// The list of things in Sentinel that the creator panel can switch on and off.
//
// HOW TO REGISTER A NEW FEATURE WHEN YOU PUSH ONE
//   1. Add a row to FEATURES below. Give it stage: 'creator' so it ships hidden from users.
//   2. Add the API path it lives under to PATHS.
//   3. Push. It appears in the creator panel under Releases as "waiting for you".
//      Test it yourself, then press "Release to everyone".
// A feature that is not in this list is never blocked.

// stage: 'off' = nobody can use it, 'creator' = only creators (your testing stage), 'live' = everyone the plan allows.
export const FEATURES = [
  { id: 'moderation',    label: 'Moderation and alerts',   blurb: 'Flagged messages, ban, release, caution, member profiles', stage: 'live' },
  { id: 'network',       label: 'Shared ban network',      blurb: 'Search scammers flagged by other communities',            stage: 'live' },
  { id: 'reports',       label: 'Reports',                 blurb: 'Misconduct and growth reports, CSV export',               stage: 'live' },
  { id: 'pulse',         label: 'Pulse',                   blurb: 'Community ideas, questions, concerns, trends, reply drafts', stage: 'live' },
  { id: 'campaigns',     label: 'Campaign planner',        blurb: 'Campaign chat and saved campaign plans',                  stage: 'live' },
  { id: 'faqs',          label: 'FAQs Intelligence',       blurb: 'FAQ drafts built from real member questions',             stage: 'live' },
  { id: 'technical',     label: 'Technical Push',          blurb: 'Technical incident reports and delivery',                 stage: 'live' },
  { id: 'knowledge',     label: 'Facts and knowledge',     blurb: 'Documents and pages the drafter may use',                 stage: 'live' },
  { id: 'pools',         label: 'Pools',                   blurb: 'Pool watching and DefiLlama search',                      stage: 'live' },
  { id: 'publishing',    label: 'Publishing and X',        blurb: 'Posting to the community, connecting X',                  stage: 'live' },
  { id: 'notifications', label: 'Notifications',           blurb: 'Direct message alerts to managers',                       stage: 'live' }
];

// Longest matching prefix wins. Paths are relative to /api.
const PATHS = [
  ['/alerts', 'moderation'], ['/users', 'moderation'],
  ['/network', 'network'],
  ['/reports', 'reports'],
  ['/pulse', 'pulse'],
  ['/pulse/campaign', 'campaigns'],
  ['/pulse/faq-intelligence', 'faqs'],
  ['/pulse/technical-push', 'technical'],
  ['/pulse/knowledge', 'knowledge'],
  ['/pulse/pools', 'pools'], ['/pulse/defillama', 'pools'],
  ['/pulse/x', 'publishing'], ['/pulse/post', 'publishing'], ['/pulse/pool-post', 'publishing'], ['/pulse/channels', 'publishing'],
  ['/notifications', 'notifications']
].sort((a, b) => b[0].length - a[0].length);

// Background calls the dashboard makes on its own on every page. They say nothing about what a person really used.
const PASSIVE = new Set(['/stats', '/me', '/notifications/summary', '/pulse/faq-intelligence/summary']);

export const featureIds = () => FEATURES.map((f) => f.id);
export const getFeature = (id) => FEATURES.find((f) => f.id === id) || null;

export function featureForPath(path) {
  const p = String(path || '').split('?')[0].replace(/\/+$/, '') || '/';
  for (const [prefix, id] of PATHS) {
    if (p === prefix || p.startsWith(prefix + '/') || (prefix.endsWith('campaign') && p.startsWith(prefix))) return id;
  }
  return null;
}
export const isPassive = (path) => PASSIVE.has(String(path || '').split('?')[0].replace(/\/+$/, ''));

// Plans. Everything starts ticked, so installing the panel changes nothing for anyone until you untick a box.
export const PLAN_IDS = ['free', 'pro', 'team'];
export const PLAN_LABELS = { free: 'Free', pro: 'Pro', team: 'Team' };
