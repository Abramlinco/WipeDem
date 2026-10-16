import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, extractTopics } from '../src/pulse/analyze.js';
import { parseFeed, isPrivateIp, assertPublicUrl, safeHttpUrl, customToSource } from '../src/pulse/sources.js';
import { hotTopics, rankTrends, buildPlaybook, overview } from '../src/pulse/strategist.js';

const NOW = Date.parse('2026-10-05T12:00:00Z');
const ago = (h) => new Date(NOW - h * 3600000).toISOString();

test('chatter is ignored, ideas and questions and concerns are kept', () => {
  assert.equal(analyze('gm everyone'), null);
  assert.equal(analyze('lol ok'), null);
  assert.equal(analyze('check out https://example.com/some/long/path'), null);
  assert.equal(analyze('!help me with something please'), null);
  assert.equal(analyze('We should add a staking dashboard so people can see their rewards').kind, 'idea');
  assert.equal(analyze('How do I claim the airdrop on mobile? Anyone know when the snapshot is?').kind, 'question');
  const c = analyze('The bridge is not working for me, still waiting on my tokens for two days');
  assert.equal(c.kind, 'concern');
  assert.ok(c.sentiment < 0);
  assert.equal(analyze('Great job on the update team, the new app is really smooth').kind, 'praise');
});

test('different spellings fold into one topic', () => {
  assert.ok(extractTopics('I staked yesterday and the staking rewards look great').includes('staking'));
  assert.ok(extractTopics('gas is too high, the fees are crazy').includes('fees'));
});

test('feeds: RSS, Atom, CDATA, entities and unsafe links', () => {
  const rss = `<rss><channel><item><title><![CDATA[Bitcoin &amp; ETH rally]]></title><link>https://a.example/post</link>
    <description>&lt;p&gt;Markets &lt;b&gt;jump&lt;/b&gt;&lt;/p&gt;</description><pubDate>Mon, 05 Oct 2026 10:00:00 GMT</pubDate></item>
    <item><title>Bad link</title><link>javascript:alert(1)</link></item></channel></rss>`;
  const a = parseFeed(rss);
  assert.equal(a.length, 1, 'the javascript: link is dropped');
  assert.equal(a[0].title, 'Bitcoin & ETH rally');
  assert.equal(a[0].summary, 'Markets jump');
  assert.equal(a[0].publishedAt, '2026-10-05T10:00:00.000Z');

  const atom = `<feed><entry><title>Top post</title><link rel="alternate" href="https://reddit.example/r/x/1"/><updated>2026-10-05T09:00:00Z</updated><content type="html">&lt;div&gt;hello&lt;/div&gt;</content></entry></feed>`;
  const b = parseFeed(atom);
  assert.equal(b[0].url, 'https://reddit.example/r/x/1');
  assert.equal(b[0].summary, 'hello');
  assert.equal(safeHttpUrl('data:text/html,hi'), '');
});

test('a feed address cannot point at private or local places', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.9', '172.20.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1']) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  assert.equal(isPrivateIp('8.8.8.8'), false);
  for (const u of ['http://example.com/feed', 'https://localhost/feed', 'https://127.0.0.1/x', 'https://169.254.169.254/latest/meta-data', 'https://[::1]/x', 'https://printer.local/x', 'ftp://example.com/x']) {
    await assert.rejects(assertPublicUrl(u), u);
  }
});

test('custom sources are validated', () => {
  assert.equal(customToSource({ type: 'reddit', value: 'r/solana' }, 'telegram:-1').url, 'https://www.reddit.com/r/solana/top/.rss?t=day');
  assert.equal(customToSource({ type: 'reddit', value: '../../etc' }, 'telegram:-1'), null);
  assert.equal(customToSource({ type: 'rss', value: 'https://x.example/feed' }, 'discord:5').ownerKey, 'discord:5');
});

const disc = (o) => ({ id: Math.random().toString(36).slice(2), platform: 'telegram', communityId: '-1', userId: 'u1', username: 'ann', kind: 'idea', score: 5, topics: [], sentiment: 0, replies: 0, staffReplied: false, status: 'new', text: 'x', createdAt: ago(5), ...o });
const trend = (o) => ({ id: Math.random().toString(36).slice(2), source: 'Decrypt', space: 'web3', weight: 1, title: 'Story', url: 'https://a.example/1', topics: [], publishedAt: ago(2), ...o });

test('a hot topic needs several different people, not one loud one', () => {
  const list = [disc({ userId: 'a', topics: ['airdrop'] }), disc({ userId: 'a', topics: ['airdrop'] }), disc({ userId: 'a', topics: ['airdrop'] }), disc({ userId: 'b', topics: ['staking'] }), disc({ userId: 'c', topics: ['staking'] })];
  const hot = hotTopics(list);
  assert.deepEqual(hot.map((h) => h.topic), ['staking']);
});

test('stories that match community talk are ranked first', () => {
  const hot = [{ topic: 'airdrop' }];
  const ranked = rankTrends([trend({ title: 'Unrelated', topics: ['weather'] }), trend({ title: 'Airdrop news', topics: ['airdrop'], publishedAt: ago(20) })], hot, NOW);
  assert.equal(ranked[0].title, 'Airdrop news');
  assert.deepEqual(ranked[0].matchedTopics, ['airdrop']);
});

