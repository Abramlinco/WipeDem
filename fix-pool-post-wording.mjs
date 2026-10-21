// fix-pool-post-wording: stops drafts saying "the Osmosis pool 944 pool (Osmosis)".
// Run from the Sentinel-Bot folder:  node fix-pool-post-wording.mjs   (safe to run twice)
import fs from 'node:fs';
import path from 'node:path';
const f = path.join(process.cwd(), 'src', 'pulse', 'poolpost.js');
if (!fs.existsSync(f)) { console.error('✖ Run this from the Sentinel-Bot folder (src/pulse/poolpost.js not found).'); process.exit(1); }
let raw = fs.readFileSync(f, 'utf8');
if (raw.includes('// post-wording')) { console.log('✔ Already applied. Nothing to do.'); process.exit(0); }
const EDITS = [
  ["const at = on ? ` (${on})` : '';",
   "const at = on && !on.split(', ').every((p) => name.toLowerCase().includes(p.toLowerCase())) ? ` (${on})` : ''; // post-wording: skip the tag when the name already says it"],
  ["`the ${name} pool`",
   "(/pool/i.test(name) ? `the ${name}` : `the ${name} pool`)"]
];
for (const [a] of EDITS) if (raw.split(a).length !== 2) { console.error('✖ Could not find the expected text once (' + a.slice(0, 30) + '…). Nothing changed. Send me src/pulse/poolpost.js.'); process.exit(1); }
fs.copyFileSync(f, f + '.bak-postwording');
for (const [a, b] of EDITS) raw = raw.replace(a, () => b);
fs.writeFileSync(f, raw);
console.log('✔ Wording fixed (backup: src/pulse/poolpost.js.bak-postwording). Restart the bot (Ctrl+C, then npm start).');
