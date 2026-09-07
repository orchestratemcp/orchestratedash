# `agent-kit/` — `create-dash-agent`

The one-command path from nothing to an agent running inside DASH.

- **Issue:** MAR-428 (DASH-11b)
- **Consumes:** the handoff contract in [`lib/handoff.ts`](../lib/handoff.ts)
- **Produces:** a project whose `agent.manifest.json` the DASH Runner will start

| File | What it is |
| --- | --- |
| `scaffold.ts` | What a new project contains. Pure — returns files, writes none. |
| `cli.ts` | `create-dash-agent`, minus the process. |
| `open-in-dash.ts` | Writes the handoff and asks the OS to open it. |
| `bin/*.ts` | The two program entry points. Bundled to `dist/`. |
| `template/agent.mjs` | The generated agent's task logic, copied verbatim. |
| `template/dash-agent-sdk.mjs` | The runtime it imports. One file, node builtins only, copied verbatim into every scaffold and into the packaged shell. |

## What a person does

```sh
npx create-dash-agent news-scout
cd news-scout
npm run open-in-dash
```

DASH comes to the front and asks whether to add the agent. Saying yes registers
it, starts it, and leaves it running when the DASH window closes.

There is no manifest to import, no JSON to find, and no file picker anywhere in
that sequence. That is the whole issue.

## What the template wires by default

Three things, because they are the three the runner and the contracts require:

- **Manifest v2** with an Agent DOM block. The runner validates it *before* it
  spawns anything and refuses v1 outright, so a template that generated v1 would
  produce agents that cannot be hosted. The block is deliberately shaped like the
  one MAR-426's `export_build_brief` emits for a runner-hosted agent — same
  runtime class, same control location id, same four commands — so a scaffold and
  a build brief are the same kind of document rather than two dialects.
- **Telemetry v1.** Every run appends events to `runs/events.jsonl` and emits
  them on the runner protocol. The runner buffers them and DASH drains them on
  its existing state poll, with no port, ingest secret or `DASH_*` child
  environment. A remotely hosted process can still post when explicitly given
  the HTTP ingest URL. The file is the primary record on purpose: an agent whose
  history exists only in whatever happened to be listening has no history.
- **The runner protocol.** Newline-delimited JSON over the child's own stdin and
  stdout, answered from the first line. Acknowledgement is not a formality — the
  runner settles an unacknowledged command as *unacknowledged*, so an agent that
  did not answer is reported as not having answered.

It declares `retry`, `pause`, `resume` and `cancel`, and not `approve`, `reject`
or `choose`. It has no approval gates, and a manifest that declared `approve`
anyway would be offering DASH a button with nothing behind it —
[`docs/agent-dom-contract-v2.md`](../docs/agent-dom-contract-v2.md) calls that
out as the failure to avoid: missing controls mean read-only, not inferred
controls.

It declares **no connections**, which is its most useful property: it can be
added and watched working without anybody having a credential to hand.

## The recipe

Since MAR-888 the manifest is not written by this module. `agent-kit/recipe.ts`
holds one `AgentRecipe` — `recipe_version: 1` — and one `planFromRecipe`, and
the three programs that write a DASH agent folder go through it:
`agent-kit/scaffold.ts`, `lib/sample-agent.ts`, and
`tools/dash-mcp/src/scaffold.ts`. Each carries only what actually differs
between the agents it builds: the steps, the sources, the connections, what a
run emits, the permissions it claims and the panel it asks DASH to draw.
Everything the three share — manifest version, safety contract, monitoring,
runtime, trigger, locations, control — is assembled once and is not a choice a
recipe gets to make.

Two properties follow, and they are the reason for the shape.

**Nothing is written by a build that refuses.** `validateRecipe` runs the
recipe's own rules and then puts the manifest it *would* write through
`validateManifest` and `checkManifestConstraints` — DASH's own import verdict —
before `planFromRecipe` returns a single file. It refuses an id that cannot be a
folder name, a relative or traversing directory, a symlinked target, a folder
with somebody's work in it, a write inside DASH's own agents directory, and a
dependency pinned to a range rather than an exact version. Everything is decided
before anything is returned, so there is no state in which half a project exists.

**The definition and the manifest cannot come apart unnoticed.** The recipe is
written into the project as `agent.recipe.json`, and

```sh
npx create-dash-agent --check <folder>
```

reports where a hand-edited manifest disagrees with it. That check earns its
keep because the edited manifest is usually still *valid*: nothing DASH
validates would object to a route with a step the program never runs, and every
run from then on is graded against it as drift. `dash_agent_validate` runs the
same comparison.

## Which files are the author's

A generated project holds two programs and only one of them is yours.

