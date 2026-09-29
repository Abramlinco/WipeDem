import crypto from 'node:crypto';

// One time sign in codes. The dashboard asks for a code, the person presses
// Start on a link to the bot carrying that code, and the bot (which sees
// their real Telegram ID) marks the code as confirmed. Codes last 10
// minutes and work once. Kept in its own file so the bot and the web
// routes can both use it without importing each other.

const pending = new Map(); // code -> { createdAt, user }
const TTL = 10 * 60 * 1000;

export function newLoginCode() {
  for (const [c, p] of pending) if (Date.now() - p.createdAt > TTL) pending.delete(c);
  const code = crypto.randomBytes(12).toString('hex'); // 24 hex characters
  pending.set(code, { createdAt: Date.now(), user: null });
  return code;
}

export function completeTelegramLogin(code, from) {
  const p = pending.get(code);
  if (!p || Date.now() - p.createdAt > TTL) return false;
  p.user = { id: String(from.id), username: from.username || '', firstName: from.first_name || '' };
  return true;
}

export function takeConfirmedLogin(code) {
  const p = pending.get(code);
  if (!p || !p.user) return null;
  pending.delete(code);
  return p.user;
}

export function isPending(code) {
  const p = pending.get(code);
  return !!p && Date.now() - p.createdAt <= TTL;
}
