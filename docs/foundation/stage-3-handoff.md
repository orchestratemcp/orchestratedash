# Stage 3 handoff — MAR-889, run traces

**Branch:** `000henrik/mar-889-run-traces` · **PR:** #357 · **Base:** `master`
(cut from `codex/agent-foundation` at `821c239`, which carries stage 1's SDK)
**Epic:** MAR-886 · **Date:** 2026-09-07

---

## What changed

Four commits.

| Commit | What |
| --- | --- |
| `6fac2f9` | The side channel: contract, runner message, buffer, route, drain, migration, ingest |
| `fce514f` | The SDK instrumentation and the tree on the run detail page |
| `6bf8c22` | The acceptance case against a real spawned agent, and the rest of the tests |
| `616930a` | The contract doc's new section, smoke proof 6q, and two pins that moved |

**Files**

- New: `contracts/run-span.schema.json`, `examples/run-span.example.json`,
  `lib/views/run-trace.ts`, `lib/copy/run-trace.ts`,
  `app/_components/run-trace.tsx`, `tests/fixtures/retrying-agent.mjs`,
  `tests/run-trace-agent.test.ts`, `tests/run-trace-view.test.ts`,
  `tests/run-trace-store.test.ts`, `tests/run-trace-render.test.tsx`.
- Changed: `runner/protocol.ts`, `runner/supervisor.ts`, `runner/server.ts`,
  `lib/agent-dom/evidence.ts`, `lib/agent-dom/runner-channel.ts`, `lib/db.ts`,
  `lib/store.ts`, `lib/contracts.ts`, `agent-kit/template/dash-agent-sdk.mjs`,
  `lib/views/build.ts`, `lib/views/types.ts`, `app/runs/detail/page.tsx`,
  `app/globals.css` (append-only `MAR-889` fence), `electron/smoke.ts`,
  `docs/telemetry-contract-v1.md`, and the tests listed under *Pins that moved*.

## The migration index

**Index 38, producing `user_version` 39.**

Assigned by reading the literal pin in `tests/store-sqlite.test.ts` — which
stood at 38 — and confirmed against it before the step was written, which is the
check that packet MAR-744 failed and MAR-784 onwards have performed. Two bare
`CREATE TABLE IF NOT EXISTS` steps in one migration:

- `run_spans` — `(agent, run_id, span_id)` primary key, `parent_span_id`,
  `name`, `kind`, both timestamps, `status`, `error_json`, `attributes_json`,
  `usage_json`, `received_at`, plus an index on `(agent, run_id, started_at)`.
- `run_span_drops` — what the per-run cap refused, because the first table
  cannot record a row it refused.

`HEAD_VERSION` moved from 38 to 39 in `tests/store-sqlite.test.ts` and
`tests/store-reconcile.test.ts`; `RECONCILED_VERSION` is untouched at 27, which
is the property those files' notes exist to guard.

**Anyone merging a parallel packet with a migration: confirm 38 is still free.**

## The new smoke proof

**6q — "the sample's run has a step trace on the installed shell"**, numbered
after 6p, the last 6* proof. Read through `window.dashData.run`, the same bridge
6i and 6k use.

It asserts a **tree with a step in it**, not a count: a count would pass on a
run that emitted only its own root span, which is exactly what a broken `step()`
produces. It also asserts the root closed `ok`, zero orphans and zero drops — on
a run this small, either would mean a link or a candidate was lost between the
child and the store.

Observed output:

```
PASS  6q. the sample's run has a step trace on the installed shell:
{"total":5,"dropped":0,"orphans":0,"root_kind":"run","root_status":"ok",
 "steps":["Reading your news sources","Summarising what it found"]}
```

## What older consumers do

Three distinct participants can be old, and all three arrive at one sentence on
the page — *This run has no step trace.* — rather than at three different
failures.

| Who is old | What happens |
| --- | --- |
| **The runner** (no `/traces/drain`) | Answers 404. `drainTraces` returns `reached: false` with no log line, exactly as `syncWorkspace` treats a runner built with no workspace. The pull is still `reached` overall, so the evidence honesty sentence does not claim DASH never looked. |
| **The agent** (no `trace` lines) | The route answers, the batch is empty, nothing is stored. `tests/legacy-agent.test.ts` is unaffected and still spawns the pre-SDK bytes. |
| **A run already in the store** | Has no spans. `runView` carries an empty trace — never a null — and the page names it. Pinned in `tests/views.test.ts`. |

The reverse direction is worth stating too: a **new agent on an old runner**
writes `trace` lines that `parseAgentMessage` (the old build) returns null for,
so they are forwarded to the runner's log as ordinary agent output. Noisy, not
harmful, and the same path any unknown message has always taken.

Telemetry v1 itself is byte-for-byte unchanged. `tests/contracts.test.ts` now
asserts that `contract.lock.json` still holds exactly the two v1 schemas and
that the event type enum still holds exactly seven types, so a future "tidy" that
folded a span type into the events would fail there.

## What was verified, and how

All commands run from **PowerShell** in `C:\Users\henri\AppData\Local\Temp\wt-f3-s1`.

```
pnpm typecheck                    → clean, no output
pnpm brand:check                  → ✓ passed — 12 characters, 96 frames, 4 bundled fonts
pnpm test                         → Test Files 285 passed, 2 failed (287)
                                     Tests 5414 passed | 3 failed | 13 skipped (5430)
pnpm build:renderer && build:shell → wrote dist\electron, runner_build=eb7f8f67ff06334c73d6
pnpm verify:shell                 → exit 0; 86 PASS, 0 FAIL, 0 SKIP
```

### The three full-suite failures, and why they are not this lane's

`tests/store-damage.test.ts` (two tests, `Test timed out in 5000ms`) and
`tools/dash-mcp/tests/template-run.test.ts` (one test, `EPERM` from `rmSync` in
`afterEach`). Both are the known load flakes this repository has recorded before:
the MCP suite is flaky under parallel load, and an EPERM on temp cleanup is
`rmSync` racing a child that still holds the directory.

Re-run alone, per that rule:

```
pnpm vitest run tests/store-damage.test.ts tools/dash-mcp/tests/template-run.test.ts
→ Test Files 2 passed (2), Tests 39 passed (39)
```

An earlier full run failed a *different* store-damage-family file
(`tests/brand-surfaces.test.tsx`, same 5000ms timeout) and passed store-damage,
which is what a load flake looks like and what a real defect does not.

That earlier run also caught three failures that **were** this lane's, all now
fixed and green: `client-bundle`, `model-choice` and the two `HEAD_VERSION`
pins. See below.

### The shell smoke

Run on a scratch store, never the installed one:

```powershell
$scratch = "C:\Users\henri\AppData\Local\Temp\f3-smoke-scratch\orchestratedash"
$env:DASH_SMOKE_USER_DATA_DIR = $scratch
pnpm verify:shell    # passes --user-data-dir=$scratch and DASH_DATA_DIR=$scratch
```

`%APPDATA%\orchestratedash` was never opened. The harness runner the smoke
leaves running on purpose (pid 17820) was retired with `POST /shutdown` on its
own pipe, presenting the session key beside `runner.json` — status 202, process
gone. The scratch store was left in place: deleting one is what *makes* an
orphan.

**Note for the next person running this:** `electron dist/electron/smoke.mjs`
invoked directly loads `http://127.0.0.1:3000/` and dies with
`ERR_CONNECTION_REFUSED`. `scripts/verify-shell.mjs` sets
`DASH_SHELL_URL=dash-app://ui/`, which is what makes it the installed path.
Use `pnpm verify:shell` with `DASH_SMOKE_USER_DATA_DIR`, not the binary.

## Evidence class

**Fixture tests + an installed-style shell on a scratch store.** Specifically:

- **A real spawned agent, not a fixture list.** `tests/run-trace-agent.test.ts`
  writes an ordinary program and the shipped runtime into a temp folder, spawns
  it under a real `Supervisor` over a real pipe, and collects the spans off
  `drainSpans` in the bytes the child wrote. The failure is a function that
  throws the first time it is called. Every candidate goes through
  `validateSpan` before it is believed.
- **Real SQLite bytes.** `tests/run-trace-store.test.ts` reads `dash.sqlite`
  *and its `-wal`* to prove a `Bearer …` never reached the store, following
  `tests/redaction.test.ts`'s pattern.
- **The installed shell.** Proof 6q ran on the packaged build against the
  packaged sample agent, through the read bridge, on a scratch store.

**Not evidence:** nothing here was seen by a person on Henrik's own build. The
run detail page's new section is proven by `react-dom/server` markup and by 6q's
view read, **not by a screenshot**. No capture-harness frames were taken — see
*Needs orchestrator*.

## Needs orchestrator

1. **One file outside the lane's declared ownership.**
   `lib/agent-dom/runner-channel.ts` gained one entry, `"/traces/drain"`, in
   `EVIDENCE_ROUTES`. It was not on the lane's write list and the design could
   not proceed without it: `RemoteRunnerChannel` is `RunnerChannel<EvidenceRoute>`,
   so `channel.call("/traces/drain")` inside `evidence.ts` is a **compile error**
   until the route is on that allowlist — which is the structural guard ADR 0006
   and MAR-488 built deliberately. The addition carries a docblock making the
   ADR 0014 argument for it (no credential in either direction; chooses *which*,
   never *what*). No lane collision: F2 owns `agent-kit/{recipe,scaffold,cli}.ts`,
   `tools/dash-mcp/src/**` and `lib/sample-agent.ts`, none of which this touches.
   `tests/broker-channel-exclusion.test.ts` and `tests/host-residency.test.ts`
   assert membership rather than an exhaustive list, so both still pass.
   **Please confirm the widening at review.**

2. **Two shared test pins moved, both deliberately.**
   - `tests/model-choice.test.ts` names every file whose code touches
     `cost_usd`. `lib/store.ts` and `lib/copy/run-trace.ts` now do, and the new
     entries say why they are safe: the store stamps `source: "reported"` itself
     rather than copying the agent's claim, and `describeSpanUsage` attributes
     the figure to the agent *inside the sentence*. A second assertion pins that
     wording so the list cannot be satisfied by a reader that shows the number
     without saying whose it is.
   - `HEAD_VERSION` 38 → 39 in `tests/store-sqlite.test.ts` and
     `tests/store-reconcile.test.ts`. That constant follows the head by design;
     `RECONCILED_VERSION` did not move.

3. **A trap worth recording as a repository note.**
   `tests/client-bundle.test.ts`'s import parser is a regex over
   `import … from "…"` and cannot tell a docblock from a statement. The sentence
   *"No value import from anything that reaches a Node builtin"* in
   `lib/views/run-trace.ts`'s header put the word above the file's only
   dependency line, so the guard read a type-only dependency as a value and
   marked a pure module Node-only — a **false positive with a real failure
   message**. Fixed by rewording the prose, with a note in the header for
   whoever edits it next. `lib/views/run-progress.ts` carries similar prose and
   is currently safe only by accident of phrasing. Tightening the parser is a
   one-line change to a shared guard and was deliberately left alone while other
   lanes are live.

4. **No screenshots.** The run detail page's new section has never been
   photographed. `electron/capture-deploy.ts` has scenes and adding one is the
   right shape for it, but it was outside this lane's ownership. If Henrik
   should *see* this, a capture scene for the run detail page is the next
   packet's first job — and per the session ritual, the packaged shell should be
   launched and left open for him.

5. **`.commitmsg.txt` appears in `6fac2f9` and is deleted in `fce514f`.** It is
   absent from the PR's net diff. Mentioned only so it is not mistaken for
   something.

## The one thing to do first

**Read `tests/run-trace-agent.test.ts` before anything else in this PR.** It is
the acceptance criterion written the way the criterion is worded, and it is the
only file here that could have caught what it did catch: `step()` originally
parented each step span to the previous one, so a run of five steps drew as a
staircase five levels deep. Every unit test passed. A fixture list of spans
would have passed too, because the fixture author would have written the
parentage they intended.

## What is NOT done

- **No retention sweep.** `run_spans` is capped per run and counts what it
  refused, but there is no time-based prune — the 90-day sweep
  `docs/telemetry-contract-v1.md` decision 2 describes still has no
  implementation for spans *or* for events. Unchanged by this packet, and now
  documented in the same place.
- **No payload capture.** No inputs, no outputs, no model reasoning, and the
  schema is deliberately not shaped to make adding them a small change. The plan
  says an explicit opt-in is a later packet.
- **`lib/views/run-progress.ts` was not touched.** The lane permitted a
  one-line change taking a failed span's error text as the failed step's
  `detail`. It is not a one-line change: `buildRunProgress` derives its steps
  from telemetry events and has no span in scope, so wiring one would mean
  threading the trace through `agentView` and changing a module the lane says to
  leave alone. Left undone deliberately; the error text is on the run detail
  page's tree, which is where the lane put the tree.
- **`lib/analyze.ts`, `lib/views/agent-health.ts`, `lib/broker/**` and
  `contracts/run-event.schema.json` are untouched**, as the lane requires.
