import { fetchText } from './sources.js';

// Pool Watch. A community manager pastes a link to a pool (an Osmosis pool, a Raydium or
// PancakeSwap pool, a Uniswap pool) or the address of a token. Sentinel then checks it on a
// schedule and says what changed: liquidity up or down, trading spikes, and brand new pools for
// the token. Data comes from DEX Screener, which is free, needs no key and covers 80+ chains.
// It does NOT give APY or APR. Those only come from a DefiLlama pool link, when DefiLlama allows it.

export const CHAIN_NAMES = {
  ethereum: 'Ethereum', bsc: 'BNB Chain', solana: 'Solana', base: 'Base', arbitrum: 'Arbitrum', polygon: 'Polygon',
  optimism: 'Optimism', avalanche: 'Avalanche', osmosis: 'Osmosis', sui: 'Sui', ton: 'TON', cronos: 'Cronos', injective: 'Injective', sei: 'Sei', kava: 'Kava'
};
const CHAIN_ALIASES = { eth: 'ethereum', mainnet: 'ethereum', bnb: 'bsc', bnbchain: 'bsc', sol: 'solana', matic: 'polygon', arb: 'arbitrum', op: 'optimism', avax: 'avalanche', osmo: 'osmosis' };
const chainOf = (s) => { const k = String(s || '').toLowerCase().trim(); return CHAIN_ALIASES[k] || k; };

const EVM = /0x[a-fA-F0-9]{40}/;
const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUGCHAIN = /^[a-z0-9-]{2,30}$/;

const usd = (n) => (n == null ? 'n/a' : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${Math.round(n)}`);
const stamp = (iso) => `${String(iso).slice(0, 16).replace('T', ' ')} UTC`;
const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);

// Retry only transient upstream failures; do not hammer a rate-limited service.
async function fetchPoolText(url, fetcher = fetchText) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await fetcher(url); } catch (e) {
      last = e;
      const transient = e.status === 429 || e.status >= 500 || ['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED'].includes(e.code) || e.name === 'AbortError' || e.name === 'TimeoutError';
      if (!transient || attempt === 2) break;
      const retryAfter = Math.min(1500, Math.max(0, Number(e.retryAfterSeconds || 0) * 1000));
      await new Promise((resolve) => setTimeout(resolve, Math.max(retryAfter, attempt === 0 ? 300 : 800)));
    }
  }
  throw last;
}

/* ------------------------------------------------------------------ */
/* Understanding what the person pasted                                */
/* ------------------------------------------------------------------ */

const NOT_SURE = "I could not tell which pool that is. Paste the pool's page address, or pick the chain and paste the pool address.";

/**
 * mode "pool": one pool. mode "token": every pool for a token address.
 * Returns { ok:true, kind, chain, address } or { ok:false, error }.
 */
export function parsePoolInput({ mode = 'pool', input, chain } = {}) {
  const raw = String(input || '').trim();
  if (!raw) return { ok: false, error: 'Paste a link or an address first.' };
  const pickChain = chain ? chainOf(chain) : '';
  if (pickChain && !SLUGCHAIN.test(pickChain)) return { ok: false, error: 'That chain name does not look right.' };

  // "chain:address"
  const pair = raw.match(/^([a-z0-9-]{2,30}):([A-Za-z0-9]+)$/);
  if (pair && !/^https?$/i.test(pair[1])) return finish(mode, chainOf(pair[1]), pair[2]);

  if (UUID.test(raw)) return mode === 'pool' ? { ok: true, kind: 'llama-pool', chain: 'defillama', address: raw.toLowerCase() } : { ok: false, error: 'That looks like a DefiLlama pool id. Use "A pool" for it.' };

  if (/^https?:\/\//i.test(raw) || /^[a-z0-9.-]+\.[a-z]{2,}\//i.test(raw)) {
    let u;
    try { u = new URL(/^https?:/i.test(raw) ? raw : `https://${raw}`); } catch { return { ok: false, error: NOT_SURE }; }
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    const seg = u.pathname.split('/').filter(Boolean);
    if (mode === 'token') return { ok: false, error: 'For a token, paste the token contract address, not a page link.' };

    if (host.endsWith('dexscreener.com') && seg.length >= 2) return finish('pool', chainOf(seg[0]), seg[1]);
    if (host === 'app.osmosis.zone') {
      const i = seg.indexOf('pool'); const id = i >= 0 ? seg[i + 1] : seg[0] === 'pools' ? seg[1] : '';
      return /^\d+$/.test(id || '') ? finish('pool', 'osmosis', id) : { ok: false, error: 'That Osmosis link has no pool number in it. It should look like app.osmosis.zone/pool/1234.' };
    }
    if (host.endsWith('raydium.io')) {
      const cands = ['pool_id', 'poolId', 'pool', 'ammId', 'id'].map((k) => u.searchParams.get(k)).concat(seg);
      const addr = cands.find((c) => c && SOL.test(c));
      return addr ? finish('pool', 'solana', addr) : { ok: false, error: 'I could not find the pool address in that Raydium link. Open the pool and copy its address, then pick Solana.' };
    }
    if (host.endsWith('defillama.com')) {
      const id = seg.find((s) => UUID.test(s));
      return id ? { ok: true, kind: 'llama-pool', chain: 'defillama', address: id.toLowerCase() } : { ok: false, error: 'I need a DefiLlama pool page (defillama.com/yields/pool/…).' };
    }
    const evm = raw.match(EVM);
    if (evm) {
      let c = pickChain || chainOf(u.searchParams.get('chain') || '');
      if (!c) c = chainOf(seg.find((s) => CHAIN_NAMES[chainOf(s)])) || (host.includes('pancakeswap') ? 'bsc' : host.includes('uniswap') ? 'ethereum' : '');
      return c ? finish('pool', c, evm[0]) : { ok: false, error: `${NOT_SURE} Pick the chain from the list.` };
    }
    return { ok: false, error: NOT_SURE };
  }

  // A bare address or pool number, which needs the chain picked.
  if (!pickChain) {
    if (mode === 'token' && EVM.test(raw)) return { ok: true, kind: 'token', chain: '', address: raw.match(EVM)[0].toLowerCase() };
    if (mode === 'token' && SOL.test(raw)) return { ok: true, kind: 'token', chain: '', address: raw };
    return { ok: false, error: 'Pick the chain for that address.' };
  }
  return finish(mode, pickChain, raw);
}

