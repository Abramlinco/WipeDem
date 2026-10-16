import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToText, chunkText, retrieve, bestSentences, tokenize, readSource, LIMITS } from '../src/pulse/knowledge.js';

const DOCS = `<html><head><title>Quicksilver Docs</title><style>.x{color:red}</style></head><body>
<nav>Home | Pricing | Login</nav><script>alert('x')</script>
<h1>Liquid staking</h1>
<p>Quicksilver lets you stake ATOM and receive stATOM, a liquid staking token that keeps earning rewards while you use it in DeFi.</p>
<p>Unstaking takes about 21 days because of the Cosmos Hub unbonding period. You can also swap stATOM on a DEX to exit sooner.</p>
<h2>Governance</h2><p>QCK is the governance token. Holders vote on proposals through the app.</p>
<h2>Security</h2><p>The protocol has been audited. Never share your seed phrase with anyone, and ignore DMs offering help.</p>
<footer>Copyright</footer></body></html>`;

test('web pages become clean text without scripts, menus or styles', () => {
  const { title, text } = htmlToText(DOCS);
  assert.equal(title, 'Quicksilver Docs');
  assert.ok(text.includes('Quicksilver lets you stake ATOM'));
  for (const junk of ['alert', 'color:red', 'Pricing | Login', 'Copyright']) assert.ok(!text.includes(junk), junk);
});

test('long text is cut into sensible chunks', () => {
  const { text } = htmlToText(DOCS);
  const chunks = chunkText(text);
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((c) => c.length <= LIMITS.chunkChars * 1.7));
  const long = chunkText('Sentence number one is here. '.repeat(400));
  assert.ok(long.length > 3 && long.length <= LIMITS.chunksPerSource);
});

test('different wordings of the same word match', () => {
  assert.deepEqual([...new Set(tokenize('staking staked stake stakes'))], ['stak']);
});

const chunks = chunkText(htmlToText(DOCS).text).map((t) => ({ text: t, title: 'Quicksilver Docs', url: 'https://docs.q.example/' }));

test('each question finds the chunk that answers it', () => {
  assert.match(retrieve(chunks, 'how long does unstaking take?')[0].text, /21 days/);
  assert.match(retrieve(chunks, 'what is QCK used for, can I vote?')[0].text, /governance token/);
  assert.match(retrieve(chunks, 'is it safe, was it audited')[0].text, /audited/);
});

test('questions the documents do not cover find nothing, instead of a weak guess', () => {
  assert.deepEqual(retrieve(chunks, 'when is the airdrop snapshot'), []);
  assert.deepEqual(retrieve(chunks, 'hello how are you'), []);
  assert.deepEqual(retrieve([], 'anything about staking'), []);
});

test('a reply quotes the best sentences, not the whole chunk', () => {
  const c = retrieve(chunks, 'how long does unstaking take?')[0];
  const s = bestSentences(c.text, 'how long does unstaking take?', 1);
  assert.match(s, /21 days/);
  assert.ok(s.length < c.text.length || c.text.split('. ').length <= 1);
});

test('a web source is read through the fetcher and a pasted source directly', async () => {
  const r = await readSource({ type: 'url', url: 'https://docs.q.example/', title: '' }, { fetcher: async () => DOCS });
  assert.equal(r.title, 'Quicksilver Docs');
  assert.ok(r.chunks.length >= 2);
  const t = await readSource({ type: 'text', title: 'FAQ', text: 'Support is available on weekdays through the ticket form on our website.' });
  assert.equal(t.chunks.length, 1);
  await assert.rejects(readSource({ type: 'url', url: 'https://x.example/', title: '' }, { fetcher: async () => '<html><body><script>app()</script></body></html>' }), /JavaScript/);
});

const POOLS = { status: 'success', data: [
  { project: 'quicksilver', chain: 'Cosmos', symbol: 'STATOM', tvlUsd: 2500000, apy: 14.2, apyBase: 9.1, apyReward: 5.1 },
  { project: 'quicksilver', chain: 'Osmosis', symbol: 'STATOM-ATOM', tvlUsd: 900000, apy: 22.456, apyBase: 3, apyReward: 19.456 },
  { project: 'lido', chain: 'Ethereum', symbol: 'STETH', tvlUsd: 30000000000, apy: 2.9 }] };

