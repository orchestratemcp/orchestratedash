# MAR-878a — dash-mcp scaffold now declares a `model_provider` connection

Client: Claude Code, `claude --model sonnet`. Worktree
`C:\Users\henri\AppData\Local\Temp\wt-ux878a-s1`, branch
`000henrik/mar-878a-template-model-provider`, off `origin/master` at `0e52211`.

This is the "functional prerequisite" half of MAR-878 only, as scoped by the
packet: the generated manifest declaration. The page/chief readiness states
are MAR-878b's territory and are untouched here.

## What changed

`tools/dash-mcp/src/scaffold.ts` — `scaffoldManifest` now emits one
`agent_dom.connections` entry (`model_provider`) and an
`agent_dom.connection_requirements` block, on the exact ADR 0013 shape
`lib/sample-agent.ts`'s `declareModelProvider` writes, with one deliberate
difference: the capability is `${provider}.chat.completion` (the ask
feature's operation, `lib/broker/operations.ts:1246-1248` /
`lib/chief/manifest.ts:64-66`) rather than a curate operation, because this
template's own `planned_route` never uses a model — the connection exists
solely so the agent can be asked a question about what it found. `optional:
true`, `ownership: "dash_managed"`, no `technical.environment_name`, same as
the sample.

- `tools/dash-mcp/src/scaffold.ts` — added `model_provider?: AiProviderId` to
  `ScaffoldRequest`, `DEFAULT_MODEL_PROVIDER = "openrouter"` (exported),
  `modelProviderConnection`, `modelProviderRequirement`,
  `chatCompletionOperationId`, `keySourceHelp`. `scaffoldManifest`'s
  `agent_dom.connections` is no longer `[]`; `connection_requirements` is new.
- `tools/dash-mcp/src/agent-tools.ts` — `ScaffoldInput.model_provider?: string`,
  validated against `lib/ai/providers.ts`'s `AI_PROVIDER_IDS` before it reaches
  the scaffolder (refused by name, nothing written, for an unrecognised
  value); threaded into the `scaffoldManifest` request; echoed back on success
  as `model_provider` so a caller can see which one it got.
- `tools/dash-mcp/src/server.ts` — `dash_agent_scaffold`'s input schema gained
  `model_provider` (enum `openrouter`/`anthropic`/`openai`, one-sentence
  description telling the assistant to match what the person already
  connected under Settings → AI); threaded through to `scaffoldAgent`.
- `tools/dash-mcp/tests/scaffold.test.ts` — replaced the test pinning
  `connections: []` with tests pinning the new shape (id, provider, ownership,
  capability id/access, field id/kind/required, the requirement block, no
  `technical` on the field), a test that the declared provider follows the
  request, and the default-provider case (existing `request()` calls, unchanged).
- `tools/dash-mcp/tests/server.test.ts` — one new test: an unrecognised
  `model_provider` through the full JSON-RPC path comes back `isError: true`
  with the allowed list named.
- `tools/dash-mcp/tests/model-provider-connection.test.ts` (new) — calls
  `lib/ai/connection-view.ts`'s `aiKeyConnections` directly over a freshly
  scaffolded manifest, with a scratch `DASH_DATA_DIR` and no key held, and
  asserts it returns exactly one `provider_key` card. This is the fixture-level
  stand-in for "the `no_provider` refusal cannot fire": `lib/views/ask.ts`
  refuses only when `aiKeyConnections` returns nothing, and this proves it no
  longer does for a scaffolded agent.
