import crypto from 'node:crypto';

// Everything about X (Twitter) that is not reading the feed:
//   - posting a tweet with a community's own keys (OAuth 1.0a, signed here, no extra package)
//   - keeping those keys encrypted at rest
//   - working out what a call costs, so nobody is surprised by a bill
// Prices are the pay-per-use rates reported for new X developers in 2026. They can change,
// so they are only used for estimates and for the monthly spend limit.

export const COST = { read: 0.005, post: 0.015, postWithLink: 0.20 };
export const TWEET_LIMIT = 280;

const URL_RE = /https?:\/\/\S+/gi;
export const hasLink = (text) => /https?:\/\/\S+/i.test(String(text || ''));
// X counts every link as 23 characters, however long it is.
export const tweetLength = (text) => [...String(text || '').replace(URL_RE, 'x'.repeat(23))].length;
export const postCost = (text) => (hasLink(text) ? COST.postWithLink : COST.post);
export const xIntentUrl = (text) => `https://x.com/intent/post?text=${encodeURIComponent(String(text || ''))}`;
export const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);

/* ------------------------------------------------------------------ */
/* Encrypted storage for a community's X keys                          */
/* ------------------------------------------------------------------ */

const keyFrom = (secret) => crypto.createHash('sha256').update(String(secret)).digest(); // 32 bytes for AES-256

export function seal(obj, secret) {
  if (!secret) throw new Error('SENTINEL_SECRET is not set');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), enc.toString('base64url')].join('.');
}

export function open(blob, secret) {
  const [v, iv, tag, enc] = String(blob || '').split('.');
  if (v !== 'v1' || !iv || !tag || !enc) throw new Error('Stored keys are unreadable');
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', keyFrom(secret), Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(enc, 'base64url')), d.final()]).toString('utf8'));
  } catch {
    // Wrong secret, or the data was changed. Either way, never hand back half a key.
    throw new Error('Could not unlock the stored X keys. Is SENTINEL_SECRET the same as when they were saved?');
  }
}

/* ------------------------------------------------------------------ */
/* OAuth 1.0a signing                                                  */
/* ------------------------------------------------------------------ */

const enc = (s) => encodeURIComponent(String(s)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export function oauth1Header({ method, url, query = {}, creds, nonce = crypto.randomBytes(16).toString('hex'), timestamp = Math.floor(Date.now() / 1000) }) {
  const oauth = {
    oauth_consumer_key: creds.apiKey, oauth_nonce: nonce, oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(timestamp), oauth_token: creds.accessToken, oauth_version: '1.0'
  };
  // A JSON body is not part of the signature, only the query and the oauth fields are.
  const all = Object.entries({ ...query, ...oauth }).map(([k, v]) => [enc(k), enc(v)]).sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
  const paramStr = all.map(([k, v]) => `${k}=${v}`).join('&');
  const base = [method.toUpperCase(), enc(url), enc(paramStr)].join('&');
  const signature = crypto.createHmac('sha1', `${enc(creds.apiSecret)}&${enc(creds.accessSecret)}`).update(base).digest('base64');
  const header = { ...oauth, oauth_signature: signature };
  return `OAuth ${Object.keys(header).sort().map((k) => `${enc(k)}="${enc(header[k])}"`).join(', ')}`;
}

/* ------------------------------------------------------------------ */
/* Calls                                                               */
/* ------------------------------------------------------------------ */

function xError(status, body) {
  const detail = String(body?.detail || body?.title || '').slice(0, 160);
  if (status === 401) return new Error('X refused the keys. Check all four are copied correctly and that the app has "Read and write" permission.');
  if (status === 402) return new Error('Your X developer account has run out of credits. Add credits in the X Developer Console.');
  if (status === 403) return new Error(`X refused this${detail ? `: ${detail}` : '. The app may only have read permission, or the post may be a duplicate.'}`);
  if (status === 429) return new Error('X says too many requests. Try again in a few minutes.');
  return new Error(`X answered ${status}${detail ? `: ${detail}` : ''}.`);
}

async function call({ method, url, creds, body, fetcher = fetch }) {
  const auth = creds.authType === 'oauth2' ? `Bearer ${creds.accessToken}` : oauth1Header({ method, url, creds });
  const res = await fetcher(url, {
    method,
    headers: { Authorization: auth, 'Content-Type': 'application/json', 'User-Agent': 'SentinelPulse/1.0' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000)
  });
  const text = await res.text();
  let json = {}; try { json = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok) throw xError(res.status, json);
  return json;
}

/** Posts one tweet as the account the keys belong to. Returns { id, url }. */
export async function postTweet(creds, text, { fetcher } = {}) {
  if (!String(text).trim()) throw new Error('The post is empty');
  if (tweetLength(text) > TWEET_LIMIT) throw new Error(`That is ${tweetLength(text)} characters. X allows ${TWEET_LIMIT}. Shorten it and try again.`);
  const j = await call({ method: 'POST', url: 'https://api.x.com/2/tweets', creds, body: { text }, fetcher });
  const id = j?.data?.id;
  if (!id) throw new Error('X accepted the post but did not say where it went.');
  return { id, url: `https://x.com/i/web/status/${id}` };
}

/** Checks the keys work and says whose account they are. */
export async function whoAmI(creds, { fetcher } = {}) {
  const j = await call({ method: 'GET', url: 'https://api.x.com/2/users/me', creds, fetcher });
  if (!j?.data?.username) throw new Error('X did not say which account these keys belong to.');
  return { username: j.data.username, name: j.data.name || '' };
}


/** Exchange an X OAuth 2.0 authorization code using PKCE. */
export async function exchangeXCode({ code, verifier, redirectUri, clientId, clientSecret = '', fetcher = fetch }) {
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier, client_id: clientId });
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'SentinelPulse/1.0' };
  if (clientSecret) headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
  const res = await fetcher('https://api.x.com/2/oauth2/token', { method: 'POST', headers, body, signal: AbortSignal.timeout(15000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`X authorization failed (${res.status}). Check the OAuth 2.0 app settings and callback URL.`);
  const who = await whoAmI({ authType: 'oauth2', accessToken: data.access_token }, { fetcher });
  return { authType: 'oauth2', accessToken: data.access_token, refreshToken: data.refresh_token || '', expiresAt: Date.now() + Math.max(60, Number(data.expires_in) || 7200) * 1000, username: who.username, name: who.name };
}

export async function refreshXOAuth2(creds, { clientId, clientSecret = '', fetcher = fetch } = {}) {
  if (!creds?.refreshToken) throw new Error('X authorization expired. Disconnect and reconnect the X account.');
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: creds.refreshToken, client_id: clientId });
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'SentinelPulse/1.0' };
  if (clientSecret) headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
  const res = await fetcher('https://api.x.com/2/oauth2/token', { method: 'POST', headers, body, signal: AbortSignal.timeout(15000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error('Could not refresh X authorization. Reconnect the account and try again.');
  return { ...creds, accessToken: data.access_token, refreshToken: data.refresh_token || creds.refreshToken, expiresAt: Date.now() + Math.max(60, Number(data.expires_in) || 7200) * 1000 };
}
