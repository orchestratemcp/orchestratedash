# Evidence index

Every claim this dossier makes, mapped to evidence that exists — or marked
`planned`, which means **nothing has been run and nothing is proven**.

Compiled 2026-09-07 by the stage 8 lane, in worktree
`C:\Users\henri\AppData\Local\Temp\wt-f8-s1`, branch
`000henrik/mar-886-funding-dossier`, based on commit `620aa93`.

## Evidence classes used here

| Class | Means |
|---|---|
| `repo` | The file or contract exists at the named path at the named commit. Verified by reading the repository. |
| `fixture` | A test suite passed. Deterministic, no real provider, no real network. |
| `installed` | The packaged/installed application was run and produced the result. |
| `real network` | A real network transaction or fetch happened, with an identifier that can be looked up. |
| `reported` | Someone else recorded the result in a handoff; this lane did not re-run it. |
| `planned` | Nothing exists. Not started, not proven, not partially true. |

**This lane ran no tests and no application.** It is a documentation lane. Any
row below that is not `repo` is either `reported` from a handoff in this
repository, or `planned`.

## 1. Claims about what exists today

| Claim | Evidence | Class |
|---|---|---|
| The agent generator is `create-dash-agent` 0.1.1, `private: true`, `license: UNLICENSED` | `agent-kit/package.json` at `620aa93` | `repo` |
| There is **no** LICENSE file at the repository root or one level below | `find . -maxdepth 2 -iname "LICENSE*"` returned nothing, 2026-09-07 | `repo` |
| The root package is `orchestratedash` 0.1.1, `private: true`, with no `license` field | `package.json` at `620aa93` | `repo` |
| Manifest v2 is a frozen contract | `contracts/agent.manifest.v2.schema.json`, plus `contracts/contract.lock.json` | `repo` |
| Telemetry v1 is a frozen contract | `docs/telemetry-contract-v1.md`, `contracts/run-event.schema.json`, `contracts/run-artifact.schema.json` | `repo` |
| The broker never gives an agent a credential | ADR 0002 (`docs/adr/0002-connection-permission-broker.md`); tests `tests/broker-threat-model.test.ts`, `tests/broker-spend.test.ts` exist | `repo` (existence); the tests' last run is `reported`, not re-run here |
| Artifact bytes and evidence handling exist and are covered | `lib/agent-dom/artifact-bytes.ts`, `lib/agent-dom/evidence.ts`; `tests/artifact-bytes.test.ts`, `tests/evidence-pull.test.ts`, `tests/run-artifact.test.ts` | `repo` |
| A GenLayer adjudication path exists | `lib/genlayer/{adjudicate,client,connection,payload,receipt,record,store,terms}.ts`; ADR 0033 | `repo` |
| A DASH brief was judged by model validators on a real public chain | `docs/mar-861-proving-handoff.md`: GenLayer Studionet, `evaluate_tx` `0x01f3b1df3f3f52584a918396f7eee2b85cf84eb6230adc2e743d830ad30d6877`, FINALIZED / SUCCESS / MAJORITY_AGREE, verdict REJECTED with two reasons, rendered as a receipt in the app. First judgement: `evaluate_tx` `0x7e374f0f5e88010908aa28321b5ba5cd161cfa2c35410ce26013f71405f933d7` | `real network`, `reported` — this lane did not re-run it. Studionet is described in that handoff as explicitly temporary |
| The DASH MCP builder exists | `tools/dash-mcp/` (README, src, template, tests, skills); ADR 0032 | `repo` |
| The agent kit test suite passed 31/31 | Reported in the source plan and in `docs/foundation/README.md`, run 2026-09-07 as `pnpm exec vitest run tests/agent-kit.test.ts` | `reported` |
| `pnpm state:check` passes with pre-existing drift warnings | `docs/foundation/README.md`, 2026-09-07 (96 drift warnings, all pre-existing) | `reported` |
| Third-party dependency licences | Read from `node_modules` in the main checkout, 2026-09-07: see `licensing-and-release.md` for the table | `repo` (read-only, main checkout) |

**Reproduction commands** for the rows above that a reviewer could re-run, from
a checkout at `620aa93` (this lane did not run them):

```text
pnpm exec vitest run tests/agent-kit.test.ts
pnpm exec vitest run tests/evidence-pull.test.ts tests/artifact-bytes.test.ts tests/run-artifact.test.ts tests/broker-threat-model.test.ts tests/broker-spend.test.ts
pnpm typecheck
pnpm state:check
```

## 2. Stage 1–7 acceptance items — all `planned`