- `tools/dash-mcp/skills/building-a-dash-agent/SKILL.md` and
  `tools/dash-mcp/README.md` — the "keep `connections: []`" prose is replaced
  with what the connection is for, that it needs no credential, and how
  fleet adoption (ADR 0013's "Give it to N waiting agents" button, or
  connecting on the agent's own row) is what actually delivers a key —
  neither of which this tool does itself.

Not touched: `agent-kit/scaffold.ts`, `lib/sample-agent.ts`, `lib/views/ask.ts`,
`electron/ask-host.ts`, `lib/fleet/**`, `app/**`, `dist/` (gitignored, built
from source on demand by the existing tests and `launch.mjs`).

## Why `chat.completion` and not the sample's `curate` operation

`lib/sample-agent.ts`'s `declareModelProvider` declares a curate capability
because its digest-write step actually calls a model
(`declareConversationModelLevel` sets `model_tier: "small"` on that step first).
This scaffold's three steps are all `model_tier: "none"` — nothing in the
template's own program calls a model — so the only consumer of this
connection is the ask feature, and the capability id that feature's own
operation carries (`lib/broker/operations.ts`'s `completionOperation`,
mirrored by `lib/chief/manifest.ts`'s `chiefOperationId` for the chief
principal) is what was declared. `tests/validate.test.ts:111-141`'s existing
fixture for the remote/dash_managed refusal already used
`"openrouter.chat.completion"` for exactly this reason, which is corroborating
evidence this is the id DASH's own test suite already treats as the ordinary
one for this shape.

## Verified, and how

- `pnpm typecheck` — clean.
- `pnpm vitest run tools/dash-mcp/tests` — **8 test files, 97 tests, all
  passed** (7 pre-existing files plus the new one).
- `pnpm test` (whole suite, once, from PowerShell) — **266 files passed, 1
  failed; 5019 passed, 9 failed, 13 skipped (5041 total)**. The 1 failed file
  is `tools/dash-mcp/tests/template-run.test.ts`, and all 9 failures are the
  same `afterEach` cleanup: `EPERM ... rmSync(scratch, ...)` racing a live
  child process's temp files under the full suite's parallel load — the exact
  shape `MEMORY.md`'s "EPERM on temp cleanup is a live child" and "MCP suite
  is flaky under parallel load" describe. Re-ran that file alone immediately
  after: **11/11 passed**, confirming it is the known parallel-load flake and
  not a regression from this change. `template-run.test.ts` was not modified
  by this packet.
- Constraint check named in the packet (`lib/manifest-constraints.ts`'s
  remote-runtime-vs-dash_managed refusal, `tools/dash-mcp/tests/validate.test.ts:111-141`):
  the scaffold's `agent_dom.locations.runtime.kind` is `"local"`, never
  `"remote"`, so this constraint does not and cannot fire for a scaffolded
  agent. Not weakened; not touched.

## What is NOT done

- No installed-app proof. Nobody scaffolded an agent through the actual
  Claude Code plugin, connected a fleet key, and asked it a question inside a
  running DASH. That is explicitly the orchestrator's and MAR-874's evidence,
  per the packet, not this session's.
- MAR-878b (the page/chief readiness states for this connection) is untouched
  and unstarted.
- `dist/` was not rebuilt/committed — it never is; it stays gitignored and the
  existing tests build it into a temp location on demand when missing.

## Surprises / contradictions

- ADR 0013's own inline example (`docs/adr/0013-fleet-connections.md:232-278`)
  labels the connection `"OpenRouter"` and gives it a `model.list` read
  capability, while `lib/sample-agent.ts`'s actual shipped code (the thing
  with tests behind it) uses the generic label `"Your model provider"` and a
  spend capability. I followed the sample's real code, not the ADR's
  illustrative snippet, for two reasons: the label needs to stay accurate when
  `model_provider` names something other than OpenRouter, and a `model.list`
  read-only capability would be a card promising a key can be used for
  something DASH does not use it for here (nothing calls `models.list` on a
  scaffolded agent's behalf). The ADR's own text is describing the concept,
  not asserting these two strings must be verbatim, and this is not the field
  the "do not invent" instruction is about — the four required members
  (`ownership`, `capabilities[].access`, no `technical.environment_name`,
  provider from the closed list) all match exactly.
- The manifest schema's `connectionRequirement.provider` is an open string
  (`contracts/agent.manifest.v2.schema.json`), so an unrecognised
  `model_provider` value is refused at the tool boundary
  (`agent-tools.ts`/`server.ts`), before the manifest is even built — never by
  the schema or `checkManifestConstraints`. Worth knowing for MAR-878b: a
  manifest built some other way with an unlisted provider string would still
  *import*; it just would not resolve to a broker profile
  (`resolveKeyGrantWithoutCredential` returns `no_broker_profile`), which
  `aiKeyConnections` already skips silently rather than half-drawing a card.

## Evidence class

Fixture tests (scaffold shape, JSON-RPC refusal path) plus one direct call
into `lib/ai/connection-view.ts`'s real `aiKeyConnections` over a scratch
`DASH_DATA_DIR` with no key held — the same reader `lib/views/ask.ts`'s
`no_provider` gate calls, run here without Electron. **Not** an
import-round-trip proof of this specific manifest shape (the existing
`tests/import-round-trip.test.ts` scaffolds the default request with no
`model_provider` override and asserts `outcome: "registered"`, which now
exercises a manifest carrying this connection — it stayed green with no
changes needed, which is itself evidence the connection does not block
import). **Not** an installed-runtime proof: nobody adopted a real fleet key
for a scaffolded agent and asked it a question inside a running DASH. That is
the orchestrator's / MAR-874's evidence per the packet.

## The one thing the next session should do first

Read `lib/views/ask.ts:120-156` again against this manifest shape and confirm
whether MAR-873's reorder (deferred there pending exactly "a manifest with a
declared connection") is now unblocked for a scaffolded agent specifically —
it still needs a held key via MAR-874's adoption surface before the reorder
means anything, but the first of the two gaps MAR-873 named (`proof-scout-mar861`
having *no* declared connection at all) is what this packet closes for every
agent the plugin builds going forward. Existing agents already scaffolded
before this change still have `connections: []` and are unaffected; there is
no migration here.
