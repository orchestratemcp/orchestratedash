# ADR 0017: DASH does not remove what it could not copy

Status: Accepted

Date: 2026-08-11

Amends: ADR 0007 (the deploy transport), under the admission questions ADR 0014 established

## Decision

Five things.

1. **Deploy gains its symmetric other half.** DASH can put an agent on a host,
   start it, ask what is there, and read evidence back; `bringAgentHome`
   (`lib/deploy/bring-home.ts`) is the first thing that can take the agent off
   again. The sequence is fixed and one-directional: **copy, then remove, never
   the reverse.** A failure at any stage before the removal call changes nothing
   on the server, and the outcome names which stage stopped it — `nothing_there`,
   `could_not_start`, `could_not_sign_in`, `could_not_read`, `outputs_left_behind`,
   `cancelled`, `could_not_save`, `would_not_stop`, `helper_too_old`,
   `could_not_remove` — rather than collapsing them into one refusal.
2. **Two widenings, both held to the same three questions ADR 0014 used to admit
   `channel` and the agent-state route:** does it carry a credential, does it
   choose *what* or *which*, and can DASH describe it honestly.
   - An eighth deploy verb, `uninstall`. `install` has removed a bundle directory
     since MAR-487, so the capability already existed; what is new is reaching it
     without writing anything back.
   - A third route family on the runner channel, `ArtifactBytesRoute`
     (`GET /artifacts/{id}/download`), carrying the bytes of one output rather
     than its index.
3. **`agent_deploys` gains a second date rather than losing its row.** ADR
   0010's rule is that the table holds DASH's memory of its own acts, and taking
   an agent back is one of those acts, not an erasure of the one that put it
   there. `brought_home_at` sits beside `sent_at`; the row is never deleted.
4. **Outputs that were on the server get a sixth `ArtifactAvailability` state,
   `brought_home`, written by DASH rather than by a runner.** It is deliberately
   not `deleted`: DASH removed the server's copy on purpose, and the second copy
   landing on this computer is the entire point of the act — `deleted`'s copy
   ("somebody removed it on purpose") reads as a loss when this is the opposite.
5. **Bring-home does not touch this computer.** No local file, run, or agent
   record changes. Taking an agent off a server and destroying an agent are kept
   as two separate presses.

## The problem this was written to solve

Deploy has been one-way since MAR-487. `host.forget` removes DASH's key and
label for a host and leaves the bundle running on a machine DASH can no longer
name — the agent is not brought back, and nothing it produced there comes home.

Henrik's own words on the issue are also the shape of the feature:

> *"If an agent lives on VPS - It should disconnect and delete/copy down to the
> local file (say it has some output that its nice it follows "home"). Then if
> you still want to delete the agent you delete it locally. So it lives on the
> VPS but can move home ;p"*

Two decisions are already inside that sentence: bring the files home before
anything is removed, and keep "take it off the server" separate from "delete
it here."

## The one rule the whole feature is built on

> **DASH does not remove what it could not copy.**

Every branch in `bringAgentHome` is that sentence, enforced in two places that
can each see one half of it. `lib/deploy/bring-home.ts` orders the sequence and
refuses the removal call when any earlier stage failed. The host helper
(`scripts/host-helper/main.ts`) independently refuses to remove a bundle whose
runner is still running, because it owns the filesystem on that machine and a
directory deleted under a live process is the quiet version of the force-kill
`AGENTS.md` forbids.

The bundle directory holds the runner's own store — the host's entire account
of what that agent did there — so the two possible orderings are not symmetric
failures:

- **Remove-then-copy** loses somebody's evidence permanently, on a machine DASH
  was still mid-conversation with.
- **Copy-then-remove**, when the copy fails, leaves the agent exactly where it
  was: a state recoverable by pressing the same control again.

Only the second is a state a person can walk back from, so it is the only order
this file performs. Stage 4 (stop, then `uninstall`) is the one point that
destroys anything, and everything above it in `bringAgentHome` is a `return`
that is also a promise the server is untouched.

## Why `lib/deploy/bring-home.ts` has no `ssh` in it

Every step — `connect`, `start`, `stop`, `uninstall`, `pull`, `fetch`, `save`,
`wait` — is injected through `BringHomeSteps`. This is `lib/deploy/verbs.ts`'s
own split, for the same reason: everything decided in the sequencing file is
decided on the *answers* those steps return, so CI runs the whole sequence —
including every order it refuses to perform — on a machine with no host, no
key, and no network. `electron/host-bring-home.ts` supplies the real steps
(`ssh`, the dialog, the store writes); `tests/bring-home.test.ts` supplies ones
that record what they were asked to do and in what order.

## The credential promise, unchanged

