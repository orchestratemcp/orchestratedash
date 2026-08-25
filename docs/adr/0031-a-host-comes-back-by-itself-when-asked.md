# ADR 0031: A host may start its runner at boot, only when a person asks, and it comes back holding what it was last told

**Status:** accepted — MAR-795, packet B of `docs/proposals/vps-residency-2026-08-25.md`
§8, from Henrik's first clause for roadmap item 4: *"startup file delivered on
connect."*
**Date:** 2026-08-26. **Issue:** MAR-795, MAR-742 roadmap item 4 / child 3.
**Touches:** ADR 0007 (the deploy transport — this closes the restart-on-boot
question it left open in August, for the machine it left open), ADR 0030 (DASH
may start its runner at login — this is the same decision one machine over, and
decision 8 there says explicitly that a host inherits nothing from it),
ADR 0029 + amendment 1 (a schedule is a standing instruction; a schedule may
carry a ceiling — this gives a host the standing row and does **not** give it a
spend), ADR 0021 (the host is a small DASH runtime — the runner this starts is
that one), ADR 0014 (asking a host to run an agent — two more routes pay its
three questions), ADR 0018 (a key crosses only on a person's press — the verb
below is its neighbour and carries no credential at all).
**Repository:** orchestratedash.

---

## Context

ADR 0007 declined restart-on-boot in a paragraph that has now been quoted
forward four times:

> **Restart-on-boot is not decided.** `runner/README.md` item 3 records that
> there is no restart policy anywhere in DASH, deliberately. A host that restarts
> an agent DASH cannot see is a supervision claim DASH cannot make, and it
> deserves its own decision rather than a systemd flag chosen in passing.

ADR 0014 blocked trigger configuration on it. ADR 0022 quoted the block.
ADR 0029 wrote the boundary onto the screen. ADR 0030 closed it **for this
machine only** and said so in its own decision 8:

> a host is a Linux box with its own service manager, and a `systemd` unit chosen
> in passing is precisely what ADR 0007 refused. **Restart-on-boot on a host
> remains undecided.**

`runner/standalone.ts` has carried the same sentence since MAR-497 — *"No restart
policy, no service file, no boot integration"* — and it was right every time it
was written, because nobody had made the decision.

This ADR makes it.

### Why it stopped being deferrable

The whole value of a customer's server is that it is awake when the customer is
not. A host that needs somebody to sign in over `ssh` after every reboot is a
host whose value proposition fails on the first unattended kernel update — and
unlike a laptop, nobody is there to notice. Henrik's first clause for item 4 is
one sentence long and it is a request to decide this.

### The thing ADR 0030 found, which applies here with more force

That packet discovered, before shipping, that a login mechanism alone would have
been *"machinery with no observable effect"*: `RunnerSchedule` begins life with
`{ schedules: [], since: {} }` and is filled by DASH's push, and a runner started
without DASH holds nothing. Its answer was decision 5 — `schedule_standing`, the
pushed document verbatim, written on every push and read back before the first
tick.

A host is worse off than that laptop was, because on a laptop DASH is opened
most days. **A host runner has never been told a single schedule in its life.**
`POST /schedules` was not on `RemoteRunnerChannel`, so a host's `schedule_standing`
row has always been empty and always would be. Writing a unit without also
admitting the route would have shipped a boot entry that reliably started a
process that reliably did nothing.

So this ADR decides both halves, and decisions 5 and 6 are the second one.

---

## Decisions

### 1. DASH writes a service unit, rather than refusing and telling the operator

The alternative was live, and it is `runner/standalone.ts`'s shipped position:
refuse, and say honestly that arranging this under a service manager is the
operator's decision. It is rejected for the customer, and kept for everybody
else — see decision 2, where a host that is not systemd gets exactly that
sentence.

