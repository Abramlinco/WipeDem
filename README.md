# Sentinel

Protects Web3 communities on Telegram and Discord from fake admins and scam DMs.
One dashboard for both platforms, with a shared network that warns you when a
known scammer turns up in your community.

## What it does

- **Catches fake admins.** Admin status is checked by numeric user ID (Telegram)
  and real permissions (Discord) on every message, live. Names, photos and role
  colours prove nothing, so copying them gets a scammer nowhere.
- **Acts in seconds.** A flagged message is deleted at once. Repeat offenders are
  muted, then flagged for you to ban. Nobody is permanently banned without a human.
- **Also checks edited messages**, because scammers post something harmless and
  edit it into the scam afterwards.
- **You control everything from the dashboard:** phrases, penalties per rule,
  escalation steps, mute times, caution message. No code.
- **Only your communities.** Signing in shows only the servers and groups where
  you are a real admin, checked live. Lose admin rights, lose access.

## Dashboard

- **Home:** Telegram on the left, Discord on the right, latest activity for both.
- **Discord / Telegram:** the full dashboard for that platform. Click anyone to see
  their history and Ban, Release or Caution them from the side panel.
- **Reports:** misconduct and community growth (joins, leaves), with CSV download
  and a copy-and-paste summary.
- **Network:** search people flagged anywhere on the network.
- **Settings:** Discord, Telegram and Account.

On a phone the menu moves to the bottom and the profile panel slides up.

## Set up (Node.js 18 or newer)

```
npm install
```

Copy `.env.example` to `.env`, fill in what you have, then:

```
npm run dev
```

Open http://localhost:3000 and sign in.

### Telegram

1. @BotFather: `/newbot`, copy the token into `TELEGRAM_BOT_TOKEN`.
2. @BotFather: `/setprivacy`, choose your bot, **Disable**. Without this the bot
   cannot see normal chat.
3. Add the bot to your group and make it an admin (delete messages, ban users).
4. Send any message in the group. This is how the dashboard learns the group exists.
5. Open the dashboard, **Continue with Telegram**, press Start in Telegram.
   This works on your own computer, no public address needed.

### Discord

1. https://discord.com/developers/applications: create an application.
2. **Bot** tab: copy the token into `DISCORD_BOT_TOKEN`. Turn on **Server Members
   Intent** and **Message Content Intent**.
3. **OAuth2** tab: copy the Client ID and Client Secret into `.env`. Under
   Redirects add exactly `http://localhost:3000/auth/discord/callback`.
4. Restart, then **Continue with Discord**. If Sentinel is not in your server yet,
   the dashboard shows an "Add to (server)" button.

## Checks

```
npm test
```

Covers: nobody sees another community's data, forged requests are refused, Ban /
Release / Caution, settings, reports, CSV safety, detection (phone apostrophes,
whole words, per rule penalties), and many events at the same moment.

## What is not finished (be honest with customers about these)

- **Data is one JSON file** (`data/db.json`). Fine for you testing. Before paying
  customers, move `src/db.js` to Postgres. It is the only file that touches storage.
- **Detection is phrase based.** An AI second opinion for wording it has never seen
  is the next step, and it costs money per message, so it deserves its own decision.
- **Discord sign in and the Telegram sign in link were written to each service's
  documented flow but could not be run against the real services here.** Expect to
  test them yourself first and send me anything that fails.
- **Discord only allows an unverified bot in 100 servers.** After that Discord asks
  you to verify it.
- **Telegram does not report joins/leaves** in some very large groups or when a group
  hides join messages, so growth numbers there can be lower than real.
- **Sessions last 7 days**, stored in the same JSON file.
- `node-telegram-bot-api` shows npm audit warnings from an old dependency. Move to
  Telegraf before you sell this. Do not run `npm audit fix --force`.

## Folder guide

```
src/index.js           starts everything
src/server.js          web server, security headers
src/auth/              sign in (Discord, Telegram) and sessions
src/access.js          works out which communities a person may see, live
src/api/routes.js      everything the dashboard asks for
src/detection/         phrase matching and penalties
src/discord/bot.js     Discord bot
src/telegram/bot.js    Telegram bot
src/platform.js        one place the API calls Ban / Release / Caution through
src/db.js              storage
dashboard/             index.html, style.css, app.js
test/                  automatic checks
```
