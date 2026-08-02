# DASH project state

Updated: 2026-08-01 (Wave 1 proven)

Portfolio sequence and estimates: [`../orchestratekit-mcp/docs/PORTFOLIO_ROADMAP_2026-08-01.md`](../orchestratekit-mcp/docs/PORTFOLIO_ROADMAP_2026-08-01.md).

## Outcome

DASH has crossed the installed first-run gate and the usefulness gate behind it. The packaged renderer, no-terminal sample handoff, build-identified runner, graceful shutdown, runner-hosted telemetry, Runs inspection and verdict are reproducibly proven on Windows; so, since MAR-457, is a cited digest a person would actually read.

**One Wave 0 claim was overstated and is corrected here.** "Artifact output" was proven only as *the agent wrote a file into its own folder* — smoke proof 6e was a directory listing. DASH had no artifact contract, table, view or surface, so nothing about that proof said DASH could show the result. MAR-457 built that seam and proves it end to end.

## Wave 0 - installed first-run reliability (proven 2026-08-01)

`pnpm verify` passed after the requested Windows restart: 51 test files, 843 tests, the real Electron renderer/preload path, exact runner build/protocol identity, pending-before-consent handoff, a new runner-hosted run in Runs, compliant verdict, digest artifact, confirmed process exit, and bounded Windows cleanup.

Implementation evidence: `05201e7`. Wave 0 is frozen; regressions belong in the mandatory smoke rather than a parallel proof path.

## Wave 1 - the shortest real agent loop (proven 2026-08-01)

**AI News Scout replaced the folder digest as the sample**, rather than shipping beside it: two samples would mean two first journeys and the undemonstrated one rots. `pnpm verify` passed at `c658667` — 53 test files, 878 tests, and 41 installed-shell proofs with no failures. Proof 6j read a live digest of 30 items from Google News, Hacker News and arXiv, every item cited, every citation traced to a source the run reported reading; 6k drew it on the run detail page.

The agent now **waits to be asked**. Its manifest always declared a manual trigger while its code ran at startup and every thirty seconds; those now agree, and proofs 6d/6e are negative checks that catch a regression back to a timer, which nothing else would.

Grounding is a **second verdict axis**, deliberately outside `RunAnalysis.compliant`: a missing citation must never render in the same red as an unapproved irreversible action. It verifies the digest against the run's own report of what it fetched, which is internal consistency, not independent proof a fetch happened — DASH does not see the network.

`network: read` is a **declaration DASH renders, not a boundary DASH enforces**. The runner strips the environment but spawns an ordinary process with ordinary network access, so every surface attributes the claim to the agent. Same honesty ADR 0002 requires of the draft-only Gmail boundary.

Four defects reached the installed smoke and none of them reached a unit test: no caller drained the artifact buffer, a runless task read as an unknown target, `observed_at` churned every five seconds against an exact-match check, and two proofs were themselves wrong. See ADR 0003 and MAR-457.

The third of those was repaired only for Run now, and **MAR-464 finished it**. `observed_at` was binding the identity of a *poll* while the check it fed needed the identity of a *decision context*; it now advances only when that context does. The Run now workaround is deleted rather than generalised — re-reading the snapshot before each command would have removed the "look again" check in front of an irreversible action and, less visibly, idempotency along with it, because the key is derived from `observed_at`. Proofs 3g and 3h are the paired guard. See ADR 0003 amendment 1.

MAR-455 landed `public_feed_fetch` in the registry. MAR-456 remains open; it is no longer a blocker, and no DASH copy claims the recommended MCP path leads here until it lands.

## Wave 2 - outside-app connections

Build MAR-458's permission broker, not a token pass-through. Google sign-in identifies the user; connector authorization separately grants Gmail/Calendar scopes. The broker owns refresh tokens and exposes narrow agent tools. Start Gmail read/search/draft-only: no send tool exists even if the provider scope could technically allow it. Support MCP connectors behind the same permission cards and audit trail. Reuse MAR-446 for BYO Google client onboarding.

**MAR-458's first slice is built.** The spawn path no longer delivers a provider
token: `deliverableSecretFields` cannot return an OAuth target, and
`assertNoBrokeredCredentials` refuses the spawn if one ever appears. An agent
reaches Gmail through `gmail.search` and `gmail.message.read` — two read
operations whose provider URL DASH constructs and whose response DASH projects —
and produces a **local** draft artifact. There is no send operation and no
provider-side draft creation, so `gmail.compose` grants no operation at all.

A grant is the intersection of three parties: DASH implements it, the manifest
declared it, the provider issued it. It is re-resolved on every call, so
disconnecting takes effect on an agent's next request rather than at its next
restart.

**Two things this slice does not claim.** The compiled Google client id is
*disclosed* on the capability card, not removed — BYO-client onboarding stays
after this slice, where ADR 0002's own rollout puts it. And the installed proof
runs against a loopback provider, because Google needs an account, a human at a
consent screen and a restricted-scope verification DASH does not have: proof 7
establishes the boundary, not Gmail's API.

See ADR 0002 amendment 1, which also corrects this ADR's account of the defect —
the raw-token path required a manifest to declare `technical.environment_name`
on its OAuth field, and no shipped example does.

## UX principle

The home view answers three questions: what can I run, what is happening now, and what needs my decision? Connections are capabilities with scopes and receipts, not a wall of OAuth settings. Every run should make inputs, actions, outputs, gates, and failures inspectable.
