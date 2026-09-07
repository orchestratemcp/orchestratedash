# Lane J — MAR-884: the numbered citation row must wrap

Tier: Sonnet (one CSS rule, one seed, two tests). Read `ux-lanes-common.md`
beside this file first.

Worktree: `C:\Users\henri\AppData\Local\Temp\wt-ux884-s1`
Branch: `000henrik/mar-884-citation-wrap` (from origin/master, which already
carries MAR-875 #328 and everything after it).
Issue: MAR-884 (https://linear.app/martini-home/issue/MAR-884). Its text:

> MAR-875's numbered citations work — "Written from: [1] [2] … [30]"
> replaces thirty full titles — but the row is laid out on one line: at the
> window's width the row runs past the right edge of the stage and the whole
> content column gains a horizontal scrollbar; scrolling right moves the
> entire briefing, the receipt and the author's panel sideways. Fixture
> digests have 3–4 items, so `electron/capture-cockpit.ts`'s `page_overflows`
> saw nothing. Seen on Henrik's installed build, master b38b28a, Proof
> Scout's Output stage, 2026-09-07 08:55.

## Do

1. Find the citation row in `app/_components/digest.tsx` (`BriefParagraphBody`,
   the element that carries `BRIEF_CITED_LABEL` and the numbered anchors) and
   the rule that keeps it on one line — look in the MAR-875 fenced block at
   the end of `app/globals.css` first (a `display:flex` without `flex-wrap`,
   or `white-space: nowrap`), then in the shared `.brief-*` rules. Fix it by
   APPENDING an override inside a new `/* ==== MAR-884 begin/end ==== */`
   fence at the very end of `app/globals.css` (do not edit the earlier fences
   in place): the row wraps, keeps its gap, keeps reading order. The
   `tests/panel-render.test.tsx` 4px-grid gate slices `globals.css` from the
   panel comment to the end of file — use the grid's units, not raw `rem`.
2. Seed a 30-item digest + a brief citing all 30 in `electron/capture-cockpit.ts`
   (a new scene or an extension of the existing seed behind a `SCENE ===`
   check so other scenes' frames do not change), and make its `layout()`
   witness report `page_overflows` / `widest_overflow` for the output stage
   at 1280 and 768. Run it once from PowerShell on a scratch store
   (`pnpm build:renderer; pnpm build:shell; $env:DASH_SHELL_URL='dash-app://ui/'; $env:DASH_DATA_DIR=<scratch>; $env:DASH_CAPTURE_DIR=<scratch>\frames; pnpm exec electron dist/electron/capture-cockpit.mjs --user-data-dir=<scratch>\capture`)
   before and after the CSS change and paste both witness lines into the
   handoff; put the two 1280 frames under `qa-screenshots-mar-884/`.
   Remember `.visually-hidden` reports a widest_overflow of ~150 by design —
   that is not the defect.
3. Add a render test (in `tests/brief-render.test.tsx` or
   `tests/one-result-per-run.test.tsx`) that a brief citing 30 items renders
   30 anchors with their aria-labels and that no `nowrap` reaches the row's
   markup or inline style. Keep every existing test green.
4. Do not touch `electron/brief-pdf.ts`, the citation numbering, or any
   other lane's fence.

Ownership (write): `app/globals.css` (append-only new fence),
`electron/capture-cockpit.ts`, the test file you extend,
`qa-screenshots-mar-884/`, `docs/mar-884-handoff.md`. Wait for
`%TEMP%\wt-ux884-s1-install.done` before running node/pnpm. After the
capture run, retire its runner with `node scripts/retire-scratch-runners.mjs`
from the worktree (never a kill).

Stop condition: PR open (`fix(mar-884): wrap the numbered citation row`),
typecheck + focused + full tests green, handoff with both witness lines.
