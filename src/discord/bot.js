import { Client, GatewayIntentBits, PermissionsBitField } from 'discord.js';
import { config } from '../config.js';
import { checkMessage, resolveAction, actionLabel, newAccountWithLink } from '../detection/detect.js';
import { captureMessage, noteReply, pulseDebug } from '../pulse/capture.js';
import {
  addAlert, addNetworkFlag, getNetworkHistory, getSettings, countStrikes,
  upsertCommunity, removeCommunity, addMemberEvent, bumpStat, addCaution
} from '../db.js';

let client = null;

export const discordEnabled = () => !!client;
export const botInGuild = (id) => !!client?.guilds.cache.has(id);

// A member is a real admin if Discord itself says they have the
// Administrator permission, or they hold a role the server's own admin
// ticked as trusted on the dashboard. A role's colour or name proves
// nothing, since anyone can copy those.
function isRealAdmin(member, settings) {
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  if (!settings?.adminRoleIds?.length) return false;
  return member.roles.cache.some(r => settings.adminRoleIds.includes(r.id));
}

export function startDiscordBot() {
  if (!config.discordToken) {
    console.log('[discord] No DISCORD_BOT_TOKEN set, skipping Discord bot.');
    return null;
  }

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers
    ]
  });

  const register = (g) => upsertCommunity({ platform: 'discord', id: g.id, name: g.name });

  client.once('ready', () => {
    console.log(`[discord] Logged in as ${client.user.tag}`);
    client.guilds.cache.forEach(register);
  });
  client.on('guildCreate', register);
  client.on('guildDelete', (g) => removeCommunity('discord', g.id));

  client.on('guildMemberAdd', (m) => {
    if (m.user.bot) return;
    addMemberEvent({ platform: 'discord', communityId: m.guild.id, communityName: m.guild.name, type: 'join', userId: m.id, username: m.user.username });
  });
  client.on('guildMemberRemove', (m) => {
    if (m.user?.bot) return;
    addMemberEvent({ platform: 'discord', communityId: m.guild.id, communityName: m.guild.name, type: 'leave', userId: m.id, username: m.user?.username || 'unknown' });
  });

  client.on('messageCreate', (message) => handleMessage(message));
  // Scammers also post something harmless and edit it into the scam later.
  client.on('messageUpdate', async (oldM, newM) => {
    if (newM.partial) newM = await newM.fetch().catch(() => null);
    if (!newM || (oldM.content != null && oldM.content === newM.content)) return;
    handleMessage(newM, true);
  });

  client.login(config.discordToken).catch(err => {
    console.error('[discord] failed to log in, check DISCORD_BOT_TOKEN and the Message Content and Server Members intents', err.message);
  });

  return client;
}

const inviteCache = new Map(); // guildId -> { at, codes }
async function ownInviteCodes(guild) {
  const c = inviteCache.get(guild.id);
  if (c && Date.now() - c.at < 300000) return c.codes;
  let codes = new Set();
  try {
    const invites = await guild.invites.fetch();
    codes = new Set(invites.map((i) => i.code.toLowerCase()));
    if (guild.vanityURLCode) codes.add(guild.vanityURLCode.toLowerCase());
  } catch {
    // The bot may not have Manage Server, in which case we simply cannot
    // tell the server's own invite apart from a foreign one, so every
    // Discord invite link gets flagged for a human to glance at.
  }
  inviteCache.set(guild.id, { at: Date.now(), codes });
  return codes;
}

