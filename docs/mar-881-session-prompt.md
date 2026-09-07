# Lane L — MAR-881: the agent page must keep its scroll position across a live poll tick

Tier: Sonnet (one page, one mechanism to find, one fix). Read
`ux-lanes-common.md` beside this file first.

Worktree: `C:\Users\henri\AppData\Local\Temp\wt-ux881-s1`
Branch: `000henrik/mar-881-scroll-reset` (from origin/master fab9dce, which
carries MAR-875/878b/874/885 changes to `app/agents/detail/page.tsx`).
Issue: MAR-881 (https://linear.app/martini-home/issue/MAR-881):

> After pressing *Judge it again* on the Output stage (scrolled down to the
> receipt), the page showed BEING JUDGED at t+3 s, then by t+23 s it had
> scrolled itself back to the top of the stage and stayed there for the
> rest of the two-minute judgement. The live poll drives `useLiveView` on a
> 5-second tick (`app/_data/use-view.ts`), and `OutputsArea`'s
> `onAdjudicated` bumps `setRefreshKey`; find whether the refresh-key bump
> remounts the stage (jumps once) or every tick re-creates the scroll
> container (jumps repeatedly) — the frames could not tell.

## Do

1. Reproduce in a test first: render the output stage with a scrolled
   container, simulate a poll tick / a `refreshKey` bump, and assert the
   scroll container element identity (or `scrollTop`) survives. Read
   `tests/agent-one-home.test.tsx` and `tests/agent-cockpit-render.test.tsx`
   for the existing render harness; a jsdom `scrollTop` assertion is fine.
2. Fix the cause without changing what the poll delivers: if `refreshKey`
   is used as a React `key` on the stage or the scroll container, key only
   the data subtree that must remount; if the container is re-created on
   each tick, stabilise it (same element, new children). No new client
   timers; do not touch `lib/**` or `electron/**`.
3. Keep every existing test green, including MAR-875's
   `tests/one-result-per-run.test.tsx` and the `agent-one-home` greps.

Ownership (write): `app/agents/detail/page.tsx` (the scroll container /
key usage only), `app/_data/use-view.ts` only if the tick itself is the
cause, tests. Nothing else; no `globals.css` change unless a container
style is the cause (then append-only fence `MAR-881`).

Evidence class: fixture test. The installed proof (scroll to the receipt,
press, page stays put for the judgement) is the orchestrator's.

Stop condition: PR open (`fix(mar-881): keep the agent page's scroll
position across a live poll tick`), tests green, `docs/mar-881-handoff.md`
naming which of the two mechanisms it was. Wait for
`%TEMP%\wt-ux881-s1-install.done` before running node/pnpm.
