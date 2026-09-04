# Session prompt — MAR-862: the DASH MCP plugin

Dispatched by the orchestrator 2026-09-04. Packet 1 of MAR-861 (Agent Tank,
deadline 2026-09-17 15:30 UTC). Copy everything below the line into a fresh
session.

---

**Client:** Claude Code, `claude --model opus` with extended thinking.

**Why this tier:** this creates a new surface and decides a seam — where a
coding agent's writes meet DASH's import boundary. The implementation is
bounded, but the shape is not yet decided and a wrong shape costs a whole
session at a deadline. Architecture tier, not the default tier.

**Repository:** `orchestratedash`.
**Worktree:** create `C:\Users\henri\AppData\Local\Temp\wt-mar862-dashmcp-a1`
(the suffix is deliberate — worktree names collide across sessions).
**Branch:** `000henrik/mar-862-dash-mcp-plugin`, from `master`.
**Linear issue:** MAR-862. Read it in full before starting; it carries the
folder shape, the mechanism and the trap.

## File ownership

**You own, and may create or edit:**

- `tools/dash-mcp/**` — the whole new package, wherever you decide it sits
  under `tools/`. Say in the handoff where you put it and why.
- `docs/adr/0032-*.md` — **ADR number 0032 is assigned to you.** Do not pick
  another; parallel packets collide on ADR numbers.
- `docs/mar-862-handoff.md` — your handoff.
- The plugin manifest and skill files the plugin needs.

**Read-only, do not edit under any circumstances:** `lib/**`, `electron/**`,
`app/**`, `runner/**`, `contracts/**`, `.orchestrate/**`, and every other
`docs/` file. You are *importing* DASH's code, not changing it. If you find you
need a change in `lib/`, stop and write the handoff — that is a different
packet.

**If a CI step is needed** for the new package, do **not** insert one. Note
what is needed in the handoff; the orchestrator assigns the insertion point.

## Objective

Ship a Claude Code plugin that makes a coding agent build a DASH-shaped agent
correctly the first time. Two halves in one plugin:

- a **skill** carrying the recipe (how an agent that fits DASH is built), and
- a **local stdio MCP server** exposing three tools that **refuse rather than
  advise**:

| Tool | Behaviour |
|---|---|
| `dash_agent_scaffold` | writes the whole folder, not a description of one |
| `dash_agent_validate` | runs DASH's real validator and returns **the fix** |
| `dash_agent_install` | stages the folder and hands DASH the import |

## Current evidence, verified 2026-09-04

The hard parts already exist and are exported:

- `lib/contracts.ts` — `validateManifest`, `validateEvent`, `validateArtifact`,
  `validateState`, `validateCommand`
- `lib/folder-import.ts`, `lib/folder-repair.ts`, `lib/manifest-constraints.ts`

The installed folder shape, read from `%APPDATA%/orchestratedash/agents/`:

```
agents/<name>/
  agent.manifest.json
  registration.json
  code/
    agent.mjs
    package.json
    sources.json
    scripts/open-in-dash.mjs
  (runtime adds: code/reports/, code/runs/events.jsonl)
```

Four agents are installed there today; read one before you scaffold one.

## Known blockers and traps

1. **Never write into the live `agents/<name>/` directory.** That folder is
   swapped on import, not edited, so anything written straight in dies on the
   next re-import. Stage elsewhere and let DASH import. **This is ADR 0032's
   subject** — write the ADR before the code.
2. **This is a local server by nature.** It touches the user's filesystem, so
   it cannot be hosted. No Cloudflare, no Docker.
3. **`registration.json` is a file, not a store row.** Registrations survive a
   store rebuild. Do not assume the store is the source of truth for what is
   installed.
4. The kit template **starts idle by design** and publishes one pending task.
   A scaffolded agent that runs on start is wrong.

## Allowed changes

Only the new package, the assigned ADR, and the handoff. Nothing else.

## Non-goals

- No change to OrchestrateKit-MCP. It stays hosted and untouched.
- No change to the runtime, the broker, or any schema.
- Not publishing the plugin to a marketplace.
- Not building the GenLayer button — that is MAR-863, a different session.

## The recipe must teach the adjudicable shape

An agent built by this plugin should emit an artifact-v2 `brief` carrying
`derived_from` with `items_digest`, so its output is adjudication-ready by
construction. MAR-863 puts a button on exactly that. `lib/brief/fingerprint.ts`
is the reference for how the digest is computed; mirror it, do not re-derive it.

## Start checks

```bash
git rev-parse --abbrev-ref HEAD
git status --short
git log --oneline -1
```

Confirm you are on your own branch in your own worktree, that the tree is
clean, and that `master` is the parent. Then read MAR-862 and ADR 0031 (the
most recent, for house style).

## Verification

Run from **PowerShell**, not Git Bash — Git Bash's `whoami` fakes
channel-secret failures.

```bash
pnpm -w typecheck
```

```bash
pnpm vitest run tools/dash-mcp
```

Do **not** run the full `pnpm verify` unless you have changed something outside
your package. If you do run it: **close DASH first** — a lock-holding Electron
kills the shell smoke silently with exit 0 in about five seconds and no proofs —
and redirect the output to a file, because piping `verify:shell` into
`Select-Object` hangs on stdout.

## Lifecycle exit state

`merged` when the PR is green on master. **Not `proven`** — see below.

## The proof, and it is behavioural

`proven` = **a fresh agent scaffolded by this plugin, in a clean Claude Code
session, imports into the installed DASH build with zero validation failures
and appears in the fleet.** Source-level tests never prove this.

If you can reach that proof in this session, do it and paste the evidence. If
you cannot, say so plainly in the handoff and leave the packet at `merged`. A
handoff that claims something works without naming the command or artifact that
showed it is treated as `merged`, never `proven`.

## Evidence to write back

1. A comment on MAR-862 with: the commit SHA, the PR number, what you verified
   and **how** (paste the output), what is not done, and any contradiction you
   found between this prompt and the repo.
2. `docs/mar-862-handoff.md` in the PR, same content.
3. The one thing the next session should do first.

## Coordination

No other session is live right now — there are zero open PRs on this repo. If
one appears while you work: you own only `tools/dash-mcp/**`, ADR 0032 and your
handoff, so a collision should be impossible. If the other PR merges first,
**merge master in — never rebase a pushed branch and never force-push.** Assume
your PR can merge while you work; re-read state before pushing.

## Hard stop

When the plugin scaffolds, validates and installs an agent, the ADR is written,
the tests pass and the handoff is written: **stop.** Do not start MAR-863's
button, do not touch the runner, do not tidy adjacent code. Write the handoff
and end the session.
