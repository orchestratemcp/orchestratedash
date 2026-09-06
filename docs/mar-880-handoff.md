# MAR-880 handoff: a failed judgement poll must not settle a live judgement

**Lane:** E (Sonnet, bounded). **Branch:** `000henrik/mar-880-judgement-poll-retry`,
from `origin/master` at `0e52211`. **Issue:** MAR-880.

## What changed

Diagnosis (from the issue, confirmed by reading the cited lines before writing
any code): Judgement 4 on Proof Scout's brief settled 25 s after the press as
`failure: "abandoned"` with `open_tx` set and `submit_tx` null — died in
`opening` — while Studionet finalized that same open transaction 6 s later.
`genlayer-js@1.1.8`'s `waitForTransactionReceipt` calls `client.getTransaction`
on every poll with no try/catch, over a transport built with `retryCount: 0`
(confirmed by reading `node_modules/.pnpm/genlayer-js@1.1.8.../dist/index.js`
lines ~1456–1494 and ~2420–2425 in the installed package). One dropped
connection anywhere in a five-minute wait killed the whole wait immediately,
regardless of the 300×2 s / 200×3 s poll budgets in `lib/genlayer/client.ts`,
because those budgets only ever governed the "not yet decided" path, never a
thrown transport error.

**`lib/genlayer/client.ts`.** `waitFinalized` no longer hands the whole wait to
the library's recursive `waitForTransactionReceipt`. It now drives its own
outer poll loop (`waitForStatus`, exported) that calls the library with
`interval: 0, retries: 0` — exactly one `getTransaction` per call — and wraps
each such call in `pollWithRetry` (exported), which retries a throw up to
`POLL_RETRY_LIMIT = 5` times with a backoff of `1s, 2s, 4s, 8s, 8s` before
giving up on that poll. Two outcomes are told apart carefully:

- A throw whose message starts with `"Timed out waiting for transaction "` —
  the library's own, deterministic shape for "asked once, not decided yet" —
  is a *normal* poll answer, not a failure, and is never retried or counted
  against the retry budget. (`isNotYetDecided`, matched against the exact
  message read out of the installed `genlayer-js@1.1.8` source.)
- Any other throw (a rejected fetch, a non-JSON body, an unindexed hash) is a
  genuine transport failure and goes through `pollWithRetry`.

Exhausting all 300 (or 200) outer polls while every individual poll kept
answering still throws a plain `Error` (unchanged intent — the chain is fine,
DASH just stopped watching). Exhausting `pollWithRetry`'s own budget on
consecutive genuine errors throws `GenLayerNetworkLostError` — a new class
defined in `lib/genlayer/record.ts` (see "Needs orchestrator" below on why it
lives there, not in `client.ts` or `adjudicate.ts`).

The total poll-count budgets (300×2 s to accepted, 200×3 s to finalized) and
the decided-state early return for `ACCEPTED` are untouched: both are still
delegated straight through to the library's own `waitForTransactionReceipt`
call inside `checkOnce`, never reimplemented.

**`lib/genlayer/record.ts`.** `AdjudicationFailure` gains `"network_lost"`,
documented against `abandoned` (the distinction: DASH stopped *hearing from
the network*, vs DASH stopped watching a chain that kept answering).
`GenLayerNetworkLostError extends Error` is defined here rather than in
`client.ts` or `adjudicate.ts` — see "Needs orchestrator".

**`lib/genlayer/adjudicate.ts`.** `adjudicateBrief`'s `deps` parameter gains
`log(line: string): void`. The `stage` helper's `catch` around
`chain.waitFinalized(hash)` now checks `error instanceof
GenLayerNetworkLostError` first: if so, it calls `deps.log` with
`` `[dash] judgement ${commissionId} stopped in ${name}: ${error.message}` ``
(the network's own text reaches the log line, never the stored `failure`
column) and returns `"network_lost"`; otherwise it falls through to the
existing `"abandoned"` return, unchanged.

**`electron/adjudicate-host.ts`.** The one caller of `adjudicateBrief` now
supplies `log: (line) => console.warn(line)` alongside the existing `now` and
`sleep`.

**`lib/copy/genlayer.ts`.** `describeAdjudicationFailure` gains a
`"network_lost"` case: headline "DASH lost the connection to the network",
meaning naming DASH's own connection as what failed (never the network's
answer or the committee's), same `next_action` and `tone` as `abandoned`
("Ask for it to be judged again.", `"muted"`).

**`app/_components/digest.tsx`: not touched.** The lane brief anticipated a
"failure-copy mapping" there, but the file only calls
`describeAdjudicationFailure(latest.failure)` generically (line ~921) — there
is no switch over `AdjudicationFailure` in that component to widen. Confirmed
by reading the surrounding ~40 lines and grepping every reference to
`AdjudicationFailure` in the repo before concluding this.

**Tests.**
- `tests/genlayer-client.test.ts` (new): `pollWithRetry` and `waitForStatus`
  tested directly with fake polls/clients, no `genlayer-js` in the room —
  covers (a) a poll throwing once then succeeding, (b) six consecutive throws
  → `GenLayerNetworkLostError`, and the "not yet decided" message being
  treated as a normal answer rather than a retry (the case that would
  otherwise silently reintroduce a slower version of the same bug — see
  "Surprises" below).
