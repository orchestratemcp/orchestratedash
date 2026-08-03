# DASH project state

Updated: 2026-08-01 (Wave 1 proven)

Portfolio sequence and estimates: [`../orchestratekit-mcp/docs/PORTFOLIO_ROADMAP_2026-08-01.md`](../orchestratekit-mcp/docs/PORTFOLIO_ROADMAP_2026-08-01.md).

## Outcome

DASH has crossed the installed first-run gate and the usefulness gate behind it. The packaged renderer, no-terminal sample handoff, build-identified runner, graceful shutdown, runner-hosted telemetry, Runs inspection and verdict are reproducibly proven on Windows; so, since MAR-457, is a cited digest a person would actually read.

**One Wave 0 claim was overstated and is corrected here.** "Artifact output" was proven only as *the agent wrote a file into its own folder* — smoke proof 6e was a directory listing. DASH had no artifact contract, table, view or surface, so nothing about that proof said DASH could show the result. MAR-457 built that seam and proves it end to end.

## Wave 0 - installed first-run reliability (proven 2026-08-01)

`pnpm verify` passed after the requested Windows restart: 51 test files, 843 tests, the real Electron renderer/preload path, exact runner build/protocol identity, pending-before-consent handoff, a new runner-hosted run in Runs, compliant verdict, digest artifact, confirmed process exit, and bounded Windows cleanup.

Implementation evidence: `05201e7`. Wave 0 is frozen; regressions belong in the mandatory smoke rather than a parallel proof path.

## Wave 1 - the shortest real agent loop (proven 2026-08-01)

**AI News Scout replaced the folder digest as the sample**, rather than shipping beside it: two samples would mean two first journeys and the undemonstrated one rots. `pnpm verify` passed at `c658667` — 53 test files, 878 tests, and 41 installed-shell proofs with no failures. Proof 6j read a live digest of 30 items from Google News, Hacker News and arXiv, every item cited, every citation traced to a source the run reported reading; 6k drew it on the run detail page.

The agent now **waits to be asked**. Its manifest always declared a manual trigger while its code ran at startup and every thirty seconds; those now agree, and proofs 6d/6e are negative checks that catch a regression back to a timer, which nothing else would.

Grounding is a **second verdict axis**, deliberately outside `RunAnalysis.compliant`: a missing citation must never render in the same red as an unapproved irreversible action. It verifies the digest against the run's own report of what it fetched, which is internal consistency, not independent proof a fetch happened — DASH does not see the network.

`network: read` is a **declaration DASH renders, not a boundary DASH enforces**. The runner strips the environment but spawns an ordinary process with ordinary network access, so every surface attributes the claim to the agent. Same honesty ADR 0002 requires of the draft-only Gmail boundary.

Four defects reached the installed smoke and none of them reached a unit test: no caller drained the artifact buffer, a runless task read as an unknown target, `observed_at` churned every five seconds against an exact-match check, and two proofs were themselves wrong. See ADR 0003 and MAR-457.

The third of those was repaired only for Run now, and **MAR-464 finished it**. `observed_at` was binding the identity of a *poll* while the check it fed needed the identity of a *decision context*; it now advances only when that context does. The Run now workaround is deleted rather than generalised — re-reading the snapshot before each command would have removed the "look again" check in front of an irreversible action and, less visibly, idempotency along with it, because the key is derived from `observed_at`. Proofs 3g and 3h are the paired guard. See ADR 0003 amendment 1.

MAR-455 landed `public_feed_fetch` in the registry. MAR-456 remains open; it is no longer a blocker, and no DASH copy claims the recommended MCP path leads here until it lands.

## Wave 2 - outside-app connections

Build MAR-458's permission broker, not a token pass-through. Google sign-in identifies the user; connector authorization separately grants Gmail/Calendar scopes. The broker owns refresh tokens and exposes narrow agent tools. Start Gmail read/search/draft-only: no send tool exists even if the provider scope could technically allow it. Support MCP connectors behind the same permission cards and audit trail. Reuse MAR-446 for BYO Google client onboarding.

**MAR-458's first slice is built.** The spawn path no longer delivers a provider
token: `deliverableSecretFields` cannot return an OAuth target, and
`assertNoBrokeredCredentials` refuses the spawn if one ever appears. An agent
reaches Gmail through `gmail.search` and `gmail.message.read` — two read
operations whose provider URL DASH constructs and whose response DASH projects —
and produces a **local** draft artifact. There is no send operation and no
provider-side draft creation, so `gmail.compose` grants no operation at all.

