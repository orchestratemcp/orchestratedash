/**
 * What `create-dash-agent` writes, decided as data.
 *
 * Pure: it produces a list of files and never touches a disk. `agent-kit/cli.ts`
 * does the writing, and `tests/agent-kit.test.ts` asserts on the files this
 * returns — including that the manifest it generates validates against the same
 * `agent.manifest.v2.schema.json` the runner will hold it to, which is the whole
 * point of the template existing.
 *
 * ## This module is now an adapter (MAR-888)
 *
 * The manifest is no longer assembled here. `agent-kit/recipe.ts` holds one
 * `AgentRecipe` shape and one `planFromRecipe`, and the three programs that
 * write a DASH agent folder — this one, `lib/sample-agent.ts` and
 * `tools/dash-mcp/src/scaffold.ts` — all go through it. What is left here is
 * this scaffolder's *recipe*: two steps, no connections, the panel a digest
 * needs, and the README that describes this particular program. Everything the
 * three agents share is assembled once, in one file, so a correction to it
 * cannot land in one copy.
 *
 * `ScaffoldRequest` and `planScaffold` keep their shape so every existing
 * caller and every existing test still works.
 *
 * ## The first supported template, and only the first
 *
 * MAR-428's non-goals are explicit: no multi-language Agent Kit matrix. So there
 * is one template, it is Node, and it is shaped by what the runner already
 * requires rather than by what a language ecosystem would prefer. The three
 * things it wires by default are the three things the issue names:
 *
 * - **Manifest v2**, with the Agent DOM block the runner refuses to spawn
 *   without, in the same shape MAR-426's emitter produces so a build brief and a
 *   scaffold are the same kind of document.
 * - **Telemetry v1**, as the event contract, emitted by the generated agent.
 * - **The runner protocol**, newline-delimited JSON over the child's own stdin
 *   and stdout, answered by the generated agent from its first line.
 *
 * ## Why the generated agent has no dependencies
 *
 * `npm install` in a scaffold that pulls a tree is a scaffold that can fail on
 * somebody's corporate network before they have seen anything work. The template
 * is plain Node with an empty dependency list, so "create it, run it, add it"
 * involves no registry at all after the scaffold itself.
 */

import {
  RECIPE_FILE_NAME,
  SDK_VERSION,
  dashAgentsRootForThisMachine,
  defaultAcceptance,
  manifestFromRecipe,
  planFromRecipe,
  type AgentRecipe,
  type RecipePlan,
  type TargetState,
} from "./recipe";
import {
  DEFAULT_SOURCES,
  DIGEST_WRITE_COMPONENT,
  FEED_FETCH_COMPONENT,
  SOURCES_FILE_NAME,
} from "../lib/agent-sources";

export { RECIPE_FILE_NAME, SDK_VERSION } from "./recipe";

export interface ScaffoldRequest {
  /** Absolute path of the directory to create. */
  directory: string;
  /** The agent's id, which is also its manifest's `agent.name`. */
  agent_id: string;
  /** What to call it in DASH. */
  display_name: string;
  /** One sentence a novice can read. */
  summary: string;
  /** Recorded in the manifest's provenance. */
  kit_version: string;
  now: Date;
  /**
   * What is already at `directory`, when the caller has looked.
   *
   * Optional so this module stays pure for the callers that plan without a
   * disk — `lib/sample-agent.ts` chooses a folder name nothing has taken, and
   * `tests/agent-kit.test.ts` plans against a path that does not exist yet. A
   * caller that is about to write should pass `readTargetState(directory)`, and
   * `agent-kit/cli.ts` does.
   */
  target?: TargetState;
}

/** The raw files the CLI carries and the scaffold copies verbatim. */
export interface TemplateSources {
  /** `agent-kit/template/agent.mjs`. */
  agent: string;
  /**
   * `agent-kit/template/dash-agent-sdk.mjs` — the runtime `agent.mjs` imports.
   *
   * A file inside the project rather than a dependency, because a scaffolded
   * project has an empty dependency list on purpose and the packaged sample is
   * copied as raw bytes with no registry anywhere in the journey. ADR 0034
   * records the decision and the two alternatives it rejects.
   */
  sdk: string;
  /** The bundled `open-in-dash.mjs`, copied into the project's `scripts/`. */
  openInDash: string;
  /**
   * `agent-kit/template/evals/run-evals.mjs` — the four acceptance checks
   * (MAR-888).
   *
   * Carried the same way the runtime is, and for the same reason: the project
   * has no dependencies, so a check that needed one could not run. It is
   * generic — everything about *this* agent reaches it through the generated
   * `evals/cases.json`.
   */
  evals: string;
}

