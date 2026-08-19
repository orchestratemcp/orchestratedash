# ADR 0023: The chief is a principal, and it is not an agent

**Status:** accepted — Henrik, 2026-08-16 ("Ok unblock it"), with persistent
memory named a must-have in the same message. The durable-transcript half
(decision 6) is therefore direction, not option; the wider activity-and-decisions
memory is MAR-673's own ADR.
**Date:** 2026-08-16
**Issue:** MAR-659 (DASH — the chief needs to actually know the fleet)
**Touches:** ADR 0002 (the broker), ADR 0011 (which model an agent uses), ADR 0012
(talking to an agent), ADR 0013 (fleet connections), ADR 0016 (a run press may
spend). ADR 0008 untouched.
**Repository:** orchestratedash

---

## Context

MAR-648 shipped the chief's composer deliberately without a model, and recorded
why in `lib/chief/route.ts`. The reason was never "no model is selected" —
MAR-642 built a fleet-wide default and `applyFleetDefault` resolves it. The
reason is narrower and structural, and it is two facts:

- `broker.handle` resolves a manifest **per agent**, and the fleet principal has
  none, so `lib/broker/execute.ts` refuses with `unknown_connection` before it
  reaches a vault.
- `connectionSecretName` only ever emits `dash.connection.`, so the fleet's own
  key under `dash.fleet` (ADR 0013) is unreachable from the spend path **by
  construction**. `lib/fleet/principal.ts` states that lock deliberately.

Henrik's attended proof pass on 2026-08-16, station 11, marked FAIL: he asked the
chief which agents run locally and which on the cloud, and it could not answer.
`describeFleetPlace` is a one-line function over records DASH already holds. The
chief could not reach it because the chief cannot compose a sentence, and a
question outside `STANDING_WORDS` falls to routing — which answers *who to ask*
rather than *what*.

This ADR decides whether those two locks still earn their place, and what a
person can still be sure of once one of them moves.

---

## Decision 1 — the broker's first parameter becomes a principal, and the chief is one

`Broker.handle(agentId: string, …)` becomes `Broker.handle(principal, …)`:

```ts
export type BrokerPrincipal =
  | { kind: "agent"; agent_id: string }
  | { kind: "chief" };
```

A type rather than a reserved string, and that is the load-bearing part.
`lib/handoff.ts` and `lib/open-link.ts` both accept an agent id matching
`/^[a-z0-9][a-z0-9._-]{0,63}$/`, and `dash.fleet` satisfies it. A string
comparison inside the broker would therefore be a hole an agent author could aim
at by choosing a name. A variant with no id field cannot be inhabited by any
string at all, so "an agent contrives to be called `dash.fleet`" stops being an
argument and becomes a compile error.

This makes `FLEET_PRINCIPAL` *more* exactly what its own docblock says it is —
**a label, not a lock** — rather than less. It goes on filling
`CredentialTarget.agent_id` so a fleet connection appears in `connection_secrets`
and `ai_key_checks` under a recognisable name, and it never becomes a principal
anywhere.

The budgets map is keyed by principal, so the chief gets its own windows. See
the cost section: that is a real widening and it is deliberate.

## Decision 2 — the chief's manifest is DASH's, derived from the catalogue

`BrokerDeps.readManifest` answers for a chief principal with a
`ConnectionSourceManifest` **DASH composes** from `lib/fleet/catalogue.ts`,
containing exactly one connection — the connected model provider — carrying
exactly one capability: that provider's `{provider}.chat.completion`.

Not a file on disk, not a fixture, and not something a person or an agent can
edit. A builder, over the same catalogue entry the Connections page already
draws, so a provider DASH has not built the flow for cannot appear in it.

**This is not a new authority.** ADR 0013 already granted it and named it as the
one genuinely new thing in that decision: *"for a fleet sign-in there is no
manifest, so DASH decides what to ask the provider for."* It made that safe by
deriving the scope set from the frozen operation table rather than writing one by
hand, which turned *DASH never asks for a scope no operation uses* from a check
into a property. The chief's manifest is that same derivation read back out for
the one principal that **is** the fleet.

