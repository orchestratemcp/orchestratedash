# ADR 0014: DASH may ask a host to run an agent, and every run must name the machine it happened on

Status: Accepted

Date: 2026-08-11

Amends: ADR 0007 (the deploy transport)

## Decision

**A start-a-run route may cross the DASH↔host boundary.** `POST
/agents/{id}/commands` — the route "Run now" already uses on this machine —
joins the set a remote channel may be asked for. It is the only member added,
and it is added as a widening of an allowlist rather than as an absence from a
denylist.

Three rules come with it, and the third is the one that makes the first
defensible:

1. **What admits a route is `EVIDENCE_ROUTES`, not the two names ADR 0007
   excluded.** MAR-602 argues from the exclusion list — "`/broker/drain` and
   `/broker/responses` are about credentials, a run trigger carries none,
   therefore admit it". The conclusion is right and the reasoning is not, and
   the difference is load-bearing: `POST /agents/{id}/lifecycle` also carries no
   *brokered* credential and is in neither list, and it takes the user's typed
   secrets as an argument. See "The claim, settled" below.
2. **A control that starts a run names the machine it will use, and DASH never
   infers it.** Deploying an agent does not change what a button already on
   screen does. The copy on this computer stays the default target permanently,
   because it is the one DASH can account for completely.
3. **A run says which machine it happened on, from the pull that produced it,
   never from a deploy record.** ADR 0010's rule pointed one table over: a
   deploy row is evidence DASH sent bytes, and it is not evidence anything ran.

And one thing is deliberately **not** decided here, having been weighed and
found not to be the cheaper answer it looks like:

> **Trigger configuration — "on command, at a time, on an interval" — is a
> separate decision and a larger one.** It is not an alternative to this route.
> It is blocked on restart-on-boot, which ADR 0007 left open on purpose, and it
> needs a scheduler that exists nowhere in this repository.

## The claim, settled

MAR-602 and finding 30 both state it, and it deserves a direct answer before
anything is built on it.

> The reason the channel is evidence-only is ADR 0006's boundary, and that
> boundary is about **credentials** […] A *run trigger carries no credential*.
> Admitting a start-a-run route would not give a remote agent the broker, so
> this appears compatible with ADR 0006 and ADR 0007 rather than in tension with
> them.

**The conclusion is correct.** Tested in both directions, for the route this ADR
actually admits:

| direction | what travels | is it a credential |
| --- | --- | --- |
| DASH → host | an `AgentCommandEnvelope`: command, actor, nonce, expiry, and a payload of `agent_id`, `observed_at`, `task_id` | no. Every field is an identifier or a timestamp, and `observed_at` is a value the host itself published |
| host → DASH | `{ok, detail, reason, duplicate}` | no. `detail` is provider content and is already bounded and scrubbed by `lib/agent-dom/transport.ts` |

The bearer on the request is the remote runner's own channel secret, which
already crosses on `/telemetry/drain` and every other evidence route. Nothing
new goes out and nothing new comes back. ADR 0006's rule — *a brokered
credential is available to a process DASH's own runner spawned, on this machine,
while DASH is open* — is untouched, because no brokered credential is anywhere
in this exchange.

**The reasoning, taken as a test, admits something it must not.** "Does it carry
a credential" reasons from the denylist. The denylist has two members. Run the
same test over the routes that are neither excluded nor admitted and one of them
passes it:

`POST /agents/{id}/lifecycle` with `action: "start"` takes a `credentials`
object — environment names to values — that `electron/main.ts` assembles from
the OS vault by `collectSpawnCredentials` and the runner hands to the spawn.
Since MAR-458 those are **not** brokered: `deliverableSecretFields` cannot
return an OAuth target and `assertNoBrokeredCredentials` refuses if one ever
appears. They are the keys a person typed for a service DASH has no client for.

So `/agents/{id}/lifecycle` carries no *brokered* credential, is not in
`BROKER_ROUTES`, and would sail through a test worded as MAR-602 words it. What
it carries is the user's own secrets, off this machine, to a runner on a VPS.
That is not ADR 0006 undone — the broker stays here — but it is a credential
crossing the line on a route neither ADR names, and it directly contradicts the
receipt ADR 0006 requires DASH to show for exactly this arrangement:

