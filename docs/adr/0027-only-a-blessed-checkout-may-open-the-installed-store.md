# ADR 0027: Only a blessed checkout may open the installed store, and every exit it can see checkpoints the WAL

**Status:** accepted — MAR-700 asked for the third occurrence to be prevented,
and the two mechanisms below are the two halves of the one that happened twice.
**Date:** 2026-08-22
**Issue:** MAR-700 (DASH — `dash.sqlite` malformed, second occurrence).
Supersedes the gate MAR-676 shipped, which was correct in intent and inverted in
fact. Completes MAR-678, whose quit path covered the quit a person asks for and
not the ways this process actually ended.
**Touches:** ADR 0021 (the host is a small DASH runtime — same store, same rule).
**Repository:** orchestratedash.

---

## Context

`%APPDATA%\orchestratedash\dash.sqlite` was destroyed twice in three days.

The 2026-08-19 file is still on disk as root-cause evidence. Its header claims
**474 pages** over a file that holds **356**, and SQLite refuses every statement
against it — `PRAGMA user_version` included. That is not a failing disk. It is
the signature of a process killed part-way through a **WAL checkpoint**: SQLite
had written page 1 with the database's new size and had not yet written the
pages that size counts.

On 2026-08-21 the same store read malformed again, with roughly twenty-six
Electron processes from six worktrees holding it.

Two facts made that possible, and neither was an accident of one branch.

### Every checkout answers to the same name

`userData` is `<appData>/<app name>`, and Electron takes the name from the
package.json of the app directory it was launched with. Every checkout of this
repository carries the same package.json, so `electron <any worktree>` is app
name `orchestratedash` and resolves the **real** store — the one with the
person's agents, connections and history in it.

MAR-676 diagnosed this exactly and wrote the refusal: `foreignCheckoutProblem`,
which asks whether `<app path>/.git` is a directory (the main working tree) or a
file (a linked worktree), and refuses the latter.

**The refusal never ran.** `electron/data-dir.ts` gated it on
`isAppEntryPoint(process.argv[1])`, which matches the basenames `main.mjs` and
`main.js`. An app-directory launch does not put a script there — `electron .`
puts the literal `"."`, and `electron C:\...\orchestratedash` puts the directory.
Probed against Electron 43.2.0 on 2026-08-22, both are false.

So the gate was exactly inverted against its own docblock. The form it checked
(`electron dist/electron/main.mjs`) is the form that gets the fallback name
`Electron` and lands in `%APPDATA%\Electron` — the store that needs no guarding.
The form it skipped is `pnpm shell`, which is how a person launches DASH from a
checkout, and how six worktrees reached one store.

This is worth stating plainly because of how it reads: MAR-676's docblock
describes the app-directory launch in detail and sounds like a fix that landed.
Only the real `argv` shows otherwise.

### The quit that is not a quit

`lib/db.ts` opens in WAL mode, so between a commit and a checkpoint `dash.sqlite`
is a **two-file** structure — the database plus a `-wal` holding transactions not
yet folded in. That is a fine state to run in and a bad one to be abandoned in:
every copy, every backup and every abrupt termination then lands on something
that must be recovered rather than read.

MAR-678 added `closeDb` to `will-quit`, and a five-second deadline for a quit
that gets stuck. Both are right and neither covers how this process actually
ends during development:

- **Ctrl-C on `pnpm shell`.** SIGINT kills the main process; Electron emits no
  lifecycle event.
- **`app.exit()`**, which by design skips `before-quit` and `will-quit`, and
  which `main.ts` reaches on a failed startup — after the store is open.
- **An uncaught exception.**

Six worktrees made a concurrent checkpoint likely. One Ctrl-C makes it possible.

---

## Decisions

### 1. The store guard asks about the destination, not the launch form

A process whose store resolves to a directory named `orchestratedash` is about to
open the person's real history, whatever argv looked like on the way in. That is
the fact the guard is about, so that is what it now asks:

    if (resolvesInstalledStore(resolved)) { … foreignCheckoutProblem … }

`resolvesInstalledStore` is `storeBasename(resolved) === APP_NAME` — pure, and
therefore testable, which the old gate was not: it lived inside
`electron/data-dir.ts`, a module that runs `app.setName` as an import side effect
and cannot be loaded from a test at all.

**Rejected: fixing `isAppEntryPoint` to also match app directories.** It would
work, and it would leave the guard keyed to a growing list of launch spellings —
`.`, `..`, an absolute path, a path with a trailing separator, a junction. The
destination is one question with one answer.

**Rejected: a marker file in the blessed checkout.** MAR-676 argued this and the
argument still holds: it would need creating, documenting and remembering, and
the first checkout somebody copied instead of cloned would carry it. `.git` being
a file in a worktree and a directory in the main tree is how git itself draws the
line.

The complement is already covered and stays where it is: when the destination is
**not** an `orchestratedash` directory, `storeIdentityProblem` is what fires, and
that has always been the check that was about the harnesses.

