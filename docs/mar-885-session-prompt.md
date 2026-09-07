# Lane K — MAR-885: agent Settings — model row in every state, and two copy residuals

Tier: Sonnet (three bounded fixes on a page that just landed; decided
design). Read `ux-lanes-common.md` beside this file first.

Worktree: `C:\Users\henri\AppData\Local\Temp\wt-ux885-s1`
Branch: `000henrik/mar-885-settings-model-row` (from origin/master, which
carries MAR-874 #332, MAR-878 #329, MAR-879 #336, MAR-884 #339).
Issue: MAR-885 (https://linear.app/martini-home/issue/MAR-885). Its text, in
short (seen on the installed build 2026-09-07 11:36, Proof Scout → Settings):

1. **No "Which model it talks with" row** renders for an agent that declares
   no model connection (`proof-scout-mar861`). MAR-874 intended four states;
   `ModelChoice` renders nothing for the `no_model_needed` arm. Render the
   row in every state. For this one: the existing honest `describeNoChoice`
   sentence (do NOT add "built without a model" — MAR-874's test blocks that
   claim because the manifest cannot distinguish the cases) plus the one
   action that exists: a link to Add agent's *Build with an assistant* path
   (`/settings/add-agent?path=assistant`, MAR-879) with a short label such as
   "Build one that can". Read `docs/mar-874-handoff.md` first for the state
   table and the test that guards the sentence.
2. The *Every day at a set time* radio description still says "DASH starts it
   for you, on this computer, at the time you pick." while the state line
   correctly says "on <server>" by residency. Make the description follow the
   same residency predicate (`AGENT_TRIGGER_COPY` in `lib/copy/agent-page.ts`;
   see how MAR-874 did the liveness sentences) and pin it.
3. *Scheduled runs* shows the raw instant `2026-09-05T18:20:00.000Z` beside
   the DID NOT START chip. Render it with `lib/copy/when.ts`'s plain moment;
   because the schedule lives on the host, say the host's clock rather than
   converting (MAR-872 owns conversion — do not attempt it). Enumerate the
   sentence so the plain-language gate sees it.

## Ownership (write)

`app/_components/{model-choice,agent-settings}.tsx`, `lib/views/models.ts`,
`lib/views/agent-schedule.ts`, `lib/copy/agent-page.ts`, the schedule-row
renderer wherever it lives (find it from `agent-settings.tsx`), and tests:
`tests/model-render.test.tsx`, `tests/model-choice.test.ts`,
`tests/copy-agent-page.test.ts`, `tests/schedule-view.test.ts`,
`tests/agent-settings-shape.test.tsx`, plus new. `app/globals.css`:
append-only fence if needed. NOT: `lib/views/ask.ts`, `lib/fleet/**`,
`lib/ai/**`, `app/agents/detail/page.tsx` (unless a one-line prop is
unavoidable — say so), the adoption command.

## Verification

Typecheck; focused tests; one full `pnpm test` from PowerShell (clear
`%TEMP%\dash-mcp-run-*` first if `template-run.test.ts` flakes). Optional:
extend `electron/capture-cockpit.ts`'s settings scene for the no-model
state and shoot one 1280 frame on a scratch store. Evidence class: fixture
tests (+ a frame). The installed look is the orchestrator's.

Stop condition: PR open (`fix(mar-885): model row in every Settings state;
residency and plain-moment copy`), tests green, `docs/mar-885-handoff.md`.
Wait for `%TEMP%\wt-ux885-s1-install.done` before running node/pnpm.
