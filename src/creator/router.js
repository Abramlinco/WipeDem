import { Router } from 'express';
import fs from 'node:fs';
import os from 'node:os';
import { config } from '../config.js';
import { db } from '../db.js';
import { requireLogin, sessionTag } from '../auth/sessions.js';
import { discordEnabled } from '../discord/bot.js';
import { telegramEnabled } from '../telegram/bot.js';
import { FEATURES, PLAN_IDS, PLAN_LABELS } from './features.js';
import { ensureState, accountView, usageSummary, updateAccount, setPlanFeature, setStage, addRelease, audit, judge, worst } from './logic.js';
import { creatorAllowed } from './hook.js'; // creator-key-login
import { keyLoginEnabled, keyIsValid, issueCookie, clearCookie, clientIp, locked, fail, succeed } from './keyauth.js'; // creator-key-login
import { snapshot } from './monitor.js';

export const creatorRouter = Router();
const started = new Date().toISOString();
const pkg = (() => { try { return JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')); } catch { return {}; } })();

/* ---------- creator key sign in (open to anyone, but only a correct key does anything) ---------- */ // creator-key-login
creatorRouter.get('/status', (req, res) => res.json({ keyLogin: keyLoginEnabled(), signedIn: creatorAllowed(req) }));
creatorRouter.post('/login', async (req, res) => {
  if (!keyLoginEnabled()) return res.status(404).json({ error: 'Not found' });
  const ip = clientIp(req);
  if (locked(ip)) return res.status(429).json({ error: 'Too many wrong keys. Wait 15 minutes and try again.' });
  if (!keyIsValid(String(req.body?.key ?? ''))) { fail(ip); return res.status(401).json({ error: 'That key is not right.' }); }
  succeed(ip);
  issueCookie(req, res);
  audit(db.data, 'creator key', 'sign in', '');
  await save();
  res.json({ ok: true });
});
creatorRouter.post('/logout', (req, res) => { clearCookie(req, res); res.json({ ok: true }); });

/* ---------- guards: signed in, a creator, and a JSON request when changing anything ---------- */
// To anyone else this panel does not exist: the answer is the same 404 the rest of the site gives for a missing page.
creatorRouter.use((req, res, next) => {
  if (!creatorAllowed(req)) return res.status(404).json({ error: 'Not found' }); // creator-key-login
  next();
});
creatorRouter.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE'].includes(req.method) && !String(req.headers['content-type'] || '').startsWith('application/json')) return res.status(415).json({ error: 'JSON required' });
  next();
});

const who = (req) => !req.session ? 'creator key' : `${sessionTag(req.session)} ${req.session.discord?.user?.username || req.session.telegram?.user?.username || ''}`.trim();
const save = () => db.write();
const day = (iso) => (iso || '').slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
const scrub = (s) => String(s || '').replace(/[A-Za-z0-9_\-.]{32,}/g, '[hidden]').slice(0, 120);

/* ---------- communities, worked out from what the bots already record ---------- */
function communityRows() {
  const today = new Date().toISOString().slice(0, 10), since = day(daysAgo(7));
  const openByKey = {}; // creator-fixes: count open alerts once, not once per community
  for (const a of db.data.alerts) if (!a.resolved) { const k = `${a.platform}:${a.guildId}`; openByKey[k] = (openByKey[k] || 0) + 1; }
  return Object.entries(db.data.communities).map(([key, c]) => {
    const stats = Object.entries(db.data.dailyStats[key] || {});
    const counts = Object.entries(db.data.memberCounts[key] || {}).sort(([a], [b]) => (a < b ? -1 : 1));
    return {
      key, platform: c.platform, name: c.name, lastSeen: c.lastSeen,
      members: counts.length ? counts[counts.length - 1][1] : null,
      scanned7d: stats.filter(([d]) => d >= since).reduce((n, [, v]) => n + (v.scanned || 0), 0),
      flagged7d: stats.filter(([d]) => d >= since).reduce((n, [, v]) => n + (v.flagged || 0), 0),
      scannedToday: db.data.dailyStats[key]?.[today]?.scanned || 0,
      openAlerts: openByKey[key] || 0
    };
  });
}

/* ---------- overview ---------- */
creatorRouter.get('/overview', (req, res) => {
  const c = ensureState(db.data);
  const accounts = Object.values(c.accounts);
  const comms = communityRows();
  res.json({
    totals: {
      accounts: accounts.length,
      newToday: accounts.filter((a) => day(a.firstSeen) === day(new Date().toISOString())).length,
      new7d: accounts.filter((a) => a.firstSeen >= daysAgo(7)).length,
      active24h: accounts.filter((a) => a.lastLogin >= daysAgo(1)).length,
      active7d: accounts.filter((a) => a.lastLogin >= daysAgo(7)).length,
      paying: accounts.filter((a) => accountView(a).effectivePlan !== 'free').length,
      paused: accounts.filter((a) => a.suspended).length,
      communities: comms.length,
      discord: comms.filter((x) => x.platform === 'discord').length,
      telegram: comms.filter((x) => x.platform === 'telegram').length,
      members: comms.reduce((n, x) => n + (x.members || 0), 0),
      openAlerts: comms.reduce((n, x) => n + x.openAlerts, 0),
      emailsCollected: accounts.filter((a) => a.email).length
    },
    plans: PLAN_IDS.map((p) => ({ id: p, label: PLAN_LABELS[p], accounts: accounts.filter((a) => accountView(a).effectivePlan === p).length })),
    usage: usageSummary(db.data),
    waiting: FEATURES.filter((f) => c.features[f.id].stage === 'creator').map((f) => ({ id: f.id, label: f.label })),
    recent: accounts.sort((a, b) => (a.firstSeen < b.firstSeen ? 1 : -1)).slice(0, 8).map((a) => ({ key: a.key, name: a.name, firstSeen: a.firstSeen, plan: a.plan })),
    build: { version: pkg.version || '', commit: (process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || '').slice(0, 7), startedAt: started, node: process.version },
    emailEnabled: process.env.CREATOR_COLLECT_EMAIL === 'true'
  });
});

/* ---------- people ---------- */
creatorRouter.get('/accounts', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  let list = Object.values(ensureState(db.data).accounts).map((a) => accountView(a));
  if (q) list = list.filter((a) => [a.name, a.email, a.key, a.note].some((v) => String(v || '').toLowerCase().includes(q)));
  list.sort((a, b) => (a.lastLogin < b.lastLogin ? 1 : -1));
  res.json({ total: list.length, accounts: list.slice(0, 300) });
});

