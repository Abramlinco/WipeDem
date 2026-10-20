import { tokenize, retrieve } from './knowledge.js';

// The thinking behind FAQs Intelligence and the "verify before it goes out" checks.
// Everything here is plain functions with no database and no AI, so it can be tested
// on its own. The rule it enforces: nothing is invented. An answer comes from a person
// (a moderator reply or the manager) or from the project's own facts, and any figure in
// a written answer must be found in the evidence behind it.

/* ------------------------------------------------------------------ */
/* What kind of conversation is it?                                    */
/* ------------------------------------------------------------------ */

export const TOPICS = ['staking', 'token', 'bridge', 'wallet', 'fees', 'mainnet', 'support', 'security', 'app', 'rewards', 'vesting', 'airdrop', 'liquidity', 'dex', 'mint', 'nft', 'governance', 'quests', 'l2', 'listing', 'tokenomics'];

// Same wording Technical Push has always used to spot technical reports.
export const TECH_RE = /error|fail|bug|broken|stuck|not working|can't|cannot|unable|transaction|migrat|wallet|connect|bridge|claim|stake|unstake|gas|rpc|api|revert|pending|balance|technical|issue|problem|crash|timeout|exploit/i;
// Words that mean something actually went wrong, as opposed to someone asking how a thing works.
const ERR_RE = /error|fail|bug|broken|stuck|not working|doesn'?t work|can't|cannot|unable|revert|crash|timeout|exploit|lost|missing|never (received|got)/i;

export const topicOf = (d) => (d.topics || []).find((t) => TOPICS.includes(t)) || (d.topics || [])[0] || 'general';

/** Is this message something FAQs Intelligence should look at? Ideas and praise are not. */
export function isCandidate(d) {
  if (d.kind === 'question' || d.kind === 'concern') return true;
  return d.kind === 'discussion' && ERR_RE.test(String(d.text || ''));
}

/** question, complaint (unhappy, but nothing broke) or technical (something failed). */
export function categorize(d) {
  const t = String(d.text || '');
  if (ERR_RE.test(t)) return 'technical';
  return d.kind === 'concern' ? 'complaint' : 'question';
}
const SEVERITY = { question: 0, complaint: 1, technical: 2 };

/* ------------------------------------------------------------------ */
/* Technical Push: what counts as a reported issue                     */
/* ------------------------------------------------------------------ */

