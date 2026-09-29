import 'dotenv/config';
import { config } from './config.js';
import { createApp } from './server.js';
import { flushStats, recordMemberCount } from './db.js';
import { startDiscordBot, discordMemberCounts } from './discord/bot.js';
import { startTelegramBot, telegramMemberCounts } from './telegram/bot.js';

const app = await createApp();
app.listen(config.port, config.host, () => {
  console.log(`[server] Dashboard running at ${config.publicUrl}  (listening on ${config.host}:${config.port})`);
});

startDiscordBot();
startTelegramBot();

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
