// Acceptance test for M1: the real Express + SQLite service against API_CONTRACT.md.
// Mirrors server/api.test.ts (which covers the mock) so both implementations are held
// to one contract. Each run uses a fresh in-memory database.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from './app';
import { openDb } from './db';
import { createStore } from './store';
import { roomId, validate } from './validate';
import { INITIAL_ROOMS } from '../src/data/rooms';
import type { ErrorResponse, ReadingsResponse, RoomsResponse, TelemetryResponse } from './contract';

const db = openDb(':memory:');
let server: Server;
let base = '';

beforeAll(async () => {
  server = createApp(db).listen(0);
  await new Promise<void>((r) => server.once('listening', r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  db.close();
});

const post = (body: unknown, raw = false) =>
  fetch(`${base}/api/telemetry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw ? (body as string) : JSON.stringify(body),
  });

const good = { building: 'ECC', roomNumber: '402', current: 20, voltage: 220, motion: false };

describe('POST /api/telemetry', () => {
  it('flags energy waste with reasons', async () => {
    const res = await post(good);
    const data = (await res.json()) as TelemetryResponse;
    expect(res.status).toBe(200);
    expect(data.status).toBe('Energy Waste');
    expect(data.reasons.length).toBeGreaterThan(0);
    expect(data.monthly.baht).toBeGreaterThan(0);
    expect(data.room.id).toBe('ecc-402');
    // 'ECC' ไม่ใช่อาคารที่ seed ไว้ ('ECC Building') ห้องนี้จึงเป็นห้องใหม่ และได้ zone 'Simulated'
    // การรักษา zone ของห้องที่ seed ไว้ ตรวจใน describe 'seeded room identity' ด้านล่าง
    expect(data.room.zone).toBe('Simulated');
  });

  it('reports normal when occupied', async () => {
    const data = (await (await post({ ...good, motion: true })).json()) as TelemetryResponse;
    expect(data.status).toBe('Normal');
  });

  it('defaults voltage to 220 when omitted', async () => {
    const data = (await (await post({ building: 'ECC', roomNumber: '9', current: 10, motion: false })).json()) as TelemetryResponse;
    expect(data.status).toBe('Energy Waste');
    // 10 A x 220 V = 2.2 kW
    const rd = (await (await fetch(`${base}/api/readings?roomId=ecc-9&limit=1`)).json()) as ReadingsResponse;
    expect(rd.readings[0].power).toBe(2.2);
  });

  it.each([
    [{ ...good, current: -1 }],
    [{ ...good, current: 'x' }],
    [{ ...good, voltage: 9999 }],
    [{ ...good, roomNumber: '' }],
    [{ ...good, motion: 'yes' }],
    [{}],
  ])('rejects invalid payload %#', async (bad) => {
    const res = await post(bad);
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorResponse).errors.length).toBeGreaterThan(0);
  });

  it('rejects malformed JSON without crashing', async () => {
    expect((await post('{oops', true)).status).toBe(400);
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
  });

  it('rejects a body over the size cap without crashing', async () => {
    const huge = JSON.stringify({ ...good, building: 'x'.repeat(20_000) });
    expect((await post(huge, true)).status).toBe(400);
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
  });

  it('names which rule fired, not how many', async () => {
    const data = (await (await post({ ...good, current: 50 })).json()) as TelemetryResponse;
    expect(data.reasons.some((r) => r.includes('ไม่มีคนอยู่'))).toBe(true);
  });
});

describe('read endpoints', () => {
  it('lists rooms and readings', async () => {
    await post(good);
    const rooms = (await (await fetch(`${base}/api/rooms`)).json()) as RoomsResponse;
    expect(rooms.rooms.some((r) => r.id === 'ecc-402')).toBe(true);
    const rd = (await (await fetch(`${base}/api/readings?limit=5&roomId=ecc-402`)).json()) as ReadingsResponse;
    expect(rd.readings.length).toBeGreaterThan(0);
  });

  it('returns readings oldest first', async () => {
    const rd = (await (await fetch(`${base}/api/readings?limit=50&roomId=ecc-402`)).json()) as ReadingsResponse;
    const stamps = rd.readings.map((r) => r.timestamp);
    expect([...stamps].sort((a: number, b: number) => a - b)).toEqual(stamps);
  });

  it('caps limit at the configured maximum', async () => {
    const res = await fetch(`${base}/api/readings?limit=99999`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as ReadingsResponse).readings.length).toBeLessThanOrEqual(500);
  });

  it('returns 404 for unknown routes', async () => {
    expect((await fetch(`${base}/api/nope`)).status).toBe(404);
  });
});

describe('persistence', () => {
  it('survives a restart of the app on the same database', async () => {
    const second = createApp(db).listen(0);
    await new Promise<void>((r) => second.once('listening', r));
    const port = (second.address() as AddressInfo).port;
    const rooms = (await (await fetch(`http://localhost:${port}/api/rooms`)).json()) as RoomsResponse;
    expect(rooms.rooms.some((r) => r.id === 'ecc-402')).toBe(true);
    await new Promise<void>((r) => second.close(() => r()));
  });
});