The acceptance text is the foundation plan's own, condensed; the authoritative
wording lives in `docs/foundation/README.md` and the source plan. Every row is
`planned` as of 2026-09-07. The orchestrator replaces a row's evidence cell as
the stage lands; **nobody should mark a row proven from a merged PR alone** —
merged is not proven.

### Stage 1 — extract runtime, preserve behaviour (MAR-887)

| # | Acceptance item | Evidence | Class |
|---|---|---|---|
| 1.1 | A real generated agent starts idle | — | `planned` |
| 1.2 | It runs first only on request | — | `planned` |
| 1.3 | It produces an artifact | — | `planned` |
| 1.4 | It reports correctly | — | `planned` |
| 1.5 | It acknowledges supported commands | — | `planned` |
| 1.6 | An old fixture agent still works | — | `planned` |
| 1.7 | No extra automatic model cost is introduced | — | `planned` |
| 1.8 | The installed journey needs no npm, network install or extra Node install | — | `planned` |

### Stage 2 — LLM-friendly generator and build recipe (MAR-888)

| # | Acceptance item | Evidence | Class |
|---|---|---|---|
| 2.1 | A machine-readable, versioned recipe exists (template/runtime version, definition, required connections, I/O contract, acceptance cases) | — | `planned` |
| 2.2 | The recipe is validated before any file is written | — | `planned` |
| 2.3 | Invalid input, path traversal and an existing target directory are all refused; no user file is silently overwritten | — | `planned` |
| 2.4 | A code assistant can adapt a sample variant without touching the runtime | — | `planned` |
| 2.5 | Definition and manifest cannot drift apart unnoticed | — | `planned` |
| 2.6 | CLI and installed sample use the same generator | — | `planned` |
| 2.7 | The MCP integration contract is documented; the local fixture is not described as a live integration | — | `planned` |

### Stage 3 — real traces in the existing run view (MAR-889)

| # | Acceptance item | Evidence | Class |
|---|---|---|---|
| 3.1 | A real failure appears on the right step with the right result | — | `planned` |
| 3.2 | A real retry appears on the right step with the right result | — | `planned` |
| 3.3 | No secret markers appear in stored telemetry or in the UI | — | `planned` |
| 3.4 | Older agent runs render without regression | — | `planned` |
| 3.5 | Traces do not assert that a result is true | — | `planned` |
| 3.6 | Lost events, unknown parent, interruption, restart and old runs without spans are handled and shown as incomplete rather than invented | — | `planned` |
| 3.7 | Measured model consumption is distinguished from estimated | — | `planned` |

### Stage 4 — evals and installed proof (no Linear id)

| # | Acceptance item | Evidence | Class |
|---|---|---|---|
| 4.1 | Eval: normal input gives the agreed result | — | `planned` |
| 4.2 | Eval: missing input gives an understandable error or abstention | — | `planned` |
| 4.3 | Eval: a tool failure is found, not hidden | — | `planned` |
| 4.4 | Eval: denied permission produces no disallowed broker operation | — | `planned` |
| 4.5 | Deterministic checks and test doubles first; no paid LLM judge is required | — | `planned` |
| 4.6 | The real sample journey is proven in packaged/installed DASH: create, review, run, inspect steps, open artifact, handle an error, stop correctly | — | `planned` |
| 4.7 | A table states which property was proven in which environment | — | `planned` |

### Stage 5 — portable packages and ProofPack (no Linear id)

| # | Acceptance item | Evidence | Class |
|---|---|---|---|
| 5.1 | Export from an isolated instance imports into a clean instance with supported data intact | — | `planned` |
| 5.2 | Permissions require a fresh review after import; imported history is history, never consent | — | `planned` |
| 5.3 | A standalone verifier accepts the original package | — | `planned` |
| 5.4 | The verifier detects one changed byte | — | `planned` |
| 5.5 | The verifier detects one missing file | — | `planned` |
| 5.6 | A passive pack can be reviewed with no code execution | — | `planned` |
| 5.7 | Exclusions are documented exactly (what does not travel, and why) | — | `planned` |
| 5.8 | No tokens, private keys, grants or admissions are ever in a package | — | `planned` |
| 5.9 | Import is inert until the user has reviewed the agent | — | `planned` |
| 5.10 | Archive bombs, path traversal and symlink escape are refused; no install script runs from a package | — | `planned` |
| 5.11 | Canonicalisation and hashing use established standards with published test vectors; bytes are hashed and the whole manifest is bound | — | `planned` |
| 5.12 | Integrity, signature, trusted identity and truthfulness are reported separately | — | `planned` |
| 5.13 | How the expected digest or trusted key reaches the recipient is defined | — | `planned` |
| 5.14 | Signatures use established crypto with domain separation, version binding and key rotation; exporter, agent, runner and approver stay separate | — | `planned` |

