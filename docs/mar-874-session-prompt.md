# Lane G — MAR-874: the agent Settings page — one state, one action per section, and explicit model adoption

Tier: Opus (a page that will be on camera; a real contradiction to diagnose;
the ADR 0013 adoption press moves onto the agent's own page). Read
`ux-lanes-common.md` beside this file first.

Worktree: `C:\Users\henri\AppData\Local\Temp\wt-ux874-s1`
Branch: `000henrik/mar-874-agent-settings` — **stacked on lane A's branch**
`000henrik/mar-875-one-result-per-run` (its PR head; lane A owns
`app/agents/detail/page.tsx`'s output stage and the renderers). Your PR
targets `master`. If lane A's PR merges first, `git merge origin/master`.
Issue: MAR-874 (https://linear.app/martini-home/issue/MAR-874). Henrik's
verbatim complaint, the three-screenshot inventory (seven sections, ~40
sentences), the three defects and his proposed shape are on the issue; the
UX plan's UX-3 keeps this issue as INDIVIDUAL-agent Settings with its
original acceptance. Global Settings is MAR-877 (another lane, disjoint).

## Henrik's proposed shape (adopted)

Rule: each section shows its current state in one sentence and offers one
action; every explanation moves behind a "Why?" disclosure, closed by
default. Nothing is deleted from the copy modules; it stops rendering by
default. Order:
1. **Name and character** — one row: avatar, name, *Rename*, *Change*.
2. **Where it runs** — one line (*This computer* / *<server name>*) with one
   switch-shaped action (*Put on <server>* / *Bring home*); the "before you
   put" bullets and the amber box behind *Why?*; the "servers you have sent
   this to" card collapses into the state line.
3. **When it runs** — one line (*On command* / *Every day at 18:20*), the
   time field inline when scheduled, one *Save*; open/closed/asleep block,
   spending line, model checkbox and the author's-trigger note behind
   *Why?*. *Scheduled runs* stays, one row, neutral colour unless the person
   can act on it (the red DID NOT START chip is MAR-864's gap, not their
   fault — neutral, sentence unchanged).
4. **Which model it talks with** — NEW. See below.
5. **Advanced** — collapsed: notifications link, show folder, check for
   changes, repair (only when the gap is real).
6. **Remove** — collapsed, at the bottom, both buttons.
Target: fits one screen at 1280 with every disclosure closed.

## The model section (the part MAR-873/MAR-878 depend on)

Facts (orchestrator-verified): `lib/views/models.ts:74 buildAgentModelSettings`
returns `noChoice("no_model_needed")` when the manifest declares no model
connection and the plan needs none, and `noChoice("no_provider_key")` when
no key is held; `app/_components/model-choice.tsx` renders it. Adoption of
the fleet credential for one agent already exists as a DASH-owned action:
`lib/connection-actions.ts:462-467` calls `adoptFleetCredential`
(`lib/fleet/actions.ts:1136`) when a person presses Connect on the agent's
own `model_provider` row and a fleet connection for that provider exists
(ADR 0013 moment 2); the fleet card's "Give it to N waiting agents" is
moment 3 (`app/_components/fleet-connector.tsx:336-354`). PR #320 (lane B)
makes every plugin-built agent declare `model_provider`, so after it merges
there will be agents in the "declared, no key held, fleet key exists" state.

Design: one row with four states, decided by `buildAgentModelSettings`
(extend the view, keep the vocabulary closed and tested):
- **Talks with your default** — `Using your default, <model>` + *Change*
  (opens today's picker: own pin vs default).
- **Waiting for your key** — the agent declares `model_provider`, holds no
  key, and a fleet connection for that provider exists: sentence
  `Give it your <provider> key so you can ask it questions` + ONE button
  *Use my key* that calls the existing agent-row connect action (which
  adopts, asks for nothing, contacts no provider). After the press the row
  becomes the first state without a reload.
- **Needs a provider** — declares, no key, no fleet connection: sentence +
  link to Settings → AI. No button.
- **Cannot talk** — declares no model connection at all: one honest
  sentence (`This agent was built without a model, so it cannot answer
  questions. Rebuild it with the assistant to add one.`), no action.
Never read a fleet credential directly, never reorder the `no_provider`
gate in `lib/views/ask.ts`, never widen `resolveKeyGrant`.

## The contradiction to diagnose first

Header says READY / LIVES ON Cloud while Settings says "This agent will not
run" with *Repair*: `ManifestGapNotice` (`page.tsx`, `lib/sample-refresh.ts:111
describeManifestGap`) vs the header's readiness. Find which is true for a
deployed agent (proof-scout-mar861 on the VPS is the live case; reproduce
with a fixture), fix the stale predicate, and put the answer in the handoff
with the fixture that pins it. Also fix `AGENT_TRIGGER_COPY.liveness`
sentence three (flagged conditionally wrong for an enrolled host) while
moving it — say "on <server>, by that server's clock" when the agent lives
on a host (MAR-872's timezone conversion is NOT yours; only stop naming the
wrong machine).

## Ownership (write)

`app/_components/{agent-settings,model-choice,deploy,folder-update,repair-agent,remove-agent}.tsx`,
the `settings:` entry of the stages record in `app/agents/detail/page.tsx`
and its page-local helpers (NOTHING else in that file — lane A and lane H
have the other stages), `lib/views/models.ts`, `lib/views/agent-schedule.ts`,
`lib/copy/agent-page.ts` (`AGENT_SETTINGS_COPY`, `AGENT_TRIGGER_COPY`,
`AGENT_CONTROL_COPY` only), `lib/copy/repair.ts`, `lib/sample-refresh.ts`
(the gap predicate only), `lib/connection-actions.ts` only if the agent-row
connect path needs a thin exported entry for the new button (prefer reusing
the existing command), and tests: `tests/copy-agent-page.test.ts`,
`tests/model-render.test.tsx`, `tests/model-choice.test.ts`,
`tests/schedule-view.test.ts`, `tests/schedule-allowance.test.ts`,
`tests/repair-render.test.tsx`, `tests/folder-repair.test.ts`,
`tests/deploy-render.test.tsx`, `tests/standing-answers.test.ts`,
`tests/sample-refresh.test.ts`, plus new render tests for the four model
states and the one-screen budget (count of rendered sentences with
disclosures closed). `app/globals.css`: append-only block.

## Verification / evidence

Typecheck, focused tests, `pnpm test` once. Frames: `electron/capture-cockpit.ts`
shoots the settings stage from a scratch store; extend a scene for a deployed
+ scheduled agent and the four model states, run it from PowerShell with
scratch `DASH_DATA_DIR`, `DASH_CAPTURE_DIR`, `--user-data-dir`. Evidence
class: fixture tests + scratch frames at 1280. The attended proof (a person
who has never seen DASH says where it runs, when, and on which model without
opening a disclosure) and the real-question proof are the orchestrator's /
Henrik's.

Stop condition: PR open (`feat(mar-874): agent Settings — one state, one
action per section; explicit model adoption`), tests green,
`docs/mar-874-handoff.md` written with the READY/"will not run" answer.
