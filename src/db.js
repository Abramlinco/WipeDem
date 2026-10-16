import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { nanoid } from 'nanoid';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultBrief } from './pulse/reply.js';
import { monthKey } from './pulse/x.js';
import { poolChunks } from './pulse/pools.js';

// Everything the app remembers lives in one JSON file so you can open
// data/db.json and see exactly what the bot knows. This is the ONLY file
// that touches storage, so when you move to Postgres later, this is the
// only file that changes. Set SENTINEL_DB_FILE to point somewhere else.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = process.env.SENTINEL_DB_FILE || path.join(__dirname, '..', 'data', 'db.json');
fs.mkdirSync(path.dirname(file), { recursive: true });

const defaultData = {
  alerts: [],           // every flagged message
  networkFlags: {},     // userId -> [{ platform, guildOrChatId, guildOrChatName, username, reason, at }]
  discordSettings: {},  // guildId -> settings
  telegramSettings: {}, // chatId -> settings
  communities: {},      // "platform:id" -> { platform, id, name, lastSeen }
  memberEvents: [],     // joins and leaves
  cautions: [],         // warnings given to users
  sessions: {},         // login sessions
  dailyStats: {},       // "platform:id" -> { "YYYY-MM-DD": { scanned, flagged } }
  memberCounts: {},     // "platform:id" -> { "YYYY-MM-DD": memberCount }
  discussions: [],      // Pulse: relevant community messages (ideas, questions, concerns...)
  trends: [],           // Pulse: stories gathered from the web by the feeder
  pulseMeta: { lastRefresh: null, sources: {} }, // Pulse: when feeds last ran and which ones are failing
  knowledge: { sources: [] }, // Pulse: documents, pages and live data each community lets the drafter use
  pools: { items: [], events: [] }, // Pulse: pools each community watches, and what changed in them
  xAccounts: {},   // Pulse: encrypted X keys/tokens per community. Kept apart from settings so they can never be sent to the browser.
  campaigns: [],    // Pulse: manager-created campaign plans, scoped to a community
  postLog: []      // Pulse: who posted what, where
};

// The file is read once at start. From then on memory is the source of truth
// and every change is saved right away. Re-reading the file on every
// operation let two things happening at the same moment overwrite each other.
export const db = new Low(new JSONFile(file), structuredClone(defaultData));

export async function initDb() {
  await db.read();
  db.data ||= structuredClone(defaultData);
  // Older data files from earlier versions are missing the newer sections.
  for (const k of Object.keys(defaultData)) db.data[k] ??= structuredClone(defaultData[k]);
  rebuildMessageIndex();
  await db.write();
}

const today = () => new Date().toISOString().slice(0, 10);
export const communityKey = (platform, id) => `${platform}:${id}`;

/* ------------------------------------------------------------------ */
/* Rules and settings                                                  */
/* ------------------------------------------------------------------ */

const rule = (label, enabled, keywords) => ({
  label, enabled, keywords,
  // mode: 'escalate' follows the tiers below. Or force one penalty for this rule.
  penalty: { mode: 'escalate', minutes: 10 }
});

export function defaultRuleSet() {
  return {
    impersonationOffer: rule('Unsolicited DM offer', true, [
      'dm me', 'send me a dm', "i've sent you a dm", 'i have sent you a message',
      'check your dm', 'check your inbox', 'message me privately', 'reach out to me directly'
    ]),
    identityClaim: rule('False admin or mod claim', true, [
      'i am an admin', "i'm an admin", 'i am a moderator', "i'm a moderator",
      'this is the admin', 'as an admin', 'official admin here'
    ]),
    suspiciousLinks: {
      ...rule('Suspicious links', true, [
        'bit.ly', 'tinyurl.com', 'cutt.ly', 'is.gd', 'rebrand.ly', 'shorturl.at', 'tiny.cc', 'rb.gy',
        'claim your airdrop', 'connect wallet to claim', 'verify your wallet', 'limited time claim'
      ]),
      // On, by default, means no link at all from anyone who is not a real
      // admin or moderator, not just links that look risky. This is the
      // strict, lock it down setting. Turn it off to go back to only
      // catching shorteners, disguised domains, and pushed links.
      strictMode: true
    },
    bannedWords: rule('Banned words', false, [])
  };
}

