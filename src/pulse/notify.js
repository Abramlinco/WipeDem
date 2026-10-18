// notify-patch: what is new for a manager, and phone alerts (a private Telegram or Discord message).
import { db, communityKey } from '../db.js';
import { config } from '../config.js';

// Ideas, questions and concerns notify. Praise and general chatter never do.
export const NOTIFY_KINDS = ['idea', 'question', 'concern'];
export const DEFAULT_KINDS = ['question', 'concern'];

const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
const trim = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

// Still waiting for a person: not handled, not replied to, and (for questions) not answered by staff.
export const needsAttention = (d) =>
  NOTIFY_KINDS.includes(d.kind) && d.status === 'new' && !d.reply && !(d.kind === 'question' && d.staffReplied);

/* ------------------------------------------------------------------ */
/* What is new                                                         */
/* ------------------------------------------------------------------ */

// seen = { pulse, alerts, faqs } ISO times: anything newer than these counts as "new".
export function buildSummary({ discussions = [], alerts = [], faqs = [], seen, now = new Date().toISOString() }) {
  const weekAgo = new Date(Date.parse(now) - 7 * 86400000).toISOString();
  const pulse = discussions.filter(needsAttention);
  const of = (kind) => pulse.filter((d) => d.kind === kind).length;
  const unseen = {
    pulse: pulse.filter((d) => d.createdAt > seen.pulse).length,
    alerts: alerts.filter((a) => a.createdAt > seen.alerts).length,
    faqs: faqs.filter((f) => f.createdAt > seen.faqs).length
  };
  unseen.total = unseen.pulse + unseen.alerts + unseen.faqs;

  const items = [
    ...pulse.map((d) => ({
      type: 'pulse', id: d.id, kind: d.kind, platform: d.platform,
      title: `${cap(d.kind)} from ${d.username || 'a member'}`, text: trim(d.text, 160),
      community: d.communityName || '', channel: d.channelName || '', at: d.createdAt,
      unseen: d.createdAt > seen.pulse, href: '#/pulse/ideas'
    })),
    ...alerts.map((a) => ({
      type: 'alert', id: a.id, kind: 'alert', platform: a.platform,
      title: `Removed message from ${a.username || 'someone'}`, text: trim(a.text, 160),
      community: a.guildName || '', channel: a.channelName || '', at: a.createdAt,
      unseen: a.createdAt > seen.alerts, href: `#/${a.platform}`
    })),
    ...faqs.map((f) => ({
      type: 'faq', id: f.id, kind: 'faq', platform: String(f.communityKey || '').split(':')[0],
      title: 'Repeated question', text: trim(f.question, 160), community: '', channel: '', at: f.createdAt,
      unseen: f.createdAt > seen.faqs, href: '#/faqs'
    }))
  ].filter((i) => i.at >= weekAgo).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20);

  return {
    now, unseen, items,
    open: { pulse: { total: pulse.length, questions: of('question'), concerns: of('concern'), ideas: of('idea') }, alerts: alerts.length, faqs: faqs.length }
  };
}

/* ------------------------------------------------------------------ */
/* Phone alerts: a private message from the bot                         */
/* ------------------------------------------------------------------ */

const subs = () => (db.data.notifySubs ||= {});
const subId = (channel, userId) => `${channel}:${userId}`;
const cleanKinds = (k) => (Array.isArray(k) ? [...new Set(k.filter((x) => NOTIFY_KINDS.includes(x)))] : null);

export const getSub = (channel, userId) => subs()[subId(channel, userId)] || null;

// ids = the person's Telegram and Discord IDs, keys = the communities they manage. Both are re-checked live before every message.
export async function saveSub(channel, userId, { on, kinds, ids, keys }) {
  const id = subId(channel, userId);
  const prev = subs()[id] || {};
  subs()[id] = {
    channel, userId: String(userId),
    on: on === undefined ? !!prev.on : !!on,
    kinds: cleanKinds(kinds) ?? prev.kinds ?? [...DEFAULT_KINDS],
    ids: ids ?? prev.ids ?? {},
    keys: keys ?? prev.keys ?? [],
    updatedAt: new Date().toISOString()
  };
  await db.write();
  return subs()[id];
}

// Keeps the saved list of communities current while the person uses the dashboard.
export async function syncSubAccess(channel, userId, ids, keys) {
  const sub = getSub(channel, userId);
  if (!sub) return;
  if (JSON.stringify(sub.keys) === JSON.stringify(keys) && JSON.stringify(sub.ids) === JSON.stringify(ids)) return;
  sub.keys = keys; sub.ids = ids;
  await db.write();
}

