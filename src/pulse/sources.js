import dns from 'node:dns/promises';
import net from 'node:net';
import crypto from 'node:crypto';
import { extractTopics } from './analyze.js';

const UA = 'SentinelPulse/1.0 (community trend reader)';
const MAX_BYTES = 2 * 1024 * 1024;

/* ------------------------------------------------------------------ */
/* Built in sources                                                    */
/* ------------------------------------------------------------------ */

// space: web3 = crypto native, traditional = mainstream business and tech,
// social = what people are talking about publicly. weight nudges ranking.
// These addresses are public feeds. If one stops working the dashboard shows
// it as failing on the Trends tab, and you can swap it here without touching
// anything else.
const reddit = (sub, label, space = 'social', weight = 1) =>
  ({ id: `reddit:${sub}`, type: 'rss', space, label, weight, url: `https://www.reddit.com/r/${sub}/top/.rss?t=day` });

export const DEFAULT_SOURCES = [
  { id: 'cointelegraph', type: 'rss', space: 'web3', label: 'Cointelegraph', weight: 1.2, url: 'https://cointelegraph.com/rss' },
  { id: 'decrypt', type: 'rss', space: 'web3', label: 'Decrypt', weight: 1.2, url: 'https://decrypt.co/feed' },
  { id: 'coindesk', type: 'rss', space: 'web3', label: 'CoinDesk', weight: 1.3, url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { id: 'theblock', type: 'rss', space: 'web3', label: 'The Block', weight: 1.2, url: 'https://www.theblock.co/rss.xml' },
  reddit('CryptoCurrency', 'r/CryptoCurrency', 'social', 1),
  reddit('ethereum', 'r/ethereum', 'social', 1),
  reddit('defi', 'r/defi', 'social', 0.9),
  reddit('web3', 'r/web3', 'social', 0.9),
  { id: 'techcrunch', type: 'rss', space: 'traditional', label: 'TechCrunch', weight: 1, url: 'https://techcrunch.com/feed/' },
  { id: 'hn', type: 'rss', space: 'traditional', label: 'Hacker News', weight: 1, url: 'https://hnrss.org/frontpage?points=150' },
  { id: 'bbc-business', type: 'rss', space: 'traditional', label: 'BBC Business', weight: 0.9, url: 'https://feeds.bbci.co.uk/news/business/rss.xml' }
];

// X is where crypto campaigns, airdrops and community ideas start, so Pulse reads it too. These three
// searches run only when an X key is set, and only a few times a day, because X charges per post read.
export const DEFAULT_X = [
  { id: 'x:airdrops', type: 'x', space: 'social', label: 'X: airdrops and campaigns', weight: 1.3, query: '(airdrop OR "points program" OR testnet OR quest) (crypto OR web3 OR defi) -is:retweet -is:reply lang:en' },
  { id: 'x:community', type: 'x', space: 'social', label: 'X: community and AMAs', weight: 1.2, query: '(AMA OR giveaway OR "community call" OR "ambassador program") (crypto OR web3) -is:retweet -is:reply lang:en' },
  { id: 'x:talk', type: 'x', space: 'social', label: 'X: crypto talk', weight: 1.1, query: '(#DeFi OR #Web3 OR #crypto) -is:retweet -is:reply lang:en' }
];

/** A community's own feed, from its settings, turned into a fetchable source. */
export function customToSource(src, ownerKey) {
  if (src.type === 'reddit') {
    const sub = String(src.value || '').replace(/^r\//i, '');
    if (!/^[A-Za-z0-9_]{2,21}$/.test(sub)) return null;
    return { ...reddit(sub, `r/${sub}`, 'social', 1.1), id: `${ownerKey}|reddit:${sub}`, ownerKey, custom: true };
  }
  if (src.type === 'rss') {
    return { id: `${ownerKey}|rss:${src.value}`, type: 'rss', space: 'web3', label: hostLabel(src.value), weight: 1.1, url: src.value, ownerKey, custom: true };
  }
  if (src.type === 'xaccount') {
    const h = String(src.value || '').replace(/^@/, '');
    if (!/^[A-Za-z0-9_]{1,15}$/.test(h)) return null;
    return { id: `${ownerKey}|xaccount:${h}`, type: 'x', space: 'social', label: `X: @${h}`, weight: 1.2, query: `from:${h} -is:retweet`, ownerKey, custom: true };
  }
  if (src.type === 'x') {
    return { id: `${ownerKey}|x:${src.value}`, type: 'x', space: 'social', label: `X: ${String(src.value).slice(0, 40)}`, weight: 1.1, query: src.value, ownerKey, custom: true };
  }
  return null;
}
const hostLabel = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'Feed'; } };

/* ------------------------------------------------------------------ */
/* Safe fetching                                                       */
/* ------------------------------------------------------------------ */

export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
    return /^f[cd]/.test(v) || /^fe[89ab]/.test(v);
  }
  return true;
}

// A community manager can type in any feed address, and this server will
// fetch it. Without this check someone could point it at an address inside
// your own network (the cloud provider's metadata service, a database admin
// page) and read the answer back through the dashboard. So: https only,
// no local names, and the address it resolves to must be a public one.
export async function assertPublicUrl(urlStr) {
  let u;
  try { u = new URL(urlStr); } catch { throw new Error('Not a valid address'); }
  if (u.protocol !== 'https:') throw new Error('Only https addresses are allowed');
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localdomain')) {
    throw new Error('That address is not public');
  }
  const ips = net.isIP(host.replace(/^\[|\]$/g, ''))
    ? [host.replace(/^\[|\]$/g, '')]
    : (await dns.lookup(host, { all: true })).map((r) => r.address);
  if (!ips.length || ips.some(isPrivateIp)) throw new Error('That address is not public');
  return u;
}

