# ADR 0032: A tool that builds an agent stages it and asks, and it holds DASH's own validator rather than a description of it

**Status:** accepted — MAR-862, packet 1 of MAR-861.
**Date:** 2026-09-04. **Issue:** MAR-862, epic MAR-861.
**Touches:** ADR 0008 (a folder is swapped, not edited — this is the rule read
from the outside, by a writer that is not DASH), ADR 0003 (manual-first agents —
a scaffolded agent starts idle and this ADR keeps it that way), ADR 0025 +
amendment 1 (a brief is a document bound to its evidence — decision 6 makes the
scaffold emit one by construction), ADR 0027 (only a blessed checkout may open
the installed store — decision 3 is the same boundary honoured by a tool that
never opens it at all), ADR 0020 (an MCP server is a connection DASH brokers —
this is **not** one of those, and decision 7 says why).
**Repository:** orchestratedash.

---

## Context

Henrik, 2026-09-04: *"the 'new' mcp is to make claude build it for dash seamless
and without fault … we have a mcp that cant confuse or make mistakes."*

The loop being replaced is four steps long and only the last one teaches
anything. A coding agent writes `agent.manifest.json` from whatever it inferred
about the shape; the person imports it; DASH refuses; and the reason arrives in
a dialog, minutes later, in a different application, to a person who did not
write the file. Every correction costs a round trip through a human being.

The Agent Kit already recorded the same lesson once, and the memory of it is
blunt: *the kit checked nothing, and a copy edit broke a handoff.* A template
that is merely correct on the day it is written is not a mechanism. What makes a
mistake impossible is not advice about the shape — it is **the same validator
DASH runs at import, in the writer's hands, before the file is written**.

### The thing that must not be built

There is an obvious wrong version of this tool, and it is obvious because it is
easier: a server that carries its own idea of the manifest — a copy of the
schema, a transcription of the rules, a prose description of the folder — and
advises. That tool is correct exactly until `contracts/` changes, and its
failure mode is silent: it keeps giving confident answers about a shape that has
moved. OrchestrateKit-MCP already pays for that drift deliberately and visibly,
with `contract.lock.json` and a `dash:schema:check` gate, because it is a hosted
advisor that only ever needed the schema. This tool needs the **code** — the
version dispatch in `validateManifest`, the constraints in
`checkManifestConstraints` that no schema can express, the plain-language layer
in `explainImportFailure` — and code cannot be pinned across a repository
boundary the way a schema can.

That is the whole reason this package lives in `orchestratedash` rather than
beside the advisor.

### The trap that is specific to this repository

ADR 0008's folder discipline is written for DASH's own code, and read from the
outside it says something a well-meaning tool would get wrong on the first
attempt. `<dataDir>/agents/<name>/` is **swapped** on import, not edited.
A tool that helpfully wrote a corrected manifest straight into the installed
folder would appear to work — the file is there, the agent is on screen — and
would lose the edit silently on the next re-import, with nothing anywhere saying
why. It is the worst class of defect this codebase collects: a write that
succeeds and a change that does not survive.

---

## Decisions

### 1. The tool stages, and DASH imports. It never writes inside the agents root

Everything the tool writes goes to a directory the **author** named: an ordinary
project folder on their disk, outside DASH's data directory. Nothing the tool
writes is ever the installed copy.

The refusal is at the tool boundary and it is a refusal rather than a redirect.
Every path argument is resolved and checked for containment in
`agentsRoot(dashDataDir())`; a target inside it is refused with the reason, and
no fallback location is chosen on the author's behalf. Picking a different
directory silently would be answering a question the author asked badly, and the
author is a coding agent that will repeat the mistake next time.

Knowing where the agents root *is* exists solely to stay out of it. The tool
never opens `dash.sqlite`, never reads a registration, never lists what is
installed. ADR 0027 draws that line for a checkout; this package is on the
outside of it by construction, and the only fact it takes from DASH's data
directory is its own address, so it can avoid it.

### 2. The import is the door that already exists

`dash_agent_install` does not invent a fourth way into DASH. It writes
`dash-handoff.json` into the staged project and opens the `dash://handoff` URL —
`lib/handoff.ts`'s document, built by `lib/handoff.ts`'s own `buildHandoff`,
with a nonce minted per install.

This matters more than reuse. The handoff ends where the other two doors end: at
`importManifest`, behind the consent dialog every import passes through. **The
tool cannot install an agent.** It can only put a proposal in front of the
person, who is asked, in DASH's words, before anything is stored. A tool built
to make a coding agent's output land reliably must not also make it land
unasked, and the nonce keeps the meaning `lib/handoff.ts` gives it — proof the
opener could read a file on this disk, authorising a question and nothing else.

### 3. The server is local, by nature rather than by preference

It writes files on the author's computer and opens a URL on the author's
desktop. A hosted server can do neither. There is no Cloudflare worker, no
container, and no remote endpoint anywhere in this package, and OrchestrateKit-MCP
stays hosted and untouched.

### 4. The validator is imported, never described