| File | Yours? |
| --- | --- |
| `agent.mjs` | Yes. `runOnce` is the run; everything under it is the task logic. |
| `sources.json` | Yes. What it reads. |
| `evals/` | Yes. Four checks against the real agent; `npm run evals` runs them. |
| `agent.recipe.json` | Yes, carefully. What this agent *is*. The manifest is generated from it. |
| `agent.manifest.json` | No. Generated from the recipe — edit the recipe and build again. |
| `AGENT_BUILDER.md` | Generated. The same table, written for whoever changes the agent next. |
| `dash-agent-sdk.mjs` | No. DASH's runtime, and DASH upgrades it in place, so an edit here is lost on the next upgrade. |
| `scripts/open-in-dash.mjs` | No. A bundle of DASH's own handoff code. |

## The checks a scaffold comes with

`evals/run-evals.mjs` is copied in verbatim and `evals/cases.json` is generated
from the recipe's four acceptance cases. It spawns the real `agent.mjs` the way
the runner does — a child process speaking newline-delimited JSON — and plays
DASH's side: a local HTTP server on `127.0.0.1` serves fixed feed bytes, and
every `broker_request` is answered here rather than by DASH. So a pass says the
program works, not that a double of it works.

The four cases are stage 4's: a normal run, a run with nothing to read, a run
where one source answers with an error, and a run where every brokered request
is refused. The last one also asserts the negative that matters most — that the
agent never asked for an operation its own manifest does not declare.

Node builtins only, no dependency, no network beyond loopback, no model and no
key.

The split is ADR 0034. It is what lets a runtime fix reach an agent somebody
has been editing for months without a merge, and it is why the plumbing is no
longer the first 500 lines of the file you open to change what the agent does.
[`docs/foundation/sdk-upgrades.md`](../docs/foundation/sdk-upgrades.md) has the
versioning rule.

## Why the generated project has no dependencies

`npm install` in a scaffold that pulls a tree is a scaffold that can fail on
somebody's corporate network before they have seen anything work. `agent.mjs`
and `dash-agent-sdk.mjs` are plain Node with node builtins only, and
`scripts/open-in-dash.mjs` is a bundle the scaffolder copies in, so after
`create-dash-agent` itself there is no registry in the path at all.

This is also why the runtime is a file rather than a package. The packaged
sample has it worse than the CLI does: `scripts/build-shell.mjs` copies these
bytes into the shell and `electron/sample-agent.ts` writes them into the user's
Documents folder, with no install step anywhere in that journey and no place to
put one that a person would forgive. `tests/agent-sdk.test.ts` holds the runtime
to builtins so that property cannot be lost in a repository where
`node_modules` is always there.

## Why `open-in-dash` is bundled rather than templated

`scripts/open-in-dash.mjs` is built from `agent-kit/open-in-dash.ts`, which
imports `lib/handoff.ts` — the same module DASH reads handoffs with. Producer and
consumer therefore come out of one compilation of one contract, and cannot
disagree about the shape. A templated copy of the same logic would agree today
and drift on its first edit.

## What it never puts in a handoff

- **No command line in the URL.** The URL names a file and proves the opener
  could read it. A URL is attacker-authored by construction, and registering an
  agent means naming a program to spawn; the two must not meet.
- **No secret, anywhere.** `lib/handoff.ts` refuses a handoff whose environment
  block carries a name that looks like a credential, and refuses `DASH_*`
  outright. A handoff that wants to give an agent a password is a handoff DASH
  will not open.
- **No credential in the nonce.** It is single-use, it expires in 30 minutes, and
  it authorises exactly one thing: showing the user a question. DASH still asks.

## Building it

```sh
pnpm build:agent-kit
```

Writes `agent-kit/dist/`, which is git-ignored like the shell's `dist/`.
`pnpm verify` does not need it — the tests exercise the TypeScript sources — but
actually running `create-dash-agent` does.

To try it without publishing anything:

```sh
pnpm build:agent-kit
node agent-kit/dist/cli.mjs my-first-agent
```

## What this does not do yet

1. **It is not published.** `package.json` says `private: true`, so
   `npx create-dash-agent` off the public registry does not work yet.
   Publishing is a human decision about a name and a namespace, not something
   this issue should have made on anybody's behalf.
2. **One template, one language.** MAR-428's non-goals are explicit about the
   multi-language matrix being out of scope.
3. **No agent builder inside DASH.** Also an explicit non-goal. The Kit is how
   an agent comes into existence; DASH watches and controls it.
4. **The generated agent does something deliberately small, and useful.** It
   reads the public feeds listed in its own `sources.json` and writes a digest
   with a link beside each item. It is a working, honest, hostable agent with no
   credentials — which is what a first-run sample has to be — and, since
   MAR-457, one somebody might actually keep rather than a demonstration of what
   agents are for.
5. **It does not run until asked.** No run at startup and no timer. An agent
   that reaches out to the network the moment it is added has acted before the
   person who added it has seen what it does.
