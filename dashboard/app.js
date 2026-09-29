'use strict';

/* =====================================================================
   Helpers
   Anything that comes from outside (scam messages, usernames, community
   names) is escaped automatically by html``. To insert trusted markup,
   nest another html`` block. Never build markup with plain strings.
===================================================================== */
const RAW = Symbol('raw');
const raw = (s) => ({ [RAW]: true, s });
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const part = (v) => {
  if (v === false || v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map(part).join('');
  return v && v[RAW] ? v.s : esc(v);
};
function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s; if (i < vals.length) out += part(vals[i]); });
  return raw(out);
}
const $ = (sel, el = document) => el.querySelector(sel);
const enc = encodeURIComponent;
const num = (n) => Number(n || 0).toLocaleString();

function ago(iso) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
const dateShort = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Unknown');
const PLAT = { telegram: 'Telegram', discord: 'Discord' };
const CODE = { telegram: 'TG', discord: 'DC' };

function qs(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

let toastTimer;
function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast show${isErr ? ' err' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 2800);
}

async function api(path, { method = 'GET', body } = {}) {
  const opts = { method, headers: {} };
  if (method !== 'GET') { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body ?? {}); }
  const res = await fetch(`/api${path}`, opts);
  if (!res.ok) {
    const err = new Error((await res.json().catch(() => ({}))).error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function fail(e) {
  if (e.status === 401) { state.me = null; render(); return; }
  toast(e.message, true);
}

/* =====================================================================
   State and routing
===================================================================== */
const state = {
  cfg: { discord: false, telegram: false },
  me: null,
  scope: 'all',          // 'all' or a community key like "telegram:-100123"
  filter: 'open',        // open | done | all
  reportDays: 30,
  profile: null,
  settings: { platform: null, id: null, data: null, extra: null }
};

const NAV = [
  ['home', 'Home', '◆'], ['discord', 'Discord', '◈'], ['telegram', 'Telegram', '✈'],
  ['reports', 'Reports', '▤'], ['network', 'Network', '◎'], ['settings', 'Settings', '⚙']
];

function route() {
  const [page = 'home', sub = ''] = location.hash.replace(/^#\/?/, '').split('/');
  return { page: NAV.some((n) => n[0] === page) ? page : 'home', sub };
}

const communitiesOf = (platform) => state.me.communities.filter((c) => !platform || c.platform === platform);

// Which community filter applies on a page that shows only one platform.
function communityFor(platform) {
  if (state.scope === 'all') return undefined;
  return !platform || state.scope.startsWith(`${platform}:`) ? state.scope : undefined;
}

function scopeSelect(platform) {
  const list = communitiesOf(platform);
  const value = platform ? (communityFor(platform) || 'all') : state.scope;
  return html`<select data-change="scope" aria-label="Community">
    <option value="all" ${value === 'all' ? 'selected' : ''}>${platform ? `All ${PLAT[platform]} communities` : 'All communities'}</option>
    ${list.map((c) => html`<option value="${c.key}" ${value === c.key ? 'selected' : ''}>${platform ? '' : `${CODE[c.platform]} · `}${c.name}</option>`)}
  </select>`;
}

/* =====================================================================
   Boot, sign in
===================================================================== */
async function boot() {
  try { state.cfg = await fetch('/auth/config').then((r) => r.json()); } catch { /* keep defaults */ }
  try { state.me = await api('/me'); } catch { state.me = null; }
  render();
}

function render() {
  if (!state.me) return renderLogin();
  const { page } = route();
  $('#app').innerHTML = shell(page).s;
  loadPage(page);
}

let loginTimer;
function renderLogin() {
  clearInterval(loginTimer);
  $('#drawer-root').innerHTML = '';
  $('#app').innerHTML = html`<div class="login"><div class="box">
    <div class="brand" style="padding-left:0"><div class="dot"></div><div><b>Sentinel</b><small>Community Protection</small></div></div>
    <h1>Sign in</h1>
    <p>Sign in with the account you use to run your community. Sentinel shows only the servers and groups where you are a real admin.</p>
    ${state.cfg.discord
      ? html`<a class="btn discord" href="/auth/discord">Continue with Discord</a>`
      : html`<button class="btn" disabled>Discord sign in is not set up yet</button>`}
    ${state.cfg.telegram
      ? html`<button class="btn telegram" data-act="tg-login">Continue with Telegram</button>`
      : html`<button class="btn" disabled>Telegram bot is not running</button>`}
    <div id="tg-wait"></div>
    <p class="note muted">Signing in never gives Sentinel your password. Discord shows you what is shared. Telegram confirms who you are through the bot.</p>
  </div></div>`.s;
}

async function telegramLogin() {
  const r = await fetch('/auth/telegram/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    .then((x) => x.json()).catch(() => ({}));
  if (!r.code) return toast(r.error || 'Could not start Telegram sign in', true);
  window.open(r.url, '_blank', 'noopener');
  $('#tg-wait').innerHTML = html`<p class="muted">Press <b>Start</b> in Telegram. Nothing opened? <a href="${r.url}" target="_blank" rel="noopener">Tap here</a>. Waiting for you…</p>`.s;
  clearInterval(loginTimer);
  let tries = 0;
  loginTimer = setInterval(async () => {
    tries++;
    const s = await fetch(`/auth/telegram/status?code=${r.code}`).then((x) => x.json()).catch(() => ({}));
    if (s.ok) { clearInterval(loginTimer); boot(); }
    else if (tries > 290 || s.waiting === false) {
      clearInterval(loginTimer);
      $('#tg-wait').innerHTML = html`<p class="muted">That link expired. Press the button to try again.</p>`.s;
    }
  }, 2000);
}

/* =====================================================================
   Shell
===================================================================== */
function shell(page) {
  const me = state.me;
  const who = [
    me.discord && html`<div class="who-chip"><span class="plat discord">DC</span>${me.discord.user.username}</div>`,
    me.telegram && html`<div class="who-chip"><span class="plat telegram">TG</span>${me.telegram.user.username ? `@${me.telegram.user.username}` : me.telegram.user.firstName}</div>`
  ];
  return html`<div class="shell">
    <aside class="rail">
      <div class="brand"><div class="dot"></div><div><b>Sentinel</b><small>Community Protection</small></div></div>
      <nav class="nav">
        ${NAV.map(([id, label, ic]) => html`<a data-nav="#/${id}" class="${page === id ? 'active' : ''}"><span class="ic">${ic}</span>${label}${(id === 'discord' || id === 'telegram') ? html`<span class="badge" data-badge="${id}" hidden></span>` : ''}</a>`)}
      </nav>
      <div class="railfoot">${who}<a href="#/settings/account" data-nav="#/settings/account">Account</a><a data-act="logout" style="cursor:pointer">Log out</a></div>
    </aside>
    <main class="main" id="page"><div class="empty">Loading…</div></main>
  </div>
  <nav class="tabbar">
    ${NAV.map(([id, label, ic]) => html`<a data-nav="#/${id}" class="${page === id ? 'active' : ''}"><span class="ic">${ic}</span>${label}</a>`)}
  </nav>`;
}

async function loadPage(page, opts = {}) {
  try {
    const { sub } = route();
    if (page === 'home') await loadHome();
    else if (page === 'discord' || page === 'telegram') await loadPlatform(page);
    else if (page === 'reports') await loadReports();
    else if (page === 'network') await loadNetwork();
    else if (page === 'settings') await loadSettings(sub);
    updateBadges();
  } catch (e) { if (!opts.silent) fail(e); }
}

async function updateBadges() {
  for (const p of ['discord', 'telegram']) {
    try {
      const s = await api(`/stats${qs({ platform: p })}`);
      document.querySelectorAll(`[data-badge="${p}"]`).forEach((el) => { el.textContent = s.awaitingReview; el.hidden = !s.awaitingReview; });
    } catch { /* ignore */ }
  }
}

const setPage = (h) => { const el = $('#page'); if (el) el.innerHTML = h.s; };

/* =====================================================================
   Pieces used on several pages
===================================================================== */
function statCards(s) {
  return html`<div class="grid">
    <div class="card accent"><div class="num">${num(s.threatsToday)}</div><div class="lbl">Threats caught today</div></div>
    <div class="card ${s.awaitingReview ? 'warn' : 'ok'}"><div class="num">${num(s.awaitingReview)}</div><div class="lbl">Awaiting your review</div></div>
    <div class="card"><div class="num">${num(s.scannedToday)}</div><div class="lbl">Messages scanned today</div></div>
    <div class="card"><div class="num">+${num(s.joinsToday)} / −${num(s.leavesToday)}</div><div class="lbl">Members joined / left today</div></div>
  </div>`;
}

const RES_CLASS = { banned: 'bad', released: 'ok', cautioned: 'net' };

function alertRow(a, withActions) {
  const data = html`data-act="profile" data-platform="${a.platform}" data-community="${a.guildId}" data-user="${a.userId}"`;
  const btn = (kind, label) => html`<button class="btn ${kind}" data-act="do" data-do="${kind === 'ban' ? 'ban' : kind}" data-platform="${a.platform}" data-community="${a.guildId}" data-user="${a.userId}">${label}</button>`;
  return html`<div class="row" ${data}>
    <div class="plat ${a.platform}">${CODE[a.platform]}</div>
    <div class="rowmain">
      <div class="who">${a.username}
        ${a.seenElsewhere && html`<span class="tag net">Seen in ${a.networkCount || 'other'} other communit${a.networkCount === 1 ? 'y' : 'ies'}</span>`}
        <span class="tag">${a.ruleLabel}</span></div>
      <div class="txt" title="${a.text}">${a.text}</div>
    </div>
    <div class="meta">${a.guildName}${a.channelName && a.channelName !== a.guildName ? ` · #${a.channelName}` : ''}<br>${ago(a.createdAt)} · ${a.actionTaken}</div>
    ${withActions && (a.resolved
      ? html`<span class="tag ${RES_CLASS[a.resolution] || ''}">${a.resolution}</span>`
      : html`<div class="actions">${btn('ban', 'Ban')}${btn('release', 'Release')}${btn('caution', 'Caution')}</div>`)}
  </div>`;
}

function onboarding(platform) {
  const tg = html`<p><b>Telegram:</b> add <b>@${state.cfg.telegramBot || 'your bot'}</b> to your group, make it an admin, then send any message in the group. It appears here within seconds.</p>`;
  const dc = html`<p><b>Discord:</b> ${state.me.invites.length
    ? html`add Sentinel to a server you manage: ${state.me.invites.map((i) => html`<a class="btn primary" style="margin:4px 6px 0 0;display:inline-block" href="${i.url}" target="_blank" rel="noopener">Add to ${i.name}</a>`)}`
    : 'sign in with Discord, then add Sentinel to your server.'}</p>`;
  return html`<div class="panel"><div class="empty"><b>No ${platform ? PLAT[platform] : ''} communities yet</b><br>
    ${platform !== 'discord' && tg}${platform !== 'telegram' && dc}</div></div>`;
}

/* =====================================================================
   Home
===================================================================== */
async function loadHome() {
  const community = state.scope === 'all' ? undefined : state.scope;
  const [stats, tg, dc] = await Promise.all([
    api(`/stats${qs({ community })}`),
    api(`/alerts${qs({ community, platform: 'telegram', resolved: false, limit: 6 })}`),
    api(`/alerts${qs({ community, platform: 'discord', resolved: false, limit: 6 })}`)
  ]);
  const column = (platform, alerts) => html`<div class="panel">
    <h2>${PLAT[platform]} <span><a data-nav="#/${platform}" style="cursor:pointer">Open ${PLAT[platform]} dashboard →</a></span></h2>
    ${alerts.length ? alerts.map((a) => alertRow(a, false))
      : html`<div class="empty">${communitiesOf(platform).length ? 'Nothing waiting. All clear.' : `No ${PLAT[platform]} community connected yet.`}</div>`}
  </div>`;
  setPage(html`
    <div class="topbar"><h1>Today, at a glance</h1><div class="tools">${scopeSelect(null)}</div></div>
    ${!state.me.communities.length && onboarding(null)}
    ${statCards(stats)}
    <div class="split">${column('telegram', tg)}${column('discord', dc)}</div>`);
}

/* =====================================================================
   Discord and Telegram dashboards
===================================================================== */
async function loadPlatform(platform) {
  if (!communitiesOf(platform).length) {
    return setPage(html`<div class="topbar"><h1>${PLAT[platform]}</h1></div>${onboarding(platform)}`);
  }
  const community = communityFor(platform);
  const resolved = state.filter === 'open' ? false : state.filter === 'done' ? true : undefined;
  const [stats, alerts] = await Promise.all([
    api(`/stats${qs({ platform, community })}`),
    api(`/alerts${qs({ platform, community, resolved, limit: 200 })}`)
  ]);
  const tab = (id, label) => html`<button class="${state.filter === id ? 'active' : ''}" data-act="filter" data-filter="${id}">${label}</button>`;
  setPage(html`
    <div class="topbar"><h1>${PLAT[platform]}</h1><div class="tools">${scopeSelect(platform)}</div></div>
    ${statCards(stats)}
    <div class="tabs">${tab('open', 'Awaiting review')}${tab('done', 'Handled')}${tab('all', 'Everything')}</div>
    <div class="panel">
      ${alerts.length ? alerts.map((a) => alertRow(a, true))
        : html`<div class="empty"><b>${state.filter === 'open' ? 'Nothing waiting for review' : 'Nothing here yet'}</b><br>Click any person to see their full history.</div>`}
    </div>`);
}

/* =====================================================================
   Profile panel
===================================================================== */
async function openProfile(platform, communityId, userId) {
  try {
    state.profile = await api(`/users/${platform}/${enc(communityId)}/${enc(userId)}`);
    drawProfile();
  } catch (e) { fail(e); }
}

function closeProfile() { state.profile = null; $('#drawer-root').innerHTML = ''; }

function drawProfile() {
  const p = state.profile;
  const d = (kind, label) => html`<button class="btn ${kind}" data-act="do" data-do="${kind}" data-platform="${p.platform}" data-community="${p.communityId}" data-user="${p.userId}">${label}</button>`;
  $('#drawer-root').innerHTML = html`<div class="overlay" data-act="close-overlay"><aside class="drawer" role="dialog" aria-label="Person details">
    <button class="x" data-act="close" aria-label="Close">✕</button>
    <h3>${p.username}</h3>
    <div class="id"><span class="plat ${p.platform}" style="display:inline-flex;width:auto;padding:0 6px;height:18px">${CODE[p.platform]}</span> ${p.communityName} · ID ${p.userId}</div>
    <div class="stat"><span>Joined</span><span>${p.joinedAt ? dateShort(p.joinedAt) : 'Before Sentinel'}</span></div>
    <div class="stat"><span>Flagged messages here</span><span>${p.flaggedCount}</span></div>
    <div class="stat"><span>Waiting for review</span><span>${p.openCount}</span></div>
    <div class="stat"><span>Cautions given</span><span>${p.cautionCount}</span></div>
    <div class="stat"><span>Last decision</span><span>${p.lastResolution || 'None yet'}</span></div>
    ${p.network.communities > 0
      ? html`<div class="netbadge"><b>Flagged in ${p.network.communities} other communit${p.network.communities === 1 ? 'y' : 'ies'}</b>${p.network.reasons.length ? html` for: ${p.network.reasons.join(', ')}` : ''}.</div>`
      : html`<div class="netbadge clear">Not flagged anywhere else on the network.</div>`}
    <h4>Recent flagged messages</h4>
    ${p.recent.length ? p.recent.map((h) => html`<div class="hist">${h.text}<div class="t">${h.ruleLabel} · ${h.actionTaken} · ${ago(h.createdAt)}${h.resolution ? ` · ${h.resolution}` : ''}</div></div>`)
      : html`<div class="muted">No flagged messages from this person.</div>`}
    <div class="actions">${d('ban', 'Ban')}${d('release', 'Release')}${d('caution', 'Caution')}</div>
    <p class="muted" style="margin-top:12px">Release lifts a mute. Caution posts your warning message in the chat and closes the alert.</p>
  </aside></div>`.s;
}

async function doAction(el) {
  const { do: action, platform, community, user } = el.dataset;
  if (action === 'ban' && !confirm('Ban this person from the community?')) return;
  el.disabled = true;
  try {
    const r = await api(`/users/${platform}/${enc(community)}/${enc(user)}/action`, { method: 'POST', body: { action } });
    toast(`Done: ${r.resolution}`);
    if (state.profile && state.profile.userId === user) await openProfile(platform, community, user);
    loadPage(route().page, { silent: true });
  } catch (e) { el.disabled = false; fail(e); }
}

/* =====================================================================
   Reports
===================================================================== */
function chart(points, series) {
  const W = 700, H = 140, base = H - 4;
  const n = points.length || 1;
  const max = Math.max(1, ...points.flatMap((p) => series.map((s) => p[s.key] || 0)));
  const gw = W / n, bw = Math.max(2, (gw * 0.8) / series.length);
  const bars = points.map((p, i) => series.map((s, j) => {
    const v = p[s.key] || 0, h = (v / max) * (H - 12);
    return `<rect class="${s.cls}" x="${(i * gw + gw * 0.1 + j * bw).toFixed(1)}" y="${(base - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5"><title>${esc(p.date)}: ${v} ${esc(s.label)}</title></rect>`;
  }).join('')).join('');
  return html`<div class="bars"><svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">${raw(bars)}</svg>
    <div class="muted" style="display:flex;justify-content:space-between"><span>${points[0]?.date || ''}</span><span>Tallest bar: ${max}</span><span>${points[points.length - 1]?.date || ''}</span></div></div>
    <div class="legend">${series.map((s) => html`<span><i style="background:${s.color}"></i>${s.label}</span>`)}</div>`;
}

let lastReport = null;
async function loadReports() {
  const community = state.scope === 'all' ? undefined : state.scope;
  const days = state.reportDays;
  const [m, g] = await Promise.all([
    api(`/reports/misconduct${qs({ days, community })}`),
    api(`/reports/growth${qs({ days, community })}`)
  ]);
  lastReport = { m, g, days };
  const maxRule = Math.max(1, ...m.byRule.map((r) => r.count));
  const members = [...g.days].reverse().find((d) => d.members !== null)?.members;
  setPage(html`
    <div class="topbar"><h1>Reports</h1><div class="tools">
      ${scopeSelect(null)}
      <select data-change="days">${[7, 30, 90].map((d) => html`<option value="${d}" ${d === days ? 'selected' : ''}>Last ${d} days</option>`)}</select>
      <a class="btn" href="/api/reports/export.csv${qs({ days, community })}">Download CSV</a>
      <button class="btn primary" data-act="copy-report">Copy summary</button>
    </div></div>

    <h4 style="margin-top:0">Misconduct</h4>
    <div class="grid">
      <div class="card accent"><div class="num">${num(m.totals.flagged)}</div><div class="lbl">Flagged messages</div></div>
      <div class="card"><div class="num">${num(m.totals.uniqueOffenders)}</div><div class="lbl">Different people</div></div>
      <div class="card bad"><div class="num">${num(m.totals.banned)}</div><div class="lbl">Banned</div></div>
      <div class="card warn"><div class="num">${num(m.totals.cautioned)}</div><div class="lbl">Cautioned</div></div>
    </div>
    <div class="panel"><h2>Flagged messages per day <span>${num(m.totals.scanned)} messages scanned in this period</span></h2>
      ${chart(m.days, [{ key: 'flagged', cls: 'bar-a', color: 'var(--accent)', label: 'Flagged messages' }])}</div>
    <div class="split">
      <div class="panel"><h2>What they were caught for</h2><div class="pad">
        ${m.byRule.length ? m.byRule.map((r) => html`<div class="hrow"><div class="l">${r.label}</div><div class="bar" style="width:${Math.round((r.count / maxRule) * 60)}%"></div><span class="muted">${r.count}</span></div>`)
          : html`<div class="muted">Nothing flagged in this period.</div>`}</div></div>
      <div class="panel"><h2>Repeat offenders</h2>
        ${m.topOffenders.length ? m.topOffenders.map((o) => html`<div class="row" data-act="profile" data-platform="${o.platform}" data-community="${o.communityId || ''}" data-user="${o.userId}">
          <div class="plat ${o.platform}">${CODE[o.platform]}</div>
          <div class="rowmain"><div class="who">${o.username}</div><div class="txt">${o.community}</div></div>
          <span class="tag ${RES_CLASS[o.status] || ''}">${o.status}</span><span class="muted">${o.count}×</span></div>`)
          : html`<div class="empty">No repeat offenders.</div>`}</div>
    </div>

    <h4>Community growth</h4>
    <div class="grid">
      <div class="card ok"><div class="num">+${num(g.totals.joins)}</div><div class="lbl">Joined</div></div>
      <div class="card bad"><div class="num">−${num(g.totals.leaves)}</div><div class="lbl">Left</div></div>
      <div class="card ${g.totals.net >= 0 ? 'accent' : 'warn'}"><div class="num">${g.totals.net >= 0 ? '+' : '−'}${num(Math.abs(g.totals.net))}</div><div class="lbl">Net change</div></div>
      <div class="card"><div class="num">${members === undefined ? '—' : num(members)}</div><div class="lbl">Members (latest count)</div></div>
    </div>
    <div class="panel"><h2>Joined and left per day</h2>
      ${chart(g.days, [{ key: 'joins', cls: 'bar-c', color: 'var(--ok)', label: 'Joined' }, { key: 'leaves', cls: 'bar-b', color: 'var(--danger)', label: 'Left' }])}</div>
    ${g.communities.length > 0 && html`<div class="panel"><h2>By community</h2>${g.communities.map((c) => html`<div class="row static">
      <div class="plat ${c.platform}">${CODE[c.platform]}</div><div class="rowmain"><div class="who">${c.name}</div></div>
      <span class="tag ok">+${c.joins}</span><span class="tag bad">−${c.leaves}</span></div>`)}</div>`}
    <p class="muted">Joins and leaves are counted from the day Sentinel was added. Telegram does not report them in some very large groups or when the group hides join messages.</p>`);
}

function reportSummary() {
  if (!lastReport) return '';
  const { m, g, days } = lastReport;
  return [
    `Sentinel report: last ${days} days`,
    `Flagged messages: ${m.totals.flagged} from ${m.totals.uniqueOffenders} people (of ${m.totals.scanned} messages scanned).`,
    `Handled: ${m.totals.banned} banned, ${m.totals.cautioned} cautioned, ${m.totals.released} released, ${m.totals.pending} waiting.`,
    m.byRule.length ? `Main causes: ${m.byRule.slice(0, 3).map((r) => `${r.label} (${r.count})`).join(', ')}.` : 'No misconduct flagged.',
    `Members joined: ${g.totals.joins}. Left: ${g.totals.leaves}. Net: ${g.totals.net >= 0 ? '+' : ''}${g.totals.net}.`
  ].join('\n');
}

/* =====================================================================
   Network
===================================================================== */
async function loadNetwork(q = '') {
  const rows = await api(`/network${qs({ q })}`);
  setPage(html`
    <div class="topbar"><h1>Shared network</h1></div>
    <div class="panel"><div class="pad muted">People flagged by communities using Sentinel. You can see how many communities flagged someone and why, never which communities.
      Nothing here bans anyone automatically. It is a warning for your own decision.</div></div>
    <input type="search" id="net-q" data-input="net" placeholder="Search by username or ID…" value="${q}" style="width:100%;margin-bottom:14px">
    <div class="panel" id="net-list">${rows.length ? rows.map((r) => html`<div class="row static">
      <div class="rowmain"><div class="who">${r.username || 'Unknown'} <span class="muted">${r.userId}</span>
        ${r.platforms.map((p) => html`<span class="plat ${p}" style="width:auto;padding:0 6px;height:18px">${CODE[p]}</span>`)}</div>
        <div class="txt">${r.reasons.join(', ')}</div></div>
      <span class="tag bad">${r.communities} communit${r.communities === 1 ? 'y' : 'ies'}</span>
      <div class="meta">${ago(r.lastSeen)}</div></div>`)
      : html`<div class="empty">${q ? 'Nobody matches that search.' : 'Nobody has been flagged yet.'}</div>`}</div>`);
  if (q) { const el = $('#net-q'); el.focus(); el.setSelectionRange(q.length, q.length); }
}

/* =====================================================================
   Settings
===================================================================== */
async function loadSettings(sub) {
  const me = state.me;
  const tabs = (active) => html`<div class="tabs">${['discord', 'telegram', 'account'].map((t) =>
    html`<button class="${active === t ? 'active' : ''}" data-nav="#/settings/${t}">${t === 'account' ? 'Account' : PLAT[t]}</button>`)}</div>`;

  if (sub === 'account') {
    return setPage(html`<div class="topbar"><h1>Settings</h1></div>${tabs('account')}
      <div class="panel"><h2>Signed in</h2>
        <div class="row static"><div class="plat discord">DC</div><div class="rowmain"><div class="who">${me.discord ? me.discord.user.username : 'Not connected'}</div></div>
          ${!me.discord && state.cfg.discord && html`<a class="btn primary" href="/auth/discord">Connect Discord</a>`}</div>
        <div class="row static"><div class="plat telegram">TG</div><div class="rowmain"><div class="who">${me.telegram ? (me.telegram.user.username ? `@${me.telegram.user.username}` : me.telegram.user.firstName) : 'Not connected'}</div></div>
          ${!me.telegram && state.cfg.telegram && html`<button class="btn primary" data-act="tg-connect">Connect Telegram</button>`}</div>
        <div class="pad"><button class="btn" data-act="logout">Log out</button></div>
      </div>
      <p class="muted">Sentinel shows only the servers and groups where you are a real admin, checked live every time. If your admin rights are removed on Discord or Telegram, your access here ends within a minute.</p>`);
  }

  const platform = sub === 'telegram' ? 'telegram' : 'discord';
  const list = communitiesOf(platform);
  if (!list.length) return setPage(html`<div class="topbar"><h1>Settings</h1></div>${tabs(platform)}${onboarding(platform)}`);

  const s = state.settings;
  const keep = s.platform === platform && list.some((c) => c.id === s.id);
  const id = keep ? s.id : list[0].id;
  const [data, extra] = await Promise.all([
    api(`/settings/${platform}/${enc(id)}`),
    (platform === 'telegram' ? api(`/telegram/${enc(id)}/admins`) : api(`/discord/${enc(id)}/roles`)).catch(() => [])
  ]);
  state.settings = { platform, id, data, extra };
  drawSettings();
}

const PENALTIES = [['escalate', 'Follow the escalation steps'], ['delete', 'Delete the message only'], ['mute', 'Delete and mute'], ['flag_for_ban', 'Flag for ban review']];

function drawSettings() {
  const { platform, id, data, extra } = state.settings;
  const list = communitiesOf(platform);
  const tabs = html`<div class="tabs">${['discord', 'telegram', 'account'].map((t) =>
    html`<button class="${platform === t ? 'active' : ''}" data-nav="#/settings/${t}">${t === 'account' ? 'Account' : PLAT[t]}</button>`)}</div>`;

  const trusted = platform === 'telegram'
    ? html`<div class="panel"><h2>Who Sentinel trusts as an admin <span>Read live from Telegram, by user ID</span></h2>
        ${extra.length ? extra.map((a) => html`<div class="row static"><div class="rowmain"><div class="who">${a.name || a.username}
          ${a.username && html`<span class="muted">@${a.username}</span>`}${a.isBot && html`<span class="tag">bot</span>`}</div>
          <div class="txt">ID ${a.id}</div></div><span class="tag info">${a.role}</span></div>`)
          : html`<div class="empty">Could not read the admin list. Make sure the bot is an admin in this group.</div>`}
        <div class="pad muted">Only these people can say admin things. Anyone else claiming to be an admin, whatever their name or photo, is treated as a normal member. To add or remove an admin, do it in Telegram. It updates here within a minute.</div></div>`
    : html`<div class="panel"><h2>Who Sentinel trusts as an admin <span>Checked live from Discord</span></h2>
        <div class="pad muted">Anyone with the Administrator permission is always trusted. You can also trust everyone who holds these roles:</div>
        ${extra.length ? extra.map((r) => html`<div class="row static"><div class="rowmain"><div class="who">${r.name} ${r.isAdmin && html`<span class="tag info">has Administrator</span>`}</div></div>
          <div class="switch ${data.adminRoleIds.includes(r.id) ? 'on' : ''}" data-act="admin-role" data-role="${r.id}" role="switch"><i></i></div></div>`)
          : html`<div class="empty">No roles found.</div>`}
        <div class="pad muted">A role's colour or name proves nothing, so Sentinel never uses them. Only real permissions and the roles you tick here count.</div></div>`;

  const rules = Object.entries(data.rules).map(([key, r]) => html`<div class="rulecard">
    <div class="rulehead"><b>${r.label}</b><div style="display:flex;gap:10px;align-items:center">
      ${key.startsWith('custom_') && html`<button class="btn" data-act="rule-del" data-rule="${key}">Delete rule</button>`}
      <div class="switch ${r.enabled ? 'on' : ''}" data-act="rule-toggle" data-rule="${key}" role="switch"><i></i></div></div></div>
    <div class="chips">${r.keywords.length ? r.keywords.map((k) => html`<span class="chip">${k}<button data-act="kw-del" data-rule="${key}" data-phrase="${k}" aria-label="Remove">✕</button></span>`)
      : html`<span class="muted">No phrases yet.</span>`}</div>
    <div class="addrow"><input type="text" id="kw-${key}" data-enter="kw-add" data-rule="${key}" placeholder="Add a phrase, for example: check ur dm" maxlength="100">
      <button class="btn" data-act="kw-add" data-rule="${key}">Add</button></div>
    <div class="penalty" data-rule="${key}">When caught:
      <select data-change="penalty">${PENALTIES.map(([v, l]) => html`<option value="${v}" ${r.penalty.mode === v ? 'selected' : ''}>${l}</option>`)}</select>
      ${r.penalty.mode === 'mute' && html`<span>for</span><input type="number" min="1" max="40320" value="${r.penalty.minutes}" data-change="penalty" style="width:90px"><span>minutes</span>`}
    </div></div>`);

  const e = data.escalation;
  const tier = (t, label) => html`<div class="tier" data-tier="${t}">
    <input type="number" min="0" value="${e[t]?.count ?? 0}" data-change="tier" data-field="count" aria-label="${label} strikes">
    <select data-change="tier" data-field="action">
      <option value="delete" ${e[t]?.action === 'delete' ? 'selected' : ''}>Delete the message</option>
      <option value="mute" ${e[t]?.action === 'mute' ? 'selected' : ''}>Delete and mute</option>
      <option value="flag_for_ban" ${e[t]?.action === 'flag_for_ban' ? 'selected' : ''}>Flag for ban review</option>
    </select>
    <input type="number" min="1" max="40320" value="${e[t]?.minutes ?? 10}" data-change="tier" data-field="minutes" aria-label="Mute minutes" ${e[t]?.action === 'mute' ? '' : 'disabled'}>
  </div>`;

  setPage(html`
    <div class="topbar"><h1>Settings</h1><div class="tools">
      <select data-change="settings-community" aria-label="Community">${list.map((c) => html`<option value="${c.id}" ${c.id === id ? 'selected' : ''}>${c.name}</option>`)}</select></div></div>
    ${tabs}
    ${trusted}
    <div class="panel"><h2>Rules <span>Turn on or off, add or remove phrases, choose the penalty</span></h2>
      ${rules}
      <div class="rulecard"><div class="addrow"><input type="text" id="new-rule" data-enter="rule-add" placeholder="New rule name, for example: Spam links" maxlength="40">
        <button class="btn primary" data-act="rule-add">Add rule</button></div></div></div>
    <div class="panel"><h2>Escalation <span>Used by rules set to "Follow the escalation steps"</span></h2>
      <div class="tier head"><div>Strikes</div><div>Action</div><div>Mute minutes</div></div>
      ${tier('tier1', 'First step')}${tier('tier2', 'Second step')}${tier('tier3', 'Third step')}
      <div class="pad"><span class="muted">A strike is one flagged message from the same person in this community. Count strikes from the last</span>
        <input type="number" min="1" max="90" value="${data.strikeWindowDays}" data-change="window" style="width:80px;margin:0 6px"><span class="muted">days. Set a step to 0 strikes to turn it off.</span></div></div>
    <div class="panel"><h2>Caution message <span>Posted in the chat when you press Caution</span></h2>
      <div class="pad"><textarea id="caution-text" maxlength="400">${data.cautionMessage}</textarea>
        <div style="margin-top:8px"><button class="btn primary" data-act="caution-save">Save message</button></div></div></div>`);
}

async function saveSetting(method, path, body, focusId) {
  const { platform, id } = state.settings;
  try {
    state.settings.data = await api(`/settings/${platform}/${enc(id)}${path}`, { method, body });
    drawSettings();
    if (focusId) $(`#${focusId}`)?.focus();
    toast('Saved');
  } catch (e) { fail(e); drawSettings(); }
}

/* =====================================================================
   Events (one place, so nothing is attached inline)
===================================================================== */
const ACTS = {
  'tg-login': telegramLogin,
  'tg-connect': async () => { await telegramLogin(); },
  logout: async () => { await fetch('/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); state.me = null; closeProfile(); render(); },
  profile: (el) => openProfile(el.dataset.platform, el.dataset.community, el.dataset.user),
  do: doAction,
  close: closeProfile,
  'close-overlay': (el, e) => { if (e.target === el) closeProfile(); },
  filter: (el) => { state.filter = el.dataset.filter; render(); },
  'copy-report': async () => { try { await navigator.clipboard.writeText(reportSummary()); toast('Summary copied'); } catch { toast('Could not copy. Select and copy manually.', true); } },
  'kw-add': (el) => {
    const input = $(`#kw-${el.dataset.rule}`);
    if (input.value.trim()) saveSetting('POST', '/keywords', { ruleKey: el.dataset.rule, phrase: input.value }, `kw-${el.dataset.rule}`);
  },
  'kw-del': (el) => saveSetting('DELETE', '/keywords', { ruleKey: el.dataset.rule, phrase: el.dataset.phrase }),
  'rule-toggle': (el) => saveSetting('POST', '/rule-toggle', { ruleKey: el.dataset.rule, enabled: !el.classList.contains('on') }),
  'rule-add': () => { const v = $('#new-rule').value.trim(); if (v) saveSetting('POST', '/rules', { label: v }); },
  'rule-del': (el) => { if (confirm('Delete this rule and its phrases?')) saveSetting('DELETE', `/rules/${enc(el.dataset.rule)}`); },
  'admin-role': (el) => {
    const ids = new Set(state.settings.data.adminRoleIds);
    ids.has(el.dataset.role) ? ids.delete(el.dataset.role) : ids.add(el.dataset.role);
    saveSetting('POST', '/admin-roles', { roleIds: [...ids] });
  },
  'caution-save': () => saveSetting('POST', '/caution-message', { text: $('#caution-text').value })
};

const CHANGES = {
  scope: (el) => { state.scope = el.value; render(); },
  days: (el) => { state.reportDays = Number(el.value); render(); },
  'settings-community': (el) => { state.settings.id = el.value; loadSettings(state.settings.platform); },
  penalty: (el) => {
    const box = el.closest('.penalty');
    const mode = $('select', box).value;
    const minutes = $('input[type=number]', box)?.value || 10;
    saveSetting('POST', '/rule-penalty', { ruleKey: box.dataset.rule, mode, minutes });
  },
  tier: (el) => {
    const row = el.closest('.tier');
    saveSetting('POST', '/escalation', { [row.dataset.tier]: {
      count: $('[data-field=count]', row).value,
      action: $('[data-field=action]', row).value,
      minutes: $('[data-field=minutes]', row).value
    } });
  },
  window: (el) => saveSetting('POST', '/escalation', { strikeWindowDays: el.value })
};

document.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-nav]');
  if (nav) { closeProfile(); location.hash = nav.dataset.nav; return; }
  const el = e.target.closest('[data-act]');
  if (el && ACTS[el.dataset.act]) ACTS[el.dataset.act](el, e);
});
document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-change]');
  if (el && CHANGES[el.dataset.change]) CHANGES[el.dataset.change](el);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeProfile();
  if (e.key !== 'Enter') return;
  const el = e.target.closest('[data-enter]');
  if (!el) return;
  ACTS[el.dataset.enter]?.(el, e);
});
let netTimer;
document.addEventListener('input', (e) => {
  if (e.target.dataset?.input !== 'net') return;
  clearTimeout(netTimer);
  const q = e.target.value;
  netTimer = setTimeout(() => loadNetwork(q).catch(fail), 300);
});

window.addEventListener('hashchange', () => { if (state.me) render(); });

// Keep the live pages fresh without disturbing anyone who is typing or has a panel open.
setInterval(() => {
  if (!state.me || state.profile) return;
  if (document.activeElement && document.activeElement.matches('input, textarea, select')) return;
  const { page } = route();
  if (['home', 'discord', 'telegram'].includes(page)) loadPage(page, { silent: true });
}, 10000);

boot();
