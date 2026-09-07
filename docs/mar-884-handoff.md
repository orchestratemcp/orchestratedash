# MAR-884 — the numbered citation row must wrap

Client: Claude Code, `claude --model sonnet`. Worktree
`C:\Users\henri\AppData\Local\Temp\wt-ux884-s1`, branch
`000henrik/mar-884-citation-wrap`, off `origin/master` at `8ce1d47` (PR #335),
merged twice during the session as `origin/master` moved: once to `327b11d`
(PR #336, MAR-879) and once more to `5f434fd` (PR #338, docs/state
checkpoint).

Lane J of the 2026-09-06/07 UX wave. Nothing here touches MAR-875's citation
numbering, `electron/brief-pdf.ts`, or any other lane's fence.

---

## 1. What was wrong, and why it was invisible until now

MAR-875 replaced thirty repeated headlines with a `Written from: [1] [2] …
[30]` line of numbered marks. `.brief-citation { white-space: nowrap; }`
(the MAR-875 fence, `app/globals.css`) was written to keep one mark from
splitting across two lines — reasonable on its own.

But `BriefParagraphBody` (`app/_components/digest.tsx`) does not put the
separating space between two sibling `<span className="brief-citation">`
elements. It puts the space *inside* each mark's own span:

```tsx
{cited.map(({ item, position }, index) => (
  <span className="brief-citation" key={...} title={item.headline}>
    {index === 0 ? null : " "}
    {/* the mark itself */}
  </span>
))}
```

`white-space: nowrap` forbids a line break at *any* character inside the
element it is set on — including that leading space. With the space living
inside the same nowrap span as the mark, there is not one legal break point
left anywhere in the thirty-mark line. It renders as a single unbreakable run
as wide as all thirty marks laid end to end (measured below: 630px), wider
than the stage at ordinary window widths.

Fixture digests everywhere else in this repo carry 3-4 items — short enough
that thirty marks' worth of unbreakable width never crosses the stage's edge,
which is exactly why `electron/capture-cockpit.ts`'s `page_overflows` never
saw it before this session added a fixture with the real shape.

**Confirmed by direct reproduction before writing the fix**, not inferred
from reading the CSS: a static HTML page carrying the same markup pattern and
the repo's actual `tokens.css` + `globals.css`, served over a local HTTP
server and inspected via `getBoundingClientRect()`/`scrollWidth`, reproduced
the exact defect (an ~1067px-wide unbreakable run inside a 460px column) and
confirmed the fix resolves it (the row drops to normal wrapped flow, no
overflow) before touching the shipped code. See "Evidence class" below for
what that reproduction does and does not stand in for.

## 2. The fix

`app/globals.css`, new fence at the very end of the file (previous fences
untouched, `MAR-884` last):

```css
.brief-citation {
  white-space: normal;
}
```

This restores the row's wrap points without touching MAR-875's actual
intent. A mark like `[12]` has no space *inside* it, so `overflow-wrap`'s
default (never break inside a word unless it alone exceeds the container,
which a 4-character mark never does) still keeps every mark on one line. No
`display: flex` or `gap` was added: the existing space character already is
the gap, and turning it into a flex row would print the separator twice (once
as the literal space, once as `gap`).

## 3. What changed, by file

- **`app/globals.css`** — one new fence, `/* ==== MAR-884 begin/end ==== */`,
  appended after MAR-879's (which itself sits after MAR-878's). Fence order
  on disk, oldest to newest: … MAR-878, MAR-879, MAR-884. Nothing earlier was
  edited in place.
