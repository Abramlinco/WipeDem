import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PgAdapter, cleanUrl, sslFor } from '../src/pgAdapter.js';

// A stand-in for the real database connection, so these tests need no network.
function fakePool({ failWrites = 0, slow = false } = {}) {
  const rows = new Map();
  const stats = { upserts: 0 };
  let toFail = failWrites;
  return {
    rows, stats,
    on() {},
    async end() {},
    async query(sql, params) {
      if (/^\s*create table/i.test(sql)) return { rows: [] };
      if (/^\s*select/i.test(sql)) return { rows: rows.has(params[0]) ? [{ data: rows.get(params[0]) }] : [] };
      if (/insert into/i.test(sql)) {
        if (slow) await new Promise((r) => setTimeout(r, 20));
        if (toFail > 0) { toFail--; throw new Error('connection reset'); }
        stats.upserts++;
        rows.set(params[0], JSON.parse(params[1]));
        return { rows: [] };
      }
      throw new Error('unexpected query: ' + sql);
    }
  };
}

test('read returns null when nothing is saved yet', async () => {
  const a = new PgAdapter('postgresql://x', { pool: fakePool(), retryMs: 1 });
  assert.equal(await a.read(), null);
});

test('what is written is what is read back', async () => {
  const pool = fakePool();
  const a = new PgAdapter('postgresql://x', { pool, retryMs: 1 });
  await a.write({ alerts: [1, 2], communities: { 'discord:1': { name: 'A' } } });
  const b = new PgAdapter('postgresql://x', { pool, retryMs: 1 });
  assert.deepEqual(await b.read(), { alerts: [1, 2], communities: { 'discord:1': { name: 'A' } } });
});

test('saves that pile up are merged and the LAST state wins', async () => {
  const pool = fakePool({ slow: true });
  const a = new PgAdapter('postgresql://x', { pool, retryMs: 1 });
  const state = { n: 0 };
  const saves = [];
  for (let i = 1; i <= 10; i++) { state.n = i; saves.push(a.write(state)); }
  await Promise.all(saves);
  assert.equal(pool.rows.get('main').n, 10);
  assert.ok(pool.stats.upserts <= 3, 'ten quick changes should not cause ten database writes');
});

test('a failed save is retried', async () => {
  const pool = fakePool({ failWrites: 2 });
  const a = new PgAdapter('postgresql://x', { pool, retryMs: 1 });
  await a.write({ ok: true });
  assert.deepEqual(pool.rows.get('main'), { ok: true });
});

test('a save that keeps failing reports the error, and the next save still works', async () => {
  const pool = fakePool({ failWrites: 3 });
  const a = new PgAdapter('postgresql://x', { pool, retryMs: 1 });
  await assert.rejects(() => a.write({ v: 1 }), /connection reset/);
  await a.write({ v: 2 });
  assert.deepEqual(pool.rows.get('main'), { v: 2 });
});

test('sslmode is removed from the address and SSL is decided here', () => {
  assert.ok(!cleanUrl('postgresql://u:p%40ss@host.neon.tech/db?sslmode=require&channel_binding=require').includes('sslmode'));
  assert.ok(cleanUrl('postgresql://u:p%40ss@host.neon.tech/db?sslmode=require').includes('p%40ss'));
  assert.equal(sslFor('postgresql://u:p@localhost:5432/db', ''), false);
  assert.deepEqual(sslFor('postgresql://u:p@host.neon.tech/db', ''), { rejectUnauthorized: true });
  assert.deepEqual(sslFor('postgresql://u:p@host/db', 'insecure'), { rejectUnauthorized: false });
  assert.equal(sslFor('postgresql://u:p@host/db', 'off'), false);
});
