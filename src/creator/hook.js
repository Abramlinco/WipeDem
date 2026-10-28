// The two small hooks the rest of Sentinel calls. Both are written so that a failure here can never block a sign in or a request.
import { db } from '../db.js';
import { ensureState, recordLogin, accountFor, decide, lockedFor, recordUse } from './logic.js';
import { featureForPath, isPassive } from './features.js';
import { hasCookie } from './keyauth.js'; // creator-key-login

// CREATOR_IDS=discord:123456789,telegram:987654321  (the same IDs people see in their Sentinel account)
export const creatorIds = () => new Set(String(process.env.CREATOR_IDS || '').split(',').map((s) => s.trim()).filter(Boolean));
export const creatorEnabled = () => creatorIds().size > 0;
export function isCreatorSession(session) {
  const ids = creatorIds();
  if (!ids.size || !session) return false;
  const d = session.discord?.user?.id, t = session.telegram?.user?.id;
  return (!!d && ids.has(`discord:${d}`)) || (!!t && ids.has(`telegram:${t}`));
}

let saveTimer = null;
const saveSoon = () => { if (!saveTimer) saveTimer = setTimeout(() => { saveTimer = null; db.write().catch((e) => console.error('[creator] save failed:', e.message)); }, 10000); saveTimer.unref?.(); };

export async function trackLogin(session) {
  try { recordLogin(db.data, session); await db.write(); } catch (e) { console.error('[creator] could not record sign in:', e.message); }
}

// Runs on every /api request after sign in: blocks what the creator has locked, and notes what people use.
export function featureGate(req, res, next) {
  try {
    const featureId = featureForPath(req.path);
    if (!featureId && req.path === '/me') return next(); // creator-fixes: a paused account is blocked on every page except /me
    const creator = isCreatorSession(req.session);
    const acc = accountFor(db.data, req.session);
    const verdict = decide(db.data, { acc, isCreator: creator, featureId });
    if (!verdict.allow) return res.status(403).json({ error: verdict.message, locked: featureId, code: verdict.code });
    if (acc && !creator && !isPassive(req.path) && recordUse(db.data, acc, featureId)) saveSoon();
  } catch (e) { console.error('[creator] gate error:', e.message); }
  next();
}

export const creatorAllowed = (req) => isCreatorSession(req.session) || hasCookie(req); // creator-key-login

export const locksFor = (session) => {
  try { return lockedFor(db.data, { acc: accountFor(db.data, session), isCreator: isCreatorSession(session) }); } catch { return []; }
};
export { ensureState };
