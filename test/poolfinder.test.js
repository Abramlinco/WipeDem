// pool-finder
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPools, matchTokens, tokenEntries, findAddresses, nameVariants } from '../src/pulse/poolfinder.js';
import { parsePoolInput } from '../src/pulse/pools.js';

const QCK = 'ibc/QCKDENOM', QATOM = 'ibc/QATOMDENOM', ATOM = 'ibc/ATOMDENOM', QUARK = 'factory/osmo1x/uquark';
const TOKENS = {
  [QCK]: { human_denom: 'QCK', name: 'Quicksilver' },
  [QATOM]: { human_denom: 'qATOM', name: 'Quicksilver Liquid Staked ATOM' },
  [ATOM]: { human_denom: 'ATOM', name: 'Cosmos Hub' },
  [QUARK]: { human_denom: 'QUARK', name: 'Quark' },
  uosmo: { human_denom: 'OSMO', name: 'Osmosis' }
};
const pool = (id, denoms, cap, err = '') => ({ chain_model: { id }, liquidity_cap: cap, liquidity_cap_error: err, balances: denoms.map((denom) => ({ denom, amount: '1' })) });
const POOLS = { data: [pool(944, [QATOM, ATOM], '6000'), pool(1, [ATOM, 'uosmo'], '864000'), pool(3137, [QUARK, 'uosmo'], '2000'), pool(952, [QCK, 'uosmo'], '500'), pool(77, [QCK, ATOM], '0', 'no price')] };
const feed = (map) => async (url) => { const hit = Object.entries(map).find(([k]) => url.includes(k)); if (!hit) throw new Error('unexpected ' + url); if (hit[1] instanceof Error) throw hit[1]; return JSON.stringify(hit[1]); };

test('a brief with a name and ticker finds the project pools on Osmosis, largest first, with readable names', async () => {
  const r = await findPools({ brief: { projectName: 'Quicksilver Protocol', ticker: 'QCK' }, fetcher: feed({ 'tokens/metadata': TOKENS, 'sqs.osmosis.zone/pools': POOLS }) });
  assert.equal(r.ok, true);
  assert.deepEqual(r.matched.map((t) => t.symbol).sort(), ['QCK', 'qATOM']);
  assert.deepEqual(r.suggestions.map((s) => s.address), ['944', '952', '77']);
  assert.equal(r.suggestions[0].label, 'qATOM / ATOM');
  assert.equal(r.suggestions[0].tvlUsd, 6000);
  assert.equal(r.suggestions[1].label, 'QCK / OSMO');
  assert.equal(r.suggestions[2].tvlUsd, null, 'a pool with no liquidity figure is kept, with n/a');
  assert.ok(!r.suggestions.some((s) => s.address === '3137' || s.address === '1'), 'other projects pools are left out');
  assert.equal(r.suggestions[0].addInput, 'https://app.osmosis.zone/pool/944');
  assert.deepEqual(parsePoolInput({ input: r.suggestions[0].addInput }), { ok: true, kind: 'pair', chain: 'osmosis', address: '944' });
});

test('the token list can be a list as well as an object, and a ticker alone is enough', () => {
  const list = [{ coinMinimalDenom: QCK, human_denom: 'QCK', name: 'Quicksilver' }, { coinMinimalDenom: QUARK, human_denom: 'QUARK', name: 'Quark' }];
  assert.deepEqual(matchTokens(tokenEntries(list), { ticker: '$qck' }).map((t) => t.denom), [QCK]);
  assert.deepEqual(matchTokens(tokenEntries({ data: list }), { projectName: 'Quark' }).map((t) => t.denom), [QUARK]);
  assert.deepEqual(nameVariants('Quicksilver Protocol'), ['quicksilver protocol', 'quicksilver']);
  assert.deepEqual(matchTokens(tokenEntries(TOKENS), { projectName: 'Co' }), [], 'a two letter name matches nothing');
});

test('without a name or ticker nothing is guessed', async () => {
  const r = await findPools({ brief: {}, fetcher: async () => { throw new Error('should not be called'); } });
  assert.equal(r.ok, false);
  assert.match(r.error, /project name or ticker/);
});

test('if Osmosis cannot be read, Pulse says so instead of failing', async () => {
  const r = await findPools({ brief: { projectName: 'Quicksilver' }, fetcher: feed({ 'tokens/metadata': new Error('down') }) });
  assert.equal(r.ok, true);
  assert.deepEqual(r.suggestions, []);
  assert.match(r.notes[0], /Osmosis could not be read/);
});

test('token addresses in the brief or documents lead to pools on other chains', async () => {
  const ADDR = '0x1111111111111111111111111111111111111111';
  const PA = '0x' + 'a'.repeat(40), PB = '0x' + 'b'.repeat(40), PC = '0x' + 'c'.repeat(40);
  const pair = (chainId, pairAddress, base, quote, usd, held = true) => ({ chainId, dexId: 'uniswap', pairAddress, url: `https://dexscreener.com/${chainId}/${pairAddress}`, baseToken: { address: held ? ADDR : '0x2222222222222222222222222222222222222222', symbol: base }, quoteToken: { address: '0x3333333333333333333333333333333333333333', symbol: quote }, liquidity: { usd } });
  const r = await findPools({
    brief: { projectName: 'Acme', ticker: 'ACME', facts: [`Our token contract is ${ADDR.toUpperCase().replace('0X', '0x')}`] },
    texts: ['nothing here'],
    fetcher: feed({ 'tokens/metadata': {}, [`tokens/${ADDR}`]: { pairs: [pair('ethereum', PA, 'ACME', 'WETH', 50000), pair('base', PB, 'ACME', 'USDC', 900), pair('bsc', PC, 'FAKE', 'USDT', 999999, false)] } })
  });
  assert.equal(r.addressesChecked, 1);
  assert.deepEqual(r.suggestions.map((s) => `${s.chain}:${s.address}`), [`ethereum:${PA}`, `base:${PB}`]);
  assert.equal(r.suggestions[0].label, 'ACME/WETH');
  assert.deepEqual(parsePoolInput({ input: r.suggestions[0].addInput }), { ok: true, kind: 'pair', chain: 'ethereum', address: PA });
});

test('address finding ignores ordinary words and long hyphenated slugs', () => {
  const sol = '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2';
  const found = findAddresses(['Liquidity is great', 'https://example.org/a-very-long-readable-page-name-about-staking', `mint ${sol}`, 'AllLettersOnlyNoDigitsHereAtAllToSeeAbc']);
  assert.deepEqual(found, [sol]);
  assert.equal(findAddresses(Array.from({ length: 20 }, (_, i) => `0x${String(i + 1).padStart(40, '0')}`)).length, 6, 'capped at six lookups');
});
