// M3 evaluation: how much does each detection level actually buy us?
//
// Generates a labelled set of SYNTHETIC scenarios, replays them in time order,
// and reports Precision / Recall / F1 for L1, L1+L2 and L1+L2+L3.
//
// The data is generated, not measured at KMITL. Every number this prints is a
// property of the generator below, and the report must say so.
//
//   npm run evaluate            # default seed
//   EVAL_SEED=7 npm run evaluate
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { analyze, WASTE_THRESHOLD_A } from '../src/engine/energy';
import {
  EMPTY_BASELINE,
  detect,
  hourOfWeek,
  update,
  type BaselineOptions,
  type BaselineStats,
} from '../server/baseline';

// ---------------------------------------------------------------------------
// Reproducible randomness. A report nobody can re-run is not evidence.
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = Number(process.env.EVAL_SEED) || 42;
const rand = mulberry32(SEED);
/** Box-Muller, so noise is normal rather than uniform. */
const gauss = (mean: number, sd: number) =>
  mean + sd * Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());

// ---------------------------------------------------------------------------
// Scenario generator
// ---------------------------------------------------------------------------
export type Label = 'normal_occupied' | 'normal_idle' | 'lights_left_on' | 'subtle_waste';

export type Sample = {
  roomId: string;
  ts: number;
  current: number;
  motion: boolean;
  label: Label;
  /** Ground truth: is this room wasting energy right now? */
  waste: boolean;
};

const DAYS = Number(process.env.EVAL_DAYS) || 28;
const ROOMS = 6;
/**
 * Readings per room per hour. A real node reports every few seconds; the project's
 * own simulator does too. One reading per hour would leave each of the 168
 * hour-of-week buckets with only DAYS/7 samples, below L3's minimum, so L3 would
 * never get to judge and would silently look like "no benefit".
 */
const SAMPLES_PER_HOUR = Number(process.env.EVAL_SAMPLES_PER_HOUR) || 4;
/** 2026-10-26 is a Monday, so hour-of-week buckets line up with the week. */
const START = new Date(2026, 9, 26, 0, 0, 0).getTime();
const HOUR = 3_600_000;

export function generate(): Sample[] {
  const samples: Sample[] = [];
  const rooms = Array.from({ length: ROOMS }, (_, i) => ({
    id: `room-${i + 1}`,
    // Rooms differ a lot: a lecture room idles near 0.6 A, a lab near 2.5 A.
    idle: 0.6 + rand() * 2.0,
    busy: 3 + rand() * 7,
  }));

  for (let h = 0; h < DAYS * 24; h++) {
    const ts = START + h * HOUR;
    const d = new Date(ts);
    const weekday = d.getDay() >= 1 && d.getDay() <= 5;
    const teaching = weekday && d.getHours() >= 8 && d.getHours() < 18;

    for (const room of rooms) {
      // The room's situation is decided once per hour; the readings inside that
      // hour are the same situation sampled repeatedly, which is how a sensor behaves.
      const roll = rand();
      let motion: boolean;
      let label: Label;
      let centre: number;
      let spread: number;

      if (teaching && roll < 0.65) {
        // In use. High load here is legitimate and must NOT be flagged.
        motion = true;
        centre = room.busy;
        spread = room.busy * 0.12;
        label = 'normal_occupied';
      } else if (roll < 0.93) {
        // Empty and properly shut down.
        motion = false;
        centre = room.idle;
        spread = room.idle * 0.15;
        label = 'normal_idle';
      } else if (roll < 0.97) {
        // Lights and air left running. Clearly over the fixed threshold.
        motion = false;
        centre = 12;
        spread = 3;
        label = 'lights_left_on';
      } else {
        // The interesting class: several times this room's own idle draw, but
        // still UNDER 7 A, so the L1 rule is blind to it by construction.
        motion = false;
        centre = Math.min(WASTE_THRESHOLD_A - 0.5, room.idle * 4);
        spread = 0.3;
        label = 'subtle_waste';
      }

      for (let q = 0; q < SAMPLES_PER_HOUR; q++) {
        const raw = gauss(centre, spread);
        const current =
          label === 'subtle_waste'
            ? Math.min(WASTE_THRESHOLD_A - 0.1, Math.max(room.idle * 2.5, raw))
            : Math.max(0.05, raw);
        samples.push({
          roomId: room.id,
          ts: ts + Math.round((q * HOUR) / SAMPLES_PER_HOUR),
          current: Math.round(current * 100) / 100,
          motion,
          label,
          waste: label === 'lights_left_on' || label === 'subtle_waste',
        });
      }
    }
  }
  // Replay must be causal, so order globally by time. Ties between rooms are
  // irrelevant: no detector uses another room's state.
  return samples.sort((a, b) => a.ts - b.ts);
}

