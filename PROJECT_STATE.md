# DASH project state — HEAD

Updated: 2026-08-19 (workflow v2: state rotation, refreshed after master moved past it)

This file is the **current truth only**, kept under ~200 lines. The full
narrative history through 2026-08-19 lives in
`docs/state-archive/PROJECT_STATE-2026-08-18.md` (master's appended entries
followed the rename in the refresh merge); per-packet evidence narratives
live in `.orchestrate/archive/state-2026-08-19-full.json` (and the earlier
`state-2026-08-18-full.json`) and in git history. `.orchestrate/state.json` is the packet index (id, lifecycle,
commit, proof command) and is validated by `pnpm state:check`. Rotate this
file at every checkpoint: move superseded entries to the archive, never
append forever.

## What DASH is

The local-first shell that lets a person add, run, inspect, and trust
agents without a terminal. Canonical first journey: **Try a sample agent**
(AI News Scout). Manifest input is v2, runner telemetry is v1. Development
and installed stores are distinct; installed journeys are proven only on
the packaged path.

## Where the product stands

- **Wave 0 — installed first-run reliability: proven** (2026-08-01,
  `05201e7`). Packaged renderer, no-terminal sample handoff, runner
  identity, graceful shutdown, Runs inspection, verdict.
- **Wave 1 — shortest real agent loop: proven** (2026-08-01, `c658667`).
  AI News Scout live cited digest; grounding as a second verdict axis;
  manual trigger honesty.
- **Wave 2 — outside-app connections: in flight.** Permission broker built
  (no token pass-through, three-party grants, `broker_lapses`, read-then-
  reach). Gmail is read/search/draft-only against a loopback provider —
  the real-Google consent path remains unproven and no surface may claim
  it. Discord outbound notifications shipped. Model choice per step
  (MAR-583) shipped. Outputs usability (MAR-697/698, PR #245): collected
  links open through the main process and exported PDFs land somewhere
  findable — merged, not proven.

## Active decision surface (ADRs 0019–0025)

- ADR 0019 + amendment 1: controlled browser. Slice 1 **built and
  machine-proven** (`electron/prove-browser.ts`, 11 checks) — open one
  page, read its words, exact per-run origins, ephemeral view. Scroll,
  click-with-approval, VPS/Xvfb path deferred; load/recovery (condition 8)
  is the largest stated gap.
- ADR 0020: an MCP server is a connection DASH brokers; tool set pinned at
  consent; curated catalogue ships empty. `planned`, no implementation.
- ADR 0021: the host is a small DASH runtime (runner-local broker as an
  install pack). `planned`, documentation only. Remote MCP parity waits on
  this (MAR-629).
- ADR 0022–0025: starting a stopped agent; the chief is a principal; a
  decision is filed where it is made; a brief is a document bound to its
  evidence (MAR-674, promoted to proven 2026-08-18, `8bf4671`).

## Lifecycle counts (from state.json, 2026-08-19)

135 packet entries merged, 18 proven, 23 planned. **Proven-debt is far
over budget** — the current focus is a proving wave, not new features.
Merged-but-unproven work is inventory, not progress.

## Known standing constraints

- Never force-kill Electron or the runner; runners stop via authenticated
  `/shutdown`.
- Port 3000 is not assumed to be DASH's; verify the owner.
- `pnpm verify` on Windows includes the real shell smoke (machine-
  affecting); run it from PowerShell with DASH closed.
- Loopback fixtures cannot refuse like real providers; proofs against them
  establish boundaries, not provider behavior.

## Where the next session starts

Read this file, run `pnpm state:check`, read the active Linear issue, and
check `docs/workflow/WORKFLOW.md` for the operating loop. Session prompts
come from the orchestrator using the contract in
`docs/workflow/session-prompt-template.md`.
