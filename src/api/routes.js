import { Router } from 'express';
import { requireLogin } from '../auth/sessions.js';
import { getAccess } from '../access.js';
import { platforms } from '../platform.js';
import { defaultEscalation } from '../db.js';
import {
  listAlerts, resolveAlertsForUser, getStats, getSettings, saveSettings, addCaution, listCautions,
  listMemberEvents, getNetworkHistory, summarizeNetwork, searchNetwork, getDailyScanned, getMemberCounts,
  communityKey
} from '../db.js';

export const apiRouter = Router();

/* ---------- guards ---------- */

apiRouter.use(requireLogin);

// Changing anything must be a JSON request. A web page on another site
// cannot send one, which shuts out forged requests.
apiRouter.use((req, res, next) => {
  const type = String(req.headers['content-type'] || '');
  if (['POST', 'PUT', 'DELETE'].includes(req.method) && !type.startsWith('application/json')) {
    return res.status(415).json({ error: 'JSON required' });
  }
  next();
});

apiRouter.use(async (req, res, next) => {
  try { req.access = await getAccess(req.session); next(); } catch (err) { next(err); }
});

const PLATFORMS = ['discord', 'telegram'];

// The set of community keys a request is allowed to look at, narrowed by
// the optional ?community= and ?platform= filters.
function scopeKeys(req) {
  let keys = [...req.access.keys];
  const { community, platform } = req.query;
  if (platform) keys = keys.filter(k => k.startsWith(`${platform}:`));
  if (community && community !== 'all') keys = keys.filter(k => k === community);
  return new Set(keys);
}

function guard(req, res, next) {
  const { platform, communityId } = req.params;
  if (!PLATFORMS.includes(platform)) return res.status(400).json({ error: 'Unknown platform' });
  if (!req.access.keys.has(communityKey(platform, communityId))) {
    return res.status(403).json({ error: 'You do not manage that community.' });
  }
  next();
}

const communityName = (req, platform, id) =>
  req.access.communities.find(c => c.key === communityKey(platform, id))?.name || '';

/* ---------- who am I ---------- */

apiRouter.get('/me', (req, res) => {
  const s = req.session;
  res.json({
    discord: s.discord?.user ? { user: s.discord.user } : null,
    telegram: s.telegram?.user ? { user: s.telegram.user } : null,
    communities: req.access.communities,
    invites: req.access.invites
  });
});

/* ---------- overview and lists ---------- */

apiRouter.get('/stats', async (req, res) => {
  res.json(await getStats(scopeKeys(req)));
});

apiRouter.get('/alerts', async (req, res) => {
  const resolved = req.query.resolved === undefined ? undefined : req.query.resolved === 'true';
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.json(await listAlerts({ communityKeys: scopeKeys(req), resolved, limit }));
});

/* ---------- a person's profile and actions ---------- */

apiRouter.get('/users/:platform/:communityId/:userId', guard, async (req, res) => {
  const { platform, communityId, userId } = req.params;
  const key = communityKey(platform, communityId);
  const alerts = await listAlerts({ communityKeys: new Set([key]), userId });
  const cautions = await listCautions({ platform, communityId, userId });
  const events = await listMemberEvents({ communityKeys: new Set([key]), userId });
  const network = summarizeNetwork(await getNetworkHistory(userId), platform, communityId);
  const latest = alerts[0];
  res.json({
    userId,
    username: latest?.username || events[events.length - 1]?.username || 'unknown',
    platform,
    communityId,
    communityName: communityName(req, platform, communityId),
    joinedAt: events.find(e => e.type === 'join')?.at || null,
    firstFlagged: alerts.length ? alerts[alerts.length - 1].createdAt : null,
    flaggedCount: alerts.length,
    openCount: alerts.filter(a => !a.resolved).length,
    cautionCount: cautions.length,
    lastResolution: alerts.find(a => a.resolved)?.resolution || null,
    recent: alerts.slice(0, 5).map(a => ({
      id: a.id, text: a.text, ruleLabel: a.ruleLabel, actionTaken: a.actionTaken,
      channelName: a.channelName, createdAt: a.createdAt, resolution: a.resolution
    })),
    network
  });
});

apiRouter.post('/users/:platform/:communityId/:userId/action', guard, async (req, res) => {
  const { platform, communityId, userId } = req.params;
  const action = req.body?.action;
  if (!['ban', 'release', 'caution'].includes(action)) return res.status(400).json({ error: 'Unknown action' });

  const key = communityKey(platform, communityId);
  const alerts = await listAlerts({ communityKeys: new Set([key]), userId });
  const latest = alerts[0];
  const username = latest?.username || 'there';
  const impl = platforms[platform];

  if (action === 'ban') await impl.ban(communityId, userId);
  if (action === 'release') await impl.release(communityId, userId);
  if (action === 'caution') {
    const settings = await getSettings(platform, communityId);
    await impl.caution(communityId, { userId, username }, settings.cautionMessage, latest?.channelId);
    await addCaution({ platform, communityId, userId, username, by: req.session.id.slice(0, 8) });
  }

  const resolution = { ban: 'banned', release: 'released', caution: 'cautioned' }[action];
  await resolveAlertsForUser(platform, communityId, userId, resolution);
  res.json({ ok: true, resolution });
});

