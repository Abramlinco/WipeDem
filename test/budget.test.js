import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import dns from 'node:dns/promises';

// X charges for every post it sends, so these tests protect the monthly limit. The network is faked:
// nothing here reaches X or anywhere else.
process.env.SENTINEL_DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-budget-')), 'db.json');
process.env.PULSE_ENABLED = 'false';
process.env.X_BEARER_TOKEN = 'test-bearer';
process.env.X_MONTHLY_BUDGET_USD = '0.10'; // room for 20 posts
dns.lookup = async () => [{ address: '93.184.216.34' }];

let searches = 0, mode = 'ok';
globalThis.fetch = async (url) => {
  url = String(url);
  if (url.includes('api.x.com/2/tweets/search/recent')) {
    if (mode === '401') return new Response('{}', { status: 401 });
    searches++;
    const data = Array.from({ length: 10 }, (_, i) => ({ id: `${searches}${i}`, text: `airdrop post ${searches}-${i}`, created_at: new Date().toISOString(), public_metrics: { like_count: 1, retweet_count: 0 } }));
    return new Response(JSON.stringify({ data }), { status: 200 });
  }
  return new Response('not here', { status: 404 }); // every other feed simply fails, which is fine here
};

let db, feeder;
before(async () => { db = await import('../src/db.js'); await db.initDb(); feeder = await import('../src/pulse/feeder.js'); });

const xSources = async () => feeder.allSources().filter((s) => s.type === 'x');

test('X is read one search at a time and stops before it would pass the monthly limit', async () => {
  const run = await feeder.refreshTrends({ only: 'x' });
  assert.equal(run.sources, 3);
  assert.equal(searches, 2, 'the third search was never sent');
  assert.equal(db.xUsage().reads, 20);
  assert.equal(feeder.xStatus().spendUsd, 0.1);
  assert.equal(run.failed, 1);
  const status = db.getPulseMeta().sources;
  const stopped = (await xSources()).map((s) => status[s.id]).filter((s) => s && !s.ok);
  assert.match(stopped[0].error, /monthly X limit/);
});

test('once the limit is reached, X is not called at all', async () => {
  const before = searches;
  await feeder.refreshTrends({ only: 'x' });
  await feeder.refreshTrends({ only: 'x', x: true });
  assert.equal(searches, before);
});

test('a call that fails costs nothing', async () => {
  db.xUsage().reads = 0;
  mode = '401';
  const run = await feeder.refreshTrends({ only: 'x' });
  mode = 'ok';
  assert.equal(run.failed, 3);
  assert.equal(db.xUsage().reads, 0, 'the reserved amount was given back');
  const status = db.getPulseMeta().sources;
  assert.ok((await xSources()).every((s) => /refused the bearer token/.test(status[s.id].error)));
});

test('the ordinary half-hourly read never spends X credits unless X is due', async () => {
  db.xUsage().reads = 0;
  await db.setXLastRun(); // X was just read
  const before = searches;
  await feeder.refreshTrends();
  assert.equal(searches, before, 'a normal refresh left X alone');
  await feeder.refreshTrends({ x: true });
  assert.ok(searches > before, 'asking for X reads it');
});

test('estimated spend is reported against the limit', () => {
  const s = feeder.xStatus();
  assert.equal(s.limitUsd, 0.1);
  assert.equal(s.readingOn, true);
  assert.equal(s.everyHours, 12);
});
