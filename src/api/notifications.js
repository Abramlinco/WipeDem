// notify-patch: the bell's data, and the phone-alert switches.
import { Router } from 'express';
import { listDiscussions, listAlerts, listFaqDrafts } from '../db.js';
import { buildSummary, getSub, saveSub, syncSubAccess, testDm, DEFAULT_KINDS } from '../pulse/notify.js';

export const notificationsRouter = Router();

const CHANNELS = ['telegram', 'discord'];
const stamp = (v, fallback) => { const t = Date.parse(v); return Number.isFinite(t) && t <= Date.now() + 60000 ? new Date(t).toISOString() : fallback; };
const identity = (req, channel) => (req.session?.[channel]?.user?.id ? String(req.session[channel].user.id) : null);
const idsOf = (req) => {
  const ids = {};
  for (const ch of CHANNELS) { const id = identity(req, ch); if (id) ids[ch] = id; }
  return ids;
};

notificationsRouter.get('/summary', async (req, res) => {
  const now = new Date().toISOString();
  const seen = { pulse: stamp(req.query.pulse, now), alerts: stamp(req.query.alerts, now), faqs: stamp(req.query.faqs, now) };
  const keys = req.access.keys;
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const summary = buildSummary({
    discussions: listDiscussions({ communityKeys: keys, since: weekAgo }),
    alerts: await listAlerts({ communityKeys: keys, resolved: false }),
    faqs: listFaqDrafts(keys).filter((x) => x.status === 'pending'),
    seen, now
  });
  const dm = {};
  for (const ch of CHANNELS) {
    const uid = identity(req, ch);
    if (!uid) { dm[ch] = null; continue; }
    await syncSubAccess(ch, uid, idsOf(req), [...keys]);
    const sub = getSub(ch, uid);
    dm[ch] = { on: !!sub?.on, kinds: sub?.kinds || [...DEFAULT_KINDS] };
  }
  res.json({ ...summary, dm });
});

notificationsRouter.post('/dm', async (req, res) => {
  const { channel, on, kinds } = req.body || {};
  if (!CHANNELS.includes(channel)) return res.status(400).json({ error: 'Unknown channel' });
  const uid = identity(req, channel);
  if (!uid) return res.status(400).json({ error: `Sign in with ${channel === 'telegram' ? 'Telegram' : 'Discord'} first.` });
  const sub = await saveSub(channel, uid, { on: typeof on === 'boolean' ? on : undefined, kinds, ids: idsOf(req), keys: [...req.access.keys] });
  res.json({ ok: true, on: sub.on, kinds: sub.kinds });
});

const lastTest = new Map(); // one test message every 10 seconds per person
notificationsRouter.post('/dm/test', async (req, res) => {
  const { channel } = req.body || {};
  if (!CHANNELS.includes(channel)) return res.status(400).json({ error: 'Unknown channel' });
  const uid = identity(req, channel);
  if (!uid) return res.status(400).json({ error: `Sign in with ${channel === 'telegram' ? 'Telegram' : 'Discord'} first.` });
  const k = `${channel}:${uid}`;
  if (Date.now() - (lastTest.get(k) || 0) < 10000) return res.json({ ok: false, error: 'Please wait a few seconds before sending another test.' });
  lastTest.set(k, Date.now());
  res.json(await testDm(channel, uid));
});
