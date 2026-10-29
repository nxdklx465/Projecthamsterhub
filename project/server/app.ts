// HTTP boundary only: routing, CORS, body limits, error translation.
// No business rule and no SQL lives here.
import express, { type NextFunction, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { config } from './config';
import { AppError, ValidationError } from './errors';
import { createStore, type Store } from './store';
import { ingest } from './analyze';
import { roomId, validate } from './validate';
import { INITIAL_ROOMS } from '../src/data/rooms';

/**
 * ใส่ห้องเดโมหกห้องที่ dashboard คาดหวัง ลงฐานข้อมูลที่ยังว่างเท่านั้น
 *
 * id ต้องมาจาก roomId(building, roomNumber) ตัวเดียวกับที่ ingest() ใช้ ไม่ใช่ id ที่เขียน
 * มือไว้ใน src/data/rooms.ts ซึ่งเป็นข้อมูลที่ frontend ใช้ใน local mode ถ้าสองฝั่งสร้าง id
 * ไม่ตรงกัน telemetry ของห้องเดิมจะไปสร้างแถวใหม่ ทำให้ห้องซ้ำและห้องที่งอกใหม่เสีย zone เดิม
 */
function seed(store: Store): void {
  if (!store.isEmpty()) return;
  for (const room of INITIAL_ROOMS)
    store.upsertRoom({ ...room, id: roomId(room.building, room.roomNumber), lastUpdated: Date.now() });
  store.recordEvent('info', `seeded ${INITIAL_ROOMS.length} rooms`);
}

export function createApp(db: DatabaseSync) {
  const store = createStore(db);
  seed(store);

  const app = express();
  app.disable('x-powered-by');

  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (config.corsOrigins.length === 0) {
      // Development default. CORS_ORIGINS must be set before this is deployed.
      res.setHeader('Access-Control-Allow-Origin', origin ?? '*');
    } else if (origin && config.corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use(express.json({ limit: config.maxBodyBytes }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.get('/api/rooms', (_req: Request, res: Response) => {
    res.json({ rooms: store.listRooms() });
  });

  app.get('/api/readings', (req: Request, res: Response) => {
    const asked = Number(req.query.limit);
    const wanted = Number.isFinite(asked) && asked > 0 ? Math.floor(asked) : config.readingsDefaultLimit;
    const limit = Math.min(wanted, config.readingsMaxLimit);
    const roomId = typeof req.query.roomId === 'string' && req.query.roomId ? req.query.roomId : undefined;
    res.json({ readings: store.listReadings(limit, roomId) });
  });

  app.post('/api/telemetry', (req: Request, res: Response) => {
    const checked = validate(req.body);
    if (!checked.ok) {
      store.recordEvent('warn', `REJECTED telemetry: ${checked.errors.join('; ')}`);
      throw new ValidationError(checked.errors);
    }
    res.json(ingest(store, checked.value));
  });

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ errors: ['not found'] });
  });

  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }

    if (err instanceof ValidationError) {
      res.status(400).json({ errors: err.errors });
      return;
    }
    // body-parser: malformed JSON, or a body over config.maxBodyBytes.
    const type = typeof err === 'object' && err !== null ? (err as { type?: string }).type : undefined;
    if (err instanceof SyntaxError && 'body' in err) {
      store.recordEvent('warn', 'REJECTED telemetry: body was not valid JSON');
      res.status(400).json({ errors: ['body must be valid JSON (max 10 KB)'] });
      return;
    }
    if (type === 'entity.too.large') {
      store.recordEvent('warn', 'REJECTED telemetry: body too large');
      res.status(400).json({ errors: ['body must be valid JSON (max 10 KB)'] });
      return;
    }

    // Anything else is ours. The detail goes to the log and the events table, never to the client.
    const correlationId = randomUUID();
    const detail = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ level: 'error', correlationId, detail }));
    try {
      store.recordEvent('error', `internal error ${correlationId}`);
    } catch {
      // The database is the thing that failed; do not mask the original error behind a second one.
    }
    const status = err instanceof AppError ? err.status : 500;
    res.status(status).json({ errors: ['internal error'], correlationId });
  });

  return app;
}
