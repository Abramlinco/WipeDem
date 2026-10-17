import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// Isolated database; tests must never touch a real community or external AI.
process.env.SENTINEL_DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-intelligence-')), 'db.json');
process.env.PORT = '0';
process.env.PULSE_ENABLED = 'false';
process.env.AI_PROVIDER = 'none';

const { createApp } = await import('../src/server.js');
const { setAccessProvider } = await import('../src/access.js');
const db = await import('../src/db.js');
const { loginAs } = await import('../src/auth/sessions.js');

let server, base, cookie;
const api = (p, o = {}) => fetch(base + p, {
  ...o,
  headers: { 'Content-Type': 'application/json', cookie, ...(o.headers || {}) },
  body: o.body === undefined ? undefined : JSON.stringify(o.body)
});

before(async () => {
  const app = await createApp();
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  setAccessProvider(async () => ({ communities: [
    { key: 'telegram:-100', platform: 'telegram', id: '-100', name: 'Mine' }
  ], invites: [] }));
  const fakeRes = { getHeader: () => undefined, setHeader: (k, v) => { cookie = String(v).split(';')[0]; } };
  await loginAs({ session: null }, fakeRes, { telegram: { user: { id: '42', username: 'tester' } } });
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); await db.flushStats(); });

function discussion({ communityId = '-100', text, kind = 'question', topics = ['staking'], idSuffix, staffReply = '' }) {
  const item = {
    platform: 'telegram', communityId, communityName: communityId === '-100' ? 'Mine' : 'Other',
    channelId: communityId, channelName: 'support', userId: idSuffix || 'user-1', username: 'member',
    messageId: `msg-${idSuffix || Math.random().toString(36).slice(2)}`, text, kind, topics,
    score: 5, sentiment: 0, createdAt: new Date().toISOString(), replies: 0, staffReplied: false
  };
  const record = db.addDiscussion(item);
  if (staffReply) {
    record.staffReplied = true;
    record.staffReplies = [{ text: staffReply, at: new Date().toISOString() }];
  }
  return record;
}

test('FAQs Intelligence scans captured questions, preserves evidence, and approval adds reusable knowledge', async () => {
  discussion({ text: 'How long does unstaking take?', idSuffix: 'faq-1', staffReply: 'Unstaking takes about 21 days.' });
  discussion({ text: 'How long does unstaking usually take?', idSuffix: 'faq-2', staffReply: 'The unbonding period is about 21 days.' });

  const scan = await api('/api/pulse/faq-intelligence/telegram/-100/scan', { method: 'POST', body: { days: 30 } });
  assert.equal(scan.status, 200);
  const result = await scan.json();
  assert.ok(result.scanned >= 2, 'should count captured questions');
  assert.ok(result.created >= 1, 'should create a reviewable FAQ draft');
  const draft = result.drafts.find(x => x.communityKey === 'telegram:-100');
  assert.ok(draft, 'draft must belong to the selected community');
  assert.ok(draft.evidence.length >= 1, 'draft should retain original evidence');
  assert.ok(draft.moderatorAnswers.length >= 1, 'draft should retain captured moderator guidance');
  assert.equal(draft.status, 'pending');

  // The pending proposal must not enter the normal reply knowledge retrieval path.
  assert.ok(!db.knowledgeChunks('telegram:-100').some(x => /FAQs Intelligence:/.test(x.title || '')),
    'pending FAQ drafts must not be supplied to normal reply generation');

  const approved = await api(`/api/pulse/faq-intelligence/${draft.id}`, { method: 'PATCH', body: { status: 'approved' } });
  assert.equal(approved.status, 200);
  assert.equal((await approved.json()).status, 'approved');
  const bank = db.listKnowledge('telegram:-100');
  assert.ok(bank.some(x => x.title.startsWith('FAQs Intelligence:')), 'approved answer should be added to existing knowledge bank');
  assert.ok(db.knowledgeChunks('telegram:-100').some(x => /FAQs Intelligence:/.test(x.title || '')),
    'approved FAQ must become available through the official knowledge retrieval path');

  // Verify the real draft API sees the approved answer only after approval.
  const followup = discussion({ text: 'How long does unstaking take?', idSuffix: 'faq-approved-followup' });
  const replyResponse = await api(`/api/pulse/discussions/${followup.id}/draft`, { method: 'POST', body: { fresh: true } });
  assert.equal(replyResponse.status, 200);
  const replyDraft = await replyResponse.json();
  assert.ok(replyDraft.knowledge.some(x => String(x.title || '').startsWith('FAQs Intelligence:')),
    'real draft endpoint should retrieve approved FAQ knowledge');
  assert.match(replyDraft.text, /21 days/i, 'draft should use the approved official answer');
});

