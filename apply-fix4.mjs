#!/usr/bin/env node
// Sentinel patch fix-4: new landing page (hero, Pulse example, module tiles) and the slogan.
//
//   node apply-fix4.mjs            apply (run from the Sentinel-Bot folder)
//   node apply-fix4.mjs --revert   undo only this patch
//
// It replaces only the landing's left panel, so it works with or without the earlier patches.
// Every anchor is checked first; if one is missing, NOTHING is written.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.cwd();
const abs = (f) => path.join(root, f);
const bak = (f) => abs(f) + '.bak-fix4';
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
  'dashboard/app.js': [
    { name: 'landing left panel', start: '<section class="login-brand">', end: '</section>', replace: blocks.LANDING_LEFT },
    { name: 'slogan in the sidebar', all: true, start: '<small>Community protection</small>', replace: '<small>Intelligent Community Pioneer</small>' },
    { name: 'trust line', start: '<p class="note muted">Signing in never gives Sentinel your password.', replace: blocks.TRUST },
    { name: 'marker', start: 'let loginTimer;', replace: '// fix-4: landing page\nlet loginTimer;' }
  ],
  'dashboard/style.css': [{ name: 'styles', append: blocks.CSS }]
};
const FILES = Object.keys(PLAN);

if (!fs.existsSync(abs('package.json')) || !FILES.every((f) => fs.existsSync(abs(f)))) die('Run this from the Sentinel-Bot project folder (the one that contains package.json, src/ and dashboard/).');

if (process.argv.includes('--revert')) {
  let n = 0;
  for (const f of FILES) if (fs.existsSync(bak(f))) { fs.copyFileSync(bak(f), abs(f)); fs.unlinkSync(bak(f)); n++; console.log('restored ' + f); }
  console.log(n ? '\n✔ fix-4 reverted.' : 'No fix-4 backups found, nothing to revert.');
  process.exit(0);
}

function edit(text, label, op) {
  if (op.append) return text.replace(/\n*$/, '\n') + op.append + '\n';
  const i = text.indexOf(op.start);
  if (i < 0) die(`${label}: anchor not found. Your file differs from the version this patch was written for.`);
  if (op.all) return text.split(op.start).join(op.replace);
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
  if (raw.includes('fix-4')) die(`${f} already has this patch. Use --revert first to re-apply.`);
  const crlf = raw.includes('\r\n');
  let text = raw.replace(/\r\n/g, '\n');
  PLAN[f].forEach((op, n) => { text = edit(text, `${f} #${n + 1} (${op.name})`, op); });
  out[f] = crlf ? text.replace(/\n/g, '\r\n') : text;
}
for (const f of FILES) { fs.copyFileSync(abs(f), bak(f)); fs.writeFileSync(abs(f), out[f]); console.log('patched ' + f); }
console.log('\n✔ fix-4 applied. Hard-refresh the dashboard (Ctrl+Shift+R), then sign out to see the landing page.');
console.log('  Undo with: node apply-fix4.mjs --revert');
process.exit(0);

// ---- code blocks (data, not executed) ----

