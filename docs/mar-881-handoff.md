# MAR-881 handoff — the agent page must keep its scroll position across a live poll tick

## What changed

- `app/_data/use-view.ts` — `useLiveView` no longer routes through `useView`.
  It keeps its own `ViewState` and, on every effect run (a key change **or**
  a poll tick), decides whether the re-read is a background heartbeat on an
  unchanged resource or a real change of resource, via a new exported pure
  function `isBackgroundPoll(previousKey, key, previousStatus)`. A background
  poll updates `state` in place once the read resolves and never drops the
  page back to `{ status: "loading" }` first; anything else (first read, a
  changed key, a previous read that was still loading or had failed) still
  shows loading exactly as before.
- `tests/use-view-live-poll.test.ts` (new) — six cases against
  `isBackgroundPoll` covering: first read, same-key tick, key changed (agent
  switch or an explicit `refreshKey` bump baked into the composed key),
  previous read still loading, previous read failed, and numeric vs. string
  key identity (not coerced into matching).
- `app/agents/detail/page.tsx` was **not** touched. The mechanism was fully
  inside the hook; the page's `if (state.status === "loading") return
  <ViewLoading />` (line ~781) is correct and untouched — it now simply never
  fires on a live poll tick that has good data already.

Commit: see `git log` on `000henrik/mar-881-scroll-reset` — one commit,
message `fix(mar-881): keep the agent page's scroll position across a live
poll tick`.

## Which mechanism it was

**Mechanism 2 from the issue: every tick re-created the whole tree, not a
single remount.** It was never really about `refreshKey` as a React `key`
prop — page.tsx does not use `refreshKey` as a `key=` anywhere; grep confirms
this (`grep -n "key={" app/agents/detail/page.tsx` has no `refreshKey` hit).

The actual chain:

1. `AgentWorkspace` calls `useLiveView((source) => source.workspace(agent), \`${agent}:${refreshKey}\`, live)`.
2. The **old** `useLiveView` folded its own five-second `tick` into that key
   before handing it to `useView`: `` `${key}:${tick}` ``. So the composed key
   changed on *every* poll tick, not just on a real refresh.
3. `useView`'s effect resets to `{ status: "loading" }` synchronously on
   *any* key change, before the read's promise resolves. That is the correct
   contract for `useView` itself (a deliberate, user-caused refresh should
   say so) — it was simply never meant to be fed a key that changes on its
   own every five seconds.
4. `AgentWorkspace` (`app/agents/detail/page.tsx:781`) returns
   `<ViewLoading />` whenever `state.status === "loading"`. That is a full
   early return before any of the workspace JSX — header, rail, stage, scroll
   container — is reached, so React unmounts the entire subtree and mounts a
   fresh one once the read resolves.

Net effect: every 5-second poll tick while `adjudicating` (or `running`) is
true unmounted and remounted the whole workspace, including whatever
scrolling div the Output stage's receipt sits in, which lands back at
`scrollTop: 0` on every remount. The issue's timeline (a jump noticed once,
around t+23s, then "stayed" at the top for the rest of the two minutes) is
consistent with repeated remounting rather than a single one: once scrolled
back to the top, a person who does not scroll back down sees no *further*
movement even though the page keeps remounting on the same five-second
cadence for as long as the judgement runs.

## What was verified, and how

1. `pnpm typecheck` — clean.
   ```
   > tsc --noEmit
   ```
2. Focused tests, from PowerShell:
   ```
   pnpm vitest run tests/use-view-live-poll.test.ts tests/agent-one-home.test.tsx tests/agent-cockpit-render.test.tsx tests/one-result-per-run.test.tsx
   ```
   Result: `Test Files  4 passed (4)`, `Tests  79 passed (79)`.
3. `pnpm brand:check` — passed (12 characters / 96 frames / 93 files
   audited, unaffected by this change but run per the common lane rules).
