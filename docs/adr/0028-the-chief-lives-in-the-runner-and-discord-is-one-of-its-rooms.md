# ADR 0028: The chief lives in the runner, and Discord is one of its rooms

**Status:** accepted — MAR-742 asked for one attended flow (Connect AI, connect
Discord, talk to the chief from Discord, close DASH, still talk to the chief) and
MAR-672 asked for the decision to be made before anything was built. This is that
decision. **Date:** 2026-08-23. **Issue:** MAR-743, child 1 of MAR-742. Absorbs
MAR-672 and the inbound half of MAR-613. **Touches:** ADR 0023 (the chief is a
principal — this moves where it runs and changes nothing about what it may
reach), ADR 0021 (the host is a small DASH runtime — the runner-side broker here
is the same shape, narrowed further), ADR 0016 (a run press may spend), ADR 0027
(only a blessed checkout may open the installed store — decision 6 is a direct
consequence), ADR 0006 (the broker's reach ends at this machine), ADR 0002
(no token pass-through). **Repository:** orchestratedash.

---

## Context

The chief answers in one place: a composer inside DASH's window. Close the
window and the chief is gone, because `electron/chief-host.ts` is Electron main
— it reads the store main opened, spends through the broker main built, and
writes a transcript main holds a handle to.

Henrik's ask is a sentence about *where*, not about *what*: "I want the chief to
live local/in cloud and to be reached by our outside chats. Like discord etc."
The five-step bar in MAR-742 is deliberately the smallest honest version of it,
and step 5 — DASH closed, computer on, still talking — is the whole difficulty.
Nothing else in the ask is hard.

DASH already has exactly one process that survives the window: the runner.
`electron/runner-process.ts` spawns it **detached**, so that "closing the DASH
window leaves running agents running", and MAR-588 already used that fact once —
the Discord *sender* is `runner/notify.ts` and not a module in main, because the
setup copy promises *with DASH closed and the computer on, messages are still
sent* and a sender in main would have made that copy a lie.

So the question this ADR answers is not "can the chief survive the window". It is
**what has to move, what must not move, and what the person is owed in the state
where the answer is worse.**

### The posture the inbound half must not break

A DASH that listened on a port would be a different product. ADR 0006 ends the
broker's reach at this machine; ADR 0021 puts a runner on a server the customer
owns and still opens nothing; `runner/server.ts` binds an OS-local socket and
refuses a non-loopback caller with belt and braces.

A Discord bot does not need a port. The gateway is an **outbound** websocket:
the runner dials `wss://gateway.discord.gg`, identifies with a bot token, and
receives events down the connection it opened. Nothing accepts. Nothing is
reachable from the internet. The no-port claim survives literally, and that is
the reason Discord is the first outside room rather than, say, a webhook
receiver — which would have required exactly the thing DASH refuses.

### The injection analysis MAR-419 wrote, arriving where it was aimed

MAR-419 was canceled and its security section was not. It says: agent output is
untrusted data, not instructions; a tool call traceable to untrusted content
keeps the human gate; the chief's tool surface is the declared command set and
never something constructed. Every sentence of that was written about *agent
output*. A Discord message is the same category with a worse provenance — it
arrives from a network, from an account DASH does not control, into a channel
whose membership DASH cannot see.

The reason MAR-419's rule transfers cleanly is that ADR 0023 already built the
chief so it could not be talked into anything: one connection, one capability,
no id in the principal, the model chosen from a row a person set and never from
the request. A Discord message inherits all of that by being nothing more than
the `question` field.

---

## Decisions

### 1. The chief's answering half runs where the runner runs; DASH's window becomes one client of it

`electron/chief-host.ts` stops being *the* chief and becomes *a* caller of it.
The answering procedure — records first, then briefing, then one brokered
completion, then a written turn — moves to `lib/chief/answer.ts`, which takes its
world as arguments: a fleet snapshot, a way to ask a model, a way to write a
turn, and a clock.

Two hosts construct it. `electron/chief-host.ts` passes main's store, main's
broker and main's clock, and behaves exactly as it does today. `runner/chief.ts`
passes the snapshot main pushed, the runner's own narrow broker, and the runner's
spool.

**Why a shared procedure and not two implementations.** The alternative is a
second chief in the runner that "does roughly the same thing", and the failure
mode is specific rather than aesthetic: the records-first rule, the
`MAX_CHIEF_CONTEXT_CHARS` bound, the fact that no charge is recorded for a
records answer, and the fact that a provider's empty answer is still billed are
each a decision somebody argued once. A second copy is a place for one of them to
quietly not be true, on the path where nobody is watching.

**What does not move.** The chief is still `{ kind: "chief" }`, still carries no
agent id, still reaches one connection and one capability. ADR 0023 decisions 1
through 5 are untouched by this ADR. Only the process changed.

### 2. The Discord channel is an outbound gateway websocket held by the runner

`runner/discord-gateway.ts` opens one websocket to Discord's gateway, identifies
with a bot token, heartbeats on the interval Discord names, and resumes when the
socket drops. It listens on nothing.

Intents are the two the bridge actually reads and no third: `GUILD_MESSAGES` and
`MESSAGE_CONTENT`. `MESSAGE_CONTENT` is a privileged intent and DASH cannot avoid
it — a bridge that could not read the message could not carry the question — so
the setup copy says so before the person creates the bot, rather than after
Discord's own screen has already asked them to flip it.

Two things are deliberately absent. There is no `GUILD_MEMBERS` intent, so DASH
learns nothing about who else is in the server. And there is no REST call other
than posting a reply: no channel listing, no history fetch, no member lookup. The
bridge reads what arrives and answers it.

### 3. A Discord message is data; the reply is an answer and never an act

What a Discord-originated message may become is exhausted by this list:

- the `question` string of one chief turn, and
- nothing else.

It may not name a model — the model is read in the runner from the row main
pushed, exactly as `electron/chief-host.ts` reads it from the row a person set.
It may not name an agent to run, start, stop, retry or deploy. It may not approve
anything, and it may not answer a pending approval. It may not change a setting,
a key, a grant, or the allowlist that admits it.

**Guarded actions are absent from Discord in v1, not confirmable over it.** The
tempting design is a confirm flow — the chief proposes, the person types "yes",
the act happens. That is refused, and the reason is that the confirmation would
travel over the same channel as the instruction and would be authenticated by the
same allowlist entry. A gate whose challenge and response come down the same wire
as the request is not a second factor; it is one factor with an extra round trip.
The human gate for a guarded action stays where it is: DASH's own window, on this
machine, where the person can see what they are approving. MAR-744 does not change
this; a richer tool harness widens what the chief can *read*, and the gate stays
on what it can *do*.

### 4. One identity may speak, named by user id

The bridge answers messages from **one allowlisted Discord user id** — the
numeric snowflake, pasted by the person during setup.

Not "anyone in the channel": channel membership is a property of a Discord server
somebody else may administer, and DASH cannot see it. Not a role, for the same
reason. Not a username or handle, because those are renameable and a renamed
handle is an authority that moved without anybody deciding it should.

Every other author's message is **ignored, silently**. No reply, no reaction, no
log line naming them. Two reasons: a "you are not allowed" reply tells anybody
who can post in that channel that this bridge exists and who it belongs to, and a
bridge that replies to strangers is a bridge a stranger can make post.

The bot's own messages are ignored, which is the loop this class of integration
gets wrong first.

### 5. Both credentials live in the runner's memory only, handed over on the authenticated channel

The runner needs two secrets to do this: the Discord **bot token**, to hold the
socket, and the **fleet model key**, to answer. Both are read from the OS vault by
main and posted to the runner's authenticated local control channel — one route,
`POST /chief/discord`, shaped exactly like MAR-588's `POST /notify/discord` and
for the same reason.

They are held on one object, in memory, in one process. Never written to
`runner.sqlite`. Never written to a file. Never logged. Never echoed by the route
that received them — the reply says whether a bridge is now configured, never
which.

**What this costs, stated rather than designed around.** The credentials exist in
a second process. That is a real widening and it is the same one MAR-588 already
accepted for the webhook address, with a larger blast radius because one of these
two spends money. It is accepted here because the alternative is not "a narrower
design" — it is "step 5 does not work", since a process that must ask main for a
key cannot answer when main is gone.

The bound is that it is memory only, so the liveness sentences are:

1. DASH open — the chief answers in Discord.
2. DASH closed, computer on — the chief still answers, from the runner.
3. Computer off, asleep or restarted — nothing answers, and when the machine
   comes back nothing answers **until DASH is opened once**, because the runner
   comes back with nothing. This is one sentence longer than MAR-588's third and
   the extra clause is the honest part.

**If the bot token leaks**, the holder can read that channel and post as the bot.
They cannot become the allowlisted user id, so they cannot ask the chief
anything. The exposure is disclosure of the chief's own answers and a channel
somebody can spam — real, worth saying on the setup screen, and not authority.

**If the runner process is compromised**, the model key is readable from its
memory. An agent child cannot read it: children are separate processes and reach
the broker only by writing a line the runner adjudicates. This is the same
statement ADR 0021 makes about a placed key on a host.

### 6. The runner does not open `dash.sqlite`; it is given a snapshot and it spools what it produces

`dash.sqlite` was destroyed twice in three days, and ADR 0027 names the mechanism:
a WAL store abandoned mid-checkpoint by one of several processes that all
resolved the same file. The runner opening it would be a second writer on the
store, at the exact times nobody is watching.

So:

- **In:** main pushes a **fleet snapshot** — the same `ChiefBriefingRow`s
  `briefingFor` builds today, plus the fleet model choice — on the same route as
  the credentials, at startup and whenever it changes. The runner answers from
  that snapshot, plus what it alone knows live: which agents it is supervising
  right now.
- **Out:** the runner writes each turn and each broker decision to its **own**
  store, `runner.sqlite`, in two spool tables. DASH drains them into
  `chief_messages` and `broker_audit` the next time it opens, over the runner's
  authenticated channel — the shape `/telemetry/drain` and `/artifacts/drain`
  already have and for the same reason.

**Transcripts live in the store, same as today.** That was MAR-743's requirement
and this keeps it: the durable home of a chief conversation is `chief_messages`
in `dash.sqlite`, and the spool is a queue in front of it, not a second home.

**What it costs.** A Discord answer is grounded in the fleet as of the last push,
so a snapshot can be stale — by minutes if DASH was closed at lunchtime, by a day
if it was closed yesterday. The chief says so rather than implying freshness: an
answer built from a snapshot older than the reply carries the snapshot's own
timestamp. And a turn that happened while DASH was closed is not in the store
until DASH opens; the runner holds it, bounded, and drops the oldest if the
bound is reached rather than growing without limit.

### 7. Provenance is a column, not an inference

`chief_messages` gains `origin` — `"window"` or `"discord"` — and `broker_audit`
gains `decided_on` — `"dash"` or `"runner"`.

Both exist for ADR 0021's own reason, which was written about a different machine
and applies unchanged here: *a row cannot lose its provenance by being copied*. A
drained row is evidence DASH **observed** a decision the runner made, not DASH
making one, and a transcript that mixed a question typed at the window with a
question typed in Discord and could not say which is a transcript that
misrepresents the conversation it is a record of.

`decided_on` takes `"host"` as its third value when ADR 0021's spool is
eventually drained too. It is written now so that day is a value and not a
migration.

### 8. A Discord message from the allowlisted user is a person's press, for the chief's own question and for nothing else

ADR 0016's rule is that a person's press is what may spend. `electron/chief-host.ts`
passes `"person"` to the broker because somebody pressed send in the composer, and
the runner passes `"person"` because somebody sent a message in Discord. Both are
a person acting; only the room differs.

The reach of that press is deliberately narrower than a Run press. It opens **no
run allowance** — `hostBroker.allowRunSpend` is not called, cannot be called from
this path, and a Discord message therefore cannot cause any *agent* to spend. It
authorises exactly one thing: one chief completion, adjudicated by the runner's
own broker, against the one operation `{provider}.chat.completion` and no other.

The ceiling is the broker's existing window, unchanged and shared with nothing:
`BROKER_SPEND_PER_WINDOW` is 6 per 60 seconds, and the inbound queue is bounded
and serial, so the worst case is six chief completions a minute. A person who
pastes their own user id is a person who can spend their own key at that rate,
which is what they asked for.

### 9. Degrade to fleet-state answers; never go silent

Every inbound message from the allowlisted user gets a reply. There is no path
that reads a question and says nothing, because silence in a chat room reads as
"it is broken" and is indistinguishable from "the computer is off" — and one of
those is the person's problem to fix and the other is not.

When the model cannot be reached — no key pushed yet after a restart, no default
model, provider down, provider refused, rate limited — the chief answers from
`lib/chief/records-answer.ts`, which is what it did for all of MAR-648, plus one
sentence naming what is missing and what would fix it. This is not a fallback
that was added for Discord; it is the chief's own first answer path, and the
model is the second one.

The one message that gets no reply is one from somebody who is not the
allowlisted user (decision 4).

### 10. Length and rate obey Discord's rules, and a long answer is cut with the cut declared

A Discord message is 2000 characters. A chief answer can exceed that. The reply
is truncated at a safe bound with a final line saying it was cut and where the
whole thing is (in DASH, on this computer, when it is next opened) — rather than
split across several messages, which turns one answer into a burst that competes
with the per-channel rate limit and arrives out of order under retry.

Sending is one request at a time through the queue `runner/notify.ts` already
established, so the bridge and the notifier cannot together produce the parallel
burst that earns a 429 each.

---

## What this ADR does not decide

**Cloud residency.** MAR-742 phase 3. Step 5 of the bar is "computer on"
deliberately; a chief that answers with the machine off needs a server the
customer owns, and that is re-scoped fresh from MAR-442/481's constraints rather
than assumed here.

**The tool harness.** MAR-744. What the chief can *read* — every agent's outputs,
the scout's latest brief, follow-up fetches — is that packet. This one moves the
chief and opens the room; it does not widen the chief's reach by one operation.
The chief in Discord today can do exactly what the chief in the window can do,
which is answer.

**Other channels.** No Slack, no Telegram, no email. MAR-613 asked for "more
channels" and the answer is that one channel proven end to end is worth more than
three built from the same guesses.

**Draining ADR 0021's host spool.** `decided_on` makes room for it. Nothing in
this packet pulls a row off a host.

---

## Consequences

- The chief answers in two rooms and is one implementation. A change to how it
  answers changes both.
- The runner holds a spending credential while DASH is closed. This is new, it is
  argued in decision 5, and its bound is that a restart erases it.
- A person who never opens the Discord tab is unaffected: with nothing
  configured the runner opens no socket, holds no token, and the chief is exactly
  what it was.
- `dash.sqlite` keeps one writer. The store that was destroyed twice does not
  acquire a second process during this packet.
- The setup copy must say three things the person cannot discover later: the
  message content intent is required, the bot token lets its holder read that
  channel, and after a restart the chief is quiet in Discord until DASH is opened.
