// Postgres storage for Sentinel. It plugs into lowdb exactly where the JSON file adapter did, so the rest of the
// app does not change. The whole state is kept as ONE jsonb document in one row (the same shape as data/db.json).
// Memory stays the source of truth, as before; every save writes the latest state to Postgres.
//
// Run ONE copy of Sentinel per database. Two running copies would overwrite each other's saves.

const TABLE = 'sentinel_state';
const ROW = 'main';

const UPSERT = `insert into ${TABLE} (id, data, updated_at) values ($1, $2::jsonb, now())
  on conflict (id) do update set data = excluded.data, updated_at = now()`;

// pg reads sslmode out of the address and would override our own SSL setting, so take it out and decide here.
export function cleanUrl(url) {
  try {
    const u = new URL(url);
    u.searchParams.delete('sslmode');
    u.searchParams.delete('channel_binding');
    return u.toString();
  } catch { return url; }
}

// Hosted databases (Neon, Supabase, Render...) need SSL. A database on this computer does not.
// DATABASE_SSL: off | insecure (encrypt but skip certificate check) | on. Blank = automatic.
export function sslFor(url, mode = (process.env.DATABASE_SSL || '').toLowerCase()) {
  if (mode === 'off') return false;
  let host = '';
  try { host = new URL(url).hostname; } catch { /* keep blank */ }
  if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(host) && mode !== 'on') return false;
  if (mode === 'insecure') return { rejectUnauthorized: false };
  return { rejectUnauthorized: true };
}

export class PgAdapter {
  constructor(url, { pool = null, retryMs = 1000 } = {}) {
    this.url = url;
    this.pool = pool;
    this.retryMs = retryMs;
    this.ready = null;
    this.chain = Promise.resolve(); // saves run one after another, never at the same time
    this.queued = null;             // a save that is waiting its turn (later changes join it)
    this.latest = null;
  }

  async connect() {
    if (!this.pool) {
      const pg = (await import('pg')).default;
      this.pool = new pg.Pool({ connectionString: cleanUrl(this.url), ssl: sslFor(this.url), max: 3, idleTimeoutMillis: 30000, connectionTimeoutMillis: 20000 });
      // An idle connection dropped by the host must be logged, not crash the bot.
      this.pool.on('error', (e) => console.error('[db] connection error:', e.message));
    }
    return this.pool;
  }

  async init() {
    this.ready ||= (async () => {
      const pool = await this.connect();
      await pool.query(`create table if not exists ${TABLE} (id text primary key, data jsonb not null, updated_at timestamptz not null default now())`);
    })().catch((e) => { this.ready = null; throw e; });
    return this.ready;
  }

  // lowdb calls this once at start. null means "nothing saved yet".
  async read() {
    await this.init();
    const r = await this.pool.query(`select data from ${TABLE} where id = $1`, [ROW]);
    return r.rows[0]?.data ?? null;
  }

  // lowdb calls this on every save. Saves that pile up while one is running are merged into one.
  write(data) {
    this.latest = data;
    if (this.queued) return this.queued;
    const job = this.chain.then(async () => {
      this.queued = null; // changes from now on need a new save
      await this.init();
      const json = JSON.stringify(this.latest);
      let lastErr;
      for (let attempt = 0; attempt < 3; attempt++) {
        try { await this.pool.query(UPSERT, [ROW, json]); return; } catch (e) {
          lastErr = e;
          if (attempt < 2) await new Promise((r) => setTimeout(r, this.retryMs * (attempt + 1)));
        }
      }
      throw lastErr;
    });
    this.queued = job;
    this.chain = job.catch(() => {}); // one failed save must not block the next one
    return job;
  }

  async close() {
    await this.chain;
    if (this.pool?.end) await this.pool.end();
  }
}
