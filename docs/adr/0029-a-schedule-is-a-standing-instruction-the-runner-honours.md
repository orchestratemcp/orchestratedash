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

**Superseded in part by amendment 1 (MAR-784), at the end of this document.**
The default below is unchanged and is still what an untouched schedule does; what
amendment 1 adds is the per-schedule ceiling this decision names as its own exit.

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
  lifts decision 6. Nothing here builds it. **Built by amendment 1 (MAR-784).**
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

---

## Amendment 1 (MAR-784): a schedule may carry a spend ceiling, and the runner carries it to the broker

Status: Accepted — Henrik's ruling on decision 6, 2026-08-25: *"Sure, but can we
have the option to opt out on this. Some agents really need to use AI and some
don't."* Built in the same packet.

Date: 2026-08-25. Issue: MAR-784, a child of MAR-742.

Migration index **34**, producing `user_version` **35** — confirmed against the
literal pin in `tests/store-sqlite.test.ts` at this branch point before it was
written, which is the check the note beside that pin asks for and the one the
previous packet's assignment failed.

### What decision 6 actually refused

Read it again, because it names its own exit and this amendment takes exactly
that exit and no other:

> **What would lift it, named rather than implied.** A per-schedule ceiling the
> person sets when they set the time — *"this may spend at most N model calls per
> scheduled run"* — plus the runner-side broker that could enforce it…

Decision 6 refused **an unbounded unattended allowance**, and its argument was
never about size. It was about repetition: *"A Discord message needs a person to
type it every time; a schedule is typed once and fires forever."* That argument
survives a ceiling completely — a bound that holds on every firing is the direct
answer to a thing that fires forever — and it does not survive the absence of
one. So the shape of the lift was fixed before this amendment started.

### 1. The ceiling is a count of model calls, per schedule, defaulting to zero

`agent_schedules.allowance_calls`. Zero is off, and **zero is what every schedule
already in an installed store migrates to**, because those schedules were set
under a rule that said an unattended run may not spend and a migration that
opened an allowance for them would be DASH changing what somebody already agreed
to.

A count and not a currency, `lib/broker/spend-allowance.ts`' reason unchanged:
two of the three providers never state a price and the third states it after the
call, so a dollar ceiling could only ever be checked once the money was gone.

**The ceiling on the ceiling is `SPEND_ALLOWANCE_CALLS`, by identity rather than
by coincidence.** `MAX_SCHEDULE_ALLOWANCE_CALLS` *is* that constant, so an
unattended run can never be worth more than the press of Run now it stands in
for, and the two cannot drift apart in a later diff. `openRunSpend` clamps to the
same number on the other side of the seam — down, never up — so a value that got
past every check still cannot open a wider allowance than a press.

**The panel offers a switch and not a number.** The question a person actually
has is *may this one use AI*, and a number field would ask them to have an
opinion about a quantity whose only honest ceiling is a constant they cannot see.
The column stays a number so that offering the quantity later is a control rather
than a migration — `agent_schedules.kind`'s own argument about itself.

### 2. The runner carries the ceiling; it does not enforce it and cannot spend

This is the half the packet chose deliberately, and the half that costs
something, so it is stated first and stated plainly.

The runner still holds no broker, no key and no provider. What it gained is one
sentence it is uniquely able to say: *I started this agent, at this moment, under
a schedule carrying this ceiling.* That travels as a `ScheduledAllowance` and is
read by the broker in DASH's window, which is where ADR 0016's allowance has
always been opened.

**It rides the reply to `POST /broker/drain`, not a route of its own**, and that
is the whole safety argument. DASH's broker loop and DASH's evidence poll are two
independent timers; a ceiling delivered on one and a request drained by the other
would sometimes arrive after the request it was meant to cover, and the symptom
would be a scheduled run refused at 03:00 for a reason nobody could reproduce at
nine. In one reply there is no ordering to get wrong: every request in the body
was written by a child of the process that reported the ceilings, and the
ceilings are opened before any of the requests is looked at.

**A fire id, and the broker opens each one exactly once.** The runner reports a
live ceiling on every drain for as long as the window lasts — it must, because a
drain that failed cannot be allowed to cost somebody their run — and
`allowRunSpend` *replaces* rather than tops up. Without an identity per fire the
report would refresh the ceiling to full several times a minute, which is not a
ceiling at all.

**And it is still only a claim.** `electron/broker-host.ts` reads DASH's own
`agent_schedules` row and grants `min(reported, stored)`, refusing outright if
the person has since switched the schedule off. So the wire can only ever narrow
what somebody set on their own page, and a compromised runner's best available
move is to ask for less.

### 3. The cost: a scheduled run spends only while DASH is open, and the panel says so

