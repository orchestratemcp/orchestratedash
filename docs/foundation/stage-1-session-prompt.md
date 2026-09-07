# Lane F1 — MAR-887: extract the agent runtime into a shared SDK file, preserving behaviour

Tier: Opus (a runtime seam across two templates, the packaged sample and the
runner protocol; behaviour must not change). Read `ux-lanes-common.md`
beside this file first — its hard rules apply (never the real store, never
`pnpm verify`, never force-kill Electron, append-only `globals.css`, no
Linear posts). Two differences: the base branch is `codex/agent-foundation`
(not master) and you MAY add one ADR, number assigned below.

Worktree: `C:\Users\henri\AppData\Local\Temp\wt-f1-s1`
Branch: `000henrik/mar-887-agent-sdk` (from `codex/agent-foundation`, which is
master `cb2cb1c` + two bookkeeping commits). PR targets `master`.
Issue: MAR-887 (epic MAR-886). Plan: read
`C:\Users\henri\Documents\DASH-agent-foundation-claude-plan.md` "Etapp 1" and
"Arkitektur och gränser" (Swedish; the acceptance is repeated below).

## Ground truth (orchestrator-mapped 2026-09-07; verify before editing)

- Two full copies of the runtime, no shared module: `agent-kit/template/agent.mjs`
  (1060 lines; mechanics ≈ 45-102 + 543-1061: `send`/`log`, broker `ask()`
  543-632, browser `browse()` 634-732, `handleBrokerResponse`, telemetry v1
  `emit`/`emitArtifact` 749-842, `state`/`publish`/`startRun` 844-954,
  `handleCommand` + stdin loop 956-1044, SIGTERM 1046-1061; task logic ≈
  103-541: `runOnce({ step, artifact })`, sources/feed parsing, curation) and
  `tools/dash-mcp/template/agent.mjs` (743 lines; adds `brief()` with
  `derived_from` + `fingerprintItems` from `brief-fingerprint.mjs`, drops the
  broker and browser blocks entirely). ADR 0032 records the fork as a later
  packet's job — this is that packet.
- Scaffolded projects have `dependencies: {}` by design (`agent-kit/scaffold.ts:371`)
  and the packaged app copies the template as raw bytes
  (`scripts/build-shell.mjs:559-562` → `<out>/agent-kit/agent.mjs`;
  `electron/sample-agent.ts:53-63 templateCandidates`, `:102-110 assertSampleTemplatesPresent`;
  `lib/sample-agent.ts:74` calls `planScaffold` with `TemplateSources { agent, openInDash }`).
  The installed journey must keep needing no npm, no network, no extra Node.
- Runner protocol v1 (`runner/protocol.ts`): NDJSON on stdin/stdout; agent →
  runner `ack | state | telemetry | artifact | artifact_file | broker_request | browser_request`;
  runner → agent `command | task | broker_response | browser_response`.
  `MAX_LINE_BYTES = 262_144`. Telemetry v1 = `contracts/run-event.schema.json`
  (`event_version` const 1, seven types, `detail` ≤ 300, additive fields
  tolerated: `tests/contracts.test.ts:200`). Artifacts: digest v1, brief v2
  (`contracts/run-artifact.schema.json`). Commands: `retry|pause|resume|cancel`
  acknowledged via `ack`.
- Broker from the agent: `broker_request { request_id, connection_id, operation, input }`
  on the same pipe, no credential ever (`lib/broker/protocol.ts`), 30 s timeout
  → `broker_unavailable`. Browser: `browser_request`, 45 s.
- Tests that pin behaviour: `tests/agent-kit.test.ts` (31, spawns the real
  generated agent under a real `Supervisor`), `tools/dash-mcp/tests/template-run.test.ts`
  (12), `tools/dash-mcp/tests/fingerprint-mirror.test.ts`, `import-round-trip.test.ts`,
  `tests/sample-agent.test.ts` (15), `tests/sample-refresh.test.ts`,
  `tests/runner-protocol.test.ts`, `tests/runner-telemetry.test.ts`,
  `tests/conformance-v2.test.ts`, `tests/scout-curates.test.ts`,
  `tests/open-in-dash-url.test.ts`, `tests/protocol-client.test.ts`.
  Old fixtures: `.data/agents/*`, `conformance/v1`, `conformance/v2`, `examples/`.
