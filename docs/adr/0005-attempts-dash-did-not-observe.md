# ADR 0005: An attempt DASH did not observe is a different kind of fact from a decision it made

Status: Accepted

Date: 2026-08-02

## Decision

DASH will surface brokered requests it never adjudicated, and will keep them
**structurally incapable of being mistaken for adjudications**.

Three storage decisions, not one surface:

1. **A request the runner destroyed** — its bounded buffer was full — becomes a
   row in a new `broker_lapses` table. The table has no `decision`, `refusal`,
   `operation`, `connection_id` or `request_id` column, and cannot acquire one
   without a further ADR.
2. **An answer DASH could not confirm was delivered** becomes a `delivered`
   column on the existing `broker_audit` row. It is *not* a lapse, because a
   decision really was made.
3. **A window in which DASH was closed** becomes a `broker_lapses` row carrying
   no agent and a NULL attempt count. It asserts DASH's own absence and nothing
   about any request.

`broker_audit` keeps its existing meaning exactly: every row is a decision DASH
actually made.

## The problem

MAR-458's broker audits every request it *handles*, including every refusal. It
cannot audit one it never received, and three ordinary things cause that. In all
three the agent settles as `broker_unavailable` at its own timeout and the
Connection Center shows nothing at all.

The permission card's history is what makes the boundary inspectable, and it was
a record of **DASH's decisions** rather than of **the agent's attempts**. Those
two agree right up until something is wrong. A user asking "why did it not read
my mail" got an empty list, which reads as "it never tried".

## What was actually available, before designing on top of it

MAR-466 and MAR-473 were both hypotheses that lost to one query, so this is what
the source says rather than what the issue guessed.

| | who observed it | what is known | survives a restart |
| --- | --- | --- | --- |
| Buffer drop | the runner | agent id, wall-clock time, a count | no — an in-memory counter |
| Undeliverable answer | the runner, then DASH | which answer, and the decision behind it | the decision does; the delivery fact did not exist |
| DASH closed | nobody | nothing | n/a |

Three findings changed the design, and the third changed the issue:

**The drop was counted but not attributed.** `Supervisor.bufferBrokerRequest`
incremented one integer for the whole process. The agent id was in hand at that
moment — it goes into the log line — and was thrown away. The count reached DASH
on the existing drain and `electron/broker-host.ts` logged it to the console and
discarded it.

**The runner already knew delivery failed, and DASH already had the answer in its
hand.** `respondToBroker` returns false when there is no live pipe;
`deliverBrokerResponses` counts those; the count is returned in the HTTP response
to `POST /broker/responses` — which `broker-host.ts` never read. The third case
was observed all along and thrown away one line short of somewhere to put it.

**The issue is wrong that case 3 leaves no trace.** `lib/broker/execute.ts`
audits on **every** path, before the answer travels. By the time delivery fails
the audit row already exists, complete with operation, request id and result
count. So case 3 is not a missing record — it is a record that *overstates*: the
history says "allowed, 12 results" for a call the agent got nothing from. That is
a worse defect than silence and a completely different fix, and treating it as a
third variety of "no trace" would have produced a second row for an event that
already had one.

## The judgment: what kind of fact is an attempt nobody adjudicated?

The three cases do not split 2 + 1 as the issue proposes. They split by **who
observed what**, and that is what decides where each one lives.

Case 3 is a **property of a decision**. DASH decided; the decision is exactly as
auditable as any other; what failed happened afterwards. It belongs on the audit
row, and putting it anywhere else would scatter one event across two tables and
make a user correlate them by timestamp.

Case 2 is an **observation without an adjudication**. Something real happened —
the runner watched a specific request die — and DASH is reporting *somebody
else's* observation, which is why the row records `observed_by: "runner"`.

Case 1 is **not an attempt at all**. Nobody saw anything, by construction: the
broker lives in Electron main because the vault does, so while DASH is closed
there is nothing to notice. The only fact available is DASH's own absence, which
DASH observes perfectly well by noticing on startup that it last wrote a
heartbeat an hour ago. So the row says *that*, and the sentence a user reads —
"this agent keeps running while DASH is closed, so nothing was there to answer
it" — is **derived at render time** from whose runtime declares
`continues_when_dash_closed`. Derived rather than stored, because the answer
changes when a manifest changes and a stored answer would go on asserting
yesterday's.

### One surface or two

**Two, and the split is by what DASH did rather than by what went wrong.** The
audit trail stays a list of decisions. Everything else appears under a separate
heading, "What DASH cannot account for", with no verdict chip, no operation name
and nothing shaped like an adjudication.

Cases 1 and 2 share the `broker_lapses` table despite being observed by different
parties, because they answer the same user question and any other arrangement
forces the page to union two tables to render one list. They stay distinguishable
by `kind` and by `observed_by`.

### The rule, made structural

The requirement was that a lapse be visibly a different kind of fact *in the data
model*, not only on the page. The strongest available version of that is a table
that **cannot express a decision**: no `decision`, no `refusal`, no `operation`,
no `connection_id`, no `request_id`, no `result_count`. A future careless join
cannot produce an audit-shaped row from it, because the columns to fill are not
there.

