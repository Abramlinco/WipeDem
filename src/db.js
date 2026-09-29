import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { nanoid } from 'nanoid';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  memberCounts: {}      // "platform:id" -> { "YYYY-MM-DD": memberCount }
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
    bannedWords: rule('Banned words', false, [])
  };
}

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
  s.rules ||= defaultRuleSet();
  for (const r of Object.values(s.rules)) {
    r.keywords ||= [];
    r.penalty ||= { mode: 'escalate', minutes: 10 };
  }
  s.escalation ||= defaultEscalation();
  s.adminRoleIds ||= [];
  s.cautionMessage ||= DEFAULT_CAUTION;
  s.strikeWindowDays ||= 7;
  return s;
}

const bucketFor = (platform) =>
  platform === 'discord' ? db.data.discordSettings : db.data.telegramSettings;

export async function getSettings(platform, id) {
  const bucket = bucketFor(platform);
  const isNew = !bucket[id];
  bucket[id] = normalizeSettings(bucket[id]);
  if (isNew) await db.write();
  return bucket[id];
}

export async function saveSettings(platform, id, settings) {
  bucketFor(platform)[id] = normalizeSettings(settings);
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

export function bumpStat(key, field, n = 1) {
  const k = `${key}|${today()}|${field}`;
  pending.set(k, (pending.get(k) || 0) + n);
}

export async function flushStats() {
  if (!pending.size) return;
  for (const [k, n] of pending) {
    const [key, date, field] = k.split('|');
    const day = ((db.data.dailyStats[key] ||= {})[date] ||= { scanned: 0, flagged: 0 });
    day[field] = (day[field] || 0) + n;
  }
  pending.clear();
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
