# ADR 0026: DASH sends LAB a route, never a goal

**Status:** proposed — MAR-479 asked for a decision document; this one arrives
with the sender it decides, because the question *"is an opt-in a user cannot
verify worth having?"* is not answerable in the abstract and the receipt is the
answer.
**Date:** 2026-08-20
**Issue:** MAR-479 (DASH — ADR: opt-in telemetry to LAB, off by default, with a
receipt of exactly what is sent). Implements the DASH half of MAR-512's
boundary; MAR-512's four open questions are answered in Decisions 2, 3, 4 and 8.
**Touches:** ADR 0006 (the broker's reach ends at this machine — the ADR that
sharpened this question), ADR 0002 (invariant 4, the permission receipt; and
amendment 1's disconnect rule, argued against in Decision 7), ADR 0004 (a
third-party liveness is never a blocking gate; and `network: read` as a
declaration DASH renders rather than a boundary DASH enforces), ADR 0024 (a
decision is filed where it is made — this setting takes its own kind).
**Repository:** orchestratedash. The receiving end is `orchestratelab`
(`lib/dashTelemetry.ts`, `app/api/insights/ingest/route.ts`), merged and off
behind `LAB_DASH_INGEST_ENABLED`.

---

## Context

ADR 0006 ended with the broker's reach bounded by the transport. It did not say
anything about the *other* direction: what DASH may tell somebody else about
what it saw. MAR-479 was filed to write that rule down "before there is a
feature arguing for an exception", and there now is one — MAR-512 built the
receiving end, and it has never received anything. The only `dash-telemetry`
row that has ever existed in LAB is one LAB wrote to itself with
`pnpm seed:dash-telemetry`.

That fixture is why this ADR can be specific. The wire shape is already decided
and already merged: a `PlanObservation` (`orchestratelab/lib/insights.ts`) minus
its `source` field, which LAB fixes to `"dash-telemetry"` on the way in. Ten
fields, four of them required. So the question this ADR faces is not "what would
a telemetry schema look like" but the much sharper one: **for each of those ten
fields, what may DASH honestly put in it?**

Answering that field by field turned out to answer MAR-479's harder questions
too, because the first field is `goal_slug` and the honest answer to it is *not
the goal*.

---

## Decision 1 — the one sentence, before any field list

> **The telemetry answers exactly one question: which component sequences do
> real installs keep assembling by hand, so that the MCP's registry can grow a
> golden path for one.**

MAR-479 requires this sentence to come before the field list, on ADR 0004's
precedent, because a telemetry design that starts from a field list has skipped
the only step that can rule a field out. It rules several out immediately.

The question is about the **registry**, not about the person. It is answerable
entirely in the MCP's own vocabulary — component ids, `plan_source`,
`playbook_id` — which are strings the registry minted and shipped to DASH, not
strings anybody typed. Every field below is one of those, an enum, a digest of
them, or a date.

MAR-512's outcome list also named "agent count, run outcomes, refusal
categories". None of them serve this sentence, and Decision 3 declines all
three.

---

## Decision 2 — the route is the identity; the goal never crosses the wire

> **`goal_slug` is a digest of the planned route, not of the goal. `goal_text`
> is the route's component ids joined for reading. `agent.goal` — the person's
> own prose — is never sent, and there is no field it could occupy.**

This is MAR-512's open question 1, and it is the load-bearing decision here.

A DASH manifest's `agent.goal` is arbitrary end-user prose. The one on this
machine right now reads *"Watches public sources for what competing agent
products ship…"*, which is harmless; the shape of the field is not. A goal is
where a customer's name, a domain, a person's name and the substance of what
somebody is automating all land. Sending it would break MAR-479's third
constraint — the rule `broker_audit` already holds, that DASH stores the
operation and the *names* of the fields an agent supplied and deliberately not
the search query, because "a durable table of every phrase an agent searched a
user's mail for would be the single most sensitive table in the store".

**The rule is the same rule, not a coincidentally similar one.** `broker_audit`
refuses the query because the query is the user's words about their own life.
`agent.goal` is the same words one level up: it is what the user wants done,
written by the user, and a table of them on somebody else's server is the same
table with a longer reach. A thing that must not exist locally must not exist
remotely.

`agent.name` is refused for the same reason and is worth naming separately,
because it looks safe and is not. It is a slug somebody chose —
`competitor-scout` here, `acme-invoice-chaser` on somebody else's machine — and
the second one names a customer.

