# Applicant checklist — what the applicant must provide

**This file is a checklist only. Do not put any of the listed data in this
repository.** No identity document, registration number, address, bank or
wallet detail, or private company record belongs in Git — not in a branch, not
in a draft, not "temporarily".

Where the answer is needed to finish a draft in this folder, the draft carries
`[TO FILL — Henrik]` and stays unfilled until Henrik supplies it out of band.

## 1. Who is applying

- [ ] Decide: does Henrik apply as an individual, or does a registered
      company apply? Both programmes accept either, but the answer changes
      every downstream item on this list.
- [ ] If a company: legal name, registration number, country of registration,
      registered address, and who is authorised to sign.
- [ ] If an individual: legal name, country of residence, tax residency.
- [ ] Named point of contact and an email address that will still be
      monitored in three months.

## 2. KYC / KYB

Starknet Seed Grants states this is mandatory: "We are legally required to
perform KYC/KYB to verify identities and ensure funds are properly
distributed" (<https://www.starknet.io/grants/seed-grants/>, read 2026-09-07).
Walrus does not state its requirement on the public RFP page; assume something
equivalent applies before any funds move.

- [ ] Government photo identity document for each person who must be verified.
- [ ] Proof of address, if requested.
- [ ] For a company: certificate of incorporation, ownership / beneficial
      owner information, director list.
- [ ] Sanctions and restricted-jurisdiction check — confirm the applicant's
      jurisdiction is eligible before spending effort on a draft.
- [ ] Decide who holds these documents and where. **Not in Git. Not in the
      DASH store. Not in a chat transcript.**

## 3. Disbursement

- [ ] Starknet: a Starknet address able to receive STRK. Decide whose it is
      and who controls the key.
- [ ] Confirm the receiving wallet is **not** any wallet a DASH agent, mandate
      or session key can reach. The stage 7 design keeps agent mandates on
      synthetic accounts; a grant-receiving account must stay outside that
      boundary entirely.
- [ ] Walrus: payment rail unknown — the RFP page discloses no amounts or
      mechanics. Ask during the process.
- [ ] Tax treatment of a token-denominated grant in the applicant's
      jurisdiction. This is an accountant question, not an engineering one.

## 4. Agreements

- [ ] Read the grant agreement before signing. Specifically check: whether it
      grants any licence over the delivered code, whether it constrains the
      licence we may choose, whether it claims any IP, and what the
      reporting and clawback terms are.
- [ ] Check whether the agreement obliges publication of anything. Our
      release position (`licensing-and-release.md`) is that no licence change
      and no publish happens without a separate decision — an agreement that
      silently forces one is a conflict to catch before signing, not after.
- [ ] Milestone reporting obligations and their cadence. Starknet states a
      three-month check-in.
- [ ] Whether the funder expects a public announcement, and whether we are
      willing to make one.

## 5. Track record and references

- [ ] Prior work or repositories that can be shown publicly. Today the DASH
      repository is `private: true` with no LICENSE file — decide what, if
      anything, a reviewer is allowed to see, and how.
- [ ] Team facts: who works on this, at what allocation, with what relevant
      background. `[TO FILL — Henrik]` in both briefs.
- [ ] Starknet only: evidence of "active Starknet community involvement or
      prior hackathon/builder program participation". **We have none today.**
      This is a gate we do not currently pass. Do not invent it.
- [ ] Walrus only: any prior engagement with the Walrus/Sui community.
      **None today.**

## 6. Before pressing submit (nothing here has been pressed)

- [ ] Re-fetch both programme pages and confirm the facts in
      `README.md` still hold. They were read on 2026-09-07 and programmes
      change.
- [ ] Confirm every claim in the brief maps to a row in `evidence-index.md`
      that is not `planned`, or is written in the brief as `planned`.
- [ ] Confirm no proof data, customer data, or secret has been published to
      make the application look better.
- [ ] Confirm the demo recording exists, or that the brief says plainly that
      it does not.
- [ ] Henrik decides. This dossier does not submit anything.
