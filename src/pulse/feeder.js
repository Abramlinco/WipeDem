import { config } from '../config.js';
import {
  upsertTrends, listCustomSources, listFocusSettings, setSourceStatus, finishRefresh, pruneDiscussions, dueKnowledge, saveKnowledgeResult, saveKnowledgeError,
  duePools, savePoolResult, xUsage, addXReads, getXLastRun, setXLastRun
} from '../db.js';
import { readPool, diffPool } from './pools.js';
import { COST } from './x.js';
import { readSource } from './knowledge.js';
import { focusQueries } from './focus.js';
import { DEFAULT_SOURCES, DEFAULT_X, customToSource, fetchSource } from './sources.js';

// The "oracle". On a timer it reads every source, keeps what is new, and
// stores it. One broken feed never stops the others.

let running = null;
let lastStart = 0;

export function allSources() {
  const custom = listCustomSources().map((s) => customToSource(s, s.ownerKey)).filter(Boolean);
  const focus = listFocusSettings().flatMap(({ ownerKey, focus }) => focusQueries(focus).map((q) => ({
    id: `${ownerKey}|focus:${q.id}`, type: 'rss', space: 'web3', label: `News: ${q.label}`, weight: 1.2, ownerKey,
    url: `https://news.google.com/rss/search?q=${encodeURIComponent(q.query)}&hl=en-US&gl=US&ceid=US:en`
  })));
  // X searches for each topic a community switched on (at most three each, to keep the cost down).
  const xFocus = listFocusSettings().flatMap(({ ownerKey, focus }) => focusQueries(focus).slice(0, 3).map((q) => ({
    id: `${ownerKey}|xfocus:${q.id}`, type: 'x', space: 'social', label: `X: ${q.label}`, weight: 1.2, ownerKey,
    query: `"${q.query.replace(/"/g, '')}" -is:retweet -is:reply lang:en`
  })));
  const x = config.xDefaultFeeds ? DEFAULT_X : [];
  const seen = new Set();
  return [...DEFAULT_SOURCES, ...x, ...custom, ...focus, ...xFocus].filter((s) => (seen.has(s.id) ? false : seen.add(s.id)));
}

// What reading X is allowed to spend. Every post that comes back is a paid read.
// reserve() takes the budget at once, with no waiting, so searches that start together can not overspend.
// settle() gives back whatever the call did not use (a failed call uses nothing).
export const xGuard = {
  reserve(n) {
    if ((xUsage().reads + n) * COST.read > config.xMonthlyBudgetUsd) return false;
    xUsage().reads += n;
    return true;
  },
  settle: (reserved, actual) => addXReads(actual - reserved)
};
export function xStatus() {
  const u = xUsage();
  return { readingOn: !!config.xBearerToken && config.xMonthlyBudgetUsd > 0, month: u.month, reads: u.reads, spendUsd: Math.round(u.reads * COST.read * 100) / 100,
    limitUsd: config.xMonthlyBudgetUsd, everyHours: config.xRefreshHours, lastRun: getXLastRun(), defaultFeeds: config.xDefaultFeeds };
}
const xDue = () => {
  if (!config.xBearerToken || config.xMonthlyBudgetUsd <= 0) return false;
  const last = getXLastRun();
  return !last || Date.now() - new Date(last).getTime() >= config.xRefreshHours * 3600000;
};

/**
 * Reads the feeds. X is read only when it is due (every X_REFRESH_HOURS) or when asked for with
 * { x: true }, so the regular half hourly read never spends X credits. { only: 'x' } reads only X.
 */
export async function refreshTrends({ x = false, only = '' } = {}) {
  if (running) return running;           // a refresh is already under way, share its result
  running = (async () => {
    if (only !== 'x') lastStart = Date.now();
    const readX = only === 'x' || x || xDue();
    const sources = allSources().filter((s) => (s.type === 'x' ? readX && config.xBearerToken && config.xMonthlyBudgetUsd > 0 : only !== 'x'));
    let added = 0, failed = 0;
    const readOne = async (src) => {
      try {
        const items = await fetchSource(src, { xBearer: config.xBearerToken, xGuard });
        added += await upsertTrends(items);
        await setSourceStatus(src.id, { ok: true, count: items.length });
      } catch (e) {
        failed++;
        await setSourceStatus(src.id, { ok: false, error: String(e.message || e).slice(0, 120) });
      }
    };
    // The free feeds are read a few at a time, so a slow one does not hold up the rest.
    const queue = sources.filter((s) => s.type !== 'x');
    await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) await readOne(queue.shift()); }));
    // X is read one search at a time. Each call costs money, so each one finishes (and settles its cost) before the next starts.
    for (const src of sources.filter((s) => s.type === 'x')) await readOne(src);
    if (readX && sources.some((s) => s.type === 'x')) await setXLastRun();
    if (only !== 'x') { await finishRefresh(); await pruneDiscussions(config.pulseRetentionDays); }
    return { sources: sources.length, added, failed };
  })().finally(() => { running = null; });
  return running;
}

