# Security and operations

A proportionate threat model for the work stages 5–7 propose, written
2026-09-07. Proportionate means: sized to a local-first desktop product with a
small team and a test-network prototype, not to a custody platform.

> **Tests are not an audit.** Nothing in this document, and nothing in the
> repository's test suites, constitutes a security review. Where an external
> review is needed before production, it is named as such below.

## 0. What exists today, and what does not

Real today (ADR 0002, and tests in `tests/broker-threat-model.test.ts` and
`tests/broker-spend.test.ts`): a permission broker that **never hands an agent
a credential**, and spending that sits behind a person's press (ADR 0016).

`planned`, and therefore unprotected because unbuilt: everything about
packages, export, import, signing, verification and chain mandates. This
document describes the protections those features must ship with, not
protections that exist.

## 1. Imported code and data

The highest-risk surface in stage 5. An imported package is attacker-controlled
input that arrives looking like a gift.

| Threat | Control | State |
|---|---|---|
| Archive bomb (decompression exhausts disk or memory) | Bounded decompressed size and entry count, enforced during extraction, not after | `planned` |
| Path traversal (`../` escaping the import directory) | Every entry path resolved and rejected if it leaves the target | `planned` |
| Symlink escape | Symlinks refused outright in packages | `planned` |
| Executable payload running on import | **No install script, no code, ever runs from an imported package.** Import is data handling, not execution | `planned` |
| Import silently granting permission | Import is **inert** until the person reviews the agent. Imported history is history, never consent. Grants and admissions are not importable at all | `planned` |
| Malicious agent definition claiming capabilities | Declared, user-approved and actually-observed capability stay three separate things. A definition can never widen its own permission | existing principle (ADR 0002 / ADR 0008), applies to import — `planned` |
| Schema confusion / version downgrade | Schema, version and size validated before any content is trusted; unknown versions refused, not guessed | `planned` |
| Resource names or paths crafted to confuse the UI | Displayed names are treated as untrusted text | `planned` |
| A passive pack that is not passive | A ProofPack is reviewable with **no code execution**. If reviewing it requires running something, it is not a ProofPack | `planned` |

**Non-goal.** We do not attempt to determine whether imported *content* is
truthful. An import is inert data until a person decides otherwise.

## 2. Outgoing export

The mirror risk: an export is the easiest way to leak everything at once.

| Threat | Control | State |
|---|---|---|
| Credential, token or private key in a package | **Never included, by construction.** No token, private key, grant or admission is exportable. The broker's design helps here: an agent never holds a credential to leak | `planned`, on an existing foundation |
| Secret embedded in run telemetry or an artifact | Secret filtering happens before persistence (stage 3), so the export inherits filtered data rather than filtering at the last moment | `planned` |
| Person exports more than they realise | Export preview shows contents, size, and an explicit list of what is excluded and why — before the file is written | `planned` |
| Sensitive data published to public storage | First network demonstration uses **synthetic public data only**. Real user data is never the demo | `planned` |
| Metadata leak on public storage | A stored pack reveals its own existence, size and timing even if encrypted. Documented, not hidden | `planned` |
| Believing deletion is recall | **Removing a pack from DASH or destroying a key does not delete copies anyone already fetched.** Stated in the product, not only in a document | `planned` |
| Machine paths, user names or store ids inside an exported pack | Treated as leakage; checked before any pack leaves in a demo or an application | `planned` |

## 3. The signing boundary

Where the most damage can be done by getting the story slightly wrong.

**Four claims, kept separate at every layer — data model, verifier output,
and UI:**

1. **Integrity** — these bytes are the bytes the manifest names.
2. **Signature** — a particular key signed this manifest.
3. **Identity** — that key belongs to somebody we have reason to trust.
4. **Truth** — the work described is correct. **Nothing we build asserts
   this.**

