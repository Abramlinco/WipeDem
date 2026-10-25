import crypto from 'node:crypto';

// One time sign in codes. The dashboard asks for a code and shows a two digit number. The person presses Start
// on a link to the bot carrying that code, then must tap the SAME number in Telegram. Only then does the bot
// (which sees their real Telegram ID) confirm the code. The code is also tied to the browser that asked for it
// by a secret cookie, so a leaked code is useless anywhere else. Codes last 10 minutes and work once. Kept in
// its own file so the bot and the web routes can both use it without importing each other.

const pending = new Map(); // code -> { createdAt, user, bind, number }
const TTL = 10 * 60 * 1000;
const MAX_PENDING = 2000;

const alive = (p) => !!p && Date.now() - p.createdAt <= TTL;
const sameSecret = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
};

export function newLogin() {
  for (const [c, p] of pending) if (!alive(p)) pending.delete(c);
  if (pending.size >= MAX_PENDING) return null;
  const code = crypto.randomBytes(12).toString('hex'); // 24 hex characters
  const bind = crypto.randomBytes(16).toString('hex');
  const number = crypto.randomInt(10, 100);             // two digits
  pending.set(code, { createdAt: Date.now(), user: null, bind, number });
  return { code, bind, number };
}

export const newLoginCode = () => newLogin()?.code ?? null;

// The three numbers shown as buttons in Telegram: the right one and two decoys, shuffled.
export function loginChoices(code) {
  const p = pending.get(code);
  if (!alive(p) || p.user) return null;
  const set = new Set([p.number]);
  while (set.size < 3) set.add(crypto.randomInt(10, 100));
  return [...set].sort(() => crypto.randomInt(0, 2) - 0.5);
}

export function completeTelegramLogin(code, from, number) {
  const p = pending.get(code);
  if (!alive(p) || p.user) return false;
  if (Number(number) !== p.number) return false;
  p.user = { id: String(from.id), username: from.username || '', firstName: from.first_name || '' };
  return true;
}

export function cancelLogin(code) {
  pending.delete(code);
}

export function takeConfirmedLogin(code, bind) {
  const p = pending.get(code);
  if (!alive(p) || !p.user || !sameSecret(p.bind, bind)) return null;
  pending.delete(code);
  return p.user;
}

export function isPending(code, bind) {
  const p = pending.get(code);
  return alive(p) && sameSecret(p.bind, bind);
}
