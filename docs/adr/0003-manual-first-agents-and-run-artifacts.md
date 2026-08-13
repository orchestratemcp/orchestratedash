# ADR 0003: Manual-first agents, run artifacts, and the registry names they share

Status: Accepted

Date: 2026-08-01

## Decision

Three decisions from MAR-457, two of which cross a repository boundary.

1. **A run artifact is a separate contract from a run event.** `contracts/run-artifact.schema.json` is its own document, carried on the runner's existing newline-delimited JSON channel in its own bounded buffer, drained through its own route, and stored in its own table.
2. **An agent may publish a task that belongs to no run**, and DASH's command enforcement treats "belongs to no run" as a real answer rather than an unknown target.
3. **DASH's scaffolded manifest names registry components directly**, from one module, and deliberately omits one step the registry's own route contains.

## Why an artifact is not an event

Telemetry v1 is frozen by MAR-433 and its digest is held in `contracts/contract.lock.json`, which closes the question on its own. The load-bearing reason is different and would apply even if the contract were open: `listRuns` derives a run's status from its events. A document that arrived as an event would be a document that could change a run's status by existing, and an artifact is produced *by* a run rather than being a fact *about* its progress.

The two also fail differently. A dropped event costs a gap in a progress display; a dropped artifact costs the user the thing they were waiting to read. They are therefore bounded separately, so that a chatty agent's telemetry cannot starve a digest and a large digest cannot cost every agent on the machine its telemetry.

## Why a task may have no run

`contracts/agent-command.schema.json` requires `retry` to name a `run_id` or a `task_id`. An agent that only acts when asked has neither when it is first added, so it can be registered and never started — the control has nothing to point at.

Rather than invent a `run` verb or a placeholder run id, the agent publishes one task representing the work it is waiting to be given, and `agent-dom-state.schema.json` no longer requires `run_id` on a task. A placeholder run id would have attached that command's audit trail to a run that does not exist, and inventing a correlation to fill a column is worse than an empty column.

Enforcement gained a third answer for the same reason. `resolveRunId` previously returned `string | null` where `null` meant "no such target"; that conflated a forged id with a real task that legitimately belongs to no run, and refused the start button as `unknown_target`. It now answers `run`, `no_run` or `unknown`.

The no-run case is **deliberately conservative**: an agent whose manifest declares irreversible components is offered no start control, because DASH cannot see whether a fresh run would perform one. Withholding costs a manual start; offering can cost a duplicated irreversible action. An agent that needs both wants a runner-enforced gate, which is a design question rather than a default to assume the answer to.

## Why the registry names live in one DASH module

`lib/analyze.ts` matches executed steps to `planned_route` by exact `component_id` string, and those strings are the OrchestrateKit registry's own component names. A literal typed into the scaffold would be a cross-repository contract with nowhere to reconcile it, and the failure is quiet and severe: every step renders as unplanned drift, so the verdict surface fills with findings about an agent that did exactly what it said it would.

`lib/agent-sources.ts` is therefore the single place those names appear. MAR-455 published `public_feed_fetch` (registry `fb93a92`) for precisely this goal — anonymous RSS/Atom/JSON over a plain GET, no crawler account, no key, no billing relationship.

**DASH deliberately omits `scheduled_trigger`**, which that registry route contains. MAR-457 ships manual-first with cadence as a later opt-in, so declaring a scheduled step would promise a step that never runs and score `missing_step` drift on every manual run of the flagship journey. The step arrives with the schedule that makes it true.

This is the open cross-repository question. If the registry's answer differs — for instance by making the trigger conditional on a cadence the user actually chose — `lib/agent-sources.ts` is the one file that changes. It is tracked on MAR-456's session.

## What `network: read` is, and is not

A declaration DASH renders. `runner/supervisor.ts` strips the environment but spawns an ordinary child process with ordinary network access, so nothing in DASH restricts what an agent reaches.

Every surface attributes the claim to the agent — "it says this is what it will do" — and the durable receipt says plainly that DASH does not restrict it. This is the same distinction ADR 0002 draws for the draft-only Gmail boundary: a contract claim must not be dressed as a technical firewall, and the consent dialog is the most costly possible place for that lie.

## Consequences

An artifact is a first-class thing a run produces, which is what makes citations, a stable id and a grounding verdict expressible at all. Manual-first becomes a shape DASH supports rather than one it fights, and the conservative no-run default means an agent with irreversible components has to earn its start button.

Four defects reached the installed smoke on its first honest run and none of them reached a unit test: no caller drained the artifact buffer, a runless task read as an unknown target, `observed_at` churned every five seconds against an exact-match check, and two of the proofs were themselves wrong. That is the second time MAR-454's argument has paid for itself, and it is the reason the smoke gates `pnpm verify` rather than sitting beside it.

## Amendment 1 (MAR-464): what `observed_at` binds

Status: Accepted

Date: 2026-08-02

MAR-457 fixed the third of those defects only for Run now, by re-reading the snapshot from DASH immediately before issuing, and deliberately left approve and reject alone — because *"the world changed since you looked, look again"* is a property worth having in front of an irreversible action. That was the right instinct and the wrong repair. This amendment answers the question it left open.

### The question

`observed_at` was doing two jobs at once. It was the **identity of a snapshot**, and it was the evidence that **the decision context has not changed**. Those are the same thing only if a snapshot's identity changes when and only when its content does — and it did not. `runner/state.ts` mints the value on every build, `electron/agent-adapters.ts` rebuilds every five seconds, so what the field actually identified was *the poll*.

So the binding was wrong, and a timestamp that moves on a timer is the wrong shape for it. **The decision, and the thing now bound, is the decision context.**

### Why not simply widen the re-read

