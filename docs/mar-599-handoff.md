# MAR-599 handoff — settings polish: headings, the fleet card's fold, Preferences

**Branch:** `000henrik/settings-polish`, cut from `origin/master` at `5ad6d70`.
**Worktree:** `C:\Users\henri\Desktop\projekt\MCP\dash-settings-polish`
**PR:** [#133](https://github.com/orchestratemcp/orchestratedash/pull/133), targeting `master`. Both CI buckets green (`verify` 1m17s, `shell-smoke` 1m44s).
**Linear:** [MAR-599](https://linear.app/martini-home/issue/MAR-599), In Review — not merged, waiting on Henrik.

This was run deliberately as a **parallel lane**: an attended test was live on
the real store on the same machine for the whole session. Everything below was
built to not touch it — a fresh worktree, a fresh branch, and capture
harnesses that never claim the installed app's identity.

---

## What changed, in three pieces

### 1. Servers and Notifications' repeated heading

MAR-593 fixed this for Connections alone — `<h1>Accounts and keys</h1>` under
a CONNECTIONS tab — and its own handoff named the other three as open. Servers
now reads `<h1>Remote machines</h1>`, Notifications `<h1>Discord alerts</h1>`.
Both say what the surface *is* rather than the word the tab strip already
said. Add agent is untouched: it is still `<h1>Add agent</h1>`, on purpose,
under Henrik's hold from MAR-592.

A new test, `tests/settings-tabs.test.tsx` › *"the heading does not repeat the
tab it is under"*, source-scans all five settings pages and asserts the `<h1>`
text differs from the active tab's label, with Add agent as the one declared
exception. It would have caught this defect on Servers and Notifications
directly, and it is the regression guard against it coming back.

### 2. The Gmail fleet card's Sign-in button, below the fold at 375px

MAR-593's own handoff (`docs/handoff-2026-08-10-mar-593-fleet-connections.md`,
"Left for somebody else") flagged this and did not fix it: *"the Gmail card's
own Sign in button sits well below the fold, behind the wider-permission
sentence and the reach sentence... the fix is shorter sentences rather than a
deleted claim."*

Two sentences were shortened:

- `lib/broker/operations.ts` — `gmail.draft.create`'s `wider_permission`, from
  three sentences (~54 words) to two (~29 words). Every fact ADR 0002
  amendment 2 requires survives — the permission is wider than the action,
  DASH builds no send operation, it is revocable — and the two clauses
  `tests/broker-boundary.test.ts` and `tests/broker-write.test.ts` pin
  (`"also allows sending"`, `"no agent can ask DASH to send"`) are both still
  literally present.
- `lib/fleet/grants.ts` — `describeFleetReach`, from three sentences to one.
  Both facts survive: a separate record per agent, and a grant scoped to what
  each agent asked for.

**This is a real, measured improvement, not a full fix.** `electron/capture-connectors.ts`
gained a genuine element-level measurement —
`first_fleet_button_bottom` / `first_fleet_button_within_viewport`, read from
the actual button's `getBoundingClientRect()` against `window.innerHeight` —
where every check in that file before this only ever measured the document
root's horizontal overflow, an axis this defect was never on. Height is a
different axis, and nothing existing would have caught it.

Run against the worst-case seeded scenario (three agents, two sharing Gmail —
`capture-connectors.ts`'s own `seed()`), the button is now **within the
viewport at 1280 and 768, in both themes and densities**. At 375px it still
sits below the fold — 4 of 16 frames in `qa-screenshots-mar599-connectors/layout.json`
report `first_fleet_button_within_viewport: false`, roughly 260px short. The
agents list (naming which of them this reaches) and the two disclosures are
all content the product's own honesty rules require rendered, not hidden
behind a click, so eliminating the scroll entirely at 375px with two agents
sharing one connector was not achievable from copy alone without cutting a
fact ADR 0002 amendment 2 requires. On the state MAR-593's own handoff says
this issue is actually about — a freshly cleared DASH, where the reach
sentence is null and no agents list renders — the card is substantially
shorter and this should not reproduce; that was not independently reverified
this session.

### 3. A new `/settings/preferences` tab

MAR-592's own scoping (`docs/handoff-2026-08-10-attended-run-paused.md`) named
five sections Henrik asked for — *"Connections · VPS/Servers · AI (OpenRouter
+ model choice) · Notifications/chat · app preferences (dark mode etc.)"* —
and MAR-592 shipped four, naming the fifth without building it.

`app/settings/preferences/page.tsx` is new, last in the tab strip (after the
held Add agent). Two sections:

- **Density** — reuses `<DensityToggle />` from `app/_components/density-toggle.tsx`
  unchanged. There is exactly one place that reads and writes `dash.density`;
  this page does not reimplement it, only renders it a second time in a
  discoverable home.
- **Theme** — DASH has **no toggle anywhere** for this. It follows
  `nativeTheme.shouldUseDarkColors` end to end
  (`electron/main.ts` → `lib/shell/chrome.ts` → `app/tokens.css`'s
  `color-scheme` rule). The page says so in plain copy rather than building a
  control nothing behind it would answer to — inventing one was out of scope
  for a leftover-fix pass. `lib/shell/chrome.ts`'s `resolveTheme` does accept a
  `chosen` override, but nothing anywhere ever passes a non-null value; a
  future session wiring a real theme switch would start there.

`app/_data/routes.ts`'s `SETTINGS_TABS` grew a fifth entry. `settings-tabs.test.tsx`
was updated for the new count and now documents MAR-599 in its own name.

---

## Evidence

Both harnesses seed their own data and **do not import `electron/smoke-identity.ts`**
— the module that calls `app.setName("orchestratedash")` so the installed
app's single-instance lock and default `userData` path apply. Skipping it was
the whole point: multiple real `electron.exe` processes were alive on this
machine for the attended test the entire session, and a capture process
claiming the same app identity would either fight it for the lock or, on one
forgotten environment variable, write into its store.

- `qa-screenshots-mar599/` — new harness `electron/capture-settings-polish.ts`.
  36 frames: Servers, Notifications, Preferences × 375/768/1280 × light/dark ×
  comfortable/compact. `layout.json` records, per frame, the `<h1>` text, the
  active tab's text, and whether they match — zero matches (the defect this
  batch fixed), zero horizontal overflow.