`dash_agent_validate` calls `validateManifest`, `checkManifestConstraints` and
`explainImportFailure` — the functions, in `lib/`, that DASH itself runs. The
package holds no schema copy, no second version-dispatch, and no independent
list of what a manifest requires.

The mechanical consequence is the point: when `contracts/` changes, the tool
changes with it, in the same commit, checked by the same `pnpm verify`. There is
no version to bump and no lock file to reconcile, because there is no boundary
for drift to cross.

Reaching TypeScript in `lib/` from a server a plugin spawns needs a bundle, and
the bundle is built **on demand at launch** by the repository's own esbuild,
never committed. A stale artifact of DASH's validator sitting in the tree would
reintroduce, as a build product, exactly the copy this decision refuses.

### 5. The tools refuse rather than advise, and a refusal carries the fix

Each of the three tools returns a verdict, not a discussion. `scaffold` writes
the whole folder and then validates its own output before reporting success;
`validate` returns the errors with `explainImportFailure`'s account attached;
`install` refuses outright on anything that would not import, and writes no
handoff.

The fix travels as data — the JSON pointer, what is wrong there, and what DASH
says about it — rather than as a sentence to be re-read. And it is DASH's own
sentence: the writer is told, before writing, the same thing the dialog would
have told the person afterwards.

### 6. A scaffolded agent emits the adjudicable shape by construction

The scaffold's `agent.mjs` emits a `digest` and then a `brief` — artifact v2,
with `derived_from` carrying `artifact_id`, `run_id`, `item_count` and
`items_digest`. An agent built by this plugin is therefore adjudication-ready on
its first run, rather than after somebody remembers to make it so.

ADR 0025 amendment 1 names the cost of getting the fingerprint wrong precisely:
*a drift between the two ends turns every correct brief into an uncited one*,
which fails silently and looks like a model that forgot to cite. So the template's
canonicalisation is a **mirror** of `lib/brief/fingerprint.ts` and is pinned by a
test that runs both over the same items and compares the hex. The mirror is
unavoidable — the template is a dependency-free `.mjs` an author owns and edits,
and it cannot import from `lib/` — but an unpinned mirror is what amendment 1
warns about, and a pinned one cannot drift without a red test.

### 7. This is a tool a coding agent holds, not a connection DASH brokers

ADR 0020 governs MCP servers DASH reaches on an agent's behalf, through the
broker, with the user's credentials. This is the other direction entirely: a
server **Claude Code** spawns, on the author's own machine, holding no
credential, reaching no provider, and spending nothing. It never appears on the
Connections page and it must never acquire a capability that would put it there.

### 8. Zero dependencies, and the protocol is written out

The stdio half is newline-delimited JSON-RPC 2.0 over the process's own stdin
and stdout — four methods — and it is implemented in this package rather than
pulled from an SDK.

This is not asceticism. Adding `@modelcontextprotocol/sdk` to DASH's dependency
tree puts a package in the installed Electron application's lock file for the
benefit of a developer tool the application never loads, and the repository is
already fluent in exactly this protocol shape: the runner speaks NDJSON to every
agent it spawns, and the agent template answers it in about forty lines. The
same argument the Agent Kit makes for a scaffold with no dependencies —
*"`npm install` in a scaffold that pulls a tree is a scaffold that can fail on
somebody's corporate network before they have seen anything work"* — applies to
a plugin somebody installs to fix a problem they are already having.

---

## What this ADR does not decide

- **Publishing the plugin.** It is installed from this repository's path. A
  marketplace entry is a distribution decision with its own versioning question,
  and MAR-862's non-goals put it out of scope.
- **Whether the Agent Kit's own template should emit a brief.** It emits a v1
  digest today. Changing it is a change to `agent-kit/`, which this packet does
  not own, and the two templates diverging is a real cost somebody should
  eventually pay down — recorded here so it is not discovered as a surprise.
- **A second language.** One template, Node, for the same reason the Agent Kit
  gives: the runner's requirements shape it, not a language ecosystem's
  preferences.
- **Anything about the runtime, the broker, or a schema.** Nothing in this
  package changes what DASH accepts. It changes only *when* an author finds out.

---

## Consequences

**A wrong manifest stops reaching the import dialog.** The validator runs in the
writer's process, before the write, so the failure a person used to see in DASH
is now a refusal in the session that caused it, attached to the file that caused
it.

**The tool is only as current as the checkout it runs from.** That is the trade
decision 4 makes deliberately: correctness is tied to a working tree instead of
to a pinned artifact, and a plugin pointed at a stale checkout will validate
against a stale contract. It is the better failure — visible, local, and fixed
by `git pull` — than an advisor drifting quietly against a schema it copied.

**A scaffolded agent runs nothing until it is asked.** ADR 0003's manual-first
rule survives the new door: the template starts idle and publishes one pending
task, which is what `Run now` targets and, per `agent-command.schema.json`, what
makes a freshly added agent startable at all.

**The staging directory is the author's, and it stays theirs.** DASH takes a
copy at import and never moves or claims the original, so the folder a coding
agent built remains an ordinary project it can keep editing — which is the
workflow the tool exists to serve.
