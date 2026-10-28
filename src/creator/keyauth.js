// Creator sign in with a secret key, for when Discord or Telegram sign in is not available.
// The key lives only in the server environment (CREATOR_KEY). It is never stored, logged or sent to the browser.
// After a correct key the browser gets a signed cookie that lasts 12 hours and only travels to /api/creator.
import crypto from 'node:crypto';

const COOKIE = 'sentinel_creator';
const HOURS = 12;
const key = () => String(process.env.CREATOR_KEY || '');

export const keyLoginEnabled = () => key().length >= 20;
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const sign = (exp) => crypto.createHmac('sha256', key()).update('creator.' + exp).digest('hex');
export const keyIsValid = (given) => keyLoginEnabled() && crypto.timingSafeEqual(sha(given), sha(key()));

const secure = (req) => req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' || String(process.env.PUBLIC_URL || '').startsWith('https');
const set = (res, value, maxAge, req) => res.setHeader('Set-Cookie', `${COOKIE}=${value}; Path=/api/creator; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure(req) ? '; Secure' : ''}`);

export function issueCookie(req, res, now = Date.now()) {
  const exp = now + HOURS * 3600 * 1000;
  set(res, `${exp}.${sign(exp)}`, HOURS * 3600, req);
}
export const clearCookie = (req, res) => set(res, '', 0, req);

export function hasCookie(req, now = Date.now()) {
  if (!keyLoginEnabled()) return false;
  const m = String(req.headers?.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(COOKIE + '='));
  const [exp, sig] = (m ? m.slice(COOKIE.length + 1) : '').split('.');
  if (!exp || !sig || !(Number(exp) > now)) return false;
  const want = sign(exp);
  return sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want));
}

// Behind Render's proxy the real visitor is the last address it appended, not the first one a visitor could invent.
export const clientIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean).pop() || req.ip || 'unknown';

// Five wrong keys from one address and that address waits 15 minutes.
const tries = new Map();
export const locked = (ip, now = Date.now()) => (tries.get(ip)?.until || 0) > now;
export function fail(ip, now = Date.now()) {
  const t = tries.get(ip) || { n: 0, until: 0 };
  t.n += 1;
  if (t.n >= 5) { t.until = now + 15 * 60 * 1000; t.n = 0; }
  tries.set(ip, t);
  if (tries.size > 5000) tries.clear();
}
export const succeed = (ip) => tries.delete(ip);
export const _reset = () => tries.clear();
