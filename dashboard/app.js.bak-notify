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
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.flags = body.flags;
    err.unverified = body.unverified;
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

/* Real, recognizable icons, not abstract glyphs. Single colour, inherits
   currentColor, so they follow the active/inactive nav styling for free. */
const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9a1 1 0 0 0 1 1H9v-5.5a1.5 1.5 0 0 1 1.5-1.5h3a1.5 1.5 0 0 1 1.5 1.5V20h2.5a1 1 0 0 0 1-1v-9"/></svg>',
  discord: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 9.5c2.5 1.2 5.5 1.2 8 0"/><path d="M9 15.5c2 .7 4 .7 6 0"/><path d="M16.5 6.5C15 6 13.7 5.7 12 5.7S9 6 7.5 6.5C5.8 9 5 12 5.3 15c1.3 1 2.8 1.7 4.4 2.2l.7-1.4"/><path d="M16.5 6.5C18.2 9 19 12 18.7 15c-1.3 1-2.8 1.7-4.4 2.2l-.7-1.4"/><circle cx="9.2" cy="12" r="1"/><circle cx="14.8" cy="12" r="1"/></svg>',
  telegram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 4 3 11.4l6 2.1M21 4l-3.2 16-8.8-6.5M21 4 9 14.5"/><path d="M9 14.5v5l2.9-3"/></svg>',
  reports: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h11l3 3v13H5z"/><path d="M16 4v3h3"/><path d="M8.5 12v4M12 10v6M15.5 13.5V16"/></svg>',
  network: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="18" r="2"/><path d="M12 7v5M12 12 6.3 16.5M12 12l5.7 4.5"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9c.2.6.8 1 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  pulse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2.5-6 4 12 2.5-6H21"/></svg>',
  faqs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v12H8l-4 3z"/><path d="M8 9h8M8 13h5"/></svg>',
  technical: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="m8.5 12 2.3 2.3 4.7-5"/></svg>',
  campaigns: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M8 14h3M8 18h7"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
  help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><path d="M9.5 9.2a2.7 2.7 0 0 1 5.2.9c0 1.8-2.7 2.3-2.7 4"/><path d="M12 17.4h.01"/></svg>',
  contrast: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 5 6v5.5c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6z"/><path d="m9 12 2 2 4-4"/></svg>',
  listen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/><path d="M8 10.5h2l1.2-2.2 1.6 4 1.2-1.8H16"/></svg>',
  reply: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 3 10.5 13.5"/><path d="M21 3 14.5 21l-4-7.5L3 9.5z"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c.8-3.6 3.7-5.4 7.5-5.4s6.7 1.8 7.5 5.4"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>'
};
// The Sentinel mark: a shield holding a pulse line. Colours come from CSS so it works on dark and light.
const MARK = '<svg class="mark" viewBox="0 0 32 32" aria-hidden="true"><path class="sh" d="M16 3 6 7v8c0 6 4.2 10.4 10 12.5C21.800 25.400 26 21 26 15V7z"/><path class="pl" d="M10 16.5H13L15 12L17.600 20L19.400 16.500H22"/></svg>';
const NAV_GROUP = { discord: 'Communities', pulse: 'Grow', reports: 'Insights', settings: 'Manage' };

const icon = (name) => raw(`<span class="ic" aria-hidden="true">${ICONS[name]}</span>`);

const NAV = [
  ['home', 'Home', 'home'], ['discord', 'Discord', 'discord'], ['telegram', 'Telegram', 'telegram'],
  ['pulse', 'Pulse', 'pulse'], ['campaigns', 'Campaign planner', 'campaigns'], ['faqs', 'FAQs Intelligence', 'faqs'], ['technical', 'Technical Push', 'technical'], ['reports', 'Reports', 'reports'], ['network', 'Network', 'network'], ['settings', 'Settings', 'settings']
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
  window.Theme?.sync?.();
  loadPage(page);
  window.Guide?.afterRender?.(page);
}