function finish(mode, chain, address) {
  if (!SLUGCHAIN.test(chain)) return { ok: false, error: NOT_SURE };
  const a = String(address);
  const valid = EVM.test(a) && a.length === 42 ? a.toLowerCase() : SOL.test(a) ? a : (/^\d{1,9}$/.test(a) && chain === 'osmosis' ? a : '');
  if (!valid) return { ok: false, error: 'That address does not look right for that chain.' };
  return { ok: true, kind: mode === 'token' ? 'token' : 'pair', chain: mode === 'token' ? chain : chain, address: valid };
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

const enc = encodeURIComponent;
const json = (text) => { try { return JSON.parse(text); } catch { throw new Error('The data service sent back something unreadable. Try again later.'); } };

function friendly(e, what) {
  // DNS and transport failures do not mean that a pool/token is invalid.
  if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED'].includes(e.code)) {
    return new Error('Could not reach DEX Screener because of a temporary DNS or network problem. Your pool was not marked invalid. Check your server connection and try again in a minute.');
  }
  if (e.name === 'AbortError' || e.name === 'TimeoutError') {
    return new Error('The data service took too long to respond. Your pool was not marked invalid. Try again shortly.');
  }
  if (e.status === 404) return new Error(`${what} was not found. Check the chain and address.`);
  if (e.status === 429) return new Error('The data service says too many requests. Wait before retrying; the pool may still be valid.');
  if (e.status === 401 || e.status === 403) return new Error('The data service refused the request. It may need a paid plan.');
  // fix-3: say what actually happened instead of a bare "The address answered 400".
  const detail = e.body ? ` (${String(e.body).replace(/\s+/g, ' ').trim().slice(0, 140)})` : '';
  if (e.status === 400) return new Error(`The data service rejected this lookup (HTTP 400)${detail}. That can mean it does not recognise this chain or pool address. Try pasting the pool's DEX Screener link (dexscreener.com/<chain>/<pool>) instead.`);
  if (e.status) return new Error(`The data service answered HTTP ${e.status}${detail}. Try again later.`);
  return e;
}

function normalizePair(p) {
  const base = p.baseToken?.symbol || '?', quote = p.quoteToken?.symbol || '?';
  const tx = p.txns?.h24;
  return {
    id: `${p.chainId}:${p.pairAddress}`, label: `${base}/${quote}`, dex: p.dexId || 'dex', chain: p.chainId,
    tvlUsd: num(p.liquidity?.usd), volume24h: num(p.volume?.h24), priceChange24h: num(p.priceChange?.h24),
    txns24h: tx ? (tx.buys || 0) + (tx.sells || 0) : null, createdAt: num(p.pairCreatedAt), url: typeof p.url === 'string' && /^https:\/\/dexscreener\.com\//.test(p.url) ? p.url : ''
  };
}

