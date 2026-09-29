import crypto from 'node:crypto';
import { Router } from 'express';
import { config, discordLoginEnabled } from '../config.js';
import { parseCookies, setCookie, clearCookie, loginAs, logout } from './sessions.js';
import { newLoginCode, takeConfirmedLogin, isPending } from './telegramLogin.js';
import { getBotUsername } from '../telegram/bot.js';

export const authRouter = Router();

const page = (title, body) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>
   <body style="font-family:system-ui;max-width:460px;margin:12vh auto;padding:0 20px;line-height:1.5">
   <h2>${title}</h2><p>${body}</p><p><a href="/">Back to the dashboard</a></p></body>`;

authRouter.get('/config', (req, res) => {
  res.json({
    discord: discordLoginEnabled(),
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
    scope: 'identify guilds',
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
      discord: { user: { id: user.id, username: user.global_name || user.username, avatar: user.avatar }, guilds: manageable }
    });
    res.redirect('/');
  } catch (err) {
    console.error('[auth] discord callback error', err);
    res.status(500).send(page('Sign in failed', 'Something went wrong talking to Discord. Please try again.'));
  }
});

/* ---------------- Telegram sign in (through the bot) ---------------- */

authRouter.post('/telegram/start', (req, res) => {
  const username = getBotUsername();
  if (!username) return res.status(503).json({ error: 'Telegram bot is not running.' });
  const code = newLoginCode();
  res.json({ code, url: `https://t.me/${username}?start=login_${code}` });
});

authRouter.get('/telegram/status', async (req, res) => {
  const code = String(req.query.code || '');
  if (!/^[a-f0-9]{24}$/.test(code)) return res.json({ ok: false });
  const user = takeConfirmedLogin(code);
  if (!user) return res.json({ ok: false, waiting: isPending(code) });
  await loginAs(req, res, { telegram: { user } });
  res.json({ ok: true });
});

authRouter.post('/logout', async (req, res) => {
  await logout(req, res);
  res.json({ ok: true });
});