test('playbook weighs community talk against outside stories', () => {
  const discussions = [
    disc({ userId: 'a', topics: ['airdrop'], text: 'when is the airdrop snapshot' }),
    disc({ userId: 'b', topics: ['airdrop'], text: 'is the airdrop live yet' }),
    disc({ userId: 'c', topics: ['bridge'], kind: 'concern', text: 'bridge is stuck' }),
    disc({ userId: 'd', topics: ['bridge'], kind: 'concern', text: 'my bridge transfer failed' }),
    disc({ userId: 'e', kind: 'question', text: 'how do i stake', createdAt: ago(3) }),
    disc({ userId: 'f', kind: 'question', text: 'where is the roadmap', createdAt: ago(3) }),
    disc({ userId: 'g', kind: 'question', text: 'is there an app', createdAt: ago(3) }),
    disc({ userId: 'h', kind: 'idea', text: 'add a leaderboard', replies: 3 })
  ];
  const trends = [trend({ title: 'Big airdrop season begins', topics: ['airdrop'] }), trend({ title: 'Fed holds rates', source: 'BBC Business', space: 'traditional', topics: ['rates'] })];
  const { items } = buildPlaybook({ discussions, trends, days: 7, now: NOW });
  const types = items.map((i) => i.type);
  assert.ok(types.includes('ride_wave'), 'airdrop is both discussed and in the news');
  assert.ok(types.includes('address_concern'), 'two people hit the same bridge problem');
  assert.ok(types.includes('answer_questions'), 'three questions nobody answered');
  assert.ok(types.includes('spotlight_idea'));
  assert.ok(types.includes('conversation_starter'), 'a story the community has not touched');
  const wave = items.find((i) => i.type === 'ride_wave');
  assert.ok(wave.draft.length > 20 && wave.actions.length >= 2 && wave.evidence.trends.length);
  const rank = { high: 0, medium: 1, low: 2 };
  assert.deepEqual(items.map((i) => rank[i.priority]), items.map((i) => rank[i.priority]).sort(), 'most urgent first');
});

test('a concern shared by three people, and a topic in two stories, are high priority', () => {
  const discussions = ['a', 'b', 'c'].map((u) => disc({ userId: u, kind: 'concern', topics: ['bridge', 'airdrop'], text: 'bridge stuck' }));
  const trends = [trend({ topics: ['airdrop'] }), trend({ topics: ['airdrop'], title: 'Another airdrop story', url: 'https://a.example/2' })];
  const { items } = buildPlaybook({ discussions, trends, days: 7, now: NOW });
  assert.equal(items.find((i) => i.type === 'address_concern').priority, 'high');
  assert.equal(items.find((i) => i.type === 'ride_wave').priority, 'high');
  assert.equal(items[0].priority, 'high');
});

test('answered questions are not reported as open', () => {
  const qs = [1, 2, 3].map((i) => disc({ userId: `q${i}`, kind: 'question', staffReplied: true, createdAt: ago(3) }));
  assert.ok(!buildPlaybook({ discussions: qs, trends: [], days: 7, now: NOW }).items.some((i) => i.type === 'answer_questions'));
  assert.equal(overview(qs, 7, NOW).totals.openQuestions, 0);
});

test('with no chat data yet the playbook says so and still offers outside stories', () => {
  const pb = buildPlaybook({ discussions: [], trends: [trend({})], days: 7, now: NOW });
  assert.ok(pb.notice);
  assert.equal(pb.items[0].type, 'conversation_starter');
});

test('questions without a question mark are kept, small talk is not', () => {
  assert.equal(analyze('what is the price of the token').kind, 'question');
  assert.equal(analyze('admin when mainnet').kind, 'question');
  assert.equal(analyze('how do i stake').kind, 'question');
  for (const t of ['hello', 'testing 123', 'how are you all doing today', "what's up everyone", 'is anyone here', 'hi admin', 'gm everyone']) {
    assert.equal(analyze(t), null, t);
  }
});

test('a drained pool and a brand new pool become high priority playbook ideas with safe drafts', () => {
  const ev = [
    { id: 'e1', itemId: 'p1', type: 'liquidity_drop', poolLabel: 'OSMO/USDC', text: 'Liquidity in OSMO/USDC fell 50% since the last check, to about $500.0K.', url: 'https://dexscreener.com/osmosis/3505', at: '2026-10-08T10:00:00Z' },
    { id: 'e2', itemId: 'p2', type: 'new_pool', poolLabel: 'QCK pools', text: 'A new pancakeswap pool appeared for QCK.', url: '', at: '2026-10-08T09:00:00Z' },
    { id: 'e3', itemId: 'p1', type: 'liquidity_drop', poolLabel: 'OSMO/USDC', text: 'duplicate of the first', url: '', at: '2026-10-08T09:30:00Z' }
  ];
  const { items } = buildPlaybook({ discussions: [], trends: [], days: 7, now: NOW, poolEvents: ev });
  const pool = items.filter((i) => i.type === 'pool_update');
  assert.equal(pool.length, 2, 'the repeat of the same change is not shown twice');
  assert.ok(pool.every((i) => i.priority === 'high'));
  assert.equal(items[0].type, 'pool_update', 'urgent pool news comes first');
  const drop = pool.find((i) => /Liquidity dropped/.test(i.title));
  assert.match(drop.draft, /DEX Screener, 2026-10-08 10:00 UTC/);
  assert.ok(!/moon|pump|guarantee|10x/i.test(pool.map((i) => i.draft).join(' ')), 'no hype or promises');
  assert.equal(drop.evidence.pools[0].url, 'https://dexscreener.com/osmosis/3505');
  assert.match(pool.find((i) => /new pool/i.test(i.title)).why, /fake pool/);
});
