# ADR 0030: DASH may start its runner at login, only when a person asks, and the runner remembers what it was told

**Status:** accepted — MAR-785, from Henrik's ruling on ADR 0029's largest named
gap, 2026-08-25: *"Yes this needs to be planned out. Maybe auto-start dash on
startup?"*
**Date:** 2026-08-25. **Issue:** MAR-785, MAR-742 roadmap item 8.
**Touches:** ADR 0007 (restart-on-boot, left open on purpose since 2026-08-06 —
this closes it), ADR 0029 (a schedule is a standing instruction — this is its
third liveness sentence, and amends decision 2's "keeps nothing of its own"),
ADR 0027 (only a blessed checkout may open the installed store — its rule,
applied to a second thing a worktree must not do), ADR 0028 (the runner outlives
the window — this makes it outlive the session too), ADR 0021 (the host is a
small DASH runtime — the same program, a different answer).
**Repository:** orchestratedash.

---

## Context

ADR 0007 declined restart-on-boot in a paragraph that has been quoted forward
three times:

> **Restart-on-boot is not decided.** `runner/README.md` item 3 records that
> there is no restart policy anywhere in DASH, deliberately. A host that restarts
> an agent DASH cannot see is a supervision claim DASH cannot make, and it
> deserves its own decision rather than a systemd flag chosen in passing.

ADR 0014 then blocked trigger configuration on it. ADR 0022 quoted the block.
ADR 0029 built the scheduler anyway and wrote the boundary onto the screen, as
the third of three liveness sentences a person reads before they set a time:

> **Computer asleep, off, or restarted** — nothing fires. The window that came
> round is recorded as missed, and nothing fires again until DASH is opened once,
> because the runner is gone and comes back with nothing.

That sentence is the whole subject of this ADR. A Windows Update at two in the
morning takes tomorrow's 08:00 run with it, silently, and the person finds out by
noticing their agent has been quiet since Tuesday.

### The thing that had to be found before anything could be decided

The issue proposed, as its likely recommendation, *"the detached runner starts
headless at login … schedules and the Discord chief work from login without DASH
ever opening."*

**That is false as built, and the mechanism alone would have shipped a switch
with no observable effect.**

`RunnerSchedule` begins life with `{ schedules: [], since: {} }`. It is filled by
DASH's push on the evidence poll — twelve times a minute, and only while DASH's
window is open. ADR 0029 decision 2 says so explicitly and says why: the push
carries the set *and* the cursor, and that is what lets a runner **"know where to
resume from without keeping anything of its own across a restart."** `runner/main.ts`
says the same thing at the call site: *"It fires nothing until that push arrives.
The set is empty."*

So a runner started by Windows at login, with DASH never opened, holds no
schedules. It also holds no chief snapshot (MAR-745's push, same shape) and
starts no agents (`runner/README.md` item 3: an agent that exits stays exited).
It exists, and it does nothing.

**A login mechanism is therefore necessary and not sufficient**, and this ADR
decides both halves. Decision 5 is the second one.

---

## Decisions

### 1. Windows starts the runner. It does not start DASH

The login entry runs a DASH process that starts the runner and exits. No window,
no tray icon, no store, no single-instance lock. Henrik's floated option — the
whole shell at login — was weighed and refused, on three grounds that are
specific to this repository rather than general taste.

**There is no window to not show.** DASH has no tray and no start-minimised mode.
`window-all-closed` counts hidden windows, which is the defect behind
*"a hidden window blocks the quit"*, so a minimised-to-tray DASH is not a flag —
it is a packet with its own quit semantics to get right. Shipping full-DASH
autostart without one means a window a person did not ask for, at the moment they
are least likely to want it, which is the behaviour people uninstall software
over.

**It would break the one gate that proves installed work.** MAR-748 is the issue
this one is related to, and it is exact: `pnpm verify` exits with zero shell
proofs when another DASH holds the single-instance lock. A DASH that starts at
every login holds that lock permanently, on the one machine where installed
proofs are executed. The choice would be a verify gate that never runs or a
person who has to quit their own app before every verify — and this project has
already learnt, twice, what an unenforced gate costs.

**It would multiply ADR 0027's exposure.** `dash.sqlite` was destroyed twice in
three days. ADR 0027's mechanism is a process ending part-way through a WAL
checkpoint, and its answer was to make every exit the shell can see checkpoint —
while stating plainly that a hard kill still destroys the store and nothing
inside the process can change that. A DASH open from login to shutdown is the
store open whenever the machine is on: every power cut, every forced restart,
every `taskkill /F` a person reaches for now lands on an open database. The
runner's own store carries the same risk and is a hundredth the size, has been
retired and rebuilt before, and holds nothing a person typed.

**What would reopen it.** A real tray with a start-minimised mode, plus an answer
to MAR-748 that does not depend on DASH being closed. Both are named here rather
than implied; neither is in this packet.

### 2. The entry is an `HKCU` Run value, written through Electron's own API

`app.setLoginItemSettings({ openAtLogin, name, path, args })`. Windows only —
`path` and `args` are Windows-only options, a macOS login item launches the
*application* (decision 1's refused shape), and there is no Linux implementation
at all. `autostartRefusal` returns `unsupported_platform` everywhere else and the
page says so rather than drawing a switch that lies.

**A Run value over a scheduled task, because of where a person can see it.** A
Run value appears in Task Manager's *Startup apps* list, with a name and a switch
of its own. A logon-triggered scheduled task does not. The extra things a task
can do — a delay, a restart policy, a hidden window, *run whether the user is
logged on or not* — are each a way for DASH to be running on somebody's machine
in a manner they cannot find, and the capability this feature needs is *start
once*. `AUTOSTART_ENTRY_NAME` is `OrchestrateDASH` rather than `app.getName()`'s
`orchestratedash`, because the list is read by a person and the name on the
window is the one they will recognise.

**And Windows' own off switch is read, not just the value's existence.** Task
Manager can disable a Run entry **without removing it**, by writing a bitmask
under `StartupApproved\Run`. Electron reports it per launch item as `enabled`.
A DASH that read only the value would say *On* over a login that does nothing,
which is the same class of lie the third liveness sentence exists to prevent.
`AutostartState.approved` is that bit, and the page has a sentence for it.

### 3. The switch is a switch on the executable, not a second entry script

The value is `<DASH's exe> [<app path>] --dash-start-runner`, and
`electron/main.ts` branches on it before it takes the single-instance lock.

**A Run value carries no environment, and neither does a scheduled task action.**
The runner is started by spawning `process.execPath` with `ELECTRON_RUN_AS_NODE=1`
— that variable is the entire mechanism by which the Electron binary becomes the
Node runtime, and the reason a user needs no Node installation. There is no
command line that expresses it. The remaining option would be a `.cmd` shim
written into the data directory, which puts an executable script in the one
place on disk every hosted agent can already write to and has Windows run it as
the person at every login. That is a worse thing than the feature is worth.

**A separate entry script was refused for the packaging reason.**
`electron dist/electron/autostart.mjs` works today, the way a dozen capture
harnesses do, and stops working the day DASH ships packaged: a packaged Electron
app ignores `argv[1]` as an app path and runs what is baked into its resources.
One switch on the one executable is the spelling that survives packaging, which
means the thing proven on Henrik's machine is the thing that ships.

**The login process takes no lock and opens no store.** Both are stated on
`startRunnerAtLogin` and both are load-bearing. A DASH that lost the lock would
hand its argv to the copy holding it and surface that window — at login, that is
the window this whole shape exists to avoid; and worse, a person double-clicking
DASH during the two seconds this process held the lock would have their launch
swallowed by a process about to exit. Not opening the store is decision 1's third
argument applied to the process this ADR adds: the runner needs a directory, not
a database.

### 4. Opt-in, always, and a worktree may never enrol

Off until pressed. No installer step enrols it, no first run offers it, and
`STARTUP_COPY.opt_in` says so on the page: *"DASH never adds itself to your
startup list on its own."*

Three refusals, in `autostartRefusal`, and the second is ADR 0027's rule made
permanent. That ADR refuses a linked worktree the installed store for the length
of one launch. A worktree that enrolled would put its own branch's build into a
person's login **for as long as that directory existed, and after it was
deleted** — a startup entry that outlives the branch, the session and the
checkout. `gitEntryKind` is exported from `electron/data-dir.ts` rather than
re-implemented, so the two guards cannot drift: one question, one implementation.
The third refusal, `scratch_store`, catches a capture harness or a `DASH_DATA_DIR`
run, which would otherwise ask Windows to start a runner over a directory that
exists for the length of a test.

**The command line is on the page, before the press.** A control that writes into
somebody's startup list owes them the literal text of what it wrote, in a form
they can match against what Windows shows them. It is also the removal
instructions — see decision 7.

### 5. The runner remembers the last set it was pushed, in its own store

`schedule_standing` in `runner.sqlite`: one row, the pushed document verbatim,
written on every push and read back before the first tick.

This is the half that makes decision 1 worth anything, and it amends ADR 0029
decision 2's *"without keeping anything of its own across a restart"*. That
sentence was true of a runner DASH always started. Once Windows can start one,
the party that used to hand the runner its world is not running, so the runner
has to remember.

**It is not the second home ADR 0029 refused.** That refusal was about *where a
schedule lives*: edited on a page, shown on a page, deleted with its agent — all
`dash.sqlite` operations — and a file that also held it would be a copy free to
disagree with the page that owns it. `agent_schedules` is still the only home and
still the only thing any surface reads. What this row holds is **what this runner
was last told**, which is the same category as `runner_audit` holding what it was
last asked to do. The staleness is bounded by the schedules only being changeable
while DASH is open, and DASH re-asserting them whole every five seconds while it
is.

**Written on every push rather than on a change.** One small upsert against a
one-row table, twelve times a minute. Comparing first would save those writes and
reintroduce exactly the bug ADR 0029 decision 2 refused a closed list to avoid: a
comparison is a closed statement about which fields matter, and a field added
later that it did not learn about would stop reaching the disk silently, visible
only after a reboot.

**Parsed, not trusted.** `readScheduleConfiguration` moved from `runner/server.ts`
to `runner/schedule.ts` and is now the one implementation both callers use. A row
off this machine's own disk gets no more trust than a body off the channel: a set
the runner would have refused from DASH is a set it refuses from itself. An
unreadable row is discarded with a line in the log, never thrown — that leaves
the runner in exactly the state it was in before this decision, and DASH's next
push repairs it.

**A retired store loses the row**, and that is accepted rather than overlooked.
`retireDamagedStore` sets a damaged `runner.sqlite` aside; the runner comes back
with no memory, which is the pre-MAR-785 runner, and one push fixes it.

### 6. What still does not survive a reboot, named rather than papered over

**The chief's fleet snapshot.** MAR-745 pushes it at bridge-setup time and
`electron/main.ts` re-pushes on the events it enumerates — all of them inside a
running DASH. A runner started at login answers Discord out of an empty fleet.
That is a real gap, it is the identical shape to decision 5, and it is not in
this packet: the fix is `chief_standing` beside `schedule_standing` and one call
in `runner/chief.ts`, and it should be built once the fire path here has been
proven on a real reboot rather than bolted on beside it.

**Agents that were running.** `runner/README.md` item 3 is untouched: an agent
that exits stays exited, and a machine that restarted is every agent exiting. A
schedule starts one at a time a person named; nothing here brings anything back,
and a restart policy remains its own decision.

**A missed window is still missed.** ADR 0029 decision 7 in full. Turning this on
does not backfill: a machine that was off over 08:00 comes back to a `missed`
row, not a run at 14:20. `STARTUP_COPY.liveness_on[2]` is that sentence, on the
page, beside the switch — because the switch is precisely the thing that makes a
person assume otherwise.

### 7. Uninstall is honest about having no hook

MSIX has no uninstall hook, and today's install is a checkout with a desktop
shortcut, which has none either. **A Run value written by DASH survives DASH
being deleted**, and points at an executable that is no longer there. Windows
fails the launch silently.

Three things are done about it and none of them is a promise DASH cannot keep.

1. **Turning the switch off removes the entry, including one that is not ours.**
   `writeAutostart`'s off path runs even when `foreign` — an entry under DASH's
   name pointing at a copy that may no longer exist. Refusing to remove it
   because it is not this install's would leave the one broken login this feature
   can produce with nothing on screen that removes it.
2. **The entry lands where Windows already offers removal.** Decision 2's whole
   argument for a Run value over a scheduled task: Task Manager's Startup apps
   list is a door DASH does not have to build and cannot take away.
3. **The page shows the literal command**, so somebody with a DASH that is
   already gone can match it against what they see and delete it by hand.

An installer that removes it on uninstall is the right answer and is a packet
that belongs with a real installer, which DASH does not have — MSIX is a
packaging proof (MAR-429) and ships nothing.

### 8. What a VPS changes, and what it does not

The issue asks what remains worth building locally once epic item 4 puts a runner
on a machine that never sleeps. The answer is **laptops**, and it is narrower
than it sounds.

A VPS solves always-on for agents that can live away from the person's machine:
no local files, no local browser, no credential that only exists in this
Windows vault. It does not solve the agent that reads a folder on the person's
disk, drives a browser they are signed into, or produces a document they expect
to find locally — and it costs money every month, which
`no-recurring-costs-until-revenue` rules out until there is revenue.

So this stays worth having after a VPS exists, for one machine's own agents, and
ADR 0021's host inherits nothing from it: a host is a Linux box with its own
service manager, and a `systemd` unit chosen in passing is precisely what ADR
0007 refused. **Restart-on-boot on a host remains undecided.** What is decided
here is restart-on-login on *this* machine.

---

## The liveness sentences, revised

ADR 0029 wrote three and said the third was the one the feature would be judged
on. There are now four, because the third has split in two, and only one of them
has changed:

1. **DASH open** — the schedule fires.
2. **DASH closed, computer on** — it still fires, from the runner.
3. **Computer restarted, this switch on** — the runner starts at sign-in with the
   schedules it was last told, and windows due after that fire with DASH never
   opened. The runs land in DASH's store the next time it is opened.
4. **Computer asleep or off over the window** — nothing fires and nothing is run
   late. The window is recorded as missed. **This switch does not change that**,
   and the page says so beside the switch.

The agent page's `AGENT_TRIGGER_COPY.liveness` still says the old three, and
sentence three there is now conditionally wrong for somebody who has enrolled.
**That copy is not changed here** — MAR-785 and the schedules packet are parallel
sessions and the agent page's schedule section belongs to the other one. It is a
named follow-up, it is small, and it is the difference between a person finding
this switch and never learning it exists.

---

## What this ADR does not decide

- **A tray, or a start-minimised DASH.** Decision 1 names both as what would
  reopen full-DASH-at-login.
- **The chief's memory across a restart.** Decision 6.
- **A restart policy for agents.** `runner/README.md` item 3, untouched.
- **Restart-on-boot on a host.** Decision 8. ADR 0007's follow-up survives for
  the machine DASH cannot see.
- **A per-schedule spend ceiling.** ADR 0029 decision 6's, unchanged and now more
  pointed: a schedule that survives a reboot is a schedule that fires for months
  without anybody deciding to.
- **An installer that cleans up.** Decision 7.
- **macOS and Linux.** Decision 2. Each needs its own mechanism and its own
  uninstall story, and a control that silently did the wrong thing on two of
  three platforms would be worse than the refusal.

---

## Consequences

- **ADR 0007's oldest open question is closed**, for this machine, four months
  and four ADRs after it was deferred.
- **DASH can now be running when nobody started it.** That is new and it is the
  point. It is bounded by: a person's press, one process that exits in seconds, a
  runner that opens no port, and ADR 0029 decision 6's refusal to let a scheduled
  run spend.
- **`runner.sqlite` gains a row that outlives a process.** Everything else in
  that store is a queue or an audit trail; this is state. It is one row, it is
  overwritten by DASH within five seconds of a window opening, and losing it
  degrades to the behaviour that existed before this ADR.
- **A worktree now has two things it may not do**, and both are asked the same
  question by the same function.
- **A person can be wrong about whether their computer starts DASH's helper**, in
  a way they could not before — and the two places that could make them wrong,
  a Windows-disabled entry and an entry belonging to another copy, each have a
  sentence on the page rather than a silence.
