import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePoolInput, readPool, diffPool, poolChunks } from '../src/pulse/pools.js';
import { retrieve } from '../src/pulse/knowledge.js';

const P = (input, extra = {}) => parsePoolInput({ mode: 'pool', input, ...extra });

test('the Osmosis link from the dashboard idea is understood', () => {
  assert.deepEqual(P('https://app.osmosis.zone/pool/3505'), { ok: true, kind: 'pair', chain: 'osmosis', address: '3505' });
  assert.equal(P('https://app.osmosis.zone/pool/').ok, false);
});

test('links from the other DEXes are understood', () => {
  assert.deepEqual(P('https://dexscreener.com/bsc/0x21d6205d3912e5eccdfbb89888ba359e358e13e0'), { ok: true, kind: 'pair', chain: 'bsc', address: '0x21d6205d3912e5eccdfbb89888ba359e358e13e0' });
  assert.equal(P('https://dexscreener.com/ethereum/0x7a597fb40f54A5E5Ad189991deDc8D7881E447ee').address, '0x7a597fb40f54a5e5ad189991dedc8d7881e447ee');
  assert.deepEqual(P('https://raydium.io/liquidity-pools/?pool_id=58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2'), { ok: true, kind: 'pair', chain: 'solana', address: '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2' });
  assert.equal(P('https://pancakeswap.finance/info/v3/bsc/pairs/0x172fcd41e0913e95784454622d1c3724f546f849').chain, 'bsc');
  assert.equal(P('https://pancakeswap.finance/info/v3/pairs/0x172fcd41e0913e95784454622d1c3724f546f849').chain, 'bsc', 'PancakeSwap defaults to BNB Chain');
  assert.equal(P('https://app.uniswap.org/explore/pools/base/0x4c36388be6f416a29c8d8eee81c771ce6be14b18').chain, 'base');
  assert.deepEqual(P('https://defillama.com/yields/pool/747c1d2a-c668-4682-b9f9-296708a3dd90'), { ok: true, kind: 'llama-pool', chain: 'defillama', address: '747c1d2a-c668-4682-b9f9-296708a3dd90' });
});

test('a bare address needs the chain, and chain names can be written loosely', () => {
  assert.equal(P('0x172fcd41e0913e95784454622d1c3724f546f849').ok, false);
  assert.equal(P('0x172fcd41e0913e95784454622d1c3724f546f849', { chain: 'BNB' }).chain, 'bsc');
  assert.equal(P('3505', { chain: 'osmo' }).chain, 'osmosis');
  assert.equal(P('bsc:0x172fcd41e0913e95784454622d1c3724f546f849').chain, 'bsc');
  assert.equal(P('osmosis:3505').address, '3505');
});

test('things that are not pools are refused with a plain reason', () => {
  for (const bad of ['', 'hello', 'https://example.com/page', '0x123', 'javascript:alert(1)']) assert.equal(P(bad, { chain: 'bsc' }).ok === true && bad !== '3505', false, bad);
  assert.match(P('').error, /Paste a link/);
  assert.match(P('0x123', { chain: 'bsc' }).error, /does not look right/);
  assert.match(parsePoolInput({ mode: 'token', input: 'https://dexscreener.com/bsc/0x172fcd41e0913e95784454622d1c3724f546f849' }).error, /token contract address/);
});

test('a token address is accepted in token mode, with or without a chain', () => {
  assert.deepEqual(parsePoolInput({ mode: 'token', input: '0xAbCdef0123456789abcdef0123456789ABCDEF01' }), { ok: true, kind: 'token', chain: '', address: '0xabcdef0123456789abcdef0123456789abcdef01' });
  assert.equal(parsePoolInput({ mode: 'token', input: '0xabcdef0123456789abcdef0123456789abcdef01', chain: 'ethereum' }).chain, 'ethereum');
});

const PAIR = (o = {}) => ({ chainId: 'osmosis', dexId: 'osmosis', pairAddress: '3505', baseToken: { symbol: 'OSMO', address: 'uosmo' }, quoteToken: { symbol: 'USDC', address: 'ibc/x' },
  priceChange: { h24: 3.2 }, volume: { h24: 250000 }, liquidity: { usd: 4200000 }, txns: { h24: { buys: 120, sells: 90 } }, url: 'https://dexscreener.com/osmosis/3505', ...o });
const fake = (body) => async (url) => { fake.last = url; return typeof body === 'function' ? body(url) : typeof body === 'string' ? body : JSON.stringify(body); };
const NOW = new Date('2026-10-08T10:00:00Z');

test('a pool is read from DEX Screener into plain facts', async () => {
  const s = await readPool({ kind: 'pair', chain: 'osmosis', address: '3505' }, { fetcher: fake({ pairs: [PAIR()] }), now: NOW });
  assert.equal(fake.last, 'https://api.dexscreener.com/latest/dex/pairs/osmosis/3505');
  assert.equal(s.label, 'OSMO/USDC'); assert.equal(s.tvlUsd, 4200000); assert.equal(s.volume24h, 250000); assert.equal(s.dex, 'osmosis'); assert.equal(s.apy, null);
});

test('unknown pools and service problems give clear messages', async () => {
  await assert.rejects(readPool({ kind: 'pair', chain: 'bsc', address: '0xabc' }, { fetcher: fake({ pairs: [] }) }), /does not know this pool yet/);
  await assert.rejects(readPool({ kind: 'pair', chain: 'bsc', address: '0xabc' }, { fetcher: fake(() => { const e = new Error('x'); e.status = 429; throw e; }) }), /too many requests/);
  await assert.rejects(readPool({ kind: 'pair', chain: 'bsc', address: '0xabc' }, { fetcher: fake('<html>') }), /unreadable/);
  await assert.rejects(readPool({ kind: 'llama-pool', address: '747c1d2a-c668-4682-b9f9-296708a3dd90' }, { fetcher: fake(() => { const e = new Error('x'); e.status = 403; throw e; }) }), /paid DefiLlama plan/);
});