### 2. The harnesses stay outside it by running as themselves

A dozen capture harnesses under `electron/` deliberately do not claim the app's
name, so their store is not an `orchestratedash` directory and Decision 1 does
not reach them. That is a better exemption than a launch-form gate because it is
the same fact that lets them run beside a live DASH without fighting it for the
single-instance lock.

### 3. The smoke's access to the real store is stated, not inherited

`electron/smoke.ts` must write to the **real** user-data directory — MAR-424's
third acceptance criterion is that a command's refusal lands in `command_audit`
there, and a harness proving that about a scratch directory would satisfy every
assertion while proving nothing about the product.

Under the old gate the smoke was exempt by accident, through the same hole that
let `pnpm shell` through. Decision 1 closes the hole, which would have taken the
smoke's access with it. So `electron/smoke-identity.ts` now sets
`DASH_ALLOW_INSTALLED_STORE` beside its `app.setName` — the switch that already
means *the real one, on purpose* — with `??=`, so a `DASH_DATA_DIR` on the way in
still wins.

This trades an accidental exemption for a declared one. The smoke can still open
the installed store from a worktree, which MAR-676 flagged as a separate decision
and which this ADR deliberately does not change: it is reached only by somebody
running `pnpm verify:shell`, and narrowing it means changing what that proof is
about.

### 4. `closeDb` asks for the checkpoint by name

`close()` checkpoints when it happens to be the last connection, and says nothing
when it is not. `closeDb` now runs `PRAGMA wal_checkpoint(TRUNCATE)` first: it
folds the log back, empties it, and **throws when another process holds the
database** instead of leaving the caller believing a self-contained file was
written.

The throw is swallowed. This runs on the way out of a process that is leaving
anyway, `synchronous = FULL` means every acknowledged commit is already durable,
and a `will-quit` that raises would trade one unwritten checkpoint for a DASH
that never exits — the failure `AGENTS.md` forbids resolving with a kill.

`handle` is cleared first, so a throw cannot leave a live `DatabaseSync` that
nothing references. That is MAR-676's lesson from the open path applied to the
close path; on Windows a leaked handle also holds its own directory.

### 5. Every exit the shell can see checkpoints

`installStoreExitGuards()` registers `process.on("exit")` — the last synchronous
moment Node offers, and one that fires for a plain return, `process.exit`,
`app.exit` and an uncaught throw alike — plus SIGINT and SIGTERM, which bypass
`exit` entirely.

The signal handlers **re-raise** rather than swallow. A Ctrl-C must still
terminate DASH; a handler that ate SIGINT would create precisely the unkillable
shell MAR-678 exists to prevent.

`SIGKILL` and `taskkill /F` remain uncoverable by anything inside this process.
That is why `AGENTS.md` forbids them, and why a reboot is the only safe release
of a stuck lock.

---

## Consequences

**A worktree can no longer open the installed store by accident.** It gets a
refusal naming three remedies: `DASH_DATA_DIR` for a store of its own,
`DASH_ALLOW_INSTALLED_STORE` to mean it, or launching from the main checkout.
Sessions that have been running `pnpm shell` from a worktree will meet this, and
that is the point.

**A clean exit leaves one file.** Which means the ordinary case — the
overwhelmingly common one — leaves nothing to recover, and a copy taken between
sessions is a copy of the whole store rather than half of it.

**A hard kill still destroys the store**, and nothing here changes that. What
changes is how many ways there are to reach one.

**The damage is now diagnosable without a `sqlite3` CLI.**
`scripts/salvage-store.mjs` walks the b-tree directly, so a lost page costs the
rows on that page rather than the file. Against the 08-19 evidence it recovers
**1,773 rows across 32 tables**, losing 17 pages, from a file SQLite will not
read one byte of. Its first line of output is the header's page count beside the
file's real one, which is what names a mid-checkpoint truncation on sight.

## What this ADR does not decide

**Whether the recovered rows go back into the store.** They did not. The live
store passes `integrity_check`; the 47 rows the 2026-08-19 reconcile dropped —
three runs, including MAR-674's attended run `3d71bed5` — are preserved as JSON
under `salvage-20260822/` instead. A partially recovered run, with no terminal
event and no artifact, is not the same thing as a run, and putting one into a
person's history is their call rather than a repair. Henrik's, 2026-08-22.

**`runner.sqlite`.** Measured on 2026-08-22 and split out as **MAR-738**,
because the shape is not this one: 29 pages of 29, `quick_check` **ok**, all 58
`runner_audit` rows readable — and `integrity_check` reporting every one of them
missing from two secondary indexes. Nothing is truncated and no page is gone.
That is an index that was never populated, not a file that was cut in half, and
the guard and the checkpoint above do not address it. Deliberately not repaired:
a `REINDEX` would clear the symptom and destroy the only evidence of the cause.
