import crypto from 'node:crypto';
import { Router } from 'express';
import { config, discordLoginEnabled } from '../config.js';
import { parseCookies, setCookie, clearCookie, loginAs, logout } from './sessions.js';
import { newLogin, takeConfirmedLogin, isPending } from './telegramLogin.js';
import { getBotUsername } from '../telegram/bot.js';
import { discordGenericInviteUrl } from '../discord/bot.js';

export const authRouter = Router();

const page = (title, body) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>
   <body style="font-family:system-ui;max-width:460px;margin:12vh auto;padding:0 20px;line-height:1.5">
   <h2>${title}</h2><p>${body}</p><p><a href="/">Back to the dashboard</a></p></body>`;

authRouter.get('/config', (req, res) => {
  res.json({
    discord: discordLoginEnabled(),
    discordInviteUrl: discordLoginEnabled() ? discordGenericInviteUrl() : null,
    telegram: !!getBotUsername(),
    telegramBot: getBotUsername() || null
  });
});

/* ---------------- Discord sign in ---------------- */

const redirectUri = () => `${config.publicUrl}/auth/discord/callback`;

authRouter.get('/discord', (req, res) => {
  if (!discordLoginEnabled()) {
    return res.status(503).send(page('Discord sign in is not set up',
      'Add DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET to your .env file, then restart.'));
  }
  const state = crypto.randomBytes(16).toString('hex');
  setCookie(res, 'sentinel_oauth_state', state, { maxAge: 600 });
  const params = new URLSearchParams({
    client_id: config.discordClientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: process.env.CREATOR_COLLECT_EMAIL === 'true' ? 'identify guilds email' : 'identify guilds', // creator-panel
    state
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

authRouter.get('/discord/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    const expected = parseCookies(req.headers.cookie)['sentinel_oauth_state'];
    clearCookie(res, 'sentinel_oauth_state');
    if (!code || !state || state !== expected) {
      return res.status(400).send(page('Sign in failed', 'The sign in link expired or was not started here. Please try again.'));
    }

    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.discordClientId,
        client_secret: config.discordClientSecret,
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: redirectUri()
      })
    });
    if (!tokenRes.ok) {
      return res.status(400).send(page('Sign in failed',
        'Discord did not accept the sign in. Check that the Redirect URL in the Developer Portal is exactly ' +
        `<code>${redirectUri()}</code>.`));
    }
    const { access_token } = await tokenRes.json();
    const auth = { headers: { Authorization: `Bearer ${access_token}` } };
    const [user, guilds] = await Promise.all([
      fetch('https://discord.com/api/users/@me', auth).then(r => r.json()),
      fetch('https://discord.com/api/users/@me/guilds', auth).then(r => r.json())
    ]);

    // Keep only servers this person owns or manages. Nothing else is kept,
    // and the access token is dropped right here, never stored.
    const MANAGE = 0x20n, ADMIN = 0x8n;
    const manageable = (Array.isArray(guilds) ? guilds : [])
      .filter(g => g.owner || (BigInt(g.permissions || 0) & (ADMIN | MANAGE)) !== 0n)
      .map(g => ({ id: g.id, name: g.name, icon: g.icon }));

    await loginAs(req, res, {
      discord: { user: { id: user.id, username: user.global_name || user.username, avatar: user.avatar, email: process.env.CREATOR_COLLECT_EMAIL === 'true' ? (user.email || null) : null }, guilds: manageable }
    });
    res.redirect('/');
  } catch (err) {
    console.error('[auth] discord callback error', err);
    res.status(500).send(page('Sign in failed', 'Something went wrong talking to Discord. Please try again.'));
  }
});

/* ---------------- Telegram sign in (through the bot) ---------------- */

const BIND_COOKIE = 'sentinel_tg_bind';
const startHits = new Map(); // ip -> times of recent sign in starts

authRouter.post('/telegram/start', (req, res) => {
  const username = getBotUsername();
  if (!username) return res.status(503).json({ error: 'Telegram bot is not running.' });
  const now = Date.now();
  const hits = (startHits.get(req.ip) || []).filter(t => now - t < 10 * 60 * 1000);
  if (hits.length >= 30) return res.status(429).json({ error: 'Too many sign in attempts. Wait a few minutes and try again.' });
  hits.push(now);
  startHits.set(req.ip, hits);
  if (startHits.size > 1000) for (const [k, v] of startHits) if (!v.some(t => now - t < 10 * 60 * 1000)) startHits.delete(k);

  const login = newLogin();
  if (!login) return res.status(503).json({ error: 'Too many sign ins are waiting. Try again in a few minutes.' });
  // The code only works for the browser that asked for it, and the person must tap this number inside Telegram.
  setCookie(res, BIND_COOKIE, login.bind, { maxAge: 600 });
  res.json({ code: login.code, number: login.number, url: `https://t.me/${username}?start=login_${login.code}` });
});

authRouter.get('/telegram/status', async (req, res) => {
  const code = String(req.query.code || '');
  if (!/^[a-f0-9]{24}$/.test(code)) return res.json({ ok: false });
  const bind = parseCookies(req.headers.cookie)[BIND_COOKIE] || '';
  const user = takeConfirmedLogin(code, bind);
  if (!user) return res.json({ ok: false, waiting: isPending(code, bind) });
  clearCookie(res, BIND_COOKIE);
  await loginAs(req, res, { telegram: { user } });
  res.json({ ok: true });
});

authRouter.post('/logout', async (req, res) => {
  await logout(req, res);
  res.json({ ok: true });
});
