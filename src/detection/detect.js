// Rules are lists of plain phrases a community manager types in. No regex
// knowledge needed. Matching is case insensitive, ignores extra spaces,
// treats phone keyboard curly apostrophes (I’m) the same as straight ones
// (I'm), and only matches whole words, so "dm me" never fires on a word
// that merely contains those letters.

const norm = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[\u2018\u2019\u02BC\u0060\u00B4]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cache = new Map();

function phraseRegex(phrase) {
  const p = norm(phrase);
  if (!p) return null;
  let re = cache.get(p);
  if (!re) {
    re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(p).replace(/ /g, '\\s+')}($|[^\\p{L}\\p{N}])`, 'u');
    cache.set(p, re);
  }
  return re;
}

const URL_RE = /\b((?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?)/i;
// URL_RE has no g flag on purpose: .test() on a global regex remembers where it stopped (lastIndex)
// and the next message would be searched from that spot. This copy is only used with matchAll.
const URL_RE_ALL = new RegExp(URL_RE.source, 'gi');
const KNOWN_SHORTENERS = new Set([
  'bit.ly', 'tinyurl.com', 'cutt.ly', 'is.gd', 'rebrand.ly', 'shorturl.at',
  'tiny.cc', 'rb.gy', 'buff.ly', 't.co', 'ow.ly', 'shrtco.de', 'v.gd', 'lnkd.in'
]);
// A Discord invite to somewhere else is one of the most common raid bot and
// phishing patterns there is, an account auto replies to ordinary chat
// with "continue the conversation here" and a link to a cloned server.
// An ordinary member almost never has a legitimate reason to post an
// invite to a different server, so this is checked unconditionally,
// without needing a keyword list at all.
const INVITE_RE = /discord(?:app\.com|\.com|\.gg)\/(?:invite\/)?([a-z0-9-]{2,32})/i;

function domainOf(url) {
  try { return new URL(url.startsWith('http') ? url : `http://${url}`).hostname.toLowerCase(); }
  catch { return null; }
}

// The domain itself is often ordinary looking and tells you nothing, a
// scam site rarely advertises itself. The far more reliable signal is the
// behavior around it, someone pushing a link at a person who never asked
// for one. Any of these phrases next to any link at all is treated as
// suspicious, regardless of what the link's domain happens to be.
const PUSH_PHRASES = [
  'send me this link', 'send you this link', 'send me the link', 'here is the link',
  "here's the link", 'click this link', 'click here', 'apply here', 'claim here',
  'verify here', 'use this link', 'follow this link'
];
function hasPushPhrase(t) {
  return PUSH_PHRASES.some((p) => phraseRegex(p)?.test(t));
}

// Signals that need no keyword list at all, so a brand new scam domain
// posted for the first time is still caught: an invite to a different
// Discord server, a raw IP address instead of a name, a punycode domain
// (used to fake a familiar looking name with foreign lookalike letters),
// or a known link shortener, which hides the real destination until
// someone has already clicked it.
function linkRisk(text, ownInviteCodes, strictMode) {
  const invite = text.match(INVITE_RE);
  if (invite && !(ownInviteCodes && ownInviteCodes.has(invite[1].toLowerCase()))) {
    return { url: invite[0], why: 'invites to a different Discord server, a common raid and phishing tactic' };
  }
  const matches = findLinks(text);
  if (!matches.length) return null;

  // Strict mode, the default, treats any link at all from a non admin as
  // not allowed, the policy being nobody but your own team should be
  // dropping links in chat. No domain reputation guessing needed.
  if (strictMode) {
    return { url: matches[0], why: 'links are reserved for admins and moderators here' };
  }

  const t = norm(text);
  if (hasPushPhrase(t)) {
    return { url: matches[0], why: 'pushes a link at someone who never asked for one' };
  }
  for (const url of matches) {
    const host = domainOf(url);
    if (!host) continue;
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) return { url, why: 'links straight to a numeric address, not a real domain' };
    if (host.startsWith('xn--') || host.includes('.xn--')) return { url, why: 'uses a disguised domain name' };
    if (KNOWN_SHORTENERS.has(host)) return { url, why: 'uses a link shortener that hides the real destination' };
  }
  return null;
}

/**
 * Check a message against one community's rules. Only ever called for people
 * who are NOT on the real, live admin list. Real admins are never checked.
 * ownInviteCodes, Discord only, is the set of this server's own invite
 * codes, so a link back to the server itself is never wrongly flagged.
 */
export function checkMessage(text, rules, ownInviteCodes) {
  if (!text || typeof text !== 'string') return { flagged: false };
  const t = norm(text);
  for (const [key, rule] of Object.entries(rules || {})) {
    if (!rule?.enabled) continue;
    for (const phrase of rule.keywords || []) {
      const re = phraseRegex(phrase);
      if (re && re.test(t)) {
        return { flagged: true, ruleKey: key, ruleLabel: rule.label, matchedPhrase: phrase, penalty: rule.penalty };
      }
    }
    if (key === 'suspiciousLinks') {
      const risk = linkRisk(text, ownInviteCodes, rule.strictMode);
      if (risk) {
        return { flagged: true, ruleKey: key, ruleLabel: rule.label, matchedPhrase: `${risk.url} (${risk.why})`, penalty: rule.penalty };
      }
    }
  }
  return { flagged: false };
}