What it costs: `lib/broker/execute.ts`' step 4 stops being "the manifest DASH
imported for the process that wrote the line" for one principal. What it does not
cost: anything on the agent path, which is untouched and reads the store exactly
as it did.

## Decision 3 — `connectionSecretName` does not move, and the fleet namespace stays sealed against agents

MAR-659 frames both locks as needing to change. Only the first does.

`connectionSecretName` goes on emitting `dash.connection.` and is **never called
for a chief principal**. The chief branch calls `fleetSecretName(provider,
field_id)` — `dash.fleet.…` — which is the key ADR 0013 already writes on
connect and re-key.

So the sentence `lib/fleet/principal.ts` protects survives verbatim: *no agent,
named anything at all, resolves to the fleet credential's vault key.* It is now
true for two independent reasons rather than one — the namespaces still cannot
meet, and the chief principal is not a name.

ADR 0013 rejected "the broker reads the fleet key directly" and gave two reasons.
Both were about agents, and neither reaches here:

1. *It would make "what the broker resolves for an agent is indistinguishable
   from today" a claim requiring proof rather than a consequence of not editing
   the file.* The agent branch is not edited. The claim stays a consequence.
2. *Per-agent revocation would become a deny row the broker must consult, a
   second permission authority beside `lib/broker/grant.ts`.* The chief has no
   per-agent revocation to preserve. There is one chief and one credential, and
   revoking it is disconnecting the provider.

So this is an **amendment scoped to a principal that is not an agent**, not an
overturning. It also avoids an N+2 vault copy: re-key still writes N+1 entries.

## Decision 4 — the chief's blast radius, stated as an invariant

> **The chief can ask a model a question and be charged for it. It can do nothing
> else.**

Its manifest declares one connection and one capability. There is no operation in
its allowlist that reads a mailbox, writes anywhere, reaches a host, or touches
an MCP server, and there is no code path by which one could be added without
editing the builder in Decision 2. Every refusal, every budget, every audit row
and the origin gate apply to it unchanged.

Three things carry over untouched and are worth saying out loud, because they are
what a person is actually relying on:

- **Origin.** A chief question is `origin: "person"` — somebody pressed send in
  the composer. ADR 0016's run allowance is an agent-side mechanism and the chief
  has none, so an unattended chief spend is not refused-by-policy, it is
  unreachable. Nothing can schedule it.
- **Model choice.** The chief has no picker. It asks under DASH's fleet default
  (MAR-642), and with no default set it has no model and says so. ADR 0012
  decision 4 holds: DASH does not choose a model for anybody. **Superseded by
  Amendment 1 (MAR-696):** the chief now has a picker of its own, read before
  the fleet default rather than instead of it; the other two bullets and ADR
  0012 decision 4 both still hold exactly as written.
- **The answer drives nothing.** ADR 0012's structural guarantee, unchanged.
  Nothing in DASH parses a chief answer, follows a link out of it, derives a
  command from it, resolves an approval by it, or hands it to an agent.

## Decision 5 — facts are briefed, phrasing is the model's, and the receipt is the guarantee

`describeChief`'s rule is that fleet facts are quoted from DASH's own records and
never reworded. **That rule does not survive contact with "which agents run local
and which on the cloud", and saying it does would be the failure.** "Never
reworded" is a property of quoting *one* record; that question is
`describeFleetPlace(hostedOn)` evaluated per agent and grouped. There is no single
record to quote.

What replaces it is weaker on purpose, so that it can actually be true:

**The briefing rule.** DASH assembles a *fleet briefing* at ask time: one row per
agent, and **every field on it is a string DASH already renders on a screen** —
`agentDisplayName`'s title, `describeFleetPlace().label`, the glance chip's
`meaning` verbatim, `describeRunCount`'s sentence, `last_evidence_at`, the
declared capability ids. The model receives the briefing and the question, under
a `CHIEF_SYSTEM_PROMPT` frozen in `lib/broker/operations.ts` beside
`ASK_SYSTEM_PROMPT` and `CURATE_SYSTEM_PROMPT`, on that file's own rule: the
caller supplies values, DASH supplies the shape.