- **`electron/capture-cockpit.ts`** — a new, fully isolated scene:
  - `TABLET` viewport constant (768×900), beside the existing `VIEWPORT`
    (1280) and `NARROW` (375).
  - `CITATION_WRAP_AGENT` (`citation-wrap-scout`) and `CITATION_WRAP_BRIEF`
    constants.
  - `seedCitationWrap()` — imports a **separate agent** (not `news-scout`),
    ingests one 30-item digest and one brief whose single paragraph cites
    all 30 positions. Run *after* every other scene in `run()` has already
    executed and been measured, using an agent nothing else in the file ever
    references, so no earlier scene's frame or number can move because of
    it (no shared rail, no shared tile count, no shared digest list).
  - A new step in `run()`, right before the final `layout.json` write: seeds
    the agent, opens its brief on the Output stage, and at both `VIEWPORT`
    (1280) and `TABLET` (768) calls the existing `measure()` **and** a new
    targeted read of `.cockpit-stage .output-card .brief-cited`'s own
    `scrollWidth`/`clientWidth` — added because `measure()`'s
    `widest_overflow` is the worst single element on the *entire* page, and
    on a fixture this rich it can be dominated by something with nothing to
    do with citations (confirmed below: it moved between two runs of
    *identical* citation-row markup, for a reason unrelated to this fix).
    Frames are named `qa-mar884-citation-wrap-{1280,768}.png` so they sort as
    one group rather than interleaving with MAR-646's `agent-output-*` set.
- **`tests/brief-render.test.tsx`** — new `describe("thirty citations in one
  line (MAR-884)")`: a 30-item digest and a brief citing all 30 in one
  paragraph, asserting (a) all thirty marks render as real anchors, each with
  its own `title` and its own `<span class="visually-hidden">` accessible
  name, each pointing at that item's own collected `item_url` — 30 checks in
  a loop, not a sample — and (b) the rendered HTML carries no inline
  `style="...nowrap..."` and no literal `white-space` at all, so a future
  change cannot reintroduce this failure mode one layer below the
  stylesheet, where no CSS override could reach it.
- **`docs/mar-884-handoff.md`** — this file.
- **`qa-screenshots-mar-884/`** — the two 1280px frames, before and after.

## 4. Verified, and how

1. **`pnpm typecheck`** — clean, run three times (after the fix, after each
   of the two `origin/master` merges). Last run: clean.
2. **Focused tests**, PowerShell:
   - `pnpm vitest run tests/brief-render.test.tsx` — 12 passed (the 10
     pre-existing plus 2 new).
   - `pnpm vitest run tests/panel-render.test.tsx` — 37 passed, including
     the 4px-grid gate that slices `globals.css` from the panel comment
     onward (covers the new MAR-884 fence). `white-space: normal` carries no
     length literal, so it cannot trip the grid check either way.
   - `pnpm vitest run tests/brief-render.test.tsx tests/brief-citations.test.ts tests/panel-render.test.tsx tests/outputs-panel.test.ts tests/one-result-per-run.test.tsx tests/density.test.ts` —
     142 passed.
   - `pnpm brand:check` — passed.
