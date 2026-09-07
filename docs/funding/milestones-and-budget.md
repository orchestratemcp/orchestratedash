# Milestones and budget

**Draft for review. No money has been requested, received or spent against
this plan.** Written 2026-09-07.

## How to read this

Three funding classes, kept apart so that no work is ever counted twice:

- **A — already built.** Done and paid for. It is context for an application,
  never something to ask money for.
- **B — self-funded PoC.** Work we intend to do regardless of any grant. It is
  what makes an application credible. Asking a funder to pay for it after the
  fact would be double funding.
- **C — grant-funded.** Work that would not happen, or would happen far later,
  without funding. This is the only class an application may draw against.

Effort is given as a **range in person-days**, for a small team (assume one
developer with AI assistance unless `[TO FILL — Henrik]` says otherwise).
Ranges are wide on purpose: narrow estimates for unbuilt work are a way of
lying politely.

**Money.** This document does not state a day rate. The rate, and whether
Henrik's own time is costed at all, is `[TO FILL — Henrik]`. Every monetary
figure below is therefore either a third-party cost with a stated basis, or a
formula.

## A — Already built (context, not a funding ask)

Verified in the repository on 2026-09-07 at commit `620aa93`. Full evidence in
`evidence-index.md`.

| Item | Where | Evidence class |
|---|---|---|
| Local-first agent supervision product (Electron shell, installable) | repo root, ADR 0001 | shipped, installed proof exists in prior handoffs |
| Permission broker that never hands an agent a credential | ADR 0002, `tests/broker-threat-model.test.ts` | fixture tests + shipped |
| Frozen contracts: manifest v2, telemetry v1, run artifact/event | `contracts/`, `docs/telemetry-contract-v1.md` | shipped contracts |
| Agent generator and sample journey | `agent-kit/`, `tests/agent-kit.test.ts` (31 passed, 2026-09-07) | fixture tests |
| MCP tool that builds and stages an agent | `tools/dash-mcp`, ADR 0032 | shipped |
| Public-chain adjudication, proven on a real network | `lib/genlayer/**`, ADR 0033, `docs/mar-861-proving-handoff.md` | real network (GenLayer Studionet) |

**Funding ask for class A: none.**

## B — Self-funded PoC (before or alongside an application)

These are foundation-plan stages 1–5. They are being done because the product
needs them, not because a funder asked.

| # | Work package | Deliverable | Verification criterion | Effort (person-days) | Depends on |
|---|---|---|---|---|---|
| B1 | Stage 1 — extract shared runtime from the template | Agent template holds definition, task logic, tools and sample data; shared mechanics live in an internal module | A generated agent starts idle, runs on request, produces an artifact, reports correctly, acknowledges supported commands; an old fixture agent still works; no extra automatic model cost | 8–15 | — |
| B2 | Stage 2 — versioned, validated build recipe | Machine-readable recipe (template/runtime version, definition, required connections, I/O contract, acceptance cases) validated before any file is written | Invalid input, path traversal and existing target directory all refused; no user file silently overwritten; CLI and installed sample use the same generator | 6–12 | B1 |
| B3 | Stage 3 — real hierarchical traces in the existing run view | Minimal span model (run/trace id, span id, parent, name, times, status, structured error), size and retention bounded, secrets filtered before persistence | A real failure and a real retry appear on the right step with the right result; no secret markers in stored telemetry or UI; older runs render without regression; incompleteness shown as incompleteness | 10–18 | B1 |
| B4 | Stage 4 — example evals and installed proof | Four evals (normal input; missing input; tool failure surfaced; denied permission causes no broker operation) plus the sample journey proven in installed DASH | Evals green as deterministic fixtures with no paid judge required; installed run recorded with revision, store and run ids; a table stating which property was proven in which environment | 6–12 | B1–B3 |
| B5 | Stage 5 — ProofPack format + local export/import | Versioned pack format; runnable export separated from passive pack; preview of contents, size and sensitivity; inert import until reviewed | Export from an isolated instance imports into a clean one with supported data intact and permissions re-reviewed; archive bomb, traversal and symlink escape all refused; no install script executes | 10–20 | B1–B4 |
| B6 | Stage 5 — standalone verifier | Verifier with no DASH, no database, no server | Accepts the original pack; detects one changed byte; detects one missing file; reports unknown signing origin and incomplete telemetry as such; test vectors for canonicalisation published | 6–12 | B5 |

**Total class B: 46–89 person-days.** Third-party cash cost: effectively zero
beyond existing tooling (no new paid service is required by B1–B6).

**Funding ask for class B: none.** If a funder wants to fund it anyway, it
must be declared as retrospective and not re-counted in class C.

