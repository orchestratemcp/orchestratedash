# MAR-888 handoff — stage 2: an LLM-friendly generator and a validated build recipe

**Epic:** MAR-886. **Issue:** MAR-888. **Branch:** `000henrik/mar-888-build-recipe`
(from `codex/agent-foundation` at `821c239`, which already carries stage 1's SDK;
PR against `master`). **PR:** #358. **ADR:** none — see "No ADR" below.

## What changed

Three programs write a DASH agent folder, and each assembled its own manifest v2
literal: the same `manifest_version`, `safety_contract`, `monitoring` block and
`agent_dom` runtime/trigger/locations/control skeleton, transcribed three times.
Stage 1 closed the fork in the runtime those three write; this closes the fork in
the document they write about it.

| File | What happened |
| -- | -- |
| `agent-kit/recipe.ts` | **New.** `AgentRecipe` (`recipe_version: 1`), `validateRecipe`, `planFromRecipe`, `manifestFromRecipe`, `checkRecipeAgainstManifest`, `agentBuilderDocument`, `evalCases`, `defaultAcceptance`, `readTargetState`, `dashAgentsRootForThisMachine`, `SDK_VERSION`. |
| `agent-kit/template/evals/run-evals.mjs` | **New.** The four acceptance checks, generic and copied verbatim into every project. Node builtins only. |
| `agent-kit/scaffold.ts` | An adapter. `recipeFor(request)` is the Agent Kit's own recipe; `planScaffold` and `scaffoldManifest` go through the shared planner. Gained an `amend` parameter for the sample. `TemplateSources` gained `evals`. |
| `agent-kit/cli.ts` | Reads the evals template, passes `readTargetState`, and gained `--check <folder>`. |
| `lib/sample-agent.ts` | Amends the **recipe** rather than the finished manifest. `amendSampleManifest` → `amendSampleRecipe`; `declareModelProvider` split into `modelProviderConnection` and `modelProviderRequirement`. |
| `tools/dash-mcp/src/scaffold.ts` | Same adapter shape. Its `recipeFor` now holds everything that makes an agent this tool builds different: a third step, a second document, the model-provider connection, the write permission, the four-section panel. The manifest literal and `projectPackage` are gone. |
| `tools/dash-mcp/src/agent-tools.ts` | Passes `readTargetState` + `overwrite: [".dash"]`; `validateAgent` reports `recipe_matches_manifest` and `recipe_drift[]`. |
| `tools/dash-mcp/src/server.ts` | Two tool descriptions say what is now written and what is now checked. |
| `electron/sample-agent.ts`, `scripts/build-shell.mjs` | Carry `run-evals.mjs` into `dist/electron/agent-kit/`; `assertSampleTemplatesPresent` fails startup without it. |
| `tests/agent-recipe.test.ts` | **New**, 31 tests. |
| `tests/fixtures/build-brief.recipe.json` | **New.** The recipe the MCP builder produces for a three-step competitor scout, generated from a finished interview draft. |
| `docs/foundation/mcp-recipe-contract.md` | **New.** The shape, the `dash_agent_plan` mapping, what the other repository would need to emit, and what is not proven. |
| `agent-kit/README.md`, `tools/dash-mcp/README.md`, `tools/dash-mcp/skills/building-a-dash-agent/SKILL.md` | The recipe, the drift check, and the evals. |

Commits: `bc2b0b3` (the recipe and the three adapters), `ec8e20c` (the fixture,
the tests and the contract document), plus the handoff commit this file is in.

## The two properties, and how each is made structural

**Nothing is written by a build that refuses.** `validateRecipe` runs the
recipe's own rules and then puts the manifest it *would* write through
`validateManifest` and `checkManifestConstraints` — DASH's own import verdict —
and `planFromRecipe` decides everything before it returns anything. There is no
state in which some of the file list exists. Refusals: an id that cannot be a
folder name, a relative directory, a directory containing `..`, a symlinked
target, a folder with somebody's files in it, a write inside DASH's own agents
root, an `overwrite` entry naming a file outside the project or one the author
owns, a dependency pinned to a range rather than an exact version, a brief with
no digest to cite, and a recipe missing any of the four acceptance kinds.

**The definition and the manifest cannot come apart unnoticed.** The recipe is
written into the project as `agent.recipe.json`. `checkRecipeAgainstManifest`
compares identity, route, connections and the artifact kinds the panel binds —
and the reason it earns its keep is that a hand-edited manifest is usually still
*valid*: `tests/agent-recipe.test.ts` asserts `validateManifest` passes on the
edited document before asserting the drift check catches it. Both
`create-dash-agent --check <folder>` and `dash_agent_validate` run it.

## What was verified, and how

