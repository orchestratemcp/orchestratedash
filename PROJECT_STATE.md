# DASH project state

Updated: 2026-08-07 (every open PR merged; the packet reconciled against master)

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

**MAR-509 merged** in PR [#56](https://github.com/orchestratemcp/orchestratedash/pull/56)
(merge commit `99fa58b`) on 2026-08-07, closing the "wanting a PR" line above.
Both harness defects are fixed exactly as described: the launcher resolves the
real `electron` executable rather than spawning a `.cmd` shim, and the proof's
own runner is built into its own output directory rather than relying on
`electron/runner-process.ts`'s module-relative resolution finding one that
was never there. The third, non-blocking item — `G2` dropping `detail` and
`recovery`, the only account of *why* a sign-in failed — is fixed in the same
PR, and it is what let the 2026-08-06 run name its own cause in one line and
led straight to MAR-508.

**MAR-508 is fixed and merged** — PR [#61](https://github.com/orchestratemcp/orchestratedash/pull/61),
merge commit `6020a9e`, 2026-08-07. The sentence here said "on a PR, not
merged", and the 2026-08-07 reconciliation pass corrects it along with ten
others. Branch
`000henrik/mar-508-google-oauth-client-secret`. This session picked **option
2** of the issue's own three — supplied locally, never committed — over
option 1 (compiled in beside the client id, which ADR 0002 already flags as a
present-tense problem) and option 3 (bring-your-own client, MAR-471's larger
and still-unbuilt answer). `DASH_GOOGLE_CLIENT_SECRET` is read fresh on every
call by a new `googleClientSecret()` in `lib/oauth/providers.ts` — the same
choice `loopbackProofOrigin()` already made and for the same reason: a
module-load-time read is invisible to a test that sets the variable per case.
`OAuthProvider` gained an optional `client_secret`; `exchangeAuthorizationCode`
and `refreshAccessToken` in `lib/oauth/flow.ts` both send it in the token
request when the provider declares one and omit the key — not an empty
string — when it does not. The loopback proof provider declares none, so
proof 7 is unchanged and unweakened.

**The test the issue asked for reads the request, not the fixture's
response.** `tests/oauth-flow.test.ts`'s new `capturingFetch` helper records
the outgoing form body; the assertion that `client_secret` reaches the wire
never touches what a server answers, which is the only way to pin a defect a
fixture that "does not care" what it receives could never have caught.

**Folded in: the issue's own "also worth revisiting."** `provider_error` and
`provider_refused` shared one case in `lib/copy/recovery.ts`'s
`describeAuthorizationFailure` and one sentence — "refused the sign-in...
managed by a workplace or school" — so a missing `client_secret`, which
`lib/oauth/flow.ts`'s `postForm` classifies as `provider_refused` for any
token-endpoint rejection other than `invalid_grant`, read to the user as
their employer blocking the app. Per RFC 6749 §5.2, every error that lands
there (`invalid_request`, `invalid_client`, `unauthorized_client`,
`unsupported_grant_type`) is the provider validating DASH's *request*, not
the account, so `provider_refused` now reads "DASH's Google sign-in request
was rejected... a fault in how DASH asked," actor `dash`. `provider_error` —
`lib/oauth/loopback.ts`'s reading of the authorization *redirect* itself
carrying an `error=` the provider put there — is a real signal about the
account and keeps the original wording. Two codes that used to render
identically now read as what actually happened.

`docs/real-google-proof-runbook.md` gained step 1a: set
`DASH_GOOGLE_CLIENT_SECRET` before running `node scripts/prove-google.mjs`,
and its own status paragraph is corrected to say the fix has landed but the
attended run has not been repeated — building the fix is not running the
proof, the same distinction MAR-509's own note draws about a harness that
builds.

Evidence: `pnpm typecheck` clean; full vitest from PowerShell (Git Bash's
`whoami` fakes channel-secret failures), 85 test files / 1611 passed / 8
skipped / 0 failed, 4 of them new. `pnpm verify:shell` was **not** run this
session: a runner from an earlier, unrelated, interrupted `prove-google.mjs`
attempt (`dist/google-proof/runner.mjs`) was found still alive on this
machine days after that run — nothing in the harness or the runbook tells an
operator to retire it when a run is interrupted, which is worth its own
follow-up — and starting the shell smoke alongside an unrelated live runner
risked exactly the interference AGENTS.md's process-safety rule exists to
avoid. It was left running rather than force-killed. **Nothing here is a
claim that the fix works against real Google.** That is the next attended
MAR-468 run, and MAR-508 is what it was blocked on.

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

**Merged in PR #43 (`958e95e`) on 2026-08-06, and half the issue was
deliberately unbuilt here.** The sentence this replaces said "open on PR #43,
stacked behind #42 and #41"; a later section already records the merge, and the
reconciliation pass corrects the claim at the point somebody reads it. MAR-457
built the artifact seam and proved it; this dresses it and invents no contract.

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
#52, which was open behind the Actions outage at the time; the overlap is
recorded in `.orchestrate/state.json` rather than avoided. **Both are merged
now** — #52 as `6515655`, this as `354c93c` — and #52 landed first, so the
conflicts that note predicted were resolved by keeping both sides.

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

**Merged** in PR [#63](https://github.com/orchestratemcp/orchestratedash/pull/63)
(merge commit `96a70b8`) on 2026-08-07; this paragraph said "open on a PR, not
merged" until the reconciliation pass. MAR-506's own child, and the half its PR
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

**Merged**, and in two parts from one branch: PRs
[#54](https://github.com/orchestratemcp/orchestratedash/pull/54) (`9a150d7`) and
[#57](https://github.com/orchestratemcp/orchestratedash/pull/57) (`7d1eb03`).
This paragraph said "open on a PR, not merged". ADR 0007's load-bearing
paragraph was a finding about a file that did not exist. It exists now:
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

**Merged** in PR [#52](https://github.com/orchestratemcp/orchestratedash/pull/52)
(merge commit `6515655`) on 2026-08-06 — this said "not merged" until the
reconciliation pass — **and half of the workspace UI was deliberately unbuilt
here.** The other half is MAR-507 below, which merged as `354c93c`.

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

**Merged** in PR [#53](https://github.com/orchestratemcp/orchestratedash/pull/53)
(merge commit `b784df0`) on 2026-08-06; this paragraph said "open on a PR, not
merged". ADR 0007 chose this repository's runner as the
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

**Merged** in PR [#51](https://github.com/orchestratemcp/orchestratedash/pull/51)
(merge commit `7f23d53`) on 2026-08-06; this said "not merged".
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

## The packet caught up with master (2026-08-07)

**Every open pull request in this repository has merged.** `gh pr list
--state all` reports #26 through #65 all `MERGED`, except #64, which was closed
in favour of the #62 hotfix. The packet still described eleven of them as open,
and two of the three sentences this file is proudest of — the ones about a
pre-merge claim being corrected by the session after it — had stopped being
written.

Eleven entries moved from `planned` to `merged`, each with its **merge commit**
rather than its branch tip, and each with `git merge-base --is-ancestor`
executed before the lifecycle moved: MAR-482 (#49), MAR-492 (#44), MAR-483
(#50), MAR-491 (#45), MAR-434's Outputs half (#52), MAR-505 (#51), MAR-497
(#53), MAR-484 (#54 then #57), MAR-498 (#55), MAR-508 (#61) and MAR-518 (#63).
MAR-506, MAR-507 and MAR-500 were already recorded `merged` and lose only the
sentences claiming they were not on master.

**`proven` was promoted for nothing, and that is the rule this pass ran on.**
This session executed no installed run. Several of those entries contain prose
that reads like proof — "proven in three directions", "green end to end" — and
promoting on a previous session's prose is precisely what the lifecycle exists
to stop. `merged` is asserted from git ancestry, which is implementation truth
and checkable here; `proven` waits for somebody to execute something.

The one exception is **MAR-434 → Done**, and it is an exception because it does
not rely on prose: its entry has recorded `proven` since PR #48 against a
citable CI run (`31100798451` at `cb9fe11`) of proof 9's acceptance criterion.

Linear was moved to match, using this packet's own meanings rather than a
board's: **In Review** means a PR is open, **In Progress** means merged and not
proven, **Done** means finished. So MAR-492 and MAR-505 move In Review → In
Progress — forward, not back, because their PRs merged and neither is proven —
and MAR-498, MAR-500, MAR-506, MAR-507, MAR-508 and MAR-518 move out of
Backlog/Todo. MAR-476 was stale in the other direction: Linear has said Done
since 2026-08-04 and the packet said In Progress.

**`state:check`'s drift count went from 11 to 17, and the increase is the
point.** An entry recorded `planned` produces no drift warning at all, because
the check only compares a *merged or proven* lifecycle against a Linear status
that has not caught up. Eleven issues were merged on master and invisible to
that check. Seventeen visible warnings, each explained in the entry it names,
is a more honest number than eleven.

**Unchanged deliberately:** MAR-458, MAR-467, MAR-468, MAR-469 and MAR-421 stay
In Progress for the reasons already written above them. The Google trio in
particular stays `merged`, because the 2026-08-07 attended run **failed** at
`G9` and the runbook's promotion rule is that a run failing any check promotes
nothing — including the fourteen checks it passed.

**What that run does establish is recorded where it belongs and nowhere wider.**
`G0a`–`G8b`, `G11`, `G12a`, `G12c`, `G13` and `G15a` passed against real Google
for the first time: a real consent, a real token exchange carrying MAR-508's
secret, a refresh token in the DPAPI vault, and the projection over real Gmail
MIME that ADR 0002 amendment 3 guessed was likeliest to be wrong. MAR-508's
entry says so and still does not claim `proven`.

**MAR-520 is filed, open, and not fixed by anything in this pass.** A
harness-spawned runner mints a channel secret kept nowhere, so after the harness
exits `POST /shutdown` answers 401 and the runner cannot be retired by the
route AGENTS.md prescribes — which is how the next run comes to open a second
writer against the same `runner.sqlite`, the pattern suspected behind MAR-506's
corruption. MAR-523's harness work retires the proof **agent**, which is what
raced the temporary-directory cleanup; the runner it leaves behind is still
unretirable.

## A reply to a real person (MAR-523)

**Open on a PR, not merged.** The first attended run ever to pass `G2` found
this on 2026-08-07 and it is one line of joining code, in the gap between two
functions that were each correct.

Real Gmail's `From:` is `Display Name <address>`. The loopback fixture's was a
bare address. The reply path handed the whole header value to
`gmail.draft.create`'s `to`, and DASH's own broker refused it `invalid_input`
**before Google was asked** — so no draft was created and `G10`, `G12b` and
`G14` were all downstream of one refusal.

**The validator was never the bug, and it is not loosened by a character.**
`ADDRESS` excludes `<`, `>` and `"` on purpose: a value passing it cannot carry
a display name with structure, cannot become two recipients, cannot end the
`To:` line. Widening it would put the whole RFC 5322 mailbox grammar back inside
a header DASH writes, which is precisely what `composeRfc822` exists to avoid.

**So the parse moved to where it happens once.** `gmail.message.read`'s
projection exposes `from_address` beside the raw `from`, and
`addressFromHeader` tests whatever it extracts against **the same `ADDRESS`**
the composer uses. The projection therefore cannot emit a value the write
operation would refuse — there is no third outcome, and that is the property
`tests/broker-write.test.ts` pins over six header shapes rather than three
examples. `ADDRESS` moved up beside the parser in the same change, because it
stopped being a rule about writing headers and became the set of addresses this
module will name at all.

The rules are three lines and one of them is a refusal. No angle brackets: the
whole trimmed value must be an address. Exactly one: the text to the next `>`
is the address and the display name is discarded rather than interpreted. More
than one: **nothing**. `From:` may legally carry several mailboxes, and picking
one would be DASH quietly choosing who a reply goes to — no recipient is a
visible failure, the wrong recipient is not.

**The loopback fixture now serves the shape Google serves.** Proof 7's provider
answers `"Colleague, A." <colleague@example.com>`, so the class is covered by
the mandatory gate rather than only by an evening somebody stands at a consent
screen. On unfixed code `7k` fails outright and `7l` — strengthened to assert
the display name does *not* reach the composed `To:` line — never runs. That is
the real accounting of how this survived three merged slices: every fixture DASH
had was a shape real Gmail almost never produces.

**Four harness papercuts from the same run are fixed here**, because they are
what the re-run needs and they live in the same file. The
`A REAL DRAFT EXISTS` banner printed unconditionally, with `draft id: unknown`,
over a run that created no draft — it is gated on the same value the cleanup
prints now, and `G16` is skipped rather than asked when there is nothing to
delete. `G16` itself failed on `deleted === "deleted"` because the operator
typed `delete`; it reads the answer now, negative branch first so `not deleted`
can never pass, and re-asks once rather than losing an attended evening to a
past participle. The end-of-run `rmSync` raced the still-running agent, whose
`cwd` is the directory being removed, so the agent is retired first through the
runner's own authenticated stop route and the removal is tolerated and named
rather than allowed to decide the exit code of a proof about Gmail. And an
`ENOENT` abort printed **"all checks passed"** over a half-run: there is a
`catch` now, the abort is a recorded failure, every check it never reached is
named as a skip, the stack prints above the summary, and the summary reserves
that sentence for a run in which nothing was skipped either.

**`G15b`'s `allowed_before_revoked: false` was a race, not a consequence of
`G9`.** The agent slept five seconds before its first poll while the harness
revoked about a second after the report said complete, so on a fast machine
every recorded poll was *after* the withdrawal and the check reported a
connection that had never worked rather than a transition. The first poll is
immediate now, the harness waits for it before revoking, and the flag is read
off that pre-revocation snapshot. The ordering is established by construction.

Evidence: `pnpm typecheck` clean, `[state] valid` with the recorded drift
warnings, and 86 test files / 1635 passed / 8 skipped / 0 failed from
PowerShell, 15 of them new. **Nothing here is a claim that a draft reaches a
real Drafts folder** — that is the MAR-468 re-run, and this is what it was
blocked on.

## The refactor the ADR predicted, done the way it said (MAR-488)

**Open on a PR, not merged, and it is one slice of the issue.** No pull
scheduler, no host event-file contract, no reconstruction from a host, no
artifact retrieval over `ssh`. What is built is the piece the ADR 0007 audit
named as the highest risk in the epic.

**The guarantee was being held by an accident of control flow.**
`drainTelemetry`, `drainArtifacts` and `syncWorkspace` each opened with
`if (runner === null) { return; }`, where `runner` is the *local*
`RunnerHandle`. They were not written against a channel — they were hardcoded to
the one runner this machine spawned. And `POST /broker/drain` is a neighbour of
`/telemetry/drain` and `/artifacts/drain` in `runner/server.ts`, on the same
authenticated channel, answering the same shape.

The audit wrote the failure down before anybody could commit it: generalise the
three to take a channel, and `/broker/drain` comes along **because it was in the
same loop**, in a commit whose message says "pull remote run evidence". No line
would say "extend the broker."

**So the parameter type is the fix.** `lib/agent-dom/evidence.ts` takes a
`RemoteRunnerChannel` — MAR-484's `RunnerChannel<EvidenceRoute>` — and
`EvidenceRoute` carries neither brokered route, so `channel.call("/broker/drain")`
inside that file is a **compile error** and the fourth drain cannot be written
there at all.

**Watched failing.** Adding exactly that line produces
`TS2345: Argument of type '"/broker/drain"' is not assignable to parameter of
type '"/health" | "/agents" | "/telemetry/drain" | …'`. The line was removed and
typecheck is clean again. MAR-465's rule — a gate nobody has seen fail is not
known to work — applied to a type.

Three assertions, none of which reads a flag: a `@ts-expect-error` at a call
site typed the way the drains are (an unused expected error is itself an error,
so it cannot rot into a tautology); a whole pull recording every route it asked
for and checking the set against `BROKER_ROUTES`, which is the capability
observed absent rather than declared absent; and MAR-484's existing scan of
`lib/` and `electron/` for the route strings in code, which already covers the
new module.

**The issue says `ControlChannel`, and that is the wrong vehicle** — worth
saying rather than quietly substituting. `ControlChannel` is *per agent*: it
carries a uri, a token and an optional socket path for one agent's own control
route, while these three drains are per *runner*. More decisively it carries a
**URI**, and a URI is a string types cannot see into — `${uri}/broker/drain`
would compile anywhere. Generalising over it would have produced the exact
refactor the audit warned about, while looking like the fix.

**Honest Runs rows, and the argument is about zeros.** The `dropped` counts the
runner reports were written to a console line and thrown away: the number that
says the record is incomplete was the one number no surface could see. They are
recorded now, in `evidence_pulls` — one row per source, overwritten, because
this is a state and not a history — and `lib/copy/evidence.ts` turns them into
the notice above the list.

The asymmetry is the whole design. For a runner on a machine **the user
administers**, the notice is **unconditional**: that host keeps working while
DASH is closed, and the evidence it has already discarded increments no counter,
so a zero is not evidence of completeness. For the runner on **this** machine it
is conditional, because DASH spawned that process and a buffer overflowing is a
real, bounded, reportable event. ADR 0005's distinction between a decision DASH
made and an attempt nobody adjudicated, pointed at a record instead of a
request.

It quotes the **oldest** look across sources, because "DASH last looked" is only
true of a list if it is true of every source in it, and the flattering answer
would be the most recent. It never reads as a fault — the tests forbid *error*,
*failed*, *problem*, *broken* and *corrupt* on every sentence the module can
produce, and forbid "complete record" — because a permanent honest caveat
rendered as a failure teaches people to ignore failures. And the table is shaped
like `broker_lapses`: no agent, no run, no artifact id, so no row in it can be
joined into something that reads like a run.

Evidence: `pnpm typecheck` clean, `brand:check` green, `[state] valid`, 88 test
files / 1644 passed / 8 skipped / 0 failed from PowerShell with 42 new cases,
and `pnpm build:renderer` green for the one `app/` change.
`tests/store-sqlite.test.ts`'s pinned migration count and table list were
updated by hand, which is that test working.

**Merged is the ceiling and nothing here has reached a host.** No `ssh` runs in
any test; the remote path is exercised only by a scripted channel. What the
installed shell *does* exercise is the local path through the same generalised
code, so a regression in the refactor fails the mandatory gate rather than
waiting for a VPS. MAR-489 owns the attended half.

## A runner nobody could retire, and the repair nobody could reach (MAR-520)

**Reproduced first-hand before a line was changed, and the reproduction shaped
the fix.** The runner the 2026-08-07 morning proof left behind was still alive
at 13:40: pid 28160 running `dist/google-proof/runner.mjs`, child agent pid
2072, `GET /health` answering `200` with `supervising: 3`, and `GET /agents`
answering **401** to the `runner.key` sitting in the same directory as its own
`runner.json`. Two different `runner.key` files on this machine were tried and
both were refused; they are byte-identical, so MSIX path virtualisation is
excluded. Last boot was 2026-08-06 22:02, before either process started, so no
restart had intervened. Every probe was a `GET` — nothing was shut down and
nothing was force-killed.

**The defect is not that the harness mints a secret per run.** It is that
**nothing recorded which secret a running runner had resolved.** `runner.json`
is deliberately secret-free and stays that way; its own header says why a file
every process on the machine can read is not where a credential goes. The
consequence nobody had drawn is that a runner whose secret diverges from the
data directory's `runner.key` — for any reason at all — becomes permanently
unauthenticable, with no evidence on disk saying so.

`runner/session-key.ts` is the answer, and the distinction it draws is the whole
of it: `runner.key` is what the **spawner** believes, and the session key is what
the **runner** is using. The runner writes the secret it actually resolved, at
the moment it resolved it, under `hardenOwnerOnly` — the same function, the same
proven ACL, the same refusal to start when the ACL cannot be verified. It is
written *before* the endpoint exists, so there is never a moment at which a
runner is reachable and nothing says how to stop it, and cleared on graceful
shutdown, so a session key on disk means a runner **is** alive rather than once
was. In the ordinary case it holds the same bytes as `runner.key` and is
redundant. In every case where they diverge it is the only thing that can retire
the process.

`runner.json` also gains `channel_secret_fingerprint`: SHA-256 truncated to 16
hex characters, no preimage, pinned by a test that asserts the secret and the
fingerprint share no substring. It turns a bare 401 — indistinguishable from a
wedged runner, a foreign process on the pipe, or a bug in the caller — into a
named answer *before* anything connects.

### The load-bearing finding is in `adopt`, and it is why the orphan held the store

`adopt` returned `RunnerCandidate | null`, and `null` covered three genuinely
different worlds: nothing is listening; something is listening that we cannot
authenticate to; the file is unreadable. `ensureRunner` reads `null` as
permission to spawn.

So **a live runner holding this data directory silently became a second runner
writing the same `runner.sqlite`** — the two-writers-one-store pattern MAR-506's
corruption is suspected to have come from, and worse than refusing to start,
because the second runner works and nothing looks wrong until the store does.

`retireLegacyRunner`'s own comment already names the rule this breaks — *"Two
runners supervising one machine is precisely what the endpoint's exactly-one
guarantee exists to prevent"* — and it only ever enforced it for the pre-MAR-430
case where the recorded file carries a `port`. A modern-but-foreign runner sailed
straight past it to `rmSync(runner.json)` and a spawn.

`adopt` returns a discriminated `AdoptOutcome` now, and `ensureRunner` **refuses
to spawn over a foreign live runner**: it first asks that runner to stop, using
the credential the runner recorded for itself, and when that cannot be done it
names the one remedy a person has — an ordinary machine restart. Never
`Stop-Process`, per AGENTS.md, and the refusal says so in the user's own words.

### The preflight

`scripts/google-proof/preflight.ts`, bundled by `prove-google.mjs` from the same
tree as everything else it builds, run **before** the build and long before an
operator sits down at a consent screen. Under Electron rather than plain Node
because `app.getPath("userData")` is the only honest answer to "which directory
is this run about to write to", and a third spelling of that path would be a
preflight guarding the wrong directory. Exit 0 clear, exit 3 held.

It deliberately does **not** retire an *adoptable* runner. The shell will adopt
it in a moment, and stopping it would be ending the fleet on startup, which is
the failure `ensureRunner`'s own header refuses.

### The quarantine directory, and why it holds no database

**DASH did not make it.** `retireDamagedStore` renames to
`runner.sqlite.damaged-<ISO>` *beside* the store and never into a subdirectory;
`runner.log` contains no "store set aside" line anywhere; and there is no
`*damaged*` file under the data directory at all. `runner-sqlite-malformed-20260806`
is a hand-made `Move-Item` from 2026-08-06 20:24. The main database was never
renamed and is gone — today's `runner.sqlite` dates from 23:03:45 the same
evening and answers `quick_check: ok`. So MAR-506's renames-and-never-deletes
rule was not violated by code. **It was never reached.**

**And it could not have been**, which is the part that is fixed. Three defects,
in the order a person would hit them:

1. **The repair was unreachable.** MAR-506 built two detections because the
   open-time probe cannot be complete, and only one was wired to anything.
   `runner/server.ts` classified a mid-request throw, answered the caller
   correctly — and dropped the finding, so `runner/main.ts`'s `storeDamage`
   stayed `null` and `POST /store/retire` replied *"There is nothing to set
   aside."* On the machine this happened to, the open-time probe **never fired
   once** — `runner.log` has no "records cannot be read" line — and the runtime
   path fired **twelve times**. The repair was unreachable through the only
   route a person has, on exactly the machine it was written for.
2. **It would not have worked if it had been.** Runtime damage does not close
   the store, so `retireStore` ran with the file open, and `renameSync` on a
   file SQLite has open answers `EBUSY` on Windows — measured with a probe on
   this machine, not assumed. The main database is moved first, so the whole
   repair failed on its first step. The store is closed and the workspace
   detached before the move now, and reopened if the move fails.
3. **A partial move was reachable** — the exact disaster `retireDamagedStore`'s
   own header describes, produced by the function written to prevent it. A main
   database moved away from its `-wal` leaves the fresh store a log referring to
   pages it does not have; a `-wal` moved away from its database discards every
   uncheckpointed transaction. It rolls its own moves back now, and reports a
   rollback that itself fails as the mixture it is.

**Watched failing**, per MAR-465. Both new store-damage guards were reverted and
both went red; restored, both green.

Evidence: `pnpm typecheck` clean, `brand:check` green, `[state] valid` with the
recorded drift warnings, 89 test files / 1670 passed / 8 skipped / 0 failed from
PowerShell with 26 new cases.

**`pnpm verify:shell` was not run, and it is recorded as not run rather than
skipped.** The orphan this issue is about was still alive on this machine, and
starting the installed smoke beside it is the two-writers-one-store pattern the
issue names. That is the failure MAR-520 is about rather than an excuse offered
for it; CI's Windows `shell-smoke` is this PR's installed evidence. **Merged is
the ceiling**: nothing here has been executed against a real leftover runner,
because retiring the live one is precisely what this session was told not to do.
The proven bar is the next attended MAR-468 run, whose preflight either reports
clear or retires something.

## The deploy bridge, and the verb set ADR 0007 deferred (MAR-487)

**The plane is built and the set is fixed.** ADR 0007's first follow-up said the
verb set "is not specified here… it belongs with the deploy bridge, where there
is something to validate against". MAR-484 wrote `connect` and left the rest as
vocabulary for an implementation that did not exist. This is that
implementation: **`install`, `start`, `stop`, `status`, `collect`, `connect`**,
in one closed array in `lib/deploy/verbs.ts`, beside the arguments each carries
and the check both ends run.

`tests/host-record.test.ts`'s by-value pin on `HOST_VERBS` **fired** when the set
widened from `["connect"]`, which is that assertion doing its job: a closed set
is only worth anything if adding to it is a change somebody has to make in one
place and defend, rather than one that rides along in a commit about something
else.

### Nothing variable reaches argv, which is stronger than validating it

ADR 0007's rule is *"DASH chooses which operation, never what to run."* The
mechanism here is narrower and easier to check: **a verb's arguments do not go
on the command line at all.** They travel as one JSON envelope on the child's
stdin, so the only strings `ssh` can be made to interpret are the fixed options
`sshArgv` composes, the destination, and a verb drawn from a closed array. The
set of strings `ssh` sees is fixed when this repository is compiled.

`connect` is the one exception and it is forced: its stdin **is** the HTTP
conversation, so a helper that drained stdin first would consume DASH's first
request and wait forever for an end that never comes.

### An identifier is not a path, and the helper is what enforces that

`bundle_id` and `agent_id` are opaque tokens over an alphabet that cannot spell
a separator, a traversal, a drive letter or a leading `-`. The helper joins them
to a root **it** chose and never receives a directory — MAR-507's rule (*the
renderer names a kind of file and never a file*) pointed at a machine DASH does
not administer, where the sharper version applies: a payload that could name a
directory is a payload that could name `/etc`.

File names *inside* a bundle are the one place a path travels, checked with
`runner/path-guard.ts`'s `inspectComponent` **per segment**. Per-component
rather than `inspectPathSyntax` on the whole string, because that one answers
about a path a caller *chose* and so requires an absolute one — a bundle name is
relative by construction and would be refused as `not_absolute` before any
interesting rule ran. It is also the stronger question: `..`, a colon opening an
alternate data stream, a trailing dot Windows silently strips, a control
character truncating a name inside a native call, and every reserved device name
at any depth are each properties of one segment.

**Two guards, watched failing**, and the table is amendment 2's shape:

| Change | What goes red |
| --- | --- |
| Remove the containment re-check alone | **nothing** — the component guard still refuses |
| Remove the component guard alone | **nothing** — containment still refuses |
| Both | the escape case |

Checked on the **helper's** side rather than only in DASH, and that is the
load-bearing word: a rule living only in the sender is a rule the host does not
have.

### What the helper is a boundary against, said without inflation

Not the host. DASH holds a key that could run anything there. What the closed
set rules out is **DASH itself** turning a deploy into arbitrary remote
execution: `start` runs `node start.mjs` because the *helper* decided that, not
because a request said so — `runner/README.md`'s sentence moved one machine
over. A test asks the helper directly with three request shapes carrying a
command, and every one is refused at the verb or ignored.

### `stop` works because of MAR-520, which ADR 0007 could not have foreseen

Every `ssh` session is a new process, so **every** stop on a host is by a
stranger. Before MAR-520 the only thing on the far end of that would have been a
signal — the force-kill AGENTS.md forbids, performed on a machine nobody is
watching, against the process holding somebody's agent history. MAR-520 made the
runner record the channel secret it actually resolved under an owner-only proven
ACL, so the helper authenticates to the runner's own `POST /shutdown`. A runner
that left no such record is **reported as running and unstoppable, with the
reason**, and the helper stops there. Both branches are driven by tests against a
real started process.

### What comes off the unproven list

ADR 0007 amendment 2 listed what stayed unproven: *"`ssh` itself: authentication,
the far-side helper, and the host's socket."* **The far-side helper comes off
it.** `tests/deploy-bridge.test.ts` runs the real helper — bundled from the same
entry point `scripts/build-runner-standalone.mjs` ships — as a local child, and
drives `runDeployVerb`, the production function, through install → start →
status → collect → stop. The only substitution is `spawn("node", [helper, verb])`
where production writes `spawn("ssh", sshArgv(…))`.

The exclusion is also asserted in the **other** direction: the deploy plane is a
second way to reach a host, and a door added there would not be a channel at
all, so no type would have seen it. A test scans the helper's own source for both
brokered route strings, comments stripped. The one route it reaches is the
runner's own shutdown, on the host's own socket, with the host's own credential.

MAR-482's refusal runs **before a byte ships**, and ADR 0006's option-1 receipt
is built and shown **before** the push — three limits, each a statement about
what DASH cannot do rather than about what the agent will do, which is what keeps
them checkable.

**What is not built, plainly.** Nothing in `app/` deploys anything and the
receipt renders nowhere yet; MAR-498 owns the Connection Center half. No host
record is persisted and no key is minted by this change — MAR-484 built both.
Restart-on-boot and retention stay undecided and the helper ships no service unit
and prunes nothing, which ADR 0007 and amendment 1 both leave open on purpose.

Evidence: `pnpm typecheck` clean, `brand:check` green, `[state] valid`,
`pnpm build:runner-standalone` green with `host-helper.mjs` in the artifact, and
90 test files / 1689 passed / 8 skipped / 0 failed from PowerShell with 21 new
cases. `pnpm verify:shell` was **not run**, and is recorded as not run rather
than skipped: the MAR-520 orphan runner was alive on this machine. Nothing here
touches the installed loop, so what a smoke would establish is that the deploy
plane did not break it — which CI's Windows `shell-smoke` establishes on this PR.

**Merged is the ceiling.** Nothing here has reached a host: no `ssh` runs in any
test, no key is used, no `sshd` is contacted. MAR-489 owns the attended VPS run,
and under ADR 0004 nothing about a remote host can ever have a blocking gate.

## The cast gets somewhere to stand (MAR-501, MAR-502, MAR-503)

**Three surfaces from one design pass, in one branch, and the reason is that
they are one screenshot matrix.** MAR-500 built the component, the assignment
and the enforcement and put them on nothing; its own note says the proven bar —
a witnessed render at 50px and 100px, both themes, `prefers-reduced-motion`
honoured — "belongs to the first BRAND-03/04/05 slice". Reviewing the three
apart would have meant photographing the same three widths in the same two
themes three times, with the second and third waves showing the first two
issues' work as unexplained background.

**The projections carry the character; nothing on a render path computes one.**
`AgentRow.avatar` and `WorkspaceView.avatar` are new, read from the `avatar`
column through `listAgents` and a new targeted `readAgentAvatar`. That is the
whole of the plumbing, and the reason it is plumbing rather than a call to
`oFor` in three components is that `oFor` is a pure function of the agent's
name and any of those components could have called it. It would have agreed
with the store on every machine, until the day something wrote a different
value — which is precisely the day MAR-435's "identifier independent of the
agent's name" would have stopped being true, silently, on three surfaces at
once. `tests/brand-surfaces.test.tsx` writes a character the seed would never
have chosen and asserts *that* is what each projection hands out.

The workspace reads the store rather than the manifest it is otherwise built
from, and that is the load-bearing line of MAR-502: `title` is the author's
`display_name` and moves whenever they publish, while the character is DASH's
own record and must not. A test renames an agent and asserts the portrait
does not move.

**The strip is presence, and it declines the one thing MAR-503 allowed it.**
That issue permits a textual state on hover. Nothing about an agent's condition
reaches the row — not the pose, not a colour, not the caption. The fleet cards
already say how each agent is; a row of characters that changed with them would
be a status display a person reads at a glance and cannot act on, and
`app/tokens.css` reserves emerald for live and healthy things specifically so
that a second, cuter status bar cannot grow underneath the real one. What the
caption says is who is here.

Static is the design rather than a first version of it. The cast has one frame
per character, so idle/working/waiting loops would be motion invented from a
single frame — the costume-as-status mistake arriving through the other door.
There is consequently nothing for `prefers-reduced-motion` to switch off, which
is what static-first buys.

**The app shell changed, and a picture is what asked for it.** `body` is now a
three-row grid — chrome, page, strip — one window tall, with `main` as the only
scrolling region. The first draft let the document scroll, and the 1280px
capture showed the result: the cast at the bottom of the *content*, a footer
somebody scrolls a run's whole history to reach, which is a different thing
from the bottom edge of the window MAR-435 asks for. `position: fixed` or
`sticky` would have been the two-line version and both paint over `main` as it
scrolls, so an approval card would pass under the characters — MAR-503's own
hard rule. A grid track has nothing beneath it.

Two grid lines are load-bearing and both were found by measuring. The column is
`minmax(0, 1fr)` because a grid item's default `min-width: auto` refuses to
shrink below min-content, and `nav.app-nav`'s five links are 484px of it: the
whole page silently laid out **574px wide inside a 375px window** the first
time this grid was tried, with the nav's own `overflow-x: auto` powerless,
because by then the scroller was as wide as its content. The middle row needs
`minmax(0, 1fr)` for the same reason in the other axis.

**Two defects found by photographing rather than by measuring**, which is the
lesson MAR-440's skip link already recorded and this repeats. `.row-list` and
`.work-list` are `<ol>`/`<ul>` and MAR-491's table-to-cards conversion left the
browser's markers on — a column of "1." "2." "3." in the left margin, outside
every card, at every width and in both themes, overflowing nothing and
misplacing nothing. And the strip's capacity was measured by a `ResizeObserver`
alone, which delivers inside the browser's rendering loop: in a window that is
not compositing it never fires, and the strip stood one character in a row a
thousand pixels wide. It listens to `resize` as well now, and holds its row in
state rather than a ref — the row does not exist until the agents arrive, so a
mount effect was measuring an element that was not there.

`electron/capture.ts` grew to match. It walks five surfaces instead of one,
because MAR-491's report names three record lists and the first wave
photographed one of them; it resolves the workspace's agent from the fleet
page's own markup rather than hardcoding a name no other machine has; and every
await is bounded by `within(…)`, after a run spent ten minutes producing a
splash and no explanation. `layout.json` now carries `widest_scroller` per
surface per width — MAR-491's hand-taken 341-inside-1425 measurement, in the
form a later session can re-take.

## The narrow window, finished (MAR-491)

**PR #45 stopped the scroll and did not make the cut.** It turned every data
table into a card list, which is why nothing overflows at 375px any more. What
it left is what the pictures show: the nine columns became nine stacked rows.
One agent card was over 700px tall at 375px — Where it came from, Plan source,
Build target, Planned steps, Clearance, Runs, one after another — so a person
reached the second agent by scrolling past four facts written in DASH's own
vocabulary. The sideways scroll became a downward one and the usability ceiling
stayed exactly where the issue found it.

**The cut is by usefulness, not by width, and that goes one step past what the
issue proposed.** MAR-491 offers two answers and prefers the second — a subset
primary, the rest behind a disclosure — *below a breakpoint*. This applies it at
every width. A width-conditional card is two interfaces, and the one a person
learns on a laptop is not the one they get when they narrow the window; and room
is not a reason to show something, because `Build target: code` answers no
question a novice has on a 27-inch monitor either. The concept direction's own
fleet card is a character, a name, a status and **one** line of meta.

`app/_components/record-card.tsx` is the one affordance and
`lib/copy/record-card.ts` is the one label. "Technical details" rather than
"More" or "Show all": the label names what is behind it, which is the only thing
that makes hiding it honest — somebody who does not want technical details can
decide not to open it. A native `<details>` is the whole implementation:
keyboard reachable, correctly announced, drawn by each platform in its own way,
working before hydration, and deliberately not remembered, because a disclosure
that reopened itself would be a preference nobody set.

**The trap the issue names is pinned by test rather than by care.**
`data-density="compact"` may not hide anything, so whatever hides facts must be
a control the user can see. `tests/record-card.test.ts` asserts that no
`[data-density]` rule declares `display: none` or `visibility: hidden`, and
separately that **no `@media` block mentions `.card-more`** — the second is what
fails if somebody later turns this back into a breakpoint.

Two faces, and the run card's is the sharper edit. The agent card keeps its
character, name, verdict chips and goal, and gains one meta line: how often it
has worked, and where it came from. `describeRunCount` says "Not run yet" /
"Run once" / "Run 34 times", because `0` under a `Runs` label is a fact a person
has to assemble and "1 runs" is the smallest possible way for a surface to look
unfinished. **The run card's heading was a UUID** — wrapped over two lines at
375px, as the largest thing on the card — which is what `lib/copy/identifiers.ts`
spends a module arguing against. It is now which agent and when.
`describeRunStart` reads the stored instant in the machine's own locale, at
render rather than in `lib/views/`, because a locale belongs to the screen
looking at it and a view cloned across a boundary would format for whichever
process happened to build it. An unparseable value comes back unchanged rather
than becoming "Unknown": a malformed timestamp is the one clue about what went
wrong. The id keeps its place as the link's destination and as a labelled value
inside the disclosure — it is how somebody reports a problem.

Card heights at 375px: the agent card 700px+ → **284px**; the run card 740px →
**165px** closed, 397px open.

**The chrome finding is closed here too.** PROJECT_STATE recorded it as separate
from MAR-491's tables and "wanting the same breakpoint decision rather than a
patch"; this is that decision, taken with the tables. `nav.app-nav` scrolled
484px of content through 359 at 375px, so two of the five destinations and the
density control were off-screen at rest with a scrollbar as the only hint they
existed — every capture wave since MAR-440 shipped measured
`density_toggle.fully_visible: false`. It wraps now. The chrome is 40px taller
at 375px, and in exchange every destination is reachable without discovering a
horizontal scroller inside a desktop application.

`qa-screenshots-wave1/` — the untracked before-state this session inherited,
taken 2026-08-05 — is committed beside the after-wave rather than deleted. A
before-state a reader cannot see is an argument they have to take on trust.

## The run that closed Communicate (MAR-468, MAR-458, MAR-469, MAR-523)

**2026-08-07, 20:25–20:28Z. All sixteen checks passed.** The grant this evidence
rests on expires **2026-08-14**, seven days after the run, because Testing-mode
grants for restricted scopes always do. A reader after that date is reading a
record, not a live claim.

It was the **fourth** attended attempt, and the file keeps all four rather than
only the one that worked. 2026-08-06 failed at `G2`: `lib/oauth/flow.ts` sent no
`client_secret` and Google refused the exchange outright — MAR-508, a defect the
loopback provider structurally could not see, because its `/token` never asked
for one. 2026-08-07 ~10:26Z failed at `G9`: DASH's own broker refused a reply to
a real display-name `From:`, and it was **right to** — MAR-523. 2026-08-07 20:14Z
failed at `G2` again, this time on an operator shell slip rather than any defect,
and promoted nothing; what it did produce is MAR-542, because a present-but-wrong
client secret read as *"DASH's request was rejected… this needs reporting"* when
the honest sentence names a configuration error.

**`G8b` is the one worth stating plainly.** ADR 0002 amendment 3 guessed, before
any run, that the projection over real Gmail MIME was the single most likely
thing to be wrong. It reported `raw_from_had_display_name: true` and
`from_address_is_bare: true` — Gmail served `Display Name <address>`, DASH's
projection handed the composer a bare addr-spec, and the validator that refused
the whole draft in October's run accepted it without being loosened by a
character. `G9` returned a real draft id and `G10` filed it against the same
thread the read came from.

The negatives held against a credential that could really have done the thing:
`G11` refused both send attempts as operations that do not exist, against a token
genuinely carrying `gmail.compose`; `G12a` refused a CRLF-carrying recipient
before any request reached Google; `G13` found no Google token anywhere in the
agent's process or environment. `G15b` — the check that was a race last time —
reported `allowed_before_revoked: true` and then `revoked`, in that order,
established by construction rather than by winning a timing contest.

**The preflight adopted a runner instead of demanding a restart.** MAR-520's fix,
merged that morning, working in the field: the leftover runner from the 20:14Z
attempt had recorded its own credential, so DASH could talk to it and took it
over rather than starting a second writer over the same `runner.sqlite`.

**What this promotes, and what it does not.** MAR-458, MAR-469, MAR-468 and
MAR-523 move to `proven`. Every promoted note carries the runbook's four
qualifications verbatim rather than by reference: the date and the seven-day
expiry; that the regime was Testing mode with a named test user and not a
verified public connection; that `G12b` is the weaker half of proof 7's `7n` and
proof 7 is not superseded; and that ADR 0005's cases 1 and 3, along with
MAR-469's durable replay memory meeting a real restart, remain unit tests only.

The Communicate leg is closed. Cloud is what remains: MAR-487 and MAR-488 are
merged, and MAR-489's attended VPS proof has not been performed.

## UX principle

The home view answers three questions: what can I run, what is happening now, and what needs my decision? Connections are capabilities with scopes and receipts, not a wall of OAuth settings. Every run should make inputs, actions, outputs, gates, and failures inspectable.

## The Bit-Command reskin (MAR-528, MAR-534, MAR-535)

**Merged in PR [#73](https://github.com/orchestratemcp/orchestratedash/pull/73)
(`7213e51`) on 2026-08-07.** The sentence this replaces said "open on a PR, not
merged", which was true when it was written; ancestry was verified with
`git merge-base --is-ancestor` before it was changed. Henrik adopted the Stitch concept package as
DASH's visual system on 2026-08-07, and the adoption is a decision rather than
a preference: 90s-terminal-brutalism, deep navy and electric blue, tonal
layering with crisp 1px borders, zero corners, Space Grotesk and JetBrains
Mono, a 4px grid — **without the fiction layer**, which the issue refuses by
name. No invented metrics, no intrusion vocabulary, no `UPPER_SNAKE` cosplay
copy, no private-key paste fields.

**The semantic names did not move, which is the whole reason the token layer
exists.** A surface that asked for `--surface-2` yesterday asks for it today
and gets a different colour. `DESIGN.md`'s frontmatter maps onto the four
surface steps without inventing anything between them: `background`,
`surface-container-low`, `surface-container`, `surface-container-high`.

**Three decisions worth reading in review.**

`--accent-contrast` became a `light-dark()` pair rather than white. The
concept's primary button is dark text on electric blue, and white on `#4cd6ff`
measures **1.70:1** — the primary button is the control every guided path ends
at, and it would have been the least readable word on the screen.
`tests/tokens.test.ts` stopped hardcoding `#ffffff`, reads the declaration, and
its floor moved from the non-text 3:1 to the text 4.5:1, which is what a button
label always was.

MAR-440's rule that *"the mono font is for content, never for vocabulary"* is
**spent**, and nothing replaces it. The body face is mono now, so the typeface
distinguishes nothing. That is the honest accounting rather than a gap: the
rule was always enforced by `lib/copy/identifiers.ts` and the copy tests around
it, and the typeface was a reminder. A reminder is not a check.

`--text-faint` dark is the palette's own `outline` lightened three steps. At
its published value it measures **4.54:1** on `--surface-3` — passing, with no
headroom at all, which is the token that fails the next time a surface moves.

**What is deliberately not here: the concept's 240px sidebar.** MAR-440 records
that replacing the horizontal nav would make a chrome pass unreviewable because
every screenshot changes for two reasons at once, and MAR-491 had just finished
making that nav wrap correctly at 375px. This restyles the chrome. It does not
re-architect it.

**A dialog rendered the whole application inside itself (MAR-534).** The
credential prompt and the approval popup each open a separate `BrowserWindow`
onto a route in DASH's own export, and both drew a title bar naming a surface
the window is not on, five links to places it cannot navigate to, a density
control for a page with one field, and a skip link past all of it — which made
"Skip to content" the first thing a keyboard user reached in a password prompt.
`isSeparateWindowRoute` already existed and already did this job for the fleet
strip; the chrome predates it by three issues and nobody joined them up.

The skip link **moved into `AppChrome`** rather than being separately gated,
because it exists precisely because the chrome sits between the window and the
content. It stays outside the `<header>`: `.app-chrome` is `position: sticky`
and therefore a positioned ancestor, and moving an absolutely-positioned
element in would silently re-anchor it — the class of defect MAR-440 already
shipped once with this exact element.

The consequence, and the one thing the fix could have broken: `body` is a
three-row grid and two of its children are now conditional, so auto-placement
would have put `main` in the `auto` track and `body`'s own `overflow: hidden`
would clip a prompt taller than its content with no scroller anywhere. All
three bands name their row now; an empty `auto` row collapses to zero.

`tests/dialog-chrome.test.tsx` is a render test rather than a screenshot,
deliberately: the failure is **presence**, and a picture of a dialog with a
navigation bar in it looks like a picture of a dialog. Its load-bearing
assertion is written against the surface *labels* rather than the `app-nav`
class name, because a chrome that kept the links and lost only its wrapper
would pass a class-name check and the links are the user-visible defect.

**The gap this could not close, stated rather than discovered later
(MAR-535).** Neither Space Grotesk nor JetBrains Mono is installed on the
development machine, and neither ships by default on any platform DASH targets
— checked, not assumed. So of the three things the visual system is made of —
the palette, the sharp shape language and the type pairing — the third does not
arrive, and the product renders in Segoe UI Variable Display and Consolas.
`app/tokens.css` says so at the top. The standing no-web-fonts rule is about a
*network* fetch and may not cover a woff2 read off disk over `dash-app://`;
deciding that is Henrik's, which is why it is an issue and not a commit.

Evidence: `pnpm typecheck` clean, `brand:check` green, `[state] valid`, 93 test
files / 1725 passed / 8 skipped / 0 failed from PowerShell. 43 images in
`qa-screenshots-mar-528/` from the real Electron shell on the installed-style
store at 1280/768/375 in both themes, every measurement reporting
`page_overflows: false`, `density_toggle.fully_visible: true` and
`fleet_strip.overlaps_main: false`.

**Not proven, and `pnpm verify:shell` was NOT RUN.** The orphaned
`dist/google-proof/runner.mjs` (pid 28160) and its child agent (pid 2072) from
the interrupted MAR-468 attempt are still alive on this machine — MAR-520's own
subject, and the reason AGENTS.md's process-safety rule exists. Starting the
shell smoke beside a live unrelated runner is two writers on one store.

## "The current connection page makes no sense to me" (MAR-533)

**Merged in PR [#74](https://github.com/orchestratemcp/orchestratedash/pull/74)
(`e85218b`) on 2026-08-07**, correcting the same pre-merge sentence MAR-528's
section above carries. That is Henrik, 2026-08-07, about the page the
whole trust story runs through — a UX verdict from the product's own first
user, and the reason this is a rebuild rather than a restyle.

**The page it replaces was not badly built; it answered a different question.**
MAR-383 asked for a *checklist* — what does this agent still need connecting —
so rows are grouped by **who holds the credential**: "Connect through DASH",
"Kept with the agent", "Managed elsewhere". Three headings of DASH's own
taxonomy, above a list of things that are mostly already connected, with the
permission card three scrolls down and underneath the buttons. That was the
right page during a first install and the wrong page ever afterwards.

Each connection is now one card answering, in order: **what can this reach, on
whose account, since when, and what has it actually been used for** — with the
receipt one click away.

**The three-party intersection is drawn.** *"A grant is the intersection of
three parties: DASH implements it, the manifest declared it, the provider
issued it"* has been true in `lib/broker/execute.ts` since MAR-458 and had
never once been on a screen.

Drawing it honestly needed a new list upstream. `requestedOperations` is
*already* an intersection of two of the three — DASH's operation set meets the
manifest's declared scopes — so from a card's point of view two parties were
indistinguishable inside it. `unrequestedOperations` is the complement, and it
is what turns the explanation from a slogan into something this repository can
be held to: **"send an email" listed as an action nobody asked for is DASH
naming an action it has never built**, and granting every permission Google has
would not create it. That is a stronger and more surprising statement than any
reassurance.

**Four capability standings, not two.** A partial consent — signed in, this one
not issued — is a different situation from never having signed in, and merging
them sends somebody to press a button that does not fix what they are looking
at. The chip is on every row; the *explanation* prints once per run, because a
reader who learns the small grey line never changes stops reading it, including
on the card where the third row differs from the first two.

**A connection DASH is not in the middle of gets the same headings with the
answers missing**, and that contrast is the page's whole lesson. The old
grouping stated its *cause* — custody — and left its *consequence* unsaid. Two
connections can both read "connected" while one has a receipt of every call and
the other has nothing at all, for ever. `handed_over` is the case worth being
blunt about: DASH holds the credential *and gives it to the agent*, so it looks
identical to the brokered case on every axis except the only one that matters.

**`lib/copy/when.ts` closes a plain-language hole nothing was watching.** The
page shipped `2026-08-07T13:58:28.037Z` onto the screen from five separate
fields — four times per lapse row — and at 375px one window wrapped over four
lines. A timestamp with a `T` and a `Z` in it is the same failure
`lib/copy/identifiers.ts` exists to stop, and it slipped through because a
timestamp is not an identifier and no rule was looking. Absolute and never
relative: a relative phrase needs a clock at render, and these timestamps are
evidence somebody can check against their provider's own account page.

**Two defects the screenshots found and no measurement could.** That is now the
fourth time on this surface family. An agent with no brokered connection was
told *"there are 5 periods DASH cannot account for"* directly above *"this
agent asked to reach nothing outside this computer"* — both sentences true,
together nonsense, because a `dash_closed` lapse says the broker was not
running to answer requests that could not have existed. And a three-action card
printed one explanation three times in eleven lines.

`electron/capture.ts` gains one full-height frame per `tall` surface. Every
image it wrote was a **viewport**, which is the right unit for "what does this
layout do as it narrows" and the wrong one for a card taller than a window —
the first review of this card was of its header.

Evidence: `pnpm typecheck` clean, `brand:check` green with **5** files using
the cast (Connections is a fourth surface for MAR-501's grammar), 96 test files
/ 1778 passed / 8 skipped from PowerShell, 51 of them new. 48 images in
`qa-screenshots-mar-533/`. `verify:shell` not run, for MAR-528's reason.

## Connect a server, and the field DASH will not draw (MAR-498, MAR-536)

**Merged in PR [#75](https://github.com/orchestratemcp/orchestratedash/pull/75)
(`ad2b1bd`) on 2026-08-07**, and it is the second half of an issue whose first
half merged on 2026-08-06. MAR-498's design slice shipped `lib/host-connect.ts`
— nine states and their sentences — with no surface, and its own state entry
has said ever since that the issue's `merged` bar was deliberately not met.
This is that bar.

**The concept screen has an `SSH_PRIVATE_KEY` textarea on it, and DASH draws no
such field.** MAR-484 made key custody structural rather than a policy:
`electron/ssh-host.ts` has **no function that returns a private key**, and a
test asserts that over the module's exports rather than trusting a comment —
because that is exactly where somebody would add a reader the day the deploy
plane wants to "just check" it.

So the flow is inverted. DASH makes the key and keeps the private half; what
the person is shown is the public half and where to put it. And the refusal is
**said out loud, on the step where the asking would have happened**: somebody
who has connected a server before *expects* to be asked, because every other
tool asks, and a flow that quietly does not ask reads as one that forgot rather
than as one that decided. The test for it checks the *markup*, not the copy —
the failure mode is somebody adding an input, not somebody deleting a sentence.

**The provider cards recommend nothing, rank nothing and link nowhere.**
MAR-485 owns provider recommendations and affiliate links and is a named
non-goal here. What they do is answer the one question a novice cannot get from
the outside — *"it is asking for a user; what is my user?"* — and "Something
else" is a first-class choice that says DASH does not know rather than guessing.

**The deploy receipt renders somewhere at last.** `lib/deploy/bundle.ts` has
built it since MAR-487 and nothing showed it. ADR 0007 requires the
while-closed sentence *before the first deploy*, and the moment a server
becomes reachable is the last point at which that is still true.
`describeDeployArrangement` is the base and the agent-named version is the
wrapper, not the other way round: two copies of a disclosure are two copies
that can be softened independently, and the one that would get softened is the
one somebody reads while deciding rather than while confirming.

### The defect this branch introduced, and the guard that missed it

Importing that receipt put `node:crypto` in the browser bundle. **The packaged
renderer stopped hydrating altogether** — every page drew its background colour
and nothing else: no chrome, no agents, no error on screen. It was found by
looking at the screenshots.

`tests/client-bundle.test.ts` exists for precisely this failure, and it passed.
Its Node-only set was five strings somebody typed, and `lib/deploy/bundle` was
not among them — a list nobody remembered to widen, which is the same shape as
the surface allowlist MAR-500 deliberately refused to add.

**The list is computed now.** `lib/` is walked, every module importing a
`node:` builtin is marked, and the mark propagates up the import graph to a
fixed point. A module written tomorrow that reads from disk is on the list the
moment it exists. The five original names are kept as a floor and asserted,
because a walk that broke and returned an empty set would pass that file
forever — which is the failure being fixed, arriving through a different door.

Two capture-harness fixes came out of the same session, both found by running
it rather than by reading it: a splash that closes during a `capturePage` retry
no longer ends a run holding 47 unwritten images, and a window that closes
between its photograph and its measurement now loses the caption rather than
the frame.

### What is not wired, said on the surface (MAR-536)

There is no host command family. `lib/shell/ipc.ts` has five and none of them
reaches `electron/ssh-host.ts`, so nothing here mints a key, writes a record or
runs a probe. The page says so **where the effect would have happened**, rather
than presenting a Next button that does nothing — the same read-only honesty
`useCanAct` already gives the developer path, extended to a capability missing
from every build rather than from this window.

The six unreachable states the surface therefore cannot reach are covered by
`tests/host-wizard-render.test.tsx` instead, which is the more durable half of
the issue's own bar: a screenshot proves a state was drawn once on one machine.

Evidence: `pnpm typecheck` clean, `brand:check` green, 98 test files / 1810
passed / 8 skipped from PowerShell, 30 of them new. 55 images in
`qa-screenshots-mar-498/`, with `page_overflows: false` and
`density_toggle.fully_visible: true` at every width — under **six** nav links,
which is MAR-491's wrapping decision surviving a sixth destination.

**Not proven, permanently so in CI.** `proven` here means attended and dated
against a real host inside MAR-489, per ADR 0004's attended half.

## A red gate that meant nothing (MAR-537)

**The flake was an ordering bug in the harness, not slowness in the artifact,
and its own failure message pointed at the wrong file.**
`tests/runner-standalone.test.ts` asserts on the runner's first four startup
lines and reached them by polling for `runner.json`. That file is a **strictly
earlier event than the lines**: `runner/main.ts` writes it the moment
`listenOnEndpoint` resolves, and prints `listening on`, `store:` and
`contracts:` afterwards. So the wait ended, by construction, at a moment when
the child might not have printed any of them.

Under load it is the *parent* that runs late — its own stdout `data` callbacks —
which is why a 100ms poll usually won this race and occasionally did not. What
it produced was `expected '[runner] standalone start: node=24.18…' to contain
'[runner] listening on'`: a truncated string blaming the built artifact for a
race in the thing observing it, on PR #75, against a commit that changed one
block comment. That is the failure ADR 0004's whole argument is about — a
blocking gate going red for a reason unrelated to the change teaches people to
re-run it without reading, and this repository's evidence discipline is worth
exactly as much as a red check is.

**The fix subsumes the old wait rather than sitting beside it.** `waitForLine`
reads the child's output until `[runner] contracts: …` appears, and because
`runner.json` is written before that line is printed, the file is present
whenever the line has arrived. The marker is `contracts:` rather than
`listening on` because that is the line the *second* test reads — ending on an
earlier one would leave that assertion racing exactly as the first pair used to.

Both failure paths now carry the child's whole captured output, its exit code
and its signal. A child that **exits** is reported the moment it exits rather
than at the deadline, because the interesting cases — an unsuitable host exiting
78, a missing module exiting 1 — are all fast, and spending sixty seconds on
them would bury the cause under a timeout that reads like slowness. The hook
timeout moved 90s → 150s for one reason: so a genuinely slow start is reported
by the sentence that names the line rather than by vitest's own timeout, which
names nothing and is the failure being fixed arriving through a different door.

Not skipped and not retried in-process, per the issue: the artifact starting
under plain Node on a tree containing only itself is MAR-497's whole proof.
Assertions are unchanged and `runner/` is untouched.

Evidence, exactly as the issue specifies it: **20 consecutive solo runs of the
file, 20 passed / 0 failed**, with `pnpm exec vitest run tests` running
concurrently in a second shell — and that concurrent full suite was itself
green, 98 test files / 1809 passed / 8 skipped / 0 failed.

**`tests/runner-store-damage.test.ts` reproduced later in the same session, and
it is fixed — but it was never the same cause.** The paragraph that stood here
said there was no signature to work from, which was true when written: the file
had just passed inside a concurrent full-suite run. It failed on the next one,
and the issue's stated reason for grouping the two — *"both start real child
processes"* — is false for this file. It spawns nothing and drives in-process
HTTP servers over named pipes.

The signature is `Error: Test timed out in 5000ms`, on exactly the two cases
that call `writeMalformedStore` and on no others. That is vitest's **default**
`testTimeout`, so this is not a race at all: it is a fixture that costs more
than the default budget on a loaded machine. Solo it takes under two seconds.

**The cost is four hundred commits, not the corruption.** The fixture inserts
400 rows one at a time, and every `run()` outside a transaction is its own
commit — on `journal_mode = DELETE`, which this fixture sets deliberately so
there is one file whose pages can be damaged, a commit means creating and
deleting a rollback journal beside the database. Four hundred file-create /
file-delete pairs is cheap on an idle machine and is not cheap on Windows with a
filter driver watching the directory. Wrapping the loop in one transaction
changes nothing about the file produced — the same rows land on the same pages —
and it took the whole suite from 32.8s to 20.9s, which is how much of that time
was journal round-trips in one fixture.

The explicit 30s budget on those two cases is the issue's own third preference
applied on top: sized from the observed worst case rather than the median, and
said in a comment. It is roughly fifteen times the solo cost, and short enough
that a genuine hang still fails the run rather than hanging it.

The general lesson is worth more than the fix. **A test whose default timeout is
load-bearing is a flake with a countdown on it**, and nothing in the suite
distinguishes "this assertion is fast" from "this assertion has been fitting
inside 5000ms so far". Both halves of MAR-537 are the same failure at one remove:
a harness making a bet about time, where the thing under test was never in
question.

## The type pairing, decided (MAR-535)

**Henrik decided it on 2026-08-07: keep the rule.** The two OFL families are not
bundled, DASH renders in Segoe UI Variable Display and Consolas on a machine
without them, and `app/tokens.css`'s paragraph about that is now the permanent
record rather than a note about a pending decision. The section above this one
described it as the gap MAR-528 "could not close and did not pretend to"; it is
closed by a decision rather than by a commit, which is what the issue asked for.

**What ships is the guard, and the rule it enforces is not the one it looks
like.** `checkNoRemoteFonts` runs inside `pnpm brand:check` over every
stylesheet and component under `app/` — 39 files — and refuses a remote
`@font-face`, an off-machine `@import`, a `<link>` to a font host, and
`next/font/google`. What it forbids is a **fetch**, not a font file. If MAR-535
is ever revisited and the two families are vendored into the export, they are
same-origin reads over `dash-app://` and **nothing here has to be relaxed to let
them in**. That is the whole design of it: a rule written as "no font files"
would have to be weakened by the very change it should tolerate, and a rule
weakened once is a rule nobody trusts afterwards.

`next/font/google` is refused for a different reason and says so in its own
sentence, because it otherwise reads as a false positive: it self-hosts, so no
page requests a remote font at runtime. What it moves is the fetch to **build
time**, where an offline or firewalled build either fails or ships whatever the
network answered that day. `next/font/local` is deliberately not refused — it is
the supported way to do exactly what bundling would have done.

The floor is the load-bearing line. A check that scanned nothing reports itself
as broken rather than passing, which is MAR-498's client-bundle lesson applied
before it could happen again: *a walk that broke and returned an empty set would
pass that file forever.*

## The cast, witnessed rather than photographed (MAR-501, MAR-502, MAR-503)

**MAR-500's note said the proven bar — a witnessed render at 50px and 100px,
both themes, `prefers-reduced-motion` honoured — "belongs to the first
BRAND-03/04/05 slice". This is that bar, executed.** What it needed was not more
pictures. Each of the three issues states clauses that a screenshot cannot
answer, so `electron/capture.ts` now asks them and writes the answers to
`cast-witness.json` beside the images: **13 witnesses, 13 passed**, in the real
Electron shell against the packaged renderer over `dash-app://` on the
installed-style store.

**Reduced motion moves through the media engine, not through a stylesheet.**
`Emulation.setEmulatedMedia` over the DevTools protocol is how the browser's own
device mode does it, and it drives the identical code path — so what is under
test is whether `app/tokens.css`'s `@media (prefers-reduced-motion: reduce)`
block is *evaluated*. Writing `--motion-fast: 0ms` from the harness would have
proven that CSS variables exist. There is no Electron API for this and no OS call
either; on Windows the signal is a Settings toggle.

It asserts a **pair**, and that is the point. Zero under `reduce` alone would
also be true of a stylesheet that had lost its `not (prefers-reduced-motion:
reduce)` block and was zeroing the tokens for everybody — a real regression that
reads as a pass. The characters are counted on both sides for the same reason: a
page that rendered nothing would report `0ms` very convincingly.

**Three defects were found by writing the witnesses, and all three were in the
witnesses.** The first compared the computed value against the string `"0ms"`
and reported the product broken twice, in both themes, on a stylesheet doing
exactly the right thing — `getComputedStyle` normalises `0ms` to `0s` and
`160ms` to `.16s`. A witness that reads a normalised value as a failure is worse
than no witness, because the next person deletes it instead of the defect. The
second hardcoded `"dash.fleet-strip"` where the real key is `"dash.fleetStrip"`,
so the off-switch witness would have read `null` and reported it — the harness
disagreeing with the thing it measures, which is `firstAgentName`'s lesson
arriving again, and the fix is to import the constants so a rename breaks the
build. The third made the activation witness read whatever focus a *previous*
witness had left behind: it worked until a workspace witness was added between
them, and then failed because of the order the witnesses ran in, which is the
least useful kind of red there is.

**`DASH_SHELL_URL` turned out to be mandatory and the harness header omitted
it.** Unpackaged, `main.ts` loads `http://127.0.0.1:3000` — so a session that has
just closed DASH to free the single-instance lock has no dev server, every load
fails `ERR_CONNECTION_REFUSED`, and the harness reports "no agents in this
store", blaming the store for a missing server. `dash-app://ui/` is what
`scripts/verify-shell.mjs` passes, for ADR 0004's reason.

**MAR-501 and MAR-502 are proven. MAR-503 is not, and the two clauses it misses
are named rather than rounded off.**

MAR-501's bar is met in full: three agents, the persisted characters at 50×50 in
both themes with `alt=""` and `aria-hidden`, both densities measured on every
surface, reduced motion honoured, and a missing-asset simulation in which every
sprite is genuinely fetched and empty — checked, not assumed, via
`complete && naturalWidth === 0` — while the boxes, the control count, the
accessible names, `main`'s height and the strip's height are all unchanged. A
missing sprite costs a picture and never a position.

MAR-502's is met for the same reasons plus its own: the portrait renders 100×100
in both themes, carries the same character file as that agent's fleet card, and
keeps its 100px box with the asset missing. The missing-asset witness runs on the
workspace surface separately rather than being inferred from the fleet page —
the fleet page's eight avatars are all 50px, so witnesses taken there say nothing
about a different element at a different size in a different layout. The focus
witness is deliberately not repeated on the portrait: it is decorative and is not
a control, so a ring around it would be the defect rather than the evidence.

**MAR-503 misses two.** Its bar asks for *10+ agents staying bounded with an
overflow count*; this machine's store has three, and seeding seven more into a
real user's records to take a screenshot would be a worse thing to do than
leaving the claim unproven. What is witnessed is the **bound** — narrowing until
the row cannot hold them, at which point the strip stands one and says "+2" with
no scrolling — which exercises the same `fleetStripSlots` branch a large fleet
would and is **not** the same claim. And its off-switch clause asks for the
setting *surviving an app restart*; what is witnessed is survival across a
document **reload**, which is the mechanism — `FleetStripScript` reading
`localStorage` before the first paint — but is not a process restart. Its
activation clause asks for click *and* keyboard; the keyboard half is driven
with real `Tab` and `Return` input events and lands on the right workspace, and
the click half is not driven.

Evidence: `pnpm typecheck` clean, `brand:check` green over 39 files,
`[state] valid`, 98 test files / 1818 passed / 8 skipped from PowerShell, and
**`pnpm verify:shell` green — 78 installed-shell proofs, zero failures**, which
is the first shell smoke run locally in several sessions. It became possible
because Henrik agreed to DASH being closed for it; the app was closed with
`WM_CLOSE`, the same signal the window's own close button sends, and not with
the force-kill AGENTS.md forbids. 66 images and `cast-witness.json` in
`qa-screenshots-mar-501-503/`.

## The living fleet (MAR-544, first slice)

**All three of the issue's asks are built, shaped around its own hard rule:
motion signals real state, or it doesn't run.** Branch
`000henrik/mar-544-living-fleet`, cut from master after PR #81.

**The O's move, and their behaviour is the fleet's state.**
`lib/views/fleet-motion.ts` derives each character's behaviour purely from
store rows: a decision waiting in the inbox (or a stalled agent) *beckons* —
and outranks work, because the person is what the agent is blocked on — a
running run *hops*, activity within the last hour *paces*, and a quiet agent
**sleeps by standing still**, the one state whose honest animation is none; a
test refuses any `.is-sleeping` rule arriving with an animation. No randomness
anywhere. The strip's "presence, not telemetry" header (MAR-503) is rewritten
to record Henrik's override rather than silently contradicted; what survives
is that no meaning colour reaches the row and the caption states the same
facts in words. The strip is now DASH's one always-on live read (runs + inbox
at the adapters' own five-second cadence), argued in place: its job is to
*notice* something coming into flight, which a poll gated on already knowing
about it cannot do. A failed read degrades to every agent standing still —
the pre-MAR-544 strip — never to invention. Five new `--motion-*` tokens,
zeroed under reduced motion, `steps()` timing throughout because eased
subpixel motion on pixel art reads as a rendering fault.

**Progress feedback, with an honesty gate.** `app/_components/working.tsx` is
the shared pips-beside-a-participle affordance; `lib/copy/working.ts` grants a
phase only to genuinely in-flight states ("Working…", "Waiting to start…") and
returns null for the waits-on-you and finished states, because a pulse on
"waiting for approval" would claim the system is working when the truth is
that it is waiting for you — the exact inverse of the fleet's
waiting-outranks-working priority, and the two vocabularies must not disagree.
Wired on the runs list — which now follows running work live, with
`agents/detail`'s disclosure line — and the workspace's current-run card.

**The boot sequence.** `ViewLoading` is now a Bit-Command boot: an
eight-piece pixel O with a clockwise dim-chase, the sentence that was already
there, a blinking cursor. `data-view-state="loading"` still stamps, so the
first-paint gate's absence-assertion is unmoved, and the state resolves the
moment real data is ready because it always did — the same genuinely-loading
state, dressed. Under reduced motion the glyph is a still, whole O.

**Verified in the rendered app** with a real running run in the dev store:
the strip carried `is-working` with `o-hop` applied at 0.64s, the caption read
"5 agents · 1 working · 4 not shown", and `/runs` showed "Working…" with the
pips pulsing over "Following the running work. Last updated …".

Evidence: typecheck clean, brand:check green (`checkAvatarCss` holds the new
avatar animations to the token rule by construction), 99 test files / 1840
passed / 8 skipped from PowerShell (15 new in `tests/fleet-motion.test.tsx`),
capture matrix in `qa-screenshots-mar544/`. **Not built, plainly:** the Chief
chat surface (MAR-419's own parked work), richer per-step phases — a
"Searching…" derived from component ids would be identifier vocabulary
guessed into English, so richer honesty needs a runner-side phase field
first — and a run-detail indicator, because `RunView` carries no status field
and adding one is a view change this slice deliberately did not smuggle in.

## The sidebar, decided (MAR-546)

**Henrik overrode the reskin's own call.** MAR-528 kept the horizontal nav,
citing MAR-440; Henrik wants the concept's fixed left sidebar, and MAR-546 is
that decision executed — branch `000henrik/mar-546-sidebar`, cut from master
after PR #81 merged so the sidebar is drawn in the bundled type pairing.

The 240px left track `--sidebar-width` has been waiting for since MAR-420:
identity block without the fiction (wordmark plus the adopted concept's own
name, `aria-hidden` because the title bar already says DASH), six pixel glyphs
drawn as `currentColor` SVG rects on a 12×12 grid rather than vendored as
PNGs — the O's are audited artwork, these are glyphs that must survive the
active block's `--accent-contrast` — and the density control at the bottom.

**Below 900px it collapses to an icon rail, not a drawer.** A drawer needs a
scrim and nothing in DASH may paint over an approval card; a drawer hides
every destination behind a press, which was the horizontal nav's whole
narrow-width failure; the rail costs 47px of a 375px window. MAR-491 is not
regressed, measured rather than asserted: at 375 `main` keeps 328px,
`page_overflows` false, `widest_scroller` null, the density toggle fully
visible — for the first time at that width since MAR-440 shipped. The labels
hide with the visually-hidden recipe, never `display: none`, so all six
accessible names survive the collapse; a test pins that distinction.

The grid stays honest when bands are absent: the sidebar column is `auto`, so
on a dialog route the empty track collapses to zero and MAR-534's gate now
removes six links and a rail from a password prompt. The chrome and the fleet
strip span both columns — the drag strip and the bottom edge are facts about
the window, not about a column of it.

Evidence: typecheck clean, brand:check green over 41 files, 98 test files /
1837 passed / 8 skipped from PowerShell (12 new in `tests/sidebar.test.tsx`),
and the full capture matrix over `dash-app://ui/` in `qa-screenshots-mar546/`:
66 images, 13/13 cast witnesses. MAR-440's note is revisited in the same PR,
as the issue asks.

## The type pairing arrives (MAR-535, decided again and executed)

**The dispute the coordinator recorded at the #77 merge is resolved: bundle.**
Henrik's final answer sits on the issue itself, ~20:30Z on 2026-08-07 — the
keep-the-rule chat answer was a menu mis-click by his own account, so the
18:15Z bundle comment stands and the later one confirms it. This session
executed it on PR [#81](https://github.com/orchestratemcp/orchestratedash/pull/81)
(branch `000henrik/mar-535-bundle-the-fonts`, cut from master at `c3a953e`).
The section above this one, and `app/tokens.css`'s paragraph, both said
"keep the rule" while it was the record; both are corrected at the point
somebody reads them rather than left to disagree with the issue.

**What ships is 62 KB and two licences.** Space Grotesk and JetBrains Mono as
SIL OFL 1.1 latin-subset **variable** woff2 in `public/fonts/`, their OFL texts
beside them, declared in the new `app/fonts.css`: `local()` first so an
installed copy wins, `font-display: swap` so an unreadable file costs a
fallback rather than a blank, and weight ranges (300–700 / 100–800) because
`.next-action` is weight 650 and a static pair could only synthesize it.

**The guard was relaxed by zero lines, which is its own design vindicated.**
`checkNoRemoteFonts` always forbade the *fetch*, never the file — the bundled
faces are same-origin reads on both paths, `next dev` in development and
`dash-app://ui/` packaged. Its "allows a bundled face" fixture went from
describing a future to describing the product. `checkBundledFonts` is the new
half of the contract: the woff2 bytes really begin `wOF2`, the licence rides
beside each family — a missing licence fails nothing visible and is a licence
violation, so it is checked as a fact about files the way the O's manifest is —
and every `/fonts/` URL a stylesheet names resolves to a shipped file, because
a deleted woff2 degrades silently through `local()` and the fallback stacks and
nothing else would ever say so. Seven fixture cases drive each failure mode.

**The verification is of the rendered app, not of CSS presence, on both
paths.** On the dev origin, with neither family installed on this machine,
`document.fonts` reports both faces `loaded` and `check()` answers true at
weights 400, 650 and 700, over same-origin `GET /fonts/*.woff2 200` — so what
loaded can only be the bundled files. On the packaged path, the capture harness
photographed the full matrix over `dash-app://ui/`: Space Grotesk headlines
over JetBrains Mono body in every image, **all 13 cast witnesses still green**,
71 images in `qa-screenshots-mar535/`. Two screenshots are attached to the
issue.

Evidence: typecheck clean, `brand:check` green — 40 files scanned for remote
fonts (`app/fonts.css` is the 40th), 4 bundled font files verified — full
vitest from PowerShell 98 files / 1825 passed / 8 skipped / 0 failed,
`build:renderer` green with `fonts/` in the export. `verify:shell` was not run
on this branch: two runners were alive (the ordinary one the smoke leaves by
design, and MAR-520's unretirable google-proof orphan), and CI runs the
Windows smoke on the PR.

## The panel becomes a contract (MAR-552, ADR 0008 slice 1)

**This is the slice that blocks the other four.** The MCP repo's drift check
pins DASH's schema copy by design, so DASH authors `$defs.panel` first and
orchestratekit-mcp mirrors it in slice 4 — the order `pnpm dash:schema:check`
enforces. Shipped on PR [#85](https://github.com/orchestratemcp/orchestratedash/pull/85)
(branch `000henrik/mar-552-panel-spec-schema`, cut from master at `341e210`),
open and unmerged, so `planned` with a null commit is where it sits.

**What ships is a schema, four types, a pure reader and a corpus.**
`$defs.panel`, `$defs.panelSectionV1`, `$defs.panelSectionOpaque` and
`$defs.roleName` in `contracts/agent.manifest.v2.schema.json`, referenced from
`agent_dom.properties.panel` — optional, and **omitted when undeclared, never
an empty object**, the exact rule `task_inputs` shipped with and for the same
reason: absence must never be read as "render something anyway". The closed
five-component vocabulary is `report`, `outputs`, `table`, `metrics`, `note`,
and the absences are still the argument — no component takes a URL, markup, a
path, an image or another agent's name, none asks the user for anything, and no
event vocabulary exists.

**The versioning rule is structural rather than a convention anybody has to
keep.** The schema's `if/then/else` on `panel_version` validates version 1
strictly against the closed enum — a section typed `reprot` refuses the import,
loudly — and sends every other version to `panelSectionOpaque` for structure
only, so an agent never becomes un-importable because its author moved first.
The same split reaches TypeScript: `resolvePanel`'s `newer_version` case
**carries no sections at all**, which turns the ADR's "never partially, because
a half-drawn panel is a guess rendered as a fact" from a rule a renderer must
remember into a shape it cannot violate. There is no array to iterate.

**One mechanical departure from the ADR's abridged JSON**, recorded because a
later reader will diff the two: Ajv's `strict: true` requires `"type": "array"`
beside `items` in the `then`/`else` branches or the schema does not compile
(strictTypes). Nothing about the shape changed. `contract.lock.json` is
untouched — it locks the frozen telemetry v1 pair, and v2 was never in it.

**A pure reader exists beside the schema for two reasons a schema cannot
serve.** `lib/contracts.ts` finds and compiles schema files with `node:fs`, so
Ajv cannot reach the client-side renderer slice 3 needs; and Ajv's account of a
failed `oneOf` is five copies of `must be equal to constant`, which names
nothing an author can act on. So `lib/panel-spec.ts` has **no imports at all**,
carries the vocabularies by value, and returns typed errors. The obvious cost
is a second source of truth, and it is paid rather than waved at: all 62 corpus
cases in `tests/panel-spec.test.ts` run through both the compiled schema and
the pure reader and must return the same verdict, so a rule added to one and
not the other turns the file red.

**The refusal says the right sentence, and the wrong door was left alone.**
`lib/import-feedback.ts` gains an `invalid_panel` case ordered *before* the
missing-property branch, because a `report` section that forgot `artifact_role`
produces Ajv's ordinary "must have required property" and read by that branch
becomes "this manifest is missing a required section" — sending an author to
the top of their manifest to look for something wrong inside their panel. It
takes the vocabulary from `panel-spec` rather than restating it as prose, which
is what keeps the sentence honest on the day a sixth component lands. It is
deliberately **not** wired into `checkManifestConstraints`: the handoff door
renders that function's result with a hardcoded ADR 0006 sentence about remote
runtimes, so a panel failure routed through it would answer the wrong question
in the user's face. Both doors already refuse through the `validateManifest`
they share.

**Non-goals held.** No renderer, no folder, no emitter, and no shipped example
declares a panel — asserted rather than assumed, the MAR-507 pattern. What the
next slices consume: MAR-554 calls `resolvePanel(manifest)` and gets
`none` / `v1` narrowed / `newer_version` / `unreadable`; MAR-555 mirrors
`$defs.panel` as a `.strict()` zod input and pins `PANEL_SECTION_TYPES_V1`;
MAR-553 needs nothing new, because the panel travels inside the manifest that
was already going.

Evidence: `pnpm typecheck` clean, `[state] valid`, `brand:check` green, full
vitest from PowerShell **99 files / 1910 passed / 8 skipped / 0 failed**, 85 of
them new. `pnpm verify:shell` was **not** run from this worktree — a parallel
visual session may have DASH open and the smoke hangs silently if it is — and
CI runs verify plus the Windows shell smoke on the PR, which is the gate.
Nothing installed changes in this slice, so `merged` is its ceiling.

## The config error stops reading as DASH's own bug (MAR-542)

A wrong or missing Google client secret reached the user as `DASH's Google
sign-in request was rejected... this needs reporting` — MAR-508 made the
token exchange send the secret correctly, but never taught `postForm` in
`lib/oauth/flow.ts` to say anything different when Google refused it.
`invalid_client`, RFC 6749 §5.2's own name for client authentication
failing, was collapsed into the same `provider_refused` bucket as every
other malformed-request code, actor `dash`, "report this". A config error a
person could fix in a minute was dressed as a defect worth filing.

**The fix is one new code, drawn narrowly.** `client_misconfigured` fires
only when `parsed.error === "invalid_client"`. `invalid_request` (which
covers a missing parameter, a duplicate, or any other malformed field —
including MAR-508's own `client_secret is missing.` shape),
`unauthorized_client` and `unsupported_grant_type` all stay under
`provider_refused`: none of them names the client credentials specifically
the way `invalid_client` does, and narrowing them too would be a guess
dressed as a diagnosis. `describeAuthorizationFailure` in
`lib/copy/recovery.ts` gained the matching case — headline `DASH's Google
client secret is wrong or missing.`, meaning says plainly the account was
never reached, actor `user` because the fix is concrete. The next action
names *what* to fix — the Google client secret DASH is configured with —
without the literal `DASH_GOOGLE_CLIENT_SECRET`: MAR-423's rule that no raw
identifier reaches a guided-path surface applies here as much as anywhere
else, and `expectPlainLanguage` enforces it on the new copy rather than
trusting a read-through.

**The test drives Google's real error shape, not the loopback fixture's.**
`electron/smoke.ts`'s `/token` route answers every POST with `200`
unconditionally and structurally cannot produce an `invalid_client` body —
the same blindness MAR-508 found the fixture had for a missing
`client_secret`. `tests/oauth-flow.test.ts` instead builds a fetch
returning `{error: "invalid_client", error_description: "Unauthorized"}`
and Google's `"The OAuth client was not found."` variant, against both
`exchangeAuthorizationCode` and `refreshAccessToken`. A neighbouring case
pins that `invalid_request` and `unauthorized_client` still classify as
`provider_refused`, guarding the narrowness against a later change
reclassifying too much.

Only `lib/oauth/flow.ts`, `lib/copy/recovery.ts` and
`tests/oauth-flow.test.ts` changed — no layout or visual file, respecting
the running visual session's ownership of look-and-feel. Evidence:
typecheck clean; full vitest from PowerShell (Git Bash's `whoami` fakes
channel-secret-adjacent failures on this machine, unrelated to this change)
98 files / 1827 passed / 8 skipped / 0 failed; `state:check` valid;
`brand:check` green, unaffected. `verify:shell` not run locally — CI's
shell-smoke gate is the check for this branch.

## An agent is now a folder (MAR-553, ADR 0008 slice 2)

ADR 0008's second implementation slice is on PR
[#87](https://github.com/orchestratemcp/orchestratedash/pull/87), branch
`000henrik/mar-553-folder-store`, open and unmerged. A newly imported agent is
now a DASH-owned folder at `{userData}/agents/{name}/`: its exact
`agent.manifest.json`, a relative `registration.json`, opaque `code/`, and
opaque `assets/`. The SQLite `agents.manifest_json` column deliberately remains.
It is an index and a last-readable fallback, which means `readStore`, every
existing view, and the row-level damage tolerance keep their shapes.

**Disagreement is reconciled and still reported.** On startup, a readable
folder wins and its manifest is projected into the row, but the discovering
session also receives `index_drift` or `missing_index` in
`unreadable.agent_folders`; projection never turns the observation into silent
agreement. If the folder is missing or unreadable, DASH serves the last readable
row so one damaged folder cannot take down the Agents page, and surfaces
`folder_missing` or `folder_unreadable`. A later clean restart has no stale
damage once the stores really agree. `describeStoreDamage` says both halves:
the folder is authoritative, and the index was used only where the folder could
not be read.

**Import commits the authority first.** The manifest, registration and declared
files are written into a bounded staging folder, fsynced, and swapped into
place before the exact manifest bytes enter SQLite. Every agent name and every
file-path segment passes `runner/path-guard.ts`'s `inspectComponent`, and the
joined path is independently checked for containment under that agent folder.
The `dash://` handoff carries a declared `{path, contents}[]` set only after the
person sees that DASH is about to take a copy. Agent-kit declares exactly its
seven scaffold files; the live registration points to the acquired manifest and
`code/` directory. Repeated handoffs compare the stored bytes as well as the
digest, so a locally changed acquired copy is repaired after consent rather
than blessed by stale metadata. Changing the author's project after import can
no longer change the code DASH runs.

**Migration tells the truth about what DASH has.** DB migration 10 is the
function-form, avatar-backfill-shaped migration the ADR specifies. It
materialises a manifest-only folder for each readable, safe row and copies no
code from an author's project and changes no legacy runner registration.
Unsafe directory names remain supported row-only agents and are reported as
skipped. Migrated agents therefore keep running from their old registration,
while `inspectAgentFolderStanding` reports `manifest_only`; no deploy producer
may pretend that means a build exists. The refusal already exported for slice 5
is `MANIFEST_ONLY_DEPLOY_REFUSAL`: this agent's build lives outside DASH;
re-import it to put a copy in DASH's keeping.

**The two consumers now have exact seams.** MAR-556's bundle producer can call
`inspectAgentFolderStanding` and, only for `complete`, consume
`agentFolderManifestPath`, `agentFolderRegistrationPath`,
`agentFolderCodePath`, and `agentFolderAssetsPath`; for `manifest_only` it can
render `MANIFEST_ONLY_DEPLOY_REFUSAL`. It needs neither the SQLite row as source
nor an author's project directory. LAB's workbench evaluation can continue to
consume the unchanged `readStore()` projection, use
`unreadable.agent_folders` through `describeStoreDamage` as disagreement
evidence, and evaluate acquired agent material from a `complete` folder's
`code/` and `assets/`, taking the folder manifest as identity. Neither consumer
has to invent reconciliation policy.

Evidence from PowerShell: `pnpm verify` passed — project state valid, typecheck
and brand check green, **102 test files / 1956 passed / 8 skipped / 0 failed**,
renderer build green, and every installed-shell proof passed. The shell proof
materialised a manifest-only folder without acquiring its source code, showed
that migrated standing still runs, imported a folder-carrying handoff, proved
that changing the original source cannot change stored code, and produced the
sample's reports from that stored `code/`. No renderer, panel schema, MCP
emitter, or MAR-556 bundle work is part of this slice.

## A date the machine wrote, on three surfaces (MAR-571)

`DigestBody` interpolated a digest item's `published_at` straight into its
muted source line, so an item read `Hacker News ·
2026-08-05T09:00:00.000Z`. That is the class of defect MAR-533 already named
and built `lib/copy/when.ts` for — that module's own header says a timestamp
with a `T` and a `Z` in it is the same failure as a raw identifier, because a
person who has to read a machine's own spelling of something has been handed
the machine's problem — and this call site was simply missed.

**It survived because nothing was looking.** No test rendered a digest item
that carried a `published_at` at all, so the copy gates, the plain-language
scan and every render test in the repository passed over it without a word.
The rule existed, the helper existed, and the one surface that needed them had
neither.

**Three surfaces from one call site**, because `DigestBody` is shared: the run
detail page, the workspace Outputs area, and — since MAR-554 — the declarative
panel's `report` and `outputs` sections. It is the *only* call site, checked
rather than assumed: `SourceList` renders no timestamp, and
`ArtifactSource.fetched_at` is drawn nowhere in the product.

The fix is a `publishedSuffix` helper over `plainMoment`, and the interesting
half is the null branch. **A timestamp DASH cannot read produces no segment
rather than the input** — `lib/copy/when.ts`'s own rule is that no function in
it ever returns what it was given, precisely so a malformed value cannot be
echoed back onto the screen on the one path nobody watches. The separator goes
with it: a dangling `" · "` would advertise a missing value a reader can do
nothing about, and the source name is a complete line on its own. The helper
returns the whole suffix rather than the moment so that the separator can never
be rendered by one branch and the value by another.

`Hacker News · 2026-08-05T09:00:00.000Z` becomes `Hacker News · 5 August 2026
at 11:00`.

**The tests were demonstrated failing before the fix was restored**, which is
the discipline MAR-465 and MAR-500 both wrote down — a gate nobody has seen
fail is not known to work. The component was reverted to the defect and three
of the four new assertions went red: the raw instant absent, the worded moment
present, and a malformed value producing no segment at all. The fourth — an
item carrying no date produces no segment either — passes in both directions
**by design**, and is recorded here as what it is: a regression guard on
behaviour the old code already had, not a claim about this fix.

The import is a *value* import and it is safe: `lib/copy/when.ts` has no
imports at all, so it reaches no Node builtin and drags nothing into the
renderer bundle. That is the rule `tests/client-bundle.test.ts` enforces over
every component in `app/`, and the failure MAR-498 and MAR-434 each paid for
once; the comment beside the import says so rather than leaving the next reader
to work out why this one is allowed.

Evidence: `typecheck` clean; `brand:check` green and unaffected — no stylesheet
or asset touched; `state:check` valid with the 19 pre-existing drift warnings,
none from this branch; full vitest from PowerShell 102 files / 1971 passed / 8
skipped / 0 failed, with `tests/outputs-render.test.tsx` going 25 → 29.
`verify:shell` NOT RUN: this change touches no shell, store or runner path, and
CI's shell-smoke gate is the check for the branch.

**One follow-up, named rather than forgotten.**
`tests/panel-render.test.tsx`'s "words a moment rather than shipping the
machine's spelling of one" assertion is scoped to the panel's own table region
*because of this defect*, and can be widened to the whole panel once both land.
It is not widened here because MAR-554's PR #88 is still open and that file does
not exist on master; cutting from #88 instead would have been a stacked PR,
which gets no CI in this repository.

## The panel gets drawn (MAR-554, ADR 0008 slice 3)

MAR-552 made the panel a contract. This draws it, and the shape of the
renderer is the ADR's rather than an implementation choice: `buildPanelView`
takes the **manifest**, calls `resolvePanel`, switches on the resolution's
`kind`, and only then switches on each section's `type`. A signature that
accepted a `PanelResolution` would let a caller build one some other way, and
the one thing ADR 0008 asks the renderer never to do is draw part of a panel it
does not understand.

Three new modules and nothing else on the product path: `lib/copy/panel.ts`
holds every fixed string, `lib/views/panel.ts` holds the bindings over
MAR-434's `buildArtifactCards`, and `app/_components/panel.tsx` is one `switch`
over a closed union with five small renderers under it. The view module imports
no value from anything that reaches a Node builtin, which is what lets it ship
in the renderer bundle — `tests/client-bundle.test.ts` records at length what
happens when that rule is broken.

**The version-skew card is structural rather than remembered.** `PanelView`'s
`newer_version` case carries no sections, inherited from `PanelResolution`'s.
There is no array to iterate, so "never partially, because a half-drawn panel
is a guess rendered as a fact" cannot be violated by a later edit without
widening a type first. A declaration DASH cannot read renders a second stated
card — damage surfaced, never silently repaired — with the typed errors kept
off the guided path because they are technical register and this is not a
technical surface. Both cards keep the author's title and the region's frame;
what is missing is only the part DASH cannot draw.

**The absences are the argument, and one of them cost something.** There is no
control anywhere in the panel — no button, no input, no form — and that
includes, deliberately, the Outputs area's own "Save a copy". It is DASH's own
control and it would have been handy. A box the author frames is the one place
a control could be made to look like it belonged to something it does not, and
the workspace's Outputs area offers the same action three inches away. The
second absence goes further than the surface it was inherited from: **no raw
identifier reaches the panel at all**, not behind a disclosure the way the
Outputs area allows. `PanelSectionView` carries no section id and
`PanelMetricView` no metric id, so there is nothing for a component to print by
accident, and those values stay reachable on the run detail page where a
disclosure already exists and is already tested.

**The one call ADR 0008 left open is named rather than buried.** The ADR says a
`table` draws "the newest JSON artifact of `source_role` whose body is an array
of objects", and under `contracts/run-artifact.schema.json` an artifact is
always an object whose root cannot be an array — so taken literally the
component could never draw anything. `ARTIFACT_BODY_MEMBERS` resolves the body
through a by-value pin mirroring that schema's own `allOf` branches (`digest` →
`items`, `draft` → `draft`). Adding a kind to the schema already requires
adding a branch; this is the render side of the same obligation, in one line a
reviewer can check against the schema. It also still accepts an artifact that
*is* an array, which is the ADR's literal reading, so neither reading is
foreclosed.

**The one table in DASH, and why it is allowed to be one.** MAR-491 removed
every table in this product after measuring one at 1425px inside a 341px
window. A panel table is a different population — at most eight columns, each
named by the author, of small declared values read across — and the 375px
problem is answered by containment rather than by hoping: the wrapper scrolls
and the page does not. `layout.json` reads `client_width: 244`,
`scroll_width: 331`, `scrolls_inside_its_own_box: true` at 375px, with
`page_overflows: false` and the wrapper as the only horizontal scroller on the
page, in all 32 frames.

**Render tests in both themes, without a browser.** Theme and density are one
attribute on `<html>` re-declaring custom properties, and MAR-420's rule is
that neither may change what is on the page — so the assertion is that the
panel's markup is byte-identical across all four combinations, which is the
strongest thing a static render can say and exactly the regression worth
catching. The half a render cannot see is checked by reading the stylesheet:
every colour in the panel's block must be a token, because a token is what
carries a value for both themes and a hardcoded hex would render identically in
a test and be wrong in one of the two palettes.

**TWO DEFECTS THE SCREENSHOTS FOUND THAT NO MEASUREMENT COULD**, which is the
fifth entry in this project's own running list of exactly that. The first was
fixed here: an absent metric rendered through the value's own class, so at the
display step an agent that had never run drew three metrics shouting their own
emptiness in type twice the size of the one real number beside them.
`.agent-panel-metric-absent` is the fix and a test pins it. The second is
recorded and not fixed, because it is in a file this slice does not own:
`app/_components/digest.tsx` prints a digest item's `published_at` straight
into its source line, so a raw instant reaches the guided path — on the run
detail page and the workspace Outputs area as well as inside the panel. That is
MAR-533's own defect surviving a fix that named the class of it;
`tests/panel-render.test.tsx` scopes its "words a moment" assertion to the
panel's own table because of it, says so in a comment, and can be widened the
day it is fixed.

**Two exceptions to this session's stated ownership, declared rather than
hidden**, both purely additive and neither touching an existing line: one
appended block at the end of `app/globals.css`, because the panel needs styles
and this repository has no component-CSS idiom that a CSS module would not have
introduced; and `electron/capture-panel.ts` plus a six-line build entry in
`scripts/build-shell.mjs`, because `electron/capture.ts` walks *routes* and the
panel has none yet.

That harness deliberately does **not** import `electron/smoke-identity.ts`,
which is the mirror image of why the smoke and the surface capture do. Those
two are proofs about the store. This one reads nothing from it — every panel is
a fixture — so taking the app's name would take its single-instance lock and
its user-data directory for no reason, and would mean the run could only happen
with DASH closed. Launched as a bare file it gets a name and a store of its
own, and this session's 32 images were taken beside three live Electron
instances without touching Henrik's records.

**What is not claimed: the renderer is not wired to any page.** `merged` is the
ceiling until a real manifest declares a panel, which arrives with MAR-548. The
screenshots are the packaged renderer's compiled stylesheet, its bundled faces,
its tokens, a theme moved by the operating system's own signal and a density
set by pressing the real control — over the exact markup the components emit,
with that markup mounted into `<main>` by the harness. They are **not** evidence
that the workspace renders a panel, because it does not yet, and
`electron/capture-panel.ts`'s header says so at length rather than leaving a
reader of the PNGs to work it out. MAR-553's folder store had not merged when
this branch was cut from `3666459`, so integration is the recorded next step
rather than something performed here.

Evidence: `typecheck` clean; `brand:check` green; full vitest from PowerShell
103 files / 2015 passed / 8 skipped / 0 failed, 77 of them new. `verify:shell`
NOT RUN — three Electron instances were live on this machine (two from the
coordinator's checkout, one from the MAR-553 worktree) and `AGENTS.md` forbids
force-killing them; CI's shell-smoke gate on PR #88 is the check for this
branch.

### MAR-553 merged mid-session, so this branch integrates it

The folder store landed on master while this was in flight — PR #87 as
`2b3801e`, with MAR-536's host commands behind it as `34d2b49` — and both were
verified with `git merge-base --is-ancestor` against `origin/master` before
anything here moved. `origin/master` was merged in; `.orchestrate/state.json`
and `PROJECT_STATE.md` were the only conflicts, both being two branches
appending an entry at the same position, and both were resolved by keeping both
sides. MAR-553's own entry moves `planned → merged` with its merge commit,
because implementation truth is git and the ancestry was checked; its prose is
left as that session wrote it, and this paragraph is the correction rather than
a rewrite of somebody else's sentence.

**What integration meant here, and what it deliberately did not.** There are now
two copies of every author document: `agents/{name}/agent.manifest.json`, which
ADR 0008 makes authoritative, and the row's `manifest_json`, which is a
projection of it. They can disagree, and the ADR's rule is decided — the folder
wins, and the disagreement is surfaced, never silently repaired. So the
renderer's contract is now explicit about which one it must be given:
`lib/views/panel.ts` names `readAgentFolderManifest` as the source and the row
as a **fallback rather than an equal**, since a row-indexed agent with no folder
— every agent predating the migration, and any whose name failed the component
guard — must still render its panel.

That rule is written and not enforced by a type, and the reason is the
client-bundle guard: `lib/agent-folders.ts` reaches `node:fs`, so importing it
here for its value would put a Node builtin in the renderer bundle, which is the
exact failure `tests/client-bundle.test.ts` was written for. It is also why
`buildPanelView` takes a document rather than an agent name — it renders for
both stores and names neither.

**The wiring itself is still the next step**, unchanged by the merge:
`workspaceView` in `lib/views/build.ts` is where the store is already read and
where two lines join `readAgentFolderManifest` to `buildPanelView`, and
`app/agents/detail/page.tsx` is where the region is placed. Both are outside
this session's ownership, and neither is worth doing before a manifest declares
a panel — which arrives with MAR-548.

## What needs connecting becomes a declaration (MAR-569, DASH slice)

ADR 0008's argument, applied to connections: what travels is a **declaration,
not code**. The agent says what it needs connected; DASH's own trusted flows do
the connecting. `$defs.connectionRequirements` is the block, referenced from
`agent_dom.connection_requirements`, versioned with the same if/then/else
discipline as `$defs.panel` — version 1 checked strictly, a version DASH does
not know accepted for structure only, and the block omitted when undeclared
rather than emitted as an empty object.

### The third connector kind does not exist, and that is the finding

The issue pinned `connector_kind` v1 to three members and attributed
`mcp_server` to MAR-498's wizard. **That wizard connects an SSH deploy host.**
`HostRecord` is an address, a username, a key name and a pinned fingerprint,
and `DEPLOY_VERBS` is what runs over it — the flow exists so an agent can be
put *on a server*. It cannot connect a Notion workspace. Nor is there an
MCP-server connect flow anywhere else in DASH: `remote_mcp_server` in
`lib/broker/providers.ts` is a `TokenCustodian` label, and that type's own
docblock records `dash_vault` as the only reachable value.

So the kind would have been unlaunchable on the day it shipped, which is the
precise failure the closed enum exists to prevent — the issue states the rule
itself, that "a kind DASH cannot launch is a lie on a button". The session
raised it rather than shipping it; Henrik's ruling on 2026-08-08 was to drop
it. **v1 is two members, `google_oauth_broker` and `api_key`.** A real
MCP-server flow belongs to the MAR-438 family and arrives the way any third
kind does: a version bump, accepted structurally, drawn as one stated "DASH
cannot connect this yet" line rather than a dead Connect button. A typo'd v1
kind still refuses at import, loudly.

Both remaining kinds act on a declared connection, so `connection_id` is
unconditionally required and the conditional branches the three-kind version
needed are gone. The link is not bookkeeping: it is what makes a requirement
checkable at all, since the standings resolve through the existing three-party
intersection on that connection and the Connect button acts on that
connection's field.

A near-collision worth knowing about: `$defs.connectionRequirement`
**singular** already existed and is a different thing — the per-credential
inventory behind `agent_dom.connections`, with fields, custody and a validation
action. Both defs now carry a description naming the other. Same connections,
opposite ends: one is the record, the other is the next action.

### The corpus found the drift it exists to find

`lib/connection-spec.ts` is the pure reader beside `lib/panel-spec.ts`, with
**no imports at all**, so MAR-570's surface and `lib/import-feedback.ts` can
reach it in a chunk that ships to the browser. `tests/connection-spec.test.ts`
runs 44 cases through **both** Ajv and the reader and asserts they agree on
every one.

It paid for itself on the first run. The schema refused a requirement carrying
a live-looking key under an `api_key` member, through the `propertyNames` guard
every connection block in this manifest has had since v2 was written; the
reader accepted it, because a re-statement written by hand had simply not
restated that rule. `FORBIDDEN_REQUIREMENT_MEMBERS` is the reader's copy now,
and the corpus is what holds the two together. A re-statement of a schema is a
second source of truth unless something fails when they disagree; this is the
something, and it was not hypothetical.

### The standings are MAR-533's, called rather than copied

`lib/connection-requirements.ts` resolves one requirement against the
connection row it names. It **calls `capabilityStandings`** from
`lib/connection-card.ts`. It does not re-derive the issued/signed-in facts from
a receipt, and the reason is the reason those four standings exist:
`not_issued` is the state a second implementation collapses into
`awaiting_you`, and the collapse tells somebody to sign in again to fix
something signing in again does not fix. That is MAR-533's own stated bug; a
fork here would have reintroduced it on a different page. A test asserts the
two stay distinct.

What the module adds is the **rollup**, because a requirement names several
operations and a line has room for one chip. The precedence is what the reader
should do next, worst-blocked first: `not_asked_for` (no sign-in clears it),
then `awaiting_you`, then `not_issued`, then `allowed`. **An empty list rolls
up to `awaiting_you`, never `allowed`** — a requirement whose connection has no
broker has granted nothing, and reporting that as "can do this right now" is
the one wrong answer on a page about what is safe to run.

**A disagreement is not a standing.** An operation a requirement names that its
own connection does not offer is two blocks of one document contradicting each
other. Rounding it into `not_asked_for` was available and would have made DASH
render "nobody asked for this" against a line that had just asked for it — so
it travels in `disagreements`, with its own sentence, pointing at a re-export
rather than a sign-in. The four standings are reused exactly, never stretched.

### Nothing is ever a button DASH cannot fire

`ConnectFlow` carries exactly what `lib/shell/ipc.ts`'s `connection.connect`
channel requires — agent, connection, field — so MAR-570 derives nothing of its
own; a descriptor the surface had to complete is one it could complete wrongly.
Both kinds land on that one channel deliberately: the row's own field kind is
what decides whether the prompt is a sign-in or a typed secret, and deriving a
second channel from `connector_kind` would put DASH's decision in the
manifest's hands.

Where no flow can be built, `ConnectFlowRefusal` says which case it is —
`connection_not_declared` or `no_field_to_act_on` — each with a sentence that
blames the file rather than the person. A test asserts **exactly one** of
`flow` and `flow_refusal` is ever set: a line with no button and no reason is a
dead end the surface cannot describe. The version-skew resolution carries no
requirements at all, inherited from the panel's rule, so there is no array to
put buttons beside.

The plain-language sentence in `lib/import-feedback.ts` is written out rather
than derived from the pinned array, because the members are slugs and
`lib/copy/identifiers.ts` refuses those on a guided surface — "google oauth
broker" is not what a person calls signing in. That makes the sentence
underivable and therefore able to go stale, so the vocabulary's size is pinned
by a test that names the paragraph to rewrite.

### What follow-ons consume, exactly

**The MCP emitter slice** mirrors `$defs.connectionRequirements`,
`$defs.connectionRequirementV1` and `$defs.connectionRequirementOpaque` as a
`.strict()` input, conditionally emitted, with fixture + `contract.lock` +
`canonical_commit` in one commit — the MAR-555 mechanics. It must emit a
`connection_id` matching an `agent_dom.connections[].id` it is already writing,
and **two** connector kinds. `dash:schema:check` gates it, which is why this
landed first. Derivation is honest here, unlike the panel's: the plan's
`connection_contract` / `what_you_need` already name the providers and scopes.

**MAR-570** calls `resolveConnectionRequirements(manifest)` for the four-way
resolution, then `resolveRequirements(requirements, agentId, rows)` for a line
each. Per line it gets `name`, `optional`, `why`, one `standing` for the chip,
`operations` for the expanded detail, `disagreements`, and either a `flow` or a
`flow_refusal` — never neither, never both. `describeStanding` and
`describeFlowRefusal` are the sentences. The `newer_version` case has
`declared_count` and no requirements, which is the stated card.

Evidence: `typecheck` clean; `brand:check` green; full vitest from PowerShell
105 files / 2124 passed / 8 skipped / 0 failed, 79 of them new; `state:check`
valid with 19 pre-existing drift warnings, none from this branch.
`verify:shell` NOT RUN locally — CI's shell-smoke gate on PR #91 is the check
for this branch, cut directly from `origin/master` at `9c7c72d` rather than
stacked. No UI, no MCP change, no broker change.

## The folder becomes the deploy bundle (MAR-556, ADR 0008 slice 5)

PR #90 is open against `master` from `000henrik/mar-556-bundle-producer`.

`lib/deploy/folder-bundle.ts` is the production caller `assembleBundle` was
missing. It reads a `complete` MAR-553 folder through
`inspectAgentFolderStanding` and the four public folder-path helpers, maps that
folder under `agent/`, puts MAR-497's standalone runner at bundle root, and
generates the one file that makes those two trees live together:
`data/agents/{agent_id}.json`.

The generated registration is relative to its own directory. Its manifest is
`../../agent/agent.manifest.json`, its working directory is
`../../agent/code`, and its command, arguments and environment are preserved.
In particular `dash:node` is not resolved on the DASH computer and is not
rewritten into a path; the standalone runner resolves it to the host's Node at
spawn time. `scripts/build-runner-standalone.mjs` exports the existing MAR-497
recipe, and `scripts/build-shell.mjs` uses that one recipe to stage the artifact
beside `main.mjs` at `dist/electron/runner-standalone`, which the existing
packager copies as part of the Electron build.

The migration boundary is first. A `manifest_only` folder returns
`MANIFEST_ONLY_DEPLOY_REFUSAL` verbatim before the producer reads the runner or
calls `assembleBundle`. The sentence therefore reaches the audited command
result and there is no half-bundle to accidentally send. An unreadable or
invalid complete folder likewise produces a stated local refusal; neither the
SQLite projection nor the author's source project is consulted.

The host action is `host.deploy`, added to the same named MAR-536 path as
create, probe and forget. The renderer supplies only a saved `host_id` and a
stored `agent_id`; preload exposes one named method; the audited dispatcher
records the action; Electron main resolves the saved host and protected key,
produces the bundle locally, and sends only MAR-487's closed `install` and
`start` verbs through `sshDeploySpawn`. Producer failures, including the exact
manifest-only sentence, are returned as renderable command detail. Per the
parallel ownership split, `lib/views/build.ts` and
`app/agents/detail/page.tsx` remain untouched; MAR-548's page action consumes
the now-live `submitHostCommand("deploy", { host_id, agent_id })` seam when the
coordinator composes the branches. No contracts schema file changed because
MAR-569 owns that block.

The layout equivalence is an executed integration test. The test builds the
real standalone artifact, writes a complete authoritative folder, sends the
produced request through the real host helper, starts the installed runner,
observes the generated registration in its initial supervised set, starts the
folder agent through the lifecycle route, and records that the process used the
host Node, the bundle's `agent/code` working directory and the stored
environment. Agent and runner are stopped over their authenticated routes.
There are **zero changes under `runner/`**.

Local PowerShell evidence: typecheck and brand check green; full Vitest **105
files / 2,050 passed / 8 skipped / 0 failed**; focused folder/deploy/shell
suite **119 passed**; both `pnpm build:shell` (with the artifact staged) and
`pnpm build:runner-standalone` green. `verify:shell` was not run locally: four
pre-existing Electron runner processes from the main, MAR-553 and MAR-554
worktrees were live, while this task requires DASH closed and `AGENTS.md`
forbids force-killing them. The PR's Windows shell-smoke is the installed gate.

What MAR-489 may now assume after this PR merges is precise: a complete folder
plus a saved reachable host with its far-side helper already installed yields a
self-contained runner + folder + live registration, installed and started so
the unchanged standalone runner supervises the agent; a manifest-only folder
refuses locally with the recorded sentence and sends nothing. The attended
runbook must still establish real SSH authentication and `sshd`, initial helper
installation, Hostinger's Node 24 / `node:sqlite` suitability, and the actual
remote execution evidence. Restart-on-boot and retention remain undecided.

### Master advanced while MAR-556 was in review

After PR #90 opened, PR #89 moved `origin/master` from the recorded cut point
`9c7c72d` to `0816f0c`. This branch merged that tip rather than rewriting its
history. The only conflict was the append position in `.orchestrate/state.json`;
both MAR-556 and MAR-571 are retained intact. `PROJECT_STATE.md` merged as two
appended sections, and MAR-571's product files are unchanged from master.

Post-merge PowerShell evidence is green: typecheck; full Vitest **105 files /
2,054 passed / 8 skipped / 0 failed**; `pnpm build:shell` with the staged
standalone artifact; `pnpm build:runner-standalone`; and `pnpm state:check`.

**PR #90 merged as `04275d6`**, verified with `git merge-base --is-ancestor` against `origin/master`. The sentence above called it open, which was true when that session wrote it; this is the same pre-merge-sentence correction every predecessor in this file has received from the session after it, and the prose it corrects is left as written.

## The panel gets declared, and the workspace draws it (MAR-548, ADR 0008 slice 3's integration)

**PR #88 merged as `9c7c72d`, and the sentence above is now history rather than
a plan.** MAR-554's entry moves `planned → merged` with its commit, checked with
`git merge-base --is-ancestor`; MAR-571's moves the same way at `0816f0c`. Both
are the pre-merge-sentence correction seven predecessors in this file have each
received from the session after them, and neither rewrites the prose its own
session wrote.

**What MAR-554 built had no caller and no author.** The renderer was complete,
tested in both themes at three widths, and reachable from nothing: no page
mounted it, and no manifest in the repository declared the block it renders. So
its ceiling was `merged` by construction, and its own exit note named the two
things that would lift it. This is both of them.

### The wiring is two joins and a field

`workspaceView` passes the **folder's** `agent.manifest.json` to
`buildPanelView`, falling back to the row's `manifest_json`, and
`app/agents/detail/page.tsx` renders the region. `panelDocument` is where ADR
0008's authority rule finally has a caller: `lib/views/panel.ts` states it in
prose and *cannot* state it in a type, because that module has to stay clear of
`node:fs` to reach the renderer bundle, so the choice is made where the disk is
already open.

**A folder that is present and unreadable falls back to the row, and that is not
the silent repair the ADR forbids.** `reconcileAgentFolders` has already
recorded it as a `folder_unreadable` issue at startup and routed it through the
same damage surface `readStore`'s unreadable rows use. The disagreement is
surfaced by the thing that observed both documents, rather than guessed at again
by a view builder holding one of them.

The region sits **below** the permission receipt and the Outputs area. Those are
DASH's record and DASH's controls; the panel is somebody else's box, and an
author's `note` placed above them would occupy the part of the page a person has
learned to read DASH's own voice in.

### Two panels, five section types between them

The **AI News Scout** — the manifest `agent-kit/scaffold.ts` generates, which is
what *Try a sample agent* actually creates — declares `report(digest)`,
`metrics`, and a `table` over the digest's items. Two choices on it are worth
more than the JSON:

- **Every metric is a `dash_fact`.** The scout emits no top-level numeric field,
  so an `artifact_field` metric could only ever render absent while *looking*
  like a number the agent had stood behind. The vocabulary offers both sources;
  this manifest uses the one it can honour.
- **`published_at` is declared `timestamp`, not `text`.** That is the author
  telling DASH the value is a moment, which is the licence DASH needs to run it
  through `plainMoment` rather than shipping the machine's spelling of it. The
  same column typed `text` would be a legal panel drawing a legal string, and
  nothing else would notice.

The **Gmail meeting assistant** declares `note`, `report(draft)`, `outputs` and
`metrics`. Its note says what the assistant does and **makes no safety claim**:
"nothing is sent" is DASH's sentence, rendered by `DraftBody` outside the
author's voice, and an author's note repeating it is precisely what the
attribution rule exists to prevent.

### The second query is not an optimisation

`artifactRecordsForAgent` is new because a panel binds by **role across every
run**, which the Outputs area beside it deliberately does not. A newest-first
window alone has a hole: an agent that has written `PANEL_ARTIFACT_LIMIT` drafts
since its last digest pushes that digest out, and a `report` bound to `digest`
renders its stated empty state — the surface saying *nothing yet* about a record
DASH is holding. That is a silent wrong answer, which is the failure this
project keeps paying for. A second query takes the newest artifact of **every
kind** whatever its position and closes it by construction.

The limit is 20 because that is `max_items`' own maximum in the schema. Setting
DASH's fetch bound to exactly the largest bound the vocabulary can request means
a truncation a person sees is always the *author's* cap biting, never DASH's, so
`describeOutputsCap`'s sentence can never be quietly wrong about whose choice
hid something.

### Both load-bearing tests were demonstrated failing first

A gate nobody has seen fail is not known to work. Pointing `panelDocument` at
the row turns the folder-wins test red — expected `Edited on disk`, received the
row's title — and it is the only assertion in the file that could catch it,
because both documents are present, both readable, and both declare a legal
panel. Dropping the second query turns the buried-role test red: twenty drafts,
no digest. Both pass on the code as committed.

### The installed witness MAR-554 could not write

`electron/smoke.ts` gains **6n** and **6o**, on the workspace route of the agent
proof 6 has just created through the real handoff. 6n asserts the author's
title, three drawn sections, and a table with rows — and the rows exist only
because the run above really produced a digest and the role really resolved
against it. 6o measures ADR 0008's strongest claim where it can be refused:
**zero controls inside the region, and zero raw instants.** MAR-554's 32
screenshots were the panel's markup mounted into `<main>` by a harness, and that
file's header says at length that they are not evidence the workspace renders a
panel. These are.

### The trim is a finding, not a change

MAR-548 asks to stop shipping the rest of the cast, and **there is no cast being
shipped.** `examples/` is in no package, nothing seeds a fleet, no surface offers
those manifests, and the only sample a user can meet is the one the menu
scaffolds — one agent, since MAR-457 replaced the folder digest rather than
shipping beside it. The four non-sample manifests in `examples/` are fixtures
with a directory that flatters them, and `tests/panel-spec.test.ts` now records
that where a reader will meet it.

Moving them into `tests/fixtures/` was the alternative and was declined on a
live collision: **MAR-569 is dirty in its own worktree editing
`contracts/agent.manifest.v2.schema.json`**, and connection-requirement work
will land on exactly those connection-declaring examples. What did change is the
half of MAR-548 that was a product change rather than a directory move: the
sample set is two agents and both declare a panel.

### Evidence, and the gap that is left

`state:check` **valid** (19 pre-existing drift warnings, none from this branch),
`typecheck` clean, `brand:check` green, full vitest from PowerShell **104 files
/ 2056 passed / 8 skipped / 0 failed**, 12 of them new, and `build:renderer`
green — which is the check that the new client import of
`app/_components/panel` did not drag a Node builtin into the browser bundle.

**`verify:shell` was NOT run, and neither was the `electron/capture.ts`
re-run.** A live DASH held the single-instance lock for this entire session,
`AGENTS.md` forbids force-killing it, and closing another session's window is
not this session's call — the same judgment MAR-441, MAR-421, MAR-434 and
MAR-554 each recorded in turn. Both remaining evidence items need the same
thing, so **`proven` is exactly one attended run away**: `pnpm verify` from
PowerShell with DASH closed, then the capture harness. Until then CI's Windows
`shell-smoke` gate on the PR is what executes 6n and 6o.

One prompt premise was wrong and is recorded rather than quietly worked around:
**orchestratekit-mcp holds no per-agent panel fixtures.** At `01e3f8a` the only
panel-shaped things in that repository are the pinned DASH schema and the
`.strict()` boundary tests in `tests/tools/exportBuildBrief.test.ts`, so both
panels were designed against the schema. `$defs.panel` was diffed against that
pinned fixture and is byte-identical, which is what makes "no schema edit" a
checked claim rather than an intention.

### The receipt was shipping raw instants, and a proof found it

6o went red on its first CI run, and the cause was a real defect rather than a
bad proof. `buildArtifactCards` interpolated `stated_at` and `received_at`
exactly as stored, so a receipt read `2026-08-05T21:14:02.000Z` beside a `Size
stored` that `describeRecordSize` has worded since MAR-434. One field in a
struct being raw while its sibling is worded is an oversight, not a decision.

Three surfaces from one place: the run detail page, the workspace Outputs area,
and the panel. It is **MAR-571's fix pointed at the other value in the same
card** — that one was the digest item's `published_at`, this is the receipt
around it — and both are MAR-533's rule.

**What wording costs is pinned rather than discovered.** `plainMoment` renders
to the minute, so an artifact DASH received in the minute the agent made it now
shows the same value on both rows. The assertion that used to sit in
`tests/outputs-panel.test.ts` — `stated_at` differs from `received_at` — was
true only because both were raw to the millisecond, and keeping it would have
meant keeping the defect to satisfy a test. What the receipt protects is *whose*
claim each row is, which the two labels carry; the replacement assertion drives
a gap big enough to mean something and requires the rendered values to differ.

### Three CI reds, three different causes, and only the first was a product defect

**CI is green at `19848eb`: `verify` and `shell-smoke` both pass**, so 6n and 6o
executed on a Windows installed shell and the declared panel was witnessed there
— the author's three labels by value, a table with rows, zero controls, zero raw
instants. Getting there took three red runs and they are worth separating,
because only one of them was a bug in the product.

1. **The receipt's raw instants** — real, and the reason 6o exists. Fixed above.
2. **A navigation race.** 6k loads the run detail page immediately before 6n
   loads the workspace, and a navigation arriving while a page is still settling
   comes back `ERR_ABORTED (-3)`. Retried now, so the proof fails when the panel
   is wrong rather than when Chromium cancelled a load — MAR-473's lesson.
3. **6n was asking the wrong question.** It read section labels with
   `.agent-panel-section h3`, a *descendant* selector, and `DigestBody` renders
   each digest item's headline as an `h3` inside the report section. A panel with
   three author labels and a two-item digest returned five, so
   `labels.length === 3` was false about a panel that was entirely correct. The
   selector is `:scope > h3` now, and the assertion moved from a count to the
   three declared strings **by value** — which is what would have caught it on
   the first run rather than the third.

**The gate could not say which of them it was**, and that is the finding worth
keeping: `shell-smoke`'s log stops at proof 6a in a failing run *and in a green
one alike*, so it reports pass/fail without ever naming the proof that decided
it. Three CI round-trips were spent on what one readable log would have answered
at once. It deserves its own issue.

What broke the deadlock was a throwaway Electron probe, deleted rather than
committed. Skipping `smoke-identity` gave it its own app name, user-data
directory and single-instance lock, so it ran **beside** the live DASH without
opening Henrik's records — the same trick `electron/capture-panel.ts` uses and
for the same reason. Against its own store it printed exactly what 6n reads, and
the five-element `labels` array in that output is what named the defect.

One thing was left on this machine and is named rather than left to be found: an
orphan runner from that probe, **pid 44632**, holding the *scratch* store at
`%APPDATA%\Electron` and not DASH's own at `%APPDATA%\orchestratedash`. It was
not force-killed, per AGENTS.md.

**What is still not done, and it is the whole gap to `proven`:** `pnpm verify`
locally from PowerShell, and the `electron/capture.ts` re-run. A live DASH held
the single-instance lock for this entire session. CI's `shell-smoke` is a
genuine installed-shell witness — it is what MAR-492 leaned on for the same
reason — but it runs on CI's machine and against CI's store, and the workspace
screenshots showing a real declared panel on a real route do not exist yet.

## The agent's own output leads its page (MAR-576)

Henrik, on the AI News Scout, in the app: *"I get no AI news from it. Only some
text about that it ran or something."*

### The diagnosis was run on the real store first, and it refuted half the prediction

MAR-548's handoff predicted the cause and was **right about the manifest**. A
`VACUUM INTO` snapshot of `%APPDATA%\orchestratedash\dash.sqlite` — read-only;
the live file was never opened read-write — shows `ai-news-scout`'s stored
document, folder and row byte-identical, stamped `create-dash-agent 43.2.0` and
generated `2026-08-05T15:24:29Z`, with `agent_dom` keys running `dom_version`,
`runtime`, `trigger`, `locations`, `connections`, `permissions`, `control`,
`memory` — **and no `panel`**. Reconciliation is clean: no damage, no drift. The
manifest predates MAR-548 exactly as predicted.

**The second half of the prediction was wrong, and that is what the issue turned
on.** The digests were all there — 33 of them, the newest carrying nine items and
three sources — and **the news was on the page the whole time**. `workspaceView`
resolves outputs from `latestArtifactForAgent`, `resolveArtifactAvailability`
returns `available` when no workspace row exists, `canPreview` passes, and
`OutputsPanel` renders the digest through `DigestBody`. Nothing was missing and
nothing was broken.

What was wrong was the **order**. Reproduced in the packaged renderer against a
scratch store seeded with Henrik's own manifest, digest and events: the first
headline began **1166px down an 812px viewport** at 375, and 664px at 1280. Above
it sat the files panel, Run now, a permission disclaimer, and — inside the output
card itself — a four-row provenance receipt reading *Made by* / *The agent's own
time* / *Reached DASH* / *Size stored*. That is "only some text about that it
ran", precisely. The agent's own output was the fifth thing on its own page, and
last inside its own card.

**So the obvious fix would have made it worse.** `AgentPanel` renders *below* the
Outputs area, so restoring the manifest alone would have pushed the declared
digest surface further down the page.

### The output leads, and only DASH's own surfaces moved

`OutputsArea` goes directly under the identity header; inputs, Run now and the
permission receipt drop below it. Inside the card the body renders before the
receipt, and the receipt folds behind *How DASH got this* while the output is
available — **inline when it is not**, which keeps MAR-434's argument that a
missing output still needs its provenance as a live branch rather than a deleted
one. `news_top_px` moves 1166 → 875 at 375, and 664 → 487 at 1280.

The author's panel **stays below DASH's surfaces**. MAR-548's attribution
argument — that a `note` must not sit where a person has learned to read DASH's
own voice — is untouched, because the news Henrik wanted is DASH's own rendering
of it, and raising that was enough.

**One defect, two renderers, and only the photograph had both in frame.**
`app/_components/panel.tsx` draws its own artifact card, so fixing the Outputs
area fixed nothing inside the author's region. The screenshot taken after
pressing the new button showed the receipt still sitting above the headlines in
the box whose entire purpose is *what did the scout find?*.

### The silence, and the one sentence that replaces it

`describeManifestGap` fires on two conditions: the stored document carries DASH's
own `create-dash-agent` provenance **and** declares no panel. Narrow on purpose —
most agents declare no panel and for them the absence is the author's choice, so
only a document **DASH itself wrote** can be behind DASH's own template. A
*malformed* panel is deliberately excluded: `resolvePanel` already reports it as
`unreadable`, and telling that person their agent is also old would be the wrong
second diagnosis of one fault.

**The first draft of the notice was itself the defect.** Headline, five-line
explanation, next action, button and a four-line reassurance rendered 400px tall
at 375px and put the news at 1156px — within ten pixels of where the bug had it.
A notice that explains why you cannot see something, by covering it, has fixed
nothing. It is one sentence now, two-column above 28rem, and the "nothing has
been lost" reassurance was cut because with the output directly underneath it
describes what the reader can already see. `next_action` survives as the way
forward for the reader with **no** button — a browser tab, or a shell older than
the command — and renders only then.

### One press, and the gate that makes it safe

`sample.refresh` is a fifth command family rather than an eighth `agent.*` verb:
that prefix is the contract's seven, and this is not one of them; `runner.*` is
process lifecycle, and no process is started, stopped or asked anything. The
payload is one agent id, so page script can ask DASH to regenerate an agent
**from DASH's own template** and has no way to hand DASH a document to store.

**The ownership gate lives in `electron/main.ts`, beside the write, not at the
IPC seam** — a gate at the seam is one a second implementation forgets. It reads
the *folder* first (ADR 0008's authority rule) and refuses anything
`create-dash-agent` did not generate. It then goes through the ordinary
`importManifest` door, which writes folder-then-row, revalidates, clears the
startup folder issue, and — through the `ON CONFLICT DO UPDATE` that deliberately
omits `avatar` — is why the caption under the button can promise the character
survives. Identity comes from the stored document, capability from the template;
regenerating rather than patching in the missing `panel` means a scaffolded agent
is never more than one press behind DASH itself. The agent's own project folder
is never touched.

`lib/shell/ipc.ts`'s compile-time routing assertion caught the unrouted command
on the first typecheck, which is exactly what it is there for.

### A test I wrote was false about the shipped product

Having folded the Outputs receipt behind a `<details>`, folding the panel's was
the obvious next step — and **neither smoke check 6o nor
`tests/panel-render.test.tsx` counts a `<summary>` as a control**, so it would
have passed everything while quietly weakening ADR 0008's "no toggle" claim.
Adding `<details>` to that control list turned it red, and the cause was not the
new code: `DigestBody` has drawn *Where this came from* inside the region since
MAR-434, arriving from the **artifact** the same way a digest item's link does —
the honest qualification `app/_components/panel.tsx`'s header already records
about links. So the assertion was wrong and the code was not. The panel's receipt
is simply moved below its body, the control list is unchanged, and it now carries
the reason.

### Evidence

`pnpm typecheck` clean · `brand:check` green · `state:check` **valid** with the
same 19 pre-existing merged/In-Progress drift warnings, none from this branch ·
full vitest from PowerShell **107 files / 2176 passed / 8 skipped / 0 failed**,
21 new · **`pnpm verify:shell` run locally on this Windows machine and all proofs
passed**, including new proof **6p** (`news_before_receipt: true`,
`heading_before_receipt: true`, `has_receipt: true`) with **6n and 6o still
green** (`controls_inside: 0`, `raw_instants: 0`) — which is what says the panel
change cost ADR 0008 nothing.

6p measures **document order** through `compareDocumentPosition`, not pixels: a
height comparison would pass or fail on the size of CI's window, and document
order is what a screen reader and a keyboard actually follow — the population an
ordering defect hurts most and the one a screenshot says nothing about.

Both load-bearing tests were demonstrated failing first. Dropping the provenance
gate turns *"says nothing about a third-party agent that declares no panel"* red
and nothing else; putting the receipt back above the body turns the two ordering
assertions red and nothing else.

Screenshots in `qa-screenshots-mar576/`: packaged renderer, 375 and 1280, light
and dark, plus one taken **after pressing Update this agent** showing the panel
present, the notice gone and the first headline at 410px. Taken by a throwaway
Electron probe that skipped `smoke-identity` — its own app name, user-data
directory and single-instance lock — so it ran beside the live DASH and never
opened Henrik's records. Deleted rather than committed, on MAR-548's precedent.

Non-goals held: no schema edit (`contracts/` belongs to MAR-569), no new panel
section type.