export const DEFAULT_LINK_BLOCKED_MESSAGE =
  'Links are not allowed here except from admins and moderators. If you have a question or a complaint, ' +
  'please open a support ticket and tag a mod there.';

export function defaultEscalation() {
  return {
    tier1: { count: 1, action: 'delete' },
    tier2: { count: 3, action: 'mute', minutes: 10 },
    tier3: { count: 5, action: 'flag_for_ban' }
  };
}

export const DEFAULT_CAUTION =
  'Reminder from the admins: real admins never ask you to DM them and never send a DM first. ' +
  'Ignore anyone who does, and report them here.';

function normalizeSettings(s = {}) {
  let changed = false;
  if (!s.rules) { s.rules = defaultRuleSet(); changed = true; }
  // A community that already saved settings before a new built in rule
  // existed would otherwise never see it, since its rule set was already
  // created. Add anything missing, but never touch a rule already there.
  for (const [key, r] of Object.entries(defaultRuleSet())) {
    if (!s.rules[key]) { s.rules[key] = r; changed = true; }
  }
  for (const r of Object.values(s.rules)) {
    r.keywords ||= [];
    r.penalty ||= { mode: 'escalate', minutes: 10 };
  }
  if (!s.escalation) { s.escalation = defaultEscalation(); changed = true; }
  s.adminRoleIds ||= [];
  if (!s.cautionMessage) { s.cautionMessage = DEFAULT_CAUTION; changed = true; }
  if (!s.linkBlockedMessage) { s.linkBlockedMessage = DEFAULT_LINK_BLOCKED_MESSAGE; changed = true; }
  if (s.rules.suspiciousLinks && s.rules.suspiciousLinks.strictMode === undefined) {
    s.rules.suspiciousLinks.strictMode = true;
    changed = true;
  }
  s.strikeWindowDays ||= 7;
  // Pulse: whether this community's chat is read for ideas, plus any feeds
  // the community manager added themselves.
  if (s.intelEnabled === undefined) { s.intelEnabled = true; changed = true; }
  s.intelSources ||= [];
  // The Project Brief the reply drafter is allowed to use. See src/pulse/reply.js.
  if (!s.brief) { s.brief = defaultBrief(); changed = true; }
  if (!s.replyModes) { s.replyModes = { question: 'manual', idea: 'manual', concern: 'manual' }; changed = true; }
  if (!s.focus) { s.focus = { topics: [], custom: [] }; changed = true; }
  return { settings: s, changed };
}

const bucketFor = (platform) =>
  platform === 'discord' ? db.data.discordSettings : db.data.telegramSettings;

export async function getSettings(platform, id) {
  const bucket = bucketFor(platform);
  const isNew = !bucket[id];
  const { settings, changed } = normalizeSettings(bucket[id]);
  bucket[id] = settings;
  if (isNew || changed) await db.write();
  return bucket[id];
}

export async function saveSettings(platform, id, settings) {
  bucketFor(platform)[id] = normalizeSettings(settings).settings;
  await db.write();
  return bucketFor(platform)[id];
}

/* ------------------------------------------------------------------ */
/* Communities (servers and groups the bot is in)                      */
/* ------------------------------------------------------------------ */

const knownKeys = new Map(); // avoids writing the file on every single message

export async function upsertCommunity({ platform, id, name }) {
  const key = communityKey(platform, String(id));
  if (knownKeys.get(key) === name) return;
  const existing = db.data.communities[key];
  if (!existing || existing.name !== name) {
    db.data.communities[key] = { platform, id: String(id), name, lastSeen: new Date().toISOString() };
    await db.write();
  }
  knownKeys.set(key, name);
}