export async function readPool(item, { fetcher = fetchText, now = new Date() } = {}) {
  const at = now.toISOString();
  if (item.kind === 'pair') {
    let j;
    try { j = json(await fetchPoolText(`https://api.dexscreener.com/latest/dex/pairs/${enc(item.chain)}/${enc(item.address)}`, fetcher)); } catch (e) { throw friendly(e, 'That pool'); }
    const p = (j.pairs || [])[0];
    if (!p) throw new Error("DEX Screener does not know this pool yet. Check the chain and address. Brand new pools can take a few minutes to appear.");
    const n = normalizePair(p);
    return { ...n, at, kind: 'pair', apy: null };
  }
  if (item.kind === 'token') {
    let j;
    try { j = json(await fetchPoolText(`https://api.dexscreener.com/latest/dex/tokens/${enc(item.address)}`, fetcher)); } catch (e) { throw friendly(e, 'That token'); }
    let pairs = (j.pairs || []).filter((p) => !item.chain || String(p.chainId).toLowerCase() === item.chain).map(normalizePair);
    if (!pairs.length) throw new Error('DEX Screener has no pools for that token yet.');
    pairs.sort((a, b) => (b.tvlUsd || 0) - (a.tvlUsd || 0));
    const first = (j.pairs || []).find((p) => [p.baseToken?.address, p.quoteToken?.address].some((a) => String(a).toLowerCase() === item.address));
    const symbol = first ? (String(first.baseToken?.address).toLowerCase() === item.address ? first.baseToken.symbol : first.quoteToken.symbol) : '';
    pairs = pairs.slice(0, 25);
    return { at, kind: 'token', symbol, label: `${symbol || 'Token'} pools`, pairs, tvlUsd: pairs.reduce((n, p) => n + (p.tvlUsd || 0), 0), volume24h: pairs.reduce((n, p) => n + (p.volume24h || 0), 0), url: pairs[0].url, apy: null };
  }
  if (item.kind === 'llama-pool') {
    let j;
    try { j = json(await fetchPoolText(`https://yields.llama.fi/chart/${enc(item.address)}`, fetcher)); }
    catch (e) { throw (e.status === 401 || e.status === 403) ? new Error('DefiLlama refused this request. Pool yields may need a paid DefiLlama plan.') : friendly(e, 'That DefiLlama pool'); }
    const last = (j.data || []).slice(-1)[0];
    if (!last) throw new Error('DefiLlama has no yield history for that pool.');
    return { at, kind: 'llama-pool', label: `DefiLlama pool ${item.address.slice(0, 8)}`, tvlUsd: num(last.tvlUsd), apy: num(last.apy), apyBase: num(last.apyBase), apyReward: num(last.apyReward), volume24h: null, url: `https://defillama.com/yields/pool/${item.address}` };
  }
  throw new Error('Unknown kind of pool');
}

/* ------------------------------------------------------------------ */
/* What changed                                                        */
/* ------------------------------------------------------------------ */