export interface ScaffoldedFile {
  /** Relative to the project directory, using forward slashes. */
  path: string;
  contents: string;
}

export type ScaffoldResult =
  | { ok: true; files: ScaffoldedFile[] }
  | { ok: false; problem: string };

/**
 * Turn what somebody typed into an id a file system and a manifest both accept.
 *
 * Lossy on purpose and reported as such by the caller: "My Agent!" becoming
 * `my-agent` is what everyone expects, and silently accepting `My Agent!` as an
 * id would put a space in a file name and a shell argument.
 */
export function deriveAgentId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/-+$/, "")
    .slice(0, 64);
}

/**
 * The Agent Kit's own recipe for one request.
 *
 * Exported because `lib/sample-agent.ts` amends it: DASH's own sample is this
 * agent plus two declarations DASH is entitled to make on its own behalf and a
 * blank scaffold is not (MAR-603, MAR-619). Amending the *recipe* rather than
 * the finished manifest is what keeps `agent.recipe.json` and
 * `agent.manifest.json` in agreement on disk — a sample whose recipe said
 * "no connections" while its manifest declared one would be reported as drift
 * by the check this packet added.
 */
export function recipeFor(request: ScaffoldRequest): AgentRecipe {
  const emits = [{ kind: "digest" as const, artifact_version: 1 as const }];
  return {
    recipe_version: 1,
    runtime: {
      sdk_version: SDK_VERSION,
      kit_version: request.kit_version,
      generated_by: `create-dash-agent ${request.kit_version}`,
      // Not a registry build. Saying so is better than borrowing a fingerprint
      // from a registry this agent was never composed against.
      registry_fingerprint: "agent-kit-template",
      dependencies: {},
    },
    agent: {
      id: request.agent_id,
      display_name: request.display_name.trim(),
      summary: request.summary.trim(),
    },
    // What this agent actually does, in the order it does it. See
    // `lib/agent-sources.ts` on why these are constants rather than literals,
    // and on why a scheduled-trigger step is deliberately absent while the
    // agent is manual-run-only.
    steps: [
      {
        component_id: FEED_FETCH_COMPONENT,
        intent: "Reads each of the sources you listed.",
        risk_level: "low",
        model_tier: "none",
      },
      {
        component_id: DIGEST_WRITE_COMPONENT,
        intent: "Saves the whole roundup, with every item's own address kept.",
        risk_level: "low",
        model_tier: "none",
      },
    ],
    sources: [...DEFAULT_SOURCES],
    // Empty, and that is the template's most useful property: it can be added
    // to DASH and watched working without anybody having a credential to hand.
    connections: [],
    contract: {
      consumes: [SOURCES_FILE_NAME],
      emits,
    },
    // What it may do that needs no credential — the case `connections` cannot
    // express, since every connection requirement carries an owner, fields and
    // a validation action.
    //
    // A declaration, not a boundary. The runner strips the environment but
    // spawns an ordinary process with ordinary network access, so this says
    // what the agent claims and who to ask about it. No surface built on it
    // may imply DASH enforces it — the same honesty ADR 0002 requires of the
    // draft-only Gmail boundary.
    permissions: {
      read: [
        {
          id: "network",
          label: "Read the news sources you choose",
          detail:
            "Fetches the addresses listed in this agent's own sources file. It sends nothing and changes nothing.",
        },
      ],
      write: [],
      approval_required_for: [],
    },
    /*
     * The panel this agent asks DASH to draw for it (MAR-548, ADR 0008).
     *
     * Three sections, and the reason there are three is that a digest is
     * three different questions. `report` is "what did it find?", rendered
     * through the same digest machinery the run detail page uses. `metrics`
     * is "is it still working?", which is DASH's question about the agent
     * rather than the agent's about the news — every item here is a
     * `dash_fact`, so every value on it renders attributed to DASH. `table`
     * is "show me everything at once", which the prose digest deliberately
     * does not do.
     *
     * The bindings name roles and nothing else. `digest` is the artifact
     * kind this agent's own `artifact()` call emits, and the three column
     * keys are members of the digest item shape
     * `contracts/run-artifact.schema.json` defines — `headline`,
     * `source_name` and `published_at`. A key that names nothing renders as
     * an absent cell rather than as an error, which is what makes this safe
     * to declare before the first run has produced anything.
     *
     * `published_at` is declared `timestamp` rather than `text`, and that is
     * the load-bearing word: it is the author telling DASH the value is a
     * moment, which is the licence DASH needs to render it in its own words
     * instead of shipping `2026-08-05T09:00:00.000Z` onto a guided surface.
     */
    panel: {
      panel_version: 1,
      title: "What the scout found",
      sections: [
        {
          id: "latest_digest",
          type: "report",
          label: "The latest digest",
          artifact_role: "digest",
        },
        {
          id: "activity",
          type: "metrics",
          label: "How this agent has been doing",
          items: [
            {
              id: "run_count",
              label: "Times it has run",
              source: { kind: "dash_fact", fact: "run_count" },
            },
            {
              id: "last_run_at",
              label: "Last checked",
              source: { kind: "dash_fact", fact: "last_run_at" },
            },
            {
              id: "last_run_verdict",
              label: "How the last run ended",
              source: { kind: "dash_fact", fact: "last_run_verdict" },
            },
          ],
        },
        {
          id: "headlines",
          type: "table",
          label: "Every headline in the latest digest",
          source_role: "digest",
          columns: [
            { key: "headline", label: "Headline", kind: "text" },
            { key: "source_name", label: "Source", kind: "text" },
            { key: "published_at", label: "Published", kind: "timestamp" },
          ],
        },
      ],
    },
    acceptance: defaultAcceptance(emits),
  };
}