// ---------------------------------------------------------------------------
// Detectors. Each sees only the samples that came before it, in time order.
// ---------------------------------------------------------------------------
// Overridable so the operating point can be swept and the choice justified with numbers
// rather than asserted. The defaults here are what server/config.ts ships.
const BASELINE_OPTS: BaselineOptions = {
  alpha: Number(process.env.EVAL_ALPHA) || 0.3,
  k: Number(process.env.EVAL_K) || 6,
  minSamples: Number(process.env.EVAL_MIN_SAMPLES) || 5,
  sdFloor: 0.05,
};
const HISTORY_WINDOW = 20;

export type Level = 'L1' | 'L1+L2' | 'L1+L2+L3';

/** Why an L3 judgement did not happen. Reported, never swallowed. */
type Skips = { insufficient_history: number; baseline_too_flat: number; judged: number };

export function run(level: Level, samples: Sample[]): { predicted: boolean[]; skips: Skips } {
  const history = new Map<string, number[]>();
  const baselines = new Map<string, BaselineStats>();
  const out: boolean[] = [];
  const skips: Skips = { insufficient_history: 0, baseline_too_flat: 0, judged: 0 };

  for (const s of samples) {
    const past = history.get(s.roomId) ?? [];
    let flagged: boolean;

    if (level === 'L1') {
      flagged = !s.motion && s.current >= WASTE_THRESHOLD_A;
    } else {
      const a = analyze(s.current, s.motion, past);
      flagged = a.status === 'Energy Waste' || a.anomaly;

      if (level === 'L1+L2+L3') {
        const key = `${s.roomId}:${hourOfWeek(s.ts)}`;
        const stats = baselines.get(key) ?? EMPTY_BASELINE;
        const verdict = detect(stats, s.current, s.motion, BASELINE_OPTS);
        if (verdict.skipped) skips[verdict.skipped]++;
        else skips.judged++;
        if (verdict.flagged) flagged = true;
        // Mirrors the server: only readings judged normal shape the baseline.
        if (!flagged) baselines.set(key, update(stats, s.current, BASELINE_OPTS.alpha));
      }
    }

    out.push(flagged);
    past.push(s.current);
    if (past.length > HISTORY_WINDOW) past.shift();
    history.set(s.roomId, past);
  }
  return { predicted: out, skips };
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------
type Metrics = { tp: number; fp: number; fn: number; tn: number; precision: number; recall: number; f1: number };

export function score(predicted: boolean[], truth: boolean[]): Metrics {
  if (predicted.length !== truth.length) throw new Error('predicted and truth differ in length');
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (let i = 0; i < truth.length; i++) {
    if (predicted[i] && truth[i]) tp++;
    else if (predicted[i] && !truth[i]) fp++;
    else if (!predicted[i] && truth[i]) fn++;
    else tn++;
  }
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { tp, fp, fn, tn, precision, recall, f1 };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** Recall restricted to one ground-truth class, which is where L1 and L3 differ. */
function recallFor(label: Label, predicted: boolean[], samples: Sample[]): string {
  let hit = 0;
  let total = 0;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].label !== label) continue;
    total++;
    if (predicted[i]) hit++;
  }
  return total === 0 ? 'n/a' : `${pct(hit / total)} (${hit}/${total})`;
}

