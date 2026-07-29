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
| `template/agent.mjs` | The generated agent, copied verbatim. |

## What a person does

```sh
npx create-dash-agent folder-digest
cd folder-digest
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
- **Telemetry v1.** Every run appends events to `runs/events.jsonl` and posts
  them to DASH when this process was given somewhere to post them. The file is
  the primary record on purpose: an agent whose history exists only in whatever
  happened to be listening has no history.
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

## Why the generated project has no dependencies

`npm install` in a scaffold that pulls a tree is a scaffold that can fail on
somebody's corporate network before they have seen anything work. `agent.mjs` is
plain Node in one file, and `scripts/open-in-dash.mjs` is a bundle the scaffolder
copies in, so after `create-dash-agent` itself there is no registry in the path
at all.

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
4. **The generated agent does something deliberately small.** It counts files in
   its own `inbox` and writes a report. It is a working, honest, hostable agent
   with no credentials, which is what a first-run sample has to be — not a
   demonstration of what agents are for.
