import 'express-async-errors';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb } from './db.js';
import { attachSession } from './auth/sessions.js';
import { authRouter } from './auth/routes.js';
import { apiRouter } from './api/routes.js';

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
  app.use('/api', apiRouter);
  app.use(express.static(path.join(__dirname, '..', 'dashboard')));

  app.use((err, req, res, _next) => {
    console.error('[server] error', err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  });
  return app;
}
