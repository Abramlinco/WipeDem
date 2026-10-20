// Read-only test. It changes nothing in Sentinel. Run it from any folder:  node probe-osmosis.mjs
const T = (url) => fetch(url, { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });

async function probe(label, url, show) {
  try {
    const r = await T(url);
    const text = await r.text();
    let extra = '';
    try { extra = show ? show(JSON.parse(text)) : ''; } catch { extra = ''; }
    console.log(`\n[${label}]\n  ${r.status} ${url}\n  ${extra || text.replace(/\s+/g, ' ').slice(0, 700)}`);
  } catch (e) {
    console.log(`\n[${label}]\n  FAILED ${url}\n  ${e.cause?.code || e.message}`);
  }
}

const first = (j) => { const x = Array.isArray(j) ? j[0] : (j.pools ? j.pools[0] : j); return x ? JSON.stringify(x).slice(0, 900) : 'empty'; };

await probe('1 Osmosis public API, pool 1', 'https://sqs.osmosis.zone/pools?IDs=1', first);
await probe('2 Osmosis public API, pool 3505 (your pool)', 'https://sqs.osmosis.zone/pools?IDs=3505', first);
await probe('3 Osmosis node, pool 3505: what type of pool is it?', 'https://lcd.osmosis.zone/osmosis/poolmanager/v1beta1/pools/3505',
  (j) => `type=${j.pool?.['@type']} id=${j.pool?.id}`);
console.log('\nDone. Copy everything above and send it back.');
