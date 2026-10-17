# FAQs Intelligence, Facts and Technical Push

How the pieces fit, and the rules the code enforces.

## Two kinds of facts
1. **Facts (the knowledge bank).** Documents, pages, live data and approved FAQs. The reply drafter reads the member's
   message, retrieves matching facts and drafts a reply for the community manager.
2. **FAQs Intelligence.** Reads the chats, checks every recurring question, complaint or error against the facts, and
   drafts an FAQ **only for what the facts do not cover**. The menu shows how many drafts are waiting. Approving a draft
   sends it into the facts. Dismissing an approved FAQ takes it back out.

**Technical Push** summarises technical complaints and errors into a report that can be downloaded or sent to the
technical team, on demand or on a schedule (set Delivery to "Send to channel").

## Nothing is invented
- An FAQ answer is a moderator reply from the chat, or text the manager wrote. With neither, the answer is empty and
  the FAQ cannot be approved.
- A number, fee or percentage in an FAQ answer that appears nowhere in the chat evidence or the facts must be confirmed
  by a person before approval (HTTP 409 with `unverified`, then resend with `confirmed: true`).
- An AI reply draft or AI technical report that contains a figure missing from its evidence is discarded and the
  built-in version is used.
- AI may only reword a moderator's reply into a tidy FAQ answer, and only if it adds no figure, link or policy problem.

## How an approved FAQ is found
The indexed text is the approved answer only. The question is stored in `search`, which retrieval matches but replies
never quote. The internal verification note is not indexed.

## The watcher
Every `PULSE_WATCH_MINUTES` (default 30) the watcher visits each community with conversations, skips those with reading
switched off, runs the FAQ gap scan, and sends any scheduled Technical Push reports. `PULSE_WATCH=false` turns it off.
The drafter also receives a short, recorded-only picture of the community (top topics, problems in the latest report,
open gaps) as background, and every draft reports `basis` (knowledge, brief or none) and `relatedIssues`.