`electron/broker-host.ts`'s header has been explicit since MAR-458 — *"when DASH
is not running, the broker is not running"* — and locally an agent's brokered
requests are buffered by the runner for DASH to drain. That is not new and this
amendment does not worsen it: with DASH closed, a scheduled run's model step has
always settled as `broker_unavailable`. What is new is that the ceiling makes the
boundary visible, so it has to be said.

So there is a fourth sentence beside the three liveness sentences, and it is on
the panel next to the switch rather than in this document:

> That works while DASH is open. With DASH closed the run still starts and still
> publishes, but nothing can reach your model until you open DASH again.

**Not saying it was the tempting option**, and it is precisely the failure this
ADR's own *"the bar this is being held to"* section is about: a product that
replaces a true sentence with a control and silence has taken information away.
The person setting a 03:00 schedule is exactly the person that sentence is for.

**What would lift *this*, named rather than implied — and not built here.** A
broker in the runner, holding a model key, narrowed the way
`runner/chief-broker.ts` is narrowed for the chief and `runner/host-broker.ts` is
for a host. It is a real packet and not a line in this one: it needs a credential
route, per-agent model resolution in main, an audit drain, and — the part that
makes it a decision rather than a task — **a model key in a second process for
every scheduled agent**, which is the widening ADR 0028 decision 5 accepted once,
for one key, with its blast radius argued in full. That argument has to be made
again at the new size before anybody makes it.

### 4. Hitting the ceiling is a degrade, and it degrades exactly like decision 6

A run that spends its allowance gets `needs_a_person` on the next model step —
**the same refusal, by the same code path, that a schedule carrying no allowance
at all gets today.** `spendAllowed` deliberately cannot tell absent, expired and
spent apart, so an agent cannot learn the shape of a budget by probing it, and
the consequence is the property this amendment wanted anyway: there is no new
failure mode to design for. The agent stops asking, finishes its plan without a
model, and publishes what it could produce — decision 6's stated cost, arriving
partway through a run instead of at the start of one.

What DASH adds is the *reason*, which the refusal itself must not carry. The
panel counts the window's rows in `broker_audit` and says `Used 1 of 2 model
calls.`, and — only when a call was actually refused — that the run used them all
and still published.

**Counted, not reported.** There is no `spent_calls` column, because a run's end
reaches DASH as an event the agent emits and a spend count written from it would
be the party being reported on doing the reporting. `broker_audit` is written by
DASH's broker at the moment it adjudicates, refusals included, so the receipt is
evidence. The imprecision that remains is stated rather than papered over: a
press of Run now within ten minutes of a scheduled fire is counted in the same
window, because `broker_audit` records which agent and which operation and never
which press — and a request that could name its own press is the thing
`BrokerOrigin` exists to refuse.

**The ceiling is reported as reached when a call was refused, never when
`used === allowed`.** Those come apart in the case that matters: an agent whose
plan needed exactly its two calls used both and asked for no third, and telling
that person their run was cut short would be DASH inventing a degrade out of
arithmetic.

### 5. What a settled window was allowed is kept on the window

`agent_schedule_runs.allowance_calls`, written from the runner's own settlement
and never derived from the schedule row at read time. Those are two different
facts the moment somebody edits a ceiling — the schedule says what the *next* run
may spend, the row says what *that* run was handed — and a panel pairing today's
ceiling with last night's spend would report an agreement that never existed.
`broker_audit.decided_on`'s rule: a row must not be able to lose the thing that
makes it true by being read later.

### What this amendment does not change

- **Decision 6's default.** Off is still off, and a schedule nobody has opted in
  for says the same sentence it said before this was built, word for word.
- **Decisions 1 through 5, 7, 8, 9 and 10.** The schedule is still one row with
  one home, still re-asserted whole on the evidence poll, still fired only by the
  runner, still `retry` with no new verb, still under `SCHEDULE_PRINCIPAL`, still
  never backfilled, still spooled, still daily-only, and MAR-588's Discord
  message is still unchanged.
- **Restart-on-boot.** ADR 0007's, still open.
- **Who may set one.** Not the chief. ADR 0028 decision 3's list is unchanged,
  and a standing instruction that can now spend is a stronger reason to keep a
  schedule off it, not a weaker one.

### What is proven

`scripts/prove-schedule-spend.mjs` — a real detached runner, two real schedules
that come round in real wall-clock time, the real Agent Kit template as one of
the two agents, and DASH's own `createBroker` standing where
`electron/broker-host.ts` stands. It ends with one of two verdicts and says which:
with `DASH_PROOF_MODEL_KEY` set it makes at most two real, bounded calls to a real
provider; without one it serves a provider on the loopback and says in the PASS
line that no real provider was asked.

The unit suite covers the five boundaries the number crosses —
`tests/schedule-allowance.test.ts` — plus the channel's own half in
`tests/schedule-runner.test.ts`.
