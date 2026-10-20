// Read-only test. It changes nothing in Sentinel. Run it from any folder:  node probe-pools.mjs
// It checks which pool data services answer from THIS computer, and what DEX Screener calls Osmosis pools.
const T = (url) => fetch(url, { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });

async function probe(label, url, show) {
  try {
    const r = await T(url);
    const text = await r.text();
    let extra = '';
    if (show) { try { extra = show(JSON.parse(text)); } catch (e) { extra = 'could not read as JSON'; } }
    console.log(`\n[${label}]\n  ${r.status} ${url}\n  ${extra || text.replace(/\s+/g, ' ').slice(0, 200)}`);
  } catch (e) {
    console.log(`\n[${label}]\n  FAILED ${url}\n  ${e.cause?.code || e.message}`);
  }
}

await probe('1 DEX Screener, Uniswap WETH/USDC (control, should work)', 'https://api.dexscreener.com/latest/dex/pairs/ethereum/0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
  (j) => `pairs: ${j.pairs?.length ?? 0}, first: ${j.pairs?.[0]?.baseToken?.symbol}/${j.pairs?.[0]?.quoteToken?.symbol}`);
await probe('2 DEX Screener, Osmosis pool 1 (what Sentinel asks today)', 'https://api.dexscreener.com/latest/dex/pairs/osmosis/1');
await probe('3 DEX Screener search: how does it name Osmosis pools?', 'https://api.dexscreener.com/latest/dex/search?q=OSMO%20USDC',
  (j) => {
    const o = (j.pairs || []).filter((p) => String(p.chainId).toLowerCase() === 'osmosis').slice(0, 4);
    return o.length ? o.map((p) => `chainId=${p.chainId} pairAddress=${p.pairAddress} ${p.baseToken?.symbol}/${p.quoteToken?.symbol} url=${p.url}`).join('\n  ') : `no Osmosis pairs in ${j.pairs?.length ?? 0} results`;
  });
await probe('4 Osmosis own API (SQS), pool 1', 'https://sqsprod.osmosis.zone/pools?IDs=1');
await probe('5 Osmosis node (LCD), pool 1', 'https://lcd.osmosis.zone/osmosis/poolmanager/v1beta1/pools/1');
console.log('\nDone. Copy everything above and send it back.');
