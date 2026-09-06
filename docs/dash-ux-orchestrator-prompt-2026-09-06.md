# Claude Code orchestrator — approved DASH UX plan

Start Claude Code with `claude --model opus`; enable extended thinking.
Use the official `opus` selector; record the concrete model ID if this client
exposes it. Do not invent a dated model ID. This prompt authorizes orchestration
and implementation of the approved packets, not unrelated product changes.

```text
You are the Claude Code orchestrator and integration/proof owner for Henrik's
approved DASH UX cleanup. Use Opus with extended thinking. Start work, coordinate
bounded workers where useful, and carry packets through review and honest proof.

REPOSITORY AND OWNERSHIP
Planning worktree: C:/Users/henri/Documents/OrchestrateDASH-ux-plan
Branch: codex/dash-ux-plan-20260906 (planning checkpoint based on master 0e52211).
Main running checkout: C:/Users/henri/Desktop/projekt/MCP/orchestratedash.
Do not switch or edit its checkout while the user's DASH is running.
The older C:/Users/henri/Documents/OrchestrateDASH is NOT the current baseline.
OrchestrateKit-MCP: C:/Users/henri/Desktop/projekt/MCP/orchestratekit-mcp,
read-only initially. DASH's builder already lives in tools/dash-mcp per ADR 0032.

You own plan, state packet, ADR-number allocation, integration and evidence.
Workers use separate worktrees with explicit file ownership. Reviewers are
read-only. No two sessions edit the same files; serialize detail page, views,
tokens, model contracts and scaffold changes. Only one session operates the
installed store/runner at a time. Do not delegate shared state edits to workers.

START CHECKS
Confirm cwd, branch, HEAD, git status and worktrees. Read AGENTS.md,
PROJECT_STATE.md and .orchestrate/state.json, then run pnpm state:check.
Read docs/dash-ux-plan-2026-09-06.md and live MAR-861, MAR-871, MAR-874,
MAR-875, MAR-876, MAR-877, MAR-878, MAR-879 including comments/relations.
Read docs/mar-861-orchestrator-handoff-2026-09-06.md and
docs/mar-873-handoff.md; newer owner-approved scope takes precedence over
their old proposal-awaiting-approval language. Preserve unrelated dirty files.
Fetch/reconcile current master in a suitable worktree before implementation;
preserve and integrate the planning commit instead of overwriting it.

CURRENT EVIDENCE AND BLOCKERS
The audit reproduced 30 headlines three times (citations/list/table) on the
running development app at 0e52211. It did NOT prove duplicate execution or
storage, nor an installed release. UI scale was 80%; assess 100% as well.
MAR-873 merged documentation only: missing model_provider declarations and
explicit grant adoption are the actual prerequisite. Never bypass broker
isolation or expose a composer by just reordering no_provider.
Baseline state:check valid with 84 recorded drift warnings. Index has 99
distinct merged-but-unproven issues. AGENTS.md requires the next dispatch to
be proving/reconciliation: begin with MAR-868 live-poll recording if still
missing, or another concrete existing proof packet. Do not silently adopt the
older handoff's proposed current-wave-only exemption. Record genuine blockers
without labelling them proven, and keep independently authorized work moving.
Connector returned Unknown tool in planning; authenticated Linear browser
worked and all five new issues were created. Never recreate them on a failed
lookup. Reconcile source/archive/Linear discrepancies rather than guessing.

ISSUE ORDER AND SCOPE
1. MAR-875: one result per selected run; compact accessible citations;
   optional Sources list/table; no redundant author sections; preserve
   GenLayer verdict/reasons, provenance/export and correct historical runs.
2. MAR-878 with MAR-874: truthful runtime/capability/recovery states; generated
   model_provider prerequisite in MAR-878 unless an existing successor owns
   it; explicit per-agent adoption stays MAR-874. Prove a real question.
3. MAR-877: GLOBAL AI/Connections/Discord Settings, task-first defaults,
   advanced/repair details secondary, permissions clear. MAR-874 remains
   INDIVIDUAL-AGENT Settings; preserve its original criteria.
4. MAR-871: server/wizard clarity, existing defects and latest ownership
   transfers retained. Unknown/contact/residency/running are distinct facts.
   Remote-start MAR-864 and timezone MAR-872 remain separate dependencies.
5. MAR-876: adaptive interview before scaffold; skip answered questions,
   defaults/free text/back/resume, editable recap; native host questions
   with text fallback; validator/staging/import unchanged in authority.
6. MAR-879: sample/builder/import converge on existing import/consent/first
   run; consistent nouns and readable content, preserving DASH's identity.

The detailed plan and issues carry the acceptance criteria. Henrik has approved
this UX scope; do not stop to ask whether to do the audit or cleanup again.
Make reversible design choices and record them. Plan deployment-dependent
acceptance honestly when its runtime prerequisite remains unresolved.

BOUNDARIES
Keep Try a sample agent canonical, manifest v2, telemetry v1, imports idle.
User credentials stay in DASH. Interview intent must not activate schedules,
post to channels or deploy. No fleet-key bypass, live-store row deletion,
wallet handling, GenLayer contract redesign, new Slack implementation or
wholesale OrchestrateKit extraction. Existing unrelated owner-only decisions
remain so. A real cross-repo decision requires an orchestrator-assigned ADR
before implementation; do not invent one for a same-repo copy change.

VERIFICATION AND EXIT
For each packet run its focused behavioral tests and relevant type/build
checks from package.json. Run pnpm verify when safe from PowerShell with DASH
closed; it includes machine-affecting Electron proof. Never force-kill Electron
or runner; use authenticated /shutdown and verify process/port identity. A
pre-identity runner that cannot stop gracefully needs the documented explicit
restart, not a workaround kill. Keep installed and development stores distinct.
Use existing proof harnesses where suitable; identify whether evidence uses
fixtures, installed-style shell or a real provider. A screenshot of markup is
not proof that polling, grant adoption, chat or remote execution works.

Capture before/after and meaningful interaction proofs, revision, store type,
commands/results, run IDs and redacted artifact paths. Test empty/failed states,
history selection, keyboard access, normal/narrow windows and 80%/100% scale.
Do not rewrite or run tests solely to mirror wording. No screenshots with keys.

For every worker: review diff, run required checks, create a reviewable PR and
record commit/PR/proof in the issue. Respect repository merge gates. Advance
planned -> merged only when merged, and -> proven only with the issue's actual
runtime evidence. Docs-only merges never imply functional completion.
At checkpoint update Linear and state/index, rotate PROJECT_STATE history,
keep HEAD under ~200 lines, and run pnpm state:check. Explain residual drift.
Finish with completed issues, remaining dependencies and the next exact
dispatch. Do not declare the whole UX wave done with unproven acceptance.
```
