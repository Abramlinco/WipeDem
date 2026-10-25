import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.SENTINEL_DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-harden-')), 'db.json');
process.env.PORT = '0';
process.env.PULSE_ENABLED = 'false';
process.env.AI_PROVIDER = 'none';

const { createApp } = await import('../src/server.js');
const { config } = await import('../src/config.js');
const { setAccessProvider } = await import('../src/access.js');
const { platforms } = await import('../src/platform.js');
const db = await import('../src/db.js');
const { loginAs, parseCookies, sessionTag } = await import('../src/auth/sessions.js');
const login = await import('../src/auth/telegramLogin.js');
const { checkMessage, newAccountWithLink, findLinks } = await import('../src/detection/detect.js');
const { checkPolicy } = await import('../src/pulse/reply.js');
const { decode } = await import('../src/pulse/sources.js');

let server, base, cookie, sessionId;
let access = [{ key: 'telegram:-100', platform: 'telegram', id: '-100', name: 'Mine' }];
const api = (p, o = {}) => fetch(base + p, { ...o, headers: { 'Content-Type': 'application/json', cookie, ...(o.headers || {}) }, body: o.body ? JSON.stringify(o.body) : undefined });
const item = (text) => db.addDiscussion({ platform: 'telegram', communityId: '-100', communityName: 'Mine', channelId: '-100', userId: '1', username: 'ann', messageId: String(Math.floor(Math.random() * 1e6)), text, kind: 'question', score: 5, topics: [], sentiment: 0 });