3. **Full suite**, PowerShell, `pnpm test`, run twice at different points:
   - **Before either `origin/master` merge:** 277 test files passed, 5269
     tests passed, 13 skipped, 0 failed.
   - **After both merges** (through PR #336 and PR #338), on the exact
     commit this PR ships: 277 test files passed, one
     (`tools/dash-mcp/tests/template-run.test.ts`) failed, 5293/5308 passed.
     Re-ran that one file alone twice more: 2 failed then 4 failed, a
     *different* sub-test each time, always `EPERM, Permission denied` on
     `rmSync(scratch, ...)` in its own `afterEach` — the documented "a
     whole-file failure is rmSync racing a child" flake, not a real
     regression. Confirmed unrelated to this branch three ways: (a) the file
     has zero references to `digest.tsx`, `globals.css`, or
     `capture-cockpit.ts`; (b) its last real change (`cb4dbfd`, MAR-862) long
     predates this branch and MAR-879's; (c) `Get-Process` showed 30
     concurrent `node`/`electron` processes on this machine at the time, from
     other lanes of the same wave, matching the documented "MCP suite is
     flaky under parallel load" note. Every other file in both runs passed
     clean.
4. **Real Electron capture**, twice each, before and after the CSS fix, on a
   scratch store, from PowerShell (never touching Henrik's real
   `%APPDATA%\orchestratedash`):

   ```
   pnpm build:renderer
   pnpm build:shell
   $env:DASH_SHELL_URL='dash-app://ui/'
   $env:DASH_DATA_DIR='<scratch>'
   $env:DASH_CAPTURE_DIR='<scratch>\frames'
   pnpm exec electron dist/electron/capture-cockpit.mjs --user-data-dir='<scratch>\capture'
   ```

   **BEFORE** (`.brief-citation { white-space: nowrap; }`, MAR-875's
   original rule — reproduced by temporarily reverting only that one
   declaration, never by editing history):

   ```
   [cockpit] citation-wrap/1280 (window reports 1279px) row={"found":true,"scroll_width":1260,"client_width":630,"overflow":630,"box_height":51,"mark_count":30} page={"reported_width":1279,"page_overflows":false,"widest_overflow":630,...}
   [cockpit] citation-wrap/768 (window reports 767px) row={"found":true,"scroll_width":1260,"client_width":630,"overflow":630,"box_height":51,"mark_count":30} page={"reported_width":767,"page_overflows":false,"widest_overflow":630,...}
   ```

   **AFTER** (`.brief-citation { white-space: normal; }`, this fix):

   ```
   [cockpit] citation-wrap/1280 (window reports 1279px) row={"found":true,"scroll_width":630,"client_width":630,"overflow":0,"box_height":76.5,"mark_count":30} page={"reported_width":1279,"page_overflows":false,"widest_overflow":629,...}
   [cockpit] citation-wrap/768 (window reports 767px) row={"found":true,"scroll_width":630,"client_width":630,"overflow":0,"box_height":76.5,"mark_count":30} page={"reported_width":767,"page_overflows":false,"widest_overflow":629,...}
   ```

   `citation_row_overflow` (`scroll_width - client_width` of
   `.cockpit-stage .output-card .brief-cited` itself, scoped so no
   same-named element elsewhere on the page could answer) is the number this
   issue turns on: **630px before, 0px after, at both widths**, all 30 marks
   present in both runs (`mark_count: 30`). `box_height` going from 51px
   (roughly two lines' worth of height while still overflowing sideways) to
   76.5px (three full wrapped lines, height alone rising because the content
   is now actually laid out rather than clipped) confirms the row is wrapping
   rather than merely being cut off. The before/after screenshots
   (`qa-screenshots-mar-884/before-1280.png` and `after-1280.png`) show the
   same thing visually: BEFORE, "Written from:" is followed by marks running
   off the card's right edge with a horizontal scrollbar under the card
   (`[1] [2] [3] ... [17] [1`, cut off mid-mark); AFTER, all thirty marks
   `[1]` through `[30]` wrap cleanly across three lines with no scrollbar.

   **`page_overflows` (the harness's pre-existing, document-level check) read
   `false` on BOTH the before and after runs, at both widths.** This is the
   sharpest finding in this handoff: `page_overflows` is *blind* to this
   entire class of defect. The citation row's 630px overflow (confirmed by
   `citation_row_overflow` and by the screenshot's own visible scrollbar) is
   absorbed by a nested `overflow-x: auto` ancestor rather than blowing out
   `document.documentElement` — exactly Henrik's own description ("the whole
   content column gains a horizontal scrollbar" — a nested scroller, not the
   outer window). The harness's own summary line ("0 frame(s) overflowed
   sideways") reported *zero* overflowing frames on the BEFORE run, while the
   screenshot from that exact run shows the defect on screen. Do not trust
   `page_overflows` / the "N frame(s) overflowed sideways" summary alone for
   this class of nested-scroller overflow — this session's targeted
   `citation_row_overflow` measurement and the screenshots are what actually
   catch it.

   `widest_overflow` (the harness's existing "worst single element on the
   whole page" number) moved from 630 (before) to 629 (after) — essentially
   unchanged, despite the citation row's own overflow dropping from 630px to
   0px. This confirms it upfront: `widest_overflow` is a page-wide maximum
   dominated by something else on this fixture-rich page entirely unrelated
   to the citation row (MAR-879's own prose-width change lands on the same
   page, `.visually-hidden`'s documented ~150px self-clip artefact, and
   others), so it is not this fix's evidence and was never meant to be —
   `citation_row_overflow` is the number this session added specifically
   because `widest_overflow` cannot be trusted for this claim.

   Both 1280px frames are at `qa-screenshots-mar-884/before-1280.png` and
   `qa-screenshots-mar-884/after-1280.png`.

   Each scratch runner was retired afterward with
   `node scripts/retire-scratch-runners.mjs` (never a kill); all four runs
   in this session show `"outcome": "RETIRED"` with a matching fingerprint.

## 5. What is NOT done / deliberately out of scope

- The PDF export path (`electron/brief-pdf.ts`) was not touched.
  `BriefPrintSources` prints the full collected list rather than the
  compressed marks, so this specific wrap defect cannot occur there; it was
  not re-verified in this session because the packet explicitly excludes it.
- MAR-875's citation numbering, mark format, and accessible-name strategy are
  unchanged.
- No other lane's fence in `app/globals.css` was edited. Fence order on disk
  after this session's two merges, oldest to newest, ends: `MAR-878`,
  `MAR-879`, `MAR-884` (this one, last).
- The `tools/dash-mcp/tests/template-run.test.ts` flake (§4.3) is
  pre-existing, unrelated to this branch's files, and was not investigated
  further — flagging it rather than fixing it is this lane's own scope
  boundary.

## 6. The one thing the next session should do first

Nothing is blocked. If a future packet touches `.brief-citation` or
`BriefParagraphBody` again, re-check that the separator space still lives
where a `white-space` rule can reach it — this defect's actual root cause
(the space living *inside* the mark's own span rather than between sibling
spans) is still true of the markup; only the CSS's blanket `nowrap` was
removed. A future rule that reaches for `nowrap` on `.brief-citation` again,
for a different reason, reintroduces exactly this failure — the new render
test in `tests/brief-render.test.tsx` (`carries no inline nowrap that a
stylesheet fix could not reach`) only guards the inline-style version of that
mistake, not a future CSS rule doing the same thing again.

## Evidence class

Three different strengths, named honestly:

1. **Fixture render tests** (`tests/brief-render.test.tsx`) —
   `renderToStaticMarkup` strings, no layout at all. They prove the markup
   (30 anchors, correct hrefs, correct accessible names) and prove no inline
   style reintroduces the bug; they cannot and do not prove wrapping, because
   a static-markup string has no computed layout.
2. **A standalone local reproduction**, built before writing the fix: the
   repo's actual `tokens.css` + `globals.css`, served locally and inspected
   with real `getBoundingClientRect()`/`scrollWidth` calls in a real browser
   engine (this session's own browser tool). This is real CSS layout, but
   *not* the packaged app — no Electron, no `dash-app://` routing, no real
   React tree, a hand-written markup approximation of `BriefParagraphBody`'s
   actual JSX shape.
3. **Installed-style shell proof** (§4.4) — the real packaged renderer,
   `dash-app://ui/` routing, a real Electron `BrowserWindow`,
   `capturePage()`, and the actual compiled `app/globals.css`, all on a
   scratch store. This is the strongest evidence in this handoff and the one
   the before/after numbers above come from. It is still not proof against
   Henrik's *installed* build (a packaged, signed artifact) — it is the
   unpackaged dev build run through the same shell code path, which is what
   every other `electron/capture-*.ts` harness in this repo also stands for.
