# Upgrading an agent's runtime

**Status:** the rule is decided (ADR 0034) and the mechanism is not built.
**Issue:** MAR-887, epic MAR-886.

An agent is two files that change on different schedules. `agent.mjs` is the
author's, and nothing DASH does may overwrite it. `dash-agent-sdk.mjs` is
DASH's, and DASH must be able to replace it — otherwise every runtime fix is
stranded in the templates and reaches only agents somebody creates afterwards.

## The rule

> An upgrade replaces `dash-agent-sdk.mjs` and never touches `agent.mjs`.

That asymmetry is the whole reason the runtime is a separate file rather than
inlined into the program (ADR 0034, "What was rejected"). It is not a
convention to be relaxed later: the moment an upgrade can also rewrite
`agent.mjs`, an author who has been editing their agent for months loses work to
a mechanism that does not understand it, and the loss is silent because the
agent still runs.

## How a version is compared

`dash-agent-sdk.mjs` exports `SDK_VERSION`, a plain `major.minor.patch` string,
pinned by `tests/agent-sdk.test.ts`. DASH ships the same file at
`agent-kit/template/dash-agent-sdk.mjs`, and the packaged shell carries a copy
at `<out>/agent-kit/dash-agent-sdk.mjs` (`scripts/build-shell.mjs`).

A future check compares the two strings and offers a replacement when they
differ. Reading the stored agent's version means reading the string out of a
file rather than importing it: an agent folder is not a module DASH may
evaluate, and importing an agent's code into DASH's own process is the thing
ADR 0008 spent a whole section refusing.

Version meaning, so a future check has something to decide with:

- **patch** — a fix with no change to what the runner sees. Safe to replace
  without asking.
- **minor** — new capability in the runtime; existing calls behave as before. An
  agent that does not use it is unaffected.
- **major** — a change an existing `agent.mjs` could notice. Not replaceable
  without the author, and probably not replaceable at all: at that point the
  honest offer is a new agent rather than a rewritten one.

`PROTOCOL_VERSION` is a different number and moves only with the runner
protocol itself. Telemetry v1 and the artifact contracts are frozen documents;
see ADR 0003.

## What is deliberately not built yet

**The replacement itself.** `lib/sample-refresh.ts` refreshes a *manifest* — it
produces the document DASH's template writes today for an agent that already
exists — and has no hook for replacing a file inside a stored agent folder.
There was no existing mechanism to ride, and inventing one was out of MAR-887's
scope for a specific reason: ADR 0008 says `<dataDir>/agents/<name>/` is
**swapped on import, not edited**, so a write into a stored folder is a write
that the next re-import discards. A runtime upgrade therefore has to be either

1. part of an import — the author re-imports and gets the new runtime with it,
   which is what happens today at no cost and with no new code; or
2. a swap of the whole folder that DASH performs and the person is asked about,
   in DASH's own words, the way every other change to a stored agent is.

Option 2 is the one worth building and it is a packet of its own. Option 1 is
already true, which is why nothing here is urgent.

**A version stamped on telemetry.** `contracts/run-event.schema.json` tolerates
additive fields and `sdk_version` on `run_started` would have fit. It is left
out until something reads it; see ADR 0034.

## What an author needs to know

Written into the scaffolded `README.md` and both templates' headers, in these
words rather than these:

| File | Yours? |
| -- | -- |
| `agent.mjs` | Yes. The run, the tools, what it collects and what it says. |
| `sources.json` | Yes. What it reads. |
| `agent.manifest.json` | Through the generator only — it is what DASH holds the agent to. |
| `dash-agent-sdk.mjs` | No. DASH upgrades it, and an edit here is lost on the next upgrade. |
