# MAR-862 handoff — DASH MCP plugin

**Packet:** MAR-862, packet 1 of epic MAR-861. **Session:** Claude Code,
`claude --model opus`, 2026-09-04.
**Branch:** `000henrik/mar-862-dash-mcp-plugin` from `master` at `7f0329e`.
**Lifecycle:** `merged` when the PR is green. **The behavioural proof is now
in** — Henrik pressed Add on 2026-09-04 and the agent is in the installed
fleet; see [The proof](#the-proof-landed-2026-09-04). Promote to `proven` when
the PR merges.

---

## What shipped

A Claude Code plugin at `tools/dash-mcp/`: one skill carrying the recipe, and a
local stdio MCP server exposing three tools that refuse rather than advise.

| Tool | Behaviour |
| -- | -- |
| `dash_agent_scaffold` | Writes the whole folder. Validates the manifest **before** writing anything, so either the folder imports or nothing exists. Validates again from the bytes on disk. |
| `dash_agent_validate` | Runs `validateManifest` + `checkManifestConstraints` and returns each problem with its JSON pointer, the schema constraint at that pointer, and the allowed values. |
| `dash_agent_install` | Validates, writes a single-use `dash-handoff.json`, opens `dash://handoff`. Refuses and writes nothing if the agent would fail validation. |

`docs/adr/0032-a-tool-that-builds-an-agent-stages-it-and-asks.md` records the
decisions. It was written before the code, as the packet required.

### Where I put it, and why

`tools/dash-mcp/` — a new top-level directory.

- Not `lib/` or `electron/`: this is not DASH, it consumes DASH.
- Not `agent-kit/`: that is npm-published as `create-dash-agent` for agent
  authors. A Claude Code plugin is a different artifact with a different
  consumer and a different install path.
- Not `scripts/`: those are repo chores, not a shipped surface.

It is in this repository rather than beside OrchestrateKit-MCP because it
imports DASH's **real** validator rather than a copy. A separate repository
would rebuild the pinned-fixture drift dance that `contract.lock.json` and
`dash:schema:check` already pay for — correct for an advisor that only needs the
schema, wrong for a tool that needs the code.

### Shape

```
tools/dash-mcp/
  .claude-plugin/plugin.json   the plugin ("dash-agent")
  .mcp.json                    spawns node ${CLAUDE_PLUGIN_ROOT}/launch.mjs
  skills/building-a-dash-agent/SKILL.md
  launch.mjs                   committed bootstrapper: rebuild if stale, then run
  build.mjs                    esbuild -> dist/ (gitignored by the repo's dist/ rule)
  src/{server,agent-tools,scaffold,validate,handoff,paths,open-in-dash,main}.ts
  template/{agent.mjs,brief-fingerprint.mjs}
  tests/                       6 files, 91 tests
  README.md
```

### Decisions worth knowing about

**The bundle is built on demand, never committed.** The server needs TypeScript
from `lib/`, so it is bundled by the repo's own esbuild. `launch.mjs` rebuilds
whenever any input is newer than the bundle, using esbuild's metafile as the
input list. A committed bundle would be a copy of the contract with a build date
on it — the exact drift ADR 0032 decision 4 refuses.

**Zero new dependencies.** The MCP stdio protocol is written out (~4 methods).
Adding `@modelcontextprotocol/sdk` would put a package in the installed Electron
app's lock file for a developer tool the app never loads. Nothing in
`pnpm-lock.yaml` changed.

**`dash_agent_install` and the project's own `npm run open-in-dash` are literally
the same code.** Both call `writeHandoff` in `src/handoff.ts`; the CLI is bundled
into every scaffold as `scripts/open-in-dash.mjs`. A tool with a private door the
author does not have is a tool the author has to keep calling.

**The handoff walks the project rather than carrying a fixed file list.** The
Agent Kit's `open-in-dash` carries seven hard-coded paths. My scaffold has a file
that list does not name — `brief-fingerprint.mjs` — so a fixed list would ship an
agent that crashes on its first line. `reports/` and `runs/` are excluded: an
agent's own output is not part of the agent.

### The adjudicable shape, by construction

A scaffolded agent emits **two** artifacts per run: a v1 `digest` (the evidence)
and a v2 `brief` carrying `derived_from` with `artifact_id`, `run_id`,
`item_count` and `items_digest`. Every brief paragraph cites items by
zero-based position.

`template/brief-fingerprint.mjs` mirrors `lib/brief/fingerprint.ts` — it has to,
because the template is a dependency-free `.mjs` that cannot import from `lib/`.
**`tests/fingerprint-mirror.test.ts` pins the two together**, running both over
the same items and comparing the hex, including the cases where two
implementations of "hash a list" usually diverge (separator, absent-vs-empty,
order). ADR 0025 amendment 1 says an unpinned mirror turns every correct brief
into an uncited one, silently.

The manifest's panel binds a `report` section to `artifact_role: "brief"`.
`lib/views/panel.ts:327` resolves a role against `artifact.kind`, so the brief
renders beside the digest rather than nowhere.

---

## What I verified, and how

All commands run from PowerShell in the worktree.

### `pnpm typecheck` — clean

```
> orchestratedash@0.1.1 typecheck
> tsc --noEmit
```

(No output, exit 0.)

### `pnpm vitest run tools/dash-mcp` — 91/91

```
 Test Files  7 passed (7)
      Tests  91 passed (91)
   Duration  2.32s
```

### `pnpm test` (whole repo) — 4991/4991

Run because I touched `tsconfig.json`, and to check my module-scope
`DASH_DATA_DIR` does not leak between workers.

```
 Test Files  265 passed (265)
      Tests  4991 passed | 13 skipped (5004)
   Duration  59.25s
```

### The MCP server over a real pipe

Spawned `launch.mjs` and spoke JSON-RPC to its stdin:

```
initialize -> {"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{"name":"dash","version":"0.1.0"}}
tools -> dash_agent_scaffold, dash_agent_validate, dash_agent_install
```

`notifications/initialized` correctly got no reply.

### Scaffold + validate, through the real protocol, on this machine

Target `C:\Users\henri\Desktop\projekt\MCP\mar862-proof-agent`:

```
--- tools/call id 2 | isError=false ---
{ "ok": true,
  "agent": "mar862-proof-scout",
  "renamed": { "asked": "mar862 Proof Scout", "using": "mar862-proof-scout" },
  "files": ["agent.manifest.json","package.json","agent.mjs","brief-fingerprint.mjs",
            "scripts/open-in-dash.mjs","sources.json","README.md",".gitignore"],
  "manifest_valid": true,
  "emits": ["digest","brief"] }

--- tools/call id 3 | isError=false ---
{ "ok": true, "agent": "mar862-proof-scout", "manifest_version": 2,
  "notes": ["8 text files would be copied into DASH."] }
```

### That agent, actually run, against a live feed

```
[agent] ready, watching 1 sources; waiting to be run
  event  0 run_started
  event  1 step_started (public_feed_fetch)
  event  2 step_started (brief_compose)
  event  3 step_started (local_file_write)
  event  4 run_completed — Read 10 items from 1 of 1 sources.

=== artifact: kind=digest v1 id=digest-4aed3edc-…
    items: 10, sources: ["Hacker News front page=ok"]

=== artifact: kind=brief v2 id=brief-4aed3edc-…
    derived_from: { "artifact_id": "digest-4aed3edc-…",
                    "run_id": "4aed3edc-…",
                    "item_count": 10,
                    "items_digest": "6e8c005f0ac7cfced518069967a9b22d015dfd8882fe74f8f2fb66fc1cad19e2" }
    § What came in      cites 10 items
    § Hacker News front page   cites 10 items
```

The steps emitted are exactly the three the manifest's `planned_route` declares,
in order, so `lib/analyze.ts` reports no drift.

### DASH's own import, run end to end

`tests/import-round-trip.test.ts` calls **`openHandoff`** — the function Electron
main calls when a `dash://handoff` link arrives — with real ports over a scratch
store, and asserts:

- outcome `registered`, `ok: true`, zero validation failures;
- the agent appears in `listAgents()`;
- `agents/<name>/code/agent.mjs` and `code/brief-fingerprint.mjs` are on disk;
- `registration.json` is written as `{command:"node",args:["agent.mjs"],cwd:"code"}`,
  so it is startable;
- the author's own folder is untouched, because DASH takes a copy;
- installing again with nothing changed is accepted and writes nothing.

`runner: null` is passed deliberately — an import that only succeeds when a
runner happens to be up has an undeclared dependency.

### A defect this found in my own code, before it shipped

The first test run failed `refuses a relative directory`. `scaffoldAgent` called
`path.resolve(input.directory)` *before* checking absoluteness, so the check
could never fire — and `path.resolve` resolves against the server's cwd, which is
**the orchestratedash checkout**. A caller passing `my-agent` would have
scaffolded an agent into the repository. The failing run left `relative/path/`
with eight files in the worktree root, which is the hazard made concrete. Fixed
in `src/paths.ts` / `src/agent-tools.ts`: the raw argument is checked before
anything resolves it, in both `scaffoldAgent` and `installAgent`.

---

## The proof, landed 2026-09-04

Henrik added the staged agent through DASH's folder picker. Verified against the
**installed** store, not a scratch one.

The folder DASH wrote for itself, `%APPDATA%\orchestratedash\agents\mar862-proof-scout\`:

```
agent.manifest.json
registration.json
code/agent.mjs
code/brief-fingerprint.mjs
code/package.json
code/sources.json
code/README.md
code/.gitignore
code/scripts/open-in-dash.mjs
code/reports/report-2026-09-04T13-24-08-583Z.md
code/runs/events.jsonl
```

That is the installed shape this packet was briefed against, exactly, plus
`brief-fingerprint.mjs`. `registration.json` is
`{"command":"dash:node","args":["agent.mjs"],"cwd":"code"}` — DASH's own bundled-Node
sentinel, so it is **startable**, not manifest-only.

The stored manifest kept its route and its panel bindings through the import:

```
route       : public_feed_fetch -> brief_compose -> local_file_write
panel roles : brief, digest, digest, metrics
```

And the fleet, read from a WAL-inclusive copy of the live `dash.sqlite`:

```
AGENTS IN THE FLEET:
  - ai-news-scout-4                    | v2 | steps 2
  - ai-news-scout-5                    | v2 | steps 2
  - competitor-scout                   | v2 | steps 6
  - mar862-proof-scout                 | v2 | steps 3   ← this packet
  - synthetic-gmail-meeting-assistant  | v2 | steps 7
```

**Zero validation failures.** A manifest that failed would not have produced a
folder or a row at all.

`listRuns` and the artifact table hold **nothing** for it yet, which is the
correct state: the agent starts idle by design and *Run now* is a press nobody
has made. Pressing it is what would put a rendered brief on the panel beside its
digest — worth doing, and not required by MAR-862's proof line.

---

## What is NOT done

`proven` also requires the PR to merge; it is `MERGEABLE`/`CLEAN` and green, and
merging is Henrik's call. Beyond that:

1. **Nobody has pressed *Run now* on the imported agent.** It starts idle by
   design, so the store holds no runs and no artifacts for it. One press would
   put a rendered brief on the panel beside its digest — the richer screenshot,
   and not something MAR-862's proof line asks for.
2. **`dash://` on this machine belongs to a stale harness**, and starting DASH
   does not reclaim it — finding 1, which turned out to be a live defect in
   `electron/handoff-host.ts` rather than a stale artifact. It did not block the
   proof, because the folder picker is a real import door and is what was used.
   It still breaks every deep link on this machine and **needs its own packet**.

Also not done, and deliberately:

- **No CI step inserted.** None is needed: `tools` was added to `tsconfig.json`'s
  `include`, so CI's existing `pnpm verify` typechecks the package, and Vitest's
  default discovery already picks up `tools/dash-mcp/tests/`. If the orchestrator
  wants a dedicated job, that is an insertion point they own.
- **No `.orchestrate/state.json` entry.** That file is read-only for this packet.
- **Not published to a marketplace.** MAR-862 non-goal.
- **OrchestrateKit-MCP untouched.** No runtime, broker or schema change.

---

## Contradictions and findings

### 1. DASH never claims `dash://` on the launch form a person uses

This started as "the registration is stale". It is worse than that, and the
correction matters, so here is the whole chain.

The registration on this machine is:

```
HKCU:\SOFTWARE\Classes\dash\shell\open\command
  "…\electron.exe" "C:\Users\henri\desktop\projekt\mcp\orchestratedash\dist\google-proof\main.mjs" "%1"
```

`dist/google-proof/main.mjs` is dated **2026-08-07**. My first reading was that
starting DASH would reclaim the scheme — `electron/handoff-host.ts` calls
`app.setAsDefaultProtocolClient` — so I started DASH from Henrik's own
`dash-launcher.cmd` and re-read the key.

**It did not change.** DASH is running and the harness still owns `dash://`.

The reason is in `registerProtocolClient`. For an unpackaged build it guards on
`isAppEntryPoint(process.argv[1])`, and `lib/shell/app-identity.ts` implements
that as `["main.mjs", "main.js"].includes(entryBasename(entry))`. The running
process is:

```
"…\electron.exe"  "C:\Users\henri\Desktop\projekt\MCP\orchestratedash"
```

`argv[1]` is the **app directory**, so `entryBasename` is `orchestratedash`, the
guard is false, and the function returns having logged *"not claiming dash://…
only the app's own entry point may be the handler"*.

That guard is right for the caller it was written against — a smoke harness must
not claim the scheme, which is a defect the docblock says already happened once.
It is wrong here: the app directory is *precisely* how a person launches DASH
(`isAppEntryPoint`'s own docblock says so — "an app directory — `electron .`,
which is how a person launches DASH — is not matched and does not need to be",
true for its MAR-656 name/store caller and false for this one). So on an
unpackaged build, **the one launch form that should claim the scheme is the one
form that never does**, and whatever last wrote the key keeps it. Since 2026-08-07
that has been the google-proof harness.

`app.isPackaged` registers unconditionally, so a packaged install (MAR-424) does
not have this. Every dev-shell install does.

**Consequence beyond this packet:** every `dash://handoff` on this machine —
the Agent Kit's `npm run open-in-dash`, this plugin's `dash_agent_install`, any
deep link — is handed to a month-old proof harness that runs its proofs and
exits. The link appears to do nothing. That is the same failure the docblock
describes as having "silently broke MAR-428's whole zero-file-picker flow until
somebody looked in the registry", reached by a different route.

I did not fix it: `electron/**` and `lib/**` are read-only for this packet, and
re-registering the key by hand is a system setting. **It needs its own packet.**

**It does not block the proof**, because there is a second door — see below.

### 2. The prompt says only the new package, ADR 0032 and the handoff — I touched one more file

`tsconfig.json`: added `"tools"` to `include` (one line). Without it,
`pnpm typecheck` — the verification the prompt itself prescribes — does not see
the package at all, so the gate would have been green and meaningless. Flagging
it rather than hiding it. Nothing else outside `tools/dash-mcp/**` changed;
`pnpm-lock.yaml` and `package.json` are untouched.

### 3. The prompt's installed-folder shape is missing a file

The prompt lists `code/{agent.mjs,package.json,sources.json,scripts/open-in-dash.mjs}`.
The real `competitor-scout` on this machine also has `code/README.md`,
`code/.gitignore` and `code/memory.json`. Nothing depended on the difference, but
the shape is descriptive of what the kit happens to write, not a contract.

### 4. The kit template and this template have diverged

`agent-kit/template/agent.mjs` emits `artifact_version: 1, kind: "digest"` and
stops — it does **not** emit a brief. That is why this packet has its own
template rather than reusing `planScaffold`. Two templates is a real cost;
ADR 0032's "what this does not decide" records it so it is not found as a
surprise. Closing the gap is somebody's later packet.

### 5. A handoff replay is accepted, not refused

I assumed re-opening the same handoff would be refused and wrote a test for it.
It is not: `lib/handoff-flow.ts` treats an identical replay as `ok` and writes
nothing, headline *"…is already in DASH."* The test now asserts what actually
holds. Worth knowing before anybody designs around single-use semantics — the
nonce is proof of possession, not a one-shot token.

---

## The one thing the next session should do first

**File finding 1 as its own packet.** A dev-shell DASH never claims `dash://`,
so every deep link on this machine — the Agent Kit's `open-in-dash`, this
plugin's `dash_agent_install`, any handoff URL — reaches a month-old proof
harness that runs its proofs and exits, and the link appears to do nothing. It
is not this packet's to fix (`electron/**` is read-only here) and it silently
breaks a flow MAR-428 already had to rescue once.

Second, and smaller: press **Run now** on `mar862-proof-scout` in DASH. It has
never run inside DASH — it starts idle by design — and one press puts a rendered
brief on the panel beside its digest, which is the screenshot MAR-863's button
will be built against.
