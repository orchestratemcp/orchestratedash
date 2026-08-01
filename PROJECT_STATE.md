# DASH project state

Updated: 2026-08-01

Portfolio sequence and estimates: [`../orchestratekit-mcp/docs/PORTFOLIO_ROADMAP_2026-08-01.md`](../orchestratekit-mcp/docs/PORTFOLIO_ROADMAP_2026-08-01.md).

## Outcome

DASH has the main architecture: packaged renderer, no-terminal sample-agent flow, runner-hosted telemetry, OAuth connection modeling, and run inspection. Its largest gap is proof and lifecycle reliability, not missing screens.

## Wave 0 - installed first-run reliability

1. MAR-453: record handoffs as pending before consent and expire unanswered requests safely.
2. MAR-454: make the Windows shell journey a mandatory promotion gate.
3. MAR-451: identify runners by build and protocol; never adopt an incompatible process.
4. MAR-452: retire runners through authenticated graceful shutdown, never `TerminateProcess`.
5. Prove the existing MAR-423 sample flow end to end: add sample -> run -> stream live output -> show artifacts/verdict in Runs.

The first four changes are implemented in the current working tree and have focused test coverage. They remain `planned`, not `merged` or `proven`, until commit and installed proof exist.

## Wave 1 - outside-app connections

Build a permission broker, not a token pass-through. Google sign-in identifies the user; connector authorization separately grants Gmail/Calendar scopes. The broker owns refresh tokens and exposes narrow agent tools. Start Gmail read/search/draft-only: no send tool exists even if the provider scope could technically allow it. Support MCP connectors behind the same permission cards and audit trail.

ADR 0002 makes this a promotion boundary. MAR-446's browser/PKCE/vault flow is
implemented, but the current spawn path still delivers a general short-lived
OAuth token to the agent and the Google desktop client ID is compiled into DASH.
Therefore draft-only enforcement, a permission broker, and BYO-client onboarding
are not yet proven product capabilities.

## Wave 2 - useful agent loop

Turn the sample into **AI News Scout**: editable sources and schedule, visible live output, cited digest artifact, grounded verdict, and a clear permission receipt. Reuse the sample journey so the demo is the shortest real product path, not a showcase-only branch.

## UX principle

The home view answers three questions: what can I run, what is happening now, and what needs my decision? Connections are capabilities with scopes and receipts, not a wall of OAuth settings. Every run should make inputs, actions, outputs, gates, and failures inspectable.
