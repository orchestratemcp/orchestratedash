# MAR-882 handoff — "Ask the chief about this agent" opens a prefilled composer

Lane M of the 2026-09-06/07 UX wave. Branch `000henrik/mar-882-chief-prefill`,
from `origin/master` `fab9dce`.

## The defect, restated

MAR-878b's fix-it card and header chip say *"Ask the chief about this
agent"* whenever an agent cannot be asked directly, but the link went to `/`
— the fleet page, which read no search params — and `ChiefChat`'s composer
had no prefill prop. Pressing it opened the chief's room empty, with no way
to tell it stayed to do with the agent you just left. MAR-878b's own handoff
named this explicitly under "What is NOT done": *"the chief entry does not
carry the agent into the composer… Needs orchestrator — one small packet on
those two files."* This is that packet.

## What changed

| File | What |
| --- | --- |
| `app/_data/routes.ts` | `CHIEF_ASK_PARAM` ("ask"), `chiefAskHref(agentId)` |
| `lib/copy/chief-chat.ts` | `describeChiefPrefill(agentTitle)` — `"About <title>: "` |
| `app/page.tsx` | wrapped default export in `Suspense` (the `AgentWorkspacePage` precedent); new internal `Fleet()` reads `?ask=`, resolves it against the fleet's own `agents` list to a display name (never the id), passes `chiefPrefill` to `FleetList` |
| `app/_components/fleet-list.tsx` | `chiefPrefill?: string \| null` prop, passed straight through to `ChiefChat` as `prefill` |
| `app/_components/chief-chat.tsx` | `prefill?: string \| null` prop; `shouldApplyPrefill` (pure, exported) decides whether a new prefill overwrites the field; applied via an effect that also opens the room and bumps a new `focusSignal` counter |
| `app/_components/composer.tsx` | `focusSignal?: number` prop (default `0`, so every existing caller is unaffected); an effect focuses the field when it grows |
| `app/_components/ask.tsx` | `capabilityHref`'s `chief`/`ask` arm and `ChiefEntry` both build their link with `chiefAskHref(agent)` instead of a bare `"/"`; `AskThread` reads its own agent id off `useSearchParams()` (`AGENT_WORKSPACE_PARAMS.agent`) since `AgentAskView`'s blocked arm carries no id and this lane does not own `app/agents/detail/page.tsx` (see below) |
| tests | `tests/agent-stage.test.ts` (`chiefAskHref` round-trip + escaping), `tests/chief-chat-copy.test.ts` (`describeChiefPrefill` in the plain-language enumeration, plus a shape test), `tests/chief-chat-render.test.tsx` (`shouldApplyPrefill` pure-function cases, a render smoke test for the new prop), `tests/fleet-view-render.test.tsx` (prop forwarding, no visible effect under a static render), `tests/ask-render.test.tsx` (both chief-entry hrefs carry `?ask=<agent>`; a `next/navigation` mock for the new `useSearchParams` call) |

Commit: see `git log` on this branch, head noted in the PR.

## Why `AskThread` reads the URL instead of taking a prop

The lane's file ownership is explicit: two sibling lanes ran in parallel,
MAR-881 on `app/agents/detail/page.tsx` and MAR-883 on `lib/connectors` +
fleet labels, and this lane's own instruction was *"your only touch on the
agent page is the chief-entry link inside `app/_components/ask.tsx`."*

