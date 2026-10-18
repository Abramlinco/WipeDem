#!/usr/bin/env node
// Sentinel patch fix-3: Pools errors, Technical Push (delete + compact cards), panel spacing, landing copy.
//
//   node apply-fix3.mjs            apply (run from the Sentinel-Bot folder)
//   node apply-fix3.mjs --revert   undo only this patch
//
// Independent of the campaign patches. Every anchor is checked first; if one is missing, NOTHING is written.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.cwd();
const abs = (f) => path.join(root, f);
const bak = (f) => abs(f) + '.bak-fix3';
const die = (m) => { console.error('\n✖ ' + m + '\n  Nothing was changed.'); process.exit(1); };

const blocks = {};
{
  let cur = null;
  for (const raw of fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split(/\r?\n/)) {
    if (!raw.startsWith('//|')) continue;
    const body = raw.slice(3);
    if (body.startsWith('#### ')) { cur = body.slice(5).trim(); blocks[cur] = []; continue; }
    if (cur) blocks[cur].push(body);
  }
  for (const k of Object.keys(blocks)) blocks[k] = blocks[k].join('\n').replace(/\n+$/, '');
}

const PLAN = {
  'src/db.js': [
    { name: 'delete report (db)', start: 'export async function markTechnicalReportPushed(', replace: blocks.DB_DELETE + '\nexport async function markTechnicalReportPushed(' }
  ],
  'src/api/pulse.js': [
    { name: 'import', start: 'listTechnicalReports, addTechnicalReport, markTechnicalReportPushed,', replace: 'listTechnicalReports, addTechnicalReport, markTechnicalReportPushed, deleteTechnicalReport,' },
    { name: 'delete route', start: '/* ---------- X ---------- */', replace: blocks.SERVER_DELETE + '/* ---------- X ---------- */' }
  ],
  'src/pulse/sources.js': [
    { name: 'keep the error body', start: 'if (!res.ok) { const err = new Error(`The address answered ${res.status}`); err.status = res.status; throw err; }',
      replace: 'if (!res.ok) {\n        const err = new Error(`The address answered ${res.status}`); err.status = res.status;\n        try { err.body = (await res.text()).slice(0, 300); } catch { /* the body is optional */ } // fix-3\n        throw err;\n      }' }
  ],
  'src/pulse/pools.js': [
    { name: 'readable errors', start: "return new Error('The data service refused the request. It may need a paid plan.');\n  return e;",
      replace: "return new Error('The data service refused the request. It may need a paid plan.');\n  // fix-3: say what actually happened instead of a bare \"The address answered 400\".\n  const detail = e.body ? ` (${String(e.body).replace(/\\s+/g, ' ').trim().slice(0, 140)})` : '';\n  if (e.status === 400) return new Error(`The data service rejected this lookup (HTTP 400)${detail}. That can mean it does not recognise this chain or pool address. Try pasting the pool's DEX Screener link (dexscreener.com/<chain>/<pool>) instead.`);\n  if (e.status) return new Error(`The data service answered HTTP ${e.status}${detail}. Try again later.`);\n  return e;" }
  ],
  'src/pulse/feeder.js': [
    { name: 'truthful pool log', start: 'export async function refreshPoolsDue() {', end: '  return done;\n}', replace: blocks.FEEDER_POOLS }
  ],
  'dashboard/app.js': [
    { name: 'landing headline', start: '<h1>Keep scammers out. Hear what your community is really saying.</h1>', replace: '<h1>Protect your community. Understand it. Grow it.</h1>' },
    { name: 'landing points', start: '<ul class="points">', end: '</ul>', replace: blocks.LANDING_POINTS },
    { name: 'landing footer', start: 'Built for Discord and Telegram community teams.', replace: 'Built for Web3 community teams on Discord and Telegram.' },
    { name: 'report card function', start: 'async function loadTechnicalPush() {', replace: blocks.TECH_CARD + '\nasync function loadTechnicalPush() {' },
    { name: 'report cards', start: 'techRows.map(r=>html`<div class="panel"><div class="panelhead"><h2>Technical report', end: 'Send to channel</button></div></div></div>`)', replace: 'techRows.map(techCard)' },
    { name: 'delete handler', start: "'tech-download': el => {", replace: blocks.TECH_HANDLER }
  ],
  'dashboard/style.css': [
    { name: 'styles', append: blocks.CSS }
  ]
};
const FILES = Object.keys(PLAN);

if (!fs.existsSync(abs('package.json')) || !FILES.every((f) => fs.existsSync(abs(f)))) die('Run this from the Sentinel-Bot project folder (the one that contains package.json, src/ and dashboard/).');