**What ADR 0007 refused was a flag chosen in passing, and this is not that.** The
distinction is the whole of this decision. A `systemd` unit dropped into an
install script would be DASH making a supervision claim about a machine it cannot
see, with no switch, no reported state and no way to find it afterwards. What is
built instead is a verb with a closed field set, off by default, enabled only by
a press, whose reported state is read back from the service manager rather than
inferred, and whose removal instructions are printed on the card for somebody
whose DASH is already gone.

**The console was not an option.** ADR 0018 and ADR 0021 §4 both make console
paste the fallback for when DASH *cannot reach* a host, never the default, and
ADR 0021 specifically refuses a second ad-hoc snippet. "Paste this to make it
start at boot" is that refused shape wearing a different hat.

**What DASH does not claim, and this is the line ADR 0007 drew that survives
intact:** the unit contains no `Restart=`. It starts the runner when the machine
boots and does not bring it back when it dies. `runner/README.md` item 3 is
untouched, an agent that exits stays exited, and a restart policy remains its own
decision on both machines. One line would have made this a supervision promise,
and the pure function that writes the unit is asserted to not contain it.

### 2. The init system is `systemd`, as a **user** unit, and anything else gets a named stop

`$XDG_CONFIG_HOME/systemd/user/orchestratedash-<bundle>.service`, enabled with
`systemctl --user enable`, on an account made to linger with
`loginctl enable-linger`.

**User and not system, because of who DASH signs in as.** ADR 0021's whole
argument for option A is that the helper account owns the secret store and the
agent never holds a key. A unit under `/etc/systemd/system` needs root, and DASH
holds a key for one unprivileged account and should never ask for more. Asking
for root to arrange a restart would be the largest privilege widening in this
product, taken for the smallest reason.

**systemd and not "whichever init is there", because a guess is worse than a
refusal.** A host that is not booted with systemd answers `init_not_supported`,
which is a named stop with its own sentence in `lib/copy/host-residency.ts`, in
`host_pack_too_old`'s shape — and the sentence hands the decision back:
*"Starting the agent runner when this server boots is something you can set up on
the server yourself."* That is `runner/standalone.ts`'s original position,
preserved exactly where it is still true.

**Lingering is asked for and never taken away.** Without it, an enabled user unit
starts when somebody logs in, which on a server nobody logs in to is never. So
`enable` asks for it. `disable` does **not** ask for the opposite: lingering is a
property of the account, other things the operator arranged may depend on it, and
DASH did not necessarily turn it on. Removing it would be this program changing
something outside what it was asked about.

**`enable`, never `enable --now`.** A runner is very often already up — `start`
spawns one and leaves it detached — and `--now` would ask the service manager to
start a **second** process over the first one's data directory and socket. This
project has corrupted a SQLite store by having two things touch it. So the press
arranges the next boot and the copy says so, and the attended proof is a real
reboot rather than a `--now` that would have proved something else.

### 3. Off by default; the reported state is the service manager's, not DASH's

ADR 0030 decision 4's opt-in rule and decision 2's read-the-off-state rule, both
transferred whole.

`ensureHostPack` runs on every helper invocation and lays down the pack; it does
not write a unit and cannot, because no function that writes one is reachable
from it. Nothing in the bootstrap enables anything. The blocking proof drives the
two verbs that run the bootstrap and then asserts the unit directory does not
exist.

**Three states and no fourth**, each with its own sentence:

| state | what it means | the sentence's job |
| --- | --- | --- |
| `not_written` | no entry for this server | offers the press |
| `enabled` | written, and the service manager will act on it | says what now happens with the computer off |
| `disabled` | written, and switched off **on the server** | names the person who did it and offers to switch it back |

The third exists because an operator can `systemctl --user disable` a unit
without deleting it — the Linux equivalent of Task Manager's `StartupApproved`
bitmask, which ADR 0030 added a whole boolean to read. A DASH that reported
`existsSync` would say *On* over a boot that does nothing.

