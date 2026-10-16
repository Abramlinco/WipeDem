// Reads one chat message and decides whether it is worth a community
// manager's attention: an idea, a question, a concern, praise, or a real
// discussion. Everything here is plain rules, no AI and no cost per message,
// so it can look at every message in every community. Chatter ("gm", "lol",
// "ok") comes back as null and is never stored.

const clean = (text) =>
  String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/<@[!&]?\d+>|<#\d+>|<a?:\w+:\d+>/g, ' ')   // Discord mentions and emoji
    .replace(/@\w+/g, ' ')
    .replace(/[\u2018\u2019\u02BC\u0060\u00B4]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

const has = (re, t) => re.test(t);

const IDEA = /\b(we should|you should|you guys should|what if|how about|why not|why don't (we|you)|i suggest|my suggestion|suggestion|i propose|proposal|idea|ideas|would be (so |really |very )?(cool|great|nice|awesome|good|useful)|it would be (so |really |very )?(cool|great|nice|awesome|good|useful)|can we (have|add|get|please)|could we (have|add|get)|please (add|make|bring|consider)|feature request|would love (to see|a|an)|i'd love (to see|a|an)|need (a|an) (way|option|feature)|maybe (we|you) (could|can)|imagine if|consider (adding|making|having))\b/i;
const QUESTION_START = /^(how|what|when|where|why|who|which|is|are|am|can|could|will|would|does|do|did|should|has|have|any(one|body)|someone)\b/i;
const QUESTION_ANY = /\b(anyone know|does anybody|can someone|how do i|how can i|how do we|where can i|where do i|when is|when will|is there a|is it possible|any update|any news)\b/i;
const CONCERN = /\b(not working|doesn't work|does not work|isn't working|broken|bug|buggy|glitch|error|failed|failing|stuck|can't|cannot|unable to|too (slow|expensive|high|low|late|confusing)|disappointed|frustrat\w+|annoying|worried|concern(ed)?|scared|unfair|misleading|no (response|reply|update|communication)|ignored|where is|still waiting|rug|rugged|scam|lost (my|our)|never (received|got|arrived)|fees? (are|is) (too|so|insane|crazy))\b/i;
const PRAISE = /\b(love (it|this|the|how)|great (job|work|update|team|project)|awesome|amazing|well done|thank you|thanks (for|team|guys)|good (job|work|update)|impressed|bullish|best (project|community|team))\b/i;

const POSITIVE = ['love', 'great', 'awesome', 'amazing', 'good', 'nice', 'excellent', 'bullish', 'excited', 'happy', 'thanks', 'thank', 'helpful', 'smooth', 'fast', 'best', 'impressed', 'perfect', 'win', 'wow'];
const NEGATIVE = ['bad', 'broken', 'bug', 'slow', 'scam', 'rug', 'worst', 'disappointed', 'angry', 'frustrated', 'annoying', 'worried', 'fail', 'failed', 'terrible', 'awful', 'hate', 'unfair', 'stuck', 'lost', 'error', 'dump', 'bearish', 'ignored'];

export function sentimentOf(text) {
  const words = clean(text).toLowerCase().match(/[a-z']+/g) || [];
  let pos = 0, neg = 0;
  for (const w of words) {
    if (POSITIVE.includes(w)) pos++;
    else if (NEGATIVE.includes(w)) neg++;
  }
  return pos + neg ? Math.round(((pos - neg) / (pos + neg)) * 100) / 100 : 0;
}

/* ---------------- topics ---------------- */

// Words a Web3 community actually talks about. Different spellings are
// folded into one topic so "stake", "staking" and "staked" count together.
const VOCAB = {
  airdrop: ['airdrop', 'airdrops', 'drop'], staking: ['stake', 'staking', 'staked', 'unstake'],
  nft: ['nft', 'nfts'], token: ['token', 'tokens', 'coin', 'coins'], tokenomics: ['tokenomics', 'supply', 'emission'],
  listing: ['listing', 'listed', 'binance', 'coinbase', 'cex', 'exchange'], mainnet: ['mainnet', 'testnet', 'launch'],
  bridge: ['bridge', 'bridging'], wallet: ['wallet', 'metamask', 'phantom', 'ledger'], fees: ['fee', 'fees', 'gas'],
  liquidity: ['liquidity', 'lp', 'pool', 'pools'], dex: ['dex', 'swap', 'swaps', 'uniswap'], roadmap: ['roadmap', 'milestone', 'milestones'],
  governance: ['governance', 'dao', 'proposal', 'vote', 'voting', 'snapshot'], whitelist: ['whitelist', 'allowlist', 'wl'],
  mint: ['mint', 'minting', 'minted'], vesting: ['vesting', 'unlock', 'unlocks', 'cliff'], rewards: ['reward', 'rewards', 'yield', 'apy', 'farming'],
  partnership: ['partnership', 'partner', 'partners', 'collab', 'collaboration', 'integration'], ama: ['ama', 'livestream', 'spaces'],
  giveaway: ['giveaway', 'giveaways', 'contest', 'raffle'], quests: ['quest', 'quests', 'points', 'season', 'campaign', 'leaderboard'],
  app: ['app', 'mobile', 'ios', 'android', 'ui', 'ux', 'dashboard', 'interface'], support: ['support', 'ticket', 'kyc', 'verification'],
  price: ['price', 'pump', 'dump', 'chart', 'marketcap', 'mcap'], security: ['hack', 'exploit', 'phishing', 'audit', 'security'],
  ai: ['ai', 'agent', 'agents', 'llm'], memecoin: ['meme', 'memecoin', 'memecoins'], l2: ['layer2', 'l2', 'rollup', 'rollups', 'arbitrum', 'base', 'optimism']
};
const FOLD = new Map();
for (const [topic, words] of Object.entries(VOCAB)) for (const w of words) FOLD.set(w, topic);

const STOP = new Set(('a about above after again all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its just like me more most my no nor not now of off on once only or other our out over own really same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who why will with would you your yours yeah yes okay ok lol lmao gm gn hey hello hi guys guy people thing things think know want need get got going go make made see say said look good bad best well even still much many back way time one two new use using used maybe actually literally basically something anything everything someone anyone everyone feel feels thanks thank please will cant dont isnt doesnt wont im ive youre thats whats theres lets also either always never ever every being because though place happen happens working works waiting great interesting start starts starting week days today tomorrow yesterday long full rare real first last next admin admins mod mods moderator moderators team dev devs info topic topics trending exciting interesting latest update updates share sharing question questions answer answers help hello anyone everyone').split(/\s+/));

export function extractTopics(text, max = 5) {
  const words = clean(text).toLowerCase().match(/[a-z][a-z0-9]{1,}/g) || [];
  const found = new Map();
  for (const w of words) {
    const topic = FOLD.get(w);
    if (topic) found.set(topic, (found.get(topic) || 0) + 2);
  }
  // Other meaningful words, so a community's own project names and slang surface too.
  for (let w of words) {
    if (FOLD.has(w) || STOP.has(w) || w.length < 5) continue;
    if (w.length > 5 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
    found.set(w, (found.get(w) || 0) + 1);
  }
  return [...found.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([t]) => t);
}

/* ---------------- classification ---------------- */

const SMALL_TALK = /^(how are (you|u)|how r u|how('s| is) (everyone|everybody|it going)|what'?s up|wassup|sup\b)/i;
const BASE_SCORE = { idea: 5, concern: 4, question: 3, discussion: 2, praise: 1 };

/**
 * Returns { kind, score, topics, sentiment } for a message worth keeping,
 * or null for chatter. kind is one of idea, question, concern, praise,
 * discussion. A higher score means more worth a manager's time.
 */
export function analyze(rawText) {
  const text = clean(rawText);
  const wordCount = text.split(' ').filter(Boolean).length;
  if (text.length < 12 || wordCount < 3) return null;
  if (/^[!\/.]/.test(text)) return null; // bot commands
  if (SMALL_TALK.test(text)) return null; // "how are you all", "what's up"

  const topics = extractTopics(text);
  const onTopic = topics.some((t) => VOCAB[t]);
  // Most people do not type a question mark in chat, so a message that starts
  // like a question, or asks "when mainnet", counts too.
  const askWord = /\b(when|wen|where|how|why|what|who|which)\b/i.test(text);
  const looseQuestion = (QUESTION_START.test(text) && wordCount >= 4) || (askWord && onTopic);
  const isQuestion = text.includes('?') && (QUESTION_START.test(text) || QUESTION_ANY.test(text) || wordCount >= 5)
    || QUESTION_ANY.test(text) || looseQuestion;

  let kind = null;
  if (has(IDEA, text)) kind = 'idea';
  else if (has(CONCERN, text)) kind = 'concern';
  else if (isQuestion) kind = 'question';
  else if (has(PRAISE, text)) kind = 'praise';

  // A long message about something real is a discussion even when it is
  // not phrased as an idea or a question.
  if (!kind && text.length >= 90 && (onTopic || wordCount >= 18)) kind = 'discussion';
  if (!kind) return null;
  // Very short messages are only kept when they are an on topic question ("admin when mainnet").
  const short = text.length < 20 || wordCount < 4;
  if (short && !(kind === 'question' && onTopic)) return null;

  let score = BASE_SCORE[kind];
  if (text.length > 120) score += 1;
  if (text.length > 260) score += 1;
  if (onTopic) score += 1;
  // The wording decides the kind, so the mood follows it when the words alone
  // were neutral ("still waiting on my tokens" has no negative word in it).
  let sentiment = sentimentOf(text);
  if (kind === 'concern') sentiment = Math.min(sentiment, -0.3);
  if (kind === 'praise') sentiment = Math.max(sentiment, 0.3);
  return { kind, score, topics, sentiment };
}
