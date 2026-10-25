import { addDiscussion, noteReply, listTrends, touchDiscussions, communityKey, knowledgeChunks } from '../db.js';
import { analyze } from './analyze.js';
import { makeDraft, withinAllowance } from './reply.js';
import { config } from '../config.js';
import { buildContext } from './context.js';
import { notifyNewDiscussion } from './notify.js'; // notify-patch

export { noteReply };

// Set PULSE_DEBUG=true to see why a message was kept or skipped.
export function pulseDebug(platform, why, who, text) {
  if (!config.pulseDebug) return;
  console.log(`[pulse] ${platform} ${who || '?'}: ${why} | "${String(text || '').replace(/\s+/g, ' ').slice(0, 70)}"`);
}

// In Auto mode a draft is prepared in the background. It is only stored,
// never posted. If it fails, the message simply has no draft waiting.
function autoDraft(record, settings) {
  if (!config.pulseAutoDrafts || settings.replyModes?.[record.kind] !== 'auto') return;
  const key = communityKey(record.platform, record.communityId);
  if (!withinAllowance(key, config.draftsPerHour)) return;
  const since = new Date(Date.now() - 4 * 86400000).toISOString();
  makeDraft({ discussion: record, brief: settings.brief, knowledge: knowledgeChunks(key), context: buildContext(key, settings.brief), trends: listTrends({ communityKeys: new Set([key]), since }) })
    .then((d) => { record.draft = { ...d, at: new Date().toISOString() }; touchDiscussions(); })
    .catch((e) => console.error('[pulse] auto draft failed', e.message));
}

export function captureMessage({ settings, platform, communityId, communityName, channelId, channelName, userId, username, text, messageId, replyToId }) {
  try {
    if (settings?.intelEnabled === false) { pulseDebug(platform, 'skipped: reading is switched off for this community', username, text); return null; }
    const result = analyze(text);
    if (!result) { pulseDebug(platform, 'skipped: not an idea, question or concern', username, text); return null; }
    const record = addDiscussion({
      platform, communityId: String(communityId), communityName,
      channelId: String(channelId || ''), channelName: channelName || '',
      userId: String(userId), username: username || 'unknown',
      messageId: messageId ? String(messageId) : '', replyToId: replyToId ? String(replyToId) : '',
      text: String(text).replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim().slice(0, 500), // keeps line breaks so separate questions stay separate
      kind: result.kind, score: result.score, topics: result.topics, sentiment: result.sentiment
    });
    pulseDebug(platform, `KEPT as ${result.kind}`, username, text);
    autoDraft(record, settings);
    notifyNewDiscussion(record);
    return record;
  } catch (e) {
    console.error('[pulse] could not keep a message', e.message);
    return null;
  }
}
