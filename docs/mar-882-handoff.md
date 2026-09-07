# MAR-882 handoff — "Ask the chief about this agent" opens a prefilled composer (redo)

Lane M2 of the 2026-09-06/07 UX wave. Branch
`000henrik/mar-882-chief-prefill-redo`, from `origin/master` `9a629cc` — the
commit that reverted the first attempt (#349, reverted as #351).

## The defect, restated

MAR-878b's fix-it card and header chip say *"Ask the chief about this
agent"* whenever an agent cannot be asked directly, but the link went to `/`
— the fleet page, which read no search params — and `ChiefChat`'s composer
had no prefill prop. Pressing it opened the chief's room empty, with no way
to tell it stayed to do with the agent you just left.

## What happened to the first attempt, and why this redo reads the URL differently

#349 wrapped `AgentsPage`'s default export in `Suspense` so an inner
component could call `useSearchParams` for `?ask=`. Its own CI passed — every
render test in this repository is `renderToStaticMarkup`, which resolves
synchronously and never shows a fallback — but master's own shell-smoke read
`1. the UI renders: {"headings":0}` at `dash-app://ui/` after the merge: in
this app's static export, a `Suspense` boundary above a page's `<h1>` makes
the very first frame the fallback, with no heading in it, because the real
tree is what suspends on `useSearchParams` and the fallback is what the
exported HTML *is* until that resolves. Reverted as #351.

**This redo never touches `app/page.tsx` at all.** `ChiefChat` already
receives the whole fleet as its `agents` prop (for `ChiefTurnBody`'s own
reasons, unrelated to this issue), so it resolves its own `?ask=<agent>`
directly from `window.location.search` inside a mount effect, rather than
asking `app/page.tsx` to read it and pass a resolved prefill down through
`FleetList`. No `useSearchParams`, no second `Suspense` boundary, nothing
above the fleet's `<h1>` changed — `git diff --stat` against `origin/master`
confirms `app/page.tsx` and `app/_components/fleet-list.tsx` carry zero
changes on this branch.

## What changed

| File | What |
| --- | --- |
| `app/_data/routes.ts` | `CHIEF_ASK_PARAM` ("ask"), `chiefAskHref(agentId)` — identical to #349 |
| `lib/copy/chief-chat.ts` | `describeChiefPrefill(agentTitle)` — `"About <title>: "` — identical to #349 |
| `app/_components/composer.tsx` | `focusSignal` prop (default `0`) plus the effect that focuses the field when it grows — identical to #349 |
| `app/_components/chief-chat.tsx` | **The redesigned half.** `shouldApplyPrefill` (pure, unchanged from #349) decides whether a new prefill overwrites the field. `resolveChiefAskPrefill(askAgentId, agents)` (new, pure) resolves a raw query id against the fleet to a display sentence, never the id itself. `readChiefAskPrefill(agents)` (new, not exported) is the one place `window.location.search` is read, guarded by `typeof window === "undefined"` for the render-test path. `ChiefChat` calls it from a `useEffect` keyed on `agents` (not `[]`, since the fleet starts empty before its own view has loaded and the id can only resolve once it hasn't), applies it through the same `appliedPrefill`/`touchedDraft` refs and `focusSignal` state #349 used, and wires `handleQuestionChange` in as the field's `onChange` so typing sets `touchedDraft` |
| `app/_components/ask.tsx` | `capabilityHref`'s `chief`/`ask` arm and `ChiefEntry` both build their link with `chiefAskHref(agent)`; `AskThread` reads its own agent id off `useSearchParams()` — identical to #349, and still safe: this component is mounted only inside `app/agents/detail/page.tsx`'s own pre-existing `Suspense` boundary (`AgentWorkspacePage`), well below that page's own headings, which this lane does not touch |
| `tests/agent-stage.test.ts`, `tests/chief-chat-copy.test.ts`, `tests/ask-render.test.tsx` | Identical to #349 — these three files' changes never depended on how `app/page.tsx` reads the param |
| `tests/chief-chat-render.test.tsx` | New tests for `shouldApplyPrefill` (identical assertions to #349, now proven against the exported function) and for `resolveChiefAskPrefill` (new — a known id resolves to the sentence, `null` for no id, `null` for an id naming nobody in the fleet, `null` against an empty fleet); one render assertion that `ChiefChat` renders without throwing and without a `window` global at all, which is what `renderToStaticMarkup` gives every test in this file |
| `tests/fleet-first-paint.test.tsx` | **New.** Source-greps `app/page.tsx` for `Suspense` and `useSearchParams` (must find neither) and renders `AgentsPage` through `renderToStaticMarkup`, asserting `<h1>Agents</h1>` is in the output — the regression guard this issue's whole redo exists to have |

There is no `chiefPrefill` prop on `FleetList` and no `prefill` prop on
`ChiefChat` in this redo — #349 had both, threading a resolved sentence down
from `app/page.tsx`. Removing that thread is what let `app/page.tsx` stay
untouched.

## Why `AskThread` still reads the URL, unchanged from #349

Restated from the original handoff, since the file is unchanged: the lane's
sibling packets (MAR-881 on `app/agents/detail/page.tsx`, MAR-883 on
`lib/connectors`/fleet labels) left this lane's only permitted touch on the
agent page as the chief-entry link inside `app/_components/ask.tsx`.
`AgentAskView`'s blocked arm carries no plain `agent` field (see
`lib/views/types.ts`), so `AskThread` reads `AGENT_WORKSPACE_PARAMS.agent`
off `useSearchParams()` itself — the same mechanism the page it is always
mounted inside already uses for the identical fact, under a `Suspense`
boundary that page already had before this issue existed.

## Verified, and how

Run from PowerShell in `C:\Users\henri\AppData\Local\Temp\wt-ux882b-s1`.

- `pnpm typecheck` — clean, both before and after the test additions.
- `pnpm brand:check` — `✓ brand:check passed — 12 characters audited …`.
- Focused: `npx vitest run tests/agent-stage.test.ts tests/chief-chat-copy.test.ts
  tests/chief-chat-render.test.tsx tests/composer-shared.test.tsx
  tests/ask-render.test.tsx tests/fleet-view-render.test.tsx
  tests/add-agent-render.test.tsx tests/brand-surfaces.test.tsx
  tests/host-sighting-render.test.tsx tests/record-card.test.tsx
  tests/runner-store-notice-render.test.tsx tests/fleet-first-paint.test.tsx`
  — `Test Files 12 passed (12)` / `Tests 218 passed (218)`.
- `pnpm test` (whole suite) — `Test Files 281 passed (281)` / `Tests 5337
  passed | 13 skipped (5350)`. Clean on the first run, no flakes to re-run.
- `pnpm build:renderer` — succeeded, static export of `/` generated with no
  error. This is itself evidence: #349's defect was a build-time/runtime
  interaction (the exported `/` HTML is the `Suspense` fallback), and a
  build that completes cleanly here is necessary but was **not** sufficient
  to have caught #349 either — the smoke run below is what actually reads
  the exported HTML the way a launched shell does.
- `pnpm build:shell` — succeeded.
- **Local shell-smoke on a scratch store** (the check the first attempt
  lacked and this redo's lane file makes mandatory):
  `$env:DASH_SHELL_URL='dash-app://ui/'; pnpm exec electron dist/electron/smoke.mjs --user-data-dir=<scratch>\orchestratedash`,
  with `DASH_DATA_DIR` set to the same scratch path (basename
  `orchestratedash`), output redirected to a log file.
  - Proof 1, the one #349 broke: `PASS  1. the UI renders:
    {"title":"OrchestrateDASH","url":"dash-app://ui/","headings":1}` —
    `headings: 1`, not `0`. The fleet page's `<h1>` is on screen from the
    first frame.
  - Final tally: **85 PASS, 0 FAIL**, `[smoke] all proofs passed`.
  - The runner the harness leaves running (pid noted in the log, by design —
    "closing DASH leaves agents running") was retired afterward with `node
    scripts/retire-scratch-runners.mjs` against the same `DASH_DATA_DIR`:
    `"status": 202, "outcome": "RETIRED"`.

No capture-harness run and no click-through of the prefill on a real,
visible composer — see "What is NOT done" below.

## Evidence class

**Fixture tests plus one scratch-store smoke run.** The smoke run proves the
one thing #349's evidence class explicitly lacked and the thing that actually
broke: that the fleet route's first paint still shows its heading with this
packet's changes in place, on the real static export, in a real (if scratch)
Electron shell. It does **not** prove the prefill itself lands in the
composer's field and takes focus — the smoke harness's fixtures never press
"Ask the chief about this agent" from an agent page, and no capture harness
was run. That claim rests on:

- `shouldApplyPrefill` and `resolveChiefAskPrefill`, both pure and both
  proven directly, which is as far as a `renderToStaticMarkup` suite can
  reach into an effect no render fires.
- The mechanism being the same shape #349's own tests already exercised for
  `shouldApplyPrefill` and `focusSignal` — only the source of the id changed,
  from a resolved prop to a URL read against the same `agents` list.

The honest next proof, same as #349's own handoff named and still true: a
capture-harness frame of `qa-screenshots-mar-878`'s `no_provider` state,
re-shot with a click through the chief entry, confirming the composer's field
shows `"About AI News Scout: "` and has focus, on the packaged shell rather
than a static render or a smoke fixture.

## What is NOT done

1. No capture-harness proof of the prefill actually appearing and focusing —
   named above and in the smoke run's own scope (the smoke fixtures do not
   drive this particular flow).
2. The URL is never cleaned up after the prefill is applied — `?ask=<id>`
   stays on the address bar. Same deliberate omission #349 named: revisiting
   the same link re-applies the same prefill on a fresh mount, which reads as
   consistent rather than broken.
3. `resolveChiefAskPrefill` re-runs on every `agents` reference change (a
   fresh array from `useMemo` in `app/page.tsx` whenever `display` or
   `favouriteOverrides` change), which the `prefill === appliedPrefill.current`
   guard in the effect makes a no-op for the ordinary case — but it does mean
   a person who opens `/?ask=<agent>`, dismisses the prefill by typing
   something else, and then toggles a favourite (which changes `agents`'
   reference) will not see the prefill return, because `appliedPrefill.current`
   already remembers this exact sentence as applied. That is the same rule
   `shouldApplyPrefill`'s own docblock states — "never overwrites a draft the
   person has edited" — extended correctly to a case #349 never had to
   consider, since its `prefill` prop only changed when the id on the URL did.

## The one thing to do first

Take the capture-harness proof named above: reshoot
`qa-screenshots-mar-878`'s `ask-no-provider` scene, click through the chief
entry, and confirm the composer's field shows `"About AI News Scout: "` and
focus, on the real Electron shell rather than a static render or a scratch
smoke fixture.
