# DASH project state

Updated: 2026-08-05 (the design pass executed; Wave 1 proven)

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
*(The last sentence describes stage 1 only. MAR-469 built `gmail.draft.create` on
that scope; there is still no send operation. See below.)*

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

**MAR-469 is built: the broker can now change something in somebody's account.**
`gmail.draft.create` puts a reply in the user's own Drafts folder, and there is
still no send operation. The judgment is ADR 0002 amendment 2.

What made stage 1's claim true was an absence — nothing was built on
`gmail.compose`, so a credential granting it granted no operations at all and "no
send exists" needed no check. That argument is spent, and what replaces it is
structural in ADR 0005's sense: **a write operation has no `plan`.** It cannot
return a URL, a path or a method, because the type declares no member that could
carry one; it declares a frozen `path` and a `compose` that returns a JSON body.
So the complete answer to "what can this do to my account?" is one array,
`WRITE_PATHS`, pinned by value in the threat-model tests. There is no `raw`
input either: DASH composes the RFC 5322 message from four typed fields, refuses
control characters in headers, and writes no `From` — Gmail fills that from the
account whose token DASH presented.

The harder half was honesty. Google has **no drafts-only scope**, so DASH cannot
ask for a permission incapable of sending, and the disclosure that used to ride
on "you granted a permission DASH offers no action for" would have vanished the
moment something was built on it. It is now `WriteOperation.wider_permission`,
required and nullable so a future write cannot ship without answering it, and it
renders before a sign-in as well as after. `consequence` is required for the same
reason: "Save a reply in your Gmail drafts" says nothing about what will be
sitting in the mailbox afterwards.

The `draft` artifact kind stopped meaning "local" and now has to say:
`draft.placement` is a **required** tagged union, so no producer can leave it to a
renderer to guess. It is the agent's claim, not DASH's record — `broker_audit` is
the record, and the copy points there. Replay protection gained a durable half
against `broker_audit`, because replaying a read costs a second read and
replaying a write costs a second draft in somebody's mailbox.

`pnpm verify` is green on Windows: `[state] valid`, typecheck, 61 test files,
1095 tests, and 67 installed-shell proof checks with no failures. **Proof 7n is
the load-bearing one**: the harness serves Gmail's two send endpoints and answers
them with success, so "DASH never called a send endpoint" is a statement about
DASH rather than about a provider's willingness to refuse. Over a run in which
the agent asked to send twice by two different names, the paths DASH reached were
`/token`, the two read paths and `/gmail/v1/users/me/drafts`.

Unchanged and still true: **the provider is not Google.** MAR-468 owns that, and
nothing here is proven against Gmail's API — including that a draft appears in a
real Drafts folder.

**MAR-468 was run on 2026-08-06, for the first time, and it failed.** The
sentence that stood here — that the harness was built and nobody had stood at the
consent screen — is corrected by that run. MAR-458 and MAR-469 stay `merged`:
the promotion rule says a run failing any check promotes nothing, and this one
failed `G2`–`G5`.

**It found a real defect in the product, which is what it exists for.**
`lib/oauth/flow.ts` sends no `client_secret`, in either
`exchangeAuthorizationCode` or `refreshAccessToken`. Google, asked directly with
exactly the parameters DASH sends:

```
HTTP 400
{ "error": "invalid_request", "error_description": "client_secret is missing." }
```

**DASH's Google OAuth has never worked against real Google and could not have.**
Google requires a client secret for Desktop app clients; PKCE does not replace it.
Proof 7 passes because the loopback provider's `/token` is a fixture that cannot
refuse for the one reason the real server does — precisely the substitution ADR
0002 amendment 1 named and this proof was filed to close. Filed as **MAR-508**,
Urgent, blocking any further attempt.

This falsifies **ADR 0002 amendment 3's point 2** in writing: that a green run
would establish the OAuth flow works against Google. It does not. The amendment
also guessed `G8b`, the projection over a real MIME tree, was "the single most
likely thing here to have been wrong". The run never reached `G8b`, and the
lesson is that the guess was one check-family too far down.

Two further defects, in the harness rather than the product, were found by the
attempt and fixed on a branch (**MAR-509**): the launcher never started Electron
at all — `spawnSync` of a `.cmd` returns `EINVAL` on current Node and
`result.error` was never checked, so two attempts printed a banner and did
nothing while looking like a proof that ran quietly — and the harness spawned a
runner that was never built into its own output directory, reported as
`never_listened`, which reads as a hung runner rather than a missing file.

**What the run does establish is narrow and worth keeping.** `G0b` passed twice,
so this was genuinely against `https://gmail.googleapis.com` with no loopback
substitution; `G7a` passed once fixed. Everything about the broker, the
projection, the write, the negatives, the audit and the revocation is untouched —
no brokered call was ever made, and nothing here is evidence for or against any
of it.

**The lesson, pointed one level up from this file's own words.** It said a
runbook is not a run. A harness that builds is not a harness that runs either:
everything about it reachable without a consent screen *had* been validated —
typecheck, esbuild bundle, `node --check` on the generated agent — and all three
defects lived strictly outside that set.

Writing that rule in advance is the point of **ADR 0002 amendment 3**. Deciding
afterwards, with a green log in hand, is how a proof comes to be read as
establishing whatever the reader hoped for.

The decision that shaped it was declining the cheap build. A standalone script
driving `lib/broker/` against Google would have been a fraction of the work and
would have left a union across two substrates, with seams wherever they failed to
overlap. Instead the harness boots the same shell through the same
`electron/smoke-identity.ts` and `electron/main.ts`, writes to the same user-data
directory, uses the same OS vault, adopts the same runner and spawns a real child
speaking the same broker protocol. **The only variable between it and proof 7 is
which server answers.**

So there is one seam rather than a class of them, and it is `7n`. Proof 7's
harness *serves* Gmail's two send endpoints and answers them with success — which
is what makes "DASH never called a send endpoint" a statement about DASH rather
than about a provider's willingness to refuse. Google cannot be made willing, so
the attended `G12b` reads `broker_audit` instead and is weaker in exactly that
way. The asymmetry runs both ways, which is why neither is redundant: `G11`
refuses both send attempts against a credential Google would genuinely have
honoured, and no loopback grant can model that, because that grant is a fixture
the harness wrote for itself. **Both proofs stay.**

The cheapest check is the one the record rests on. `G0b` asserts
`loopbackProofOrigin()` is null before anything is connected: without it every
check below would pass against the fake provider and the dated log would be a lie
about which server answered.

It cannot become a gate **by construction rather than by convention**, which is
ADR 0004's rule enforced: `scripts/prove-google.mjs` exits before it builds
anything if `CI` is set or no terminal is attached, and no `package.json` script
names it. `pnpm verify` does not run it and *does* typecheck it — `tsconfig.json`
includes `scripts/google-proof` — because a proof that rots silently between
attended runs would be worse than none, and typechecking a file is not executing
it.

The requirement the harness was verified against is that **`pnpm verify` still
passes without it**. Two full runs on Windows, both green: `[state] valid`,
typecheck, 62 test files, 1113 tests, and 67 installed-shell proof checks with no
failures plus the one advisory note. 67 is unchanged from `c6c3406` and that is
right — MAR-421 landed in between and added nine unit tests and no installed
proof, which is why 1104 became 1113 and 67 stayed 67.

