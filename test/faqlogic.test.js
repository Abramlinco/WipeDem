import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSource } from '../src/pulse/knowledge.js';
import { analyze } from '../src/pulse/analyze.js';
import {
  isCandidate, categorize, clusterQuestions, similarity, findSimilarDraft, coverage, answersFor,
  figuresIn, unsupportedFigures, communityContext, isTechnicalIssue, groupIssues, splitMessage
} from '../src/pulse/faqlogic.js';

const row = (text, extra = {}) => ({ text, kind: 'question', topics: ['staking'], createdAt: new Date().toISOString(), ...extra });

test('an approved FAQ is found by its question while the approved answer stays the text', async () => {
  const q = 'How long does unstaking take?';
  const src = await readSource({ type: 'text', title: 'FAQs Intelligence: How long does unstaking usually take?', text: 'The unbonding period is about 21 days.', search: 'How long does unstaking usually take?' });
  assert.equal(src.chunks[0].text, 'The unbonding period is about 21 days.');
  assert.ok(coverage(q, { knowledge: src.chunks.map((c) => ({ ...c, title: 'FAQ' })) }).covered, 'found by the question words');
  assert.ok(!/unstak/i.test(src.chunks[0].text), 'the question is not part of the quotable text');
});

test('a very short approved answer still gets its own chunk', async () => {
  const src = await readSource({ type: 'text', title: 'FAQ', text: 'About 21 days.', search: 'How long does unstaking take?' });
  assert.equal(src.chunks.length, 1);
});

test('the same question in different words is one FAQ, different questions stay apart', () => {
  const clusters = clusterQuestions([
    row('How long does unstaking usually take?'), row('How long does unstaking take?'), row('How do I unstake?'),
    row('Why is my bridge transfer stuck?', { topics: ['bridge'], kind: 'concern' })
  ]);
  assert.equal(clusters.length, 3);
  assert.equal(clusters[0].items.length, 2);
  assert.equal(clusters.find((c) => c.topic === 'bridge').category, 'technical');
  assert.ok(similarity('How long does unstaking take?', 'How do I unstake?') < 0.5);
});

test('only questions, concerns and error reports are looked at', () => {
  assert.equal(isCandidate({ kind: 'idea', text: 'add a dashboard' }), false);
  assert.equal(isCandidate({ kind: 'praise', text: 'love it' }), false);
  assert.equal(isCandidate({ kind: 'discussion', text: 'my wallet is broken since the update' }), true);
  assert.equal(isCandidate({ kind: 'discussion', text: 'a long general chat about the weekend and the team meetup' }), false);
  assert.equal(categorize({ kind: 'concern', text: 'I am unhappy with the wait' }), 'complaint');
  assert.equal(categorize({ kind: 'question', text: 'How do I stake?' }), 'question');
});

test('a topic the facts cover is not drafted again, and a gap is', () => {
  const knowledge = [{ text: 'The unbonding period is about 21 days.', search: 'How long does unstaking take?', title: 'Docs' }];
  assert.equal(coverage('How long does unstaking take?', { knowledge }).covered, true);
  assert.equal(coverage('How do I connect my ledger wallet?', { knowledge }).covered, false);
  assert.equal(coverage('What are the withdrawal fees?', { knowledge: [], brief: { facts: ['Withdrawal fees are 0.1 percent.'] } }).via, 'brief');
  assert.equal(coverage('one', { knowledge }).covered, false, 'one stray word is not coverage');
});

test('answers come only from what a person already said, the cluster question first', () => {
  const [c] = clusterQuestions([
    row('How long does unstaking take?', { staffReplies: [{ text: 'Unstaking takes about 21 days.' }] }),
    row('How long does unstaking usually take?', { staffReplies: [{ text: 'The unbonding period is about 21 days.' }] })
  ]);
  assert.deepEqual(answersFor(c), ['Unstaking takes about 21 days.', 'The unbonding period is about 21 days.']);
  assert.deepEqual(answersFor({ rep: row('x'), items: [row('x')] }), [], 'no reply means no answer is invented');
});

test('figures must be found in the evidence', () => {
  assert.deepEqual(figuresIn('Takes 21 days. Fee is $5 and APY 12.5%. Step 2) done. See https://x.io/a/12345'), ['21', '5', '12.5']);
  assert.deepEqual(unsupportedFigures('It takes 14 days, not 21 days', ['unbonding is about 21 days']), ['14']);
  assert.deepEqual(unsupportedFigures('It takes 21 days', ['unbonding is about 21 days']), []);
  assert.deepEqual(unsupportedFigures('Around 1,000 tokens', ['you receive 1000 tokens']), [], 'commas do not matter');
});

