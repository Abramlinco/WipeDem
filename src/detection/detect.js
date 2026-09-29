import fs from 'fs';
import path from 'path';

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

const escapeRe = (s) => s.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&');
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

/** Helper function to read the db.json file and check if a user is cross-verified */
function checkUserVerifiedID(platformUserId) {
  try {
    const dbPath = path.resolve(process.cwd(), 'db.json');
    if (!fs.existsSync(dbPath)) return false;

    const fileContent = fs.readFileSync(dbPath, 'utf8');
    const dbData = JSON.parse(fileContent);

    // Look for common JSON-store layouts ("users", "accounts", or top-level array)
    const usersList = dbData.users || dbData.accounts || (Array.isArray(dbData) ? dbData : Object.values(dbData));

    if (!Array.isArray(usersList)) return false;

    // Search if this user ID matches your database fields and is fully set up
    return usersList.some(user => 
      user && 
      (user.discordId === platformUserId || user.id === platformUserId) && 
      (user.telegramId || user.connectedTelegram === true || user.telegram)
    );
  } catch (err) {
    console.error('[Sentinel DB Reader Error]', err.message);
    return false;
  }
}

/**
 * Check a message against one community's rules. Only ever called for people
 * who are NOT on the real, live admin list. Real admins are never checked.
 * 
 * NOTE: Changed to async to safely support dynamic db.json checking hooks.
 */
export async function checkMessage(text, platformMessage, rules) {
  // If the middle rules parameter is an object/array, shift arguments to handle backwards compatibility
  let actualRules = rules;
  let msgObj = platformMessage;
  if (platformMessage && typeof platformMessage === 'object' && !platformMessage.mentions && !platformMessage.content) {
    actualRules = platformMessage;
    msgObj = null;
  }

  if (!text || typeof text !== 'string') return { flagged: false };
  const t = norm(text);

  // =========================================================
  // 1. BEHAVIORAL CHECK: Mass Mention Spam (Discord Only)
  // =========================================================
  if (msgObj && msgObj.mentions && msgObj.mentions.users && msgObj.mentions.users.size > 3) {
    return {
      flagged: true,
      ruleKey: 'mass_mention',
      ruleLabel: 'Mass Mention Spam',
      matchedPhrase: `${msgObj.mentions.users.size} pings`,
      penalty: { mode: 'mute', minutes: 15 } // Force auto-mute for raiders
    };
  }

  // =========================================================
  // 2. BEHAVIORAL CHECK: Smart Link & Identity Verification
  // =========================================================
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const links = t.match(urlRegex);

  if (links) {
    // Baseline safe zones
    const trustedDomains = ['discord.gg', 'discord.com', 'discordapp.com', 'telegram.me', 't.me', 'quicksilver.zone'];
    
    // Check if user is fully paired up inside your local JSON datastore
    const authorId = msgObj?.author?.id || msgObj?.from?.id;
    const identityIsVerified = authorId ? checkUserVerifiedID(authorId) : false;

    // Smart contextual risk flags
    const scamTriggers = ['support', 'ticket', 'assistance', 'verify', 'claim', 'help', 'follow', 'here', 'below', 'section'];
    const triggersFound = scamTriggers.filter(word => t.includes(word));

    for (const url of links) {
      const lowerUrl = url.toLowerCase();
      
      // Pass-through: Do not trigger if it's an official Discord or Telegram address
      const isOfficialPlatform = trustedDomains.some(domain => lowerUrl.includes(domain));
      if (isOfficialPlatform) continue;

      // Type-Squat Check: Catches domains mimicking official layouts (e.g. d1scord.app)
      if (lowerUrl.includes('disc') && !lowerUrl.includes('discord.com') && !lowerUrl.includes('discord.gg') && !lowerUrl.includes('discordapp.com')) {
        return {
          flagged: true,
          ruleKey: 'phishing_link',
          ruleLabel: 'Phishing Discord Clone Link',
          matchedPhrase: url,
          penalty: { mode: 'delete' } // Clean up text instantly
        };
      }

      // Identity Enforcement Check: Unverified profiles are blocked from dropping external links
      if (!identityIsVerified) {
        return {
          flagged: true,
          ruleKey: 'unauthorized_link_post',
          ruleLabel: '🚨 Unauthorized Link (Profile Not Linked to Telegram)',
          matchedPhrase: url,
          penalty: { mode: 'delete' }
        };
      }

      // Smart Intent Check: Links combined with high-urgency ticket text get swept
      if (triggersFound.length >= 1) {
        return {
          flagged: true,
          ruleKey: 'deceptive_action_link',
          ruleLabel: '🛑 Deceptive Action/Ticket Heuristic Link',
          matchedPhrase: `${url} (Context: ${triggersFound.join(', ')})`,
          penalty: { mode: 'delete' }
        };
      }
    }
  }

  // =========================================================
  // 3. KEYWORD LOOP: Your original keyword rule comparison engine
  // =========================================================
  for (const [key, rule] of Object.entries(actualRules || {})) {
    if (!rule?.enabled) continue;
    for (const phrase of rule.keywords || []) {
      const re = phraseRegex(phrase);
      if (re && re.test(t)) {
        return { flagged: true, ruleKey: key, ruleLabel: rule.label, matchedPhrase: phrase, penalty: rule.penalty };
      }
    }
  }

  return { flagged: false };
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
  return 'message deleted';
}
