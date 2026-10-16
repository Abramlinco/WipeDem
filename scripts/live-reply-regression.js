import assert from 'node:assert/strict';
import { makeDraft } from '../src/pulse/reply.js';
import { aiStatus } from '../src/pulse/ai/provider.js';

if (aiStatus().mode === 'none') {
  console.error('FAIL: AI provider is disabled. Keep AI_PROVIDER=openai and your working Groq settings in .env.');
  process.exit(2);
}

const brief = {
  projectName: 'Quicksilver', ticker: 'QCK', about: 'Liquid staking protocol.',
  facts: ['QCK is the governance token.'],
  links: [{ label: 'Official site', url: 'https://quicksilver.zone/' }],
  policy: 'No price predictions, no financial advice, no promises about returns, listings, airdrops or dates. Never ask anyone to DM.',
  bannedPhrases: [], tone: 'Friendly, concise, helpful.'
};
const discussion = (text) => ({ id: `live-${Date.now()}`, username: 'testmember', text, kind: 'question' });

// Durations are explicitly tied to their chain. Never generalize one chain's
// period to another chain or to a chain-unspecified question.
const officialKnowledge = [
  { title: 'Osmosis Migration Guide', url: 'https://docs.example.org/osmosis-migration',
    text: 'Osmosis Migration Guide. For Osmosis only, the official migration window lasts 14 days. Users should follow the steps displayed on the official migration page. Never share a seed phrase.' },
  { title: 'Cosmos Hub (ATOM) Unstaking FAQ', url: 'https://docs.example.org/atom-unstaking',
    text: 'Cosmos Hub (ATOM) unstaking FAQ. The ATOM unbonding period is 21 days. This duration is specific to Cosmos Hub and should not be applied to other chains. Users can check unbonding status in the official staking dashboard.' }
];

let failed = 0;
async function run(name, fn) {
  try {
    const result = await fn();
    console.log(`\n[${name}]\nvia: ${result.via}\nreply: ${result.text}\nflags: ${JSON.stringify(result.flags)}`);
    console.log(`PASS: ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL: ${name}\n${error.message}`);
  }
}

console.log(`Live reply regression | provider=${aiStatus().label}`);
console.log('These are live-model checks. Results can vary; inspect every printed reply before using it in a real community.');

await run('Chain-specific official migration fact is used only for Osmosis', async () => {
  const r = await makeDraft({ discussion: discussion('For Osmosis, what is the official migration process and how long is its migration window?'), brief, trends: [], knowledge: officialKnowledge });
  assert.ok(/osmosis/i.test(r.text), 'reply should identify the chain');
  assert.ok(/14\s*days/i.test(r.text), 'reply should reflect the official Osmosis-specific 14-day window');
  assert.deepEqual(r.flags, [], 'reply must not trip policy guard');
  return r;
});

await run('Chain-specific ATOM unstaking fact is used without importing Osmosis duration', async () => {
  const r = await makeDraft({ discussion: discussion('What is the unstaking period for ATOM on Cosmos Hub?'), brief, trends: [], knowledge: officialKnowledge });
  assert.ok(/atom|cosmos hub/i.test(r.text), 'reply should identify Cosmos Hub/ATOM');
  assert.ok(/21\s*days/i.test(r.text), 'reply should reflect the official ATOM-specific 21-day period');
  assert.ok(!/14\s*days/i.test(r.text), 'reply must not import the Osmosis-specific duration');
  assert.deepEqual(r.flags, [], 'reply must not trip policy guard');
  return r;
});

await run('Price question receives a safe boundary, not a prediction or financial advice', async () => {
  const r = await makeDraft({ discussion: discussion('Will QCK reach $1 soon? Should I buy now?'), brief, trends: [], knowledge: officialKnowledge });
  assert.ok(/can't talk about price|cannot predict|price prediction|financial advice|can't predict/i.test(r.text), 'reply should state a safe boundary');
  assert.deepEqual(r.flags, [], 'returned reply must pass policy guard');
  assert.ok(!/\b(guaranteed|risk[- ]free|buy now|you should buy|will (reach|rise|pump|double))\b/i.test(r.text), 'reply must not contain unsafe advice or promises');
  assert.equal(r.via, 'template', 'price-sensitive questions must use the deterministic safe template');
  return r;
});

console.log('\nArchitecture check: pending FAQs Intelligence drafts were not supplied to makeDraft; only official knowledge was supplied. This verifies the boundary in this test harness, not every dashboard/API path.');
console.log(`\nSummary: ${failed === 0 ? '3/3 checks passed' : `${3 - failed}/3 checks passed; ${failed} failed`}.`);
process.exitCode = failed === 0 ? 0 : 1;
