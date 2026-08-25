# ADR 0029: A schedule is a standing instruction the runner honours while nobody watches

**Status:** accepted — MAR-742 roadmap item 8, from Henrik's late-evening intake
on 2026-08-24: *"we need to be able to do chron / schedule jobs in DASH."*
**Date:** 2026-08-24. **Issue:** MAR-742, roadmap item 8. **Touches:** ADR 0022
(starting a stopped agent — this composes its two acts and adds no third),
ADR 0028 (the runner outlives the window — this is its shape, applied to a
second thing the runner has to do alone), ADR 0016 (a run press may spend —
decision 5 is where this ADR is narrowest), ADR 0014 (asking a host to run an
agent — this answers the question it deferred), ADR 0007 (restart-on-boot, left
open, and still open). **Repository:** orchestratedash.

---

## Context

ADR 0014 named trigger configuration and declined it, in a paragraph two later
decisions have quoted back:

> Trigger configuration — "on command, at a time, on an interval" — is a
> separate decision and a larger one. It is blocked on restart-on-boot, which
> ADR 0007 left open on purpose, and it needs a scheduler that exists nowhere in
> this repository.

That refusal was then written into the product. `AGENT_TRIGGER_COPY` on the
agent's Settings stage has shipped three radio buttons since MAR-641, two of them
disabled, and the disabled ones say why: *"Not built yet. DASH has no scheduler,
and nothing would start it while DASH is closed."* A person reading that page
learns exactly what DASH cannot do.

Both halves of ADR 0014's sentence have since changed, and only one of them has
changed all the way.

**The scheduler now has a place to live.** ADR 0028 moved the chief into the
runner on the strength of one fact: `electron/runner-process.ts` spawns the
runner **detached**, so closing DASH's window leaves it running. MAR-588 had
already used that fact once — the Discord *sender* is `runner/notify.ts` and not
a module in main, because the setup copy promises *with DASH closed and the
computer on, messages are still sent* and a sender in main would have made that
copy a lie. The same sentence is what a schedule needs, and the same process is
where it has to go.

**The door a schedule would fire at now exists.** ADR 0022 built it, and said so
in a section written for this decision before this decision existed:

> Deliberately, the verb is a **composition of two routes that already existed**
> rather than a new message the runner has to learn. A cadence therefore needs no
> new one: it fires the same two acts, in the same order, against the same
> routes, and the allowance opens in the same place because the second act is the
> same `retry`.

**Restart-on-boot has not changed.** ADR 0007 left it open and it is still open.
DASH does not install a launch agent, a scheduled task, or a service, and this
packet does not add one. So the honest reach of a schedule is bounded by the
runner's own lifetime, and the whole of decision 7 and the whole of the copy
follow from that.

### The bar this is being held to

The disabled radios are the precedent, and they are the reason this ADR spends
as much prose on what a schedule *cannot* do as on what it can. A product that
replaced *"Not built yet, and nothing would start it while DASH is closed"* with
a time picker and silence would have taken a true sentence off the screen and put
nothing in its place. Everything below is written so the replacement sentence is
also true.

---

## Decisions

### 1. The schedule is a row in `dash.sqlite`. The runner is handed a copy and never reads the file

`agent_schedules` is the home: one row per agent, written by a person's press in
DASH's window, read by the agent page, and deleted when the agent is removed.

The runner is given a copy over its authenticated local channel and holds it in
memory. It does not open `dash.sqlite`, for ADR 0028 decision 6's reason
unchanged and undiluted: that file was destroyed twice in three days, ADR 0027
names a second writer on a WAL store as the mechanism, and a scheduler is a
process that wakes up at exactly the times nobody is watching.

**Why not a file beside the registrations.** `runner/README.md` makes registrations
files rather than rows on purpose, and a `schedules/` directory would have
inherited that argument and one property this decision wants: the runner would
have its schedules back after a restart without waiting for anything. It is
refused because it makes two homes for one fact. A schedule is edited on a page,
shown on a page, and has to be deleted when the agent is, and every one of those
is a store operation; a file that also held it would be a second copy free to
disagree, and the disagreement would surface as an agent that runs on a cadence
its own settings page says it does not have.

### 2. The copy is pushed on the evidence poll, not on the settings change

`electron/agent-adapters.ts` already runs a pass over the runner's evidence
routes every five seconds while DASH is open. The schedule set rides it: every
tick, DASH drains what the runner has done and then re-asserts the whole current
set.

The alternative — MAR-588's and ADR 0028's shape, a push fired after each
settings change — is refused **because MAR-745 already found its failure mode**.
The chief's snapshot was pushed at bridge-setup time and on nothing else, so a
runner went on answering from a fleet that had stopped being real, with nothing
on screen to say so, and the fix was to enumerate every event that must also
push. That enumeration is a closed list somebody has to widen correctly forever.