`tests/store-sqlite.test.ts` asserts the exact column list. If a later feature
genuinely needs an operation name on a lapse, that test failing is the intended
conversation: it means the runner has started parsing agent-authored request
bodies in the one process that talks to every agent, which is a decision for an
ADR and not for a migration.

## What this costs

**A dropped request can never say what it asked for.** The runner does not parse
a brokered request — `lib/broker/protocol.ts` is the parser, on the DASH side
where the allowlist and the vault are — so a drop is a count of things nobody
read. Labelling drops would mean putting a second reader of untrusted
agent-authored bodies in the runner, to improve a diagnostic. Not worth it. The
qualifier on the card says so out loud instead of leaving a user to infer it from
a missing field.

**A closed window can overstate DASH's absence by up to one heartbeat interval,
and can never understate it.** The window starts at the last heartbeat, which is
written every 30 seconds and once more on a clean quit. The error is one-sided by
construction.

**A closed window is only recorded when an already-running runner spanned it.**
DASH adopted a runner that reports starting at or before the last heartbeat, so
one process was up at the start of the window and is up now. A runner started
*during* the window is not recorded at all, because DASH cannot see when within
the window it started and therefore cannot bound the claim. Restarts under 60
seconds are not recorded either: a page listing every restart is a page nobody
reads, which is the same failure as a page listing nothing.

**`delivered = 0` means "DASH could not confirm delivery", not "the agent never
got it".** Three situations reach it — the child had exited, the POST failed, its
reply did not parse — and only the first is certainly a non-delivery. An
acknowledgement DASH never received looks identical to one that was never sent.
Asserting a failure DASH cannot see is the same error as asserting a decision
nobody made, pointed the other way, so the column and the copy both claim only
what is supportable. `NULL` stays "nothing to report" and is never recruited to
mean "confirmed fine".

**Nothing here makes an agent's failed request succeed.** This is a visibility
change. ADR 0002 amendment 1's cost — when DASH is closed, the broker is closed —
is unchanged and remains correct.

## What is proven, and what is not

Stated plainly, because the split matters more than the total.

**Proven end to end on the installed shell** (proof 8): case 2. A real agent the
runner spawned fires 200 brokered requests past a buffer of 64; the shell's own
broker loop drains, records and renders. The load-bearing check is **8d**, which
compares audit rows against requests actually sent and fails if the two sum past
what the agent fired — a build that synthesised a plausible row for a request
DASH never received would pass every other check in the file and fail that one.
8e asserts the lapse carries no operation, decision or refusal; 8f asserts the
rendered sentence names no operation either.

**Unit tests only**: cases 1 and 3.

- Case 3's runner half is proven over the real local transport
  (`tests/runner-server.test.ts` drives `POST /broker/responses` and asserts the
  reported positions), and its DASH half — marking the right audit row — is
  covered in `tests/broker-lapses.test.ts`. What is *not* proven on the installed
  shell is the two halves meeting, because that needs a child to exit inside the
  window between DASH deciding and the runner writing. That is reproducible but
  it is a race to schedule rather than a bound to hit.
- Case 1 cannot be driven by a proof running *inside* DASH, because it requires
  DASH not to be running. The pure derivation is tested exhaustively
  (`lib/broker/uptime.ts` has one exported function and every rejection path has
  a test); the wiring in `electron/main.ts` is not covered by an installed proof.

MAR-454's warning is the reason this paragraph exists: a test that only exercises
something in-process proves the code and not the product. One of three is proven
against the product. The other two are not, and no state file will say otherwise.

## Alternatives rejected

**Synthesise an audit row for a dropped request, marked somehow.** This is the
thing the issue explicitly warns against and it is right. `command_audit` and
`broker_audit` are believable precisely because every row is a decision DASH
made; one fabricated row that looks like a decision costs the whole table its
credibility, and a marker column is a convention that survives exactly as long as
every future reader remembers to check it. A separate table with no decision
columns survives readers who forget.

**Store the closed window per agent.** It would make rendering a lookup instead
of a derivation, and it would freeze `continues_when_dash_closed` as it was at
the moment DASH started, so an agent whose manifest changed afterwards would be
warned about a window that never applied to it.

**Have the runner buffer what it drops so DASH can label it.** Retaining what you
discarded to describe the discarding defeats the bound that caused it. The bound
exists because a brokered request is something an agent wants done to a user's
account.

**Raise `MAX_BROKER_BUFFER_COUNT` so drops stop happening.** Treats the symptom,
keeps the dependency, and is ADR 0004's "why not simply raise the timeout" in a
different costume. The bound is right; what was missing was a way to see it act.

## Follow-ups this does not do

- An installed proof for case 3 is possible — an agent that sends one request and
  exits immediately — and is not written here. It would fold a second failure
  into proof 8 and make a red line ambiguous about which case broke.
- Case 1 has no installed proof and probably cannot have an unattended one. If it
  ever gets a dated manual proof, ADR 0004's rule applies: manual, dated, and not
  in `pnpm verify`.
- Lapses are never pruned. The volume is bounded in practice — one row per drain
  that dropped anything, one per closed window — but nothing collects them, and a
  long-lived install will accumulate. Worth doing when somebody has a store big
  enough to notice.
