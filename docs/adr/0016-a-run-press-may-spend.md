# ADR 0016: A run press may spend, and nothing else may

Status: Accepted

Date: 2026-08-11

Companion to `docs/adr/0011-which-model-an-agent-uses.md`, which decided who
names a model, and to `docs/adr/0012-talking-to-an-agent.md`, which decided who
says what an answer cost. This decides **who is allowed to spend**.

## Decision

Four things.

1. **A person's Run press opens a spend allowance**, scoped to one agent,
   bounded by a small number of calls and a short window.
   `lib/broker/spend-allowance.ts` holds it and `electron/main.ts` is the only
   caller that opens one.
2. **An agent-origin spend is permitted while an allowance is open, and refused
   otherwise**, with the same `needs_a_person` it has always been refused with.
   The refusal's meaning narrows from *"an agent may never spend"* to *"no run
   you asked for is open"*.
3. **The budget is denominated in tokens, not money**, because tokens are the
   only unit DASH holds before the fact. DASH makes no claim about what a press
   costs in currency, and no surface built on this may make one.
4. **The model an agent spends under is the owner's, substituted by DASH**, not
   the agent's. The agent supplies no usable model and cannot; an agent whose
   owner has named none is refused with `no_model_chosen`.

## The problem this was written to solve

Henrik, on MAR-619: *"can we update the AI news scout to acctually read the
news, summarize, and put together a curated summary of the latest news with
links to its source? We need an model provider for this i guess?"*

Everything that request needs existed except the last inch. The scout finds real
news; MAR-603 declared its digest step `cheap`/`small`; OpenRouter is in the
vault at fleet level; `openrouter.chat.completion` is a real brokered operation
with a frozen path and a cost projection. And the scout could not reach any of
it, because `lib/broker/execute.ts` refused every spend that did not come from a
person at the keyboard.

That refusal was not an oversight. `BrokerOrigin`'s own docblock argued it:

> A completion is refused for an agent because MAR-582 named the thing that has
> to exist first — "a cost story and a per-run budget" — and this slice builds
> the first and not the second. An agent that may spend without a per-run budget
> is an agent that can empty an account between two of DASH's five-second polls.

And it named its own exit:

> So this is a stated, temporary standing rather than a principle: when MAR-299
> has a per-run budget, letting an agent spend is this gate plus that budget, and
> the diff is small and visible.

This ADR is that budget and that diff.

## Why the press, and not the run

The obvious key for a per-run budget is the run. It is the wrong one.

A run id is minted **by the agent** — `startRun` in `agent-kit/template/agent.mjs`
calls `randomUUID` — and reaches DASH as a telemetry claim. An allowance keyed on
a value the spending party chooses is an allowance that party can reset by
choosing another one. It is the same mistake as letting a request carry its own
origin, which is precisely why `BrokerOrigin` is a parameter of `handle` and not
a field on `BrokerRequest`.

The press is a fact about DASH's own UI. No child process can assert one, and
`electron/main.ts` opens the allowance on the `retry` verb — the verb behind Run
now — before the command reaches the runner.

This is why the change reads as a **narrowing of an approximation** rather than a
relaxation of a rule. The sentence the origin gate was always protecting is *a
person is behind every penny DASH spends*, and `origin` was a crude proxy for it
because DASH had no way to tie a line read off a child's stdout to a button
somebody pressed. Now it has one, and the sentence is enforced rather than
approximated.

## Why the budget is in tokens

A budget denominated in money cannot be enforced, and pretending otherwise would
be exactly the invented number `AnswerCharge` and `describeAmount` exist to
refuse.

Two of the three providers never state a price at all — `prices_its_own_answer`
is false for Anthropic and OpenAI — and the one that does states it *after* the
call. A dollar ceiling could only be checked once the money was already gone.

What DASH holds exactly, and in advance, is the size of what it sends and the
ceiling on what it asks back: `MAX_MATERIAL_CHARS` and `MAX_OUTPUT_TOKENS`, both
DASH's own constants in `lib/broker/operations.ts` rather than a caller's.
Multiplied by `SPEND_ALLOWANCE_CALLS`, they give the worst case one press can
produce, in the unit a provider actually bills on, with DASH holding nobody's
rate card.

The limit of that claim is stated rather than buried: **DASH cannot promise a
press costs less than a stated amount of money.** It can say what will be sent
and how many times. Copy that turned that into a currency figure would be
inventing one.

## The numbers, and why they are small

