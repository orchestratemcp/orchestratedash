# Lane A — MAR-875: one result per run (UX-1)

Tier: Opus (cross-cutting rendering change across two renderers and the view
layer, with judgment calls on what "one place" means). Read
`ux-lanes-common.md` beside this file first.

Worktree: `C:\Users\henri\AppData\Local\Temp\wt-ux875-s1`
Branch: `000henrik/mar-875-one-result-per-run` (from origin/master 0e52211)
Issue: MAR-875 "DASH — one result per run: remove repeated briefing sources and tables"
(https://linear.app/martini-home/issue/MAR-875)

## The defect, as seen on the installed build tonight (orchestrator, 2026-09-06 20:23)

Proof Scout (`proof-scout-mar861`, a plugin-scaffolded agent) on
`?stage=output` with its brief open shows the same 30 Hacker News headlines
three times: (1) under every paragraph as "Written from: <full title> · <full
title> · …" (30 full-title links in one paragraph), (2) as the author panel's
`report(digest)` list ("The latest digest"), and (3) as the author panel's
`table` ("Every headline in the latest digest", 30 rows). The GenLayer receipt
sits between the citations and the author panel and is correct.

Mechanism (mapped by the orchestrator; verify before you change it):
- `app/agents/detail/page.tsx:839-850` — `openOutput` from `?output=`,
  `resolveOpenCard(view.outputs, openOutput)` (falls back to newest),
  `drawnOutputs = new Set([openCard.reference.artifact_id])` → `<AgentPanel alreadyShown=…>` at :1121.
- `app/_components/panel.tsx:178-201` `SectionBody`: only `report` and
  `outputs` honour `alreadyShown` (via `PanelArtifactCard`, `:396-535`,
  `elsewhere` at :414 → `PANEL_ALREADY_SHOWN` pointer); `table`, `metrics`,
  `note` never do. A 30-item digest renders 30 table rows (`PANEL_ROW_CAP=200`).
- The suppressed id is the brief's; the brief's *source digest* (its
  `derived_from.artifact_id`) is a different artifact, so `report(digest)`
  draws in full.
- `app/_components/digest.tsx:994-1036` `BriefParagraphBody` prints every cited
  item's full headline after `BRIEF_CITED_LABEL` ("Written from").
- History mixing: `lib/views/build.ts:1978-1984` builds `view.panel` from a
  second `artifactRecordsForAgent(agent)` call bound `newestOfRole`
  (`lib/views/panel.ts:525-530`), so selecting an older output in the rail
  changes only `alreadyShown` while the author panel keeps describing the
  newest run.
- Cards: `lib/views/build.ts:1738-1752` → flat, agent-wide, newest-first, cap 20;
  `reference.run_id` per card; no run grouping anywhere.
- Rail: `app/_components/agent-rail.tsx:60-157` links to `?stage=output&output=<artifact_id>`.

## Design (orchestrator defaults; reversible; record deviations in the handoff)

1. **One Results briefing per selected run.** On the output stage the selected
   card is drawn once, in full, by DASH's card (`outputs.tsx`). Everything the
   author panel would draw of the *same run* that is already on screen — the
   selected artifact AND the artifact it was derived from (`derived_from.artifact_id`
   for briefs) — collapses into one **Sources (N)** disclosure, closed by
   default, offering **List** and **Table** as two views of the same rows
   (List = the digest items as today's `DigestBody` list; Table = today's
   `TableSection`). Extend `alreadyShown` from "one id" to "the selected
   artifact and its source lineage" — a small pure helper in `lib/views/artifacts.ts`
   (or a new `lib/views/lineage.ts`) with its own test.
2. **Compact accessible citations.** `BriefParagraphBody` renders numbered
   citation links (`[1]`, `[2]`, …, one `<a>` per cited item, `href=item_url`
   when known, `aria-label`/`title` = the headline) instead of 30 full titles;
   the numbering is the item's index within the run's Sources so the same
   number means the same source everywhere. Items with no URL render as a
   non-link `<span>` with the same aria-label. Keep `BRIEF_CITED_LABEL` semantics
   (and the uncited label) intact. Keyboard: all links are real anchors,
   focus order follows reading order. The PDF renderer (`electron/brief-pdf.ts`
   → `BriefBody`) must still print something readable: for print, render the
   full headline list under a "Sources" heading once at the end rather than
   numbers only (guard by a `print` prop or the existing static-markup path;
   do not break `tests/brief-print.test.ts`).
3. **No mixing across runs.** Build the author panel per run: add
   `panel_by_run: Record<run_id, PanelView>` (or equivalent) in
   `lib/views/build.ts` computed only for runs that have cards (≤20 cards, cheap),
   keep `view.panel` as the newest for existing consumers, and have the output
   stage pick `panel_by_run[openCard.reference.run_id] ?? view.panel`. When the
   selected run is not the newest, the stage says so in one sentence above the
   panel (a copy-module sentence, enumerated for the plain-language gate).
4. **Group artifacts by run** in the rail/history: `OutputHistory`/`AgentRail`
   group entries by `run_id` with the run's day as the group label; within a
   group the existing order. Empty already-shown sections do not render (a
   section whose every artifact is elsewhere renders nothing, not a pointer).
5. **Keep** the GenLayer verdict + reasons beside the result (`AdjudicationReceipt`
   position unchanged; technical rows stay in its `<details>`), provenance
   `Receipt`, export/download/PDF, `open_run` link, developer `<details>`,
   `grounding={null}` at both digest call sites, ADR 0008 (no controls of any
   kind inside `.agent-panel` — a `<details>/<summary>` is allowed, a `<button>`
   is not; the List/Table switch therefore must be two `<details>` or an
   anchor-based toggle, NOT a button, inside the panel).

## Ownership (write)

`app/agents/detail/page.tsx` (whole file — you are the only lane on it),
`app/_components/{panel,outputs,digest,output-history,agent-rail}.tsx`,
`lib/views/{panel,artifacts,build}.ts` (build.ts: only the panel/cards region),
`lib/copy/{panel,brief,agent-page}.ts` (agent-page: only `AGENT_OUTPUTS_COPY`),
`lib/brief/citations.ts`, `electron/brief-pdf.ts`, `electron/smoke.ts`
(proofs 6n/6o/6p only), `electron/capture-cockpit.ts`, and every test that
pins these: `tests/agent-one-home.test.tsx`, `tests/agent-cockpit-render.test.tsx`,
`tests/agent-feed-render.test.tsx`, `tests/panel-render.test.tsx`,
`tests/panel-view.test.ts`, `tests/outputs-render.test.tsx`,
`tests/outputs-panel.test.ts`, `tests/brief-render.test.tsx`,
`tests/brief-print.test.ts`, `tests/brief-citations.test.ts`,
`tests/curated-digest.test.tsx`, `tests/panel-empty-disclosure.test.tsx`,
plus new tests. `app/globals.css`: append-only block per the common rules.

Read-only: everything else. In particular do NOT touch `app/_components/agent-settings.tsx`,
`model-choice.tsx`, `deploy.tsx`, `lib/views/ask.ts`, `lib/panel-spec.ts`,
`contracts/**` (no new panel section type — Sources is a rendering of existing
`report`/`table` sections, not a manifest vocabulary change).

## Traps the tests already encode (read them before editing)

- `tests/agent-one-home.test.tsx` greps `page.tsx` source for literals
  (`alreadyShown={drawnOutputs}`, `resolveOpenCard(view.outputs, openOutput)`,
  stage record slices `"\n    output: ("`). Update the greps to the new
  invariant; keep the invariant (one OutputsArea, one panel, one body).
- `PANEL_ALREADY_SHOWN` names "Generated assets" verbatim; `AGENT_OUTPUTS_COPY.heading`
  is pinned in several render tests.
- `tests/panel-render.test.tsx`: byte-identical panel markup across
  theme×density; no `<button>` etc. inside the panel; every href must be one of
  the digest's own source URLs; no raw instants.
- `electron/smoke.ts` 6n pins the scaffold's three section labels and
  `table_rows > 0` on the *run detail* / agent page; 6p pins `.cockpit-stage .digest-items li`
  before `.output-receipt` on the landing stage. If your change alters what 6n/6p
  can see, update those proofs to assert the new truth (one Sources disclosure,
  rows present inside it) — never delete a proof. You may run the smoke locally
  from PowerShell against a scratch store ONLY as
  `pnpm build:renderer; pnpm build:shell; $env:DASH_SHELL_URL='dash-app://ui/'; pnpm exec electron dist/electron/smoke.mjs --user-data-dir=<scratch>\orchestratedash > <scratch>\smoke.log 2>&1`
  (the basename must be `orchestratedash`; redirect output to a file; it takes
  ~2 min; 85 PASS / 0 FAIL is the bar; fewer than 85 lines means it died).
- `electron/capture-cockpit.ts` measures `.agent-panel .digest-items` (`panel_bodies`)
  and asserts a `"Written up"` section has a non-elsewhere card at
  `&stage=output&output=digest-scout-0`. Update its counters/witness to the new
  structure. To photograph before/after yourself (optional but valuable):
  build both halves in your worktree, then run it from PowerShell with
  `$env:DASH_DATA_DIR=<scratch>`, `$env:DASH_CAPTURE_DIR=<scratch>\frames` and
  `--user-data-dir=<scratch>\capture` so it cannot collide with the live app or
  other lanes. Its fixtures have 3–4 items per digest; that is fine for
  structure, and say so in the handoff.

## Acceptance (from the issue; the orchestrator proves the installed part)

Each representation has one deliberate place; exercise empty, single-result,
multi-run, rejected and pending-verdict states in tests; keyboard-accessible
citations and Sources view; history selection never mixes runs; no loss of
provenance, export or full-run access. Focused behaviour tests target run
selection and de-duplication, not wording snapshots.

Stop condition: PR open with the design above implemented, typecheck clean,
focused + full tests green, handoff written (`docs/mar-875-handoff.md`).