> This agent signs in to Gmail itself, on the computer where it runs. DASH
> cannot limit what it does there, cannot show you what it did, and turning this
> off here does not stop it.

An agent that DASH hands secrets to over a channel is not an agent that "signs
in itself". Under ADR 0006's option 1, a remote agent **holds its own
credentials**; a lifecycle-start across the boundary would make DASH the
supplier, which is a third arrangement with no receipt written for it.

**What has actually been holding is the allowlist.** `remoteRunnerChannel`
carries a `Set` of `EVIDENCE_ROUTES` and rejects anything else with
`RemoteRouteRefused`, and `RemoteRunnerChannel` is `RunnerChannel<EvidenceRoute>`
over a union of literal strings. `/agents/{id}/lifecycle` is unreachable from a
host today for the same reason `/notify/discord` and `/store/retire` are: nobody
put them on the list. Not one of the three was argued about.

That is the *unargued* failure mode ADR 0007's load-bearing paragraph describes,
found one route over from where it was predicted. ADR 0007 predicted
`/broker/drain` riding along in a generalising refactor. The nearer risk is a
list that grows by anyone who can say "this one carries no credential either."

**So the test is restated, and it is a widening rather than an absence.** Three
questions, all of which a route must answer before it joins `EVIDENCE_ROUTES`:

1. **Does it carry a credential in either direction?** `/broker/*` carries one
   both ways. `/agents/{id}/lifecycle` carries one outbound. `/agents/{id}/commands`
   carries none.
2. **Does it choose *what* runs, or only *which*?** This is
   `runner/README.md`'s rule, which ADR 0007 says "decides more of this ADR than
   anything in ADR 0006", and the credential question does not cover it at all.
3. **Can DASH describe the result honestly afterwards?** ADR 0006's and
   ADR 0007's receipt test. A route whose effect DASH cannot account for is a
   button that produces an invisible consequence.

Question 2 is the one a run trigger has to pass on its own merits, and it does.
`POST /agents/{id}/commands` names an agent the host already installed and a
target the host's own state snapshot published a moment ago. It cannot introduce
code, cannot name a path, and cannot name a command line. `runner/execute.ts`
adjudicates it against the **host's** durable store — envelope validity,
assertable actor, expiry, replayed nonce, unknown target, undeclared capability,
agent not running — and the two stores never consult each other. DASH asks; the
host decides and is free to refuse. That is the same sentence
`runner/README.md` uses about registrations, and it survives one machine over
without weakening.

Question 3 is where this route nearly fails, and it is why the surface work in
this ADR is part of the decision rather than a follow-up. See "What Run now
means" and "What the surfaces must say".

## What is already true, before designing anything on top of it

ADR 0005's habit, and this time it re-prices one of the two candidates
completely.

**The route exists, on both machines, and is already adjudicated.** `POST
/agents/{id}/commands` is `runner/server.ts` line 627, in the same file and the
same process that is running on the VPS right now. Nothing has to be built on
the far side. The runner deployed for MAR-489 is this repository's runner at
`runner_build fa45e8715e790f8d6897`, which the attended run checked against the
id DASH shipped rather than asserting.

**The far side is already alive and already supervising.** The attended run read
both machines at the same moment: `HOST status ai-news-scout-2 running=true
pid=3758 since 21:51:04`. The deployed copy was up for the entire session. What
was missing was never a process; it was a way to say anything to it.

**"Run now" is not a lifecycle action.** It issues the agent-dom command `retry`
against a task the snapshot published, through `POST /agents/{id}/commands`.
`electron/main.ts` says so about the other family: lifecycle "goes to the
runner's `/lifecycle` route, never through the command channel […] these act on
a process, and no manifest declares them." So the route this ADR admits is the
declared, adjudicated, replay-protected one, and the process-control route stays
where it is. That split was made for a different reason and pays for itself
here.

**There is no scheduler anywhere in this repository, and that is the finding
that decides the second candidate.** Stated precisely, because "give it a
schedule" sounds like configuration:

- `agent.manifest.v2.schema.json` has `trigger.schedule` as a **free-text
  string**. Nothing parses it. The schema's own words about its neighbour:
  "schedule is free text (`weekdays at 08:00 local time`) and DASH does not
  parse it".