let lastXManual = 0;
/** For the "Read X now" button: at most once every ten minutes, because it spends X credits. */
export const secondsUntilXAllowed = () => Math.max(0, Math.ceil((lastXManual + 600000 - Date.now()) / 1000));
export const markXManual = () => { lastXManual = Date.now(); };

/** For the manual Refresh button: at most once every two minutes. */
export const secondsUntilRefreshAllowed = () => Math.max(0, Math.ceil((lastStart + 120000 - Date.now()) / 1000));

export function startFeeder() {
  if (!config.pulseEnabled) { console.log('[pulse] Trend feeder is switched off (PULSE_ENABLED=false).'); return; }
  const run = () => refreshTrends()
    .then((r) => console.log(`[pulse] feeds read: ${r.added} new stories, ${r.failed} of ${r.sources} sources failed`))
    .catch((e) => console.error('[pulse]', e.message));
  setTimeout(run, 30000);
  setInterval(run, config.pulseRefreshMinutes * 60000).unref?.();
  // Documents, pages and live data refresh on their own schedule, checked every 15 minutes.
  const know = () => refreshKnowledgeDue().then((n) => n && console.log(`[pulse] knowledge refreshed: ${n} source${n === 1 ? '' : 's'}`)).catch((e) => console.error('[pulse] knowledge', e.message));
  setTimeout(know, 45000);
  setInterval(know, 15 * 60000).unref?.();
  // Watched pools are checked on their own schedule (POOL_REFRESH_MINUTES), looked at every five minutes.
  const pools = () => refreshPoolsDue().then((n) => n && console.log(`[pulse] pools checked: ${n}`)).catch((e) => console.error('[pulse] pools', e.message));
  setTimeout(pools, 60000);
  setInterval(pools, 5 * 60000).unref?.();
}

/* ------------------------------------------------------------------ */
/* Knowledge bank refresh                                              */
/* ------------------------------------------------------------------ */

const reading = new Set();

/** Reads one knowledge source and stores the result. Never throws. */
export async function refreshKnowledgeSource(source, { fetcher } = {}) {
  if (reading.has(source.id)) return { ok: false, error: 'Already being read' };
  reading.add(source.id);
  try {
    const result = await readSource(source, fetcher ? { fetcher } : {});
    await saveKnowledgeResult(source.id, result);
    return { ok: true, chunks: result.chunks.length };
  } catch (e) {
    await saveKnowledgeError(source.id, e.message || 'Could not read it');
    return { ok: false, error: String(e.message || e).slice(0, 200) };
  } finally { reading.delete(source.id); }
}

export async function refreshKnowledgeDue() {
  let done = 0;
  for (const s of dueKnowledge()) { await refreshKnowledgeSource(s); done++; }
  return done;
}

/* ------------------------------------------------------------------ */
/* Pool Watch refresh                                                  */
/* ------------------------------------------------------------------ */

const checking = new Set();

/** Reads one watched pool, works out what changed, and stores both. Never throws. */
export async function refreshPoolItem(item, { fetcher } = {}) {
  if (checking.has(item.id)) return { ok: false, error: 'Already being checked' };
  checking.add(item.id);
  try {
    const snapshot = await readPool(item, fetcher ? { fetcher } : {});
    const events = diffPool(item, item.snapshot, snapshot, item.history);
    const fresh = await savePoolResult(item.id, { snapshot, events });
    return { ok: true, events: fresh.length };
  } catch (e) {
    await savePoolResult(item.id, { error: e.message || 'Could not read it' });
    return { ok: false, error: String(e.message || e).slice(0, 200) };
  } finally { checking.delete(item.id); }
}

export async function refreshPoolsDue() {
  // fix-3: report what really happened. Only pools that were read successfully count as "checked";
  // failures are printed with the reason instead of being hidden behind a success count.
  let done = 0; const failed = [];
  for (const p of duePools(Date.now(), config.poolRefreshMinutes)) {
    const r = await refreshPoolItem(p);
    if (r.ok) done++; else if (r.error !== 'Already being checked') failed.push(`${p.label || `${p.chain || ''}:${p.address || ''}`} - ${r.error}`);
    await new Promise((resolve) => setTimeout(resolve, 400)); // gentle with the data service
  }
  if (failed.length) console.error(`[pulse] ${failed.length} pool(s) could not be read:\n  ${failed.join('\n  ')}`);
  return done;
}