**What is left is the route, and the route is enough.** Decision 1's question is
answered by which component sequences get composed, not by what anybody wanted.
The MCP cannot add a playbook for *"watch competitor X"*; it adds one for
`public_source_fetch → signal_sort → brief_compose → deep_dive_synthesis → …`.
So:

- `goal_slug` = `dash_route_` followed by the first 12 hex characters of
  `sha256(plan_source ␟ component_id ␟ component_id ␟ …)`, in step order.
- `goal_text` = the same component ids joined with ` → `.

Both are composed **only** from registry vocabulary and an enum. There is no
branch on which a character the user typed reaches either one — which is a
property of the composition rather than a rule the sender has to remember, and
is checked by a test that feeds it a manifest whose goal, name and display name
are all distinctive strings and asserts none of them appears anywhere in the
payload bytes.

**What this costs.** A slug nobody can read back to a sentence. LAB's
golden-path-gap list will rank `dash_route_9f2c1a0b4e7d` above whatever it ranks
second, and no one will be able to say what that goal *was*. That is the right
trade and it is barely a trade: `goal_text` renders the actual component chain,
which is the thing the registry can act on. The unreadable half is the half
nobody was entitled to.

---

## Decision 3 — the four fields DASH cannot honestly fill, and what it puts in them

> **`route_score` is `0` meaning absent, `must_have_missing` and
> `forbidden_present` are always empty, and `route_changed` is always `false`.
> Each is a hole in the wire shape, named here rather than papered over with a
> plausible number.**

MAR-512's open question 2 asked which fields are unrepresented. Both directions
have holes.

**LAB fields DASH cannot fill:**

- **`route_score`.** Documented as *"playbook precision or composed route
  score"*. That number is a property of the **registry**, computed by
  `plan_workflow`, and it does not survive into the manifest —
  `agent.route_id` and `agent.playbook_id` are both empty strings on every real
  manifest on this machine. DASH has never held it and cannot derive it.
- **`must_have_missing`, `forbidden_present`.** Corpus **contract** ids. DASH
  has no corpus, so it has no contract to violate.
  `safety_contract.enforced_approval_gates` and `irreversible_components` are
  the nearest-looking fields and mean something else entirely — mapping one onto
  the other would be the mislabeling AGENTS.md's grounded-prose rule exists to
  refuse.
- **`route_changed`.** Under Decision 2 the slug **is** the route, so a changed
  route is a new slug rather than a changed row. The fact is expressed, in a
  different place, by an old slug going quiet and a new one appearing.

`route_score` is the one that does damage, and the damage should be stated
rather than discovered. It is required and must be finite, so DASH sends `0`;
LAB's `goldenPathGaps` sorts ascending by score, so **every DASH row sorts to
the top of that list**, above real corpus rows with real scores. That is a
defect in the wire shape, not in either side, and it has a clean fix that is not
DASH's to make: DASH sends `playbook_candidate`, and LAB already loads the MCP
registry in the same function (`loadInsights` → `loadRegistrySnapshot`), so
**the score is resolvable on LAB's side from the id DASH sends**. Filed as a
follow-up rather than done here, because this session does not write LAB code
and because inventing a number in DASH is precisely the failure the follow-up
avoids.

**DASH facts the wire shape has no room for**, and which this ADR declines to
add fields for:

- `provenance.registry_fingerprint` — which registry version produced the plan.
  Genuinely useful to Decision 1's question and genuinely absent. The right home
  is a wire-shape change agreed with MAR-512, not a field DASH invents.
- Telemetry v1's `model`, `tokens_in`, `tokens_out`, `cost_usd`. DASH has held
  these since v1 and they are **deliberately not sent**. They do not serve
  Decision 1's sentence, and a spend figure is a fact about the person's wallet.
- MAR-512's "agent count" and "refusal categories". Agent count is a fact about
  the install rather than the registry; refusal categories are one short step
  from what the person refused. Both fail Decision 1.

---

## Decision 4 — one token, from LAB, held the way every other credential is

> **A single shared bearer token, generated by LAB, typed into the credential
> window main owns, stored in the OS vault under `lab.telemetry-token`. SQLite
> holds a masked hint and a date and has no column a token could occupy.**

MAR-512's open question 3 asked whether one shared token is enough, or whether
MAR-479's receipt language wants something richer — per-field consent, a signed
manifest of what is enabled.

**One token, and per-field consent is refused.** The token authenticates; it is
not the receipt and cannot be made into one. There is exactly one DASH per LAB
here (LAB's own route comment says so, contrasting with the per-agent tokens in
`/api/events`), so a token identifies a pairing and nothing more.

