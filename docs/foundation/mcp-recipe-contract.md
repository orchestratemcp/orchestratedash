# The recipe contract between DASH and an MCP builder

**Stage 2 of MAR-886 (MAR-888).** Status: the recipe is implemented and live in
this repository. The integration with the *other* repository's
`export_build_brief` is **described here and not built** — see "What is not
proven" at the bottom, and read that section before quoting anything above it.

---

## What a recipe is

`agent-kit/recipe.ts` defines `AgentRecipe`, `recipe_version: 1`. It is the
machine-readable definition three programs build a DASH agent folder from:
`agent-kit/scaffold.ts` (the CLI), `lib/sample-agent.ts` (DASH's own
"Try a sample agent"), and `tools/dash-mcp/src/scaffold.ts` (the MCP builder). A
scaffolded project carries its own copy at `agent.recipe.json`.

```jsonc
{
  "recipe_version": 1,
  "runtime": {
    "sdk_version": "1.0.0",          // the runtime file that ships in the folder
    "kit_version": "0.1.1",          // the generator
    "generated_by": "…",             // verbatim into provenance.generated_by
    "registry_fingerprint": "…",     // never a real registry build
    "dependencies": {}               // exact versions only; a range is refused
  },
  "agent": { "id": "…", "display_name": "…", "summary": "…" },
  "steps": [                          // the planned route, in order
    { "component_id": "public_feed_fetch", "intent": "…",
      "risk_level": "low", "model_tier": "none" }
  ],
  "sources": [{ "name": "…", "url": "…", "format": "rss|atom|hn_algolia" }],
  "connections": [ /* ADR 0013 declarations, verbatim */ ],
  "connection_requirements": { /* the next-action half, or omitted */ },
  "contract": {
    "consumes": ["sources.json"],
    "emits": [{ "kind": "digest", "artifact_version": 1 }]
  },
  "permissions": { "read": [], "write": [], "approval_required_for": [] },
  "panel": { /* ADR 0008's panel, verbatim */ },
  "acceptance": [ /* the four kinds, below */ ]
}
```

`tests/fixtures/build-brief.recipe.json` is a complete example: the recipe the
MCP builder produces for a three-step competitor scout that emits a digest and a
brief. `tests/agent-recipe.test.ts` walks it from validation to a real
`Supervisor` spawning what was written.

### What is deliberately not on it

The **target directory**. It is a build argument (`RecipeBuild`), not a property
of the agent, so a recipe can be committed as a fixture and moved between
machines without carrying somebody's home directory.

The **shared skeleton**: `manifest_version`, `safety_contract`, `monitoring`,
and the `agent_dom` runtime / trigger / locations / control / memory blocks.
`manifestFromRecipe` assembles those and no recipe may vary them. A template
that let an agent choose its own automation clearance would be a template
teaching every agent built from it to overstate itself.

### The four acceptance cases

`acceptance` must carry all four kinds — `normal_input`, `missing_input`,
`tool_failure`, `denied_permission` — and `validateRecipe` refuses a recipe
missing one. The sentences are the recipe's own; the mechanics are in the
generated `evals/run-evals.mjs`, which spawns the real agent under the runner
protocol against a loopback fixture server and a broker double.

---

## How `dash_agent_plan` maps to it

The MCP builder's interview already produces "the exact `dash_agent_scaffold`
arguments". That is the same information a recipe carries, in the shape the tool
call takes rather than the shape the folder does.

| `dash_agent_plan` → `scaffold_request` | `AgentRecipe` |
| --- | --- |
| `name` | `agent.id` |
| `display_name` | `agent.display_name` |
| `summary` | `agent.summary` |
| `sources[]` | `sources[]`, unchanged |
| `model_provider` | selects the provider named in `connections[0]` and its `capabilities[].id` |
| `directory` | **not on the recipe** — it is `RecipeBuild.directory` |
| `recap.route[]` | `steps[]`; `recap.route[].does` is `steps[].intent` |
| `recap.will_not_do[]` | not carried: it is prose about what the template cannot do, and belongs in the conversation rather than in a build input |

