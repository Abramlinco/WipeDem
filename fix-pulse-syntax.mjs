// fix-pulse-syntax: repairs one broken line in dashboard/pulse.js (a missing closing brace in the
// campaign "save" call, left behind by the first apply-campaign-ux.mjs). Safe to run more than once.
// Run from the Sentinel-Bot folder:  node fix-pulse-syntax.mjs
import fs from 'node:fs';
import path from 'node:path';
const f = path.join(process.cwd(), 'dashboard', 'pulse.js');
if (!fs.existsSync(f)) { console.error('✖ Run this from the Sentinel-Bot folder (dashboard/pulse.js not found).'); process.exit(1); }
const raw = fs.readFileSync(f, 'utf8');
const bad = "origin, via: m.meta?.source || '' });";
const good = "origin, via: m.meta?.source || '' } });";
const n = raw.split(bad).length - 1;
if (n === 0) { console.log(raw.includes(good) ? '✔ Already fixed. Nothing to do.' : '✖ The broken line was not found. Send me dashboard/pulse.js.'); process.exit(0); }
if (n > 1) { console.error('✖ Found it ' + n + ' times, expected once. Nothing changed.'); process.exit(1); }
fs.copyFileSync(f, f + '.bak-savefix');
fs.writeFileSync(f, raw.replace(bad, good));
console.log('✔ Fixed dashboard/pulse.js (backup: dashboard/pulse.js.bak-savefix).');
