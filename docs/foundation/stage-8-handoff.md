# Stage 8 handoff — the funding dossier

**Lane:** F8, MAR-886 stage 8 (no Linear id — workspace free-issue limit,
recorded in `docs/foundation/README.md`).
**Branch:** `000henrik/mar-886-funding-dossier`, based on `620aa93`.
**Date:** 2026-09-07.
**Evidence class: nothing runtime.** This was a documentation lane. No test was
run, no application was launched, no code changed. The only verification
performed was reading the repository and fetching public web pages.

**Nothing was sent, posted, submitted or delivered to anyone.** No application
was filed, no community was contacted, no message left this machine except
HTTP GET requests to the public pages listed below.

## What was written

Eleven files, all new, all under `docs/funding/` except this handoff.

| File | Contents |
|---|---|
| `docs/funding/README.md` | Programme facts with source and check date, programme status and next step per track, and a readiness table per track (Walrus, Starknet) with the six plan criteria, each `ready`/`partial`/`planned` with the gap named. Three-column shape — official requirement / our assumption / open question — wherever facts appear |
| `docs/funding/walrus-brief.md` | Application draft: one-liner, user problem, why this ecosystem, bounded solution, reusable deliverables, existing base, demo (`planned`), team facts `[TO FILL — Henrik]`, risks, next 90 days |
| `docs/funding/starknet-brief.md` | Same shape for Starknet, opening with the blocking eligibility gap |
| `docs/funding/milestones-and-budget.md` | Work packages in three funding classes (already built / self-funded PoC / grant-funded) so nothing is funded twice; effort ranges in person-days; dependencies; cost assumptions with basis or "unknown"; maintenance, storage, RPC, CI and external review; the funding gap as a formula; token-valuation risk with no rate assumed |
| `docs/funding/evidence-index.md` | Claim → evidence table. What exists today with repo paths and the GenLayer transaction hashes; a row per stage 1–7 acceptance item, all `planned`; every external source with its fetch result including the failures |
| `docs/funding/demo-script.md` | Two recordable demos, each ending on a failure case (mutated ProofPack rejected; refused Starknet operation plus a direct-bypass check), with the screenshot paths that will be needed. First line says no video exists |
| `docs/funding/ecosystem-and-competition.md` | Primary-source review with reuse / integrate / build calls per area, and what would make either application not worth filing |
| `docs/funding/adoption-and-business.md` | Three falsifiable user hypotheses, interview guide, pilot with explicit failure criteria, four revenue hypotheses with test methods, five measures with test-traffic separation and local-or-consent collection, four unsent outreach drafts |
| `docs/funding/licensing-and-release.md` | Own-code inventory, direct dependency licences read from the main checkout, proposed public/commercial boundary, the `UNLICENSED`/private gap named, release checklist, and the no-change-no-publish line |
| `docs/funding/security-and-operations.md` | Threat model for imported code/data, outgoing export, the signing boundary and the transaction policy; limitations; incident and revocation path; what needs external review; "tests are not an audit" |
| `docs/funding/applicant-checklist.md` | What the applicant must provide — entity, KYC/KYB, disbursement wallet, agreements — as a checklist with no data |

Commits, in order:

| Commit | Contents |
|---|---|
| `2a12836` | README + applicant checklist |
| `13adf95` | Walrus and Starknet briefs |
| `cf565bf` | Milestones/budget + evidence index |
| `5ae794b` | Demo script + ecosystem and competition |
| `ec25420` | Adoption, licensing, security and operations |

## Facts fetched today, and from where

All fetched 2026-09-07 by this lane. Full table in
`docs/funding/evidence-index.md` section 3.

**Programme sources.**

