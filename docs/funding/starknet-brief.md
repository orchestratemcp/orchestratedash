# Starknet Seed Grants application draft

**Draft. Not submitted. Not sent to anyone.** Written 2026-09-07 against
programme facts read the same day
(<https://www.starknet.io/grants/seed-grants/>). Re-check before use.

**Blocking gap, stated first.** The programme asks for "active Starknet
community involvement or prior hackathon/builder program participation"
(read 2026-09-07). We have none. This draft is complete so that it is ready
if that changes; filing it today would mean claiming something untrue.

Everything marked `planned` is not built. Everything marked
`[TO FILL — Henrik]` is a fact only Henrik has.

---

## One-liner

An open agent kit where a person gives an agent a bounded mandate — this
network, this contract, this operation, this much, until this time — and can
follow every transaction back to the run, the step and the approval that
produced it.

**This is our hypothesis, not a confirmed fit to any specific programme
priority.**

## The user problem

An agent that can act is more useful than one that can only write. An agent
that can act with your money is also how you lose your money.

The two answers on offer today are both bad for a non-developer:

1. **Give the agent a key.** Everything the key can do, the agent can do, and
   a prompt injection or a bad step does it at machine speed.
2. **Approve every action manually.** Which removes the reason for having an
   agent, and trains the person to click yes.

The third answer — a bounded mandate — exists in wallet tooling but is
addressed at game developers and DeFi users, not at the person who wants an
agent to do one small recurring paid thing. And even where the bound exists,
the person usually cannot answer the question that matters after the fact:
*which run, which step, which approval caused this transaction?*

Our contribution is that last part joined to the first: the bound **and** the
audit trail back into the run, in a product a non-developer already uses.

## Why this ecosystem

Because Starknet's account abstraction puts the enforcement in the account
rather than in the app. That is exactly the property this design needs: a rule
that only the UI enforces is not a rule, and we would rather negative-test a
bypass than market one.

Primary sources read 2026-09-07:

- **SNIP-9 (outside execution)**, status *Review*
  (<https://github.com/starknet-io/SNIPs/blob/main/SNIPS/snip-9.md>): an
  `OutsideExecution` struct with `caller` (restrictable, or `'ANY_CALLER'`),
  a `nonce` that "is used to prevent signature reuse across executions",
  `execute_after` / `execute_before` giving a "timestamp range in which the
  execution is allowed", and `calls`. It notes the implementation "allows
  reentrancy", which is a constraint we have to design around rather than
  ignore.
- **Session keys, official Starknet post** (published 2025-04-29, read
  2026-09-07,
  <https://www.starknet.io/blog/session-keys-on-starknet-unlocking-gasless-secure-transactions/>):
  session keys let a user grant scoped authority with "specific function
  calls, time limits, and spending caps", and names Argent as a popular
  implementation.
- **Cartridge Controller session policies**
  (<https://docs.cartridge.gg/controller/sessions>, read 2026-09-07):
  policies name contract addresses and allowed methods, and token spend
  limits (hex value, or `"*"` for unlimited). The page does not document
  expiry as a policy field and does not state whether enforcement is on-chain
  or client-side — an open question we must answer by reading code, not
  marketing.

The programme also asks that teams "plan to use/build on existing Starknet
tools". We intend to. Stage 7's rule is explicit: reuse an established
signer/session solution, document its real enforcement properties and limits,
and **write no new cryptography**.

**The honest part.** `starkclaw`
(<https://github.com/keep-starknet-strange/starkclaw>, read 2026-09-07) is an
MIT-licensed Starknet mobile agent wallet whose README states: "Don't give an
AI your wallet. Give it a *session key* with hard limits, and enforce those
limits on-chain." That is our sentence, written by somebody else. Its README
also says it is experimental, with the mobile app "in demo mode with mocked
interactions" and full Starknet integration incomplete. We are not going to
pretend it does not exist. The distinction we propose is in
`ecosystem-and-competition.md`; in short, they are building the wallet, and we
are building the join between a mandate and the agent run that used it, inside
a supervision product that already exists. If the right answer turns out to be
"use starkclaw's account contract and contribute upstream", that is a good
outcome and a cheaper one.

## The bounded solution

One operation, on a test network, whose effect can actually be checked. Not
arbitrary contract calls behind a selector allowlist — a selector list does
not make a call safe.

Six separated concerns, because collapsing any two of them is how these
systems fail:

1. The agent **proposes** an action.
2. Policy **judges** the proposal against the mandate.
3. The person **approves**, bound to the exact network, account, payload and
   policy version. A change after review requires a new review.
4. Signing happens **outside** the agent. Private keys never enter LLM
   context, agent code, traces, or an export package.
5. Sending, with nonce/replay, concurrency, double-send-after-timeout,
   expiry and revocation all handled.
6. The **receipt** is correlated back to run and span, and shows real network
   states — submitted, pending, rejected, reverted, accepted. A received
   transaction is not a completed operation and neither is finality.

The mandate itself names: network, contract, allowed entrypoints, token and
recipient where relevant, integer amount with decimals, validity period, call
limit, and revocation. Network fees are bounded separately and documented
separately.

### What we will not claim

- **A UI budget is not an on-chain budget.** The deliverable includes a table
  saying which rules the account or contract enforces and which are only DASH
  policy — and a negative test that calls directly, past DASH, for anything we
  describe as on-chain enforced. A test that passes because the UI hid the
  button is not a test.
- No mainnet, no customer funds, no custody, no production mandates, no
  trading, no token purchases. Synthetic accounts and a local isolated
  environment first.
- No own wallet product.

## Reusable deliverables (the ecosystem contribution)

| Deliverable | Reusable by | State |
|---|---|---|
| Mandate schema: the fields a bounded agent mandate needs, and which are enforceable where | Any agent tool on Starknet | `planned` (stage 7) |
| Standalone mandate adapter example (no DASH import) | Other frameworks | `planned` (stage 7) |
| Enforcement table + negative tests: account-enforced vs app-policy, with a direct-bypass test | Anyone marketing bounded agents | `planned` (stage 7) |
| Run ↔ proposal ↔ approval ↔ tx-hash correlation model | Any tool that must audit agent actions | `planned` (stage 7) |
| ProofPack: the pack that carries the whole trail to someone else | Cross-ecosystem | `planned` (stage 5) |

## The existing base (what is real today)

Verified in the repository on 2026-09-07 at commit `620aa93`:

- **A permission broker that never gives an agent a credential** (ADR 0002),
  with a threat model under test (`tests/broker-threat-model.test.ts`,
  `tests/broker-spend.test.ts`). Spending is behind a person's press
  (ADR 0016). This is the architecture a mandate needs, already load-bearing
  in a shipped product rather than proposed in a slide.
- **Frozen contracts** for manifests, run events and run artifacts
  (`contracts/`, `docs/telemetry-contract-v1.md`) — the correlation surface a
  transaction receipt has to attach to.
- **A shipped, proven public-chain integration.** `lib/genlayer/**`, ADR 0033:
  a DASH work product judged by model validators on GenLayer Studionet, with
  the verdict shown back in the app. Transactions
  `0x7e374f0f5e88010908aa28321b5ba5cd161cfa2c35410ce26013f71405f933d7` and
  `0x01f3b1df3f3f52584a918396f7eee2b85cf84eb6230adc2e743d830ad30d6877`
  (FINALIZED / SUCCESS / MAJORITY_AGREE; verdict REJECTED with two reasons) —
  `docs/mar-861-proving-handoff.md`. Different chain, different purpose. It is
  offered as evidence that the team ships real on-chain integrations and
  publishes negative results, not as Starknet work.
- **An agent generator and sample journey** (`agent-kit/`, 31 passing tests as
  of 2026-09-07) into which the synthetic Starknet sample variant would go —
  through the real runner and broker, not a special demo path.

**No Starknet code exists in this repository today.**

## Demo

**No recording exists yet, and no Starknet transaction has ever been made by
this project.** `demo-script.md` holds the flow to be recorded, including the
failure case: an operation the mandate refuses, shown refusing.

## Team

`[TO FILL — Henrik]` — team, allocation, background, prior shipped work.

`[TO FILL — Henrik]` — applying entity, and the address that would receive
STRK. See `applicant-checklist.md`; that address must be outside anything an
agent mandate can reach.

**Starknet community involvement: none today.** Stated plainly because the
programme asks for it and we do not have it.

## Risks

| Risk | Honest assessment |
|---|---|
| Eligibility | The community-involvement requirement is unmet. Whether it is a hard gate or a scoring factor is not stated on the page — an open question, not an assumption |
| "MVP or PoC" ambiguity | DASH is a working product; the Starknet part is not a PoC yet. If the programme means the chain-specific work, we are not eligible until stage 7 lands |
| Overlap with existing work | `starkclaw` targets the same sentence. Mitigation: scope to the run-to-transaction join, and prefer reuse or upstream contribution over duplication |
| Enforcement honesty | The whole value depends on truthfully separating account-enforced from app-policy. Getting this wrong would be worse than not shipping. Hence the direct-bypass negative test as an acceptance criterion |
| Key handling | Any path that puts a signing key near LLM context is a project failure, not a bug. Synthetic accounts only, isolated environment first |
| SNIP-9 status | Status *Review*, and it "allows reentrancy". Building on a moving standard is a real cost |
| Token valuation | The grant is denominated up to $25,000 **in STRK**. The rate at disbursement is unknown and this dossier assumes none. See `milestones-and-budget.md` |
| Four-week review | Roughly a month to a decision. No plan here depends on a faster answer |

## Next 90 days

Matches the programme's requirement for "a clear plan detailing how the grant
will be used within the next three months". All of it is `planned`.

- **Weeks 1–3.** Map existing signer/session tooling (Argent/Ready sessions,
  Cartridge Controller policies, SNIP-9 outside execution, starkclaw's account
  contract) and choose what to reuse. Deliverable: a written comparison of
  real enforcement properties, and a decision. No cryptography written.
- **Weeks 3–6.** Mandate schema and policy engine, with the proposal /
  approval / signing / sending / receipt boundaries separated. Tests for
  allowed operation, disallowed recipient, disallowed operation, over limit,
  expired mandate, revoked mandate, replay.
- **Weeks 5–8.** Local deterministic run against an isolated environment with
  synthetic accounts. The enforcement table is produced here, with the
  direct-bypass negative test.
- **Weeks 7–10.** Testnet operation, if the prerequisites exist without buying
  tokens: one checkable operation, correlated receipt, plus a reproducible
  refusal. If test tokens or an endpoint are unavailable, the local adapter is
  completed and the blocker is documented — the integration is not called
  proven.
- **Weeks 9–12.** Standalone adapter example, synthetic sample variant in the
  existing generator family, recorded demo including the refusal, and the
  three-month check-in report the programme asks for.

**Out of scope:** mainnet, customer funds, custody, trading, automated
strategies, production mandates, a wallet product, and any token purchase.

---

**Not submitted.** This file exists so Henrik can edit a draft instead of
writing one.