test('community context is built only from recorded things', () => {
  const ctx = communityContext({
    brief: { projectName: 'Quicksilver', ticker: 'QCK', about: 'Liquid staking.' },
    discussions: [row('a?'), row('b?'), row('c?', { topics: ['bridge'] })],
    faqDrafts: [{ status: 'pending', gap: true }, { status: 'approved' }],
    reports: [{ createdAt: new Date().toISOString(), groups: [{ topic: 'bridge', count: 4 }] }]
  });
  assert.match(ctx.text, /Quicksilver \(QCK\) - Liquid staking/);
  assert.match(ctx.text, /staking \(2\), bridge \(1\)/);
  assert.deepEqual(ctx.knownIssues, [{ topic: 'bridge', count: 4 }]);
  assert.equal(ctx.openGaps, 1);
  assert.equal(communityContext().text, '', 'nothing recorded, nothing said');
});

test('an existing draft is found whatever its status', () => {
  const drafts = [{ communityKey: 'telegram:-100', question: 'How long does unstaking take?', status: 'dismissed' }];
  assert.ok(findSimilarDraft(drafts, 'telegram:-100', 'How long does unstaking usually take?'));
  assert.equal(findSimilarDraft(drafts, 'telegram:-200', 'How long does unstaking take?'), undefined);
});

test('a technical issue is something that broke, not a how-to question or a general worry', () => {
  const issue = (text, topics = []) => isTechnicalIssue({ kind: 'concern', text, topics });
  for (const t of ['My transaction fails every time I try to stake', 'The app keeps crashing on android', 'Wallet connect timed out again', 'The claim page keeps timing out for me', 'Why is my bridge transfer stuck?', 'Withdrawals are missing from my balance']) assert.ok(issue(t), t);
  for (const t of ['How do I stake my tokens?', 'I made a mistake with my capital', "I can't wait for mainnet", 'I love the new dashboard', 'price is dumping, this is a scam']) assert.ok(!issue(t), t);
  assert.ok(!isTechnicalIssue({ kind: 'praise', text: 'wallet works great, nothing failed' }));
});

test('messages that report a failure are kept by the chat reader, so Technical Push can see them', () => {
  for (const t of ['My transaction fails every time I try to stake on the app', 'Getting errors when I connect my wallet to the site', 'The website is down again for me', 'Bridge crashes whenever I confirm the transfer', 'Having trouble claiming my rewards this morning', 'the claim page keeps timing out for me']) {
    assert.equal(analyze(t)?.kind, 'concern', t);
  }
  assert.equal(analyze('gm everyone'), null);
});

test('issues are grouped by topic with members, dates and answered counts, biggest first', () => {
  const g = groupIssues([
    { userId: 'a', topics: ['wallet'], createdAt: '2026-10-10T00:00:00Z', staffReplied: true },
    { userId: 'a', topics: ['wallet'], createdAt: '2026-10-12T00:00:00Z' },
    { userId: 'c', topics: ['wallet'], createdAt: '2026-10-13T00:00:00Z' },
    { userId: 'b', topics: ['bridge'], createdAt: '2026-10-11T00:00:00Z' }
  ]);
  assert.deepEqual(g.map((x) => [x.topic, x.count, x.reporters, x.answered]), [['wallet', 3, 2, 1], ['bridge', 1, 1, 0]]);
  assert.equal(g[0].firstAt, '2026-10-10T00:00:00Z');
});

test('a long report is split into numbered messages that each fit, and never cut off silently', () => {
  const long = Array.from({ length: 60 }, (_, i) => `• line ${i} ${'x'.repeat(60)}`).join('\n');
  const parts = splitMessage(long, 1900);
  assert.ok(parts.length > 1 && parts.every((p) => p.length <= 1900));
  assert.match(parts[0], /^\(1\/\d+\) /);
  assert.equal(parts.join('\n').match(/line \d+/g).length, 60, 'every line is in exactly one part');
  const capped = splitMessage(long.repeat(5), 1900, 4);
  assert.equal(capped.length, 4);
  assert.match(capped.at(-1), /rest of this report is in the Sentinel dashboard/);
  assert.deepEqual(splitMessage('short report', 1900), ['short report']);
  assert.deepEqual(splitMessage('', 1900), []);
});
