# ADR 0022: DASH may start a stopped agent on this computer, and a start press is a run press

Status: Accepted

Date: 2026-08-16

Companion to [ADR 0014](0014-asking-a-host-to-run-an-agent.md), which decided
that a control starting a run must name its machine, and to
[ADR 0016](0016-a-run-press-may-spend.md), which decided who is allowed to
spend. This decides **what the primary control does when there is no process.**

## Decision

Four things.

1. **The agent page may start a registered agent's process on this computer.**
   The verb is `runner.start`, which has been in `lib/shell/ipc.ts`'s `COMMANDS`
   since MAR-415 and reaches `POST /agents/{id}/lifecycle {"action":"start"}`.
   **No new capability is granted here** — the route, the allowlist entry, the
   audit record and the supervisor's refusals all predate this decision. What is
   new is that a person can reach it.
2. **One press performs both acts: start the process, then ask it to run.**
   Starting an agent does not run it — the kit template starts idle and stays
   idle on purpose (MAR-457), publishing the pending task that Run now binds. A
   control that only spawned would leave a person watching a status change.
3. **The spend allowance still opens in exactly one place.** The second act *is*
   an Agent DOM `retry` going through `runAgentCommand`, so ADR 0016's single
   door — `input.command === "retry"` in `electron/main.ts` — is where the
   allowance opens, unmoved. A lifecycle command on its own still spends nothing.
4. **The control is offered only for a status the runner published about its own
   child.** `offline` and `error` are the two `resolveStatus` produces when the
   process is not live, and `SELF_REPORTABLE_STATUSES` forbids an agent from
   claiming either. Nothing reads `agent_deploys`, so ADR 0010's rule that a
   deploy row is not a liveness record is untouched.

## The problem this was written to solve

Henrik, on MAR-657, from an attended proof pass: *"What I truly lack is a run
button. One that triggers the agent to go through all its steps."* And, of the
newly installed competitor scout: *"No trigger run so we can't see output or
chat with it."*

The state of the real store when that was written:

```json
{"agent_id":"competitor-scout","status":"offline","runs":[],"tasks":[],
 "choices":[],"actions":[],"approval_requests":[]}
```

`ai-news-scout-4` and `ai-news-scout-5` were identical. **Every agent on the
machine was stopped, and nothing in the product could start one.**

That was not a missing button. It was a missing caller. `runner.start` had
exactly one call site — `ensureRunning` in `lib/handoff-flow.ts`, at the end of
the add-agent flow — so an agent was started on the day it was installed and by
nothing afterwards. `runner/main.ts` adopts every registration with
`child: null` and calls `start` on none of them, which `runner/README.md` states
as a deliberate non-goal: *"An agent that exits stays exited. Supervision here
means 'knows it died and says so', not 'brings it back'."*

So DASH's supervision surface could observe, adjudicate, pause, resume, cancel
and remove — and could not begin anything.

## Why the predicate is not a widening

`lib/views/agent-control.ts` refuses to offer Run now whenever the agent merely
looks idle, and says why: *"offering Run now whenever the agent looks idle would
put a button on screen that `submitAgentCommand` refuses, which is worse than no
button because the refusal arrives after the press."* That reasoning is correct
and this decision does not touch it.

The new branch answers a **different question on a different channel**. Run now
asks *is there a task to bind*, and is refused by the Agent DOM command
pipeline. Start asks *is there a process*, and is refused by the supervisor with
`unknown_agent | already_running | invalid_manifest | spawn_failed`.
`already_running` is excluded by the status that gates it; the other three are
runtime facts no predicate could know in advance, and they are named on screen
rather than swallowed.

### It also removes a refusal that already existed

`runner/state.ts` gates `runs`, `choices`, `actions` and `approval_requests` on
the process being live. **`tasks` is the one array it does not.** A dead agent's
last self-report keeps its tasks verbatim, so an agent that ran and then exited
still carried a pending `waiting-to-be-run` — and drew a Run now whose `retry`
`Supervisor.deliver` answers with `not_running`. That is precisely the
after-the-press refusal the module was written to prevent, arriving by a road
nobody had walked. Deciding `start` **above** the pending-task check replaces a
button that could not work with one that can.

## What `AGENT_CONTROL_COPY.idle` keeps

All three sentences. MAR-609 built them because a freshly added agent once
showed no button and no explanation, and a *running* agent with nothing pending
still gets `nothing_waiting` and still gets no button. This adds a way to start;
it deletes no explanation of why you cannot.

## How a schedule reaches the same door (MAR-490)

Deliberately, the verb is a **composition of two routes that already existed**
rather than a new message the runner has to learn. A cadence therefore needs no
new one: it fires the same two acts, in the same order, against the same routes,
and the allowance opens in the same place because the second act is the same
`retry`.

What a scheduler additionally needs is the thing ADR 0014 already named as out
of scope and did not decide:

> Trigger configuration — "on command, at a time, on an interval" — is a
> separate decision and a larger one. It is blocked on restart-on-boot, which
> ADR 0007 left open on purpose, and it needs a scheduler that exists nowhere in
> this repository.

Both halves of that stand. A schedule that only fires while DASH is open is not
a schedule, and nothing here changes that. What has changed is that the door it
would fire *at* now exists and is reachable by a person, which is the half
MAR-657 was filed on.

## What this does not decide

- **No restart policy.** `runner/README.md` item 3 is untouched: an agent that
  exits stays exited, and nothing brings it back on its own. A person's press is
  still the only thing that starts a process, which is why this is safe to ship
  without the scheduler.
- **No remote start.** Every port is the local one. ADR 0014's per-server
  controls are unchanged and still name their machines; this control is the
  permanent local default it sits beside.
- **Nothing about an agent that publishes no task.** It starts, it stays up, and
  DASH says so. Whether such an agent should be startable at all is a question
  about the manifest contract, not about this control.