A re-assertion on a five-second cadence has no such list. A push that fails is
retried within five seconds; a runner adopted from a previous launch is corrected
within five seconds; a schedule saved while the socket was briefly wedged lands
within five seconds. The cost is a few hundred bytes on a local socket twelve
times a minute, which is smaller than the cost of the bug it removes.

**What the push carries, per agent, is the schedule and one more thing: the
newest window DASH already has a record of.** That is what lets a runner which
has just started know where to resume from without keeping anything of its own
across a restart, and it is the same *"takes its world as arguments"* shape ADR
0028 decision 1 gave the chief.

### 3. The runner fires, and DASH's window fires nothing

There is one scheduler and it is in the runner, including while DASH is open and
looking straight at it.

A second one in main would be faster to write and would double the number of
processes that can start an agent. The failure it produces is not a race that
occasionally fires twice; it is that the two schedulers would have different
liveness, so *whether a run happened* would depend on which of two processes was
alive at 08:00 — and that is the one question this feature exists to answer.

### 4. A fire is ADR 0022's two acts, composed in the runner, through the runner's own adjudication

Start the process if it is not running; wait, bounded, for the agent to publish
the pending task the kit template opens on startup; then deliver a `retry`
bound to that task.

`retry` goes through `executeCommand` — the runner's own validation, its own
nonce table, its own idempotency claim, its own audit row. Not through a shortcut
to `supervisor.deliver`. `runner/execute.ts` states why in its own header: the
Agent DOM v2 threat model assumes a compromised DASH "can request any displayed
action" and answers that the runner still checks for itself, and a second,
narrower path to "the runner accepted a retry" is exactly how a rule enforcement
already makes could come to be bypassed. `applyStandingAnswers` made the same
choice for the same reason and said so.

**No new verb.** Nothing in the contract, the command catalogue, or the
supervisor learns the word "schedule". A scheduled run is a `retry` with a
different actor, which is what makes it renderable by every surface that already
renders runs.

### 5. The actor is `runtime_adapter`, on its own channel principal, and never `dash_session`

`DASH_LOCAL_PRINCIPAL` may assert `dash_session` and nothing else, and
`runner/execute.ts` is explicit about what that value means: *"the OS user
running this copy of DASH"*. At 03:00 with the window closed there is no such
user in the loop, and writing one into the audit row would be the runner
inventing a session to make its own command look ordinary.

So a scheduled fire runs under `SCHEDULE_PRINCIPAL` — `channel_id:
"dash-schedule"`, may assert `runtime_adapter` and nothing else — with an actor
of type `service`. `runtime_adapter` is already in the contract's enum and has
had no producer until now.

The consequence is the one worth having: `runner_audit` can be read after the
fact and a scheduled run is distinguishable from a pressed one, by a column,
without inference. That is ADR 0021's rule and ADR 0028 decision 7's, arriving in
a third place.

### 6. A scheduled fire opens no spend allowance

ADR 0016's allowance is opened in exactly one place — `input.command === "retry"`
in `electron/main.ts` — and a run fired by the runner does not pass through it.
This decision is that it stays that way, and that the absence is stated rather
than worked around.

ADR 0028 decision 8 made the same call for the chief's second room, and the
argument transfers with its sign made stronger rather than weaker. A Discord
message needs a person to type it every time; a schedule is typed once and fires
forever. `lib/broker/spend-allowance.ts` was written against precisely this
shape: *"An agent that may spend without a per-run budget is an agent that can
empty an account between two of DASH's five-second polls."* A daily schedule is
that sentence with the polls removed.

**What it costs, stated rather than designed around.** An agent whose plan
curates through a model — the News Scout does — gets that step refused on a
scheduled run. It still runs, still fetches, and still publishes what it can
produce without spending; the refusal is recorded where every other brokered
refusal is. That is a real reduction in what a scheduled run is worth, and it is
accepted here because the alternative is not a narrower design but an unattended
credential with no ceiling on how many times it fires.

**What would lift it, named rather than implied.** A per-schedule ceiling the
person sets when they set the time — *"this may spend at most N model calls per
scheduled run"* — plus the runner-side broker that could enforce it, which ADR
0021 already built for a host and ADR 0028 decision 5 already narrowed for the
chief. That is the smaller half of a real packet, not a line in this one, and
`lib/broker/spend-allowance.ts`'s own note is the design brief for it.

### 7. A missed window is reported as missed, and never backfilled

If the machine was asleep, off, or restarted when a window came round, DASH says
so and does not run anything late.

Catch-up-on-wake was considered and is refused, for two reasons that point the
same way. The first is about the work: an agent scheduled at 08:00 to collect the
morning's news does not want the 08:00 run at 14:20, and a product that delivers
it has produced a stale artifact with a fresh timestamp — which is the class of
lie ADR 0015 and `fleetChangedSince` exist to prevent elsewhere. The second is
about the volume: a person who leaves a laptop shut for a week comes back to a
machine that starts seven runs at once, and a person cannot be asked to predict
that when they pick a time.

