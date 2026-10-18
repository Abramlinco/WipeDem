// notify-patch
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.SENTINEL_DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-notify-')), 'db.json');
process.env.PORT = '0';
process.env.PULSE_ENABLED = 'false';
process.env.AI_PROVIDER = 'none';

const { createApp } = await import('../src/server.js');
const { setAccessProvider } = await import('../src/access.js');
const db = await import('../src/db.js');
const { loginAs } = await import('../src/auth/sessions.js');
const notify = await import('../src/pulse/notify.js');

const OLD = '2000-01-01T00:00:00.000Z';
let server, base, cookie;
const item = (communityId, text, extra = {}) => db.addDiscussion({
  platform: 'telegram', communityId, communityName: communityId === '-100' ? 'Mine' : 'Someone Elses', channelId: communityId,
  userId: '1', username: 'ann', messageId: String(Math.floor(Math.random() * 1e9)), text, kind: 'question', score: 5, topics: [], sentiment: 0, ...extra
});

before(async () => {
  const app = await createApp();
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  setAccessProvider(async () => ({ communities: [{ key: 'telegram:-100', platform: 'telegram', id: '-100', name: 'Mine' }], invites: [] }));
  const fakeRes = { getHeader: () => undefined, setHeader: (k, v) => { cookie = String(v).split(';')[0]; } };
  await loginAs({ session: null }, fakeRes, { telegram: { user: { id: '42', username: 'abraham' } } });
});
after(async () => { server.close(); await db.flushStats(); });

const api = (p, o = {}) => fetch(base + p, {
  ...o, headers: { 'Content-Type': 'application/json', cookie, ...(o.headers || {}) }, body: o.body ? JSON.stringify(o.body) : undefined
});

test('buildSummary counts what is new and what still needs a person', () => {
  const now = new Date().toISOString();
  const d = (o) => ({ id: Math.random().toString(36), kind: 'question', status: 'new', createdAt: now, username: 'a', text: 'hello', ...o });
  const s = notify.buildSummary({
    discussions: [d({}), d({ kind: 'concern' }), d({ kind: 'praise' }), d({ staffReplied: true }), d({ status: 'done' }), d({ createdAt: OLD })],
    alerts: [{ id: 'a1', platform: 'discord', guildName: 'G', username: 'x', text: 'scam', createdAt: now }],
    faqs: [], seen: { pulse: OLD, alerts: now, faqs: OLD }, now
  });
  assert.equal(s.open.pulse.total, 3); // question, concern, and the old question; praise, answered and done are skipped
  assert.equal(s.open.pulse.questions, 2);
  assert.equal(s.unseen.pulse, 2);
  assert.equal(s.unseen.alerts, 0);
  assert.equal(s.unseen.total, 2);
  assert.ok(s.items.every((i) => i.at >= new Date(Date.parse(now) - 7 * 86400000).toISOString()));
});

test('the summary needs a sign in', async () => {
  assert.equal((await fetch(base + '/api/notifications/summary')).status, 401);
});

test('the summary only counts my communities and what is newer than the last look', async () => {
  item('-100', 'How do I stake?');
  item('-200', 'secret question from another community');
  const all = await (await api(`/api/notifications/summary?pulse=${OLD}`)).json();
  assert.equal(all.unseen.pulse, 1);
  assert.ok(!JSON.stringify(all).includes('secret'));
  const caughtUp = await (await api(`/api/notifications/summary?pulse=${encodeURIComponent(new Date(Date.now() + 5000).toISOString())}`)).json();
  assert.equal(caughtUp.unseen.pulse, 0);
  assert.equal(caughtUp.open.pulse.total, 1);
});

test('phone alerts can only be switched on for an account you are signed in with', async () => {
  assert.equal((await api('/api/notifications/dm', { method: 'POST', body: { channel: 'discord', on: true } })).status, 400);
  assert.equal((await api('/api/notifications/dm', { method: 'POST', body: { channel: 'nope', on: true } })).status, 400);
  const ok = await (await api('/api/notifications/dm', { method: 'POST', body: { channel: 'telegram', on: true, kinds: ['question', 'bogus'] } })).json();
  assert.deepEqual(ok.kinds, ['question']);
  const sum = await (await api('/api/notifications/summary')).json();
  assert.equal(sum.dm.telegram.on, true);
  assert.equal(sum.dm.discord, null);
});

test('a phone alert goes out for a matching message, and only to managers of that community', async () => {
  const sent = [];
  notify.setDmSender(async (channel, userId, text) => { sent.push({ channel, userId, text }); });
  notify.setManageChecker(async (sub, key) => key === 'telegram:-100');
  try {
    await notify.saveSub('telegram', '42', { on: true, kinds: ['question'], ids: { telegram: '42' }, keys: ['telegram:-100'] });
    notify.notifyNewDiscussion(item('-100', 'When does staking open?'));
    notify.notifyNewDiscussion(item('-100', 'We should add a quiz', { kind: 'idea' })); // kind not selected
    notify.notifyNewDiscussion(item('-200', 'question in a community I do not manage'));
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].userId, '42');
    assert.match(sent[0].text, /When does staking open/);
    assert.ok(!sent[0].text.includes('do not manage'));
  } finally {
    notify.setDmSender(null); notify.setManageChecker(null);
    await notify.saveSub('telegram', '42', { on: false });
  }
});
