'use strict';
/* Sentinel creator panel. Everything from outside goes through html``, which escapes it. */
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const RAW = Symbol('raw');
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const part = (v) => (v === false || v == null ? '' : Array.isArray(v) ? v.map(part).join('') : v[RAW] ? v.s : esc(v));
const html = (s, ...v) => { let o = ''; s.forEach((x, i) => { o += x + (i < v.length ? part(v[i]) : ''); }); return { [RAW]: true, s: o }; };
const $ = (s, el = document) => el.querySelector(s);
const num = (n) => Number(n || 0).toLocaleString();
const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never');
const dshort = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'never');

let toastTimer;
function toast(msg, err = false) { const t = $('#toast'); t.textContent = msg; t.className = `toast show${err ? ' err' : ''}`; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = 'toast'; }, 2800); }
async function api(path, { method = 'GET', body } = {}) {
  const o = { method, headers: {} };
  if (method !== 'GET') { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(body ?? {}); }
  const r = await fetch(`/api/creator${path}`, o);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || `Request failed (${r.status})`); e.status = r.status; throw e; }
  return j;
}

const TABS = [['overview', 'Overview'], ['people', 'People'], ['communities', 'Communities'], ['plans', 'Plans and access'], ['releases', 'Releases'], ['health', 'Health'], ['activity', 'Activity log']];
let tab = 'overview', search = '', cache = {}, healthTimer = null;
const STAGE = { off: 'Off for everyone', creator: 'Testing (only me)', live: 'Live' };

function frame(body) {
  $('#cp').innerHTML = html`<div class="cp-top"><h1>Creator panel</h1><a href="/">← Back to Sentinel</a></div>
    <div class="cp-tabs">${TABS.map(([id, l]) => html`<button class="${tab === id ? 'on' : ''}" data-tab="${id}">${l}</button>`)}</div>${body}`.s;
}

async function load() {
  clearInterval(healthTimer);
  try {
    if (tab === 'overview') return viewOverview(await api('/overview'));
    if (tab === 'people') return viewPeople(await api(`/accounts?q=${encodeURIComponent(search)}`));
    if (tab === 'communities') return viewCommunities(await api('/communities'));
    if (tab === 'plans') return viewPlans(await api('/plans'));
    if (tab === 'releases') return viewReleases(await api('/releases'));
    if (tab === 'health') { await viewHealth(); healthTimer = setInterval(() => { if (tab === 'health' && !document.hidden) viewHealth(); }, 15000); return; }
    if (tab === 'activity') return viewActivity(await api('/audit'));
  } catch (e) {
    if (e.status === 404 || e.status === 401) { $('#cp').innerHTML = html`<div class="cp-panel"><h2>Not available</h2><p class="muted">This page is only for the Sentinel creator. Sign in with the creator account, and make sure CREATOR_IDS is set on the server.</p><a href="/">Back to Sentinel</a></div>`.s; return; }
    toast(e.message, true);
  }
}

function viewOverview(o) {
  const t = o.totals;
  const card = (n, l) => html`<div class="cp-card"><b>${num(n)}</b><span class="muted">${l}</span></div>`;
  frame(html`
    <div class="cp-grid">${card(t.accounts, 'People signed up')}${card(t.newToday, 'New today')}${card(t.active24h, 'Active 24h')}${card(t.active7d, 'Active 7 days')}
      ${card(t.paying, 'On a paid plan')}${card(t.paused, 'Paused')}${card(t.communities, 'Communities')}${card(t.members, 'Members across them')}${card(t.openAlerts, 'Open alerts')}${card(t.emailsCollected, 'Emails collected')}</div>
    ${o.waiting.length ? html`<div class="cp-panel"><h2>Waiting for your approval</h2><p class="muted">Pushed but hidden from users: ${o.waiting.map((w) => w.label).join(', ')}. Open Releases to let users in.</p></div>` : ''}
    ${!o.emailEnabled ? html`<div class="cp-panel"><h2>Emails</h2><p class="muted">Not being collected. Set CREATOR_COLLECT_EMAIL=true on the server. Discord will then ask people for their email on their next sign in. Telegram never shares one.</p></div>` : ''}
    <div class="cp-panel"><h2>What people use</h2><table class="cp-table"><tr><th>Feature</th><th>Stage</th><th>Used by</th><th>Never used</th><th>Visits</th></tr>
      ${o.usage.map((u) => html`<tr><td>${u.label}</td><td><span class="cp-pill ${u.stage === 'live' ? 'ok' : 'warn'}">${STAGE[u.stage]}</span></td><td>${num(u.used)}</td><td>${num(u.unused)}</td><td>${num(u.visits)}</td></tr>`)}</table></div>
    <div class="cp-panel"><h2>Plans</h2>${o.plans.map((p) => html`<span class="cp-pill" style="margin-right:8px">${p.label}: ${num(p.accounts)}</span>`)}</div>
    <div class="cp-panel"><h2>Newest sign ups</h2>${o.recent.length ? o.recent.map((r) => html`<div class="cp-log">${r.name || r.key} · ${r.plan} · ${when(r.firstSeen)}</div>`) : html`<p class="muted">Nobody has signed in since the panel was installed.</p>`}</div>
    <div class="cp-panel"><h2>Running build</h2><p class="muted">Version ${o.build.version || 'unknown'}${o.build.commit ? `, commit ${o.build.commit}` : ''}. Started ${when(o.build.startedAt)}. Node ${o.build.node}.</p></div>`.s);
}

