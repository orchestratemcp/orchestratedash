# DASH project state — HEAD

Updated: 2026-09-07 (checkpoint after the approved UX wave landed).

## Sources and history

Git is implementation truth; Linear is intent/ownership; ADRs are decisions;
tests and actual runtime proofs are evidence. `.orchestrate/state.json` is an
index. Previous HEAD preserved verbatim in
`docs/state-archive/PROJECT_STATE-2026-09-07-ux-wave.md`; earlier archives
remain in that folder.

## Product and journey

DASH is a local-first shell to add, run, inspect and trust agents without a
terminal. Preserve **Try a sample agent** as the canonical first journey.
Manifest input v2; runner telemetry v1. Development and installed stores differ.

Describe -> adaptive interview -> editable plan -> validated build -> DASH
import -> missing connections -> first manual run -> optional channels,
schedules and cloud. Credentials stay in DASH; imported agents start idle.

## Current baseline

Master `5137e86`. Running checkout `C:/Users/henri/Desktop/projekt/MCP/orchestratedash`
on master; Henrik launches DASH via `Desktop\DASH.lnk` (rebuilds when
preflight refuses). Hard external deadline: **2026-09-17 15:30 UTC** (Agent Tank,
MAR-861). Wave-3 handoff for the next orchestrator:
`docs/mar-861-orchestrator-handoff-2026-09-07.md`.

## The approved UX wave (2026-09-06 plan) — all on master

| Issue | PR | Lifecycle | Proof still owed |
|---|---|---|---|
| MAR-875 one result per run | #328 | merged | before/after on Henrik's build (Output stage seen 2026-09-07; MAR-884 found there) |
| MAR-876 builder interview | #324 | merged | host session end to end; DASH import + first run |
| MAR-877 global Settings | #327 | merged | AI / Notifications on the installed store (Connections seen 2026-09-07) |
| MAR-878 readiness + provider | #320 + #329 | merged | fresh scaffold adopted, real question (spend needs Henrik's go) |
| MAR-871 server page | #325 | merged | attended first-time enrolment (owner) |
| MAR-874 agent Settings | #332 | merged | one screen at 1280; Use my key adoption |
| MAR-879 onboarding/readability | #336 | merged | three-path walk; sample press on the installed build |
| MAR-880 judgement poll retries | #322 | merged | a press that survives a failed first poll |
| MAR-868 verdict on the page's poll | #311 | **proven** 2026-09-07 | — |

Follow-ups filed from the wave: MAR-881 (page scrolls to top on a poll
tick), MAR-882 (chief entry should prefill the composer), MAR-883 (agent ids
as labels on the Gmail row), MAR-884 (citation row does not wrap; lane running).

## Dependencies and boundaries

- MAR-873 is superseded by MAR-878: scaffolds declare `model_provider`;
  adoption is the explicit *Use my key* / *Connect* press (ADR 0013). Never
  read fleet credentials for an agent, never reorder the `no_provider` gate.
- MAR-864 remote start (needs an ADR, Henrik's shape), MAR-872 timezone,
  MAR-869 digest fields to the judge, MAR-870 stale `dash://` row: **owner
  rulings**, unchanged. Unknown server state never becomes a healthy claim.
- ADR 0032: the DASH builder lives in `tools/dash-mcp/**`; OrchestrateKit-MCP
  read-only; cross-repo changes need an orchestrator-assigned ADR.
- No live-store deletion, wallets, implicit cloud/schedule activation, or new
  connectors.

## Proof and dispatch

Index: 140 merged / 73 proven entries; 106 distinct merged-not-proven issues.
The AGENTS.md proven-debt gate stays on: **the next dispatch is a proving
pass**, in this order — rebuild DASH after MAR-884 lands; walk the installed
build for MAR-875/877/874/879 (no sideways scroll, Settings at 100% and 80%,
agent Settings one screen, three Add-agent paths with the sample pressed);
adopt a fresh scaffold and ask one real question (MAR-878/874, spend on
Henrik's key with his go); a judge press for MAR-880.

Then MAR-881/882/883 (Sonnet, bounded), then whatever Henrik's rulings
unblock (MAR-864 first: it gates Discord and the cloud half of the video),
then MAR-866 dress rehearsal.

Process facts this wave: worker lanes run as subagents in `%TEMP%\wt-<lane>`
worktrees with disjoint ownership; `app/globals.css` takes one fenced
append per lane, merged by keeping every fence in order; the orchestrator
merges on green with a string-compared `gh pr checks` gate (no `jq` on this
box); `scripts/retire-scratch-runners.mjs` retires capture-harness runners
over their own `/shutdown`. Never force-kill Electron/runner; `pnpm verify`
from PowerShell only with DASH closed.
