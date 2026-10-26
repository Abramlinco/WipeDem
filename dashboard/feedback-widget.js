'use strict';
/* =====================================================================
   Testing-phase notice + floating feedback button (feedback-widget patch)
   A small card fixed to the corner of the screen. Closing it folds it into a
   "Feedback" button that stays put while the page scrolls; tapping that opens
   the card again. "Send feedback" opens the visitor's own mail app, addressed
   to the developer. Nothing here talks to the server.
   To change where feedback goes, edit EMAIL below.
===================================================================== */
(function () {
  var EMAIL = 'abrahameffiong6@gmail.com';
  var KEY = 'sentinel_fb_min';

  function isMin() { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } }
  function setMin(v) { try { if (v) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch (e) { /* private mode: it just will not be remembered */ } }

  var ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

  function mailto() {
    var body = 'What happened, or what would you like to see?\r\n\r\n\r\n\r\n---\r\nPage: ' +
      (location.hash || '#/').slice(0, 80) + '\r\nBrowser: ' + String(navigator.userAgent || '').slice(0, 120);
    return 'mailto:' + EMAIL + '?subject=' + encodeURIComponent('Sentinel feedback') + '&body=' + encodeURIComponent(body);
  }

  var root = document.createElement('div');
  root.className = 'fbw';
  root.setAttribute('data-nopush', '');
  document.body.appendChild(root);

  function render(focus) {
    var min = isMin();
    root.classList.toggle('min', min);
    // Only fixed text goes into this markup, so nothing from outside can reach it.
    if (min) {
      root.innerHTML = '<button type="button" class="fbw-pill" data-fbw="open" aria-label="Open feedback">' + ICON + '<span>Feedback</span></button>';
    } else {
      root.innerHTML =
        '<section class="fbw-card" role="region" aria-label="Testing phase notice">' +
          '<div class="fbw-head"><span class="fbw-tag">Testing</span>' +
            '<button type="button" class="fbw-x" data-fbw="close" aria-label="Minimize this notice">&#8211;</button></div>' +
          '<p><b>Sentinel is in a testing phase.</b> Something broken, or an idea? You can send your feedback with the button below.</p>' +
          '<a class="btn primary fbw-send" data-fbw="mail" href="' + mailto() + '">' + ICON + '<span>Send feedback</span></a>' +
          '<div class="fbw-more">' +
            (typeof window.openFeedback === 'function' ? '<button type="button" class="fbw-link" data-fbw="form">Write it here instead</button>' : '') +
            '<span class="fbw-addr">' + EMAIL + '</span></div>' +
        '</section>';
    }
    if (focus) { var f = root.querySelector('button, a'); if (f) f.focus(); }
  }

  // On phones the bottom tab bar is there only when signed in. Keep the button clear of it.
  function syncBar() { root.classList.toggle('fbw-up', !!document.getElementById('tabbar')); }

  root.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-fbw]') : null;
    if (!el) return;
    var act = el.getAttribute('data-fbw');
    if (act === 'close') { setMin(true); render(true); }
    else if (act === 'open') { setMin(false); render(true); }
    else if (act === 'mail') { el.setAttribute('href', mailto()); }
    else if (act === 'form') { if (typeof window.openFeedback === 'function') window.openFeedback(); }
  });

  render(false);
  syncBar();
  var app = document.getElementById('app');
  if (app && window.MutationObserver) new MutationObserver(syncBar).observe(app, { childList: true });
  window.addEventListener('hashchange', function () { var a = root.querySelector('[data-fbw="mail"]'); if (a) a.setAttribute('href', mailto()); });
})();