export async function removeCommunity(platform, id) {
  delete db.data.communities[communityKey(platform, String(id))];
  knownKeys.delete(communityKey(platform, String(id)));
  await db.write();
}

export async function listCommunities(platform) {
  return Object.values(db.data.communities).filter(c => !platform || c.platform === platform);
}

/* ------------------------------------------------------------------ */
/* Alerts                                                              */
/* ------------------------------------------------------------------ */

export async function addAlert(alert) {
  const record = {
    id: nanoid(10),
    resolved: false,
    resolution: null,
    createdAt: new Date().toISOString(),
    ...alert
  };
  db.data.alerts.unshift(record);
  db.data.alerts = db.data.alerts.slice(0, 5000);
  await db.write();
  return record;
}

const alertKey = (a) => communityKey(a.platform, a.guildId);

export async function listAlerts({ resolved, communityKeys, platform, userId, since, limit } = {}) {
  let out = db.data.alerts;
  if (communityKeys) out = out.filter(a => communityKeys.has(alertKey(a)));
  if (platform) out = out.filter(a => a.platform === platform);
  if (userId) out = out.filter(a => a.userId === String(userId));
  if (resolved !== undefined) out = out.filter(a => a.resolved === resolved);
  if (since) out = out.filter(a => a.createdAt >= since);
  return limit ? out.slice(0, limit) : out;
}

// How many times this person has already been flagged in this community
// recently. Counted from saved alerts, so it survives restarts.
export async function countStrikes(platform, communityId, userId, windowDays = 7) {
  const since = new Date(Date.now() - windowDays * 86400000).toISOString();
  return db.data.alerts.filter(a =>
    a.platform === platform && a.guildId === String(communityId) &&
    a.userId === String(userId) && a.createdAt >= since).length;
}

export async function resolveAlertsForUser(platform, communityId, userId, resolution) {
  let n = 0;
  for (const a of db.data.alerts) {
    if (!a.resolved && a.platform === platform && a.guildId === String(communityId) && a.userId === String(userId)) {
      a.resolved = true;
      a.resolution = resolution;
      a.resolvedAt = new Date().toISOString();
      n++;
    }
  }
  if (n) await db.write();
  return n;
}

/* ------------------------------------------------------------------ */
/* Shared network                                                      */
/* ------------------------------------------------------------------ */

export async function addNetworkFlag(userId, entry) {
  const id = String(userId);
  (db.data.networkFlags[id] ||= []).push({ at: new Date().toISOString(), ...entry });
  if (db.data.networkFlags[id].length > 200) db.data.networkFlags[id].shift();
  await db.write();
}

export async function getNetworkHistory(userId) {
  return db.data.networkFlags[String(userId)] || [];
}

// Other communities only. Never expose another project's name to a customer.
export function summarizeNetwork(entries, platform, communityId) {
  const others = entries.filter(e => !(e.platform === platform && e.guildOrChatId === String(communityId)));
  const unique = new Set(others.map(e => `${e.platform}:${e.guildOrChatId}`));
  return {
    communities: unique.size,
    reasons: [...new Set(others.map(e => e.reason))].slice(0, 5),
    lastSeen: others.length ? others[others.length - 1].at : null
  };
}