**The receipt, not the prompt, is the guarantee.** Under every chief answer DASH
renders — from its own records, never parsed out of the answer text — the exact
briefing rows that were sent. This is `AskCitation`'s discipline moved from saved
digests to fleet facts: a model that invents an agent cannot make that agent
appear in the table beside its sentence, and a person can check the phrasing
against DASH's own list without leaving the room.

**Records first, model second.** `answerChief` stays, and stays in front. A
question that matches `STANDING_WORDS` is still answered from records: no model,
no charge, no latency, and MAR-547's exactness intact for the question people
actually ask most. The model is reached for what records alone cannot phrase.

**What this does not prevent, named rather than designed around.** The model can
attribute a fact to the wrong agent, omit an agent, or soften a definite fact into
a vague one. None of those is a prompt problem and none is caught by a test. The
receipt makes them visible; it does not make them impossible. That is the price of
the model, and it is why the model does not get the standing question.

## Decision 6 — the chief remembers the conversation; it never remembers the fleet

MAR-648's session-only argument was that a chief answer is a statement about the
fleet *now*, and a stored one would be a sentence about last Tuesday sitting in a
scrollback looking like a sentence about today.

**That is an argument against undated re-presentation, not against storage.**
Decision 5 already produces the missing date.

- **The transcript is durable.** `chief_messages`, beside `agent_questions`,
  which ADR 0012 argued for in exactly these terms: *"a person typed these words,
  on their own computer, into something shaped like a conversation, and a
  conversation that forgets everything when the page closes is not one."* Stored:
  the question, the answer, the model, the charge, and **the receipt as it stood**
  — the briefing rows, frozen. Kept until the person clears the thread, from a
  control in the chat room. ADR 0008 is untouched: nothing is added to the
  author's panel.
- **Staleness is computed and shown.** A stored turn renders with its timestamp
  and its frozen receipt. When a fact in the frozen receipt differs from the same
  fact now, DASH marks the turn: *the fleet has changed since this was written.*
  That is a fact DASH observed by comparing two of its own records, so it is
  inside the facts-only rule — and it is what stops an old sentence impersonating
  a current one, which was the whole of the original objection.
- **What the model is told about the past is narrow.** The last few turns of
  *this* thread as text, and **never an old receipt.** Feeding a stale briefing
  into a fresh answer is precisely how a sentence about last Tuesday gets written
  in the present tense. Current facts come only from a briefing built at ask time.

**What is deliberately not built:** no vector store, no embeddings, no distilled
"facts DASH has learned about your fleet". DASH already has a memory system — it
is the store, and every question re-reads it. What was missing was never memory;
it was that the chief could not read what DASH already remembers.

> The chief's memory is conversational continuity. Its knowledge is always fresh.

## Decision 7 — small talk goes through the same call, with an empty briefing

Henrik: *"I also want the agent to be more chatty. If I say hi it replies."*

A greeting is answered by the same model call with no briefing rows attached —
**not** from a table of canned greetings. A greeting table would be a second
personality free to drift from the first, and it is the exact shape MAR-547
forbids: a sentence in a speech position with nothing behind it, that a reader
cannot tell from one with a record behind it.

What keeps a greeting from becoming speculation is structural. Its receipt says
*nothing from your records was used*, so a person can see per turn whether the
chief was speaking from records or being polite — and an answer that makes a
claim about the fleet under an empty receipt is a defect anybody can see.

`describeChiefScope` is rewritten with this: it currently promises that answers
are free and that nothing is kept, and after this ADR neither is true.

## Decision 8 — the room is decided by the surface, and the type enforces it

Henrik: *"When in fleet mode I want the chat to only be chief mode… When going to
a specific agent you talk to only that agent. At least semantically."*

