import { Router } from 'express';
import {
  listDiscussions, listTrends, setDiscussionStatus, getSettings, saveSettings, getPulseMeta, communityKey,
  getDiscussion, markReplied, touchDiscussions, listFaqDrafts, addFaqDraft, updateFaqDraft,
  getTechnicalSettings, saveTechnicalSettings, listTechnicalReports, addTechnicalReport, markTechnicalReportPushed,
  knowledgeChunks, listKnowledge, addKnowledgeSource, getKnowledgeSource, deleteKnowledgeSource,
  listCampaigns, addCampaign, updateCampaign, deleteCampaign,
  listPoolItems, listPoolEvents, addPoolItem, getPoolItem, deletePoolItem, getXAccount, setXAccount, deleteXAccount, logPost
} from '../db.js';
import { platforms } from '../platform.js';
import { makeDraft, checkPolicy, withinAllowance } from '../pulse/reply.js';
import { applyFocus, focusKeywords, PRESETS } from '../pulse/focus.js';
import { aiStatus, complete } from '../pulse/ai/provider.js';
import { retrieve, bestSentences, SLUG, defiLlamaLink, LIMITS, searchProjects } from '../pulse/knowledge.js';
import { parsePoolInput, CHAIN_NAMES } from '../pulse/pools.js';
import { COST, TWEET_LIMIT, seal, open, whoAmI, postTweet, tweetLength, postCost, xIntentUrl, refreshXOAuth2 } from '../pulse/x.js';
import { overview, hotTopics, rankTrends, buildPlaybook } from '../pulse/strategist.js';
import { refreshTrends, secondsUntilRefreshAllowed, allSources, refreshKnowledgeSource, refreshPoolItem, xStatus, secondsUntilXAllowed, markXManual } from '../pulse/feeder.js';
import { assertPublicUrl, safeHttpUrl } from '../pulse/sources.js';
import { config } from '../config.js';
import crypto from 'node:crypto';
import { saveSessionRecord } from '../db.js';

// Mounted inside the main API router, so sign in, the JSON only rule and
// req.access (which communities this person manages) are already in force.
export const pulseRouter = Router();

const PLATFORMS = ['discord', 'telegram'];
const toInt = (v, min, max, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
};

// Only communities this person manages, narrowed by ?community= and ?platform=.
function scopeKeys(req) {
  let keys = [...req.access.keys];
  const { community, platform } = req.query;
  if (platform) keys = keys.filter((k) => k.startsWith(`${platform}:`));
  if (community && community !== 'all') keys = keys.filter((k) => k === community);
  return new Set(keys);
}

function guard(req, res, next) {
  const { platform, communityId } = req.params;
  if (!PLATFORMS.includes(platform)) return res.status(400).json({ error: 'Unknown platform' });
  if (!req.access.keys.has(communityKey(platform, communityId))) {
    return res.status(403).json({ error: 'You do not manage that community.' });
  }
  next();
}

const sinceIso = (days) => new Date(Date.now() - days * 86400000).toISOString();
const days = (req) => toInt(req.query.days, 1, 30, 7);

// A link that opens the original message in the chat app.
function chatLink(d) {
  if (!d.messageId) return '';
  if (d.platform === 'discord') return `https://discord.com/channels/${d.communityId}/${d.channelId}/${d.messageId}`;
  const id = String(d.communityId);
  return id.startsWith('-100') ? `https://t.me/c/${id.slice(4)}/${d.messageId}` : '';
}

const present = (d) => ({
  id: d.id, platform: d.platform, communityId: d.communityId, communityName: d.communityName,
  channelName: d.channelName, username: d.username, text: d.text, kind: d.kind, score: d.score,
  topics: d.topics, sentiment: d.sentiment, replies: d.replies, staffReplied: d.staffReplied,
  status: d.status, createdAt: d.createdAt, link: chatLink(d), replied: !!d.reply, draftReady: !!d.draft && !d.reply
});

/* ---------- the community side ---------- */

pulseRouter.get('/overview', (req, res) => {
  const d = days(req);
  const list = listDiscussions({ communityKeys: scopeKeys(req), since: sinceIso(d) });
  res.json({
    ...overview(list, d),
    hotTopics: hotTopics(list, { limit: 10 }).map(({ items, ...t }) => t)
  });
});

pulseRouter.get('/discussions', (req, res) => {
  const { platform, kind, status, topic } = req.query;
  const list = listDiscussions({
    communityKeys: scopeKeys(req),
    platform: PLATFORMS.includes(platform) ? platform : undefined,
    kind: ['idea', 'question', 'concern', 'praise', 'discussion'].includes(kind) ? kind : undefined,
    status: ['active', 'new', 'starred', 'done', 'dismissed'].includes(status) ? status : undefined,
    topic: topic ? String(topic).slice(0, 40) : undefined,
    since: sinceIso(days(req)),
    limit: 400
  });
  // Starred first, then most worth reading, then newest.
  list.sort((a, b) => (b.status === 'starred') - (a.status === 'starred') || (b.score + b.replies * 2) - (a.score + a.replies * 2) || b.createdAt.localeCompare(a.createdAt));
  res.json(list.slice(0, 150).map(present));
});

pulseRouter.post('/discussions/:id/status', async (req, res) => {
  const status = req.body?.status;
  if (!['new', 'starred', 'done', 'dismissed'].includes(status)) return res.status(400).json({ error: 'Unknown status' });
  const d = await setDiscussionStatus(req.params.id, req.access.keys, status);
  if (!d) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true, status });
});

/* ---------- the outside world ---------- */

async function focusOf(keys) {
  const all = [];
  for (const k of keys) {
    const i = k.indexOf(':');
    const kw = focusKeywords((await getSettings(k.slice(0, i), k.slice(i + 1))).focus);
    if (!kw.length) return []; // one community has no focus, so show everything
    all.push(...kw);
  }
  return [...new Set(all)];
}

pulseRouter.get('/trends', async (req, res) => {
  const keys = scopeKeys(req);
  const d = days(req);
  const hot = hotTopics(listDiscussions({ communityKeys: keys, since: sinceIso(d) }), { limit: 15 });
  const space = ['web3', 'traditional', 'social'].includes(req.query.space) ? req.query.space : null;
  let trends = listTrends({ communityKeys: keys, since: sinceIso(Math.max(d, 3)) });
  if (space) trends = trends.filter((t) => t.space === space);
  trends = applyFocus(trends, await focusOf(keys));
  res.json(rankTrends(trends, hot).slice(0, 60).map((t) => ({
    id: t.id, title: t.title, url: safeHttpUrl(t.url), source: t.source, space: t.space, summary: t.summary,
    publishedAt: t.publishedAt || t.fetchedAt, topics: t.topics, matchedTopics: t.matchedTopics, own: !!t.ownerKey
  })));
});

