# Going live: checklist

Do these in order. Each one is a real way a launch goes wrong.

## 1. Where it runs
- Run Sentinel on a small always-on server (a VPS), not your laptop. Node 18 or newer.
- Run **one copy only**. Sentinel keeps its data in a single file in `data/`, and two copies would overwrite each other and use the same bot tokens.
- Keep it running with a process manager such as `pm2` (`pm2 start npm --name sentinel -- start`), so it restarts after a crash or reboot.
- Put HTTPS in front of it with a reverse proxy (Caddy is the simplest, nginx works too). Leave `HOST=127.0.0.1` when the proxy runs on the same machine.

## 2. `.env` for the live server
```
PUBLIC_URL=https://your-real-address
HOST=127.0.0.1
PULSE_DEBUG=false
PULSE_CAPTURE_STAFF=false
```
- `PUBLIC_URL` must be the real https address. Sentinel only marks login cookies `Secure` when it starts with `https`.
- In the Discord Developer Portal add `https://your-real-address/auth/discord/callback` as a Redirect for "Continue with Discord".
- `PULSE_DEBUG` prints member messages into the log, and `PULSE_CAPTURE_STAFF` reads admins as members. Both are for testing only. Sentinel prints a warning at startup if either is still on.
- Never put real keys in `.env.example` or commit `.env`. If a token was ever pasted in a chat or screenshot, reset it in the Developer Portal or @BotFather.

## 3. The bots
- **Discord:** turn on the Message Content and Server Members intents for the bot. Discord requires verification and approval for privileged intents once a bot is in many servers, so check Discord's current rules before inviting lots of communities.
- **Telegram:** make the bot an admin in each group, or turn off its privacy mode in @BotFather, or it will not see ordinary messages.
- Check the bot can write in the channels where you want it to post replies.

## 4. Backups
- Copy the `data/` folder somewhere else every day (a cron job or your host's snapshot feature). It holds your settings, strikes, alerts, the Pulse messages, and the knowledge bank.
- Try restoring a backup once, before you need one.

## 5. Privacy and trust
- Tell each community that Pulse reads public chat for ideas, questions and concerns, keeps them for 30 days (`PULSE_RETENTION_DAYS`), and that admins and private channels are not read. Each community can be switched off under Pulse > Setup > Reading.
- If you connect an AI model, member messages and your knowledge excerpts are sent to that provider. Free tiers of some providers may keep or learn from what they receive. For real communities, prefer a paid plan with clear data terms, or leave AI off and use the built-in drafter.
- Check any privacy law that applies where your members live.

## 6. Start small
- Invite 3 to 5 friendly communities first, not everyone.
- Leave drafting on **Manual** at first. Nothing is ever posted without a person pressing Send, but Manual keeps every draft a deliberate action.
- Give testers one place to send feedback, and ask them for the exact message and the draft they got when something looks wrong.
- Fill in each community's Project brief and Knowledge before they start. Empty ones give generic answers.

## 7. X, pools and posting
- **X costs money.** X charges for every post it sends and for every post you publish. Set `X_MONTHLY_BUDGET_USD`
  to what you are happy to spend. Sentinel stops reading X when the limit is reached, and shows the estimate under
  Pulse > Setup > X. Confirm the current prices in the X Developer Console, because the rates in Sentinel are from
  a 2026 guide and X can change them.
- **Decide who pays for X posting.** Posts made through a connected account are billed to the owner of the X
  developer app that made the keys. For the first testers, prefer **Open in X** (free) and keep the connection for
  communities that bring their own X developer account.
- **`SENTINEL_SECRET` is needed to connect an X account.** Back it up with your `data/` folder and never change it,
  or the saved X keys can no longer be opened (you would just reconnect them).
- X has its own rules for automated accounts. Posting only happens when a person presses Post, but read X's current
  automation rules before connecting a busy brand account. Deleted posts should disappear from your data, so X
  results are only kept for 14 days.
- **Pools:** DEX Screener is free and needs no key, but it is a shared service. Keep `POOL_REFRESH_MINUTES` at 20
  or more and watch a sensible number of pools per community (the limit is 20).
- Every post made with the Post window is logged with who made it. Posts are limited to 30 per hour per community.

## 8. Before you invite anyone
- [ ] `npm test` passes on the server.
- [ ] Startup shows `[discord] Logged in as ...`, the Telegram start line, and no warnings.
- [ ] You can sign in at the real https address.
- [ ] A test message appears in Pulse. A test draft opens, and Send posts a reply.
- [ ] A Knowledge page you added shows as Working, and the test box finds its text.
- [ ] A backup of `data/` exists.
- [ ] A pool link you paste shows its liquidity, and a test post to a private channel arrives.
- [ ] If you use X: the spend limit shows under Setup > X, and you have checked X's current prices.

## Known limits
- Reading and drafting use plain word matching and templates, not understanding. They miss unusual wording. An AI model improves the wording, never the facts: the facts always come from your brief and knowledge.
- Web pages that only load with JavaScript cannot be read. Paste their text instead.
- DefiLlama's free plan may not include yield (APY) data. If so, Pulse says so in Knowledge and TVL still works.
- Pulse cannot read direct messages, which is where most scam bots work.