### Stage 6 — Walrus prototype (no Linear id)

| # | Acceptance item | Evidence | Class |
|---|---|---|---|
| 6.1 | ADR on how pack digest, blob id, network, storage period and any transaction reference relate | — | `planned` |
| 6.2 | Store and retrieve synthetic ProofPack data on a test network | — | `planned` |
| 6.3 | Bytes, network, purchased/valid storage period, cost with source or "unknown", and upload/retrieve status are all shown | — | `planned` |
| 6.4 | Retry, interruption, partial publication and renewal are handled with no automatic purchase | — | `planned` |
| 6.5 | A separate process retrieves the pack and verifies it against an independently supplied reference | — | `planned` |
| 6.6 | Blob id, network, digest, date, SDK version and commands are recorded as reproducible evidence | — | `planned` |
| 6.7 | A mutated package is rejected | — | `planned` |
| 6.8 | Network failure and expired/unavailable storage produce understandable states | — | `planned` |
| 6.9 | Client-side encryption, key sharing/recovery and metadata exposure are documented; only synthetic public data in the first network demonstration | — | `planned` |
| 6.10 | A minimal example uses the verifier/adapter without DASH | — | `planned` |
| 6.11 | Any local mock is named mock | — | `planned` |
| 6.12 | The Walrus SDK version and network facts are verified against current official documentation | — | `planned` — **and note that `docs.wal.app` returned HTTP 403 to this lane's fetcher on 2026-09-07; a browser will be needed** |

### Stage 7 — Starknet bounded mandate (no Linear id)

| # | Acceptance item | Evidence | Class |
|---|---|---|---|
| 7.1 | Existing signer/session-permission solutions are mapped before technology is chosen; established solutions reused; no own cryptography | Candidates gathered 2026-09-07 in `ecosystem-and-competition.md` | `planned` (the mapping is started, the decision is not made) |
| 7.2 | Proposal, policy judgement, approval, signing, sending and receipt are separated | — | `planned` |
| 7.3 | Private wallet keys never reach LLM context, agent code, traces or export packages | — | `planned` |
| 7.4 | Mandate fields defined: network, contract, entrypoints, token/recipient, integer amount + decimals, validity, call limit, revocation | — | `planned` |
| 7.5 | Network fee bounding is documented separately; a UI budget is not called an on-chain budget | — | `planned` |
| 7.6 | It is proven which rules the account/contract enforces and which are DASH policy only | — | `planned` |
| 7.7 | A direct call past DASH is negative-tested for anything marketed as on-chain enforced | — | `planned` |
| 7.8 | Approval is bound to exact network, account, payload and policy version; a change after review forces a new review | — | `planned` |
| 7.9 | Nonce/replay, concurrent calls, double-send after timeout, expiry and revocation are handled; reservation/settlement used where concurrency could bypass a local limit | — | `planned` |
| 7.10 | Run/span correlates to proposal, approval and transaction hash | — | `planned` |
| 7.11 | Real network states are shown (submitted / pending / rejected / reverted / accepted) and a received transaction is not confused with a completed operation or with finality | — | `planned` |
| 7.12 | The receipt is refetched after a restart | — | `planned` |
| 7.13 | Tests: allowed operation, disallowed recipient/operation, over limit, expired/revoked mandate, replay — and no test passes merely because the UI hid a button | — | `planned` |
| 7.14 | A standalone adapter example and a synthetic sample variant run through the real runner and broker | — | `planned` |
| 7.15 | Local deterministic run, and — where testnet prerequisites exist without buying tokens — a real testnet operation with a correlated receipt plus a reproducible refusal | — | `planned` |

## 3. Claims in the dossier that rest on external sources

Every one of these was fetched on **2026-09-07** by this lane. A fetch failure
is recorded as a failure.

