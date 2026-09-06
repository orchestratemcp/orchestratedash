# DASH project state — HEAD

Updated: 2026-09-06. Approved UX plan and Linear filing; documentation only.

## Sources and history

Git is implementation truth; Linear is intent/ownership; ADRs are decisions;
tests and actual runtime proofs are evidence. `.orchestrate/state.json` is an
index. Previous HEAD preserved verbatim in
`docs/state-archive/PROJECT_STATE-2026-09-06-pre-ux.md`; earlier archives remain.
No historical lifecycle was promoted by this planning checkpoint.

## Product and journey

DASH is a local-first shell to add, run, inspect and trust agents without a
terminal. Preserve **Try a sample agent** as the canonical first journey.
Manifest input v2; runner telemetry v1. Development and installed stores differ.

Describe -> adaptive interview -> editable plan -> validated build -> DASH
import -> missing connections -> first manual run -> optional channels,
schedules and cloud. Credentials stay in DASH; imported agents start idle.

## Current baseline

Audit baseline: master `0e52211`, clean running checkout at
`C:/Users/henri/Desktop/projekt/MCP/orchestratedash`. The Documents checkout
`C:/Users/henri/Documents/OrchestrateDASH` is older and is not the running source.
This checkpoint: `codex/dash-ux-plan-20260906`, isolated worktree
`C:/Users/henri/Documents/OrchestrateDASH-ux-plan`.

Historical first-run/agent-loop proofs remain in the index and archives.
For Wave 3 read `docs/mar-861-orchestrator-handoff-2026-09-06.md` and live
MAR-861. Reconcile historical release/deadline/network statements before
runtime dispatch. MAR-862 builder and MAR-863 adjudication are recorded
proven; MAR-868 poll and MAR-865 VPS still need remaining specified proofs.
MAR-873's merged handoff is documentation only, not working model fallback.

## Approved UX work — all planned

Acceptance and ownership: `docs/dash-ux-plan-2026-09-06.md`.
Handoff: `docs/dash-ux-orchestrator-prompt-2026-09-06.md`.

| Issue | Scope |
|---|---|
| MAR-875 | One result per run; accessible sources; no triple rendering |
| MAR-876 | Adaptive interview before DASH MCP builds |
| MAR-877 | Global AI, Connections and Discord Settings |
| MAR-878 | Runtime/capability truth, chat recovery, provider prerequisite |
| MAR-879 | Sample/builder/import convergence, content and readability |
| MAR-871 | Existing server/wizard cleanup; approved additions on issue |
| MAR-874 | Existing agent Settings and explicit model-grant adoption |

Five issues created through authenticated Linear browser UI after connector
Unknown tool. MAR-861 received the plan update; MAR-871 and MAR-874 received
approved scope comments. Global Settings is separate from MAR-874.

## Dependencies and boundaries

- MAR-878 owns generated model_provider declaration unless an existing
  successor is found; MAR-874 owns explicit adoption under ADR 0013.
  Never read fleet credentials for an agent or merely reorder the gate.
- MAR-864 remote-start and MAR-872 timezone decisions remain separate.
  Unknown server state must never become a false healthy claim.
- ADR 0032 puts DASH builder in `tools/dash-mcp/**`. OrchestrateKit-MCP is
  read-only initially. Later cross-repo changes require an ADR allocated
  by orchestrator before implementation.
- Keep GenLayer rejection reasons and permission consequences accessible
  at relevant decisions; technical details can expand underneath.
- No live-store deletion, wallets, implicit cloud/schedule activation or
  new connector work is authorized by this UX scope.

## Proof and dispatch

Index after filing: 133 merged, 72 proven, 33 planned entries (not unique
issues). **99 distinct issues have merged entries and no proven entry.**
The AGENTS.md debt gate applies: next dispatch is proof/reconciliation,
preferably MAR-868's missing recording if still outstanding. The earlier
handoff's wave-only exemption was not adopted in AGENTS.md.

The audit reproduced UI repetition in a running development app, not an
installed release. Baseline state check valid with 84 recorded drift warnings.
This checkpoint changes planning documents/index only, with no product tests
or machine-affecting shell smoke claimed.

After required proving, prioritize MAR-875; coordinate MAR-878 with MAR-874
and MAR-877, then MAR-876 and MAR-879. MAR-871 is independent except its
runtime acceptance. One owner for shared files/state, separate worktrees,
one installed-runtime proof owner. Reviewers read-only.

Never force-kill Electron/runner; use authenticated `/shutdown` and verify
port ownership. On Windows run `pnpm verify` from PowerShell only when safe
with DASH closed; it includes machine-affecting shell smoke. Record revision,
store, commands and artifacts for planned -> merged -> proven transitions.
