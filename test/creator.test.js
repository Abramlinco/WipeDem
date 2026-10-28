import { test } from 'node:test';
import assert from 'node:assert/strict';
import { featureForPath, isPassive } from '../src/creator/features.js';
import { ensureState, recordLogin, accountFor, decide, lockedFor, recordUse, updateAccount, setPlanFeature, setStage, effectivePlan, usageSummary, judge, worst } from '../src/creator/logic.js';

const sess = (d, t) => ({ discord: d ? { user: { id: d, username: 'dee', email: 'd@x.io' } } : null, telegram: t ? { user: { id: t, username: 'tee' } } : null });

test('paths map to features, longest prefix first', () => {
  assert.equal(featureForPath('/pulse/campaigns'), 'campaigns');
  assert.equal(featureForPath('/pulse/campaign-chat'), 'campaigns');
  assert.equal(featureForPath('/pulse/faq-intelligence/scan'), 'faqs');
  assert.equal(featureForPath('/pulse/x/refresh'), 'publishing');
  assert.equal(featureForPath('/pulse/discussions'), 'pulse');
  assert.equal(featureForPath('/settings/discord/1'), null);
  assert.equal(featureForPath('/me'), null);
  assert.ok(isPassive('/stats') && !isPassive('/alerts'));
});

test('install changes nothing: everyone can use everything', () => {
  const data = {}; ensureState(data);
  const acc = recordLogin(data, sess('1', null));
  assert.deepEqual(lockedFor(data, { acc, isCreator: false }), []);
});

test('sign in creates one account and joins discord and telegram', () => {
  const data = {};
  recordLogin(data, sess(null, '9'));
  recordLogin(data, sess('1', null));
  assert.equal(Object.keys(data.creator.accounts).length, 2);
  const joined = recordLogin(data, sess('1', '9'));
  assert.equal(Object.keys(data.creator.accounts).length, 1);
  assert.equal(joined.logins, 3);
  assert.equal(accountFor(data, sess(null, '9')).key, joined.key);
  assert.equal(joined.email, 'd@x.io');
});

test('plan tick boxes, stages, pause and expiry are enforced', () => {
  const data = {}; const acc = recordLogin(data, sess('1', null));
  setPlanFeature(data, 'free', 'faqs', false);
  assert.equal(decide(data, { acc, isCreator: false, featureId: 'faqs' }).code, 'plan');
  assert.equal(decide(data, { acc, isCreator: true, featureId: 'faqs' }).allow, true);
  updateAccount(data, acc.key, { plan: 'pro' });
  assert.equal(decide(data, { acc, isCreator: false, featureId: 'faqs' }).allow, true);
  updateAccount(data, acc.key, { paidUntil: '2020-01-01' });
  assert.equal(effectivePlan(acc), 'free');
  assert.equal(decide(data, { acc, isCreator: false, featureId: 'faqs' }).allow, false);
  setStage(data, 'reports', 'creator');
  assert.equal(decide(data, { acc, isCreator: false, featureId: 'reports' }).code, 'not_released');
  assert.equal(decide(data, { acc, isCreator: true, featureId: 'reports' }).allow, true);
  setStage(data, 'reports', 'off');
  assert.equal(decide(data, { acc, isCreator: false, featureId: 'reports' }).code, 'off');
  updateAccount(data, acc.key, { suspended: true });
  assert.equal(decide(data, { acc, isCreator: false, featureId: 'network' }).code, 'suspended');
  assert.equal(updateAccount(data, acc.key, { plan: 'gold' }).status, 400);
  assert.equal(updateAccount(data, acc.key, { paidUntil: 'soon' }).status, 400);
});

test('usage counts one visit per 10 minutes and feeds the summary', () => {
  const data = {}; const acc = recordLogin(data, sess('1', null));
  const t0 = new Date('2026-01-01T10:00:00Z');
  assert.equal(recordUse(data, acc, 'pulse', t0), true);
  assert.equal(recordUse(data, acc, 'pulse', new Date(t0.getTime() + 60000)), false);
  assert.equal(recordUse(data, acc, 'pulse', new Date(t0.getTime() + 20 * 60000)), true);
  const s = usageSummary(data).find((u) => u.id === 'pulse');
  assert.deepEqual([s.used, s.unused, s.visits], [1, 0, 2]);
});

test('a feature added to the registry later appears without losing settings', () => {
  const data = {}; ensureState(data);
  delete data.creator.features.pools; delete data.creator.plans.pro.features.pools;
  setPlanFeature(data, 'free', 'faqs', false);
  ensureState(data);
  assert.equal(data.creator.features.pools.stage, 'live');
  assert.equal(data.creator.plans.pro.features.pools, true);
  assert.equal(data.creator.plans.free.features.faqs, false);
});

test('health verdicts', () => {
  const ok = { errorsLastHour: 0, serverErrors15m: 0, lagMs: 5, rssMb: 100, uptimeSec: 9999, dbMs: 20 };
  assert.equal(worst(judge(ok)), 'ok');
  assert.equal(worst(judge({ ...ok, serverErrors15m: 2 })), 'warn');
  assert.equal(worst(judge({ ...ok, dbError: 'down' })), 'bad');
  assert.equal(worst(judge({ ...ok, uptimeSec: 30 })), 'warn');
});
