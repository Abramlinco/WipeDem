// Read-only check of "Post update" and "Suggested pools" on YOUR data. It changes nothing.
// Run it from the sentinel-bot folder (the bot can stay running):  node check-pool-post.mjs
process.env.AI_PROVIDER = 'none';
import fs from 'node:fs';
import path from 'node:path';

const say = (...a) => console.log(...a);
const ok = (m) => say('  OK   ' + m);
const bad = (m) => say('  FAIL ' + m);
const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');

say('\n[1] Are the patches really in this folder?');
const files = { 'src/pulse/poolpost.js': 'Post update (new file)', 'src/pulse/poolfinder.js': 'Suggested pools (new file)' };
for (const [f, what] of Object.entries(files)) (fs.existsSync(f) ? ok : bad)(`${what}: ${f}${fs.existsSync(f) ? '' : ' is missing, so that patch is not applied here'}`);
const marks = [['src/api/pulse.js', 'pool-post', "server route for Post update"], ['dashboard/pulse.js', 'pool-post', 'Post update button'], ['src/api/pulse.js', 'pool-finder', 'server route for Suggested pools'], ['dashboard/pulse.js', 'pool-finder', 'Suggested pools panel']];
for (const [f, m, what] of marks) (read(f).includes(m) ? ok : bad)(`${what} (${f})`);
say('  If any line above says FAIL, run that patch again from this folder. If all say OK, the bot must also be restarted (Ctrl+C, then npm start) and the page hard-refreshed (Ctrl+Shift+R).');

const dbFile = process.env.SENTINEL_DB_FILE || path.join('data', 'db.json');
say(`\n[2] Reading your saved data (${dbFile})`);
if (!fs.existsSync(dbFile)) { bad('database file not found. Run this from the sentinel-bot folder.'); process.exit(1); }
const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
const items = db.pools?.items || [];
ok(`${items.length} watched pool(s)`);
const briefOf = (key) => { const i = key.indexOf(':'); const bucket = key.slice(0, i) === 'discord' ? db.discordSettings : db.telegramSettings; return bucket?.[key.slice(i + 1)]?.brief || {}; };

say('\n[3] "Post update": can a draft be created, and would it pass the post checks?');
let draftMod, replyMod;
try { draftMod = await import('./src/pulse/poolpost.js'); replyMod = await import('./src/pulse/reply.js'); } catch (e) { bad('could not load the code: ' + e.message); }
if (draftMod && replyMod) {
  for (const it of items) {
    const name = it.label || `${it.chain}:${it.address}`;
    const comm = db.communities?.[it.communityKey]?.name || it.communityKey;
    if (!it.snapshot) { bad(`${name} (${comm}): Pulse has not read this pool yet (status: ${it.status}${it.error ? ', error: ' + it.error : ''}). Post update needs a successful read. Press Check now first.`); continue; }
    const brief = briefOf(it.communityKey);
    let problems = 0;
    let first = '';
    try {
      const total = draftMod.poolPostDraft(it, brief, 0).total;
      for (let n = 0; n < total; n++) {
        const d = draftMod.poolPostDraft(it, brief, n);
        if (!first) first = d.text;
        const flags = replyMod.checkPolicy(d.text, brief, d.sources);
        if (flags.length) { problems++; bad(`${name}: version ${n + 1} would be blocked when posting: ${flags.map((f) => `"${f.phrase}" (${f.why})`).join('; ')}`); }
      }
      if (!problems) ok(`${name} (${comm}): all ${total} versions pass the post checks`);
    } catch (e) { bad(`${name}: could not build a draft: ${e.message}`); }
    if (first) say('\n      Version 1:\n      ' + first.replace(/\n/g, '\n      ') + '\n');
    if ((brief.bannedPhrases || []).length) say(`      (This community's banned phrases: ${brief.bannedPhrases.join(', ')})`);
  }
}

say('\n[4] "Suggested pools": what would "Find pools" return for each community with a project name or ticker?');
try {
  const { findPools } = await import('./src/pulse/poolfinder.js');
  const seen = new Set();
  const buckets = [['discord', db.discordSettings || {}], ['telegram', db.telegramSettings || {}]];
  for (const [platform, b] of buckets) for (const [id, s] of Object.entries(b)) {
    const br = s.brief || {};
    if (!br.projectName && !br.ticker) continue;
    const key = `${platform}:${id}`; if (seen.has(key)) continue; seen.add(key);
    const r = await findPools({ brief: br, texts: [] });
    const comm = db.communities?.[key]?.name || key;
    if (!r.ok) { bad(`${comm}: ${r.error}`); continue; }
    ok(`${comm} (${br.projectName || ''} ${br.ticker || ''}): ${r.suggestions.length} pool(s) found, tokens matched: ${r.matched.map((t) => t.symbol).join(', ') || 'none'}`);
    for (const n of r.notes) say('      note: ' + n);
    for (const s of r.suggestions.slice(0, 3)) say(`      ${s.label}  liquidity ${s.tvlUsd == null ? 'n/a' : '$' + Math.round(s.tvlUsd)}  ${s.url}`);
  }
  if (!seen.size) say('  No community has a project name or ticker in its project brief yet, so there is nothing to search for.');
} catch (e) { bad('could not run the pool finder: ' + e.message); }
say('\nDone. Copy everything above and send it back, together with what you saw on screen when it failed (the red message, if any).');
