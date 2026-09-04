# Session prompt — MAR-863: `genlayer.adjudicate`

Dispatched by the orchestrator 2026-09-04, in parallel with MAR-862. Packet 2
of MAR-861 (Agent Tank, deadline 2026-09-17 15:30 UTC).

**This is the only packet the hackathon judges actually score. It must not
slip.**

---

**Client:** Claude Code, `claude --model opus` with extended thinking.

**Why this tier:** a new broker operation is a security boundary, and
AGENTS.md routes security boundaries and architecture to opus. It also decides
a new connection kind and a new artifact surface. Not a bounded-implementation
packet.

**Repository:** `orchestratedash`.
**Worktree:** create `C:\Users\henri\AppData\Local\Temp\wt-mar863-adjudicate-b1`
(the suffix is deliberate — worktree names collide across sessions).
**Branch:** `000henrik/mar-863-genlayer-adjudicate`, from `master` at or after
`3004f41`.
**Linear issue:** MAR-863. Read it in full first.

## File ownership — a parallel session is live

**MAR-862 is running right now** and owns `tools/dash-mcp/**`, `docs/adr/0032-*`
and `docs/mar-862-handoff.md`. **Do not touch any of those.**

**You own:**

- `lib/broker/operations.ts`, `lib/broker/execute.ts`
- `lib/genlayer/**` (new — the client and the payload builder)
- `lib/connection-spec.ts`, `lib/connection-requirements.ts`,
  `lib/connections-list.ts` — only as far as the new connection kind needs
- `app/_components/outputs.tsx`, `app/_components/panel.tsx`,
  `app/_components/digest.tsx`
- `lib/copy/**` for the new strings
- `docs/adr/0033-*.md` — **ADR number 0033 is assigned to you.** 0032 belongs
  to the parallel session. Do not pick another.
- `docs/mar-863-handoff.md`
- tests for all of the above

**Read-only:** `tools/**`, `runner/**`, `electron/**` unless the operation
genuinely cannot be wired without it — and if that is true, say so in the
handoff before editing.

## Objective

A button in DASH sends an agent's brief for adjudication on GenLayer, and the
verdict comes back as a receipt beside the citations. That is the demo.

## The four-part rule governs

`lib/broker/operations.ts:1844` states the rule for adding an operation. Meet
it on all four counts and say in the handoff how each is met:

1. **Card sentence in the user's words** — *"have this brief judged on
   GenLayer"*, not *"submit to an intelligent contract"*.
2. **Scope list unchanged** — `required_scopes: []`, no growth in
   `SPEND_PATHS`.
3. **Request shape** carries the commission id, the deliverable payload and the
   terms, and nothing an author could fill.
4. **Projection** returns `{verdict, reasons[]}` and a different structure from
   either existing one.

## One connection kind, and it holds no key

`genlayer`: an RPC endpoint and a contract address. **No credential.** The
account is a throwaway made per run by `createAccount()` and funded from
Studionet's built-in faucet over the `sim_fundAccount` RPC method. Nothing
enters the vault, so there is nothing for the broker to gate on spend and
nothing to leak.

## Reuse, do not re-derive

The spike repo `github.com/orchestratemcp/brief-acceptance` has the working
code. Port it, do not reinvent it:

- `scripts/dash-brief-to-payload.mjs` — brief + digest to on-chain payload
- `scripts/lib/studio.mjs` — the client, the retry, and `applied()`

`lib/brief/fingerprint.ts` is already the other half of the payload builder.
Recompute `derived_from.items_digest` and **refuse the payload if the join
fails**, exactly as DASH's own renderer already rules.

**No addresses cross.** Evidence rows carry a receipt id
`<digest artifact>#<n>` instead of a URL, which keeps DASH's rule that
model-authored prose never carries a link. Write the test that asserts no
`http://` or `https://` reaches the case file.

## The three-field trap that cost the spike two runs