creatorRouter.post('/accounts/:key', async (req, res) => {
  const r = updateAccount(db.data, req.params.key, req.body || {});
  if (r.error) return res.status(r.status).json({ error: r.error });
  if (r.done.length) audit(db.data, who(req), 'account', `${r.acc.name || r.acc.key}: ${r.done.join(', ')}`);
  await save();
  res.json({ ok: true, account: accountView(r.acc) });
});

creatorRouter.get('/communities', (req, res) => res.json({ communities: communityRows().sort((a, b) => (b.members || 0) - (a.members || 0)) }));

/* ---------- plans: the tick boxes ---------- */
creatorRouter.get('/plans', (req, res) => {
  const c = ensureState(db.data);
  res.json({ plans: PLAN_IDS.map((id) => ({ id, label: PLAN_LABELS[id], features: c.plans[id].features })), features: FEATURES.map(({ id, label, blurb }) => ({ id, label, blurb })) });
});
creatorRouter.post('/plans/:plan/:feature', async (req, res) => {
  const r = setPlanFeature(db.data, req.params.plan, req.params.feature, req.body?.enabled);
  if (r.error) return res.status(r.status).json({ error: r.error });
  audit(db.data, who(req), 'plan', `${req.params.plan}: ${req.params.feature} ${req.body?.enabled === true ? 'included' : 'removed'}`);
  await save();
  res.json({ ok: true });
});

