import { Client, GatewayIntentBits, PermissionsBitField } from 'discord.js';
import { config } from '../config.js';
import { checkMessage, resolveAction, actionLabel } from '../detection/detect.js';
import {
  addAlert, addNetworkFlag, getNetworkHistory, getSettings, countStrikes,
  upsertCommunity, removeCommunity, addMemberEvent, bumpStat
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

  client.once('clientready', () => {
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

async function handleMessage(message, isEdit = false) {
  try {
    if (!message.guild || message.author?.bot) return;
    const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!member) return;

    const guildId = message.guild.id;
    const key = `discord:${guildId}`;
    if (!isEdit) bumpStat(key, 'scanned');

    const settings = await getSettings('discord', guildId);
    if (isRealAdmin(member, settings)) return;

    // --- FIX APPLIED HERE: Added 'await' for the asynchronous db.json checker ---
    const result = await checkMessage(message.content, message, settings.rules);
    if (!result.flagged) return;

    // --- FIX APPLIED HERE ---
    // 1. If it's a partial or uncached message structure, fetch the full content so we can manipulate it
    let targetMessage = message;
    if (message.partial) {
      try {
        targetMessage = await message.fetch();
      } catch (fetchError) {
        console.error("[Sentinel Cache Alert] Failed to fetch full message structure:", fetchError);
      }
    }

    // 2. Perform the deletion with active console error reporting instead of hiding it
    if (targetMessage.deletable) {
      await targetMessage.delete()
        .then(() => console.log(`[Sentinel Success] Deleted scam text from user: ${targetMessage.author.id}`))
        .catch((err) => console.error("[Discord Deletion API Error] Active Failure:", err.message));
    } else {
      console.log(`[Sentinel Alert] Message from ${targetMessage.author?.id} flagged, but Bot client lacks systemic authority to delete it.`);
    }
    // --- END OF FIX ---

    const strikes = (await countStrikes('discord', guildId, message.author.id, settings.strikeWindowDays)) + 1;
    const tier = resolveAction(strikes, settings.escalation, result.penalty);
    if (tier.action === 'mute') {
      await member.timeout(tier.minutes * 60 * 1000, `Sentinel: ${result.ruleLabel}`).catch(() => {});
    }

    const history = await getNetworkHistory(message.author.id);
    const others = history.filter(h => !(h.platform === 'discord' && h.guildOrChatId === guildId));

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
      actionTaken: actionLabel(tier),
      seenElsewhere: others.length > 0,
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
    PermissionsBitField.Flags.BanMembers
  ]).bitfield.toString();
  const p = new URLSearchParams({
    client_id: config.discordClientId, scope: 'bot', permissions: perms,
    guild_id: guildId, disable_guild_select: 'true'
  });
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
  if (!member) return false;
  return true;
}

// --- EXPLICITLY SEPARATED BY PARSER BOUNDARIES ---
export function discordMemberCounts() {
  if (!client) return {};
  const counts = {};
  client.guilds.cache.forEach(g => {
    counts[g.id] = g.memberCount || 0;
  });
  return counts;
}
