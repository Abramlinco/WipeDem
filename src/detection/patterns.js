// The core rule, from real Web3 community management experience: a genuine
// admin or moderator never tells a user to DM them first, and never claims
// to have already DM'd someone. In these communities the direction only
// ever runs one way, user contacts admin, never admin contacts user.
//
// Each pattern below is checked against the message text. A match alone is
// a soft signal, since ordinary helpful chat can sound similar. A match
// combined with financial or token related wording is treated as a much
// stronger signal, since that combination is almost never innocent.

export const impersonationPhrases = [
  /\bdm\s+me\b/i,
  /\bsend\s+me\s+a\s+dm\b/i,
  /\bi(?:'ve| have)?\s+sent\s+you\s+(a\s+)?(dm|message|pm)\b/i,
  /\bcheck\s+your\s+(dm|dms|inbox|message)\b/i,
  /\bi\s+can\s+help\s+you.{0,15}\bdm\b/i,
  /\breach\s+out\s+to\s+me\s+(directly|privately)\b/i,
  /\bmessage\s+me\s+privately\b/i
];

export const financialContextWords = [
  /\bwallet\b/i,
  /\bseed\s*phrase\b/i,
  /\bprivate\s*key\b/i,
  /\btoken\b/i,
  /\bmigrat/i,
  /\bairdrop\b/i,
  /\bclaim\b/i,
  /\bverify\s+your\s+(account|wallet|assets)\b/i,
  /\brefund\b/i,
  /\bstaking\b/i
];

export function scoreMessage(text) {
  const phraseHit = impersonationPhrases.some(p => p.test(text));
  const financialHit = financialContextWords.some(p => p.test(text));

  if (!phraseHit) return { flagged: false, score: 0, financialHit };

  // A bare phrase hit with no financial context is still worth a soft flag,
  // since offering unsolicited DM help is against the norm on its own, but
  // it is scored lower so it can be reviewed rather than auto contained
  // if you choose to raise the threshold later in Settings.
  const score = financialHit ? 2 : 1;
  return { flagged: true, score, financialHit };
}
