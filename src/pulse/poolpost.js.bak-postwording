// pool-post: ready-to-edit announcements for a watched pool. Built in (no AI, no cost), five versions to cycle through.
// Only numbers Pulse really has are used. Yield (APY) appears only when a source provided one.
// The wording is factual on purpose: no urgency, no promises, no price talk, so it passes Sentinel's own post checks.
import { CHAIN_NAMES } from './pools.js';

const usd = (n) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${Math.round(n)}`);
const clean = (s, n = 80) => String(s ?? '').replace(/[\[\]\n\r]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const DAY = 20 * 3600000;

const SAFETY = [
  'Always DYOR (do your own research) before you take part.',
  'Always DYOR, and never share your seed phrase, private keys or password with anyone, including admins.',
  'Keep your wallet safe: only use official links, and never share your seed phrase.',
  'Please DYOR. Admins will never DM you first or ask for your seed phrase.'
];

/** What is really known about the pool right now. */
export function poolFacts(item, now = Date.now()) {
  const s = item.snapshot || {};
  const hist = item.history || [];
  const day = [...hist].reverse().find((h) => now - new Date(h.at).getTime() >= DAY);
  const ref = day || (hist.length > 1 ? hist[hist.length - 2] : null);
  const chainId = s.chain || item.chain || '';
  return {
    kind: item.kind,
    label: clean(item.label || s.label || (item.kind === 'pair' ? `${chainId} pool ${item.address}` : 'This pool'), 60),
    dex: clean(s.dex, 24),
    chain: CHAIN_NAMES[chainId] || clean(chainId, 24),
    tvl: s.tvlUsd ?? null,
    volume: item.kind === 'llama-pool' ? null : (s.volume24h ?? null),
    apy: s.apy ?? null,
    pairCount: s.pairs?.length ?? null,
    change: ref?.tvlUsd && s.tvlUsd != null ? (s.tvlUsd - ref.tvlUsd) / ref.tvlUsd : null,
    since: day ? 'since yesterday' : 'since the last check',
    url: /^https:\/\//.test(s.url || item.url || '') ? (s.url || item.url) : '',
    date: s.at ? String(s.at).slice(0, 10) : ''
  };
}

function build(f, brief) {
  const name = f.label;
  const on = f.dex && f.dex.toLowerCase() !== f.chain.toLowerCase() ? `${f.dex}, ${f.chain}` : (f.chain || f.dex);
  const at = on ? ` (${on})` : '';
  const chg = f.change != null && Math.abs(f.change) >= 0.05 ? `${f.change > 0 ? 'up' : 'down'} about ${Math.round(Math.abs(f.change) * 100)}% ${f.since}` : '';
  const liq = f.tvl == null ? '' : f.kind === 'token'
    ? `${f.pairCount ?? 'Several'} pools hold about ${usd(f.tvl)} in liquidity in total${chg ? `, ${chg}` : ''}`
    : `Liquidity is about ${usd(f.tvl)}${chg ? `, ${chg}` : ''}`;
  const vol = f.volume != null ? `Trading volume over the last 24 hours is about ${usd(f.volume)}.` : '';
  const apy = f.apy != null ? `The yield (APY) is about ${f.apy.toFixed(1)}%, as of ${f.date || 'the last check'}. Rates change and can go down.` : '';
  const asOf = f.date ? ` (as of ${f.date})` : '';
  const link = f.url;
  const hello = clean(brief?.projectName, 40) ? `Hello ${clean(brief.projectName, 40)} community!` : 'Hello community!';
  const j = (...parts) => parts.filter(Boolean).join(' ');
  const dot = (s) => (s ? `${s}.` : '');
  return [
    j(`Pool update: ${name}${at}.`, dot(liq), vol, link ? `Details: ${link}` : ''),
    j(`${hello} A quick look at ${f.kind === 'token' ? name : `the ${name} pool`}${at}.`, dot(liq ? `${liq}${asOf}` : ''), apy, link ? `Have a look: ${link}` : ''),
    j(`${name}${at}:`, liq ? `${liq.replace(/^Liquidity is about /, '~').replace(/ in liquidity in total/, ' total')}.` : '', link),
    j(`Are you providing liquidity or trading in ${name}${at}?`, dot(liq), vol, 'Tell us how it is going in the replies!', link),
    apy ? j(`Yield check: ${name}${at}.`, apy, dot(liq), link) : j(`By the numbers: ${name}${at}.`, dot(liq), vol, link)
  ].map((t) => t.replace(/\s+/g, ' ').trim());
}

/** Version n (wraps around) of the announcement, with its safety line and the link it may use. */
export function poolPostDraft(item, brief = {}, n = 0, now = Date.now()) {
  const f = poolFacts(item, now);
  const all = [...new Set(build(f, brief))];
  const total = all.length;
  const i = ((Math.trunc(n) % total) + total) % total;
  const text = `${all[i]}\n\n${SAFETY[i % SAFETY.length]}`;
  return { text, n: i, total, sources: f.url ? [f.url] : [] };
}