Per-field consent would be ten switches over a ten-field payload — 1024 payload
shapes DASH would have to be able to describe truthfully — in exchange for
letting somebody withhold a component id from a machine on their own loopback
interface. Decision 5's receipt shows the actual bytes; a person who does not
like a field can read it and switch the whole thing off, which is the one
control that stays honest at every setting.

The endpoint defaults to `http://127.0.0.1:3000` — LAB is local-only by its own
AGENTS.md and binds loopback. It is configurable, and a non-loopback endpoint is
**rendered as such on the settings page rather than refused**: DASH does not get
to decide where somebody's own LAB runs, and pretending the default is a
boundary would be the `network: read` mistake ADR 0004 names.

---

## Decision 5 — the receipt is the payload, stored, and it makes one claim rather than two

> **DASH keeps the exact JSON body of every post it makes, with the endpoint,
> the HTTP status and the time, and renders it on the settings page — before the
> first send as a preview computed from the store, and after every send as a
> row. The receipt claims "this is what DASH sent". It does not claim "this is
> all that left your computer".**

MAR-479's second constraint: not a policy document describing categories, the
actual payload, in a place a suspicious person can look before deciding and
again afterwards. ADR 0002 invariant 4's reasoning — approving something you
cannot see is not approving it — applied to bytes leaving the machine instead of
a credential entering it.

Two halves, because *before* and *after* are different questions:

- **Before.** The page renders the payload DASH *would* post right now, composed
  from the live store by the same function that composes the real one. Not an
  example and not a schema: the bytes, for this install's actual agents.
- **After.** `lab_telemetry_sends` holds each post verbatim. Rendered
  newest-first, including failures with their status codes, because a person
  checking what was sent is at least as interested in the attempt that failed.

**And now MAR-479's hardest question, which this ADR must answer rather than
assume: is an opt-in a user cannot verify worth having?**

Yes — but only with the claim scoped exactly as above, and the scoping is the
whole of the answer. DASH can prove what it composed and what it recorded
posting, because both are its own records. It cannot prove that no other bytes
left the machine; that is an assertion about a network DASH's own product
principle says it does not see. So the receipt is worded as a record of DASH's
own act and never as a guarantee about the interface. A person who does not
trust DASH is not made to trust it by a sentence DASH wrote about itself — they
are given a payload small enough to read and a port on their own machine to
watch it arrive at, which is more than a policy document could offer and is the
honest ceiling.

---

## Decision 6 — a daily batch, at most one observation per route per day, and never a gate

> **DASH composes one observation per (route, day) for each day an agent
> actually ran, sends what it has not sent before, and does this on startup and
> when a person presses Send now. A failure is recorded and nothing else.**

The alternative was send-on-event, at run completion. Rejected for two reasons
that are the same reason twice: the observation is *about a day*, so a second
run of the same agent on the same day adds nothing but a duplicate row LAB would
have to dedupe; and a sender wired into the event path is a sender that touches
the runner, which is a much larger change than "a new module in main" for no
gain. Reading the store on a schedule keeps the whole feature to one direction
of data flow and zero changes to how a run works.

De-duplication is DASH's, not LAB's: a `(goal_slug, observed_on)` pair already
present in `lab_telemetry_sends` is not sent again. So the batch is idempotent
across restarts, and a person pressing Send now twice posts nothing the second
time.

`observed_on` is the **UTC** day of the run's first event, because LAB's own
window (`loadDashTelemetryObservations`) compares it against a UTC day. A local
day here would silently shift a late-evening run into LAB's next bucket.

**Never a gate.** ADR 0004's rule, transplanted: LAB is not this repository and
not this machine, so nothing about the send half may block anything. A LAB that
is down, that 404s because `LAB_DASH_INGEST_ENABLED` is off, or that rejects the
token is a receipt row with a status code. It does not fail a run, does not
notify, does not retry in a loop, and does not appear anywhere except the page a
person opened to look at it.

---

## Decision 7 — off by default; revoking stops the send and keeps the receipts

> **The shipped state is off, with no token and no row. Turning it off deletes
> the token from the vault, stops all sending, and keeps every receipt. What was
> already sent is on LAB, and DASH says so plainly rather than offering to
> recall it.**