test('real draft API retrieves chain-specific official facts rather than applying one duration to every chain', async () => {
  const source = await api('/api/pulse/knowledge/telegram/-100', { method: 'POST', body: {
    type: 'text', title: 'Official Chain Timing Facts',
    text: 'Osmosis migration guide: the official Osmosis migration window lasts 14 days. This duration applies to Osmosis migration only. Cosmos Hub ATOM unstaking FAQ: the ATOM unbonding period is 21 days and this duration applies to Cosmos Hub only.'
  } });
  assert.equal(source.status, 200);

  const osmosis = discussion({ text: 'For Osmosis, how long is the migration window?', idSuffix: 'osmosis-window' });
  const osmosisResponse = await api(`/api/pulse/discussions/${osmosis.id}/draft`, { method: 'POST' });
  assert.equal(osmosisResponse.status, 200);
  const osmosisDraft = await osmosisResponse.json();
  assert.match(osmosisDraft.text, /14 days/i);
  assert.ok(osmosisDraft.knowledge.some(x => /Official Chain Timing Facts/.test(x.title || '')));

  const atom = discussion({ text: 'What is the unstaking period for ATOM on Cosmos Hub?', idSuffix: 'atom-unbonding' });
  const atomResponse = await api(`/api/pulse/discussions/${atom.id}/draft`, { method: 'POST' });
  assert.equal(atomResponse.status, 200);
  const atomDraft = await atomResponse.json();
  assert.match(atomDraft.text, /21 days/i);
  assert.doesNotMatch(atomDraft.text, /14 days/i);
  assert.ok(atomDraft.knowledge.some(x => /Official Chain Timing Facts/.test(x.title || '')));
});

test('FAQs Intelligence and Technical Push do not expose another community data', async () => {
  discussion({ communityId: '-200', text: 'How do I unstake?', idSuffix: 'foreign-faq', staffReply: 'Private moderator answer.' });
  const scan = await api('/api/pulse/faq-intelligence/telegram/-200/scan', { method: 'POST', body: { days: 30 } });
  assert.equal(scan.status, 403);

  const foreignReport = await db.addTechnicalReport({ id: 'foreign-report', communityKey: 'telegram:-200', communityName: 'Other', issueCount: 1, groups: [], sourceLinks: [], content: 'SECRET TECH REPORT', createdAt: new Date().toISOString(), pushedAt: null });
  const listing = await api('/api/pulse/technical-push');
  assert.equal(listing.status, 200);
  const data = await listing.json();
  assert.ok(!data.reports.some(x => x.id === foreignReport.id));
  assert.ok(!JSON.stringify(data).includes('SECRET TECH REPORT'));
});

test('Technical Push groups technical reports, keeps moderator responses, and does not assert root cause', async () => {
  discussion({ text: 'Wallet transaction is stuck pending and fails on bridge.', kind: 'concern', topics: ['wallet'], idSuffix: 'tech-1', staffReply: 'Please share the transaction hash in the support thread.' });
  discussion({ text: 'My wallet transaction failed and is still pending.', kind: 'question', topics: ['wallet'], idSuffix: 'tech-2' });

  const response = await api('/api/pulse/technical-push/telegram/-100/generate', { method: 'POST', body: { days: 7 } });
  assert.equal(response.status, 201);
  const report = await response.json();
  assert.equal(report.communityKey, 'telegram:-100');
  assert.ok(report.issueCount >= 2, 'both technical reports should be counted');
  assert.ok(report.groups.some(g => g.topic === 'wallet' && g.count >= 2), 'similar reports should be grouped by their captured topic');
  assert.ok(report.sourceLinks.length >= 2, 'source evidence should be retained');
  assert.match(report.content, /Root cause is not confirmed|root cause/i, 'report should distinguish symptoms from confirmed cause');
  assert.match(report.content, /transaction hash|Moderator reply/i, 'captured moderator action should be included');
});

test('Technical Push refuses generation for a community the user does not manage', async () => {
  const response = await api('/api/pulse/technical-push/telegram/-200/generate', { method: 'POST', body: { days: 7 } });
  assert.equal(response.status, 403);
});


