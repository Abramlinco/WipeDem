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

  const approved = await api(`/api/pulse/faq-intelligence/${draft.id}`, { method: 'PATCH', body: { status: 'approved' } });
  assert.equal(approved.status, 200);
  assert.equal((await approved.json()).status, 'approved');
  const bank = db.listKnowledge('telegram:-100');
  assert.ok(bank.some(x => x.title.startsWith('FAQs Intelligence:')), 'approved answer should be added to existing knowledge bank');
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
