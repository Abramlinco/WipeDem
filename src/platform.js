import * as tg from './telegram/bot.js';
import * as dc from './discord/bot.js';

// One place that knows how each platform performs an action. The API talks
// to this table only, which also lets the tests swap in fakes.
export const platforms = {
  telegram: {
    ban: tg.banTelegramUser,
    release: tg.releaseTelegramUser,
    caution: (community, user, text) => tg.cautionTelegramUser(community, user, text),
    admins: tg.getTelegramAdmins
  },
  discord: {
    ban: dc.banDiscordUser,
    release: dc.releaseDiscordUser,
    caution: (community, user, text, channelId) => dc.cautionDiscordUser(channelId, user, text),
    roles: dc.getGuildRoles
  }
};
