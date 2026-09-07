# Demo scripts

**No video exists. No recording of any kind has been made. Neither demo below
has ever been run, because the features they show are `planned`.**

This file is the script to follow once stage 6 and stage 7 land, written now so
that the demo is designed before the code — including the failure case, which
is the part demos usually leave out.

Each demo is short by design: under three minutes, one screen, no slides. A
reviewer should be able to see the claim and see it fail.

## Rules for both recordings

1. **Show the failure.** A demo that only shows success is an advertisement.
   Each script below ends on a refusal, and the refusal is the point.
2. **Record the real journey.** Through the installed application and the real
   runner and broker. No special demo path, no hand-built fixture pretending
   to be a run.
3. **Synthetic data only.** No customer data, no real credential, no real
   recipient, no proof data published to make the demo prettier.
4. **Never speed up or cut the waiting.** If a network step takes forty
   seconds, the recording shows forty seconds or says it was trimmed.
5. **Say what is mock.** If any component is a local mock, the recording says
   the word "mock" out loud and on screen.
6. **Say what the demo does not prove.** One closing sentence, every time.

## Demo 1 — Walrus track: a work result someone else can check

**Shows:** a finished agent result leaves DASH as a passive pack, is stored on
a Walrus test network, is fetched and verified by a separate program that has
never seen DASH, and is then rejected when a single byte changes.

**Prerequisite state:** `planned` — depends on stage 5 (ProofPack + verifier)
and stage 6 (Walrus adapter).

| # | Action on screen | What the viewer should understand | Capture |
|---|---|---|---|
| 1 | The sample agent runs in installed DASH and produces its artifact | This is a normal result from the normal product, not a demo fixture | `qa-screenshots-mar-886-stage6/01-run-complete.png` |
| 2 | Open the run inspector; show the steps and the evidence the result cites | The result has structure behind it | `.../02-run-steps.png` |
| 3 | Choose export; the preview shows contents, total size, and an explicit list of what is **excluded** | Nothing leaves without being shown first. No tokens, no keys, no grants | `.../03-export-preview.png` |
| 4 | Export completes; the pack digest is displayed | One digest binds the whole manifest | `.../04-pack-digest.png` |
| 5 | Store to the Walrus test network; the screen shows bytes, network, storage period, cost with its source or the word "unknown", and status | Real facts, honestly labelled, including what we do not know | `.../05-stored-blob.png` |
| 6 | **Switch to a terminal with no DASH.** Run the standalone verifier against the retrieved pack, giving the expected digest from a separate channel | The recipient needs neither our app, our database, nor our server. And the digest does not come from the same untrusted place as the bytes | `.../06-verify-ok.png` |
| 7 | Verifier prints its four separate answers: contents intact / signature present or absent / signing origin known or unknown / telemetry complete or incomplete | Four different questions, four different answers. None of them says the work is true | `.../07-verify-four-answers.png` |
| 8 | **Failure case.** Change one byte in one file inside the pack. Re-run the verifier | | `.../08-verify-mutated-fail.png` |
| 9 | Verifier fails, naming the file and the mismatch | Tamper-evidence is real, not decorative | same |
| 10 | **Second failure case.** Delete one file from the pack. Re-run | The verifier notices absence, not only alteration | `.../09-verify-missing-file-fail.png` |
| 11 | Closing line, spoken and on screen | "This proves the bytes are the ones that were exported and that nothing was altered. It does not prove the agent's conclusion is correct." | — |

**Recording needed:** one screen recording, ~2–3 minutes, plus the nine
screenshots above.
**Exists today:** nothing.

**Cut this demo short if:** the Walrus test network is unavailable. In that
case record steps 1–4 and 6–10 with a **local** adapter and say the word
"mock" wherever the network would have been. A mock demo labelled mock is
honest; a mock demo presented as network proof is not.

## Demo 2 — Starknet track: a mandate the agent cannot exceed

**Shows:** a person gives an agent a bounded mandate, the agent proposes an
allowed operation and it goes through with a receipt traceable back to the
run — then the agent proposes an operation outside the mandate and is refused,
and the refusal is shown to hold even when DASH is bypassed.

**Prerequisite state:** `planned` — depends on stage 7.

| # | Action on screen | What the viewer should understand | Capture |
|---|---|---|---|
| 1 | The person creates a mandate: network, contract, allowed entrypoints, recipient, integer amount with decimals, validity period, call limit | The bound is explicit and readable by a non-developer | `qa-screenshots-mar-886-stage7/01-mandate.png` |
| 2 | The screen states which of those rules the account enforces and which are DASH policy only | The honest distinction, in the product, not in a footnote | `.../02-enforcement-table.png` |
| 3 | The agent runs and **proposes** an operation. The proposal is shown before anything is signed | Proposal, approval and signing are separate things | `.../03-proposal.png` |
| 4 | The person approves. The approval names the exact network, account, payload and policy version | Approval is bound to what was actually shown | `.../04-approval.png` |
| 5 | The transaction is sent. The screen shows the real network state — submitted, then pending, then accepted | A sent transaction is not a completed operation | `.../05-tx-states.png` |
| 6 | Open the run inspector: the run, the step, the proposal, the approval and the transaction hash are all joined | This is the contribution — the trail back from a transaction to the run that caused it | `.../06-correlation.png` |
| 7 | **Failure case.** The agent proposes a transfer to a recipient the mandate does not allow | | `.../07-refusal.png` |
| 8 | DASH refuses, naming which mandate field was violated | The refusal is legible, not a generic error | same |
| 9 | **Failure case, second half — the important one.** In a terminal, call the same operation directly, bypassing DASH entirely | If the rule only lived in our UI, this would succeed | `.../08-direct-bypass.png` |
| 10 | The call fails at the account or contract for the rules that are account-enforced — **and for any rule that is DASH policy only, the recording says so out loud** | Nothing is marketed as on-chain enforced unless the bypass test proves it | same |
| 11 | Restart the application; the receipt is refetched and the correlation survives | State is not a screenshot in memory | `.../09-after-restart.png` |
| 12 | Closing line, spoken and on screen | "Test network, synthetic account, one operation. No mainnet, no customer funds, and the mandate rules that are only enforced by DASH are named on screen." | — |

**Recording needed:** one screen recording, ~3 minutes, plus the nine
screenshots above.
**Exists today:** nothing.

**Cut this demo short if:** testnet prerequisites are missing and test tokens
cannot be obtained without purchase — tokens must not be bought. In that case
record steps 1–4 and 7–10 against the local deterministic environment, say
plainly that no network operation was performed, and do not call the
integration proven.

## What still has to be decided before recording

- Who narrates, and in which language. `[TO FILL — Henrik]`
- Whether the recordings are published anywhere, or attached privately to an
  application. Publishing is a decision, not a default.
- Where recordings are stored. **Not in Git** — the repository holds
  screenshots under `qa-screenshots-*/`, and a video does not belong there.
  `[TO FILL — Henrik]`
- Whether any on-screen element leaks a path, a machine name, or a store
  identifier that should not be shown to a reviewer. Check every frame before
  sending anything.
