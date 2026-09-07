# ADR 0034: A shared agent SDK ships as one file inside the agent folder

**Status:** accepted — MAR-887, stage 1 of MAR-886.
**Date:** 2026-09-07. **Issue:** MAR-887, epic MAR-886.
**Touches:** ADR 0032 (a tool that builds an agent stages it and asks — it
recorded this fork as a later packet's job, and this is that packet), ADR 0008
(the agent folder is the unit of storage and deploy — the SDK is a file in that
unit, which is why an upgrade is a swap rather than an edit), ADR 0002 (the
permission broker — decision 5 draws the line this file must not be mistaken
for), ADR 0003 (artifacts on the runner's own channel), ADR 0025 amendment 1 (a
brief is bound to its evidence by a fingerprint the agent and DASH both
compute).
**Repository:** orchestratedash.

---

## Context

There were two agent runtimes, and they were the same runtime.

`agent-kit/template/agent.mjs` was 1060 lines, of which roughly 520 were
mechanics: the newline-delimited JSON protocol, telemetry v1, the digest
artifact, the broker channel, the browser channel, the command
acknowledgements, the idle-until-asked state machine, and SIGTERM.
`tools/dash-mcp/template/agent.mjs` was 743 lines carrying its own copy of
almost all of that, plus a brief artifact the kit's copy did not have, minus the
broker and browser blocks the kit's copy did. ADR 0032 named the divergence when
it created it and said closing it belonged to a later packet.

The cost of two copies is not duplication. It is that a correction lands in one
of them. `tools/dash-mcp/template/brief-fingerprint.mjs` existed as a separate
file precisely because a drift in a hash function turns every correctly cited
brief into an uncited one, silently — and that file was itself a third copy of
something, mirroring `lib/brief/fingerprint.ts`. The repository already knew what
this failure looks like and had built one guard rail against one instance of it.

MAR-886 stage 1 asks for the extraction and, in the same breath, for the thing
that makes an extraction hard here: *"the installed journey must not require
npm, network installation or an extra Node installation."*

## Decision

**The shared runtime is one self-contained ESM file, `dash-agent-sdk.mjs`, that
ships inside the agent folder beside `agent.mjs` and is imported from it by
relative path. It uses node builtins only and has no package, no version range
and no `node_modules`. `agent-kit/template/dash-agent-sdk.mjs` is the single
source of truth; both scaffolders and the packaged sample write those same
bytes.**

Five consequences follow, and they are the decision as much as the sentence
above is.

1. **The templates keep their definition and their task logic and nothing
   else.** `agent.mjs` is what an author — or a coding agent — edits: what it
   reads, what it collects, what it says about it. Both templates now say so at
   the top, and name the file that is not theirs.

2. **`brief-fingerprint.mjs` is absorbed rather than kept.** Its whole purpose
   was to be a file marked *do not edit* standing next to a file that is
   editable. The runtime is now that file, and it carries the same warning, so a
   second one beside it was one boundary too many for a reader to hold. DASH's
   half stays at `lib/brief/fingerprint.ts` and
   `tools/dash-mcp/tests/fingerprint-mirror.test.ts` still pins the two halves
   against each other — pointed at the runtime's exports now.

3. **Nothing in the protocol changes, and the messages are byte-identical.**
   Same seven telemetry types with `event_version: 1`, the same `seq`/`ts`
   discipline, the same artifact shapes at versions 1 and 2, the same four
   acknowledged commands, the same waiting task with the same `created_at`
   fixed at startup. The one place a shape could have moved — the digest's
   `generated_at`, which one template stamped and the other did not — is
   resolved by stamping it only when the author did not, so both templates emit
   exactly the keys, in exactly the order, they emitted before.

4. **An agent generated before this packet keeps working, untouched.** ADR 0008
   makes the folder the unit and nothing rewrites `agent.mjs` in place, so every
   existing agent is still a monolithic file with no import, spawned by a runner
   that did not change. `tests/legacy-agent.test.ts` spawns those exact bytes
   under a real `Supervisor` and holds them to the same behaviour.

5. **The SDK is not a sandbox and must never be described as one.** It runs
   inside the agent's own process, which has an ordinary network stack and an
   ordinary file system. Enforcement stays where it can actually be enforced:
   the runner spawns and strips the environment, and the broker holds every
   credential and answers with narrow operations (ADR 0002). No provider secret
   reaches an agent to make an example simpler, and no surface built on this
   file may imply that importing it constrains anything.

## Versioning and the upgrade rule

The file exports `SDK_VERSION`. `docs/foundation/sdk-upgrades.md` specifies the
rule this ADR fixes:

> An upgrade replaces `dash-agent-sdk.mjs` and never touches `agent.mjs`.

That asymmetry is the whole reason the split is worth having. A runtime fix can
reach an agent somebody has been editing for months without a merge, and the
author's work cannot be overwritten by a mechanism that does not understand it.
The replacement is **not implemented in this packet** — `lib/sample-refresh.ts`
today refreshes a manifest and has no file-replacement hook to ride, and
inventing one to write into a folder ADR 0008 says is swapped rather than edited
is a decision that deserves its own packet.

## What was rejected

**An npm package.** The obvious shape, and the one that fails at the only place
that matters. `agent-kit/scaffold.ts` writes `dependencies: {}` deliberately:
*"`npm install` in a scaffold that pulls a tree is a scaffold that can fail on
somebody's corporate network before they have seen anything work."* The packaged
sample is worse than that — `scripts/build-shell.mjs` copies the template into
the shell as raw bytes and `electron/sample-agent.ts` writes them into the
user's Documents folder. There is no install step anywhere in that journey and
no place to put one that a person would forgive. A package would also make the
runtime's version a range to resolve rather than a file to compare, which is a
harder question with no better answer.

**Bundling the SDK into `agent.mjs` at scaffold time.** Tempting because it
keeps one file, and it destroys the property the split was for: an agent whose
runtime is inlined cannot be upgraded without rewriting the file the author
owns. It also puts 500 lines of plumbing back in front of whoever opens the
program to change what it does, which is the readability problem this packet
was asked to solve.

**A second copy under `tools/dash-mcp/template/`.** The MCP package already
reads its templates from the checkout at scaffold time, so it reads the kit's
runtime from `agent-kit/template/` and writes those bytes. A copy in its own
template directory would be a fork that looks maintained, and ADR 0032 decision
4 already refuses that shape for the validator: a committed artifact of DASH's
own code is a copy of the contract with a build date on it.

**Stamping `sdk_version` on `run_started`.** `contracts/run-event.schema.json`
tolerates additive fields, so it was available. It is left out: this packet's
whole claim is that the runner sees nothing new, and spending that claim on a
field nothing reads yet is a bad trade. It can be added when something consumes
it.

## Consequences

The Agent Kit template is 554 lines, of which the mechanics are none.
`tools/dash-mcp/template/agent.mjs` is 416, and the difference between the two is
now genuinely the difference between the two agents rather than two transcriptions
of the same plumbing. A correction to the runtime is one edit in one file that
both scaffolders and the packaged sample pick up on their next build.

The new failure this introduces is a missing sibling: `agent.mjs` imports
`./dash-agent-sdk.mjs`, and a copy path that carries one file without the other
produces an agent that is written, imported, registered and dead on its first
line. Three places therefore name both files explicitly rather than globbing —
`AGENT_KIT_PROJECT_FILES` marks the runtime `required`,
`assertSampleTemplatesPresent` checks for it at startup so a packaging mistake
is a crash rather than a broken menu item, and `tests/agent-sdk.test.ts` holds
the file to node builtins only so the no-registry property cannot be lost in a
repository where `node_modules` is always present.