//|#### LANDING_LEFT
//|<section class="login-brand">
//|      <div class="brand">${raw(MARK)}<div><b>Sentinel</b><small>Intelligent Community Pioneer</small></div></div>
//|      <div class="login-hero">
//|        <h1>Protect your community. Understand it. Grow it.</h1>
//|        <p class="lead">One workspace for Web3 community teams.</p>
//|        <div class="lp-card" role="img" aria-label="Example of the Pulse screen">
//|          <div class="lp-head"><span class="lp-title">${icon('pulse')}Pulse</span><span class="lp-sample">Example</span></div>
//|          <svg class="bigpulse lp-line" viewBox="0 0 480 60" preserveAspectRatio="none" aria-hidden="true"><path class="base" d="M0 30H480"/><path class="beat" pathLength="640" d="M0 30H150L175 30L200 6L238 54L262 30H480"/></svg>
//|          <ul class="lp-rows">
//|            <li><span class="lp-tag q">Question</span><span>14 members asked how to bridge</span></li>
//|            <li><span class="lp-tag c">Concern</span><span>Withdrawals feel slow today</span></li>
//|            <li><span class="lp-tag i">Idea</span><span>A weekly quiz night</span></li>
//|          </ul>
//|        </div>
//|        <div class="lp-tiles">
//|          <div class="lp-tile"><span class="pi">${icon('shield')}</span><b>Protection</b><span class="d">Scam links and fake admins, flagged.</span></div>
//|          <div class="lp-tile"><span class="pi">${icon('campaigns')}</span><b>Campaigns</b><span class="d">Ideas that fit your community.</span></div>
//|          <div class="lp-tile"><span class="pi">${icon('faqs')}</span><b>Support</b><span class="d">Repeated questions and bugs, sorted.</span></div>
//|        </div>
//|      </div>
//|      <p class="foot">Built for Web3 community teams on Discord and Telegram.</p>
//|    </section>
//|#### TRUST
//|<div class="trust">${icon('shield')}<span>Nothing is banned, posted or sent unless you approve it or switch it on.</span></div>
//|      <p class="note muted">Signing in never gives Sentinel your password.
//|#### CSS
//|/* fix-4: landing page */
//|.login-brand{gap:24px; padding-top:36px; padding-bottom:30px;}
//|.login-hero h1{font-size:clamp(26px,2.8vw,36px); margin-bottom:12px; text-wrap:balance;}
//|.login-hero .lead{color:var(--rail-text); font-size:14.5px; line-height:1.5; margin:0 0 20px;}
//|.lp-card{background:rgba(255,255,255,.04); border:1px solid var(--rail-line); border-radius:14px; padding:12px 16px 4px; margin:0 0 12px;}
//|.lp-head{display:flex; justify-content:space-between; align-items:center;}
//|.lp-title{display:flex; align-items:center; gap:8px; color:#fff; font-weight:600; font-size:13.5px;}
//|.lp-title .ic svg{width:16px; height:16px; color:var(--rail-accent);}
//|.lp-sample{font-size:10.5px; letter-spacing:.06em; text-transform:uppercase; color:var(--rail-sub); border:1px solid var(--rail-line); border-radius:999px; padding:1px 8px;}
//|.bigpulse.lp-line{display:block; width:100%; max-width:none; height:22px; margin:6px 0 4px;}
//|.lp-rows{list-style:none; margin:0; padding:0;}
//|.lp-rows li{display:flex; align-items:center; gap:10px; padding:8px 0; border-top:1px solid var(--rail-line); font-size:13px; color:var(--rail-text);}
//|.lp-tag{flex:0 0 auto; min-width:70px; text-align:center; font-size:11px; font-weight:600; padding:2px 8px; border-radius:6px;}
//|.lp-tag.q{color:#8fd3ff; background:rgba(106,174,242,.16);}
//|.lp-tag.c{color:#ffb4bf; background:rgba(244,105,123,.16);}
//|.lp-tag.i{color:#8ff0c4; background:rgba(62,207,142,.16);}
//|.lp-tiles{display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px;}
//|.lp-tile{display:flex; flex-direction:column; gap:3px; padding:11px 12px; border:1px solid var(--rail-line); border-radius:12px; background:rgba(255,255,255,.025);}
//|.lp-tile .pi{width:30px; height:30px; border-radius:9px; background:var(--rail-active); color:var(--rail-accent); display:flex; align-items:center; justify-content:center; margin-bottom:4px;}
//|.lp-tile .pi svg{width:16px; height:16px;}
//|.lp-tile b{color:#fff; font-size:13px; font-weight:600;}
//|.lp-tile .d{color:var(--rail-text); font-size:12.5px; line-height:1.45;}
//|.login .trust{display:flex; gap:8px; align-items:flex-start; margin:20px 0 0; font-size:13px; line-height:1.5; color:var(--sub);}
//|.login .trust svg{width:16px; height:16px; flex:0 0 auto; margin-top:2px; color:var(--accent);}
//|.brand small{line-height:1.25; overflow-wrap:anywhere;}
//|@media (max-width:900px){.login{grid-template-columns:1fr;} .login-brand{padding:32px 24px;} .lp-tiles{grid-template-columns:1fr;}}
