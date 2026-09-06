---
name: building-a-dash-agent
description: Build an agent that OrchestrateDASH will import and run. Use when the user wants to create, scaffold, fix, or install a DASH agent, when an agent fails to import into DASH, or when editing an agent.manifest.json, agent_dom block, or a DASH agent folder.
---

# Building an agent DASH accepts

DASH runs a **local process** per agent, watches it over a newline-delimited JSON
pipe, and draws a panel the agent declared for itself. An agent is a folder. DASH
takes its own copy of that folder at import.

The `dash` MCP server that ships beside this skill carries **DASH's real
validator** — the same functions DASH runs when a person imports — so a manifest
can be checked before it is written. Use it. Do not hand-write a manifest and
hope.

## The loop

1. **`dash_agent_scaffold`** — writes the whole folder. Prefer this over writing
   files yourself; it validates the manifest before writing anything, so either
   the folder imports or nothing exists.
2. Edit `agent.mjs` and `sources.json` for what this agent actually does.
3. **`dash_agent_validate`** — after any edit to the manifest. It returns the
   JSON pointer, what the schema requires there, and the allowed values.
4. **`dash_agent_install`** — hands DASH the import. DASH asks the person before
   storing anything; you cannot answer for them.

If you are changing a manifest by hand, call `dash_agent_validate` with the
`manifest` argument **before** writing the file. That is the shortest loop:
compose, check, correct, write.

## Four rules that are not negotiable

### Never write into DASH's agents folder

`%APPDATA%/orchestratedash/agents/<name>/` on Windows,
`~/Library/Application Support/orchestratedash/agents/<name>/` on macOS,
`~/.config/orchestratedash/agents/<name>/` on Linux.

DASH **swaps** that folder on import rather than editing it. Anything written
there directly is discarded on the next import: the write succeeds and the
change does not survive, silently. Build in an ordinary project folder and
install. The MCP tools refuse a path inside it.

### An agent starts idle

No run at startup, no timer. An agent that reaches the network the moment it is
added has acted before the person who added it has seen what it does.

It must publish **one pending task** — the scaffold calls it "Waiting to be
run". This is load-bearing, not decoration: a `retry` command has to name a run
or a task, and a freshly added agent has no runs. Without the task there is
nothing for DASH's *Run now* to point at and the agent cannot be started at all.

### `stdout` belongs to the protocol

The agent writes newline-delimited JSON messages on stdout. Anything else is
treated as ordinary logging and forwarded to DASH's log — which is fine — but a
`console.log` of an object with a `type` field is read as a protocol message.
Use the template's `log()`, which prefixes its output.

### Acknowledge every command

A command arriving on stdin gets an `ack` with `ok` and a `detail`. An
unacknowledged command is reported to the user as unacknowledged, not as
success. Refusing (`ok: false`) is a good answer; silence is not.

## The folder

```
<project>/
  agent.manifest.json      what it promises DASH
  agent.mjs                the program; DASH looks for this exact name
  brief-fingerprint.mjs    one half of a function DASH holds the other half of
  sources.json             what it reads
  package.json
  README.md
  scripts/open-in-dash.mjs the author's own install command
```

A folder with no `agent.mjs` still imports — DASH stores it and says plainly
that it cannot run it, writing no registration. That is a real outcome, not an
error, but it is rarely what anybody meant.

## The manifest

Version 2. Required at the top level: `manifest_version`, `agent`,
`planned_route`, `safety_contract`, `monitoring`, `provenance`, `agent_dom`.
Unknown fields are accepted — the contract's rule is that DASH ignores what it
does not understand rather than rejecting the document.

Two things the schema cannot say, checked separately at import:

- `agent.name` must work as a folder name. DASH refuses a name it would have to
  change rather than silently renaming the author's agent.
- A manifest declaring `agent_dom.locations.runtime.kind: "remote"` **and** any
  connection with `ownership: "dash_managed"` is a contradiction and is refused.
  An agent running away from this computer can never reach a connection DASH
  manages for it.

### `planned_route` must match what the program does