| Field | Question it answers |
|---|---|
| `status_name` | did it reach a decision? |
| `consensus_data.leader_receipt[0].execution_result` | did the leader's call succeed? |
| `result_name` | did the committee accept the leader? |

A write can be **FINALIZED**, with **SUCCESS** execution, and apply **no
state**, because consensus was `MAJORITY_DISAGREE`. Measured at roughly **one
judgement in ten** over ten runs. `applied()` in the spike repo is the
three-part check.

**The UI must have a resubmit path for the no-verdict outcome, not a spinner.**
A screen that waits forever on one run in ten is the defect this packet is
most likely to ship.

## Latency is not a detail

Measured across ten judgements: `evaluate` took **16 to 249 seconds** to
accepted and **45 to 281 seconds** to finalized. Budget for the tail. No fixed
timeout. The run is long enough that the surface needs to say what is
happening.

## Known traps

1. **Two renderers draw an artifact card.** Fixing `outputs.tsx` does not fix
   `panel.tsx`. Both call `DigestBody`; put the change where both get it.
2. **The author's panel forbids controls.** ADR 0008 bars buttons there. The
   button belongs on DASH's own card.
3. **Adding `genlayer-js`** brings a dependency into the main-process bundle.
   Check it bundles under esbuild ESM before building on it; a Node-only entry
   point has broken this bundle before.
4. **A new ADD COLUMN migration must be guarded**, and its index is one less
   than `user_version`. If you need a migration, grep the literal pin in
   `tests/store-sqlite.test.ts` before writing the step — an assigned index can
   be stale.

## Non-goals

- No appeal path this packet.
- No Bradbury, no real chain-layer transfer. Studionet only.
- No key in the vault, no new spend path.
- Do not touch `tools/dash-mcp/**` — the parallel session owns it.

## Start checks

```bash
git rev-parse --abbrev-ref HEAD
git status --short
git log --oneline -1
```

Confirm your own branch, your own worktree, a clean tree, and that `master` is
at or after `3004f41`.

## Verification

Run from **PowerShell**, not Git Bash — Git Bash's `whoami` fakes
channel-secret failures.

```bash
pnpm -w typecheck
```

```bash
pnpm vitest run tests/broker-genlayer.test.ts
```

If you run the full `pnpm verify`: **close DASH first**, or the shell smoke
dies silently with exit 0 in about five seconds and no proofs. Redirect the
output to a file; piping `verify:shell` into `Select-Object` hangs on stdout.
Expect exactly 85 PASS and 0 FAIL from the smoke; fewer means it died mid-run.

## Lifecycle exit state

`merged` when the PR is green on master. **Not `proven`.**

## The proof, and it is behavioural

`proven` = **on the installed build, a real agent's brief is sent for
adjudication from the button, and the verdict renders as a receipt in the
Output stage.** Paste the transaction hash and attach the screenshot.

Reach the no-verdict path at least once if you can. If it will not reproduce
live, say so and cite the spike's `transcripts/stability.json`, which has one.

## Evidence to write back

1. A comment on MAR-863: commit SHA, PR number, what you verified and **how**
   (paste it), what is not done, and any contradiction between this prompt and
   the repo.
2. `docs/mar-863-handoff.md` in the PR, same content.
3. The one thing the next session should do first.

## Coordination — read this before pushing

MAR-862 is live in another worktree. Ownership is disjoint by design. If its
PR merges first: **merge master in. Never rebase a pushed branch and never
force-push.** Assume your PR can merge while you work, and re-read state
before pushing. If you find yourself needing a file the other session owns,
stop and write the handoff instead of taking it.

## Hard stop

When the operation exists, the connection kind is declared, the verdict renders
as a receipt, the no-verdict path has a route out, ADR 0033 is written, the
tests pass and the handoff is written: **stop.** Do not build the appeal path,
do not touch the deploy plane, do not start MAR-864. Write the handoff and end
the session.
