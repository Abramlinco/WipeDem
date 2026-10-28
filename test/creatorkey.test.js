import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyLoginEnabled, keyIsValid, issueCookie, hasCookie, locked, fail, succeed, _reset } from '../src/creator/keyauth.js';

const res = () => ({ h: {}, setHeader(k, v) { this.h[k] = v; } });
const cookieOf = (r) => ({ headers: { cookie: r.h['Set-Cookie'].split(';')[0] } });

test('login stays off unless the key is long enough', () => {
  delete process.env.CREATOR_KEY; assert.equal(keyLoginEnabled(), false);
  process.env.CREATOR_KEY = 'short'; assert.equal(keyLoginEnabled(), false); assert.equal(keyIsValid('short'), false);
});

test('only the exact key works', () => {
  process.env.CREATOR_KEY = 'a-long-secret-key-1234567890';
  assert.equal(keyIsValid('a-long-secret-key-1234567890'), true);
  assert.equal(keyIsValid('a-long-secret-key-123456789'), false);
  assert.equal(keyIsValid(''), false);
  assert.equal(keyIsValid(undefined), false);
});

test('cookie is signed, expires, and dies if the key changes', () => {
  process.env.CREATOR_KEY = 'a-long-secret-key-1234567890';
  const r = res(); issueCookie({ headers: {} }, r, 1000);
  assert.match(r.h['Set-Cookie'], /HttpOnly; SameSite=Strict/);
  assert.equal(hasCookie(cookieOf(r), 2000), true);
  assert.equal(hasCookie(cookieOf(r), 1000 + 13 * 3600 * 1000), false);
  const forged = { headers: { cookie: 'sentinel_creator=' + (Date.now() + 99999999) + '.' + 'a'.repeat(64) } };
  assert.equal(hasCookie(forged), false);
  const r2 = res(); issueCookie({ headers: {} }, r2);
  process.env.CREATOR_KEY = 'another-long-secret-key-0987654321';
  assert.equal(hasCookie(cookieOf(r2)), false);
});

test('five wrong keys lock that address out for 15 minutes', () => {
  _reset(); const t = 5000;
  for (let i = 0; i < 4; i++) fail('1.1.1.1', t);
  assert.equal(locked('1.1.1.1', t), false);
  fail('1.1.1.1', t);
  assert.equal(locked('1.1.1.1', t + 1000), true);
  assert.equal(locked('2.2.2.2', t + 1000), false);
  assert.equal(locked('1.1.1.1', t + 16 * 60000), false);
  succeed('1.1.1.1');
});
