// Creator panel rules. Pure functions over a plain data object, so they can be tested without the server or database.
import { FEATURES, PLAN_IDS, featureIds } from './features.js';

const STAGES = ['off', 'creator', 'live'];
const USE_WINDOW_MS = 10 * 60 * 1000; // one "visit" = activity at least 10 minutes after the last one

export function defaultCreatorState() {
  const features = {};
  for (const f of FEATURES) features[f.id] = { stage: f.stage };
  const plans = {};
  for (const p of PLAN_IDS) plans[p] = { features: Object.fromEntries(featureIds().map((id) => [id, true])) };
  return { accounts: {}, index: { discord: {}, telegram: {} }, plans, features, releases: [], audit: [] };
}

// Adds anything missing (a plan, or a feature registered since the last start) without touching what the creator already set.
export function ensureState(data) {
  const base = defaultCreatorState();
  const c = (data.creator ||= base);
  c.accounts ||= {}; c.index ||= { discord: {}, telegram: {} };
  c.index.discord ||= {}; c.index.telegram ||= {};
  c.releases ||= []; c.audit ||= [];
  c.plans ||= {}; c.features ||= {};
  for (const p of PLAN_IDS) {
    c.plans[p] ||= { features: {} };
    c.plans[p].features ||= {};
    for (const id of featureIds()) if (typeof c.plans[p].features[id] !== 'boolean') c.plans[p].features[id] = true;
  }
  for (const f of FEATURES) c.features[f.id] ||= { stage: f.stage };
  return c;
}

/* ---------------- who signed in ---------------- */

const accountKeyOf = (discordId, telegramId) => (discordId ? `discord:${discordId}` : `telegram:${telegramId}`);

function merge(c, keep, drop) {
  keep.logins += drop.logins;
  keep.firstSeen = keep.firstSeen < drop.firstSeen ? keep.firstSeen : drop.firstSeen;
  keep.email ||= drop.email;
  keep.note = [keep.note, drop.note].filter(Boolean).join(' | ');
  if (drop.suspended) keep.suspended = true;
  for (const [id, u] of Object.entries(drop.usage || {})) {
    const k = (keep.usage[id] ||= { count: 0, last: null });
    k.count += u.count; k.last = [k.last, u.last].filter(Boolean).sort().pop() || null;
  }
  delete c.accounts[drop.key];
}

// Called on every sign in. Creates the account the first time, joins Discord and Telegram logins of one person.
export function recordLogin(data, session, now = new Date()) {
  const c = ensureState(data);
  const dUser = session?.discord?.user, tUser = session?.telegram?.user;
  const discordId = dUser?.id ? String(dUser.id) : null, telegramId = tUser?.id ? String(tUser.id) : null;
  if (!discordId && !telegramId) return null;
  const at = now.toISOString();
  const byD = discordId && c.accounts[c.index.discord[discordId]];
  const byT = telegramId && c.accounts[c.index.telegram[telegramId]];
  let acc = byD || byT;
  if (!acc) {
    acc = { key: accountKeyOf(discordId, telegramId), discordId: null, telegramId: null, name: '', email: null, firstSeen: at, lastLogin: at, logins: 0, plan: 'free', suspended: false, paidUntil: null, note: '', usage: {} };
    c.accounts[acc.key] = acc;
  } else if (byD && byT && byD !== byT) {
    merge(c, byD, byT); acc = byD;
  }
  if (discordId) { acc.discordId = discordId; c.index.discord[discordId] = acc.key; }
  if (telegramId) { acc.telegramId = telegramId; c.index.telegram[telegramId] = acc.key; }
  const name = dUser?.username || (tUser?.username ? `@${tUser.username}` : tUser?.firstName) || acc.name;
  acc.name = String(name || '').slice(0, 80);
  if (dUser?.email) acc.email = String(dUser.email).slice(0, 200);
  acc.lastLogin = at; acc.logins += 1;
  return acc;
}

export function accountFor(data, session) {
  const c = ensureState(data);
  const d = session?.discord?.user?.id, t = session?.telegram?.user?.id;
  return c.accounts[(d && c.index.discord[String(d)]) || (t && c.index.telegram[String(t)])] || null;
}

/* ---------------- plans and access ---------------- */