describe('fault tolerance', () => {
  it('records the rejected field reasons in events and keeps serving requests', async () => {
    const expectedErrors = [
      'building is required (max 40 chars)',
      'current must be a number between 0 and 100 (A)',
    ];
    const expectedEventMessage = `REJECTED telemetry: ${expectedErrors.join('; ')}`;
    const before = db.prepare('SELECT COUNT(*) AS n FROM readings WHERE room_id = ?').get('ecc-402') as { n: number };

    const res = await post({ ...good, building: 'x'.repeat(41), current: -1 });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorResponse).errors).toEqual(expectedErrors);

    const event = db.prepare('SELECT level, message FROM events WHERE message = ?').get(expectedEventMessage) as
      | { level: string; message: string }
      | undefined;
    expect(event).toEqual({ level: 'warn', message: expectedEventMessage });

    const after = db.prepare('SELECT COUNT(*) AS n FROM readings WHERE room_id = ?').get('ecc-402') as { n: number };
    expect(after.n).toBe(before.n);
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
  });

  it('records every rejection instead of dropping it', () => {
    const store = createStore(db);
    const before = store.listRooms().length;
    expect(validate({}).ok).toBe(false);
    // the REJECTED events were written by the requests above; no room was created for them
    expect(store.listRooms().length).toBe(before);
  });

  it('skips the z-score until there is enough history', () => {
    const store = createStore(db);
    expect(store.recentCurrents('room-with-no-history', 20)).toEqual([]);
  });
});

// Regression: seed() ต้องใส่ห้องด้วย id เดียวกับที่ roomId() สร้างจาก building และ roomNumber
// ไม่ใช่ id ที่เขียนมือไว้ใน src/data/rooms.ts มิฉะนั้น telemetry ของห้องเดิมจะไปสร้างแถวใหม่
// ทำให้ dashboard เห็น 12 ห้องแทน 6 ห้อง และห้องที่งอกใหม่ได้ zone 'Simulated'
describe('seeded room identity', () => {
  it('seeds every room under the id roomId() builds, with its zone', async () => {
    const rooms = (await (await fetch(`${base}/api/rooms`)).json()) as RoomsResponse;
    for (const seeded of INITIAL_ROOMS) {
      const id = roomId(seeded.building, seeded.roomNumber);
      const found = rooms.rooms.find((r) => r.id === id);
      expect(found, `seeded room ${seeded.building} ${seeded.roomNumber} must exist as id ${id}`).toBeDefined();
      expect(found?.zone).toBe(seeded.zone);
    }
  });

  it('updates the seeded room instead of creating a duplicate', async () => {
    const seeded = INITIAL_ROOMS[0];
    const expectedId = roomId(seeded.building, seeded.roomNumber);
    const before = (await (await fetch(`${base}/api/rooms`)).json()) as RoomsResponse;

    const res = await post({
      building: seeded.building,
      roomNumber: seeded.roomNumber,
      current: 3.1,
      voltage: 220,
      motion: true,
    });
    const data = (await res.json()) as TelemetryResponse;
    expect(res.status).toBe(200);

    // identity ไม่ใช่จำนวนอย่างเดียว: id ต้องเป็นค่าที่ roomId() สร้าง และ zone ต้องเป็นค่าเดิมจาก seed
    expect(data.room.id).toBe(expectedId);
    expect(data.room.zone).toBe(seeded.zone);

    const after = (await (await fetch(`${base}/api/rooms`)).json()) as RoomsResponse;
    expect(after.rooms.length).toBe(before.rooms.length);

    // ห้องเดียวกันต้องมีแถวเดียว ไม่ใช่สองแถวที่ id ต่างกัน
    const ids = after.rooms
      .filter((r) => r.building === seeded.building && r.roomNumber === seeded.roomNumber)
      .map((r) => r.id);
    expect(ids).toEqual([expectedId]);
  });
});