- `trigger.expected_interval_seconds` is used in exactly one place —
  `lib/views/glance.ts`, to decide whether an agent is *past* an expectation and
  should read as stalled. It is a judgement about lateness, not a clock.
- `runner/` contains no timer, no cron, and no restart policy. `runner/README.md`
  item 3 records the absence of a restart policy as deliberate.

So a schedule is not a field to fill in. It is an executor that does not exist,
placed on a machine DASH does not administer.

**A trigger in the manifest is the agent author's claim, and the schedule Henrik
asked for is the user's instruction.** ADR 0006 already did this analysis on
`locations.runtime.kind` and the result transfers without change: a manifest
field has "exactly the standing `draft.placement` and `sources_fetched` have —
the agent's claim, never DASH's record." *"I want to be able to switch
trigger"* is a person telling DASH what to do, so it must be DASH's record, in
its own table, immune to the next re-import — the argument `agent_looks` makes
for not being a column on `agents`, where the next `ON CONFLICT DO UPDATE`
either remembers to leave it alone or quietly resets it.

**The command channel has a principal, and a remote one is not `dash-local`.**
`runner/execute.ts` carries `ChannelPrincipal`, and the local shell's is
`{channel_id: "dash-local", may_assert: ["dash_session"]}`. The runner
authenticates the *channel* and cannot authenticate the human; it records the
actor as DASH's claim and stops there. That gap is named in that file already.
It does not widen here, and it does now cross a machine boundary, which is worth
saying out loud rather than inheriting silently.

## The candidates

### Option 1 — a start-a-run route on the remote channel

`EVIDENCE_ROUTES` gains the command route; DASH resolves a deployed agent's host
and posts the same envelope it posts locally.

