import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.SENTINEL_DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-pulse-')), 'db.json');
process.env.PORT = '0';
process.env.PULSE_ENABLED = 'false'; // tests never touch the real internet
process.env.AI_PROVIDER = 'none'; // tests use the built-in drafter, never a real AI

const { createApp } = await import('../src/server.js');
const { config } = await import('../src/config.js');
const { setAccessProvider } = await import('../src/access.js');
const db = await import('../src/db.js');
const { loginAs } = await import('../src/auth/sessions.js');
const { captureMessage, noteReply } = await import('../src/pulse/capture.js');

let server, base, cookie, mineId, foreignId;
const item = (communityId, text, extra = {}) => db.addDiscussion({
  platform: 'telegram', communityId, communityName: communityId === '-100' ? 'Mine' : 'Someone Elses', channelId: communityId,
  userId: '1', username: 'ann', messageId: String(Math.floor(Math.random() * 1e6)), text, kind: 'idea', score: 5, topics: ['airdrop'], sentiment: 0, ...extra
});

before(async () => {
  const app = await createApp();
  await new Promise(r => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  // This admin manages group -100 only. Group -200 belongs to someone else.
  setAccessProvider(async () => ({ communities: [{ key: 'telegram:-100', platform: 'telegram', id: '-100', name: 'Mine' }], invites: [] }));
  const fakeRes = { getHeader: () => undefined, setHeader: (k, v) => { cookie = String(v).split(';')[0]; } };
  await loginAs({ session: null }, fakeRes, { telegram: { user: { id: '42', username: 'abraham' } } });

  mineId = item('-100', 'We should add a staking dashboard').id;
  foreignId = item('-200', 'secret idea from another community').id;
  await db.upsertTrends([
    { id: 'g1', ownerKey: null, source: 'Decrypt', space: 'web3', weight: 1, title: 'Global story', url: 'https://a.example/1', topics: ['airdrop'], fetchedAt: new Date().toISOString(), publishedAt: new Date().toISOString() },
    { id: 'f1', ownerKey: 'telegram:-200', source: 'Their feed', space: 'web3', weight: 1, title: 'Private to the other community', url: 'https://b.example/1', topics: [], fetchedAt: new Date().toISOString(), publishedAt: new Date().toISOString() },
    { id: 'x1', ownerKey: null, source: 'Bad', space: 'web3', weight: 1, title: 'Evil link', url: 'javascript:alert(1)', topics: [], fetchedAt: new Date().toISOString(), publishedAt: new Date().toISOString() }
  ]);
});
after(async () => { server.close(); await db.flushStats(); });

const api = (p, o = {}) => fetch(base + p, {
  ...o, headers: { 'Content-Type': 'application/json', cookie, ...(o.headers || {}) }, body: o.body ? JSON.stringify(o.body) : undefined
});

test('Pulse needs a sign in', async () => {
  assert.equal((await fetch(base + '/api/pulse/overview')).status, 401);
});

test('discussions from other communities never appear', async () => {
  const list = await (await api('/api/pulse/discussions')).json();
  assert.ok(list.some(d => d.id === mineId));
  assert.ok(!list.some(d => d.id === foreignId));
  assert.ok(!JSON.stringify(await (await api('/api/pulse/overview')).json()).includes('secret'));
  assert.ok(!JSON.stringify(await (await api('/api/pulse/playbook')).json()).includes('secret'));
});

test('a person cannot change another community\'s discussion', async () => {
  assert.equal((await api(`/api/pulse/discussions/${foreignId}/status`, { method: 'POST', body: { status: 'done' } })).status, 404);
  assert.equal((await api(`/api/pulse/discussions/${mineId}/status`, { method: 'POST', body: { status: 'starred' } })).status, 200);
  assert.equal((await api(`/api/pulse/discussions/${mineId}/status`, { method: 'POST', body: { status: 'bogus' } })).status, 400);
  const mine = (await (await api('/api/pulse/discussions')).json()).find(d => d.id === mineId);
  assert.equal(mine.status, 'starred');
});

test('changes must be JSON, so another website cannot forge them', async () => {
  const r = await fetch(base + `/api/pulse/discussions/${mineId}/status`, { method: 'POST', headers: { 'Content-Type': 'text/plain', cookie }, body: '{"status":"done"}' });
  assert.equal(r.status, 415);
});

test('trends: another community\'s own feed stays private, and unsafe links are removed', async () => {
  const trends = await (await api('/api/pulse/trends')).json();
  assert.ok(trends.some(t => t.title === 'Global story'));
  assert.ok(!trends.some(t => t.title.includes('Private to the other')));
  assert.equal(trends.find(t => t.title === 'Evil link').url, '');
});

test('feeds that point at private addresses are refused', async () => {
  for (const value of ['https://127.0.0.1/feed', 'http://example.com/feed', 'https://169.254.169.254/latest/meta-data', 'https://localhost/x']) {
    const r = await api('/api/pulse/sources/telegram/-100', { method: 'POST', body: { type: 'rss', value } });
    assert.equal(r.status, 400, value);
  }
  assert.equal((await api('/api/pulse/sources/telegram/-100', { method: 'POST', body: { type: 'reddit', value: '../etc' } })).status, 400);
});

test('feeds can only be added to a community you manage', async () => {
  assert.equal((await api('/api/pulse/sources/telegram/-200', { method: 'POST', body: { type: 'reddit', value: 'solana' } })).status, 403);
  assert.equal((await api('/api/pulse/sources/telegram/-100', { method: 'POST', body: { type: 'reddit', value: 'solana' } })).status, 200);
  const { sources } = await (await api('/api/pulse/sources')).json();
  assert.ok(sources.some(s => s.custom && s.label === 'r/solana'));
  assert.equal((await api('/api/pulse/sources/telegram/-100', { method: 'DELETE', body: { type: 'reddit', value: 'solana' } })).status, 200);
  assert.ok(!(await (await api('/api/pulse/sources')).json()).sources.some(s => s.custom));
});

test('switching reading off stops messages being kept', async () => {
  const settings = await db.getSettings('telegram', '-100');
  const send = () => captureMessage({ settings: { ...settings }, platform: 'telegram', communityId: '-100', communityName: 'Mine', userId: '5', username: 'zed', text: 'Can we please add a mobile app for staking?', messageId: '999' });
  assert.ok(send());
  assert.equal((await api('/api/pulse/enabled/telegram/-100', { method: 'POST', body: { enabled: false } })).status, 200);
  const off = await db.getSettings('telegram', '-100');
  assert.equal(captureMessage({ settings: off, platform: 'telegram', communityId: '-100', userId: '5', username: 'zed', text: 'Can we please add a mobile app for staking?', messageId: '1000' }), null);
  assert.equal((await api('/api/pulse/enabled/telegram/-200', { method: 'POST', body: { enabled: true } })).status, 403);
  await api('/api/pulse/enabled/telegram/-100', { method: 'POST', body: { enabled: true } });
});

test('replies are counted, and a staff reply marks a question as answered', async () => {
  const q = captureMessage({ settings: await db.getSettings('telegram', '-100'), platform: 'telegram', communityId: '-100', communityName: 'Mine', userId: '6', username: 'q', text: 'How do I claim my airdrop on the mobile app?', messageId: '5001' });
  assert.equal(q.kind, 'question');
  noteReply('telegram', '-100', '5001', false);
  noteReply('telegram', '-100', '5001', true);
  assert.equal(q.replies, 1);
  assert.equal(q.staffReplied, true);
});

/* ---------- Phase 1: project brief, drafting, approved sending ---------- */
const { platforms } = await import('../src/platform.js');

test('the brief is private to communities you manage, and links must be https', async () => {
  assert.equal((await api('/api/pulse/brief/telegram/-200')).status, 403);
  assert.equal((await api('/api/pulse/brief/telegram/-200', { method: 'POST', body: { projectName: 'x' } })).status, 403);
  assert.equal((await api('/api/pulse/brief/telegram/-100', { method: 'POST', body: { links: [{ label: 'x', url: 'http://plain.example' }] } })).status, 400);
  assert.equal((await api('/api/pulse/brief/telegram/-100', { method: 'POST', body: { links: [{ label: 'x', url: 'javascript:alert(1)' }] } })).status, 400);
  const saved = await (await api('/api/pulse/brief/telegram/-100', { method: 'POST', body: {
    projectName: 'Quicksilver', ticker: 'QCK', facts: ['QCK is the governance token.'], links: [{ label: 'Site', url: 'https://q.example' }] } })).json();
  assert.equal(saved.projectName, 'Quicksilver');
  assert.equal((await (await api('/api/pulse/brief/telegram/-100')).json()).links[0].url, 'https://q.example/');
});

test('drafting works for your community and is refused for another', async () => {
  const mine = item('-100', 'what is the QCK token used for? is it governance?', { kind: 'question' });
  const foreign = item('-200', 'a question in another community', { kind: 'question' });
  assert.equal((await api(`/api/pulse/discussions/${foreign.id}/draft`, { method: 'POST' })).status, 404);
  const r = await api(`/api/pulse/discussions/${mine.id}/draft`, { method: 'POST' });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.match(d.text, /governance token/);
  assert.deepEqual(d.flags, []);
});

test('sending needs approval, passes the policy check on the server, and only works on your own community', async () => {
  const mine = item('-100', 'what is the QCK token used for? is it governance?', { kind: 'question' });
  const foreign = item('-200', 'a question in another community', { kind: 'question' });
  const posted = [];
  platforms.telegram.reply = async (...args) => { posted.push(args); return true; };
  const send = (id, body) => api(`/api/pulse/discussions/${id}/send`, { method: 'POST', body });

  assert.equal((await send(foreign.id, { text: 'hi', approved: true })).status, 404);
  assert.equal((await send(mine.id, { text: 'Thanks for asking!' })).status, 400, 'no approval flag');
  const bad = await send(mine.id, { text: 'It is guaranteed to 10x, DM me', approved: true });
  assert.equal(bad.status, 422);
  assert.ok((await bad.json()).flags.length >= 2);
  assert.equal((await send(mine.id, { text: 'Visit https://evil.example/claim', approved: true })).status, 422);
  assert.equal(posted.length, 0, 'nothing was posted by any of the refused attempts');

  assert.equal((await send(mine.id, { text: 'QCK is the governance token. More at https://q.example.', approved: true })).status, 200);
  assert.equal(posted.length, 1);
  assert.equal(posted[0][3], 'QCK is the governance token. More at https://q.example.');
  const after = (await (await api('/api/pulse/discussions?status=done')).json()).find((x) => x.id === mine.id);
  assert.equal(after.replied, true);
});

test('a failed post is reported, not hidden', async () => {
  const mine = item('-100', 'another question about staking rewards?', { kind: 'question' });
  platforms.telegram.reply = async () => { throw new Error('chat not found'); };
  const r = await api(`/api/pulse/discussions/${mine.id}/send`, { method: 'POST', body: { text: 'Thanks!', approved: true } });
  assert.equal(r.status, 502);
});

/* ---------- Phase 3: knowledge bank ---------- */
const K = '/api/pulse/knowledge/telegram/-100';
const post = (p, body) => api(p, { method: 'POST', body });

test('the knowledge bank is private to communities you manage', async () => {
  assert.equal((await api('/api/pulse/knowledge/telegram/-200')).status, 403);
  assert.equal((await post('/api/pulse/knowledge/telegram/-200', { type: 'text', text: 'x'.repeat(80) })).status, 403);
  assert.equal((await post('/api/pulse/knowledge/telegram/-200/ask', { question: 'anything here' })).status, 403);
});

test('pasted text is stored, searchable, and never sent back in the list', async () => {
  assert.equal((await post(K, { type: 'text', text: 'too short' })).status, 400);
  const add = await post(K, { type: 'text', title: 'Unstaking FAQ', text: 'Unstaking takes about 21 days because of the Cosmos Hub unbonding period. You can also swap stATOM on a DEX to exit sooner.' });
  assert.equal(add.status, 200);
  const { source } = await add.json();
  assert.equal(source.status, 'ok');
  const hits = await (await post(`${K}/ask`, { question: 'how long does unstaking take?' })).json();
  assert.match(hits[0].excerpt, /21 days/);
  assert.deepEqual(await (await post(`${K}/ask`, { question: 'when is the airdrop snapshot' })).json(), []);
  const list = await (await api(K)).json();
  assert.ok(list.sources.some((x) => x.id === source.id));
  assert.ok(!JSON.stringify(list).includes('unbonding period'));
});

test('web page addresses that point at private places are refused', async () => {
  for (const url of ['http://example.com/docs', 'https://localhost/x', 'https://127.0.0.1/x', 'https://169.254.169.254/latest/meta-data']) {
    assert.equal((await post(K, { type: 'url', url })).status, 400, url);
  }
});

test('DefiLlama names are checked before anything is fetched', async () => {
  assert.equal((await post(K, { type: 'defillama', tvlSlug: '../../etc' })).status, 400);
  assert.equal((await post(K, { type: 'defillama' })).status, 400);
});

test('the Draft button answers from the knowledge bank', async () => {
  const q = item('-100', 'how long does unstaking take?', { kind: 'question' });
  const d = await (await api(`/api/pulse/discussions/${q.id}/draft`, { method: 'POST', body: { fresh: true } })).json();
  assert.match(d.text, /21 days/);
  assert.equal(d.knowledge[0].title, 'Unstaking FAQ');
  assert.deepEqual(d.flags, []);
});

test('a source can only be removed from its own community', async () => {
  const list = await (await api(K)).json();
  const id = list.sources[0].id;
  assert.equal((await api(`/api/pulse/knowledge/telegram/-200/${id}`, { method: 'DELETE' })).status, 403);
  assert.equal((await api(`${K}/${id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await api(`${K}/${id}`, { method: 'DELETE' })).status, 404);
});

/* ---------- Pools, X and posting (checks that need no network) ---------- */
const POST = (body) => post('/api/pulse/post', { text: 'We are live. Official links are pinned.', approved: true, ...body });

test('pool watching is private to your communities and refuses what it cannot read, before any network call', async () => {
  assert.equal((await post('/api/pulse/pools/telegram/-200', { mode: 'pool', input: 'https://app.osmosis.zone/pool/3505' })).status, 403);
  const bad = await post('/api/pulse/pools/telegram/-100', { mode: 'pool', input: 'https://example.com/nothing' });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /could not tell/);
  assert.equal((await post('/api/pulse/pools/telegram/-100', { mode: 'pool', input: '0x123', chain: 'bsc' })).status, 400);
  assert.equal((await post('/api/pulse/pools/telegram/-100', { mode: 'token', input: 'https://dexscreener.com/bsc/0x172fcd41e0913e95784454622d1c3724f546f849' })).status, 400);
  const list = await (await api('/api/pulse/pools')).json();
  assert.ok(Array.isArray(list.items) && Array.isArray(list.events) && list.chains.osmosis === 'Osmosis');
});

test('X account keys can only be saved with an encryption secret, all four keys, and for your own community', async () => {
  const st = await (await api('/api/pulse/x/telegram/-100')).json();
  assert.equal(st.account.connected, false);
  assert.equal(typeof st.limitUsd, 'number');
  assert.equal(st.costs.postWithLink, 0.2);
  assert.equal((await api('/api/pulse/x/telegram/-200')).status, 403);
  assert.equal((await post('/api/pulse/x/telegram/-200/connect', { apiKey: 'a', apiSecret: 'b', accessToken: 'c', accessSecret: 'd' })).status, 403);
  // The developer's local .env may contain SENTINEL_SECRET. Explicitly simulate
  // the missing-secret condition this assertion is intended to cover.
  const originalSecretKey = config.secretKey;
  let noSecret;
  try {
    config.secretKey = '';
    noSecret = await post('/api/pulse/x/telegram/-100/connect', { apiKey: 'a', apiSecret: 'b', accessToken: 'c', accessSecret: 'd' });
  } finally {
    config.secretKey = originalSecretKey;
  }
  assert.equal(noSecret.status, 400);
  assert.match((await noSecret.json()).error, /SENTINEL_SECRET/);
  assert.equal((await post('/api/pulse/x/refresh', {})).status, 400, 'reading X is off without a key');
});

test('posting needs approval and a destination, and only works on your own communities', async () => {
  assert.equal((await POST({ targets: [{ platform: 'telegram', communityId: '-100' }], approved: false })).status, 400);
  assert.equal((await POST({ targets: [] })).status, 400);
  assert.equal((await POST({ targets: [{ platform: 'telegram', communityId: '-200' }] })).status, 403);
  assert.equal((await POST({ targets: [{ platform: 'discord', communityId: '5', channelId: '123456' }] })).status, 403, 'not your Discord server');
  assert.equal((await POST({ text: '', targets: [{ platform: 'telegram', communityId: '-100' }] })).status, 400);
});

test('hype, unknown links and unfilled placeholders block a post, with reasons, and nothing is sent', async () => {
  const hype = await POST({ text: 'This is guaranteed to 10x. Join https://evil.example/x', targets: [{ platform: 'telegram', communityId: '-100' }] });
  assert.equal(hype.status, 422);
  const flags = (await hype.json()).flags;
  assert.ok(flags.length >= 2);
  const ph = await POST({ text: 'Next update on [date] from the team', targets: [{ platform: 'telegram', communityId: '-100' }] });
  assert.equal(ph.status, 422);
  assert.ok((await ph.json()).flags.some((f) => f.phrase === '[date]'));
  const long = await POST({ text: 'x'.repeat(300), targets: [], x: { mode: 'api', platform: 'telegram', communityId: '-100' } });
  assert.equal(long.status, 400, 'no X account is connected');
});

test('"Open in X" needs no account and gives a ready link', async () => {
  const r = await POST({ targets: [], x: { mode: 'intent', platform: 'telegram', communityId: '-100' } });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.results.length, 0);
  assert.match(j.xIntentUrl, /^https:\/\/x\.com\/intent\/post\?text=We%20are%20live/);
  assert.equal((await POST({ targets: [], x: { mode: 'intent', platform: 'telegram', communityId: '-200' } })).status, 403);
});

test('the Discord channel picker answers even when the bot is not running', async () => {
  assert.deepEqual(await (await api('/api/pulse/channels/telegram/-100')).json(), []);
  assert.equal((await api('/api/pulse/channels/discord/5')).status, 403);
});