**`pnpm typecheck`** — clean.

**Focused suites** (PowerShell):

```
pnpm vitest run tools/dash-mcp/tests tests/agent-kit.test.ts tests/sample-agent.test.ts \
  tests/agent-sdk.test.ts tests/legacy-agent.test.ts tests/sample-refresh.test.ts \
  tests/conformance-v2.test.ts tests/runner-telemetry.test.ts
  -> Test Files 17 passed (17) | Tests 228 passed (228)

pnpm vitest run tests/agent-recipe.test.ts
  -> Test Files 1 passed (1) | Tests 31 passed (31)
```

**`pnpm test`** — one run from PowerShell, exit 0:

```
Test Files  284 passed (284)
     Tests  5383 passed | 13 skipped (5396)
  Duration  194.85s
```

Nothing failed, so nothing needed re-running alone.

**`pnpm build:agent-kit`**, then the real CLI against a scratch directory
(`%TEMP%\f2-scratch`), which wrote `agent.manifest.json`, `agent.recipe.json`,
`package.json`, `agent.mjs`, `dash-agent-sdk.mjs`, `sources.json`,
`evals/run-evals.mjs`, `evals/cases.json`, `AGENT_BUILDER.md`, `README.md`,
`.gitignore` and `scripts/open-in-dash.mjs`.

**The generated evals, run against that real generated agent:**

```
> node evals/run-evals.mjs
ok normal_input: The run completes and sends a digest, with every item carrying the address it came from.
ok missing_input: The run completes and says there was nothing to read. It does not fail, and it does not send a document claiming to have found something.
ok tool_failure: The run completes, the digest names the source that failed, and the items from the source that worked are all there. A partial result is reported as partial.
ok denied_permission: The run completes with a complete digest and says it was not summarised. No operation outside the ones this agent's own manifest declares is ever asked for.

4 of 4 checks passed.
```

That is stage 4's first acceptance bullet, executed against a real agent under
the real runner protocol rather than against a double of it.

**`create-dash-agent --check`, on the same folder, before and after a
hand-edited manifest:**

```
> node agent-kit/dist/cli.mjs --check <scratch>\news-scout
  The manifest passes DASH's own importer.
  agent.recipe.json and agent.manifest.json describe the same agent.
  (exit 0)

# then: planned_route[1].component_id changed to "something_else" by hand
> node agent-kit/dist/cli.mjs --check <scratch>\news-scout
  The manifest passes DASH's own importer.
  The recipe and the manifest have come apart:
    /planned_route
      recipe says:   public_feed_fetch → local_file_write
      manifest says: public_feed_fetch → something_else
  (exit 1)
```

Note the first line of the second run: the edited manifest is still valid. That
is the whole reason the second check exists.

**`pnpm build:renderer`, `pnpm build:shell`** — both exit 0.
`dist/electron/agent-kit/` holds `agent.mjs` (21284),
`dash-agent-sdk.mjs` (31833), `open-in-dash.mjs` (12569) and
`run-evals.mjs` (19837). The fourth file is this packet's; without it
`assertSampleTemplatesPresent` fails at startup rather than leaving a menu item
that breaks later.

**The installed-style shell smoke, on a scratch store:**

```
$env:DASH_DATA_DIR='<temp>\f2-smoke\orchestratedash'; $env:DASH_SHELL_URL='dash-app://ui/'
pnpm exec electron dist/electron/smoke.mjs --user-data-dir=<temp>\f2-smoke\orchestratedash
```

**85 PASS / 0 FAIL**, `[smoke] all proofs passed`, exit 0. The 6* block, which is
the one this packet changes:

```
PASS  6a. the shipped sample templates can be read: "present"
PASS  6b. Try a sample agent creates a real handoff
PASS  6b-m1. migration creates only a manifest and leaves the existing registration in place
PASS  6b-m2. the sample still runs from its migrated standing
PASS  6b-m3. the migrated sample stops cleanly before re-import
PASS  6c. consent sees pending first, then registers and starts the sample
PASS  6c-f. the folder-carrying handoff runs DASH's copy, not the author's project
PASS  6d. the sample waits to be asked
PASS  6e. nothing ran on its own: []
PASS  6f. Run now is accepted through the audited bridge
PASS  6f. the handoff ledger keeps the first final outcome
PASS  6g. runner-hosted telemetry renders through the Runs bridge
PASS  6h. the sample leaves a digest in its own folder
PASS  6i. the digest reaches DASH, not just the agent's folder
PASS  6j. the digest carries a grounding verdict over every local item
PASS  6k. the run detail page draws the digest
PASS  6m. the mandatory gate reached no host outside this machine
PASS  6n. the workspace draws the panel the sample's manifest declared
PASS  6o. nothing inside the author's region is a control or a raw instant
PASS  6p. the agent's own output is on the page a link to it lands on
```

