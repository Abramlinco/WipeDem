// The part that weighs what the community is saying against what the wider
// web is talking about, and turns the overlap and the gaps into things a
// community manager can actually do. Pure functions, no network, no storage,
// so the same input always gives the same playbook.

const HOUR = 3600000;
const clip = (s, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const evidenceOf = (d) => ({ id: d.id, username: d.username, platform: d.platform, kind: d.kind, text: clip(d.text), at: d.createdAt });
const active = (d) => d.status === 'new' || d.status === 'starred';

/* ---------------- what the community is talking about ---------------- */

export function hotTopics(discussions, { minUsers = 2, limit = 12 } = {}) {
  const map = new Map();
  for (const d of discussions) {
    for (const topic of d.topics || []) {
      const t = map.get(topic) || { topic, count: 0, users: new Set(), kinds: {}, sentiment: 0, platforms: new Set(), replies: 0, items: [] };
      t.count++;
      t.users.add(`${d.platform}:${d.userId}`);
      t.kinds[d.kind] = (t.kinds[d.kind] || 0) + 1;
      t.sentiment += d.sentiment || 0;
      t.platforms.add(d.platform);
      t.replies += d.replies || 0;
      t.items.push(d);
      map.set(topic, t);
    }
  }
  return [...map.values()]
    .filter((t) => t.users.size >= minUsers)
    .map((t) => ({
      topic: t.topic, count: t.count, users: t.users.size, kinds: t.kinds,
      sentiment: Math.round((t.sentiment / t.count) * 100) / 100,
      platforms: [...t.platforms], replies: t.replies,
      items: t.items.sort((a, b) => (b.score + b.replies) - (a.score + a.replies)),
      weight: t.users.size * 2 + t.count + t.replies
    }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit);
}

const dayKey = (iso) => iso.slice(0, 10);

export function overview(discussions, days, now = Date.now()) {
  const count = (kind) => discussions.filter((d) => d.kind === kind).length;
  const people = new Map();
  for (const d of discussions) {
    const k = `${d.platform}:${d.userId}`;
    const p = people.get(k) || { userId: d.userId, username: d.username, platform: d.platform, ideas: 0, questions: 0, concerns: 0, total: 0, replies: 0 };
    p.total++; p.replies += d.replies || 0;
    if (d.kind === 'idea') p.ideas++;
    if (d.kind === 'question') p.questions++;
    if (d.kind === 'concern') p.concerns++;
    people.set(k, p);
  }
  const perDay = {};
  for (let i = days - 1; i >= 0; i--) perDay[new Date(now - i * 24 * HOUR).toISOString().slice(0, 10)] = 0;
  for (const d of discussions) if (dayKey(d.createdAt) in perDay) perDay[dayKey(d.createdAt)]++;
  const plat = (p) => {
    const list = discussions.filter((d) => d.platform === p);
    return { total: list.length, ideas: list.filter((d) => d.kind === 'idea').length };
  };
  const unanswered = discussions.filter((d) => d.kind === 'question' && active(d) && !d.staffReplied && !d.replies);
  return {
    totals: {
      discussions: discussions.length, ideas: count('idea'), questions: count('question'), concerns: count('concern'),
      praise: count('praise'), openQuestions: unanswered.length, contributors: people.size
    },
    byPlatform: { telegram: plat('telegram'), discord: plat('discord') },
    sentiment: discussions.length ? Math.round((discussions.reduce((n, d) => n + (d.sentiment || 0), 0) / discussions.length) * 100) / 100 : 0,
    timeline: Object.entries(perDay).map(([date, n]) => ({ date, count: n })),
    contributors: [...people.values()].sort((a, b) => (b.ideas * 3 + b.total + b.replies) - (a.ideas * 3 + a.total + a.replies)).slice(0, 8)
  };
}

/* ---------------- what the wider web is talking about ---------------- */

const trendBase = (t, now) => {
  const ageH = Math.max(0, (now - new Date(t.publishedAt || t.fetchedAt).getTime()) / HOUR);
  return (t.weight || 1) * Math.pow(0.5, ageH / 24) + Math.min(1, (t.engagement || 0) / 500);
};

/**
 * Orders stories so the ones that touch what this community is already
 * discussing come first, then by freshness and the source's own weight.
 */
export function rankTrends(trends, hot, now = Date.now()) {
  const hotNames = new Set(hot.map((h) => h.topic));
  return trends
    .map((t) => {
      const matchedTopics = (t.topics || []).filter((x) => hotNames.has(x));
      return { ...t, matchedTopics, rank: trendBase(t, now) * (1 + matchedTopics.length * 0.8) };
    })
    .sort((a, b) => b.rank - a.rank);
}

/* ---------------- the playbook ---------------- */

const PRIORITY = { high: 0, medium: 1, low: 2 };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
const trendEv = (t) => ({ title: t.title, url: t.url, source: t.source });

export function buildPlaybook({ discussions, trends, days = 7, now = Date.now(), poolEvents = [] }) {
  const items = [];
  const recentTrends = trends.filter((t) => now - new Date(t.publishedAt || t.fetchedAt).getTime() < 72 * HOUR);
  const people = new Set(discussions.map((d) => `${d.platform}:${d.userId}`));
  const hot = hotTopics(discussions, { minUsers: people.size >= 30 ? 3 : 2 });
  const ranked = rankTrends(recentTrends, hot, now);
  const add = (i) => items.push({ priority: 'medium', channels: ['x', 'telegram', 'discord'], weight: 0, ...i });

  /* 0. Something changed in a pool the community watches. */
  const stamp = (iso) => `${String(iso).slice(0, 16).replace('T', ' ')} UTC`;
  const POOL_IDEA = {
    liquidity_drop: (e) => ({ priority: 'high', weight: 60, title: `Liquidity dropped in ${e.poolLabel}`,
      why: `${e.text} Drops like this are noticed fast, and silence lets rumours fill the gap.`,
      actions: ['Find out why before you say anything (a large withdrawal, a pool migration, an incentive ending)', 'Post a short factual update saying what you know and when you will know more', 'Answer members who have asked about it'],
      draft: `Update on ${e.poolLabel}: liquidity changed recently, and we know some of you noticed.\n\nWhat we know: [reason]\nWhat we are checking: [next step]\nNext update: [date]\n\nLive numbers: DEX Screener, ${stamp(e.at)}.` }),
    new_pool: (e) => ({ priority: 'high', weight: 55, title: `Check the new pool before anyone uses it`,
      why: `${e.text} A fake pool can be used to take members' money, so confirm it before anyone is pointed to it.`,
      actions: ['Check the pool was created by your team or a partner you know', 'If it is not yours, warn members not to add liquidity there', 'If it is yours, announce it with the official link and change the draft to match'],
      draft: `Heads up: a new pool for our token has appeared (${e.poolLabel}). Please only use pools that are linked from our official channels.\n\nOfficial links: [link]\n\nIf you see another pool for our token, check with the team before adding anything.` }),
    liquidity_up: (e) => ({ priority: 'low', weight: 20, title: `Liquidity is growing in ${e.poolLabel}`,
      why: `${e.text} Growth is worth sharing, and members like seeing real numbers.`,
      actions: ['Share it with the source and the time', 'Thank the people who provided liquidity', 'Avoid saying where it will go next'],
      draft: `${e.text}\n\nSource: DEX Screener, ${stamp(e.at)}. Numbers change often. This is information, not advice.` }),
    volume_spike: (e) => ({ priority: 'low', weight: 18, title: `More trading activity in ${e.poolLabel}`,
      why: `${e.text} A busy pool is a good moment to remind members where the official links are.`,
      actions: ['Share it with the source and the time', 'Pin the official links in the community'],
      draft: `${e.text}\n\nSource: DEX Screener, ${stamp(e.at)}. Numbers change often. This is information, not advice.` }),
    apy_change: (e) => ({ priority: 'medium', weight: 30, title: `The yield changed in ${e.poolLabel}`,
      why: `${e.text} Members who earn from it will ask why.`,
      actions: ['Say what you know about the change', 'Share the number with its source and the time', 'Remind members that rates change'],
      draft: `${e.text}\n\nSource: DefiLlama, ${stamp(e.at)}.` })
  };
  const poolSeen = new Set();
  for (const e of poolEvents.slice(0, 12)) {
    const make = POOL_IDEA[e.type];
    const key = `${e.itemId}:${e.type}`;
    if (!make || poolSeen.has(key)) continue;
    poolSeen.add(key);
    add({ id: `pool-${e.id}`, type: 'pool_update', channels: ['x', 'telegram', 'discord'], evidence: { discussions: [], trends: [], pools: [{ text: e.text, url: e.url, at: e.at }] }, ...make(e) });
  }

  /* 1. A topic the community cares about is also in the news: join the wave. */
  const usedTrend = new Set();
  for (const h of hot) {
    const matches = ranked.filter((t) => t.matchedTopics.includes(h.topic));
    if (!matches.length) continue;
    matches.slice(0, 2).forEach((m) => usedTrend.add(m.id));
    add({
      id: `wave-${slug(h.topic)}`, type: 'ride_wave', priority: matches.length >= 2 ? 'high' : 'medium', weight: h.weight + matches.length * 3,
      title: `Ride the "${h.topic}" wave`,
      why: `${h.users} members raised ${h.topic} (${h.count} messages) while ${matches.length} outside ${matches.length === 1 ? 'story is' : 'stories are'} running on it. Posting now meets real interest with a live news hook.`,
      actions: [
        `Publish an X thread connecting "${clip(matches[0].title, 80)}" to what your members have been saying`,
        'Post the same question as a poll in Telegram and Discord',
        'Pin the strongest member take and thank the person who wrote it'
      ],
      draft: `${h.topic[0].toUpperCase()}${h.topic.slice(1)} is on everyone's mind, including yours. ${h.users} of you raised it recently, and now "${clip(matches[0].title, 110)}" (${matches[0].source}) is making the rounds.\n\nHow does this change things for us? Tell us what you think below.`,
      evidence: { discussions: h.items.slice(0, 3).map(evidenceOf), trends: matches.slice(0, 3).map(trendEv) }
    });
  }

  /* 2. A topic only your own members are driving: own the narrative. */
  for (const h of hot) {
    if (ranked.some((t) => t.matchedTopics.includes(h.topic))) continue;
    if (h.users < (people.size >= 30 ? 3 : 2)) continue;
    add({
      id: `own-${slug(h.topic)}`, type: 'own_topic', priority: h.users >= 4 ? 'high' : 'medium', weight: h.weight,
      title: `Members are driving "${h.topic}" themselves`,
      why: `${h.users} members talked about ${h.topic} and nothing outside is pushing it, so this interest is yours. Leading it gets you the credit.`,
      actions: ['Turn the best member messages into a short post', 'Offer a community call or AMA segment on it', 'Ask the team for an official position'],
      draft: `Quick poll: ${h.users} of you have been discussing ${h.topic}. What would you most like from us?\n\n1. A plain explainer\n2. A community call\n3. A vote on next steps\n4. Something else (reply below)`,
      evidence: { discussions: h.items.slice(0, 3).map(evidenceOf), trends: [] }
    });
  }

  /* 3. Questions nobody has answered yet. */
  const cutoff = now - 30 * 60000;
  const open = discussions.filter((d) => d.kind === 'question' && active(d) && !d.staffReplied && !d.replies && new Date(d.createdAt).getTime() < cutoff)
    .sort((a, b) => b.score - a.score);
  if (open.length >= 3) {
    add({
      id: 'open-questions', type: 'answer_questions', priority: open.length >= 6 ? 'high' : 'medium', weight: open.length * 2,
      title: `Answer ${open.length} questions nobody has replied to`,
      why: 'Unanswered questions are where new members quietly decide to leave, and where scammers move in to "help".',
      actions: ['Reply to the top few directly today', 'Turn repeats into a pinned FAQ', 'Cover the rest in the next AMA'],
      draft: `Open questions from the community:\n\n${open.slice(0, 4).map((d, i) => `${i + 1}. ${clip(d.text, 110)}`).join('\n')}\n\nWe'll answer these on [date]. Add yours below.`,
      evidence: { discussions: open.slice(0, 4).map(evidenceOf), trends: [] }
    });
  }

  /* 4. A complaint several people share. */
  for (const h of hot) {
    const concerns = h.items.filter((d) => d.kind === 'concern');
    const who = new Set(concerns.map((d) => d.userId));
    if (concerns.length < 2 || who.size < 2) continue;
    add({
      id: `concern-${slug(h.topic)}`, type: 'address_concern', priority: who.size >= 3 ? 'high' : 'medium', weight: who.size * 3 + concerns.length,
      title: `Speak to the "${h.topic}" concern`,
      why: `${who.size} different members raised a problem with ${h.topic}. A short, honest update now costs far less than a rumour later.`,
      actions: ['Say what you know and what you do not', 'Give a date for the next update', 'Reply under the original messages so those members see it'],
      draft: `Update on ${h.topic}: we've seen your feedback and we're on it.\n\nWhat we know: [status]\nWhat we're doing: [next step]\nNext update: [date]\n\nThank you for flagging it.`,
      evidence: { discussions: concerns.slice(0, 3).map(evidenceOf), trends: [] }
    });
  }

  /* 5. The best member ideas. */
  const ideas = discussions.filter((d) => d.kind === 'idea' && active(d)).sort((a, b) => (b.score + b.replies * 2) - (a.score + a.replies * 2));
  if (ideas.length >= 2) {
    add({
      id: 'idea-vote', type: 'spotlight_idea', priority: 'medium', weight: ideas.length + ideas.slice(0, 3).reduce((n, d) => n + d.replies, 0),
      title: 'Put the best member ideas to a vote',
      why: `${ideas.length} ideas came in. Showing members their ideas were read is the cheapest way to get more of them.`,
      actions: ['Post the top three as a vote in both communities', 'Credit the people who wrote them', 'Report back which one the team picks'],
      draft: `Community idea vote 🗳️\n\nThe best ideas from you this week:\n\n${ideas.slice(0, 3).map((d, i) => `${i + 1}. ${clip(d.text, 100)}`).join('\n')}\n\nReact with 1️⃣ 2️⃣ or 3️⃣. The winner goes straight to the team.`,
      evidence: { discussions: ideas.slice(0, 3).map(evidenceOf), trends: [] }
    });
  }

  /* 6. Big stories your community has not touched: start the conversation. */
  const fresh = ranked.filter((t) => !usedTrend.has(t.id) && !t.matchedTopics.length).slice(0, 2);
  fresh.forEach((t, i) => add({
    id: `starter-${t.id}`, type: 'conversation_starter', priority: i === 0 && !hot.length ? 'high' : 'low', weight: t.rank,
    title: `Start a conversation: ${clip(t.title, 70)}`,
    why: `A fresh story from ${t.source} your members have not discussed yet. A good question keeps the community lively between announcements.`,
    actions: ['Post it with one open question', 'Share it in whichever platform is quieter'],
    draft: `${t.title} (${t.source})\n\nWhat do you make of this? Does it change how you see things? Tell us below.`,
    evidence: { discussions: [], trends: [trendEv(t)] }
  }));

  /* 7. A community that has gone quiet. */
  if (days >= 3) {
    const lastDay = discussions.filter((d) => now - new Date(d.createdAt).getTime() < 24 * HOUR).length;
    const priorPerDay = (discussions.length - lastDay) / (days - 1);
    if (priorPerDay >= 5 && lastDay < priorPerDay * 0.4) {
      add({
        id: 'revive', type: 'revive', priority: 'high', weight: priorPerDay,
        title: 'The community has gone quiet',
        why: `About ${lastDay} meaningful messages in the last day against roughly ${Math.round(priorPerDay)} a day before. Quiet stretches are easy to fix early.`,
        actions: ['Ask one easy question today', 'Run a small giveaway or quiz', 'Announce the next AMA date'],
        draft: 'Daily question: what is one thing we should build or fix next? The best answer gets [reward].',
        evidence: { discussions: [], trends: [] }
      });
    }
  }

  /* 8. Thank the people carrying the community. */
  const top = overview(discussions, days, now).contributors.filter((p) => p.total >= 3).slice(0, 3);
  if (top.length >= 2) {
    add({
      id: 'thank-contributors', type: 'thank_contributors', priority: 'low', weight: top.length,
      title: 'Recognise your top contributors',
      why: 'The same few people usually answer newcomers and keep ideas flowing. Naming them makes them stay and shows others what is valued.',
      actions: ['Post a shout-out', 'Consider a role or small reward'],
      draft: `Shout-out to this week's top contributors: ${top.map((p) => p.username).join(', ')}. Thank you for the ideas and answers that make this community better.`,
      evidence: { discussions: [], trends: [] }
    });
  }

  items.sort((a, b) => PRIORITY[a.priority] - PRIORITY[b.priority] || b.weight - a.weight);
  const notice = !discussions.length
    ? 'No community messages have been read yet, so these suggestions come only from outside stories. They sharpen as your chats are read.'
    : null;
  return { items: items.slice(0, 12), notice };
}
