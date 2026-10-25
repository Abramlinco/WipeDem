import { config } from '../../config.js';

// One doorway to whatever model is configured. Three modes:
//   none       no model. The built in drafter (templates filled from your
//              Project Brief and the latest stories) is used. Free, always works.
//   openai     any service that speaks the common "chat completions" format.
//              Free tiers of several providers, and a model running on your own
//              computer (Ollama), work this way. Set AI_BASE_URL, AI_API_KEY, AI_MODEL.
//   anthropic  Claude, paid. Set ANTHROPIC_API_KEY.
// Switching later is only an .env change. Nothing else in the app changes.

export function aiStatus() {
  const p = config.aiProvider;
  if (p === 'anthropic') return { mode: 'anthropic', model: config.anthropicModel, label: `Claude (${config.anthropicModel})` };
  if (p === 'openai') return { mode: 'openai', model: config.aiModel, label: `${config.aiModel} via ${hostOf(config.aiBaseUrl)}` };
  return { mode: 'none', model: null, label: 'Built-in drafter (no AI, free)' };
}
const hostOf = (u) => { try { return new URL(u).host; } catch { return 'custom service'; } };

async function post(url, headers, body) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 30000);
  try {
    const res = await fetch(url, { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const text = await res.text();
    if (!res.ok) {
      // Never put the key or the whole response in the message, only the status.
      throw new Error(res.status === 401 || res.status === 403 ? 'The AI key was refused. Check it in .env.'
        : res.status === 429 ? 'The AI service says the limit was reached. Try again in a minute.'
        : `The AI service answered ${res.status}.`);
    }
    return JSON.parse(text);
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('The AI service took too long to answer.');
    throw e;
  } finally { clearTimeout(timer); }
}

/** Returns the model's reply as plain text. Throws a readable error if it fails. */
export async function complete({ system, user, maxTokens = 400 }) {
  const { mode } = aiStatus();
  if (mode === 'anthropic') {
    const r = await post('https://api.anthropic.com/v1/messages',
      { 'x-api-key': config.anthropicKey, 'anthropic-version': '2023-06-01' },
      { model: config.anthropicModel, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] });
    return (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  }
  if (mode === 'openai') {
    // Reasoning models (such as gpt-oss) spend part of max_tokens on thinking, which can leave an empty answer.
    const reasoning = /gpt-oss/i.test(config.aiModel || '');
    const r = await post(`${config.aiBaseUrl.replace(/\/+$/, '')}/chat/completions`,
      config.aiKey ? { Authorization: `Bearer ${config.aiKey}` } : {},
      { model: config.aiModel, max_tokens: reasoning ? maxTokens + 600 : maxTokens, temperature: 0.4, ...(reasoning ? { reasoning_effort: 'low' } : {}), messages: [{ role: 'system', content: system }, { role: 'user', content: user }] });
    return String(r.choices?.[0]?.message?.content || '').trim();
  }
  throw new Error('No AI model is set up.');
}
