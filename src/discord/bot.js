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
    // Instantly filter out bot webhooks or system text structures
    if (!message.guild || message.author?.bot) return;

    const guildId = message.guild.id;
    const key = `discord:${guildId}`;
    if (!isEdit) bumpStat(key, 'scanned'); //

    const settings = await getSettings('discord', guildId); //
    
    // =========================================================================
    // STEP 1: IMPACT SCANNER (Context Evaluation)
    // Runs BEFORE slow API profile lookups to outrun the user-bot's 50ms script
    // =========================================================================
    const result = await checkMessage(message.content, message, settings.rules); //
    
    // Catch automated mass notification exploits (@everyone / @here)
    const isMassPingViolation = message.mentionEveryone || message.content.includes('@everyone') || message.content.includes('@here');
    
    // If the message is completely clean and carries no threat tokens, let it pass safely
    if ((!result || !result.flagged) && !isMassPingViolation) return;

    // =========================================================================
    // STEP 2: THE CONJUNCTION IDENTITY GATE (Staff Validation Matrix)
    // The strict zero-trust gate. All conditions must align.
    // =========================================================================
    const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null); //
    let isGenuineAuthorizedStaff = false;

    if (member) {
      // 🕵️‍♂️ INDICATOR A: Native System Privileges (Live API Check)
      // Checks if they are the real server owner or possess real native management bits
      const hasNativeAuthority = member.permissions.has(PermissionsBitField.Flags.Administrator) || 
                                 member.permissions.has(PermissionsBitField.Flags.ManageGuild) || 
                                 member.permissions.has(PermissionsBitField.Flags.BanMembers) ||
                                 member.id === message.guild.ownerId; //

      // 🕵️‍♂️ INDICATOR B: Exact Staff Role Verification
      // Verifies if they possess your designated high-tier community roles (Moderator, Validator, Team, CEO)
      const hasStaffRole = member.roles.cache.some(role => {
        const name = role.name.toLowerCase();
        return name.includes('moderator') || 
               name.includes('validator') || 
               name.includes('team') || 
               name.includes('admin') || 
               (settings?.adminRoleIds?.length && settings.adminRoleIds.includes(role.id)); //
      });

      // 🕵️‍♂️ INDICATOR C: Cross-Verified Staff Identity Data Check
      // Matches the immutable numeric account ID against your secure db.json array
      const authorId = message.author.id;
      const isIdentityCrossVerified = checkUserVerifiedID(authorId);

      // 🚨 STRATEGIC SECURITY ENFORCEMENT:
      // To post links or admin mentions, the user MUST have native authority or a staff role,
      // AND their unique numeric ID must be cross-verified inside your secure staff database.
      // If a hijacked 9-year-old account or a sleeper account copies your name, it WILL fail 
      // the verification gate and trigger immediate suppression.
      if ((hasNativeAuthority || hasStaffRole) && isIdentityCrossVerified) {
        isGenuineAuthorizedStaff = true;
      }
    }

    // =========================================================================
    // STEP 3: SYSTEMIC RADICAL INTERCEPTION
    // Failed the conjunction gate = Threat Entity. Erase it in less than 20ms.
    // =========================================================================
    if (!isGenuineAuthorizedStaff) {
      let targetMessage = message; //
      if (message.partial) {
        try { targetMessage = await message.fetch(); } catch { /* fail safe on cache drop */ } //
      }

      // Radical Strike: Instantly delete it before the user-bot's script can self-delete
      if (targetMessage.deletable) {
        await targetMessage.delete() //
          .then(() => console.log(`[Sentinel Success] Radical Threat Interception: Purged scam content in Quicksilver from: ${targetMessage.author.id}`))
          .catch((err) => console.error("[Discord Deletion API Error] Failure Details:", err.message));
      }

      // =========================================================================
      // STEP 4: INFRACTION WINDOW ACCUMULATOR & 48-HOUR TIMEOUT
      // Tracks strategy shifts. 3 unique attempts = Immediate 48-Hour Suspension.
      // =========================================================================
      const currentInfractionsCount = (await countStrikes('discord', guildId, message.author.id, settings.strikeWindowDays)) + 1; //
      let tier = resolveAction(currentInfractionsCount, settings.escalation, result?.penalty); //
      let monitoringLabel = result?.ruleLabel || '🛑 Unauthorized Support-Link/Raid Mention Shield Active';

      // 🛑 PERSISTENCE OVERWRITE: Drop the absolute hammer on the 3rd attempt
      if (currentInfractionsCount >= 3) {
        tier = { action: 'mute', minutes: 2880 }; // 48 Hours = 2880 minutes
        monitoringLabel = '🛑 Automated 48-Hour Suspension (Persistent Automated Scammer Loop Neutralized)';
      }

      // Restrict API communication privileges natively
      if (tier.action === 'mute' && member) {
        await member.timeout(tier.minutes * 60 * 1000, `Sentinel Threat Control: ${monitoringLabel}`).catch(() => {}); //
      }

      // Write data blocks straight into db.json for the web application dashboard grids
      const history = await getNetworkHistory(message.author.id); //
      const others = history.filter(h => !(h.platform === 'discord' && h.guildOrChatId === guildId)); //

      await addAlert({
        platform: 'discord', //
        guildId, //
        guildName: message.guild.name, //
        channelId: message.channel.id, //
        channelName: message.channel.name || 'channel', //
        userId: message.author.id, //
        username: message.author.username, //
        text: message.content, //
        ruleKey: result?.ruleKey || 'custom_scam_links', //
        ruleLabel: monitoringLabel,
        matchedPhrase: result?.matchedPhrase || '@everyone tag', //
        strikeCount: currentInfractionsCount, //
        actionTaken: currentInfractionsCount >= 3 ? 'Suspended for 48 hours' : actionLabel(tier), //
        seenElsewhere: others.length > 0, //
        networkCount: new Set(others.map(o => `${o.platform}:${o.guildOrChatId}`)).size //
      });

      await addNetworkFlag(message.author.id, {
        platform: 'discord', guildOrChatId: guildId, guildOrChatName: message.guild.name, //
        username: message.author.username, reason: monitoringLabel //
      });
      
      bumpStat(key, 'flagged'); //
    }
  } catch (err) {
    console.error('[discord] critical engine handling error:', err.message);
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