A grant is the intersection of three parties: DASH implements it, the manifest
declared it, the provider issued it. It is re-resolved on every call, so
disconnecting takes effect on an agent's next request rather than at its next
restart.

**Two things this slice does not claim.** The compiled Google client id is
*disclosed* on the capability card, not removed — BYO-client onboarding stays
after this slice, where ADR 0002's own rollout puts it. And the installed proof
runs against a loopback provider, because Google needs an account, a human at a
consent screen and a restricted-scope verification DASH does not have: proof 7
establishes the boundary, not Gmail's API.

See ADR 0002 amendment 1, which also corrects this ADR's account of the defect —
the raw-token path required a manifest to declare `technical.environment_name`
on its OAuth field, and no shipped example does.

**MAR-467 is built.** A brokered request DASH never received now leaves a trace,
and the judgment is in ADR 0005: an attempt nobody adjudicated is a **different
kind of fact** from a decision DASH made, and it is kept different in the data
model rather than only in the copy. The new `broker_lapses` table has no
`decision`, `refusal`, `operation`, `connection_id` or `request_id` column, so no
row in it can be mistaken for an audit row by a careless join or a future
renderer; `tests/store-sqlite.test.ts` pins the column list.

The issue's own account of the third case was wrong and is corrected there. An
undeliverable answer does **not** leave no trace: `lib/broker/execute.ts` audits
on every path before the answer travels, so the row already exists and reads
"allowed, 12 results" for a call the agent got nothing from. That is a record
which overstates rather than a missing one, so it became a `delivered` column on
the audit row and not a second population of near-misses. Two other things were
already known and thrown away: the runner counted drops without attributing them,
and `POST /broker/responses` had always returned which answers failed, in a body
`electron/broker-host.ts` never read.

DASH-was-closed is the case nobody observed, by construction. Nothing is stored
about the agent: DASH records **its own absence**, and the per-agent sentence is
derived at render time from whose runtime declares `continues_when_dash_closed`,
because that answer changes when a manifest does.

**One of the three is proven end to end** (proof 8, the buffer drop: 200 requests
against a bound of 64, drained and rendered by the installed shell's own broker
loop). Proof 8d is the load-bearing one — it fails if the audit rows and the
dropped requests sum past what the agent actually sent, which is what a
synthesised row would do. Cases 1 and 3 are covered by unit tests only, and ADR
0005 says so plainly rather than letting the total imply otherwise.

`pnpm verify` is green on Windows at `56b16a2`: `[state] valid`, typecheck, 60
test files, 1056 tests, and 63 installed-shell proof checks with no failures.
Proof 8 reported the same three numbers on every run — 200 sent, 64 adjudicated,
136 dropped — which is what a bound being hit looks like next to a race.

One smoke run was lost to **inherited state, and it was proof 7 that failed
rather than anything MAR-467 built**. An interrupted earlier run had left its
requests in the runner's *bounded buffer*, which survives DASH; the next pass
drained and adjudicated them at startup and seeded the broker's per-agent replay
set with proof 7's fixed request ids, so that run's real calls came back
`duplicate_request` and five checks failed together, naming a boundary that was
working correctly. Proof 7's ids are unique per smoke process now. This is
MAR-473's lesson pointed the other way: a proof a leftover can *fail* is worse
than one a leftover can satisfy, because a blocking gate that goes red for an
unrelated reason teaches people to re-run it until it is green.

Wave 2's remaining work: MAR-468 (the real-Google proof that would promote
MAR-458 to `proven`), MAR-469 (provider-side draft creation), MAR-470 (MCP
connectors through the same card), MAR-471 (bring-your-own Google client).

## The release signal, repaired (MAR-465, MAR-466, MAR-473)

All three defects are fixed and proven. MAR-465 and MAR-466 merged in PR #31 at
`08a0d36`; MAR-473 — found while proving them, and the reason "master is green"
meant "master was green once" — is PR #32.

`pnpm verify` is green end to end on Windows: `[state] valid`, typecheck, 59 test
files, 1033 tests, and 57 installed-shell proofs with no failures. The two gates
now say different things on purpose. `verify` (Linux) checks that the state
packet's ancestry claims are true; `shell-smoke` (Windows) checks the installed
loop against sources this machine serves. Neither can be made red by a third
party, which is ADR 0004's rule and the reason the signal is now worth reading.

