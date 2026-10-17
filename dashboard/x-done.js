// Tells the open Sentinel tab that X is connected, then closes this tab if the browser allows it.
try { const c = new BroadcastChannel('sentinel-x'); c.postMessage({ type: 'x-connected' }); c.close(); } catch { /* ignore */ }
setTimeout(() => window.close(), 600);