Fleet page → the chief principal, the fleet briefing, no agent's saved material.
Agent page → that agent's principal and that agent's saved reports, MAR-545's
path unchanged.

Semantically **and** structurally: `{ kind: "chief" }` carries no agent id, so
there is no value a chief question could be aimed at an agent with, and no agent
question that can carry the fleet briefing. Two transcripts, two tables, no shared
thread.

Crossing rooms stays a hand-off, which MAR-648 already built: the chief names the
agent that declared the subject and links into its chat, where the paid per-agent
path lives. The chief never answers *from* an agent's saved material — the
briefing carries counts and report titles, never item text — which is also what
keeps a chief question from costing what an agent question costs.

---

## What this costs, stated rather than designed around

**A fourth budget window.** `budgets` is keyed per principal, so the chief gets
its own `BROKER_SPEND_PER_WINDOW` of six. The fleet-wide ceiling on questions per
minute rises by six. Deliberate: sharing a window with an agent would mean a
person's own question failing because a scout was busy, which is the failure a
rate limit should never cause.

**`lib/broker/execute.ts` computes two vault names.** One `switch` on the
principal, and it is that file's first branch on *who is asking* other than the
origin gate. Small and visible, and the reason it is acceptable is Decision 3:
the second name is only reachable from a principal no agent can be.

**A second material shape and a second system prompt.** `CHIEF_SYSTEM_PROMPT`
joins the two already there. Two prompts for two jobs, neither reachable with the
other's frame — that file's own established rule.

**The briefing grows linearly with the fleet.** One row per agent, sent on every
model-answered question. A fleet of forty is a cost story this ADR does not have,
and where to truncate is a decision nobody has made. It is bounded in practice
today by a fleet of one, which is not the same as being bounded.

---

## The model to set the default to

The chief takes DASH's fleet default and gets no selector of its own, because the
fleet default is already defined as *"the model DASH uses unless an agent says
otherwise"* and the chief is the fleet. A second selector would be a fourth place
a model is decided and a fourth thing to keep in step with `applyFleetDefault`.

Henrik asked which one to set it to. **Claude Haiku 4.5**
(`claude-haiku-4-5-20251001`) through an Anthropic key. The chief's work is
phrasing over a briefing DASH has already assembled and bounded — selection and
short prose, not reasoning — and it runs on every *hi*. Frequency is the deciding
variable here, not capability.

One consequence: Anthropic does not price its own answers
(`prices_its_own_answer` is false), so a chief on Anthropic shows tokens and no
amount, and ADR 0012's table already says why. A running cost figure on the chief
requires an OpenRouter default instead. That is a trade for Henrik to make, and
DASH must not make it for him.

---

## The visual direction, and why the corners stay square

Henrik: *"It's too edgy. Make it softer and look more like an AI chat in Claude or
ChatGPT."*

**"Softer" is not a request for rounded corners.** What makes those interfaces
read as soft is four things and none of them is a radius: no chrome per turn — a
speaker and a paragraph in a reading column, not a bordered row per message;
generous vertical rhythm between turns; one accent per screen; and a measure and
line height tuned for reading rather than scanning.

The chief room today does the opposite on three of the four. `.chief-asked` puts
an accent bar on the person's own words, `.chief-quoted` puts a second rule beside
it, `.chief-reply` drops to `--text-sm` so the answer is *smaller* than the
question, and `.chief-room` is a bordered box inside a bordered band. That is what
"edgy" is naming: border count and density, not corner radius.

So: unbox the turns, return the reply to base size, raise the space between
turns, keep exactly one accent, keep the 70ch measure, keep the navy ground, keep
every corner square. That is a real change to how the surface feels and it costs
the design system nothing.

Bit-Command was adopted whole and its fiction layer refused whole. Nothing here
adds a persona, a typing animation, or a name for the chief beyond `CHIEF_NAME`.

