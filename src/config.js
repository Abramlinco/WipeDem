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
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || ''
};

export const discordLoginEnabled = () =>
  !!(config.discordClientId && config.discordClientSecret);
