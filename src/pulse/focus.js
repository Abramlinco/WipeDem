const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const PRESETS = [
  { id: 'liquid-staking', label: 'Liquid staking', query: 'liquid staking', keywords: ['liquid staking', 'lst', 'lsd', 'restaking', 'staking', 'validator'] },
  { id: 'pools', label: 'Pools and liquidity', query: 'liquidity pools DeFi', keywords: ['liquidity pool', 'liquidity', 'pools', 'amm', 'lp'] },
  { id: 'dex', label: 'DEX and swaps', query: 'DEX decentralized exchange', keywords: ['dex', 'swap', 'swaps', 'decentralized exchange', 'uniswap'] },
  { id: 'gas', label: 'Gas and fees', query: 'crypto gas fees', keywords: ['gas fee', 'gas fees', 'gas', 'gwei', 'fees'] },
  { id: 'yields', label: 'APR, APY and yield', query: 'DeFi yields APY', keywords: ['apr', 'apy', 'yield', 'yields', 'farming'] },
  { id: 'airdrops', label: 'Airdrops', query: 'crypto airdrop', keywords: ['airdrop', 'airdrops', 'points program'] },
  { id: 'governance', label: 'Governance and DAOs', query: 'DAO governance crypto', keywords: ['governance', 'dao', 'proposal', 'voting'] },
  { id: 'l2', label: 'Layer 2 and rollups', query: 'layer 2 rollups', keywords: ['layer 2', 'l2', 'rollup', 'rollups', 'arbitrum', 'optimism', 'base'] },
  { id: 'security', label: 'Security and hacks', query: 'crypto hack exploit', keywords: ['hack', 'exploit', 'phishing', 'audit', 'vulnerability'] },
  { id: 'ai', label: 'AI and crypto', query: 'AI agents crypto', keywords: ['ai', 'agent', 'agents'] },
  { id: 'memecoins', label: 'Memecoins', query: 'memecoin', keywords: ['memecoin', 'memecoins', 'meme coin'] }
];
export function focusKeywords(focus) {
  if (!focus) return [];
  const out = [];
  for (const id of focus.topics || []) out.push(...(PRESETS.find((p) => p.id === id)?.keywords || []));
  for (const c of focus.custom || []) out.push(String(c).toLowerCase());
  return [...new Set(out)];
}
export function applyFocus(items, keywords) {
  if (!keywords.length) return items;
  const re = new RegExp(`\\b(?:${keywords.map(esc).join('|')})\\b`, 'i');
  return items.filter((t) => t.ownerKey || re.test(`${t.title} ${t.summary || ''}`));
}
export function focusQueries(focus) {
  const out = [];
  for (const id of focus.topics || []) {
    const p = PRESETS.find((x) => x.id === id);
    if (p) out.push({ id: p.id, label: p.label, query: p.query });
  }
  for (const c of (focus.custom || []).slice(0, 5)) out.push({ id: `c-${c}`, label: c, query: c });
  return out;
}