// ---------------------------------------------------------------------------
function main(): void {
  const samples = generate();
  const truth = samples.map((s) => s.waste);
  const levels: Level[] = ['L1', 'L1+L2', 'L1+L2+L3'];
  const results = levels.map((level) => {
    const { predicted, skips } = run(level, samples);
    return { level, predicted, skips, metrics: score(predicted, truth) };
  });
  const l3 = results[results.length - 1];

  const counts = samples.reduce<Record<string, number>>((acc, s) => {
    acc[s.label] = (acc[s.label] ?? 0) + 1;
    return acc;
  }, {});

  const lines: string[] = [];
  lines.push('# K-SES — Detection evaluation (L1 vs L1+L2 vs L1+L2+L3)');
  lines.push('');
  lines.push('> **The data in this report is synthetic.** It is generated by');
  lines.push('> `scripts/evaluate.ts`, not measured at KMITL. The numbers describe how the');
  lines.push('> detectors behave on that generator, and nothing more. Regenerate with');
  lines.push('> `npm run evaluate`.');
  lines.push('');
  lines.push(`Seed \`${SEED}\` · ${DAYS} days · ${ROOMS} rooms · ${samples.length} readings`);
  lines.push('');
  lines.push('## Ground truth');
  lines.push('');
  lines.push('| Class | Readings | Wasting? |');
  lines.push('| --- | ---: | --- |');
  lines.push(`| normal_occupied — in use, load is legitimate | ${counts.normal_occupied ?? 0} | no |`);
  lines.push(`| normal_idle — empty and shut down | ${counts.normal_idle ?? 0} | no |`);
  lines.push(`| lights_left_on — empty, well over ${WASTE_THRESHOLD_A} A | ${counts.lights_left_on ?? 0} | **yes** |`);
  lines.push(`| subtle_waste — empty, several times its own idle draw but **under ${WASTE_THRESHOLD_A} A** | ${counts.subtle_waste ?? 0} | **yes** |`);
  lines.push('');
  lines.push('## Results');
  lines.push('');
  lines.push('| Level | Precision | Recall | F1 | TP | FP | FN | TN |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const { level, metrics: m } of results) {
    lines.push(
      `| ${level} | ${pct(m.precision)} | ${pct(m.recall)} | ${pct(m.f1)} | ${m.tp} | ${m.fp} | ${m.fn} | ${m.tn} |`,
    );
  }
  lines.push('');
  lines.push('## Recall per class — where the levels actually differ');
  lines.push('');
  lines.push('| Level | lights_left_on | subtle_waste |');
  lines.push('| --- | --- | --- |');
  for (const { level, predicted } of results) {
    lines.push(`| ${level} | ${recallFor('lights_left_on', predicted, samples)} | ${recallFor('subtle_waste', predicted, samples)} |`);
  }
  lines.push('');
  lines.push('## Did L3 actually get to judge?');
  lines.push('');
  lines.push('A level that never runs looks identical to a level that runs and finds nothing.');
  lines.push('These counts tell the two apart.');
  lines.push('');
  lines.push('| Outcome | Readings |');
  lines.push('| --- | ---: |');
  lines.push(`| judged against a baseline | ${l3.skips.judged} |`);
  lines.push(`| skipped — fewer than ${BASELINE_OPTS.minSamples} readings in that hour bucket | ${l3.skips.insufficient_history} |`);
  lines.push(`| skipped — baseline too flat to divide by | ${l3.skips.baseline_too_flat} |`);
  lines.push('');
  lines.push('## Settings used');
  lines.push('');
  lines.push(`L1 threshold ${WASTE_THRESHOLD_A} A · L3 alpha ${BASELINE_OPTS.alpha}, k ${BASELINE_OPTS.k}, minSamples ${BASELINE_OPTS.minSamples}, sdFloor ${BASELINE_OPTS.sdFloor}`);
  lines.push('');
  lines.push('`k` was chosen by sweeping it on this generator and checking the choice holds');
  lines.push('across several seeds, not by taste. Reproduce either with:');
  lines.push('');
  lines.push('```bash');
  lines.push('for k in 3 3.5 4 4.5 5 6 8; do EVAL_K=$k npm run evaluate; done');
  lines.push('for s in 42 7 99 2026; do EVAL_SEED=$s npm run evaluate; done');
  lines.push('```');
  lines.push('');
  lines.push('## Reading this');
  lines.push('');
  lines.push(`L1 is a fixed ${WASTE_THRESHOLD_A} A threshold, so its recall on \`subtle_waste\` is 0 by`);
  lines.push('construction — that class is generated below the threshold on purpose. L2 and L3');
  lines.push("compare a reading against the room's own behaviour instead, which is the only way");
  lines.push('that class can be caught. Any gain comes with false positives; the FP column is the price.');
  lines.push('');
  lines.push('Without L4, describe the system as *rule-based + statistical anomaly detection*.');
  lines.push('It is not machine learning.');

  const report = lines.join('\n') + '\n';
  const out = resolve(process.cwd(), 'EVALUATION.md');
  writeFileSync(out, report, 'utf8');

  console.log(report);
  console.log(`written to ${out}`);
}

// Only when run directly, so tests can import score() without generating a report.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
