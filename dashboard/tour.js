'use strict';

/* =====================================================================
   First-time guide.
   - A welcome card the first time someone signs in.
   - A short spotlight tour of the navigation.
   - A note at the top of each page the first time it is opened.
   - Hover tips that say what a button does (long press or tap on a phone).
   All of it is switched on or off with the Guide button, and remembered
   in this browser only. Everything shown is fixed text written here.
===================================================================== */
(() => {
  const K = { guide: 'sentinel.guide', welcomed: 'sentinel.welcomed', seen: 'sentinel.seen', tips: 'sentinel.tips' };
  const get = (k, d = null) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } };
  const put = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode: it just will not be remembered */ } };
  const list = (k) => { try { const v = JSON.parse(get(k, '[]')); return Array.isArray(v) ? v : []; } catch { return []; } };
  const isOn = () => get(K.guide) !== 'off';
  const say = (m, err) => { if (typeof toast === 'function') toast(m, err); };
  const phone = () => window.matchMedia && window.matchMedia('(max-width: 820px)').matches;
  const ic = (name) => (typeof ICONS !== 'undefined' && ICONS[name]) || '';
  const mark = () => (typeof MARK !== 'undefined' ? MARK : '');

  /* ---------------- what each page is for ---------------- */
  const INTRO = {
    home: ['Your daily overview', 'See what Sentinel caught today, how many messages are waiting for your review, and how your communities are growing. Click any flagged message to see that person\'s history.'],
    discord: ['Your Discord servers', 'These are messages Sentinel removed. Nothing is final until you choose: Ban removes the person, Caution posts your warning in the chat, and Release lifts any mute or ban. Click a name to see their history.'],
    telegram: ['Your Telegram groups', 'These are messages Sentinel removed. Nothing is final until you choose: Ban removes the person, Caution posts your warning in the chat, and Release lifts any mute or ban. Click a name to see their history.'],
    'pulse/ideas': ['What your community is saying', 'Pulse picks out ideas, questions and concerns from your chats. Press Draft reply for a suggested answer you can edit, copy or send. Star keeps something near the top, Done marks it handled, and Dismiss hides it.'],
    'pulse/trends': ['What is happening outside', 'Crypto news, Reddit and mainstream tech, with the stories your members are also talking about shown first. Use Refresh now to read the feeds straight away.'],
    'pulse/pools': ['Pools you watch', 'Paste a link to a pool, or your token\'s address, and Pulse checks it every 20 minutes. You are told when liquidity drops or grows, when trading spikes, and when a new pool appears for your token. Important changes also show up as ideas in the Playbook.'],
    'pulse/playbook': ['Ideas for what to post', 'Pulse compares what your members say with what is trending and suggests what to do. Each idea has steps and a draft post you can copy.'],
    'pulse/setup': ['Teach Pulse about your project', 'The more it knows, the better the replies. Add your brief and docs under Project brief and Knowledge. Drafting controls how drafts are prepared, Focus picks your topics, X sets up reading and posting on X, and Reading chooses which communities are read.'],
    reports: ['How things are going over time', 'Charts of scams caught and member growth. Copy a summary or download a CSV to share with your team.'],
    network: ['People flagged elsewhere', 'Look up someone before you trust them. You see how many communities flagged them and why, never which communities. Nothing is banned automatically.'],
    settings: ['How Sentinel behaves', 'Choose what counts as a scam, what happens to people who break rules, the messages Sentinel posts, and who it trusts as an admin. Pulse settings are on the Pulse page, under Setup.']
  };
  function pageKey() {
    const [page, sub] = (location.hash.replace(/^#\/?/, '') || 'home').split('/');
    if (page === 'pulse') return `pulse/${!sub || sub === 'brief' ? (sub === 'brief' ? 'setup' : 'ideas') : sub}`;
    return page || 'home';
  }

  /* ---------------- hover tips ---------------- */
  const NAV_TIPS = {
    '#/home': 'Today\'s overview: what Sentinel caught and what needs your review.',
    '#/discord': 'Messages Sentinel removed in your Discord servers, waiting for your decision.',
    '#/telegram': 'Messages Sentinel removed in your Telegram groups, waiting for your decision.',
    '#/pulse': 'Ideas, questions and concerns from your community, plus trends and reply drafts.',
    '#/reports': 'Charts of scams caught and member growth over time.',
    '#/network': 'Look up people flagged by other communities.',
    '#/settings': 'Rules, penalties, messages and trusted admins.',
    '#/pulse/ideas': 'What your members are asking, suggesting and worrying about.',
    '#/pulse/trends': 'What is trending in crypto and beyond, including X.',
    '#/pulse/pools': 'The pools you watch, and what changed in them.',
    '#/pulse/playbook': 'Suggested posts and campaigns based on your chats and the news.',
    '#/pulse/setup': 'Your brief, knowledge, drafting and focus settings.'
  };
  const RULES = [
    ['[data-do="ban"]', 'Ban this person from the community. You will be asked to confirm first.'],
    ['[data-do="release"]', 'Lift any mute or ban and close this alert. Use it when Sentinel got it wrong.'],
    ['[data-do="caution"]', 'Post your caution message in the chat, mentioning this person. They are not removed.'],
    ['[data-pulse="draft"][data-fresh]', 'Write a fresh draft from scratch.'],
    ['[data-pulse="draft"]', 'Get a suggested reply built from your brief, docs and live data. You can edit it before anything is sent.'],
    ['[data-pulse="status"][data-status="starred"]', 'Star this to keep it near the top of the list.'],
    ['[data-pulse="status"][data-status="done"]', 'Mark as handled. It leaves the list (tick Show handled to see it again).'],
    ['[data-pulse="status"][data-status="dismissed"]', 'Hide this from the list. Use it for noise.'],
    ['[data-pulse="status"][data-status="new"]', 'Put this back in the list.'],
    ['[data-pulse="topic"]', 'Show only messages about this topic. Click again to clear it.'],
    ['[data-pulse="refresh"]', 'Read the news feeds now instead of waiting for the next automatic check.'],
    ['[data-pulse="copy"]', 'Copy this draft post so you can paste it on X, Telegram or Discord.'],
    ['[data-pulse="copy-draft"]', 'Copy this reply so you can paste it into the chat yourself.'],
    ['[data-pulse="send-draft"]', 'Post this as a reply in the chat. You will be asked to confirm first.'],
    ['[data-pulse="enabled"]', 'Turn Pulse reading on or off for this community.'],
    ['[data-pulse="know-ask"]', 'See which sources a draft would use for this question. Nothing is sent.'],
    ['[data-pulse="know-refresh"]', 'Read this source again now.'],
    ['[data-pulse="know-del"]', 'Stop using this source in replies.'],
    ['[data-pulse="know-add-url"]', 'Read this page and keep its text so replies can use it.'],
    ['[data-pulse="know-find"]', 'Search DefiLlama for your project by name.'],
    ['[data-pulse="know-llama-add"]', 'Keep this project\'s total value locked up to date, so replies can quote it with the time.'],
    ['[data-pulse="pool-add"]', 'Start watching this. Pulse reads it straight away to check the link works.'],
    ['[data-pulse="pool-refresh"]', 'Check this pool again now.'],
    ['[data-pulse="pool-del"]', 'Stop watching this pool and remove its updates.'],
    ['[data-pulse="post"]', 'Share this on your Discord, Telegram or X. You choose where, and confirm before anything is posted.'],
    ['[data-pulse="post-go"]', 'Post to every place you ticked. You will be asked to confirm first.'],
    ['[data-pulse="post-copy"]', 'Copy this text so you can paste it yourself.'],
    ['[data-pulse="x-refresh"]', 'Read X now. This spends X credits, so it can be used once every ten minutes.'],
    ['[data-pulse="x-watch-add"]', 'Follow this X account or search. It is read when X is next read.'],
    ['[data-pulse="x-connect"]', 'Connect your X account so Sentinel can post for you. The keys are encrypted before they are saved.'],
    ['[data-pulse="x-disconnect"]', 'Forget these keys. Sentinel will no longer be able to post to this X account.'],
    ['[data-act="rule-toggle"]', 'Turn this rule on or off.'],
    ['[data-act="kw-add"]', 'Add a phrase that triggers this rule.'],
    ['[data-act="rule-del"]', 'Delete this rule and all its phrases.'],
    ['[data-act="link-strict"]', 'Strict blocks every link from non-admins. Smart blocks only links that look risky.'],
    ['[data-act="admin-role"]', 'Treat everyone with this role as a trusted admin.'],
    ['[data-act="copy-report"]', 'Copy a short summary you can paste into a message.'],
    ['[data-act="add-community"]', (el) => `Connect another ${el.dataset.platform === 'discord' ? 'Discord server' : 'Telegram group'}.`],
    ['.navplus', (el) => `Connect another ${el.dataset.platform === 'discord' ? 'Discord server' : 'Telegram group'}.`],
    ['[data-change="scope"]', 'Look at one community, or all of them together.'],
    ['[data-guide="toggle"]', 'Turn these hover tips and page notes on or off.'],
    ['[data-theme-toggle]', 'Switch between light and dark.'],
    ['[data-act="logout"]', 'Sign out of Sentinel on this device.'],
    ['[data-act="more"]', 'More pages: Reports, Network, Settings and your account.'],
    ['[data-nav]', (el) => NAV_TIPS[el.dataset.nav]]
  ];

  let tipEl = null, tipTimer = null, tipFor = null;
  const tipNode = () => {
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tip'; tipEl.setAttribute('role', 'tooltip'); document.body.appendChild(tipEl); }
    return tipEl;
  };
  function match(target) {
    if (!target || !target.closest) return null;
    for (const [sel, t] of RULES) {
      const el = target.closest(sel);
      if (el) { const text = typeof t === 'function' ? t(el) : t; if (text) return { el, text }; }
    }
    return null;
  }
  function showTip(el, text) {
    const t = tipNode();
    t.textContent = text;
    t.style.left = '0px'; t.style.top = '0px';
    t.classList.add('show');
    const r = el.getBoundingClientRect(), w = t.offsetWidth, h = t.offsetHeight;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    let top = r.bottom + 8;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 8);
    t.style.left = `${Math.round(left)}px`; t.style.top = `${Math.round(top)}px`;
  }
  function hideTip() {
    clearTimeout(tipTimer); tipFor = null;
    if (tipEl) tipEl.classList.remove('show');
  }
  document.addEventListener('mouseover', (e) => {
    if (!isOn()) return;
    const m = match(e.target);
    if (!m) return hideTip();
    if (m.el === tipFor) return;
    hideTip(); tipFor = m.el;
    // Shown only if the pointer is still on the button when the delay is over.
    tipTimer = setTimeout(() => { if (tipFor === m.el && m.el.matches(':hover')) showTip(m.el, m.text); }, 380);
  });
  document.addEventListener('mouseout', (e) => { if (tipFor && !tipFor.contains(e.relatedTarget)) hideTip(); });
  // Scrolling hides a tip that is showing, but does not cancel one that is about to show.
  document.addEventListener('scroll', () => { if (tipEl) tipEl.classList.remove('show'); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTip(); });
  document.addEventListener('focusin', (e) => {
    if (!isOn() || !e.target.matches || !e.target.matches(':focus-visible')) return;
    const m = match(e.target);
    if (m) { hideTip(); tipFor = m.el; showTip(m.el, m.text); }
  });
  document.addEventListener('focusout', hideTip);
  // On a phone there is no hover, so the first tap on each kind of button also shows its tip for a moment.
  document.addEventListener('pointerdown', (e) => {
    hideTip();
    if (e.pointerType !== 'touch' || !isOn()) return;
    const m = match(e.target);
    if (!m) return;
    const key = m.text.slice(0, 40), seen = list(K.tips);
    if (seen.includes(key)) return;
    put(K.tips, JSON.stringify([...seen, key].slice(-60)));
    tipFor = m.el; showTip(m.el, m.text);
    tipTimer = setTimeout(hideTip, 3200);
  }, true);

  /* ---------------- page note ---------------- */
  function afterPage() {
    const page = document.getElementById('page');
    if (!page) return;
    page.querySelectorAll('.guide-note').forEach((n) => n.remove());
    if (!isOn() || !get(K.welcomed)) return; // notes wait until the welcome card has been dealt with
    const key = pageKey();
    const intro = INTRO[key];
    if (!intro || list(K.seen).includes(key)) return;
    const note = document.createElement('div');
    note.className = 'guide-note';
    note.setAttribute('role', 'note');
    note.dataset.key = key;
    note.innerHTML = `<span class="gi">${ic('help')}</span>
      <div class="gt"><b></b><p></p></div>
      <div class="gb"><button class="btn" data-guide="tour">Take the tour</button><button class="btn primary" data-guide="dismiss">Got it</button></div>`;
    note.querySelector('b').textContent = intro[0];
    note.querySelector('p').textContent = intro[1];
    const top = page.querySelector(':scope > .topbar');
    if (top) top.after(note); else page.prepend(note);
  }

  /* ---------------- on / off ---------------- */
  function sync() {
    const on = isOn();
    document.querySelectorAll('[data-guide-state]').forEach((el) => { el.textContent = on ? 'On' : 'Off'; el.classList.toggle('on', on); });
    document.querySelectorAll('[data-guide="toggle"]').forEach((el) => el.setAttribute('aria-pressed', String(on)));
  }
  function setGuide(on) {
    put(K.guide, on ? 'on' : 'off');
    if (on) put(K.seen, '[]');
    hideTip(); sync(); afterPage();
    say(on ? 'Guide is on. Hover over buttons to see what they do.' : 'Guide is off. Turn it on again any time from the Guide button.');
  }

  /* ---------------- welcome card ---------------- */
  function welcome() {
    if (document.querySelector('.welcome')) return;
    const box = document.createElement('div');
    box.className = 'overlay center';
    box.style.zIndex = '80';
    box.innerHTML = `<div class="welcome" role="dialog" aria-modal="true" aria-labelledby="wl-t">
      ${mark()}
      <h2 id="wl-t">Welcome to Sentinel</h2>
      <p class="lead">Sentinel looks after your Discord and Telegram communities and helps you hear what members are really saying. Here is what it does.</p>
      <ul class="points">
        <li><span class="pi">${ic('shield')}</span><div><b>Protection that asks first</b><span>Catches fake admins, scam links and raid bots. Nobody is banned without your decision.</span></div></li>
        <li><span class="pi">${ic('listen')}</span><div><b>Ideas, questions and concerns</b><span>Pulse turns busy chats into a short list, next to what is trending in crypto.</span></div></li>
        <li><span class="pi">${ic('reply')}</span><div><b>Replies you approve</b><span>Drafts answers from your own docs and live data. Nothing is posted until you press send.</span></div></li>
      </ul>
      <div class="wb"><button class="btn" data-w="skip">Skip, I will explore</button><button class="btn primary" data-w="tour">Show me around</button></div>
    </div>`;
    const close = (choice) => {
      document.removeEventListener('keydown', onKey, true);
      box.remove(); put(K.welcomed, '1');
      if (choice === 'tour') { put(K.guide, 'on'); sync(); setTimeout(startTour, 200); }
      else { put(K.guide, 'off'); sync(); afterPage(); say('Guide is off. Turn it on any time from the Guide button.'); }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close('skip'); }
      if (e.key === 'Tab') { // keep focus inside the card
        const b = [...box.querySelectorAll('button')];
        const i = b.indexOf(document.activeElement);
        e.preventDefault();
        b[(i + (e.shiftKey ? -1 : 1) + b.length) % b.length].focus();
      }
    };
    box.addEventListener('click', (e) => { const b = e.target.closest('[data-w]'); if (b) close(b.dataset.w); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(box);
    box.querySelector('[data-w="tour"]').focus();
  }

  /* ---------------- spotlight tour ---------------- */
  const STEPS = [
    { sel: '[data-nav="#/home"]', title: 'Home', text: 'Your daily overview: what Sentinel caught, how many messages need your review, and how your communities are growing.' },
    { sel: '[data-nav="#/discord"]', title: 'Discord', text: 'Every message Sentinel removed in your servers. You decide what happens to each person. The + connects another server.' },
    { sel: '[data-nav="#/telegram"]', title: 'Telegram', text: 'The same for your Telegram groups. A red number appears when messages are waiting for you.' },
    { sel: '[data-nav="#/pulse"]', title: 'Pulse', text: 'Hear your community. Pulse finds ideas, questions and concerns in chat, shows what is trending, and drafts replies you approve before anything is posted.' },
    { sel: '[data-nav="#/reports"]', more: true, title: 'Reports', text: 'Charts of scams caught and member growth over time, with a summary or export you can share with your team.' },
    { sel: '[data-nav="#/network"]', more: true, title: 'Network', text: 'Look up people other communities have flagged. You see how many flagged them and why, never which communities.' },
    { sel: '[data-nav="#/settings"]', more: true, title: 'Settings', text: 'Choose what counts as a scam, what happens to rule breakers, the messages Sentinel posts, and who it trusts.' },
    { sel: '[data-guide="toggle"]', more: true, title: 'This guide', text: 'Hover over any button to see what it does, and read the short note at the top of each page. Turn it off here whenever you like.' }
  ];
  let tour = null;
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const targetFor = (step) => [...document.querySelectorAll(step.sel)].find(visible) || null;

  function startTour() {
    if (tour) return;
    document.querySelectorAll('.guide-note').forEach((n) => n.remove());
    hideTip();
    const shade = document.createElement('div'); shade.className = 'tour-shade';
    const spot = document.createElement('div'); spot.className = 'tour-spot';
    const pop = document.createElement('div'); pop.className = 'tour-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Quick tour');
    document.body.append(shade, spot, pop);
    tour = { i: 0, shade, spot, pop };
    document.addEventListener('keydown', onTourKey, true);
    window.addEventListener('resize', place);
    go(0);
  }
  function endTour(finished) {
    if (!tour) return;
    document.removeEventListener('keydown', onTourKey, true);
    window.removeEventListener('resize', place);
    tour.shade.remove(); tour.spot.remove(); tour.pop.remove(); tour = null;
    document.getElementById('tabbar')?.classList.remove('open');
    put(K.welcomed, '1');
    if (finished) { afterPage(); say('That is the tour. Hover over any button to see what it does.'); } else afterPage();
  }
  function go(i) {
    if (!tour) return;
    tour.i = Math.max(0, Math.min(STEPS.length - 1, i));
    const step = STEPS[tour.i];
    const tabbar = document.getElementById('tabbar');
    if (tabbar) tabbar.classList.toggle('open', phone() && !!step.more);
    tour.pop.innerHTML = `<h3></h3><p></p><div class="tb"><span class="count"></span>
      <button class="btn" data-t="skip">Skip</button>${tour.i ? '<button class="btn" data-t="back">Back</button>' : ''}
      <button class="btn primary" data-t="next">${tour.i === STEPS.length - 1 ? 'Done' : 'Next'}</button></div>`;
    tour.pop.querySelector('h3').textContent = step.title;
    tour.pop.querySelector('p').textContent = step.text;
    tour.pop.querySelector('.count').textContent = `${tour.i + 1} of ${STEPS.length}`;
    tour.pop.onclick = (e) => {
      const b = e.target.closest('[data-t]');
      if (!b) return;
      if (b.dataset.t === 'next') { tour.i === STEPS.length - 1 ? endTour(true) : go(tour.i + 1); }
      else if (b.dataset.t === 'back') go(tour.i - 1);
      else endTour(false);
    };
    requestAnimationFrame(() => { place(); tour?.pop.querySelector('[data-t="next"]')?.focus(); });
    // The phone's More menu animates open, so measure again once it has settled.
    setTimeout(place, 260);
  }
  function place() {
    if (!tour) return;
    const step = STEPS[tour.i];
    const el = targetFor(step);
    const { spot, pop } = tour;
    if (!el) { spot.style.cssText = 'display:none'; pop.style.left = '50%'; pop.style.top = '30%'; pop.style.transform = 'translateX(-50%)'; return; }
    pop.style.transform = '';
    const r = el.getBoundingClientRect(), pad = 6;
    spot.style.display = 'block';
    spot.style.left = `${r.left - pad}px`; spot.style.top = `${r.top - pad}px`;
    spot.style.width = `${r.width + pad * 2}px`; spot.style.height = `${r.height + pad * 2}px`;
    const pw = pop.offsetWidth, ph = pop.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    let left, top;
    if (!phone()) {
      left = r.right + 20; top = r.top + r.height / 2 - ph / 2;
      if (left + pw > vw - 12) left = Math.max(12, r.left - pw - 20);
    } else {
      left = Math.min(Math.max(12, r.left + r.width / 2 - pw / 2), vw - pw - 12);
      top = r.top - ph - 18;
      if (top < 12) top = r.bottom + 18;
    }
    top = Math.min(Math.max(12, top), vh - ph - 12);
    pop.style.left = `${Math.round(left)}px`; pop.style.top = `${Math.round(top)}px`;
  }
  function onTourKey(e) {
    if (!tour) return;
    if (e.key === 'Escape') { e.stopPropagation(); endTour(false); }
    else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); tour.i === STEPS.length - 1 ? endTour(true) : go(tour.i + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); go(tour.i - 1); }
  }

  /* ---------------- buttons ---------------- */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-guide]');
    if (!b) return;
    const what = b.dataset.guide;
    document.getElementById('tabbar')?.classList.remove('open');
    if (what === 'toggle') setGuide(!isOn());
    else if (what === 'dismiss') { put(K.seen, JSON.stringify([...new Set([...list(K.seen), b.closest('.guide-note')?.dataset.key || pageKey()])])); afterPage(); }
    else if (what === 'tour') { put(K.guide, 'on'); sync(); startTour(); }
  });

  window.Guide = {
    isOn, sync, afterPage, start: startTour,
    afterRender() {
      sync();
      if (!get(K.welcomed)) setTimeout(() => { if (!get(K.welcomed)) welcome(); }, 450);
    }
  };
})();