4. `pnpm test`, full suite, from PowerShell: `278 passed | 1 failed` files,
   `5306 passed | 13 skipped` tests. The one failure —
   `tools/dash-mcp/tests/template-run.test.ts`, an `EPERM` on `rmSync` during
   its own `afterEach` cleanup — is unrelated to this change (a different
   subsystem entirely: DASH MCP's scaffold-run harness, not the agent
   detail page or `use-view.ts`) and matches the known
   `EPERM on temp cleanup is a live child` flake pattern. Re-ran it alone:
   `pnpm vitest run tools/dash-mcp/tests/template-run.test.ts` → `1 passed
   (1)`, `11 passed (11)`. Treated as flake, not a regression from this
   change.

## What is NOT done

- No jsdom-backed, real-DOM proof that a scroll container's `scrollTop`
  literally survives a rendered poll tick. This repository's test suite runs
  under plain Node with no `environment` set in `vitest.config.ts`, and
  neither `jsdom` nor `@testing-library/react` is an installed dependency —
  `package.json` and `pnpm-lock.yaml` are outside this lane's file ownership,
  so adding either was not an option. `tests/shell-focus-refresh.test.ts` is
  this repository's existing precedent for testing a hook's extracted
  decision logic directly instead of mounting it, which is the pattern this
  fix follows (`isBackgroundPoll`).
- The installed-style proof named in the lane brief — scroll to the receipt,
  press *Judge it again*, watch the page hold its scroll position for the
  full judgement — was explicitly left to the orchestrator (see "Evidence
  class" below) and was not attempted here.
- `app/_data/use-view.ts`'s `useLiveView` is shared by
  `app/_components/fleet-strip.tsx`, `app/_components/browser-panel.tsx`, and
  `app/runs/page.tsx` in addition to the agent detail page. All three had the
  same latent every-tick-remounts-on-a-loading-flash exposure this fix
  removes; none of them currently has a test file, so none is exercised here
  beyond `pnpm test`'s full run staying green. Worth a follow-up screenshot
  pass on those three surfaces if the orchestrator wants it confirmed
  visually, but it is the same mechanism and the same fix, not a new one.

## Surprises / contradictions

- The lane brief frames the two hypotheses as "remounts the stage (jumps
  once)" vs. "every tick re-creates the scroll container (jumps
  repeatedly)". The actual mechanism is the second, but it is not literally
  "the scroll container" being re-created in isolation — it is the entire
  `AgentWorkspace` subtree unmounting via the top-level `state.status ===
  "loading"` early return in `page.tsx`, which takes the scroll container
  down along with everything else. Naming this precisely in case a future
  session goes looking for a narrower "container re-creation" that isn't
  there.
- `refreshKey` (the `AgentWorkspace`-level `useState`) is not itself the bug.
  It is one of the two inputs baked into the key `useLiveView` receives, and
  a legitimate one: a press that bumps it (e.g. `onAdjudicated`,
  `issue()`'s explicit post-command refresh) *should* show a loading state
  once — that is a deliberate, user-caused refresh, not a heartbeat. The fix
  only suppresses the loading flash for the *tick* `useLiveView` adds
  internally, never for a change to the key the caller passed in.

## The one thing the next session should do first

Get installed-style (or at minimum a real jsdom/browser) proof that scrolling
to the Output stage's receipt, pressing *Judge it again*, and waiting through
a live poll tick (>5s) actually holds `scrollTop` — this lane's evidence is a
source-level unit test of the decision function the fix is built on, not a
rendered one, because this repository's test infra has no DOM.

## Evidence class

**Fixture test only.** `isBackgroundPoll` is unit-tested directly (six
cases); the surrounding page's existing rendering tests
(`agent-one-home`, `agent-cockpit-render`, `one-result-per-run`) stay green,
confirming nothing else in the stage's rendering shape moved. No
scratch-store harness frame and no installed-app proof were produced — that
is explicitly the orchestrator's evidence to gather per the lane brief.