if (process.argv.includes('--revert')) {
  let n = 0;
  for (const f of FILES) if (fs.existsSync(bak(f))) { fs.copyFileSync(bak(f), abs(f)); fs.unlinkSync(bak(f)); n++; console.log('restored ' + f); }
  console.log(n ? '\n✔ fix-3 reverted.' : 'No fix-3 backups found, nothing to revert.');
  process.exit(0);
}

function edit(text, label, op) {
  if (op.append) return text.replace(/\n*$/, '\n') + op.append + '\n';
  const i = text.indexOf(op.start);
  if (i < 0) die(`${label}: anchor not found. Your file differs from the version this patch was written for.`);
  if (text.indexOf(op.start, i + 1) >= 0) die(`${label}: anchor appears more than once.`);
  let j = i + op.start.length;
  if (op.end) {
    const k = text.indexOf(op.end, j);
    if (k < 0) die(`${label}: end anchor not found.`);
    j = k + op.end.length;
  }
  return text.slice(0, i) + op.replace + text.slice(j);
}

const out = {};
for (const f of FILES) {
  const raw = fs.readFileSync(abs(f), 'utf8');
  if (raw.includes('fix-3')) die(`${f} already has this patch. Use --revert first to re-apply.`);
  const crlf = raw.includes('\r\n');
  let text = raw.replace(/\r\n/g, '\n');
  PLAN[f].forEach((op, n) => { text = edit(text, `${f} #${n + 1} (${op.name})`, op); });
  out[f] = crlf ? text.replace(/\n/g, '\r\n') : text;
}
for (const f of FILES) { fs.copyFileSync(abs(f), bak(f)); fs.writeFileSync(abs(f), out[f]); console.log('patched ' + f); }
console.log('\n✔ fix-3 applied. Restart the server (node src/index.js) and hard-refresh the dashboard (Ctrl+Shift+R).');
console.log('  Undo with: node apply-fix3.mjs --revert');
process.exit(0);

// ---- code blocks (data, not executed) ----

