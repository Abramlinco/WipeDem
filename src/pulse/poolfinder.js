// pool-finder: suggests pools to watch for a community, from its project details.
// Osmosis pools come from Osmosis's own API (DEX Screener does not carry Osmosis). Pools on other chains
// come from DEX Screener, one lookup per token address found in the project brief or uploaded documents.
// Nothing here adds anything: it only suggests, and the manager clicks Add.
import { fetchText } from './sources.js';

const TOKENS_URL = 'https://sqs.osmosis.zone/tokens/metadata';
const POOLS_URL = 'https://sqs.osmosis.zone/pools';
const MB = 1024 * 1024;
const cache = new Map(); // key -> { at, promise }; skipped when a fetcher is passed in (tests)

const enc = encodeURIComponent;
const num = (v) => (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const clean = (s, n = 80) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const shortDenom = (d) => (String(d).startsWith('ibc/') ? `ibc/${String(d).slice(4, 10)}…` : clean(String(d).split('/').pop(), 12));

function cached(useCache, key, ttlMs, load) {
  if (!useCache) return load();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.promise;
  const promise = load().catch((e) => { cache.delete(key); throw e; });
  cache.set(key, { at: Date.now(), promise });
  return promise;
}

const GENERIC = new Set(['protocol', 'network', 'finance', 'labs', 'dao', 'community', 'chain', 'token', 'app', 'foundation', 'official']);

/** "Quicksilver Protocol" also matches tokens named "Quicksilver ...". */
export function nameVariants(name) {
  const w = clean(name, 60).toLowerCase().split(/\s+/).filter(Boolean);
  const out = new Set();
  if (w.join(' ').length >= 3) out.add(w.join(' '));
  while (w.length > 1 && GENERIC.has(w[w.length - 1])) { w.pop(); if (w.join(' ').length >= 3) out.add(w.join(' ')); }
  return [...out];
}

/** The token list comes back as a list or as an object keyed by denom. Either way: [[denom, details], ...] */
export function tokenEntries(j) {
  const list = Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : null;
  if (list) return list.map((m) => [m?.coinMinimalDenom || m?.denom || m?.base_denom, m]);
  const o = j && typeof j === 'object' ? (j.data && typeof j.data === 'object' ? j.data : j) : {};
  return Object.entries(o);
}

/** Tokens whose name contains the project name, or whose symbol is exactly the ticker. */
export function matchTokens(entries, brief) {
  const variants = nameVariants(brief?.projectName);
  const ticker = clean(brief?.ticker, 20).replace(/^\$/, '').toLowerCase();
  const res = variants.map((v) => new RegExp(`(^|[^a-z0-9])${esc(v)}([^a-z0-9]|$)`, 'i'));
  const out = [];
  for (const [denom, m] of entries) {
    if (!denom || !m || typeof m !== 'object') continue;
    const symbol = clean(m.human_denom || m.symbol || m.name, 24);
    const name = clean(m.name, 60);
    const bySymbol = ticker.length >= 2 && symbol.toLowerCase() === ticker;
    const byName = res.some((re) => re.test(name) || re.test(symbol));
    if (bySymbol || byName) out.push({ denom, symbol: symbol || shortDenom(denom), name });
  }
  return out;
}

const poolList = (j) => (Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : Array.isArray(j?.pools) ? j.pools : []);

/** Pools that hold at least one of the matched tokens, largest first. */
export function osmosisSuggestions(pools, tokens, symbols = new Map()) {
  const want = new Map(tokens.map((t) => [t.denom, t.symbol]));
  const out = [];
  for (const p of pools) {
    const id = p?.chain_model?.id;
    const denoms = (p?.balances || []).map((b) => b?.denom).filter(Boolean);
    if (id === undefined || id === null || !denoms.some((d) => want.has(d))) continue;
    const cap = num(p.liquidity_cap);
    const tvlUsd = String(p.liquidity_cap_error || '').trim() && !cap ? null : cap;
    const names = denoms.map((d) => want.get(d) || symbols.get(d) || shortDenom(d));
    const url = `https://app.osmosis.zone/pool/${enc(id)}`;
    out.push({ id: `osmosis:${id}`, chain: 'osmosis', dex: 'osmosis', address: String(id), label: names.slice(0, 4).join(' / ') + (names.length > 4 ? ' …' : ''), tvlUsd, tokens: names, url, addInput: url });
  }
  return out.sort((a, b) => (b.tvlUsd ?? -1) - (a.tvlUsd ?? -1)).slice(0, 200);
}

const EVM = /\b0x[a-fA-F0-9]{40}\b/g;
const SOL = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;

/** Token addresses written in the brief or in uploaded documents. A few look-alike strings are harmless: DEX Screener simply knows nothing about them. */
export function findAddresses(texts, max = 6) {
  const evm = new Set(), sol = new Set();
  for (const t of texts || []) {
    const s = String(t ?? '').slice(0, 20000);
    for (const m of s.matchAll(EVM)) evm.add(m[0].toLowerCase());
    for (const m of s.matchAll(SOL)) { const a = m[0]; if (/\d/.test(a) && /[a-z]/.test(a) && /[A-Z]/.test(a)) sol.add(a); }
  }
  return [...evm, ...sol].slice(0, max);
}

async function dexSuggestions(addresses, fetcher) {
  const out = new Map();
  for (const a of addresses) {
    let j;
    try { j = JSON.parse(await fetcher(`https://api.dexscreener.com/latest/dex/tokens/${enc(a)}`, { timeoutMs: 15000 })); } catch { continue; }
    for (const p of (j?.pairs || []).slice(0, 60)) {
      const holds = [p.baseToken?.address, p.quoteToken?.address].some((x) => String(x).toLowerCase() === a.toLowerCase());
      const chain = String(p.chainId || '').toLowerCase();
      if (!holds || !chain || !p.pairAddress) continue;
      const id = `${chain}:${p.pairAddress}`;
      if (out.has(id)) continue;
      const base = clean(p.baseToken?.symbol, 16) || '?', quote = clean(p.quoteToken?.symbol, 16) || '?';
      const url = typeof p.url === 'string' && /^https:\/\/dexscreener\.com\//.test(p.url) ? p.url : `https://dexscreener.com/${chain}/${p.pairAddress}`;
      out.set(id, { id, chain, dex: clean(p.dexId, 24) || 'dex', address: String(p.pairAddress), label: `${base}/${quote}`, tvlUsd: num(p.liquidity?.usd), tokens: [base, quote], url, addInput: `https://dexscreener.com/${chain}/${p.pairAddress}` });
    }
  }
  return [...out.values()].sort((a, b) => (b.tvlUsd ?? -1) - (a.tvlUsd ?? -1)).slice(0, 200);
}

export async function findPools({ brief, texts = [], fetcher, now = new Date() } = {}) {
  const name = clean(brief?.projectName, 60), ticker = clean(brief?.ticker, 20);
  if (!name && !ticker) return { ok: false, error: 'Add your project name or ticker in the project brief first, so Pulse knows what to look for.' };
  const useCache = !fetcher;
  const f = fetcher || ((url, opts) => fetchText(url, opts));
  const notes = [];
  const suggestions = [];
  let matched = [];

  try {
    const tj = await cached(useCache, 'osmosis-tokens', 6 * 3600000, async () => JSON.parse(await f(TOKENS_URL, { timeoutMs: 30000, maxBytes: 8 * MB })));
    const entries = tokenEntries(tj);
    matched = matchTokens(entries, brief);
    if (matched.length) {
      const symbols = new Map(entries.map(([d, m]) => [d, clean(m?.human_denom || m?.symbol || m?.name, 16)]));
      const pj = await cached(useCache, 'osmosis-pools', 10 * 60000, async () => JSON.parse(await f(POOLS_URL, { timeoutMs: 60000, maxBytes: 24 * MB })));
      suggestions.push(...osmosisSuggestions(poolList(pj), matched, symbols));
    }
  } catch {
    notes.push('Osmosis could not be read just now, so Osmosis pools may be missing. Try again in a minute.');
  }

  const addresses = findAddresses([brief?.about, ...(brief?.facts || []), ...(brief?.links || []).map((l) => l?.url), ...texts]);
  if (addresses.length) {
    try { suggestions.push(...(await dexSuggestions(addresses, f))); } catch { notes.push('DEX Screener could not be read just now. Try again in a minute.'); }
  }

  if (!suggestions.length && !notes.length) {
    notes.push(matched.length
      ? 'Those tokens were found, but no pools hold them yet.'
      : 'No pools found. If your token lives on Ethereum, BNB Chain, Polygon, Base or Solana, put its contract address in the project brief or in an uploaded document. If it is on Osmosis, check the project name and ticker in the brief.');
  }
  return { ok: true, project: { name, ticker }, matched: matched.slice(0, 30).map(({ symbol, name: n }) => ({ symbol, name: n })), suggestions, notes, addressesChecked: addresses.length, at: now.toISOString() };
}