Because it removes a safety property nobody decided to remove, and it removes a second one quietly.

The visible cost is the obvious one: a control that re-reads its own freshness token immediately before acting cannot detect that the world moved, because it has just adopted whatever the world now says. In front of an irreversible action that is the whole check.

The invisible cost is worse. `idempotencyKey` hashes `observed_at`, deliberately — that is what lets a double click collapse into one command while a *deliberate* second attempt against a new snapshot is still allowed. Re-reading before every command mints a fresh value per press by construction, so every press derives a new key and the anti-duplication defence stops existing. The workaround was defensible on Run now only because starting a manual-first agent is not irreversible and the agent refuses a concurrent run itself. Generalised to approve and reject, it would have bought a duplicated irreversible action.

That defence was already degrading, which is the part nobody had noticed. Under a value that moved every five seconds, two presses either side of a poll derived *different* keys — so the protection held for a fast double click and lapsed for a slow one. It was masked only because the staleness check refused the second press first, for the wrong reason.

### The decision

`observed_at` advances when the **decision context** advances, and not otherwise.

`decisionIdentity` in `lib/agent-dom/enforce.ts` reduces a snapshot to the facts a control decision reads — status, connections, runs *by id and status*, tasks, choices, actions, approval requests and decisions, and `plan_vs_actual`. `lib/agent-dom/store.ts` carries the stored `observed_at` forward whenever that identity is unchanged. The enforcement comparison is untouched and still exact.

Three exclusions are load-bearing rather than incidental:

- **`memory` and `audit_events`** grow while an agent works. If they counted, this would fix the idle case and leave the busy one broken — an agent writing an audit row would invalidate a pending approval, which is the version a user would still meet.
- **A run's `progress`, `current_step`, `started_at` and `finished_at`** tick continuously through exactly the run an approval is usually blocking, and none of them changes whether any control is valid. `status` carries every transition that does.
- **Key order.** The digest is canonical at every depth, because an agent that rebuilt a task from a `Map` between polls would otherwise churn the identity with identical content — the original defect returning through a door no test would obviously be about.

### This is not DASH editing a document it received

The content is stored exactly as it arrived. What is declined is the *advance of an identity* for content that did not change, and the value written is always one the runner itself minted for this same context. It can only ever be **older** than the arriving one.

That direction is the argument. The invariant `runner/state.ts` protects is that an agent must not be able to make old state look current; freezing moves the value the other way, so the invariant is preserved rather than traded away. The runner's own latest timestamp is kept beside it as `runner_observed_at` and is what orders two snapshots — using a frozen value to answer *"is this older than what I hold?"* would have let a genuinely stale document roll a resolved approval back to pending, which is the one thing the out-of-order guard exists to refuse.

### Consequences

The workaround is removed rather than generalised, so there is one freshness rule again instead of one rule and an exception. Approvals survive being read, because looking is not an event. `stale_snapshot` starts meaning what it says. Idempotency works for the first time, including across a poll.

The detail page's `observed_at` row is relabelled **"State last changed"**: it no longer answers *"when did DASH last look"*, and left as "Last agent snapshot" it would read as *"DASH has stopped checking"* the moment an idle agent sat still. When DASH last looked is a separate question and `useLiveView` already answers it during a run.

One honest cost: a change to the projection is a one-off advance of `observed_at` for every stored snapshot, so any control drawn across an upgrade is refused once. That is why `decision_identity` is stored rather than recomputed on read — recomputing would silently reinterpret old bytes under a new definition, and being refused once after an upgrade is the truthful outcome.

Proved by smoke proofs **3g** and **3h** on the installed shell, paired deliberately: 3g that two poll intervals do not move what a control is bound to, 3h that a context which genuinely moved is still refused. `tests/decision-identity.test.ts` is the fast explanation of a failure, not the evidence — this defect passed 878 unit tests, and the harness is what found it.

## Amendment 2 (MAR-621): an idle retry may target the agent

Status: Accepted

Date: 2026-08-13

The original decision made a pending task the only honest target for a manual
agent with no run. That solved the scaffold in front of us and accidentally
made publishing a queue a prerequisite for being startable. The rebuilt agent
page exposed the contradiction: a valid manual agent could report `ready`, no
tasks, and no runs, while DASH said it ran only when asked and offered no way to
ask.

Two repairs were considered. DASH could open and dispatch an empty workspace
task before every press, or `retry` could target the idle agent itself. The
second is chosen.

A workspace task is custody for person-supplied files: opening one creates a
durable runner row and directory, dispatch closes it, and artifacts are
attributed through it. Creating that structure when there are no files would
make an empty custody record a ceremonial token for a different contract. It
would also leave durable state behind merely because somebody pressed Run.

An agent-targeted `retry` instead means exactly one thing: ask this already
running, already-reported agent to create a fresh run. It is accepted only when
all the existing trusted-side checks agree: the manifest declares `retry`, no
non-terminal run exists, the snapshot is current, and a fresh retry is safe
under the irreversible-component rule. `pause`, `resume`, and `cancel` still
require a run or task target. A published pending task still wins and remains
the more specific target.

Files do not move into this command. When a person selected files, MAR-507's
workspace dispatch still completes first and a refusal stops the retry. The
press remains the `retry` boundary in Electron main, so ADR 0016's spend
allowance still opens on that press and nowhere else. When another copy exists,
ADR 0014's existing sentence remains attached to the local control: “Run now
uses the copy on this computer.”

This is an additive command-v1 change. Existing agents and hosts that publish a
waiting task keep working unchanged; updated runners additionally accept the
narrow agent-only `retry` shape. Source tests prove both enforcement paths. An
installed local press producing the curated digest is still the proof required
to promote MAR-621 and MAR-619 from merged to proven.
