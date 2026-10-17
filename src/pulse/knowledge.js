import { fetchText, decode } from './sources.js';

// The knowledge bank: what Pulse is allowed to know about a community's
// project. Three kinds of source feed it:
//   text       something the manager pasted in
//   url        a web page, such as docs, an FAQ or a tokenomics page, re-read on a schedule
//   defillama  live numbers (TVL, pool yields) with an "as of" time
// Everything is split into chunks. For each question the best chunks are found
// by plain word matching, with no AI and no cost. Replies may only use what is found here.

export const LIMITS = { sourcesPerCommunity: 30, textChars: 60000, chunksPerSource: 150, chunkChars: 700 };

/* ------------------------------------------------------------------ */
/* Web page to plain text                                              */
/* ------------------------------------------------------------------ */

export function htmlToText(html) {
  let h = String(html || '');
  const title = decode((h.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/\s+/g, ' ').trim();
  h = h
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|aside|template|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|ul|ol|table|blockquote|pre)>/gi, '\n')
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<h[1-6][^>]*>/gi, '\n## ')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<[^>]*>/g, ' ');
  const text = decode(decode(h))
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title, text };
}

/* ------------------------------------------------------------------ */
/* Chunking                                                            */
/* ------------------------------------------------------------------ */

export function chunkText(text, size = LIMITS.chunkChars, max = LIMITS.chunksPerSource) {
  const paras = String(text || '').split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let cur = '';
  const push = () => { if (cur.trim().length >= 20) chunks.push(cur.trim()); cur = ''; };
  for (const raw of paras) {
    // A heading always starts a new chunk, so topics stay apart.
    const isHeading = /^#{1,6}\s/.test(raw);
    if (isHeading) { push(); cur = `${raw.replace(/^#{1,6}\s+/, '').replace(/[.:]+$/, '')}.`; continue; }
    const para = raw;
    // A very long paragraph is cut at sentence ends.
    const pieces = para.length > size ? para.split(/(?<=[.!?])\s+/) : [para];
    for (const piece of pieces) {
      if ((cur + ' ' + piece).length > size && cur) push();
      cur = cur ? `${cur} ${piece}` : piece;
      if (cur.length > size * 1.6) push();
    }
    if (cur.length > size * 0.6) push(); // keep topics apart rather than gluing everything together
  }
  push();
  return chunks.slice(0, max);
}

/* ------------------------------------------------------------------ */
/* Finding the right chunk                                             */
/* ------------------------------------------------------------------ */

const STOP = new Set('a an and are as at be but by can do does for from had has have how i if in into is it its just me my of on or our so than that the their them then there these they this to us was we were what when where which who why will with would you your about any also been being could did get got should some such very want need know like please tell can cant dont whats thats admin hello hey guys'.split(' '));

