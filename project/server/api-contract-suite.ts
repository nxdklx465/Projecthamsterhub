import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { ErrorResponse, ReadingsResponse, RoomsResponse, TelemetryResponse } from './contract';

type ApiTarget = { server: Server; dispose?: () => void };

/** Register the same unchanged HTTP contract assertions against one API implementation. */
export function registerApiContractSuite(name: string, createTarget: () => ApiTarget): void {
  describe(name, () => {
    let target: ApiTarget | undefined;
    let base = '';

    beforeAll(async () => {
      const started = createTarget();
      target = started;
      await new Promise<void>((resolve, reject) => {
        started.server.once('error', reject);
        started.server.listen(0, resolve);
      });
      base = `http://localhost:${(started.server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      if (!target) return;
      const started = target;
      await new Promise<void>((resolve) => started.server.close(() => resolve()));
      started.dispose?.();
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
        expect(data.reasons.some((reason) => reason.includes('ไม่มีคนอยู่'))).toBe(true);
        expect(data.monthly.baht).toBeGreaterThan(0);
      });

      it('reports normal when occupied', async () => {
        const data = (await (await post({ ...good, motion: true })).json()) as TelemetryResponse;
        expect(data.status).toBe('Normal');
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
    });

    describe('read endpoints', () => {
      it('lists rooms and readings', async () => {
        await post(good);
        const rooms = (await (await fetch(`${base}/api/rooms`)).json()) as RoomsResponse;
        expect(rooms.rooms.some((r: { id: string }) => r.id === 'ecc-402')).toBe(true);
        const rd = (await (await fetch(`${base}/api/readings?limit=5&roomId=ecc-402`)).json()) as ReadingsResponse;
        expect(rd.readings.length).toBeGreaterThan(0);
      });

      it('returns 404 for unknown routes', async () => {
        expect((await fetch(`${base}/api/nope`)).status).toBe(404);
      });
    });
  });
}