/* ---------- Gap detection, verification and the watcher ---------- */
const KEY = 'telegram:-100';
const faqRecord = (over) => ({
  id: 'faq-x', communityKey: KEY, communityName: 'Mine', topic: 'fees', question: 'What is the withdrawal fee?', answer: '',
  basis: 'none', gap: true, category: 'question', moderatorAnswers: [], evidence: [{ text: 'What is the withdrawal fee?' }], sources: [],
  occurrenceCount: 2, status: 'pending', fingerprint: `fp-${over.id}`, verificationNote: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...over
});
const patchFaq = (id, body) => api(`/api/pulse/faq-intelligence/${id}`, { method: 'PATCH', body });
const scanNow = async () => (await api('/api/pulse/faq-intelligence/telegram/-100/scan', { method: 'POST', body: { days: 30 } })).json();

test('FAQs Intelligence only drafts what the facts do not already cover', async () => {
  const add = await api('/api/pulse/knowledge/telegram/-100', { method: 'POST', body: { type: 'text', title: 'Refund policy', text: 'Refunds take about 5 business days to process after the request is approved.' } });
  assert.equal(add.status, 200);
  discussion({ text: 'How long do refunds take to process?', idSuffix: 'cov-1', staffReply: 'Refunds take 5 business days.' });
  discussion({ text: 'How long do refunds take?', idSuffix: 'cov-2' });
  discussion({ text: 'How do I connect my ledger wallet to the app?', idSuffix: 'gap-1', topics: ['wallet'], staffReply: 'Open Settings, choose Ledger and follow the prompts.' });
  discussion({ text: 'How can I connect a ledger wallet?', idSuffix: 'gap-2', topics: ['wallet'] });

  const scan = await scanNow();
  assert.ok(scan.covered >= 1, 'the refund question is already in the facts');
  const mine = scan.drafts.filter(x => x.communityKey === KEY);
  assert.ok(!mine.some(x => /refund/i.test(x.question)), 'no FAQ is drafted for something the facts already answer');
  const gap = mine.find(x => /ledger/i.test(x.question));
  assert.ok(gap, 'a question the facts do not cover becomes a draft');
  assert.equal(gap.gap, true);
  assert.equal(gap.basis, 'moderator');
  assert.match(gap.answer, /Ledger/, 'the answer is the moderator reply from the chat, not a guess');
  assert.equal((await scanNow()).created, 0, 'the same question is never raised twice');
});

test('an FAQ answer with a figure nobody gave needs a person to confirm it, and approval can be taken back', async () => {
  await db.addFaqDraft(faqRecord({ id: 'faq-fig', answer: 'The withdrawal fee is 12 percent.', basis: 'moderator', moderatorAnswers: ['Withdrawal fees are low.'] }));
  const first = await patchFaq('faq-fig', { status: 'approved' });
  assert.equal(first.status, 409);
  assert.deepEqual((await first.json()).unverified, ['12']);
  assert.equal(db.listFaqDrafts(new Set([KEY])).find(x => x.id === 'faq-fig').status, 'pending', 'a refused approval changes nothing');
  assert.ok(!db.knowledgeChunks(KEY).some(x => /withdrawal fee/i.test(x.title || '')));

  assert.equal((await patchFaq('faq-fig', { status: 'approved', confirmed: true })).status, 200);
  assert.ok(db.knowledgeChunks(KEY).some(x => x.title === 'FAQs Intelligence: What is the withdrawal fee?'));

  assert.equal((await patchFaq('faq-fig', { status: 'dismissed' })).status, 200);
  assert.ok(!db.knowledgeChunks(KEY).some(x => /withdrawal fee/i.test(x.title || '')), 'a dismissed FAQ can never be drafted from');
});

test('an FAQ without a real answer cannot be approved until the manager writes one', async () => {
  await db.addFaqDraft(faqRecord({ id: 'faq-empty', question: 'Where do I find the pricing page?', fingerprint: 'fp-empty' }));
  assert.equal((await patchFaq('faq-empty', { status: 'approved' })).status, 400);
  assert.ok(!db.knowledgeChunks(KEY).some(x => /pricing page/i.test(x.title || '')));
  const ok = await patchFaq('faq-empty', { status: 'approved', answer: 'The pricing page is linked from the menu of the official website.' });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).basis, 'manager');
  assert.ok(db.knowledgeChunks(KEY).some(x => /pricing page/i.test(x.title || '')));
});