The fix-it card that needed the link (`AskThread`'s blocked-arm rendering of
`ChiefEntry`) has no agent id available to it: `AgentAskView`'s `can_ask:
false` arm carries `connect: AiKeyFlow | null` (an id only when the reason is
a missing key) but no plain `agent` field — see that type's own header in
`lib/views/types.ts`. Threading one in as a new required prop would have
meant editing the one call site, in `app/agents/detail/page.tsx`, which is
off-limits.

`AskThread` (and everything under it) is only ever mounted inside the agent
workspace route, which already carries `?agent=<id>` on its own address and
already wraps its tree in `Suspense` (`AgentWorkspacePage`). So `AskThread`
reads `AGENT_WORKSPACE_PARAMS.agent` off `useSearchParams()` itself, the same
mechanism the page it lives inside already uses for the identical fact — no
new prop, no edit to a file outside this lane's ownership, no second
`Suspense` boundary needed (the existing one already covers this subtree).
The other `ChiefEntry` call site, inside `AgentChatBar`, already had `agent`
as an explicit prop from its own untouched caller and needed no change to
how it gets the id — only to what it does with it.

`git diff --stat` against `origin/master` confirms `app/agents/detail/page.tsx`
carries zero changes on this branch.

## Two decisions worth recording

**A pure function carries the "untouched draft" rule, because no render test
here can prove it.** Every render test in this repository is
`renderToStaticMarkup`, which fires no effect — the same reason
`visibleChiefTurns` exists beside the Clear button it filters for.
`shouldApplyPrefill(prefill, appliedPrefill, touched)` is the whole of the
rule: apply a new, different, non-null prefill only while the person has not
typed since the room last opened. `touched` becomes `true` the moment the
field's own `onChange` fires (typing, or the arrow-key recall walk) and never
resets, so a half-written question about one agent survives a chief-entry
link to a different one clicked afterwards — exactly the behaviour the lane
asked for and the two extra scenarios `tests/chief-chat-render.test.tsx`
drives directly through the pure function.

**Focus is a signal, not a boolean**, for `scrollSignal`'s own reason already
stated in `composer.tsx`: a plain `focus: true` prop has nothing to flip
itself back to `false` with, so a second identical request could never fire.
`focusSignal` defaults to `0` and is bumped once per applied prefill; every
existing caller of `Composer` (the chief's own collapsed state, `AskComposer`)
passes nothing and is unaffected.

## Verified, and how

Run from PowerShell in `C:\Users\henri\AppData\Local\Temp\wt-ux882-s1`.

- `npx tsc --noEmit -p tsconfig.json` — clean.
- `pnpm brand:check` — `✓ brand:check passed — 12 characters audited …`
- Focused: `npx vitest run tests/agent-stage.test.ts tests/chief-chat-copy.test.ts
  tests/chief-chat-render.test.tsx tests/composer-shared.test.tsx
  tests/ask-render.test.tsx tests/fleet-view-render.test.tsx
  tests/add-agent-render.test.tsx tests/brand-surfaces.test.tsx
  tests/host-sighting-render.test.tsx tests/record-card.test.tsx
  tests/runner-store-notice-render.test.tsx` — `Test Files 11 passed (11)` /
  `Tests 215 passed (215)`.
- `pnpm test` (whole suite): first run —
  `Test Files 1 failed | 277 passed (278)` / `Tests 2 failed | 5312 passed |
  13 skipped (5327)`, both failures an `EPERM` inside `afterEach`'s `rmSync`
  in `tests/path-guard.test.ts` / `tests/task-workspace.test.ts` — the
  documented live-child race, not this packet (`git diff --stat` shows
  neither file touched here). Re-run alone:
  `npx vitest run tests/path-guard.test.ts tests/task-workspace.test.ts` —
  `Test Files 2 passed (2)` / `Tests 61 passed (61)`.
- No installed-build run, no `verify:shell`, no smoke, no capture harness —
  this lane's evidence class is fixture tests only, stated up front in the
  lane file.

## Evidence class

**Fixture tests.** Nothing here is proof on the installed build. Specifically
not proven:

- That the prefill actually lands in a rendered textarea and steals focus on
  a live DASH — `renderToStaticMarkup` cannot exercise an effect, so this is
  proven only at the level `shouldApplyPrefill` and `focusSignal`'s own logic
  can be proven at (pure functions, directly). A scratch-store capture frame
  of `qa-screenshots-mar-878`'s `no_provider` state, re-shot after this
  packet with a click through the chief entry, would be the next honest
  proof — this lane did not build or run a capture harness.
- That the two Electron chief hosts (`electron/chief-host.ts`,
  `electron/chief-discord.ts`) are unaffected — they are, by construction
  (nothing here touches `electron/**` or what a briefing carries), but that
  is an argument from the diff rather than a run.

## What is NOT done

1. No installed-build or capture-harness proof, as stated above and in the
   lane file's own evidence-class line.
2. The URL is never cleaned up after the prefill is applied — `?ask=<id>`
   stays on the address bar. Not asked for by the issue or the lane file, and
   revisiting the same link (say, via back button) re-applies the same
   prefill on a fresh mount, which reads as consistent rather than broken.
   Named here only because a future session touching this area should know
   it was a deliberate omission, not an oversight.

## The one thing to do first

Take the capture-harness proof this lane's evidence class explicitly does not
have: reshoot `qa-screenshots-mar-878`'s `ask-no-provider` scene, click
through the chief entry, and confirm the composer's field shows
`"About AI News Scout: "` and focus, on the real Electron shell rather than a
static render.