**And a fourth fact beside the three, which is deliberately not a fourth state.**
`starts_at_boot` is whether the *account* lingers. It is a property of the
account rather than of the entry, so it is reported separately, and
`describeResidency` has a distinct sentence for an entry that is enabled on an
account that does not linger — *"This server will only start your agents when
somebody signs in to it."* Folding it into `enabled` would be the same lie in a
different coat.

**One switch for a server that has several units.** There is one runner per
bundle, so there is one unit per bundle, but *"does this server come back by
itself"* is one question. `hostServiceReduction` collapses N states to one and
**under-claims on purpose**: `not_written` beats `disabled` beats `enabled`, so a
server that is half arranged reads as not arranged and the exit beside it — Turn
on — writes the missing entries. The opposite reduction would print *"this server
starts your agents when it reboots"* over an agent that stays stopped.

### 4. A boot-started runner does fire schedules, and one instruction fires on one machine

The question this packet was told to answer, and the answer is yes, with a rule
attached that is larger than the yes.

**Yes, because otherwise the switch has no effect.** ADR 0030's own finding,
restated: a runner that comes back holding nothing is a runner that exists and
does nothing. `schedule_standing` already exists and is already generic —
`runner/main.ts` calls `restore()` before `start()` on both machines, because it
is the same program. What was missing was that **nothing had ever pushed a
schedule to a host**, and decision 5 is that route.

**And here is the trap that came with it.** `install` *copies* an agent to a
server; it does not move it. After a deploy the same agent is registered on two
runners — which is why `bring-home` exists. That was harmless while a host could
never be told a schedule. The moment the route is admitted, one instruction —
*run this agent at eight* — becomes **two runs, on two machines, in the same
minute**, each publishing into one agent's history with nothing on the row to
separate them. `agent_dom_state` already refuses to store a host's snapshot for
the same keying reason (ADR 0014 amendment 1); run evidence from two machines
under one id is that collision one table over.

So:

> **An agent's schedule is honoured by the server it was deployed to, and only
> while residency is on for that server. Everywhere else it is honoured here.**

`splitSchedules` is that rule, pure, and every schedule lands in exactly one push.

**Why it is keyed on the press and not on the deploy.** The cheaper rule —
*deployment delegates the schedule* — was weighed and refused, because it changes
behaviour nobody asked to change. Somebody who deployed an agent months ago and
set a schedule for it has that schedule firing on this machine today; a build
that silently moved it would move it to a machine whose scheduled runs **cannot
pay for a model call** (decision 7). That is a working thing quietly broken by an
upgrade. Keying on residency ties the change to a press, and a server nobody has
pressed the switch for takes nothing out of the local push — which is asserted
directly, because it is the property that makes this safe to ship.

**Two servers holding the same agent is named rather than decided.**
`delegationConflicts` reports it; both are told and both fire. It is a state a
person reaches with two deliberate presses, and an agent that ran *nowhere* would
be worse and much harder to notice. The exit is a per-agent *which machine runs
this* choice, which belongs with the schedule's own settings page and not with
the packet that admitted the route.

### 5. `POST /schedules` and `POST /schedules/drain` join both channels

`lib/agent-dom/runner-channel.ts`'s rule is that **a route is added to both
channels or to neither**, and `EVIDENCE_ROUTES` is the parameter of both, so
adding there satisfies it by construction.

Held to ADR 0014's three questions, for the **pair** rather than for each,
because a push nothing can drain is a push whose effects DASH cannot account for:

| question | answer |
| --- | --- |
| Carries a credential in either direction? | **No.** Out goes agent ids, times and a per-schedule ceiling that is *a count of model calls and never a currency*; back come settlements — a window, an outcome and a sentence. `ScheduleConfiguration` has no field a key could travel in. |
| Chooses *what* runs, or only *which*? | **Which**, one step further removed than the run route beside it. `runner/schedule.ts` turns a due window into the same `retry` a press produces, through the same `executeCommand`; a set naming an agent the host does not hold starts nothing, because the host's own supervisor refuses it. |
| Can DASH describe the result honestly? | **Yes, and this question produced the surface.** The push is DASH's own act and DASH records when it made it; the drain is evidence DASH *observed*. What DASH may not claim is that a server is currently honouring anything — only when it last told it. |

