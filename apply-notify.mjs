#!/usr/bin/env node
// Sentinel patch: notifications. A bell, unread badges, a ping, a Home "needs your attention" card, and phone alerts.
//
//   node apply-notify.mjs            apply (run from the Sentinel-Bot folder)
//   node apply-notify.mjs --revert   undo only this patch
//
// What it adds:
//   - a bell on every page with a count of what is new, and a panel listing it
//   - badges on Home and Pulse (sidebar and phone tab bar). They stay until you open the bell, press "Mark all read", or open an item from it.
//     Merely having a page or tab open never clears them.
//   - a ping when something new arrives: toast, short sound, vibration, tab title "(2) Sentinel", optional pop-up
//   - a "Needs your attention" card at the top of Home
//   - "New" markers on the Pulse rows that arrived since your last visit
//   - phone alerts: a private Telegram or Discord message from the bot, so you hear about it with the page closed
//
// Every anchor is checked first; if one is missing, NOTHING is written.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.cwd();
const abs = (f) => path.join(root, f);
const bak = (f) => abs(f) + '.bak-notify';
const die = (m) => { console.error('\n✖ ' + m + '\n  Nothing was changed.'); process.exit(1); };

const blocks = {};
{
  let cur = null;
  for (const raw of fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split(/\r?\n/)) {
    if (!raw.startsWith('//|')) continue;
    const body = raw.slice(3);
    if (body.startsWith('#### ')) { cur = body.slice(5).trim(); blocks[cur] = []; continue; }
    if (cur) blocks[cur].push(body);
  }
  for (const k of Object.keys(blocks)) blocks[k] = blocks[k].join('\n').replace(/\n+$/, '');
}

const PLAN = {
  'dashboard/app.js': [
    { name: 'badges on Home and Pulse (sidebar)', start: blocks.A1_START, replace: blocks.A1_NEW },
    { name: 'badges on the phone tab bar', start: blocks.A2_START, replace: blocks.A2_NEW },
    { name: 'bell after each page draws', start: blocks.A3_START, replace: blocks.A3_NEW },
    { name: 'start notifications after sign in', start: blocks.A4_START, replace: blocks.A4_NEW },
    { name: 'Home loads the summary', start: blocks.A5_START, replace: blocks.A5_NEW },
    { name: 'Home loads the summary (2)', start: blocks.A6_START, replace: blocks.A6_NEW },
    { name: 'Home subtitle mentions Pulse', start: blocks.A7_START, replace: blocks.A7_NEW },
    { name: 'Home attention card', start: blocks.A8_START, replace: blocks.A8_NEW }
  ],
  'dashboard/index.html': [{ name: 'script tag', start: blocks.H1_START, replace: blocks.H1_NEW }],
  'dashboard/style.css': [{ name: 'styles', append: blocks.CSS }],
  'src/api/routes.js': [
    { name: 'import', start: blocks.R1_START, replace: blocks.R1_NEW },
    { name: 'mount', start: blocks.R2_START, replace: blocks.R2_NEW }
  ],
  'src/pulse/capture.js': [
    { name: 'import', start: blocks.C1_START, replace: blocks.C1_NEW },
    { name: 'call', start: blocks.C2_START, replace: blocks.C2_NEW }
  ],
  'src/telegram/bot.js': [{ name: 'private message helper', append: blocks.TG_DM }],
  'src/discord/bot.js': [{ name: 'private message helper', append: blocks.DC_DM }]
};
const NEWFILES = {
  'src/pulse/notify.js': blocks.SERVER_NOTIFY,
  'src/api/notifications.js': blocks.SERVER_API,
  'dashboard/notify.js': blocks.DASH_NOTIFY,
  'dashboard/sw.js': blocks.SW,
  'test/notify.test.js': blocks.TEST
};
const FILES = Object.keys(PLAN);
const MARK = 'notify-patch';

if (!fs.existsSync(abs('package.json')) || !FILES.every((f) => fs.existsSync(abs(f)))) die('Run this from the Sentinel-Bot project folder (the one that contains package.json, src/ and dashboard/).');

if (process.argv.includes('--revert')) {
  let n = 0;
  for (const f of FILES) if (fs.existsSync(bak(f))) { fs.copyFileSync(bak(f), abs(f)); fs.unlinkSync(bak(f)); n++; console.log('restored ' + f); }
  for (const f of Object.keys(NEWFILES)) if (fs.existsSync(abs(f)) && fs.readFileSync(abs(f), 'utf8').includes(MARK)) { fs.unlinkSync(abs(f)); n++; console.log('removed ' + f); }
  console.log(n ? '\n✔ Notifications patch reverted. Restart Sentinel and hard-refresh the dashboard.' : 'No notifications patch found, nothing to revert.');
  process.exit(0);
}

function edit(text, label, op) {
  if (op.append) return text.replace(/\n*$/, '\n') + op.append + '\n';
  if (!op.start) die(`${label}: internal error (missing anchor).`);
  const i = text.indexOf(op.start);
  if (i < 0) die(`${label}: anchor not found. Your file differs from the version this patch was written for.`);
  if (text.indexOf(op.start, i + 1) >= 0) die(`${label}: anchor appears more than once.`);
  let j = i + op.start.length;
  if (op.end) {
    const k = text.indexOf(op.end, j);
    if (k < 0) die(`${label}: end anchor not found.`);
    j = k + op.end.length;
  }
  return text.slice(0, i) + op.replace + text.slice(j);
}

for (const f of Object.keys(NEWFILES)) if (fs.existsSync(abs(f))) die(`${f} already exists. If this patch was applied before, run it with --revert first.`);

const out = {};
for (const f of FILES) {
  const raw = fs.readFileSync(abs(f), 'utf8');
  if (raw.includes(MARK)) die(`${f} already has this patch. Use --revert first to re-apply.`);
  const crlf = raw.includes('\r\n');
  let text = raw.replace(/\r\n/g, '\n');
  PLAN[f].forEach((op, n) => { text = edit(text, `${f} #${n + 1} (${op.name})`, op); });
  out[f] = crlf ? text.replace(/\n/g, '\r\n') : text;
}
const eol = fs.readFileSync(abs('package.json'), 'utf8').includes('\r\n') ? '\r\n' : '\n';
for (const f of FILES) { fs.copyFileSync(abs(f), bak(f)); fs.writeFileSync(abs(f), out[f]); console.log('patched ' + f); }
for (const [f, body] of Object.entries(NEWFILES)) { fs.mkdirSync(path.dirname(abs(f)), { recursive: true }); fs.writeFileSync(abs(f), body.replace(/\n/g, eol) + eol); console.log('added   ' + f); }

console.log('\n✔ Notifications patch applied.');
console.log('  1. Stop Sentinel and start it again (npm start), so the new server code loads.');
console.log('  2. Hard-refresh the dashboard (Ctrl+Shift+R).');
console.log('  3. Click the bell, then Settings, to turn on phone alerts and pop-ups.');
console.log('  Undo with: node apply-notify.mjs --revert');
process.exit(0);