## C — Grant-funded work packages

Only these appear in an application. Each names the track it belongs to.

### Walrus track

| # | Work package | Deliverable | Verification criterion | Effort (person-days) | Depends on | Cash cost |
|---|---|---|---|---|---|---|
| C-W1 | Walrus storage adapter | Store and retrieve a pack; show bytes, network, storage period, cost with source or "unknown", upload/retrieve status; retry, interruption, partial publication, renewal — none automatic | Adapter test suite green; a local mock is labelled mock everywhere it appears | 8–14 | B5, B6 | testnet storage: see cost assumptions |
| C-W2 | Digest / blob-id / network / period ADR | Written decision on how pack digest, Walrus blob id, network, storage period and any transaction reference relate — they are not interchangeable identifiers | ADR accepted; the verifier's error messages match its vocabulary | 2–4 | C-W1 | none |
| C-W3 | Real testnet store + independent retrieval | A separate process fetches the pack from Walrus and verifies it against an independently supplied reference | Blob id, network, digest, date, SDK version and exact commands recorded as reproducible evidence; mutated pack rejected | 5–10 | C-W1 | testnet storage |
| C-W4 | Failure and expiry states | Network failure, expired or unavailable storage render as understandable states | Each state reachable in a test and visible in the UI; no automatic purchase on any path | 4–8 | C-W3 | none |
| C-W5 | Confidentiality documentation | Client-side encryption options, key sharing and recovery, metadata exposure, and the plain statement that deletion does not recall fetched copies | Written and reviewed; first network demonstration uses synthetic public data only | 3–6 | C-W1 | none |
| C-W6 | Minimal standalone example (no DASH) | Smallest program that produces or checks a pack, usable by another tool | Runs in a clean environment with no DASH present | 3–6 | B6 | none |
| **Walrus subtotal** | | | | **25–48** | | |

### Starknet track

| # | Work package | Deliverable | Verification criterion | Effort (person-days) | Depends on | Cash cost |
|---|---|---|---|---|---|---|
| C-S1 | Signer/session landscape review and choice | Written comparison of real enforcement properties and limits across the candidates named in `ecosystem-and-competition.md`; a decision to reuse | Decision recorded with the properties it depends on; no new cryptography written | 4–8 | — | none |
| C-S2 | Mandate schema and policy engine | Mandate fields (network, contract, entrypoints, token/recipient, integer amount + decimals, validity, call limit, revocation) and separate fee bounding | Tests: allowed operation, disallowed recipient, disallowed operation, over limit, expired, revoked, replay | 8–15 | C-S1 | none |
| C-S3 | Separated proposal / approval / signing / send / receipt | Each boundary is its own component; approval bound to network, account, payload and policy version | A change after review forces a new review; keys provably absent from LLM context, agent code, traces and packs | 8–15 | C-S2 | none |
| C-S4 | Enforcement table + direct-bypass negative test | Table of which rules the account/contract enforces vs which are DASH policy only, with a test that calls directly past DASH | The negative test fails if a rule advertised as on-chain is only app-side | 4–8 | C-S3 | none |
| C-S5 | Local deterministic run, synthetic accounts | Full flow in an isolated environment | Deterministic and repeatable; nonce/replay, concurrency, double-send-after-timeout, expiry and revocation all covered | 5–10 | C-S3 | none |
| C-S6 | Testnet operation with correlated receipt | One checkable operation on a test network plus a reproducible refusal | Run/span ↔ proposal ↔ approval ↔ tx hash correlated; real network states shown; receipt refetched after restart | 5–10 | C-S5 | testnet fees, no token purchase |
| C-S7 | Standalone adapter example + synthetic sample variant | Adapter usable without DASH; sample variant in the existing generator family, through the real runner and broker | Runs clean; no special demo path bypassing runner/broker | 4–8 | C-S5 | none |
| **Starknet subtotal** | | | | **38–74** | | |

### Shared, both tracks

| # | Work package | Deliverable | Verification criterion | Effort (person-days) | Cash cost |
|---|---|---|---|---|---|
| C-X1 | Documentation for external adopters | Format spec, verifier usage, adapter usage, written for someone who does not use DASH | A person outside the project follows it without asking us | 4–8 | none |
| C-X2 | Recorded demos, both tracks including failure cases | Two recordings per `demo-script.md` | Each recording shows the failure case, not only the happy path | 2–4 | none |
| C-X3 | Maintenance window after delivery | Bug fixes, dependency updates, answering adopters, keeping testnet artifacts alive | Named period, e.g. 3 months post-delivery | 6–12 | storage renewal (manual) |
| C-X4 | CI for the new surfaces | Verifier and adapter suites in CI, on the existing runner | Green on the repository's existing CI; no new paid CI tier assumed | 2–4 | none if existing CI suffices |
| C-X5 | External security review (optional, recommended before any production use) | Third-party review of the signing boundary, pack validation and mandate enforcement | A written report from someone who did not write the code | 0 (external) | see cost assumptions |