The far side is built. The adjudication is built. The transport is built and
proven in CI (`tests/ssh-fetch.test.ts` runs the real `httpAdapter` over a
child's stdio). What is missing is the wiring — which host a deployed agent's
commands go to — and the honesty about which copy a button meant.

Its cost is not the route. It is that a run DASH causes on a host is a run whose
evidence arrives on **ADR 0007's pull schedule**, bounded by the host's
retention and by when DASH next looks. Pressing a button and seeing nothing is
the ordinary case, not the failure case, and a surface that does not say so
turns a working feature into a broken-looking one.

### Option 2 — a schedule the host executes

The agent gets a trigger a person configures, the host's runner honours it, and
a remote agent runs with no new route at all. This is the candidate MAR-602
calls "a different and possibly cheaper answer to the same need", and it has to
be argued down rather than skipped, because on the issue's face it is free.

**It is not cheaper. It is the largest thing in this issue.** By the finding
above it needs: a scheduler in the runner; a durable, user-owned schedule record
that survives re-import; a way to deliver a schedule change to a host and to
know it arrived; and a decision about what a schedule means when the host
reboots.

**That last one is blocked, deliberately, by ADR 0007.** Restart-on-boot is
listed as undecided, twice, with the reason:

> A host that restarts an agent DASH cannot see is a supervision claim DASH
> cannot make, and it deserves its own decision rather than a systemd flag
> chosen in passing.

A schedule is that claim made larger. A schedule that dies at the next reboot is
a promise DASH breaks silently; one that survives is a service unit, which is
the flag chosen in passing. Neither is available until restart-on-boot is
decided, and deciding it inside a run-trigger issue would be exactly the passing
choice ADR 0007 refused.

**And it makes the evidence problem worse in the one direction that matters.**
ADR 0007 already warns that on "a host running for a week against a DASH opened
on Sundays, *dropped* will be the ordinary case rather than the alarming one".
Every run in that week is unattended by construction. A person who configures an
interval and comes back to a Runs page is asking DASH for an account it cannot
give, and it is not obvious from the button that they are.

**It also answers a different question.** A schedule answers *run without me*. A
trigger answers *run now, because I said so, and tell me it happened.* Henrik
asked for both, the same evening, in his own words — *"we need to be able to
trigger and control the agent from DASH even tho it moved to the cloud"* and
*"I want to be able to switch trigger. Trigger on command or set a time or how
often it should trigger."* They are not substitutes. A scheduled agent nobody
can also trigger by hand is worse than what exists locally today.

### Option 3 — neither; make today's behaviour explicit

Say plainly that Run now runs the copy on this computer, that the copy on the
server runs when its own trigger fires, and that its trigger is `manual` and
nothing will ever fire it. Build nothing else.

This is the status quo with the silence removed, and it is worth naming because
**half of it is required regardless of which other option is chosen.** The
attended run's second consequence — *"with the agent present in both places, one
button silently means the local one, and nothing on screen says which machine a
run happened on"* — is a defect whether or not a run ever crosses. Option 3
alone is ADR 0006's option 3 again: a refusal without a product. The feature
becomes impossible rather than bounded, and a decision that says only "you
cannot have that" is a delay.

## What is chosen, and why the order is the decision

**Option 1 is chosen now. Option 2 is deferred, with its blocker named. Option
3's honesty is adopted unconditionally and lands first.**

The two mechanisms may both be right, and this ADR says which comes first and
why, because the ordering is not a matter of taste.

**The route is what makes the schedule provable.** ADR 0004's rule is permanent:
a blocking gate may depend only on this repository and this machine, so nothing
about a VPS is ever gated, and MAR-489's attended-and-dated shape is the
permanent shape. Now ask what an attended proof of each option looks like. For a
run trigger it is: press a control, watch the far machine, read both stores.
Performable in a session, this week, on the host that is already enrolled. For a
schedule it is: configure an interval, then wait for somebody else's clock,
having first decided what a reboot means. **A mechanism whose only possible
proof is attended should be the one a human can trigger on purpose.** Building
the schedule first would mean the first proof of remote execution in this
project's history is a wait.

**And it converts a permanently blocked check into a performable one.** `V8`
failed and `V9`, `V9b` were not run because they were blocked by it.
`evidence_pulls` still holds exactly one row, `source=local`, and MAR-488's
remote drain has never executed against a real host. The remote drain is written
and tested and has never been given a reason to find anything, because nothing
on the host has ever produced any evidence to drain. A remote run is the first
thing that would.

**Deferring the schedule costs nothing that is not already deferred.** The
manual-trigger agent on the VPS cannot start itself today and will not be able
to after this ADR. That is unchanged, it is stated on the agent's own page in
the words its manifest earned — *"No schedule and no inbound event is
configured"* — and a person who wants it to run can now cause that directly
rather than being told to wait for a mechanism nobody has built.

**Option 3's honesty is not sequenced behind either of them**, because it is the
answer to admission question 3. Until DASH can say which machine ran something,
a route that causes a run on another machine ships a button whose effect is
invisible, and question 3 refuses that. The naming work is therefore part of
this decision and not a follow-up to it.

## What "Run now" means when an agent exists in two places

Today it silently means the local copy, and finding 30 records why: a deployed
agent is still imported here, so the button resolves to the channel it always
resolved to. Nothing on screen says so. Four answers were available.

| answer | verdict |
| --- | --- |
| Run both | No. Two runs, two digests, two Discord posts, from one press nobody read as plural. |
| Run the remote when one exists, else local | No. **Silent re-targeting**: a button changes meaning because of something the person did on another screen days ago. Today's wrongness is at least constant; this makes it conditional on state the button does not show. |
| Ask each time | No. A modal on the most-used control in the product, whose answer is the same every time for the overwhelming majority of agents — the ones that live in exactly one place. |
| **The control says which machine it uses** | **Chosen.** |

**A control that starts a run says which machine it will use, in words attached
to that control.** For an agent that exists in one place it says nothing, and
that is the rule rather than an exemption: a product that appends "on this
computer" to every button is teaching people to read past it by the time it
matters. For an agent that exists in two, it names itself and its machine, and
when there is a second action it is a second named action rather than a mode of
the first.

*In words attached to the control*, and deliberately not in the label. A run
button is uppercase and letter-spaced by `DESIGN.md`'s rule, so "Send files and
run now on this computer" is a control wearing a sentence. A sentence beneath it
that names the control — *"Run now uses the copy on this computer"* — ties the
two together without deforming the button, and leaves room for the clause that
does the real work.

The rule underneath it, which is what makes it more than a copy change:

> **Deploying an agent never changes what a control already on screen does.**
> The copy on this computer stays the target of the existing button,
> permanently, because it is the copy DASH can account for completely.

That is the same habit as *"the renderer names a kind of file and never a file"*
and *"the API chooses which registration to start, never what to run"*: the
narrow, named, unsurprising thing, chosen by the caller in the open.

**And a run that already happened must say where.** Not derived from
`agent_deploys` — ADR 0010 forbids exactly that inference, and its list of
permanently unavailable sentences includes *"this agent is running on
marketing-vps"*. The honest source is the one MAR-488 already built: a run's
machine of origin is a property of **the pull that brought it in**. DASH drained
it from the local runner, or from a runner on a host, and it knows which,
because it is the thing that asked.

This is checkable today rather than assumed. `evidence_pulls` holds one row,
`source=local`, `kind=this_machine`, so *every* run in every store this project
has ever produced came from this machine — and a surface saying so is stating a
fact rather than defaulting to a flattering one. The moment that stops being
true, it stops being true in a table DASH writes when it looks.

## What the surfaces must say

Plain language, passing `lib/copy/identifiers.ts`: no route names, no field
names, no filenames.

**An agent that exists only here.** Unchanged. Naming a machine when there is
only one is noise, and the existing sentence — *"It runs only when you ask.
Nothing happens on a timer."* — is already true and already the right one.

**An agent that also exists on a server, before this route is wired:**

> Run now uses the copy on this computer. There is also a copy on Hostinger, and
> DASH cannot start that one yet.

Two sentences, both facts, and the second is DASH admitting a limit rather than
implying the first sentence covers everything. It is the wording that must be on
screen the day this ADR lands, because it is true the day this ADR lands.

**The same agent once the route is wired:**

> Run now uses the copy on this computer.
> Run on Hostinger starts the copy that is there. DASH will show what it did the
> next time it can reach that server, and only what the server still has then.

The second half of the second sentence is not decoration. It is ADR 0007's pull
cost said at the moment of pressing, so that "nothing appeared" is understood as
the arrangement rather than as a failure. Amendment 2's rule about disclosure —
said *before* the act, because a disclosure that arrives after has told them
nothing — applies unchanged.

**A run in the list, on the machine it happened on.** The fact belongs on the
row, because which machine a run happened on is a property *of that run* — the
opposite call to MAR-488's completeness notice, which sits above the list
because it is a statement about which runs *exist* and would be a lie beside a
run that does.

> This ran on this computer.
> This ran on Hostinger.

**And DASH cannot say it per row yet, so it does not pretend to.** `runs` has no
column for the machine, because until this issue there was only one and the
question could not be asked. Adding one belongs with the wiring, where there is
a remote pull to write it from. Until then the honest form is the answer DASH
*can* support from `evidence_pulls`, and it is a statement about the list:

> Everything below ran on this computer.

— true of every store this project has ever produced, and derived from the table
DASH writes when it looks rather than assumed. And, once a server becomes a
source:

> Some of these ran on a server, and DASH cannot tell you which.

That second sentence is a worse product and the right decision. The alternative
is a plausible guess from `agent_deploys`, which ADR 0010 forbids by name, and a
visible limit is what creates the pressure to record the fact properly. It is
also self-repairing in the direction that matters: the day a run carries its own
origin, the list-level sentence has nothing left to say and the row says it.

**What no surface may say.** That an agent is running on a server; that a server
holds the current version; that a list of runs from a host is complete. The
first two are ADR 0010's, unchanged. The third is MAR-488's notice, which
already exists, already renders above the list, and already says the honest
thing for a remote source without being a fault report.

## What stops being proven, and what starts being provable

**`V8` becomes performable and does not become proven.** ADR 0004 is permanent
here: a VPS is neither this repository nor this machine, so no blocking gate
will ever cover a remote run. What changes is that the attended proof has a path
to walk. It stays attended, dated, with a promotion rule written first, forever.

**The channel principal now crosses a machine boundary.** The runner
authenticates the channel and records DASH's claim about the actor; it cannot
check a human. Locally that means "the OS user running this copy of DASH".
Remotely it means the same thing, asserted to a runner on a machine the user
administers, over a credential that machine holds. Nothing widens — a remote
channel asserts no more than a local one — but the sentence "the runner records
the actor as DASH's claim" is doing more work than it was, and
`assertableActorTypes` is still the function that changes when enrollment and
session authentication land.

**A run caused remotely is a run whose evidence may never arrive.** The host's
buffer is bounded, `runner/supervisor.ts` drops past its bound, and DASH reads
whatever survived until it next looked. A remote Run now can therefore succeed
completely and leave no trace DASH can show, and that is not a defect to fix
later — it is the pull model, chosen in ADR 0007 for ADR 0006's reason. The only
available mitigation is that the surface says so before the press, which is why
it is in the copy above rather than in a follow-up.

**Nothing here has reached a host.** The route is admitted; the wiring that
resolves a deployed agent's host and posts to it is not written by this ADR's
session and is named as a follow-up below. `evidence_pulls` still holds one row.

## Alternatives rejected

**Add a `run` verb to `DEPLOY_VERBS`.** The strongest alternative and the one
that looks free: the set is closed, `lib/deploy/verbs.ts` is one file, and
`install`/`start`/`stop`/`status`/`collect` already sit there with `run` looking
like the obvious sixth sibling. Rejected, and the reason is that it would be a
**second way to start a run, weaker than the first**.

A run is not a filesystem act. It is an agent-dom command with an actor, a
nonce, an expiry, a target the host itself published, and a replay record —
adjudicated by `runner/execute.ts` against the host's own store, which is where
the contract puts the obligation and where the threat model's compromised-DASH
entry is answered. The deploy plane has none of that: no envelope, no expiry, no
nonce, no adjudication, and a helper whose whole discipline is that it takes
identifiers and joins them to a root it chose. A `run` verb would reach the same
agent by a path with none of the checks, and the two would drift, and the weaker
one would be the one a future caller reached for because it needed no snapshot.

The deploy plane's own boundary says the same thing from the other side:
`start` runs `node start.mjs` "because the helper decided that, not because a
request said so." A verb that started *an agent's run* would be the helper
deciding something it has no state to decide with.

**Widen the route type to a prefix, a pattern, or a plain string.** Rejected for
the reason `RunnerChannel` takes a route rather than a URL at all:
`${origin}/broker/drain` is a string and types cannot see into it. Any widening
that admits a shape rather than a value returns this module to decoration, and
ADR 0007 amendment 2's table — the one where removing the brand alone goes red
in nothing — is what a shape-based route would quietly reproduce everywhere.

**Have the host's runner poll DASH for pending commands.** A queue the far side
drains, so nothing new is admitted on DASH's side. Rejected: it is the VPS
dialling in, which is the property ADR 0007 exists to keep and which ADR 0006
observed did not exist. It also needs an address on this machine, which is
option 1 of ADR 0007 with its bill and its listener.

**Let the agent's manifest declare a schedule DASH honours.** Rejected on ADR
0006's own analysis of `locations.runtime.kind`: it is the author's claim about
itself, and a person configuring when *their* agent runs is not the author
making a declaration. A schedule DASH executes from a manifest field would also
reset every time the manifest is re-imported, silently, which is the trap
`agent_looks` and `avatar` both have notes about.

**Say nothing about which machine ran a run and let the deploy record imply
it.** What happens today, and ADR 0010 already ruled it out for the sibling
claim. A deploy row is evidence DASH sent bytes on a date. Reading a run's
location out of it would be the present-tense inference that ADR's date exists
to prevent.

## Follow-ups this does not do

- **The wiring is not written.** Resolving a deployed agent's host, building the
  channel and posting the envelope touches `electron/agent-adapters.ts` and
  `electron/ssh-host.ts`, which another session owns while this one runs. The
  route being admitted with no caller is a deliberate half-step and is the
  opposite of ADR 0007 amendment 2's habit of not writing vocabulary ahead of an
  implementation; it is accepted here only because the decision it encodes is
  what this issue was opened to make.
- **Trigger configuration gets its own issue and its own ADR**, and it is
  blocked on restart-on-boot rather than on effort. Both of ADR 0007's open
  follow-ups — restart-on-boot and host retention — are prerequisites rather
  than neighbours.
- **Bringing an agent home is not decided.** Henrik's third friction note —
  disconnect it from the server, copy it and its outputs back down, then decide
  whether to delete it locally — is the symmetric other half of deploy, and it
  interacts with the run-history question finding 26 already sits in. It is not
  this decision's, and it is not smaller than it.
- **Whether a person may stop a run on a host** is not decided. `stop` in the
  deploy plane stops the runner process, which is a different act with a
  different blast radius, and a run-scoped cancel is an agent-dom command with
  the same shape as the one admitted here — which means it is admissible by the
  same test and has simply not been asked for.
- **The deployed agent on 186.240.156.166 stays enrolled.** Nothing in this ADR
  requires re-enrolling a host, re-pinning a key, or re-installing a bundle. The
  route is one the runner already serving that bundle already answers.

## Amendment 1 (MAR-602): the wiring, and the two things it had to widen

Status: Accepted. Date: 2026-08-11.

This ADR's first follow-up said the wiring "is not written by this ADR's session
and is named as a follow-up below". This is that session. Building it found that
the route this ADR admitted **could not be reached**, for two reasons neither the
ADR nor MAR-489 had located — and both are widenings, so both are held to the
same three questions the run route was.

### What was actually blocking, and it was not the route

**`sshHostChannel` took a credential no caller could supply.** ADR 0007 says the
control plane's credential is "that runner's own channel secret". Nothing has
ever minted or exchanged one — `runner/README.md` item 6 has recorded that gap
since May — and this ADR passed over it in one clause: *"the bearer on the
request is the remote runner's own channel secret, which already crosses on
`/telemetry/drain` and every other evidence route."* It does not already cross.
`evidence_pulls` holding one row, `source=local`, is not only because nothing had
ever run on a host; it is also because the remote drain had no bearer to drain
with, and would have answered 401 if it had ever been given a reason to try.

**`sshHostChannel` also passed no bundle id to `connect`.** A host holds many
bundles, one runner each; `connect` joins *one* bundle's socket to stdio. The
helper would have read `argv[1]` as `undefined`, failed `checkDeployRequest`, and
written a refusal into a pipe DASH was about to speak HTTP down. Nothing observed
it, because the function had no caller. That is this ADR's own observation about
the run route — a thing admitted with no caller is a thing nobody has run —
landing one file over, and it is the argument for wiring belonging to a decision
rather than following it.

### Widening 1 — a seventh deploy verb, `channel`

ADR 0007 amendment 3 fixed the set at six and said "no more". It is seven now.

| question | answer |
| --- | --- |
| Carries a credential? | **Yes**, host to DASH, and it is the only member of either plane that does |
| Chooses what, or which? | Neither. It reads one file under a root the helper chose |
| Can DASH describe it honestly? | It never reaches a surface; the promise is that it is never stored |

The first answer is the one that had to be argued rather than counted, so it is
argued. The value is **not a user's credential and not a brokered one**: it is a
secret the host's own runner minted for itself, whose whole authority is over
that runner, through a socket only a session `sshd` authenticated can reach. ADR
0006's line is untouched — reaching that runner grants the evidence routes and
the run route and nothing else, because the broker is excluded by the *type* of
the channel the credential is spent on.

**It is not a new capability on the host.** `stop` has read that exact file —
`{bundle}/data/runner.session.key`, MAR-520's record of the secret the runner
actually resolved — since MAR-487, and already authenticates to the runner's own
`POST /shutdown` with it. What is new is returning the value instead of spending
it, to a caller that signed in with the key whose `authorized_keys` line runs
this program and nothing else.

**The rejected alternative was cheaper and worse.** DASH could mint the secret
and ship it in the install payload at `data/runner.key`, needing no new verb at
all. It fails on two counts. `checkDeployRequest` admits exactly `0o644` and
`0o755`, so the credential would land world-readable on a machine whose home
directory ordinarily is — and widening the mode set for one file would be a hole
in a closed set, opened to avoid opening a closed set. And it inverts custody:
the credential stops being the runner's own and becomes one DASH supplied to a
process on a machine it does not administer, which is the third arrangement this
ADR already refused to invent a receipt for.

**DASH does not store it.** No vault entry and no cache: it is fetched per press,
spent, and dropped. `electron/host-run.ts` is where that promise is kept, and
`HostActionResult` has no member it could travel in. Fetching fresh costs one
`ssh` round trip and buys the property that matters — a runner that restarted has
a new secret, and a DASH holding the old one would answer 401 with nothing on
screen able to say why.

### Widening 2 — `GET /agents/{id}` on the remote channel

The run route cannot be composed without it. A run command names *a target the
host's own snapshot published*; `runner/execute.ts` refuses an `unknown_target`,
and this ADR is explicit that "the two stores never consult each other". So the
task id in DASH's store is a fact about the copy on this computer and never one
about the copy on a server.

| question | answer |
| --- | --- |
| Carries a credential? | No. An agent id out, a schema-validated document back |
| Chooses what, or which? | Neither. It is the only admitted route that changes nothing |
| Can DASH describe it honestly? | Yes — and the honest answer is that it must not keep it |

`/agents` — the list — has been on the evidence route set since MAR-484, so this
is one level deeper on a family already crossing. It was absent for the same
reason the run route was: the list is a fixed string and this has a variable
segment, and until `AgentCommandRoute` this module had no shape for a route that
was not a literal. **That is an absence of vocabulary rather than a decision
anybody took**, which is precisely what this ADR says to name rather than
inherit.

The third question produced a refusal worth recording. `agent_dom_state` is keyed
by agent id alone, and a deployed agent has the same id in both places — so
storing a host's snapshot would overwrite this machine's row, with two runners'
clocks fighting through `putAgentDomState`'s ordering guard. The host's snapshot
is therefore **read through and never into** the store: held for the length of one
command and dropped. The day a snapshot carries its machine of origin, that
becomes a storage decision; today it is a refusal.

One smaller consequence, recorded because it is a real hole rather than a shape:
for a state route the path *ends* at the agent, so an `agent_id` of `..`
normalises to `/agents` — a route that exists and answers the whole list.
Nothing escalates, since the same channel may ask for `/agents` directly, but a
caller that asked about one agent and silently received every agent is a caller
whose next line is wrong. The guard that was defensive for the command route is
load-bearing for this one.

### One consequence for the command pipeline, and the path not taken

A remote command is judged against the host's snapshot, so `CommandRuntime` gains
an optional `snapshot` — absent means read the store, and an explicit `null`
means the other machine had nothing to say, which is a rejection rather than a
fallback.

The alternative was a second, thinner path that minted an envelope and posted it
without the audit row, the nonce, the expiry and the idempotency claim. Rejected
for the reason this ADR rejected a `run` verb on the deploy plane: it would be a
second way to start a run, weaker than the first, and **the weaker one would be
the one reaching a machine DASH does not administer.** So the pipeline is
unchanged and only its evidence is substituted. DASH refusing early is a courtesy
that saves a round trip; the host refusing is the decision.

### What the surface does now

The copy this ADR wrote for the wired state is on screen, and the sentence it
replaces — *"DASH cannot start that one yet"* — is gone, because it stopped being
true. The control is a **second named action** per server, beside the first and
never instead of it, so the rule holds: deploying an agent does not change what a
control already on screen does.

### What is proven now, and what `V8` still needs

`tests/host-run-channel.test.ts` drives the **real host helper**, built from the
entry point the standalone artifact ships, against a runner listening on a real
socket: the credential handed back is the one the runner wrote, `connect` carries
its bundle id, the state read returns a task this machine has never seen, and the
posted envelope arrives whole on the host's own disk.
`tests/agent-command.test.ts` proves the snapshot substitution is total in both
directions. And the remote drain finally has something to drain, so an
`evidence_pulls` row with `kind=another_machine` is written for the first time in
this project's history — the row `V9` was blocked on.

**The only variable left is which process is on the other end of the pipe.**
`ssh`, the key, `sshd` and 186.240.156.166 stay unproven and, under ADR 0004,
permanently unprovable by a blocking gate. `V8` is now **performable and not
performed**: it needs one attended press, by Henrik, on the host that is still
enrolled. Nothing here re-enrols a host, re-pins a key, or re-installs a bundle.

### What this still does not do

- **Files do not travel to a server.** The local Run now hands files to the
  runner on this computer first, and there is no path that puts a person's file
  on a host — so the copy over there runs against what was deployed with it. The
  second control has no files step in front of it, and that is a limit rather
  than an oversight.
- **A run in the list still cannot say which machine it happened on.** `runs` has
  no column for it, so the list-level sentence is still the honest form. What
  changed is that its second wording is now reachable, because a server can
  finally become a source.
- **Trigger configuration is untouched**, and still blocked on restart-on-boot.
- **Whether a person may stop a run on a host is still not decided**, and is
  still admissible by the same test.
