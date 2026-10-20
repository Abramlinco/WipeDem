// Read-only test. It changes nothing in Sentinel. Run it from any folder:  node probe-quicksilver.mjs
// It tries the "find this project's pools automatically" idea for Quicksilver (QCK and its q-assets).
const T = async (url, ms = 30000) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
  const text = await r.text();
  return { status: r.status, text, size: text.length };
};
const short = (s, n = 300) => String(s).replace(/\s+/g, ' ').slice(0, n);
const money = (n) => (Number(n) >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : `$${Math.round(n / 1000)}K`);

// 1. What does DEX Screener know under the ticker QCK? (shows the fake-ticker risk too)
console.log('\n[1] DEX Screener search "QCK"');
try {
  const r = await T('https://api.dexscreener.com/latest/dex/search?q=QCK');
  const j = JSON.parse(r.text);
  const hits = (j.pairs || []).filter((p) => /qck/i.test(`${p.baseToken?.symbol} ${p.quoteToken?.symbol}`)).slice(0, 8);
  console.log(`  ${r.status}, ${j.pairs?.length ?? 0} results, ${hits.length} mention QCK`);
  for (const p of hits) console.log(`  ${p.chainId} | ${p.dexId} | ${p.baseToken?.symbol}/${p.quoteToken?.symbol} | liquidity ${money(p.liquidity?.usd || 0)} | token ${p.baseToken?.address}`);
} catch (e) { console.log('  FAILED', e.cause?.code || e.message); }

// 2. Which tokens does Osmosis list for Quicksilver (QCK and the q-assets such as qATOM, qOSMO)?
console.log('\n[2] Osmosis token list: QCK and q-assets');
const wanted = new Map();
try {
  const r = await T('https://sqs.osmosis.zone/tokens/metadata');
  console.log(`  ${r.status}, ${r.size} bytes`);
  let j; try { j = JSON.parse(r.text); } catch { console.log('  not JSON:', short(r.text)); }
  if (j) {
    const entries = Array.isArray(j) ? j.map((m) => [m.coinMinimalDenom || m.denom, m]) : Object.entries(j);
    for (const [denom, m] of entries) {
      const sym = String(m?.human_denom || m?.symbol || m?.name || '');
      if (/^(qck|q[a-z0-9]{2,6})$/i.test(sym) || /quicksilver/i.test(JSON.stringify(m).slice(0, 400))) wanted.set(denom, sym);
    }
    console.log(`  found ${wanted.size} candidates`);
    for (const [d, s] of [...wanted].slice(0, 15)) console.log(`  ${s.padEnd(8)} ${d}`);
    if (!wanted.size) console.log('  sample entry:', short(JSON.stringify(entries[0]), 400));
  }
} catch (e) { console.log('  FAILED', e.cause?.code || e.message); }

// 3. Which Osmosis pools contain those tokens?
console.log('\n[3] Osmosis pools containing them');
try {
  const r = await T('https://sqs.osmosis.zone/pools', 60000);
  console.log(`  ${r.status}, ${r.size} bytes`);
  let j; try { j = JSON.parse(r.text); } catch { console.log('  not JSON:', short(r.text)); }
  const pools = Array.isArray(j) ? j : j?.pools;
  if (pools && wanted.size) {
    const hits = pools
      .map((p) => ({ id: p.chain_model?.id, cap: Number(p.liquidity_cap) || 0, toks: (p.balances || []).map((b) => wanted.get(b.denom) || '?') }))
      .filter((p) => p.toks.some((t) => t !== '?'))
      .sort((a, b) => b.cap - a.cap).slice(0, 15);
    console.log(`  ${pools.length} pools scanned, showing top ${hits.length} that contain a Quicksilver token`);
    for (const p of hits) console.log(`  pool ${String(p.id).padEnd(6)} ${money(p.cap).padEnd(9)} ${p.toks.join(' / ')}`);
  } else if (!pools) console.log('  unexpected shape:', short(r.text));
} catch (e) { console.log('  FAILED', e.cause?.code || e.message); }
console.log('\nDone. Copy everything above and send it back.');