//|#### DB_DELETE
//|// fix-3: deleting a report removes the whole record (text, evidence links, groups) and any pending auto-send pointing at it.
//|export async function deleteTechnicalReport(id, communityKeys) {
//|  const rec = db.data.technicalReports.find((x) => x.id === id && communityKeys.has(x.communityKey));
//|  if (!rec) return false;
//|  db.data.technicalReports = db.data.technicalReports.filter((x) => x !== rec);
//|  const s = db.data.technicalSettings[rec.communityKey];
//|  if (s && s.autoPendingReportId === id) s.autoPendingReportId = '';
//|  await db.write(); return true;
//|}
//|#### SERVER_DELETE
//|// fix-3: delete a technical report. Only reports from communities you manage can be deleted.
//|pulseRouter.delete('/technical-push/:id', async (req, res) => {
//|  const gone = await deleteTechnicalReport(String(req.params.id || ''), req.access.keys);
//|  if (!gone) return res.status(404).json({ error: 'Technical report not found.' });
//|  res.json({ ok: true });
//|});
//|#### FEEDER_POOLS
//|export async function refreshPoolsDue() {
//|  // fix-3: report what really happened. Only pools that were read successfully count as "checked";
//|  // failures are printed with the reason instead of being hidden behind a success count.
//|  let done = 0; const failed = [];
//|  for (const p of duePools(Date.now(), config.poolRefreshMinutes)) {
//|    const r = await refreshPoolItem(p);
//|    if (r.ok) done++; else if (r.error !== 'Already being checked') failed.push(`${p.label || `${p.chain || ''}:${p.address || ''}`} - ${r.error}`);
//|    await new Promise((resolve) => setTimeout(resolve, 400)); // gentle with the data service
//|  }
//|  if (failed.length) console.error(`[pulse] ${failed.length} pool(s) could not be read:\n  ${failed.join('\n  ')}`);
//|  return done;
//|}
//|#### TECH_CARD
//|// fix-3: compact technical report card
//|function techCard(r) {
//|  const full = String(r.content || '');
//|  const parts = full.split(/\n\s*\n/);
//|  const headLines = (parts[0] || '').split('\n');
//|  const title = headLines.shift() || '';
//|  const facts = headLines.map((l) => { const i = l.indexOf(':'); return i > 0 && i < 40 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : null; });
//|  const structured = /^[A-Z ]{8,}$/.test(title.trim()) && facts.length >= 2 && facts.every(Boolean);
//|  const rest = structured ? parts.slice(1).join('\n\n') : full;
//|  const text = html`<div class="tp-text">${rest}</div>`;
//|  const meta = [`${r.issueCount} issue report${r.issueCount === 1 ? '' : 's'}`, r.reporterCount ? `${r.reporterCount} member${r.reporterCount === 1 ? '' : 's'}` : '', `${r.periodDays} days`].filter(Boolean).join(' · ');
//|  return html`<div class="panel tp-card"><div class="tp-head"><div><div class="tp-title">Technical report · ${dateShort(r.createdAt)}</div><div class="tp-meta">${meta}</div></div><span class="tag ${r.pushedAt ? 'ok' : 'info'}">${r.pushedAt ? 'Sent' : 'Ready'}</span></div>${structured ? html`<dl class="tp-facts">${facts.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>` : ''}${rest.length > 650 ? html`<details class="tp-more"><summary>View full report</summary>${text}</details>` : (rest.trim() ? text : '')}<div class="tp-actions"><button class="btn primary" data-act="tech-download" data-id="${r.id}">Download</button><button class="btn" data-act="tech-push" data-id="${r.id}">Send to channel</button><span class="tp-spacer"></span><button class="btn ban" data-act="tech-delete" data-id="${r.id}">Delete</button></div></div>`;
//|}
//|#### TECH_HANDLER
//|'tech-delete': async el => {
//|    const r = techRows.find(x => x.id === el.dataset.id); if (!r) return;
//|    if (!confirm(`Delete the report from ${dateShort(r.createdAt)}? This permanently removes it, including its evidence links, and cannot be undone.`)) return;
//|    await api(`/pulse/technical-push/${enc(r.id)}`, { method: 'DELETE' });
//|    toast('Report deleted'); await loadTechnicalPush();
//|  },
//|  'tech-download': el => {
//|#### LANDING_POINTS
//|<ul class="points">
//|          <li><span class="pi">${icon('shield')}</span><div><b>Protection that asks first</b><span>Catches fake admins, scam links and raid bots in Discord and Telegram. Nobody is banned without your decision.</span></div></li>
//|          <li><span class="pi">${icon('pulse')}</span><div><b>Pulse</b><span>What members ask, suggest and worry about, next to what is moving in crypto and in the pools you watch.</span></div></li>
//|          <li><span class="pi">${icon('campaigns')}</span><div><b>Campaign planner</b><span>Brainstorm campaigns that fit your community, pick one, and get a draft. Nothing is published for you.</span></div></li>
//|          <li><span class="pi">${icon('faqs')}</span><div><b>Answers and reports you approve</b><span>Spots repeated questions, drafts replies from your own docs, and turns reported bugs into developer reports. Nothing goes out unless you choose it.</span></div></li>
//|        </ul>
//|#### CSS
//|/* fix-3: shared panel header (it had no styles, so headings touched the panel edge) and compact report cards */
//|.panelhead{display:flex; justify-content:space-between; align-items:center; gap:8px 14px; flex-wrap:wrap; padding:14px 18px; border-bottom:1px solid var(--line);}
//|.panelhead > h2{margin:0; padding:0; border:0; min-width:0; font-size:14px; font-weight:600; display:flex; align-items:baseline; gap:2px 10px; flex-wrap:wrap;}
//|.panelhead > h2 span{color:var(--sub); font-weight:400; font-size:12.5px;}
//|.panelhead + .pad{padding:16px 18px 18px;}
//|.panelhead + .pad .tools{margin-top:12px;}
//|.tp-card{padding:0;}
//|.tp-head{display:flex; justify-content:space-between; align-items:flex-start; gap:12px; padding:14px 18px 4px;}
//|.tp-title{font-size:14.5px; font-weight:600;}
//|.tp-meta{font-size:12.5px; color:var(--sub); margin-top:2px;}
//|.tp-facts{display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:10px 18px; margin:10px 18px 4px; padding:12px 14px; background:var(--surface-2); border:1px solid var(--line); border-radius:10px;}
//|.tp-facts dt{font-size:11px; letter-spacing:.04em; text-transform:uppercase; color:var(--faint); font-weight:600;}
//|.tp-facts dd{margin:2px 0 0; font-size:13px; overflow-wrap:anywhere;}
//|.tp-text{white-space:pre-wrap; overflow-wrap:anywhere; font-size:13px; line-height:1.65; color:var(--text); padding:12px 18px 2px;}
//|.tp-more{margin:6px 0 0;}
//|.tp-more > summary{cursor:pointer; padding:8px 18px; font-size:13px; font-weight:600; color:var(--accent); list-style:none;}
//|.tp-more > summary::-webkit-details-marker{display:none;}
//|.tp-actions{display:flex; gap:8px; flex-wrap:wrap; align-items:center; padding:12px 18px 16px;}
//|.tp-spacer{flex:1;}
//|@media (max-width:560px){.tp-spacer{display:none;}}
