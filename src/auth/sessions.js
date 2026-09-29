import crypto from 'node:crypto';
import { config } from '../config.js';
import { getSessionRecord, saveSessionRecord, deleteSessionRecord } from '../db.js';

export const COOKIE = 'sentinel_sid';
const WEEK = 7 * 24 * 3600;

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function setCookie(res, name, value, { maxAge = WEEK } = {}) {
  const secure = config.publicUrl.startsWith('https') ? '; Secure' : '';
  const cookie = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', prev ? [].concat(prev, cookie) : cookie);
}

export function clearCookie(res, name) {
  setCookie(res, name, '', { maxAge: 0 });
}

export async function attachSession(req, res, next) {
  try {
    const sid = parseCookies(req.headers.cookie)[COOKIE];
    req.session = sid ? await getSessionRecord(sid) : null;
    next();
  } catch (err) { next(err); }
}

/**
 * Add a login (discord or telegram) to the current session, or start a new
 * one. Signing in with the second platform joins it to the first, so one
 * person can manage both from one dashboard.
 */
export async function loginAs(req, res, patch) {
  const session = req.session || {
    id: crypto.randomBytes(24).toString('hex'),
    createdAt: new Date().toISOString(),
    discord: null,
    telegram: null
  };
  session.expiresAt = new Date(Date.now() + WEEK * 1000).toISOString();
  Object.assign(session, patch);
  await saveSessionRecord(session);
  setCookie(res, COOKIE, session.id);
  req.session = session;
  return session;
}

export async function logout(req, res) {
  if (req.session) await deleteSessionRecord(req.session.id);
  clearCookie(res, COOKIE);
}

export function requireLogin(req, res, next) {
  if (!req.session) return res.status(401).json({ error: 'login_required' });
  next();
}
