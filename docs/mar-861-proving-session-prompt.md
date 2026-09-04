# Session prompt — proving MAR-862 and MAR-863 on the installed build

Dispatched by the orchestrator 2026-09-04. Both packets are `merged` and
neither is `proven`. This session closes both, and it doubles as the dress
rehearsal for MAR-866's video.

---

**Client:** Claude Code, `claude --model opus` with extended thinking.

**Why this tier:** installed/runtime proof work, which AGENTS.md routes to
opus. It also requires judgement about what counts as proof and when to stop
and hand off rather than fix.

**Repository:** `orchestratedash`, on `master` at or after `13f648b`.
**Worktree:** work in the **main checkout**, not a worktree. A worktree shell
resolves the real store through `package.json`'s name and you want the real
installed build here deliberately.
**Linear issues:** MAR-862 and MAR-863, both in epic MAR-861.

## Objective

Reach `proven` on both, with behavioural evidence:

- **MAR-862** — a fresh agent scaffolded by the `dash-agent` plugin, in a
  clean session, imports into the installed DASH build with **zero validation
  failures** and appears in the fleet.
- **MAR-863** — that agent's brief is sent for adjudication from the button on
  DASH's own output card, and the **verdict renders as a receipt** beside the
  citations.

## File ownership

**You own:**

- `docs/mar-861-proving-handoff.md` — your handoff
- `qa-screenshots-mar-861/**` — a new directory for the evidence
- **Bounded fixes only**, and only in files MAR-862 or MAR-863 already own
  (`tools/dash-mcp/**`, `lib/genlayer/**`, `lib/broker/operations.ts`,
  `app/_components/{outputs,panel,digest}.tsx`, `lib/copy/genlayer.ts`)

**Read-only:** everything else. `.orchestrate/state.json` is the
orchestrator's; do not edit it. No new ADR — 0032 and 0033 are taken and you
are not making a new decision.

**A fix is allowed only when it unblocks the proof.** Name every one in the
handoff with the reason. If a defect needs a design decision, **stop and hand
off** — do not decide it at a deadline.

## Order of work

### 1. Build and install

```bash
pnpm build:renderer
```

```bash
pnpm build:shell
```

Both, in that order. Building the shell without the renderer first means you
photograph a page that does not exist.

### 2. Prove MAR-862

Install the plugin from `tools/dash-mcp` and use it from a **clean session** —
the proof is that a coding agent with no memory of this repo gets it right.
Scaffold an agent, validate it, install it, and import it into the installed
DASH.

Name the agent something obviously disposable, for example
`proof-scout-mar861`. **Do not delete anything from the store** to make room.

The proof is: zero validation failures, and the agent visible in the fleet in
the running app. Screenshot it.

### 3. Give it something to produce

Run the agent so it emits an artifact-v2 `brief` with `derived_from` and
`items_digest`, plus the digest it cites. Without a brief there is nothing for
MAR-863's button to act on.

If the scaffolded template cannot produce one unaided, say so plainly — that is
a finding about MAR-862's recipe, not a reason to hand-write an artifact.
Falling back to the `competitor-scout` brief already in the store is acceptable
for MAR-863's proof; record which one you used.

### 4. Prove MAR-863

Check the shipped endpoint first. `lib/genlayer/connection.ts` ships:

```
rpc_url          https://studio.genlayer.com/api
contract_address 0xD08455a5Cfc53E43731834d6C92a6FE4aA0b3B75
```

**Studionet is explicitly temporary and its state is not guaranteed across
deployments.** Confirm that contract still answers before assuming a failure is
DASH's. If it has been reset, redeploy from
`github.com/orchestratemcp/brief-acceptance` with
`node scripts/studionet-run.mjs` or its deploy path, and record the new address
in the handoff — the orchestrator will decide whether the shipped constant
moves.

Then press the button and watch. Record the transaction hash, screenshot the
receipt beside the citations.

**Expect it to be slow.** Measured: 16 to 249 seconds to accepted, 45 to 281
seconds to finalized. A long wait is not a hang.

**Expect a no-verdict outcome about one time in ten** — FINALIZED, leader
execution SUCCESS, consensus MAJORITY_DISAGREE, no state applied. If you hit
it, that is a *bonus proof*, not a failure: photograph it, because MAR-866's
video wants that beat. The button should relabel to "Judge it again" and there
must be no spinner.

## Gotchas that have cost sessions before

- **Run everything from PowerShell**, not Git Bash. Git Bash's `whoami` fakes
  channel-secret failures.
- **Never force-kill Electron.** It corrupted the real store once. Close the
  window and let it exit.
- **`pnpm verify` needs DASH closed.** A lock-holding Electron kills the shell
  smoke silently with exit 0 in about five seconds and no proofs. Expect
  exactly 85 PASS and 0 FAIL; fewer means it died mid-run. Redirect the output
  to a file — piping `verify:shell` into `Select-Object` hangs on stdout.
- **`electron .` skips the store guard.** Use the packaged launch path.
- **The store and the vault are two roots.** Moving one without the other reads
  as `not_found:ENOENT` on a credential that exists.
- **Reading the live store needs the WAL.** Copy the `.sqlite` *and* the
  `-wal`, never the `-shm`, and read the copy.
- **`innerText` returns uppercased chips.** Grepping chip copy reads false
  while it is on screen.

## Verification before you finish

```bash
pnpm typecheck
```

```bash
pnpm test
```

Only if you changed code. If you changed nothing, say so and skip them.

## Lifecycle exit state

Propose `proven` for whichever packet you actually proved, and `merged` for
whichever you did not. **You do not edit `state.json`** — the orchestrator
promotes on your evidence.

A handoff that claims something works without naming the command or artifact
that showed it is treated as `merged`, never `proven`. Screenshots are evidence
of a screen; the transaction hash is evidence of a chain.

## Evidence to write back

1. Comments on **MAR-862 and MAR-863** separately, each with what was proved,
   the exact evidence, and what was not.
2. `docs/mar-861-proving-handoff.md` with both, plus every bounded fix you made
   and why, plus any contradiction between this prompt and the repo.
3. The screenshots in `qa-screenshots-mar-861/`.
4. The one thing the next session should do first.

## Leave the app running

When you are done, **launch the packaged shell and leave DASH open** with the
proof on screen. Henrik ends sessions by looking at the app, not at a test
summary.

## Hard stop

When both proofs are attempted, the evidence is written and the handoff is
complete: **stop.** Do not start MAR-864, do not enrol a host, do not begin the
video. Write the handoff and end the session.