- ADRs to read: 0002 (broker), 0003 (artifacts on the NDJSON channel), 0008
  (the agent folder is the unit), 0016, 0022, 0025 (brief bound by index +
  fingerprint), 0032 (the builder stages and asks; records the fork).

## Design (orchestrator decision; deviations go in the handoff with reasons)

1. **The SDK is one self-contained ESM file shipped inside the agent folder**,
   `dash-agent-sdk.mjs`, imported by `agent.mjs` with a relative import — the
   same shape `brief-fingerprint.mjs` already has. No npm package, no
   `node_modules`, node builtins only. Reason: scaffolds carry no
   dependencies and the packaged sample copies raw files. Source of truth:
   `agent-kit/template/dash-agent-sdk.mjs`. It absorbs `brief-fingerprint.mjs`'s
   functions (keep `lib/brief/fingerprint.ts` as the DASH mirror and keep the
   mirror test pointing at the new file's exports).
2. **SDK surface** (export names are yours to finalise; keep them small):
   `startAgent({ definition, runOnce })` — reads the manifest (both
   locations), publishes the pending task, runs the stdin loop, handles
   commands with the same `ack` semantics, SIGTERM as today; the `runOnce`
   context gives `step(componentId, label)`, `digest(body)`, `brief(body)`
   (with the derived_from binding and the digest-first refusal),
   `artifact(body)` (kept as an alias for the kit's older shape), `ask(...)`,
   `browse(...)`, `log(...)`, `signal` (for cancel). `SDK_VERSION` and
   `PROTOCOL_VERSION` constants exported; the emitted telemetry is byte-for-
   byte the same shape as today (`event_version: 1`, same seven types, same
   `seq`/`ts`/`detail` rules) — a new optional `sdk_version` field on
   `run_started` is allowed ONLY if `tests/contracts.test.ts`'s additive rule
   and `lib/analyze.ts` stay green; otherwise leave it out.
3. **Templates keep only definition + task logic.** `agent-kit/template/agent.mjs`
   becomes ~the current 103-541 plus a short header that imports the SDK and
   calls `startAgent`. `tools/dash-mcp/template/agent.mjs` likewise, keeping
   its model-free brief composition. Both templates document at the top:
   "Edit this file. Do not edit `dash-agent-sdk.mjs`; DASH upgrades it."
4. **Scaffolders and packaging.** `agent-kit/scaffold.ts`: `TemplateSources`
   gains `sdk`; `planScaffold` writes `dash-agent-sdk.mjs`;
   `AGENT_KIT_PROJECT_FILES` (`agent-kit/open-in-dash.ts:66-74`) lists it as
   required. `agent-kit/cli.ts readTemplates` reads it. `tools/dash-mcp/src/scaffold.ts`
   writes the same SDK file (read from `agent-kit/template/` at build/scaffold
   time, or bundled by `tools/dash-mcp/build.mjs` — pick the one that keeps a
   single source of truth and say why) and stops writing `brief-fingerprint.mjs`.
   `scripts/build-shell.mjs` copies the SDK beside `agent.mjs` into
   `<out>/agent-kit/`; `electron/sample-agent.ts templateCandidates` +
   `readTemplateSources` + `assertSampleTemplatesPresent` include it;
   `lib/sample-agent.ts` passes it through. `pnpm build:agent-kit` unchanged
   unless needed.
5. **Old agents keep working untouched.** Existing generated agents have a
   monolithic `agent.mjs` with no import; nothing in the runner changes, so
   they run as before — prove it with the existing fixtures and one explicit
   test that spawns the OLD template bytes (keep a copy under
   `tests/fixtures/legacy-agent-kit-template.mjs` taken from the current
   `agent-kit/template/agent.mjs` before you change it) under a real
   `Supervisor` and asserts the same telemetry/artifact/ack behaviour.
6. **Upgrade path, documented not automated:** `docs/foundation/sdk-upgrades.md`
   — the SDK file carries `SDK_VERSION`; a future "Check for changes" /
   sample-refresh can replace `dash-agent-sdk.mjs` when the version differs
   and must never touch `agent.mjs`. Do not implement the replacement in this
   lane unless `lib/sample-refresh.ts` already has the hook; if it does, wire
   it and test it.
7. **ADR 0034** — "A shared agent SDK ships as one file inside the agent
   folder" (`docs/adr/0034-a-shared-agent-sdk-file-inside-the-agent-folder.md`):
   the decision, the rejected alternatives (npm dependency; bundling the SDK
   into agent.mjs at scaffold time), the versioning/upgrade rule, and the
   line it draws: the SDK is not a sandbox, enforcement stays in runner/broker,
   no provider secret ever reaches the agent. Number 0034 is assigned by the
   orchestrator; check `ls docs/adr` first and use the next free number if
   0034 is taken, saying so.
8. Which files an LLM should edit, exactly: write it in the scaffolded
   `README.md` and in `agent-kit/README.md` (`agent.mjs`, `sources.json`,
   evals later; never `dash-agent-sdk.mjs`, `agent.manifest.json` only through
   the generator).

## Acceptance (from the plan)

A real generated agent starts idle, runs only on request, produces an
artifact, reports correctly and acknowledges supported commands; an old
fixture agent still works; no extra automatic model cost. Both scaffolders
and the packaged sample use the same runtime; the installed journey needs no
npm, network or extra Node.

## Verification

`pnpm typecheck`; `pnpm build:agent-kit`; the pinning tests above (run
`tests/agent-kit.test.ts`, `tests/sample-agent.test.ts`, `tests/sample-refresh.test.ts`,
`tools/dash-mcp/tests`, `tests/conformance-v2.test.ts`, `tests/runner-*.test.ts`
focused, then one full `pnpm test` from PowerShell — clear
`%TEMP%\dash-mcp-run-*` first); `pnpm build:shell` must succeed and
`<out>/agent-kit/` must contain the SDK. Then the real thing on a scratch
store from PowerShell: `pnpm build:renderer; pnpm build:shell; $env:DASH_SHELL_URL='dash-app://ui/'; pnpm exec electron dist/electron/smoke.mjs --user-data-dir=<scratch>\orchestratedash > <scratch>\smoke.log 2>&1`
— the smoke creates and runs the sample (proofs 6g–6k) — paste the 6* lines
and the 85/85 tally; retire the runner with `node scripts/retire-scratch-runners.mjs`.
Evidence class: fixture tests + installed-style shell on a scratch store.
Henrik's installed build is the orchestrator's.

Ownership (write): `agent-kit/**`, `tools/dash-mcp/template/**`,
`tools/dash-mcp/src/scaffold.ts`, `tools/dash-mcp/build.mjs` (if bundling),
`lib/sample-agent.ts`, `electron/sample-agent.ts`, `scripts/build-shell.mjs`,
`lib/sample-refresh.ts` (only for the hook), `docs/adr/0034-*.md`,
`docs/foundation/sdk-upgrades.md`, `docs/foundation/stage-1-handoff.md` (the
handoff — same contract as `docs/mar-<id>-handoff.md`), the tests listed and
new ones. NOT: `runner/**`, `lib/broker/**`, `contracts/**`, `lib/contracts.ts`,
`lib/analyze.ts`, `app/**`, `.orchestrate/**`, `PROJECT_STATE.md`,
`docs/foundation/README.md`.

Stop condition: PR open against master (`feat(mar-887): shared agent SDK file
inside the agent folder`), all of the above green, handoff written. Wait for
`%TEMP%\wt-f1-s1-install.done` before running node/pnpm.
