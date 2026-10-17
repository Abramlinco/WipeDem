import { config } from './config.js';
import { createApp } from './server.js';
import { flushStats, recordMemberCount } from './db.js';
import { startDiscordBot, discordMemberCounts } from './discord/bot.js';
import { startTelegramBot, telegramMemberCounts } from './telegram/bot.js';
import { startFeeder } from './pulse/feeder.js';
import { startWatcher } from './pulse/intelligence.js';

const app = await createApp();
app.listen(config.port, config.host, () => {
  console.log(`[server] Dashboard running at ${config.publicUrl}  (listening on ${config.host}:${config.port})`);
});

startDiscordBot();
startTelegramBot();
startFeeder();
startWatcher();

// Things that are fine while testing but must not be left on for real users.
if (config.pulseCaptureStaff) console.warn('[WARNING] PULSE_CAPTURE_STAFF is on: admins and owners are being read as if they were members. Turn it off before going live.');
if (config.pulseDebug) console.warn('[note] PULSE_DEBUG is on: message text is printed to this log. Turn it off before going live, so member messages do not end up in log files.');
if (config.host !== '127.0.0.1' && config.host !== 'localhost' && !config.publicUrl.startsWith('https')) {
  console.warn('[WARNING] The dashboard is reachable from the network but PUBLIC_URL is not https. Put it behind HTTPS before real admins sign in.');
}

// Save the message counters every few seconds, not on every message.
setInterval(() => flushStats().catch(e => console.error('[stats]', e.message)), 15000);

// Once an hour, note how many members each community has (for the growth report).
async function snapshotMembers() {
  try {
    for (const { key, count } of [...await discordMemberCounts(), ...await telegramMemberCounts()]) {
      await recordMemberCount(key, count);
    }
  } catch (e) { console.error('[members]', e.message); }
}
setTimeout(snapshotMembers, 20000);
setInterval(snapshotMembers, 3600000);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => { await flushStats().catch(() => {}); process.exit(0); });
}