async function handleMessage(message, isEdit = false) {
  try {
    if (!message.guild || message.author?.bot) return;
    const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!member) return;

    const guildId = message.guild.id;
    const key = `discord:${guildId}`;
    if (!isEdit) bumpStat(key, 'scanned');

    const settings = await getSettings('discord', guildId);
    const replyToId = message.reference?.messageId || '';
    if (isRealAdmin(member, settings)) {
      // A staff reply is how Pulse knows a question has been answered.
      if (replyToId) noteReply('discord', guildId, replyToId, true);
      // Staff are normally not read. PULSE_CAPTURE_STAFF=true is for testing with your own admin account.
      if (config.pulseCaptureStaff && !isEdit && message.channel.permissionsFor?.(message.guild.roles.everyone)?.has(PermissionsBitField.Flags.ViewChannel)) {
        captureMessage({
          settings, platform: 'discord', communityId: guildId, communityName: message.guild.name,
          channelId: message.channel.id, channelName: message.channel.name,
          userId: message.author.id, username: message.author.username,
          text: message.content, messageId: message.id, replyToId
        });
      } else {
        pulseDebug('discord', 'skipped: sender is an admin or owner (staff are not read)', message.author.username, message.content);
      }
      return;
    }

    let result = checkMessage(message.content, settings.rules, await ownInviteCodes(message.guild));

    // A link posted by a brand new account is treated as suspicious on its
    // own, even with no matching rule, the same signal dedicated Discord
    // security bots use. settings.rules.suspiciousLinks carries the penalty
    // to use, so this still respects whatever this community configured.
    if (!result.flagged && settings.rules.suspiciousLinks?.enabled) {
      const accountAgeDays = (Date.now() - member.user.createdTimestamp) / 86400000;
      if (newAccountWithLink(message.content, accountAgeDays)) {
        result = {
          flagged: true, ruleKey: 'suspiciousLinks', ruleLabel: 'Suspicious links',
          matchedPhrase: `posted a link within ${Math.round(accountAgeDays)} day(s) of the account existing`,
          penalty: settings.rules.suspiciousLinks.penalty
        };
      }
    }
    if (!result.flagged) {
      // A clean message. Pulse keeps it if it is an idea, question or concern.
      // Edits are skipped (the original was already read), and so are channels
      // that regular members cannot see, such as a private staff channel.
      if (!isEdit) {
        if (replyToId) noteReply('discord', guildId, replyToId, false);
        const everyoneSees = message.channel.permissionsFor?.(message.guild.roles.everyone)
          ?.has(PermissionsBitField.Flags.ViewChannel);
        if (!everyoneSees) pulseDebug('discord', 'skipped: channel is not visible to @everyone', message.author.username, message.content);
        if (everyoneSees) {
          captureMessage({
            settings, platform: 'discord', communityId: guildId, communityName: message.guild.name,
            channelId: message.channel.id, channelName: message.channel.name,
            userId: message.author.id, username: message.author.username,
            text: message.content, messageId: message.id, replyToId
          });
        }
      }
      return;
    }

    pulseDebug('discord', `skipped: flagged by the scam rule "${result.ruleLabel}"`, message.author.username, message.content);
    // Contain first, review after. Nobody is permanently banned without a human.
    await message.delete().catch(() => {});

    const history = await getNetworkHistory(message.author.id);
    const others = history.filter(h => !(h.platform === 'discord' && h.guildOrChatId === guildId));
    const knownElsewhere = others.length > 0;

    const strikes = (await countStrikes('discord', guildId, message.author.id, settings.strikeWindowDays)) + 1;
    // Someone already flagged in another community is treated as a known
    // scammer here, straight to a ban review, skipping the usual escalation
    // ladder entirely, whatever strike count they are actually on.
    const tier = knownElsewhere ? { action: 'flag_for_ban' } : resolveAction(strikes, settings.escalation, result.penalty);
    if (tier.action === 'mute') {
      await member.timeout(tier.minutes * 60 * 1000, `Sentinel: ${result.ruleLabel}`).catch(() => {});
    }
    if (result.ruleKey === 'suspiciousLinks') {
      // Always explain the no links policy, whatever else happens to the message.
      await cautionDiscordUser(message.channel.id, { userId: message.author.id }, settings.linkBlockedMessage).catch(() => {});
      await addCaution({ platform: 'discord', communityId: guildId, userId: message.author.id, username: message.author.username, by: 'auto' });
    } else if (tier.action === 'caution') {
      await cautionDiscordUser(message.channel.id, { userId: message.author.id }, settings.cautionMessage).catch(() => {});
      await addCaution({ platform: 'discord', communityId: guildId, userId: message.author.id, username: message.author.username, by: 'auto' });
    }

    await addAlert({
      platform: 'discord',
      guildId,
      guildName: message.guild.name,
      channelId: message.channel.id,
      channelName: message.channel.name || 'channel',
      userId: message.author.id,
      username: message.author.username,
      text: message.content,
      ruleKey: result.ruleKey,
      ruleLabel: result.ruleLabel,
      matchedPhrase: result.matchedPhrase,
      strikeCount: strikes,
      actionTaken: knownElsewhere ? 'flagged for ban review, already known on the network' : actionLabel(tier),
      seenElsewhere: knownElsewhere,
      networkCount: new Set(others.map(o => `${o.platform}:${o.guildOrChatId}`)).size
    });
    await addNetworkFlag(message.author.id, {
      platform: 'discord', guildOrChatId: guildId, guildOrChatName: message.guild.name,
      username: message.author.username, reason: result.ruleLabel
    });
    bumpStat(key, 'flagged');
  } catch (err) {
    console.error('[discord] error handling message', err.message);
  }
}

/* ------------- used by the dashboard ------------- */

