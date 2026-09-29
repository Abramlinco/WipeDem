import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.SENTINEL_DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-')), 'db.json');
process.env.PORT = '0';

const { createApp } = await import('../src/server.js');
const { setAccessProvider } = await import('../src/access.js');
const { platforms } = await import('../src/platform.js');
const db = await import('../src/db.js');
const { loginAs } = await import('../src/auth/sessions.js');
const { checkMessage, resolveAction } = await import('../src/detection/detect.js');

let server, base, cookie;
const calls = [];

before(async () => {
  const app = await createApp();
  await new Promise(r => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;

  // Two groups exist. This admin manages only the first.
  setAccessProvider(async () => ({
    communities: [{ key: 'telegram:-100', platform: 'telegram', id: '-100', name: 'Mine' }],
    invites: []
  }));
  platforms.telegram.ban = async (...a) => { calls.push(['ban', ...a]); return true; };
  platforms.telegram.release = async (...a) => { calls.push(['release', ...a]); return true; };
  platforms.telegram.caution = async (...a) => { calls.push(['caution', ...a]); return true; };
  platforms.telegram.admins = async () => [{ id: '1', name: 'Boss', username: 'boss', role: 'Owner' }];

  // Sign in by creating a session directly (the real sign in needs Telegram/Discord).
  const fakeRes = { getHeader: () => undefined, setHeader: (k, v) => { cookie = String(v).split(';')[0]; } };
  await loginAs({ session: null }, fakeRes, { telegram: { user: { id: '42', username: 'abraham' } } });

  await db.addAlert({ platform: 'telegram', guildId: '-100', guildName: 'Mine', channelId: '-100', channelName: 'Mine', userId: '7', username: 'faker', text: 'send me a dm', ruleLabel: 'Unsolicited DM offer', actionTaken: 'message deleted', seenElsewhere: true, networkCount: 2 });
  await db.addAlert({ platform: 'telegram', guildId: '-200', guildName: 'Someone Elses', channelId: '-200', channelName: 'x', userId: '8', username: 'secret', text: 'private', ruleLabel: 'Other', actionTaken: 'message deleted' });
  await db.addAlert({ platform: 'telegram', guildId: '-100', guildName: 'Mine', channelId: '-100', channelName: 'Mine', userId: '9', username: 'evil', text: '=HYPERLINK("http://x")', ruleLabel: 'Banned words', actionTaken: 'message deleted' });
});

after(async () => { server.close(); await db.flushStats(); });

const api = (p, o = {}) => fetch(base + p, {
  ...o,
  headers: { 'Content-Type': 'application/json', cookie, ...(o.headers || {}) },
  body: o.body ? JSON.stringify(o.body) : undefined
});

test('nothing works without signing in', async () => {
  const r = await fetch(base + '/api/me');
  assert.equal(r.status, 401);
});

test('an admin only ever sees their own communities', async () => {
  const r = await api('/api/alerts');
  const list = await r.json();
  assert.ok(list.length >= 2);
  assert.ok(list.every(a => a.guildId === '-100'));
  assert.ok(!JSON.stringify(list).includes('secret'));
});

test("another community's people and settings are off limits", async () => {
  assert.equal((await api('/api/users/telegram/-200/8')).status, 403);
  assert.equal((await api('/api/settings/telegram/-200')).status, 403);
  assert.equal((await api('/api/users/telegram/-200/8/action', { method: 'POST', body: { action: 'ban' } })).status, 403);
  const filtered = await (await api('/api/alerts?community=telegram:-200')).json();
  assert.equal(filtered.length, 0);
});

test('forged cross site style requests are refused', async () => {
  const r = await fetch(base + '/api/users/telegram/-100/7/action', { method: 'POST', headers: { cookie, 'Content-Type': 'text/plain' }, body: '{"action":"ban"}' });
  assert.equal(r.status, 415);
});

test('profile shows history and network summary without naming other communities', async () => {
  const p = await (await api('/api/users/telegram/-100/7')).json();
  assert.equal(p.username, 'faker');
  assert.equal(p.flaggedCount, 1);
  assert.equal(p.openCount, 1);
  assert.equal(typeof p.network.communities, 'number');
});

test('caution, ban and release act on the platform and close the alert', async () => {
  let r = await api('/api/users/telegram/-100/7/action', { method: 'POST', body: { action: 'caution' } });
  assert.equal((await r.json()).resolution, 'cautioned');
  assert.equal(calls.find(c => c[0] === 'caution')[1], '-100');
  r = await api('/api/users/telegram/-100/9/action', { method: 'POST', body: { action: 'ban' } });
  assert.equal((await r.json()).resolution, 'banned');
  assert.deepEqual(calls.find(c => c[0] === 'ban').slice(1), ['-100', '9']);
  const p = await (await api('/api/users/telegram/-100/7')).json();
  assert.equal(p.openCount, 0);
  assert.equal(p.cautionCount, 1);
});

test('settings: add keyword, penalty, custom rule, escalation', async () => {
  const B = '/api/settings/telegram/-100';
  let s = await (await api(`${B}/keywords`, { method: 'POST', body: { ruleKey: 'impersonationOffer', phrase: '  Check UR dm ' } })).json();
  assert.ok(s.rules.impersonationOffer.keywords.includes('Check UR dm'));
  s = await (await api(`${B}/rule-penalty`, { method: 'POST', body: { ruleKey: 'identityClaim', mode: 'mute', minutes: 30 } })).json();
  assert.deepEqual(s.rules.identityClaim.penalty, { mode: 'mute', minutes: 30 });
  s = await (await api(`${B}/rules`, { method: 'POST', body: { label: 'Spam links' } })).json();
  const custom = Object.keys(s.rules).find(k => k.startsWith('custom_'));
  assert.equal(s.rules[custom].label, 'Spam links');
  s = await (await api(`${B}/escalation`, { method: 'POST', body: { tier2: { count: 2, action: 'mute', minutes: 15 }, strikeWindowDays: 3 } })).json();
  assert.equal(s.escalation.tier2.minutes, 15);
  assert.equal(s.strikeWindowDays, 3);
  s = await (await api(`${B}/rules/${custom}`, { method: 'DELETE' })).json();
  assert.ok(!s.rules[custom]);
  assert.equal((await api(`${B}/rules/impersonationOffer`, { method: 'DELETE' })).status, 404);
  assert.equal((await api(`${B}/rule-penalty`, { method: 'POST', body: { ruleKey: 'identityClaim', mode: 'nonsense' } })).status, 400);
});

test('trusted admin list comes from the platform', async () => {
  const a = await (await api('/api/telegram/-100/admins')).json();
  assert.equal(a[0].username, 'boss');
  assert.equal((await api('/api/telegram/-200/admins')).status, 403);
});

test('reports and csv export (formulas are neutralised)', async () => {
  const m = await (await api('/api/reports/misconduct?days=7')).json();
  assert.equal(m.days.length, 7);
  assert.ok(m.totals.flagged >= 2);
  const g = await (await api('/api/reports/growth?days=7')).json();
  assert.equal(g.days.length, 7);
  const csv = await (await api('/api/reports/export.csv?days=7')).text();
  assert.ok(csv.includes(`"'=HYPERLINK`));
  assert.ok(!csv.includes('secret'));
});

test('stats are scoped and count scanned messages', async () => {
  db.bumpStat('telegram:-100', 'scanned', 5);
  const s = await (await api('/api/stats')).json();
  assert.ok(s.scannedToday >= 5);
  assert.ok(s.threatsToday >= 2);
});

test('detection: phone apostrophes, whole words, per rule penalty', () => {
  const rules = {
    a: { label: 'A', enabled: true, keywords: ["i'm an admin", 'dm me'], penalty: { mode: 'mute', minutes: 30 } }
  };
  assert.equal(checkMessage('Hi I’m an admin here', rules).flagged, true);     // curly apostrophe
  assert.equal(checkMessage('please DM   ME now', rules).flagged, true);       // spacing and case
  assert.equal(checkMessage('the random message was fine', rules).flagged, false);
  assert.equal(checkMessage('dm meeting notes', rules).flagged, false);        // whole words only
  assert.deepEqual(resolveAction(1, {}, { mode: 'mute', minutes: 30 }), { action: 'mute', minutes: 30 });
  const esc = { tier1: { count: 1, action: 'delete' }, tier2: { count: 3, action: 'mute', minutes: 10 }, tier3: { count: 5, action: 'flag_for_ban' } };
  assert.equal(resolveAction(1, esc, {}).action, 'delete');
  assert.equal(resolveAction(3, esc, {}).action, 'mute');
  assert.equal(resolveAction(9, esc, { mode: 'escalate' }).action, 'flag_for_ban');
});

test('many things happening at the same moment are never lost', async () => {
  const before = (await db.listAlerts()).length;
  await Promise.all(Array.from({ length: 60 }, (_, i) => Promise.all([
    db.addAlert({ platform: 'telegram', guildId: '-100', guildName: 'Mine', userId: `u${i}`, username: `u${i}`, text: 'x', ruleLabel: 'r', actionTaken: 'message deleted' }),
    db.addNetworkFlag(`u${i}`, { platform: 'telegram', guildOrChatId: '-100', reason: 'r' }),
    db.addMemberEvent({ platform: 'telegram', communityId: '-100', type: 'join', userId: `j${i}` }),
    db.getStats(new Set(['telegram:-100']))
  ])));
  assert.equal((await db.listAlerts()).length, before + 60);
  assert.equal((await db.listMemberEvents({})).filter(e => e.userId?.startsWith('j')).length, 60);
  const onDisk = JSON.parse(fs.readFileSync(process.env.SENTINEL_DB_FILE, 'utf8'));
  assert.equal(onDisk.alerts.length, before + 60);
});