function viewPeople(r) {
  frame(html`<div class="cp-panel"><div class="cp-row"><input type="search" id="q" placeholder="Search name, email or ID" value="${search}"><button class="cp-btn" data-act="search">Search</button><span class="muted">${num(r.total)} found</span></div>
    <table class="cp-table"><tr><th>Person</th><th>Email</th><th>Plan</th><th>Paid until</th><th>Last in</th><th>Used</th><th>Not used</th><th></th></tr>
    ${r.accounts.map((a) => html`<tr data-key="${a.key}"><td><b>${a.name || a.key}</b><br><span class="muted">${a.key} · ${a.logins} sign-ins</span></td><td>${a.email || '—'}</td>
      <td><select data-field="plan"><option value="free" ${a.plan === 'free' ? 'selected' : ''}>Free</option><option value="pro" ${a.plan === 'pro' ? 'selected' : ''}>Pro</option><option value="team" ${a.plan === 'team' ? 'selected' : ''}>Team</option></select>
        ${a.effectivePlan !== a.plan ? html`<br><span class="cp-pill warn">expired, treated as Free</span>` : ''}</td>
      <td><input type="date" data-field="paidUntil" value="${a.paidUntil || ''}"></td><td>${when(a.lastLogin)}</td>
      <td class="muted">${a.used.length ? a.used.join(', ') : 'nothing yet'}</td><td class="muted">${a.unused.length === 0 ? '—' : a.unused.length + ' features'}</td>
      <td><button class="cp-btn ${a.suspended ? 'go' : 'stop'}" data-act="pause" data-paused="${a.suspended}">${a.suspended ? 'Resume' : 'Pause'}</button></td></tr>`)}</table></div>`.s);
}

function viewCommunities(r) {
  frame(html`<div class="cp-panel"><table class="cp-table"><tr><th>Community</th><th>Platform</th><th>Members</th><th>Read today</th><th>Read 7d</th><th>Flagged 7d</th><th>Open alerts</th><th>Last seen</th></tr>
    ${r.communities.map((c) => html`<tr><td>${c.name}</td><td>${c.platform}</td><td>${c.members == null ? '—' : num(c.members)}</td><td>${num(c.scannedToday)}</td><td>${num(c.scanned7d)}</td><td>${num(c.flagged7d)}</td><td>${num(c.openAlerts)}</td><td>${dshort(c.lastSeen)}</td></tr>`)}</table>
    ${r.communities.length ? '' : html`<p class="muted">No communities connected yet.</p>`}</div>`.s);
}

function viewPlans(r) {
  frame(html`<div class="cp-panel"><h2>What each plan includes</h2><p class="muted">Tick a box to include a feature in a plan. Changes apply immediately. Creators are never blocked.</p>
    <table class="cp-table"><tr><th>Feature</th>${r.plans.map((p) => html`<th>${p.label}</th>`)}</tr>
    ${r.features.map((f) => html`<tr><td><b>${f.label}</b><br><span class="muted">${f.blurb}</span></td>${r.plans.map((p) => html`<td><input class="cp-tick" type="checkbox" data-plan="${p.id}" data-feature="${f.id}" ${p.features[f.id] ? 'checked' : ''}></td>`)}</tr>`)}</table></div>`.s);
}