**MAR-465 (proven).** `fetch-depth: 0` on both jobs, but the line that mattered
more is what `INVALID` is now allowed to mean. A commit absent from this *clone*
is `UNVERIFIED` and the run says it is not ancestry evidence; a commit absent
from this *repository* is `INVALID`. On its own, `fetch-depth: 0` would have
traded a false red for a false green, so a shallow clone under CI is itself a
failure that names the workflow line responsible — deleting that line goes red
again rather than passing having checked nothing. Proven both directions on
GitHub Actions: the first green `verify` since 2026-08-01, and then a
deliberately fabricated commit sha failing with **one** precise line rather than
the shotgun every-issue-`INVALID` a shallow clone produced.

**MAR-466 (proven).** The cause was **accumulated store state**, and the
hypothesis in the issue was wrong: `decisionIdentity` never treated
`runs[].progress` as a change, and nothing else wrote a snapshot. Proof 3h ends
by writing a snapshot dated `observed_at + 120s`, deliberately, and nothing
removed it. `putAgentDomState` refuses any snapshot older than the newest the
runner has said — correctly — so for two minutes afterwards the *next* run's seed
was refused as out of order and every proof from 3c down ran against the previous
run's world. The intermittency was a stopwatch, not a race, which is how a proof
recorded as proven at `b9f5f07` could fail later on the same commit.

Proof 3 now forgets the agent before seeding and takes the fabricated future back
out when done. The quieter defect was **3b, which could not notice it had failed
to seed**: an out-of-order snapshot is declined as `{ ok: true, superseded: true }`
and the check read only `ok`, so it reported success having written nothing and
pushed its own failure downstream into 3c, where it read as a defect in the thing
3c is about. Three consecutive `verify:shell` runs, 56 proofs each, zero
failures — runs 2 and 3 seeded 29.6 seconds apart, so the last one sat squarely
inside the window that used to poison it.

**MAR-473 (fixed and proven).** `shell-smoke` was *not* the reliable half
MAR-465 assumed, and the cause was arithmetic rather than luck. Reading all
thirteen CI runs since 2026-08-01 separates the failure from the passes: telemetry
propagation is a **constant** 3.3–5.5s in every run, while the agent's fetch is
**bimodal** — ~1s when all three sources answer, 11–16s when one does not
(`items_total` 30 versus 20). The scout reads its sources **sequentially** with a
15-second timeout each, and `6g` had a **single 20-second** budget covering the
fetch *and* the propagation behind it. One hung source spent 15 of the 20 seconds
and left ~5 for a step needing ~4. On `0ac58ac` the fetch took 15.6s and the
telemetry needed 4.6s: **the gate lost by 0.2 seconds** and reported it as
`6g … : null`.

So the two candidate stories — a blocked fetch, and a run not finishing inside
the harness's wait — were the same event seen from two ends. The network was the
variable; the bridge was the victim. Worst case is 3 × 15s against a 20s budget,
so this was never a rare race.

The mandatory gate now reads three **loopback** feeds the harness serves, one per
declared parser; the live sources moved to `6l`, which is dated, names the source
that failed, and can never fail a release. **ADR 0004** records the policy: a
blocking release gate may depend only on this repository and this machine.

Three defects were fixed independently of the root cause. `6g` failed with
`null`, which cannot distinguish "no run" from "a run still running" from "a
completed run whose id predates this proof"; it now reports what it waited for,
for how long, over how many polls, and what it saw. `6i`/`6j`/`6k` were hardcoded
to `completed?.run_id ?? ""`, so one upstream failure printed three red lines each
blaming the thing it is named after; they skip explicitly now. And `6j` asserted
only that *a* verdict existed — a digest of **zero** items from three dead sources
is reported `grounded`, so it passed whether the fetch worked or not, and twice it
did exactly that on runs 30736386756 and 30753436632, which carried 20 items where
30 were expected with nobody the wiser.

The gate is therefore **stronger**, not weaker: exact item counts, all three
parsers exercised every run, and a propagation budget measured against what that
step actually takes. What stops being proven, plainly: a release can go green
while one of the three shipped source URLs is dead or has changed shape. The
honest accounting is that enforcement was never there.

**MAR-472 (fixed here, filed for the record).** `tests/broker-transport.test.ts`
failed 3 runs out of 3 under full-suite load on Windows, on master's own code —
`settle(400)` betting a fixed sleep on Windows spawning a Node process. It waits
for the line now instead of assuming it. Assertions unchanged, `lib/broker/`
untouched. Fixed because `pnpm verify` could not go green on Windows without it.

## UX principle

The home view answers three questions: what can I run, what is happening now, and what needs my decision? Connections are capabilities with scopes and receipts, not a wall of OAuth settings. Every run should make inputs, actions, outputs, gates, and failures inspectable.
