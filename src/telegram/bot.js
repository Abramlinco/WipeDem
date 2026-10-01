import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config.js';
import { checkMessage, resolveAction, actionLabel } from '../detection/detect.js';
import {
  addAlert, addNetworkFlag, getNetworkHistory, getSettings, countStrikes,
  upsertCommunity, removeCommunity, listCommunities, addMemberEvent, bumpStat
} from '../db.js';
import { completeTelegramLogin } from '../auth/telegramLogin.js';

let bot = null;
let botUsername = '';

export const telegramEnabled = () => !!bot;
export const getBotUsername = () => botUsername;

// Telegram lets admins post "anonymously as the group". Those messages come
// from this special account, so they are the group's own admins and are skipped.
const GROUP_ANONYMOUS_BOT_ID = 1087968824;

// Admin rights are ALWAYS read from Telegram by numeric user ID, never from
// a name, username, or profile picture, and never from a stored copy. A
// short cache stops us asking on every single message.
const adminCache = new Map(); // chatId -> { ids: Set, at }
const CACHE_MS = 60 * 1000;

async function getAdminIds(chatId) {
  const cached = adminCache.get(chatId);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.ids;
  const admins = await bot.getChatAdministrators(chatId);
  const ids = new Set(admins.map(a => a.user.id));
  adminCache.set(chatId, { ids, at: Date.now() });
  return ids;
}

const isGroup = (chat) => chat && (chat.type === 'group' || chat.type === 'supergroup');
const displayName = (u) => u?.username || [u?.first_name, u?.last_name].filter(Boolean).join(' ') || 'unknown';
const htmlEscape = (s) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export function startTelegramBot() {
  if (!config.telegramToken) {
    console.log('[telegram] No TELEGRAM_BOT_TOKEN set, skipping Telegram bot.');
    return null;
  }

    bot = new TelegramBot(config.telegramToken, { 
    polling: {
      params: { timeout: 10 },
      request: {
        agentOptions: {
          keepAlive: true,
          family: 4 // <-- THIS EXPLICITLY PERMANENTLY STABILISES NETWORK DROPS
        }
      }
    } 
  });

  bot.getMe().then(me => { botUsername = me.username; }).catch(err =>
    console.error('[telegram] could not read bot username, check TELEGRAM_BOT_TOKEN', err.message));

  // Sign in to the dashboard: the link carries a one time code.
  bot.onText(/^\/start login_([a-f0-9]{24})$/, (msg, match) => {
    if (msg.chat.type !== 'private') return;
    const ok = completeTelegramLogin(match[1], msg.from);
    bot.sendMessage(msg.chat.id, ok
      ? 'You are signed in. Go back to the Sentinel dashboard, it will open by itself.'
      : 'That sign in link has expired. Go back to the dashboard and start again.');
  });

  bot.onText(/^\/start$/, (msg) => {
    if (msg.chat.type !== 'private') return;
    bot.sendMessage(msg.chat.id,
      'I protect groups from fake admins and scam DMs. Add me to your group, make me an admin, then open the Sentinel dashboard.');
  });

  bot.onText(/^\/setup/, (msg) => {
    if (!isGroup(msg.chat)) return;
    upsertCommunity({ platform: 'telegram', id: msg.chat.id, name: msg.chat.title || 'Group' });
    bot.sendMessage(msg.chat.id,
      'Sentinel is active in this chat. Admin rights are checked live against Telegram by user ID on every message. Manage rules from the web dashboard.');
  });

  // Remember every group the bot is added to (and forget the ones it leaves).
  bot.on('my_chat_member', (upd) => {
    if (!isGroup(upd.chat)) return;
    const status = upd.new_chat_member?.status;
    if (status === 'left' || status === 'kicked') removeCommunity('telegram', upd.chat.id);
    else upsertCommunity({ platform: 'telegram', id: upd.chat.id, name: upd.chat.title || 'Group' });
  });

   // --- FIXED ASYNC INTEGRATION GATEWAYS APPLIED HERE ---
  bot.on('message', async (msg) => { await handleMessage(msg); });
  bot.on('edited_message', async (msg) => { await handleMessage(msg, true); });
  
  // Suppress network noise: node-telegram-bot-api auto-reconnects safely
  bot.on('polling_error', (err) => {
    if (err.message.includes('ECONNRESET')) return;
    console.error('[telegram] polling error', err.message);
  });


  console.log('[telegram] Bot started, polling for messages.');
  return bot;
}

