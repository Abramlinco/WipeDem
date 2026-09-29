import { discordLoginEnabled } from './config.js';
import { botInGuild, discordUserStillManages, discordGuildName, discordInviteUrl } from './discord/bot.js';
import { telegramAdminChats } from './telegram/bot.js';

// Works out, live, which servers and groups this signed in person
// manages. Every API call is limited to exactly this list.

async function liveAccess(session) {
  const communities = [];
  const invites = [];

  if (session.discord?.user) {
    for (const g of session.discord.guilds || []) {
      if (botInGuild(g.id)) {
        if (await discordUserStillManages(g.id, session.discord.user.id)) {
          communities.push({ key: `discord:${g.id}`, platform: 'discord', id: g.id, name: discordGuildName(g.id) || g.name, icon: g.icon });
        }
      } else if (discordLoginEnabled()) {
        invites.push({ id: g.id, name: g.name, url: discordInviteUrl(g.id) });
      }
    }
  }

  if (session.telegram?.user) {
    for (const c of await telegramAdminChats(Number(session.telegram.user.id))) {
      communities.push({ key: `telegram:${c.id}`, platform: 'telegram', id: String(c.id), name: c.name });
    }
  }
  return { communities, invites };
}

let provider = liveAccess;
export const setAccessProvider = (fn) => { provider = fn || liveAccess; };

export async function getAccess(session) {
  const { communities, invites = [] } = await provider(session);
  return { communities, invites, keys: new Set(communities.map(c => c.key)) };
}
