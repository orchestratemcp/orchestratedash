# Lane F2 — MAR-888: an LLM-friendly generator and a versioned, validated build recipe

Tier: Opus (a contract between three writers — CLI, sample, MCP builder —
that must not drift; validation of untrusted input before any write). Read
`ux-lanes-common.md` first; base is `codex/agent-foundation` AFTER stage 1
(MAR-887, PR #356) — read `docs/adr/0034-*.md`, `docs/foundation/stage-1-handoff.md`
and `agent-kit/template/dash-agent-sdk.mjs` (exports: `SDK_VERSION`,
`PROTOCOL_VERSION`, `log`, `readManifest`, `ask`, `browse`,
`canonicaliseItems`, `fingerprintItems`, `startAgent({ definition, runOnce })`)
before designing.

Worktree: `C:\Users\henri\AppData\Local\Temp\wt-f2-s1`
Branch: `000henrik/mar-888-build-recipe`. PR targets `master`.
Issue: MAR-888 (epic MAR-886). Plan: `C:\Users\henri\Documents\DASH-agent-foundation-claude-plan.md`
"Etapp 2" (Swedish; acceptance repeated below). A parallel lane (F3,
MAR-889) instruments `dash-agent-sdk.mjs`, `runner/**`, `lib/store.ts`,
`lib/db.ts`, run views — stay off those files entirely.

## Ground truth (verify)

- Three writers of an agent folder today: `agent-kit/cli.ts` → `planScaffold`
  (`agent-kit/scaffold.ts`, request `{ directory, agent_id, display_name, summary, kit_version, now }`
  + `TemplateSources { agent, openInDash, sdk }`), the packaged sample
  (`lib/sample-agent.ts planSampleAgent` → `planScaffold` + `amendSampleManifest`),
  and the MCP builder (`tools/dash-mcp/src/scaffold.ts scaffoldManifest` /
  `planScaffold`, its own fork with `sources`, `model_provider`, brief step;
  `dash_agent_interview` / `dash_agent_plan` / `dash_agent_scaffold` in
  `src/server.ts`, MAR-876). The MCP `dash_agent_plan` already emits "the
  exact `dash_agent_scaffold` arguments" from an interview draft.
- The manifest is v2 (`contracts/agent.manifest.v2.schema.json`), validated
  by `validateManifest` + `checkManifestConstraints` (`lib/contracts.ts`,
  `lib/manifest-constraints.ts`); `tools/dash-mcp/src/validate.ts` runs the
  same functions. `conformance/v2/mar-426.runner-hosted.agent.manifest.json`
  is the pinned output of the MCP's `export_build_brief` (a different repo's
  tool; local fixture only).
- Tests: `tests/agent-kit.test.ts` (31 + stage 1 additions), `tests/agent-sdk.test.ts`,
  `tests/sample-agent.test.ts`, `tools/dash-mcp/tests/*` (scaffold, validate,
  interview, interview-plan, server, import-round-trip, template-run,
  fingerprint-mirror, tools, model-provider-connection), `tests/conformance-v2.test.ts`.

## Design (orchestrator decision; deviations argued in the handoff)

1. **One recipe, one planner.** Introduce a machine-readable, versioned
   `AgentRecipe` (`recipe_version: 1`) in `agent-kit/recipe.ts`: template/
   runtime version (`SDK_VERSION`, kit version), agent definition (id,
   display name, summary, sources, steps' intent), required connections
   (declared ADR-0013 shape or none), input/output contract (what the run
   consumes and emits: digest v1 / brief v2), and acceptance cases (the four
   eval kinds of stage 4: normal / missing input / tool failure / denied
   permission, each with a fixture description). `planFromRecipe(recipe, sources)`
   → the same `ScaffoldPlan` shape `planScaffold` returns today.
   `planScaffold` becomes a thin adapter that builds a recipe from the old
   request (so every existing caller and test keeps working), and the MCP
   scaffold's own `scaffoldManifest` is rebuilt on the same recipe so the
   three writers cannot drift. Name things after what exists; do not
   "pretend proposed APIs already exist" — the recipe is new and says so.
2. **Validate before any write.** `validateRecipe(recipe)` returns typed
   problems (JSON pointer + constraint) and runs the manifest through
   `validateManifest` + `checkManifestConstraints` BEFORE the first file is
   written; the planner refuses: invalid ids, path traversal in
   `directory`/file names (`..`, absolute segments, symlink targets), a
   non-empty target directory (unless an explicit `overwrite: []` list names
   files, and user files like `agent.mjs`/`sources.json` are never in it by
   default), writes inside DASH's agents root. Tests for each refusal, and
   one proving no half-written project remains after a refusal.
3. **Definition ↔ manifest cannot drift unnoticed.** The recipe is written
   into the project as `agent.recipe.json` beside the manifest, and a pure
   `checkRecipeAgainstManifest(recipe, manifest)` reports drift (steps,
   connections, kinds); `dash_agent_validate` and the kit's CLI run it;
   the sample-refresh "check for changes" path may call it if a one-line
   hook exists (say so if not).
4. **Builder instructions + evals.** Generate `AGENT_BUILDER.md` into the
   project: short, imperative, which files an LLM edits (`agent.mjs`,
   `sources.json`, `evals/`), which it must not (`dash-agent-sdk.mjs`,
   `agent.manifest.json` except through the recipe), how to run the evals
   locally with the bundled Node, how to validate. Generate `evals/` with
   the four acceptance cases as runnable deterministic checks against the
   agent's own `runOnce` using test doubles for sources and the broker (a
   small `evals/run-evals.mjs`, node builtins only, no dependencies, no paid
   judge). Pin versions: the recipe carries `sdk_version` and `kit_version`;
   no `latest` anywhere; if a scaffold ever needs a dependency, it must name
   a version and a lockfile strategy — today it needs none, keep it that way.
