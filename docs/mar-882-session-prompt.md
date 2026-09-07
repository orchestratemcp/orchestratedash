# Lane M — MAR-882: "Ask the chief about this agent" opens a prefilled composer

Tier: Sonnet (a route param, a prefill prop, one link). Read
`ux-lanes-common.md` beside this file first.

Worktree: `C:\Users\henri\AppData\Local\Temp\wt-ux882-s1`
Branch: `000henrik/mar-882-chief-prefill` (from origin/master fab9dce).
Issue: MAR-882 (https://linear.app/martini-home/issue/MAR-882):

> When direct chat is unavailable the agent page offers *Ask the chief about
> this agent* (MAR-878b), but the link goes to `/`, the fleet page, which
> reads no search params, and `Composer` (`app/_components/chief-chat.tsx`)
> has no prefill prop. Add an `?ask=<agent_id>` param on the fleet route
> that pre-fills the composer with "About <agent display name>: " and
> focuses it, and make the agent page's chief entry use it. No change to
> what the chief receives — MAR-878b already carries the capability facts.

## Do

1. `app/_data/routes.ts`: a typed helper `chiefAskHref(agentId)` beside the
   existing href builders; keep raw ids out of anything rendered.
2. `app/page.tsx` (the fleet page, MAR-879 just reshaped it — read it as it
   is on master): read the param with the same mechanism the agent page
   uses for `?agent=`/`?stage=`, resolve the display name from the fleet
   view (never render the id), pass `prefill` to `Composer`.
3. `app/_components/chief-chat.tsx`: a `prefill?: string` prop that sets the
   initial draft once and focuses the textarea; a later prefill for a
   different agent replaces an untouched draft but never a draft the person
   has edited (test both).
4. The agent page's chief entry (`app/_components/ask.tsx` footer / chat
   stage per MAR-878b — read `docs/mar-878b-handoff.md`) links via the new
   helper. Do not touch `lib/views/ask.ts`, `lib/chief/**`, `electron/**`.
5. Tests: `tests/composer-shared.test.tsx` / the chief-chat render test for
   the prefill behaviour; `tests/agent-stage.test.ts` or the routes test for
   the helper; an ask-render test that the chief entry's href carries the
   param. Keep MAR-879's `tests/add-agent-render.test.tsx` and
   `tests/brand-surfaces.test.tsx` green.

Ownership (write): `app/page.tsx`, `app/_components/chief-chat.tsx`,
`app/_components/ask.tsx` (the chief entry link only), `app/_data/routes.ts`,
tests, `docs/mar-882-handoff.md`. Evidence class: fixture tests; the
installed press is the orchestrator's.

Stop condition: PR open (`feat(mar-882): Ask the chief opens a prefilled
composer`), tests green, handoff written. Wait for
`%TEMP%\wt-ux882-s1-install.done` before running node/pnpm.
