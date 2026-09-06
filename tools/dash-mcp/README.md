# dash-mcp — a Claude Code plugin that builds DASH agents

A skill carrying the recipe, and a local MCP server carrying **DASH's own
import validator**. Together they let a coding agent build a DASH-shaped agent
that imports first time.

The mechanism, stated plainly: an MCP does not stop Claude making mistakes.
What stops mistakes is handing Claude the same validator DASH runs at import,
**before** the file is written. The old loop was: Claude writes a manifest, the
person imports, DASH refuses, and nobody learns why quickly.

See [ADR 0032](../../docs/adr/0032-a-tool-that-builds-an-agent-stages-it-and-asks.md)
for the decisions and their reasons.

## Installing it

```
/plugin install <path to this repository>/tools/dash-mcp
```

The server is local by nature — it writes files on your computer and opens
DASH — so there is nothing hosted and nothing to sign in to. It runs from this
checkout and builds itself on first use.

## The tools

| Tool | What it does |
| -- | -- |
| `dash_agent_interview` | Asks the person what they want, one or two questions at a time, before anything is built. Reads a detailed opening answer and skips whatever it settled. Names what a DASH agent cannot do, with the nearest thing that works. Holds no credential and calls no model. |
| `dash_agent_plan` | Turns a finished interview into a recap a person can read and the exact `dash_agent_scaffold` arguments behind it. Refuses while anything is unanswered. |
| `dash_agent_scaffold` | Writes the whole folder. Validates the manifest **before** writing anything, so either the folder imports or nothing exists. |
| `dash_agent_validate` | Runs `validateManifest` + `checkManifestConstraints` and returns each problem with the JSON pointer, the constraint at it, and the allowed values. |
| `dash_agent_install` | Validates, writes a single-use handoff, and opens DASH. **DASH asks the person**; this tool cannot answer for them. |

All of them refuse rather than advise. A refusal comes back as `isError` with a
`refusal` string and, where there is one, a `problems` array — never prose to
be interpreted.

## The interview

The mechanism that stopped wrong manifests reaching the import dialog does
nothing about the other half of the problem: an agent that imports perfectly
and is not what anybody asked for. "Keep an eye on AI news for me" does not say
which sites, how often, what comes back, or where it lands — and most of what
people assume a DASH agent can do (post to Slack, send email, write a document,
act on their behalf, run every hour) it cannot.

So the server asks. It holds the question order, decides what is still unknown
from what has been answered, and reads a detailed opening answer for whatever it
settles — by written-out rules, never by a model, because a server that
acquired an LLM call would be a connection DASH brokers rather than a tool a
coding agent holds (ADR 0032 decision 7). Anything a sentence says two ways
comes back as ambiguous and is asked.

Every question offers the unsupported answers by name. That is the point of it:
somebody who wanted Slack finds out during the interview, with Discord and the
agent's own page named as what does work, rather than after the agent is
installed and silent.

The draft lives in the author's own project directory
(`<project>/.dash/interview-<id>.json`), never in DASH's data directory, and
passing the id back resumes it.

**Asking for something is not switching it on.** A person who asks for a 7am
daily run gets a manual agent whose recap says the daily time is written down as
what they wanted and is theirs to switch on in DASH after the first run. Nothing
here sets a schedule, connects Discord, posts anywhere, or deploys.

## What it will not do

- **Write inside `<dataDir>/agents/`.** DASH swaps an agent's folder on import
  rather than editing it, so a write there succeeds and is discarded on the
  next import, silently. Every path argument is checked and refused.
- **Install an agent.** It stages a folder and hands DASH a proposal. The
  consent dialog is a person's press.

## What a scaffolded agent is

A manual-run agent that starts idle, publishes one pending task, and emits two
artifacts per run:

- a **`digest`** — the raw roundup, every item keeping its address;
- a **`brief`** — `artifact_version: 2`, a document about that digest whose
  paragraphs cite items by position, carrying `derived_from` with an
  `items_digest` DASH recomputes and checks.

That second document is what makes the output judgeable rather than only
readable, and it is why `brief-fingerprint.mjs` is a separate file marked *do
not edit*: it is the agent's half of one function DASH holds the other half of.
`tests/fingerprint-mirror.test.ts` pins the two together.

It also declares one `model_provider` connection, `optional: true`, so the
person can ask it a question about what it found even though none of its own
steps need a model. That needs no credential to import or run — DASH only
hands it a key when the person presses "Give it to N waiting agents" on
Settings → AI, or connects it on the agent's own row. Pass `model_provider`
(`openrouter`, `anthropic` or `openai`; default `openrouter`) to
`dash_agent_scaffold` to match whichever provider the person already has
connected.

## Layout

```
.claude-plugin/plugin.json   the plugin
.mcp.json                    spawns launch.mjs
skills/building-a-dash-agent/SKILL.md
launch.mjs                   builds if stale, then runs the server
build.mjs                    esbuild -> dist/ (gitignored)
src/
  server.ts       JSON-RPC over stdio; transport only, no policy
  interview.ts    the interview state machine; pure, and holds no model
  agent-tools.ts  the five tools
  scaffold.ts     the file plan
  validate.ts     DASH's verdict, plus the fix for each problem
  handoff.ts      writing dash-handoff.json and opening dash://
  paths.ts        where it may write, and the one place it may not
  open-in-dash.ts bundled into every scaffold as scripts/open-in-dash.mjs
template/
  agent.mjs               the program
  brief-fingerprint.mjs   the mirror; do not edit either copy alone
```

## Working on it

```
pnpm typecheck
pnpm vitest run tools/dash-mcp
node tools/dash-mcp/build.mjs
```

`dist/` is deliberately not committed. This server holds DASH's real validator
rather than a copy, so it is built from the checkout it is started from — a
committed bundle would be a copy of the contract with a build date on it.
`launch.mjs` rebuilds whenever any file the bundle was built from is newer than
the bundle, using esbuild's own metafile as the input list.

To drive it by hand:

```
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node tools/dash-mcp/launch.mjs
```