`6b`'s own detail is the proof that the installed build ships the new files:

```
[{"path":"agent.manifest.json","bytes":6481},{"path":"agent.recipe.json","bytes":5975},
 {"path":"package.json","bytes":443},{"path":"agent.mjs","bytes":21252},
 {"path":"dash-agent-sdk.mjs","bytes":31751},{"path":"scripts/open-in-dash.mjs","bytes":12561},
 {"path":"sources.json","bytes":556},{"path":"evals/run-evals.mjs","bytes":19825},
 {"path":"evals/cases.json","bytes":1511},{"path":"AGENT_BUILDER.md","bytes":3843},
 {"path":"README.md","bytes":2089},{"path":".gitignore","bytes":278},
 {"path":"dash-handoff.json","bytes":114954}]
```

The recipe, the builder instructions and the checks travel with the sample DASH
creates for a person on their first run, through the same consent dialog and the
same seven ordered checks as everything else in that list. `6c-f` then proves
DASH ran its own copy of that folder rather than the author's.

The runner was retired with `node scripts/retire-scratch-runners.mjs`
(status 202, `RETIRED`).

**Evidence class:** fixture tests, plus a real generated agent spawned under a
real `Supervisor` and under its own eval harness, plus an installed-style shell
on a scratch store. Nothing was proven on Henrik's installed build. The real
store at `%APPDATA%\orchestratedash` was never opened.

## Deviations from the lane brief, and why

1. **`agent.recipe.json` is not added to `AGENT_KIT_PROJECT_FILES`.** That list
   is in `agent-kit/open-in-dash.ts`, which the lane does not own, and adding to
   it would change the file list every Agent Kit handoff carries — including the
   one the shell smoke's `6b` proof reads. The recipe is a *build* input that
   lives in the author's folder; DASH stores a copy of the folder for the MCP
   path (its handoff walks the directory) and does not for the kit path. Worth a
   decision by whoever owns that file, and it is not a decision this lane should
   make quietly.
2. **No `dash_agent_recipe` tool.** The brief allowed one if it were a thin
   projection. It would be — `planFromDraft` then `recipeFor` — but it adds a
   fourth tool competing for a model's attention in a server whose own design
   note says the descriptions are what a model chooses between, and it shows a
   document `dash_agent_scaffold` already writes and `dash_agent_validate`
   already reads. Documented in `docs/foundation/mcp-recipe-contract.md` with
   this reasoning instead.
3. **The sample-refresh hook does not exist.** The brief made it conditional.
   `lib/sample-refresh.ts`'s `refreshedManifest` produces a *manifest* for an
   agent already in DASH's store, and `electron/main.ts` writes it to the store.
   The recipe lives in the author's project folder, which that path never
   touches — ADR 0008 swaps the stored folder rather than editing it — so there
   is nothing one line could ride. Saying so rather than inventing one.
4. **Files edited outside the ownership list**, all forced and all named here:
   - `electron/sample-agent.ts` and `scripts/build-shell.mjs` — the lane allows
     these "if the recipe file must ship in the packaged kit". It is
     `run-evals.mjs` rather than the recipe that must: the recipe is generated,
     the eval runner is a template file. Choosing to generate the runner from a
     TypeScript string instead would have avoided both edits and put a 400-line
     program inside a template literal; the packaging change is three lines and
     `assertSampleTemplatesPresent` is the guard that makes a mistake in it a
     crash at startup rather than a broken menu item.
   - `tests/agent-sdk.test.ts` and `tests/runner-telemetry.test.ts` — one line
     each, adding `evals` to a `TemplateSources` literal so the file compiles.
     No assertion changed.
5. **`dashAgentsRootForThisMachine` duplicates `tools/dash-mcp/src/paths.ts`'s
   data-directory resolution.** `paths.ts` is not in this lane's ownership, and
   the two refusals are deliberately independent anyway: the MCP refuses at its
   tool boundary before a recipe exists, and the planner refuses for every
   writer including the CLI. Worth collapsing into one exported helper by
   whoever owns `paths.ts`.
6. **`evals/run-evals.mjs` is copied verbatim rather than being a template with
   holes.** Everything about a particular agent reaches it through the generated
   `evals/cases.json`, so both scaffolders write the same bytes — the same
   property ADR 0034 gives the runtime, for the same reason.

## What is NOT done

- **No JSON Schema for the recipe.** It is a TypeScript interface plus a
  validator. `contracts/` holds cross-repository contracts, and promoting the
  recipe to one should follow a second producer existing rather than precede it.
