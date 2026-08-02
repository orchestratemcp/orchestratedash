# ADR 0004: A release gate may not depend on somebody else's uptime

Status: Accepted

Date: 2026-08-02

## Decision

The Windows `shell-smoke` gate is split in two.

1. **Mandatory and blocking.** The installed loop — a real Electron shell, a
   detached runner, a run that completes, telemetry that reaches the Runs
   bridge, an artifact that crosses into DASH, and a page that draws it — is
   proven against **feeds served by the harness itself** over loopback. It
   depends on nothing outside the machine running it.
2. **Advisory and never blocking.** Whether the three addresses the AI News
   Scout ships with still answer, still parse, and how slowly, is asked
   separately by proof `6l`, printed with a timestamp and per-source status,
   and recorded in `failures` **never**.

MAR-457 made the live fetch the point of the proof, and this ADR does not undo
that. It moves the liveness question out of the blocking path and, in the same
change, makes it a real question for the first time.

## The evidence this rests on

`shell-smoke` failed on `0ac58ac` — a documentation-only commit — at proofs
6g/6i/6j/6k, having passed on the four master runs before it and every run
since. Reading all thirteen CI runs from 2026-08-01 onward gives the mechanism,
and it is arithmetic rather than luck:

| run | 6g | digest written | telemetry lag | items | slack left |
| --- | --- | --- | --- | --- | --- |
| 30739044032 | PASS | 1.0s | 3.8s | 30 | 19.0s |
| 30743772691 | PASS | 0.7s | 4.4s | 30 | 19.3s |
| 30743867794 | PASS | 0.8s | 5.5s | 30 | 19.2s |
| 30746871033 | PASS | 1.2s | 3.6s | 30 | 18.8s |
| 30736386756 | PASS | 11.2s | 3.7s | **20** | 8.8s |
| 30753436632 | PASS | 11.6s | 3.3s | **20** | 8.4s |
| **30753490951** | **FAIL** | **15.6s** | **4.6s** | — | **4.4s** |
| 30754387170 … 30756061314 (5 runs) | PASS | 0.8–1.4s | 3.4–4.0s | 30 | ~19s |

- Telemetry propagation is a **constant**: 3.3–5.5s in every recorded run. The
  Runs bridge, which 6g is named after and which the failure appeared to
  indict, is not the variable and never was.
- Fetch time is **bimodal**: ~1s when all three sources answer, 11–16s when one
  does not. `items_total` 30 is three sources × `MAX_ITEMS_PER_SOURCE`; 20 is
  one source gone.
- `agent-kit/template/agent.mjs` reads sources **sequentially** with a
  **15-second** timeout each. `electron/smoke.ts` gave 6g a **single 20-second**
  budget covering the fetch *and* the propagation behind it.

So one unresponsive source consumed 15 of the 20 seconds and left ~5 for a step
that needs ~4. On `0ac58ac` the fetch took 15.6s and the telemetry needed 4.6s:
**the gate lost by 0.2 seconds** and reported it as `6g … : null`.

The two competing explanations — "an outbound fetch was blocked" and "the run
did not complete inside the harness's wait" — are the same event seen from two
ends. The network is the variable; the bridge is the victim. Worst case is
3 × 15s = 45s against a 20s budget, so this was never a rare race: it was a
gate that fails whenever any one of three third-party endpoints hangs.

## Why not simply raise the timeout

Because it treats the symptom and keeps the dependency. A 60-second budget
survives one hung source and still fails on two, and it makes every green run
slower for a guarantee that remains somebody else's to withdraw. The gate would
go on being unreliable, just less often — which is worse, because a gate that
fails rarely is a gate people re-run rather than read.

## Why not simply delete the live fetch

Because MAR-457's argument is right: a digest nobody can verify is precisely
what DASH exists not to ship, and a proof that only ever reads fixtures cannot
notice the day Google News changes its RSS shape.

That argument, however, applies to a proof that actually checks. **The one that
existed did not.** Proof 6j asserted `verdict !== undefined` — that *some*
verdict had been computed. Per `lib/analyze.ts`, a digest of **zero** items from
three unreachable sources has nothing uncited and nothing unsupported, so it is
reported `grounded`, and 6j passed. It would have passed on `ungrounded` too.

This is not hypothetical. Runs 30736386756 and 30753436632 carried 20 items
where 30 were expected — one of the three shipped sources was gone — and every
proof stayed green. The gate was already blind to the thing it was paying for.

**So the trade is not "liveness versus reliability".** The old gate paid the
full flakiness cost of three third-party endpoints and received no liveness
guarantee in return. The split pays nothing and asks a sharper question.

## What the split actually buys

The mandatory gate gets *stronger*, not weaker, in three ways:

- **Exact counts.** Against a local feed the expected item count is known, so
  6j now asserts `verdict === "grounded"` **and** `items_total === items_cited
  === 9` instead of "a verdict exists". The 20-instead-of-30 degradation that
  slipped through twice cannot slip through now.
- **All three parsers, every run.** The loopback feed serves one document per
  declared format (`rss`, `hn_algolia`, `atom`). Reading three live feeds never
  guaranteed this: a quiet source simply contributed fewer items.
- **Determinism.** Proof `6g`'s budget now covers propagation only, and is
  measured against the 3.3–5.5s that step has actually taken.

The advisory proof is likewise sharper than what it replaces: it names the
source that failed, its HTTP status, its latency and whether the body still
parses as the format it declares.

## What stops being proven

Stated plainly, because this is the cost:

**A release can now go green while one of the three shipped source URLs is
dead, has moved, or has changed shape.** Nothing blocking will stop it.

Two things bound that cost. First, the sources are configuration the user owns
(`sources.json`) rather than code, and a dead source already degrades honestly
in the product: `readSource` reports `unreachable`, `not_a_feed` or `empty` per
source, `analyzeGrounding` refuses to vouch for what it cannot trace, and the
run detail page shows it. Second, the advisory proof runs on every
`shell-smoke` and says which source failed — where the blocking gate said only
`null`. What is lost is enforcement, not visibility.

The honest accounting is that enforcement was never really there: the gate
passed twice with a source down. This ADR trades a guarantee that did not exist
for a signal that does.

## The general rule

**A blocking release gate may depend only on this repository and this machine.**
Anything that depends on a third party's uptime is advisory, dated, and named
so a person can act on it.

The reasoning is MAR-465's, which this repository has now paid for twice. A
gate that goes red for reasons the committer cannot fix teaches people that red
means "re-run it", and a signal nobody believes is worse than no signal: it
costs the same to produce and it protects nothing. `state:check` was red for
three merges and said nothing true. `shell-smoke` failed a documentation-only
commit. Both taught the same lesson from opposite directions.

## Follow-ups this does not do

- MAR-468's real-Google proof stays a dated **manual** proof with a human at a
  consent screen, and must not enter `pnpm verify`. Same rule, same reason.
- Whether the advisory result should be recorded somewhere durable rather than
  only printed in a job log is left open. It becomes worth doing when somebody
  wants the trend rather than the current answer.
- The scout still fetches sequentially. Fetching in parallel would cut the
  worst case from 45s to 15s and is a sensible change on its own merits, but it
  is not load-bearing now that the blocking gate reads loopback, so it is not
  made here.
