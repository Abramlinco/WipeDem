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
    const list = [];

    // 1. Process Discord Objects safely
    const discordData = discordMemberCounts(); // Non-async object
    for (const [guildId, count] of Object.entries(discordData || {})) {
      list.push({ key: `discord:${guildId}`, count });
    }

    // 2. Process Telegram Objects safely
    // (Assuming telegramMemberCounts behaves the same way or uses an async database layer)
    const telegramData = typeof telegramMemberCounts === 'function' ? await telegramMemberCounts() : {};
    if (telegramData && typeof telegramData === 'object' && !Array.isArray(telegramData)) {
      for (const [chatId, count] of Object.entries(telegramData)) {
        list.push({ key: `telegram:${chatId}`, count });
      }
    } else if (Array.isArray(telegramData)) {
      list.push(...telegramData);
    }

    // 3. Commit records to database
    for (const { key, count } of list) {
      await recordMemberCount(key, count);
    }
  } catch (e) { 
    console.error('[members]', e.message); 
  }
}


setTimeout(snapshotMembers, 20000);
setInterval(snapshotMembers, 3600000);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => { await flushStats().catch(() => {}); process.exit(0); });
}