- <https://www.starknet.io/grants/seed-grants/> — read. "up to $25,000 in
  STRK", non-dilutive; MVP or PoC required, early stage; projects already live
  on Starknet with a core group of users are **not eligible**; rolling
  submissions reviewed in rounds with a response "in about a month" /
  "approximately four weeks"; KYC/KYB mandatory ("We are legally required to
  perform KYC/KYB"); a clear three-month plan required with a check-in after
  three months; **active Starknet community involvement or prior
  hackathon/builder programme participation required**; must plan to build on
  existing Starknet tools. Not found on the page: rubric weightings, appeal
  process, disbursement schedule.
- <https://www.walrus.xyz/rfp/> — read. Funds teams building "the next
  generation of apps with verifiable data"; open RFPs live behind an Airtable
  link and **no RFP titles or amounts appear on the page**; "the final
  agreement includes funding and a budget for the winning applicant"; review
  begins ~2 weeks after an RFP opens; RFPs stay open until a suitable team is
  selected; grants (as opposed to RFPs) come from ongoing community
  conversations; criteria are technical strength/execution, creativity,
  ecosystem engagement, team commitment/resourcing.
- <https://www.walrus.xyz/> — read. "The Verifiable Data Platform for AI
  Builders", and it ships **Walrus Memory**, a portable memory layer for AI
  agents whose memory "stays independently verifiable". This is the most
  consequential finding of the lane and reshaped the Walrus pitch.

**Fetch failures, recorded rather than papered over.**

- `https://docs.wal.app/`, `/docs/getting-started` and
  `/docs/system-overview/operations` all returned **HTTP 403 Forbidden**.
  `https://docs.walrus.site/` did not resolve (DNS). Consequence: **no
  blob-id, storage-epoch, pricing or encryption fact is quoted anywhere in the
  dossier as verified.** Search snippets suggesting 1-day testnet epochs and
  2-week mainnet epochs are marked `to verify`, not used.
- `https://docs.letta.com/agent-file` returned 404 — the GitHub repository was
  used instead and is cited as the source.
- `https://www.sigstore.dev/` returned a loading page only —
  `docs.sigstore.dev/about/overview/` was used instead.
- `https://langchain-ai.github.io/langgraph/concepts/memory/` returned a
  redirect page with no content — `docs.langchain.com` was used instead.
- `https://community.starknet.io/t/snip-session-keys-for-smart-accounts/116132`
  appeared in search results and was **not fetched**; it is listed as a lead,
  and nothing relies on it.

**Ecosystem sources read successfully:** Letta Agent File
(github.com/letta-ai/agent-file), OpenAI Agents SDK sessions, LangGraph
persistence, SLSA provenance v1.0, Sigstore overview, C2PA 2.1 specification,
SNIP-9, the official Starknet session-keys post (published 2025-04-29),
Cartridge Controller session policies, `starkclaw`
(github.com/keep-starknet-strange/starkclaw, MIT, experimental), and the
MystenLabs/walrus repository (Apache-2.0).

**Repository facts** were read in this worktree at `620aa93`, plus dependency
licences read read-only from `node_modules` in the main checkout
(`C:\Users\henri\Desktop\projekt\MCP\orchestratedash\node_modules`). Nothing
in the main checkout was written.

## The two findings that matter most

1. **Walrus already ships agent memory.** A naive "portable verifiable agent
   memory on Walrus" pitch would have been proposing their own product back to
   them. The brief now scopes to a *passive, third-party-verifiable
   deliverable* for a recipient who runs no agent — and states that if the
   open RFP list turns out to want agent memory, **the application should not
   be filed**.
2. **`starkclaw` already writes our Starknet sentence.** An MIT-licensed
   Starknet agent wallet built for "bounded delegation: session keys, policy
   guardrails, and audit trails", inside `keep-starknet-strange`. It is
   experimental (mobile app in demo mode, mocked interactions), but it is
   better positioned on the wallet side than we would be. The brief now scopes
   to the *join* — transaction ↔ receipt ↔ approval ↔ run ↔ span, plus a
   published enforcement table with a direct-bypass negative test — and says
   that contributing upstream instead would be a good outcome.

## What is `[TO FILL — Henrik]`

- Applying entity: person or company, and the KYC/KYB path.
- Team facts: who works on this, allocation, background, prior public work.
- Developer day rate, or whether Henrik's time is costed at all — **every
  monetary total in the budget is blocked on this**, which is why the funding
  gap is written as a formula rather than a number.
- A quote for an external security review.
- The receiving Starknet address (kept outside anything an agent mandate can
  reach).
- Security contact address and who monitors it, required before any verifier
  is published.
- Demo narration language, and where recordings are stored (not Git).
- Placeholders inside the four outreach drafts.

## What is `planned`

Everything chain-specific and everything about packages. Concretely: all of
stages 1–7 acceptance (every row in `evidence-index.md` section 2), the
ProofPack format, the standalone verifier, both storage/mandate adapters, both
demos, both recordings, and any Walrus or Starknet code. **No Walrus blob has
been stored and no Starknet transaction has ever been made by this project.**

The only real-network evidence this project holds is the GenLayer Studionet
adjudication from MAR-861/863 — a different chain for a different purpose,
cited in both briefs as evidence of shipping ability rather than as track
work, with its transaction hashes and the note that Studionet is temporary.

## Readiness, in one line each

- **Walrus: not ready to apply.** No verified matching open RFP, no
  integration, and the technical docs could not be fetched.
- **Starknet: not ready to apply.** No Starknet PoC, and the community
  involvement the programme requires does not exist.

## The one thing the next session should do first

**Open the Walrus RFP Airtable list and read the current Walrus docs from a
real browser** (our fetcher gets 403), then decide whether a matching RFP
exists at all. That single answer decides whether the Walrus brief is edited
and used, re-scoped, or shelved — and it is cheap compared with any further
writing.

## Surprises and contradictions

- The lane brief said Walrus RFPs were "for verifiable data, no specific
  matching RFP or amount verified". That held exactly. What it did not
  anticipate is that Walrus ships a competing-adjacent agent product on its own
  home page.
- The Starknet page's community-involvement requirement is a harder gate than
  the plan's summary implied. Whether it is disqualifying or merely
  score-reducing is **not stated on the page**, and the dossier records it as
  an open question rather than resolving it optimistically.
- The dependency surface is far smaller than expected — six runtime packages,
  all permissive — which makes a future licence decision unusually tractable.
- The plan's own check said "Starknet Seed up to 25 000 USD in STRK, MVP/PoC,
  rolling, ~4 weeks review, KYC/KYB". Every one of those re-verified today. No
  contradiction found.

## Needs orchestrator

1. **Stage 8 has no Linear id.** The dossier refers to it as "MAR-886 stage 8"
   throughout. If the workspace limit is lifted, file it and add the id to
   `docs/foundation/README.md`'s coverage table.
2. **`docs/foundation/README.md` is orchestrator-owned and was not edited by
   this lane.** Its evidence log has no entry for stage 8; the orchestrator
   should append one pointing at this handoff and at `docs/funding/`.
3. **`evidence-index.md` section 2 is the orchestrator's fill-in surface.**
   Every stage 1–7 acceptance row is `planned`. Rows should move only on
   proven evidence, never on a merged PR — merged is not proven.
4. **The `README.md` readiness table needs re-running** whenever a stage
   lands; its `ready / partial / planned` cells are stated as of 2026-09-07.
5. **Decision needed from Henrik, not from a lane:** the licence boundary in
   `licensing-and-release.md` section 3, and specifically whether
   `create-dash-agent` becomes open. The "open agent kit" pitch is untrue
   until it does.
6. **No ADR was written** (correct for this lane — no cross-repo contract
   changed). Stage 6 owes an ADR on digest vs blob id vs network vs storage
   period; it is listed as work package C-W2, not filed here.

## What was verified, and how

| Check | Command / method | Result |
|---|---|---|
| Repository facts | Read files at `620aa93` in the lane worktree | `agent-kit/package.json` = `create-dash-agent` 0.1.1, `private: true`, `UNLICENSED`; root `package.json` = `orchestratedash` 0.1.1, `private: true`, no licence field |
| No LICENSE file | `find . -maxdepth 2 -iname "LICENSE*"` | no matches |
| Dependency licences | Read `node_modules/<pkg>/package.json` in the main checkout, read-only | 14 direct dependencies, all MIT / BSD-2-Clause / Apache-2.0; table in `licensing-and-release.md` |
| Cited repo paths exist | Existence check on every path cited in the dossier | all present |
| Programme and ecosystem facts | WebFetch, 2026-09-07, URLs recorded per claim | successes and failures both recorded in `evidence-index.md` section 3 |

**Not run, by lane rule:** `pnpm install`, `pnpm typecheck`, `pnpm test`,
`pnpm verify`, any Electron launch. No `node_modules` exists in this worktree
and none was created. No test result in this dossier is claimed as this lane's
own; test results referenced are `reported` from the source plan and
`docs/foundation/README.md`.

## Evidence class

**Nothing runtime.** Documentation only. The evidence in this dossier is:
repository reads at a named commit, dependency metadata read read-only from
the main checkout, and public web pages fetched on 2026-09-07 with their URLs
and their failures recorded. No fixture test was run by this lane, no
scratch-store harness was used, no application was launched, and no network
transaction was made.