// ---- code blocks (data, not executed) ----

//|#### SERVER_NOTIFY
//|// notify-patch: what is new for a manager, and phone alerts (a private Telegram or Discord message).
//|import { db, communityKey } from '../db.js';
//|import { config } from '../config.js';
//|
//|// Ideas, questions and concerns notify. Praise and general chatter never do.
//|export const NOTIFY_KINDS = ['idea', 'question', 'concern'];
//|export const DEFAULT_KINDS = ['question', 'concern'];
//|
//|const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
//|const trim = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
//|
//|// Still waiting for a person: not handled, not replied to, and (for questions) not answered by staff.
//|export const needsAttention = (d) =>
//|  NOTIFY_KINDS.includes(d.kind) && d.status === 'new' && !d.reply && !(d.kind === 'question' && d.staffReplied);
//|
//|/* ------------------------------------------------------------------ */
//|/* What is new                                                         */
//|/* ------------------------------------------------------------------ */
//|
//|// seen = { pulse, alerts, faqs } ISO times: anything newer than these counts as "new".
//|export function buildSummary({ discussions = [], alerts = [], faqs = [], seen, now = new Date().toISOString() }) {
//|  const weekAgo = new Date(Date.parse(now) - 7 * 86400000).toISOString();
//|  const pulse = discussions.filter(needsAttention);
//|  const of = (kind) => pulse.filter((d) => d.kind === kind).length;
//|  const unseen = {
//|    pulse: pulse.filter((d) => d.createdAt > seen.pulse).length,
//|    alerts: alerts.filter((a) => a.createdAt > seen.alerts).length,
//|    faqs: faqs.filter((f) => f.createdAt > seen.faqs).length
//|  };
//|  unseen.total = unseen.pulse + unseen.alerts + unseen.faqs;
//|
//|  const items = [
//|    ...pulse.map((d) => ({
//|      type: 'pulse', id: d.id, kind: d.kind, platform: d.platform,
//|      title: `${cap(d.kind)} from ${d.username || 'a member'}`, text: trim(d.text, 160),
//|      community: d.communityName || '', channel: d.channelName || '', at: d.createdAt,
//|      unseen: d.createdAt > seen.pulse, href: '#/pulse/ideas'
//|    })),
//|    ...alerts.map((a) => ({
//|      type: 'alert', id: a.id, kind: 'alert', platform: a.platform,
//|      title: `Removed message from ${a.username || 'someone'}`, text: trim(a.text, 160),
//|      community: a.guildName || '', channel: a.channelName || '', at: a.createdAt,
//|      unseen: a.createdAt > seen.alerts, href: `#/${a.platform}`
//|    })),
//|    ...faqs.map((f) => ({
//|      type: 'faq', id: f.id, kind: 'faq', platform: String(f.communityKey || '').split(':')[0],
//|      title: 'Repeated question', text: trim(f.question, 160), community: '', channel: '', at: f.createdAt,
//|      unseen: f.createdAt > seen.faqs, href: '#/faqs'
//|    }))
//|  ].filter((i) => i.at >= weekAgo).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20);
//|
//|  return {
//|    now, unseen, items,
//|    open: { pulse: { total: pulse.length, questions: of('question'), concerns: of('concern'), ideas: of('idea') }, alerts: alerts.length, faqs: faqs.length }
//|  };
//|}
//|
//|/* ------------------------------------------------------------------ */
//|/* Phone alerts: a private message from the bot                         */
//|/* ------------------------------------------------------------------ */
//|
//|const subs = () => (db.data.notifySubs ||= {});
//|const subId = (channel, userId) => `${channel}:${userId}`;
//|const cleanKinds = (k) => (Array.isArray(k) ? [...new Set(k.filter((x) => NOTIFY_KINDS.includes(x)))] : null);
//|
//|export const getSub = (channel, userId) => subs()[subId(channel, userId)] || null;
//|
//|// ids = the person's Telegram and Discord IDs, keys = the communities they manage. Both are re-checked live before every message.
//|export async function saveSub(channel, userId, { on, kinds, ids, keys }) {
//|  const id = subId(channel, userId);
//|  const prev = subs()[id] || {};
//|  subs()[id] = {
//|    channel, userId: String(userId),
//|    on: on === undefined ? !!prev.on : !!on,
//|    kinds: cleanKinds(kinds) ?? prev.kinds ?? [...DEFAULT_KINDS],
//|    ids: ids ?? prev.ids ?? {},
//|    keys: keys ?? prev.keys ?? [],
//|    updatedAt: new Date().toISOString()
//|  };
//|  await db.write();
//|  return subs()[id];
//|}
//|
//|// Keeps the saved list of communities current while the person uses the dashboard.
//|export async function syncSubAccess(channel, userId, ids, keys) {
//|  const sub = getSub(channel, userId);
//|  if (!sub) return;
//|  if (JSON.stringify(sub.keys) === JSON.stringify(keys) && JSON.stringify(sub.ids) === JSON.stringify(ids)) return;
//|  sub.keys = keys; sub.ids = ids;
//|  await db.write();
//|}
//|
//|async function defaultSender(channel, userId, text) {
//|  if (channel === 'telegram') return (await import('../telegram/bot.js')).sendTelegramDm(userId, text);
//|  if (channel === 'discord') return (await import('../discord/bot.js')).sendDiscordDm(userId, text);
//|  throw new Error('Unknown channel');
//|}
//|
//|// Does this person still manage this community right now? A removed admin stops getting messages.
//|async function defaultChecker(sub, key) {
//|  const i = key.indexOf(':');
//|  const platform = key.slice(0, i), id = key.slice(i + 1);
//|  if (platform === 'telegram') {
//|    const tid = sub.ids?.telegram;
//|    if (!tid) return false;
//|    const chats = await (await import('../telegram/bot.js')).telegramAdminChats(Number(tid));
//|    return chats.some((c) => String(c.id) === id);
//|  }
//|  if (platform === 'discord') {
//|    const did = sub.ids?.discord;
//|    return !!did && (await import('../discord/bot.js')).discordUserStillManages(id, did);
//|  }
//|  return false;
//|}
//|
//|let sender = defaultSender;
//|let checker = defaultChecker;
//|export const setDmSender = (fn) => { sender = fn || defaultSender; };
//|export const setManageChecker = (fn) => { checker = fn || defaultChecker; };
//|
//|export function composeText(items) {
//|  const one = items.length === 1;
//|  const head = one ? `🔔 New ${items[0].kind} in ${items[0].communityName || 'your community'}` : `🔔 ${items.length} new messages in Pulse`;
//|  const lines = items.slice(0, 3).map((r) => `${r.username || 'A member'}: ${trim(r.text, 180)}`);
//|  if (items.length > 3) lines.push(`…and ${items.length - 3} more`);
//|  const link = /^https:/i.test(config.publicUrl || '') ? `\n\nOpen Sentinel: ${config.publicUrl}/#/pulse/ideas` : '';
//|  return `${head}\n\n${lines.join('\n')}${link}`;
//|}
//|
//|export function friendlyError(channel, e) {
//|  const m = String(e?.message || e);
//|  if (/not running/i.test(m)) return m;
//|  if (channel === 'telegram' && /403|blocked|initiate|not started|chat not found/i.test(m)) return 'Telegram will not let Sentinel message you yet. Open the Sentinel bot in Telegram, press Start, then try again.';
//|  if (channel === 'discord' && (String(e?.code) === '50007' || /cannot send messages to this user/i.test(m))) return 'Discord blocked the message. In your Discord privacy settings, allow direct messages from server members, then try again.';
//|  return 'The message could not be sent. Check that the bot is running, then try again.';
//|}
//|
//|export async function testDm(channel, userId) {
//|  try {
//|    await sender(channel, userId, '🔔 Sentinel test: phone alerts are working. You will get a message like this when a new question or concern arrives.');
//|    return { ok: true };
//|  } catch (e) {
//|    return { ok: false, error: friendlyError(channel, e) };
//|  }
//|}
//|
//|// One message at most every 30 seconds per person. Anything arriving in between is combined into the next one.
//|const COOLDOWN = 30000;
//|const queues = new Map(); // subId -> { last, items, timer }
//|
//|function enqueue(sub, record) {
//|  const id = subId(sub.channel, sub.userId);
//|  const q = queues.get(id) || { last: 0, items: [], timer: null };
//|  queues.set(id, q);
//|  q.items.push(record);
//|  if (q.timer) return;
//|  q.timer = setTimeout(() => flush(id), Math.max(0, q.last + COOLDOWN - Date.now()));
//|  q.timer.unref?.();
//|}
//|
//|async function flush(id) {
//|  const q = queues.get(id);
//|  if (!q) return;
//|  const items = q.items.splice(0);
//|  q.timer = null; q.last = Date.now();
//|  const sub = subs()[id];
//|  if (!sub?.on || !items.length) return;
//|  try {
//|    const allowed = [];
//|    for (const r of items) if (await checker(sub, communityKey(r.platform, r.communityId))) allowed.push(r);
//|    if (allowed.length) await sender(sub.channel, sub.userId, composeText(allowed));
//|  } catch (e) {
//|    console.error(`[notify] could not send a ${sub.channel} alert: ${e.message}`);
//|  }
//|}
//|
//|// Called for every new Pulse message. Never throws and never blocks the chat.
//|export function notifyNewDiscussion(record) {
//|  try {
//|    if (!NOTIFY_KINDS.includes(record.kind)) return;
//|    const key = communityKey(record.platform, record.communityId);
//|    for (const sub of Object.values(subs())) {
//|      if (sub.on && sub.kinds.includes(record.kind) && sub.keys.includes(key)) enqueue(sub, record);
//|    }
//|  } catch (e) {
//|    console.error('[notify]', e.message);
//|  }
//|}
//|#### SERVER_API
//|// notify-patch: the bell's data, and the phone-alert switches.
//|import { Router } from 'express';
//|import { listDiscussions, listAlerts, listFaqDrafts } from '../db.js';
//|import { buildSummary, getSub, saveSub, syncSubAccess, testDm, DEFAULT_KINDS } from '../pulse/notify.js';
//|
//|export const notificationsRouter = Router();
//|
//|const CHANNELS = ['telegram', 'discord'];
//|const stamp = (v, fallback) => { const t = Date.parse(v); return Number.isFinite(t) && t <= Date.now() + 60000 ? new Date(t).toISOString() : fallback; };
//|const identity = (req, channel) => (req.session?.[channel]?.user?.id ? String(req.session[channel].user.id) : null);
//|const idsOf = (req) => {
//|  const ids = {};
//|  for (const ch of CHANNELS) { const id = identity(req, ch); if (id) ids[ch] = id; }
//|  return ids;
//|};
//|
//|notificationsRouter.get('/summary', async (req, res) => {
//|  const now = new Date().toISOString();
//|  const seen = { pulse: stamp(req.query.pulse, now), alerts: stamp(req.query.alerts, now), faqs: stamp(req.query.faqs, now) };
//|  const keys = req.access.keys;
//|  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
//|  const summary = buildSummary({
//|    discussions: listDiscussions({ communityKeys: keys, since: weekAgo }),
//|    alerts: await listAlerts({ communityKeys: keys, resolved: false }),
//|    faqs: listFaqDrafts(keys).filter((x) => x.status === 'pending'),
//|    seen, now
//|  });
//|  const dm = {};
//|  for (const ch of CHANNELS) {
//|    const uid = identity(req, ch);
//|    if (!uid) { dm[ch] = null; continue; }
//|    await syncSubAccess(ch, uid, idsOf(req), [...keys]);
//|    const sub = getSub(ch, uid);
//|    dm[ch] = { on: !!sub?.on, kinds: sub?.kinds || [...DEFAULT_KINDS] };
//|  }
//|  res.json({ ...summary, dm });
//|});
//|
//|notificationsRouter.post('/dm', async (req, res) => {
//|  const { channel, on, kinds } = req.body || {};
//|  if (!CHANNELS.includes(channel)) return res.status(400).json({ error: 'Unknown channel' });
//|  const uid = identity(req, channel);
//|  if (!uid) return res.status(400).json({ error: `Sign in with ${channel === 'telegram' ? 'Telegram' : 'Discord'} first.` });
//|  const sub = await saveSub(channel, uid, { on: typeof on === 'boolean' ? on : undefined, kinds, ids: idsOf(req), keys: [...req.access.keys] });
//|  res.json({ ok: true, on: sub.on, kinds: sub.kinds });
//|});
//|
//|const lastTest = new Map(); // one test message every 10 seconds per person
//|notificationsRouter.post('/dm/test', async (req, res) => {
//|  const { channel } = req.body || {};
//|  if (!CHANNELS.includes(channel)) return res.status(400).json({ error: 'Unknown channel' });
//|  const uid = identity(req, channel);
//|  if (!uid) return res.status(400).json({ error: `Sign in with ${channel === 'telegram' ? 'Telegram' : 'Discord'} first.` });
//|  const k = `${channel}:${uid}`;
//|  if (Date.now() - (lastTest.get(k) || 0) < 10000) return res.json({ ok: false, error: 'Please wait a few seconds before sending another test.' });
//|  lastTest.set(k, Date.now());
//|  res.json(await testDm(channel, uid));
//|});
//|#### DASH_NOTIFY
//|'use strict';
//|
//|/* notify-patch
//|   Notifications: the bell, unread badges, the ping, the Home attention card and phone alerts.
//|   Loaded before app.js. It uses the dashboard's own helpers (html, api, qs, ago, toast, fail, route, state, modalShell),
//|   which only exist once app.js has run, so nothing here touches them until a page asks. */
//|(() => {
//|  const K = { seen: 'sentinel.nf.seen', done: 'sentinel.nf.announced', prefs: 'sentinel.nf.prefs' };
//|  const get = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
//|  const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: it just will not be remembered */ } };
//|
//|  const SECTION = { pulse: 'pulse', discord: 'alerts', telegram: 'alerts', faqs: 'faqs' };
//|  const KINDS = [['question', 'Questions'], ['concern', 'Concerns'], ['idea', 'Ideas']];
//|  const BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
//|
//|  let data = null, seen = null, announced = new Set(), curNs = null;
//|  let prefs = { sound: true, browser: false, ...get(K.prefs, {}) };
//|  let started = false, loaded = false, inflight = null, timer = null, lastPage = '', panelViewed = false;
//|  let hl = { page: '', ids: new Set() };
//|  let audio = null;
//|
//|  const signedIn = () => typeof state !== 'undefined' && !!state.me;
//|  const ns = () => { const m = state.me || {}; return `:${m.telegram?.user?.id || ''}:${m.discord?.user?.id || ''}`; };
//|  const idOf = (i) => `${i.type}:${i.id}`;
//|  const shown = (n) => (n > 99 ? '99+' : String(n));
//|
//|  /* ---------------- talking to the server ---------------- */
//|  function load() {
//|    if (!signedIn()) return Promise.resolve(null);
//|    if (inflight) return inflight;
//|    inflight = (async () => {
//|      try {
//|        const n = ns();
//|        if (n !== curNs) { curNs = n; seen = get(K.seen + n, null); announced = new Set(get(K.done + n, [])); loaded = false; data = null; }
//|        const r = await api(`/notifications/summary${seen ? qs(seen) : ''}`);
//|        // The very first visit starts from "now", so an old backlog does not show up as brand new.
//|        if (!seen) { seen = { pulse: r.now, alerts: r.now, faqs: r.now }; put(K.seen + curNs, seen); }
//|        data = r;
//|        const fresh = r.items.filter((i) => i.unseen && !announced.has(idOf(i)));
//|        fresh.forEach((i) => announced.add(idOf(i)));
//|        if (fresh.length) { announced = new Set([...announced].slice(-400)); put(K.done + curNs, [...announced]); }
//|        if (loaded && fresh.length) ping(fresh);
//|        loaded = true;
//|        if (hl.page === 'pulse') data.items.forEach((i) => { if (i.type === 'pulse' && i.unseen) hl.ids.add(i.id); });
//|        paint();
//|        decorate();
//|        return r;
//|      } finally { inflight = null; }
//|    })();
//|    return inflight;
//|  }
//|
//|  // Only ever called from something the person did: opening the bell, "Mark all read", or opening an item.
//|  // Nothing marks things as seen just because a page or tab happens to be open.
//|  async function markSeen(sections) {
//|    if (!data || !seen) return;
//|    for (const s of [].concat(sections)) seen[s] = data.now;
//|    put(K.seen + curNs, seen);
//|    try {
//|      // A refresh already in flight was asked for with the old "seen" times, so wait for it, then ask again.
//|      if (inflight) await inflight.catch(() => {});
//|      await load();
//|    } catch { /* the next refresh will catch up */ }
//|  }
//|
//|  /* ---------------- the ping ---------------- */
//|  function beep() {
//|    try {
//|      audio ||= new (window.AudioContext || window.webkitAudioContext)();
//|      if (audio.state === 'suspended') audio.resume();
//|      const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime;
//|      o.type = 'sine'; o.frequency.setValueAtTime(880, t); o.frequency.setValueAtTime(1175, t + 0.12);
//|      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
//|      o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t + 0.45);
//|    } catch { /* sound is a nice extra, never required */ }
//|  }
//|  // Browsers only allow sound after the person has touched the page once.
//|  for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => { try { audio ||= new (window.AudioContext || window.webkitAudioContext)(); audio.resume?.(); } catch { /* ignore */ } }, { once: true, passive: true });
//|
//|  async function native(title, body, hash) {
//|    try {
//|      const url = `/${hash || ''}`;
//|      const reg = await navigator.serviceWorker?.getRegistration?.();
//|      if (reg?.showNotification) { await reg.showNotification(title, { body, tag: 'sentinel', renotify: true, icon: '/favicon.svg', data: { url } }); return; }
//|      const n = new Notification(title, { body, tag: 'sentinel', icon: '/favicon.svg' });
//|      n.onclick = () => { window.focus(); location.hash = hash || '#/home'; n.close(); };
//|    } catch { /* pop-ups are optional */ }
//|  }
//|
//|  function ping(items) {
//|    const one = items[0], many = items.length > 1;
//|    toast(many ? `${items.length} new items need a look` : `${one.title}${one.community ? ` in ${one.community}` : ''}`);
//|    if (prefs.sound) beep();
//|    try { navigator.vibrate?.(many ? [90, 60, 90] : 90); } catch { /* not every device vibrates */ }
//|    document.querySelectorAll('.nf-bell').forEach((b) => { b.classList.add('ring'); setTimeout(() => b.classList.remove('ring'), 1000); });
//|    if (prefs.browser && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
//|      native(many ? `${items.length} new items in Sentinel` : one.title, many ? 'Open Sentinel to review them.' : one.text, one.href);
//|    }
//|  }
//|
//|  /* ---------------- badges, bell, tab title ---------------- */
//|  function setBadge(id, n) {
//|    document.querySelectorAll(`[data-badge="${id}"]`).forEach((el) => { el.textContent = shown(n); el.hidden = !n; });
//|  }
//|
//|  const bellHtml = () => `<button type="button" class="nf-bell" data-nf="bell" aria-label="Notifications" aria-expanded="false" title="Notifications">${BELL}<span class="nf-count" hidden></span></button>`;
//|
//|  function inject() {
//|    const top = document.querySelector('#page > .topbar');
//|    document.querySelector('.nf-float')?.remove();
//|    if (top) {
//|      let tools = top.querySelector(':scope > .tools');
//|      if (!tools) { tools = document.createElement('div'); tools.className = 'tools'; top.appendChild(tools); }
//|      if (!tools.querySelector('.nf-bell')) tools.insertAdjacentHTML('beforeend', bellHtml());
//|    } else if (document.getElementById('page') && !document.querySelector('.nf-bell')) {
//|      document.body.insertAdjacentHTML('beforeend', bellHtml().replace('class="nf-bell"', 'class="nf-bell nf-float"'));
//|    }
//|  }
//|
//|  function paint() {
//|    const u = data?.unseen || { total: 0, pulse: 0 };
//|    setBadge('home', u.total);
//|    setBadge('pulse', u.pulse);
//|    document.querySelectorAll('.nf-bell').forEach((b) => {
//|      b.classList.toggle('has-new', u.total > 0);
//|      const c = b.querySelector('.nf-count');
//|      if (c) { c.textContent = shown(u.total); c.hidden = !u.total; }
//|      b.setAttribute('aria-label', u.total ? `Notifications, ${u.total} new` : 'Notifications');
//|    });
//|    if (signedIn()) document.title = u.total ? `(${shown(u.total)}) Sentinel` : 'Sentinel';
//|    const p = document.getElementById('nf-panel');
//|    if (p) p.innerHTML = panelHtml().s;
//|  }
//|
//|  // On the Pulse page, marks the rows that arrived since the last visit.
//|  function decorate() {
//|    if (typeof route !== 'function' || route().page !== 'pulse') return;
//|    document.querySelectorAll('#page .row.static').forEach((row) => {
//|      const id = row.querySelector('[data-pulse][data-id]')?.dataset.id;
//|      if (!id || !hl.ids.has(id) || row.querySelector('.nf-new')) return;
//|      row.classList.add('nf-fresh');
//|      row.querySelector('.who')?.insertAdjacentHTML('beforeend', '<span class="tag info nf-new">New</span>');
//|    });
//|  }
//|
//|  /* ---------------- the bell panel and the Home card ---------------- */
//|  const LABEL = { question: 'Question', concern: 'Concern', idea: 'Idea', alert: 'Protection', faq: 'FAQ draft' };
//|
//|  const row = (i) => html`<button type="button" class="nf-row${i.unseen ? ' unseen' : ''}" data-nf="go" data-href="${i.href}">
//|    <span class="nf-dot" aria-hidden="true"></span>
//|    <span class="nf-body">
//|      <span class="nf-title">${i.title} <span class="tag ${i.kind === 'concern' || i.kind === 'alert' ? 'net' : ''}">${LABEL[i.kind] || ''}</span></span>
//|      <span class="nf-text">${i.text}</span>
//|      <span class="nf-meta">${[PLAT[i.platform], i.community, i.channel && i.channel !== i.community ? `#${i.channel}` : ''].filter(Boolean).join(' · ')}${i.community || i.platform ? ' · ' : ''}${ago(i.at)}</span>
//|    </span></button>`;
//|
//|  function panelHtml() {
//|    const items = data?.items || [];
//|    return html`<div class="nf-head"><b>Notifications</b>
//|        <div class="nf-head-actions"><button type="button" class="btn" data-nf="read-all">Mark all read</button><button type="button" class="btn" data-nf="settings">Settings</button></div></div>
//|      <div class="nf-list">${items.length ? items.map(row) : html`<div class="empty"><b>Nothing waiting</b><br>New questions, concerns and removed messages appear here the moment they arrive.</div>`}</div>`;
//|  }
//|
//|  function homeCard(nf) {
//|    const d = nf || data;
//|    if (!d) return '';
//|    const o = d.open;
//|    const alertHref = d.items.find((i) => i.type === 'alert')?.href || '#/discord';
//|    const chip = (href, label, n) => html`<a class="chip nf-chip ${n ? 'on' : ''}" data-nav="${href}" style="cursor:pointer">${label} <b>${n}</b></a>`;
//|    const items = d.items.slice(0, 6);
//|    return html`<div class="panel nf-home"><h2>Needs your attention <span>${d.unseen.total ? `${d.unseen.total} new since you last looked` : 'Nothing new since you last looked'} · <a data-nf="settings" style="cursor:pointer">Notification settings</a></span></h2>
//|      <div class="nf-chips">${chip('#/pulse/ideas', 'Unanswered questions', o.pulse.questions)}${chip('#/pulse/ideas', 'Concerns', o.pulse.concerns)}${chip('#/pulse/ideas', 'Ideas', o.pulse.ideas)}${chip(alertHref, 'Removed messages to review', o.alerts)}${chip('#/faqs', 'FAQ drafts', o.faqs)}</div>
//|      ${items.length ? html`<div class="nf-list flat">${items.map(row)}</div>` : html`<div class="empty">All clear. Sentinel will show new questions, concerns and removed messages here.</div>`}
//|    </div>`;
//|  }
//|
//|  function closePanel() {
//|    const p = document.getElementById('nf-panel');
//|    if (!p) return;
//|    p.remove();
//|    document.querySelectorAll('.nf-bell').forEach((b) => b.setAttribute('aria-expanded', 'false'));
//|    // The person opened the panel and saw the list, so what was in it is now read.
//|    if (panelViewed) { panelViewed = false; markSeen(['pulse', 'alerts', 'faqs']); }
//|  }
//|
//|  function togglePanel(btn) {
//|    if (document.getElementById('nf-panel')) return closePanel();
//|    const p = document.createElement('div');
//|    p.id = 'nf-panel'; p.className = 'nf-panel'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', 'Notifications');
//|    p.innerHTML = panelHtml().s;
//|    document.body.appendChild(p);
//|    panelViewed = true;
//|    const r = btn.getBoundingClientRect();
//|    p.style.top = `${Math.round(Math.min(Math.max(r.bottom + 8, 12), 140))}px`;
//|    p.style.right = `${Math.max(12, Math.round(window.innerWidth - r.right))}px`;
//|    btn.setAttribute('aria-expanded', 'true');
//|    load().catch(() => {});
//|  }
//|
//|  /* ---------------- settings window ---------------- */
//|  function settingsInner() {
//|    const dm = data?.dm || {};
//|    const supported = 'Notification' in window;
//|    let note, action = '';
//|    if (!supported) note = 'This browser cannot show pop-up alerts.';
//|    else if (!window.isSecureContext) note = 'Pop-up alerts need a secure (https) address. They will work once Sentinel is live on https.';
//|    else if (Notification.permission === 'denied') note = 'Blocked in your browser settings. Allow notifications for this site, then reopen this window.';
//|    else if (Notification.permission === 'granted' && prefs.browser) { note = 'On. You get a pop-up when Sentinel is open but in the background.'; action = html`<button type="button" class="btn" data-nf="browser-off">Turn off</button>`; }
//|    else { note = 'Get a pop-up when Sentinel is open but in the background.'; action = html`<button type="button" class="btn primary" data-nf="browser-on">Turn on</button>`; }
//|
//|    const chan = (ch, label, help) => {
//|      const s = dm[ch];
//|      if (!s) return '';
//|      return html`<label class="nf-opt"><input type="checkbox" data-nf-change="dm-on" data-channel="${ch}" ${s.on ? 'checked' : ''}><span><b>Message me on ${label}</b><small>${help}</small></span></label>
//|        ${s.on && html`<div class="nf-kinds">${KINDS.map(([k, l]) => html`<label><input type="checkbox" data-nf-change="dm-kind" data-channel="${ch}" data-kind="${k}" ${s.kinds.includes(k) ? 'checked' : ''}> ${l}</label>`)}<button type="button" class="btn" data-nf="dm-test" data-channel="${ch}">Send a test</button></div>`}`;
//|    };
//|
//|    return html`<p class="muted" style="margin:6px 0 14px">Choose how Sentinel tells you that something needs you.</p>
//|      <h4 class="nf-h">On this device</h4>
//|      <label class="nf-opt"><input type="checkbox" data-nf-change="sound" ${prefs.sound ? 'checked' : ''}><span><b>Play a sound</b><small>A short chime when something new arrives while Sentinel is open.</small></span></label>
//|      <div class="nf-opt static"><span><b>Pop-up alerts</b><small>${note}</small></span>${action}</div>
//|      <h4 class="nf-h">On your phone, even when Sentinel is closed</h4>
//|      ${chan('telegram', 'Telegram', 'Sentinel sends you a private Telegram message, so you hear about it on your phone with this page closed.')}
//|      ${chan('discord', 'Discord', 'Sentinel sends you a private Discord message. Allow direct messages from server members in your Discord privacy settings.')}
//|      ${!dm.telegram && !dm.discord && html`<p class="muted">Sign in with Telegram or Discord to get phone alerts.</p>`}
//|      <p class="muted" style="margin-top:12px">You only hear about communities you manage. Praise and general chat never send an alert.</p>`;
//|  }
//|
//|  const redrawSettings = () => { const el = document.getElementById('nf-set'); if (el) el.innerHTML = settingsInner().s; };
//|
//|  function openSettings() {
//|    closePanel();
//|    const root = document.getElementById('drawer-root');
//|    if (!root) return;
//|    root.innerHTML = modalShell('Notifications', html`<div id="nf-set">${settingsInner()}</div>`).s;
//|  }
//|
//|  /* ---------------- events ---------------- */
//|  document.addEventListener('click', async (e) => {
//|    const el = e.target.closest('[data-nf]');
//|    if (!el) { const p = document.getElementById('nf-panel'); if (p && !p.contains(e.target)) closePanel(); return; }
//|    const act = el.dataset.nf;
//|    try {
//|      if (act === 'bell') return togglePanel(el);
//|      if (act === 'read-all') return await markSeen(['pulse', 'alerts', 'faqs']);
//|      if (act === 'settings') { await load().catch(() => {}); return openSettings(); }
//|      if (act === 'go') {
//|        const href = el.dataset.href || '#/home';
//|        panelViewed = false; // opening one item reads that section only, not everything in the panel
//|        closePanel();
//|        markSeen(SECTION[href.replace(/^#\//, '').split('/')[0]] || []);
//|        if (location.hash === href) loadPage(route().page, { silent: true }); else location.hash = href;
//|        return;
//|      }
//|      if (act === 'browser-on') {
//|        const p = await Notification.requestPermission();
//|        prefs.browser = p === 'granted'; put(K.prefs, prefs); redrawSettings();
//|        if (prefs.browser) native('Sentinel alerts are on', 'You will see pop-ups like this one.', '#/home');
//|        return;
//|      }
//|      if (act === 'browser-off') { prefs.browser = false; put(K.prefs, prefs); return redrawSettings(); }
//|      if (act === 'dm-test') {
//|        el.disabled = true;
//|        const r = await api('/notifications/dm/test', { method: 'POST', body: { channel: el.dataset.channel } });
//|        el.disabled = false;
//|        toast(r.ok ? 'Test sent. Check your phone.' : (r.error || 'Could not send the test.'), !r.ok);
//|      }
//|    } catch (err) { fail(err); }
//|  });
//|
//|  document.addEventListener('change', async (e) => {
//|    const el = e.target.closest('[data-nf-change]');
//|    if (!el) return;
//|    const what = el.dataset.nfChange;
//|    try {
//|      if (what === 'sound') { prefs.sound = el.checked; put(K.prefs, prefs); if (el.checked) beep(); return; }
//|      const ch = el.dataset.channel;
//|      const kinds = what === 'dm-kind' ? [...document.querySelectorAll(`#nf-set [data-nf-change="dm-kind"][data-channel="${ch}"]`)].filter((x) => x.checked).map((x) => x.dataset.kind) : undefined;
//|      const on = what === 'dm-on' ? el.checked : !!data?.dm?.[ch]?.on;
//|      await api('/notifications/dm', { method: 'POST', body: { channel: ch, on, kinds } });
//|      await load();
//|      redrawSettings();
//|      if (what === 'dm-on' && on) toast('Phone alerts are on. Press "Send a test" to check they reach you.');
//|    } catch (err) { fail(err); redrawSettings(); }
//|  });
//|
//|  addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanel(); });
//|  addEventListener('hashchange', closePanel);
//|  document.addEventListener('visibilitychange', () => { if (!document.hidden) load().catch(() => {}); });
//|
//|  /* ---------------- lifecycle ---------------- */
//|  function loop() {
//|    clearTimeout(timer);
//|    timer = setTimeout(async () => {
//|      if (signedIn()) await load().catch(() => {});
//|      else if (data) { data = null; curNs = null; paint(); document.title = 'Sentinel'; }
//|      loop();
//|    }, document.hidden ? 30000 : 8000);
//|  }
//|
//|  function start() {
//|    if (!signedIn()) return;
//|    if (!started) {
//|      started = true;
//|      if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});
//|      loop();
//|    }
//|    paint();
//|    load().catch(() => {});
//|  }
//|
//|  function afterPage() {
//|    if (!signedIn()) return;
//|    const page = route().page;
//|    if (page !== lastPage) {
//|      lastPage = page;
//|      hl = { page, ids: new Set() };
//|      if (page === 'pulse' && data) data.items.forEach((i) => { if (i.type === 'pulse' && i.unseen) hl.ids.add(i.id); });
//|    }
//|    start();
//|    inject();
//|    paint();
//|    decorate();
//|  }
//|
//|  window.Notify = { start, afterPage, refresh: load, homeCard, markSeen };
//|})();
//|#### SW
//|/* notify-patch: lets Sentinel show a pop-up that works on phones too, and opens the right page when it is tapped. */
//|self.addEventListener('install', () => self.skipWaiting());
//|self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
//|self.addEventListener('notificationclick', (e) => {
//|  e.notification.close();
//|  const url = (e.notification.data && e.notification.data.url) || '/';
//|  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
//|    for (const c of list) {
//|      if ('focus' in c) return c.focus().then((w) => (w && w.navigate ? w.navigate(url) : null)).catch(() => {});
//|    }
//|    return self.clients.openWindow(url);
//|  }));
//|});
//|#### CSS
//|/* notify-patch: bell, badges, panel, Home card, settings */
//|.nf-bell{position:relative; display:inline-flex; align-items:center; justify-content:center; width:38px; height:38px; padding:0; border-radius:10px; border:1px solid var(--line); background:var(--surface); color:var(--text); cursor:pointer;}
//|.nf-bell:hover{background:var(--surface-2);}
//|.nf-bell svg{width:19px; height:19px; display:block;}
//|.nf-bell.has-new{color:var(--accent); border-color:var(--accent);}
//|.nf-count{position:absolute; top:-6px; right:-6px; min-width:18px; height:18px; padding:0 5px; box-sizing:border-box; border-radius:999px; background:#cf3339; color:#fff; font-size:10.5px; font-weight:700; line-height:18px; text-align:center;}
//|.nf-count[hidden]{display:none;}
//|.nf-bell.ring svg{animation:nfring .9s ease-in-out;}
//|@keyframes nfring{0%,100%{transform:rotate(0)}15%{transform:rotate(14deg)}30%{transform:rotate(-12deg)}45%{transform:rotate(9deg)}60%{transform:rotate(-6deg)}75%{transform:rotate(3deg)}}
//|@media (prefers-reduced-motion:reduce){.nf-bell.ring svg{animation:none;}}
//|.nf-float{position:fixed; top:calc(12px + env(safe-area-inset-top,0px)); right:14px; z-index:35;}
//|.nf-panel{position:fixed; z-index:45; width:min(420px, calc(100vw - 24px)); max-height:min(560px, calc(100vh - 160px)); display:flex; flex-direction:column; background:var(--surface); border:1px solid var(--line); border-radius:var(--r-panel); box-shadow:var(--shadow-pop); overflow:hidden;}
//|.nf-head{display:flex; align-items:center; justify-content:space-between; gap:10px; padding:12px 14px; border-bottom:1px solid var(--line);}
//|.nf-head-actions{display:flex; gap:6px;}
//|.nf-head .btn{min-height:30px; padding:4px 10px; font-size:12.5px;}
//|.nf-list{overflow-y:auto;}
//|.nf-row{display:flex; gap:10px; width:100%; text-align:left; background:none; border:none; border-bottom:1px solid var(--line); padding:12px 14px; cursor:pointer; font:inherit; color:inherit;}
//|.nf-row:last-child{border-bottom:none;}
//|.nf-row:hover{background:var(--surface-2);}
//|.nf-dot{flex:0 0 8px; width:8px; height:8px; border-radius:50%; margin-top:6px; background:transparent;}
//|.nf-row.unseen .nf-dot{background:var(--accent);}
//|.nf-row.unseen .nf-title{color:var(--text);}
//|.nf-body{flex:1; min-width:0; display:flex; flex-direction:column; gap:3px;}
//|.nf-title{font-weight:600; font-size:13.5px; display:flex; gap:6px; align-items:center; flex-wrap:wrap;}
//|.nf-text{color:var(--text); font-size:13px; line-height:1.45; overflow-wrap:anywhere; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;}
//|.nf-meta{color:var(--sub); font-size:12px;}
//|.nf-fresh{box-shadow:inset 3px 0 0 var(--accent);}
//|.nf-home .nf-chips{display:flex; flex-wrap:wrap; gap:8px; padding:12px 18px; border-bottom:1px solid var(--line);}
//|.nf-chip{text-decoration:none; padding:5px 12px; color:var(--text);}
//|.nf-chip b{font-weight:700;}
//|.nf-home .nf-row{padding:12px 18px;}
//|.nf-h{font-size:12px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--sub); margin:18px 0 4px;}
//|.nf-opt{display:flex; gap:12px; align-items:flex-start; padding:11px 0; border-top:1px solid var(--line); cursor:pointer;}
//|.nf-opt.static{cursor:default; align-items:center;}
//|.nf-opt > span{flex:1; min-width:0;}
//|.nf-opt small{display:block; color:var(--sub); font-size:12.5px; font-weight:400; margin-top:2px; line-height:1.45;}
//|.nf-opt input{margin-top:3px;}
//|.nf-kinds{display:flex; gap:14px; flex-wrap:wrap; align-items:center; padding:0 0 12px 26px; font-size:13px;}
//|.tabbar .badge.tb{position:absolute; top:0; left:calc(50% + 6px); min-width:16px; padding:0 5px; border-radius:999px; background:#cf3339; color:#fff; font-size:10px; font-weight:700; line-height:16px; text-align:center;}
//|.tabbar .badge.tb[hidden]{display:none;}
//|@media (max-width:820px){
//|  .nf-panel{left:12px; width:auto; max-height:calc(100vh - 190px);}
//|  .nf-bell{width:42px; height:42px;}
//|}
//|#### TEST
//|// notify-patch
//|import { test, before, after } from 'node:test';
//|import assert from 'node:assert/strict';
//|import os from 'node:os';
//|import path from 'node:path';
//|import fs from 'node:fs';
//|
//|process.env.SENTINEL_DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-notify-')), 'db.json');
//|process.env.PORT = '0';
//|process.env.PULSE_ENABLED = 'false';
//|process.env.AI_PROVIDER = 'none';
//|
//|const { createApp } = await import('../src/server.js');
//|const { setAccessProvider } = await import('../src/access.js');
//|const db = await import('../src/db.js');
//|const { loginAs } = await import('../src/auth/sessions.js');
//|const notify = await import('../src/pulse/notify.js');
//|
//|const OLD = '2000-01-01T00:00:00.000Z';
//|let server, base, cookie;
//|const item = (communityId, text, extra = {}) => db.addDiscussion({
//|  platform: 'telegram', communityId, communityName: communityId === '-100' ? 'Mine' : 'Someone Elses', channelId: communityId,
//|  userId: '1', username: 'ann', messageId: String(Math.floor(Math.random() * 1e9)), text, kind: 'question', score: 5, topics: [], sentiment: 0, ...extra
//|});
//|
//|before(async () => {
//|  const app = await createApp();
//|  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
//|  base = `http://127.0.0.1:${server.address().port}`;
//|  setAccessProvider(async () => ({ communities: [{ key: 'telegram:-100', platform: 'telegram', id: '-100', name: 'Mine' }], invites: [] }));
//|  const fakeRes = { getHeader: () => undefined, setHeader: (k, v) => { cookie = String(v).split(';')[0]; } };
//|  await loginAs({ session: null }, fakeRes, { telegram: { user: { id: '42', username: 'abraham' } } });
//|});
//|after(async () => { server.close(); await db.flushStats(); });
//|
//|const api = (p, o = {}) => fetch(base + p, {
//|  ...o, headers: { 'Content-Type': 'application/json', cookie, ...(o.headers || {}) }, body: o.body ? JSON.stringify(o.body) : undefined
//|});
//|
//|test('buildSummary counts what is new and what still needs a person', () => {
//|  const now = new Date().toISOString();
//|  const d = (o) => ({ id: Math.random().toString(36), kind: 'question', status: 'new', createdAt: now, username: 'a', text: 'hello', ...o });
//|  const s = notify.buildSummary({
//|    discussions: [d({}), d({ kind: 'concern' }), d({ kind: 'praise' }), d({ staffReplied: true }), d({ status: 'done' }), d({ createdAt: OLD })],
//|    alerts: [{ id: 'a1', platform: 'discord', guildName: 'G', username: 'x', text: 'scam', createdAt: now }],
//|    faqs: [], seen: { pulse: OLD, alerts: now, faqs: OLD }, now
//|  });
//|  assert.equal(s.open.pulse.total, 3); // question, concern, and the old question; praise, answered and done are skipped
//|  assert.equal(s.open.pulse.questions, 2);
//|  assert.equal(s.unseen.pulse, 2);
//|  assert.equal(s.unseen.alerts, 0);
//|  assert.equal(s.unseen.total, 2);
//|  assert.ok(s.items.every((i) => i.at >= new Date(Date.parse(now) - 7 * 86400000).toISOString()));
//|});
//|
//|test('the summary needs a sign in', async () => {
//|  assert.equal((await fetch(base + '/api/notifications/summary')).status, 401);
//|});
//|
//|test('the summary only counts my communities and what is newer than the last look', async () => {
//|  item('-100', 'How do I stake?');
//|  item('-200', 'secret question from another community');
//|  const all = await (await api(`/api/notifications/summary?pulse=${OLD}`)).json();
//|  assert.equal(all.unseen.pulse, 1);
//|  assert.ok(!JSON.stringify(all).includes('secret'));
//|  const caughtUp = await (await api(`/api/notifications/summary?pulse=${encodeURIComponent(new Date(Date.now() + 5000).toISOString())}`)).json();
//|  assert.equal(caughtUp.unseen.pulse, 0);
//|  assert.equal(caughtUp.open.pulse.total, 1);
//|});
//|
//|test('phone alerts can only be switched on for an account you are signed in with', async () => {
//|  assert.equal((await api('/api/notifications/dm', { method: 'POST', body: { channel: 'discord', on: true } })).status, 400);
//|  assert.equal((await api('/api/notifications/dm', { method: 'POST', body: { channel: 'nope', on: true } })).status, 400);
//|  const ok = await (await api('/api/notifications/dm', { method: 'POST', body: { channel: 'telegram', on: true, kinds: ['question', 'bogus'] } })).json();
//|  assert.deepEqual(ok.kinds, ['question']);
//|  const sum = await (await api('/api/notifications/summary')).json();
//|  assert.equal(sum.dm.telegram.on, true);
//|  assert.equal(sum.dm.discord, null);
//|});
//|
//|test('a phone alert goes out for a matching message, and only to managers of that community', async () => {
//|  const sent = [];
//|  notify.setDmSender(async (channel, userId, text) => { sent.push({ channel, userId, text }); });
//|  notify.setManageChecker(async (sub, key) => key === 'telegram:-100');
//|  try {
//|    await notify.saveSub('telegram', '42', { on: true, kinds: ['question'], ids: { telegram: '42' }, keys: ['telegram:-100'] });
//|    notify.notifyNewDiscussion(item('-100', 'When does staking open?'));
//|    notify.notifyNewDiscussion(item('-100', 'We should add a quiz', { kind: 'idea' })); // kind not selected
//|    notify.notifyNewDiscussion(item('-200', 'question in a community I do not manage'));
//|    await new Promise((r) => setTimeout(r, 80));
//|    assert.equal(sent.length, 1);
//|    assert.equal(sent[0].userId, '42');
//|    assert.match(sent[0].text, /When does staking open/);
//|    assert.ok(!sent[0].text.includes('do not manage'));
//|  } finally {
//|    notify.setDmSender(null); notify.setManageChecker(null);
//|    await notify.saveSub('telegram', '42', { on: false });
//|  }
//|});
//|#### TG_DM
//|// notify-patch: a private message to a manager (phone alert). Telegram only allows this after the person has pressed Start on the bot, which signing in already needs.
//|export async function sendTelegramDm(userId, text) {
//|  if (!bot) throw new Error('The Telegram bot is not running.');
//|  await bot.sendMessage(Number(userId), String(text).slice(0, 3900), { disable_web_page_preview: true });
//|}
//|#### DC_DM
//|// notify-patch: a private message to a manager (phone alert). Fails if they have switched off direct messages from server members.
//|export async function sendDiscordDm(userId, text) {
//|  if (!client) throw new Error('The Discord bot is not running.');
//|  const user = await client.users.fetch(String(userId));
//|  await user.send({ content: String(text).slice(0, 1900), allowedMentions: { parse: [] } });
//|}
//|#### R1_START
//|import { pulseRouter } from './pulse.js';
//|#### R1_NEW
//|import { pulseRouter } from './pulse.js';
//|import { notificationsRouter } from './notifications.js'; // notify-patch
//|#### R2_START
//|apiRouter.use('/pulse', pulseRouter);
//|#### R2_NEW
//|apiRouter.use('/pulse', pulseRouter);
//|apiRouter.use('/notifications', notificationsRouter);
//|#### C1_START
//|import { buildContext } from './context.js';
//|#### C1_NEW
//|import { buildContext } from './context.js';
//|import { notifyNewDiscussion } from './notify.js'; // notify-patch
//|#### C2_START
//|    autoDraft(record, settings);
//|    return record;
//|#### C2_NEW
//|    autoDraft(record, settings);
//|    notifyNewDiscussion(record);
//|    return record;
//|#### H1_START
//|<script src="/tour.js"></script>
//|#### H1_NEW
//|<script src="/tour.js"></script>
//|<script src="/notify.js"></script><!-- notify-patch -->
//|#### A1_START
//|(id === 'discord' || id === 'telegram' || id === 'faqs')
//|#### A1_NEW
//|['home', 'pulse', 'discord', 'telegram', 'faqs'].includes(id)
//|#### A2_START
//|${NAV.slice(0, 4).map(([id, label, ic]) => html`<a data-nav="#/${id}" class="${page === id ? 'active' : ''}">${icon(ic)}${label}</a>`)}
//|#### A2_NEW
//|${NAV.slice(0, 4).map(([id, label, ic]) => html`<a data-nav="#/${id}" class="${page === id ? 'active' : ''}">${icon(ic)}${label}<span class="badge tb" data-badge="${id}" hidden></span></a>`)}
//|#### A3_START
//|  decoratePage();
//|  window.Guide?.afterPage?.();
//|#### A3_NEW
//|  decoratePage();
//|  window.Guide?.afterPage?.();
//|  window.Notify?.afterPage?.();
//|#### A4_START
//|  window.Theme?.sync?.();
//|  loadPage(page);
//|#### A4_NEW
//|  window.Theme?.sync?.();
//|  window.Notify?.start?.(); // notify-patch
//|  loadPage(page);
//|#### A5_START
//|const [stats, tg, dc, pulse] = await Promise.all([
//|#### A5_NEW
//|const [stats, tg, dc, pulse, nf] = await Promise.all([
//|#### A6_START
//|    api(`/pulse/overview${qs({ community, days: 7 })}`).catch(() => null)
//|  ]);
//|#### A6_NEW
//|    api(`/pulse/overview${qs({ community, days: 7 })}`).catch(() => null),
//|    window.Notify?.refresh?.().catch(() => null)
//|  ]);
//|#### A7_START
//|  setPage(html`
//|    <div class="topbar"><h1>Today, at a glance</h1>
//|#### A7_NEW
//|  const np = nf?.open?.pulse?.total || 0;
//|  if (np) state.homeSub += ` ${np} ${np === 1 ? 'message needs' : 'messages need'} attention in Pulse.`;
//|  setPage(html`
//|    <div class="topbar"><h1>Today, at a glance</h1>
//|#### A8_START
//|    ${statCards(stats)}
//|    ${pulse ? html`<div class="panel"><h2>Pulse at a glance
//|#### A8_NEW
//|    ${statCards(stats)}
//|    ${window.Notify?.homeCard?.(nf) || ''}
//|    ${pulse ? html`<div class="panel"><h2>Pulse at a glance
