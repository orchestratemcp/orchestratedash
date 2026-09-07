# DASH agent foundation — local intent, status and evidence log

Source plan: `C:\Users\henri\Documents\DASH-agent-foundation-claude-plan.md`,
revision 2 (2026-09-07), approved by Henrik for execution the same day.
Epic: Linear MAR-886. Worktree `C:\Users\henri\Documents\DASH-agent-foundation`,
branch `codex/agent-foundation`, base master `cb2cb1c`.

This file is the local planned-intent record the plan asks for where Linear
cannot hold it, and the running evidence log for every stage. Git is
implementation truth; Linear is intent truth where an id exists; this file
fills the gap honestly and never invents ids.

## Linear coverage

| Stage | Linear | Note |
|---|---|---|
| Epic | MAR-886 | created 2026-09-07 |
| 1 SDK extraction | MAR-887 | created |
| 2 generator + recipe | MAR-888 | created |
| 3 traces | MAR-889 | created |
| 4 evals + installed proof | — | **blocked**: workspace free-issue limit reached 2026-09-07 16:44 |
| 5 portable packs / ProofPack | — | blocked, same |
| 6 Walrus prototype | — | blocked, same |
| 7 Starknet prototype | — | blocked, same |
| 8 funding dossier | — | blocked, same |

Owner action to lift the block: upgrade the Linear workspace or archive
closed issues; then the five sub-issues are filed from the acceptance text
below. Until then, stage 4–8 lifecycle is recorded here, and `state.json`
carries only the four real ids.

## Stage acceptance (verbatim intent for stages without an id)

**Stage 4 — evals and installed proof.** Four example evals exist and run
green as fixtures: normal input → agreed result; missing input → understandable
error/abstention; tool failure is found, not hidden; denied permission → no
disallowed broker operation. Deterministic checks and test doubles first; no
paid judge required. The real sample journey is proven in installed DASH:
create, review, run, inspect steps, open artifact, handle an error, stop
correctly — with revision, store and run ids. Doubles are not proof of a real
provider connection. A table says which property was proven where.

**Stage 5 — portable agent packages and ProofPack.** Versioned package format
(definition, runtime/template version, dependencies, selected artifacts, run
evidence); runnable export vs passive ProofPack a recipient verifies without
running agent code. Supported records and explicit exclusions listed; never
tokens, private keys, grants or admissions; imported history is history, not
consent. Local export/import first with preview; import inert until reviewed;
schema/version/size/path/file validation (archive bombs, traversal, symlink
escape); no install scripts from a package. Canonicalisation + hashing with
established standards and test vectors; bytes hashed; whole manifest bound;
integrity ≠ signature ≠ identity ≠ truth. Standalone verifier (no DASH, db or
server) reporting missing/changed files, unknown signing origin, incomplete
telemetry; how the expected digest/trusted key reaches the recipient is
defined. Signatures: established crypto, explicit trust model, domain
separation, version binding, key rotation; exporter/agent/runner/approver kept
separate. Narrow storage adapter (local disk + Walrus needs). Acceptance:
export from an isolated instance imports into a clean one with supported data
intact and permissions re-reviewed; the verifier accepts the original and
detects one changed byte and one missing file; a passive pack reviews without
code execution; exclusions documented exactly.

**Stage 6 — Walrus.** Read current official docs, verify versions; ADR on
digest vs blob id vs network vs storage period vs tx reference. Store/retrieve
synthetic ProofPack data on testnet where supported, reusing the sample
agent's artifact flow; no mandatory wallet in the first journey. Show bytes,
network, storage period, cost with source or "unknown", statuses; retry,
interruption, partial publication, renewal without automatic purchases. A
separate process retrieves and verifies against an independent reference;
record blob id, network, digest, date, SDK version, commands. Mock is named
mock. Document client-side encryption, key sharing, metadata exposure; only
synthetic public data. Minimal example without DASH. If endpoint/test tokens
are missing: local adapter done, blocker documented, not "proven". No token
purchase.