`electron/host-run.ts` states it for `host.run` and `electron/host-bring-home.ts`
keeps it identically for `host.bringHome`: **DASH asks for the credential,
spends it, and drops it.** No vault entry, no module-level cache, nothing
returned from the host layer that could carry it — `HostActionResult` has no
member it would fit in. A bring-home fetches the runner's session credential
once, through the `channel` verb, and holds it in a local variable for the
length of the sequence — longer than a run press, but still one function's
stack frame.

`openWithRetry` in `lib/deploy/bring-home.ts` re-dials rather than sleeping
through a fixed delay: a runner that has just been started answers as soon as
the host has a pid, and writes `runner.json` and its session key a moment
later. Only `no_channel_credential` is retried — every other refusal names a
state that waiting cannot change.

## Widening 1 — the `uninstall` deploy verb

| question | answer |
| --- | --- |
| Carries a credential? | No |
| Chooses what, or which? | Neither — it takes a `bundle_id` and nothing else |
| Can DASH describe it honestly? | Yes: "take this bundle off this server" |

`lib/deploy/verbs.ts` keeps every verb's arguments off `ssh`'s argv, on a
closed array (`DEPLOY_VERBS`) a reader can count — adding `uninstall` is a
change to that array and to the argument type derived from it, in one file,
reviewed as a widening rather than assembled from a general shell.
`scripts/host-helper/main.ts` answers it by taking one bundle off the machine
it runs on, after checking the bundle's own runner is not running.

## Widening 2 — artifact bytes on the runner channel

`lib/agent-dom/evidence.ts`'s drains bring home what an agent *did* —
telemetry, digests, and the runner's *index* of its file-backed outputs
(`workspace_artifacts`). None of the three is a file: the index carries a name,
a size, and a digest, and the bytes stay wherever the runner put them.

On this machine that gap is invisible — `workspaceDownload` reaches the local
runner over its own socket the moment somebody presses Save. On a host it is
the whole problem: the file exists only there, and bringing an agent home
removes the bundle that holds it. A bring-home that copied only the index would
leave the Outputs panel listing files that no longer exist anywhere.

| question | answer |
| --- | --- |
| Carries a credential? | No — an artifact id out, bytes back, over the same channel already admitted |
| Chooses what, or which? | Neither. `ArtifactBytesRoute` names one file already listed in the runner's own index |
| Can DASH describe it honestly? | Yes, and precisely: "what that server still had when DASH looked" |

`lib/agent-dom/artifact-bytes.ts` is not `workspaceDownload` generalised, even
though it is close. `workspaceDownload` is one file, chosen by a person, saved
where they point, on a press they can repeat. `fetchArtifacts` is every file a
runner still has, fetched because the bundle holding them is about to be
destroyed, with no second chance — so the two want opposite failure behaviour.
A download that fails is a sentence and a shrug; a copy that fails here must
stop the removal (`outputs_left_behind`, Stage 3 in `bringAgentHome`). Each
file is capped at `MAX_ARTIFACT_BYTES` (32 MB) and the batch verdict is
all-or-nothing: one file DASH could not take off the server is enough to stop
everything, deliberately not a warning a person could click past.

`fetchArtifacts` returns bytes and lets the caller decide where they land —
`electron/host-bring-home.ts` asks the user, once, for one folder for the whole
batch, through the operating system's own dialog, and this module never learns
the answer. It also does not re-verify the digest the index already carries:
checking `sha256` here would be checking a runner's claim against that same
runner's bytes, a check that cannot fail in the way it is meant to catch.

`RemoteRunnerChannel` is `RunnerChannel<EvidenceRoute | AgentCommandRoute |
AgentStateRoute | ArtifactBytesRoute>` — still, deliberately, missing
`BrokerRoute`. `ArtifactBytesRoute` joined the same allowlist `EvidenceRoute`
did, under the same type-level exclusion ADR 0006 and ADR 0007 describe: a
broker-capable channel is a different TypeScript type, built on a different
transport (`ipcFetch`, a `socketPath`, no host in it and no route to a
network), so `channel.call("/broker/drain")` inside this file is a compile
error rather than a policy somebody has to remember.

## What the store records, and the tense it stays inside

Two writes, both after the removal succeeds, both about **DASH's own act**
rather than a claim about the server's present state — the bound ADR 0010 and
ADR 0015 already set, unchanged here:

- `recordAgentBroughtHome` sets `agent_deploys.brought_home_at`. The row is not
  deleted, mirroring ADR 0010's rule that the table is DASH's memory of what it
  sent, never a live mirror of what is running.
