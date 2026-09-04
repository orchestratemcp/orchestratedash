# MAR-868 handoff — the agent page follows an adjudication in flight

## Diagnosis, verified before anything changed

The handoff's diagnosis held exactly as written. Read `app/agents/detail/page.tsx`
before touching it:

- `running` (`app/agents/detail/page.tsx:213`) is computed only from
  `state.data.snapshot.runs`, via `isRunInFlight`. An adjudication is not a run
  and touches none of that.
- `following = running || asked > 0` (`app/agents/detail/page.tsx:217`, before
  this change). `asked` is bumped only by `issue()` on `retry`/`resume` and by
  `startAndRunHere()` — both run-starting presses. `adjudicate()`
  (`app/agents/detail/page.tsx:1563`, before this change) set `feedback` and
  nothing else: no `asked`, no `refreshKey`, no live predicate.
- So a press of "Have it judged" left `live` false for the whole two-minute-plus
  wait. `useLiveView` (`app/_data/use-view.ts`) never repolls while `active` is
  false, so the page held whatever it read at the moment of the press —
  typically the *previous* receipt, or no receipt at all — until somebody used
  the overflow menu's Refresh.
- The button itself was already correct. `app/_components/outputs.tsx:293-299`
  already computes `judging` and the three-way label
  (`action` / `action_again` / `action_running`) off `card.adjudications[0].stage`,
  landed with MAR-863 (`eec5b5c`). It never got to run against fresh data,
  because the view underneath it never changed. "Nothing in between" was an
  observed symptom of stale data, not missing button logic — confirmed by
  reading `git log --oneline -- app/_components/outputs.tsx`.

No redesign was needed. The fix is entirely in what makes the page poll and
when it takes its first fresh read after the press.

## What changed

All in `app/agents/detail/page.tsx`:

1. **`adjudicating`**, a new predicate alongside `running`: true when any card
   in `state.data.outputs` carries an adjudication where
   `isRunning(attempt)` (`lib/genlayer/record.ts`) is true — i.e. `stage !==
   "settled"`. `following` is now `running || asked > 0 || adjudicating`.
2. **The exit is the record's own, not a new timer.** `isRunning` goes false
   the moment a row reaches `stage: "settled"`, which `lib/genlayer/adjudicate.ts`'s
   `settle()` writes on every terminal path alike — an accepted verdict, a
   `no_consensus`, or a failure. That is the same "settled row, a failure, or
   a timeout" bound the brief asked for; no client-side deadline was added
   because the record already carries a bounded one. `lib/genlayer/**` was not
   touched.
3. **`OutputsArea` gained an `onAdjudicated` prop**, `onExported`'s twin, wired
   to the same `() => setRefreshKey((value) => value + 1)` the parent already
   passes for `onExported`. `adjudicate()` calls it once, only on `result.ok`.
   This matters because `adjudicateBrief`'s own contract
   (`app/_data/source.ts:1500`) is that it returns once the attempt is
   *recorded and running* — so the row exists to read the instant the call
   resolves, and the explicit refresh (mirroring `issue()`'s own "one explicit
   refresh after a command" pattern) is what puts it on screen immediately
   instead of waiting for whatever unrelated poll happens next.
4. No change to `lib/copy/genlayer.ts`, `app/_components/outputs.tsx`, or
   `app/_data/source.ts` — none was needed.

## What was verified, and how

- `pnpm typecheck` — clean, from PowerShell, in the worktree.
- `pnpm test` — 266 test files, 5022 passed, 13 skipped, exit 0, run from
  PowerShell. `tests/store-damage.test.ts` passed in this run (it is the file
  known to be flaky under parallel load; it did not need a solo re-run this
  time).
- No new test was written. The change is a predicate over data the existing
  view-building tests already exercise (`adjudicationResolverFor`,
  `buildArtifactCards`) and a wiring change in a page component that has no
  existing render-level test harness for its live-polling behaviour; the
  proof this packet asks for is a recording against the installed build, not
  a unit test.

## What is not done

- **The recording.** This packet's proof is behavioural and time-based — watch
  the stage change and the verdict arrive without touching anything — and a
  judgement measured at sixteen to two hundred forty-nine seconds to accepted
  cannot be substituted with a screenshot. See the session's own note on
  whether a build-and-record pass was completed this session.
- The Connections card gap for the `genlayer` kind is untouched, as instructed
  — it is real and filed separately, and does not block this packet or the
  MAR-866 video.
- No ADR was written or touched. 0032 and 0033 stand as they were.

## Lifecycle state

`merged` once this PR is green. Not `proven` until the recording exists.