function viewReleases(r) {
  frame(html`<div class="cp-panel"><h2>Features: who can use them</h2><p class="muted">Running version ${r.build.version || '?'}${r.build.commit ? `, commit ${r.build.commit}` : ''}. A new push stays hidden until you release it.</p>
    <table class="cp-table">${r.features.map((f) => html`<tr data-feature="${f.id}"><td><b>${f.label}</b><br><span class="muted">${f.blurb}</span></td><td><span class="cp-pill ${f.stage === 'live' ? 'ok' : 'warn'}">${STAGE[f.stage]}</span></td>
      <td>${f.stage !== 'live' ? html`<button class="cp-btn go" data-act="stage" data-stage="live">Release to everyone</button>` : ''}
        ${f.stage !== 'creator' ? html`<button class="cp-btn" data-act="stage" data-stage="creator">Only me</button>` : ''}
        ${f.stage !== 'off' ? html`<button class="cp-btn stop" data-act="stage" data-stage="off">Turn off</button>` : ''}</td></tr>`)}</table></div>
    <div class="cp-panel"><h2>Add a release note</h2><div class="cp-row"><input type="text" id="r-ver" placeholder="Version (optional)"><input type="text" id="r-title" placeholder="Title" style="flex:1"></div><textarea id="r-notes" placeholder="What changed"></textarea><div class="cp-row"><button class="cp-btn go" data-act="release">Save note</button></div></div>
    <div class="cp-panel"><h2>Release history</h2>${r.releases.length ? r.releases.map((x) => html`<div class="cp-log"><b>${x.version ? x.version + ' · ' : ''}${x.title}</b> · ${when(x.at)}<br>${x.notes}</div>`) : html`<p class="muted">No notes yet.</p>`}</div>`.s);
}

async function viewHealth() {
  const h = await api('/health'), n = h.numbers;
  if (tab !== 'health') return;
  const label = { ok: 'Healthy', warn: 'Needs a look', bad: 'Problem' }[h.status];
  frame(html`<div class="cp-panel"><h2>Overall: <span class="cp-pill ${h.status}">${label}</span></h2><p class="muted">Refreshes every 15 seconds. ${num(n.requests15m)} requests in 15 min, up ${Math.round(n.uptimeSec / 60)} min.</p></div>
    <div class="cp-panel"><table class="cp-table">${h.checks.map((c) => html`<tr><td><b>${c.label}</b></td><td><span class="cp-pill ${c.status}">${c.status === 'info' ? 'info' : c.status === 'ok' ? 'OK' : c.status === 'warn' ? 'Warning' : 'Problem'}</span></td><td>${c.detail}</td></tr>`)}</table></div>
    <div class="cp-panel"><h2>Recent errors</h2>${h.errors.length ? h.errors.map((e) => html`<div class="cp-log">${when(e.at)} · ${e.msg}</div>`) : html`<p class="muted">No errors since the last restart.</p>`}</div>`.s);
}

function viewActivity(r) {
  frame(html`<div class="cp-panel"><h2>Everything changed from this panel</h2>${r.audit.length ? r.audit.map((a) => html`<div class="cp-log">${when(a.at)} · ${a.who} · <b>${a.action}</b> · ${a.detail}</div>`) : html`<p class="muted">Nothing yet.</p>`}</div>`.s);
}

async function act(fn, ok) { try { await fn(); if (ok) toast(ok); await load(); } catch (e) { toast(e.message, true); } }

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab]'); if (t) { tab = t.dataset.tab; return load(); }
  const a = e.target.closest('[data-act]'); if (!a) return;
  const row = a.closest('tr');
  if (a.dataset.act === 'search') { search = $('#q').value; return load(); }
  if (a.dataset.act === 'pause') return act(() => api(`/accounts/${encodeURIComponent(row.dataset.key)}`, { method: 'POST', body: { suspended: a.dataset.paused !== 'true' } }), 'Saved');
  if (a.dataset.act === 'stage') return act(() => api(`/features/${row.dataset.feature}/stage`, { method: 'POST', body: { stage: a.dataset.stage } }), 'Saved');
  if (a.dataset.act === 'release') return act(() => api('/releases', { method: 'POST', body: { version: $('#r-ver').value, title: $('#r-title').value, notes: $('#r-notes').value } }), 'Release note saved');
});
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.plan) return act(() => api(`/plans/${el.dataset.plan}/${el.dataset.feature}`, { method: 'POST', body: { enabled: el.checked } }), 'Saved');
  if (el.dataset.field) { const row = el.closest('tr'); return act(() => api(`/accounts/${encodeURIComponent(row.dataset.key)}`, { method: 'POST', body: { [el.dataset.field]: el.value } }), 'Saved'); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'q') { search = e.target.value; load(); } });
load();
