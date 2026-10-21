// campaign-ux
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickMode, sourceStat } from '../src/pulse/campaignkit.js';

const plan = [{ role: 'user', kind: 'ask' }, { role: 'assistant', kind: 'plan' }];
const ideasOnly = [{ role: 'assistant', kind: 'ideas' }];

test('the first ask gives ideas, and later asks refine the plan unless the manager starts over', () => {
  assert.equal(pickMode({ stored: [] }), 'ideas');
  assert.equal(pickMode({ stored: ideasOnly }), 'ideas', 'ideas alone are not a plan to refine');
  assert.equal(pickMode({ stored: plan }), 'chat');
  assert.equal(pickMode({ stored: plan, intent: 'chat' }), 'chat');
  assert.equal(pickMode({ stored: plan, intent: 'ideas' }), 'ideas', 'start over works even after a plan exists');
  assert.equal(pickMode({ stored: [], intent: 'chat' }), 'ideas', 'nothing to refine yet');
  assert.equal(pickMode({ stored: plan, intent: 'nonsense' }), 'chat');
});

test('picking an idea always develops it', () => {
  assert.equal(pickMode({ idea: { title: 'x' }, stored: [], intent: 'ideas' }), 'develop');
  assert.equal(pickMode({ idea: { title: 'x' }, stored: plan }), 'develop');
});

test('source status counts stored items and finds the newest read time', () => {
  assert.deepEqual(sourceStat([]), { count: 0, newest: '' });
  assert.deepEqual(sourceStat(undefined), { count: 0, newest: '' });
  const s = sourceStat([{ fetchedAt: '2026-10-20T08:00:00.000Z' }, { publishedAt: '2026-10-20T10:00:00.000Z' }, { fetchedAt: '2026-10-19T08:00:00.000Z', publishedAt: '2026-10-20T11:00:00.000Z' }, {}]);
  assert.equal(s.count, 4);
  assert.equal(s.newest, '2026-10-20T10:00:00.000Z');
});