`/broker/drain` and `/broker/responses` remain absent by type, and the blocking
proof asserts a cast-through attempt is refused at runtime as well.

### 6. The push rides the presses that already reach that server

`electron/agent-adapters.ts` re-asserts the local set twelve times a minute over
a Unix socket, and ADR 0029 decision 2's argument for that cadence is that a
total re-assertion has no closed list of events somebody must widen correctly
forever.

**That argument is about the shape, not the number, and the number does not
survive the transport.** Reaching a host is two `ssh` children — `channel` for
the runner's own session secret, then `connect` for the pipe — which is two
process spawns and two key exchanges. Twelve a minute per server is a cost a
person pays on their own laptop, in their own battery, for a document that
changes when they edit a schedule.

So the push happens on turning residency on and on checking the server, it
re-asserts the **whole** set each time, and it touches only servers residency is
on for. A person who never presses the switch has DASH talking to their servers
exactly as often as it does today: on a press.

What covers the gap between presses is the thing this packet is for — the server
keeps what it was last told across a reboot — and the card says *when* it was
last told rather than implying it is current. A background sweep on a timer is
**not** in this packet and is named here so it is a decision rather than an
omission.

**One push per bundle, not per host.** A host runs one runner per bundle, each
with its own store, so a push carrying the whole host's schedules would hand
agent X's runner an instruction about agent Y — refused by its supervisor and
spooled as a settlement that drains home as a run that never happened. Every
resident bundle is pushed to, **including ones whose agent has no schedule**,
because `configure` replaces rather than merges and an empty set is how a
withdrawal travels.

### 7. A scheduled run on a host still cannot spend, and the card says so

ADR 0029 amendment 1 had to add a fourth sentence to the local panel: *"With DASH
closed the run still starts and still publishes, but nothing can reach your model
until you open DASH again."* On a host the shape is different and the outcome is
the same: `runner/host-broker.ts`'s spend allowance is opened by a **Run press on
that host**, and a schedule is exactly the case where nobody pressed anything.

The residency proposal §7 scoped unattended host spend into its own packet
deliberately, so that *"the first attended proof of residency is not also the
first attended proof of a new spend rule"*. This ADR keeps that scope and pays
for it in copy:

> A run that starts this way cannot reach your model. Putting a key on this
> server lets an agent you press Run on use it; it does not pay for a run nobody
> asked for.

That sentence is on the card, in the on-state list, and is pinned by test. It is
the difference between a person turning this on for an agent that works without a
model and turning it on for one that does not and finding out at 3am on a machine
they cannot see.

### 8. DASH's record follows the server; it never leads it

One row per server, `host_residency`, holding *when this person turned it on* and
*when DASH last told it what to run*. It holds **nothing** about what the server
is doing — that is read live, on a press.

The ordering at every call site is the whole of the failure design:

- **On:** ask the server first, write the row only after it agreed. A row written
  on the attempt would start excluding that agent from the local push, so a
  failed enable would produce an agent that fires **nowhere** — silently, which
  is the one outcome worse than firing twice.
- **Off:** ask the server first, delete the row only after it agreed. A row
  deleted on the attempt would resume local firing while the server's entry was
  still enabled, which is decision 4's double-run arrived at from the other side.
- **Forget:** the row goes with the deploy records and the placements, and it has
  a consequence they do not — a surviving row would leave somebody's schedules
  firing nowhere, on a machine DASH can no longer name.

The row has to be durable rather than in memory, and this is the reason it is a
migration: it decides something DASH does twelve times a minute with the server
unreachable. A DASH restart with the flag in memory would quietly resume firing
one instruction on two machines.

