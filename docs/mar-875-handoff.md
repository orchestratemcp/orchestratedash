# MAR-875 handoff — one result per run (UX-1)

Branch `000henrik/mar-875-one-result-per-run`, PR
[#328](https://github.com/orchestratemcp/orchestratedash/pull/328), based on
`origin/master` and merged forward to `2894539` before pushing.

Lane A of the 2026-09-06 UX wave. This session implemented, tested and opened
the PR; it merged nothing, touched no store, ran no Electron, and posted
nothing to Linear.

## What changed

Implementation commit `9f55d1f`, with a merge of `origin/master` on top.

### The defect, restated from the code

`app/agents/detail/page.tsx` handed the author's panel a set of **one** artifact
id — the card the Output stage had drawn — and `app/_components/panel.tsx`
yielded the body for exactly that one. Both were right, and on Proof Scout the
stage's card is a **brief**: its rows belong to the *digest it was written from*,
a different artifact with a different id. So the run's collected list was on the
screen (under every paragraph, as a full headline per citation) and the panel
could not tell, drawing it again as `report(digest)` and a third time as a
thirty-row `table`.

The orchestrator's mechanism note was accurate in every particular. Two of the
things it named were confirmed and fixed; one was confirmed and deliberately
left alone (below).

### Files

| File | What it now does |
| --- | --- |
| `lib/views/artifacts.ts` | `resolveDrawnLineage` — the selected artifact **and** its `derived_from` parent, as a `Map<id, "body" \| "source">`. `groupCardsByRun` + `ArtifactRunGroup` — a run's cards kept together, with `from` (the group's index in the flat list) so callers keep their position rules. |
| `lib/views/panel.ts` | `PanelTableView.source_artifact_id`; `PanelView.declared.by_run`; `sectionsByRun`. |
| `lib/views/panel-run.ts` *(new)* | `panelForRun`. Its own module for a bundle reason — see "Surprises". |
| `app/_components/panel.tsx` | `PanelSections` (the collapse), `sectionYields`, `collectSources`, `SourcesDisclosure`. `alreadyShown` is a map now. |
| `app/_components/digest.tsx` | `BriefParagraphBody` cites by mark; `BriefBody` gains `print`; `BriefPrintSources`. |
| `app/_components/agent-rail.tsx`, `app/_components/output-history.tsx` | Grouped by run, dated once per day. |
| `app/agents/detail/page.tsx` | `drawnOutputs = resolveDrawnLineage(openCard)`; `openPanel = panelForRun(...)`; the older-run sentence. |
| `lib/copy/panel.ts` | `PANEL_SOURCES_COPY` (summary / meaning / list / table). |
| `lib/copy/brief.ts` | `briefCitationMark`, `BRIEF_PRINT_SOURCES_HEADING`. |
| `lib/copy/agent-page.ts` | `AGENT_OUTPUTS_COPY.older_run`. |
| `lib/brief/citations.ts` | `citedEntries` (position + item); `citedItems` re-expressed over it. |
| `electron/brief-pdf.ts` | Passes `print: true`. |
| `electron/smoke.ts` | Proof 6n rewritten to the new arrangement. |
| `electron/capture-cockpit.ts` | `panel_bodies` re-aimed; `panel_sources`, `panel_sources_open` added. |
| `app/globals.css` | One appended block, fenced `/* ==== MAR-875 begin/end ==== */`. Tokens only; nothing restyled in place. |

Tests: `tests/one-result-per-run.test.tsx` (new, 32 cases) plus updates to
`agent-one-home`, `brief-render`, `brief-print`, `brief-citations`,
`panel-view` and `panel-empty-disclosure`.

## What was verified, and how

Run from **PowerShell** in the worktree.

```
pnpm typecheck                       -> clean (no output)
pnpm brand:check                     -> 12 characters, 96 frames, 4 fonts verified
pnpm vitest run tests/one-result-per-run.test.tsx
                                     -> Test Files 1 passed | Tests 32 passed
pnpm test                            -> Test Files 266 passed | 1 failed (267)
                                        Tests 5069 passed | 1 failed | 13 skipped
```

The one red file is `tests/store-damage.test.ts` — *"carries the damage as a
recovery, beside the agents that survived"*, **`Error: Test timed out in
5000ms`**, not an assertion. Re-run alone it passes:

```
pnpm vitest run tests/store-damage.test.ts
                                     -> Test Files 1 passed | Tests 28 passed