before(async () => {
  const app = await createApp();
  await new Promise(r => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  setAccessProvider(async () => ({ communities: access, invites: [] }));
  const fakeRes = { getHeader: () => undefined, setHeader: (k, v) => { cookie = String(v).split(';')[0]; } };
  const s = await loginAs({ session: null }, fakeRes, { telegram: { user: { id: '42', username: 'abraham' } } });
  sessionId = s.id;
});
after(async () => { server.close(); await db.flushStats(); });

test('a rule key like __proto__ is refused and never reaches Object.prototype', async () => {
  const B = '/api/settings/telegram/-100';
  for (const ruleKey of ['__proto__', 'constructor', 'toString']) {
    for (const [p, body] of [['/rule-toggle', { ruleKey, enabled: true }], ['/rule-penalty', { ruleKey, mode: 'delete' }], ['/keywords', { ruleKey, phrase: 'x' }]]) {
      assert.equal((await api(B + p, { method: 'POST', body })).status, 404, `${ruleKey} ${p}`);
    }
  }
  assert.equal({}.enabled, undefined, 'Object.prototype was not touched');
  assert.equal((await api(B + '/rule-toggle', { method: 'POST', body: { ruleKey: 'suspiciousLinks', enabled: true } })).status, 200);
});

test('a malformed cookie does not break anything', async () => {
  assert.deepEqual(parseCookies('x=100%; sentinel_sid=abc'), { x: '100%', sentinel_sid: 'abc' });
  const r = await fetch(base + '/api/me', { headers: { cookie: `x=100%; ${cookie}` } });
  assert.equal(r.status, 200);
});

test('session tags are not the start of the session id', () => {
  assert.equal(sessionTag({ id: sessionId }).length, 8);
  assert.notEqual(sessionTag({ id: sessionId }), sessionId.slice(0, 8));
});

test('the shared network list needs at least one managed community', async () => {
  assert.equal((await api('/api/network')).status, 200);
  const saved = access; access = [];
  try { assert.equal((await api('/api/network')).status, 403); } finally { access = saved; }
});

test('Telegram sign in needs the number, and the browser that asked for it', () => {
  const a = login.newLogin();
  assert.equal(login.loginChoices(a.code).length, 3);
  assert.ok(login.loginChoices(a.code).includes(a.number));
  const wrong = a.number === 10 ? 11 : a.number - 1;
  assert.equal(login.completeTelegramLogin(a.code, { id: 5 }, wrong), false);
  assert.equal(login.completeTelegramLogin(a.code, { id: 5 }), false, 'no number, no sign in');
  assert.equal(login.takeConfirmedLogin(a.code, a.bind), null, 'nothing confirmed yet');
  assert.equal(login.completeTelegramLogin(a.code, { id: 5, username: 'u' }, a.number), true);
  assert.equal(login.takeConfirmedLogin(a.code, 'someone-elses-browser'), null);
  assert.equal(login.takeConfirmedLogin(a.code, ''), null);
  assert.equal(login.takeConfirmedLogin(a.code, a.bind).id, '5');
  assert.equal(login.takeConfirmedLogin(a.code, a.bind), null, 'works once');
  const b = login.newLogin(); login.cancelLogin(b.code);
  assert.equal(login.completeTelegramLogin(b.code, { id: 6 }, b.number), false, 'a cancelled code is dead');
});

test('the Telegram sign in routes hand out a number and a bound cookie', async () => {
  const bot = await import('../src/telegram/bot.js');
  // The bot is not running in tests, so only the refusal path is reachable here.
  const r = await fetch(base + '/auth/telegram/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, bot.getBotUsername() ? 200 : 503);
  const a = login.newLogin();
  login.completeTelegramLogin(a.code, { id: 9 }, a.number);
  const noCookie = await (await fetch(`${base}/auth/telegram/status?code=${a.code}`)).json();
  assert.equal(noCookie.ok, false, 'a leaked code does not sign in another browser');
  const ok = await fetch(`${base}/auth/telegram/status?code=${a.code}`, { headers: { cookie: `sentinel_tg_bind=${a.bind}` } });
  assert.equal((await ok.json()).ok, true);
});

test('words that merely look like links are not links; real links still are', () => {
  const rules = db.defaultRuleSet();
  rules.suspiciousLinks.enabled = true; rules.suspiciousLinks.strictMode = true;
  for (const t of ['I love Node.js and Next.js', 'great project.Thanks', 'gm.wagmi', 'see README.md and main.py']) {
    assert.equal(checkMessage(t, rules).flagged, false, t);
  }
  for (const t of ['claim at evil-airdrop.xyz/claim now', 'join t.me/scamchat', 'visit bit.ly/abc', 'http://192.168.0.1/login']) {
    assert.equal(checkMessage(t, rules).flagged, true, t);
  }
  assert.deepEqual(findLinks('Node.js is fine, https://example.com/a. ok'), ['https://example.com/a']);
});

test('one harmless link no longer blinds later link checks', () => {
  const rules = db.defaultRuleSet();
  rules.suspiciousLinks.enabled = true; rules.suspiciousLinks.strictMode = false;
  assert.equal(newAccountWithLink('see https://harmless.example/page for details', 1), true);
  assert.equal(newAccountWithLink('see https://harmless.example/page for details', 1), true);
  assert.equal(checkMessage('click here bit.ly/abc', rules).flagged, true);
  assert.equal(checkMessage('lots of words here and then bit.ly/abc', rules).flagged, true);
});

test('the reply policy catches links written without https://', () => {
  const brief = { links: [{ label: 'Docs', url: 'https://docs.example.com/start' }] };
  assert.ok(checkPolicy('Claim at evil-airdrop.xyz/claim now', brief).length > 0);
  assert.ok(checkPolicy('Join discord.gg/abc123', brief).length > 0);
  assert.equal(checkPolicy('Read docs.example.com/start for steps', brief).length, 0);
  assert.equal(checkPolicy('We run on Node.js and the docs are clear.', brief).length, 0);
  assert.equal(checkPolicy('Docs: https://docs.example.com/start.', brief).length, 0);
});

test('a broken feed entity does not throw', () => {
  assert.doesNotThrow(() => decode('bad &#99999999999; and &#x110000; entity'));
  assert.equal(decode('fine &amp; &#65;'), 'fine & A');
});

test('a ban or release that failed is reported as failed and leaves the alert open', async () => {
  await db.addAlert({ platform: 'telegram', guildId: '-100', guildName: 'Mine', channelId: '-100', channelName: 'Mine', userId: '71', username: 'a', text: 'dm me', ruleLabel: 'DM', actionTaken: 'message deleted' });
  const keep = { ban: platforms.telegram.ban, release: platforms.telegram.release };
  try {
    platforms.telegram.ban = async () => false;
    let r = await api('/api/users/telegram/-100/71/action', { method: 'POST', body: { action: 'ban' } });
    assert.equal(r.status, 502);
    platforms.telegram.release = async () => { throw new Error('no rights'); };
    r = await api('/api/users/telegram/-100/71/action', { method: 'POST', body: { action: 'release' } });
    assert.equal(r.status, 502);
    const open = await (await api('/api/alerts?resolved=false')).json();
    assert.ok(open.some(a => a.userId === '71'), 'the alert is still open');
    platforms.telegram.ban = async () => true;
    r = await api('/api/users/telegram/-100/71/action', { method: 'POST', body: { action: 'ban' } });
    assert.equal(r.status, 200);
  } finally { Object.assign(platforms.telegram, keep); }
});

test('dismissing a false positive removes it from the shared network list', async () => {
  await db.addAlert({ platform: 'telegram', guildId: '-100', guildName: 'Mine', channelId: '-100', channelName: 'Mine', userId: '72', username: 'b', text: 'hello.world', ruleLabel: 'Suspicious links', actionTaken: 'message deleted' });
  await db.addNetworkFlag('72', { platform: 'telegram', guildOrChatId: '-100', guildOrChatName: 'Mine', username: 'b', reason: 'Suspicious links' });
  await db.addNetworkFlag('72', { platform: 'telegram', guildOrChatId: '-999', guildOrChatName: 'Other', username: 'b', reason: 'Banned words' });
  const r = await api('/api/users/telegram/-100/72/action', { method: 'POST', body: { action: 'dismiss' } });
  assert.equal(r.status, 200);
  const left = await db.getNetworkHistory('72');
  assert.equal(left.length, 1);
  assert.equal(left[0].guildOrChatId, '-999', 'only this community\'s flag was removed');
});

test('a reply cannot be sent twice, and a bad sources field is not a server error', async () => {
  const d = item('how does staking work?');
  const posted = [];
  const keep = platforms.telegram.reply;
  platforms.telegram.reply = async (...a) => { posted.push(a); return true; };
  try {
    const send = (body) => api(`/api/pulse/discussions/${d.id}/send`, { method: 'POST', body });
    assert.equal((await send({ text: 'Thanks for asking!', approved: true, sources: 'not-an-array' })).status, 200);
    assert.equal((await send({ text: 'Thanks for asking!', approved: true })).status, 409);
    assert.equal(posted.length, 1);
  } finally { platforms.telegram.reply = keep; }
});

test('empty titles, statuses and questions are refused', async () => {
  const c = await (await api('/api/pulse/campaigns', { method: 'POST', body: { title: 'Quiz night' } })).json();
  if (c.id) {
    assert.equal((await api(`/api/pulse/campaigns/${c.id}`, { method: 'PATCH', body: { title: '   ' } })).status, 400);
    assert.equal((await api(`/api/pulse/campaigns/${c.id}`, { method: 'PATCH', body: { status: '' } })).status, 400);
    assert.equal((await api(`/api/pulse/campaigns/${c.id}`, { method: 'PATCH', body: { status: 'paused' } })).status, 200);
  }
});

test('the whole-app switches keep drafts on Manual and reports on download', async () => {
  const M = '/api/pulse/modes/telegram/-100';
  const T = '/api/pulse/technical-push/telegram/-100/settings';
  assert.equal(config.pulseAutoDrafts, true, 'default is unchanged: each community decides');
  assert.equal(config.technicalAutoDelivery, true);
  config.pulseAutoDrafts = false; config.technicalAutoDelivery = false;
  try {
    assert.equal((await api(M, { method: 'POST', body: { modes: { question: 'auto' } } })).status, 403);
    assert.equal((await api(M, { method: 'POST', body: { modes: { question: 'manual' } } })).status, 200);
    assert.equal((await api(T, { method: 'POST', body: { cadence: 'weekly', delivery: 'auto', destinationPlatform: 'telegram', destinationCommunityId: '-100', enabled: true } })).status, 403);
    assert.equal((await api(T, { method: 'POST', body: { cadence: 'weekly', delivery: 'download' } })).status, 200);
    const { runTechnicalSchedules } = await import('../src/pulse/intelligence.js');
    assert.equal(await runTechnicalSchedules(), 0);
  } finally { config.pulseAutoDrafts = true; config.technicalAutoDelivery = true; }
  assert.equal((await api(M, { method: 'POST', body: { modes: { question: 'auto' } } })).status, 200);
});