test('editing an approved FAQ re-indexes it, and a dismissed FAQ is not raised again by the next scan', async () => {
  const edited = await patchFaq('faq-empty', { answer: 'The pricing page is linked from the footer of the official website.' });
  assert.equal(edited.status, 200);
  const chunks = db.knowledgeChunks(KEY).filter(x => /pricing page/i.test(x.title || ''));
  assert.equal(chunks.length, 1, 'one copy only');
  assert.match(chunks[0].text, /footer/);

  const gap = (await scanNow()).drafts.find(x => /ledger/i.test(x.question));
  assert.equal((await patchFaq(gap.id, { status: 'dismissed' })).status, 200);
  discussion({ text: 'How can I connect my ledger wallet to the app?', idSuffix: 'gap-3', topics: ['wallet'] });
  const again = await scanNow();
  assert.ok(!again.drafts.some(x => /ledger/i.test(x.question) && x.status === 'pending'), 'dismissed stays dismissed');
});

test('the count on the menu is the number of drafts waiting', async () => {
  await db.addFaqDraft(faqRecord({ id: 'faq-count', question: 'Is there a mobile app?', fingerprint: 'fp-count' }));
  const summary = await (await api('/api/pulse/faq-intelligence/summary')).json();
  const waiting = db.listFaqDrafts(new Set([KEY])).filter(x => x.status === 'pending').length;
  assert.equal(summary.pending, waiting);
  assert.equal(summary.byCommunity[KEY], waiting);
});

test('a draft made before the facts changed is rebuilt instead of shown', async () => {
  const q = discussion({ text: 'What do gold tier members get?', idSuffix: 'stale-1' });
  const first = await (await api(`/api/pulse/discussions/${q.id}/draft`, { method: 'POST', body: {} })).json();
  assert.ok(!first.knowledge.some(k => k.title === 'Gold tier perks'));
  await new Promise(r => setTimeout(r, 10));
  const add = await api('/api/pulse/knowledge/telegram/-100', { method: 'POST', body: { type: 'text', title: 'Gold tier perks', text: 'Gold tier members get priority support through the premium help desk channel.' } });
  assert.equal(add.status, 200);
  const second = await (await api(`/api/pulse/discussions/${q.id}/draft`, { method: 'POST', body: {} })).json();
  assert.ok(second.knowledge.some(k => k.title === 'Gold tier perks'), 'the cached draft was not served after the facts changed');
});

test('automatic Technical Push delivery only goes where the manager can post, and runs on its cadence', async () => {
  const settings = (body) => api('/api/pulse/technical-push/telegram/-100/settings', { method: 'POST', body });
  const foreign = await settings({ cadence: 'daily', delivery: 'auto', destinationPlatform: 'telegram', destinationCommunityId: '-200', enabled: true });
  assert.equal(foreign.status, 403, 'a destination the person does not manage is refused');

  const { platforms } = await import('../src/platform.js');
  const intel = await import('../src/pulse/intelligence.js');
  const posted = [];
  platforms.telegram.post = async (...args) => { posted.push(args); return true; };
  assert.equal((await settings({ cadence: 'daily', delivery: 'auto', destinationPlatform: 'telegram', destinationCommunityId: '-100', enabled: true })).status, 200);

  assert.equal(await intel.runTechnicalSchedules(), 1);
  assert.equal(posted.length, 1);
  assert.equal(posted[0][0], '-100');
  assert.match(posted[0][2], /TECHNICAL COMMUNITY REPORT|Root cause/i);
  assert.ok(db.listTechnicalReports(new Set([KEY])).some(r => r.pushedAt), 'the report is marked as sent');
  assert.equal(await intel.runTechnicalSchedules(), 0, 'not due again until the cadence has passed');
});

test('the drafter knows what problems the community has already reported', async () => {
  const q = discussion({ text: 'My wallet will not connect to the app, any idea?', topics: ['wallet'], idSuffix: 'ctx-1' });
  const draft = await (await api(`/api/pulse/discussions/${q.id}/draft`, { method: 'POST', body: { fresh: true } })).json();
  assert.ok(draft.relatedIssues.some(i => i.topic === 'wallet' && i.count >= 2), 'earlier wallet reports are surfaced to the manager');
  assert.ok(['knowledge', 'brief', 'none'].includes(draft.basis));
});

