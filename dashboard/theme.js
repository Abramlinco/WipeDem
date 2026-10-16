'use strict';
// Loaded in <head> so the right theme is set before anything is drawn, with no flash.
// Without a saved choice the page follows the device (light or dark).
(function () {
  const KEY = 'sentinel.theme';
  const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const root = document.documentElement;
  const saved = read();
  if (saved === 'light' || saved === 'dark') root.setAttribute('data-theme', saved);

  const isDark = () => (root.getAttribute('data-theme')
    ? root.getAttribute('data-theme') === 'dark'
    : window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);

  function sync() {
    const dark = isDark();
    document.querySelectorAll('[data-theme-label]').forEach((el) => { el.textContent = dark ? 'Light mode' : 'Dark mode'; });
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#0a1114' : '#f2f4f5');
  }
  function toggle() {
    const next = isDark() ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem(KEY, next); } catch { /* private mode: the choice just lasts until reload */ }
    sync();
  }
  document.addEventListener('click', (e) => { if (e.target.closest('[data-theme-toggle]')) toggle(); });
  window.Theme = { toggle, sync, isDark };
})();