### 9. A runner this helper did not start is still a runner

Found while building this and fixed in the same commit, because the boot entry
creates it.

`BundleRecord.pid` was the whole truth while the helper was the only thing that
could start a runner. A unit that brings one up at boot breaks that in one step:
the record names a process that died with the previous uptime, so `status`
reports `running: false` about a live runner, `channel` refuses with
`not_running` and no control-plane route is reachable, and — the one that
matters — `start` sees a dead pid and **spawns a second runner over the first
one's data directory and socket**.

`livePid` reads the record first and the runner's own `data/runner.json` second,
so every existing path is unchanged on a host with no unit and all four are
honest on a host with one.

---

## What this ADR does not decide

- **A restart policy for agents, or for the runner.** Decision 1. The unit starts
  it at boot and makes no claim about a crash. `runner/README.md` item 3 stands
  on both machines.
- **A background sweep that pushes schedules without a press.** Decision 6, named
  rather than omitted.
- **Unattended spend on a host.** Decision 7. It is the residency proposal §7's
  larger half and it is its own packet, after the chief is proven.
- **Which machine runs an agent that sits on two resident servers.** Decision 4.
  It needs a per-agent choice on the schedule's own settings page.
- **macOS or Windows hosts.** There are none: a host is a Linux box reached over
  `ssh`, which is ADR 0021's premise. A host on another platform gets decision
  2's named stop.
- **The chief on a host.** Packet C. Nothing here reads or writes a chief slot,
  and `RESERVED_HOST_SLOTS` is still empty.
- **Copying a host's state home before a re-setup.** Packet E. This ADR adds a
  unit to the list of things a re-setup will find, and does not decide what
  happens to it.

---

## Consequences

- **ADR 0007's oldest open question is now closed on both machines**, four months
  and five ADRs after it was deferred.
- **A customer's server can be running DASH's runner when nobody started it.**
  That is new and it is the point. It is bounded by: a person's press, a unit
  with no restart policy, a runner that opens no port, and a scheduled run that
  cannot spend.
- **`RemoteRunnerChannel` carries two more routes**, and the count of things a
  host can be asked has grown for the fourth time since the set closed. Each one
  is argued in `lib/agent-dom/runner-channel.ts` beside the others.
- **A schedule now has a machine**, derived from a deploy record and a press
  rather than stored on the schedule. The day that becomes a per-agent choice,
  this rule is what it replaces.
- **`user_version` is 37**, and the new table is the first in this store whose
  contents change what DASH pushes rather than what DASH shows.
- **`pnpm test` skips two proofs on Windows.** A host is a Linux box, and
  `serviceUnitText` refuses a root it cannot spell in a `key=value` file — which
  every Windows path is. The generation is asserted on every platform against
  the roots a real host has; the placement runs on the Linux job.

---

## The attended half, which is permanently attended

ADR 0004 forbids a blocking gate that depends on a machine that is not this
repository. None of the following can run in CI and none of it is claimed as
proven until it has been run and dated in `docs/attended-vps-proof-runbook.md`:

1. the enrolled host reports `not_written` before anything is pressed;
2. the switch is turned on, and the server reports `enabled` **with
   `starts_at_boot` true** — the linger half, which is the one most likely to
   need a person;
3. the host is **actually rebooted**, with DASH never opened;
4. the runner comes back holding the schedules it was last told —
   `runner.log`'s *"standing schedules: restored from this runner's own store"*
   is the line that says so;
5. a window due after that reboot fires, and its evidence is in DASH's store the
   next time DASH opens;
6. a window that came round while the host was **down** is recorded `missed` and
   is never backfilled;
7. the operator can see the entry with `systemctl --user list-unit-files` and
   remove it with the two lines the card printed, without DASH.

Until every one of those has a date beside it, the standing sentence is ADR
0021's: *"the entry is on that server"*, never *"your server starts your agents
now."*
