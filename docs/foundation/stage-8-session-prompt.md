# Lane F8 — Stage 8: the funding dossier under docs/funding (prepare for review; send nothing)

Tier: Opus (primary-source research, honest competitive framing, budget
reasoning; the pitch must not outrun the evidence). Read `ux-lanes-common.md`
first for the repository rules; this lane writes DOCUMENTATION ONLY.

Worktree: `C:\Users\henri\AppData\Local\Temp\wt-f8-s1` (no `node_modules`
needed — do not run pnpm install; do not run tests).
Branch: `000henrik/mar-886-funding-dossier` (from `codex/agent-foundation`).
PR targets `master`. Epic: MAR-886. Stage 8 has NO Linear id yet (workspace
issue limit) — refer to it as "MAR-886 stage 8".

Read the plan: `C:\Users\henri\Documents\DASH-agent-foundation-claude-plan.md`
(Swedish) — sections "Etapp 5", "Etapp 6", "Etapp 7", "Etapp 8",
"Prioritering och gränser" and "Verifiering, process och leverans". Stage 8's
deliverable list and rules are binding.

## Hard rules for this lane

- **Send nothing, post nothing, contact nobody.** No emails, no forms, no
  community posts, no DMs, no issue comments on other people's repos. Drafts
  only, in files.
- **No invented facts.** No credentials, partners, users, traction, or
  metrics that do not exist. Where a fact is missing write `[TO FILL — Henrik]`
  or `planned`. Grants are not recurring revenue. Proposed targets are
  targets, not traction.
- **Primary sources only for programme facts**, fetched today with the URL
  and the date you read it; if a page cannot be fetched, say so instead of
  quoting memory. The plan's own check (2026-09-07): Starknet Seed up to
  25 000 USD in STRK, MVP/PoC, rolling, ~4 weeks review, KYC/KYB
  (https://www.starknet.io/grants/seed-grants/); Walrus grants/RFPs for
  verifiable data, no specific matching RFP or amount verified
  (https://walrus.xyz/rfp/). Re-check both and record what you found.
- **No identity documents or private company data in Git.** A requirements
  checklist for the applicant (person/organisation, KYC/KYB, agreements) is
  fine; the data itself is not.
- Repository facts you may cite as existing today (verified by the
  orchestrator 2026-09-07): `agent-kit/package.json` is `create-dash-agent`
  0.1.1, `private: true`, `license: UNLICENSED` — not published; the repo
  root has no LICENSE file unless you find one; manifest v2 and telemetry v1
  are frozen contracts (`contracts/`, `docs/telemetry-contract-v1.md`); the
  broker never gives an agent a credential (ADR 0002); a GenLayer
  adjudication path exists (`lib/genlayer/**`, ADR 0033) and was proven on
  Studionet; the sample-agent journey, the DASH MCP builder (`tools/dash-mcp`,
  ADR 0032) and the run inspector exist. Stages 1–7 of the foundation plan
  are IN PROGRESS or PLANNED — write their evidence rows as `planned` with
  the exact acceptance the plan states; the orchestrator fills them in as
  they land. Do not describe the Walrus or Starknet prototypes as built.

## Deliverables (all under `docs/funding/`, English)

- `README.md` — source and check date for each programme, programme status,
  next step, and a readiness table per track (Walrus, Starknet) with rows for:
  reproducible chain-specific PoC, understandable benefit outside DASH, honest
  competitive picture, proposed licence model, realistic budget, clear
  application — each `ready / partial / planned` with the gap named. Three
  columns everywhere facts appear: official requirement / our assumption /
  open question.
- `walrus-brief.md`, `starknet-brief.md` — application drafts: one-liner,
  user problem, why this ecosystem, bounded solution, reusable deliverables
  (the standalone verifier and adapters, the ProofPack format, the mandate
  adapter example), existing base, demo (say "planned" where it is), team
  facts to complete, risks, next 90 days. Walrus pitch hypothesis (from the
  plan): an open format and tooling that lets AI agents hand over verifiable
  work results via Walrus, independent of agent platform. Starknet pitch
  hypothesis: an open agent kit where a user gives an agent a bounded mandate
  and can follow every transaction back to its run. State both as
  hypotheses, not confirmed RFP fits.
- `milestones-and-budget.md` — separate work packages with deliverable,
  verification criterion, effort as a range, dependencies, cost assumptions;
  already built / self-funded PoC / future grant-funded shown separately, no
  double funding of the same work; include maintenance, storage, RPC, CI and
  possible security review; state the funding gap if the programme ceiling
  is short; note token-valuation risk without assuming a rate.
- `evidence-index.md` — a table: claim → evidence (commit, environment,
  reproduction command, test result, installed proof, screenshot path,
  network reference) or `planned`. Seed it with what exists today (cite the
  repo paths above and `docs/mar-861-*` handoffs for the GenLayer proof) and
  a row per stage 1–7 acceptance item marked `planned`.
- `demo-script.md` — one short demo per track including a failure case
  (mutated ProofPack rejected; refused Starknet operation), written as
  recordable flows with the screenshot/recording that will be needed; say
  plainly that no video exists yet.
- `ecosystem-and-competition.md` — a primary-source review, fetched today
  with URLs and dates, of nearby tooling for agent memory/portability
  (e.g. agent frameworks' memory/export features), work verification /
  provenance (content hashing, signing, attestation tooling), and
  account/permission tooling on Starknet (session keys / account
  abstraction / spending-limit accounts — name the actual projects you can
  verify). For each: reuse vs integrate vs build, and why our contribution is
  still needed. A general agent shell with a token attached is not a pitch —
  say what is specific.
- `adoption-and-business.md` — 2–3 concrete user hypotheses, an interview
  guide, a pilot setup, and draft outreach messages for Henrik's LATER use
  (clearly marked drafts, not sent); revenue hypotheses (team sharing,
  history, administration, support); pricing and willingness-to-pay are to be
  tested; measurement plan (time to first working agent, export/import
  successes, independent verifications, external adapter users, meaningful
  test transactions; test traffic separated from use; local or explicit-
  consent collection only, no hidden analytics).
- `licensing-and-release.md` — inventory of own code, third-party licences
  (read `package.json` dependencies and their licences from `node_modules`
  ONLY if present in the main checkout `C:\Users\henri\Desktop\projekt\MCP\orchestratedash\node_modules`
  — read-only; otherwise list the dependencies and mark licences `to check`),
  package names and rights; a proposed boundary between a reusable public
  component (verifier, ProofPack format, adapters, agent SDK) and the
  commercial DASH product; the current UNLICENSED/private status named as a
  gap; a release checklist prepared locally (what a publish would require)
  with an explicit "no licence change, no publish without decision" line.
- `security-and-operations.md` — proportionate threat model for imported
  code/data, outgoing export, the signing boundary and the transaction
  policy; limitations; incident and revocation path; what needs external
  review before production; tests are not an audit.

Also `docs/funding/applicant-checklist.md`: what the applicant must provide
(entity, KYC/KYB, wallet for disbursement, agreements) as a checklist — no
data.

## Exit

Commit in small pieces, push, open the PR as draft
(`docs(mar-886): funding dossier (stage 8) — prepared for review, not
submitted`), mark it ready at the end, and write `docs/foundation/stage-8-handoff.md`
(what was written, which facts were fetched from where, what is `[TO FILL]`,
what is `planned`). Report the PR URL, head SHA, the list of files, the
programme facts as fetched today, and anything under "Needs orchestrator".
Stop there.
