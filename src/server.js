import 'express-async-errors';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb } from './db.js';
import { attachSession } from './auth/sessions.js';
import { authRouter } from './auth/routes.js';
import { apiRouter } from './api/routes.js';
import { creatorRouter } from './creator/router.js'; // creator-panel
import { installMonitor, trackRequests } from './creator/monitor.js'; // creator-panel
import { config } from './config.js';
import { exchangeXCode } from './pulse/x.js';
import { getXAccount, setXAccount } from './db.js';
import { seal } from './pulse/x.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function createApp() {
  await initDb();
  const app = express();
  app.disable('x-powered-by');

app.set('trust proxy', 1);
app.get('/healthz', (req, res) => res.type('text').send('ok'));

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
  installMonitor(); // creator-panel
  app.use(trackRequests); // creator-panel
  app.use('/auth', authRouter);
  // A small page for the X tab. No inline script (the security policy blocks it), so the message is plain HTML.
  const xPage = (res, status, title, message) => res.status(status).type('html').send(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
    `<body style="font-family:system-ui,sans-serif;max-width:34rem;margin:15vh auto;padding:0 1.25rem;line-height:1.5">` +
    `<h2>${title}</h2><p>${String(message).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))}</p>` +
    `<p><a href="/#/pulse/setup">Back to Sentinel</a></p>`);
  app.get('/auth/x/callback', async (req, res) => {
    try {
      const pending = req.session?.xOAuthPending;
      if (!pending || !req.query.state || req.query.state !== pending.state || Date.now() - pending.createdAt > 10 * 60 * 1000) return xPage(res, 400, 'X link expired', 'This X sign-in link expired or was already used. Go back to Sentinel and press Connect again.');
      delete req.session.xOAuthPending;
      await (await import('./db.js')).saveSessionRecord(req.session);
      if (req.query.error) return xPage(res, 400, 'X connection cancelled', 'You cancelled the X sign-in. You can close this tab and return to Sentinel.');
      if (!config.secretKey) return xPage(res, 500, 'Sentinel is not ready', 'SENTINEL_SECRET is not configured. Set it and restart Sentinel before connecting X.');
      const token = await exchangeXCode({ code: String(req.query.code || ''), verifier: pending.verifier, redirectUri: config.xOAuthRedirectUri, clientId: config.xClientId, clientSecret: config.xClientSecret });
      await setXAccount(pending.communityKey, { sealed: seal({ authType: 'oauth2', accessToken: token.accessToken, refreshToken: token.refreshToken, expiresAt: token.expiresAt }, config.secretKey), handle: token.username, connectedAt: new Date().toISOString(), authType: 'oauth2' });
      return res.redirect('/x-done.html');
    } catch (e) {
      console.error('[x-oauth]', e.message);
      // The messages come from Sentinel's own X error handling: no keys or tokens are ever in them.
      return xPage(res, 502, 'Sentinel could not finish connecting X', e.message || 'Check the X app callback URL and OAuth permissions, then try again.');
    }
  });
  app.use('/api/creator', creatorRouter); // creator-panel
  app.use('/api', apiRouter);
  app.use(express.static(path.join(__dirname, '..', 'dashboard')));

  app.use((err, req, res, _next) => {
    console.error('[server] error', err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  });
  return app;
}
