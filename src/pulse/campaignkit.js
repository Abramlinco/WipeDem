// campaign-ux: small pure helpers for the Campaign Planner.

/**
 * What an ask does. A chosen picked idea is always developed. Otherwise the manager can say "ideas" (start over,
 * three new ideas from the chosen source) or "chat" (refine the plan). With no choice, the old rule applies:
 * once a plan or reply exists, asks are follow-ups; before that they are ideas.
 */
export function pickMode({ idea, intent = '', stored = [] } = {}) {
  if (idea) return 'develop';
  const hasPlan = (stored || []).some((m) => m && m.role === 'assistant' && (m.kind === 'plan' || m.kind === 'chat'));
  if (intent === 'ideas') return 'ideas';
  return hasPlan ? 'chat' : 'ideas'; // "chat" with nothing to refine also becomes ideas
}

/** How many stored items a brainstormer has to work with, and when the newest was read. */
export function sourceStat(items) {
  let newest = '';
  let best = 0;
  for (const t of items || []) {
    const iso = t?.fetchedAt || t?.publishedAt || '';
    const ms = Date.parse(iso) || 0;
    if (ms > best) { best = ms; newest = iso; }
  }
  return { count: (items || []).length, newest };
}