async function defaultSender(channel, userId, text) {
  if (channel === 'telegram') return (await import('../telegram/bot.js')).sendTelegramDm(userId, text);
  if (channel === 'discord') return (await import('../discord/bot.js')).sendDiscordDm(userId, text);
  throw new Error('Unknown channel');
}

// Does this person still manage this community right now? A removed admin stops getting messages.
async function defaultChecker(sub, key) {
  const i = key.indexOf(':');
  const platform = key.slice(0, i), id = key.slice(i + 1);
  if (platform === 'telegram') {
    const tid = sub.ids?.telegram;
    if (!tid) return false;
    const chats = await (await import('../telegram/bot.js')).telegramAdminChats(Number(tid));
    return chats.some((c) => String(c.id) === id);
  }
  if (platform === 'discord') {
    const did = sub.ids?.discord;
    return !!did && (await import('../discord/bot.js')).discordUserStillManages(id, did);
  }
  return false;
}

let sender = defaultSender;
let checker = defaultChecker;
export const setDmSender = (fn) => { sender = fn || defaultSender; };
export const setManageChecker = (fn) => { checker = fn || defaultChecker; };

export function composeText(items) {
  const one = items.length === 1;
  const head = one ? `🔔 New ${items[0].kind} in ${items[0].communityName || 'your community'}` : `🔔 ${items.length} new messages in Pulse`;
  const lines = items.slice(0, 3).map((r) => `${r.username || 'A member'}: ${trim(r.text, 180)}`);
  if (items.length > 3) lines.push(`…and ${items.length - 3} more`);
  const link = /^https:/i.test(config.publicUrl || '') ? `\n\nOpen Sentinel: ${config.publicUrl}/#/pulse/ideas` : '';
  return `${head}\n\n${lines.join('\n')}${link}`;
}

export function friendlyError(channel, e) {
  const m = String(e?.message || e);
  if (/not running/i.test(m)) return m;
  if (channel === 'telegram' && /403|blocked|initiate|not started|chat not found/i.test(m)) return 'Telegram will not let Sentinel message you yet. Open the Sentinel bot in Telegram, press Start, then try again.';
  if (channel === 'discord' && (String(e?.code) === '50007' || /cannot send messages to this user/i.test(m))) return 'Discord blocked the message. In your Discord privacy settings, allow direct messages from server members, then try again.';
  return 'The message could not be sent. Check that the bot is running, then try again.';
}

export async function testDm(channel, userId) {
  try {
    await sender(channel, userId, '🔔 Sentinel test: phone alerts are working. You will get a message like this when a new question or concern arrives.');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: friendlyError(channel, e) };
  }
}

// One message at most every 30 seconds per person. Anything arriving in between is combined into the next one.
const COOLDOWN = 30000;
const queues = new Map(); // subId -> { last, items, timer }

function enqueue(sub, record) {
  const id = subId(sub.channel, sub.userId);
  const q = queues.get(id) || { last: 0, items: [], timer: null };
  queues.set(id, q);
  q.items.push(record);
  if (q.timer) return;
  q.timer = setTimeout(() => flush(id), Math.max(0, q.last + COOLDOWN - Date.now()));
  q.timer.unref?.();
}

async function flush(id) {
  const q = queues.get(id);
  if (!q) return;
  const items = q.items.splice(0);
  q.timer = null; q.last = Date.now();
  const sub = subs()[id];
  if (!sub?.on || !items.length) return;
  try {
    const allowed = [];
    for (const r of items) if (await checker(sub, communityKey(r.platform, r.communityId))) allowed.push(r);
    if (allowed.length) await sender(sub.channel, sub.userId, composeText(allowed));
  } catch (e) {
    console.error(`[notify] could not send a ${sub.channel} alert: ${e.message}`);
  }
}

// Called for every new Pulse message. Never throws and never blocks the chat.
export function notifyNewDiscussion(record) {
  try {
    if (!NOTIFY_KINDS.includes(record.kind)) return;
    const key = communityKey(record.platform, record.communityId);
    for (const sub of Object.values(subs())) {
      if (sub.on && sub.kinds.includes(record.kind) && sub.keys.includes(key)) enqueue(sub, record);
    }
  } catch (e) {
    console.error('[notify]', e.message);
  }
}