pulseRouter.get('/sources', (req, res) => {
  const keys = scopeKeys(req);
  const meta = getPulseMeta();
  res.json({
    lastRefresh: meta.lastRefresh,
    feederOn: config.pulseEnabled,
    xConnected: !!config.xBearerToken,
    sources: allSources().filter((s) => !s.ownerKey || keys.has(s.ownerKey)).map((s) => ({
      id: s.id, label: s.label, space: s.space, custom: !!s.custom, ownerKey: s.ownerKey || null,
      type: s.type, needsKey: s.type === 'x' && !config.xBearerToken, status: meta.sources[s.id] || null
    }))
  });
});

pulseRouter.post('/refresh', async (req, res) => {
  const wait = secondsUntilRefreshAllowed();
  if (wait > 0) return res.status(429).json({ error: `Feeds were just read. Try again in ${wait} seconds.` });
  res.json(await refreshTrends());
});

/* A community's own extra feeds */

pulseRouter.post('/sources/:platform/:communityId', guard, async (req, res) => {
  const { platform, communityId } = req.params;
  const type = req.body?.type;
  let value = String(req.body?.value ?? '').trim().slice(0, 300);
  if (!['reddit', 'rss', 'x', 'xaccount'].includes(type)) return res.status(400).json({ error: 'Choose Reddit, RSS, an X search or an X account' });
  if (!value) return res.status(400).json({ error: 'Type the feed first' });
  if (type === 'reddit') {
    value = value.replace(/^\/?r\//i, '');
    if (!/^[A-Za-z0-9_]{2,21}$/.test(value)) return res.status(400).json({ error: 'That is not a valid subreddit name' });
  }
  if (type === 'xaccount') {
    value = value.replace(/^@/, '');
    if (!/^[A-Za-z0-9_]{1,15}$/.test(value)) return res.status(400).json({ error: 'That is not a valid X username' });
  }
  if (type === 'rss') {
    try { await assertPublicUrl(value); } catch (e) { return res.status(400).json({ error: e.message }); }
  }
  const s = await getSettings(platform, communityId);
  if (s.intelSources.length >= 10) return res.status(400).json({ error: 'That is the most feeds allowed' });
  if (!s.intelSources.some((x) => x.type === type && x.value.toLowerCase() === value.toLowerCase())) s.intelSources.push({ type, value });
  await saveSettings(platform, communityId, s);
  res.json({ ok: true });
});

pulseRouter.delete('/sources/:platform/:communityId', guard, async (req, res) => {
  const { platform, communityId } = req.params;
  const s = await getSettings(platform, communityId);
  s.intelSources = s.intelSources.filter((x) => !(x.type === req.body?.type && x.value === req.body?.value));
  await saveSettings(platform, communityId, s);
  res.json({ ok: true });
});

/* Switch reading a community's chat on or off */

pulseRouter.post('/enabled/:platform/:communityId', guard, async (req, res) => {
  const { platform, communityId } = req.params;
  const s = await getSettings(platform, communityId);
  s.intelEnabled = !!req.body?.enabled;
  await saveSettings(platform, communityId, s);
  res.json({ ok: true, enabled: s.intelEnabled });
});

pulseRouter.get('/enabled', async (req, res) => {
  const out = [];
  for (const c of req.access.communities) out.push({ key: c.key, name: c.name, platform: c.platform, id: c.id, enabled: (await getSettings(c.platform, c.id)).intelEnabled !== false });
  res.json(out);
});

/* ---------- the playbook ---------- */

pulseRouter.get('/playbook', async (req, res) => {
  const keys = scopeKeys(req);
  const d = days(req);
  res.json(buildPlaybook({
    discussions: listDiscussions({ communityKeys: keys, since: sinceIso(d) }),
    trends: applyFocus(listTrends({ communityKeys: keys, since: sinceIso(4) }), await focusOf(keys)),
    days: d,
    poolEvents: listPoolEvents({ communityKeys: keys, since: sinceIso(3), limit: 30 })
  }));
});

/* ---------- Campaign intelligence coordinator ---------- */
pulseRouter.post('/campaign-coordinator', async (req, res) => {
  const b = req.body || {};
  const communityKeyValue = String(b.community || '');
  if (!req.access.keys.has(communityKeyValue)) return res.status(403).json({ error: 'Choose a community you manage.' });
  const source = line(b.source, 40) || 'ai';
  const campaignType = line(b.type, 80) || 'Community campaign';
  const message = line(b.message, 1800);
  const pasted = line(b.example, 3000);
  if (!message && !pasted) return res.status(400).json({ error: 'Tell the coordinator what you want to plan, or paste a campaign example.' });
  const [platform, communityId] = communityKeyValue.split(':', 2);
  const settings = await getSettings(platform, communityId);
  const discussions = listDiscussions({ communityKeys: new Set([communityKeyValue]), since: sinceIso(30), limit: 80 });
  const trends = listTrends({ communityKeys: new Set([communityKeyValue]), since: sinceIso(7) }).slice(0, 12);
  const communityName = req.access.communities.find(c => c.key === communityKeyValue)?.name || 'Selected community';
  const discussionContext = discussions.slice(0, 18).map(d => `- ${d.kind}: ${String(d.text || '').slice(0, 220)}`).join('\n') || 'No recent community discussions are available.';
  const trendContext = trends.map(t => `- ${t.title} (${t.source || 'source unknown'}): ${String(t.summary || '').slice(0, 180)} ${t.url || ''}`).join('\n') || 'No current feed stories are available.';
  const brief = typeof settings.brief === 'string' ? settings.brief : JSON.stringify(settings.brief || {});
  const system = 'You are Sentinel Campaign Coordinator for Web3 community managers. Give actionable, concise campaign advice tailored to the selected community, never invent live source results or claim a campaign is verified unless evidence is supplied. Distinguish source evidence from your recommendation. When asked to draft, provide a ready-to-use draft, objective, steps, participation mechanic, measurement, and optional reward. Avoid token-price promises, financial advice, fake engagement, and unsupported claims. Keep replies readable with headings and bullets.';
  const user = `Community: ${communityName}\nCommunity key: ${communityKeyValue}\nSelected source: ${source}\nSelected campaign type: ${campaignType}\nProject brief: ${String(brief).slice(0, 1800)}\nRecent community conversations:\n${discussionContext}\nCurrent configured feed stories (not a complete live scan of X or Zealy):\n${trendContext}\nUser message: ${message}\nPasted campaign/example: ${pasted}\n\nRespond to the user's latest request. Adapt examples to this community. If the source is X or Zealy and no verified results are supplied, say that the current feed does not prove a live scan and ask for a link or suggest checking configured sources. Do not repeat the entire context.`;
  try {
    if (aiStatus().mode !== 'none') {
      const reply = await complete({ system, user, maxTokens: 520 });
      return res.json({ reply, mode: 'ai', community: communityName, source, type: campaignType });
    }
    const topic = (discussions[0]?.topics || []).slice(0, 3).join(', ');
    const fallback = `Campaign idea: ${campaignType}\n\nObjective: Increase meaningful participation in ${communityName}${topic ? ` around ${topic}` : ''}.\n\nSuggested format: ${source === 'zealy' ? 'Use a quest-style sequence with clear completion criteria.' : source === 'x' ? 'Use an X thread or community post as inspiration, then invite members to participate in your own channels.' : 'Start with a simple community activity and adapt it to member interests.'}\n\nSteps:\n1. Publish a clear introduction and rules.\n2. Ask members to participate with a specific, low-friction task.\n3. Highlight useful contributions and share a short recap.\n\nMeasure: participants, meaningful replies, completed tasks and returning members.\n\nThis is a built-in starter idea, not a live scan of X or Zealy. Configure an AI provider in .env for conversational, context-aware refinement.`;
    return res.json({ reply: fallback, mode: 'built-in', community: communityName, source, type: campaignType });
  } catch (e) { return res.status(502).json({ error: e.message || 'The campaign coordinator could not generate a response.' }); }
});

/* ---------- Campaign planner: saved manager-owned plans ---------- */
pulseRouter.get('/campaigns', (req, res) => res.json(listCampaigns(scopeKeys(req))));
pulseRouter.post('/campaigns', async (req, res) => {
  const b = req.body || {}; const key = String(b.community || '');
  if (!req.access.keys.has(key)) return res.status(403).json({ error: 'Choose a community you manage.' });
  const title = line(b.title, 100);
  if (!title) return res.status(400).json({ error: 'Give the campaign a name.' });
  const rec = { id: crypto.randomUUID(), communityKey: key, title, type: line(b.type, 40) || 'Community challenge', goal: line(b.goal, 240), audience: line(b.audience, 160), platform: line(b.platform, 60) || 'Discord + Telegram', steps: lines(b.steps, 240, 8), reward: line(b.reward, 160), draft: String(b.draft || '').slice(0, 2000), status: 'idea', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await addCampaign(rec); res.status(201).json(rec);
});
pulseRouter.patch('/campaigns/:id', async (req, res) => {
  const allowed = {}; const b = req.body || {};
  if (['idea', 'planned', 'active', 'completed', 'paused'].includes(b.status)) allowed.status = b.status;
  for (const k of ['title', 'goal', 'audience', 'platform', 'reward', 'draft']) if (typeof b[k] === 'string') allowed[k] = b[k].slice(0, k === 'draft' ? 2000 : 240);
  if (Array.isArray(b.steps)) allowed.steps = lines(b.steps, 240, 8);
  const c = await updateCampaign(req.params.id, scopeKeys(req), allowed);
  if (!c) return res.status(404).json({ error: 'Campaign not found in your communities.' }); res.json(c);
});
pulseRouter.delete('/campaigns/:id', async (req, res) => {
  if (!await deleteCampaign(req.params.id, scopeKeys(req))) return res.status(404).json({ error: 'Campaign not found in your communities.' }); res.json({ ok: true });
});

/* ---------- Project Brief: what the reply drafter may use ---------- */

const line = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const lines = (arr, n, max) => (Array.isArray(arr) ? arr : []).map((x) => line(x, n)).filter(Boolean).slice(0, max);

pulseRouter.get('/ai', (req, res) => res.json(aiStatus()));

pulseRouter.get('/brief/:platform/:communityId', guard, async (req, res) => {
  const s = await getSettings(req.params.platform, req.params.communityId);
  res.json(s.brief);
});

pulseRouter.post('/brief/:platform/:communityId', guard, async (req, res) => {
  const { platform, communityId } = req.params;
  const b = req.body || {};
  const links = [];
  for (const l of (Array.isArray(b.links) ? b.links : []).slice(0, 12)) {
    const url = safeHttpUrl(l?.url);
    if (!url || !url.startsWith('https://')) return res.status(400).json({ error: `"${line(l?.url, 60)}" is not an https link` });
    links.push({ label: line(l.label, 40) || 'Link', url });
  }
  const s = await getSettings(platform, communityId);
  s.brief = {
    projectName: line(b.projectName, 80), ticker: line(b.ticker, 12),
    about: String(b.about ?? '').trim().slice(0, 1200),
    facts: lines(b.facts, 300, 30), links,
    policy: String(b.policy ?? '').trim().slice(0, 600),
    bannedPhrases: lines(b.bannedPhrases, 60, 30),
    tone: line(b.tone, 200) || 'Friendly, clear and short.'
  };
  await saveSettings(platform, communityId, s);
  res.json(s.brief);
});

/* ---------- Draft a reply, then send it once a person approves ---------- */

pulseRouter.post('/discussions/:id/draft', async (req, res) => {
  const d = getDiscussion(req.params.id, req.access.keys);
  if (!d) return res.status(404).json({ error: 'Not found' });
  const key = communityKey(d.platform, d.communityId);
  const settings = await getSettings(d.platform, d.communityId);

  // A draft was already prepared automatically. Show it, re-checked against the brief as it is now.
  if (d.draft && !d.reply && req.body?.fresh !== true) {
    const urls = (d.draft.sources || []).map((s) => s.url);
    return res.json({ ...d.draft, flags: checkPolicy(d.draft.text, settings.brief, urls), to: d.username, original: d.text, replied: false });
  }
  if (!withinAllowance(key, config.draftsPerHour)) return res.status(429).json({ error: 'Draft limit for this hour reached. Try again later.' });
  const draft = await makeDraft({
    discussion: d, brief: settings.brief, knowledge: knowledgeChunks(key),
    trends: listTrends({ communityKeys: new Set([key]), since: sinceIso(4) })
  });
  d.draft = { ...draft, at: new Date().toISOString() };
  touchDiscussions();
  res.json({ ...draft, to: d.username, original: d.text, replied: !!d.reply });
});

pulseRouter.post('/discussions/:id/send', async (req, res) => {
  const d = getDiscussion(req.params.id, req.access.keys);
  if (!d) return res.status(404).json({ error: 'Not found' });
  const text = String(req.body?.text ?? '').trim();
  if (!text) return res.status(400).json({ error: 'The reply is empty' });
  if (text.length > 1500) return res.status(400).json({ error: 'Keep the reply under 1500 characters' });
  if (req.body?.approved !== true) return res.status(400).json({ error: 'A person must approve the reply first' });

  // Checked again here, on the server, whatever the page said.
  const settings = await getSettings(d.platform, d.communityId);
  const allowed = (req.body?.sources || []).map((u) => safeHttpUrl(u)).filter(Boolean);
  const flags = checkPolicy(text, settings.brief, allowed);
  if (flags.length) return res.status(422).json({ error: 'The reply breaks a policy rule. Edit it and try again.', flags });

  let ok = false;
  try { ok = await platforms[d.platform].reply(d.communityId, d.channelId, d.messageId, text); }
  catch { ok = false; }
  if (!ok) return res.status(502).json({ error: 'Could not post to the chat. Check the bot can still see and write in that channel.' });
  await markReplied(d.id, req.access.keys, text, req.session.id.slice(0, 8));
  res.json({ ok: true });
});

/* ---------- Draft modes and focus ---------- */

pulseRouter.get('/modes/:platform/:communityId', guard, async (req, res) => {
  const s = await getSettings(req.params.platform, req.params.communityId);
  res.json({ modes: s.replyModes, focus: s.focus, presets: PRESETS.map(({ id, label }) => ({ id, label })) });
});

pulseRouter.post('/modes/:platform/:communityId', guard, async (req, res) => {
  const { platform, communityId } = req.params;
  const s = await getSettings(platform, communityId);
  for (const k of ['question', 'idea', 'concern']) {
    if (['manual', 'auto'].includes(req.body?.modes?.[k])) s.replyModes[k] = req.body.modes[k];
  }
  await saveSettings(platform, communityId, s);
  res.json(s.replyModes);
});

pulseRouter.post('/focus/:platform/:communityId', guard, async (req, res) => {
  const { platform, communityId } = req.params;
  const valid = new Set(PRESETS.map((p) => p.id));
  const topics = [...new Set((Array.isArray(req.body?.topics) ? req.body.topics : []).filter((t) => valid.has(t)))];
  const custom = lines(req.body?.custom, 40, 10);
  const s = await getSettings(platform, communityId);
  s.focus = { topics, custom };
  await saveSettings(platform, communityId, s);
  res.json(s.focus);
});

/* ---------- Knowledge bank: documents, pages and live data ---------- */

const HOURS = [6, 12, 24, 72, 168];
const pickHours = (v, fallback) => (HOURS.includes(Number(v)) ? Number(v) : fallback);

pulseRouter.get('/knowledge/:platform/:communityId', guard, (req, res) => {
  res.json({ sources: listKnowledge(communityKey(req.params.platform, req.params.communityId)), hours: HOURS, maxText: LIMITS.textChars });
});

pulseRouter.post('/knowledge/:platform/:communityId/ask', guard, (req, res) => {
  const key = communityKey(req.params.platform, req.params.communityId);
  const question = String(req.body?.question ?? '').trim().slice(0, 300);
  if (question.length < 3) return res.status(400).json({ error: 'Type a question first' });
  const hits = retrieve(knowledgeChunks(key), question, { k: 3 });
  res.json(hits.map((h) => ({
    title: h.title, url: h.url, live: h.live, at: h.at, score: h.score,
    excerpt: h.live ? h.text : bestSentences(h.text, question, 3)
  })));
});

pulseRouter.post('/knowledge/:platform/:communityId', guard, async (req, res) => {
  const { platform, communityId } = req.params;
  const key = communityKey(platform, communityId);
  const b = req.body || {};
  let src;
  if (b.type === 'text') {
    const text = String(b.text ?? '').trim();
    if (text.length < 40) return res.status(400).json({ error: 'Paste a little more text, at least a few sentences.' });
    if (text.length > LIMITS.textChars) return res.status(400).json({ error: `That is too long. Keep it under ${LIMITS.textChars.toLocaleString('en')} characters, or split it into two.` });
    src = { type: 'text', title: line(b.title, 80) || 'Pasted notes', text, url: '', refreshHours: 0 };
  } else if (b.type === 'url') {
    const url = line(b.url, 500);
    try { await assertPublicUrl(url); } catch (e) { return res.status(400).json({ error: e.message }); }
    src = { type: 'url', title: line(b.title, 80), url, refreshHours: pickHours(b.refreshHours, 24) };
  } else if (b.type === 'defillama') {
    const tvlSlug = line(b.tvlSlug, 60), yieldProject = line(b.yieldProject, 60), chain = line(b.chain, 40);
    if (!tvlSlug && !yieldProject) return res.status(400).json({ error: 'Enter a protocol name, a yield project name, or both.' });
    for (const v of [tvlSlug, yieldProject]) if (v && !SLUG.test(v)) return res.status(400).json({ error: `"${v}" does not look like a DefiLlama name. Use the last part of the address on defillama.com.` });
    const config = { tvlSlug, yieldProject, chain };
    src = { type: 'defillama', title: line(b.title, 80) || `DefiLlama: ${yieldProject || tvlSlug}`, config, url: defiLlamaLink(config), refreshHours: pickHours(b.refreshHours, 6) };
  } else return res.status(400).json({ error: 'Choose a web page, pasted text, or DefiLlama data' });

  let rec;
  try { rec = await addKnowledgeSource(key, src); } catch (e) { return res.status(400).json({ error: e.message }); }
  const result = await refreshKnowledgeSource(rec); // read it now, so a problem shows straight away
  res.json({ source: listKnowledge(key).find((x) => x.id === rec.id), result });
});

pulseRouter.post('/knowledge/:platform/:communityId/:sourceId/refresh', guard, async (req, res) => {
  const key = communityKey(req.params.platform, req.params.communityId);
  const src = getKnowledgeSource(req.params.sourceId, new Set([key]));
  if (!src) return res.status(404).json({ error: 'Not found' });
  if (src.type === 'text') return res.status(400).json({ error: 'Pasted text has nothing to refresh. Remove it and paste the new version.' });
  if (src.lastTried && Date.now() - new Date(src.lastTried).getTime() < 30000) return res.status(429).json({ error: 'Just read a moment ago. Try again in half a minute.' });
  const result = await refreshKnowledgeSource(src);
  res.json({ source: listKnowledge(key).find((x) => x.id === src.id), result });
});

pulseRouter.delete('/knowledge/:platform/:communityId/:sourceId', guard, async (req, res) => {
  const key = communityKey(req.params.platform, req.params.communityId);
  if (!(await deleteKnowledgeSource(req.params.sourceId, new Set([key])))) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

/* ---------- Pool Watch ---------- */

const PLAT_NAME = { discord: 'Discord', telegram: 'Telegram' };
const namesOf = (req) => new Map(req.access.communities.map((c) => [c.key, c.name]));

function poolView(p, names) {
  const hist = p.history || [];
  const day = [...hist].reverse().find((h) => Date.now() - new Date(h.at).getTime() >= 20 * 3600000);
  const ref = day || (hist.length > 1 ? hist[hist.length - 2] : null);
  const cur = p.snapshot;
  return {
    id: p.id, communityKey: p.communityKey, communityName: names.get(p.communityKey) || '', kind: p.kind, chain: p.chain, address: p.address,
    label: p.label || cur?.label || (p.kind === 'pair' ? `${p.chain} pool ${p.address}`.slice(0, 40) : 'Watched'), url: cur?.url || '',
    status: p.status, error: p.error, lastTried: p.lastTried,
    snapshot: cur ? { tvlUsd: cur.tvlUsd ?? null, volume24h: cur.volume24h ?? null, apy: cur.apy ?? null, dex: cur.dex || '', chain: cur.chain || p.chain, at: cur.at, symbol: cur.symbol || '',
      pairCount: cur.pairs?.length ?? null, pairs: cur.pairs?.slice(0, 5).map((x) => ({ label: x.label, dex: x.dex, chain: x.chain, tvlUsd: x.tvlUsd })) } : null,
    tvlChange: ref?.tvlUsd && cur?.tvlUsd != null ? (cur.tvlUsd - ref.tvlUsd) / ref.tvlUsd : null,
    since: day ? 'since yesterday' : 'since the last check'
  };
}

pulseRouter.get('/pools', (req, res) => {
  const keys = scopeKeys(req);
  const names = namesOf(req);
  res.json({
    items: listPoolItems(keys).map((p) => poolView(p, names)),
    events: listPoolEvents({ communityKeys: keys, since: sinceIso(days(req)), limit: 60 }).map((e) => ({ id: e.id, communityName: names.get(e.communityKey) || '', poolLabel: e.poolLabel, type: e.type, severity: e.severity, text: e.text, url: e.url, at: e.at })),
    chains: CHAIN_NAMES
  });
});

pulseRouter.post('/pools/:platform/:communityId', guard, async (req, res) => {
  const { platform, communityId } = req.params;
  const key = communityKey(platform, communityId);
  const b = req.body || {};
  const parsed = parsePoolInput({ mode: b.mode === 'token' ? 'token' : 'pool', input: String(b.input ?? '').slice(0, 300), chain: line(b.chain, 30) });
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  let rec;
  try { rec = await addPoolItem(key, { kind: parsed.kind, chain: parsed.chain, address: parsed.address, label: '', url: '' }); } catch (e) { return res.status(400).json({ error: e.message }); }
  const result = await refreshPoolItem(rec); // read it now, so a wrong link shows straight away
  res.json({ item: poolView(getPoolItem(rec.id, new Set([key])), namesOf(req)), result });
});

pulseRouter.post('/pools/:platform/:communityId/:id/refresh', guard, async (req, res) => {
  const key = communityKey(req.params.platform, req.params.communityId);
  const p = getPoolItem(req.params.id, new Set([key]));
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (p.lastTried && Date.now() - new Date(p.lastTried).getTime() < 60000) return res.status(429).json({ error: 'Just checked a moment ago. Try again in a minute.' });
  const result = await refreshPoolItem(p);
  res.json({ item: poolView(getPoolItem(p.id, new Set([key])), namesOf(req)), result });
});

pulseRouter.delete('/pools/:platform/:communityId/:id', guard, async (req, res) => {
  const key = communityKey(req.params.platform, req.params.communityId);
  if (!(await deletePoolItem(req.params.id, new Set([key])))) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

/* ---------- Finding a project on DefiLlama by name ---------- */

pulseRouter.get('/defillama/search', async (req, res) => {
  try { res.json(await searchProjects(String(req.query.q ?? '').slice(0, 60))); }
  catch (e) { res.status(502).json({ error: e.message }); }
});


/* ---------- FAQs Intelligence: discover knowledge from real conversations ---------- */
pulseRouter.get('/faq-intelligence', (req, res) => {
  const keys = scopeKeys(req);
  res.json(listFaqDrafts(keys));
});

pulseRouter.post('/faq-intelligence/:platform/:communityId/scan', guard, async (req, res) => {
  const { platform, communityId } = req.params;
  const key = communityKey(platform, communityId);
  const since = sinceIso(toInt(req.body?.days, 1, 90, 30));
  const rows = listDiscussions({ communityKeys: new Set([key]), since, limit: 1500 });
  const questions = rows.filter((d) => d.kind === 'question' || d.kind === 'concern')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const groups = new Map();
  for (const d of questions) {
    const topic = (d.topics || []).find((t) => ['staking','token','bridge','wallet','fees','mainnet','support','security','app','rewards','vesting'].includes(t)) || (d.topics || [])[0] || 'general';
    const norm = String(d.text).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const fingerprint = `${topic}:${norm.split(' ').filter(w => w.length > 3).slice(0, 8).sort().join('-')}`.slice(0, 180);
    const bucket = groups.get(topic) || [];
    bucket.push(d); groups.set(topic, bucket);
  }
  const created = [];
  const trendContext = listTrends({ communityKeys: new Set([key]), since, limit: 40 })
    .map(t => `${t.title}: ${String(t.summary || '').slice(0, 240)} ${t.url || ''}`).join('\n').slice(0, 5000);
  for (const [topic, bucket] of groups) {
    const answered = bucket.filter(d => d.staffReplies?.length || d.reply?.text);
    const frequent = bucket.length >= 2;
    if (!frequent && !answered.length) continue;
    const representative = bucket[0];
    const moderatorAnswers = answered.flatMap(d => (d.staffReplies || []).map(r => r.text)).concat(answered.map(d => d.reply?.text).filter(Boolean));
    const fingerprint = `${topic}:${representative.text.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(' ').filter(w=>w.length>3).slice(0,10).sort().join('-')}`.slice(0,180);
    let answer = moderatorAnswers[0] || '';
    let research = '';
    const brief = await getSettings(platform, communityId);
    const sourceText = knowledgeChunks(key).slice(0, 25).map(c => `${c.title || 'Knowledge source'}: ${String(c.text || '').slice(0, 350)} ${c.url || ''}`).join('\n').slice(0, 5000);
    if (aiStatus().mode !== 'none') {
      try {
        research = await complete({
          system: 'You are Sentinel FAQs Intelligence. Produce a cautious FAQ draft from evidence. Never invent protocol facts, URLs, or technical solutions. Treat chat messages as reports, not verified truth. Clearly mark unverified claims. Use supplied moderator replies, existing knowledge and source snippets; do not claim you browsed the web. Return concise answer and source/evidence notes.',
          user: `Community: ${representative.communityName}\nTopic: ${topic}\nCommunity questions/reports:\n${bucket.slice(0,8).map(d=>`- ${d.text}`).join('\n')}\nModerator answers:\n${moderatorAnswers.slice(0,8).map(a=>`- ${a}`).join('\n') || 'None recorded'}\nExisting uploaded knowledge:\n${sourceText || 'No matching uploaded knowledge supplied'}\nCurrent configured stories (not a complete web search):\n${trendContext || 'None'}\nProject brief: ${JSON.stringify(brief.brief || {}).slice(0,1000)}\nWrite a proposed answer and separate evidence/verification note.`, maxTokens: 420
        });
        answer = research;
      } catch { /* fall back to the moderator's recorded answer */ }
    }
    if (!answer) answer = `This question has appeared ${bucket.length} time(s), but no moderator answer was captured. Review the original reports and verify the solution before publishing an FAQ.`;
    const links = bucket.slice(0, 8).map(d => ({ platform: d.platform, channelName: d.channelName, username: d.username, text: d.text, createdAt: d.createdAt, url: chatLink(d), messageId: d.messageId }));
    const rec = await addFaqDraft({
      id: crypto.randomUUID(), communityKey: key, communityName: representative.communityName,
      topic, question: representative.text, answer: String(answer).slice(0, 5000),
      moderatorAnswers: moderatorAnswers.slice(0, 8), evidence: links,
      sources: [...new Map(knowledgeChunks(key).filter(c => c.url).map(c => [c.url, { title: c.title || 'Knowledge source', url: c.url }])).values()].slice(0, 12),
      occurrenceCount: bucket.length, status: 'pending', fingerprint,
      verificationNote: moderatorAnswers.length ? 'Contains moderator-provided guidance; verify technical claims before approval.' : 'No moderator answer was captured. Human verification required.',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    });
    created.push(rec);
  }
  res.json({ scanned: questions.length, created: created.length, drafts: listFaqDrafts(new Set([key])) });
});

pulseRouter.patch('/faq-intelligence/:id', async (req, res) => {
  const patch = {};
  for (const k of ['question', 'answer', 'status']) {
    if (typeof req.body?.[k] === 'string') patch[k] = req.body[k].slice(0, k === 'answer' ? 5000 : 1200);
  }
  if (patch.status && !['pending','approved','dismissed'].includes(patch.status)) return res.status(400).json({ error: 'Unknown FAQ status.' });
  const rec = await updateFaqDraft(req.params.id, req.access.keys, patch);
  if (!rec) return res.status(404).json({ error: 'FAQ draft not found.' });
  // Approval makes the answer reusable by the existing reply drafter.
  if (patch.status === 'approved') {
    const title = `FAQs Intelligence: ${String(rec.question).slice(0, 70)}`;
    const exists = listKnowledge(rec.communityKey).some(s => s.title === title);
    if (!exists) {
      const text = `Question: ${rec.question}\nApproved answer: ${rec.answer}\nVerification note: ${rec.verificationNote || ''}`;
      const src = await addKnowledgeSource(rec.communityKey, { type: 'text', title, text, url: '', refreshHours: 0 });
      // A text knowledge source is indexed by the existing knowledge refresher.
      await refreshKnowledgeSource(src);
    }
  }
  res.json(rec);
});

/* ---------- Technical Push: community-reported engineering issues ---------- */
pulseRouter.get('/technical-push', (req, res) => {
  const keys = scopeKeys(req);
  const settings = Object.fromEntries([...keys].map(key => [key, getTechnicalSettings(key)]));
  res.json({ reports: listTechnicalReports(keys), settings });
});

pulseRouter.post('/technical-push/:platform/:communityId/settings', guard, async (req, res) => {
  const { platform, communityId } = req.params;
  const key = communityKey(platform, communityId);
  const b = req.body || {};
  const cadence = ['daily','weekly','monthly'].includes(b.cadence) ? b.cadence : 'weekly';
  const delivery = ['download','auto'].includes(b.delivery) ? b.delivery : 'download';
  const destinationPlatform = ['discord','telegram'].includes(b.destinationPlatform) ? b.destinationPlatform : '';
  const destinationCommunityId = String(b.destinationCommunityId || '').slice(0, 80);
  const destinationChannelId = String(b.destinationChannelId || '').slice(0, 100);
  if (delivery === 'auto' && (!destinationPlatform || !destinationCommunityId)) return res.status(400).json({ error: 'Choose a destination community for automatic delivery.' });
  const saved = await saveTechnicalSettings(key, { cadence, delivery, destinationPlatform, destinationCommunityId, destinationChannelId, enabled: b.enabled === true });
  res.json(saved);
});

pulseRouter.post('/technical-push/:platform/:communityId/generate', guard, async (req, res) => {
  const { platform, communityId } = req.params;
  const key = communityKey(platform, communityId);
  const daysBack = toInt(req.body?.days, 1, 90, 7);
  const since = sinceIso(daysBack);
  const rows = listDiscussions({ communityKeys: new Set([key]), since, limit: 1500 });
  const technical = rows.filter(d => d.kind === 'concern' || d.kind === 'question' || d.kind === 'discussion')
    .filter(d => /error|fail|bug|broken|stuck|not working|can't|cannot|unable|transaction|migrat|wallet|connect|bridge|claim|stake|unstake|gas|rpc|api|revert|pending|balance|technical|issue|problem|crash|timeout|exploit/i.test(d.text));
  const grouped = new Map();
  for (const d of technical) {
    const topic = (d.topics || []).find(t => ['staking','token','bridge','wallet','fees','mainnet','support','security','app','rewards','vesting'].includes(t)) || 'other technical issue';
    if (!grouped.has(topic)) grouped.set(topic, []);
    grouped.get(topic).push(d);
  }
  const communityName = technical[0]?.communityName || req.access.communities.find(c => c.key === key)?.name || key;
  let summary = '';
  const context = [...grouped.entries()].map(([topic, items]) => `${topic} (${items.length} reports):\n${items.slice(0,8).map(d=>`- [${d.platform}/${d.channelName}] ${d.text}${d.staffReplies?.length ? ` | Moderator response: ${d.staffReplies.map(r=>r.text).join(' / ')}` : ''}`).join('\n')}`).join('\n').slice(0, 10000);
  if (aiStatus().mode !== 'none' && context) {
    try { summary = await complete({ system: 'You are a technical support analyst writing an evidence-led incident report for engineers. Distinguish user-reported symptoms from confirmed root causes. Do not invent logs, metrics, fixes, or root causes. Group related reports and list practical investigation steps.', user: `Project/community: ${communityName}\nPeriod: last ${daysBack} days\n${context}\nWrite: executive summary, grouped issues with counts, symptoms/evidence, moderator actions, developer investigation suggestions, unknowns.`, maxTokens: 900 }); } catch {}
  }
  if (!summary) summary = `TECHNICAL COMMUNITY REPORT\nCommunity: ${communityName}\nPeriod: last ${daysBack} days\nTotal matching reports: ${technical.length}\n\n${[...grouped.entries()].map(([topic, items]) => `${topic.toUpperCase()} — ${items.length} report(s)\n${items.slice(0,12).map(d=>`• ${d.text}${d.staffReplies?.length ? `\n  Moderator reply: ${d.staffReplies.map(r=>r.text).join(' / ')}` : ''}\n  Source: ${chatLink(d) || `${d.platform} · ${d.channelName || 'channel'} · ${d.createdAt}`}`).join('\n')}`).join('\n\n') || 'No matching technical reports were found in this period.'}\n\nRoot cause is not confirmed by these community reports. Developer verification is required.`;
  const report = await addTechnicalReport({ id: crypto.randomUUID(), communityKey: key, communityName, periodDays: daysBack, issueCount: technical.length, groups: [...grouped.entries()].map(([topic, items]) => ({ topic, count: items.length, discussionIds: items.map(d=>d.id) })), sourceLinks: technical.map(d=>({ url: chatLink(d), platform:d.platform, channelName:d.channelName, text:d.text, createdAt:d.createdAt })).slice(0,200), content: summary, createdAt: new Date().toISOString(), pushedAt: null });
  res.status(201).json(report);
});

pulseRouter.post('/technical-push/:id/push', async (req, res) => {
  const report = listTechnicalReports(req.access.keys).find(r => r.id === req.params.id);
  if (!report) return res.status(404).json({ error: 'Technical report not found.' });
  const sourceKey = report.communityKey;
  const settings = getTechnicalSettings(sourceKey);
  if (!settings.destinationPlatform || !settings.destinationCommunityId) return res.status(400).json({ error: 'Configure a destination community in Technical Push settings first.' });
  const targetKey = communityKey(settings.destinationPlatform, settings.destinationCommunityId);
  if (!req.access.keys.has(targetKey)) return res.status(403).json({ error: 'You do not manage the configured destination community.' });
  const ok = await platforms[settings.destinationPlatform].post(settings.destinationCommunityId, settings.destinationChannelId || settings.destinationCommunityId, report.content.slice(0, 3900));
  if (!ok) return res.status(502).json({ error: 'Could not deliver the report to the configured channel.' });
  await markTechnicalReportPushed(report.id, req.access.keys);
  res.json({ ok: true });
});

/* ---------- X ---------- */

pulseRouter.get('/x/:platform/:communityId', guard, (req, res) => {
  const acct = getXAccount(communityKey(req.params.platform, req.params.communityId));
  res.json({ ...xStatus(), bearerSet: !!config.xBearerToken, secretSet: !!config.secretKey, costs: COST, tweetLimit: TWEET_LIMIT,
    account: acct ? { connected: true, handle: acct.handle, since: acct.connectedAt } : { connected: false } });
});

pulseRouter.post('/x/:platform/:communityId/authorize', guard, async (req, res) => {
  if (!config.xClientId) return res.status(400).json({ error: 'Set X_CLIENT_ID and register the callback URL shown in .env.example first.' });
  const state = crypto.randomBytes(24).toString('base64url');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  req.session.xOAuthPending = { state, verifier, communityKey: communityKey(req.params.platform, req.params.communityId), createdAt: Date.now() };
  await saveSessionRecord(req.session);
  const url = new URL('https://x.com/i/oauth2/authorize');
  url.search = new URLSearchParams({ response_type: 'code', client_id: config.xClientId, redirect_uri: config.xOAuthRedirectUri, scope: 'tweet.read tweet.write users.read offline.access', state, code_challenge: challenge, code_challenge_method: 'S256' }).toString();
  res.json({ url: url.toString() });
});

pulseRouter.post('/x/:platform/:communityId/connect', guard, async (req, res) => {
  const key = communityKey(req.params.platform, req.params.communityId);
  if (!config.secretKey) return res.status(400).json({ error: 'Set SENTINEL_SECRET in your .env file first and restart. It encrypts the X keys before they are saved. Make one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"' });
  const b = req.body || {};
  const creds = { apiKey: line(b.apiKey, 200), apiSecret: line(b.apiSecret, 200), accessToken: line(b.accessToken, 200), accessSecret: line(b.accessSecret, 200) };
  if (Object.values(creds).some((v) => !v)) return res.status(400).json({ error: 'Fill in all four keys.' });
  let who;
  try { who = await whoAmI(creds); } catch (e) { return res.status(400).json({ error: e.message }); }
  await setXAccount(key, { sealed: seal(creds, config.secretKey), handle: who.username, connectedAt: new Date().toISOString() });
  res.json({ ok: true, handle: who.username });
});

pulseRouter.delete('/x/:platform/:communityId', guard, async (req, res) => {
  await deleteXAccount(communityKey(req.params.platform, req.params.communityId));
  res.json({ ok: true });
});

// Reads X now. It spends X credits, so it is limited to once every ten minutes.
pulseRouter.post('/x/refresh', async (req, res) => {
  if (!xStatus().readingOn) return res.status(400).json({ error: 'X reading is off. Set X_BEARER_TOKEN in .env, and make sure X_MONTHLY_BUDGET_USD is above 0.' });
  const wait = secondsUntilXAllowed();
  if (wait > 0) return res.status(429).json({ error: `X was just read. It spends credits, so try again in ${Math.ceil(wait / 60)} minute${wait > 60 ? 's' : ''}.` });
  markXManual();
  res.json(await refreshTrends({ only: 'x' }));
});

/* ---------- Posting to your community and to X ---------- */

pulseRouter.get('/channels/:platform/:communityId', guard, async (req, res) => {
  try { res.json(await platforms[req.params.platform].channels(req.params.communityId)); } catch { res.json([]); }
});

const PLACEHOLDER = /\[[^\]\n]{1,60}\]/;

// Posts one approved message to the chosen places. Every destination is checked first, with the same
// rules as replies, so nothing is posted anywhere unless all of it is allowed.
pulseRouter.post('/post', async (req, res) => {
  const b = req.body || {};
  const text = String(b.text ?? '').trim();
  if (!text) return res.status(400).json({ error: 'The post is empty.' });
  if (text.length > 2000) return res.status(400).json({ error: 'Keep the post under 2000 characters.' });
  if (b.approved !== true) return res.status(400).json({ error: 'A person must approve the post first.' });
  const targets = (Array.isArray(b.targets) ? b.targets : []).slice(0, 8);
  const x = b.x && typeof b.x === 'object' ? b.x : null;
  if (!targets.length && !x) return res.status(400).json({ error: 'Choose where to post.' });
  const names = namesOf(req);

  const plan = [];
  for (const t of targets) {
    if (!PLATFORMS.includes(t?.platform)) return res.status(400).json({ error: 'Unknown platform.' });
    const id = String(t.communityId ?? '');
    const key = communityKey(t.platform, id);
    if (!req.access.keys.has(key)) return res.status(403).json({ error: 'You do not manage one of those communities.' });
    if (t.platform === 'discord' && !/^\d{5,25}$/.test(String(t.channelId ?? ''))) return res.status(400).json({ error: 'Choose a Discord channel.' });
    plan.push({ key, platform: t.platform, communityId: id, channelId: String(t.channelId ?? '') });
  }
  let xKey = '', acct = null;
  if (x) {
    if (!PLATFORMS.includes(x.platform)) return res.status(400).json({ error: 'Choose which community this X post belongs to.' });
    xKey = communityKey(x.platform, String(x.communityId ?? ''));
    if (!req.access.keys.has(xKey)) return res.status(403).json({ error: 'You do not manage that community.' });
    if (x.mode === 'api') {
      acct = getXAccount(xKey);
      if (!acct || !config.secretKey) return res.status(400).json({ error: 'No X account is connected for that community.' });
      if (tweetLength(text) > TWEET_LIMIT) return res.status(400).json({ error: `That is ${tweetLength(text)} characters. X allows ${TWEET_LIMIT}. Shorten it for X.` });
    } else if (x.mode !== 'intent') return res.status(400).json({ error: 'Unknown X option.' });
  }

  const extra = (Array.isArray(b.sources) ? b.sources : []).map(safeHttpUrl).filter(Boolean);
  const issues = [];
  for (const key of new Set([...plan.map((p) => p.key), xKey].filter(Boolean))) {
    const i = key.indexOf(':');
    const settings = await getSettings(key.slice(0, i), key.slice(i + 1));
    const known = [...extra, ...knowledgeChunks(key).map((k) => k.url).filter(Boolean)];
    for (const f of checkPolicy(text, settings.brief, known)) issues.push({ ...f, community: names.get(key) || '' });
  }
  const ph = text.match(PLACEHOLDER);
  if (ph) issues.push({ phrase: ph[0], why: 'a part that still needs filling in' });
  if (issues.length) return res.status(422).json({ error: 'Fix these before posting.', flags: issues });

  for (const k of new Set([...plan.map((p) => p.key), acct ? xKey : ''].filter(Boolean))) {
    if (!withinAllowance(`${k}:post`, 30)) return res.status(429).json({ error: 'That is a lot of posts for one hour. Try again later.' });
  }

  const results = [];
  for (const p of plan) {
    const label = `${PLAT_NAME[p.platform]} · ${names.get(p.key) || p.communityId}`;
    try {
      const ok = await platforms[p.platform].post(p.communityId, p.channelId, text);
      results.push(ok ? { label, ok: true } : { label, ok: false, error: 'The bot could not post there. Check that it can see and write in that channel.' });
    } catch { results.push({ label, ok: false, error: 'The bot could not post there. Check that it can see and write in that channel.' }); }
  }
  if (acct) {
    try {
      let creds = open(acct.sealed, config.secretKey);
      if (creds.authType === 'oauth2' && creds.expiresAt && creds.expiresAt < Date.now() + 120000) {
        creds = await refreshXOAuth2(creds, { clientId: config.xClientId, clientSecret: config.xClientSecret });
        await setXAccount(xKey, { ...acct, sealed: seal(creds, config.secretKey), handle: acct.handle });
      }
      const r = await postTweet(creds, text);
      results.push({ label: `X · @${acct.handle}`, ok: true, url: r.url, cost: postCost(text) });
    } catch (e) { results.push({ label: `X · @${acct.handle}`, ok: false, error: e.message }); }
  }
  await logPost({ by: req.session.id.slice(0, 8), where: results.map((r) => `${r.label}${r.ok ? '' : ' (failed)'}`), preview: text.slice(0, 120) });
  res.json({ results, xIntentUrl: x?.mode === 'intent' ? xIntentUrl(text) : undefined, tweetLength: x ? tweetLength(text) : undefined });
});
