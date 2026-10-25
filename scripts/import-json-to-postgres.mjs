#!/usr/bin/env node
// Copies your local data/db.json into Postgres, once.
//
//   PowerShell:   $env:DATABASE_URL = "postgresql://..."
//                 node scripts/import-json-to-postgres.mjs            (uses data/db.json)
//                 node scripts/import-json-to-postgres.mjs path\to\db.json
//                 add --force to replace data that is already in Postgres
//
// Do this BEFORE the app runs against that database, or while the Render service is suspended. A running copy
// keeps its own state in memory and would overwrite what you import on its next save.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PgAdapter } from '../src/pgAdapter.js';

const die = (m) => { console.error('\n✖ ' + m + '\n'); process.exit(1); };
const url = process.env.DATABASE_URL;
if (!url) die('DATABASE_URL is not set. In PowerShell: $env:DATABASE_URL = "postgresql://..."');

const force = process.argv.includes('--force');
const given = process.argv.slice(2).find((a) => !a.startsWith('--'));
const file = path.resolve(given || path.join('data', 'db.json'));
if (!fs.existsSync(file)) die(`Cannot find ${file}`);

let data;
try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { die(`${file} is not valid JSON: ${e.message}`); }
if (!data || typeof data !== 'object' || Array.isArray(data)) die('That file does not look like a Sentinel data file.');

const count = (d) => ({
  communities: Object.keys(d.communities || {}).length,
  alerts: (d.alerts || []).length,
  discussions: (d.discussions || []).length,
  knowledgeSources: (d.knowledge?.sources || []).length,
  pools: (d.pools?.items || []).length
});
const adapter = new PgAdapter(url);
try {
  const existing = await adapter.read();
  if (existing) {
    const c = count(existing);
    const empty = !c.communities && !c.alerts && !c.discussions && !c.knowledgeSources && !c.pools;
    if (!empty && !force) {
      console.log('Postgres already holds data:', c);
      die('Not replaced. Run again with --force if you really want to replace it.');
    }
  }
  await adapter.write(data);
  await adapter.close();
  console.log('✔ Copied into Postgres from', file);
  console.log('  Now holds:', count(data));
} catch (e) {
  die('Could not reach Postgres: ' + e.message);
}