export function effectivePlan(acc, now = new Date()) {
  if (!acc) return 'free';
  if (acc.plan !== 'free' && acc.paidUntil && new Date(acc.paidUntil + 'T23:59:59Z') < now) return 'free';
  return PLAN_IDS.includes(acc.plan) ? acc.plan : 'free';
}

// May this person use this feature right now? Creators are never blocked, so they can test every stage.
export function decide(data, { acc, isCreator, featureId, now = new Date() }) {
  if (isCreator) return { allow: true }; // creator-fixes
  if (acc?.suspended) return { allow: false, code: 'suspended', message: 'This account is paused. Contact the Sentinel team.' };
  if (!featureId) return { allow: true };
  const c = ensureState(data);
  const f = c.features[featureId];
  if (!f) return { allow: true };
  if (acc?.suspended) return { allow: false, code: 'suspended', message: 'This account is paused. Contact the Sentinel team.' };
  if (f.stage === 'off') return { allow: false, code: 'off', message: 'This feature is switched off for now.' };
  if (f.stage === 'creator') return { allow: false, code: 'not_released', message: 'This feature is not released yet. It is coming soon.' };
  const plan = effectivePlan(acc, now);
  if (c.plans[plan]?.features?.[featureId] === false) return { allow: false, code: 'plan', message: `This feature is not included in the ${plan[0].toUpperCase() + plan.slice(1)} plan.` };
  return { allow: true };
}

export function lockedFor(data, { acc, isCreator, now = new Date() }) {
  if (isCreator) return [];
  return featureIds().filter((id) => !decide(data, { acc, isCreator, featureId: id, now }).allow);
}

// Counts a visit, at most once every 10 minutes per person and feature. Returns true when something changed.
export function recordUse(data, acc, featureId, now = new Date()) {
  if (!acc || !featureId) return false;
  const u = (acc.usage ||= {})[featureId] ||= { count: 0, last: null };
  if (u.last && now - new Date(u.last) < USE_WINDOW_MS) { u.last = now.toISOString(); return false; }
  u.count += 1; u.last = now.toISOString();
  return true;
}

/* ---------------- changes made by the creator ---------------- */

export function audit(data, who, action, detail = '', now = new Date()) {
  const c = ensureState(data);
  c.audit.unshift({ at: now.toISOString(), who: String(who || '').slice(0, 60), action, detail: String(detail).slice(0, 300) });
  c.audit.length = Math.min(c.audit.length, 500);
}