- `SPEND_ALLOWANCE_CALLS = 2`. One is what the scout needs — a single curation
  call per run. The second lets a step that failed on a torn connection be tried
  again inside the same run without a person pressing anything, and it stops
  there: three begins to look like a retry loop's allowance rather than a run's.
- `SPEND_ALLOWANCE_MS = 10 * 60_000`. A run of the scout is seconds of work. Ten
  minutes is generous by an order of magnitude and short enough that an allowance
  cannot sit open across an afternoon for something else to find.

A second press replaces the allowance rather than topping it up, so the ceiling
is always one press's worth however many times somebody presses.

Neither number replaces the *existing* bounds: a spend still costs a call from
`BROKER_CALLS_PER_WINDOW` and from `BROKER_SPEND_PER_WINDOW`, and still takes the
durable replay check against `broker_audit`. The allowance is a fourth bound, not
a substitute for three.

## The disclosure

Spending somebody's money on a press obliges DASH to say so **before** the press.
`WorkspaceView.run_spend` carries the sentence and `AgentControls` draws it under
the Run button, in `lib/copy/curation.ts`'s words.

It is null for every agent that cannot spend, which is nearly all of them — one
that declares no model provider, one whose key is not connected, one whose owner
has named no model. All three produce a run refused before anything is sent, and
an unconditional warning about money would be a warning about nothing;
`describeFleetReach` records what becomes of those.

## What an agent may not decide

The model. ADR 0011's first decision is that *a level is what an agent's author
declares; a model is what its owner chooses*, and this is the first path where an
author's own program does the asking. So `lib/broker/execute.ts` overwrites the
`model` on an agent-origin spend with `readModelChoice`'s answer before the
operation composes anything — there is no branch in which what an agent asked for
survives into the body DASH sends.

An owner who has named none gets `no_model_chosen` rather than a model DASH
picked. Translating a declared *level* into a model name is the mapping ADR 0011
refuses to keep a second copy of, and choosing one anyway would be DASH deciding
what somebody's account is billed for.

## What the model may not do

`{provider}.digest.curate` returns **numbers, not prose about items**. Its
projection parses the reply into groups whose membership is expressed as indexes
into a list the agent already had, and the agent checks those against its own
items before writing the artifact.

So a model that invents a headline has no field to put it in, and a model that
misattributes a source cannot change where an item came from. This is
`lib/ai/ask.ts`'s citation discipline — *"a model that invents a source cannot
make that source appear in the list beside it"* — applied to a digest.

The flat `items` array stays authoritative and untouched, so `analyzeGrounding`
computes the same grounding verdict it always did and a model cannot improve a
run's score by grouping tidily. An item no group claimed is still rendered, under
DASH's own heading.

## What this does not do

- **No per-run budget in money.** See above. MAR-299 still owns spend as a
  subject, and this ADR deliberately does not decide what a monthly ceiling or a
  per-agent cap would look like.
- **No scheduled spending.** An agent on a timer has no press behind it and is
  refused. That is the designed outcome, not a gap: cadence plus spending is a
  decision somebody has to take on purpose, and taking it silently here would be
  taking it in the wrong issue.
- **No spending on a server.** ADR 0011's deploy refusal stands unchanged. A
  bundle is still refused when the plan needs a model and the agent asks DASH to
  hold the key, and nothing under `runner/` reads an allowance.
- **No streaming, no embedding, no image generation.** The operation set grew by
  three curations and by nothing else.

## Alternatives rejected

- **Drop the origin check and rely on the existing rate limits.** One line, and
  it discards the precondition MAR-582 wrote down. `BROKER_SPEND_PER_WINDOW` is
  six a minute, which unattended is roughly 8,600 calls a day against somebody's
  account with nobody at the keyboard. A rate limit bounds a burst; it does not
  put a person behind the spend.
- **Curate on a person's press, from the digest surface.** Safe, and no ADR
  needed — and it makes the scout something a person has to operate twice per
  digest, with the curated form becoming DASH's output rather than the agent's
  own artifact. The issue asks for an agent that summarises, not a button that
  summarises for it.
- **Key the allowance on the run id.** Rejected above: the agent mints it.
- **Close the allowance on `run_completed`.** Rejected for the same reason one
  step further on — the agent emits that event, so closing on it would put the
  end of the budget in the hands of the process being budgeted. A clock cannot be
  argued with.
- **Ask the model for JSON.** Rejected. This runs at `cheap`, which is ADR 0011's
  level for the digest step and is chosen precisely because small models do
  extraction well; a small model that loses a brace produces nothing a parser can
  salvage, while one that mangles a line of the line-based format leaves every
  other line readable.
