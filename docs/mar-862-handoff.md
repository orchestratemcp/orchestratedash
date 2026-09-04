# MAR-862 handoff — DASH MCP plugin

**Packet:** MAR-862, packet 1 of epic MAR-861. **Session:** Claude Code,
`claude --model opus`, 2026-09-04.
**Branch:** `000henrik/mar-862-dash-mcp-plugin` from `master` at `7f0329e`.
**Lifecycle:** `merged` when the PR is green. **Not `proven`** — see
[What is not done](#what-is-not-done).

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

## What is NOT done

**The packet stays at `merged`, not `proven`.** `proven` requires a fresh agent
importing into the **installed** DASH build and appearing in the fleet. I got
everything except the last two steps:

1. **The consent dialog is a person's press.** `dash_agent_install` opens
   `dash://` and DASH asks. I did not and will not answer that for Henrik.
2. **`dash://` on this machine is registered to something else.** See the
   contradiction below.

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

### 1. `dash://` is registered to a stale google-proof harness — blocks the proof

```
HKCU:\SOFTWARE\Classes\dash\shell\open\command
  "…\electron.exe" "C:\Users\henri\desktop\projekt\mcp\orchestratedash\dist\google-proof\main.mjs" "%1"
```

`dist/google-proof/main.mjs` is dated **2026-08-07**. So on this machine today, a
`dash://handoff` URL is handed to a month-old proof harness rather than to DASH.
I did **not** re-register it — that is a system setting.

It is self-healing: `electron/handoff-host.ts:85` calls
`app.setAsDefaultProtocolClient(HANDOFF_SCHEME)` at startup, so **starting DASH
once reclaims the scheme**, and the install then works. This is the same family
as the recorded "orphan google-proof runner blocks verify:shell" finding, one
registry key over.

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

**Start DASH once, then run `dash_agent_install` on
`C:\Users\henri\Desktop\projekt\MCP\mar862-proof-agent` and press Add.**

Starting DASH reclaims `dash://` from the google-proof harness (finding 1). The
folder is already scaffolded, validated and staged. That single press is the
whole remaining distance between `merged` and `proven` — screenshot the imported
agent in the fleet, with its brief section on the panel, and the packet closes.