- `qa-screenshots-mar599-connectors/` — `electron/capture-connectors.ts`
  rerun after the copy shortening. 16 frames. `layout.json` carries the new
  `first_fleet_button_*` fields described above.
- `scripts/build-shell.mjs` gained an explicit esbuild entry for the new
  harness, on the same terms as `capture-connectors.ts`'s own entry.

**One harness bug found and fixed while capturing, worth flagging separately.**
Electron's `localStorage` lives in the session partition
(`app.getPath("userData")`, driven by `app.getName()`), not in
`DASH_DATA_DIR` — so it is shared by every unpackaged capture process ever run
against this machine's default `Electron` userData directory, regardless of
which scratch SQLite store each one pointed at. A prior run left density
"compact" in that shared storage, and the first screenshots taken this session
had "comfortable" in the filename while showing the compact layout — a wrong
label a person would not catch from the image alone, since the two densities
are legitimately the same shape here. Both harnesses now call an
`ensureComfortable()` step before their loop starts, reading the actual
attribute and correcting it rather than assuming. Recaptured after the fix;
every image in both evidence directories is confirmed correct by eye.

---

## What was verified

From **PowerShell**, in the worktree:

- `pnpm state:check` — valid, 0 drift warnings
- `pnpm typecheck` — clean
- `pnpm brand:check` — passed
- `pnpm test` — **150 files, 2912 passed, 10 skipped, 0 failed**

`pnpm verify:shell` was **not run locally** — deliberately. This machine had
several other Electron processes live the entire session for the concurrent
attended test, and running the shell smoke locally would have meant either
contending with it for the machine or risking exactly the collision this whole
lane was structured to avoid. **CI's Windows `shell-smoke` is this change's
installed witness**, and it passed: both `verify` and `shell-smoke` are green
on PR #133.

## What is not proven

- **The 375px fold is smaller, not gone**, in the worst-case seeded scenario.
  See above. A future pass could revisit whether the agents list or the
  disclosures can be restructured (not deleted) to close the remaining ~260px
  — collapsing the agents list behind a summary was considered and not done
  here, since ADR 0002 amendment 2's "before the button" requirement is about
  the disclosures, not the agents list, and conflating the two risks a
  different defect.
- **Nobody has used this.** The images establish the pages render correctly
  at every width, theme and density measured. They do not establish that a
  person finds Preferences, or that the shortened Gmail copy still reads as
  complete to somebody encountering it for the first time.
- **The theme section is copy only.** It is honest about current behaviour,
  not a step toward a manual switch. If Henrik wants one, `resolveTheme`'s
  `chosen` parameter is where it plugs in, and it would need a storage key, a
  pre-paint script (the same shape `DensityScript` uses), and a decision about
  whether `nativeTheme.themeSource` should follow it in main — a real feature,
  not a leftover fix.

## Files

**New:** `app/settings/preferences/page.tsx`, `electron/capture-settings-polish.ts`,
`qa-screenshots-mar599/`, `qa-screenshots-mar599-connectors/`.

**Edited:** `app/settings/servers/page.tsx`, `app/settings/notifications/page.tsx`
(headings), `app/_data/routes.ts` (`SETTINGS_TABS`), `lib/broker/operations.ts`,
`lib/fleet/grants.ts` (shortened copy), `electron/capture-connectors.ts`
(fold measurement, density reset), `electron/capture.ts` (new
`settings-preferences` scene, for a future full-surface run), `scripts/build-shell.mjs`
(new harness entry), `tests/settings-tabs.test.tsx`.

**Zero changes** under `runner/`, and none to any view, contract, migration,
command or broker path beyond the two copy strings named above.

## For whoever picks this up next

PR #133 is open and green, not merged — this session did not merge it, per
standing instruction that only Henrik merges. If master moves before it does,
rebase rather than re-cutting; nothing here touches a file likely to collide
with the attended-test session's own changes (that session owns `lib/connections.ts`-adjacent
and Electron-bug files per its own handoff, this one touched settings pages,
two copy strings, and capture harnesses).
