# ADR 0024: A decision is filed where it is made, and activity is never filed at all

**Status:** accepted — Henrik, 2026-08-16 ("lets sign it and start working"),
the same day the draft was posted. Implementation starts with the log itself —
the table, the filing module, the write-sites, the surface; the chief's memory
briefing is the following slice, on this document's own sequencing.
**Date:** 2026-08-16
**Issue:** MAR-673 (DASH — the chief's memory: what the fleet did and what was
decided, as one store it files as it goes)
**Touches:** ADR 0023 (the briefing rule, the frozen receipt, the staleness
marker, the blast-radius invariant), ADR 0012 (`agent_questions`' storage
discipline, `AskCitation`), ADR 0008 (untouched — nothing is added to the
author's panel). MAR-547's facts-only rule governs throughout.
**Repository:** orchestratedash

---

## Context

Henrik, 2026-08-16: *"Chief needs a memory. A good one. It should regularly file
sessions and decisions."* Asked what it should keep, he chose **both — activity
and decisions, as one memory.**

ADR 0023 decision 6 made the chief's *transcript* durable — `chief_messages`,
the frozen receipt, the computed staleness marker. That answers *"what did I ask
it last week"*. It deliberately does not answer *"what happened last week"* or
*"why did we do it that way"*, and its own closing line says why the gap is
real: *the chief's memory is conversational continuity; its knowledge is always
fresh.* Fresh knowledge is knowledge of **now**. Nothing the chief can currently
be briefed on says what the fleet did, and nothing anywhere says why.

The two halves are not the same kind of missing:

- **Activity** already exists as records. `runs`, `events`, `run_artifacts`,
  `command_audit`, `broker_audit` are DASH's account of what the fleet did, row
  by row. What is missing is only a briefing that reads them backwards in time.
- **Decisions** do not exist at all. A model gets pinned (`agent_model_choice`),
  a fleet default set (`fleet_model_default`), a connection granted
  (`broker_grants`), a manifest re-imported with a source gone (`agents`) — and
  in every case DASH keeps the *resulting state* and loses the *transition*. The
  tables answer "what is the setting"; nothing answers "when did it change, from
  what, decided by whom, and why".

The test this ADR must pass on paper, from the issue: **"why did the scout stop
covering Reddit?"** — answerable, with a receipt, from the two halves joined.
The walk-through is at the end, after the decisions that make it possible.

---

## Decision 1 — what counts: a decision is a committed change to standing state, filed at the write-site

> **A decision is filed when the answer to "what may the fleet do, or with
> what?" changes hands or changes value — and at the moment it does, by the code
> that did it.**

Concretely, a row is filed when:

- an agent is added or removed;
- a re-import changes what an agent's manifest **declares** — its connections,
  its sources, its planned route. The diff is DASH's own comparison of the
  document it held against the document it just accepted, which is a fact DASH
  observed, not an interpretation;
- a model is pinned to an agent, unpinned, or the fleet default changes;
- a connection is granted or revoked, for an agent or for the fleet;
- a standing setting that governs future runs changes — a deploy target, a
  notification route;
- a person approves a command marked **irreversible**. This is the one entry
  that is not a standing change, and it earns its place because it is the
  question a memory exists to answer about a single afternoon: *who let this
  happen*. Routine approvals, reads and refusals stay where they already are —
  `command_audit` is their table, and the activity briefing reads it.

What is deliberately **not** filed: run outcomes, artifact arrivals, telemetry,
refusals, lapses. Those are events, DASH already has events, and MAR-673 names
the failure precisely — *recording everything makes a log nobody reads.* The
decisions log grows at the speed a person changes their fleet, not at the speed
the fleet runs. That difference in growth rate is what makes Decision 4's
retrieval strategy affordable, so it is load-bearing, not taste.

**The kinds are a closed list.** `DECISION_KINDS` in `lib/fleet/decisions.ts`,
on `WRITE_PATHS` and `SPEND_PATHS`' terms: a short, frozen enumeration that is
the complete answer to a question a person asks — here, *"what can appear in my
decisions log?"* — and short enough to read in ten seconds. A kind that is not
in the list cannot be filed, so the log cannot quietly widen into the event
stream it exists not to be.

**Filed at the write-site, in the same transaction.** Not a watcher, not a
diff-scan, not inference after the fact. The function that writes
`agent_model_choice` files the decision row in the transaction that writes the
choice; the import path that replaces `agents.manifest_json` files the declared
diff in the transaction that replaces it. A memory assembled by observation can
miss; a memory written by the hand that made the change is complete for exactly
the kinds it covers — which is why the kinds list being closed and short
matters: completeness is only claimable per kind, per write-site, and each pair
is one visible call.

### The table

`fleet_decisions`, append-only:

| column | what it is |
| --- | --- |
| `id`, `decided_at` | arrival order and DASH's clock |
| `subject_kind`, `subject_id` | `agent` / `connection` / `fleet`; the id, null for the fleet |
| `kind` | one of `DECISION_KINDS` |
| `topic` | the chain key within a kind — the source name, the connection id, the setting name; empty when the kind needs none |
| `summary` | DASH's own sentence of what changed, composed by the write-site from the copy it already renders |
| `outcome_json` | the resulting standing state, **frozen** — including, for a re-import, the declared diff itself, because `agents` keeps only the latest document and the delta exists nowhere else the moment after |
| `decided_by` | `person` or `dash-rule`; when a rule decided, its name |
| `reason`, `reason_added_at` | Decision 2's columns |
| `receipts_json` | the record references this row was filed from — a `command_audit` id, an import timestamp, run ids. References, never prose |

No foreign keys, for `command_audit`'s stated reason: a decision about an agent
that is later removed must remain insertable and readable, and the rows most
worth keeping are exactly the ones whose subject is gone.

## Decision 2 — the reason is the person's or a rule's, never the model's, and its absence is said out loud

A decision without a why is an event, and DASH has events. But a *required* why
is worse than a missing one: a mandatory field yields ritual text, and ritual
text in a memory is speculation with a timestamp. So the reason is split into
what can always be true and what can only be offered:

- **The circumstance is always DASH's, and always present.** What changed, from
  what to what, on which surface, decided by whom — `summary`, `outcome_json`,
  `decided_by`, composed from records at filing time. Machine-authored,
  facts-only, and not a why. It is the part of the answer that never depends on
  anybody's diligence.
- **The why is the person's, offered at the moment of deciding.** The confirming
  control for each filing write-site gains one optional line — *why, for your
  future self* — stored verbatim in `reason`. The person's words travel as the
  person's words: rendered attributed and quoted, on `lib/copy/chief-chat.ts`'
  standing rule that author text is never folded into a paragraph where a reader
  cannot tell who is speaking. ADR 0008 is untouched — these controls live on
  DASH's own surfaces (settings, import, connections), not in the author's
  panel, which admits no control.
- **When DASH decided by rule, the rule is the reason.** A decision
  `applyFleetDefault` resolved carries `decided_by: dash-rule` and the rule's
  name, and the rendered reason is that rule's own copy string — the sentence
  DASH already shows for it — so the stated why cannot drift from the code that
  did the deciding.
- **When nobody authored one, the row says so.** *No reason was recorded.* The
  chief repeats exactly that sentence, because it is the true one. A person can
  add a reason later, from the decisions surface; `reason_added_at` is set and
  the rendering says *added later*, so a recollection cannot impersonate a
  contemporaneous note.

**The model never authors a reason, and neither does an agent.** A
model-composed why is MAR-547's forbidden sentence in its most plausible
costume: fluent, motivated, and standing in a speech position with nothing
behind it. This is the single most important refusal in this ADR. A memory
makes speculation *easier* — the model now has enough true circumstance to
build a convincing false why on — so the discipline tightens exactly where the
temptation grows.

## Decision 3 — a stale decision announces itself twice over, both times computed

ADR 0023's staleness marker compares a frozen receipt against DASH's records now
and marks the turn. That precedent extends to decisions with two mechanisms,
both computed at read time, neither a mutable flag — the log stays append-only
and history is never edited:

**Supersession, by chain.** `(subject_kind, subject_id, kind, topic)` is a chain
key. A newer row on the same key supersedes the older, computed by ordering at
read time. Every rendering of a superseded decision — on the surface, in a
briefing row, in a receipt — carries its successor: *later changed to Y, on
date*. "We decided X" therefore cannot be presented bare when X was reversed;
the chain arrives whole or not at all, and the memory briefing (Decision 4)
sends chains, not rows.

**Drift, by comparison.** `outcome_json` froze the standing state the decision
produced. At read, DASH compares it with the same state now. When they differ
and no later row on the chain accounts for it, the row is marked: *the fleet no
longer matches this decision, and no decision says why.* That marker is inside
the facts-only rule — two of DASH's own records, read and compared — and it is
also the log auditing itself: standing state that moved without a filed
decision means a write-site is not filing, which is precisely the defect
Decision 1's "what this costs" admits no gate can fully catch. The marker is
the detector.

## Decision 4 — retrieval is by subject and chain, never by similarity; and activity is projected, never filed

**No vector store, no embeddings, and also no keyword match.** The scout's ask
path is the cautionary shape: `selectItems` matches question words against
saved text and falls back to newest-N, which is why *"summarize"* matched
nothing — the word appears in no digest. That failure mode is not fixed by
better similarity; it is fixed by noticing that memory questions are not text
questions. *"Why did the scout stop covering Reddit?"* is not answered by any
stored sentence containing those words; it is answered by **the scout's
decision chains plus its activity**, and "the scout" is resolvable by
structure: the chief's routing corpus already resolves an agent from a
question, and keeps that job.

The memory briefing for a subject is therefore:

- **its decision chains, complete.** Not top-N: Decision 1's filter is what
  makes "all of them" affordable, and a truncated chain is exactly how a
  reversed decision gets presented as current. A ceiling exists
  (`MAX_MEMORY_ROWS`, on `MAX_BRIEFING_AGENTS`' honest-gap terms) far above any
  real chain-set and visible in the receipt when hit — truncation that shows
  itself rather than a fallback that pretends to be a match;
- **its activity, projected at ask time** from `runs`, `events`,
  `run_artifacts`, `command_audit` — counts, dates and notable rows, phrased by
  the same copy functions the screens use, over a stated window. When no
  subject resolves, the briefing carries fleet-scope chains and says so —
  `SelectionBasis`' discipline: a basis is stated, never passed off as a match.

**Activity is never filed.** No session summaries, no distilled "what happened
this week" rows, no model-authored digests stored as memory. Two reasons, and
each would independently suffice:

1. **DASH already files activity at ingest.** The tables *are* the filing. A
   second, summarized copy would be a cached projection — the exact thing the
   `runs` table's own comment refuses ("a cached projection is a second source
   of truth that drifts"), and ADR 0023's closing principle refuses for the
   chief: knowledge is always fresh because every question re-reads the store.
2. **A stored summary becomes a fact source.** Whatever authored it — and the
   only candidate with the fluency to do it is the model — its sentences would
   be read back as if they were records. That is a speculation cache with
   DASH's name on it, laundering yesterday's phrasing into tomorrow's facts.

Henrik asked for **one memory**, and this is one memory in the literal sense:
`fleet_decisions` lives in the same SQLite store as every record it cites,
`receipts_json` points sideways at rows in that store, and one briefing joins
the halves at ask time. *"Files as it goes"* holds with one correction that
keeps ADR 0023 intact: **DASH** files as it goes, at each write-site; the chief
reads memory and never writes it. The blast-radius invariant survives verbatim
— *the chief can ask a model a question and be charged for it; it can do
nothing else.*

## Decision 5 — the receipt discipline tightens: every remembered claim names its rows

The briefing rule carries over unchanged: **every field on a memory briefing
row is a string DASH already renders on a screen.** That sentence has a
structural consequence — a decisions surface must exist, because a row cannot
be composed of rendered strings if nothing renders them. A read-only list,
newest first, chains grouped, markers shown: the fleet page's memory section.
This is not decoration; it is the half of the receipt a person can walk to.
(*Unfindable is the same as missing* — a memory only a model can see is a
memory Henrik will report as absent.)

The receipt under a memory answer is the same rows that were sent, frozen into
`chief_messages` exactly as fleet briefings are today. `receipt_json` becomes a
tagged shape carrying fleet rows and memory rows; `parseReceipt` already reads
defensively, and a pre-0024 row keeps reading as fleet rows — an old receipt
reads as the weaker claim, that function's standing rule. Each memory receipt
row names its decision row and links to it on the surface; activity lines name
the run pages they were projected from. `AskCitation`'s discipline, third
surface: a model that invents a decision, a date, or a reason cannot make it
appear in the table beside its sentence.

And the tightening, stated as a rule rather than a hope: **a why the store does
not hold is a why the chief does not say.** When `reason` is null, the
records-first answer is *"no reason was recorded"* — that phrasing needs no
model at all, so the one question a memory most invites speculation on is
answered from records, `answerChief`'s arrangement extended to the past tense.

---

## The walk: "why did the scout stop covering Reddit?"

1. **The change.** On re-import, the scout's manifest no longer declares the
   Reddit source. The import write-site computes the declared diff between the
   document it held and the document it accepted, and files — same transaction —
   `kind: declared-source, topic: reddit, outcome: dropped, decided_by: person`,
   with the diff frozen in `outcome_json` and the import receipt in
   `receipts_json`. The confirm surface offered one optional line; say Henrik
   typed *"rate limits made it worthless."* His words land in `reason`,
   verbatim.
2. **The question, weeks later.** Routing resolves the scout. The memory
   briefing carries the scout's chains — including `declared-source/reddit`,
   whole — and its projected activity. The model phrases; underneath, DASH
   renders the receipt from its own records: the decision row, its date, the
   quoted reason attributed to the person, linked to the decisions surface.
3. **The reversal case.** Reddit re-added in September: the chain carries both
   rows, so the answer's material says *dropped, then restored* — a bare "we
   dropped it" is not composable from what was sent, and the receipt shows the
   chain regardless of what the model wrote.
4. **The silent-drift case.** Reddit reappears in the manifest with no filed
   row: the drift marker renders on the dropped-decision — *the fleet no longer
   matches this decision, and no decision says why* — which is both the honest
   answer and the bug report.
5. **The no-reason case.** Henrik skipped the line: *"the source was dropped
   when the manifest was re-imported on 20 August; no reason was recorded."*
   True, receipted, answered without a model — and the decisions surface lets
   him add the reason now, dated as added later.

At no point did the model supply a fact. It supplied word order.

---

## What this costs, stated rather than designed around

**Write-site coupling, and a completeness claim that is per-kind.** Every
filing write-site takes a dependency on `lib/fleet/decisions.ts`. A standing
setting added *later* whose write-site does not file makes the log lie by
omission, and no gate fully catches that — the copy-gate lesson: a rule can be
green everywhere and unenforced on a surface nobody wired. Two mitigations,
neither total: a source-assertion test that writes to the standing tables named
in `DECISION_KINDS` occur only in modules that file (the house shape used to
pin "nothing reads `cost_usd`"), and Decision 3's drift marker, which turns a
silent omission into a visible one after the fact.

**The why will usually be empty.** An optional line mostly goes unfilled. Then
the log degrades to circumstance-only — which is still the transition, the
actor, the date and the diff, all of which DASH loses today. The floor is
useful; the ceiling needs Henrik's habit, and no schema can supply it.

**`outcome_json` is a frozen copy.** For re-imports it holds a diff of a
document DASH otherwise keeps only latest-of. Deliberate, and the same shape as
the frozen receipt: a record of *what the decision changed*, not a second copy
of current truth — nothing reads it to answer a present-tense question.

**A charged question grows.** Memory rows ride the same model call as the fleet
briefing, so a subject with long chains costs more per question. Bounded by
`MAX_MEMORY_ROWS`, visibly truncated in the receipt when hit; where to truncate
*well* is left open, ADR 0023's own posture on the briefing cap.

**A new surface.** The decisions list must be built, placed, and kept — the
briefing rule makes it a prerequisite, not a follow-up.

---

## What is proven, and what is not

**Nothing.** This is a decision document; no code exists against it, and an ADR
proves nothing by itself.

Provable once built:

- each filing write-site, driven through the transaction: change made → row
  filed, change refused → no row;
- supersession and drift as pure functions, `fleetChangedSince`'s test shape;
- the Reddit walk end to end as a fixture: import diff → filed row → memory
  briefing → frozen receipt, including the reversal and no-reason arms;
- the receipt round-trip: a pre-0024 `chief_messages` row still renders, a
  tagged one freezes and re-renders its memory rows;
- the decisions surface, by capture.

**Not judgeable before the fleet has real history** — the same boundary ADR
0023 drew, one step further out: whether `DECISION_KINDS` covers what Henrik
actually changes, whether the optional why ever gets written, and whether
chains-plus-activity is enough material for faithful phrasing are all
observable only against months of a fleet that has done real work and had real
decisions taken about it. The bar stays the issue's own: ask the chief
something about last week that is true, and get an answer with a receipt naming
the records it came from.