/** Compares a fresh reading with the last one and with about a day ago. Returns events worth telling someone. */
export function diffPool(item, prev, next, history = [], now = Date.now()) {
  const events = [];
  const pct = (a, b) => (b ? (a - b) / b : null);
  const name = next.label || item.label || 'This pool';

  if (item.kind === 'token') {
    if (!prev) return events;
    const before = new Map((prev.pairs || []).map((p) => [p.id, p]));
    for (const p of next.pairs) {
      if (!before.has(p.id) && (p.tvlUsd || 0) >= 500) {
        events.push({ type: 'new_pool', severity: 'medium', text: `A new ${p.dex} pool appeared for ${next.symbol || 'your token'}: ${p.label} on ${CHAIN_NAMES[p.chain] || p.chain}, with about ${usd(p.tvlUsd)} liquidity. Check that your team created it, because anyone can make a pool for a token.`, data: { pair: p.id } });
      }
    }
    for (const [id, old] of before) {
      const cur = next.pairs.find((x) => x.id === id);
      if (cur && (old.tvlUsd || 0) >= 5000 && cur.tvlUsd < old.tvlUsd * 0.5) {
        events.push({ type: 'liquidity_drop', severity: 'high', text: `Liquidity in ${old.label} (${old.dex}, ${CHAIN_NAMES[old.chain] || old.chain}) fell ${Math.round((1 - cur.tvlUsd / old.tvlUsd) * 100)}% to about ${usd(cur.tvlUsd)}.`, data: { pair: id } });
      }
    }
    return events;
  }

  const day = [...history].reverse().find((h) => now - new Date(h.at).getTime() >= 20 * 3600000);
  const ref = day || prev;
  if (!ref) return events;
  const since = day ? 'since yesterday' : 'since the last check';

  if (ref.tvlUsd >= 2000 && next.tvlUsd != null) {
    const c = pct(next.tvlUsd, ref.tvlUsd);
    if (c <= -0.30) events.push({ type: 'liquidity_drop', severity: 'high', text: `Liquidity in ${name} fell ${Math.round(-c * 100)}% ${since}, to about ${usd(next.tvlUsd)}.` });
    else if (c >= 0.25) events.push({ type: 'liquidity_up', severity: 'info', text: `Liquidity in ${name} grew ${Math.round(c * 100)}% ${since}, to about ${usd(next.tvlUsd)}.` });
  }
  if (ref.volume24h != null && next.volume24h >= 5000 && next.volume24h >= ref.volume24h * 2) {
    events.push({ type: 'volume_spike', severity: 'info', text: `Trading volume in ${name} is more than double ${since}: about ${usd(next.volume24h)} in 24 hours.` });
  }
  if (ref.apy != null && next.apy != null && Math.abs(next.apy - ref.apy) >= 1 && Math.abs(pct(next.apy, ref.apy) ?? 0) >= 0.25) {
    const up = next.apy > ref.apy;
    events.push({ type: 'apy_change', severity: up ? 'info' : 'medium', text: `The yield (APY) in ${name} ${up ? 'rose' : 'fell'} from about ${ref.apy.toFixed(1)}% to ${next.apy.toFixed(1)}% ${since}. Rates change and can go down.` });
  }
  return events;
}

/* ------------------------------------------------------------------ */
/* Making what is known available to replies                           */
/* ------------------------------------------------------------------ */

/** Turns watched pools into searchable facts, so "what is the liquidity in our pool?" can be answered with a date. */
export function poolChunks(items) {
  const out = [];
  for (const p of items) {
    const s = p.snapshot;
    if (!s) continue;
    const base = { live: true, at: s.at, sourceId: p.id, search: 'pool pools liquidity tvl volume trading apy apr yield' };
    const where = (x) => `${x.label} on ${x.dex || 'a DEX'} (${CHAIN_NAMES[x.chain] || x.chain || ''})`.replace(/ \(\)$/, '');
    if (s.kind === 'pair') {
      out.push({ ...base, title: s.label, url: s.url || '', text: `${where(s)}: liquidity is about ${usd(s.tvlUsd)} and 24 hour trading volume about ${usd(s.volume24h)}, as of ${stamp(s.at)}. Source: DEX Screener.` });
    } else if (s.kind === 'token') {
      const top = s.pairs.slice(0, 3).map((x) => `${x.label} on ${x.dex} (${usd(x.tvlUsd)})`).join(', ');
      out.push({ ...base, title: s.label, url: s.url || '', text: `${s.symbol || 'The token'} has ${s.pairs.length} ${s.pairs.length === 1 ? 'pool' : 'pools'} with about ${usd(s.tvlUsd)} liquidity in total. The largest: ${top}, as of ${stamp(s.at)}. Source: DEX Screener.` });
      for (const x of s.pairs.slice(0, 5)) out.push({ ...base, title: x.label, url: x.url || s.url || '', text: `${where(x)}: liquidity is about ${usd(x.tvlUsd)} and 24 hour trading volume about ${usd(x.volume24h)}, as of ${stamp(s.at)}. Source: DEX Screener.` });
    } else if (s.kind === 'llama-pool') {
      out.push({ ...base, title: s.label, url: s.url, text: `${s.label}: APY (yield, APR) is about ${s.apy == null ? 'n/a' : `${s.apy.toFixed(2)}%`}${s.apyBase != null ? ` (base ${s.apyBase.toFixed(2)}%${s.apyReward != null ? `, rewards ${s.apyReward.toFixed(2)}%` : ''})` : ''} with ${usd(s.tvlUsd)} TVL, as of ${stamp(s.at)}. Source: DefiLlama. Rates change and can go down.` });
    }
  }
  return out;
}
