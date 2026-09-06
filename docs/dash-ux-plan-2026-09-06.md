# DASH: simplify the agent journey

Approved scope: Henrik, 2026-09-06. Planning only in this checkpoint.
Audit baseline: running development app from DASH master `0e52211`; source and live UI inspected. This is not installed-release proof. Linear reconciliation is recorded below after submission.

## Product journey

Describe -> adaptive interview -> editable plan -> build and validate -> import into DASH -> connect missing services -> first manual run -> optional channels, schedules and cloud.

Preserve Try a sample agent as the canonical first journey. Build with an assistant and Import an agent converge on the same import, consent and first-run controls. Keep manifest v2 and telemetry v1. Credentials stay in DASH; imports start idle. A requested schedule is intent until explicitly activated.

## Evidence and design rules

- Proof Scout presents the same 30 headlines as long inline citations, a collected-items list and a table. This establishes repeated rendering, not repeated execution or storage. `app/agents/detail/page.tsx:850` suppresses only the selected artifact; `app/_components/panel.tsx:190` exempts tables; `app/_components/digest.tsx:994` renders full citation titles.
- AI Settings puts repair before setup and always shows three advanced model rows. Connections puts five per-agent lapse notices above services. Servers repeats uncertain status and offers ambiguous actions. Notifications mixes alerts and chief chat with prominent credential replacement.
- Proof Scout is READY but cannot answer questions, beside OPEN CHAT. Runtime, capabilities and action availability need separate truthful states.
- The builder skill begins scaffold/edit/validate/install, with no interview. The host assistant owns question presentation; DASH MCP owns the build contract and validation.
- The app was at 80% scale. Small monospace base typography also contributes; do not silently reset user preferences. Preserve DASH's avatars and identity, improve report/chat readability.
- Default views answer what happened, what needs attention and what to do next. One primary action per section. Supporting records stay accessible. Never hide failed verification, permission consequences or emergency stop controls.

## Delivery packets and acceptance criteria

### UX-1 — One result per run (P1, MAR-875)

One briefing in Results; Sources (count) is an optional view with list/table alternatives; Activity holds execution detail. Compact accessible citations open the relevant source. Group artifacts by run. Remove empty already-shown sections. Changing history must never mix the selected run with the latest author panel. GenLayer verdict and actionable reasons remain beside the result; transaction and developer detail expand beneath it.

Acceptance: reproduce Proof Scout's 30-item case before; after, each representation has one deliberate place. Exercise empty, one-result, multi-run, rejected and pending-verdict states. Keyboard-accessible citations and source view; no loss of provenance, export or full-run access. Installed-style screenshot/recording evidence names revision, store and run IDs. Tests target run selection and deduplication behavior rather than snapshots of wording.

Ownership: agent detail, panel/output/digest rendering and related focused tests. Coordinate scaffold panel defaults with UX-2; no simultaneous edits.

### UX-2 — Adaptive DASH builder interview (P1, MAR-876)

Ask outcome, sources, desired result, trigger, allowed autonomy and destination only when unanswered. One question or two related questions at a time; suggested defaults, free text, back/change and resumable draft. Ask about VPS only when needed. Show one editable recap before build. Record unsupported requests explicitly. Use host-native questions with text fallback; do not assume MCP owns client UI. Reuse actual validator and existing staging/import tools. Never request secrets in chat or write installed agent folders.

Acceptance: vague request, fully specified request, edited answer, interrupted/resumed interview and unsupported feature each produce consistent validated plans. Fresh generated agent imports, stays idle, connects declared requirements and completes a first manual run. Planned route matches emitted execution. Interview does not activate schedule, post to a channel or deploy. Model-provider declaration follows the MAR-873 successor; explicit grant adoption remains DASH-owned.

Ownership: `tools/dash-mcp/**` and focused contract tests in DASH. OrchestrateKit-MCP is read-only initially. ADR 0032 already locates the DASH builder here; do not extract or duplicate it. Any later cross-repository change requires a numbered ADR allocated by orchestrator before implementation.

### UX-3 — Task-first Settings (P1, MAR-877 global; MAR-874 agent-specific)

Live reconciliation corrected the audit's initial grouping: MAR-874 is the individual-agent Settings page, not global Settings. MAR-877 owns global AI/Connections/Discord; MAR-874 retains its original acceptance and explicit grant adoption. Neither replaces the other.

Preserve the existing model grant-adoption scope. New setup: connect provider then choose model. Configured state: provider and default model summary; advanced routing collapsed. Repair is contextual or under Troubleshoot. Connections lead with services; lapse diagnostics summarized separately. Explain shared-agent permissions once at authorization. Use human display names with disambiguation. Channels/Discord distinguishes Alerts and Chat; retain separate credential and revocation semantics. Move credential replacement into management controls; keep stop/disconnect findable.