test('one scan covers every community the manager runs, and the list holds all of them', async () => {
  discussion({ text: 'Why does the claim page keep timing out for me?', idSuffix: 'all-1', kind: 'concern', topics: ['wallet'] });
  discussion({ text: 'Why does the claim page keep timing out?', idSuffix: 'all-2', kind: 'concern', topics: ['wallet'] });
  const res = await api('/api/pulse/faq-intelligence/scan', { method: 'POST', body: { days: 30 } });
  assert.equal(res.status, 200);
  const r = await res.json();
  assert.ok(r.communities >= 1);
  assert.ok(['scanned', 'created', 'covered', 'refreshed'].every(k => typeof r[k] === 'number'));
  assert.ok(Array.isArray(r.drafts) && r.drafts.every(x => x.communityKey && x.communityName !== undefined), 'every draft says which community it came from');
  const listed = await (await api('/api/pulse/faq-intelligence')).json();
  assert.equal(listed.filter(x => x.status === 'pending').length, (await (await api('/api/pulse/faq-intelligence/summary')).json()).pending, 'the menu number is the number waiting in the list');
});

test('Technical Push reports things that broke, counts different members, and ignores how-to questions', async () => {
  discussion({ text: 'How do I stake my tokens on the app?', kind: 'question', topics: ['staking'], idSuffix: 'tp-howto' });
  discussion({ text: 'The app keeps crashing whenever I open the staking page', kind: 'concern', topics: ['app'], idSuffix: 'tp-a' });
  discussion({ text: 'Staking page crashes for me too on android', kind: 'concern', topics: ['app'], idSuffix: 'tp-b' });
  const res = await api('/api/pulse/technical-push/telegram/-100/generate', { method: 'POST', body: { days: 7 } });
  assert.equal(res.status, 201);
  const report = await res.json();
  assert.ok(!report.content.includes('How do I stake my tokens'), 'a how-to question is not an issue report');
  assert.ok(report.content.includes('keeps crashing'));
  const app = report.groups.find(g => g.topic === 'app');
  assert.ok(app.count >= 2 && app.reporters >= 2, 'two different members hit the same problem');
  assert.ok(report.reporterCount >= 2);
  assert.match(report.content, /from \d+ members?/);
  assert.match(report.content, /\[Telegram/, 'each report says which chat it came from');
});

test('a long technical report is delivered in numbered messages that each fit, not cut off', async () => {
  const { platforms } = await import('../src/platform.js');
  const posted = [];
  platforms.telegram.post = async (...a) => { posted.push(a[2]); return true; };
  for (let i = 0; i < 14; i++) discussion({ text: `Wallet transaction failed on the bridge, attempt ${i}. ${'detail '.repeat(60)}`, kind: 'concern', topics: ['wallet'], idSuffix: `long-${i}` });
  assert.equal((await api('/api/pulse/technical-push/telegram/-100/settings', { method: 'POST', body: { cadence: 'weekly', delivery: 'download', destinationPlatform: 'telegram', destinationCommunityId: '-100', enabled: false } })).status, 200);
  const report = await (await api('/api/pulse/technical-push/telegram/-100/generate', { method: 'POST', body: { days: 7 } })).json();
  assert.ok(report.content.length > 3900, 'the report is longer than one Telegram message');
  const pushed = await api(`/api/pulse/technical-push/${report.id}/push`, { method: 'POST', body: {} });
  assert.equal(pushed.status, 200);
  assert.ok(posted.length >= 2 && posted.every(p => p.length <= 3900), 'every part fits a message');
  assert.match(posted[0], /^\(1\//);
  assert.ok(db.listTechnicalReports(new Set([KEY])).find(r => r.id === report.id).pushedAt);
});

test('a scheduled report that fails to deliver is retried later instead of being lost or remade', async () => {
  const { platforms } = await import('../src/platform.js');
  const intel = await import('../src/pulse/intelligence.js');
  await db.saveTechnicalSettings(KEY, { cadence: 'daily', delivery: 'auto', enabled: true, destinationPlatform: 'telegram', destinationCommunityId: '-100', destinationChannelId: '', lastAutoAt: '', autoPendingReportId: '' });
  let up = false;
  const posted = [];
  platforms.telegram.post = async (...a) => { if (up) posted.push(a[2]); return up; };
  assert.equal(await intel.runTechnicalSchedules(), 0, 'delivery failed');
  const after = db.getTechnicalSettings(KEY);
  assert.ok(after.autoPendingReportId, 'the report is remembered for a retry');
  const count = db.listTechnicalReports(new Set([KEY])).length;
  up = true;
  assert.equal(await intel.runTechnicalSchedules(Date.now() + 4 * 3600000), 1, 'retried a few hours later');
  assert.equal(db.listTechnicalReports(new Set([KEY])).length, count, 'the same report was sent, not a new one');
  assert.ok(posted.length >= 1);
  assert.equal(db.getTechnicalSettings(KEY).autoPendingReportId, '');
});
