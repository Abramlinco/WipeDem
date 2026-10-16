import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oauth1Header, seal, open, tweetLength, hasLink, postCost, COST, postTweet, whoAmI, xIntentUrl, TWEET_LIMIT } from '../src/pulse/x.js';

// The worked example from X's own documentation for signing a request. If this signature comes out
// exactly right, the signing code is right.
test('request signing reproduces the example in X\'s documentation', () => {
  const header = oauth1Header({
    method: 'POST', url: 'https://api.twitter.com/1.1/statuses/update.json',
    query: { include_entities: 'true', status: 'Hello Ladies + Gentlemen, a signed OAuth request!' },
    creds: { apiKey: 'xvz1evFS4wEEPTGEFPHBog', apiSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
      accessToken: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb', accessSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE' },
    nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg', timestamp: 1318622958
  });
  // X's "Creating a signature" page documents hCtSmYh+iHYCEqBWrE7C7hYmtUk= for exactly these inputs
  // (percent-encoded inside the header).
  assert.match(header, /oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"/);
});

test('keys are stored encrypted, open only with the right secret, and refuse tampering', () => {
  const creds = { apiKey: 'k', apiSecret: 's', accessToken: 't', accessSecret: 'ts' };
  const blob = seal(creds, 'a long secret value');
  assert.ok(!blob.includes('apiSecret') && !blob.includes('"s"'), 'nothing readable in the stored text');
  assert.deepEqual(open(blob, 'a long secret value'), creds);
  assert.throws(() => open(blob, 'a different secret'), /Could not unlock/);
  const parts = blob.split('.'); parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith('AA') ? 'BB' : 'AA');
  assert.throws(() => open(parts.join('.'), 'a long secret value'), /Could not unlock/);
  assert.throws(() => open('garbage', 'x'), /unreadable/);
  assert.throws(() => seal(creds, ''), /SENTINEL_SECRET/);
  assert.notEqual(seal(creds, 'a long secret value'), blob, 'every save uses a fresh random value');
});

test('post length counts a link as 23 characters, and links cost far more', () => {
  const link = 'https://example.com/a/very/long/path/that/goes/on/and/on/and/on?with=query&and=more';
  assert.equal(tweetLength(`Read this ${link}`), 'Read this '.length + 23);
  assert.equal(tweetLength('x'.repeat(280)), 280);
  assert.ok(tweetLength('x'.repeat(281)) > TWEET_LIMIT);
  assert.equal(hasLink('no link here'), false);
  assert.equal(postCost('plain post'), COST.post);
  assert.equal(postCost(`with ${link}`), COST.postWithLink);
  assert.match(xIntentUrl('Hi & bye #web3'), /^https:\/\/x\.com\/intent\/post\?text=Hi%20%26%20bye%20%23web3$/);
});

const creds = { apiKey: 'k', apiSecret: 's', accessToken: 't', accessSecret: 'ts' };
const reply = (status, body) => async (url, opts) => { reply.last = { url, opts }; return new Response(JSON.stringify(body), { status }); };

test('a post is sent as JSON with a signed header, and the link to it is returned', async () => {
  const r = await postTweet(creds, 'Hello from Sentinel', { fetcher: reply(201, { data: { id: '12345', text: 'Hello from Sentinel' } }) });
  assert.equal(r.id, '12345');
  assert.equal(r.url, 'https://x.com/i/web/status/12345');
  assert.equal(reply.last.url, 'https://api.x.com/2/tweets');
  assert.equal(reply.last.opts.method, 'POST');
  assert.deepEqual(JSON.parse(reply.last.opts.body), { text: 'Hello from Sentinel' });
  assert.match(reply.last.opts.headers.Authorization, /^OAuth oauth_consumer_key="k"/);
  assert.ok(!reply.last.opts.headers.Authorization.includes('"ts"') && !reply.last.opts.headers.Authorization.includes('apiSecret'), 'secrets are never put in the header');
});

test('X problems become plain messages', async () => {
  await assert.rejects(postTweet(creds, 'x'.repeat(300), { fetcher: reply(201, {}) }), /300 characters/);
  await assert.rejects(postTweet(creds, '   ', { fetcher: reply(201, {}) }), /empty/);
  await assert.rejects(postTweet(creds, 'hi', { fetcher: reply(401, {}) }), /refused the keys/);
  await assert.rejects(postTweet(creds, 'hi', { fetcher: reply(402, {}) }), /run out of credits/);
  await assert.rejects(postTweet(creds, 'hi', { fetcher: reply(403, { detail: 'You are not permitted to create a duplicate Tweet.' }) }), /duplicate/);
  await assert.rejects(postTweet(creds, 'hi', { fetcher: reply(429, {}) }), /too many requests/);
});

test('connecting checks whose account the keys belong to', async () => {
  assert.deepEqual(await whoAmI(creds, { fetcher: reply(200, { data: { username: 'quicksilverzone', name: 'Quicksilver' } }) }), { username: 'quicksilverzone', name: 'Quicksilver' });
  assert.equal(reply.last.url, 'https://api.x.com/2/users/me');
  await assert.rejects(whoAmI(creds, { fetcher: reply(200, {}) }), /did not say which account/);
});