- `markArtifactsBroughtHome` sets `workspace_artifacts.availability =
  'brought_home'` for every id the pull's own index named as `available` on that
  machine. `deleted` was the near-miss candidate and its copy is wrong in both
  directions here: DASH removed the file, on purpose, and the second copy
  landing on this computer is the entire point — the opposite of what `deleted`
  says.

`recordEvidencePull` is written whether or not the sequence went on to remove
anything, and after the sequence rather than inside it: a bring-home that
reached the pull and then stopped has still looked, and the pull is the record
of the looking — the same argument `electron/host-run.ts` makes for writing
"when DASH last looked" even when the answer is boring.

## The disclosure

`lib/copy/bring-home.ts` splits fact from words for the reason
`lib/copy/evidence.ts` already established: the sequence has many distinct
ways to stop, each meaning a different next step for the person, and a
function that composed its own sentences inline would be a file where a change
to a rule and a change to a word look identical in a diff.

`describeBringHome` is the disclosure — what goes on screen *beside the
control*, before it is pressed, per ADR 0007 amendment 2 ("a disclosure that
arrives after the act has told them nothing"). It names the three things a
person cannot undo by pressing again: the agent leaves the server, DASH will
ask where the files go, and nothing on this computer is deleted. The third is
the sentence Henrik asked for in so many words, and it is what makes the
two-step visible instead of merely true.

`describeBringHomeOutcome` renders every `BringHomeStop` through an exhaustive
switch, so a new stop with no sentence is a compile error rather than a case
that silently renders empty text. The success sentence says *what that server
still had when DASH looked*, never *everything it produced* — ADR 0007's pull
cost means a host's evidence buffer is bounded and DASH has never been in a
position to claim otherwise.

## `helper_too_old`, and why it is its own stop

A host enrolled before MAR-611 answers `unknown_verb` to `uninstall` forever,
until its setup step is re-run — the helper is installed once, with its verb
set embedded in its own bytes. This is given a stop of its own rather than
folded into `could_not_remove` because it has a precise, performable exit
(`could_not_remove` does not), and a generic "the server would not remove it"
would send somebody looking at their server for a fault that is DASH's own
version skew. This is `runner/execute.ts`'s argument against collapsing
refusals, on the one refusal that would waste the most of somebody's evening.

## What this deliberately does not do

- **Delete nothing on this computer.** The agent, its folder, its runs, and its
  outputs all stay. Removing the local agent is `removeAgent`'s, from the
  agent's own page, afterwards — MAR-604 still owns that decision and this ADR
  does not touch it.
- **Bring the agent's own bundle files down.** `agent_deploys` already holds the
  digest of what was sent, so a copy pulled back would be older-or-equal by
  construction; writing it over the local folder would be a silent downgrade
  nobody asked for.
- **Reconstruct an agent DASH does not hold.** A host may name a bundle DASH
  never sent — ADR 0015 permits exactly that sentence — and
  `bringAgentHomeFromHost` refuses before starting anything when the agent is
  not present locally. Adopting a stranger's agent off a server is a different
  feature with a different verb.
- **Pool connections.** Six or more `ssh` children per press, because ADR 0007
  already decided one connection per request and declined a pool. Bring-home is
  the slowest thing DASH does to a host, and also the one thing nobody does
  twice a day.
- **Decide a restart or removal policy for the local run history.** Untouched;
  a bring-home only ever adds to it.

## Alternatives rejected

- **A single generic refusal for every stop.** Rejected for the same reason
  `runner/execute.ts` keeps its own refusals apart: collapsing distinct
  failures into one sentence sends a person to the wrong end of their own
  problem, and `outputs_left_behind` specifically owes them the names of the
  files still stranded rather than a generic "some files could not be copied."
- **Ship the runner's session credential in the install payload instead of a
  `channel` verb.** Rejected in ADR 0014 already, for the same shape this ADR
  reuses: `checkDeployRequest`'s mode allowlist has no slot for a
  world-readable exception, and it inverts custody of a secret that belongs to
  the runner, not to DASH.
- **A dialog per file instead of one folder for the batch.** Rejected: a
  bring-home of a dozen outputs is one decision that was already made by
  pressing Bring Home, and asking it twelve more times would not be safety, it
  would be friction standing in for a decision already taken.
- **Verify each artifact's digest against the index on receipt.** Rejected: the
  index and the bytes come from the same runner, so the check could only ever
  confirm a runner did not corrupt its own claim about itself — not the kind of
  independent check `install`'s re-hash performs against a sender DASH does not
  control.
- **Have bring-home also remove the local agent.** Rejected directly by Henrik's
  own framing of the issue: *stop hosting this* and *destroy this* are
  different decisions, and collapsing them into one press removes the
  reversibility that makes the first one safe to press at all.