**Shared subtotal: 14–28 person-days**, plus the external review as cash.

## Totals

| Class | Person-days | Notes |
|---|---|---|
| A — already built | — | Not funded |
| B — self-funded PoC | 46–89 | Not funded |
| C — Walrus track | 25–48 | Grant-eligible |
| C — Starknet track | 38–74 | Grant-eligible |
| C — shared | 14–28 | Split proportionally if both tracks are funded; **never charged twice** |

If both applications were successful, C-X1..C-X5 is delivered once and its
cost is split, not billed to both. That rule is stated inside each application
draft too, so a funder can see it.

## Cost assumptions

Each with its basis, or marked unknown. No figure here is a quote.

| Cost | Basis | Status |
|---|---|---|
| Developer day rate | `[TO FILL — Henrik]` | unknown — every labour figure above is person-days, not money, for this reason |
| Walrus testnet storage | Storage on Walrus is bought for a number of epochs; pricing was **not verifiable** for this dossier because `docs.wal.app` returned HTTP 403 to our fetcher on 2026-09-07 | **unknown — must be read from a browser before any budget is submitted** |
| Walrus mainnet storage | Not applicable — mainnet is out of scope | n/a |
| Starknet testnet fees | Test network fees; no tokens are to be purchased. Availability of a faucet is `to check` | unknown, expected small |
| RPC access | Public endpoints assumed sufficient for a testnet PoC; a paid provider is only needed if rate limits bite | assumption, not verified |
| CI | The repository's existing CI is assumed sufficient. No new paid tier is budgeted | assumption |
| External security review | A meaningful review of a signing boundary and pack validation is a real market cost. No quote has been obtained | `[TO FILL — Henrik]` — obtain one quote before claiming a number |
| Legal / entity / accounting for a token-denominated grant | Depends on the applying entity | `[TO FILL — Henrik]` |
| Maintenance (C-X3) | Time, plus manual storage renewal. **Nothing in the design auto-renews or auto-purchases** | person-days above |

## The funding gap

**Starknet.** The programme ceiling is "up to $25,000 in STRK"
(<https://www.starknet.io/grants/seed-grants/>, read 2026-09-07). Whether
38–74 person-days of C-S work plus a share of C-X fits under that ceiling
depends entirely on the day rate, which is unfilled. The formula, so it can be
checked as soon as the rate exists:

```
Starknet ask  =  (C-S person-days + share of C-X person-days) x day rate
                 + testnet fees
                 + share of external review, if included
Gap           =  Starknet ask  -  25,000 USD (in STRK)
```

If the result is positive, the honest options are: reduce scope (drop C-S7,
deliver the adapter example later), self-fund the remainder, or state the gap
in the application rather than shrinking the estimate to fit. **Shrinking the
estimate to fit the ceiling is not an option.**

**Walrus.** No amount is disclosed by the programme; the page says only that
"the final agreement includes funding and a budget for the winning applicant".
The ask is therefore expressed as the C-W scope with its effort range and the
day rate, and the funder proposes the number. There is no gap to compute until
there is a figure to compute against.

**External security review** is the most likely single item to fall outside
either budget. If it does, the correct outcome is that the deliverable ships
labelled as un-reviewed — see `security-and-operations.md`. Tests are not an
audit.

## Token-valuation risk

The Starknet grant is denominated "up to $25,000 in STRK". Three consequences,
none of which this document tries to price:

1. **No exchange rate is assumed anywhere in this dossier.** Not for planning,
   not for the ask, not for reporting.
2. The USD value of a STRK-denominated award at the moment of disbursement,
   and at any later moment, may differ from the value at application. It can
   move either way. If the plan only works at one particular rate, the plan
   is wrong.
3. Selling, converting, or holding the token is a decision for Henrik and his
   accountant, with tax consequences this dossier does not attempt to
   describe. Nothing in this project buys, sells, or converts any token, and
   nothing automates it.

Walrus discloses no denomination, so the same risk is simply unknown there.

## What is not funded by anybody

Stated so that no reviewer can be surprised later: mainnet launch, customer
funds, custody, trading, automatic storage renewal, production signing, a
wallet product, a marketplace, a cloud control plane, full portability of all
agent memory, npm publication, and any licence change. Each of those needs its
own decision on a finished case.
