# Lane N — MAR-883: agent display names, not ids, in the Connections row's button and sentence

Tier: Sonnet (label construction only). Read `ux-lanes-common.md` beside
this file first.

Worktree: `C:\Users\henri\AppData\Local\Temp\wt-ux883-s1`
Branch: `000henrik/mar-883-agent-labels` (from origin/master fab9dce).
Issue: MAR-883 (https://linear.app/martini-home/issue/MAR-883):

> On Settings → Connections the Gmail row's button reads
> `GIVE IT TO MEETING-ASSISTANT` and the consequence sentence names
> `meeting-assistant` — the agent's id, not its display name. MAR-877 (#327)
> added same-name disambiguation for the service list in
> `lib/views/agent-labels.ts`, but these strings are built in
> `lib/connectors.ts` / `lib/fleet/**`. Build them from the display name
> (with `agent-labels.ts`'s disambiguation when two agents share one), keep
> the id behind the developer details, and add the strings to the module's
> `every*Sentence()` enumerator so the plain-language gate sees them.

## Do

1. Find every place the Connections page's per-agent button/consequence
   text is composed (`grep -rn "Give it to" lib app`), and every caller
   that feeds it an id. Thread the display label through (the view layer
   already knows names: see how MAR-877 did it in `lib/views/agent-labels.ts`
   and `app/_components/service-row.tsx`). Where the label is composed in
   `lib/fleet/**` for the fleet card ("Give it to N waiting agents" /
   "Give it to <one>"), use the same label source — do NOT change what the
   share/adopt commands do, only what they say.
2. Buttons render uppercase globally; keep labels short (`Give it to Meeting
   Assistant`), and for two agents with the same name use the
   disambiguated form (`Meeting Assistant — Dash google proof`).
3. Enumerate the new sentences in the module's `every*Sentence()` and make
   sure `expectPlainLanguage` covers them; add render tests for the
   one-agent, two-same-name and many-agents cases
   (`tests/service-row-render.test.tsx`, `tests/fleet-connector-render.test.tsx`,
   `tests/connections-list.test.ts`).

Ownership (write): `lib/connectors.ts`, `lib/connections-list.ts`,
`lib/fleet/**` (label construction only — no behaviour), `lib/views/agent-labels.ts`
(additive), `app/_components/{service-row,fleet-connector}.tsx` (label plumbing
only), tests, `docs/mar-883-handoff.md`. Nothing in `lib/broker/**`.
Evidence class: fixture tests; the installed Connections page is the
orchestrator's.

Stop condition: PR open (`fix(mar-883): Connections names agents, not ids`),
tests green, handoff written. Wait for `%TEMP%\wt-ux883-s1-install.done`
before running node/pnpm.
