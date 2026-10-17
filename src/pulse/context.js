import { listDiscussions, listFaqDrafts, listTechnicalReports } from '../db.js';
import { communityContext } from './faqlogic.js';

// What the app has learned about one community, ready to hand to the drafter.
// Kept apart from intelligence.js so the capture path can use it without pulling in the chat bots.
export function buildContext(key, brief = {}) {
  const keys = new Set([key]);
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  return communityContext({
    brief,
    discussions: listDiscussions({ communityKeys: keys, since, limit: 800 }),
    faqDrafts: listFaqDrafts(keys),
    reports: listTechnicalReports(keys)
  });
}