// "staking", "staked", "stake" and "stakes" all become "stak", so questions match however they are worded.
const stem = (w) => (w.length > 3 ? w.replace(/(ing|ed|es|s|e)$/, '') : w);
export function tokenize(text) {
  return (String(text).toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter((w) => !STOP.has(w)).map(stem);
}

/**
 * chunks: [{ text, ... }]. Returns the best matches with a score, best first.
 * A chunk counts only if it matches clearly: two different words from the
 * question, or one rare word. No match is better than a weak one.
 */
export function retrieve(chunks, query, { k = 3 } = {}) {
  const q = [...new Set(tokenize(query))];
  if (!q.length || !chunks.length) return [];
  const docs = chunks.map((c) => { const t = tokenize(`${c.text} ${c.search || ''}`); const tf = new Map(); for (const w of t) tf.set(w, (tf.get(w) || 0) + 1); return { c, tf }; });
  const N = docs.length;
  // With only a few chunks even a rare word scores low, so the bar scales with the amount of text.
  const bar = Math.min(1.6, 0.55 * Math.log(1 + (N + 1) / 0.5));
  const df = new Map();
  for (const w of q) df.set(w, docs.filter((d) => d.tf.has(w)).length);
  const scored = [];
  for (const { c, tf } of docs) {
    let score = 0, matched = 0;
    for (const w of q) {
      const f = tf.get(w);
      if (!f) continue;
      matched++;
      score += Math.log(1 + (N + 1) / ((df.get(w) || 0) + 0.5)) * (1 + Math.log(f));
    }
    if (matched >= 2 || score >= bar) scored.push({ ...c, score: Math.round(score * 100) / 100, matched });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, k);
}

/** The sentences of a chunk that best answer the question, so a reply quotes a line, not a wall of text. */
export function bestSentences(text, query, max = 2) {
  const q = new Set(tokenize(query));
  let sentences = String(text).split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  // The first short line of a chunk is its heading ("Unstaking."). It is context, not part of the answer.
  if (sentences.length > 1 && sentences[0].split(/\s+/).length <= 4) sentences = sentences.slice(1);
  if (sentences.length <= max) return sentences.join(' ');
  const scored = sentences.map((s, i) => ({ s, i, n: tokenize(s).filter((w) => q.has(w)).length }));
  const top = scored.sort((a, b) => b.n - a.n || a.i - b.i).slice(0, max).filter((x) => x.n > 0);
  const picked = (top.length ? top : scored.slice(0, 1)).sort((a, b) => a.i - b.i).map((x) => x.s).join(' ');
  return picked.length > 420 ? `${picked.slice(0, 419)}…` : picked;
}

/* ------------------------------------------------------------------ */
/* Reading a source                                                    */
/* ------------------------------------------------------------------ */

// Returns { title, chunks:[{text, live?, at?}], chars } or throws a readable error.
export async function readSource(source, { fetcher = fetchText, now = new Date() } = {}) {
  if (source.type === 'text') {
    const text = String(source.text || '');
    // `search` is optional, extra words that make a chunk findable without being part of what a reply
    // may quote. An approved FAQ uses it for the member's question, while `text` stays the answer.
    const search = String(source.search || '').trim();
    // chunkText drops fragments under 20 characters, so a very short answer ("About 21 days.") keeps its own chunk.
    const pieces = chunkText(text);
    if (!pieces.length && text.trim()) pieces.push(text.trim());
    return { title: source.title, chunks: pieces.map((t) => (search ? { text: t, search } : { text: t })), chars: text.length };
  }
  if (source.type === 'url') {
    const raw = await fetcher(source.url, { maxBytes: 3 * 1024 * 1024 });
    const isHtml = /<html|<body|<head|<!doctype|<div|<p[ >]/i.test(raw.slice(0, 4000));
    const { title, text } = isHtml ? htmlToText(raw) : { title: '', text: raw.replace(/\r/g, '').trim() };
    const clipped = text.slice(0, LIMITS.textChars * 2);
    if (clipped.length < 40) throw new Error('No readable text found. The page may need JavaScript to load, so paste its text instead.');
    return { title: source.title || title || source.url, chunks: chunkText(clipped).map((t) => ({ text: t })), chars: clipped.length };
  }
  if (source.type === 'defillama') return readDefiLlama(source, { fetcher, now });
  throw new Error('Unknown source type');
}

/* ------------------------------------------------------------------ */
/* DefiLlama live data                                                 */
/* ------------------------------------------------------------------ */

const usd = (n) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${Math.round(n)}`);
const pct = (n) => (Number.isFinite(n) ? `${n.toFixed(2)}%` : 'n/a');
const stamp = (d) => `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
export const SLUG = /^[a-z0-9][a-z0-9._-]{1,59}$/i;

function llamaError(e, what) {
  if (e.status === 401 || e.status === 403) return new Error(`DefiLlama refused the request for ${what}. That data may need a paid DefiLlama plan.`);
  if (e.status === 404) return new Error(`DefiLlama has nothing under "${what}". Check the name: it is the last part of the address on defillama.com.`);
  if (e.status === 429) return new Error('DefiLlama says too many requests. It will retry later.');
  return e;
}

async function readDefiLlama(source, { fetcher, now }) {
  const { tvlSlug, yieldProject, chain } = source.config || {};
  const chunks = [];
  const at = now.toISOString();
  if (tvlSlug) {
    if (!SLUG.test(tvlSlug)) throw new Error('That does not look like a DefiLlama protocol name');
    let tvl;
    try { tvl = JSON.parse(await fetcher(`https://api.llama.fi/tvl/${encodeURIComponent(tvlSlug)}`)); } catch (e) { throw llamaError(e, tvlSlug); }
    if (typeof tvl !== 'number' || !Number.isFinite(tvl)) throw new Error('DefiLlama sent back something unexpected for TVL');
    chunks.push({ live: true, at, search: 'tvl total value locked liquidity deposits', text: `${tvlSlug} total value locked (TVL) is about ${usd(tvl)} as of ${stamp(now)}. Source: DefiLlama.` });
  }
  if (yieldProject) {
    if (!SLUG.test(yieldProject)) throw new Error('That does not look like a DefiLlama yield project name');
    let body;
    // The full pool list is large, so it is read once, filtered, and only the project's pools are kept.
    try { body = JSON.parse(await fetcher('https://yields.llama.fi/pools', { maxBytes: 80 * 1024 * 1024, timeoutMs: 45000 })); } catch (e) { throw llamaError(e, 'yield pools'); }
    const pools = (Array.isArray(body?.data) ? body.data : [])
      .filter((p) => String(p.project).toLowerCase() === yieldProject.toLowerCase() && (!chain || String(p.chain).toLowerCase() === chain.toLowerCase()))
      .sort((a, b) => (b.tvlUsd || 0) - (a.tvlUsd || 0)).slice(0, 10);
    if (!pools.length) throw new Error(`No yield pools found for "${yieldProject}"${chain ? ` on ${chain}` : ''}. Check the project name on defillama.com/yields.`);
    for (const p of pools) {
      chunks.push({ live: true, at, search: 'apy apr yield rate rates interest earn earnings pool pools', text: `${yieldProject} pool ${p.symbol} on ${p.chain}: APY is about ${pct(p.apy)}${Number.isFinite(p.apyBase) ? ` (base ${pct(p.apyBase)}` : ''}${Number.isFinite(p.apyReward) ? `, rewards ${pct(p.apyReward)}` : ''}${Number.isFinite(p.apyBase) ? ')' : ''}, with ${usd(p.tvlUsd || 0)} TVL, as of ${stamp(now)}. Source: DefiLlama. Rates change and can go down.` });
    }
  }
  if (!chunks.length) throw new Error('Add a protocol name, a yield project name, or both');
  return { title: source.title, chunks, chars: chunks.reduce((n, c) => n + c.text.length, 0), url: source.url };
}

export const defiLlamaLink = (config = {}) =>
  config.yieldProject ? `https://defillama.com/yields?project=${encodeURIComponent(config.yieldProject)}`
    : config.tvlSlug ? `https://defillama.com/protocol/${encodeURIComponent(config.tvlSlug)}` : '';

/* ------------------------------------------------------------------ */
/* Finding a project on DefiLlama by name                              */
/* ------------------------------------------------------------------ */

let llamaCache = { at: 0, list: [] };
export const resetProjectCache = () => { llamaCache = { at: 0, list: [] }; };

/**
 * Searches DefiLlama's list of projects by name, so nobody has to know what a "slug" is.
 * The list is large, so it is read once and kept for six hours.
 */
export async function searchProjects(q, { fetcher = fetchText, now = Date.now() } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  if (needle.length < 2) return [];
  if (!llamaCache.list.length || now - llamaCache.at > 6 * 3600000) {
    let body;
    try { body = JSON.parse(await fetcher('https://api.llama.fi/protocols', { maxBytes: 60 * 1024 * 1024, timeoutMs: 45000 })); } catch (e) { throw llamaError(e, 'the project list'); }
    llamaCache = { at: now, list: (Array.isArray(body) ? body : []).filter((p) => p && p.slug && p.name).map((p) => ({
      name: String(p.name), slug: String(p.slug), tvl: Number.isFinite(p.tvl) ? p.tvl : 0, category: String(p.category || ''), chains: (p.chains || []).slice(0, 3).map(String)
    })) };
  }
  const rank = (p) => {
    const n = p.name.toLowerCase(), s = p.slug.toLowerCase();
    return n === needle || s === needle ? 3 : n.startsWith(needle) || s.startsWith(needle) ? 2 : n.includes(needle) || s.includes(needle) ? 1 : 0;
  };
  return llamaCache.list.map((p) => ({ p, r: rank(p) })).filter((x) => x.r > 0)
    .sort((a, b) => b.r - a.r || b.p.tvl - a.p.tvl).slice(0, 8).map((x) => x.p);
}
