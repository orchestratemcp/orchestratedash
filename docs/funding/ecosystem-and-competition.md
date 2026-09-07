# Ecosystem and competition

A primary-source review, **fetched 2026-09-07**, of the tooling nearest to
what stages 5–7 propose. Every entry names the URL and the date it was read.
Where a page could not be fetched, that is recorded instead of a quote.

The purpose is not to argue that we are unique. It is to decide, per area,
whether to **reuse**, **integrate**, or **build** — and to say what is left
that is specifically ours. A general agent shell with a token attached is not
a pitch, and this document is where that claim gets tested.

## Summary of the calls

| Area | Nearest existing work | Our call | Why |
|---|---|---|---|
| Agent state export/import | Letta Agent File (`.af`) | **Reuse the idea, do not rebuild it** | It solves runnable agent portability, and does it first. Our gap is elsewhere |
| Agent memory on decentralised storage | **Walrus Memory** | **Integrate; do not compete** | Walrus already ships agent memory. Overlapping it would be both redundant and a bad application |
| Framework session/memory persistence | OpenAI Agents SDK sessions, LangGraph checkpointers/stores | **Neither reuse nor compete** | Both are storage backends for continuity, with no export format and no integrity story |
| Build/artifact provenance | SLSA + in-toto attestations | **Reuse the model** | The subject/digest/predicate shape is the right shape. Reuse it rather than invent a new envelope |
| Signing and transparency | Sigstore (cosign / Fulcio / Rekor) | **Reuse where an identity model fits** | Key management is the hardest part of signing, and Sigstore already solved it for CI identities |
| Content provenance and its honesty discipline | C2PA | **Reuse the discipline, not the format** | C2PA is for media assets. Its refusal to make value judgements is the posture we want |
| Starknet bounded delegation | Argent/Ready session keys, Cartridge Controller policies, SNIP-9, `starkclaw` | **Reuse the account layer; build only the join** | Wallet-side bounded delegation exists and is better developed than anything we would write |

## 1. Agent portability and memory

### Letta — Agent File (`.af`)

