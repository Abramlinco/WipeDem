'use strict';

/* notify-patch
   Notifications: the bell, unread badges, the ping, the Home attention card and phone alerts.
   Loaded before app.js. It uses the dashboard's own helpers (html, api, qs, ago, toast, fail, route, state, modalShell),
   which only exist once app.js has run, so nothing here touches them until a page asks. */
(() => {
  const K = { seen: 'sentinel.nf.seen', done: 'sentinel.nf.announced', prefs: 'sentinel.nf.prefs' };
  const get = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
  const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: it just will not be remembered */ } };

  const SECTION = { pulse: 'pulse', discord: 'alerts', telegram: 'alerts', faqs: 'faqs' };
  const KINDS = [['question', 'Questions'], ['concern', 'Concerns'], ['idea', 'Ideas']];
  const BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';

  let data = null, seen = null, announced = new Set(), curNs = null;
  let prefs = { sound: true, browser: false, ...get(K.prefs, {}) };
  let started = false, loaded = false, inflight = null, timer = null, lastPage = '', panelViewed = false;
  let hl = { page: '', ids: new Set() };
  let audio = null;

  const signedIn = () => typeof state !== 'undefined' && !!state.me;
  const ns = () => { const m = state.me || {}; return `:${m.telegram?.user?.id || ''}:${m.discord?.user?.id || ''}`; };
  const idOf = (i) => `${i.type}:${i.id}`;
  const shown = (n) => (n > 99 ? '99+' : String(n));

  /* ---------------- talking to the server ---------------- */
  function load() {
    if (!signedIn()) return Promise.resolve(null);
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const n = ns();
        if (n !== curNs) { curNs = n; seen = get(K.seen + n, null); announced = new Set(get(K.done + n, [])); loaded = false; data = null; }
        const r = await api(`/notifications/summary${seen ? qs(seen) : ''}`);
        // The very first visit starts from "now", so an old backlog does not show up as brand new.
        if (!seen) { seen = { pulse: r.now, alerts: r.now, faqs: r.now }; put(K.seen + curNs, seen); }
        data = r;
        const fresh = r.items.filter((i) => i.unseen && !announced.has(idOf(i)));
        fresh.forEach((i) => announced.add(idOf(i)));
        if (fresh.length) { announced = new Set([...announced].slice(-400)); put(K.done + curNs, [...announced]); }
        if (loaded && fresh.length) ping(fresh);
        loaded = true;
        if (hl.page === 'pulse') data.items.forEach((i) => { if (i.type === 'pulse' && i.unseen) hl.ids.add(i.id); });
        paint();
        decorate();
        return r;
      } finally { inflight = null; }
    })();
    return inflight;
  }

  // Only ever called from something the person did: opening the bell, "Mark all read", or opening an item.
  // Nothing marks things as seen just because a page or tab happens to be open.
  async function markSeen(sections) {
    if (!data || !seen) return;
    for (const s of [].concat(sections)) seen[s] = data.now;
    put(K.seen + curNs, seen);
    try {
      // A refresh already in flight was asked for with the old "seen" times, so wait for it, then ask again.
      if (inflight) await inflight.catch(() => {});
      await load();
    } catch { /* the next refresh will catch up */ }
  }

  /* ---------------- the ping ---------------- */
  function beep() {
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime;
      o.type = 'sine'; o.frequency.setValueAtTime(880, t); o.frequency.setValueAtTime(1175, t + 0.12);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t + 0.45);
    } catch { /* sound is a nice extra, never required */ }
  }
  // Browsers only allow sound after the person has touched the page once.
  for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => { try { audio ||= new (window.AudioContext || window.webkitAudioContext)(); audio.resume?.(); } catch { /* ignore */ } }, { once: true, passive: true });

  async function native(title, body, hash) {
    try {
      const url = `/${hash || ''}`;
      const reg = await navigator.serviceWorker?.getRegistration?.();
      if (reg?.showNotification) { await reg.showNotification(title, { body, tag: 'sentinel', renotify: true, icon: '/favicon.svg', data: { url } }); return; }
      const n = new Notification(title, { body, tag: 'sentinel', icon: '/favicon.svg' });
      n.onclick = () => { window.focus(); location.hash = hash || '#/home'; n.close(); };
    } catch { /* pop-ups are optional */ }
  }

  function ping(items) {
    const one = items[0], many = items.length > 1;
    toast(many ? `${items.length} new items need a look` : `${one.title}${one.community ? ` in ${one.community}` : ''}`);
    if (prefs.sound) beep();
    try { navigator.vibrate?.(many ? [90, 60, 90] : 90); } catch { /* not every device vibrates */ }
    document.querySelectorAll('.nf-bell').forEach((b) => { b.classList.add('ring'); setTimeout(() => b.classList.remove('ring'), 1000); });
    if (prefs.browser && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      native(many ? `${items.length} new items in Sentinel` : one.title, many ? 'Open Sentinel to review them.' : one.text, one.href);
    }
  }

  /* ---------------- badges, bell, tab title ---------------- */
  function setBadge(id, n) {
    document.querySelectorAll(`[data-badge="${id}"]`).forEach((el) => { el.textContent = shown(n); el.hidden = !n; });
  }

  const bellHtml = () => `<button type="button" class="nf-bell" data-nf="bell" aria-label="Notifications" aria-expanded="false" title="Notifications">${BELL}<span class="nf-count" hidden></span></button>`;

  function inject() {
    const top = document.querySelector('#page > .topbar');
    document.querySelector('.nf-float')?.remove();
    if (top) {
      let tools = top.querySelector(':scope > .tools');
      if (!tools) { tools = document.createElement('div'); tools.className = 'tools'; top.appendChild(tools); }
      if (!tools.querySelector('.nf-bell')) tools.insertAdjacentHTML('beforeend', bellHtml());
    } else if (document.getElementById('page') && !document.querySelector('.nf-bell')) {
      document.body.insertAdjacentHTML('beforeend', bellHtml().replace('class="nf-bell"', 'class="nf-bell nf-float"'));
    }
  }

  function paint() {
    const u = data?.unseen || { total: 0, pulse: 0 };
    setBadge('home', u.total);
    setBadge('pulse', u.pulse);
    document.querySelectorAll('.nf-bell').forEach((b) => {
      b.classList.toggle('has-new', u.total > 0);
      const c = b.querySelector('.nf-count');
      if (c) { c.textContent = shown(u.total); c.hidden = !u.total; }
      b.setAttribute('aria-label', u.total ? `Notifications, ${u.total} new` : 'Notifications');
    });
    if (signedIn()) document.title = u.total ? `(${shown(u.total)}) Sentinel` : 'Sentinel';
    const p = document.getElementById('nf-panel');
    if (p) p.innerHTML = panelHtml().s;
  }

  // On the Pulse page, marks the rows that arrived since the last visit.
  function decorate() {
    if (typeof route !== 'function' || route().page !== 'pulse') return;
    document.querySelectorAll('#page .row.static').forEach((row) => {
      const id = row.querySelector('[data-pulse][data-id]')?.dataset.id;
      if (!id || !hl.ids.has(id) || row.querySelector('.nf-new')) return;
      row.classList.add('nf-fresh');
      row.querySelector('.who')?.insertAdjacentHTML('beforeend', '<span class="tag info nf-new">New</span>');
    });
  }

  /* ---------------- the bell panel and the Home card ---------------- */
  const LABEL = { question: 'Question', concern: 'Concern', idea: 'Idea', alert: 'Protection', faq: 'FAQ draft' };

  const row = (i) => html`<button type="button" class="nf-row${i.unseen ? ' unseen' : ''}" data-nf="go" data-href="${i.href}">
    <span class="nf-dot" aria-hidden="true"></span>
    <span class="nf-body">
      <span class="nf-title">${i.title} <span class="tag ${i.kind === 'concern' || i.kind === 'alert' ? 'net' : ''}">${LABEL[i.kind] || ''}</span></span>
      <span class="nf-text">${i.text}</span>
      <span class="nf-meta">${[PLAT[i.platform], i.community, i.channel && i.channel !== i.community ? `#${i.channel}` : ''].filter(Boolean).join(' · ')}${i.community || i.platform ? ' · ' : ''}${ago(i.at)}</span>
    </span></button>`;

  function panelHtml() {
    const items = data?.items || [];
    return html`<div class="nf-head"><b>Notifications</b>
        <div class="nf-head-actions"><button type="button" class="btn" data-nf="read-all">Mark all read</button><button type="button" class="btn" data-nf="settings">Settings</button></div></div>
      <div class="nf-list">${items.length ? items.map(row) : html`<div class="empty"><b>Nothing waiting</b><br>New questions, concerns and removed messages appear here the moment they arrive.</div>`}</div>`;
  }

  function homeCard(nf) {
    const d = nf || data;
    if (!d) return '';
    const o = d.open;
    const alertHref = d.items.find((i) => i.type === 'alert')?.href || '#/discord';
    const chip = (href, label, n) => html`<a class="chip nf-chip ${n ? 'on' : ''}" data-nav="${href}" style="cursor:pointer">${label} <b>${n}</b></a>`;
    const items = d.items.slice(0, 6);
    return html`<div class="panel nf-home"><h2>Needs your attention <span>${d.unseen.total ? `${d.unseen.total} new since you last looked` : 'Nothing new since you last looked'} · <a data-nf="settings" style="cursor:pointer">Notification settings</a></span></h2>
      <div class="nf-chips">${chip('#/pulse/ideas', 'Unanswered questions', o.pulse.questions)}${chip('#/pulse/ideas', 'Concerns', o.pulse.concerns)}${chip('#/pulse/ideas', 'Ideas', o.pulse.ideas)}${chip(alertHref, 'Removed messages to review', o.alerts)}${chip('#/faqs', 'FAQ drafts', o.faqs)}</div>
      ${items.length ? html`<div class="nf-list flat">${items.map(row)}</div>` : html`<div class="empty">All clear. Sentinel will show new questions, concerns and removed messages here.</div>`}
    </div>`;
  }

  function closePanel() {
    const p = document.getElementById('nf-panel');
    if (!p) return;
    p.remove();
    document.querySelectorAll('.nf-bell').forEach((b) => b.setAttribute('aria-expanded', 'false'));
    // The person opened the panel and saw the list, so what was in it is now read.
    if (panelViewed) { panelViewed = false; markSeen(['pulse', 'alerts', 'faqs']); }
  }

  function togglePanel(btn) {
    if (document.getElementById('nf-panel')) return closePanel();
    const p = document.createElement('div');
    p.id = 'nf-panel'; p.className = 'nf-panel'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', 'Notifications');
    p.innerHTML = panelHtml().s;
    document.body.appendChild(p);
    panelViewed = true;
    const r = btn.getBoundingClientRect();
    p.style.top = `${Math.round(Math.min(Math.max(r.bottom + 8, 12), 140))}px`;
    p.style.right = `${Math.max(12, Math.round(window.innerWidth - r.right))}px`;
    btn.setAttribute('aria-expanded', 'true');
    load().catch(() => {});
  }

  /* ---------------- settings window ---------------- */
  function settingsInner() {
    const dm = data?.dm || {};
    const supported = 'Notification' in window;
    let note, action = '';
    if (!supported) note = 'This browser cannot show pop-up alerts.';
    else if (!window.isSecureContext) note = 'Pop-up alerts need a secure (https) address. They will work once Sentinel is live on https.';
    else if (Notification.permission === 'denied') note = 'Blocked in your browser settings. Allow notifications for this site, then reopen this window.';
    else if (Notification.permission === 'granted' && prefs.browser) { note = 'On. You get a pop-up when Sentinel is open but in the background.'; action = html`<button type="button" class="btn" data-nf="browser-off">Turn off</button>`; }
    else { note = 'Get a pop-up when Sentinel is open but in the background.'; action = html`<button type="button" class="btn primary" data-nf="browser-on">Turn on</button>`; }

    const chan = (ch, label, help) => {
      const s = dm[ch];
      if (!s) return '';
      return html`<label class="nf-opt"><input type="checkbox" data-nf-change="dm-on" data-channel="${ch}" ${s.on ? 'checked' : ''}><span><b>Message me on ${label}</b><small>${help}</small></span></label>
        ${s.on && html`<div class="nf-kinds">${KINDS.map(([k, l]) => html`<label><input type="checkbox" data-nf-change="dm-kind" data-channel="${ch}" data-kind="${k}" ${s.kinds.includes(k) ? 'checked' : ''}> ${l}</label>`)}<button type="button" class="btn" data-nf="dm-test" data-channel="${ch}">Send a test</button></div>`}`;
    };

    return html`<p class="muted" style="margin:6px 0 14px">Choose how Sentinel tells you that something needs you.</p>
      <h4 class="nf-h">On this device</h4>
      <label class="nf-opt"><input type="checkbox" data-nf-change="sound" ${prefs.sound ? 'checked' : ''}><span><b>Play a sound</b><small>A short chime when something new arrives while Sentinel is open.</small></span></label>
      <div class="nf-opt static"><span><b>Pop-up alerts</b><small>${note}</small></span>${action}</div>
      <h4 class="nf-h">On your phone, even when Sentinel is closed</h4>
      ${chan('telegram', 'Telegram', 'Sentinel sends you a private Telegram message, so you hear about it on your phone with this page closed.')}
      ${chan('discord', 'Discord', 'Sentinel sends you a private Discord message. Allow direct messages from server members in your Discord privacy settings.')}
      ${!dm.telegram && !dm.discord && html`<p class="muted">Sign in with Telegram or Discord to get phone alerts.</p>`}
      <p class="muted" style="margin-top:12px">You only hear about communities you manage. Praise and general chat never send an alert.</p>`;
  }

  const redrawSettings = () => { const el = document.getElementById('nf-set'); if (el) el.innerHTML = settingsInner().s; };

  function openSettings() {
    closePanel();
    const root = document.getElementById('drawer-root');
    if (!root) return;
    root.innerHTML = modalShell('Notifications', html`<div id="nf-set">${settingsInner()}</div>`).s;
  }

  /* ---------------- events ---------------- */
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-nf]');
    if (!el) { const p = document.getElementById('nf-panel'); if (p && !p.contains(e.target)) closePanel(); return; }
    const act = el.dataset.nf;
    try {
      if (act === 'bell') return togglePanel(el);
      if (act === 'read-all') return await markSeen(['pulse', 'alerts', 'faqs']);
      if (act === 'settings') { await load().catch(() => {}); return openSettings(); }
      if (act === 'go') {
        const href = el.dataset.href || '#/home';
        panelViewed = false; // opening one item reads that section only, not everything in the panel
        closePanel();
        markSeen(SECTION[href.replace(/^#\//, '').split('/')[0]] || []);
        if (location.hash === href) loadPage(route().page, { silent: true }); else location.hash = href;
        return;
      }
      if (act === 'browser-on') {
        const p = await Notification.requestPermission();
        prefs.browser = p === 'granted'; put(K.prefs, prefs); redrawSettings();
        if (prefs.browser) native('Sentinel alerts are on', 'You will see pop-ups like this one.', '#/home');
        return;
      }
      if (act === 'browser-off') { prefs.browser = false; put(K.prefs, prefs); return redrawSettings(); }
      if (act === 'dm-test') {
        el.disabled = true;
        const r = await api('/notifications/dm/test', { method: 'POST', body: { channel: el.dataset.channel } });
        el.disabled = false;
        toast(r.ok ? 'Test sent. Check your phone.' : (r.error || 'Could not send the test.'), !r.ok);
      }
    } catch (err) { fail(err); }
  });

  document.addEventListener('change', async (e) => {
    const el = e.target.closest('[data-nf-change]');
    if (!el) return;
    const what = el.dataset.nfChange;
    try {
      if (what === 'sound') { prefs.sound = el.checked; put(K.prefs, prefs); if (el.checked) beep(); return; }
      const ch = el.dataset.channel;
      const kinds = what === 'dm-kind' ? [...document.querySelectorAll(`#nf-set [data-nf-change="dm-kind"][data-channel="${ch}"]`)].filter((x) => x.checked).map((x) => x.dataset.kind) : undefined;
      const on = what === 'dm-on' ? el.checked : !!data?.dm?.[ch]?.on;
      await api('/notifications/dm', { method: 'POST', body: { channel: ch, on, kinds } });
      await load();
      redrawSettings();
      if (what === 'dm-on' && on) toast('Phone alerts are on. Press "Send a test" to check they reach you.');
    } catch (err) { fail(err); redrawSettings(); }
  });

  addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanel(); });
  addEventListener('hashchange', closePanel);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load().catch(() => {}); });

  /* ---------------- lifecycle ---------------- */
  function loop() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (signedIn()) await load().catch(() => {});
      else if (data) { data = null; curNs = null; paint(); document.title = 'Sentinel'; }
      loop();
    }, document.hidden ? 30000 : 8000);
  }

  function start() {
    if (!signedIn()) return;
    if (!started) {
      started = true;
      if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});
      loop();
    }
    paint();
    load().catch(() => {});
  }

  function afterPage() {
    if (!signedIn()) return;
    const page = route().page;
    if (page !== lastPage) {
      lastPage = page;
      hl = { page, ids: new Set() };
      if (page === 'pulse' && data) data.items.forEach((i) => { if (i.type === 'pulse' && i.unseen) hl.ids.add(i.id); });
    }
    start();
    inject();
    paint();
    decorate();
  }

  window.Notify = { start, afterPage, refresh: load, homeCard, markSeen };
})();