```

It is the known flake under parallel-lane load — three other worktrees were
building and testing on this machine throughout — and it touches none of this
packet's files. **Re-run it once before merging rather than taking my word.**

`tests/client-bundle.test.ts` failed once during development and was **right**:
`app/agents/detail/page.tsx` is a client component and `lib/views/panel.ts`
reaches `node:fs` through `lib/panel-spec.ts`. That is why `panelForRun` lives
in `lib/views/panel-run.ts` with type imports only. It is green now.

## What is NOT done

- **No runtime proof of any kind.** No `pnpm verify`, no `verify:shell`, no
  `pnpm shell`; no Electron process was started by this session, and no store —
  real or scratch — was read or written.
- **Proof 6n was rewritten by reasoning, not by running.** See "the one thing to
  do first".
- **The capture harness was not run**, so there are no before/after frames. Its
  fixtures carry 3–4 items per digest, which is fine for structure and will not
  photograph the thirty-row case Henrik actually saw.
- **`app/_components/outputs.tsx` is unchanged.** DASH's own card was
  deliberately not touched: MAR-668's ruling is that the surface which yields is
  the author's, never DASH's, and deleting DASH's record to resolve a
  duplication takes away the half a person needs in order to check what they are
  reading. Provenance, Save a copy, Save as PDF, Ask GenLayer, the developer
  disclosure and "Open the full run" are all still there, asserted in
  `one-result-per-run.test.tsx` → *"keeps DASH's own card whole"*.
- **No ADR, no migration, no manifest schema change, no contract change.**
  `Sources` is a rendering of existing `report`/`table` sections.

## Surprises and contradictions

**1. The brief's literal "collapse into one Sources disclosure" is wrong in one
case, and the fix needed a richer signal.** When the reader opens the **digest
itself**, its rows are already on the stage in full — a "read them as a list"
behind a disclosure two hundred pixels below would be this packet's own
complaint wearing the shape of its fix. So `alreadyShown` became a
`Map<id, "body" | "source">` rather than a `Set`: the list view is offered only
for a digest the stage's card was *written from*, while the author's **table** is
offered either way, because a grid read across is a reading a flat list cannot
give. A deviation from the lane brief's wording; I believe it is what the brief
meant.

**2. `by_run` narrowing had to stop at `outputs` sections.** Narrowing everything
per run made "Everything it produced" produce one run's worth, which answers a
question nobody asked — and it would have broken the capture harness's
`deep-dive-panel` scene, which opens `brief-scout-0` and expects
`digest-scout-1`'s deep dive to be reachable in the panel. Every *singular*
binding (`report`, `table`, `artifact_field` metrics) narrows; `outputs` stays
agent-wide. Recorded in `sectionsByRun`'s own comment.

**3. The lane's "empty already-shown sections do not render" costs the author
their labels.** On the scaffolded sample agent, two of three declared sections
bind the digest the stage draws, so the region goes from three labels to one plus
a disclosure. That is the intended outcome, but it is a visible reduction of the
author's declared layout and 6n had to be rewritten around it. If Henrik wants
the labels back, the smallest change is to render a labelled `<article>` around
the Sources disclosure carrying the first yielding section's label — one
component, no view-model change.

**4. `PANEL_ALREADY_SHOWN` is now reachable in exactly one situation** — a mixed
`outputs` list. It is still pinned by `agent-one-home.test.tsx` and by the new
file, so it cannot rot silently, but it is a far narrower constant than it was.

**5. `lib/views/types.ts` was NOT edited**, though `panel: PanelView` is declared
there. Putting `by_run` inside the `PanelView` union in `lib/views/panel.ts`
(which this lane owns) meant `types.ts` needed no change at all, so design point
3 landed inside lane ownership. Nothing is owed here; noting it because the lane
brief anticipated a `panel_by_run` field on the workspace view, and that is not
the shape that shipped.

**6. Some files now carry LF where the tree is CRLF** (`app/globals.css`'s
appended block, and four files round-tripped through a script). `core.autocrlf`
is `true`, so the committed bytes are LF either way and `git diff --stat` shows
only real changes. Harmless, but it is why `git` prints CRLF warnings on this
branch.

## The one thing the next session should do first

**Run the installed shell smoke and read proof 6n.** It is the only assertion in
this packet whose new form has never been executed, and it is the one that gates
`pnpm verify` on Windows. From PowerShell, with DASH's own store untouched:

```
pnpm build:renderer
pnpm build:shell
$env:DASH_SHELL_URL='dash-app://ui/'
pnpm exec electron dist/electron/smoke.mjs --user-data-dir=<scratch>\orchestratedash > <scratch>\smoke.log 2>&1
```

The basename must be `orchestratedash`; 85 PASS / 0 FAIL is the bar, and fewer
than 85 lines means it died rather than failed.

What 6n now expects on `?stage=output`, and the reasoning to check it against:
the scaffold declares `report(digest)`, `metrics`, `table(digest)`; the stage's
open card is the newest digest; `report` and `table` both bind it, so both yield
and one `Sources (n)` disclosure replaces them. Therefore `sections === 1`,
`labels === ["How this agent has been doing"]`, `sources_summary` starts with
`"Sources ("`, `sources_open === false`, `table_rows > 0` (the rows are in the
DOM inside a closed `<details>`), and `panel_digest_bodies === 0`. 6o is
unaffected — `<summary>` is not in its `button, input, select, textarea` query —
and 6p is unaffected, and slightly safer, because the panel no longer draws a
`.digest-items` list at all.

**If 6n fails, do not delete it.** The likely failure is the wait condition
(`sections === 1 && sources_summary !== null`) timing out because the sample's
newest artifact is not what I assumed; the `panel` object is printed on failure
and will say which.

Second, before or after: run the capture harness against a scratch store and
look at `agent-output-author-panel` and `agent-output-brief-outputs-area`. Four
DASH defects in a row have had no overflow to measure, and this packet changes
what the author's region looks like more than anything since MAR-646.

## Evidence class

**Fixture tests only.** Everything above was proven by `vitest` against
in-memory fixtures and by `tsc`. Nothing in this packet has been observed in the
packaged renderer, in the installed shell, or against any store. The smoke and
capture-harness edits are *reasoned* changes to proof code that has not been
executed since they were made. No claim in this handoff should be promoted past
`merged` on the strength of it.

## Needs orchestrator

1. **A ruling on the deviation in "Surprises" #1** — the list view is withheld
   when the digest itself is the open card. Reversible in one predicate in
   `collectSources`.
2. **A ruling on "Surprises" #3** — whether losing the author's declared labels
   for yielding sections is acceptable, or whether the Sources disclosure should
   wear the first yielding section's label.
3. **Installed proof of 6n**, and the lifecycle promotion that depends on it.
   This session's evidence does not reach `proven`.
4. **Linear**: MAR-875 has had nothing posted to it by this session.
5. Coordinate with **UX-2 (MAR-876)** before it changes `agent-kit/scaffold.ts`'s
   declared panel: the scaffold's three sections are what 6n counts, and this
   packet has just changed how many of them survive on the Output stage.