test('a token lists all its pools, biggest first, and names the token', async () => {
  const tok = '0xabcdef0123456789abcdef0123456789abcdef01';
  const mk = (addr, usdv, dex) => PAIR({ chainId: 'bsc', dexId: dex, pairAddress: addr, baseToken: { symbol: 'QCK', address: tok }, quoteToken: { symbol: 'BNB', address: '0xbb' }, liquidity: { usd: usdv }, url: `https://dexscreener.com/bsc/${addr}` });
  const s = await readPool({ kind: 'token', chain: '', address: tok }, { fetcher: fake({ pairs: [mk('0x1', 5000, 'pancakeswap'), mk('0x2', 90000, 'uniswap')] }), now: NOW });
  assert.equal(s.symbol, 'QCK'); assert.equal(s.pairs[0].tvlUsd, 90000); assert.equal(s.tvlUsd, 95000);
});

const item = { kind: 'pair', label: 'OSMO/USDC' };
const snap = (o) => ({ kind: 'pair', label: 'OSMO/USDC', tvlUsd: 1000000, volume24h: 100000, apy: null, ...o });
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600000).toISOString();

test('a big drop in liquidity is flagged as high priority, with plain wording and no price talk', () => {
  const ev = diffPool(item, snap(), snap({ tvlUsd: 500000 }), [], NOW.getTime());
  assert.equal(ev.length, 1); assert.equal(ev[0].type, 'liquidity_drop'); assert.equal(ev[0].severity, 'high');
  assert.match(ev[0].text, /fell 50% since the last check, to about \$500\.0K/);
  assert.ok(!/price|moon|pump/i.test(ev[0].text));
});

test('growth and trading spikes are noticed, small moves are not', () => {
  assert.equal(diffPool(item, snap(), snap({ tvlUsd: 1300000 }), [], NOW.getTime())[0].type, 'liquidity_up');
  assert.equal(diffPool(item, snap(), snap({ volume24h: 260000 }), [], NOW.getTime())[0].type, 'volume_spike');
  assert.deepEqual(diffPool(item, snap(), snap({ tvlUsd: 1050000, volume24h: 120000 }), [], NOW.getTime()), []);
  assert.deepEqual(diffPool(item, null, snap(), [], NOW.getTime()), [], 'the first reading has nothing to compare with');
});

test('a day-old reading is used as the baseline when there is one', () => {
  const history = [{ at: hoursAgo(26), tvlUsd: 1000000 }, { at: hoursAgo(1), tvlUsd: 760000 }];
  const ev = diffPool(item, snap({ tvlUsd: 760000 }), snap({ tvlUsd: 700000 }), history, NOW.getTime());
  assert.match(ev[0].text, /fell 30% since yesterday/, 'a slow slide is caught even though each step was small');
});

test('a yield change is flagged, and always carries the warning that rates change', () => {
  const llama = { kind: 'llama-pool', label: 'DefiLlama pool 747c1d2a' };
  const ev = diffPool(llama, { tvlUsd: 3e6, apy: 12 }, { tvlUsd: 3e6, label: llama.label, apy: 7 }, [], NOW.getTime());
  assert.equal(ev[0].type, 'apy_change'); assert.equal(ev[0].severity, 'medium'); assert.match(ev[0].text, /from about 12\.0% to 7\.0%.*Rates change and can go down/);
});

test('a new pool for a watched token is reported, and a drained one is flagged', () => {
  const tk = { kind: 'token', label: 'QCK pools' };
  const pair = (id, t) => ({ id, label: 'QCK/BNB', dex: 'pancakeswap', chain: 'bsc', tvlUsd: t });
  const before = { symbol: 'QCK', pairs: [pair('bsc:0x1', 50000)] };
  const after = { symbol: 'QCK', pairs: [pair('bsc:0x1', 20000), pair('bsc:0x9', 8000), pair('bsc:0x8', 100)] };
  const ev = diffPool(tk, before, after, [], NOW.getTime());
  assert.deepEqual(ev.map((e) => e.type).sort(), ['liquidity_drop', 'new_pool']);
  assert.match(ev.find((e) => e.type === 'new_pool').text, /Check that your team created it/);
  assert.ok(!ev.some((e) => /0x8|100/.test(e.text)), 'dust pools are ignored');
});

test('watched pools become dated facts that a question about liquidity can find', () => {
  const items = [{ id: 'p1', snapshot: { ...snap(), at: '2026-10-08T10:00:00.000Z', dex: 'osmosis', chain: 'osmosis', url: 'https://dexscreener.com/osmosis/3505' } }];
  const chunks = poolChunks(items);
  assert.equal(chunks.length, 1);
  assert.match(chunks[0].text, /OSMO\/USDC on osmosis \(Osmosis\): liquidity is about \$1\.00M and 24 hour trading volume about \$100\.0K, as of 2026-10-08 10:00 UTC\. Source: DEX Screener\./);
  assert.ok(chunks[0].live && chunks[0].url.startsWith('https://dexscreener.com/'));
  const hit = retrieve(chunks, 'what is the liquidity in our pool right now?');
  assert.equal(hit.length, 1);
  assert.deepEqual(poolChunks([{ id: 'p2', snapshot: null }]), [], 'a pool not read yet says nothing');
});
