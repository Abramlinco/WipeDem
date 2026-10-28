// Watches the running app: recent errors, server error counts, and how late the server is answering.
// Nothing here is stored in the database; it is the live picture since the last start.

const errors = [];                 // newest first: { at, msg }
const minutes = new Map();         // "minute number" -> { req, err5 }
let lagMs = 0;
let installed = false;

// Error text can carry a token by accident. Anything that looks like one is blanked before it is kept.
const clean = (args) => args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()))
  .join(' ').replace(/[A-Za-z0-9_\-.]{32,}/g, '[hidden]').slice(0, 300);

export function installMonitor() {
  if (installed) return;
  installed = true;
  const original = console.error.bind(console);
  console.error = (...args) => {
    try { errors.unshift({ at: new Date().toISOString(), msg: clean(args) }); if (errors.length > 100) errors.length = 100; } catch { /* never break logging */ }
    original(...args);
  };
  let last = Date.now();
  setInterval(() => { const now = Date.now(); lagMs = Math.max(0, now - last - 1000); last = now; }, 1000).unref();
}

export function trackRequests(req, res, next) {
  const started = Date.now();
  res.on('finish', () => {
    const m = Math.floor(started / 60000);
    const b = minutes.get(m) || { req: 0, err5: 0 };
    b.req += 1; if (res.statusCode >= 500) b.err5 += 1;
    minutes.set(m, b);
    for (const k of minutes.keys()) if (k < m - 70) minutes.delete(k);
  });
  next();
}

export function snapshot(now = Date.now()) {
  const m = Math.floor(now / 60000);
  let req15 = 0, err15 = 0;
  for (const [k, b] of minutes) if (k > m - 15) { req15 += b.req; err15 += b.err5; }
  const hourAgo = new Date(now - 3600000).toISOString();
  return {
    errorsLastHour: errors.filter((e) => e.at >= hourAgo).length,
    serverErrors15m: err15, requests15m: req15,
    lagMs: Math.round(lagMs),
    rssMb: Math.round(process.memoryUsage().rss / 1048576),
    uptimeSec: Math.round(process.uptime()),
    recent: errors.slice(0, 30)
  };
}
