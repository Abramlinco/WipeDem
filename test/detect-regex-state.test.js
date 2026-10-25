import test from 'node:test';
import assert from 'node:assert/strict';
import { newAccountWithLink, checkMessage } from '../src/detection/detect.js';

const strictRules = {
  suspiciousLinks: { label: 'Suspicious links', enabled: true, keywords: [], strictMode: true, penalty: { mode: 'escalate', minutes: 10 } }
};

test('a brand new account link is caught every time, not every other message', () => {
  const msg = 'claim your reward at https://free-airdrop.example/claim now';
  for (let i = 0; i < 6; i++) assert.equal(newAccountWithLink(msg, 1), true, `message ${i + 1} was missed`);
});

test('a link check is not affected by an earlier message that had a link', () => {
  newAccountWithLink('see https://a.example/long/path/here please', 1);
  assert.equal(checkMessage('see https://evil.example/x', strictRules).flagged, true);
  assert.equal(newAccountWithLink('hi https://b.example', 1), true);
});
