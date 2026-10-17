import './no-ai.js'; // must stay the first import: tests must never call a real AI model
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, checkPolicy, makeDraft, defaultBrief } from '../src/pulse/reply.js';
import { analyze } from '../src/pulse/analyze.js';

const brief = { ...defaultBrief(), projectName: 'Quicksilver', ticker: 'QCK', about: 'Liquid staking on Cosmos.',
  facts: ['QCK is the governance token of Quicksilver.', 'Staking rewards are shown on the app dashboard.'],
  links: [{ label: 'Website', url: 'https://quicksilver.example' }, { label: 'Support', url: 'https://quicksilver.example/support' }] };
const d = (text, kind = 'question') => ({ id: 'x', username: 'ann', text, kind });
const story = (title, topics) => ({ id: title, title, url: `https://news.example/${encodeURIComponent(title)}`, source: 'Decrypt', topics, publishedAt: new Date().toISOString(), weight: 1 });

test('your two screenshot questions are routed sensibly', () => {
  assert.deepEqual(classify("Hello admin, what's the trending topic in Web3, any exciting info?", 'question', brief).primary, 'market');
  const c = classify('admin see latest info, i think bitcoin is cooking and how do we utilise the token', 'question', brief);
  assert.ok(c.routes.includes('market') && c.routes.includes('project'));
  assert.equal(classify('when moon? will the price go up?', 'question', brief).primary, 'price');
  assert.equal(classify('the app is not working for me', 'concern', brief).primary, 'support');
});

test('"admin" is no longer a topic', () => {
  const a = analyze("Hello admin, what's the trending topic in Web3, any exciting info?");
  assert.ok(!a.topics.includes('admin') && !a.topics.includes('trending') && !a.topics.includes('topic'));
});

test('policy guard catches promises, hype, price talk, DMs and unknown links', () => {
  const bad = ['It is guaranteed to pump', 'This will 10x for sure', 'Price will reach $5 soon', 'You should buy now',
    'DM me and I will help', 'The airdrop is confirmed for Friday', 'Check https://evil.example/claim', 'we promise rewards'];
  for (const t of bad) assert.ok(checkPolicy(t, brief).length > 0, t);
  assert.equal(checkPolicy('Thanks! Docs are at https://quicksilver.example/support and this is not advice.', brief).length, 0);
  assert.ok(checkPolicy('We love pineapple', { ...brief, bannedPhrases: ['pineapple'] }).length > 0);
});