| Claim | Source | Result |
|---|---|---|
| Starknet Seed Grants: up to $25,000 in STRK, non-dilutive; MVP/PoC stage; rolling, reviewed in rounds, ~4 weeks; KYC/KYB mandatory; three-month plan; community involvement required; projects already live on Starknet with users are ineligible | <https://www.starknet.io/grants/seed-grants/> | fetched and read |
| Walrus RFPs: no amounts disclosed; open RFPs behind an Airtable link; review starts ~2 weeks after opening; RFPs stay open until a team is selected; criteria are technical strength, creativity, ecosystem engagement, team commitment | <https://www.walrus.xyz/rfp/> | fetched and read |
| Walrus positions itself as "The Verifiable Data Platform for AI Builders" and ships **Walrus Memory**, a portable, independently verifiable memory layer for AI agents | <https://www.walrus.xyz/> | fetched and read |
| Walrus is "A decentralized blob store using Sui for coordination and governance"; Apache-2.0 | <https://github.com/MystenLabs/walrus> | fetched and read |
| Walrus blob ids, storage epochs, pricing, encryption posture | <https://docs.wal.app/> and two sub-pages | **HTTP 403 Forbidden to this lane's fetcher.** `https://docs.walrus.site/` did not resolve (DNS). **No such fact is quoted in this dossier as verified** |
| SNIP-9 outside execution: status Review; `caller` (or `'ANY_CALLER'`), `nonce` preventing signature reuse, `execute_after`/`execute_before`, `calls`; SNIP-12 typed-data signature; "allows reentrancy" | <https://github.com/starknet-io/SNIPs/blob/main/SNIPS/snip-9.md> | fetched and read |
| Session keys on Starknet allow "specific function calls, time limits, and spending caps"; Argent named as a popular implementation. Post dated 2025-04-29 | <https://www.starknet.io/blog/session-keys-on-starknet-unlocking-gasless-secure-transactions/> | fetched and read |
| Cartridge Controller session policies name contract addresses and allowed methods, and token spend limits (hex, or `"*"` unlimited); expiry is not documented on that page and the enforcement location is not stated there | <https://docs.cartridge.gg/controller/sessions> | fetched and read |
| `starkclaw`: Starknet mobile agent wallet for bounded delegation — "Don't give an AI your wallet. Give it a *session key* with hard limits, and enforce those limits on-chain."; experimental; mobile app in demo mode with mocked interactions; MIT | <https://github.com/keep-starknet-strange/starkclaw> | fetched and read |
| Letta Agent File (`.af`): open standard for serialising stateful agents; contains model config, message history, system prompt, memory blocks, tool rules, environment variables, tools; "When you export agents with secrets, the secrets are set to `null`"; no signing or checksums mentioned; only Letta officially supports it | <https://github.com/letta-ai/agent-file> | fetched and read (`https://docs.letta.com/agent-file` returned 404) |
| OpenAI Agents SDK sessions: many storage backends; no documented cross-framework export format; no signing, checksums or audit trail documented | <https://openai.github.io/openai-agents-python/sessions/> | fetched and read |
| LangGraph persistence: checkpointers (thread-scoped) and stores (cross-thread); no documented cross-framework export format; no integrity or provenance verification documented | <https://docs.langchain.com/oss/python/langgraph/persistence> | fetched and read (`https://langchain-ai.github.io/langgraph/concepts/memory/` redirected to a page with no content) |
| SLSA provenance v1.0: in-toto statement, predicate `https://slsa.dev/provenance/v1`, `subject` + `digest`, `builder.id` as "the transitive closure of all entities that are trusted to faithfully run the build"; verification remains the consumer's responsibility | <https://slsa.dev/spec/v1.0/provenance> | fetched and read |
| Sigstore: cosign, Fulcio, Rekor; keyless signing where "the private key is discarded after a single signing"; OIDC identity; transparency log makes signing events publicly auditable | <https://docs.sigstore.dev/about/overview/> | fetched and read (`https://www.sigstore.dev/` returned only a loading page) |
| C2PA 2.1: manifests, assertions, claim signatures, hard bindings; "C2PA specifications SHOULD NOT provide value judgments about whether a given set of provenance data is 'good' or 'bad'" | <https://spec.c2pa.org/specifications/specifications/2.1/specs/C2PA_Specification.html> | fetched and read (after a 301 from `c2pa.org`) |
| A Starknet community forum thread proposing session keys as a standard interface for smart accounts | <https://community.starknet.io/t/snip-session-keys-for-smart-accounts/116132> | **found in search results only, not fetched.** Treated as a lead, not a source |

## 4. What this dossier deliberately does not claim

- No users, pilots, customers, partners, letters of support or traction. None
  exist.
- No revenue. Grants are not recurring revenue and are not counted as such
  anywhere in this folder.
- No Walrus or Starknet integration, prototype, transaction or stored blob.
- No security audit. `security-and-operations.md` says explicitly that tests
  are not an audit.
- No exchange rate for STRK, at any point.
- No screenshot or video of a Walrus or Starknet flow. None has been recorded.
  `demo-script.md` says so in its first line.

## 5. Screenshot and proof paths

Existing screenshot evidence in this repository is organised as
`qa-screenshots-<ticket>/` directories at the repository root (for example
`qa-screenshots-mar-861/`). Stage 6 and 7 demo captures, when they are made,
belong in the same shape — `qa-screenshots-mar-886-stage6/` and
`qa-screenshots-mar-886-stage7/` — and their exact paths are then written into
`demo-script.md` and into the rows above, replacing `planned`.

**No such directory exists today.**