Collapsing 1 into 2, or 2 into 3, is the standard failure of provenance
products. C2PA takes the same position for media: its specification says C2PA
"SHOULD NOT provide value judgments about whether a given set of provenance
data is 'good' or 'bad'"
(<https://spec.c2pa.org/specifications/specifications/2.1/specs/C2PA_Specification.html>,
read 2026-09-07). SLSA is equally explicit that verification against
expectations "remains the consumer's responsibility"
(<https://slsa.dev/spec/v1.0/provenance>, read 2026-09-07).

| Threat | Control | State |
|---|---|---|
| Circular verification — bytes and expected digest fetched from the same untrusted source | The trust model **must** define how an expected digest or trusted key reaches the recipient by an independent path. A verifier that does not is verification theatre | `planned` |
| Signature reused in another context | Domain separation and version binding in what is signed | `planned` |
| Key compromise with no way out | Key rotation designed in from the start, with a documented revocation path | `planned` |
| Confusing who signed | Exporter, agent, runner and approver identities stay separate. A signed export does **not** assert that a customer approved anything | `planned` |
| Over-claiming historical events | A signature over an export does not certify that every historical event in it is genuine. Existing approval events lack the identity binding that a "signed customer approval" claim would need | known limitation, stated |
| Home-grown cryptography | Established libraries and standards only. If Sigstore's model fits (cosign / Fulcio / Rekor, OIDC identity, ephemeral keys — <https://docs.sigstore.dev/about/overview/>, read 2026-09-07), prefer it over anything bespoke | `planned` |
| Transparency log as a privacy leak | A public log records that an export happened. Signing stays optional, and each option's trust and privacy trade-off is written down | `planned` |

## 4. Transaction policy (stage 7)

| Threat | Control | State |
|---|---|---|
| Private key reaching model context | Keys never enter LLM context, agent code, traces or export packages. Signing happens outside the agent, in a separate component | `planned` |
| A "limit" that only the UI enforces | An **enforcement table** states which rules the account or contract enforces and which are DASH policy only, plus a **direct-bypass negative test** calling past DASH for anything advertised as on-chain enforced | `planned` |
| Prompt injection causing an action | The agent only ever *proposes*. Policy judges, a person approves, and approval is bound to the exact network, account, payload and policy version. A change after review forces a new review | `planned` |
| Replay and double-send | Nonce handling, concurrency control, double-send-after-timeout, expiry and revocation all tested. Reservation/settlement where concurrency could otherwise slip past a local limit | `planned` |
| Mistaking submission for completion | Real network states shown: submitted, pending, rejected, reverted, accepted. A received transaction is not a completed operation and is not finality | `planned` |
| Unbounded fees | Network fees are bounded and documented **separately** from the mandate amount | `planned` |
| Overbroad allowlists | Scope limited to one operation whose effect can actually be checked. An arbitrary contract call is not made safe by appearing on a selector list. `ANY_CALLER` in SNIP-9 (<https://github.com/starknet-io/SNIPs/blob/main/SNIPS/snip-9.md>, read 2026-09-07) is exactly the kind of default that removes a bound quietly | `planned` |
| Reentrancy | SNIP-9 states its implementation "allows reentrancy"; any account interaction must be designed and tested against that | `planned` |
| Real funds at risk | Test networks and synthetic accounts only. No mainnet, no customer funds, no custody, no token purchase, no production mandate | scope rule |
| Grant funds reachable by an agent | The grant-receiving address is outside anything a mandate or session key can reach (`applicant-checklist.md`) | scope rule |

## 5. Limitations — stated, not buried

1. **We do not verify truth.** Every mechanism here checks bytes, signatures
   and policies. None checks whether the agent was right.
2. **A verifier can only be as good as the reference it is given.** If the
   recipient has no independent digest or trusted key, verification proves
   internal consistency and nothing else.
3. **Deletion is not recall.** Anything published is potentially permanent.
4. **Telemetry can be incomplete.** Lost events, unknown parents, restarts and
   old runs without spans are real. The product must render incompleteness
   rather than draw a complete-looking graph over a gap.
5. **A DASH-only rule is a DASH-only rule.** Anything not enforced by an
   account or contract is app policy and is labelled as such, everywhere.
6. **Studionet-class networks are temporary.** The existing GenLayer proof
   (`docs/mar-861-proving-handoff.md`) runs on a network its own operators
   describe as temporary; that evidence has a shelf life.
7. **The transitive dependency licence and vulnerability surface is
   unaudited** (`licensing-and-release.md`).
8. **No penetration test, no cryptographic review, and no formal verification
   has been performed on anything in this project.**

## 6. Incident and revocation path

Prepared, not exercised. Nothing below has ever been used, because there has
been nothing to use it on.

**Reporting.** A security contact must exist **before** any verifier or
adapter is published — a published verification tool with no disclosure route
is irresponsible. `[TO FILL — Henrik]`: the address, and who monitors it.

**If a signing key is compromised:**
1. Stop signing with it immediately.
2. Publish the revocation through whatever channel the trust model defined —
   which is why the trust model must define one *before* the first signature.
3. Packs signed before the compromise cannot be un-signed. State the affected
   window honestly rather than implying a clean cut.
4. Rotate, and re-issue only what genuinely needs re-issuing.

**If a mandate is being misused:**
1. Revoke the mandate. Revocation must work from the product, not only from a
   wallet.
2. Understand that a revocation that is only DASH policy stops DASH, not the
   chain. This is precisely why the enforcement table exists.
3. Preserve the run, proposal, approval and transaction correlation — that
   trail *is* the incident investigation.

**If a published pack turns out to contain something it should not:**
1. Stop distributing the digest and any reference to it.
2. Assume every copy already fetched is permanent.
3. Rotate any exposed credential immediately; a removed blob is not a rotated
   secret.
4. Write down how it got in, and add the check that would have caught it.

**If an imported package caused harm:**
1. It should not have been able to — import is inert and executes nothing. If
   it did, that is a design failure, not a user error, and the import path is
   disabled until it is understood.

## 7. What needs external review before production

Ordered by how much damage a mistake would do. **None of this has been
commissioned.**

| # | Area | Why an outsider is required |
|---|---|---|
| 1 | The signing boundary and trust model | The people who designed it are the worst people to find its circular-trust flaw |
| 2 | Package parsing and import validation | Parsing untrusted archives is a classic vulnerability class; a fresh adversarial eye is worth more than another test |
| 3 | Mandate enforcement, on-chain and in policy | The whole claim is "this bound holds". If it does not, users lose money |
| 4 | Any account or contract code, if we end up writing any | Cheapest fix: **do not write any.** Reuse an audited account |
| 5 | Secret filtering in telemetry and exports | A leak here is silent and permanent |

**Before production** means: before mainnet, before customer funds, before
production mandates, and before a verifier is presented as authoritative to
people who did not write it. Until that review exists, every deliverable is
labelled un-reviewed — including in any funding application. A grant that does
not stretch to a review does not change what the deliverable is; it changes
what we are allowed to call it.