/**
 * Plan the project, optionally amending the recipe first.
 *
 * `amend` is `lib/sample-agent.ts`'s hook and exists for one reason: DASH's own
 * sample is this agent plus declarations DASH is entitled to make and a blank
 * scaffold is not. Before MAR-888 the sample rewrote the finished
 * `agent.manifest.json` after `planScaffold` returned, which was fine while the
 * manifest was the only document — and would now write a folder whose recipe
 * and manifest disagree the moment it was created. Amending the recipe means
 * one document is edited and the other is derived from it, which is the whole
 * property this packet is for.
 */
export function planScaffold(
  request: ScaffoldRequest,
  sources: TemplateSources,
  amend?: (recipe: AgentRecipe) => AgentRecipe,
): ScaffoldResult {
  const recipe = recipeFor(request);
  return asScaffoldResult(
    planFromRecipe(
      amend === undefined ? recipe : amend(recipe),
      {
        agent: sources.agent,
        sdk: sources.sdk,
        openInDash: sources.openInDash,
        evals: sources.evals,
        readme: readme(request),
        gitignore: gitignore(),
      },
      {
        directory: request.directory,
        now: request.now,
        target: request.target,
        dashAgentsRoot: dashAgentsRootForThisMachine(),
      },
    ),
  );
}

/**
 * A recipe plan in this module's older shape.
 *
 * `problems` is deliberately flattened into `problem`: every caller of
 * `planScaffold` — the CLI, the sample, the tests — renders one sentence, and a
 * scaffolder that has to teach every caller a second error shape to gain a
 * detail none of them shows is a scaffolder nobody upgrades. The MCP, which
 * does show structured problems, calls `planFromRecipe` directly.
 */
function asScaffoldResult(plan: RecipePlan): ScaffoldResult {
  if (plan.ok) {
    return { ok: true, files: plan.files };
  }
  const detail = plan.problems?.map((entry) => `${entry.where}: ${entry.problem}`).join(" ");
  return { ok: false, problem: detail === undefined ? plan.problem : `${plan.problem} ${detail}` };
}

