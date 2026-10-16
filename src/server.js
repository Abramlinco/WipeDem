import 'express-async-errors';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb } from './db.js';
import { attachSession } from './auth/sessions.js';
import { authRouter } from './auth/routes.js';
import { apiRouter } from './api/routes.js';
import { config } from './config.js';
import { exchangeXCode } from './pulse/x.js';
import { getXAccount, setXAccount } from './db.js';
import { seal } from './pulse/x.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function createApp() {
  await initDb();
  const app = express();
  app.disable('x-powered-by');

  // The dashboard loads only its own files (plus Discord profile pictures).
  // Blocking inline scripts means even a scam message full of HTML cannot run code.
  app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: https://cdn.discordapp.com; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  app.use(express.json({ limit: '50kb' }));
  app.use(attachSession);
  app.use('/auth', authRouter);
  app.get('/auth/x/callback', async (req, res) => {
    try {
      const pending = req.session?.xOAuthPending;
      if (!pending || !req.query.state || req.query.state !== pending.state || Date.now() - pending.createdAt > 10 * 60 * 1000) return res.status(400).send('X authorization expired or could not be verified. Return to Sentinel and try again.');
      delete req.session.xOAuthPending;
      await (await import('./db.js')).saveSessionRecord(req.session);
      if (req.query.error) return res.status(400).send('X authorization was cancelled. You can close this tab and return to Sentinel.');
      const token = await exchangeXCode({ code: String(req.query.code || ''), verifier: pending.verifier, redirectUri: config.xOAuthRedirectUri, clientId: config.xClientId, clientSecret: config.xClientSecret });
      if (!config.secretKey) return res.status(500).send('SENTINEL_SECRET is not configured. Set it and restart Sentinel before connecting X.');
      await setXAccount(pending.communityKey, { sealed: seal({ authType: 'oauth2', accessToken: token.accessToken, refreshToken: token.refreshToken, expiresAt: token.expiresAt }, config.secretKey), handle: token.username, connectedAt: new Date().toISOString(), authType: 'oauth2' });
      return res.redirect('/#/pulse/setup');
    } catch (e) { console.error('[x-oauth]', e.message); return res.status(502).send('Sentinel could not finish connecting X. Check the X app callback URL and OAuth permissions, then try again.'); }
  });
  app.use('/api', apiRouter);
  app.use(express.static(path.join(__dirname, '..', 'dashboard')));

  app.use((err, req, res, _next) => {
    console.error('[server] error', err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  });
  return app;
}
