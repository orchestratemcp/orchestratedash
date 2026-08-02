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
