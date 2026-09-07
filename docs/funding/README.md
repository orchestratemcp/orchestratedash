# Funding dossier — prepared for review, not submitted

**Status: draft for Henrik's review. Nothing in this folder has been sent,
posted, or submitted to anyone.** No application was filed, no community
channel was contacted, no message was delivered. Every outreach text in this
folder is a draft for Henrik's own later use.

**Epic:** MAR-886 (DASH agent foundation), stage 8. Stage 8 has no Linear id
of its own — the workspace free-issue limit was reached on 2026-09-07, so its
intent lives in `docs/foundation/README.md`.

**Written:** 2026-09-07. **Programme facts checked:** 2026-09-07 (see below).
**Re-check before any final application draft is used.**

## What this folder is

Ten documents that would let Henrik decide whether DASH is ready to apply to
two ecosystem funding programmes, and — if he decides yes — give him drafts to
edit rather than a blank page.

| File | What it holds |
|---|---|
| `README.md` | This page: programme facts, status, readiness per track |
| `walrus-brief.md` | Application draft, Walrus track |
| `starknet-brief.md` | Application draft, Starknet track |
| `milestones-and-budget.md` | Work packages, effort ranges, cost assumptions, funding gap |
| `evidence-index.md` | Every claim mapped to real evidence or marked `planned` |
| `demo-script.md` | Two recordable demos, each including a failure case |
| `ecosystem-and-competition.md` | Primary-source review of nearby tooling |
| `adoption-and-business.md` | User hypotheses, interview guide, pilot, revenue hypotheses, measurement |
| `licensing-and-release.md` | Code and dependency licences, public/commercial boundary, release checklist |
| `security-and-operations.md` | Threat model, limitations, incident and revocation path |
| `applicant-checklist.md` | What the applicant must provide (no data stored here) |

## How to read a fact in this folder

Every factual table has three columns:

- **Official requirement** — what a primary source says, with the URL and the
  date it was read.
- **Our assumption** — what we are choosing to believe or plan on. Not a fact.
- **Open question** — what nobody has answered yet.

If a row has an assumption but no source, it is an assumption. Treat it as one.

## Programme facts as fetched on 2026-09-07

### Starknet Seed Grants

Source: <https://www.starknet.io/grants/seed-grants/> — fetched 2026-09-07,
page returned and read in full.

| Official requirement (starknet.io, read 2026-09-07) | Our assumption | Open question |
|---|---|---|
| "up to $25,000 in STRK", non-dilutive | We would ask for less than the ceiling, sized to the work packages in `milestones-and-budget.md` | Is a partial amount normal, or does asking small read as unambitious? |
| Teams must have "an MVP or Proof of Concept" and be early stage | DASH is past MVP as a product; the Starknet-specific part is not yet a PoC. The PoC we would present is stage 7, which is `planned` | Does "MVP or PoC" mean the chain-specific work, or the product it sits in? Unanswered on the page |
| Projects "already live on Starknet with a core group of users are not eligible" | We are not live on Starknet and have no Starknet users, so we are inside the window | None |
| Rolling submissions, no deadlines; "reviewed in rounds"; response "in about a month" / "approximately four weeks" | Plan for ~4 weeks from submission to answer; do not build a schedule that depends on a faster reply | None |
| KYC/KYB mandatory — "We are legally required to perform KYC/KYB" | Henrik or his entity completes this outside Git (`applicant-checklist.md`) | Which entity applies — person or company? `[TO FILL — Henrik]` |
| "All teams should present a clear plan detailing how the grant will be used within the next three months"; check-in after three months | The 90-day plan in `starknet-brief.md` is that plan | None |
| Requires "active Starknet community involvement or prior hackathon/builder program participation" | **We do not meet this today.** No Starknet community history exists | Is this a hard gate or a scoring factor? Not stated on the page |
| Must plan to use/build on existing Starknet tools | Stage 7 explicitly reuses existing account/session tooling rather than writing new cryptography | Which specific tool we build on is still open (see `ecosystem-and-competition.md`) |

Not found on the page: evaluation rubric weightings, appeal process, or the
fund disbursement schedule.

**Programme status for us: not ready to apply.** Two named gaps: no
Starknet-specific PoC exists yet (stage 7 is `planned`), and the community
involvement the page asks for does not exist.

**Next step:** land stage 7's local deterministic run, then decide whether the
community requirement can be met honestly before applying.

### Walrus grants and RFPs

Source: <https://www.walrus.xyz/rfp/> — fetched 2026-09-07, page returned and
read. Also <https://www.walrus.xyz/> — fetched 2026-09-07.

| Official requirement (walrus.xyz, read 2026-09-07) | Our assumption | Open question |
|---|---|---|
| The foundation funds teams building "the next generation of apps with verifiable data" | A portable, independently verifiable work-result pack is inside that description | Whether "verifiable data" here means the storage layer's own verifiability or application-level provenance |
| Open RFPs are behind a "View open RFPs" Airtable link; **no RFP titles or topics appear on the page itself** | We cannot claim a matching RFP exists | **Is there an open RFP that matches?** Unanswered — the list was not opened for this dossier |
| No funding amounts are disclosed; "the final agreement includes funding and a budget for the winning applicant" | Budget is negotiated, not a fixed ceiling. `milestones-and-budget.md` therefore states a requested range, not a draw against a known cap | What range is realistic? Unknown |
| RFP review "begins approximately 2 weeks after RFP opening"; RFPs "remain open until a suitable team or solution is selected" | No deadline pressure, but also no queue position | None |
| RFP eligibility: "Any individual, team, organization, or entity passionate about the possibilities of verifiable data" | Henrik or his entity qualifies formally | None |
| Grants (as distinct from RFPs) are "typically awarded through ongoing conversations with teams we've gotten to know through the community" | The grant path needs community presence we do not have; the RFP path does not obviously require it | Which path fits us better? Open |
| Stated criteria: technical strength/execution, creativity, ecosystem engagement, team commitment/resourcing | We are strong on execution evidence, weak on ecosystem engagement | How heavily is ecosystem engagement weighted? Not stated |