/* ---------- settings ---------- */

const settingsBase = '/settings/:platform/:communityId';
apiRouter.use(settingsBase, guard);

const cleanPhrase = (p) => String(p ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);
const toInt = (v, min, max, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
};
const ACTIONS = ['delete', 'mute', 'flag_for_ban'];

apiRouter.get(settingsBase, async (req, res) => {
  res.json(await getSettings(req.params.platform, req.params.communityId));
});

// Runs a change to the settings and sends back the result.
function edit(method, path, fn) {
  apiRouter[method](`${settingsBase}${path}`, async (req, res) => {
    const { platform, communityId } = req.params;
    const s = await getSettings(platform, communityId);
    const err = fn(s, req.body || {}, req.params);
    if (err) return res.status(err.status || 400).json({ error: err.error });
    res.json(await saveSettings(platform, communityId, s));
  });
}

edit('post', '/keywords', (s, { ruleKey, phrase }) => {
  const p = cleanPhrase(phrase);
  if (!s.rules[ruleKey]) return { status: 404, error: 'Unknown rule' };
  if (!p) return { error: 'Type a phrase first' };
  if (!s.rules[ruleKey].keywords.some(k => k.toLowerCase() === p.toLowerCase())) s.rules[ruleKey].keywords.push(p);
});

edit('delete', '/keywords', (s, { ruleKey, phrase }) => {
  if (!s.rules[ruleKey]) return { status: 404, error: 'Unknown rule' };
  s.rules[ruleKey].keywords = s.rules[ruleKey].keywords.filter(k => k.toLowerCase() !== String(phrase).toLowerCase());
});

edit('post', '/rule-toggle', (s, { ruleKey, enabled }) => {
  if (!s.rules[ruleKey]) return { status: 404, error: 'Unknown rule' };
  s.rules[ruleKey].enabled = !!enabled;
});

edit('post', '/rule-penalty', (s, { ruleKey, mode, minutes }) => {
  if (!s.rules[ruleKey]) return { status: 404, error: 'Unknown rule' };
  if (!['escalate', ...ACTIONS].includes(mode)) return { error: 'Unknown penalty' };
  s.rules[ruleKey].penalty = { mode, minutes: toInt(minutes, 1, 40320, 10) };
});

edit('post', '/rules', (s, { label }) => {
  const name = cleanPhrase(label).slice(0, 40);
  if (!name) return { error: 'Give the rule a name' };
  if (Object.keys(s.rules).length >= 20) return { error: 'That is the most rules allowed' };
  const key = `custom_${Date.now().toString(36)}`;
  s.rules[key] = { label: name, enabled: true, keywords: [], penalty: { mode: 'escalate', minutes: 10 } };
});

edit('delete', '/rules/:ruleKey', (s, _body, params) => {
  if (!params.ruleKey.startsWith('custom_') || !s.rules[params.ruleKey]) return { status: 404, error: 'Only your own rules can be deleted' };
  delete s.rules[params.ruleKey];
});

edit('post', '/escalation', (s, body) => {
  const base = defaultEscalation();
  for (const t of ['tier1', 'tier2', 'tier3']) {
    if (!body[t]) continue;
    const action = ACTIONS.includes(body[t].action) ? body[t].action : base[t].action;
    s.escalation[t] = { count: toInt(body[t].count, 0, 1000, 0), action, minutes: toInt(body[t].minutes, 1, 40320, 10) };
  }
  if (body.strikeWindowDays !== undefined) s.strikeWindowDays = toInt(body.strikeWindowDays, 1, 90, 7);
});

edit('post', '/caution-message', (s, { text }) => {
  const t = String(text ?? '').trim().slice(0, 400);
  if (!t) return { error: 'The message cannot be empty' };
  s.cautionMessage = t;
});

edit('post', '/admin-roles', (s, { roleIds }) => {
  s.adminRoleIds = (Array.isArray(roleIds) ? roleIds : []).map(String).slice(0, 50);
});

apiRouter.get('/telegram/:communityId/admins', (req, res, next) => {
  req.params.platform = 'telegram';
  guard(req, res, async () => {
    try { res.json(await platforms.telegram.admins(req.params.communityId)); } catch (e) { next(e); }
  });
});

