# DASH Agent Rules

Read `PROJECT_STATE.md` and `.orchestrate/state.json` before planning work.

## Product boundary

DASH is the local-first shell that lets a person add, run, inspect, and trust agents without a terminal. The canonical first journey is the existing **Try a sample agent** flow; extend and prove it instead of creating a parallel demo.

Manifest input is v2 and runner telemetry is v1. Development and installed stores are distinct. Never claim an installed journey works from source-level tests alone.

## Sources of truth

- Git is implementation truth.
- Linear is intent and ownership truth.
- ADRs are decision truth.
- Tests and installed-app smoke runs are evidence truth.
- `.orchestrate/state.json` is an index, never an independent source of truth.

Keep the lifecycle explicit: `planned` -> `merged` -> `proven`. Proven means the packaged or installed path named by the issue was executed with reproducible evidence.

## Process safety

Do not force-kill Electron or the runner. New runners stop through the authenticated `/shutdown` route. A pre-identity Windows runner that cannot shut down gracefully requires one explicit Windows restart. Never assume port 3000 belongs to DASH; verify the owner.

## Session protocol

At the start: confirm repository and branch, inspect `git status`, run `pnpm state:check`, and read the active Linear issue. At the end: run focused tests plus `pnpm verify` when safe, attach commit/proof evidence to Linear, add an ADR for cross-repository decisions, update the state packet, and run `pnpm state:check` again. Preserve unrelated dirty files.

On Windows, `pnpm verify` includes the real Electron shell smoke and uses installed-style user data. Treat that as a machine-affecting proof, not a unit test.

## New-session handoff contract

When Henrik asks for a **new session prompt**, do not return a loose summary.
Return one or more copy/paste-ready prompts and specify for each:

1. client (`Codex` or `Claude Code`), exact model selector, and reasoning level;
2. repository, branch/worktree, Linear issue, and read/write ownership;
3. objective, current evidence, known blocker, allowed changes, and non-goals;
4. required start checks, verification commands, lifecycle exit state, and the
   evidence that must be written back to Linear/state files;
5. coordination rules for any parallel session.

Model routing while usage is available:

- Use **Codex `gpt-5.6-sol` with high/xhigh reasoning** for cross-repository
  implementation, architecture migrations, difficult debugging, security
  boundaries, and installed/runtime proof work.
- Use **Codex `gpt-5.6-terra` with medium/high reasoning** for a bounded issue,
  mechanical cleanup, focused tests, or documentation where the scope is known.
- Use **Claude Code `--model opus` with extended thinking** for an independent
  architecture/UX audit, long-context reconciliation, or a second opinion on a
  risky plan. The official `opus` alias intentionally resolves to Claude Code's
  current Opus model; include the concrete model ID too when the client exposes
  it.
- Use **Claude Code `--model sonnet`** for bounded implementation and review when
  Opus usage is limited.

For important work that benefits from both clients, default to Codex
`gpt-5.6-sol` xhigh as the implementation/proof owner and Claude Code `opus` as
a read-only reviewer. Reverse the lead only when the task is primarily product
writing or UX synthesis. Two live sessions must never edit the same files or
worktree. Give them separate repositories/file ownership, or make one explicitly
read-only. The user will say when one provider's usage is exhausted; until then,
recommend the strongest justified model rather than silently downgrading.
