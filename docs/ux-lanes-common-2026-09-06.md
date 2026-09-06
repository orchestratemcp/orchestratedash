# Common rules for every DASH UX lane (wave 3 UX, 2026-09-06)

You are one bounded worker lane in Henrik's DASH UX cleanup. The orchestrator
(a separate session) owns integration, `.orchestrate/state.json`,
`PROJECT_STATE.md`, ADR numbering, Linear, merges and every installed-runtime
proof. You implement, test, open a PR, write a handoff, and stop.

## Repository facts (verified 2026-09-06)

- Repo: github.com/orchestratemcp/orchestratedash. Default branch `master`,
  currently `0e52211`. Your worktree is already created on your own branch
  from `origin/master`; `pnpm install --offline --frozen-lockfile` was started
  for it by the orchestrator. If `node_modules` is missing or the install log
  (`%TEMP%\wt-<lane>-install.log`) is not finished, wait for it; do not start a
  second install in parallel.
- The approved plan is NOT on master yet. Read it with:
  `git show origin/codex/dash-ux-plan-20260906:docs/dash-ux-plan-2026-09-06.md`
  (PR #319, docs only). Also read `AGENTS.md`, `docs/mar-861-orchestrator-handoff-2026-09-06.md`
  and `docs/mar-873-handoff.md` on master for the traps this wave already hit.
- Tests: `pnpm typecheck`, `pnpm vitest run tests/<file>` for focused runs,
  `pnpm test` for the whole suite (~5000 tests, several minutes). Run them from
  **PowerShell**, not Git Bash. `pnpm brand:check` walks `app/` and must stay green.
- Copy gates: 75 test files call `expectPlainLanguage` over `every*Sentence()`
  enumerators; a new user-facing sentence needs to be enumerated by the module's
  enumerator or it is unenforced. No raw identifiers (ids, hashes, ISO instants)
  in primary copy. Buttons render uppercase globally; keep labels short.
- Two renderers draw an artifact card (`app/_components/outputs.tsx` and
  `app/_components/panel.tsx`); a fix in one is not a fix in the other.

## Hard rules

1. **Never** run `pnpm verify`, `pnpm verify:shell`, `pnpm shell`, `pnpm shell:smoke`,
   or any `electron dist/electron/*.mjs` without an explicit
   `--user-data-dir=<scratch>` AND `DASH_DATA_DIR=<scratch>`. The real store lives
   in `%APPDATA%\orchestratedash` and Henrik's DASH is running from the main
   checkout; you must not touch either. Never force-kill any Electron process.
2. Do not edit: `.orchestrate/state.json`, `PROJECT_STATE.md`, `AGENTS.md`,
   `CLAUDE.md`, `docs/adr/**`, `package.json`, `pnpm-lock.yaml`,
   `contracts/**`, `app/tokens.css`. `app/globals.css`: you may only APPEND one
   block at the very end, fenced `/* ==== MAR-<id> begin ==== */ … /* ==== MAR-<id> end ==== */`.
   Do not restyle shared rules in place (other lanes are live in parallel).
3. Stay inside your lane's file ownership (in your lane file). If the design
   genuinely needs a file outside it, stop, write it in the handoff under
   "Needs orchestrator", and continue with what you can do without it.
4. No new ADR (none of these lanes changes a cross-repo contract). No manifest
   v2 schema changes. No migrations. No new Slack/Discord connectors.
5. Never read a fleet credential directly for an agent, never reorder the
   `no_provider` gate in `lib/views/ask.ts`, never delete rows from any store,
   never activate schedules/channels/deploys.
6. Tests pin behaviour, not wording: when you change a sentence, update the
   test that pinned it; when you change structure, keep the invariant the test
   was protecting (read the test's docblock first).
7. Preserve unrelated dirty files. Never rebase or force-push a pushed branch.
   If `origin/master` moves, `git merge origin/master` into your branch.
8. PowerShell here-strings with quotes break: write commit messages and PR
   bodies to a file and use `git commit -F` / `gh pr create --body-file`.
9. Do not use the Linear connector, do not post to Linear; the orchestrator
   does that from your handoff.

## Exit contract

When your lane's stop condition is true:

1. `pnpm typecheck` clean; focused tests green; `pnpm test` run once from
   PowerShell (paste the summary line; if unrelated files fail, re-run them
   alone before believing them and say so).
2. Commit(s) on your branch with message trailer
   `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; push;
   `gh pr create --base master --head <branch> --title "<type>(mar-<id>): …" --body-file <file>`
   with the PR body ending in
   `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
   Do NOT merge. Do not write "Fixes MAR-…" (Linear lifecycle stays open).
3. Write `docs/mar-<id>-handoff.md` in the PR: what changed (files, commit),
   what was verified and HOW (paste command + result), what is NOT done,
   surprises/contradictions, the one thing the next session should do first,
   and a section "Evidence class" stating honestly whether your evidence is
   fixture tests, scratch-store harness frames, or nothing runtime.
4. Report back to the orchestrator in your final message: PR URL, head SHA,
   test summary, files changed, anything under "Needs orchestrator".

Hard stop: when the PR is open and the handoff is written, end. Do not start
adjacent work, do not "also fix" things in other lanes' files.
