// The metric function has to be right before any table it produces means anything.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generate, run, score } from './evaluate';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let evaluationDir = '';

beforeAll(() => {
  evaluationDir = mkdtempSync(join(tmpdir(), 'kses-evaluate-'));
});

afterAll(() => {
  if (evaluationDir) rmSync(evaluationDir, { recursive: true, force: true });
});

describe('score', () => {
  it('counts a worked example correctly', () => {
    //              TP     FP     FN     TN
    const pred = [true, true, false, false];
    const truth = [true, false, true, false];
    const m = score(pred, truth);
    expect(m).toMatchObject({ tp: 1, fp: 1, fn: 1, tn: 1 });
    expect(m.precision).toBeCloseTo(0.5, 6);
    expect(m.recall).toBeCloseTo(0.5, 6);
    expect(m.f1).toBeCloseTo(0.5, 6);
  });

  it('is perfect when prediction matches truth', () => {
    const t = [true, false, true, true, false];
    const m = score([...t], t);
    expect(m.precision).toBe(1);
    expect(m.recall).toBe(1);
    expect(m.f1).toBe(1);
    expect(m.fp).toBe(0);
    expect(m.fn).toBe(0);
  });

  it('gives zero, not NaN, when nothing is predicted positive', () => {
    const m = score([false, false], [true, false]);
    expect(m.precision).toBe(0);
    expect(m.recall).toBe(0);
    expect(m.f1).toBe(0);
  });

  it('gives zero, not NaN, when truth has no positives', () => {
    const m = score([true, false], [false, false]);
    expect(m.recall).toBe(0);
    expect(m.f1).toBe(0);
  });

  it('computes F1 as the harmonic mean, not the average', () => {
    // precision 1.0, recall 0.5 -> F1 = 2(1 x 0.5)/1.5 = 0.666..., not 0.75
    const m = score([true, false, false, false], [true, true, false, false]);
    expect(m.precision).toBe(1);
    expect(m.recall).toBeCloseTo(0.5, 6);
    expect(m.f1).toBeCloseTo(2 / 3, 6);
  });

  it('refuses mismatched lengths instead of scoring nonsense', () => {
    expect(() => score([true], [true, false])).toThrow(/differ in length/);
  });
});

describe('M3 evaluator', () => {
  it('runs the evaluator CLI and produces the same seed-42 report twice outside the project', () => {
    const env: NodeJS.ProcessEnv = { ...process.env, EVAL_SEED: '42' };
    delete env.EVAL_DAYS;
    delete env.EVAL_SAMPLES_PER_HOUR;
    delete env.EVAL_K;
    delete env.EVAL_ALPHA;
    delete env.EVAL_MIN_SAMPLES;

    const runCli = () =>
      execFileSync(
        process.execPath,
        [resolve(projectRoot, 'node_modules/tsx/dist/cli.mjs'), resolve(projectRoot, 'scripts/evaluate.ts')],
        { cwd: evaluationDir, env, encoding: 'utf8' },
      );

    const firstOutput = runCli();
    const firstReport = readFileSync(join(evaluationDir, 'EVALUATION.md'), 'utf8');
    const secondOutput = runCli();
    const secondReport = readFileSync(join(evaluationDir, 'EVALUATION.md'), 'utf8');

    expect(firstOutput).toBe(secondOutput);
    expect(firstReport).toBe(secondReport);
    expect(firstReport).toContain('Seed `42` · 28 days · 6 rooms · 16128 readings');
    expect(firstReport).toContain('| L1+L2+L3 | 90.5% | 74.5% | 81.7% | 822 | 86 | 282 | 14938 |');
    expect(firstReport).toContain('| judged against a baseline | 10660 |');
  });

  it('replays the chronological prefix identically without seeing future readings', () => {
    const samples = generate();
    const timestamps = samples.map((sample) => sample.ts);
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));

    const prefixLength = Math.floor(samples.length / 2);
    const fullReplay = run('L1+L2+L3', samples);
    const prefixReplay = run('L1+L2+L3', samples.slice(0, prefixLength));
    expect(prefixReplay.predicted).toEqual(fullReplay.predicted.slice(0, prefixLength));
  });
});
