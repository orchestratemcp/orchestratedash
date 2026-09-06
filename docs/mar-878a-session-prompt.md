# Lane B — MAR-878a: the plugin always emits a model_provider connection

Tier: Sonnet (bounded, decided design, one package, existing tests to extend).
Read `ux-lanes-common.md` beside this file first.

Worktree: `C:\Users\henri\AppData\Local\Temp\wt-ux878a-s1`
Branch: `000henrik/mar-878a-template-model-provider` (from origin/master 0e52211)
Issue: MAR-878 (https://linear.app/martini-home/issue/MAR-878) — this lane is
its "functional prerequisite" half only: the generated model_provider
declaration. The page/chief readiness states are a later lane (MAR-878b).
No new issue id exists; name the PR `feat(mar-878): dash-mcp scaffold declares a model_provider connection`.

## Why (verified by the orchestrator; read `docs/mar-873-handoff.md` for the full chain)

`tools/dash-mcp/src/scaffold.ts:257-261` emits `agent_dom.connections: []` and
no `connection_requirements`; every step is `model_tier: "none"`. DASH's ask
composer (`lib/views/ask.ts:120-128`) refuses `no_provider` because
`aiKeyConnections` finds no `provider_key` field, and `electron/ask-host.ts`
can only spend through a `connection_id` declared in the manifest. So every
agent the plugin builds is READY but "has no way to answer questions". The
fix is upstream: the scaffold must declare the ADR-0013-shaped connection so
the fleet key can be adopted for it. Reading the fleet key directly and
reordering the gate are both rejected (ADR 0013, ADR 0023).

## What to build

1. In `scaffoldManifest`, emit exactly the ADR 0013 shape that
   `lib/sample-agent.ts:243-315` (`declareModelProvider`) writes:
   `agent_dom.connections = [{ id: "model_provider", provider, label,
   purpose, ownership: "dash_managed", capabilities: [{ id: "<provider>.chat.completion"-style spend op as the sample does, access: "spend" }],
   fields: [{ id: "api_key", label: "API key", purpose, kind: "secret", required: true, help }],
   validation_action: { id: "test_model_key", label: "Check the key", behavior: "test" } }]`
   and `agent_dom.connection_requirements = { requirements_version: 1,
   requirements: [{ id: "model_provider", name, connector_kind: "api_key",
   connection_id: "model_provider", optional: true, why }] }`.
   Copy the exact operation id / capability shape from `lib/sample-agent.ts`
   and from `docs/adr/0013-fleet-connections.md:232-278` — do not invent
   fields. The field must NOT carry `technical.environment_name`.
   `purpose`/`why` must say the honest thing: the model is for answering
   questions about what the agent found (and any step that later asks for a
   model); the agent still collects and writes without it.
2. Add a scaffold request option `model_provider?: "openrouter" | "anthropic" | "openai"`
   (default `"openrouter"`, the by-value list in `lib/ai/providers.ts`), thread
   it through `dash_agent_scaffold`'s input schema in `tools/dash-mcp/src/server.ts`
   and `agent-tools.ts`, with a one-sentence description telling the assistant
   to match the provider the person has connected under DASH → Settings → AI.
3. Keep `optional: true` and keep import idle: the manifest must still import
   with ZERO validation failures when no key exists (that is ADR 0032's whole
   point). Check `lib/manifest-constraints.ts` for the rule that refuses a
   `dash_managed` connection on a remote runtime (`tools/dash-mcp/tests/validate.test.ts:111-141`);
   the scaffold's runtime must remain the one DASH accepts, and the agent must
   still be deployable by the deploy verb afterwards — if the constraint bites,
   stop and report; do not weaken the constraint.
4. Update `tools/dash-mcp/tests/scaffold.test.ts:93-96` (it pins `connections: []`)
   to pin the new shape, and add tests that: (a) `validateManifest` +
   `checkManifestConstraints` accept it; (b) `aiKeyConnections(agentId, manifest)`
   from `lib/ai/connection-view.ts` returns one `provider_key` card so the
   `no_provider` refusal cannot fire for a scaffolded agent; (c) the provider
   option is honoured and an unknown value is refused; (d) `import-round-trip`
   still imports idle with no key. Keep `template-run.test.ts` green (the
   program itself does not change unless it reads connections — check
   `tools/dash-mcp/template/agent.mjs`).
5. Update `tools/dash-mcp/skills/building-a-dash-agent/SKILL.md` (:97-98, :184)
   and `tools/dash-mcp/README.md` so the prose stops saying "keep connections
   empty" and instead explains: the scaffold declares a model provider so the
   person can ask it questions; DASH gives it the fleet key only when they
   press the "Give it to N waiting agents" button on Settings → AI (ADR 0013
   moment 3) or connect it on the agent's own row; nothing is spent until then.
6. Do not touch `agent-kit/scaffold.ts` or `lib/sample-agent.ts` (they are a
   different product decision, documented at `lib/sample-agent.ts:224-232`).
   Do not touch `lib/views/ask.ts`, `electron/ask-host.ts`, `lib/fleet/**`,
   `app/**`.

## Ownership (write)

`tools/dash-mcp/**` only (src, tests, skills, README; `dist/` is built output —
rebuild it with `node tools/dash-mcp/build.mjs` if that is how the repo keeps
it in sync; check whether `dist/` is committed and follow the existing practice).

## Verification

`pnpm typecheck`; `pnpm vitest run tools/dash-mcp/tests` (all seven files);
`pnpm test` once from PowerShell. Evidence class for the handoff: fixture
tests + the import-round-trip through DASH's real import path into a scratch
`DASH_DATA_DIR`. The installed proof (a fresh agent, adopted, answering a real
question) is the orchestrator's and MAR-874's, not yours; say so.

Stop condition: PR open, tests green, `docs/mar-878a-handoff.md` written
(name it that; the orchestrator folds it into MAR-878 on Linear).
