# Walrus application draft

**Draft. Not submitted. Not sent to anyone.** Written 2026-09-07 against
programme facts read the same day (<https://www.walrus.xyz/rfp/>,
<https://www.walrus.xyz/>). Re-check before use — and before use, read the
open RFP list, which the public page does not show.

Everything marked `planned` is not built. Everything marked
`[TO FILL — Henrik]` is a fact only Henrik has.

---

## One-liner

An open format and a standalone tool that let an AI agent hand over a
verifiable work result — the output plus the evidence it rests on — through
Walrus, so a recipient can check it without trusting, running, or even having
the agent platform that produced it.

**This is our hypothesis about a fit, not a confirmed answer to any RFP.** No
matching open RFP has been verified.

## The user problem

Somebody runs an agent. The agent produces something: a summary, a data pull,
a filled-in document, a decision. Then they have to give that result to
someone who was not there.

Today the recipient gets a file and a story. There is no way to check that the
file is the one the run produced, that the evidence cited in it exists, or
that nothing was edited on the way over. The agent platform can show a nice
run view — but only to people inside that platform, and only while the
platform still exists and still has the run.

So the trust boundary is the platform. Leave the platform, lose the proof.
That is a bad deal for the person who has to act on the result, and it is a
bad deal for the person who produced it, because their good work is
indistinguishable from a plausible fabrication.

Three concrete shapes of the same problem:

1. A person hands an agent's research to a colleague or a client who does not
   use the same tool.
2. A team migrates between agent platforms and loses the history that made
   past results defensible.
3. Someone needs to check, six months later, whether the thing the agent said
   it did is what it actually did.

## Why this ecosystem

Because the missing piece is availability plus independent verifiability of
the bytes, and that is what Walrus is for. Walrus states that "Data on Walrus
is independently verifiable, meaning anyone can confirm it is correct and
unaltered without trusting the provider storing it"
(<https://www.walrus.xyz/>, read 2026-09-07).

A verifiable work result needs exactly two things we cannot provide by
ourselves: somewhere the bytes live that neither party controls, and a way for
a recipient to fetch them without our software. Local disk plus email gives
neither.

**The honest part.** Walrus already ships **Walrus Memory**, "a portable
memory layer for AI agents" — memory that "stays independently verifiable, so
your agent can prove what it remembered" (<https://www.walrus.xyz/>, read
2026-09-07). We are not proposing to build that, and we would be wrong to
pretend we had not seen it. The distinction we propose is in
`ecosystem-and-competition.md` and is repeated here because it decides whether
this application is worth filing at all:

- Walrus Memory is about an agent's **continuity** — what it remembers, moving
  with it.
- What we propose is about a **finished deliverable's defensibility** — a
  passive pack a third party who runs no agent can verify, whose contents are
  bound together by one manifest digest, and whose verifier is a small
  standalone program.

If the RFP list turns out to want the first thing, this application should not
be filed. That is a real possible outcome and the dossier says so.

## The bounded solution

Not a framework. Four small pieces, each of which has to be useful alone:

1. **ProofPack** — a versioned, passive package format: the work result, the
   artifacts it cites, the run evidence, the agent definition and runtime
   version, and a manifest that binds all of it by content digest. Passive
   means a recipient reviews it without executing any code from it.
2. **A standalone verifier** — a program with no dependency on DASH, its
   database, or any server. It reports: which files are missing, which bytes
   changed, whether the signing origin is known, and where the telemetry is
   incomplete. It is required to say "incomplete" rather than draw a tidy
   graph over gaps.
3. **A narrow Walrus storage adapter** — store a pack, retrieve a pack. Shaped
   by local disk plus Walrus, not a generic multi-chain abstraction.
   Portability has to work with no chain at all.
4. **A mandate/adapter example that does not import DASH** — the smallest
   program that produces or checks a pack, so another tool can adopt the
   format without adopting us.

### What we will not claim

- A signature does not make the contents true. Integrity, signature, trusted
  identity and truthfulness are four separate claims and the verifier reports
  them separately. C2PA takes the same position for media: its own
  specification says C2PA "SHOULD NOT provide value judgments about whether a
  given set of provenance data is 'good' or 'bad'"
  (<https://spec.c2pa.org/specifications/specifications/2.1/specs/C2PA_Specification.html>,
  read 2026-09-07). We adopt that discipline for agent work.
- A verifier that takes both the bytes and the expected digest from the same
  untrusted place proves nothing. How the expected digest or trusted key
  reaches the recipient is part of the design, not an afterthought.
- Deleting a pack from DASH does not delete copies anyone already fetched.
- No mandatory wallet or chain connection in a first user journey.

## Reusable deliverables (the ecosystem contribution)

| Deliverable | Reusable by | State |
|---|---|---|
| ProofPack format specification with test vectors | Any agent tool | `planned` (stage 5) |
| Standalone verifier, no DASH, no database, no server | Any recipient | `planned` (stage 5) |
| Walrus storage adapter (store / retrieve / status) | Any producer of packs | `planned` (stage 6) |
| Minimal example that uses verifier + adapter without DASH | Other frameworks | `planned` (stage 6) |
| ADR on how pack digest, Walrus blob id, network, storage period and any transaction reference relate — they are not interchangeable identifiers | Anyone building on Walrus | `planned` (stage 6) |

## The existing base (what is real today)

Verified in the repository on 2026-09-07 at commit `620aa93`:

- **Frozen contracts.** `contracts/agent.manifest.v2.schema.json`,
  `contracts/run-event.schema.json`, `contracts/run-artifact.schema.json` and
  `docs/telemetry-contract-v1.md`. Run evidence already has a defined shape;
  ProofPack does not start from nothing.
- **Artifact and evidence handling.** `lib/agent-dom/artifact-bytes.ts` and
  `lib/agent-dom/evidence.ts`, covered by `tests/artifact-bytes.test.ts`,
  `tests/evidence-pull.test.ts` and `tests/run-artifact.test.ts`.
- **A permission broker an agent cannot go around** (ADR 0002). The broker
  never hands an agent a credential. That is the property that makes a pack
  safe to export: there is no credential in the agent's reach to leak into one.
- **A real public-chain integration already shipped and proven.**
  `lib/genlayer/**` and ADR 0033: a DASH work product was published to an
  intelligent contract and judged by a committee of models on GenLayer
  Studionet, with the verdict rendered back in the app. Transaction
  `0x01f3b1df3f3f52584a918396f7eee2b85cf84eb6230adc2e743d830ad30d6877`,
  FINALIZED / SUCCESS / MAJORITY_AGREE, verdict REJECTED with two stated
  reasons (`docs/mar-861-proving-handoff.md`). It is a different chain and a
  different purpose — it is offered as evidence that this team ships real
  network integrations and reports honest negative results, not as Walrus work.
- **An agent generator and a sample journey** (`agent-kit/`, 31 passing tests
  in `tests/agent-kit.test.ts` as of 2026-09-07), and an MCP tool that stages
  an agent build (`tools/dash-mcp`, ADR 0032).

## Demo

**No recording exists yet. Nothing has been stored on or retrieved from any
Walrus network.** `demo-script.md` contains the flow that would be recorded,
including the failure case (a mutated pack that the verifier rejects), and
names the screenshots and recording that will be needed.

The demo we intend, once stage 6 lands:

1. The sample agent produces a real result in DASH.
2. The user reviews and exports a ProofPack. The preview shows contents, size
   and what is excluded.
3. The pack is stored on a Walrus test network. Bytes, network, storage
   period, and cost-with-source-or-"unknown" are shown.
4. A **separate process** retrieves it and verifies it against an
   independently supplied reference. Blob id, network, digest, date, SDK
   version and the exact commands are recorded.
5. One byte is changed. Verification fails, and says which file and why.

## Team

`[TO FILL — Henrik]` — who is on the team, allocation, relevant background,
and prior shipped work that may be shown. One developer plus AI assistance is
an honest answer if it is the true one; the budget in
`milestones-and-budget.md` is written for that shape.

`[TO FILL — Henrik]` — applying entity (person or company). See
`applicant-checklist.md`.

**Ecosystem engagement: none today.** Walrus lists ecosystem engagement as one
of four evaluation criteria. We have no Walrus or Sui community history. This
is a real weakness and is not disguised.

## Risks

| Risk | Honest assessment |
|---|---|
| Walrus Memory already covers the adjacent need | Real. If the RFP wants agent memory, our fit is poor. Mitigation is scope: passive third-party-verifiable deliverables, not agent continuity |
| We could not read the Walrus technical docs | `docs.wal.app` returned HTTP 403 to our fetcher on 2026-09-07. Any pricing, epoch or encryption statement must be re-verified from a browser before this draft is finalised |
| No matching open RFP verified | The RFP list is behind an Airtable link that this dossier did not open. Applying without reading it would be guessing |
| Storage cost and renewal | Storage is bought for a period. Nothing in our design may auto-purchase or auto-renew. Expiry must render as an honest state, not a silent gap |
| Metadata exposure | A pack on public storage exposes its own existence, size and timing. First network demonstration uses synthetic public data only |
| Verification theatre | The easy failure mode is a verifier that always says OK. The acceptance criterion is that it detects a changed byte and a missing file, and that this is demonstrated on camera |
| Team capacity | Small team. Ranges in `milestones-and-budget.md` are ranges for that reason |

## Next 90 days

Sequenced, and each item has an acceptance test in
`milestones-and-budget.md`. All of it is currently `planned`.

- **Weeks 1–4.** ProofPack format v1 with canonicalisation rules and test
  vectors; local export and import with preview; import inert until reviewed;
  validation against archive bombs, path traversal and symlink escape.
- **Weeks 3–6.** Standalone verifier. Acceptance: accepts the original pack;
  detects one changed byte; detects one missing file; reports unknown signing
  origin and incomplete telemetry as such.
- **Weeks 5–8.** Walrus adapter against a test network. Record blob id,
  network, digest, date, SDK version and the exact commands as reproducible
  evidence. A local mock is called a mock.
- **Weeks 7–10.** Independent retrieval and verification from a separate
  process; failure and expiry states rendered honestly.
- **Weeks 9–12.** Minimal standalone example without DASH; documentation;
  recorded demo including the failure case.

**Out of scope for these 90 days:** mainnet, customer funds, automatic storage
renewal, production signing, full portability of all agent memory, and any
licence change or package publication (that needs its own decision — see
`licensing-and-release.md`).

---

**Not submitted.** This file exists so Henrik can edit a draft instead of
writing one.
