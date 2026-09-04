# MAR-863 handoff — `genlayer.brief.adjudicate`

**Session:** Claude Code, `claude --model opus`, extended thinking.
**Branch:** `000henrik/mar-863-genlayer-adjudicate`, from `master` at `3004f41`.
**Worktree:** `C:\Users\henri\AppData\Local\Temp\wt-mar863-adjudicate-b1`.
**Lifecycle at merge:** `merged`. **Not** `proven` — see *The proof* below.

---

## What shipped

A button on DASH's own output card sends an agent's brief for adjudication on
GenLayer Studionet, and the verdict comes back as a receipt beside the citations.

| Layer | File |
| -- | -- |
| The operation | `lib/broker/operations.ts` (appended section) |
| The payload builder | `lib/genlayer/payload.ts` |
| The three-field receipt reading | `lib/genlayer/receipt.ts` |
| The connection kind | `lib/genlayer/connection.ts` |
| The terms | `lib/genlayer/terms.ts` |
| The state machine | `lib/genlayer/adjudicate.ts` |
| The transport (`genlayer-js`) | `lib/genlayer/client.ts` |
| The record shape (pure) | `lib/genlayer/record.ts` |
| The store | `lib/genlayer/store.ts` + migration index 37 in `lib/db.ts` |
| The words | `lib/copy/genlayer.ts` |
| The receipt on screen | `app/_components/digest.tsx` (`AdjudicationReceipt`) |
| The button | `app/_components/outputs.tsx` |
| The command | `lib/shell/ipc.ts` (`adjudicate.start`), `electron/adjudicate-host.ts` |
| The decision | `docs/adr/0033-…md` |
| The tests | `tests/broker-genlayer.test.ts` (30) |

---

## The four-part rule, met on all four counts

`lib/broker/operations.ts` states that adding an operation is *"a deliberate act
with a card sentence, a scope list, a request shape and a projection"*.

1. **Card sentence in the user's words.** `label` is `"Have this brief judged on
   GenLayer"`. `consequence` leads with the irreversible fact — *"Anyone can read
   them there and nobody can take them down"* — rather than burying it.
   `tests/broker-genlayer.test.ts` asserts the label by value and asserts it
   carries no identifier.
2. **Scope list unchanged, `SPEND_PATHS` unchanged.** `required_scopes: []`,
   because there is no credential to intersect. Both frozen path arrays are
   untouched **by construction**, because the adjudication is not a member of the
   `BrokerOperation` union at all — the test pins `writePaths()` by value and
   asserts no spend path mentions genlayer. What bounds it instead is
   `ADJUDICATE_FUNCTIONS`, the complete four-entry list of contract functions
   DASH will ever call; `reclaim`, the only function on the contract that moves
   anything, is absent from it.
3. **Request shape carries the commission id, the deliverable and the terms, and
   nothing an author could fill.** Every field is built by DASH from an artifact
   it is already holding. `compose` narrows all six and refuses a deliverable
   with any `scheme://` in it, over the whole serialised document.
4. **Projection returns `{verdict, reasons[]}`** — two fields, a different shape
   from a completion's five and a curation's groups. `judge_output`, the model's
   raw fenced reply, is deliberately **not** projected.

### One thing I did differently from the brief, and why

The brief said "a new broker operation". I declared it in `lib/broker/operations.ts`
under the same rule and the same review discipline, but **outside the
`BrokerOperation` union**. ADR 0033 decision 1 carries the argument in full. The
short version:

- The union is the set of ids an agent may *name*. `operationById` resolves it,
  `handle` decides about it, and a credential is held for one call. There is no
  credential here, it is three transactions rather than one request, and `handle`'s
  fetch has a fixed 20-second deadline against a measured 281-second tail.
- Widening `BrokerAccess` to four members and then writing three refusals inside
  `handle` to stop the widening meaning anything is strictly weaker than not
  widening it. As declared, `operationById("genlayer.brief.adjudicate")` returns
  **null**, exactly as it does for `gmail.send`.
- It also would have rippled into `lib/connections.ts`, `lib/views/types.ts`,
  `lib/fleet/catalogue.ts`, `lib/mcp/catalogue.ts` and
  `app/_components/connection-card.tsx`, all of which restate the three-member
  union and are pinned against it by `tests/broker-spend.test.ts:169`.

If a reviewer wants it inside the union instead, that is a real conversation and
ADR 0033 decision 1 is the thing to argue against.

---

## I had to edit `electron/`, and here is the statement the brief asked for

The brief made `electron/**` read-only *"unless the operation genuinely cannot be
wired without it, and if that is true say so in the handoff BEFORE editing."*
Saying it here, and it was written before the edits:

**It cannot be wired without it.** The proof line is behavioural on the installed
build — a person presses a button in the renderer and a network call happens. In
DASH the renderer reaches the network only through an IPC command, and a command
needs three things outside `lib/`: a bridge method in `electron/preload.ts`, an
entry in the wiring table in `electron/main.ts`, and a performer. There is no
existing command family it could ride: `workspaceAction` in `main.ts` branches on
`export_brief` and otherwise contacts the runner, so a new action there would
reach the runner rather than the network.

What I edited, and it is three lines plus one new file:

- `electron/preload.ts` — one bridge method, `adjudicateBrief`.
- `electron/main.ts` — one import and one entry in the existing wiring table.
- `electron/adjudicate-host.ts` — **new**, the seam, on `electron/open-out.ts`'
  pattern so the one route that publishes outward is one reviewable file.

Nothing in `runner/**` or `tools/**` was touched. `tools/dash-mcp/**`,
`docs/adr/0032-*` and `docs/mar-862-handoff.md` — MAR-862's — were not touched.

---

## Other files outside the stated ownership list, and why

- `lib/db.ts` — migration index 37. Unavoidable: a verdict is a receipt, and a
  receipt that vanishes on restart is not one.
- `lib/views/artifacts.ts`, `lib/views/build.ts` — the card view needs an
  `adjudications` field and a resolver, the same shape `citations` already has.
- `lib/shell/ipc.ts` — the command catalogue.
- `app/agents/detail/page.tsx`, `app/_data/source.ts` — the press and the bridge.
- `app/globals.css` — three rules for the receipt block.
- `tests/store-sqlite.test.ts`, `tests/store-reconcile.test.ts`,
  `tests/shell.test.ts`, `tests/outputs-render.test.tsx` — the pins that exist to
  force exactly this review. See the migration note below.

---

## Migration index: assigned 37, confirmed against the pin first

The brief did not assign one. `tests/store-sqlite.test.ts` pinned
`user_version` at **37** at this branch point, so the new step is **index 37 and
produces 38** — the off-by-one `lib/db.ts` warns about. I grepped the literal pin
before writing the step, as the brief said to.

`HEAD_VERSION` moved 37 → 38 in both `tests/store-sqlite.test.ts` and
`tests/store-reconcile.test.ts`. `RECONCILED_VERSION` in `lib/store-reconcile.ts`
is `MULTI_ACCOUNT_INDEX + 1` and does **not** follow the head, so it needed no
change — checked, because a new migration has reddened that file before.

**Confirm 37 is still free at the merge.** MAR-862 is live in another worktree
and owns `tools/dash-mcp/**`, so a collision is unlikely — but AGENTS.md is
explicit that a worker session choosing a serial number is how they collide, and
the pin above is the gate that catches it.

---

## The three traps the brief named, and what happened to each

1. **Two renderers draw an artifact card.** `AdjudicationReceipt` lives inside
   `BriefBody` in `app/_components/digest.tsx`, so `outputs.tsx` and `panel.tsx`
   both get it. The **button** is only in `outputs.tsx` — ADR 0008 bars controls
   from the author's panel. The record is shared and the act is not.
2. **`genlayer-js` in the main-process bundle.** Checked *first*, before anything
   was built on it: it bundles under `esbuild` at `platform: "node"`,
   `format: "esm"`, `target: "node24"` — `scripts/build-shell.mjs`' exact
   configuration — at ~1.2 MB, and the bundle runs. `pnpm build:shell` on this
   branch produces a `dist/electron/main.mjs` containing `sim_fundAccount` and
   `createAccount`.
3. **A guarded migration with the right index.** It is a `CREATE TABLE IF NOT
   EXISTS` plus its index, not an `ADD COLUMN`, so it re-runs cleanly on a store
   the tests rewind.

---

## The no-verdict path

`readReceipt` reads the three fields and returns `no_consensus` for a
`FINALIZED` + `SUCCESS` + `MAJORITY_DISAGREE` transaction. When that happens:

- `adjudicateBrief` **does not call `get_verdict`** — nothing was written, so the
  answer would be an empty verdict and returning it would report a result that
  does not exist. The test asserts the call was not made.
- The row settles with `outcome: "no_consensus"`, a null verdict and no failure.
- `describeAdjudication` gives it a headline, an explanation that says it happens
  on about one judgement in ten and is *not* a judgement of the briefing, and a
  next action.
- The button relabels to **Judge it again** and starts a fresh commission.

There is no code path that draws a spinner on this outcome.

---

## Verification — what I ran, pasted