MAR-479's first constraint is "off by default, not off until you accept a
banner". Implemented as absence: no row in `lab_telemetry`, nothing in the
vault, and `shouldSendTelemetry` returns false on the absent state before it
reads anything else. A person who never opens the page sends nothing, forever,
and there is no dialog anywhere that asks them to.

**What happens to what was already sent** is the part MAR-479 says not to
assume, and ADR 0002 amendment 1's disconnect rule is the shape to argue
against: disconnecting a connection forgets the receipt and *keeps the audit
rows*, because erasing them would delete exactly the history a suspicious user
disconnected in order to check.

That argument transfers, and one half of it gets stronger while the other
disappears:

- **Keeping the local receipts is more obviously right here.** Somebody turning
  this off is very likely turning it off *because* they went to look at what was
  being sent. Deleting the record of it at that exact moment would be the worst
  possible timing for a helpful cleanup.
- **The other half does not transfer at all, because the rows are not DASH's to
  delete.** ADR 0002's audit rows are on this machine. These are on LAB. DASH
  can stop sending and can say what it sent; it cannot reach into somebody
  else's database, and an "erase what I sent" button would be a promise DASH
  cannot keep. The page says the true sentence instead: *what was already sent
  is on that LAB, and clearing it is done there.*

Turning it back on re-uses nothing: the token was deleted, so it must be pasted
again. The receipts remain, so the history reads continuously across the gap.

---

## Decision 8 — a same-day collision is made impossible rather than resolved

> **`dash_route_` prefixes every slug DASH sends. LAB's corpus slugs are corpus
> fixture names. The two sets cannot intersect, so the precedence question never
> arises.**

MAR-512's open question 4, answered by construction rather than by policy.

The situation described there is real: `goalsOn()` in LAB's `lib/insights.ts` is
first-occurrence-wins per day, and `loadInsights()` concatenates `lab-local`
first, so **`lab-local` silently wins any same-day, same-slug collision**. That
is deliberate-by-construction on LAB's side, and MAR-512 rightly said somebody
should choose it on purpose rather than inherit it from concatenation order.

Choosing it on purpose: **lab-local-wins is the right precedence and it should
also be unreachable.** Right, because LAB's own corpus sweep is a controlled run
over known fixtures and a remote install's report is not; if the two ever did
describe the same slug on the same day, the local one is the one whose
provenance is fully known. Unreachable, because a namespace prefix costs nothing
and turns "which source wins" from a rule somebody has to remember into a fact
about the strings. The `dash_route_` prefix is also distinct from the
`dash_demo_` prefix `pnpm seed:dash-telemetry` writes, so a real observation is
distinguishable from the fixture at a glance and by `LIKE`.

---

## Decision 9 — this setting takes its own decision kind

> **`lab_telemetry` joins `DECISION_KINDS`. Turning the send on, turning it off,
> and replacing the token each file one row against the fleet.**

ADR 0024's rule, and its own words on the trap: *"a decision kind resolves
against its own row"*. `fleet_level_model` and `chief_model` are both separate
kinds from `fleet_model_default` for exactly this reason — a view resolving one
against another's current value reports a setting nobody made. Filing this under
`fleet_connection`, or beside the notification route, would make the decisions
log answer *"is DASH sending telemetry?"* with somebody else's state.

Subject is the fleet (`subject_kind: "fleet"`, `subject_id: null`); it is a
property of the install, not of an agent. Topic is empty — there is one such
setting and no chain within it.

---

## What is proven, and what is not

**Proven by this packet** (transcript in the PR):

- an attended DASH run's observation arriving in LAB's `dash_telemetry_events`
  with a `dash_route_` slug, and LAB's `/insights` rendering `dash-telemetry` as
  a source alongside `lab-local`;
- the composition, unit-tested: a manifest whose goal, name and display name are
  distinctive strings produces a payload containing none of them;
- off-by-default, as the absent state rather than as a default value;
- de-duplication across restarts, and a failed send recorded as a receipt with
  its status.

**Not proven, and not provable from here:**

- That nothing else leaves the machine. Decision 5 scopes the claim rather than
  making it.
- That the telemetry answers Decision 1's question *usefully*. That needs months
  of a real install and a registry that grew a golden path because of something
  in this table. Until then the feature is a pipe with one honest message in it.
- Anything about LAB's behaviour under load, duplicate submission or a hostile
  sender. That is MAR-512's half and its own tests.

**Deliberately left open:** the `route_score` follow-up and the
`registry_fingerprint` field (both Decision 3), which are wire-shape changes
needing MAR-512's agreement rather than a unilateral DASH edit.
