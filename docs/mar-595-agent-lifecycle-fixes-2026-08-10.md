# MAR-595 — agent lifecycle fixes, session handoff (2026-08-10)

Worked in an isolated worktree (`../dash-mar595`, branch
`000henrik/mar-595-agent-lifecycle-fixes`) cut from `origin/master` at
`04dc346`. [PR #127](https://github.com/orchestratemcp/orchestratedash/pull/127)
is open against master. CI was running at the moment this was written; check
`gh pr checks 127` before merging.

## What this session was asked to fix

Six findings from `docs/mar-489-attended-run-2026-08-10.md`, all fixed with a
regression test:

| Finding | What it was | What changed |
| --- | --- | --- |
| F12 | `console.warn` after the launching terminal's reader closed threw an uncaught `EPIPE`, crashing DASH | `lib/shell/pipe-guard.ts` — swallows `EPIPE` on `stdout`/`stderr`, rethrows anything else |
| F13 | Agents list read once on mount; adding an agent via the native consent dialog never refreshed it | `lib/shell/focus-refresh.ts` — refetches on window focus (`app/page.tsx`) |
| F15 | Re-importing over a running agent failed with "build is incomplete… Build it again" — the real cause is Windows refusing to rename a folder a live process has open | `lib/agent-folders.ts`'s `isAgentFolderLocked` classifies `EBUSY`; `lib/handoff-flow.ts` reports "stop the agent first" instead. Scaffold README's matching false promise corrected |
| F18 | `removeAgentWithReport`/`removeAgentFolder` existed with no UI reaching them | Second removal action added (`forgetAgent`'s `deleteFolder` option) — **Remove from DASH** (keep files) and **Remove and delete all files**, wired preload → command catalogue → renderer → confirm UI on the agent detail page |
| F9 | `open-in-dash` refused to import an agent missing a scaffold file it no longer uses (e.g. `sources.json`), with a misleading "build incomplete" refusal | Only `agent.manifest.json`/`package.json`/`agent.mjs`/`scripts/open-in-dash.mjs` are required now; `sources.json`/`README.md`/`.gitignore` are optional |
| — | MCP-planned agent (no `agent.display_name`) rendered its raw slug as its title | `lib/copy/agent-name.ts`'s `humanizeAgentName` — used wherever DASH falls back from `display_name`, replaces `lib/sample-agent.ts`'s private copy of the same logic |
| F11 (small) | Two-data-directories trap (`electron .` vs `electron dist/electron/main.mjs`) had no visible cause in the log | `reportStoreLocation` now logs `app_name` beside the store path |

## File-ownership deviation — read this first

The session brief scoped ownership to `electron/main.ts`, `agent-kit/**`,
`app/agents/**`, forbidding `lib/connections.ts`, `lib/ai/**`, `/settings`
(session 1's files). Fixing F13/F15/F18/F9/the display-name fallback required
touching files outside that literal list:

- `app/page.tsx` and `app/_data/source.ts` — the Agents list itself lives at
  the app root, not under `app/agents/**`; there was no way to fix F13 or
  wire F18's removal buttons without touching these.
- `lib/store.ts`, `lib/handoff-flow.ts`, `electron/handoff-host.ts`,
  `electron/preload.ts`, `lib/shell/ipc.ts` — F15 and F18's backend/command
  plumbing.
- `lib/views/build.ts`, `lib/workspace.ts`, `lib/sample-agent.ts` — the
  display-name fallback's three read sites plus the pre-existing duplicate of
  the same humanizing logic.

None of these are in the forbidden list, and none collided with anything
session 1 was working on as far as this session could see. Flagged in the PR
description and here for visibility — if another session touched any of these
concurrently, the merge conflict (not a silent overwrite) is the safety net.

## Verification

From PowerShell, in the worktree:

- `pnpm state:check` — valid, 0 drift warnings.
- `pnpm typecheck` — clean, no errors.
- `pnpm brand:check` — passed (11 characters, 3 action sheets/24 frames, 3
  rendered sizes, 5 files using the cast, 57 files checked for remote fonts, 4
  bundled font files).
- `pnpm test` (vitest) — **146 files, 2861 passed, 10 skipped.** Ran once from
  Git Bash first and saw 56 failures across 6 files (`channel-secret`,
  `folder-bundle`, `host-record`, `runner-session-key`, `runner-standalone`,
  `task-workspace`) — all `ChannelSecretError: … Command failed: whoami /user
  /fo csv /nh`, the known Git-Bash-`whoami` artifact. Re-ran those 6 files and
  then the whole suite from PowerShell: fully green, confirming the Bash run
  was environmental, not a real regression.
- `pnpm verify:shell` — **not run locally.** `Get-Process electron` showed a
  live process from the main `orchestratedash` checkout (almost certainly
  Henrik's own running DASH) at the point this was ready to verify.
  `AGENTS.md` treats the Windows shell smoke as "a machine-affecting proof,
  not a unit test" against installed-style user data on the real store —
  running it alongside someone else's live session risked exactly the kind of
  contention the project's memory notes warn about (`MCP suite is flaky under
  parallel load`, orphan-runner-blocks-verify:shell). CI's Windows
  `shell-smoke` job on PR #127 is the actual gate; it runs in an isolated
  runner unaffected by local processes.

## What was not touched

- `.orchestrate/state.json` / `PROJECT_STATE.md` — both exceed this session's
  256KB single-read limit and there's no writer script for them (only
  `scripts/check-project-state.mjs`, a checker). `state:check` passed without
  a new entry, meaning MAR-595 isn't gated on being recorded there before
  merge, but whoever closes MAR-595 out should still add an entry once it's
  proven (merged → proven still needs an installed-shell run per
  `AGENTS.md`'s lifecycle rule).
- Findings 1, 2, 3, 6, 7 (the planner's route-matcher/`safety_review`
  problems), 8 (`runner.sqlite` malformed), 14 (no model-provider producer),
  16 (Google sign-in), 17 (`ai-news-scout` reads fixtures) — out of this
  session's scope, still open.
- MAR-489's Part B (`V0`–`V10`, the real VPS proof) — untouched, per the
  run-evidence doc's own "what this run does not prove" section. Nothing here
  changes that.

## Next steps

1. Watch PR #127's CI (`gh pr checks 127`). If shell-smoke is green, this can
   merge to master.
2. After merging: an actual installed-shell run exercising F13 (add an agent,
   watch the list refresh without swapping tabs), F18 (both removal buttons on
   a real agent), and F15 (edit a running agent's manifest, re-run
   `open-in-dash`, confirm the new message) would take this from `merged` to
   `proven` for those four findings, per this repo's own lifecycle rule.
3. `.orchestrate/state.json` / `PROJECT_STATE.md` entries for MAR-595, once
   proven.