So a window that came round while nothing was watching is settled as `missed`,
with a sentence and a count, and the next fire is the next window. **The record
of a missed window is written when the runner next ticks**, which is to say when
the machine is back — the runner cannot record something at a moment it did not
exist for, and a row claiming otherwise would be DASH stamping its own absence
with a time it was not there.

A grace window makes this a decision rather than a race: a due moment reached
within `SCHEDULE_GRACE_MS` of now fires, and anything older is missed. A tick
that ran fifteen seconds late fires; a machine that woke ninety minutes late does
not.

### 8. What the runner produced is spooled, and DASH drains it

`schedule_spool` in `runner.sqlite`; `agent_schedule_runs` in `dash.sqlite` is
the home. Read-then-delete in one transaction, bounded at the write, dropping the
oldest — the chief's spool exactly, for its reasons.

This is the half that makes the feature legible. A run that happened at 03:00
lands in the store as telemetry the next time DASH opens, like any other run; what
telemetry cannot carry is *that a schedule caused it*, because the agent minting
the run id has never heard of the schedule. The spool is where that fact travels,
and it is why the agent page can say "ran, on time" rather than making a person
infer a cause from a timestamp.

### 9. Daily at a time is the whole of v1; the cron expression is refused, visibly

One kind, `daily`, one field, `HH:MM`, in the machine's own local time. No
timezone is stored, because the schedule fires on this machine and nowhere else,
and a stored zone would be a promise about portability nothing keeps.

The third radio stays on screen and stays disabled, and its copy changes from
*"not built yet, for the same reason as a set time"* to a reason that is now
actually true: a written schedule is a power-user affordance and the novice
default has to work first. The switcher keeps doing the job MAR-641 gave it —
showing a person the shape of the thing and being honest about which parts of it
exist.

Weekly, weekdays-only, and every-N-hours are all cheap once `daily` is proven and
none of them is in this packet.

### 10. Discord notification of a scheduled run rides MAR-588 unchanged

Nothing is built here and nothing needs to be. `DiscordNotifier` lives in the
runner and watches the child's own output, so a scheduled run that publishes an
artifact produces the same *"published a new report"* message a pressed run does,
at 03:00, with DASH closed, through machinery that already exists.

What the message does **not** say is that the run was scheduled. That is a real
gap and it is named rather than closed: `NotifiableEvent` would need a third
kind or a flag, `buildDiscordMessage` a branch, and the notifier a way to learn
which runs the scheduler caused — a small packet, and the wrong one to bolt onto
this while the fire path is still being proven for the first time.

---

## The liveness sentences

Three, in the shape MAR-588 established and ADR 0028 extended, because a person
who is about to rely on a cadence is owed the boundary of it before they set one:

1. **DASH open** — the schedule fires.
2. **DASH closed, computer on** — the schedule still fires, from the runner.
3. **Computer asleep, off, or restarted** — nothing fires. The window that came
   round is recorded as missed, and nothing fires again until DASH is opened
   once, because the runner is gone and comes back with nothing.

The third sentence is the one this feature is judged on, and it is the one ADR
0007 owns. A schedule that survived a restart needs DASH to install something
into the operating system's own scheduler, which is a decision about what an
installer may do to a person's machine and is not made here.

**The copy on the settings page says all three.** That is the whole of what this
ADR asks the surface to do.

---

## What this ADR does not decide

- **Restart-on-boot.** ADR 0007's, still open. The one change is that there is
  now something concrete waiting on it, which is a better argument than the
  hypothetical one it was left open against.
- **A per-schedule spend ceiling.** Decision 6 names it as the precondition that
  lifts decision 6. Nothing here builds it.
- **Cron.** Decision 9.
- **More than one schedule per agent.** The table's primary key is the agent, and
  that is a decision the same way `chief_discord.allowed_user_id` being a column
  rather than a table was: two schedules on one agent is a thing to add when
  somebody wants it, not an invitation to design for now.
- **Scheduling on a host.** ADR 0021's runner is the same program and would
  inherit this, and nothing in this packet pushes a schedule to one. A host runs
  what it is asked to run.
- **A schedule the chief can set.** ADR 0028 decision 3 exhausts what a Discord
  message may become and a schedule is not on that list. It stays not on it: a
  standing instruction that spends and fires unattended is the last thing that
  should be settable from a room whose membership DASH cannot see.

---

## Consequences

- DASH gains a process that starts agents without a person present. That is new,
  it is the point, and decision 6 is the bound on what it can cost.
- `runner_audit` gains a second kind of actor. Anything reading it for "who did
  this" now has two answers instead of one, and both are true.
- The agent page's trigger switcher stops being a statement about what DASH
  cannot do and becomes a control. The two sentences it keeps — the third
  liveness sentence and the disabled cron option — are what stops that from being
  a downgrade in honesty.
- `dash.sqlite` still has one writer.
- A person can now be wrong about when their agent ran, in a way they could not
  before, and the missed-window record is the only thing standing between them
  and that. It is therefore load-bearing and is written even when it is boring.