// A link from an account created in the last few days is a much stronger
// signal than the same link from someone with real history in the
// community, the same "new member link lockdown" idea used by dedicated
// Discord security bots. Telegram does not expose account creation dates,
// so this only applies where accountAgeDays is actually known.
export function newAccountWithLink(text, accountAgeDays, maxDays = 3) {
  if (accountAgeDays === null || accountAgeDays === undefined) return false;
  if (accountAgeDays > maxDays) return false;
  // (URL_RE is a global regex, so calling .test() on it remembers its position and misses later links.)
  return findLinks(text).length > 0 || INVITE_RE.test(text);
}

const MAX_MINUTES = 40320; // 28 days, the longest Discord allows
export const clampMinutes = (m) => Math.min(Math.max(Math.round(Number(m) || 10), 1), MAX_MINUTES);

/** Tier reached for this many strikes, using the community's own tiers. */
export function resolveEscalation(strikeCount, escalation) {
  const tiers = [escalation?.tier1, escalation?.tier2, escalation?.tier3]
    .filter(t => t && t.count > 0)
    .sort((a, b) => b.count - a.count);
  for (const tier of tiers) {
    if (strikeCount >= tier.count) return tier;
  }
  return { action: 'delete' };
}

/**
 * The action to take. A rule can force its own penalty (delete only, mute,
 * or flag for ban), otherwise the community's escalation tiers decide.
 */
export function resolveAction(strikeCount, escalation, penalty) {
  const mode = penalty?.mode || 'escalate';
  if (mode === 'delete') return { action: 'delete' };
  if (mode === 'mute') return { action: 'mute', minutes: clampMinutes(penalty.minutes) };
  if (mode === 'flag_for_ban') return { action: 'flag_for_ban' };
  const tier = resolveEscalation(strikeCount, escalation);
  return tier.action === 'mute' ? { ...tier, minutes: clampMinutes(tier.minutes) } : tier;
}

export function actionLabel(tier) {
  if (tier.action === 'mute') return `muted for ${tier.minutes} minutes`;
  if (tier.action === 'flag_for_ban') return 'flagged for ban review';
  if (tier.action === 'caution') return 'sent an automatic caution';
  return 'message deleted';
}
// ---- harden: reading links out of chat ----
// Chat is full of "word.word" that is not a link: Node.js, Next.js, "great project.Thanks", "gm.wagmi". A
// written address without https:// only counts as a link when its ending is one people really put links on.
// (Self contained on purpose: it does not depend on any other name in this file.)
const LINK_SCAN_RE = /\b((?:https?:\/\/)(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:\/\S*)?|(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?)/gi;
const LINK_SCAN_SHORT = new Set([
  'bit.ly', 'tinyurl.com', 'cutt.ly', 'is.gd', 'rebrand.ly', 'shorturl.at',
  'tiny.cc', 'rb.gy', 'buff.ly', 't.co', 'ow.ly', 'shrtco.de', 'v.gd', 'lnkd.in'
]);
const LINK_SCAN_TLDS = new Set([
  'com', 'net', 'org', 'io', 'co', 'xyz', 'app', 'dev', 'ai', 'info', 'biz', 'online', 'site', 'top', 'club',
  'live', 'click', 'link', 'pro', 'gg', 'me', 'ly', 'gd', 'gy', 'vip', 'shop', 'store', 'tech', 'cloud', 'fun',
  'space', 'website', 'network', 'finance', 'crypto', 'exchange', 'money', 'cash', 'capital', 'digital', 'world',
  'life', 'one', 'icu', 'cyou', 'sbs', 'rest', 'bond', 'cfd', 'mom', 'work', 'support', 'help', 'email', 'page',
  'art', 'quest', 'monster', 'buzz', 'pw', 'tk', 'ml', 'ga', 'cf', 'gq', 'lol', 'wtf', 'uk', 'fr', 'ru', 'cn',
  'jp', 'kr', 'br', 'es', 'nl', 'se', 'ch', 'tv', 'fm', 'eu', 'ca', 'au', 'de'
]);

/** Every link in a text, trimmed of trailing punctuation. Addresses with https:// always count. */
export function findLinks(text) {
  const out = [];
  for (const m of String(text || '').matchAll(LINK_SCAN_RE)) {
    const raw = m[1].replace(/[.,;:!?'")\]>]+$/, '');
    if (!raw) continue;
    if (/^https?:\/\//i.test(raw)) { out.push(raw); continue; }
    let host = '';
    try { host = new URL(`http://${raw}`).hostname.toLowerCase(); } catch { continue; }
    if (LINK_SCAN_SHORT.has(host) || LINK_SCAN_TLDS.has(host.split('.').pop()) || host.startsWith('xn--') || host.includes('.xn--')) out.push(raw);
  }
  return out;
}