DASH grades a run by matching its executed steps to `planned_route` by exact
`component_id`. A route describing an aspiration produces drift findings on a
perfectly correct run — every step reported as unplanned, or a step that never
runs reported as missing. If you add a `step(...)` call to `agent.mjs`, add it
to the route in the same edit, in the same order.

Do not declare a `scheduled_trigger` step on a manual-run agent.

### `agent_dom.panel` is data, never code

A panel is a closed vocabulary DASH renders with its own components: `report`,
`outputs`, `table`, `metrics`, `note`. No component takes a URL, markup, a path,
or an image, and agent-authored code never runs in DASH's renderer.

Bindings name **roles**, and a role resolves against an artifact's own `kind`. A
`report` section with `artifact_role: "brief"` draws the newest `brief`
artifact. A key that names nothing renders as an absent cell rather than an
error, which is what makes a panel safe to declare before the first run.

### Declare only controls you implement

The scaffold declares `retry`, `pause`, `resume`, `cancel` — and deliberately
not `approve`, `reject`, `choose`. Declaring an approval verb with no approval
gate behind it offers DASH a button with nothing under it. Missing controls mean
read-only; they are never inferred.

## The shape that makes output judgeable

This is the part most hand-written agents get wrong, and it is the reason the
scaffold exists.

Every run emits **two** artifacts, never one instead of the other:

- a **`digest`** — the raw roundup. Every item keeps `source_url` / `item_url`,
  the address it came from. This is the evidence, and writing about it must not
  change it.
- a **`brief`** — `artifact_version: 2`, a short document about that digest.
  Each paragraph carries `items`: **zero-based positions into the digest's
  array**, never headlines.

A brief must carry `derived_from`:

```json
{
  "artifact_id": "digest-<run id>",
  "run_id": "<the same run>",
  "item_count": 42,
  "items_digest": "<sha256, lowercase hex>"
}
```

`items_digest` is SHA-256 over a canonical rendering of the digest's items in
order — `JSON.stringify(items.map(i => [i.headline, i.source_url ?? null,
i.item_url ?? null]))`. DASH recomputes it from the digest it holds. **On a
mismatch it draws the brief with no citations at all**, because a real link
under a claim it does not support is worse than no link.

That is why `brief-fingerprint.mjs` is a separate file the scaffold marks *do
not edit*: it is one half of a function DASH holds the other half of, and a
drift between them turns every correct brief into an uncited one — silently, and
on screen it looks like a model that forgot to cite.

Fingerprint the array you actually sent. Recomputing the items from a second
read of the same sources produces a different list and fails the join for a
reason nobody can see.

A paragraph with no `items` is legitimate — it means prose written without
naming a source, and DASH marks it rather than dropping it. Citing unrelated
items to look well-sourced is the failure the whole design exists to prevent.

Brief prose carries **no links**. A paragraph containing anything address-shaped
is dropped whole rather than cleaned. The addresses live on the digest's items,
where DASH renders them as real links.

## Credentials

An agent never holds one. It asks DASH to perform a named operation on a
connection the user set up, and DASH holds the sign-in and performs it. The most
a compromised agent can do is ask for an operation on a list and be refused for
anything else.

`dash_agent_scaffold` always declares one connection, `model_provider`, so the
agent can be asked a question about what it found even though its own steps
never use a model. It is `optional: true` and needs no credential to be added
and watched working: nothing DASH does with a fresh scaffold depends on a key
existing. What the connection buys is somewhere for a key to go. When the
person has already connected a provider under DASH → Settings → AI, pressing
"Give it to N waiting agents" there hands this agent that key with no further
setup — that is the fleet adoption ADR 0013 describes, not something this tool
does itself. Connecting it on the agent's own row works the same way. Pass
`model_provider` (`openrouter`, `anthropic` or `openai`; defaults to
`openrouter`) to match whichever the person already has, so the same key
covers this agent too.

## When an import fails

Call `dash_agent_validate`. It returns DASH's own words plus, per problem, the
pointer and the constraint at it. Fix the pointer it names; do not guess from
the headline.

If validation passes but the agent does not appear, the failure is after
validation — the person declined the dialog, or DASH is not running. The handoff
link expires; run `dash_agent_install` again.