From the Walrus home page (<https://www.walrus.xyz/>, read 2026-09-07), which
matters more than the funding page for our positioning:

- Walrus brands itself "The Verifiable Data Platform for AI Builders".
- It advertises **Walrus Memory**, a portable memory layer for AI agents:
  "Take your AI agent's memory anywhere with Walrus Memory", memory that
  "stays independently verifiable, so your agent can prove what it remembered".
- "Data on Walrus is independently verifiable, meaning anyone can confirm it
  is correct and unaltered without trusting the provider storing it."

This is adjacent to our own stage 5/6 hypothesis and has to be addressed
head-on rather than ignored. `ecosystem-and-competition.md` does that.

**Fetch failure, recorded honestly:** the Walrus technical documentation at
`https://docs.wal.app/` returned **HTTP 403 Forbidden** to our fetcher on
2026-09-07, as did `/docs/getting-started` and
`/docs/system-overview/operations`. `https://docs.walrus.site/` did not
resolve (DNS). Therefore **no blob-id, storage-epoch, pricing or encryption
fact in this dossier is quoted from a page we actually read.** Search-result
snippets attributed to the same docs suggested testnet epochs of one day and
mainnet epochs of two weeks; that is `to verify`, not a source. The Walrus
repository <https://github.com/MystenLabs/walrus> was readable (2026-09-07)
and describes Walrus as "A decentralized blob store using Sui for coordination
and governance", licensed Apache-2.0.

**Programme status for us: not ready to apply.** No matching open RFP has been
verified, no Walrus integration exists (stage 6 is `planned`), and the core
technical facts we would need to write accurately could not be fetched.

**Next step:** open the RFP list and read the current Walrus docs from a
browser (our fetcher is blocked), then decide RFP versus grant path.

## Readiness table

"Funding-ready" is defined by the plan as: a reproducible chain-specific PoC,
an understandable benefit outside DASH, an honest competitive picture, a
proposed licence model, a realistic budget, and a clear application.

### Walrus track

| Criterion | State | The gap |
|---|---|---|
| Reproducible chain-specific PoC | `planned` | Stage 6 is not started. No Walrus code exists in the repo. Nothing has been stored or retrieved on any Walrus network. |
| Understandable benefit outside DASH | `partial` | The standalone verifier and the ProofPack format are designed to work with no DASH, database or server (stage 5 acceptance) — but they are `planned`. Today the benefit is describable, not demonstrable. |
| Honest competitive picture | `ready` | `ecosystem-and-competition.md`, primary sources fetched 2026-09-07. The uncomfortable finding — Walrus already ships an agent-memory product — is written down, not hidden. |
| Proposed licence model | `partial` | `licensing-and-release.md` proposes a boundary. Nothing is decided; the repo is `private: true` / `UNLICENSED` with no LICENSE file, which is a gap, not open source. |
| Realistic budget | `partial` | Work packages and effort ranges exist. The day rate and Henrik's own cost basis are `[TO FILL — Henrik]`, and the programme discloses no amount to size against. |
| Clear application | `partial` | `walrus-brief.md` is a complete draft with team facts marked `[TO FILL — Henrik]`. It cannot be finalised until the open RFP list is read. |

### Starknet track

| Criterion | State | The gap |
|---|---|---|
| Reproducible chain-specific PoC | `planned` | Stage 7 is not started. No Starknet code exists in the repo. The nearest real chain evidence is a GenLayer adjudication proof (a different chain, a different purpose) — see `evidence-index.md`. |
| Understandable benefit outside DASH | `partial` | A standalone mandate adapter example is in the stage 7 acceptance; it is `planned`. |
| Honest competitive picture | `ready` | Documented, including `starkclaw`, an MIT-licensed Starknet agent wallet built for exactly "bounded delegation" — read 2026-09-07. |
| Proposed licence model | `partial` | Same as above. |
| Realistic budget | `partial` | Ceiling is known ($25,000 in STRK). Effort ranges exist; day rate `[TO FILL — Henrik]`. Token-valuation risk noted, no rate assumed. |
| Clear application | `partial` | `starknet-brief.md` is a complete draft. Blocked on the community-involvement requirement, which we do not meet today. |

### What is `ready` today, on both tracks

- The competitive review, because it was done from primary sources today.
- The evidence discipline: `evidence-index.md` marks `planned` where nothing
  was run, and cites commits and transaction hashes where something was.

Nothing else is `ready`. The dossier's honest headline is: **the writing is
ahead of the building, and the dossier says so in every table.**

## Rules this folder follows

- Grants are not recurring revenue. Nowhere in this folder is a grant counted
  as product income.
- Proposed targets are targets. No metric in this folder describes traction
  that exists.
- Stages 1–7 of the foundation plan are in progress or planned. Their
  acceptance items appear in `evidence-index.md` as `planned` rows with the
  exact acceptance text; the orchestrator fills them in as they land.
- No identity document, private company detail, wallet address or credential
  appears in this folder. `applicant-checklist.md` lists what is needed; the
  data itself stays out of Git.