Source: <https://github.com/letta-ai/agent-file>, read 2026-09-07.
(<https://docs.letta.com/agent-file> returned HTTP 404 the same day.)

An "open standard file format for serializing stateful AI agents". A `.af`
file carries "Model configuration, Message history, System prompt, Memory
blocks, Tool rules, Environment variables, Tools". Secrets are handled by
exclusion: "When you export agents with secrets, the secrets are set to
`null`". Only Letta officially supports the format today; the README allows
that "Other frameworks could also load in `.af` files if they convert the
state into their own representations."

**What it already does better than we would.** It is a real, published,
open format for moving a *running* agent between installations, and it was
first. Anyone proposing "portable agents" without acknowledging it is either
uninformed or hoping the reviewer is.

**What it does not do.** The README documents no cryptographic signing, no
checksums, and no integrity verification. So a `.af` file answers "can this
agent be reconstituted elsewhere?" and does not answer "is this file the one
that was exported, and did the work it describes actually happen?" It also
carries agent *capability* — a recipient who wants only to check a finished
result must accept a bundle containing tools and environment configuration.

**Call: reuse the idea, do not rebuild it.** If DASH ever needs runnable
agent export across ecosystems, `.af` is the thing to interoperate with, not
to replace. Our stage 5 contribution is the other half: the **passive** pack a
recipient verifies without running anything, with content integrity and an
explicit separation between integrity, signature, identity and truth.

### Walrus Memory

Source: <https://www.walrus.xyz/>, read 2026-09-07.

Walrus brands itself "The Verifiable Data Platform for AI Builders" and
advertises **Walrus Memory**: "Take your AI agent's memory anywhere with
Walrus Memory". It claims agent memory, conversations, checkpoints and
reasoning persist across sessions, that memory "stays independently
verifiable, so your agent can prove what it remembered", and that it is
portable "without migrations or vendor lock-in".

**This is the single most important finding in this document**, because it
sits directly on top of a naive version of our own Walrus pitch. If our
application had said "portable, verifiable agent memory on Walrus", we would
have been proposing their existing product back to them.

**What it does.** Continuity for the agent: what it remembers, following it
between applications.

**What is left.** Two things, and the Walrus brief stands or falls on them:

1. **The recipient who runs no agent.** Walrus Memory serves the agent.
   A passive ProofPack serves a third party — a colleague, a client, an
   auditor — who wants to check a finished deliverable and its evidence
   without adopting any agent platform, ours or anyone's.
2. **One digest binding a whole deliverable.** Memory is a stream. A work
   result is a bounded set: the output, the artifacts it cites, the run
   evidence, the agent definition and runtime version, bound together by a
   single manifest digest with published canonicalisation rules and test
   vectors, and a verifier that reports missing files and incomplete
   telemetry as such.

**Call: integrate, do not compete.** Walrus is the storage and availability
layer under our pack. If, on reading the open RFP list, the ecosystem's actual
want turns out to be agent memory, then the honest conclusion is that we
should not file the Walrus application — and `README.md` records that as a
real possible outcome.

### OpenAI Agents SDK — sessions

Source: <https://openai.github.io/openai-agents-python/sessions/>, read
2026-09-07.

Session memory is automatic: "Before each run: the runner automatically
retrieves the conversation history for the session and prepends it to the
input items. After each run: All new items generated during the run are
automatically stored in the session." Backends include SQLite, async SQLite,
Redis, SQLAlchemy, MongoDB, Dapr, server-managed OpenAI conversations, and an
encrypted wrapper.

The documented operations are `get_items()`, `add_items()`, `pop_item()` and
`clear_session()`. **No standardised export/import format, no cross-framework
compatibility layer, and no integrity, signing or audit mechanism is
documented.**

**Call: neither reuse nor compete.** This is storage plumbing for continuity
inside one framework. It is evidence for our problem statement, not a
competitor to it: the dominant agent SDK gives you nine ways to persist
history and no way to hand it to somebody who can check it.

### LangGraph — persistence

Source: <https://docs.langchain.com/oss/python/langgraph/persistence>, read
2026-09-07. (<https://langchain-ai.github.io/langgraph/concepts/memory/>
returned only a redirect page the same day.)

Checkpointers "persist a thread's graph state as checkpoints" for
thread-scoped memory, conversation continuity, human-in-the-loop workflows,
time travel and fault tolerance. Stores "persist application-defined key-value
data" across threads.

**No cross-framework export format is documented, and no integrity,
cryptographic verification or provenance mechanism for persisted state is
described.**

**Call: neither reuse nor compete.** Same conclusion as above, from the other
major framework. Two of the largest agent ecosystems have rich persistence and
no verifiable handover.

### What this section establishes

The frameworks solve *continuity*. Letta solves *runnable portability*.
Walrus Memory solves *portable verifiable memory for the agent*. **Nobody in
this list solves a bounded, passive, third-party-verifiable deliverable** —
the thing you hand to someone who was not there, does not use your tools, and
should not have to trust you. That is the gap stage 5 targets, and it is
narrow enough to be honest about.

## 2. Verification, provenance and signing

We should not invent a provenance format. Three mature bodies of work already
define how to say "this artifact, this digest, this signer, this much trust".

### SLSA provenance v1.0

Source: <https://slsa.dev/spec/v1.0/provenance>, read 2026-09-07.

Provenance is "the verifiable information about software artifacts describing
where, when and how something was produced", expressed as an in-toto statement
with predicate type `https://slsa.dev/provenance/v1`. `subject` identifies the
artifacts and `digest` carries the cryptographic hashes. The trust anchor is
`builder.id`, "the transitive closure of all entities that are trusted to
faithfully run the build". Crucially, provenance documents *what happened*;
verification against expectations "remains the consumer's responsibility", and
the provenance itself makes no claim that the build was secure or reviewed.

**Call: reuse the model.** A ProofPack is a build artifact with a strange
builder — an agent run. Subject + digest + predicate + a named builder
identity is exactly the right shape, and "the document does not certify the
result is good" is exactly the right disclaimer. Stage 5 should express the
pack manifest as an in-toto-shaped statement rather than a bespoke envelope,
unless a concrete incompatibility is found and written down.

### Sigstore

Source: <https://docs.sigstore.dev/about/overview/>, read 2026-09-07.
(<https://www.sigstore.dev/> returned only a loading page the same day.)

Three components: **cosign** (signing client), **Fulcio** (issues short-lived
certificates), **Rekor** (append-only transparency log). Keyless signing uses
ephemeral keys where "the private key is discarded after a single signing";
identity comes from an OIDC token, and Fulcio "verifies this token and issues a
short-lived certificate bound to the provided identity and public key". Rekor
means "signing events can be publicly audited" and lets an identity owner
"monitor the log to verify that their identity is being properly used".

**Call: reuse where an identity model fits.** Key management is the part of
signing that projects get wrong, and Sigstore removes it for identities that
map to an OIDC account. The obstacles are honest ones: a local, offline-first
desktop product does not automatically have an OIDC identity for the person
pressing the button, and a transparency log is public — logging every export
is a metadata leak. Stage 5 should therefore treat signing as optional and
pluggable, with the trust model written down for each option, rather than
mandating a scheme it has not tested.

### C2PA

Source:
<https://spec.c2pa.org/specifications/specifications/2.1/specs/C2PA_Specification.html>,
read 2026-09-07 (301 redirect from `c2pa.org`).

C2PA defines manifests (bundles of assertions, claims and signatures),
assertions (CBOR-based labelled statements), claim signatures, and hard
bindings (byte-range and box-based hashing, plus soft bindings via
fingerprints). And it is explicit about its limits: "C2PA specifications
SHOULD NOT provide value judgments about whether a given set of provenance data
is 'good' or 'bad'". Validators present cryptographically verifiable facts;
deciding trust stays a human judgement.

**Call: reuse the discipline, not the format.** C2PA targets media assets and
carries a lot of machinery we do not need. But its posture is the one our
verifier must adopt: report what is cryptographically checkable, refuse to
grade the content, and let the human decide. Our four separated answers —
contents intact / signature present / origin known / telemetry complete — are
that posture made concrete.

## 3. Starknet accounts, sessions and bounded delegation

This is the area where existing work is closest to our stage 7 pitch, and the
review has to be least flattering to us.

### SNIP-9 — outside execution

Source: <https://github.com/starknet-io/SNIPs/blob/main/SNIPS/snip-9.md>,
read 2026-09-07. **Status: Review.**

An `OutsideExecution` struct lets a protocol submit a transaction on behalf of
a user account. Its fields: `caller`, which "can be used to restrict which
calling contracts can initiate this execution, although a special address
`'ANY_CALLER'` can be used to allow every caller"; `nonce`, which "is used to
prevent signature reuse across executions and doesn't need to be incremental
as long as it's unique"; `execute_after` / `execute_before`, a "timestamp
range in which the execution is allowed"; and `calls`. Signature verification
uses SNIP-12 typed data. The spec notes the implementation "allows
reentrancy".

**Relevance.** Time-bounding and replay protection are already specified at
the protocol level. `ANY_CALLER` is the kind of default that quietly removes a
bound — exactly the sort of thing our enforcement table must expose rather
than paper over. And "allows reentrancy" is a real design constraint to test
against, not a footnote.

### Session keys — official Starknet position

Source:
<https://www.starknet.io/blog/session-keys-on-starknet-unlocking-gasless-secure-transactions/>,
published 2025-04-29, read 2026-09-07.

Session keys let a user delegate limited authority under "predefined rules
(e.g., limited to certain functions, time duration, or spending caps)", with
Argent named as "a popular implementation of session keys on Starknet,
offering developers an API to integrate session-based transactions
seamlessly". The post frames the constraints as security features: a session
key "has a controlled lifespan, preventing abuse".

**Relevance.** The mandate concept exists and is officially endorsed. We are
not introducing bounded delegation to Starknet; we are proposing to consume it.

### Cartridge Controller — session policies

Source: <https://docs.cartridge.gg/controller/sessions>, read 2026-09-07.

Policies pre-approve interactions so that "games can execute transactions
seamlessly without requesting approval for each interaction". A policy names
contract addresses and their allowed methods, and token approvals support
spending limits given in hexadecimal — or `"*"` for unlimited.

**Two open questions from that page.** Expiry is not documented there as a
policy field, and the page does not state whether enforcement is in the account
contract or client-side (it references a paymaster and gasless transactions).
Both must be answered by reading the contracts, not the marketing — and that
is precisely the kind of question our enforcement table exists to answer in
public.

### starkclaw

Source: <https://github.com/keep-starknet-strange/starkclaw>, read 2026-09-07.
Licence MIT.

A Starknet mobile agent wallet "built for bounded delegation: session keys,
policy guardrails, and audit trails". Its README states: "Don't give an AI
your wallet. Give it a *session key* with hard limits, and enforce those limits
on-chain." It describes on-chain policy enforcement (spending limits, expiry
windows, contract allowlists) implemented in account contract logic, a split
key architecture separating an owner key from a session key, and
defence-in-depth across on-chain checks, signature binding and remote signer
hardening. It also states it is **experimental software**, with the mobile app
"in demo mode with mocked interactions" and full Starknet integration
incomplete.

**This is the closest existing project to our stage 7 sentence, and it is
better positioned on the wallet side than we would be.** It is on-chain-first,
MIT, and inside the Starknet ecosystem's own organisation.

**Call: reuse the account layer; build only the join.** Three consequences we
accept in advance:

1. Stage 7's first work package is a *decision*, not an implementation. If
   starkclaw's account contract or Argent's sessions fit, we consume one of
   them. Writing our own account logic would be slower, less safe, and less
   welcome in the ecosystem.
2. If the right outcome is a contribution to starkclaw rather than a parallel
   project, that is a **good** outcome and cheaper for everyone. The Starknet
   brief says so.
3. What is genuinely left for us is not the mandate primitive. It is the
   **join**: transaction hash ↔ receipt ↔ approval ↔ run ↔ span ↔ the artifact
   the agent produced, surfaced in a supervision product a non-developer
   already uses, with an explicit table of which rules are account-enforced and
   which are only app policy, backed by a direct-bypass negative test. None of
   the sources above publishes that table for its own rules.

### A lead, not a source

A Starknet community forum thread proposing session keys as a standard
interface for smart accounts
(<https://community.starknet.io/t/snip-session-keys-for-smart-accounts/116132>)
appeared in search results on 2026-09-07 but was **not fetched**. It is listed
here so the stage 7 lane reads it; nothing in this dossier relies on it.

## 4. So what is specifically ours

Stated as narrowly as the evidence allows, after everything above:

1. **A passive, third-party-verifiable deliverable pack** — for a recipient
   who runs no agent, adopts no platform, and should not have to trust the
   sender. Adjacent work serves the agent's continuity; this serves the
   recipient's scrutiny.
2. **A verifier that reports four separate answers** — contents intact,
   signature present, origin known, telemetry complete — and refuses to grade
   the work itself.
3. **The join between a chain operation and the run that caused it**, inside a
   local-first supervision product where a non-developer can actually see it.
4. **A published enforcement table with a bypass test** — saying which rules
   the chain enforces and which are only ours, and proving it by calling past
   our own software.

Each of those is `planned`. None is built. That is the honest state, and it is
why `README.md` says neither track is ready to apply today.

## 5. What would change these calls

- If the open Walrus RFP list asks for agent memory, the Walrus application
  should not be filed as drafted.
- If starkclaw or Argent sessions already expose the run-correlation join,
  stage 7's contribution shrinks to documentation and a bypass test — and the
  Starknet application should shrink with it rather than pad itself.
- If Letta's `.af` gains signing and integrity, the passive-pack case narrows
  to the recipient-who-runs-nothing scenario, and should be re-argued on that
  alone.
- If `docs.wal.app` becomes readable and its facts contradict anything assumed
  here, this document is wrong and gets corrected before any application.