export async function searchNetwork(q, limit = 50) {
  const needle = String(q || '').toLowerCase().trim();
  const rows = Object.entries(db.data.networkFlags).map(([userId, entries]) => {
    const last = entries[entries.length - 1];
    return {
      userId,
      username: last?.username || '',
      communities: new Set(entries.map(e => `${e.platform}:${e.guildOrChatId}`)).size,
      platforms: [...new Set(entries.map(e => e.platform))],
      reasons: [...new Set(entries.map(e => e.reason))].slice(0, 4),
      lastSeen: last?.at
    };
  });
  return rows
    .filter(r => !needle || r.userId.includes(needle) || r.username.toLowerCase().includes(needle))
    .sort((a, b) => String(b.lastSeen).localeCompare(String(a.lastSeen)))
    .slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* Joins, leaves, cautions                                             */
/* ------------------------------------------------------------------ */

export async function addMemberEvent(evt) {
  db.data.memberEvents.push({ at: new Date().toISOString(), ...evt });
  if (db.data.memberEvents.length > 50000) db.data.memberEvents.splice(0, 5000);
  await db.write();
}

export async function listMemberEvents({ communityKeys, since, userId } = {}) {
  return db.data.memberEvents.filter(e =>
    (!communityKeys || communityKeys.has(communityKey(e.platform, e.communityId))) &&
    (!since || e.at >= since) && (!userId || e.userId === String(userId)));
}

export async function addCaution(c) {
  db.data.cautions.push({ id: nanoid(8), at: new Date().toISOString(), ...c });
  await db.write();
}

export async function listCautions({ platform, communityId, userId } = {}) {
  return db.data.cautions.filter(c =>
    (!platform || c.platform === platform) &&
    (!communityId || c.communityId === String(communityId)) &&
    (!userId || c.userId === String(userId)));
}

/* ------------------------------------------------------------------ */
/* Daily counters (messages scanned) kept in memory and saved in batches */
/* ------------------------------------------------------------------ */

const pending = new Map(); // "key|date|field" -> n
let dirty = false;         // Pulse changes waiting to be saved with the next batch

export function bumpStat(key, field, n = 1) {
  const k = `${key}|${today()}|${field}`;
  pending.set(k, (pending.get(k) || 0) + n);
}

export async function flushStats() {
  if (!pending.size && !dirty) return;
  for (const [k, n] of pending) {
    const [key, date, field] = k.split('|');
    const day = ((db.data.dailyStats[key] ||= {})[date] ||= { scanned: 0, flagged: 0 });
    day[field] = (day[field] || 0) + n;
  }
  pending.clear();
  dirty = false;
  await db.write();
}

export async function recordMemberCount(key, count) {
  (db.data.memberCounts[key] ||= {})[today()] = count;
  await db.write();
}

export async function getStats(communityKeys) {
  await flushStats();
  const t = today();
  const keys = [...communityKeys];
  const todays = db.data.alerts.filter(a => communityKeys.has(alertKey(a)) && a.createdAt.slice(0, 10) === t);
  const events = db.data.memberEvents.filter(e =>
    communityKeys.has(communityKey(e.platform, e.communityId)) && e.at.slice(0, 10) === t);
  return {
    threatsToday: todays.length,
    awaitingReview: db.data.alerts.filter(a => communityKeys.has(alertKey(a)) && !a.resolved).length,
    knownFromNetwork: todays.filter(a => a.seenElsewhere).length,
    scannedToday: keys.reduce((n, k) => n + (db.data.dailyStats[k]?.[t]?.scanned || 0), 0),
    joinsToday: events.filter(e => e.type === 'join').length,
    leavesToday: events.filter(e => e.type === 'leave').length
  };
}

export async function getDailyScanned(communityKeys, since) {
  await flushStats();
  const out = {};
  for (const k of communityKeys) {
    for (const [date, v] of Object.entries(db.data.dailyStats[k] || {})) {
      if (date >= since.slice(0, 10)) out[date] = (out[date] || 0) + (v.scanned || 0);
    }
  }
  return out;
}

export async function getMemberCounts(communityKeys, since) {
  const out = {};
  for (const k of communityKeys) {
    for (const [date, n] of Object.entries(db.data.memberCounts[k] || {})) {
      if (date >= since.slice(0, 10)) out[date] = (out[date] || 0) + n;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Login sessions                                                      */
/* ------------------------------------------------------------------ */

export async function getSessionRecord(id) {
  const s = db.data.sessions[id];
  if (!s) return null;
  if (new Date(s.expiresAt) < new Date()) {
    delete db.data.sessions[id];
    await db.write();
    return null;
  }
  return s;
}

export async function saveSessionRecord(session) {
  db.data.sessions[session.id] = session;
  await db.write();
  return session;
}

export async function deleteSessionRecord(id) {
  delete db.data.sessions[id];
  await db.write();
}

/* ------------------------------------------------------------------ */
/* Pulse: community discussions                                        */
/* ------------------------------------------------------------------ */

// Chat is busy, so these changes stay in memory and are saved with the next
// batch (every 15 seconds, see flushStats) instead of rewriting the file on
// every message.
const MAX_DISCUSSIONS = 5000;
const msgIndex = new Map(); // "platform:community:messageId" -> discussion, so replies can find their parent
const msgKey = (platform, communityId, messageId) => `${platform}:${communityId}:${messageId}`;

function rebuildMessageIndex() {
  msgIndex.clear();
  for (const d of db.data.discussions) {
    if (d.messageId) msgIndex.set(msgKey(d.platform, d.communityId, d.messageId), d);
  }
}

export function addDiscussion(item) {
  const record = {
    id: nanoid(10), status: 'new', replies: 0, staffReplied: false,
    createdAt: new Date().toISOString(), ...item
  };
  db.data.discussions.unshift(record);
  if (record.messageId) msgIndex.set(msgKey(record.platform, record.communityId, record.messageId), record);
  if (db.data.discussions.length > MAX_DISCUSSIONS) {
    for (const old of db.data.discussions.splice(MAX_DISCUSSIONS)) {
      if (old.messageId) msgIndex.delete(msgKey(old.platform, old.communityId, old.messageId));
    }
  }
  dirty = true;
  return record;
}

// Someone replied to a message we kept. Counting replies shows which ideas
// got people talking, and a staff reply marks a question as answered.
export function noteReply(platform, communityId, parentMessageId, byStaff) {
  const parent = msgIndex.get(msgKey(platform, String(communityId), String(parentMessageId)));
  if (!parent) return false;
  if (byStaff) parent.staffReplied = true; else parent.replies++;
  dirty = true;
  return true;
}

export function listDiscussions({ communityKeys, platform, kind, status, topic, since, limit } = {}) {
  let out = db.data.discussions;
  if (communityKeys) out = out.filter(d => communityKeys.has(communityKey(d.platform, d.communityId)));
  if (platform) out = out.filter(d => d.platform === platform);
  if (kind) out = out.filter(d => d.kind === kind);
  if (status) out = out.filter(d => status === 'active' ? (d.status === 'new' || d.status === 'starred') : d.status === status);
  if (topic) out = out.filter(d => d.topics?.includes(topic));
  if (since) out = out.filter(d => d.createdAt >= since);
  return limit ? out.slice(0, limit) : out;
}

export async function setDiscussionStatus(id, communityKeys, status) {
  const d = db.data.discussions.find(x => x.id === id);
  // A person can only touch discussions from communities they manage.
  if (!d || !communityKeys.has(communityKey(d.platform, d.communityId))) return null;
  d.status = status;
  await db.write();
  return d;
}

// One discussion, but only if it belongs to a community this person manages.
export function getDiscussion(id, communityKeys) {
  const d = db.data.discussions.find(x => x.id === id);
  return d && communityKeys.has(communityKey(d.platform, d.communityId)) ? d : null;
}

export async function markReplied(id, communityKeys, text, by) {
  const d = getDiscussion(id, communityKeys);
  if (!d) return null;
  d.reply = { text, by, at: new Date().toISOString() };
  d.staffReplied = true;
  d.status = 'done';
  await db.write();
  return d;
}

export async function pruneDiscussions(retentionDays = 30) {
  const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();
  const before = db.data.discussions.length;
  db.data.discussions = db.data.discussions.filter(d => d.createdAt >= cutoff);
  if (db.data.discussions.length !== before) { rebuildMessageIndex(); await db.write(); }
}

/* ------------------------------------------------------------------ */
/* Pulse: trends gathered from the web                                 */
/* ------------------------------------------------------------------ */

const MAX_TRENDS = 800;

// ownerKey is null for the built in feeds everyone sees, or a community key
// for a feed that one community added, which only that community sees.
export async function upsertTrends(items) {
  const have = new Set(db.data.trends.map(t => t.id));
  let added = 0;
  for (const t of items) {
    if (have.has(t.id)) continue;
    db.data.trends.unshift(t);
    have.add(t.id);
    added++;
  }
  const cutoff = new Date(Date.now() - 14 * 86400000).toISOString();
  db.data.trends = db.data.trends.filter(t => (t.publishedAt || t.fetchedAt) >= cutoff).slice(0, MAX_TRENDS);
  await db.write();
  return added;
}

export function listTrends({ communityKeys, since, limit } = {}) {
  let out = db.data.trends.filter(t => !t.ownerKey || !communityKeys || communityKeys.has(t.ownerKey));
  if (since) out = out.filter(t => (t.publishedAt || t.fetchedAt) >= since);
  return limit ? out.slice(0, limit) : out;
}

export async function setSourceStatus(sourceId, status) {
  db.data.pulseMeta.sources[sourceId] = { ...status, at: new Date().toISOString() };
}
export async function finishRefresh() {
  db.data.pulseMeta.lastRefresh = new Date().toISOString();
  await db.write();
}
export const getPulseMeta = () => db.data.pulseMeta;

// Feeds that individual communities added in their settings.
export function listCustomSources() {
  const out = [];
  for (const [platform, bucket] of [['discord', db.data.discordSettings], ['telegram', db.data.telegramSettings]]) {
    for (const [id, s] of Object.entries(bucket)) {
      for (const src of s.intelSources || []) out.push({ ...src, ownerKey: communityKey(platform, id) });
    }
  }
  return out;
}

// Lets code outside this file say "a discussion changed, save it with the next batch".
export const touchDiscussions = () => { dirty = true; };

// Communities that switched on focus topics. The feeder reads this.
export function listFocusSettings() {
  const out = [];
  for (const [platform, bucket] of [['discord', db.data.discordSettings], ['telegram', db.data.telegramSettings]]) {
    for (const [id, s] of Object.entries(bucket)) {
      if (s.focus?.topics?.length || s.focus?.custom?.length) out.push({ ownerKey: communityKey(platform, id), focus: s.focus });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Pulse: knowledge bank                                               */
/* ------------------------------------------------------------------ */

const KNOWLEDGE_MAX_SOURCES = 30;

export const knowledgeSourcesFor = (key) => db.data.knowledge.sources.filter((s) => s.communityKey === key);

// The list the dashboard shows. The chunks themselves are not sent to the browser.
export function listKnowledge(key) {
  return knowledgeSourcesFor(key).map(({ chunks, text, ...rest }) => ({ ...rest, chunkCount: chunks?.length || 0, chars: rest.chars || 0 }));
}

// Everything a community's drafter may draw on, flattened for searching.
export function knowledgeChunks(key) {
  const out = [...poolChunks(db.data.pools.items.filter((p) => p.communityKey === key))];
  for (const s of knowledgeSourcesFor(key)) {
    for (const c of s.chunks || []) out.push({ text: c.text, search: c.search || '', live: !!c.live, at: c.at || s.fetchedAt, sourceId: s.id, title: s.title, url: s.url || '' });
  }
  return out;
}

export async function addKnowledgeSource(key, src) {
  if (knowledgeSourcesFor(key).length >= KNOWLEDGE_MAX_SOURCES) throw new Error(`That is the most sources allowed (${KNOWLEDGE_MAX_SOURCES})`);
  const record = { id: nanoid(10), communityKey: key, status: 'pending', error: null, chunks: [], fetchedAt: null, lastTried: null, createdAt: new Date().toISOString(), ...src };
  db.data.knowledge.sources.push(record);
  await db.write();
  return record;
}

// Only a source from a community this person manages.
export function getKnowledgeSource(id, communityKeys) {
  const s = db.data.knowledge.sources.find((x) => x.id === id);
  return s && communityKeys.has(s.communityKey) ? s : null;
}

export async function saveKnowledgeResult(id, result) {
  const s = db.data.knowledge.sources.find((x) => x.id === id);
  if (!s) return;
  s.chunks = result.chunks; s.chars = result.chars; s.status = 'ok'; s.error = null;
  if (result.title && s.type !== 'text') s.title = s.title || result.title;
  s.fetchedAt = s.lastTried = new Date().toISOString();
  await db.write();
}

export async function saveKnowledgeError(id, message) {
  const s = db.data.knowledge.sources.find((x) => x.id === id);
  if (!s) return;
  s.status = 'error'; s.error = String(message).slice(0, 200); s.lastTried = new Date().toISOString();
  await db.write(); // old chunks are kept, so a temporary failure does not wipe what Pulse knew
}

export async function deleteKnowledgeSource(id, communityKeys) {
  const s = getKnowledgeSource(id, communityKeys);
  if (!s) return false;
  db.data.knowledge.sources = db.data.knowledge.sources.filter((x) => x.id !== id);
  await db.write();
  return true;
}

// Web and live sources are re-read on their own schedule. A failing one is retried after an hour at most.
export function dueKnowledge(now = Date.now()) {
  return db.data.knowledge.sources.filter((s) => {
    if (s.type === 'text') return false;
    const last = s.lastTried ? new Date(s.lastTried).getTime() : 0;
    const every = (s.status === 'error' ? Math.min(s.refreshHours || 24, 1) : (s.refreshHours || 24)) * 3600000;
    return now - last >= every;
  });
}

/* ------------------------------------------------------------------ */
/* Pulse: pools                                                        */
/* ------------------------------------------------------------------ */

const MAX_POOLS = 20, MAX_EVENTS = 500, EVENT_QUIET_HOURS = 12;

export const poolItemsFor = (key) => db.data.pools.items.filter((p) => p.communityKey === key);

export function listPoolItems(communityKeys) {
  return db.data.pools.items.filter((p) => communityKeys.has(p.communityKey));
}

export async function addPoolItem(key, item) {
  if (poolItemsFor(key).length >= MAX_POOLS) throw new Error(`That is the most pools allowed (${MAX_POOLS}). Remove one first.`);
  const dup = poolItemsFor(key).find((p) => p.kind === item.kind && p.chain === item.chain && String(p.address).toLowerCase() === String(item.address).toLowerCase());
  if (dup) throw new Error('You are already watching that.');
  const record = { id: nanoid(10), communityKey: key, status: 'pending', error: null, snapshot: null, history: [], lastEvents: {}, createdAt: new Date().toISOString(), lastTried: null, ...item };
  db.data.pools.items.push(record);
  await db.write();
  return record;
}

export function getPoolItem(id, communityKeys) {
  const p = db.data.pools.items.find((x) => x.id === id);
  return p && communityKeys.has(p.communityKey) ? p : null;
}

export async function deletePoolItem(id, communityKeys) {
  if (!getPoolItem(id, communityKeys)) return false;
  db.data.pools.items = db.data.pools.items.filter((x) => x.id !== id);
  db.data.pools.events = db.data.pools.events.filter((e) => e.itemId !== id);
  await db.write();
  return true;
}

// Stores a fresh reading, and any changes worth telling a person about. The same kind of
// change is not announced again for a few hours, so one busy day does not fill the feed.
export async function savePoolResult(id, { snapshot, error, events = [] }) {
  const p = db.data.pools.items.find((x) => x.id === id);
  if (!p) return [];
  const now = new Date().toISOString();
  p.lastTried = now;
  if (error) { p.status = 'error'; p.error = String(error).slice(0, 200); await db.write(); return []; }
  p.status = 'ok'; p.error = null; p.snapshot = snapshot;
  if (snapshot.label && !p.label) p.label = snapshot.label;
  const last = p.history[p.history.length - 1];
  if (!last || Date.now() - new Date(last.at).getTime() > 45 * 60000) {
    p.history.push({ at: snapshot.at, tvlUsd: snapshot.tvlUsd ?? null, volume24h: snapshot.volume24h ?? null, apy: snapshot.apy ?? null, count: snapshot.pairs?.length ?? null });
    if (p.history.length > 100) p.history.shift();
  }
  const fresh = [];
  for (const e of events) {
    const prev = p.lastEvents[e.type];
    if (prev && Date.now() - new Date(prev).getTime() < EVENT_QUIET_HOURS * 3600000) continue;
    p.lastEvents[e.type] = now;
    const rec = { id: nanoid(10), communityKey: p.communityKey, itemId: p.id, poolLabel: p.label || 'Pool', url: snapshot.url || p.url || '', at: now, ...e };
    db.data.pools.events.unshift(rec); fresh.push(rec);
  }
  if (db.data.pools.events.length > MAX_EVENTS) db.data.pools.events.length = MAX_EVENTS;
  await db.write();
  return fresh;
}

export function listPoolEvents({ communityKeys, since, limit = 100 } = {}) {
  let out = db.data.pools.events;
  if (communityKeys) out = out.filter((e) => communityKeys.has(e.communityKey));
  if (since) out = out.filter((e) => e.at >= since);
  return out.slice(0, limit);
}

export function duePools(now = Date.now(), minutes = 20) {
  return db.data.pools.items.filter((p) => !p.lastTried || now - new Date(p.lastTried).getTime() >= minutes * 60000 * (p.status === 'error' ? 3 : 1));
}

/* ------------------------------------------------------------------ */
/* Pulse: X                                                            */
/* ------------------------------------------------------------------ */

// Reading X costs money per post, so every read is counted against a monthly limit.
export function xUsage() {
  const meta = db.data.pulseMeta;
  const m = monthKey();
  if (!meta.xUsage || meta.xUsage.month !== m) meta.xUsage = { month: m, reads: 0 };
  return meta.xUsage;
}
export async function addXReads(n) { const u = xUsage(); u.reads = Math.max(0, u.reads + n); await db.write(); }
export const getXLastRun = () => db.data.pulseMeta.xLastRun || null;
export async function setXLastRun() { db.data.pulseMeta.xLastRun = new Date().toISOString(); await db.write(); }

export const getXAccount = (key) => db.data.xAccounts[key] || null;
export async function setXAccount(key, rec) { db.data.xAccounts[key] = rec; await db.write(); }
export async function deleteXAccount(key) { delete db.data.xAccounts[key]; await db.write(); }

export async function logPost(entry) {
  db.data.postLog.unshift({ at: new Date().toISOString(), ...entry });
  if (db.data.postLog.length > 300) db.data.postLog.length = 300;
  await db.write();
}


/* ------------------------------------------------------------------ */
/* Pulse: campaign plans                                               */
/* ------------------------------------------------------------------ */
export function listCampaigns(communityKeys, { limit = 100 } = {}) {
  return db.data.campaigns.filter((c) => communityKeys.has(c.communityKey)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
}
export async function addCampaign(rec) {
  db.data.campaigns.unshift(rec);
  if (db.data.campaigns.length > 1000) db.data.campaigns.length = 1000;
  await db.write(); return rec;
}
export async function updateCampaign(id, communityKeys, patch) {
  const c = db.data.campaigns.find((x) => x.id === id && communityKeys.has(x.communityKey));
  if (!c) return null;
  Object.assign(c, patch, { updatedAt: new Date().toISOString() }); await db.write(); return c;
}
export async function deleteCampaign(id, communityKeys) {
  const n = db.data.campaigns.length; db.data.campaigns = db.data.campaigns.filter((x) => !(x.id === id && communityKeys.has(x.communityKey)));
  if (db.data.campaigns.length === n) return false; await db.write(); return true;
}