**Stage 7 — Starknet.** Map existing signer/session-permission solutions;
reuse; no own cryptography. Separate proposal / policy / approval / signing /
sending / receipt; keys never in LLM context, agent code, traces or packs;
local isolated environment and synthetic accounts first. Mandate fields
(network, contract, entrypoints, token/recipient, integer amount + decimals,
validity, call limit, revocation) and separate fee bounding; UI budget ≠
onchain budget. Prove which rules are account/contract-enforced vs DASH
policy; negative-test a direct bypass for anything marketed onchain-enforced;
one checkable operation. Approval bound to network/account/payload/policy
version; nonce/replay, concurrency, double-send, expiry, revocation;
reservation/settlement. Correlate run/span ↔ proposal ↔ approval ↔ tx hash;
real network states; refetch on restart. Tests: allowed, disallowed
recipient/operation, over limit, expired/revoked, replay. Standalone adapter
example + synthetic sample variant through the real runner/broker.
Acceptance: local deterministic run and, with testnet prerequisites, a real
testnet operation with correlated receipt plus a reproducible refusal. No
token purchase; no mainnet, customer funds or production mandates.

**Stage 8 — funding dossier** under `docs/funding/`: README (readiness table,
official vs assumed vs open), walrus-brief, starknet-brief, milestones-and-
budget, evidence-index, demo-script, ecosystem-and-competition,
adoption-and-business, licensing-and-release, security-and-operations.
Prepared for review; nothing submitted, posted or sent. No identity documents
or private company data in Git.

## Order and ownership

Stages 1–4 before any chain-specific change; 5 is the shared base; then 6,
then 7; 8 collected throughout. Each stage runs as its own lane (subagent) in
its own worktree with disjoint file ownership; the orchestrator owns this
file, `.orchestrate/state.json`, ADR numbers, integration and every
installed-runtime proof. Ownership per stage is recorded on the stage's
Linear issue or, for 4–8, in the lane's handoff under `docs/foundation/`.

## Evidence log

Entries are appended as stages land: date, commit, command, result, evidence
class (fixture / installed shell / real network), and what is NOT proven.

- 2026-09-07 — worktree created from cb2cb1c; `pnpm install --offline` done;
  `pnpm state:check` valid (96 drift warnings, all pre-existing). No product
  change yet.
- 2026-09-07 — stage 8 delivered for review: PR #355 (docs/funding/*, 12 files; lane F8, Opus). Evidence class: repository reads + web fetches, nothing runtime. Findings: Walrus Memory exists (pitch re-scoped to passive ProofPack); starkclaw exists (pitch re-scoped to the run↔tx join + enforcement table). Readiness: neither track ready; all stage 1–7 rows planned. Owner decisions: licence boundary; open the Walrus RFP list/docs in a real browser (fetcher 403).
- 2026-09-07 — stage 1 merged: PR #356 → master 1d7c4e7 (CI green). SDK file `agent-kit/template/dash-agent-sdk.mjs` (SDK_VERSION 1.0.0), ADR 0034, legacy fixture test, scratch-store smoke 85/85 (6a–6p incl. 6c-f: DASH stored `code/dash-agent-sdk.mjs` with its hash). Evidence class: fixture tests + installed-style shell on a scratch store. NOT proven: Henrik installed build (stage 4).
- 2026-09-07 — stage 3 merged: PR #357 → master 3e0f63f (CI green). Span side channel + run_spans (migration 38), run inspector tree, retrying fixture proves error+retry on the right step; scratch-store and CI smoke 86/86 incl. 6q. Evidence class: fixture + installed-style shell on a scratch store. NOT proven: Henrik installed build; no screenshot of the new section yet.
- 2026-09-07 — stage 2 merged: PR #358 → master cfbe48c (CI green). Recipe v1 behind every scaffolder, validated before write; AGENT_BUILDER.md + evals/ (4/4 on a real CLI scaffold); union with stage 3 caught SDK_VERSION drift via the recipe test. Evidence class: fixture + real generated agent under a real Supervisor + scratch-store smoke 85/85. NOT proven: Henrik installed build; assistant-customisation walk.
