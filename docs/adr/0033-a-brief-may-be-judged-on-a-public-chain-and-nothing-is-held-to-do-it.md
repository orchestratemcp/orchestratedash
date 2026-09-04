# ADR 0033: A brief may be sent for judgement on a public chain, and DASH holds nothing to do it

**Status:** accepted — MAR-863, packet 2 of MAR-861 (*Agent Tank — evidence-bound
work, judged on chain, demoed in DASH*).
**Date:** 2026-09-04. **Issue:** MAR-863.
**Touches:** ADR 0002 (the broker — this adds a thing the broker file declares
and that the broker's own `handle` cannot perform, and says why), ADR 0025 +
amendment 1 (a brief is a document bound to its evidence — the fingerprint join
this re-checks is that amendment's, and the payload is refused when it fails),
ADR 0008 (the author's panel forbids controls — the verdict renders there and
the button does not), ADR 0016 (a person is behind every penny — nothing here
spends, and the reason is structural), ADR 0020 (an MCP server is a connection —
this adds a connection that is not a credential, which that ADR's vocabulary did
not have a shape for).
**Repository:** orchestratedash.

---

## Context

The Agent Tank spike, `github.com/orchestratemcp/brief-acceptance`, ran ten
judgements against real validators on GenLayer Studionet and wrote down what
happened. A DASH brief — the document a model writes about what an agent
collected — was published to an intelligent contract with machine-readable terms,
and a committee of models judged whether every claim in it was supported by the
evidence rows the paragraph cited.

It worked, and it found three things that decide this ADR.

**One.** The judge is only as good as what it is shown. Run 1 rejected an honest
brief because the projection was dropping fields the prose had been written from
— reaction and comment counts the digest row carried. The judge was right: as
shipped, the claim had no support. **An evidence projection that keeps only the
headline turns a grounded brief into an ungrounded one at the last step.**

**Two.** A decided transaction is not a verdict. A write can be `FINALIZED`, with
the leader's execution `SUCCESS`, and apply **no state at all**, because the
committee returned `MAJORITY_DISAGREE`. Measured at roughly **one judgement in
ten** over the stability run. Reading the first two fields and not the third
reports that as a success with a mysteriously empty result.

**Three.** It is slow, and unevenly so. `evaluate` took **16 to 249 seconds** to
be accepted and **45 to 281 seconds** to finalize.

The question this ADR answers is what shape that takes inside a product whose
standing rules are that an agent never chooses a URL, that model-authored prose
never carries a link, and that a person is behind everything irreversible.

### The thing that makes the whole design possible

Studionet has a faucet on its RPC. `sim_fundAccount` will fund a freshly created
account, so an adjudication can run with **no key anywhere in DASH**. Every other
connection DASH holds is a credential in the vault; this one is not, and that is
not a convenience — it is why there is no spend path, no scope, no vault entry
and nothing to leak.

---

## Decisions

### 1. The adjudication is declared in the broker's file, and is not a `BrokerOperation`

`lib/broker/operations.ts` states the rule for adding an operation: *a card
sentence, a scope list, a request shape and a projection.* This meets it on all
four counts, and it is declared **beside** the `BrokerOperation` union rather
than inside it.

The union is the set of things an agent may *name* in a brokered request:
`operationById` resolves it, `lib/broker/execute.ts` decides about it, and a
credential is held for the length of one call. All three are wrong here — there
is no credential to hold, it is three transactions rather than one HTTP request,
and `handle`'s fetch carries a fixed twenty-second deadline against a measured
tail of 281 seconds.

The alternative was to widen `BrokerAccess` to a fourth member and then write
three refusals inside `handle` to stop the widening from meaning anything. That
is strictly weaker. As declared, `operationById("genlayer.brief.adjudicate")`
returns **null** — exactly as it does for `gmail.send` — so there is no line an
agent can write, named anything at all, that reaches this. `WRITE_PATHS` and
`SPEND_PATHS` are unchanged by construction rather than by inspection.

What bounds it instead is `ADJUDICATE_FUNCTIONS`: the complete list of contract
functions DASH will ever call, which is `WRITE_PATHS`' argument applied to a
chain. `reclaim` — the only function on that contract that moves anything — is
absent, and is therefore refused by absence rather than by a check.

### 2. The `genlayer` connection is an endpoint and an address, and holds no credential

`CONNECTOR_KINDS_V1` has two members and both are flows for putting a secret
somewhere only Electron main can read. This connection has no secret. It is
**where** to talk and **what** to talk to, and the account that signs is a
throwaway made per attempt by `createAccount()`, funded from the faucet, held in
one closure for the length of one adjudication and never written anywhere.

Consequences, stated rather than implied:

- Nothing enters the vault, so there is nothing for the broker to gate on spend
  and nothing that could leak.
- A compromised renderer that learned the whole connection would have learned a
  public URL and a public address.
- `https` only, with **no exception for localhost**. A local Studio is a real
  thing people run; supporting it means deciding what DASH does about a plaintext
  endpoint carrying somebody's document, and that decision belongs in the packet
  that adds it.

### 3. No address crosses, and a receipt id goes where a URL would

DASH's standing rule is that model-authored prose never carries a link —
`readBrief` drops a paragraph whole rather than cleaning one out of it. Publishing
to a public chain keeps that property by giving every evidence row a **receipt
id**, `<digest artifact id>#<original position>`, built from DASH's own records.

The receipt id resolves back to a row in the run DASH holds, so a judge can check
a claim against the row it was written from, and a model can never mint one. The
check is made over the **whole serialised deliverable** rather than field by
field, so a member nobody thought about cannot carry one past it, and
`tests/broker-genlayer.test.ts` drives a fixture whose every row has both a
`source_url` and an `item_url`.

Against decision 1 of the run-1 finding, the projection carries every field of a
row that a paragraph could have been written *from* — headline, source name,
summary, date, and the extras DASH's own collectors write — and only the two
members that are addresses are withheld.

### 4. The join is re-checked before anything is published, and a mismatch is a refusal

ADR 0025 amendment 1 makes a brief's citations checkable by hashing the digest's
item identities. `lib/brief/fingerprint.ts` already refuses to draw citations
when the join fails. This makes the same ruling one step earlier and one degree
harder: the payload is **refused**, so a brief written from a different list is
never published at all.

The hash is imported from that module and not transcribed. A second copy is a
second thing to drift, and the cost of drift here is a public, permanent document
whose citations point at the wrong rows.

### 5. Three fields, read in one place, and no verdict is a result

`lib/genlayer/receipt.ts` is the only module in DASH that reads a GenLayer
receipt, and it reads three fields:

| Field | Question |
| -- | -- |
| `status_name` | did the transaction reach a decision? |
| `consensus_data.leader_receipt[0].execution_result` | did the leader's call succeed? |
| `result_name` | did the committee accept the leader's answer? |

`no_consensus` is a first-class outcome with a sentence, an explanation and a
**button** — never a spinner. It is not worded as a failure, because it is not
one: the validators are supposed to be able to refuse a verdict they do not
accept, and that they did is the equivalence principle working. Asking again is a
new commission against the same brief, which is why `commissionIdFor` mints a
fresh id rather than retrying an old one, and why `brief_adjudications` keeps one
row per **attempt**.

A screen that waits forever on one run in ten is the defect this packet was most
likely to ship. It is the fourth section of the test file.

### 6. No fixed timeout, and the wait is durable

The measured tail is 281 seconds to finalized. A thirty-second deadline fails
most runs and a sixty-second one fails a third of them, so there is no deadline:
the wait is bounded by the transport's own retry budget, set at roughly double
the worst observed, and exhausting it settles the attempt as `abandoned` —
*DASH stopped waiting*, never *it failed*.

The command **returns before the judgement finishes.** A row exists before the
first byte leaves, every stage is written as it is reached, and the page reads
the stage on the poll it already runs. A command that awaited the whole thing
would hold an IPC promise open across five minutes of somebody's session, and a
renderer that reloaded in the middle would lose the only handle on a document
that is already public.

### 7. The verdict renders where both renderers get it; the button does not

Two components draw an artifact card — `app/_components/outputs.tsx` is DASH's
own and `app/_components/panel.tsx` is the author's declared one — and both call
`BriefBody`. The receipt is written into `BriefBody`, so both get it.

The button is not. ADR 0008 bars controls from the author's panel, so asking for
a judgement lives on DASH's own card and nowhere else. **The record is shared and
the act is not.**

The transaction hash renders as text and never as a link. DASH's window denies
every anchor by design, and an address beside model-authored prose is the exact
thing decision 3 refuses to publish — the rule would be odd to keep on the way
out and drop on the way back.

### 8. It is a tenth command family, and it is the first that is irreversible outward

`adjudicate.start` is its own family in `lib/shell/ipc.ts`. Every other command
in that catalogue acts on this computer, this person's account, or a program on
this machine. This one puts a document on a public network where it stays
whatever anybody here does afterwards.

`irreversible: true`, and in a stronger sense than anywhere else in the
catalogue: `connection.disconnect` is irreversible in that a token cannot be
un-revoked, and a person can reconnect. There is no reconnecting from this.

The payload is **two opaque ids and nothing else**. Main resolves them against
its own store, finds the digest itself, builds the payload itself, and refuses
what it cannot check — so no document crosses the boundary, and page script can
name a briefing this agent already produced but can never choose what gets
published. The endpoint and the contract address are absent from the payload too,
so it cannot pick the chain either.

---

## What this does not decide

- **No appeal path.** A rejected brief cannot be re-argued on chain; asking again
  is a fresh judgement of the same document. Filed separately under MAR-861.
- **No Bradbury and no value transfer.** Studionet only, and every commission is
  opened at a bounty of zero. `reclaim` is unreachable because there is nothing to
  reclaim and because it is not in `ADJUDICATE_FUNCTIONS`.
- **No agent-initiated judgement.** There is no allowance, no schedule and no
  operation id an agent can name. If that is ever wanted it is a new decision,
  and decision 1 is what it would have to be argued against.
- **Whether the contract at the configured address is the one DASH expects.**
  Nothing short of reading the deployed source would answer it and Studio does not
  offer that over this RPC. The shipped default is the address DASH has actually
  run against; a changed address is the person's own claim about their own
  deployment.

---

## Evidence

- The spike's `transcripts/stability.json`: ten judgements, `ACCEPTED` 8,
  `REJECTED` 1, `NO_CONSENSUS` 1; 45–281 s to finalized.
- A live end-to-end run of this packet's own flow against the deployed contract
  at `0xD08455a5Cfc53E43731834d6C92a6FE4aA0b3B75` on 2026-09-04: open, submit and
  evaluate all `FINALIZED` / `SUCCESS` / `MAJORITY_AGREE`, verdict `ACCEPTED`,
  evaluate transaction
  `0x873d79fd81bbfd9a9dea038ba6e5b143652cf4c53be07d11fe429292c6e7d5d5`, 121
  seconds end to end.
- `tests/broker-genlayer.test.ts`: thirty tests over the four claims above,
  including the `MAJORITY_DISAGREE` receipt driven with no network in the room.