Wave 2's remaining work, reordered by what the 2026-08-06 run found:
**MAR-508** (the missing `client_secret` — now the blocker, and nothing about
Google can be proven until it is decided and fixed), **MAR-509** (the harness
fixes, on a branch and wanting a PR), MAR-468's **run** again once MAR-508 lands,
MAR-470 (MCP connectors through the same card), MAR-471 (bring-your-own Google
client, which MAR-508's decision may fold into or pull forward).

## The broker's reach (MAR-476, epic MAR-475)

**A decision, and nothing was implemented.** ADR 0006 answers the question ADR
0002 amendment 1 left as a cost: what DASH does about agents that must run when
DASH is closed. `lib/`, `electron/`, `runner/`, `contracts/` and the workflows
are untouched by design.

**The broker's reach ends at the machine DASH is installed on.** A process
DASH's own runner did not spawn gets no brokered credential; DASH will not
operate a hosted token broker; and an agent that must run unattended on a VPS
or Railway **holds its own credentials**, rendered on the `agent_managed` path
that already exists with a receipt saying DASH cannot narrow it, cannot show
what it did, and cannot take it away.

The finding that shaped it is that **the rule is already enforced by the
transport rather than by policy.** Since MAR-430 the runner listens on a Unix
socket or a Windows named pipe and never on a port, so there is no address an
off-machine process could dial — `runner/server.ts` keeps `isLocalPeer` only
against a TCP listener that does not exist. What was missing is that nothing
writes it down, which is why `examples/gmail-meeting-assistant.manifest.v2.example.json`
declares `continues_when_dash_closed: true` beside two brokered connections,
validates, and tells the user only afterwards as an ADR 0005 case-1 lapse row.

A **hosted broker was rejected**, and the shortest of four reasons decides it:
it would turn invariant 1 back into a rule someone must follow, after amendment
1 spent a paragraph on why its being a *fact about where the code can run* is
what made the boundary worth having. The other three: what a user trusts
changes category from installed software to an operator; revocation stops being
locally checkable, which is proof `7n`'s lesson pointed at a receipt; and ADR
0002's own Google release path attaches an annual independent CASA assessment,
at a fee the assessor sets, the moment restricted-scope data crosses a server.
Its receipt already fails the honesty test **in the code** — `describeCustody`'s
`hosted_broker` sentence is missing the clause its `remote_mcp_server` sibling
has, and both ways of writing it are bad.

`hosted_broker` stays in `TokenCustodian` and is neither a plan nor a mistake:
it is the vocabulary for **somebody else's** hosted broker, which is what ADR
0002 stage 3 always described. DASH operating one is what is ruled out.

**`continues_when_dash_closed` is not sufficient, and no new field is needed.**
It asks a question about *time* where a grant needs one about *place*, and the
shipped Gmail example disproves it directly: a `local_process`, at a `local`
location, declaring it `true`. `locations.runtime.kind` already carries place,
is required, and orchestratekit-mcp already emits it. It must not be the gate
either — it is the author's claim about a fact DASH observes directly by having
spawned the process, with the same standing `draft.placement` has. So it drives
copy and never a grant.

**ADR 0002 gains amendment 4**, narrowing the four sentences written as
universals: the Decision's first line and invariants 1, 3 and 5. Invariant 6
keeps every word and stops reassuring about the mailbox — it was always a
statement about the operation set.

What stops being proven is in the ADR and is larger than the decision looks:
`broker_audit` stops being a complete answer to what has been done to an
account, and that is **not** a fourth `broker_lapses` case, because a lapse
needs DASH to observe its own absence and here DASH is uninvolved rather than
absent. Revocation stops being immediate for the connections most likely to
matter. Proof `7g` has **no analogue past the line** — on the unbrokered side
the token *is* in the agent's environment by design — so the honesty burden
sits entirely on copy. And nothing about remote deployment can ever have a
blocking gate under ADR 0004's rule, permanently rather than until somebody
automates it.

Evidence: `pnpm state:check` valid and `pnpm typecheck` clean. **The Windows
shell smoke was deliberately not run**, and that is a judgment rather than a
skipped step: this change is documentation only, it asserts nothing an
installed proof could confirm, and running it would be a machine-affecting act
in support of no claim.

Epic MAR-475's other children are filed and unstarted: MAR-477 (the MCP → DASH
round-trip proof — the contract seam was re-verified field-for-field against
both repositories this session and is **aligned**, so it is a proof and not an
emitter), MAR-478 (deploy to a host, blocked by the ADR) and MAR-479 (the
opt-in LAB telemetry ADR).

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

## Wave 1 - the design pass, executed (MAR-440, MAR-436, MAR-420)

