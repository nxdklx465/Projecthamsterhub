import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createApp } from './app';
import { openDb } from './db';
import { createMockApi } from './mock-api';
import { registerApiContractSuite } from './api-contract-suite';
import { validate } from './validate';

// M1 acceptance: the unchanged contract assertions run against the real API and mock.
registerApiContractSuite('real Express + SQLite API', () => {
  const db = openDb(':memory:');
  return { server: createServer(createApp(db)), dispose: () => db.close() };
});

registerApiContractSuite('mock API contract parity', () => ({ server: createMockApi().server }));

describe('validate', () => {
  it('defaults voltage to 220', () => {
    const v = validate({ building: 'ECC', roomNumber: '1', current: 5, motion: true });
    expect(v.ok && v.value.voltage).toBe(220);
  });
});
