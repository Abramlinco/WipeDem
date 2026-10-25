import 'dotenv/config';

const port = Number(process.env.PORT || 3000);

export const config = {
  port,
  host: process.env.HOST || '127.0.0.1',
  // The address people use to reach the dashboard. Discord sends people
  // back to this address after they sign in, so it must match exactly what
  // you register in the Discord Developer Portal.
  publicUrl: (process.env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, ''),
  discordToken: process.env.DISCORD_BOT_TOKEN || '',
  discordClientId: process.env.DISCORD_CLIENT_ID || '',
  discordClientSecret: process.env.DISCORD_CLIENT_SECRET || '',
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
  // Pulse: community ideas and market trends
  pulseEnabled: process.env.PULSE_ENABLED !== 'false',
  pulseRefreshMinutes: Math.max(10, Number(process.env.PULSE_REFRESH_MINUTES) || 30),
  pulseRetentionDays: Math.min(Math.max(Number(process.env.PULSE_RETENTION_DAYS) || 30, 1), 90),
  xBearerToken: process.env.X_BEARER_TOKEN || '',
  xClientId: process.env.X_CLIENT_ID || '',
  xClientSecret: process.env.X_CLIENT_SECRET || '',
  xOAuthRedirectUri: process.env.X_OAUTH_REDIRECT_URI || `${(process.env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, '')}/auth/x/callback`,
  // Reply drafting. See src/pulse/ai/provider.js.
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
  aiBaseUrl: process.env.AI_BASE_URL || '',
  aiKey: process.env.AI_API_KEY || '',
  aiModel: process.env.AI_MODEL || '',
  // Pulse testing aids. PULSE_DEBUG prints why each message was kept or skipped.
  // PULSE_CAPTURE_STAFF lets Pulse read admins too, so you can test with your own account.
  pulseDebug: process.env.PULSE_DEBUG === 'true',
  pulseCaptureStaff: process.env.PULSE_CAPTURE_STAFF === 'true',
  // Pools, X and posting
  secretKey: process.env.SENTINEL_SECRET || '',
  xMonthlyBudgetUsd: process.env.X_MONTHLY_BUDGET_USD ? Math.max(0, Number(process.env.X_MONTHLY_BUDGET_USD) || 0) : 10,
  xRefreshHours: Math.min(Math.max(Number(process.env.X_REFRESH_HOURS) || 12, 1), 72),
  xDefaultFeeds: process.env.X_DEFAULT_FEEDS !== 'false',
  poolRefreshMinutes: Math.max(10, Number(process.env.POOL_REFRESH_MINUTES) || 20),
  draftsPerHour: Math.min(Math.max(Number(process.env.DRAFTS_PER_HOUR) || 60, 5), 1000),
  // Whole-app switches for the two automatic things. Each community still chooses in its own settings; these
  // default to "allowed". Set either to false in .env to force Manual drafts / manual-download reports everywhere.
  pulseAutoDrafts: process.env.PULSE_AUTO_DRAFTS !== 'false',
  technicalAutoDelivery: process.env.TECHNICAL_AUTO_DELIVERY !== 'false',
  // The watcher reads every connected community on its own: it drafts FAQs for gaps in the facts and sends scheduled technical reports.
  pulseWatch: process.env.PULSE_WATCH !== 'false',
  watchMinutes: Math.min(Math.max(Number(process.env.PULSE_WATCH_MINUTES) || 30, 5), 1440),
  // FAQs Intelligence: how many times a question must be asked before it becomes a draft (1 = every uncovered question).
  faqMinAsks: Math.min(Math.max(Number(process.env.FAQ_MIN_ASKS) || 1, 1), 10),
  // How many AI written proposals one scan may request, to stay inside free-tier limits.
  faqAiPerScan: Math.min(Math.max(Number(process.env.FAQ_AI_PER_SCAN) || 8, 0), 50)
};
// Which engine drafts replies. AI_PROVIDER can force one (none, openai, anthropic),
// otherwise the first one that has a key wins, and with no keys it is "none".
config.aiProvider = (() => {
  const want = (process.env.AI_PROVIDER || '').toLowerCase();
  if (want === 'none') return 'none';
  if (want === 'anthropic') return config.anthropicKey ? 'anthropic' : 'none';
  if (want === 'openai') return config.aiBaseUrl && config.aiModel ? 'openai' : 'none';
  if (config.anthropicKey) return 'anthropic';
  if (config.aiBaseUrl && config.aiModel) return 'openai';
  return 'none';
})();

export const discordLoginEnabled = () =>
  !!(config.discordClientId && config.discordClientSecret);