// fix-4: landing page
let loginTimer;
function renderLogin() {
  clearInterval(loginTimer);
  $('#drawer-root').innerHTML = '';
  $('#app').innerHTML = html`<div class="login">
    <section class="login-brand">
      <div class="brand">${raw(MARK)}<div><b>Sentinel</b><small>Intelligent Community Pioneer</small></div></div>
      <div class="login-hero">
        <h1>Protect your community. Understand it. Grow it.</h1>
        <p class="lead">One workspace for Web3 community teams.</p>
        <div class="lp-card" role="img" aria-label="Example of the Pulse screen">
          <div class="lp-head"><span class="lp-title">${icon('pulse')}Pulse</span><span class="lp-sample">Example</span></div>
          <svg class="bigpulse lp-line" viewBox="0 0 480 60" preserveAspectRatio="none" aria-hidden="true"><path class="base" d="M0 30H480"/><path class="beat" pathLength="640" d="M0 30H150L175 30L200 6L238 54L262 30H480"/></svg>
          <ul class="lp-rows">
            <li><span class="lp-tag q">Question</span><span>14 members asked how to bridge</span></li>
            <li><span class="lp-tag c">Concern</span><span>Withdrawals feel slow today</span></li>
            <li><span class="lp-tag i">Idea</span><span>A weekly quiz night</span></li>
          </ul>
        </div>
        <div class="lp-tiles">
          <div class="lp-tile"><span class="pi">${icon('shield')}</span><b>Protection</b><span class="d">Scam links and fake admins, flagged.</span></div>
          <div class="lp-tile"><span class="pi">${icon('campaigns')}</span><b>Campaigns</b><span class="d">Ideas that fit your community.</span></div>
          <div class="lp-tile"><span class="pi">${icon('faqs')}</span><b>Support</b><span class="d">Repeated questions and bugs, sorted.</span></div>
        </div>
      </div>
      <p class="foot">Built for Web3 community teams on Discord and Telegram.</p>
    </section>
    <section class="login-card"><div class="box">
      <h2>Sign in</h2>
      <p>Use the account you run your community with. Sentinel shows only the servers and groups where you are a real admin.</p>
      ${state.cfg.discord
        ? html`<a class="btn discord" href="/auth/discord">${icon('discord')}Continue with Discord</a>`
        : html`<button class="btn" disabled>Discord sign in is not set up yet</button>`}
      ${state.cfg.telegram
        ? html`<button class="btn telegram" data-act="tg-login">${icon('telegram')}Continue with Telegram</button>`
        : html`<button class="btn" disabled>Telegram bot is not running</button>`}
      <div id="tg-wait"></div>
      <div class="trust">${icon('shield')}<span>Nothing is banned, posted or sent unless you approve it or switch it on.</span></div>
      <p class="note muted">Signing in never gives Sentinel your password. Discord shows you what is shared. Telegram confirms who you are through the bot.</p>
    </div></section>
  </div>`.s;
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
      <div class="brand">${raw(MARK)}<div><b>Sentinel</b><small>Intelligent Community Pioneer</small></div></div>
      <nav class="nav">
        ${NAV.map(([id, label, ic]) => html`${NAV_GROUP[id] ? html`<div class="navgroup">${NAV_GROUP[id]}</div>` : ''}<a data-nav="#/${id}" class="${page === id ? 'active' : ''}">${icon(ic)}${label}
          ${(id === 'discord' || id === 'telegram' || id === 'faqs') ? html`<span class="badge" data-badge="${id}" hidden></span>` : ''}
          ${(id === 'discord' || id === 'telegram') ? html`<button class="navplus" data-act="add-community" data-platform="${id}" title="Add ${label}" aria-label="Add ${label}">${icon('plus')}</button>` : ''}
        </a>`)}
      </nav>
      <div class="railfoot">
        <div class="railtools">
          <button class="railbtn" data-guide="toggle">${icon('help')}Guide<span class="state" data-guide-state></span></button>
          <button class="railbtn" data-theme-toggle>${icon('contrast')}<span data-theme-label>Dark mode</span></button>
        </div>
        ${who}
        <a href="#/settings/account" data-nav="#/settings/account">${icon('user')}Account</a>
        <a data-act="logout" style="cursor:pointer">${icon('logout')}Log out</a>
      </div>
    </aside>
    <main class="main" id="page"><div class="empty">Loading…</div></main>
  </div>
  <nav class="tabbar" id="tabbar">
    <div class="moresheet">
      ${NAV.slice(4).map(([id, label, ic]) => html`<a data-nav="#/${id}" class="${page === id ? 'active' : ''}">${icon(ic)}${label}</a>`)}
      <div class="sep"></div>
      <a data-guide="toggle">${icon('help')}Guide<span class="tag" data-guide-state style="margin-left:auto"></span></a>
      <a data-theme-toggle>${icon('contrast')}<span data-theme-label>Dark mode</span></a>
      <a data-nav="#/settings/account">${icon('user')}Account</a>
      <a data-act="logout">${icon('logout')}Log out</a>
    </div>
    ${NAV.slice(0, 4).map(([id, label, ic]) => html`<a data-nav="#/${id}" class="${page === id ? 'active' : ''}">${icon(ic)}${label}</a>`)}
    <a data-act="more" class="${NAV.slice(4).some((n) => n[0] === page) ? 'active' : ''}">${icon('menu')}More</a>
  </nav>`;
}

async function loadPage(page, opts = {}) {
  try {
    const { sub } = route();
    if (page === 'home') await loadHome();
    else if (page === 'discord' || page === 'telegram') await loadPlatform(page);
    else if (page === 'pulse') await loadPulse(sub);
    else if (page === 'campaigns') await loadCampaignPlanner();
    else if (page === 'faqs') await loadFaqIntelligence();
    else if (page === 'technical') { techSettingsOpen = false; await loadTechnicalPush(); }
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
  // FAQ drafts waiting for a manager.
  try {
    const f = await api('/pulse/faq-intelligence/summary');
    document.querySelectorAll('[data-badge="faqs"]').forEach((el) => { el.textContent = f.pending; el.hidden = !f.pending; });
  } catch { /* ignore */ }
}

const PAGE_SUB = {
  discord: 'Messages Sentinel removed in your Discord servers, waiting for your decision.',
  telegram: 'Messages Sentinel removed in your Telegram groups, waiting for your decision.',
  pulse: 'What your community is asking, suggesting and worrying about, and what is trending outside.',
  reports: 'Scams caught and member growth over time.',
  network: 'Look up people flagged by other communities.',
  settings: 'Choose how Sentinel protects, warns and trusts.'
};
// Gives each page a one line description under its title, so nobody has to guess what a page is for.
function decoratePage() {
  const top = $('#page')?.querySelector?.(':scope > .topbar');
  if (!top || top.querySelector('.titles')) return;
  const h1 = top.querySelector(':scope > h1');
  if (!h1) return;
  const text = route().page === 'home' ? state.homeSub : PAGE_SUB[route().page];
  const wrap = document.createElement('div');
  wrap.className = 'titles';
  top.insertBefore(wrap, h1);
  wrap.appendChild(h1);
  if (text) { const p = document.createElement('p'); p.className = 'pagesub'; p.textContent = text; wrap.appendChild(p); }
}
const setPage = (h) => {
  const el = $('#page');
  if (!el) return;
  el.innerHTML = h.s;
  decoratePage();
  window.Guide?.afterPage?.();
};

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

const RES_CLASS = { banned: 'bad', released: 'ok', cautioned: 'net', dismissed: 'info' };

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
  const [stats, tg, dc, pulse] = await Promise.all([
    api(`/stats${qs({ community })}`),
    api(`/alerts${qs({ community, platform: 'telegram', resolved: false, limit: 6 })}`),
    api(`/alerts${qs({ community, platform: 'discord', resolved: false, limit: 6 })}`),
    api(`/pulse/overview${qs({ community, days: 7 })}`).catch(() => null)
  ]);
  const column = (platform, alerts) => html`<div class="panel">
    <h2>${PLAT[platform]} <span><a data-nav="#/${platform}" style="cursor:pointer">Open ${PLAT[platform]} dashboard →</a></span></h2>
    ${alerts.length ? alerts.map((a) => alertRow(a, false))
      : html`<div class="empty">${communitiesOf(platform).length ? 'Nothing waiting. All clear.' : `No ${PLAT[platform]} community connected yet.`}</div>`}
  </div>`;
  const n = state.me.communities.length, waiting = stats.awaitingReview;
  state.homeSub = !n ? 'Connect a community to start protecting it.'
    : `Sentinel is watching ${n} ${n === 1 ? 'community' : 'communities'}. ${waiting ? `${waiting} ${waiting === 1 ? 'message is' : 'messages are'} waiting for your review.` : 'Nothing is waiting for your review.'}`;
  setPage(html`
    <div class="topbar"><h1>Today, at a glance</h1><div class="tools">${scopeSelect(null)}</div></div>
    ${!state.me.communities.length && onboarding(null)}
    ${statCards(stats)}
    ${pulse ? html`<div class="panel"><h2>Pulse at a glance <span><a data-nav="#/pulse/ideas" style="cursor:pointer">Open Pulse →</a></span></h2>
      <div class="grid">
        <div class="card accent"><div class="num">${num(pulse.totals?.ideas)}</div><div class="lbl">Ideas this week</div></div>
        <div class="card ${pulse.totals?.openQuestions ? 'warn' : 'ok'}"><div class="num">${num(pulse.totals?.openQuestions)}</div><div class="lbl">Unanswered questions</div></div>
        <div class="card ${pulse.totals?.concerns ? 'bad' : ''}"><div class="num">${num(pulse.totals?.concerns)}</div><div class="lbl">Community concerns</div></div>
        <div class="card"><div class="num">${num(pulse.totals?.contributors)}</div><div class="lbl">Contributors</div></div>
      </div>
      ${pulse.hotTopics?.length ? html`<div class="chips" style="margin-top:12px">${pulse.hotTopics.slice(0, 4).map((t) => html`<span class="chip">${t.topic}</span>`)}</div>` : ''}
    </div>` : ''}
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
    <div class="tabs filters">${tab('open', 'Awaiting review')}${tab('done', 'Handled')}${tab('all', 'Everything')}</div>
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

function closeProfile() { state.profile = null; state.modal = null; $('#drawer-root').innerHTML = ''; }

function drawProfile() {
  const p = state.profile;
  const d = (kind, label, extra = '') => html`<button class="btn ${kind}" data-act="do" data-do="${kind}" data-platform="${p.platform}" data-community="${p.communityId}" data-user="${p.userId}"${raw(extra)}>${label}</button>`;
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

    <h4>Caution message for this person</h4>
    <p class="muted" style="margin-top:0">Prefilled with your community's default. Edit it here for something specific to what this person did, it only changes this one message.</p>
    <textarea id="caution-box" maxlength="400">${p.defaultCautionMessage}</textarea>
    <div class="actions" style="margin-top:8px">${d('caution', 'Send caution', ' data-usemsg="1"')}</div>

    <h4>Decide</h4>
    <div class="actions">${d('ban', 'Ban')}${d('release', 'Release')}${d('dismiss', 'Dismiss, no action')}</div>
    <p class="muted" style="margin-top:12px">Release lifts a mute or ban. Dismiss closes this without contacting ${p.username}, for a false positive.</p>
  </aside></div>`.s;
}

function openAddCommunity(platform) {
  state.profile = null;
  if (platform === 'discord') {
    if (!state.cfg.discord || !state.cfg.discordInviteUrl) {
      $('#drawer-root').innerHTML = modalShell('Add Discord', html`<p class="muted">Discord sign in is not set up on this server yet. See the README for <code>DISCORD_CLIENT_ID</code> and <code>DISCORD_CLIENT_SECRET</code>.</p>`).s;
      return;
    }
    const w = window.open(state.cfg.discordInviteUrl, 'sentinel-invite', 'width=480,height=720');
    $('#drawer-root').innerHTML = modalShell('Add Sentinel to a Discord server', html`
      <p>A Discord window opened for you to pick the server. If you do not see it, ${w ? 'check for a blocked pop up,' : ''} or use this link:</p>
      <a class="btn primary" href="${state.cfg.discordInviteUrl}" target="_blank" rel="noopener">Open Discord's server picker</a>
      <p class="muted" style="margin-top:14px">You need the <b>Manage Server</b> permission on whichever server you choose. Once it is added, come back here and sign in with the same Discord account to see it.</p>
    `).s;
    return;
  }
  if (!state.cfg.telegram) {
    $('#drawer-root').innerHTML = modalShell('Add Telegram', html`<p class="muted">The Telegram bot is not running. Add <code>TELEGRAM_BOT_TOKEN</code> to your .env and restart.</p>`).s;
    return;
  }
  const botLink = `https://t.me/${state.cfg.telegramBot}`;
  $('#drawer-root').innerHTML = modalShell('Add Sentinel to a Telegram group', html`
    <ol style="padding-left:18px; line-height:1.9; margin:0">
      <li>Open your group in Telegram and tap its name to open <b>Group info</b>.</li>
      <li>Tap <b>Add members</b>, search for <b>@${state.cfg.telegramBot}</b>, and add it.</li>
      <li>Tap <b>Administrators → Add Admin</b>, choose the bot, and turn on <b>Delete Messages</b> and <b>Ban Users</b>.</li>
      <li>Send any message in the group. That is how Sentinel learns the group exists.</li>
      <li>Come back here and sign in with Telegram to see it listed.</li>
    </ol>
    <a class="btn primary" style="margin-top:14px;display:inline-block" href="${botLink}" target="_blank" rel="noopener">Open @${state.cfg.telegramBot}</a>
  `).s;
}

function modalShell(title, body) {
  return html`<div class="overlay" data-act="close-overlay"><aside class="drawer modal" role="dialog" aria-label="${title}">
    <button class="x" data-act="close" aria-label="Close">✕</button>
    <h3>${title}</h3>
    ${body}
  </aside></div>`;
}

async function doAction(el) {
  const { do: action, platform, community, user } = el.dataset;
  if (action === 'ban' && !(await askConfirm('Ban this person?', 'They will be banned from the community. You can review and undo this from Discord or Telegram.', 'Ban'))) return;
  const body = { action };
  if (action === 'caution' && el.dataset.usemsg) body.message = $('#caution-box')?.value || '';
  el.disabled = true;
  try {
    const r = await api(`/users/${platform}/${enc(community)}/${enc(user)}/action`, { method: 'POST', body });
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
  const [m, g, pulse] = await Promise.all([
    api(`/reports/misconduct${qs({ days, community })}`),
    api(`/reports/growth${qs({ days, community })}`),
    api(`/pulse/overview${qs({ days, community })}`).catch(() => null)
  ]);
  lastReport = { m, g, pulse, days };
  const maxRule = Math.max(1, ...m.byRule.map((r) => r.count));
  const members = [...g.days].reverse().find((d) => d.members !== null)?.members;
  setPage(html`
    <div class="topbar"><h1>Reports</h1><div class="tools">
      ${scopeSelect(null)}
      <select data-change="days">${[7, 30, 90].map((d) => html`<option value="${d}" ${d === days ? 'selected' : ''}>Last ${d} days</option>`)}</select>
      <a class="btn" href="/api/reports/export.csv${qs({ days, community })}">Download CSV</a>
      <button class="btn primary" data-act="copy-report">Copy summary</button>
    </div></div>

    ${pulse ? html`<h4 style="margin-top:0">Pulse · community health</h4><div class="grid"><div class="card accent"><div class="num">${num(pulse.totals?.ideas)}</div><div class="lbl">Ideas</div></div><div class="card"><div class="num">${num(pulse.totals?.openQuestions)}</div><div class="lbl">Unanswered questions</div></div><div class="card ${pulse.concerns ? 'warn' : 'ok'}"><div class="num">${num(pulse.totals?.concerns)}</div><div class="lbl">Concerns</div></div><div class="card"><div class="num">${num(pulse.totals?.contributors)}</div><div class="lbl">Contributors</div></div></div><div class="panel"><h2>Topics being discussed</h2>${pulse.hotTopics?.length ? pulse.hotTopics.slice(0,8).map(t => html`<div class="hrow"><div class="l">${t.topic}</div><span class="muted">${num(t.count)} messages</span></div>`) : html`<div class="muted">No Pulse topics in this period.</div>`}</div>` : html`<div class="panel"><h2>Pulse report</h2><div class="muted">Pulse summary is temporarily unavailable. Security and growth reports are still shown below.</div></div>`}
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

const PENALTIES = [['escalate', 'Follow the escalation steps'], ['delete', 'Delete the message only'], ['mute', 'Delete and mute'], ['caution', 'Delete and send a caution'], ['flag_for_ban', 'Flag for ban review']];

let settingsSection = 'protection';
const SETTINGS_SECTIONS = [['protection', 'Protection'], ['messages', 'Messages'], ['admins', 'Trusted admins'], ['pulse', 'Pulse']];

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
    ${key === 'suspiciousLinks' && html`<div class="toggle" style="margin-bottom:10px">
      <div class="switch ${r.strictMode ? 'on' : ''}" data-act="link-strict" role="switch"><i></i></div>
      <span>${r.strictMode ? 'Strict: no link at all from non admins' : 'Smart: only risky looking links, foreign invites, shorteners, pushed links'}</span>
    </div>`}
    <div class="chips">${r.keywords.length ? r.keywords.map((k) => html`<span class="chip">${k}<button data-act="kw-del" data-rule="${key}" data-phrase="${k}" aria-label="Remove">✕</button></span>`)
      : html`<span class="muted">No phrases yet.</span>`}</div>
    ${key === 'suspiciousLinks' && html`<div class="muted" style="margin:-4px 0 10px">${r.strictMode ? 'These phrases are ignored while strict mode is on, since every link is already blocked.' : 'These phrases below are the extra ones checked on top of the built in risky link detection.'}</div>`}
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

  const sections = {
    protection: html`<div class="panel"><h2>Rules <span>Turn on or off, add or remove phrases, choose the penalty</span></h2>
      ${rules}
      <div class="rulecard"><div class="addrow"><input type="text" id="new-rule" data-enter="rule-add" placeholder="New rule name, for example: Spam links" maxlength="40">
        <button class="btn primary" data-act="rule-add">Add rule</button></div></div></div>
    <div class="panel"><h2>Escalation <span>Used by rules set to "Follow the escalation steps"</span></h2>
      <div class="tier head"><div>Strikes</div><div>Action</div><div>Mute minutes</div></div>
      ${tier('tier1', 'First step')}${tier('tier2', 'Second step')}${tier('tier3', 'Third step')}
      <div class="pad"><span class="muted">A strike is one flagged message from the same person in this community. Count strikes from the last</span>
        <input type="number" min="1" max="90" value="${data.strikeWindowDays}" data-change="window" style="width:80px;margin:0 6px"><span class="muted">days. Set a step to 0 strikes to turn it off.</span></div></div>`,
    messages: html`<div class="split">
      <div class="panel"><h2>Caution message <span>Posted when you press Caution</span></h2>
        <div class="pad"><textarea id="caution-text" maxlength="400">${data.cautionMessage}</textarea>
          <div style="margin-top:8px"><button class="btn primary" data-act="caution-save">Save message</button></div></div></div>
      <div class="panel"><h2>Link blocked message <span>Posted whenever a link is removed</span></h2>
        <div class="pad"><textarea id="link-blocked-text" maxlength="400">${data.linkBlockedMessage}</textarea>
          <div style="margin-top:8px"><button class="btn primary" data-act="link-msg-save">Save message</button></div></div></div>
    </div>`,
    admins: trusted,
    pulse: html`<div class="panel"><h2>Pulse <span>Community ideas, replies and market trends</span></h2>
      <div class="pad"><div class="muted" style="margin-bottom:12px">Everything about reading your community's ideas and drafting replies is set up on the Pulse page, under Setup: your project brief, knowledge (docs and live data), how drafts are prepared, topic focus, and which communities are read.</div>
        <button class="btn primary" data-nav="#/pulse/setup">Open Pulse setup</button></div></div>`
  };
  const section = sections[settingsSection] ? settingsSection : 'protection';

  setPage(html`
    <div class="topbar"><h1>Settings</h1><div class="tools">
      <select data-change="settings-community" aria-label="Community">${list.map((c) => html`<option value="${c.id}" ${c.id === id ? 'selected' : ''}>${c.name}</option>`)}</select></div></div>
    ${tabs}
    <div class="subnav">${SETTINGS_SECTIONS.map(([sid, l]) => html`<button class="${section === sid ? 'active' : ''}" data-act="settings-section" data-section="${sid}">${l}</button>`)}</div>
    ${sections[section]}`);
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


/* FAQs Intelligence and Technical Push */
let faqRows = [], techRows = [];
let faqFilter = { platform: 'all', status: 'pending' }, faqDays = 30;
let techSettingsOpen = false, techKey = '', techDays = 7;
// Remember whether the delivery settings are open, so a refresh does not snap them shut while you type.
document.addEventListener('toggle', (e) => { if (e.target.matches?.('details.fold')) techSettingsOpen = e.target.open; }, true);
function communityOptions(selected = '') {
  return state.me.communities.map(c => html`<option value="${c.key}" ${c.key === selected ? 'selected' : ''}>${c.name} · ${PLAT[c.platform]}</option>`);
}
// FAQs Intelligence is one place for every chat the manager runs. Each card says which platform,
// community and channel it came from, and the tabs filter by platform and by status.
const PLATFORM_NAME = { telegram: 'Telegram', discord: 'Discord' };
const PLATFORM_ORDER = ['telegram', 'discord'];
const faqPlatform = (r) => String(r.communityKey || '').split(':')[0];

function faqCard(r) {
  const plat = faqPlatform(r);
  const where = [...new Set((r.evidence || []).map((e) => e.channelName).filter(Boolean))].slice(0, 3).join(', ');
  return html`<div class="panel"><div class="panelhead"><h2>FAQ draft · ${r.topic} <span>${r.occurrenceCount} report(s) · ${r.status}</span></h2><span>${r.gap ? html`<span class="tag">Not in your facts</span> ` : ''}${r.category === 'technical' || r.category === 'complaint' ? html`<span class="tag">${r.category}</span>` : ''}</span></div><div class="pad"><p class="muted"><span class="tag info">${PLATFORM_NAME[plat] || plat}</span> ${r.communityName || ''}${where ? ` · ${where}` : ''}</p><p><b>Question:</b> ${r.question}</p><label class="fld"><span>Proposed answer</span><textarea data-faq-answer="${r.id}" rows="5" placeholder="Write the verified answer here">${r.answer}</textarea></label><p class="muted">${r.verificationNote||''}</p><details><summary>Evidence (${r.evidence?.length||0})</summary>${(r.evidence||[]).map(e=>html`<p class="muted">${PLATFORM_NAME[e.platform] || e.platform} · ${e.channelName}: ${e.text} ${e.url?html`<a href="${e.url}" target="_blank" rel="noopener">Open message</a>`:''}</p>`)}</details><details><summary>Sources (${r.sources?.length||0})</summary>${(r.sources||[]).map(x=>html`<p><a href="${x.url}" target="_blank" rel="noopener">${x.title}</a></p>`)}</details><div class="tools">${r.status === 'approved' ? html`<button class="btn primary" data-act="faq-approve" data-id="${r.id}">Update in Facts</button><button class="btn" data-act="faq-dismiss" data-id="${r.id}">Remove from Facts</button>` : r.status === 'dismissed' ? html`<button class="btn" data-act="faq-approve" data-id="${r.id}">Approve into Facts</button>` : html`<button class="btn primary" data-act="faq-approve" data-id="${r.id}">Approve into Facts</button><button class="btn" data-act="faq-save" data-id="${r.id}">Save edits</button><button class="btn" data-act="faq-dismiss" data-id="${r.id}">Dismiss</button>`}</div></div></div>`;
}

async function loadFaqIntelligence() {
  const cs = state.me.communities || [];
  if (!cs.length) return setPage(html`<div class="topbar"><h1>FAQs Intelligence</h1></div>${onboarding(null)}`);
  faqRows = await api('/pulse/faq-intelligence');
  drawFaqs();
}

function drawFaqs() {
  const onPlatform = (r, p) => p === 'all' || faqPlatform(r) === p;
  const shown = faqRows.filter((r) => r.status === faqFilter.status && onPlatform(r, faqFilter.platform));
  const platforms = PLATFORM_ORDER.filter((p) => (state.me.communities || []).some((c) => c.platform === p));
  const platformTab = (p) => html`<button class="${faqFilter.platform === p ? 'active' : ''}" data-act="faq-filter" data-kind="platform" data-value="${p}">${p === 'all' ? 'All chats' : PLATFORM_NAME[p]} (${faqRows.filter((r) => r.status === faqFilter.status && onPlatform(r, p)).length})</button>`;
  const statusTab = (s, label) => html`<button class="${faqFilter.status === s ? 'active' : ''}" data-act="faq-filter" data-kind="status" data-value="${s}">${label} (${faqRows.filter((r) => r.status === s && onPlatform(r, faqFilter.platform)).length})</button>`;
  const present = PLATFORM_ORDER.filter((p) => shown.some((r) => faqPlatform(r) === p));
  const body = !faqRows.length
    ? html`<div class="panel"><div class="pad empty">No drafts yet. Sentinel checks your conversations on its own, or press Scan all communities to check now.</div></div>`
    : !shown.length
      ? html`<div class="panel"><div class="pad empty">Nothing here. Try another tab.</div></div>`
      : faqFilter.platform === 'all' && present.length > 1
        ? present.map((p) => html`<h3 style="margin:20px 0 10px">${PLATFORM_NAME[p]} <span class="tag">${shown.filter((r) => faqPlatform(r) === p).length}</span></h3>${shown.filter((r) => faqPlatform(r) === p).map(faqCard)}`)
        : shown.map(faqCard);
  setPage(html`<div class="topbar"><div><h1>FAQs Intelligence</h1><div class="muted">Repeated questions, complaints and errors from all your chats, in one place.</div></div><div class="tools"><select id="faq-days"><option value="7" ${faqDays===7?'selected':''}>7 days</option><option value="30" ${faqDays===30?'selected':''}>30 days</option><option value="90" ${faqDays===90?'selected':''}>90 days</option></select><button class="btn primary" data-act="faq-scan">Scan all communities</button></div></div>
  <div class="panel"><div class="pad"><b>Conversation-led knowledge discovery</b><p class="muted">Sentinel watches your conversations and drafts an FAQ only for the questions, complaints and errors your facts do not already cover. An answer comes from a moderator reply or from you, never from a guess, and nothing reaches your facts until you approve it.</p></div></div>
  <div class="tabs">${platformTab('all')}${platforms.map(platformTab)}</div>
  <div class="tabs filters">${statusTab('pending', 'Waiting for review')}${statusTab('approved', 'In your facts')}${statusTab('dismissed', 'Dismissed')}</div>
  ${body}`);
}
// fix-3: compact technical report card
function techCard(r) {
  const full = String(r.content || '');
  const parts = full.split(/\n\s*\n/);
  const headLines = (parts[0] || '').split('\n');
  const title = headLines.shift() || '';
  const facts = headLines.map((l) => { const i = l.indexOf(':'); return i > 0 && i < 40 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : null; });
  const structured = /^[A-Z ]{8,}$/.test(title.trim()) && facts.length >= 2 && facts.every(Boolean);
  const rest = structured ? parts.slice(1).join('\n\n') : full;
  const text = html`<div class="tp-text">${rest}</div>`;
  const meta = [`${r.issueCount} issue report${r.issueCount === 1 ? '' : 's'}`, r.reporterCount ? `${r.reporterCount} member${r.reporterCount === 1 ? '' : 's'}` : '', `${r.periodDays} days`].filter(Boolean).join(' · ');
  return html`<div class="panel tp-card"><div class="tp-head"><div><div class="tp-title">Technical report · ${dateShort(r.createdAt)}</div><div class="tp-meta">${meta}</div></div><span class="tag ${r.pushedAt ? 'ok' : 'info'}">${r.pushedAt ? 'Sent' : 'Ready'}</span></div>${structured ? html`<dl class="tp-facts">${facts.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>` : ''}${rest.length > 650 ? html`<details class="tp-more"><summary>View full report</summary>${text}</details>` : (rest.trim() ? text : '')}<div class="tp-actions"><button class="btn primary" data-act="tech-download" data-id="${r.id}">Download</button><button class="btn" data-act="tech-push" data-id="${r.id}">Send to channel</button><span class="tp-spacer"></span><button class="btn ban" data-act="tech-delete" data-id="${r.id}">Delete</button></div></div>`;
}
async function loadTechnicalPush() {
  const cs = state.me.communities || [];
  if (!cs.length) return setPage(html`<div class="topbar"><h1>Technical Push</h1></div>${onboarding(null)}`);
  const key = cs.some(c=>c.key===techKey) ? techKey : (state.scope !== 'all' && cs.some(c=>c.key===state.scope) ? state.scope : cs[0].key);
  const c = cs.find(x=>x.key===key) || cs[0];
  const data = await api(`/pulse/technical-push${qs({community:key})}`);
  techRows = data.reports.filter(r=>r.communityKey===key);
  const cfg = data.settings[key] || {};
  const cadenceName = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' }[cfg.cadence || 'weekly'];
  const settingsLine = cfg.delivery === 'auto' ? `${cadenceName} · sends to ${cfg.destinationPlatform || 'a channel'}` : `${cadenceName} · manual download`;
  setPage(html`<div class="topbar"><div><h1>Technical Push</h1><div class="muted">Aggregate reported technical issues into evidence-led developer reports.</div></div><div class="tools"><select id="tech-community" data-change="tech-community">${communityOptions(key)}</select><select id="tech-days" data-change="tech-days"><option value="1" ${techDays===1?'selected':''}>24 hours</option><option value="7" ${techDays===7?'selected':''}>7 days</option><option value="30" ${techDays===30?'selected':''}>30 days</option><option value="90" ${techDays===90?'selected':''}>90 days</option></select><button class="btn primary" data-act="tech-generate">Generate report</button></div></div>
  <details class="panel fold" ${techSettingsOpen ? 'open' : ''}><summary><span><b>Delivery settings</b> <span class="muted">${c.name}</span></span><span class="tools"><span class="tag">${settingsLine}</span><span class="chev">▾</span></span></summary><div class="pad"><div class="formgrid">
  <label class="fld"><span>Cadence preference</span><select id="tech-cadence"><option value="daily" ${cfg.cadence==='daily'?'selected':''}>Daily</option><option value="weekly" ${(!cfg.cadence||cfg.cadence==='weekly')?'selected':''}>Weekly</option><option value="monthly" ${cfg.cadence==='monthly'?'selected':''}>Monthly</option></select></label>
  <label class="fld"><span>Delivery</span><select id="tech-delivery"><option value="download" ${cfg.delivery!=='auto'?'selected':''}>Manual download</option><option value="auto" ${cfg.delivery==='auto'?'selected':''}>Send to channel</option></select></label>
  <label class="fld"><span>Destination platform</span><select id="tech-platform"><option value="">Choose</option><option value="discord" ${cfg.destinationPlatform==='discord'?'selected':''}>Discord</option><option value="telegram" ${cfg.destinationPlatform==='telegram'?'selected':''}>Telegram</option></select></label>
  <label class="fld"><span>Destination community ID</span><input id="tech-destination" value="${cfg.destinationCommunityId||''}" placeholder="Server or chat ID"></label>
  <label class="fld"><span>Destination channel ID</span><input id="tech-channel" value="${cfg.destinationChannelId||''}" placeholder="Discord channel ID; optional for Telegram"></label>
  </div><button class="btn primary" data-act="tech-settings" style="margin-top:12px">Save settings</button><p class="muted">Choose Send to channel and Sentinel will generate and send this report on its own at the chosen cadence. A period with no technical reports sends nothing. You can always generate and download a report yourself.</p></div></details>
  ${techRows.length?techRows.map(techCard) : html`<div class="panel"><div class="pad empty">No technical reports yet. Generate a report to aggregate recent issues.</div></div>`}`);
}
async function saveFaq(id, status) {
  const answer = $(`[data-faq-answer="${id}"]`)?.value || '';
  let confirmed = false;
  for (;;) {
    try { await api(`/pulse/faq-intelligence/${enc(id)}`, {method:'PATCH',body:{answer,status,confirmed}}); break; }
    // A figure that is not in the chat evidence or your facts needs a person to vouch for it.
    catch (e) { if (e.status === 409 && e.unverified && !confirmed && confirm(e.message)) { confirmed = true; continue; } throw e; }
  }
  toast(status==='approved'?'FAQ approved into Facts':status==='dismissed'?'FAQ dismissed and removed from Facts':'FAQ saved');
  await loadFaqIntelligence(); updateBadges();
}
function downloadText(name, text) {
  const blob = new Blob([text],{type:'text/plain;charset=utf-8'}), url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}

/* =====================================================================
   Events (one place, so nothing is attached inline)
===================================================================== */
const ACTS = {
  'faq-scan': async () => {
    faqDays = Number($('#faq-days')?.value || 30);
    const r=await api('/pulse/faq-intelligence/scan',{method:'POST',body:{days:faqDays}});
    toast(`Scanned ${r.communities} communit${r.communities===1?'y':'ies'}: ${r.created} new FAQ draft(s), ${r.covered||0} already covered by your facts`); await loadFaqIntelligence(); updateBadges();
  },
  'faq-filter': el => { faqFilter[el.dataset.kind] = el.dataset.value; drawFaqs(); },
  'faq-save': el => saveFaq(el.dataset.id,'pending'),
  'faq-approve': el => saveFaq(el.dataset.id,'approved'),
  'faq-dismiss': el => saveFaq(el.dataset.id,'dismissed'),
  'tech-generate': async () => {
    const key=$('#tech-community')?.value||'', c=state.me.communities.find(x=>x.key===key); if(!c)return toast('Choose a community',true);
    techKey = key; techDays = Number($('#tech-days')?.value || 7);
    const r=await api(`/pulse/technical-push/${c.platform}/${enc(c.id)}/generate`,{method:'POST',body:{days:techDays}});
    toast(`Report generated: ${r.issueCount} issue report(s)`); await loadTechnicalPush();
  },
  'tech-settings': async () => {
    const key=$('#tech-community')?.value||'', c=state.me.communities.find(x=>x.key===key); if(!c)return toast('Choose a community',true);
    techKey = key;
    await api(`/pulse/technical-push/${c.platform}/${enc(c.id)}/settings`,{method:'POST',body:{cadence:$('#tech-cadence').value,delivery:$('#tech-delivery').value,destinationPlatform:$('#tech-platform').value,destinationCommunityId:$('#tech-destination').value.trim(),destinationChannelId:$('#tech-channel').value.trim(),enabled:$('#tech-delivery').value==='auto'}});
    toast('Settings saved'); techSettingsOpen = true; await loadTechnicalPush();
  },
  'tech-delete': async el => {
    const r = techRows.find(x => x.id === el.dataset.id); if (!r) return;
    if (!confirm(`Delete the report from ${dateShort(r.createdAt)}? This permanently removes it, including its evidence links, and cannot be undone.`)) return;
    await api(`/pulse/technical-push/${enc(r.id)}`, { method: 'DELETE' });
    toast('Report deleted'); await loadTechnicalPush();
  },
  'tech-download': el => { const r=techRows.find(x=>x.id===el.dataset.id); if(r)downloadText(`sentinel-technical-report-${r.createdAt.slice(0,10)}.txt`,r.content); },
  'tech-push': async el => { const r = await api(`/pulse/technical-push/${enc(el.dataset.id)}/push`,{method:'POST',body:{}}); toast(r.parts > 1 ? `Report sent in ${r.parts} messages` : 'Report sent'); await loadTechnicalPush(); },
  'add-community': (el, e) => { e.stopPropagation(); openAddCommunity(el.dataset.platform); },
  'tg-login': telegramLogin,
  'tg-connect': async () => { await telegramLogin(); },
  logout: async () => { await fetch('/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); state.me = null; closeProfile(); render(); },
  profile: (el) => openProfile(el.dataset.platform, el.dataset.community, el.dataset.user),
  do: doAction,
  close: closeProfile,
  more: () => $('#tabbar')?.classList.toggle('open'),
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
  'rule-del': async (el) => { if (await askConfirm('Delete this rule?', 'The rule and all its phrases will be removed.', 'Delete')) saveSetting('DELETE', `/rules/${enc(el.dataset.rule)}`); },
  'settings-section': (el) => { settingsSection = el.dataset.section; drawSettings(); },
  'admin-role': (el) => {
    const ids = new Set(state.settings.data.adminRoleIds);
    ids.has(el.dataset.role) ? ids.delete(el.dataset.role) : ids.add(el.dataset.role);
    saveSetting('POST', '/admin-roles', { roleIds: [...ids] });
  },
  'caution-save': () => saveSetting('POST', '/caution-message', { text: $('#caution-text').value }),
  'link-msg-save': () => saveSetting('POST', '/link-blocked-message', { text: $('#link-blocked-text').value }),
  'link-strict': (el) => saveSetting('POST', '/link-strict-mode', { enabled: !el.classList.contains('on') })
};

const CHANGES = {
  scope: (el) => { state.scope = el.value; render(); },
  days: (el) => { state.reportDays = Number(el.value); render(); },
  'settings-community': (el) => { state.settings.id = el.value; loadSettings(state.settings.platform); },
  // Technical Push: choosing another community shows that community's reports and settings.
  'tech-community': (el) => { techKey = el.value; techSettingsOpen = false; loadTechnicalPush().catch(fail); },
  'tech-days': (el) => { techDays = Number(el.value); },
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
  const el = e.target.closest('[data-act]');
  if (el && ACTS[el.dataset.act]) { ACTS[el.dataset.act](el, e); return; }
  const nav = e.target.closest('[data-nav]');
  if (nav) { closeProfile(); $('#tabbar')?.classList.remove('open'); location.hash = nav.dataset.nav; }
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