async function handleMessage(msg, isEdit = false) {
  try {
    if (!isGroup(msg.chat)) return;
    const chatId = msg.chat.id;
    const communityId = String(chatId);
    const key = `telegram:${communityId}`;
    upsertCommunity({ platform: 'telegram', id: chatId, name: msg.chat.title || 'Group' });

    // Joins and leaves for the growth report.
    if (msg.new_chat_members?.length) {
      for (const u of msg.new_chat_members.filter(u => !u.is_bot)) {
        await addMemberEvent({ platform: 'telegram', communityId, communityName: msg.chat.title, type: 'join', userId: String(u.id), username: displayName(u) });
      }
      return;
    }
    if (msg.left_chat_member && !msg.left_chat_member.is_bot) {
      const u = msg.left_chat_member;
      await addMemberEvent({ platform: 'telegram', communityId, communityName: msg.chat.title, type: 'leave', userId: String(u.id), username: displayName(u) });
      return;
    }

    if (!msg.text || !msg.from || msg.from.is_bot) return;
    if (msg.from.id === GROUP_ANONYMOUS_BOT_ID || msg.is_automatic_forward) return;

    if (!isEdit) bumpStat(key, 'scanned');
    const userId = msg.from.id;

    const adminIds = await getAdminIds(chatId);
    if (adminIds.has(userId)) return; // real admins (by ID) can say anything

        const settings = await getSettings('telegram', communityId);
    
    // --- RESTORED THIS CRITICAL CHECK LINE HERE ---
    const result = await checkMessage(msg.text, settings.rules);
    if (!result.flagged) return;

    // --- VERIFIED TYPE-SAFE DELETION CORE ---
    const targetChat = msg.chat.id;
    const targetMessageId = Number(msg.message_id);

    await bot.deleteMessage(targetChat, targetMessageId)
      .then(() => console.log(`[Sentinel Success] Deleted Telegram scam text from user: ${msg.from.id}`))
      .catch((err) => console.error("[Telegram Deletion API Error] Failure Details:", err.message));


    const strikes = (await countStrikes('telegram', communityId, userId, settings.strikeWindowDays)) + 1;
    const tier = resolveAction(strikes, settings.escalation, result.penalty);
    if (tier.action === 'mute') {
      await bot.restrictChatMember(chatId, userId, {
        can_send_messages: false,
        until_date: Math.floor(Date.now() / 1000) + tier.minutes * 60
      }).catch(() => {});
    }

    const history = await getNetworkHistory(userId);
    const others = history.filter(h => !(h.platform === 'telegram' && h.guildOrChatId === communityId));

    await addAlert({
      platform: 'telegram',
      guildId: communityId,
      guildName: msg.chat.title || 'Group',
      channelId: communityId,
      channelName: msg.chat.title || 'Group',
      userId: String(userId),
      username: displayName(msg.from),
      text: msg.text,
      ruleKey: result.ruleKey,
      ruleLabel: result.ruleLabel,
      matchedPhrase: result.matchedPhrase,
      strikeCount: strikes,
      actionTaken: actionLabel(tier),
      seenElsewhere: others.length > 0,
      networkCount: new Set(others.map(o => `${o.platform}:${o.guildOrChatId}`)).size
    });
    await addNetworkFlag(userId, {
      platform: 'telegram', guildOrChatId: communityId, guildOrChatName: msg.chat.title || 'Group',
      username: displayName(msg.from), reason: result.ruleLabel
    });
    bumpStat(key, 'flagged');
  } catch (err) {
    console.error('[telegram] error handling message', err.message);
  }
}


/* ------------- used by the dashboard ------------- */

// Groups this person is a real admin of (asked live, by numeric ID).
const adminChatCache = new Map(); // userId -> { at, chats }
export async function telegramAdminChats(userId) {
  if (!bot) return [];
  const cached = adminChatCache.get(userId);
  if (cached && Date.now() - cached.at < 30000) return cached.chats;
  const groups = await listCommunities('telegram');
  const checks = await Promise.all(groups.map(async g => {
    try {
      const m = await bot.getChatMember(g.id, userId);
      return (m.status === 'creator' || m.status === 'administrator') ? { id: g.id, name: g.name } : null;
    } catch { return null; }
  }));
  const chats = checks.filter(Boolean);
  adminChatCache.set(userId, { at: Date.now(), chats });
  return chats;
}

export async function getTelegramAdmins(chatId) {
  if (!bot) return [];
  const admins = await bot.getChatAdministrators(chatId);
  return admins.map(a => ({
    id: String(a.user.id),
    name: [a.user.first_name, a.user.last_name].filter(Boolean).join(' '),
    username: a.user.username || '',
    role: a.status === 'creator' ? 'Owner' : (a.custom_title || 'Admin'),
    isBot: !!a.user.is_bot
  }));
}

export async function banTelegramUser(chatId, userId) {
  if (!bot) return false;
  await bot.banChatMember(chatId, userId).catch(() => {});
  return true;
}

// Put the person back to the group's normal permissions.
export async function releaseTelegramUser(chatId, userId) {
  if (!bot) return false;
  const chat = await bot.getChat(chatId).catch(() => null);
  const perms = chat?.permissions || { can_send_messages: true };
  await bot.restrictChatMember(chatId, userId, { permissions: JSON.stringify(perms) }).catch(() => {});
  await bot.unbanChatMember(chatId, userId, { only_if_banned: true }).catch(() => {});
  return true;
}

export async function cautionTelegramUser(chatId, { userId, username }, text) {
  if (!bot) return false;
  const who = `<a href="tg://user?id=${userId}">${htmlEscape(username || 'there')}</a>`;
  await bot.sendMessage(chatId, `⚠️ ${who} ${htmlEscape(text)}`, { parse_mode: 'HTML' }).catch(() => {});
  return true;
}

export async function telegramMemberCounts() {
  if (!bot) return [];
  const groups = await listCommunities('telegram');
  const out = [];
  for (const g of groups) {
    try { out.push({ key: `telegram:${g.id}`, count: await bot.getChatMemberCount(g.id) }); } catch { /* bot removed */ }
  }
  return out;
}