export function updateAccount(data, key, patch) {
  const c = ensureState(data);
  const acc = c.accounts[key];
  if (!acc) return { error: 'Account not found.', status: 404 };
  const done = [];
  if (patch.plan !== undefined) {
    if (!PLAN_IDS.includes(patch.plan)) return { error: 'Unknown plan.', status: 400 };
    if (acc.plan !== patch.plan) done.push(`plan ${acc.plan} → ${patch.plan}`);
    acc.plan = patch.plan;
  }
  if (patch.suspended !== undefined) {
    const v = patch.suspended === true;
    if (acc.suspended !== v) done.push(v ? 'paused' : 'resumed');
    acc.suspended = v;
  }
  if (patch.paidUntil !== undefined) {
    const v = patch.paidUntil === null || patch.paidUntil === '' ? null : String(patch.paidUntil);
    if (v !== null && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return { error: 'Use a date like 2026-12-31.', status: 400 };
    if (acc.paidUntil !== v) done.push(`paid until ${v || 'no date'}`);
    acc.paidUntil = v;
  }
  if (patch.note !== undefined) { acc.note = String(patch.note).slice(0, 300); done.push('note edited'); }
  return { acc, done };
}

export function setPlanFeature(data, plan, featureId, enabled) {
  const c = ensureState(data);
  if (!PLAN_IDS.includes(plan) || !featureIds().includes(featureId)) return { error: 'Unknown plan or feature.', status: 400 };
  c.plans[plan].features[featureId] = enabled === true;
  return { ok: true };
}

export function setStage(data, featureId, stage) {
  const c = ensureState(data);
  if (!featureIds().includes(featureId) || !STAGES.includes(stage)) return { error: 'Unknown feature or stage.', status: 400 };
  const was = c.features[featureId].stage;
  c.features[featureId].stage = stage;
  return { ok: true, was };
}

export function addRelease(data, { version, title, notes, featureId }, now = new Date()) {
  const c = ensureState(data);
  const t = String(title || '').trim().slice(0, 120);
  if (!t) return { error: 'Give the release a title.', status: 400 };
  const rec = { id: now.getTime().toString(36), at: now.toISOString(), version: String(version || '').slice(0, 30), title: t, notes: String(notes || '').slice(0, 1000), featureId: featureIds().includes(featureId) ? featureId : null };
  c.releases.unshift(rec); c.releases.length = Math.min(c.releases.length, 200);
  return { rec };
}

/* ---------------- numbers for the overview ---------------- */

export function usageSummary(data) {
  const c = ensureState(data);
  const accounts = Object.values(c.accounts);
  return FEATURES.map((f) => {
    const users = accounts.filter((a) => (a.usage?.[f.id]?.count || 0) > 0);
    return { id: f.id, label: f.label, stage: c.features[f.id].stage, used: users.length, unused: accounts.length - users.length, visits: users.reduce((n, a) => n + a.usage[f.id].count, 0) };
  });
}

export function accountView(acc, now = new Date()) {
  const used = Object.keys(acc.usage || {}).filter((id) => acc.usage[id].count > 0);
  return {
    key: acc.key, name: acc.name, email: acc.email, discordId: acc.discordId, telegramId: acc.telegramId,
    firstSeen: acc.firstSeen, lastLogin: acc.lastLogin, logins: acc.logins,
    plan: acc.plan, effectivePlan: effectivePlan(acc, now), suspended: !!acc.suspended, paidUntil: acc.paidUntil, note: acc.note,
    used, unused: featureIds().filter((id) => !used.includes(id)),
    usage: acc.usage
  };
}

/* ---------------- health ---------------- */

const RANK = { ok: 0, info: 0, warn: 1, bad: 2 };
export const worst = (checks) => checks.reduce((w, c) => (RANK[c.status] > RANK[w] ? c.status : w), 'ok');

export function judge({ errorsLastHour, serverErrors15m, lagMs, rssMb, uptimeSec, dbMs, dbError, feederAgeMin, feederEveryMin, sourcesFailing, sourcesTotal }) {
  const checks = [];
  if (dbError) checks.push({ id: 'db', label: 'Database', status: 'bad', detail: `Not responding: ${dbError}` });
  else checks.push({ id: 'db', label: 'Database', status: dbMs > 1500 ? 'bad' : dbMs > 500 ? 'warn' : 'ok', detail: dbMs == null ? 'File storage' : `Answered in ${dbMs} ms` });
  checks.push({ id: 'api', label: 'Dashboard server errors', status: serverErrors15m >= 10 ? 'bad' : serverErrors15m >= 1 ? 'warn' : 'ok', detail: `${serverErrors15m} server error${serverErrors15m === 1 ? '' : 's'} in the last 15 minutes` });
  checks.push({ id: 'errors', label: 'Errors in the log', status: errorsLastHour > 20 ? 'bad' : errorsLastHour > 5 ? 'warn' : 'ok', detail: `${errorsLastHour} in the last hour` });
  checks.push({ id: 'lag', label: 'Server speed', status: lagMs > 500 ? 'bad' : lagMs > 150 ? 'warn' : 'ok', detail: `Event loop delay ${lagMs} ms` });
  checks.push({ id: 'mem', label: 'Memory', status: rssMb > 900 ? 'bad' : rssMb > 450 ? 'warn' : 'ok', detail: `${rssMb} MB in use` });
  checks.push({ id: 'uptime', label: 'Restarts', status: uptimeSec < 300 ? 'warn' : 'ok', detail: uptimeSec < 300 ? 'Restarted in the last 5 minutes. Check the error log for a crash.' : 'Running without a restart' });
  if (feederEveryMin) {
    const stale = feederAgeMin == null ? false : feederAgeMin > feederEveryMin * 3;
    checks.push({ id: 'feeder', label: 'Pulse trend feeder', status: stale ? 'warn' : sourcesTotal && sourcesFailing / sourcesTotal > 0.5 ? 'warn' : 'ok', detail: feederAgeMin == null ? 'Has not run yet' : `Last ran ${feederAgeMin} min ago, ${sourcesFailing} of ${sourcesTotal} sources failing` });
  }
  return checks;
}