Acceptance: fresh/connected/expired provider states; import-before-connect and import-after-connect; explicit adoption grants the intended agent and a real question works. No fleet-key bypass. Keyboard navigation and collapsed-state persistence; sensitive values remain masked. Validate destination labels against actual supported Slack/Discord behavior; do not advertise unbuilt connectors.

### UX-4 — Clear server states and actions (P1, extend MAR-871)

Retain all nine existing defects and their proof obligations. One summary distinguishes last contact, residency, running state and last successful job. Unknown stays unknown. One refresh; precise labels for reboot policy, deployment, return home and disconnection. Replace indirect deployment wording with an honest route or functioning chooser. Preserve remote key-boundary explanations at relevant decisions.

Acceptance: never checked, unreachable, reachable idle, running, stopped and duplicate-server cases; consistent card/summary facts and unambiguous action scope. Prove available deploy/return flows. Runtime-dependent remote start and timezone fixes remain MAR-864/MAR-872 dependencies, never papered over with optimistic copy.

### UX-5 — Truthful readiness and recovery (P1, MAR-878, related to MAR-873)

Separate runtime availability, supported capabilities and unmet requirements. Direct agent chat appears only when supported; chief entry explicitly says Ask chief about this agent. Chief receives the relevant capability/refusal state and points to the same recovery as the page. Coordinate generated model-provider declarations with the real successor to MAR-873; MAR-873's merged documentation is not functional completion. Do not treat the old handoff's MAR-873b placeholder as a real issue identifier.

Acceptance: non-chat agent, model-required agent without grant, disconnected provider, stopped agent and fully configured agent yield consistent UI and chief explanations. A newly scaffolded agent completes the intended question flow after authorized connection/adoption. Test grant refusal paths; never read a fleet credential directly to conceal missing agent authorization.

### UX-6 — Unified onboarding and readable content (P2, MAR-879)

Agents page Add agent offers sample, assistant builder and folder import converging on existing import. Preserve deep links. Show missing requirements plus one next action after import. Standardize Results/Sources/Activity/Connections/Channels/Servers, remove repeated reassurance and raw identifiers from primary copy. Preserve brand while improving report/chat text size, width and typography; avoid a generic redesign. Author details and precise identifiers remain available when needed.

Acceptance: demonstrate all three entry paths without terminal steps inside DASH; representative novice can find result and next action without searching Settings. Review 100% and 80% scale, narrow and normal desktop windows, themes, keyboard focus and screen-reader names. Test current run, empty state and long content. UX-2 supplies the builder path; UX-1 and UX-3 stabilize shared terminology first.

## Sequence, ownership and proof

1. Read live Linear and current Git before dispatch. Five new issues MAR-875 through MAR-879 are filed; reuse them and existing MAR-871/MAR-874. MAR-861 carries the approved plan update. Preserve existing issue relationships and owners; no duplicate packets.
2. Apply AGENTS.md proven-debt rule literally: the next dispatch is proof/reconciliation when debt exceeds ten. Start with MAR-868's live-poll recording if still missing. The earlier handoff's proposed current-wave exemption is not an adopted AGENTS change.
3. UX-1 first implementation; coordinate UX-5/model declarations and UX-3 adoption. UX-4 can proceed independently except runtime-gated acceptance. UX-2 follows stable capability contracts; UX-6 integrates the whole journey.
4. Orchestrator owns plan/state/ADR numbering and integration. Workers use separate worktrees and explicit file ownership. One owner for installed-store/runtime proof; reviewers are read-only. Shared `app/agents/detail`, tokens, views, scaffold and state files must be serialized.
5. Keep planned -> merged -> proven explicit. Source tests, fixture captures, installed-style shell proof and real service proof are different evidence. Record each honestly. Never promote from code inspection alone.

Non-goals: GenLayer contract redesign, new Slack integration, automatic cloud activation, broker bypasses, deleting live-store rows, changing unrelated hackathon decisions, or completing the entire OrchestrateKit separation inside a UX packet.

## Linear filing ledger

Filed 2026-09-06 through the authenticated Linear browser after the connector returned Unknown tool. Created pages and issue-created confirmations verified: MAR-875 results; MAR-876 interview; MAR-877 global Settings; MAR-878 readiness; MAR-879 onboarding/readability. All Backlog/planned. High priority for MAR-875 through MAR-878; Medium for MAR-879. MAR-871 and MAR-874 received scope/approval comments; MAR-861 received the project plan and sequence. No product changes or lifecycle promotions.

Issue URLs: https://linear.app/martini-home/issue/MAR-875 through https://linear.app/martini-home/issue/MAR-879. Existing updates: https://linear.app/martini-home/issue/MAR-871 and https://linear.app/martini-home/issue/MAR-874. Epic: https://linear.app/martini-home/issue/MAR-861.