// Does this person still manage this server right now? Asked live, so
// removing someone's admin rights in Discord removes their dashboard access.
const manageCache = new Map(); // "guild:user" -> { at, ok }
export async function discordUserStillManages(guildId, userId) {
  if (!client) return false;
  const k = `${guildId}:${userId}`;
  const c = manageCache.get(k);
  if (c && Date.now() - c.at < 60000) return c.ok;
  let ok = false;
  try {
    const guild = client.guilds.cache.get(guildId);
    const member = guild && await guild.members.fetch(userId);
    ok = !!member && (guild.ownerId === userId ||
      member.permissions.has(PermissionsBitField.Flags.Administrator) ||
      member.permissions.has(PermissionsBitField.Flags.ManageGuild));
  } catch { ok = false; }
  manageCache.set(k, { at: Date.now(), ok });
  return ok;
}

export function discordGuildName(id) {
  return client?.guilds.cache.get(id)?.name || null;
}

export function discordInviteUrl(guildId) {
  const perms = new PermissionsBitField([
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.ReadMessageHistory,
    PermissionsBitField.Flags.ManageMessages,
    PermissionsBitField.Flags.ModerateMembers,
    PermissionsBitField.Flags.BanMembers,
    PermissionsBitField.Flags.ManageGuild
  ]).bitfield.toString();
  const p = new URLSearchParams({
    client_id: config.discordClientId, scope: 'bot', permissions: perms,
    guild_id: guildId, disable_guild_select: 'true'
  });
  return `https://discord.com/oauth2/authorize?${p}`;
}

// No server preselected, so Discord shows the person its own picker listing
// every server where they can add a bot. Used for the first time "+" button,
// before we know which server they mean to protect.
export function discordGenericInviteUrl() {
  const perms = new PermissionsBitField([
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.ReadMessageHistory,
    PermissionsBitField.Flags.ManageMessages,
    PermissionsBitField.Flags.ModerateMembers,
    PermissionsBitField.Flags.BanMembers,
    PermissionsBitField.Flags.ManageGuild
  ]).bitfield.toString();
  const p = new URLSearchParams({ client_id: config.discordClientId, scope: 'bot', permissions: perms });
  return `https://discord.com/oauth2/authorize?${p}`;
}

export async function getGuildRoles(guildId) {
  const guild = client?.guilds.cache.get(guildId);
  if (!guild) return [];
  return [...guild.roles.cache.values()]
    .filter(r => r.id !== guild.id && !r.managed)
    .sort((a, b) => b.position - a.position)
    .map(r => ({ id: r.id, name: r.name, isAdmin: r.permissions.has(PermissionsBitField.Flags.Administrator) }));
}

export async function banDiscordUser(guildId, userId) {
  const guild = client?.guilds.cache.get(guildId);
  if (!guild) return false;
  await guild.members.ban(userId, { reason: 'Sentinel: confirmed impersonation or scam' }).catch(() => {});
  return true;
}

export async function releaseDiscordUser(guildId, userId) {
  const guild = client?.guilds.cache.get(guildId);
  if (!guild) return false;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (member) await member.timeout(null).catch(() => {});
  await guild.bans.remove(userId).catch(() => {});
  return true;
}

export async function cautionDiscordUser(channelId, { userId }, text) {
  if (!client || !channelId) return false;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (channel?.send) {
    await channel.send({ content: `<@${userId}> ${text}`, allowedMentions: { users: [userId] } }).catch(() => {});
  }
  return true;
}

export async function discordMemberCounts() {
  if (!client) return [];
  return [...client.guilds.cache.values()].map(g => ({ key: `discord:${g.id}`, count: g.memberCount }));
}

// Posts an approved reply as a real Discord reply to the member's message.
// allowedMentions stops a draft containing @everyone from pinging anyone.
export async function replyDiscord(guildId, channelId, messageId, text) {
  if (!client) return false;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.send || channel.guildId !== guildId) return false;
  const opts = { content: text.slice(0, 1900), allowedMentions: { parse: [], repliedUser: true } };
  const original = messageId ? await channel.messages?.fetch(messageId).catch(() => null) : null;
  if (original) await original.reply(opts); else await channel.send(opts);
  return true;
}

// Channels the bot can actually write in, for the "post to your community" picker.
// 0 is a normal text channel and 5 is an announcement channel.
export function listDiscordChannels(guildId) {
  const g = client?.guilds.cache.get(guildId);
  const me = g?.members.me;
  if (!g || !me) return [];
  return [...g.channels.cache.values()]
    .filter((c) => (c.type === 0 || c.type === 5) && c.permissionsFor(me)?.has([PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]))
    .map((c) => ({ id: c.id, name: c.name, position: c.rawPosition ?? 0 }))
    .sort((a, b) => a.position - b.position)
    .map(({ id, name }) => ({ id, name }));
}

// Posts an approved message in a channel. allowedMentions stops @everyone and @here from pinging anyone.
export async function postDiscord(guildId, channelId, text) {
  if (!client) return false;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.send || channel.guildId !== guildId) return false;
  await channel.send({ content: text.slice(0, 1900), allowedMentions: { parse: [] } });
  return true;
}