test('price questions get a polite non-answer with no prediction', async () => {
  const r = await makeDraft({ discussion: d('wen moon? will the price go up this week?'), brief, trends: [] });
  assert.equal(r.primary, 'price');
  assert.deepEqual(r.flags, []);
  assert.match(r.text, /can't talk about price/i);
});

test('market questions use the oracle stories and name the source', async () => {
  const r = await makeDraft({ discussion: d("Hello admin, what's the trending topic in Web3, any exciting info?"), brief,
    trends: [story('Bitcoin held earlier gains', ['bitcoin']), story('Ethereum staking inflows rise', ['staking'])] });
  assert.ok(r.sources.length > 0);
  assert.match(r.text, /Decrypt/);
  assert.match(r.text, /not advice/i);
  assert.deepEqual(r.flags, [], 'story links are allowed because they are sources');
});

test('project questions answer only from confirmed facts, otherwise say the team will check', async () => {
  const known = await makeDraft({ discussion: d('what is the QCK token used for? governance?'), brief, trends: [] });
  assert.match(known.text, /governance token of Quicksilver/);
  const unknown = await makeDraft({ discussion: d('how many tokens does the team hold in vesting?'), brief, trends: [] });
  assert.match(unknown.text, /checking with the team/i);
  assert.ok(!/\d/.test(unknown.text), 'no invented numbers');
});

test('ideas get thanks and no promise', async () => {
  const r = await makeDraft({ discussion: d('We should add a leaderboard so people see rewards', 'idea'), brief, trends: [] });
  assert.match(r.text, /can't promise/i);
  assert.deepEqual(r.flags, []);
});

test('an empty brief still produces a safe, general draft', async () => {
  const r = await makeDraft({ discussion: d('how do I use the token?'), brief: defaultBrief(), trends: [] });
  assert.equal(r.hasBrief, false);
  assert.deepEqual(r.flags, []);
});

/* ---------- from the live screenshots ---------- */
import { extractTopics } from '../src/pulse/analyze.js';
import { splitParts } from '../src/pulse/reply.js';
const realStory = (title, url) => ({ id: title, title, url, source: 'Test', topics: extractTopics(title, 6), publishedAt: new Date().toISOString(), weight: 1 });
const LIVE = [
  realStory('OKX eyes emerging markets with yield-offering stablecoin savings and payments app', 'https://cointelegraph.com/news/okx?utm_source=rss_feed&utm_medium=rss'),
  realStory('Strive Adds $169M Bitcoin in Its Biggest Buy in Four Months', 'https://decrypt.co/380129/strive'),
  realStory('Best Principal Token (PT) Stablecoin Yields (2026-10-05)', 'https://www.reddit.com/r/defi/comments/1wyhvju/')
];

test('"latest info on our token rewards" does not get unrelated bitcoin and stablecoin news', async () => {
  const r = await makeDraft({ discussion: d('Can we review the dashboard to show us real rewards and what\'s the latest info on our token rewards', 'question'), brief: defaultBrief(), trends: LIVE });
  assert.deepEqual(r.sources, []);
  assert.ok(!/headlines|in the news|Bitcoin|stablecoin/i.test(r.text), r.text);
  assert.match(r.text, /checking with the team/i);
});

test('a message with several lines gets every part answered, and small talk is ignored', async () => {
  const msg = 'Can we please add a staking dashboard for rewards?\nwhat is the price of the token\nadmin when mainnet\nany update on the roadmap?\nhello everyone';
  assert.equal(splitParts(msg).length, 5);
  const r = await makeDraft({ discussion: d(msg, 'idea'), brief, trends: [] });
  assert.equal(r.parts.length, 4, 'hello everyone is dropped');
  assert.match(r.text, /noted it for the team/i, 'the idea');
  assert.match(r.text, /can't talk about price/i, 'the price question');
  assert.match(r.text, /mainnet/i, 'the mainnet question is acknowledged');
  assert.match(r.text, /roadmap/i, 'the roadmap question is acknowledged');
  assert.ok(!/hello everyone/i.test(r.text));
  assert.deepEqual(r.flags, []);
  assert.match(r.note, /4 separate questions/);
});

test('the same message with the line breaks lost (older saved messages) still answers price and the idea', async () => {
  const flat = 'Can we please add a staking dashboard for rewards? what is the price of the token admin when mainnet any update on the roadmap? hello everyone';
  const r = await makeDraft({ discussion: d(flat, 'idea'), brief, trends: [] });
  assert.match(r.text, /noted it for the team/i);
  assert.match(r.text, /can't talk about price/i);
});

test('a general "what is trending" question still gets fresh stories, with tracking junk removed', async () => {
  const r = await makeDraft({ discussion: d("what's popping with the market and what's trending", 'question'), brief, trends: LIVE });
  assert.ok(r.sources.length > 0);
  assert.ok(!/utm_/.test(r.text), 'no tracking parameters in the reply');
  assert.deepEqual(r.flags, []);
});

/* ---------- Phase 3: knowledge bank ---------- */
import { chunkText, htmlToText } from '../src/pulse/knowledge.js';
const DOC_URL = 'https://docs.quicksilver.example/staking';
const KB = [
  ...chunkText('## Unstaking\nUnstaking takes about 21 days because of the Cosmos Hub unbonding period. You can also swap stATOM on a DEX to exit sooner.\n## Governance\nQCK is the governance token. Holders vote on proposals through the app.\n## Security\nThe protocol has been audited. Never share your seed phrase.')
    .map((t) => ({ text: t, title: 'Quicksilver Docs', url: DOC_URL, live: false })),
  { text: 'quicksilver pool STATOM on Cosmos: APY (yield, APR, rate) is about 14.20% (base 9.10%, rewards 5.10%), with $2.50M TVL, as of 2026-10-06 12:30 UTC. Source: DefiLlama. Rates change and can go down.', title: 'Quicksilver live data', url: 'https://defillama.com/yields?project=quicksilver', live: true, at: '2026-10-06T12:30:00Z' }
];

test('a project question is answered from the docs, names the source, and links to it', async () => {
  const r = await makeDraft({ discussion: d('how long does unstaking take?'), brief, trends: [], knowledge: KB });
  assert.match(r.text, /according to Quicksilver Docs/i);
  assert.match(r.text, /21 days/);
  assert.ok(r.text.includes(DOC_URL), 'links to the page it used');
  assert.deepEqual(r.flags, [], 'the docs link is allowed because it is one of the knowledge sources');
  assert.equal(r.knowledge[0].title, 'Quicksilver Docs');
  assert.doesNotMatch(r.text, /checking with the team/i);
});

test('an APY question gets the live number with its time and a rates-change warning', async () => {
  const r = await makeDraft({ discussion: d('what is the current apy on statom?'), brief, trends: [], knowledge: KB });
  assert.match(r.text, /14\.20%/);
  assert.match(r.text, /as of 2026-10-06 12:30 UTC/);
  assert.match(r.text, /can go down/);
  assert.deepEqual(r.flags, []);
});

test('a question the knowledge bank does not cover still says the team will check', async () => {
  const r = await makeDraft({ discussion: d('when is the airdrop snapshot happening?'), brief, trends: [], knowledge: KB });
  assert.match(r.text, /checking with the team/i);
  assert.equal(r.knowledge.length, 0);
});

test('knowledge never makes the drafter talk about price', async () => {
  const kb = [...KB, { text: 'The token price is currently very high and will likely double soon.', title: 'Blog', url: '', live: false }];
  const r = await makeDraft({ discussion: d('what is the price of the token and will it go up?'), brief, trends: [], knowledge: kb });
  assert.match(r.text, /can't talk about price/i);
  assert.doesNotMatch(r.text, /double|very high/i);
});

test('several questions each use their own knowledge', async () => {
  const msg = 'how long does unstaking take?\nwhat is QCK used for\nwhat is the price of the token\nwhen is the airdrop snapshot?';
  const r = await makeDraft({ discussion: d(msg), brief: { ...defaultBrief(), projectName: 'Quicksilver', ticker: 'QCK' }, trends: [], knowledge: KB });
  assert.match(r.text, /21 days/);
  assert.match(r.text, /governance token/i);
  assert.match(r.text, /can't talk about price/i);
  assert.match(r.text, /checking with the team on “when is the airdrop snapshot”/i);
  assert.deepEqual(r.flags, []);
});

test('a link that is not from the brief, the stories or the knowledge bank is still blocked', () => {
  assert.ok(checkPolicy('See https://evil.example/claim', brief, [DOC_URL]).length > 0);
  assert.equal(checkPolicy(`See ${DOC_URL}`, brief, [DOC_URL]).length, 0);
});