export async function fetchText(url, { headers = {}, timeoutMs = 12000, maxBytes = MAX_BYTES } = {}) {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublicUrl(current); // checked again on every redirect
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(current, { redirect: 'manual', signal: ctl.signal, headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, application/json, */*', ...headers } });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        current = new URL(res.headers.get('location'), current).toString();
        continue;
      }
      if (!res.ok) {
        const err = new Error(`The address answered ${res.status}`); err.status = res.status;
        try { err.body = (await res.text()).slice(0, 300); } catch { /* the body is optional */ } // fix-3
        throw err;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > maxBytes) throw new Error('That page or feed is too large');
      return buf.toString('utf8');
    } finally { clearTimeout(timer); }
  }
  throw new Error('Too many redirects');
}

/* ------------------------------------------------------------------ */
/* RSS and Atom reading (no dependency needed)                         */
/* ------------------------------------------------------------------ */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export const decode = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
const plain = (s) => decode(decode(s || '')).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
};

// Only ordinary web links are ever kept, so a feed cannot slip a
// javascript: address into the dashboard.
export function safeHttpUrl(u) {
  try { const p = new URL(String(u).trim()); return /^https?:$/.test(p.protocol) ? p.toString() : ''; } catch { return ''; }
}

export function parseFeed(xml, limit = 20) {
  const items = [];
  const blocks = String(xml).match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
  for (const b of blocks.slice(0, limit)) {
    const title = plain(tag(b, 'title'));
    let link = plain(tag(b, 'link'));
    if (!link) {
      const links = [...b.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
      const alt = links.find((l) => !/rel=["'](?!alternate)/i.test(l)) || links[0] || '';
      link = (alt.match(/href=["']([^"']+)["']/i) || [])[1] || '';
    }
    const summary = plain(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content')).slice(0, 300);
    const when = plain(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'));
    const t = when ? new Date(when) : null;
    const url = safeHttpUrl(decode(link));
    if (!title || !url) continue;
    items.push({ title: title.slice(0, 200), url, summary, publishedAt: t && !isNaN(t) ? t.toISOString() : null });
  }
  return items;
}

/* ------------------------------------------------------------------ */
/* Turning a source into trend records                                 */
/* ------------------------------------------------------------------ */

const trendId = (ownerKey, url) => crypto.createHash('sha1').update(`${ownerKey || ''}|${url}`).digest('hex').slice(0, 16);

function toTrend(source, item) {
  return {
    id: trendId(source.ownerKey, item.url),
    ownerKey: source.ownerKey || null,
    sourceId: source.id, source: source.label, space: source.space, weight: source.weight,
    title: item.title, url: item.url, summary: item.summary || '',
    publishedAt: item.publishedAt, fetchedAt: new Date().toISOString(),
    topics: extractTopics(`${item.title} ${item.title} ${item.summary || ''}`, 6),
    engagement: item.engagement || 0
  };
}

// X needs a paid API key, so it only runs when X_BEARER_TOKEN is set. This
// was written from X's published API description and has not been run
// against the live service from here, so test it once before relying on it.
const X_PER_READ = 10; // X's smallest page for recent search

// Reads one X search. Every post returned is a paid read, so the guard stops the call before it starts
// if the month's limit would be passed, and counts what came back.
async function fetchX(source, bearer, guard) {
  const q = source.query;
  if (!q) throw new Error('This X source has no search in it');
  // The budget is reserved BEFORE the call, in one step with no waiting in between. If several searches
  // start together they can not all pass the check and then all spend. What was not used is given back.
  if (guard && !guard.reserve(X_PER_READ)) throw new Error('The monthly X limit has been reached, so X is paused until next month. You can raise X_MONTHLY_BUDGET_USD in .env.');
  const url = `https://api.x.com/2/tweets/search/recent?${new URLSearchParams({ query: q, max_results: String(X_PER_READ), 'tweet.fields': 'created_at,public_metrics' })}`;
  let data = [];
  try {
    const body = JSON.parse(await fetchText(url, { headers: { Authorization: `Bearer ${bearer}` } }));
    data = body.data || [];
  } catch (e) {
    if (e.status === 401 || e.status === 403) throw new Error('X refused the bearer token. Check X_BEARER_TOKEN in .env.');
    if (e.status === 402) throw new Error('Your X developer account has run out of credits.');
    if (e.status === 429) throw new Error('X says too many requests. It will try again at the next X read.');
    throw e;
  } finally {
    if (guard) await guard.settle(X_PER_READ, data.length);
  }
  return data.map((t) => ({
    title: t.text.replace(/\s+/g, ' ').slice(0, 200),
    url: `https://x.com/i/web/status/${t.id}`,
    summary: '',
    publishedAt: t.created_at || null,
    engagement: (t.public_metrics?.like_count || 0) + 2 * (t.public_metrics?.retweet_count || 0)
  }));
}
export async function fetchSource(source, { xBearer, xGuard } = {}) {
  let items;
  if (source.type === 'x') {
    if (!xBearer) throw new Error('X_BEARER_TOKEN is not set');
    items = await fetchX(source, xBearer, xGuard);
  } else {
    items = parseFeed(await fetchText(source.url));
  }
  return items.map((i) => toTrend(source, i));
}