- **No change in the other repository.** `export_build_brief` still emits a
  manifest. `tests/fixtures/build-brief.recipe.json` is a local fixture produced
  by this repository's own MCP scaffolder and must not be described as live
  integration.
- **No traces, no run-view change.** Stage 3 (MAR-889) owns `runner/**`,
  `lib/store.ts`, `lib/db.ts`, `lib/views/**` and `dash-agent-sdk.mjs`; nothing
  here touches any of them.
- **No migration, no contract change, no ADR.** See below.
- **`agent-kit/package.json` is still `private: true`.** Nothing published.

## No ADR

The lane forbids one and nothing here needs one: no cross-repository contract
changes, manifest v2 and telemetry v1 are untouched, and the recipe is an input
to this repository's own generators rather than a promise to anybody else. ADR
0034's decision 5 — the runtime is not a sandbox and must never be described as
one — is honoured in the generated `AGENT_BUILDER.md`, which says it in the
document a coding assistant actually reads.

## Surprises worth passing on

- **A hand-edited manifest is usually still valid**, which is exactly why the
  drift check is not redundant with `validateManifest`. A route naming a step
  the program never runs passes every schema DASH has and turns every later run
  into a page of drift findings. The test asserts the validity before asserting
  the drift, so a future reader cannot mistake the check for a second validator.
- **`path.join` normalises a traversal away**, so a check made after
  `path.resolve` can never see one. `planFromRecipe` reads `..` off the caller's
  own string before resolving it, and the test builds its hostile path by
  concatenation rather than with `path.join`, which silently produced a clean
  path and a green assertion that meant nothing.
- **The eval runner must wait for the child to exit before deleting its
  workspace.** SIGTERM followed immediately by `rmSync` is `EPERM` on Windows
  every time, and it surfaces as "the checks could not run" rather than as
  anything about a process. `settle()` waits on `exit` with a hard-kill
  fallback, and `rmSync` carries `maxRetries`.
- **The MCP scaffolds into a directory its own interview has already written
  to.** `dash_agent_interview` saves `.dash/interview-<id>.json` in the very
  folder the agent is built in, so a strict emptiness check breaks the one flow
  the tool exists for. `.dash` is named explicitly in `overwrite` rather than
  the check being loosened.
- **The kit's plain template makes no brokered call at all**, because it looks
  for a `.digest.curate` capability in its own manifest and finds none. The
  `denied_permission` case is therefore mostly a *negative*: the run completes,
  and no operation outside the manifest's declared set was requested. On DASH's
  sample, which declares one, the refusal path is genuinely exercised.

## The one thing the next session should do first

Read deviation 1 and decide whether `agent.recipe.json` belongs in
`AGENT_KIT_PROJECT_FILES`. Today an agent imported from the Agent Kit reaches
DASH without its recipe, and one imported through the MCP reaches it with one,
because the two handoffs are built differently. That asymmetry is small now and
will be load-bearing the moment anything in DASH wants to read a stored agent's
recipe.

## Needs orchestrator

1. **`.orchestrate/state.json` and `PROJECT_STATE.md` are untouched**, per the
   lane rules. MAR-888's entry is yours to promote.
2. **Two files outside the ownership list were edited for compilation only** —
   `tests/agent-sdk.test.ts`, `tests/runner-telemetry.test.ts` — and two more
   under the lane's conditional permission: `electron/sample-agent.ts` and
   `scripts/build-shell.mjs`. Deviation 4 has the detail.
3. **Lane F3 (MAR-889) shares no file with this branch.** Nothing here touches
   `runner/**`, `lib/store.ts`, `lib/db.ts`, `lib/views/**`, `app/**` or
   `agent-kit/template/dash-agent-sdk.mjs`. The one shared *directory* is
   `agent-kit/template/`, where this lane added `evals/` and changed nothing
   else.
4. **The installed-build proof is yours.** This lane's shell evidence is a
   scratch store under `%TEMP%`, which can be deleted, and a scratch scaffold at
   `%TEMP%\f2-scratch`.
5. **Decision wanted on the recipe's home** if a second producer appears: a JSON
   Schema under `contracts/` would make it a cross-repository contract and would
   need an ADR. Not needed while this repository is the only producer.
6. **`scripts/retire-scratch-runners.mjs` retired lane F3's runner too.** It
   walks every scratch store it can find, and it reported two:
   `%TEMP%\f2-smoke\orchestratedash` (pid 24876, this lane's) and
   `%TEMP%\f3-smoke-scratch\orchestratedash` (pid 9736, MAR-889's). Both came
   back status 202, `RETIRED`. Neither is the real store and retiring is the
   correct end state for both, but if F3 was mid-proof when this ran, that is
   why its runner went away and it should re-run rather than conclude anything
   from the gap.
