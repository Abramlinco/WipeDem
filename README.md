# Sentinel

Protects Web3 communities on Telegram and Discord from fake admins and scam DMs.
One dashboard for both platforms, with a shared network that warns you when a
known scammer turns up in your community.

## What it does

- **Catches fake admins.** Admin status is checked by numeric user ID (Telegram)
  and real permissions (Discord) on every message, live. Names, photos and role
  colours prove nothing, so copying them gets a scammer nowhere.
- **No links from anyone except admins and moderators, by default.** This is
  the strict setting and it is on out of the box: any link at all from a non
  admin is removed, and the person is told to open a support ticket and tag a
  mod instead. Turn this off per community from Settings to fall back to a
  smarter mode that only catches foreign Discord invites, link shorteners,
  disguised domains, brand new accounts posting links, and links pushed at
  someone who never asked for one, the common "kindly continue this
  conversation here" redirect pattern.
- **A person already flagged in another community is sent straight to a ban
  review here**, skipping the usual escalation steps entirely, the moment
  they try the same thing in yours.
- **Acts in seconds.** A flagged message is deleted at once. Repeat offenders are
  muted, then flagged for you to ban. Nobody is permanently banned without a human.
- **Also checks edited messages**, because scammers post something harmless and
  edit it into the scam afterwards.
- **You control everything from the dashboard:** phrases, penalties per rule,
  escalation steps, mute times, caution message, per person before sending it.
  No code.
- **Only your communities.** Signing in shows only the servers and groups where
  you are a real admin, checked live. Lose admin rights, lose access.

See `GO-LIVE.md` for a checklist before real users join.

## Pulse: ideas, market trends and a campaign playbook

Pulse is a second job for the same bots. While Sentinel protects, Pulse listens,
so the marketing team and community managers never miss an idea, and always
have something to post. It lives on its own **Pulse** page with three tabs.

- **Ideas.** Telegram on the left, Discord on the right. Every message that
  passes the scam checks is read, and only the useful ones are kept: ideas
  ("we should add..."), questions, concerns and real discussions. "gm" and "lol"
  are thrown away. Filter by kind or by topic, star what matters, mark things
  done, and jump to the original message. Questions that no admin or member has
  replied to are flagged **Unanswered**. A panel shows who is sharing the most.
- **Market trends.** An "oracle" that reads public feeds every 30 minutes: crypto
  news (Cointelegraph, Decrypt, CoinDesk, The Block), Reddit (r/CryptoCurrency,
  r/ethereum, r/defi, r/web3), and mainstream business and tech (TechCrunch,
  Hacker News, BBC Business). Stories that touch what your own community is
  already discussing are pushed to the top and labelled. Each community can add
  its own subreddits or RSS feeds, which only that community sees.
- **Playbook.** Weighs the two sides against each other and suggests things to
  do: ride a topic that is both in your chat and in the news, own a topic only
  your members are driving, answer the open questions, speak to a concern several
  people share, put the best member ideas to a vote, start a conversation about a
  big story your chat has not touched, wake up a quiet community, thank your top
  contributors. Every suggestion comes with steps, a draft post you can edit and
  copy, and the member messages and stories that triggered it.

### Reply drafting (Draft reply button)

Every idea, question and concern on the Ideas tab has a **Draft reply** button.
Pulse works out what kind of message it is (price question, support problem,
project question, market question, idea), builds a reply, and opens it in a
panel where you can edit it, copy it, or press **Approve and send reply** to
post it as a real reply in the chat, from the bot. **Nothing is ever sent
without that button.** There is deliberately no fully automatic mode.

**Project brief** (a tab on the Pulse page, one per community) is where you tell
Pulse what it may say: project name and ticker, what the project is, confirmed
facts (one per line), official links, your policy rules, and words never to use.
A reply can only state facts from the brief or from a news story it names, and
can only contain links from the brief or those stories. If the answer is not in
the brief, the draft says the team is checking, rather than guessing.

Every draft, and every reply at the moment you press Send, is checked by code
(not by the AI) against built in rules: no price predictions, no promised
returns, airdrops, listings or dates, no "10x" or "guaranteed", no financial
advice, no "DM me", no links that are not yours. A reply that fails is blocked on
the server, and the panel lists what to fix. Add your own banned phrases in the brief.

