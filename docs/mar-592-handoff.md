# MAR-592 handoff — Settings, and the sidebar that stopped being a list of everything

**Branch:** `000henrik/mar-592-settings-tabs`, cut from `origin/master` at
`be90d84` (PR #121, the MAR-545 chat work, is in the base).
**Worktree:** `C:\Users\henri\Desktop\projekt\MCP\dash-mar592`
**Targets:** `master`.

---

## What changed, in one paragraph

The sidebar had seven destinations; it has four. Connections, Notifications,
Servers and Add agent are now four tabs on one Settings page, at four real
routes. Nothing inside those four surfaces changed — the page files were moved
with `git mv` and the only edits inside them are import paths. The fleet gained
an **Add agent** button, because the sidebar row that used to be the way in is
gone.

## The routes

| Was | Is | Label |
| --- | --- | --- |
| `/connections` | `/settings` | Connections |
| `/notifications` | `/settings/notifications` | Notifications |
| `/hosts` | `/settings/servers` | Servers |
| `/agents/add` | `/settings/add-agent` | Add agent |

`/settings` **is** the Connections tab, not a page that forwards to one. A static
export cannot answer a redirect, so a forwarding page would be a page whose whole
job is to run a script and navigate away — a blank Settings page on any slow
paint, and more often in the packaged renderer than in development. Connections
gets the short address because it is the tab a person arrives for.

The old four routes are **gone**, not kept as redirects. `tests/settings-tabs.test.tsx`
asserts no page file remains at any of them: a stale copy would still build, still
be reachable by an old link, and would drift from the live one the first time
either was edited.

## Why real routes and not tab state

This is the part worth not undoing. Three things depend on each tab being a page
in the export:

1. **`dash://open`.** `lib/open-link.ts` names a surface and asks for it to be
   shown; MAR-588 sends those links into a Discord channel. A tab held in React
   state is not a surface anything outside the renderer can name.
2. **The capture harnesses.** `electron/capture.ts` and its three siblings
   photograph a *route*. Tabs behind a click would need a harness that clicks,
   and MAR-577 already paid for what a clicking harness gets wrong.
3. **Existing links.** A not-connected chip on the fleet must land *on
   Connections*, not on Settings-with-luck.

## The hold was respected

The add-agent flow moved **verbatim**. `app/settings/add-agent/page.tsx` is
`app/agents/add/page.tsx` at a new path with no edits at all — its imports were
already at the right depth. No wording, no ordering, no control changed.

`app/settings/layout.tsx` renders **no `<h1>`** on purpose. A "Settings" heading
above the strip would demote all four pages' headings to `<h2>`, which is a
content change to four surfaces in a change claiming it moved them untouched.
The title bar carries "Settings" instead, on all four routes.

## What was verified

From **PowerShell**, in the worktree:

- `pnpm state:check` — valid, 0 drift warnings
- `pnpm typecheck` — clean
- `pnpm brand:check` — green
- `pnpm test` — **141 files, 2825 passed, 10 skipped, 0 failed** (base was 140
  files / 2814 passed; the 11 new ones are `tests/settings-tabs.test.tsx`)
- `pnpm build:renderer` — the export lists `/settings`, `/settings/notifications`,
  `/settings/servers` and `/settings/add-agent` as prerendered static pages. This
  is the load-bearing line: a tab held in state would list none of them.
- `pnpm build:shell` — green

**Screenshots:** `qa-screenshots-mar592/` — 78 packaged-renderer frames at
375/768/1280 in both themes, 13/13 harness witnesses passed, `layout.json`
measuring 96 rows with **zero** overflowing sideways. All four tabs are
photographed at all three widths. At 375px the strip wraps to two lines rather
than scrolling — MAR-491's rule, and the one thing this layout could plausibly
have got wrong.

`qa-screenshots-mar592/servers/` is the repointed two-state harness photographing
**live content** at `/settings/servers`. That matters more than it looks: a
harness aimed at a dead route photographs background colour and reports nothing
wrong, which is exactly what MAR-498 shipped once.

## What is *not* proven

- **Nobody has used this.** The acceptance test is that somebody who has never
  seen DASH finds where to connect Gmail unprompted. The images establish that
  one press of Settings lands on a page with Gmail on it. They do not establish
  that a stranger presses Settings.
- **The add-agent flow has not been re-run end to end** in this session. It moved
  byte-identical, and the attended test is the thing that would prove it.
- **`pnpm verify:shell` ran and did not reach a verdict.** 40 PASS, 4 FAIL, then
  a `TypeError` in cleanup. All four failures are one pre-existing condition on
  this machine, not this branch:

  ```
  FAIL 4b.     the runner is listening and its store answers:
               {"ok":false,"store_damaged":true,...}
  FAIL 6b-m2.  {"detail":"database disk image is malformed"}
  FAIL 6b-m3.  {"detail":"database disk image is malformed"}
  FAIL 6c.     "It is saved, but DASH could not reach the part of itself
               that runs agents."
  ```

  **The runner's SQLite store on this machine is damaged, and it was damaged
  before this run.** The fleet screenshot captured earlier in the session —
  `qa-screenshots-mar592/agents-1280-light-comfortable.png` — already shows
  DASH's own "The part of DASH that runs your agents cannot read its own
  records" notice and its **Set records aside** recovery button. So the store
  damage is a fact the capture harness photographed before `verify:shell` was
  ever invoked, rather than something this run produced.

  Two further reasons this local run is not a witness either way: Electron
  instances from the main checkout were live throughout (AGENTS.md forbids
  force-killing them), and the smoke needs the machine to itself.

  **CI's Windows `shell-smoke` is this branch's installed witness.** No smoke
  proof visits these routes, so it witnesses that the change breaks nothing
  installed rather than that it works.

  *Worth Henrik's attention separately from this issue:* the real store wants
  the **Set records aside** button pressed. That is DASH's own recovery path and
  it is on the fleet page right now.

## One decision left for after the attended test

The active tab's label and the page's own `<h1>` now say the same word twice, one
directly above the other — CONNECTIONS over CONNECTIONS. That is the honest
consequence of moving pages verbatim, and it is what most tabbed settings
surfaces do. Removing an `<h1>` from four pages is a redesign this change
declined to make while the hold stands. If Henrik wants it gone, it is a
four-line follow-up.

## Files

**Moved (renames):** `app/connections/page.tsx` → `app/settings/page.tsx`;
`app/notifications/page.tsx` → `app/settings/notifications/page.tsx`;
`app/hosts/page.tsx` → `app/settings/servers/page.tsx`;
`app/agents/add/page.tsx` → `app/settings/add-agent/page.tsx`.

**New:** `app/settings/layout.tsx`, `app/_components/settings-tabs.tsx`,
`tests/settings-tabs.test.tsx`.

**Edited:** `app/_data/routes.ts` (SURFACES down to four; `SETTINGS_ROOT`,
`SETTINGS_TABS`, `settingsTabFor`, `isSettingsRoute`), `app/_components/sidebar-icons.tsx`
(four glyphs → one gear), `app/globals.css` (`.settings-tabs`, `.settings-tab`,
`.page-actions`), `app/page.tsx` (the Add agent button), and the link sites in
`app/agents/detail/page.tsx`, `app/runs/page.tsx`, `app/_components/add-agent-form.tsx`,
`app/_components/deploy.tsx`, `app/_components/glance-chips.tsx`.

**Harnesses repointed:** `electron/capture.ts` (the two old scenes become four
`settings-*` scenes), `electron/capture-connectors.ts`, `electron/capture-servers.ts`,
`electron/capture-deploy.ts`, and a stale route comment in `scripts/build-shell.mjs`.

**Zero changes under `runner/`**, and none to any view, contract, migration,
command or broker path.

## A note for whoever picks up MAR-590

PR #122 (fleet grid track floor at 375px) was `CONFLICTING` when this branch was
cut — master moved under it when #121 merged — so this work was cut from
`origin/master` without it. This branch touches `app/page.tsx` (the Add agent
button, near the top of the file) and `app/globals.css` (new rules appended after
`.lede`). Neither is the fleet grid track, so the two should merge cleanly, but
whoever lands second should look.