**Both merged.** PRs [#41](https://github.com/orchestratemcp/orchestratedash/pull/41)
(MAR-440, MAR-436) and [#42](https://github.com/orchestratemcp/orchestratedash/pull/42)
(MAR-420, stacked on it) are on master at `7d77e98` and `095a6da`. This paragraph
said "merge-ready and not merged" until after they were, which is the smallest
possible instance of what the rest of this file is careful about.

The stack had **never been executed by an Electron shell** when it was written —
the design session could measure the DOM at three widths and could not launch
anything. `pnpm verify` is now green on Windows at `033aa01`, and #42 is that
commit merged into the density branch: `[state]
valid` with the 7 recorded drift warnings, typecheck clean, 65 test files, 1202
tests, and **70 installed-shell proofs with no failures** plus the one advisory
note, all three live sources answering.

67 of those proofs are the existing gate, unchanged. The three new ones are the
interesting part, and **the smoke found nothing — the screenshots did.**

**The skip link was never hidden.** MAR-440 moved it down by a 40px title bar
and left `translateY(-200%)`, which is twice the *element's* height and knows
nothing about `top`. The link measures 39px: 48 down, 78 up, and 9px of
accent-coloured link sat across the top of every page, at every width, in both
themes, from the moment the chrome landed. Nothing overflowed and nothing was
misplaced, so no DOM measurement could have seen it and none did. It took a
picture. Proof `1e` now measures it in a real window in both directions, because
a link that never shows would take away a keyboard user's only shortcut past six
navigation links, and that failure is as invisible as the one being fixed.

**The harness claimed to cover the splash and did not.** `firstWindow`'s comment
said keeping the splash meant the mandatory gate "covers the splash's whole
lifecycle, including that it closes"; no check anywhere asserted either half —
the same shape as `6j` asserting only that *a* verdict existed. `1c` and `1d` are
that sentence made true. `1d` also retires a standing hazard rather than only a
false claim: proof 7 finds the credential prompt by taking "the window that is
not the app window", which is correct only once the splash is gone, and now
something establishes that before proof 7 relies on it.

Two of the four risks this stack was audited for were **already sound and are
recorded here so they are not re-audited**. `electron/app-window.ts` is bundled
into `smoke.mjs` exactly once — main and the harness share one module instance,
because the harness imports main rather than launching it — so `appWindow()`
answers with the window `createWindow` set. And `startupFailed` is assigned on
one line inside the startup `catch`, so an ordinary quit still exits 0; the green
run is the evidence.

The screenshots both PRs said they lacked are `electron/capture.ts`: 13 images
across 1280/768/375 in both themes plus the splash, and a `layout.json` beside
them. It is a script for the reason the smoke is a script — a picture somebody
took once is not evidence the next person can refresh — and it fakes neither
half of what it photographs. The theme moves through `nativeTheme`, the same
signal the OS sends; the density moves by **clicking the real control**, so each
pair is a small proof as well as an image and a toggle that had stopped working
would produce visibly identical output. It is on no `package.json` script and
never on the `electron .` path, per ADR 0004: it produces evidence, not a
verdict, and must not be able to fail a release.

**What is not fixed, and is not MAR-491.** At 375px the density control is at
x=437..472 in a 374px viewport — `nav.app-nav` scrolls 484px of content through
374px, so MAR-420's one control is off-screen at rest. The `560px` query does
work: the label goes and the glyph stays, 35px wide, exactly as its comment
intends. The five navigation links overflow anyway, so the stated reason for
keeping the control at narrow widths — *"density matters most on a narrow
window"* — is defeated by the strip it sits in. MAR-491 measured the **tables**
and explicitly recorded that the chrome was fine; this is the chrome, it is a
different finding, and it wants the same breakpoint decision rather than a patch.
The page itself does not overflow at any of the three widths, which is the claim
MAR-491 made and which still holds.

**One defect reached master, and a comment was what hid it (MAR-492).**
MAR-420's pre-paint script sets `data-density` on `<html>`, and `density-toggle.tsx`
asserted that `suppressHydrationWarning` was therefore unnecessary — "this
touches `<html>`'s attribute, not any element React rendered". `app/layout.tsx`
renders `<html>`. So React hydrated it, found an attribute the build never
produced, and logged a mismatch on every load for anybody who had chosen
compact. `<html lang="en" suppressHydrationWarning>` is the fix and the comment
is rewritten; `tests/density.test.ts` now fails if the flag leaves that element
or spreads to any other.

The interesting part is which gate could have caught it and none did. It is a
**dev-mode console message** — production hydration does not warn, and React
patches no attribute either way, so compact kept working and nothing on screen
was wrong. The three new proofs photograph density by clicking the real control
in a fresh window, which never has a stored preference to disagree about, and
no test in this repository reads a console. The screenshots found the skip link;
running the app found this. Evidence: typecheck clean, 65 test files, 1204 tests
(the two new ones), `[state] valid` with the same 7 drift warnings, and a clean
console on `/` and `/runs/detail` in `next dev` with `dash.density=compact`
stored. `pnpm verify:shell` was **not** run locally — Electron was open, and
AGENTS.md's rule is worth more than a proof this change cannot affect — but
**CI's Windows `shell-smoke` ran it** on the branch tip `b26107b`: 70 proofs,
zero failures, plus the advisory `6l` with all three live sources answering.
Still 70, which is the right number: this change adds no proof, and one that
moved the count would mean it had done something to the installed loop.

MAR-492 was filed after the fix rather than before it, which is worth naming
rather than tidying away: the work arrived as a bug report against master, and
an issue written afterwards is a record, not intent.

MAR-420's fleet grid, sidebar and honesty pass are unbuilt and out of scope of
#42 by its own description.

One operational note, because it looked like a blocker and was not. A runner from
a previous build was holding the store; DASH retired it itself through the
authenticated shutdown route on the identity mismatch and span a fresh one, which
is `runner-process.ts` doing exactly what it was written to do. Nothing was
force-killed, and AGENTS.md's rule cost nothing.

## The protected workspace (MAR-434, runner half)

**Built and not proven, and the unproven half is named.** This is the feature
MAR-434's design slice deliberately did not build: the runner-owned task
workspace that gives `resolveAvailability` something to resolve against. Branch
`000henrik/mar-434-protected-workspace`, cut from `095a6da`.

The design slice's own account of the gap was exact — MAR-457 stores an artifact
*body*, so there was no file whose absence could be observed, and missing / moved
/ quarantined / deleted had vocabulary, a test and no producer. `runner/workspace.ts`
is the producer, and each of the five states is now driven in a test by making the
thing that causes it actually happen rather than by passing a resolver a value.

**A child is told one path and it is not the one that matters.** It gets its own
task directory: `inputs/` holding bytes a human selected, `outbox/` to write into.
Registered artifacts go to `{dataDir}/artifacts/{opaque}` — a directory the child
is never told about, under a name it cannot guess. So an artifact stops being
writable by the process that produced it *at the moment it is registered*, and
that is what makes a SHA-256 recorded then still true later: not a promise the
agent will not rewrite the file, but the absence of a path it could rewrite it
through. Registration copies rather than renames and then re-reads and re-hashes
from the registered location, so the digest on the receipt describes the bytes in
the file the receipt points at.

**The defect this session found was in its own first draft, and the test that
should have caught it was passing.** `resolveInsideWorkspace` compared
`realpath(root)` with `realpath(target)`, which holds perfectly when the *root
itself* has been replaced by a junction: both sides resolve through it, the file
genuinely is inside the directory the root now points at, and containment is
true. A child runs as the same user as the runner, so it can delete the outbox
and recreate it as a junction to the user's Documents folder — and on Windows a
junction needs no elevation, which is why the symlink half was never the
interesting case. The test covering it used `symlinkSync(…, "dir")`, which
Windows refuses to an unelevated process, so it caught the error and returned:
passing without executing anything, on the one platform the rule exists for. Both
are fixed. `assertUnlinkedBelow` walks from the data directory down and requires
every directory the runner created to still be a directory, and the test uses a
junction, which needs no privilege and therefore actually runs.

The walk starts at the data directory rather than the filesystem root on
purpose. Above that line the layout is the user's operating system — a
redirected `%LOCALAPPDATA%`, a roaming profile, macOS's `/tmp` — and refusing to
run there would be refusing to run on ordinary machines. Below it, anything that
is not a directory replaced one.

**The Windows path rules run on every platform**, so CI executes them. `NUL`,
`\\?\`, `COM1`, `offert.pdf:stream` and a trailing dot mean nothing to Linux, and
a check guarded by `process.platform === "win32"` would be enforced only on the
machine the shell smoke runs on and proven nowhere. That is ADR 0004's rule
pointed at a security boundary rather than at a release gate.

**What the child cannot say is stronger than what it is checked against.** The
`artifact_file` message carries three strings — task, role, name — and no agent,
no run id, no size, no digest and no path. Agent identity comes from the
supervisor's knowledge of which pipe the line arrived on; run identity comes from
the task record. There is nowhere in the message to forge either, which is a
different quality of statement from a check that they match.

**`resolveAvailability` has a producer now.** `resolveArtifactAvailability` in
`lib/store.ts` is what production passes. It answers `available` for an artifact
it has never heard of, deliberately: almost every artifact in DASH is a MAR-457
body with no file, so reporting those as `missing` because they are absent from a
table about files would turn every existing digest on every existing run page
red.

**Availability is fetched, not drained.** Telemetry, artifacts and broker
requests are events — each happens once, so an emptied buffer has been delivered.
Availability is a state: a file that was there five seconds ago may not be now,
and nothing emits an event when antivirus takes it. So `GET /workspace-artifacts`
returns the whole current picture on each poll, capped at 500 with `truncated`
reported rather than silently applied.

**`pnpm verify` is green end to end on Windows at `3a630ee`**: `[state] valid`
with the 7 recorded drift warnings, typecheck clean, 68 test files, 1275 tests
passed and 8 skipped, and **70 installed-shell proofs with no failures**. 73 of
those tests are new, across `tests/path-guard.test.ts`,
`tests/task-workspace.test.ts`, `tests/workspace-availability.test.ts` and
additions to `tests/runner-protocol.test.ts` and `tests/store-sqlite.test.ts`.

**70 is unchanged from master, and that is the honest reading of it.** This
branch adds 73 unit tests and *no installed proof*, so what the green smoke
establishes is that the workspace did not break the installed loop — not that
the workspace works installed. The same distinction PROJECT_STATE drew when
MAR-421 left the count at 67.

One thing the run did observe, without a proof asserting it: the packaged shell
created `workspaces/`, `artifacts/` and `quarantine/` under
`%APPDATA%\orchestratedash` with owner-only ACLs applied and verified, at
runner startup, on the real installed-style data directory. `openWorkspaceRoot`
shells out to `icacls` three times on Windows and none of it hung or prompted.
That is an observation about a directory listing, which is exactly the shape of
evidence Wave 0's "artifact output" claim was corrected for overstating — so it
is recorded as an observation and not as a proof.

**MAR-434's acceptance criterion is therefore still not met**, and the missing
piece is now small and specific: an installed proof covering select files →
trigger → output → download, asserting that downloaded bytes and SHA-256 match
the runner-registered artifact. That is the next session's work and it is the
thing that would move this issue to `proven`.

The smoke leaves its runner running on purpose — "closing DASH leaves agents
running" is the point of it. An earlier attempt at this run *looked* like a hang
and was not: the surviving runner holds the inherited stdout, so a caller that
buffers the pipeline never sees EOF. Nothing was force-killed; the orphan was
retired through the authenticated `/shutdown` route AGENTS.md prescribes, which
worked first time.

**What is not built, plainly.** Nothing renders any of this: file-backed
artifacts have no artifact *kind*, because adding one to `RunArtifact` is a
compile error in `app/_components/digest.tsx`'s exhaustive switch, and `app/` was
out of this session's ownership. So the runner holds files, hashes them, indexes
them and answers about them, and no page shows them yet. The Gmail draft handoff
is untouched and was an explicit non-goal. Producer component stays unbuilt for
the reason the design slice gave: the runner knows which agent and which task,
not which step, and inferring it from event ordering would be a guess rendered as
a fact.
## What a run produced, as a thing you own (MAR-434, design slice)

**Open on PR #43, stacked behind #42 and #41, and half the issue is
deliberately unbuilt.** MAR-457 built the artifact seam and proved it; this
dresses it and invents no contract.

The defect underneath was small and quiet: the run detail page rendered
`view.artifacts[0]` and nothing else, while the store kept every artifact a run
sent. An agent that writes a digest *and* a reply had half its work invisible,
with nothing on screen to say so.

**Missing, moved, quarantined and deleted are four states because they lead
somewhere different** — the argument `lib/copy/recovery.ts` already makes about
credentials, applied to outputs. Moved is the one that decides it: re-running
leaves the person with two outputs and the one they were hunting for is still
wherever it went, so "run it again" is not a weaker recovery there but a wrong
one. A quarantine sends them to the software holding it, because re-running
produces another file taken the same way. A deletion is somebody's decision,
usually theirs, so its next action is conditional and never reads as a fault.
The test asserts the four *next actions* are four distinct strings, which is
the assertion a collapse into "unavailable" would fail.

**A receipt distinguishes the agent's claim from DASH's record.**
`generated_at` is what the agent says; `received_at` is when DASH stored it.
One "Created" row would quietly promote the first into the second — the same
care `draft.placement` is worded with. Size is measured from the stored body
because **there is no file**, and the receipt says so rather than implying a
path. `ArtifactReceipt` carries no run id at all: the panel only ever renders
on that run's page, and a field that exists is one a later renderer will print.
A test holds it to that, and caught the field the first draft left in.

`describeArtifactRole` takes a `string` rather than the `kind` union, because
the JSON schema and the renderer's union are two authorities that can disagree
across a version. An unknown kind now degrades to metadata plus a reveal;
`RunOutput`'s `default` branch used to throw on a page a user was reading.

`view.artifacts` is **kept** beside the new `artifact_cards`, because
`electron/smoke.ts` reads it as proof 6k. A blocking release gate is not
something to break for a tidier shape.

Evidence: `pnpm typecheck` clean, `pnpm state:check` valid, `pnpm test` 67 files
/ 1245 passed / 8 skipped / 0 failed including 43 new cases. **`pnpm
verify:shell` was not run** — two Electron processes were live, AGENTS.md
forbids force-killing them and DASH is single-instance by design, which is the
call MAR-441 and MAR-421 made in the same situation. **No screenshot either**:
the session was unattended and the Browser pane composites no frames when it is
not displayed, so a render test took its place — repeatable, and in CI.

**What is not built is the half that would populate the four states.** MAR-457
stores the artifact *body* in DASH's own records rather than a reference to a
file, so there is no file whose absence could be observed. The thing that would
observe it is the runner-owned protected workspace — a separate feature with
its own installed-MSIX proof, which this slice does not touch. So
`resolveAvailability` is a parameter with an honest default: production passes
nothing and every output is `available`, which is true, while tests drive all
five states. That is the pattern `describeConnectionCondition`'s revoked
sentence shipped under, written before anything could produce the condition.
The receipt's **producer component** is unbuilt for a different reason: nothing
links an artifact to the step that made it, and inferring it from event
ordering would be a guess rendered as a fact.

## The import-time refusal ADR 0006 mandates (MAR-482)

ADR 0006's second rule: "A manifest that asks for both is a contradiction DASH
must refuse at import, not discover at runtime." Both meaning a runtime
declared away from this computer (`agent_dom.locations.runtime.kind: "remote"`)
beside a connection DASH would have to manage (`ownership: "dash_managed"`).
Until this slice the combination was schema-legal, DASH shipped an example that
did it, and a user found out afterwards as a lapse row.

`lib/manifest-constraints.ts` is the check — constraints the schema cannot
express, run at the two doors a manifest enters through: `importManifest` in
`lib/store.ts` and the handoff flow's `readManifestFor`. Deliberately **not**
in `validateManifest`, which `runner/supervisor.ts` and `lib/db.ts` also run
over manifests imported long ago — a constraint that tightened retroactively
would strand an already-imported agent in an unreadable row. And deliberately
**copy, not gating**: the transport already decides who reaches the broker;
this refusal only stops DASH accepting a promise it will never keep.

The plain-language half lives in `lib/import-feedback.ts` as the
`remote_agent_dash_connections` case. One structural lesson worth keeping: the
distinctive phrase the recogniser keys on lives in `import-feedback.ts` and is
imported by `manifest-constraints.ts`, not the other way around, because
`import-feedback.ts` is bundled into the add-agent page's client component and
the constraint module drags `lib/contracts.ts` and its `node:fs` schema reads
in — the first draft pointed the import the obvious way and Turbopack refused
the client chunk.

The same slice adds ADR 0006's option-3 sentence to the permission card,
**before** the grant: `BrokerRowView.dash_closed_sentence`, built by
`describeDashClosedWindow` and gated on the manifest's own
`continues_when_dash_closed` claim — for an agent that stops with DASH the
warning would describe a window in which the agent does not exist, so its
honest form is absence. The shipped Gmail example is exactly the shape this
sentence exists for and is untouched, per the issue: it is legal, and it
needed the sentence, not a change.

`examples/dash-managed.manifest.v2.example.json` became a **local** worker in
the same change: under the refusal, a contradictory file in `examples/` would
be an example DASH itself refuses to import. Its purpose — the DASH-managed
OAuth reconnect flow — never depended on being remote.

## The two follow-ups the merge order created, and the acceptance criterion (MAR-434)

`docs/merge-order-2026-08-06.md` named two follow-ups PRs #43 and #46 could not
close themselves, because #43 shipped before #46 existed and #46 could not
touch `app/`. Both are closed here. `lib/views/build.ts`'s `runView` now passes
`resolveArtifactAvailability(agent, runId)` into `buildArtifactCards`, adapted
to the per-record signature it takes; `tests/views.test.ts` drives a real
`moved` row through `syncWorkspaceArtifacts` and `runView` rather than a stub
resolver, so the assertion is that production asks the producer, not that the
view model can represent the answer. `.orchestrate/state.json`'s MAR-434 entry
carries the same pre-merge-sentence correction MAR-473, MAR-467, MAR-441,
MAR-474 and MAR-469 each made for the predecessor before them.

**Building MAR-434's own acceptance criterion — select files, trigger, output,
download — found the half of the feature that was still missing.** Nothing
served an output's bytes anywhere: `runner/server.ts` had `GET
/artifacts/{id}/verify` (re-hashes in place, returns a boolean) and `POST
.../delete`, and no route that returned the bytes themselves. A download
action had nothing to call. `runner/workspace.ts` gains
`openArtifactForDownload`, which opens a stream and never returns
`stored_path` — the same discipline `toView` already keeps for every other
route on this surface. `runner/task-api.ts`'s `download` wraps it with the
same audit-on-every-path discipline `verify` and `remove` already carry.
`runner/server.ts` routes `GET /artifacts/{id}/download` to it, streamed, over
the same bearer-token channel as everything else here.
`tests/task-workspace.test.ts` drives it against a real registered artifact:
exact bytes back, an unknown id refused, a deleted one refused without
pretending the bytes are still there.

`electron/smoke.ts` gains **proof 9** (9a–9g), matching proof 8's own answer to
"this runner feature has no UI yet": drive the real routes on the real,
installed, adopted runner, and read DASH's own store back to confirm the
*installed shell's own poll loop* — not a reimplementation of it — did the
rest. A real agent the runner spawns is handed one user's own file, dispatched,
and turns it into an output; **9f** reads that output back through the new
download route and hashes it independently of the registration record, which
is the acceptance criterion itself; **9g** waits for
`electron/agent-adapters.ts`'s own five-second poll — not the harness — to
carry the result into DASH's own `workspace_artifacts` table as `available`,
closing the loop the `resolveArtifactAvailability` wiring above opened.

**Proof 9 has not been run, and the reason is outside this change.** This
machine had a live DASH session open for the whole of this session: a real
`dash://handoff` window from an unrelated `orchestratekit-mcp` export
(MAR-477's agent-project), with its own uncommitted work
(`docs/adr/0007-the-deploy-transport.md`) sitting in this same working tree.
AGENTS.md forbids force-killing Electron, DASH is single-instance by design
(MAR-450), and closing another session's live window is not this session's
call to make — the same reasoning MAR-441, MAR-421 and this issue's own #43
session each recorded when they found Electron already running. `pnpm
state:check` and `pnpm typecheck` are clean; `pnpm vitest run`, scoped past two
stale-but-registered git worktrees this machine still carries under
`.claude/worktrees/` (both from already-merged branches, both clean — vitest's
default glob otherwise triples the file and test count by including them), is
71 files / 1330 passed / 8 skipped / 0 failed.

The paragraph this replaces said MAR-434 stays merged because proof 9 was
written but unexecuted. **It has since executed, and MAR-434 is proven**:
proof 9 (9a–9g) ran green on CI's installed shell (PR #48, run 31100798451),
after two commits fixed what the run surfaced — the owner-only ACL proof was
reading its own owner as a stranger on CI's RID-500 account, because `icacls
/save` abbreviates that account's SID to `LA`, and the repair pass removed the
"foreign" grant then proved owner-only on the lockout it had created.
`inspectAcl` now requires the owner's own full-control ACE and admits `LA`/`LG`
as owner spellings only for that exact account. The full story is in
`.orchestrate/state.json`'s MAR-434 entry and PR #48's root-cause comment.

## Inputs, the half of the workspace UI that was still a sentence (MAR-507)

**Select a file, against the roles the manifest declares, wired to the
admission API proof 9 already drives.** Built against master rather than on PR
#52, which is open behind the Actions outage; the overlap is recorded in
`.orchestrate/state.json` rather than avoided.

**The renderer names a kind of file and never a file.** `workspace.selectInput`
carries an agent, a task and a role, and no path in either direction. Main
opens `dialog.showOpenDialog`, reads the declared limits out of the manifest
itself, and hands the runner a path the page never saw. That is
`connection.connect`'s shape, and here the sharper version of it: a credential
the renderer could name is one page script already held, while a path the
renderer could name is one nobody chose. A payload carrying `source_path`,
`path`, `file` or `directory` is refused outright rather than having the field
dropped — exactly as a credential field on a connect is.

Nothing can widen what the agent declared either. `role_id` is checked against
the manifest in main and an undeclared role is refused **before a picker
opens**, so a person is not asked for a document that could not have been used.
The limits travel from the manifest, not the payload: a renderer-supplied limit
block could only be obeyed — letting a page widen the author's declaration — or
ignored, and an ignored field on the wire is one a later reader believes.

**Cards, never a table** (MAR-491), and **selected / copied / rejected are per
file rather than per role**. A rejection carries the runner's own sentence
verbatim: the runner is what decided and its limits are what move, so a second
vocabulary in DASH is the thing that stays wrong when they change. The copied
state says the fact nobody would guess and the whole workspace design rests on
— DASH took its own copy, so changing the original now changes nothing.

There is no "remove" control, because the runner has no route that takes an
admitted input back out. One that faked it by hiding the card would be worse:
the file would still reach the agent.

**Run now dispatches the task, and a refusal stops the run.** That branch is the
interesting half. An agent started before its task is bound reads an empty
workspace; one started after a failed dispatch produces an output derived from
nothing the person gave it. Both look exactly like a successful run from
outside, which is why neither may happen quietly.

**Three things this does not do.** No shipped example manifest declares
`task_inputs`, so the panel is invisible in the product until one does — a test
asserts that of all five rather than leaving it to be discovered, and it is the
same shape as `describeConnectionCondition`'s revoked sentence: vocabulary and
surface built before a producer. The task id lives in page state, because DASH
holds no such row and the runner has no route to list an agent's open tasks —
leaving the page loses the selection, and reopening a *second* task would orphan
the first one's files rather than reuse them. And the installed-shell proof the
issue asks for is not written: proof 9 covers the runner's half, and adding one
needs `electron/smoke.ts`, which PR #51 owns.

Evidence: typecheck clean, `[state] valid` with the 8 recorded drift warnings,
74 test files / 1392 passed / 8 skipped / 0 failed from PowerShell, and
`pnpm build:renderer` green — which is the check `tests/client-bundle.test.ts`
exists because of, since a pure `lib/` module reaching a `"use client"` tree is
exactly where `node:fs` got into the browser bundle once before.

## The avatar foundation, and nothing wearing it yet (MAR-500)

**Built, green, and on no surface — the last part by the issue's own
non-goals.** BRAND-03/04/05 are the surfaces; this is the component, the
assignment rule and the enforcement all three will sit on.

**The assets are vendored, and the manifest is what keeps the copy honest.**
The eleven audited 50×50 PNGs and `o-cast.json` are copied out of
orchestrateweb rather than referenced, because DASH must render with no network
and no sibling checkout. A copy drifts; the per-file SHA-256 is what says so.
DASH's brand check deliberately has **no `--write`** — a check that can
regenerate its own audit record is a copy agreeing with itself about having
changed. A deliberate asset change is made and audited in orchestrateweb and
re-vendored here.

**Assignment is persisted because MAR-435 asked for an identifier independent
of the agent's name, and a function of the name is not.** `oFor(agent.name)` —
byte-identical to SITE's, so both products draw the same agent the same way on
day one — is the *default* assignment and runs exactly twice: on insert, and in
migration 8's backfill for agents imported before the column existed. The
re-import path's `ON CONFLICT DO UPDATE` omits `avatar` on purpose, so an
author changing `display_name` does not re-costume an agent the user has
already learned to recognise.

The load-bearing test is **not** that the stored value equals `oFor(name)`. It
does, at creation, so that assertion would pass just as happily against a store
that recomputed on every read. `tests/o-cast.test.ts` writes a character the
seed would never have chosen and asserts *that* comes back. Its SITE-parity
pins were produced by executing orchestrateweb's own `oFor` body, not by
running DASH's and writing down the answer.

`MIGRATIONS` gains a function form for the first time, for one reason: this
migration's data step is not expressible in SQL, and a string hash rewritten in
SQLite expressions would be a second copy of the one function whose whole job
is to agree with another repository.

**Each violation class is demonstrated failing, in CI rather than in a
transcript.** The issue asks for mutate-fail-restore with the transcript in the
PR. That is something somebody did once on a machine nobody else has, so the
rules live in `scripts/brand-rules.mjs` as pure functions over strings and
`tests/brand-check.test.ts` drives each class with a fixture that must fail and
a neighbour that must not — a rule loosened into always-passing fails there
rather than passing silently forever. The last case runs the real script over
the working tree.

Six classes: a hash disagreeing with the manifest; a size that is not a whole
multiple of 50; a character chosen by a condition or a status word, and an
announced costume outside an empty allowlist; `--ok` reaching an avatar or
anything enclosing it; `image-rendering: pixelated` going missing; and a
literal duration where a `--motion-*` token belongs, because `app/tokens.css`
zeroes those under `prefers-reduced-motion` and that is what makes stillness
free of per-surface code.

**One rule SITE has that DASH deliberately does not**: a surface allowlist.
SITE's cast may appear on four files and nowhere else. DASH's surfaces are the
point, and a list every BRAND issue has to widen is a gate edited into
meaninglessness in three commits.

**What is not proven, plainly.** The proven bar is a witnessed render at 50px
and 100px in the installed shell, both themes, `prefers-reduced-motion`
honoured — and that needs a surface. So this stays `merged`, and the promotion
belongs to the first BRAND-03/04/05 slice. What was checked instead:
`renderToStaticMarkup` over the attributes a screenshot is worst at (a picture
of a decorative avatar looks exactly like a picture of an announced one), and a
real `pnpm build:renderer` confirming all eleven files reach `out/o/1x/`
byte-identical — ninja at `910b5184…`, the audited hash.

Evidence: typecheck clean, `brand:check` green, `[state] valid` with the 8
recorded drift warnings, and 75 test files / 1404 passed / 8 skipped / 0 failed
from PowerShell. PowerShell deliberately: under Git Bash `whoami /user` fails
and 43 unrelated channel-secret and task-workspace cases go red on code this
branch does not touch.

## "The runner answered 500." (MAR-506)

**A malformed `runner.sqlite` was being reported to the user as a status code.**
Found by a `pnpm verify:shell` run on 2026-08-06: eight smoke checks failed on
it and nothing else, `runner.log` ended with `database disk image is malformed`,
and what a person saw was a sentence naming the transport. Everything they
needed was elsewhere — DASH reached the runner, the runner is running, nothing
of theirs is lost, and no agent will start until it is fixed.

**Detected twice, because once is not enough.** The issue asks whether the
runner should detect `SQLITE_CORRUPT` at open *rather than* 500-ing per request.
The honest answer is both, and the reported machine is the argument: **the store
opened.** `journal_mode`, `synchronous`, `foreign_keys` and the migration check
all succeeded, because a header page and a `user_version` live on pages that
were intact; only the queries against damaged leaves threw. So `openRunnerStore`
runs `PRAGMA quick_check`, which walks pages rather than the header, and the
same classification runs again on whatever any route throws.

The test that carries this builds that exact file — a real database with 400
real rows, header and schema page untouched, every later page overwritten — and
asserts the naive checks **still pass** on it before asserting that the probe
does not. Remove the probe and that is the only test in the file that fails.

**A runner whose records are unreadable supervises nothing**, and that is a
decision rather than a consequence. The supervisor does not need the database to
spawn a child; it needs it for replay protection, idempotency and the approval
record — every guarantee DASH renders about a command happening once and having
been approved. An agent running without them is an agent whose guarantees DASH
is still printing and no longer keeping, which is worse than one that is not
running, because the second is visible.

It still listens: `/health` reports `store_damaged`, `/shutdown` stops it,
`/store/retire` repairs it, and everything else answers one shape — 503 with
`reason: "store_damaged"`. A runner that exited here would have left DASH with
"the runner did not start", which names nothing and offers no repair.

**The repair renames and never deletes.** The runner's database is the one place
a user's free-text approval reason comes to rest, and a damaged database is
frequently still readable by a recovery tool — so deleting it would destroy the
only copy of a record DASH deliberately keeps nowhere else, in order to fix a
fault the user did not cause. `/store/retire` sits above the damage guard and
**below** the authentication check: a runner that could be made to abandon its
replay records by anyone who reached its socket would have a way to make an
executed command executable again.

**Three kinds, not one**, for the reason `describeSecureStoreFailure` keeps
five. Real damage; a file that was never a database, which is usually something
else having been put there and where blaming the disk sends somebody after a
fault that is not present; and one DASH could not open, which is a permission or
a lock, is not damage, and is never offered a repair that throws the file away.

**`can_retire` is false at the transport today, and that is the honest value.**
The runner can set a damaged store aside and the route is proven against a
genuinely corrupt file. Nothing in DASH asks it to yet: that wants a shell
command, a preload method, a main-process dispatch and a control on a surface,
four of which live in files PR #52 owns. `describeStoreDamage` makes the same
call for its unnamed case and says why — a next action the user cannot take is
worse than one admitting DASH cannot fix this, because the first sends them
looking.

One consequence worth naming: `/health`'s `ok` now means "and my store is
readable", so smoke proof `4b` goes red on a damaged store where eight scattered
checks used to. That is the better failure — one early, with `store_damaged` in
the body it prints — and `4b`'s label now understates what it checks.

Evidence: typecheck clean, `[state] valid` with the 8 recorded drift warnings,
73 test files / 1378 passed / 8 skipped / 0 failed from PowerShell, 27 of them
new. `pnpm verify:shell` was **not run**: this machine's runner store is the
damaged one the issue is about, so a shell smoke here would have been testing
the fault rather than the fix.

## The repair gets a button (MAR-518)

**Open on a PR, not merged.** MAR-506's own child, and the half its PR
deliberately left unbuilt: `POST /store/retire` existed and worked, and
`can_retire` was hardcoded `false` because nothing in DASH asked for it yet.
Branch `000henrik/mar-518-retire-store-surface`, cut from master independently
of the MAR-508 branch above — stacked PRs get no CI here, so both are cut from
the same tip rather than from each other.

All five files the issue named: `lib/shell/ipc.ts` gains `runner.retireStore`,
naming no agent — a damaged store is a fact about the runner, not about any one
of the agents it supervises. `electron/main.ts`'s `runnerLifecycle` gains a
`retireStore` branch reaching `POST /store/retire` directly, never an agent's
`/lifecycle` route. `electron/preload.ts`, `app/_data/source.ts` and
`app/page.tsx` carry it the rest of the way.

**One thing the issue's file list didn't spell out turned out to be load-
bearing.** `runner.status`, `runner.start`, `runner.stop` and `runner.remove`
were wired end to end in the dispatcher and never once exposed through
`dashShell` — no page has ever been able to ask the runner how it is. Without
that, there was no way for `app/page.tsx` to learn a store was damaged in the
first place, so `runnerStatus` was added beside `retireRunnerStore` in the
preload bridge, following the same optional-method shape `downloadOutput` set.

**The status branch was also wrong, not just unreached.** It called
`response.json()` unconditionally, and `fetch` does not throw on a non-2xx
status — only on a transport failure. So a damaged store's typed 503 parsed as
`{agents: undefined}`, `(body.agents ?? []).length` was `0`, and `runner.status`
reported `{ok: true, supervising: 0}`: a healthy, idle runner, which is the
opposite of true. Fixed by checking `response.ok` first and classifying the
body with `lib/agent-dom/transport.ts`'s own `readStoreDamage`, exported for
this rather than reimplemented — one classifier, so the per-agent path and the
home page cannot drift on what counts as damaged.

**The surface, per the issue's own UX argument.** `app/page.tsx` is not about
any single agent, and a damaged runner store is "nothing can run, and this
needs your decision" — a fact about the whole runner. `useRunnerStoreDamage`
checks once on mount, gated on `useCanAct`, matching `useHost`'s own pattern
rather than adding a poller nothing else on this page has. The parsing —
`data` is `Record<string, string | number | boolean>` on the wire and has to
be narrowed by hand — is a pure `runnerStoreDamageFromStatus` function so it is
testable without React, a bridge, or a runner, and it refuses to invent a kind
the runner did not actually report. `RunnerStoreDamageNotice` renders
`describeRunnerStoreDamage(kind, { can_retire: true })` as the three-part
recovery **plus a real button** — the button the per-agent path can never have,
because it has nowhere to put one.

**The last line, done last.** `lib/agent-dom/transport.ts`'s `can_retire`
flips from `false` to `true`, exactly as MAR-506's own comment said it would.
That path's copy now reads as text what the home page's button lets somebody
actually do.

**The `4b` relabel, folded in.** `electron/smoke.ts`'s proof `4b` —
"the runner is listening on its `{transport}` endpoint" — checks `/health`'s
`ok` field, which has meant "and my store is readable" since MAR-506. The old
name read as a connectivity check failing for a store fault; it now reads
"the runner is listening and its store answers". The assertion is unchanged.

**Not done, per the issue's own "Do not."** No automatic retirement anywhere —
the click is the consent, and nothing here sets a store aside without a person
pressing the button that says so.

Evidence: `pnpm typecheck` clean, full vitest from PowerShell, 86 test files /
1616 passed / 8 skipped / 0 failed, 9 of them new across `tests/shell.test.ts`
(the `retireStore` dispatch, naming no agent), `tests/agent-dom-transport.test.ts`
(`can_retire: true`) and the new `tests/runner-store-notice-render.test.tsx`
(the parser's five cases and the rendered notice, including that a button
exists and that no branch ever says "delete"). `pnpm verify:shell` was **not**
run this session: an orphaned `dist/google-proof/runner.mjs` process from an
unrelated, interrupted `prove-google.mjs` attempt was found still alive on this
machine, and starting the shell smoke alongside a live, unrelated runner risked
the interference AGENTS.md's process-safety rule exists to avoid.

**Not proven installed.** The button has not been clicked in a real Electron
shell against a genuinely damaged `runner.sqlite`. That is what would move this
to `proven`, and it is also what the relabelled `4b` would now catch failing if
the retire path regressed.

## The plane that must not be generalised, made structural (MAR-484)

**Open on a PR, not merged.** ADR 0007's load-bearing paragraph was a finding
about a file that did not exist. It exists now:
`lib/agent-dom/runner-channel.ts`.

The failure it guards against is not an argument somebody wins. It is the
obvious, correct-looking refactor — generalise the drains to take a channel so a
remote runner's telemetry can be pulled the same way — with `/broker/drain`
coming along **because it was in the same loop**, in a commit whose message says
"pull remote run evidence".

**What makes it impossible comes before any type says so.** A broker-capable
channel is built on `ipcFetch`, and `ipcFetch` dials a `socketPath`: no host, no
name to resolve, no route to a network, and a URL on the reserved `.invalid` TLD
so a leak into a real `fetch` fails closed. The types are that fact made
checkable in an editor. `RunnerChannel<Route>` takes a **route** rather than a
URL, because `${origin}/broker/drain` is a string types cannot see into; and
`call` is a **property with a function type, never a method**, because
TypeScript checks method parameters bivariantly even under `strictFunctionTypes`
and the method spelling would have made the whole module decoration.

**Two guards, watched failing, and they are not the same guard.** Widening the
remote channel's route set turns the call-site `@ts-expect-error` into TS2578.
Removing the capability brand alone turns **nothing** red — parameter
contravariance already excludes the assignment. Removing both turns both
assertions red. So the phantom `unique symbol` brand earns its one cast by
surviving somebody deciding the two route sets should be the same. A third guard
scans `lib/` and `electron/` for the route strings *in code*, with comments
stripped, which catches a hand-rolled `fetch` that bypassed the channel.

`electron/broker-host.ts` is the one production change, and it is what makes the
property load-bearing rather than decorative. **`electron/agent-adapters.ts` is
untouched, deliberately**: generalising its drains is MAR-488's work, and it is
now safe to do — which was the entire point.

**The dialer is `ipcFetch`'s move a second time, and it is not an HTTP parser.**
`node:http`'s client takes a `createConnection` that may return any duplex
stream, so the request line, header encoding, chunked transfer and every edge
case around them are Node's — byte for byte the code that serves the local
runner. What `lib/agent-dom/ssh-fetch.ts` contributes is a duplex over a child's
two pipes and the no-op socket methods the HTTP client calls. `setTimeout` is a
no-op *on purpose*: the deadline that governs this transport is
`transport.ts`'s `AbortSignal`, and a second timer would give a remote channel a
different timeout story from a local one.

**The deploy plane's version of "never what to run."** `ssh` takes its options
as argv, and argv has no quoting layer to get wrong — an address of
`-oProxyCommand=…` is not an address, it is a flag. `lib/hosts.ts` refuses any
component reaching argv that begins with `-`, as its own named problem rather
than folded into "malformed". `sshArgv`'s absences matter as much as its
presences: no `-L`, `-R` or `-D`, because option 2 was rejected for MAR-430's
reason and the way that stays true is that the flag is never passed.

**Custody, stated as an absence.** `electron/ssh-host.ts` has **no function that
returns a private key**. It can create one with the machine's own `ssh-keygen`,
protect it with `runner/channel-secret.ts`'s own `hardenOwnerOnly`, prove it
again immediately before every use, and name the path `ssh` should read. DASH
cannot leak what it never reads, and a test asserts that over the module's
exports rather than trusting a header — which is where somebody would add a
reader, because the deploy plane will one day want to "just check" the key. Only
the public half is returned, because that is the one thing that should travel.

Evidence: `pnpm typecheck` clean; 75 test files / 1400 passed / 8 skipped / 0
failed, 53 of them new. The compile-time exclusion was watched failing in all
three directions above.

**The one production change is covered by the installed shell.**
`pnpm verify:shell` on this branch is 64 passed / 8 failed, and **proof 8
(8a–8f) is among the passes** — the real Electron shell driving the refactored
broker loop end to end: 200 requests sent by the agent, 64 adjudicated, 136
dropped, drained through `/broker/drain` and answered through
`/broker/responses` over the typed channel. The 8 failures are the same
store-damage set that fails on master's own tree in the same session.

**Nothing here has reached a host.** No `ssh` runs in any test, no host record is
persisted, and no surface connects one — that is MAR-498. What is proven is the
dialer, the record's refusals, the command's shape and the key's custody. ADR
0004 keeps the rest attended and dated, permanently.

## What a run produced, as a thing you can keep (MAR-434, the Outputs half)

**Open on PR [#52](https://github.com/orchestratemcp/orchestratedash/pull/52),
not merged, and half of the workspace UI is deliberately unbuilt.**

The agent workspace rendered `latest_digest` and nothing else — one artifact, on
a page whose agent may well have written two. That is the same defect MAR-434
corrected on the run detail page and did not correct here. `WorkspaceView` now
carries `outputs`, built by the same `buildArtifactCards` and resolved by the
same `resolveArtifactAvailability` production already passes on the run detail
page; a second resolver is how two surfaces come to disagree about whether a
person's file is still there. It is one run's outputs and not an archive, and
each card links to the run.

**`workspace.download` is a fifth command family and its payload is the
design.** Two opaque ids, no path in either direction: main asks the *user*
where to put the bytes through the operating system's own save dialog, so the
renderer neither supplies a location nor learns one. That is
`runner/workspace.ts`'s discipline about `stored_path` kept at the surface that
finally calls the route proof `9f` proves. `tests/shell.test.ts` refuses a
payload carrying `path`, `destination`, `source_path`, `stored_path` or
`directory`.

The button is governed by the four unavailable states rather than governing
itself: a moved output's next action is not "download", because the file is
still wherever it went. Where the window cannot act it is **absent** rather than
disabled — a greyed-out control beside a file that exists reads as a claim about
the file. "Save a copy", not "Download": the file is already on this computer.

Evidence: `pnpm typecheck` clean, 74 test files / 1390 passed / 8 skipped / 0
failed. Rendered in the real app on the developer path — the workspace for
`ai-agent-news` draws both outputs with their roles, receipts, the no-send
safeguard and the digest body, and draws no Save button, which is a browser tab
correctly reporting that it cannot act. **No screenshot**: the session was
unattended and the Browser pane composites no frames when it is not displayed,
so the render tests take its place, which is the call the MAR-434 design slice
made in the same situation.

**What is not built is Inputs, and it is MAR-507.** Selecting local files
against the manifest's declared roles needs three more members of the family
this change opens; the runner has served all three routes since PR #46 and proof
9 drives them. MAR-434 stays open on that half.

## What actually runs on the VPS (MAR-497)

**Open on a PR, not merged.** ADR 0007 chose this repository's runner as the
remote process and left one follow-up unowned: the runner is bundled into the
Electron app and started by the Electron binary with `ELECTRON_RUN_AS_NODE=1`,
and a host has no Electron binary to start it with. **ADR 0007 amendment 1
answers it — the host supplies Node; DASH does not ship a runtime** — and
`pnpm build:runner-standalone` is the artifact. `dist/runner-standalone/` holds
`start.mjs`, `runner.mjs`, `contracts/`, a `package.json` and a README, and is
started with one command. `runner/main.ts`, `runner/server.ts` and
`runner/endpoint.ts` are untouched.

**The preflight is its own module and its own bundle, and that is the
structural half.** `runner/store.ts` imports `node:sqlite` at the top level, so
a check living in that module graph would run *after* the import it exists to
check — on the host it is written for, it would never execute.
`runner/host-runtime.ts` checks the major version against a floor and then
actually **resolves** the module, because a version comparison alone would be
this repository carrying a changelog fact it cannot verify on the machine it is
refusing. An unsuitable host exits **78** (`EX_CONFIG`) with a sentence naming
what it found; a runner that started and then failed still exits 1, and a deploy
verb can branch on the difference without parsing English out of a log.

The floor is Node 24 as a *support* claim rather than the earliest version that
might work. `node:sqlite` appeared in 22.5 and spent its first releases behind
`--experimental-sqlite`, and a floor admitting a release where the module needs
a flag would make the documented start command wrong on a host that satisfies
the floor.

**`contracts/` is in the artifact because the search would otherwise find the
repository.** `lib/contracts.ts` walks up from its own module location, so an
artifact carrying no schemas at all works perfectly under this repository and
fails on a host at the first manifest — not at build time and not at start time.
`tests/runner-standalone.test.ts` copies the artifact to a temporary directory
with nothing above it, strips `DASH_CONTRACTS_DIR` and `ELECTRON_RUN_AS_NODE`
from the child's environment, and asserts that the runner's own `contracts:`
line names the artifact's own directory. That is the only arrangement in which
the difference is visible.

**The data directory is created and hardened here rather than inherited.** On
Windows it sits under a user profile whose ACL already excludes other
principals; a VPS home directory does not, and this one holds the channel
credential, the database and any file a person handed to an agent. The entry
point applies `runner/channel-secret.ts`'s own `hardenOwnerOnly` and refuses to
start if the permissions cannot be **proven**.

**`dash:node` already means the right thing on a host**, which the sentinel's
name does not suggest and which the issue listed as an open question.
`resolveSpawnCommand` returns the *spawning* process's own `execPath` plus
`ELECTRON_RUN_AS_NODE=1`; on a host the spawning process is the standalone
runner under the host's own Node, so it resolves to that and the variable is a
flag plain Node has no opinion about. No host-specific branch, and the reason
the sentinel exists carries over intact — a registration must not name a real
interpreter path, on a version-stamped MSIX root or on a host. It matters
immediately rather than eventually: **the sample agent is registered with
exactly this sentinel** and is the first thing anybody would deploy. Proven by
starting a real child under the standalone runner rather than by reading the
resolver.

**One correction it forced, and it was load-bearing.** `runner_build` is what
`electron/runner-process.ts` compares before adopting a runner, and the
algorithm hashed `path.relative` output and raw file bytes — both
platform-dependent, which nothing had noticed because only one machine ever
computed it. A Linux-built artifact beside a Windows-built shell, from one
commit, would have reported **different** identities, so "the host is running
the build this DASH shipped" would have been false in the only situation
anybody asks it. `scripts/runner-build-id.mjs` is now the one implementation and
folds path separators to `/` and CRLF to LF. Every input is TypeScript or JSON,
so there is no binary to corrupt.

Evidence: `pnpm typecheck` clean, `pnpm state:check` valid with the 8 recorded
drift warnings, 73 test files / 1383 passed / 8 skipped / 0 failed including 18
new cases, and both build scripts reporting the same `runner_build` from this
tree — which is the identity claim executed rather than asserted.

**`pnpm verify:shell` is red on this machine and not because of this branch.**
64 passed, 8 failed, 1 advisory; every failure is downstream of `[runner]
request failed: database disk image is malformed`, and the identical 8 fail on
master's own tree in the same session. MAR-506's quarantine of the malformed
`runner.sqlite` **has not actually happened**: the quarantine directory exists
and is empty, and a read-only open of the live store still answers "database
disk image is malformed". Nothing was worked around and nothing was moved.

**Nothing about a host is proven, and that is permanent rather than pending.**
What CI proves is the artifact starting under plain Node on a tree containing
only itself, serving a task over its own socket, and stopping through the
authenticated route. `ssh`, the deploy verbs and a real VPS are ADR 0004's
attended half; MAR-489 owns them.


## The developer path had no gate (MAR-505, MAR-506)

**Open on PR [#51](https://github.com/orchestratemcp/orchestratedash/pull/51), not merged.**
`pnpm shell` showed a window that said "Reading your agents…" and never said
anything else, and **the renderer was never at fault**: a freshly built export
of the same source hydrates and renders real data in the real shell.

`pnpm shell` builds the shell from the working tree and then loads whatever
answers on `127.0.0.1:3000`. On this machine that was a `next dev` server 59
hours and three merges old, serving a complete page whose client never
hydrated — reproduced identically in an ordinary Chromium, which is what
exonerated Electron, the preload and `dist/`. Editing `next.config.mjs` made
that server restart itself and the page hydrated in 268ms: same code, same
machine, same port.

**Nobody noticed it had gone stale because hot reload had never worked on this
origin.** Next blocks cross-origin access to its own dev resources for any host
not in `allowedDevOrigins`, and the default list omits the literal loopback
address `lib/shell/window.ts` deliberately requires — it refuses `localhost` on
purpose, because a name resolves through DNS. Two individually correct
decisions, whose intersection logged `Blocked cross-origin request to Next.js
dev resource /_next/webpack-hmr from "127.0.0.1"` into
`.next/dev/logs/next-development.log`, where nobody reads.

**Why no gate caught it is the larger half.** `scripts/verify-shell.mjs` forces
`DASH_SHELL_URL=dash-app://ui/` so the mandatory proof depends only on this
repository and this machine (ADR 0004). That is right and is unchanged; its
consequence is that **the gate has never once loaded the developer path**. And
the two proofs that look like they would have caught it would not have: proof
`1` counts headings the server had already delivered, and `2d` calls
`window.dashData` from the harness, which is not the page. Both are the shape
MAR-473 named when `6j` asserted only that *a* verdict existed.

So the assertion is an **absence**, because a frozen shell is not missing
anything on screen. Since MAR-432 every page opens in a loading state and leaves
it in an effect, so `data-view-state="loading"` still present after the budget
means no effect ever ran. `lib/shell/first-paint.ts` owns the rule; smoke proof
`1f` and `pnpm shell:check` evaluate the same probe so they cannot drift into
asking different questions under one name. `pnpm shell` also stops launching
against a renderer it cannot vouch for — nothing listening, another application
on the port, an error status, or an export older than the source it is built
from — and `lib/shell/preflight.ts` says plainly that it cannot tell a healthy
page from a frozen one, because no HTTP probe can.

Proven in three directions on Windows: PASS against the restarted dev server
(281ms, 2 polls), PASS against the packaged origin (`1f`, 3ms, 1 poll), and FAIL
with exit 1 against a page that never hydrates (stuck after 20207ms over 78
polls). The preflight's staleness refusal fired for real, naming the file.
`pnpm typecheck` clean, `pnpm state:check` valid, 74 test files / 1372 passed /
8 skipped / 0 failed.

**`pnpm verify:shell` cannot pass on this machine, for a reason outside this
change.** `runner.sqlite` in the installed-style data directory cannot be opened
at all — `database disk image is malformed` — while `dash.sqlite` reports
`integrity_check: ok`. All eight smoke failures need the runner's own database
(`6f`, `6g`, `6h`, `9b`–`9e`, `9g`); the other 65 pass, including `1f`. That is
MAR-506, which also names the product gap it exposed: a person is told "The
runner answered 500", by an application that has an entire recovery vocabulary
for damage to its *own* store and none for the runner's.

## UX principle

The home view answers three questions: what can I run, what is happening now, and what needs my decision? Connections are capabilities with scopes and receipts, not a wall of OAuth settings. Every run should make inputs, actions, outputs, gates, and failures inspectable.