**Two drafting engines, switched in `.env`:**

- **Built-in drafter (default, free, no key).** Fills templates from your brief
  and the latest stories. Plainer, but it works today and costs nothing.
- **An AI model.** Better wording. Fill in either a free or low cost service
  (`AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, which also covers a model on your own
  computer through Ollama) or Claude (`ANTHROPIC_API_KEY`) when you are ready to
  pay. Switching is only an `.env` change. If the AI is down, rate limited, or
  writes something that breaks a rule, Pulse falls back to the built-in drafter
  and tells you. Check the data terms of any free service: your brief and the
  member's message are sent to it. `DRAFTS_PER_HOUR` caps usage per community.

On a phone the bottom bar shows Home, Discord, Telegram and Pulse, and a
**More** button opens Reports, Network, Settings, Account and Log out.

### Knowledge bank (Pulse > Setup > Knowledge)

The Project brief holds a few confirmed facts. The knowledge bank holds everything else a
reply may be based on, per community:

- **Web pages:** your docs, FAQ or tokenomics page. Pulse reads the page, keeps the text,
  and re-reads it on a schedule (6 hours to a week) so answers stay current. Addresses must
  be public https links. Pages that need JavaScript to load cannot be read, so paste their text.
- **Pasted text:** anything not on a public page. Use `## Heading` lines to keep topics apart.
- **DefiLlama:** search for your project by name and Sentinel keeps its TVL (total value locked) up to date, with the time it was read.

For each question in a message, Pulse finds the best matching sections by plain word matching
(no AI, no cost) and replies only from them, naming the source and linking to it. If nothing
matches well, the draft says the team will check, instead of guessing. Price questions never use
the knowledge bank. A **Test what Pulse knows** box lets you type a question and see exactly
which sources would be used, without sending anything. Live numbers come with an "as of" time and
a note that rates change.

**DefiLlama caveat:** TVL comes from DefiLlama's free API. Whether pool yield (APY) data is free
is unclear: DefiLlama's own SDKs list it under a paid plan, while other sources describe a public
endpoint. Sentinel tries the public endpoint and, if DefiLlama refuses, shows a plain message in
the Knowledge list. These connectors were tested against a simulated DefiLlama, not the live service,
so add one on your own machine and check the result.

A message with several questions gets each part answered as a short list, and small talk such as
"hello everyone" is ignored.

### First-time guide and appearance

- **Welcome card and tour.** The first time someone signs in they see a short card saying what
  Sentinel does, then an optional spotlight tour of the navigation (on a phone it opens the More
  menu to show Reports, Network and Settings).
- **Page notes.** The first time each page is opened, a short note at the top says what the page
  is for and what its buttons do. "Got it" hides it for good.
- **Hover tips.** With the guide on, hovering a button (Ban, Release, Caution, Draft reply, Star,
  Done and so on) says what it does. On a phone, the first tap on each kind of button shows its tip.
- **Guide button** (bottom of the sidebar, or the More menu on a phone) turns all of this on or off.
  Turning it back on shows the page notes again. Everything is remembered in that browser only.
- **Light and dark.** The Dark mode button switches theme. Without a choice, Sentinel follows the device.
- To see the welcome card again while testing, run `localStorage.removeItem('sentinel.welcomed')` in the
  browser console and reload.
- To add a hover tip for a new button, add a line to `RULES` in `dashboard/tour.js`: a selector for the
  button and the sentence to show. To change a page note, edit `INTRO` in the same file.

Design notes: one accent colour (a deep teal) is used for primary actions, the active page and keyboard
focus. Green, amber and red appear only where they mean something, and Telegram blue and Discord violet
only identify the platform. All text colours were measured against the 4.5:1 readability target in both themes.

### Pools (Pulse > Pools)

Paste a link to a pool (for example `app.osmosis.zone/pool/3505`, or a Raydium, PancakeSwap, Uniswap or
DEX Screener link), or choose "Every pool for a token" and paste the token's contract address. Sentinel
checks it every 20 minutes (`POOL_REFRESH_MINUTES`) and lists what changed on the Updates feed:

- liquidity dropping 30% or more, or growing 25% or more, compared with yesterday
- trading volume more than doubling
- a **new pool appearing for your token**. Anyone can create a pool for a token, so Sentinel tells you
  to check it was made by your team before members are pointed to it
- a yield (APY) change, for DefiLlama pool links

Big changes also become Playbook ideas (a drained pool is a high priority one), and watched pools feed
replies, so "what is the liquidity in our pool?" is answered with the number and the time it was read.

Liquidity and trading volume come from **DEX Screener** (free, no key, 80+ chains including Osmosis, Solana,
BNB Chain and Ethereum). **DEX Screener does not provide APY or APR.** APY appears only for a DefiLlama pool
link (`defillama.com/yields/pool/...`), and only if DefiLlama allows that on the free plan.

### X (Pulse > Setup > X)

**Reading X.** Set `X_BEARER_TOKEN` in `.env`. X charges for every post it sends (reported at about half a cent
per post for new developers in 2026), so Sentinel keeps a monthly limit, `X_MONTHLY_BUDGET_USD` (10 dollars unless
you change it, 0 turns X off). Every read is counted, the next search is refused before it is sent if it would
pass the limit, and a failed call is refunded. X is read every `X_REFRESH_HOURS` (12), separately from the
half-hourly news feeds, so the normal refresh never spends X credits. Three general searches run by default
(airdrops and campaigns, community ideas, crypto talk, switch off with `X_DEFAULT_FEEDS=false`), plus any accounts
and searches a community adds, plus up to three searches from its Focus topics. Posts appear under Market trends.
The Setup page shows the estimated spend against the limit and has a "Read X now" button (once every ten minutes).

**Posting to X.** There are two ways, and the free one needs nothing:

- **Open in X** (free). X opens with your text ready and you press Post there. No keys, no cost.
- **Post from Sentinel.** Connect a community's X account under Setup > X with the four keys of an X developer app
  that has Read and write permission. Needs `SENTINEL_SECRET` in `.env`, which encrypts the keys before they are saved
  (kept apart from the settings, so they are never sent to the browser). Each post costs about $0.015, or about
  $0.20 if it contains a link, shown before you confirm. **The bill goes to whoever owns the X developer account that
  made the keys.** If you connect one app for many communities, you pay for all their posts.

### Posting to your community (the Post… button)

Playbook ideas have a **Post…** button. Choose any of your communities (and the Discord channel), and X, edit the text,
and confirm. Every destination is checked first with the same rules as replies (no promises, no hype, no unknown links),
a draft that still has `[square brackets]` to fill in is blocked, and nothing is posted unless all of it passes.
Posts are logged with who made them.

### Where settings live

- **Settings** (sidebar): Protection (rules and escalation), Messages, Trusted admins, and a
  Pulse card that points to Pulse setup.
- **Pulse > Setup**: Project brief, Knowledge, Drafting (manual or auto-prepared drafts), Focus
  (topics you care about), and Reading (which communities Pulse reads).

### How it decides (and what that means)

Reading is **rule based, not AI**. It looks for wording like "we should", "how
do I", "not working", plus Web3 vocabulary, and costs nothing per message. That
makes it fast and predictable, but it will miss ideas phrased in unusual ways
and will occasionally keep something that is not an idea. The playbook drafts
are templates filled with your real topics and quotes, not written by an AI.
Both are the natural place to add an AI model later (see below).

### What Pulse keeps, and privacy

Pulse stores up to 500 characters of each idea, question or concern, with the
person's name, for 30 days by default (`PULSE_RETENTION_DAYS`). It never keeps
messages that were flagged as scams. On Discord it skips any channel that
regular members cannot see, so private staff channels are not read. You can
switch reading off per community from the bottom of the Ideas tab. Because this
is members' chat, tell your communities that you do this, and check the rules
of any platform and any local privacy law that applies to you.

### X (Twitter)

Reading X needs a paid X API plan that includes recent search. Put the key in
`X_BEARER_TOKEN`. Without it Pulse simply skips X and uses everything else.
That connection was written from X's published API description and has not been
run against the live service, so test it once before you rely on it.

## Turn on Discord's own free protection too

Sentinel is not the only layer worth having. Discord itself gives every
Community server a free, built in suspicious link filter checked against
Discord's own list of confirmed phishing and malware domains, something no
bot can fully replace since Discord has a threat feed Sentinel does not. In
Discord: **Server Settings → Community** (enable it if it is not on yet),
then **Server Settings → AutoMod**, turn on the suspicious link filter,
Block Spam Content, and Block Mention Spam. This runs before a message even
posts, catching things Sentinel only sees after the fact.

## Dashboard

- **Home:** Telegram on the left, Discord on the right, latest activity for both.
- **Discord / Telegram:** the full dashboard for that platform. Click anyone to see
  their history and Ban, Release or Caution them from the side panel.
- **Reports:** misconduct and community growth (joins, leaves), with CSV download
  and a copy-and-paste summary.
- **Pulse:** community ideas, market trends and the campaign playbook (above).
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

If Sentinel was already added to your server before today, it needs **Manage
Server** to tell your own invite link apart from a foreign one. Without it,
every Discord invite link gets flagged for your review, which is safe, just
more cautious than it needs to be. Re-add the bot using the button above, or
grant Manage Server to its role directly in Server Settings → Roles.

## Checks

```
npm test
```

Covers: nobody sees another community's data, forged requests are refused, Ban /
Release / Caution / Dismiss, settings (including the link policy), reports, CSV
safety, detection (phone apostrophes, whole words, per rule penalties, foreign
Discord invite links, brand new accounts posting links, strict versus smart
link mode, pushed links), the known scammer network override, and many events
at the same moment. 18 checks. Pulse has its own two files: `test/pulse.test.js` (reading, feeds, ranking,
playbook) and `test/reply.test.js` and `test/ai.test.js` (routing, policy rules, drafting, AI fallback),
and `test/pulse-api.test.js` (nobody sees another community's ideas or
feeds, forged requests are refused, private feed addresses are refused, switching
reading off works).

## What is not finished (be honest with customers about these)

- **Data is one JSON file** (`data/db.json`). Fine for you testing. Before paying
  customers, move `src/db.js` to Postgres. It is the only file that touches storage.
- **Pulse feed addresses were not checked against the live internet here.** The
  built in feed list is public addresses written from memory. If one is wrong or
  moves, the Trends tab shows it as Failing with the reason, and you can fix the
  address in `src/pulse/sources.js`. The first run on your machine is the real test.
- **The AI paths have not been run against a live AI service from here.** Both
  were tested against a fake local server, which proves the safety behaviour
  (rule breaking drafts are replaced, keys never leak, member text is treated
  as data) but not each provider's exact responses. Try one draft after you add
  a key. The Claude connection uses Anthropic's documented messages format.
- **Sending a reply needs the bot to be allowed to write in that channel.**
  If it cannot, the panel says so and nothing is marked as replied.
- **The pool and X connections were tested against simulated services, not the live ones.** What was
  verified: the request signing for posting to X reproduces the example in X's own documentation exactly,
  the spend limit holds and refunds failed calls, and the pool reading, change detection and posting checks
  all work. What was not: DEX Screener's real responses (including that its Osmosis pool address is the pool
  number), X's real responses and prices (the rates are from a third-party guide, so confirm them in the X
  Developer Console), and posting through the live Discord and Telegram bots. Try one of each before inviting
  anyone.
- **Pulse reads only what each bot can see.** It cannot read direct messages
  between users, which is where most scam bots do their work (see Detection below).
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
src/pulse/analyze.js   decides what is an idea, question or concern, and finds topics
src/pulse/capture.js   what the bots call for each clean message
src/pulse/sources.js   feed list, RSS reading, safe fetching
src/pulse/feeder.js    the timer that reads the web
src/pulse/strategist.js  weighs chat against trends and builds the playbook
src/api/pulse.js       everything the Pulse page asks for
src/db.js              storage
dashboard/             index.html, style.css, app.js
test/                  automatic checks
```