apiRouter.get('/discord/:communityId/roles', (req, res, next) => {
  req.params.platform = 'discord';
  guard(req, res, async () => {
    try { res.json(await platforms.discord.roles(req.params.communityId)); } catch (e) { next(e); }
  });
});

/* ---------- reports ---------- */

const dayList = (days) => {
  const out = [];
  for (let i = days - 1; i >= 0; i--) out.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
  return out;
};
const sinceIso = (days) => new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10) + 'T00:00:00.000Z';
const rangeDays = (req) => toInt(req.query.days, 1, 90, 30);

apiRouter.get('/reports/misconduct', async (req, res) => {
  const days = rangeDays(req);
  const keys = scopeKeys(req);
  const since = sinceIso(days);
  const alerts = await listAlerts({ communityKeys: keys, since });
  const scanned = await getDailyScanned(keys, since);

  const perDay = Object.fromEntries(dayList(days).map(d => [d, 0]));
  const byRule = {}, byOffender = {};
  for (const a of alerts) {
    perDay[a.createdAt.slice(0, 10)] = (perDay[a.createdAt.slice(0, 10)] || 0) + 1;
    byRule[a.ruleLabel || 'Other'] = (byRule[a.ruleLabel || 'Other'] || 0) + 1;
    const k = `${a.platform}:${a.guildId}:${a.userId}`;
    (byOffender[k] ||= { userId: a.userId, username: a.username, platform: a.platform, communityId: a.guildId, community: a.guildName, count: 0, status: 'pending' }).count++;
    if (a.resolved) byOffender[k].status = a.resolution;
  }
  const count = (r) => alerts.filter(a => a.resolution === r).length;
  res.json({
    days: Object.entries(perDay).map(([date, flagged]) => ({ date, flagged, scanned: scanned[date] || 0 })),
    totals: {
      flagged: alerts.length,
      uniqueOffenders: Object.keys(byOffender).length,
      pending: alerts.filter(a => !a.resolved).length,
      banned: count('banned'), cautioned: count('cautioned'), released: count('released'),
      scanned: Object.values(scanned).reduce((a, b) => a + b, 0),
      fromNetwork: alerts.filter(a => a.seenElsewhere).length
    },
    byRule: Object.entries(byRule).map(([label, n]) => ({ label, count: n })).sort((a, b) => b.count - a.count),
    byPlatform: {
      discord: alerts.filter(a => a.platform === 'discord').length,
      telegram: alerts.filter(a => a.platform === 'telegram').length
    },
    topOffenders: Object.values(byOffender).sort((a, b) => b.count - a.count).slice(0, 10)
  });
});

apiRouter.get('/reports/growth', async (req, res) => {
  const days = rangeDays(req);
  const keys = scopeKeys(req);
  const since = sinceIso(days);
  const events = await listMemberEvents({ communityKeys: keys, since });
  const counts = await getMemberCounts(keys, since);

  const perDay = Object.fromEntries(dayList(days).map(d => [d, { joins: 0, leaves: 0 }]));
  const perCommunity = {};
  for (const e of events) {
    const d = e.at.slice(0, 10);
    const field = e.type === 'join' ? 'joins' : 'leaves';
    if (perDay[d]) perDay[d][field]++;
    const k = communityKey(e.platform, e.communityId);
    (perCommunity[k] ||= { key: k, platform: e.platform, name: communityName(req, e.platform, e.communityId) || e.communityName, joins: 0, leaves: 0 })[field]++;
  }
  const joins = events.filter(e => e.type === 'join').length;
  const leaves = events.length - joins;
  res.json({
    days: Object.entries(perDay).map(([date, v]) => ({ date, ...v, members: counts[date] ?? null })),
    totals: { joins, leaves, net: joins - leaves },
    communities: Object.values(perCommunity).sort((a, b) => b.joins - a.joins)
  });
});

// Spreadsheets treat text starting with = + - @ as a formula, and scam
// messages are written by strangers, so those get a harmless prefix.
const csvCell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

apiRouter.get('/reports/export.csv', async (req, res) => {
  const alerts = await listAlerts({ communityKeys: scopeKeys(req), since: sinceIso(rangeDays(req)) });
  const head = ['Time', 'Platform', 'Community', 'Channel', 'User', 'User ID', 'Message', 'Rule', 'Action', 'Status'];
  const rows = alerts.map(a => [a.createdAt, a.platform, a.guildName, a.channelName, a.username, a.userId, a.text, a.ruleLabel, a.actionTaken, a.resolution || 'pending']);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="sentinel-report.csv"');
  res.send([head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n'));
});

/* ---------- shared network ---------- */

apiRouter.get('/network', async (req, res) => {
  res.json(await searchNetwork(req.query.q));
});

apiRouter.use((err, req, res, _next) => {
  console.error('[api] error', err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});