5. **Build-brief fixture.** Add `tests/fixtures/build-brief.recipe.json`
   modelled on the MCP planner's `dash_agent_plan` output (and the
   `conformance/v2` brief shape where relevant) and a test that walks
   recipe → validate → plan → files on disk → `validateManifest` → the
   generated agent spawns under a real Supervisor (reuse the stage-1 harness
   in `tests/agent-kit.test.ts`) → runs on request → emits a digest.
6. **MCP contract documented, not changed live.** `docs/foundation/mcp-recipe-contract.md`:
   the recipe JSON the DASH MCP builder produces/consumes, how
   `dash_agent_plan` maps to it, what `export_build_brief` in the other repo
   would need to emit, and the explicit statement that the local fixture is
   not live integration. `tools/dash-mcp/src/server.ts` may gain a
   `dash_agent_recipe` tool only if it is a thin projection of the existing
   plan → recipe; otherwise document instead.
7. Keep `Try a sample agent` canonical: the sample is a recipe too
   (`lib/sample-agent.ts` builds it), and the CLI, the sample and the MCP
   scaffolder produce identical bytes for identical recipes — pin that with
   a test.

## Acceptance (from the plan)

A coding assistant can follow the generated instructions and customise a
sample variant without touching the runtime; definition and manifest cannot
drift apart unnoticed; the CLI and the installed sample use the same
generator.

## Ownership (write)

`agent-kit/{recipe.ts,scaffold.ts,cli.ts,README.md,template/AGENT_BUILDER.md,template/evals/**}`
(NOT `template/dash-agent-sdk.mjs`, NOT `template/agent.mjs` beyond wiring
the evals' expectations), `lib/sample-agent.ts` (recipe adapter only),
`tools/dash-mcp/src/{scaffold,validate,server,agent-tools,interview}.ts` +
its tests, `tools/dash-mcp/skills/**`, `tools/dash-mcp/README.md`,
`docs/foundation/{mcp-recipe-contract.md,stage-2-handoff.md}`, tests:
`tests/agent-kit.test.ts`, `tests/agent-recipe.test.ts` (new),
`tests/sample-agent.test.ts`, `tests/fixtures/build-brief.recipe.json`,
`tests/conformance-v2.test.ts` (only if the recipe touches it). NOT:
`runner/**`, `lib/store.ts`, `lib/db.ts`, `lib/views/**`, `app/**`,
`contracts/**`, `.orchestrate/**`, `docs/foundation/README.md`,
`electron/**` except `electron/sample-agent.ts` if the recipe file must ship
in the packaged kit (then also `scripts/build-shell.mjs`, say so).

## Verification

Typecheck; `pnpm build:agent-kit`; the focused suites above; one full
`pnpm test` from PowerShell; `pnpm build:shell`; the scratch-store shell
smoke as in stage 1 (85/85, paste 6a–6k); retire the runner. Evidence class:
fixture tests + installed-style shell on a scratch store. Stop condition:
PR open (`feat(mar-888): a versioned agent recipe behind every scaffolder,
validated before any write`), green, `docs/foundation/stage-2-handoff.md`.
Wait for `%TEMP%\wt-f2-s1-install.done` before running node/pnpm.
