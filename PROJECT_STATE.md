# DASH project state

Updated: 2026-08-01

Portfolio sequence and estimates: [`../orchestratekit-mcp/docs/PORTFOLIO_ROADMAP_2026-08-01.md`](../orchestratekit-mcp/docs/PORTFOLIO_ROADMAP_2026-08-01.md).

## Outcome

DASH has crossed the installed first-run gate: packaged renderer, no-terminal sample handoff, build-identified runner, graceful shutdown, runner-hosted telemetry, Runs inspection, verdict, and artifact output are reproducibly proven on Windows. The next product gap is usefulness: turn that trusted loop into an agent someone would keep running.

## Wave 0 - installed first-run reliability (proven 2026-08-01)

`pnpm verify` passed after the requested Windows restart: 51 test files, 843 tests, the real Electron renderer/preload path, exact runner build/protocol identity, pending-before-consent handoff, a new runner-hosted run in Runs, compliant verdict, digest artifact, confirmed process exit, and bounded Windows cleanup.

Implementation evidence: `05201e7`. Wave 0 is frozen; regressions belong in the mandatory smoke rather than a parallel proof path.

## Wave 1 - the shortest real agent loop

Extend the existing MAR-423 sample path into **AI News Scout** without OAuth: editable public RSS/HTTP sources, manual run first and cadence second, visible live steps, source citations, a stable digest artifact, grounded/completed/failed verdicts, recovery copy, and a narrow `network: read` permission receipt. Reuse the installed smoke so this stays a product journey rather than a showcase branch.

## Wave 2 - outside-app connections

Build a permission broker, not a token pass-through. Google sign-in identifies the user; connector authorization separately grants Gmail/Calendar scopes. The broker owns refresh tokens and exposes narrow agent tools. Start Gmail read/search/draft-only: no send tool exists even if the provider scope could technically allow it. Support MCP connectors behind the same permission cards and audit trail.

ADR 0002 makes this a promotion boundary. MAR-446's browser/PKCE/vault flow is
implemented, but the current spawn path still delivers a general short-lived
OAuth token to the agent and the Google desktop client ID is compiled into DASH.
Therefore draft-only enforcement, a permission broker, and BYO-client onboarding
are not yet proven product capabilities.

## UX principle

The home view answers three questions: what can I run, what is happening now, and what needs my decision? Connections are capabilities with scopes and receipts, not a wall of OAuth settings. Every run should make inputs, actions, outputs, gates, and failures inspectable.