// Something went wrong. A how-to question ("how do I stake?") is not an issue report, and neither is
// a general worry, so a message needs a failure in it AND something technical it happened to.
const FAILURE = /\b(fail(s|ed|ing|ure|ures)?|errors?|bugs?|bugg(y|ed)|glitch(es|ed|y)?|broken|crash(es|ed|ing)?|stuck|froze(n)?|freez(es|ing)|hang(s|ing)?|tim(e[ds]?|ing) ?outs?|revert(s|ed|ing)?|rejected|declined|not (working|loading|showing|appearing|syncing|connecting|updating|responding|displaying|going through|confirming)|(doesn'?t|does not|isn'?t|won'?t|didn'?t|did not) (work|load|show|appear|sync|connect|update|respond|go through|confirm)|can'?t|cannot|can not|unable to|never (received|arrived|showed|got)|missing|disappeared|(is|are|was|keeps?) (down|offline)|nothing happens|lost (my|our)|wrong (balance|amount))\b/i;
const TECH_CONTEXT = /\b(wallets?|metamask|phantom|ledger|keplr|txs?|txn|transactions?|bridg(e|es|ing)|bridged|stak(e|ed|es|ing)|unstak(e|ed|es|ing)|claim(s|ed|ing)?|withdraw(al|als|ing)?|deposit(s|ing)?|swap(s|ping)?|gas|rpc|api|app|website|site|dashboard|portal|page|login|log in|sign in|connect(ing|ion)?|sync(ing)?|node|validator|mint(ing|ed)?|airdrop|balance|transfer(s|red|ring)?|pool|liquidity|button|interface|kyc|verification|extension|mobile|ios|android|browser|network|chain|mainnet|testnet|contract|explorer|rewards?|ibc|ui)\b/i;

/** True when a message reports something that broke, not a question about how a thing works. */
export function isTechnicalIssue(d) {
  if (!d || d.kind === 'praise') return false;
  const t = String(d.text || '').replace(/can'?t wait/gi, ' ');
  if (!FAILURE.test(t)) return false;
  return TECH_CONTEXT.test(t) || (d.topics || []).some((x) => TOPICS.includes(x));
}

/**
 * Groups issue reports by topic and counts what an engineer wants to know: how many reports, how many
 * different members, when it started and last happened, and how many a moderator has already answered.
 * Biggest problem first.
 */
export function groupIssues(rows) {
  const by = new Map();
  for (const d of rows) {
    const topic = (d.topics || []).find((t) => TOPICS.includes(t)) || 'other technical issue';
    if (!by.has(topic)) by.set(topic, []);
    by.get(topic).push(d);
  }
  const answered = (d) => !!(d.staffReplied || (d.staffReplies || []).length);
  const groups = [...by.entries()].map(([topic, items]) => {
    const times = items.map((d) => d.createdAt).sort();
    return {
      topic, items, count: items.length,
      reporters: new Set(items.map((d) => d.userId || d.username || d.id)).size,
      firstAt: times[0], lastAt: times[times.length - 1],
      answered: items.filter(answered).length
    };
  });
  return groups.sort((a, b) => b.count - a.count || b.reporters - a.reporters || a.topic.localeCompare(b.topic));
}

/* ------------------------------------------------------------------ */
/* Fitting a long report into chat messages                            */
/* ------------------------------------------------------------------ */

/**
 * Splits text at line breaks into parts that each fit a chat message, labelled (1/3), (2/3)...
 * Discord allows 2000 characters and Telegram 4096, and a report is usually longer than either.
 * Past maxParts the rest is left out and the last part says so, rather than flooding the channel.
 */
export function splitMessage(text, limit = 1900, maxParts = 8) {
  const room = limit - 12;
  const pieces = [];
  let cur = '';
  const flush = () => { if (cur.trim()) pieces.push(cur.replace(/\s+$/, '')); cur = ''; };
  for (const raw of String(text || '').split('\n')) {
    let line = raw;
    while (line.length > room) {
      const cut = line.lastIndexOf(' ', room) > room * 0.5 ? line.lastIndexOf(' ', room) : room;
      if (cur) flush();
      pieces.push(line.slice(0, cut)); line = line.slice(cut).trimStart();
    }
    if (cur.length + line.length + 1 > room) flush();
    cur += (cur ? '\n' : '') + line;
  }
  flush();
  if (pieces.length <= 1) return pieces.length ? [pieces[0]] : [];
  let parts = pieces;
  if (parts.length > maxParts) parts = [...parts.slice(0, maxParts - 1), 'The rest of this report is in the Sentinel dashboard. Download the full report there.'];
  return parts.map((t, i) => `(${i + 1}/${parts.length}) ${t}`);
}

/* ------------------------------------------------------------------ */
/* Grouping the same question asked in different words                 */
/* ------------------------------------------------------------------ */

export function similarity(a, b) {
  const A = new Set(tokenize(a)), B = new Set(tokenize(b));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / (A.size + B.size - shared);
}

/**
 * rows: discussions, newest first. Returns clusters of the same question inside the same
 * topic, so "how long does unstaking take" and "how long is unstaking" become one FAQ, and two
 * unrelated staking questions stay apart.
 */
export function clusterQuestions(rows, threshold = 0.5) {
  const clusters = [];
  for (const d of rows) {
    const topic = topicOf(d);
    const home = clusters.find((c) => c.topic === topic && similarity(c.rep.text, d.text) >= threshold);
    if (home) { home.items.push(d); if (SEVERITY[categorize(d)] > SEVERITY[home.category]) home.category = categorize(d); }
    else clusters.push({ topic, rep: d, items: [d], category: categorize(d) });
  }
  return clusters;
}

export const fingerprint = (topic, question) =>
  `${topic}:${[...new Set(tokenize(question))].sort().slice(0, 8).join('-')}`.slice(0, 180);

/** An existing draft for the same question, whatever its status, so nothing is raised twice. */
export const findSimilarDraft = (drafts, communityKey, question, threshold = 0.6) =>
  drafts.find((x) => x.communityKey === communityKey && similarity(x.question, question) >= threshold);

/* ------------------------------------------------------------------ */
/* Is it already in the facts?                                         */
/* ------------------------------------------------------------------ */

/**
 * Checks a question against the knowledge bank (documents, pages, live data and approved FAQs)
 * and the brief's confirmed facts. A single shared word is not enough to count as covered,
 * because "no match" is cheaper than a wrong "already answered".
 */
export function coverage(question, { knowledge = [], brief = {} } = {}) {
  const q = [...new Set(tokenize(question))];
  if (!q.length) return { covered: false, via: null };
  // A long, jargon-heavy question shares a couple of words with almost any document about the same topic,
  // so the bar grows with the question: short questions need 2 shared words, long ones need about 40%
  // of their words (at most 6). "Already covered" must mean the documents really speak to the question.
  const need = Math.min(q.length, Math.min(6, Math.max(2, Math.ceil(q.length * 0.4))));
  const hit = retrieve(knowledge, question, { k: 3 }).find((h) => h.matched >= need);
  if (hit) return { covered: true, via: 'knowledge', title: hit.title || '', score: hit.score };
  for (const f of brief.facts || []) {
    const ft = new Set(tokenize(f));
    if (q.filter((w) => ft.has(w)).length >= need) return { covered: true, via: 'brief', title: 'Project brief' };
  }
  return { covered: false, via: null };
}

/* ------------------------------------------------------------------ */
/* Where the answer comes from                                         */
/* ------------------------------------------------------------------ */

/** Replies a person already gave in the chat, the cluster's own question first. */
export function answersFor(cluster) {
  const items = [...cluster.items].sort((a, b) => similarity(b.text, cluster.rep.text) - similarity(a.text, cluster.rep.text));
  const out = [];
  for (const d of items) {
    for (const r of d.staffReplies || []) if (r?.text) out.push(String(r.text).trim());
    if (d.reply?.text) out.push(String(d.reply.text).trim());
  }
  return [...new Set(out.filter(Boolean))];
}

export const PLACEHOLDER = /no moderator answer was captured/i;

export const NOTES = {
  moderator: 'Taken from a moderator reply in the chat. Check it is still correct before approving.',
  none: 'Nothing in your facts covers this and nobody has answered it in the chat. Write the verified answer yourself before approving.',
  manager: 'Written or edited by the manager.',
  'ai-knowledge': 'AI proposed answer, written from your uploaded documents and the question. NOT verified. Read it against your documents, edit anything that is wrong, then approve.',
  'ai-general': 'AI proposed answer from general crypto knowledge. Your documents do not cover this, so NOTHING here is confirmed for your project. Check it, edit it, and approve only if it is right.'
};

/** An answer an AI wrote and no person has changed yet. It can only be approved after an explicit confirmation. */
export const isAiBasis = (basis) => basis === 'ai-knowledge' || basis === 'ai-general';

/* ------------------------------------------------------------------ */
/* Figures must come from evidence                                     */
/* ------------------------------------------------------------------ */

const norm = (n) => String(n).replace(/,/g, '').replace(/\.0+$/, '');
const stripUrls = (s) => String(s || '').replace(/https?:\/\/\S+/gi, ' ');
const UNIT_AFTER = /^\s?(%|x\b|days?\b|hours?\b|hrs?\b|minutes?\b|mins?\b|weeks?\b|months?\b|years?\b|[kmb]\b)/i;

/** Numbers a reader could rely on: two or more digits, or any number with a unit or currency sign. */
export function figuresIn(text) {
  const s = stripUrls(text);
  const out = new Set();
  for (const m of s.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const raw = norm(m[0]);
    const before = s.slice(Math.max(0, m.index - 1), m.index);
    const after = s.slice(m.index + m[0].length, m.index + m[0].length + 10);
    if (raw.replace(/\D/g, '').length >= 2 || UNIT_AFTER.test(after) || /[$€£]/.test(before)) out.add(raw);
  }
  return [...out];
}

const allNumbers = (text) => new Set([...stripUrls(text).matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => norm(m[0])));

/** Figures in `text` that appear nowhere in the evidence. Empty means every figure is backed up. */
export function unsupportedFigures(text, evidence = []) {
  const known = new Set();
  for (const e of evidence) for (const n of allNumbers(e)) known.add(n);
  return figuresIn(text).filter((f) => !known.has(f));
}

/* ------------------------------------------------------------------ */
/* What the app has learned about a community                          */
/* ------------------------------------------------------------------ */

const DAY = 86400000;

/**
 * A compact picture of a community, built only from things that were recorded: the manager's
 * brief, what members talked about, the open gaps in the facts and the latest technical report.
 * It is background for the drafter, not a source of facts to quote.
 */
export function communityContext({ brief = {}, discussions = [], faqDrafts = [], reports = [], now = Date.now() } = {}) {
  const recent = discussions.filter((d) => now - new Date(d.createdAt).getTime() < 14 * DAY);
  const counts = new Map();
  for (const d of recent) { const t = topicOf(d); if (t !== 'general') counts.set(t, (counts.get(t) || 0) + 1); }
  const topTopics = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([topic, count]) => ({ topic, count }));
  const latest = reports.filter((r) => now - new Date(r.createdAt).getTime() < 14 * DAY).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const knownIssues = (latest?.groups || []).filter((g) => g.topic && g.count).slice(0, 5).map((g) => ({ topic: g.topic, count: g.count }));
  const openGaps = faqDrafts.filter((x) => x.status === 'pending' && x.gap !== false).length;
  const lines = [];
  const name = [brief.projectName, brief.ticker ? `(${brief.ticker})` : ''].filter(Boolean).join(' ');
  if (name || brief.about) lines.push(`Project: ${[name, brief.about].filter(Boolean).join(' - ')}`);
  if (topTopics.length) lines.push(`Members have mostly been talking about, in the last 14 days: ${topTopics.map((t) => `${t.topic} (${t.count})`).join(', ')}`);
  if (knownIssues.length) lines.push(`Problems members reported in the latest technical report: ${knownIssues.map((t) => `${t.topic} (${t.count})`).join(', ')}`);
  if (openGaps) lines.push(`Questions the project's facts do not cover yet: ${openGaps}`);
  return { text: lines.join('\n'), topTopics, knownIssues, openGaps };
}
