/* notify-patch: lets Sentinel show a pop-up that works on phones too, and opens the right page when it is tapped. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if ('focus' in c) return c.focus().then((w) => (w && w.navigate ? w.navigate(url) : null)).catch(() => {});
    }
    return self.clients.openWindow(url);
  }));
});