- `tests/broker-genlayer.test.ts`: `CLOCK` now carries a no-op `log`; two new
  tests in "one run" drive `adjudicateBrief` through a fake `GenLayerChain`
  whose `waitFinalized` throws `GenLayerNetworkLostError` (→ `network_lost`,
  one log line naming the commission and stage, the network's text bound into
  it) and a plain timeout `Error` (→ `abandoned`, nothing logged). The
  "says something different for every stage and every failure" test now
  covers six failures. Two new tests run `describeAdjudicationFailure` output
  for `network_lost` and `abandoned` through `expectPlainLanguage` — this
  module was not under that gate before this packet.

## Verified, and how

- `pnpm typecheck` (PowerShell): clean, no errors.
- `pnpm vitest run tests/genlayer-client.test.ts tests/broker-genlayer.test.ts`
  (PowerShell): **2 files passed, 43 tests passed.**
- `pnpm brand:check` (PowerShell): passed (12 characters, 96 frames, 9 files
  using the cast — unaffected by this change but run per the lane's own rule).
- `pnpm test` (PowerShell, full suite, run once): **267 test files passed,
  5034 tests passed, 13 skipped, exit 0.** No unrelated failures to re-run.

## What is NOT done

- No live run against Studionet. This packet cannot be proven against the
  real network from a worker-lane worktree — that is the orchestrator's
  installed-runtime proof, per the lane contract. Everything above is fixture
  evidence: fake polls, a fake `GenLayerChain`, no network in the room.
- `isNotYetDecided`'s message match is pinned to the exact string
  `genlayer-js@1.1.8` throws (verified by reading the installed package's
  `dist/index.js`, not from documentation). A future dependency bump that
  changes that message's wording would silently make DASH treat "still
  pending" as a transport error — degraded (slower, more backoff, and after
  six such calls a false `network_lost` on a transaction that is actually just
  slow), not silently wrong in the original bug's direction. Worth a comment
  at the pnpm-lock.yaml bump if `genlayer-js` is ever upgraded; I did not
  touch `package.json` or the lockfile (out of lane).

## Surprises / contradictions

- The lane design offered two implementation shapes ("DASH's own poll loop
  over `client.getTransaction`" or "keep using `waitForTransactionReceipt`
  with `retries: 0` per single poll"). I ended up doing a hybrid: my own outer
  loop and retry budget (per the first shape), but still delegating the actual
  status check and receipt simplification to the library's
  `waitForTransactionReceipt` call with `retries: 0` (the second shape) rather
  than reimplementing `isDecidedState` / `transactionsStatusNameToNumber` /
  `simplifyTransactionReceipt` myself. Reimplementing those looked like the
  literal reading of "DASH's own poll loop over `getTransaction`" but carried
  real risk of subtly changing what a receipt looks like to
  `lib/genlayer/receipt.ts`, for no benefit the tests could catch (that
  module's reading logic has its own fixture coverage and I did not want to
  find out at runtime that a hand-rolled receipt shape drifted from the
  library's). The hybrid keeps every existing behavior (poll cadence, decided
  states, receipt shape) delegated to code that was already measured against
  real Studionet runs (ADR 0033's evidence section), and adds only the retry
  wrapper on top — "add the retry budget on top, bounded," as the design says.
- `app/_components/digest.tsx` needed no edit at all (see above) — the lane
  brief's "failure-copy mapping only" scope turned out to be zero lines.
- `lib/genlayer/record.ts` is not in the lane's listed ownership, but the
  design's own step 2 requires widening `AdjudicationFailure`, which is
  defined only there (re-exported by `lib/genlayer/store.ts`). I also put
  `GenLayerNetworkLostError` there rather than in `client.ts` or
  `adjudicate.ts`: `client.ts` already has a type-only import from
  `adjudicate.ts` (`GenLayerChain`), and having `adjudicate.ts` import a value
  back from `client.ts` to `instanceof`-check it would be this codebase's
  first runtime import cycle between the two. `record.ts` is documented as
  having "no imports but one type" and being safe for anything to reach, so
  both files import the error class from there with no new cycle. Flagging
  this under "Needs orchestrator" since it is a real (if small and mechanical)
  departure from the stated ownership list.

## Needs orchestrator

- `lib/genlayer/record.ts` was edited (widened `AdjudicationFailure`, added
  `GenLayerNetworkLostError`) even though it is not in this lane's listed
  ownership. It is a small, additive, doc-commented change with no removals,
  directly required by the lane's own design (step 2's "new `AdjudicationFailure`
  member"). No other lane's file list in this wave mentions `record.ts`, so I
  do not believe this collides with parallel work, but the orchestrator should
  confirm no other lane also touches it before merging.
- The `isNotYetDecided` message-match fragility noted above: worth a line in
  `PROJECT_STATE.md` or wherever `genlayer-js` version bumps are tracked, so a
  future upgrade of that dependency re-checks this string.

## Evidence class

Fixture tests only. No scratch-store harness frame, no installed-runtime
proof, no live Studionet run. Everything verified above is `vitest` against
fakes with no network, no chain, and no key in the room, plus `tsc --noEmit`
and the full local test suite. The orchestrator's installed-runtime proof
(if any is scheduled for this packet) still needs to run separately.
