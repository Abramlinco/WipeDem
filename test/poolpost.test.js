// pool-post
import './no-ai.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { poolPostDraft, poolFacts } from '../src/pulse/poolpost.js';
import { checkPolicy } from '../src/pulse/reply.js';

const NOW = Date.parse('2026-10-21T09:00:00Z');
const URL1 = 'https://app.osmosis.zone/pool/944';
const osmo = (over = {}) => ({
  id: 'p1', communityKey: 'discord:1', kind: 'pair', chain: 'osmosis', address: '944', label: 'qATOM / ATOM',
  snapshot: { label: 'qATOM / ATOM', dex: 'osmosis', chain: 'osmosis', tvlUsd: 864800, volume24h: null, apy: null, at: '2026-10-21T08:00:00Z', url: URL1, kind: 'pair' },
  history: [{ at: '2026-10-20T07:00:00Z', tvlUsd: 700000 }, { at: '2026-10-21T07:30:00Z', tvlUsd: 860000 }], ...over
});
const BRIEF = { projectName: 'Quicksilver', links: [] };
const allVersions = (item, brief = BRIEF) => { const first = poolPostDraft(item, brief, 0, NOW); return Array.from({ length: first.total }, (_, n) => poolPostDraft(item, brief, n, NOW)); };

test('facts come from the stored pool: change since yesterday, no invented yield', () => {
  const f = poolFacts(osmo(), NOW);
  assert.equal(f.chain, 'Osmosis'); assert.equal(f.tvl, 864800); assert.equal(f.apy, null); assert.equal(f.since, 'since yesterday');
  assert.ok(Math.abs(f.change - (864800 - 700000) / 700000) < 1e-9);
  assert.equal(f.url, URL1);
});

test('every version is factual, links the pool, carries safety wording and passes the post checks', () => {
  const versions = allVersions(osmo());
  assert.ok(versions.length >= 4, 'several versions to cycle through');
  assert.equal(new Set(versions.map((v) => v.text)).size, versions.length, 'all different');
  for (const v of versions) {
    assert.deepEqual(checkPolicy(v.text, BRIEF, v.sources), [], `flags in: ${v.text}`);
    assert.ok(v.text.includes(URL1), 'links the pool');
    assert.match(v.text, /DYOR|seed phrase|wallet safe/i, 'crypto safety wording');
    assert.match(v.text, /\$864\.8K/, 'real liquidity');
    assert.match(v.text, /up about 24% since yesterday/);
    assert.ok(!/\bAPY\b|yield/i.test(v.text), 'no yield claim when no source gives one');
    assert.ok(!/miss out|guarantee|moon|buy now|risk[- ]free|\[|\]/i.test(v.text), 'no hype, no placeholders');
    assert.ok(v.text.length < 700);
  }
  assert.match(versions[1].text, /^Hello Quicksilver community!/);
});

test('yield and volume appear only when a source provided them', () => {
  const llama = osmo({ kind: 'llama-pool', label: 'DefiLlama pool', snapshot: { ...osmo().snapshot, apy: 4.23, volume24h: 99999, kind: 'llama-pool' } });
  const v = allVersions(llama);
  assert.ok(v.some((x) => /yield \(APY\) is about 4\.2%.*Rates change and can go down/.test(x.text)));
  assert.ok(v.every((x) => !/volume/i.test(x.text)), 'a DefiLlama pool has no trading volume');
  for (const x of v) assert.deepEqual(checkPolicy(x.text, BRIEF, x.sources), []);
  const uni = osmo({ chain: 'ethereum', snapshot: { ...osmo().snapshot, dex: 'uniswap', chain: 'ethereum', volume24h: 34580000, url: 'https://dexscreener.com/ethereum/0xabc' } });
  const u = allVersions(uni);
  assert.ok(u.some((x) => /Trading volume over the last 24 hours is about \$34\.58M/.test(x.text)) && u.some((x) => /uniswap, Ethereum/.test(x.text)));
  for (const x of u) assert.deepEqual(checkPolicy(x.text, BRIEF, x.sources), []);
});

test('regenerating cycles and wraps, and a pool with no liquidity figure still gets a sensible post', () => {
  const a = poolPostDraft(osmo(), BRIEF, 0, NOW), b = poolPostDraft(osmo(), BRIEF, 1, NOW);
  assert.notEqual(a.text, b.text);
  assert.equal(poolPostDraft(osmo(), BRIEF, a.total, NOW).text, a.text, 'wraps around');
  assert.equal(poolPostDraft(osmo(), BRIEF, -1, NOW).n, a.total - 1);
  const none = osmo({ snapshot: { ...osmo().snapshot, tvlUsd: null }, history: [] });
  const d = poolPostDraft(none, {}, 0, NOW);
  assert.ok(d.text.includes(URL1) && !/n\/a|null|undefined|NaN/.test(d.text) && !/\$/.test(d.text));
  assert.deepEqual(checkPolicy(d.text, {}, d.sources), []);
  assert.match(poolPostDraft(none, {}, 1, NOW).text, /^Hello community!/, 'no project name, no problem');
});

test('a token watch (every pool for a token) is described as a group, and has no link when it has none', () => {
  const token = { id: 't1', communityKey: 'discord:1', kind: 'token', chain: 'ethereum', address: '0xabc', label: 'ACME pools', snapshot: { kind: 'token', label: 'ACME pools', symbol: 'ACME', tvlUsd: 120000, volume24h: 5000, pairs: [{}, {}, {}], at: '2026-10-21T08:00:00Z' }, history: [] };
  const v = allVersions(token, {});
  assert.ok(v.every((x) => /3 pools hold about \$120\.0K/.test(x.text)));
  assert.ok(v.every((x) => !/pools pool/.test(x.text)), 'no "pools pool"');
  assert.ok(v.some((x) => /3 pools hold about \$120\.0K in liquidity in total/.test(x.text)));
  assert.deepEqual(v[0].sources, []);
  for (const x of v) assert.deepEqual(checkPolicy(x.text, {}, x.sources), []);
});