test('DefiLlama: TVL and pools become dated live facts for only your project', async () => {
  const now = new Date('2026-10-06T12:30:00Z');
  const calls = [];
  const fetcher = async (url) => { calls.push(url); return url.includes('/tvl/') ? '3400000' : JSON.stringify(POOLS); };
  const r = await readSource({ type: 'defillama', title: 'Quicksilver live data', config: { tvlSlug: 'quicksilver-protocol', yieldProject: 'quicksilver' } }, { fetcher, now });
  assert.equal(r.chunks.length, 3);
  assert.ok(r.chunks.every((c) => c.live && c.at));
  assert.match(r.chunks[0].text, /TVL\) is about \$3\.40M as of 2026-10-06 12:30 UTC/);
  assert.match(r.chunks[1].text, /STATOM on Cosmos: APY.*14\.20%/);
  assert.ok(!r.chunks.some((c) => /lido|STETH/i.test(c.text)), 'other projects are left out');
  assert.ok(r.chunks.every((c) => !/guarantee/i.test(c.text)));
  // and a question about APY finds the pools
  const hits = retrieve(r.chunks.map((c) => ({ ...c, title: 'x' })), 'what is the current apy on statom?');
  assert.match(hits[0].text, /STATOM on Cosmos/);
  assert.ok(calls.some((u) => u === 'https://api.llama.fi/tvl/quicksilver-protocol'));
});

test('DefiLlama: clear messages when the data is not available', async () => {
  const fail = (status) => async () => { const e = new Error('x'); e.status = status; throw e; };
  const cfg = (c) => ({ type: 'defillama', title: 't', config: c });
  await assert.rejects(readSource(cfg({ yieldProject: 'quicksilver' }), { fetcher: fail(403) }), /paid DefiLlama plan/);
  await assert.rejects(readSource(cfg({ tvlSlug: 'nope-nope' }), { fetcher: fail(404) }), /nothing under/);
  await assert.rejects(readSource(cfg({ yieldProject: 'nothing' }), { fetcher: async () => JSON.stringify(POOLS) }), /No yield pools found/);
  await assert.rejects(readSource(cfg({}), { fetcher: async () => '1' }), /Add a protocol name/);
  await assert.rejects(readSource(cfg({ tvlSlug: '../../etc' }), { fetcher: async () => '1' }), /does not look like/);
});

import { searchProjects, resetProjectCache } from '../src/pulse/knowledge.js';
const LIST = [
  { name: 'Quicksilver Protocol', slug: 'quicksilver-protocol', tvl: 3400000, category: 'Liquid Staking', chains: ['Cosmos', 'Osmosis'] },
  { name: 'Quick Swap', slug: 'quickswap', tvl: 9000000, category: 'Dexes', chains: ['Polygon'] },
  { name: 'Lido', slug: 'lido', tvl: 3e10, category: 'Liquid Staking', chains: ['Ethereum'] },
  { name: 'Weird', slug: 'weird-quick-thing', tvl: 100, category: 'Other', chains: [] },
  { slug: 'broken' }, null
];

test('typing a project name finds it, best match first, without knowing any slug', async () => {
  resetProjectCache();
  let calls = 0;
  const fetcher = async (url) => { calls++; assert.equal(url, 'https://api.llama.fi/protocols'); return JSON.stringify(LIST); };
  const r = await searchProjects('quicksilver', { fetcher });
  assert.equal(r[0].slug, 'quicksilver-protocol');
  assert.deepEqual(r[0].chains, ['Cosmos', 'Osmosis']);
  const q = await searchProjects('quick', { fetcher });
  assert.deepEqual(q.map((x) => x.slug), ['quickswap', 'quicksilver-protocol', 'weird-quick-thing'].sort((a, b) => 0) && q.map((x) => x.slug), 'several matches');
  assert.ok(q.findIndex((x) => x.slug === 'quickswap') < q.findIndex((x) => x.slug === 'weird-quick-thing'), 'names that start with it come before ones that only contain it');
  assert.equal(calls, 1, 'the big list is only downloaded once');
  assert.deepEqual(await searchProjects('x', { fetcher }), [], 'too short to search');
  assert.deepEqual(await searchProjects('zzzznothing', { fetcher }), []);
});

test('if DefiLlama will not give the project list, the message says why', async () => {
  resetProjectCache();
  await assert.rejects(searchProjects('lido', { fetcher: async () => { const e = new Error('x'); e.status = 429; throw e; } }), /too many requests/);
});