Run from PowerShell (Git Bash's `whoami` fakes channel-secret failures).

```
> pnpm typecheck
> tsc --noEmit
(clean)
```

```
> pnpm vitest run
 Test Files  259 passed (259)
      Tests  4930 passed | 13 skipped (4943)
   Duration  52.07s
```

```
> npx vitest run tests/broker-genlayer.test.ts
 Test Files  1 passed (1)
      Tests  30 passed (30)
```

```
> node scripts/brand-check.mjs
✓ brand:check passed — 12 characters audited against the vendored manifest, …
```

```
> pnpm build:shell
[build-shell] wrote dist\electron runner_build=ece23019d06309eae8ae
```

**A live end-to-end run against the deployed contract, 2026-09-04:**

```
14:35:56 account 0x6075c004e754b12356251E0c8519CfE9B9da31dF
14:35:57 faucet  {"jsonrpc":"2.0","result":"0xd0a1ab6c…","id":1}
14:36:34 open     0xfa5cad667d4cdc2b28e7f047420285baa3ceb04fa84215f2d3e061644be7a35f
                  FINALIZED SUCCESS MAJORITY_AGREE  acc=5663ms fin=34782ms
14:37:10 submit   0xdefb2166bac1131294097cc7a287860f477c953adcc5101a3cacbd7f2a57bb97
                  FINALIZED SUCCESS MAJORITY_AGREE  acc=5782ms fin=35186ms
14:37:56 evaluate 0x873d79fd81bbfd9a9dea038ba6e5b143652cf4c53be07d11fe429292c6e7d5d5
                  FINALIZED SUCCESS MAJORITY_AGREE  acc=13900ms fin=45993ms
14:37:57 VERDICT  {"verdict":"ACCEPTED","reasons":[]}
```

Contract `0xD08455a5Cfc53E43731834d6C92a6FE4aA0b3B75`, chain 61999,
`https://studio.genlayer.com/api`. 121 seconds end to end.

**Note the empty `reasons` on an `ACCEPTED`.** That is real and the surface
handles it — `ADJUDICATION_NO_REASONS` says *"The committee gave no reasons
beyond the verdict."* rather than drawing an empty list.

---

## What is NOT done

- **The installed-build behavioural proof.** See below.
- **The no-verdict path has not been reproduced live.** It is 1-in-10 and did not
  come up. It is driven in the test against the receipt shape the spike recorded
  as iteration 8 of `transcripts/stability.json`:
  `{"n":8,"verdict":null,"state_applied":false,"consensus":"MAJORITY_DISAGREE","acc":93637,"fin":123640}`.
- **The `genlayer` connection has no card on the Connections page.** It is
  declared, validated and used, but `lib/fleet/catalogue.ts` builds its rows from
  credential custody and `ServiceKind` is `account | key | server` — a connection
  that holds no credential has no shape there yet. The defaults ship and work; a
  person cannot yet change the endpoint or the address from a page.
  `resolveGenLayerConnection` takes the overrides and is called with `{}`.
- **No agent can ask for a judgement**, by design (ADR 0033 decision 1).
- **No appeal path, no Bradbury, no value transfer** — the stated non-goals.

---

## Contradictions between the brief and the repo

1. **"A new broker operation"** — declared in the broker's file but outside the
   `BrokerOperation` union. Argued above and in ADR 0033 decision 1.
2. **"Read-only: electron/"** — could not hold. Stated above, with the three
   edits enumerated.
3. **The spike's `commission-terms.json` `asked` clause names OpenClaw and Hermes
   Agent specifically.** DASH's copy in `lib/genlayer/terms.ts` generalises that
   one clause to *"this agent's subject"*, because DASH judges whatever brief it
   is given. The two clauses the judge actually grades on —
   `acceptance_criteria` and `evidence_requirements` — are the spike's, verbatim,
   so the transcripts remain measurements of the sentences that shipped.
4. **`lib/brief/fingerprint.ts` is "already the other half of the payload
   builder"** — true, and `fingerprintItems` is imported rather than transcribed.
   The spike's script had its own copy; that copy is not ported.

---

## The proof, and it is behavioural

`proven` = on the **installed** build, a real agent's brief is sent for
adjudication from the button and the verdict renders as a receipt in the Output
stage, with the transaction hash and a screenshot.

The one thing the next session should do first: **run the installed build,
press the button on a real `ai-agent-news` or `competitor-scout` brief, and
capture the verdict on screen.** Everything else in this packet is done and
green; that is the line between `merged` and `proven`.

Two things that will bite whoever does it:

- The agent needs a brief with a **matching digest in the same run**. A brief
  whose digest has drifted is refused before anything is published — correctly —
  and the sentence on screen will say the list does not match rather than
  anything about the network.
- It takes one to five minutes. The card says what stage it is at on the page's
  own five-second poll; do not read a quiet page as a hang before minute six.