`tools/dash-mcp/src/scaffold.ts`'s `recipeFor(request)` is that mapping, and
`dash_agent_scaffold` is `recipeFor` followed by `planFromRecipe`. There is no
second path: the recipe the folder ends up carrying is the one the manifest was
generated from.

### Why there is no `dash_agent_recipe` tool

It was considered and left out. The projection would be thin — `planFromDraft`
then `recipeFor` — but the value it adds over `dash_agent_plan` is a document
the caller can already obtain by scaffolding, and the cost is a fourth tool
competing for a model's attention in a server whose own design note says the
descriptions are what a model chooses between. `dash_agent_scaffold` writes
`agent.recipe.json`, and `dash_agent_validate` reads it back and reports drift;
that covers producing and consuming a recipe without a tool whose only job is
to show one.

## What `dash_agent_validate` now reports

Alongside the manifest verdict:

- `recipe_matches_manifest: true` when the folder's `agent.recipe.json` and
  `agent.manifest.json` describe the same agent;
- `recipe_matches_manifest: false` plus `recipe_drift[]` — each entry a JSON
  pointer into the manifest, what the recipe says, and what the manifest says —
  and one sentence saying to edit the recipe rather than the manifest.

A folder with no recipe gets neither field. Every agent scaffolded before this
existed has none, and a note about a missing file on a folder nothing is wrong
with is noise.

The drift check is deliberately narrow: identity, route, connections, and the
artifact kinds the panel binds. `provenance.generated_at` moves on every build
and comparing it would report drift on a correct folder.

---

## What `export_build_brief` in the other repository would need to emit

`conformance/v2/mar-426.runner-hosted.agent.manifest.json` is a pinned copy of
what that tool emits today: a **manifest**, not a recipe. To hand DASH a recipe
instead, it would need to emit the fields above, and three of them are where the
work actually is:

1. **`steps[].component_id` must be the id the generated program passes to
   `step()`**, not a name from a plan. `lib/analyze.ts` grades a run by matching
   executed steps to `planned_route` by exact string, so an id that describes an
   aspiration turns every correct run into a page of drift findings.
2. **`contract.emits` must be what the program actually sends.** A recipe
   claiming a brief its program never emits produces a panel section that is
   permanently empty, and `checkRecipeAgainstManifest` reports it as drift
   against the panel.
3. **`connections[]` must be ADR 0013 shaped and honest about ownership.** A
   `dash_managed` connection on an agent whose runtime is declared `remote` is
   refused at import by `checkManifestConstraints` (ADR 0006), and
   `validateRecipe` refuses it before a byte is written rather than at import.

A brief that cannot supply `steps[].intent` should send the component id twice
rather than invent a sentence: `validateRecipe` refuses an empty intent, and a
generated sentence that drifts from the step is worse than a repeated id,
because `AGENT_BUILDER.md` puts it in front of whoever edits the agent next.

## What is not proven

- **No live integration exists.** Nothing in this repository calls
  `export_build_brief`, and no MCP server outside this checkout has produced a
  recipe. `tests/fixtures/build-brief.recipe.json` is a **local fixture**
  produced by this repository's own `tools/dash-mcp/src/scaffold.ts` from an
  interview draft. It is a worked example of the shape and is not evidence that
  another tool emits it.
- **The other repository is unchanged.** Changing it is a separate delivery, and
  it needs the repository and the write ownership settled first (the plan's
  Etapp 2 item 5 says so).
- **No schema file.** The recipe is a TypeScript interface and a validator, not
  a JSON Schema under `contracts/`. `contracts/` holds cross-repository
  contracts; a recipe is an input to this repository's own generator, and
  promoting it to a contract is a decision that should follow a second producer
  existing rather than precede it.
