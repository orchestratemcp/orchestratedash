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
pnpm test                            -> Test Files 265 passed | 4 failed (269)
                                        Tests 5081 passed | 7 failed | 13 skipped
```

### The red files are a machine flake, and this is the proof

Every failure in every full run was **`Error: Test timed out in 5000ms`** —
never an assertion — and every one landed in the store/folder group that does
real SQLite and filesystem work in temp directories: `agent-folders`,
`folder-repair-flow`, `store-damage`, `store-sqlite`, `brand-surfaces`. Three
other lane worktrees were installing, building and testing on this machine
throughout.

I did not take that on trust. Checking `origin/master` out **in this same
worktree** and running the same four files, interleaved:

| Run | `origin/master` (2894539) | this branch |
| --- | --- | --- |
| 1 | 1 failed / 78 | 7 failed / 78 |
| 2 | **6 failed / 78** | **0 failed — 78 passed** |

The flake moves with the machine, not with the branch: master failed six of the
same tests in a run where this branch passed all seventy-eight. The
`brand-surfaces` case passes on its own too (`-t "hands the fleet row the
character"` → 1 passed | 17 skipped).

None of these files import anything this packet changed. **Re-run them once on a
quiet machine before merging rather than taking my word**, but do not go hunting
through this diff on their account — the defect is not there.

`tests/client-bundle.test.ts` failed once during development and was **right**:
`app/agents/detail/page.tsx` is a client component and `lib/views/panel.ts`
reaches `node:fs` through `lib/panel-spec.ts`. That is why `panelForRun` lives
in `lib/views/panel-run.ts` with type imports only. It is green now.

### CI ran the installed shell smoke, and proof 6n passed

Both PR checks are green on `610bedd`: `verify` (2m2s) and **`shell-smoke`
(1m52s)** — the real Electron shell against installed-style user data on the
Windows runner.

`85 PASS / 0 FAIL / 0 SKIP` in the raw job log
(`gh api repos/orchestratemcp/orchestratedash/actions/jobs/101577437973/logs`;
`gh run view` truncates it). The rewritten 6n reported exactly the shape this
session predicted from the source, before it had ever been executed:

```
PASS  6n. the workspace draws the panel the sample's manifest declared:
{"heading":"What the scout found","sections":1,
 "labels":["How this agent has been doing"],"table_rows":9,
 "sources_summary":"Sources (9)","sources_open":false,
 "panel_digest_bodies":0,"controls_inside":0,"raw_instants":0}
PASS  6o. nothing inside the author's region is a control or a raw instant:
{"controls_inside":0,"raw_instants":0}
PASS  6p. the agent's own output is on the page a link to it lands on:
{"has_news":true,"news_before_card_receipt":true,
 "has_card_receipt":true,"has_permission_receipt":false}
```

Read what 6n is saying, because it is the packet's claim in one line: on the
installed shell the author's region drew **one** declared section, **zero**
digest bodies, and one **closed** `Sources (9)` disclosure with the nine rows
still behind it. Nine, not thirty, because the sample agent's real Hacker News
run collected nine — the count is DASH's own and it is honest.

`sources_open: false` and `controls_inside: 0` together are ADR 0008 holding
under the new markup: a `<details>` is not a control, and nothing in the region
asks the reader for anything.

## What is NOT done

- **This session started no Electron process and touched no store**, real or
  scratch. The installed-shell evidence above is CI's, on a GitHub Windows
  runner — which is the right place for it, and is *not* the same thing as
  Henrik's own installed build on his own machine.
- **The capture harness was not run**, so there are no before/after frames. Its
  fixtures carry 3–4 items per digest, which is fine for structure and will not
  photograph the thirty-item case Henrik actually saw. This is now the largest
  remaining gap.
- **Nobody has looked at this on screen.** Four DASH defects in a row have had
  no overflow to measure, and this packet changes what the author's region looks
  like more than anything since MAR-646. A closed disclosure where three
  sections used to be is exactly the kind of change a number reports as a
  triumph and an eye reports as "where did my table go".
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

**Look at it.** The smoke question this section originally asked has been
answered by CI — 6n, 6o and 6p all pass on the installed shell — so the largest
remaining gap is that no human and no camera has seen this surface.

Run the capture harness against a scratch store and read
`agent-output-author-panel` and `agent-output-brief-outputs-area`:

```
pnpm build:renderer
pnpm build:shell
$env:DASH_DATA_DIR='<scratch>'
$env:DASH_CAPTURE_DIR='<scratch>\frames'
pnpm exec electron dist/electron/capture-cockpit.mjs --user-data-dir=<scratch>\capture
```

Pass `--user-data-dir` or the run collides with the live app and with the other
lanes, and a stale log fakes success. Its fixtures carry 3–4 items per digest,
so the frames will show the *structure* and not the thirty-item volume.

The specific thing to judge, because a number cannot: the sample agent's panel
now goes from three labelled sections to **one section plus a closed
disclosure**. That is the intended fix and it is also, on a first look, a
surface that lost two headings. If it reads as "where did my table go" rather
than as "the sources are one press away", the answer is "Surprises" #3 — give
the disclosure the first yielding section's label, one component, no view-model
change.

## Evidence class

**Fixture tests, plus installed-shell smoke in CI.**

- *Fixture tests* — `vitest` over in-memory fixtures, and `tsc`. This covers the
  lineage, the collapse, the per-run binding, the citation marks, the print
  path, and the run grouping.
- *Installed-style shell proof* — the `shell-smoke` job on this PR, 85 PASS /
  0 FAIL / 0 SKIP, with proofs 6n/6o/6p asserting the new arrangement on the
  real Electron shell against installed-style user data. This is stronger than
  the "fixture tests only" I expected to be able to claim, and it is what the
  rewritten 6n is worth.
- *Not proven* — **nothing has been photographed and nothing has been seen on
  Henrik's own installed build.** A GitHub Windows runner is not his machine,
  and 6n asserts a DOM shape rather than a legible screen. Promotion past
  `merged` should wait on the capture run above, or on Henrik looking at it.

## Needs orchestrator

1. **A ruling on the deviation in "Surprises" #1** — the list view is withheld
   when the digest itself is the open card. Reversible in one predicate in
   `collectSources`.
2. **A ruling on "Surprises" #3** — whether losing the author's declared labels
   for yielding sections is acceptable, or whether the Sources disclosure should
   wear the first yielding section's label.
3. **The lifecycle call.** `shell-smoke` green on this PR is real installed-style
   evidence and it came from CI rather than from a claim — but it is a DOM
   assertion on a runner, not a look at Henrik's build. My own reading is
   `merged` on evidence, `proven` only after the capture run or Henrik's eyes.
   The orchestrator owns that call.
4. **Linear**: MAR-875 has had nothing posted to it by this session.
5. Coordinate with **UX-2 (MAR-876)** before it changes `agent-kit/scaffold.ts`'s
   declared panel: the scaffold's three sections are what 6n counts, and this
   packet has just changed how many of them survive on the Output stage.