/* ---------- releases: what is pushed, and who may use it ---------- */
creatorRouter.get('/releases', (req, res) => {
  const c = ensureState(db.data);
  res.json({
    features: FEATURES.map(({ id, label, blurb }) => ({ id, label, blurb, stage: c.features[id].stage })),
    releases: c.releases,
    build: { version: pkg.version || '', commit: (process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || '').slice(0, 7), startedAt: started }
  });
});
creatorRouter.post('/features/:id/stage', async (req, res) => {
  const r = setStage(db.data, req.params.id, req.body?.stage);
  if (r.error) return res.status(r.status).json({ error: r.error });
  audit(db.data, who(req), 'stage', `${req.params.id}: ${r.was} → ${req.body.stage}`);
  await save();
  res.json({ ok: true });
});
creatorRouter.post('/releases', async (req, res) => {
  const r = addRelease(db.data, req.body || {});
  if (r.error) return res.status(r.status).json({ error: r.error });
  audit(db.data, who(req), 'release note', r.rec.title);
  await save();
  res.json({ ok: true, release: r.rec });
});

/* ---------- health ---------- */
async function pingDb() {
  const pool = db.adapter?.pool;
  if (!pool?.query) return { ms: null };
  const t = Date.now();
  try { await pool.query('select 1'); return { ms: Date.now() - t }; } catch (e) { return { error: scrub(e.message) }; }
}

creatorRouter.get('/health', async (req, res) => {
  const snap = snapshot();
  const dbp = await pingDb();
  const meta = db.data.pulseMeta || {};
  const sources = Object.values(meta.sources || {});
  const feederAgeMin = meta.lastRefresh ? Math.round((Date.now() - new Date(meta.lastRefresh).getTime()) / 60000) : null;
  const checks = judge({
    ...snap, dbMs: dbp.ms, dbError: dbp.error,
    feederAgeMin, feederEveryMin: config.pulseEnabled ? config.pulseRefreshMinutes : 0,
    sourcesFailing: sources.filter((s) => s.ok === false).length, sourcesTotal: sources.length
  });
  const comms = communityRows();
  for (const [p, token, on] of [['telegram', config.telegramToken, telegramEnabled()], ['discord', config.discordToken, discordEnabled()]]) {
    const mine = comms.filter((c) => c.platform === p);
    const label = `${p[0].toUpperCase() + p.slice(1)} bot`;
    if (!token) checks.push({ id: p, label, status: 'info', detail: 'Not set up (no token)' });
    else if (!on) checks.push({ id: p, label, status: 'bad', detail: 'A token is set but the bot is not running. Check the token and the log.' });
    else checks.push({ id: p, label, status: 'ok', detail: `Running. ${mine.length} communit${mine.length === 1 ? 'y' : 'ies'}, ${mine.reduce((n, c) => n + c.scannedToday, 0)} messages read today` });
  }
  checks.push({ id: 'ai', label: 'Reply drafting', status: 'info', detail: config.aiProvider === 'none' ? 'Built-in drafter (no AI key set)' : `Using ${config.aiProvider}` });
  checks.push({ id: 'storage', label: 'Storage', status: 'info', detail: db.adapter?.pool ? 'Postgres' : 'JSON file (data is lost if the host disk is wiped)' });
  res.json({
    status: worst(checks), checks,
    errors: snap.recent,
    numbers: { requests15m: snap.requests15m, serverErrors15m: snap.serverErrors15m, uptimeSec: snap.uptimeSec, rssMb: snap.rssMb, lagMs: snap.lagMs, load: os.loadavg()[0].toFixed(2) }
  });
});

creatorRouter.get('/audit', (req, res) => res.json({ audit: ensureState(db.data).audit.slice(0, 200) }));