If it still reads as edgy afterwards, the remaining lever is a **declared
exception**, and the system already has the mechanism for one: `app/tokens.css`
keeps the `--radius-*` names at `0px` precisely so *"a rounded thing in this
system should have to name itself in this file rather than in a stylesheet nobody
re-reads"*, and `tests/tokens.test.ts` asserts every one of them. An exception is
therefore one visible diff across two files with a reason attached. This ADR
recommends not spending it yet, and putting that decision to Henrik against a
screenshot rather than against a paragraph.

---

## What is proven, and what is not

**Nothing.** This is a decision document and no code has been written against it.
Documentation proves nothing by itself.

Provable once built, and before MAR-647 lands:

- the principal change and the chief's manifest, driven over `handle` — including
  the negative: a chief principal cannot reach a Gmail operation, in the shape
  `tests/broker-threat-model.test.ts` already uses;
- that a chief vault read lands on `dash.fleet.` and an agent's never can, driven
  from the broker side in `tests/fleet-connections.test.ts`' shape;
- one real charged question against a real key, attended;
- the receipt, the transcript, the staleness marker, the room separation and the
  visual pass, the last by capture.

**Not judgeable before the competitor scout (MAR-647) lands**, and Henrik said so
himself — *"the agents have no real output so we can't really test this"*:

- whether the briefing is *enough*. On a fleet of one with few artifacts, a
  briefing that is too thin and one that is exactly right give the same answers.
- whether phrasing stays faithful over real evidence. Faithfulness is only
  observable against facts rich enough to get wrong.
- what a question actually costs in practice, and therefore whether records-first
  is pulling its weight.
- the hand-off end to end: the chief names the scout, and the scout's own chat
  answers from real saved material.

So "the chief knows the fleet" is not accepted as proven by any test in the list
above. It is accepted when Henrik re-walks station 11 against a fleet that has
produced real work.

---

## Amendment 1 (MAR-696): the chief gets a picker of its own

**Amends:** Decision 4's "Model choice" bullet — *"The chief has no picker. It
asks under DASH's fleet default (MAR-642), and with no default set it has no
model and says so."* That sentence is no longer true and this amendment is the
record of why.

The corrected composer (MAR-696, replacing the floating window this ADR's own
visual-direction section anticipated arguing about, and which Henrik refused on
sight as PR #246/`c058d9b`) carries, in his own words, *"the chief's current
model and a swap control."* A swap control needs something to swap into — a
model the chief can be told to use instead of the fleet's — and that is a
standing choice DASH did not previously let anyone make.

**What changed, mechanically.** `chief_model_choice` is a new one-row table,
`fleet_model_default`'s exact shape, read *before* it rather than instead of
it (`readEffectiveChiefModel`, `lib/ai/model-store.ts`). Nothing about
`fleet_model_default` moved: an agent with no pin of its own still falls back
to it exactly as before, and the chief now does too, but only where it has no
pin of its own either. Filed under its own decision kind, `chief_model` —
never a second write under `fleet_model_default`'s kind — because the two are
different rows, and a decision kind resolves against its own row.

**What did not change.** Decision 4's other two bullets stand untouched: a
chief question is still unreachable except through a person pressing send, and
the answer still drives nothing. The picker is the one and only widening this
amendment records — the chief still declares one connection and one
capability, still cannot be scheduled, and ADR 0012 decision 4 — DASH does not
choose a model for anybody — still holds, restated one level up: DASH does not
choose the chief's model either, unless nobody has, in which case the fleet's
own standing default answers exactly as it always did.

**The visual-direction section above is otherwise unchanged and its argument
held**, with one exception it explicitly reserved the door for: *"the
remaining lever is a declared exception... putting that decision to Henrik
against a screenshot rather than against a paragraph."* Henrik's 2026-08-19
screenshot answered it — rounded corners, but scoped to the composer alone,
recorded as `--radius-chief-composer` in `app/tokens.css` and nowhere else.
The rest of that section's argument — unbox the turns, one accent, no
persona — is unaffected; corner radius was always the one lever it left open.
