import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config.js';
import { checkMessage, resolveAction, actionLabel } from '../detection/detect.js';
import { captureMessage, noteReply, pulseDebug } from '../pulse/capture.js';
import {
  addAlert, addNetworkFlag, getNetworkHistory, getSettings, countStrikes,
  upsertCommunity, removeCommunity, listCommunities, addMemberEvent, bumpStat, addCaution
} from '../db.js';
import { completeTelegramLogin, loginChoices, cancelLogin } from '../auth/telegramLogin.js';

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

// A link hidden behind a word ("click here") keeps its real address in the message entities. Scan those too.
function withLinkTargets(msg, text) {
  const hidden = [...(msg.entities || []), ...(msg.caption_entities || [])]
    .filter(e => e.type === 'text_link' && e.url).map(e => e.url);
  return hidden.length ? `${text}\n${hidden.join('\n')}` : text;
}

export function startTelegramBot() {
  if (!config.telegramToken) {
    console.log('[telegram] No TELEGRAM_BOT_TOKEN set, skipping Telegram bot.');
    return null;
  }

  bot = new TelegramBot(config.telegramToken, { polling: true });
  bot.getMe().then(me => { botUsername = me.username; }).catch(err =>
    console.error('[telegram] could not read bot username, check TELEGRAM_BOT_TOKEN', err.message));

  // Sign in to the dashboard: the link carries a one time code.
  // Pressing Start is not enough to sign in. The person must tap the number shown on the dashboard screen in
  // front of them, so a link forwarded by someone else cannot sign them in as an admin.
  bot.onText(/^\/start login_([a-f0-9]{24})$/, (msg, match) => {
    if (msg.chat.type !== 'private') return;
    const choices = loginChoices(match[1]);
    if (!choices) {
      return bot.sendMessage(msg.chat.id, 'That sign in link has expired. Go back to the dashboard and start again.').catch(() => {});
    }
    const row = choices.map(n => ({ text: String(n), callback_data: `lg:${match[1]}:${n}` }));
    bot.sendMessage(msg.chat.id,
      '⚠️ Someone is signing in to the Sentinel dashboard with your Telegram account.\n\n' +
      'Only continue if YOU just started this, on the screen in front of you. Tap the number that screen shows.\n\n' +
      'If someone sent you this link, or you see no number, tap "This was not me".',
      { reply_markup: { inline_keyboard: [row, [{ text: 'This was not me', callback_data: `lg:${match[1]}:no` }]] } }
    ).catch(() => {});
  });

  bot.on('callback_query', async (q) => {
    try {
      const m = /^lg:([a-f0-9]{24}):(\d{2}|no)$/.exec(q.data || '');
      if (!m || q.message?.chat?.type !== 'private') return await bot.answerCallbackQuery(q.id).catch(() => {});
      const ok = m[2] !== 'no' && completeTelegramLogin(m[1], q.from, Number(m[2]));
      if (!ok) cancelLogin(m[1]); // a wrong tap or a refusal kills the code, so it cannot be guessed
      await bot.answerCallbackQuery(q.id, { text: ok ? 'Signed in' : 'Sign in cancelled' }).catch(() => {});
      await bot.editMessageText(ok
        ? 'You are signed in. Go back to the Sentinel dashboard, it will open by itself.'
        : 'Sign in cancelled. Nothing was shared. If you want to sign in, go back to the dashboard and start again.',
        { chat_id: q.message.chat.id, message_id: q.message.message_id }).catch(() => {});
    } catch (err) { console.error('[telegram] sign in confirm error', err.message); }
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

  bot.on('message', (msg) => handleMessage(msg));
  // Scammers post something harmless, then edit it into the scam. Check edits too.
  bot.on('edited_message', (msg) => handleMessage(msg, true));
  bot.on('polling_error', (err) => console.error('[telegram] polling error', err.message));

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

    const body = msg.text || msg.caption; // photos and videos carry their words in the caption
    if (!body || !msg.from || msg.from.is_bot) return;
    if (msg.from.id === GROUP_ANONYMOUS_BOT_ID || msg.is_automatic_forward) return;

    if (!isEdit) bumpStat(key, 'scanned');
    const userId = msg.from.id;

    // In groups with topics, every post "replies" to the topic's first
    // message, which says nothing about the person being answered.
    const parent = msg.reply_to_message && !msg.reply_to_message.forum_topic_created ? msg.reply_to_message.message_id : '';

    const adminIds = await getAdminIds(chatId);
    if (adminIds.has(userId)) {
      // A staff reply is how Pulse knows a question has been answered.
      if (parent) noteReply('telegram', communityId, parent, true, body || msg.caption || '');
      // Staff are normally not read. PULSE_CAPTURE_STAFF=true is for testing with your own admin account.
      if (config.pulseCaptureStaff && !isEdit) {
        captureMessage({
          settings: await getSettings('telegram', communityId), platform: 'telegram', communityId, communityName: msg.chat.title || 'Group',
          channelId: communityId, channelName: msg.chat.title || 'Group',
          userId, username: displayName(msg.from), text: body, messageId: msg.message_id, replyToId: parent
        });
      } else {
        pulseDebug('telegram', 'skipped: sender is an admin or owner (staff are not read)', displayName(msg.from), body);
      }
      return; // real admins (by ID) can say anything
    }

    const settings = await getSettings('telegram', communityId);
    const result = checkMessage(withLinkTargets(msg, body), settings.rules);
    if (result.flagged) pulseDebug('telegram', `skipped: flagged by the scam rule "${result.ruleLabel}"`, displayName(msg.from), body);
    if (!result.flagged) {
      // A clean message. Pulse keeps it if it is an idea, question or concern.
      if (!isEdit) {
        if (parent) noteReply('telegram', communityId, parent, false);
        captureMessage({
          settings, platform: 'telegram', communityId, communityName: msg.chat.title || 'Group',
          channelId: communityId, channelName: msg.chat.title || 'Group',
          userId, username: displayName(msg.from), text: body, messageId: msg.message_id, replyToId: parent
        });
      }
      return;
    }

    // Contain first, review after. Nobody is permanently banned without a human.
    await bot.deleteMessage(chatId, msg.message_id).catch(() => {});

    const history = await getNetworkHistory(userId);
    const others = history.filter(h => !(h.platform === 'telegram' && h.guildOrChatId === communityId));
    const knownElsewhere = others.length > 0;

    const strikes = (await countStrikes('telegram', communityId, userId, settings.strikeWindowDays)) + 1;
    // Someone already flagged in another community is treated as a known
    // scammer here, straight to a ban review, skipping the usual escalation
    // ladder entirely, whatever strike count they are actually on.
    const tier = knownElsewhere ? { action: 'flag_for_ban' } : resolveAction(strikes, settings.escalation, result.penalty);
    let muteFailed = false;
    if (tier.action === 'mute') {
      // The Bot API wants a permissions object (sent as JSON), not a bare can_send_messages flag.
      await bot.restrictChatMember(chatId, userId, {
        permissions: JSON.stringify({ can_send_messages: false }),
        until_date: Math.floor(Date.now() / 1000) + tier.minutes * 60
      }).catch((err) => { muteFailed = true; console.error('[telegram] could not mute', userId, err.message); });
    }
    if (result.ruleKey === 'suspiciousLinks') {
      // Always explain the no links policy, whatever else happens to the message.
      await cautionTelegramUser(chatId, { userId, username: displayName(msg.from) }, settings.linkBlockedMessage).catch(() => {});
      await addCaution({ platform: 'telegram', communityId, userId: String(userId), username: displayName(msg.from), by: 'auto' });
    } else if (tier.action === 'caution') {
      await cautionTelegramUser(chatId, { userId, username: displayName(msg.from) }, settings.cautionMessage).catch(() => {});
      await addCaution({ platform: 'telegram', communityId, userId: String(userId), username: displayName(msg.from), by: 'auto' });
    }

    await addAlert({
      platform: 'telegram',
      guildId: communityId,
      guildName: msg.chat.title || 'Group',
      channelId: communityId,
      channelName: msg.chat.title || 'Group',
      userId: String(userId),
      username: displayName(msg.from),
      text: body,
      ruleKey: result.ruleKey,
      ruleLabel: result.ruleLabel,
      matchedPhrase: result.matchedPhrase,
      strikeCount: strikes,
      actionTaken: knownElsewhere ? 'flagged for ban review, already known on the network' : actionLabel(tier) + (muteFailed ? ' (the mute FAILED: check the bot can restrict members)' : ''),
      seenElsewhere: knownElsewhere,
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
  if (chats.length) adminChatCache.set(userId, { at: Date.now(), chats }); // only remember a non-empty answer
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
  try { await bot.banChatMember(chatId, userId); }
  catch (err) { console.error('[telegram] ban failed', err.message); return false; }
  return true;
}

// Put the person back to the group's normal permissions.
export async function releaseTelegramUser(chatId, userId) {
  if (!bot) return false;
  const chat = await bot.getChat(chatId).catch(() => null);
  const perms = chat?.permissions || { can_send_messages: true };
  // Either step working is enough (a banned person cannot be restricted, a muted one is not banned).
  let restored = false, unbanned = false;
  await bot.restrictChatMember(chatId, userId, { permissions: JSON.stringify(perms) }).then(() => { restored = true; }).catch(() => {});
  await bot.unbanChatMember(chatId, userId, { only_if_banned: true }).then(() => { unbanned = true; }).catch(() => {});
  if (!restored && !unbanned) console.error('[telegram] release failed for', userId);
  return restored || unbanned;
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

// Posts an approved reply as a real Telegram reply. Sent as plain text, so
// nothing in the draft can be read as formatting or a hidden link.
export async function replyTelegram(chatId, messageId, text) {
  if (!bot) return false;
  const opts = messageId ? { reply_to_message_id: Number(messageId), allow_sending_without_reply: true } : {};
  await bot.sendMessage(chatId, text.slice(0, 3900), opts);
  return true;
}

// Posts an approved message in the group. Sent as plain text, so nothing in it can be read as formatting.
export async function postTelegram(chatId, text) {
  if (!bot) return false;
  await bot.sendMessage(chatId, text.slice(0, 3900));
  return true;
}
// notify-patch: a private message to a manager (phone alert). Telegram only allows this after the person has pressed Start on the bot, which signing in already needs.
export async function sendTelegramDm(userId, text) {
  if (!bot) throw new Error('The Telegram bot is not running.');
  await bot.sendMessage(Number(userId), String(text).slice(0, 3900), { disable_web_page_preview: true });
}
