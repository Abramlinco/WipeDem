import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { recordLogin, decide, lockedFor, updateAccount } from '../src/creator/logic.js';
import { featureIds } from '../src/creator/features.js';

test('a paused account is blocked everywhere, even on pages that are not a listed feature', () => {
  const data = {};
  const acc = recordLogin(data, { discord: { user: { id: '1', username: 'x' } } });
  updateAccount(data, acc.key, { suspended: true });
  assert.equal(decide(data, { acc, isCreator: false, featureId: null }).code, 'suspended');
  assert.deepEqual(lockedFor(data, { acc, isCreator: false }), featureIds());
  assert.equal(decide(data, { acc, isCreator: true, featureId: null }).allow, true);
  updateAccount(data, acc.key, { suspended: false });
  assert.equal(decide(data, { acc, isCreator: false, featureId: null }).allow, true);
});

test('the creator panel draws real tables, not its own HTML as text', async () => {
  const el = { innerHTML: '', textContent: '', className: '' };
  const now = new Date().toISOString();
  const data = {
    '/overview': { totals: { accounts: 1, newToday: 1, new7d: 1, active24h: 1, active7d: 1, paying: 0, paused: 0, communities: 0, discord: 0, telegram: 0, members: 0, openAlerts: 0, emailsCollected: 0 }, plans: [{ id: 'free', label: 'Free', accounts: 1 }], usage: [{ id: 'pulse', label: 'Pulse', stage: 'live', used: 1, unused: 0, visits: 1 }], waiting: [], recent: [{ key: 'telegram:1', name: '<b>x</b>', firstSeen: now, plan: 'free' }], build: { version: '1', commit: '', startedAt: now, node: 'v22' }, emailEnabled: false },
    '/accounts': { total: 1, accounts: [{ key: 'telegram:1', name: '<img src=x>', email: null, plan: 'free', effectivePlan: 'free', suspended: false, paidUntil: null, lastLogin: now, logins: 1, used: ['pulse'], unused: [] }] }
  };
  const ctx = { document: { querySelector: () => el, addEventListener() {}, hidden: false }, fetch: async (p) => ({ ok: true, status: 200, json: async () => data[p.replace('/api/creator', '').split('?')[0]] || {} }), setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../dashboard/creator.js', import.meta.url), 'utf8') + '\n;globalThis.__setTab = (t) => { tab = t; return load(); };', ctx);
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(el.innerHTML.includes('<table class="cp-table">'), 'overview should contain a real table');
  assert.ok(!el.innerHTML.includes('&lt;div'), 'markup must not be shown as text');
  assert.ok(el.innerHTML.includes('&lt;b&gt;x&lt;/b&gt;'), 'names from users must stay escaped');
  await ctx.__setTab('people');
  assert.ok(el.innerHTML.includes('<table class="cp-table">') && !el.innerHTML.includes('&lt;div'));
  assert.ok(el.innerHTML.includes('&lt;img src=x&gt;') && !el.innerHTML.includes('<img src=x>'));
});