/* ---------------------------------------------------------------------- *
 * The manifest
 * ---------------------------------------------------------------------- */

/**
 * A manifest v2 for a runner-hosted agent with no connections.
 *
 * Assembled by `manifestFromRecipe` since MAR-888; this is the Agent Kit's
 * recipe put through it. The Agent DOM block deliberately mirrors the shape
 * MAR-426's `export_build_brief` emits for a runner-hosted agent — the same
 * runtime class, the same control location id, the same four commands. That is
 * what the issue's "a build brief can be consumed without schema translation"
 * means in practice: a scaffold and a build brief produce documents DASH reads
 * through one path, and if they diverged, one of the two would quietly become
 * the supported one.
 *
 * **Exported for MAR-576**, which needs the document without the project around
 * it. Re-importing an agent DASH scaffolded means producing the manifest this
 * template writes *today* for an agent that already exists — no directory, no
 * `agent.mjs`, no handoff. `directory` is genuinely unread here; the shared
 * `ScaffoldRequest` keeps it because the scaffold proper needs it.
 */
export function scaffoldManifest(request: ScaffoldRequest): Record<string, unknown> {
  return manifestFromRecipe(recipeFor(request), request.now);
}

/* ---------------------------------------------------------------------- *
 * The rest of the project
 * ---------------------------------------------------------------------- */

function gitignore(): string {
  return `node_modules/

# The handoff carries a single-use code that lets DASH open this agent's
# proposal. It is regenerated every time you run "open-in-dash", it expires,
# and it has no business in version control.
dash-handoff.json

# What the agent itself produced.
reports/
runs/
`;
}

/**
 * The project README, written for the person who just ran one command.
 *
 * Three steps, in the order they happen, with no vocabulary from inside DASH in
 * any of them. There is no mention of a manifest path, a registration file or a
 * runner: those are all real and all DASH's business, and a person adding their
 * first agent needs to know none of them.
 *
 * `AGENT_BUILDER.md` beside it is the other half and is written for somebody
 * else entirely — the coding assistant that will change this agent. Two files
 * because they are two audiences: a person adding their first agent should not
 * have to read past instructions about a recipe to find the one command they
 * need.
 */
function readme(request: ScaffoldRequest): string {
  return `# ${request.display_name}

${request.summary}

## Add it to DASH

\`\`\`sh
npm run open-in-dash
\`\`\`

DASH opens and asks whether to add this agent. Say yes and it appears in DASH,
waiting. **It does not run until you press Run now** — it reads nothing and
reaches nowhere until you ask it to.

If nothing happens, DASH is probably not installed yet. The command prints a
link you can open by hand once it is.

## Change what it watches

Edit \`${SOURCES_FILE_NAME}\`. Each entry needs a name you will recognise, the
address to read, and which kind of feed it is — \`rss\`, \`atom\`, or
\`hn_algolia\`. The kind is declared rather than guessed, so a source that
starts answering with an error page is reported as a problem instead of being
read as an empty feed.

Every run writes its digest into \`reports\` and hands DASH a copy with each
item's source attached.

## Make it yours

\`agent.mjs\` is the part that does the work, and \`runOnce\` is one run of it.
Change what it reads, what it collects and what it says about it.
\`AGENT_BUILDER.md\` is the longer version of that, written for a coding
assistant: which files are yours, which are not, and how to check your changes.

\`dash-agent-sdk.mjs\` beside it is DASH's, and you should not edit it: it is how
DASH watches and controls the agent, and DASH replaces that file when it has a
newer one. An edit there is an edit you lose. There are no dependencies in
either file.

## Check it still works

\`\`\`sh
npm run evals
\`\`\`

Four checks against this agent, with no network and no key: a normal run, a run
with nothing to read, a run where a source fails, and a run where DASH refuses
what it asks for.

If you change what the agent *does* in a way that changes what it is allowed to
do, edit \`${RECIPE_FILE_NAME}\` and run \`npm run open-in-dash\` again. DASH
asks you to confirm the change rather than applying it quietly — but only if
the agent is stopped first. DASH cannot replace files a running copy still has
open, and will say so rather than applying the change.
`;
}
