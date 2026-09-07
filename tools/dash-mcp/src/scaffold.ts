/**
 * The whole folder, as data (MAR-862, ADR 0032 decisions 5 and 6).
 *
 * Pure: it produces a list of files and touches no disk. `writeScaffold` does
 * the writing, and the tests assert on what this returns — including that the
 * manifest validates against the same `agent.manifest.v2.schema.json` the
 * runner will hold it to, which is the whole point of a template existing.
 *
 * ## Why this is not `agent-kit/scaffold.ts`
 *
 * It is deliberately close to it, and the kit's shape is where the proven parts
 * come from — the runtime class, the control location id, the four commands, an
 * empty `connections` array so the agent can be added and watched working
 * without anybody having a credential to hand.
 *
 * It diverges in one place, and the divergence is this packet's reason to
 * exist: the kit's template emits a v1 `digest` and stops. An agent that stops
 * there produces something readable and nothing judgeable. This one emits the
 * digest **and** a v2 `brief` bound to it by `derived_from`, so its output can
 * be adjudicated on its first run rather than after somebody remembers to make
 * it so. ADR 0032 records that the two templates now differ and that closing
 * the gap is somebody's later packet, so it is not discovered as a surprise.
 *
 * ## The second divergence (MAR-878)
 *
 * The kit's own template — and this one, until now — emitted `connections: []`
 * so DASH's ask composer (`lib/views/ask.ts`) refuses every agent this tool
 * builds with `no_provider`: there is no `connection_id` to spend against, so
 * every plugin-built agent is READY and unable to answer a single question.
 * `lib/sample-agent.ts`'s `declareModelProvider` already amends DASH's own
 * sample this way for exactly this reason (MAR-619); this file now does the
 * same thing for the agent a coding assistant builds, on the same ADR 0013
 * shape, `optional: true` so import never depends on a key existing. Only the
 * capability differs — the sample's step curates a digest and declares a
 * curate operation; this template's steps do not use a model at all, so the
 * connection exists purely for the "ask this agent a question" feature and
 * declares that operation instead. See `modelProviderConnection` below.
 */

import {
  SDK_VERSION,
  dashAgentsRootForThisMachine,
  defaultAcceptance,
  manifestFromRecipe,
  planFromRecipe,
  type AgentRecipe,
  type RecipePlan,
  type TargetState,
} from "../../../agent-kit/recipe";
import { FEED_FETCH_COMPONENT, DIGEST_WRITE_COMPONENT, SOURCES_FILE_NAME } from "../../../lib/agent-sources";
import { aiProviderById, type AiProviderId } from "../../../lib/ai/providers";

/**
 * Composing the brief.
 *
 * A literal, and `lib/agent-sources.ts` explains at length why literals here
 * are a hazard: `lib/analyze.ts` matches a run's executed steps to its
 * `planned_route` by exact `component_id`, so a name that drifts from the
 * registry's turns every step into `unplanned` drift and fills the verdict
 * surface with findings about an agent that did exactly what it said. There is
 * no exported constant for this one. It is the string the installed
 * `competitor-scout` already uses for the same step, and the template emits
 * exactly it — which is the property that actually has to hold.
 */
export const BRIEF_COMPOSE_COMPONENT = "brief_compose";

/**
 * The provider named when a caller does not choose one.
 *
 * OpenRouter for `lib/sample-agent.ts`'s own reason: it is the only one of the
 * three that prices its own answer, so a run's cost can be shown without DASH
 * holding a price list.
 */
export const DEFAULT_MODEL_PROVIDER: AiProviderId = "openrouter";

/** The connection id every agent this tool scaffolds uses for its model. */
const MODEL_PROVIDER_CONNECTION_ID = "model_provider";

/** The one field that connection asks for. */
const MODEL_PROVIDER_FIELD_ID = "api_key";

/**
 * The spend operation this connection's capability names.
 *
 * `${provider}.chat.completion` — the same id `lib/broker/operations.ts`'s
 * `completionOperation` builds for the ask feature (MAR-545) and the same one
 * `lib/chief/manifest.ts`'s `chiefOperationId` derives for the chief
 * principal. No import of either: this connection is neither the chief's nor
 * a curate step's, and importing a helper scoped to one of those to build a
 * string this file can build itself would say something about ownership that
 * is not true. What matters is that the three places agree on the literal
 * format, and `tools/dash-mcp/tests/scaffold.test.ts` pins this file's side of
 * that agreement by value.
 */
function chatCompletionOperationId(providerId: AiProviderId): string {
  return `${providerId}.chat.completion`;
}

/**
 * The one connection every agent this tool scaffolds declares (MAR-878).
 *
 * `dash_managed`, `optional: true`, and a `chat.completion` capability rather
 * than a curate one: this template's own steps never use a model
 * (`planned_route[].model_tier` is `"none"` throughout), so the only thing
 * this connection is for is the "ask this agent a question" feature — the one
 * DASH's ask composer refuses under `no_provider` when `agent_dom.connections`
 * is empty. See this file's own docblock for the fuller story.
 *
 * No `technical.environment_name`, deliberately: DASH holds this key and
 * spends it itself, and a manifest naming a delivery variable for a
 * model-provider field is refused at connect (`brokered_provider_delivery`,
 * ADR 0013 amendment 5).
 */
function modelProviderConnection(providerId: AiProviderId): Record<string, unknown> {
  return {
    id: MODEL_PROVIDER_CONNECTION_ID,
    provider: providerId,
    label: "Your model provider",
    purpose:
      "Lets you ask this agent questions about what it found. Any step you add later that " +
      "needs a model can use this same connection too.",
    ownership: "dash_managed",
    capabilities: [
      {
        id: chatCompletionOperationId(providerId),
        label: "Answer a question about what this agent found",
        access: "spend",
      },
    ],
    fields: [
      {
        id: MODEL_PROVIDER_FIELD_ID,
        label: "API key",
        purpose: "So DASH can reach this agent's model provider on its behalf.",
        kind: "secret",
        required: true,
        help: keySourceHelp(providerId),
        // No `technical.environment_name` — see the docblock above.
      },
    ],
    validation_action: {
      id: "test_model_key",
      label: "Check the key",
      behavior: "test",
    },
  };
}

/** Where to get a key, in the provider's own words. */
function keySourceHelp(providerId: AiProviderId): string {
  const label = aiProviderById(providerId)?.label ?? providerId;
  return `Your ${label} account has a keys page; a key made there is what DASH needs.`;
}

/**
 * The next action beside the inventory above: what still needs connecting,
 * and why pressing it is worth doing even though nothing is broken without it.
 *
 * `optional: true` is load-bearing, not polite (`lib/sample-agent.ts` makes the
 * same point about its own copy of this field): this agent fetches, composes a
 * brief and writes a digest with no model at all, and declaring this required
 * would show it as broken on a machine where it works exactly as documented.
 */
function modelProviderRequirement(): Record<string, unknown> {
  return {
    requirements_version: 1,
    requirements: [
      {
        id: MODEL_PROVIDER_CONNECTION_ID,
        name: "Your model provider",
        connector_kind: "api_key",
        connection_id: MODEL_PROVIDER_CONNECTION_ID,
        optional: true,
        why:
          "Without it this agent still collects what it finds and writes its digest; it just " +
          "cannot answer questions about what it found.",
      },
    ],
  };
}

export interface ScaffoldRequest {
  /** Absolute path of the project directory. */
  directory: string;
  /** The agent's id, which is also its manifest's `agent.name`. */
  agent_id: string;
  /** What to call it in DASH. */
  display_name: string;
  /** One sentence a novice can read. */
  summary: string;
  /** What it should read. Empty falls back to the template's own list. */
  sources: readonly FeedSource[];
  now: Date;
  /**
   * What is already at `directory`, when the caller has looked. A caller about
   * to write should pass `readTargetState(directory)`; `scaffoldAgent` does.
   */
  target?: TargetState;
  /**
   * Entries in `target` this build is allowed to find there. `scaffoldAgent`
   * names `.dash`, the folder `dash_agent_interview` saves its draft in, and
   * nothing else.
   */
  overwrite?: readonly string[];
  /**
   * Which provider the manifest's `model_provider` connection names (MAR-878).
   *
   * Defaults to `DEFAULT_MODEL_PROVIDER`. Match this to whatever the person has
   * already connected under DASH → Settings → AI — the connection adopts a
   * fleet key by provider id, so naming the wrong one means the fleet's
   * "Give it to N waiting agents" button never counts this agent.
   */
  model_provider?: AiProviderId;
}

export interface FeedSource {
  name: string;
  url: string;
  format: "rss" | "atom" | "hn_algolia";
}

export interface ScaffoldedFile {
  /** Relative to the project directory, forward slashes. */
  path: string;
  contents: string;
}

export type ScaffoldPlan =
  | { ok: true; files: ScaffoldedFile[] }
  | { ok: false; problem: string };

/** What the scaffold reads off disk, passed in so this stays pure. */
export interface TemplateSources {
  /** `tools/dash-mcp/template/agent.mjs`. */
  agent: string;
  /**
   * `agent-kit/template/evals/run-evals.mjs` (MAR-888). The Agent Kit's, for
   * the same reason the runtime is: there is one set of acceptance checks and
   * both scaffolders write the same bytes. Everything about *this* agent
   * reaches it through the generated `evals/cases.json`.
   */
  evals: string;
  /**
   * `agent-kit/template/dash-agent-sdk.mjs`. Copied verbatim.
   *
   * Read from the Agent Kit's template directory rather than from this
   * package's, because there is exactly one runtime and both scaffolders write
   * the same bytes. A second copy under `tools/dash-mcp/template/` would be a
   * fork with a build date on it, and ADR 0032 decision 4 already refuses that
   * shape for the validator; ADR 0034 refuses it for the runtime.
   */
  sdk: string;
  /** The bundled `open-in-dash.mjs`, copied into the project's `scripts/`. */
  openInDash: string;
}

/**
 * Turn what somebody typed into an id a file system and a manifest both accept.
 *
 * Lossy on purpose and reported as such by the caller: "My Agent!" becoming
 * `my-agent` is what everyone expects, and silently accepting `My Agent!` would
 * put a space in a file name and a shell argument.
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

/** The sources a scaffold gets when the caller names none. */
export const TEMPLATE_SOURCES: readonly FeedSource[] = [
  {
    name: "Hacker News front page",
    url: "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=20",
    format: "hn_algolia",
  },
];

export function planScaffold(request: ScaffoldRequest, sources: TemplateSources): ScaffoldPlan {
  return asPlan(
    planFromRecipe(
      recipeFor(request),
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
        overwrite: request.overwrite,
        dashAgentsRoot: dashAgentsRootForThisMachine(),
      },
    ),
  );
}

/**
 * A recipe plan in this module's older shape.
 *
 * `planFromRecipe` reports structured problems and this collapses them into the
 * one sentence `ScaffoldPlan` carries. Nothing a caller reads is lost:
 * `scaffoldAgent` puts the manifest through `verdictForManifest` itself and
 * renders *those* problems, with a JSON pointer and the schema's own words at
 * each one, which is the shape a coding assistant can act on.
 */
function asPlan(plan: RecipePlan): ScaffoldPlan {
  if (plan.ok) {
    return { ok: true, files: plan.files };
  }
  const detail = plan.problems?.map((entry) => `${entry.where}: ${entry.problem}`).join(" ");
  return { ok: false, problem: detail === undefined ? plan.problem : `${plan.problem} ${detail}` };
}

/**
 * This tool's own recipe for one request (MAR-888).
 *
 * Everything that makes an agent this tool builds different from one the Agent
 * Kit builds is here and nowhere else: a third step that composes a brief, the
 * pair of documents one run emits, the model-provider connection MAR-878 added
 * so the agent can be asked a question, the write permission its report file
 * needs, and a panel with the evidence and the account side by side. The
 * skeleton the two share — manifest version, safety contract, monitoring,
 * runtime, trigger, locations, control — is assembled by `manifestFromRecipe`
 * and is no longer transcribed here.
 */
export function recipeFor(request: ScaffoldRequest): AgentRecipe {
  const provider = request.model_provider ?? DEFAULT_MODEL_PROVIDER;
  const emits = [
    { kind: "digest" as const, artifact_version: 1 as const },
    { kind: "brief" as const, artifact_version: 2 as const },
  ];
  const feeds = request.sources.length === 0 ? TEMPLATE_SOURCES : request.sources;

  return {
    recipe_version: 1,
    runtime: {
      sdk_version: SDK_VERSION,
      kit_version: "dash-mcp",
      generated_by: "dash-mcp dash_agent_scaffold",
      // Not a registry build. Saying so is better than borrowing a fingerprint
      // from a registry this agent was never composed against.
      registry_fingerprint: "dash-mcp-template",
      dependencies: {},
    },
    agent: {
      id: request.agent_id,
      display_name: request.display_name.trim(),
      summary: request.summary.trim(),
    },
    /*
     * What this agent actually does, in the order it does it — and these are
     * the three ids `template/agent.mjs` passes to `step()`, in the same order.
     * That correspondence is the whole contract of this block: `lib/analyze.ts`
     * grades a run by matching executed steps to this list, so a route that
     * describes an aspiration rather than the program produces drift findings
     * on a perfectly correct run.
     *
     * No scheduled-trigger step, deliberately. The agent is manual-run-only, and
     * a route declaring a step that never runs is `missing_step` drift on every
     * single run.
     */
    steps: [
      {
        component_id: FEED_FETCH_COMPONENT,
        intent: "Reads each of the sources you listed.",
        risk_level: "low",
        model_tier: "none",
      },
      {
        component_id: BRIEF_COMPOSE_COMPONENT,
        intent:
          "Writes a short summary of what came in, citing the items it is talking about.",
        risk_level: "low",
        model_tier: "none",
      },
      {
        component_id: DIGEST_WRITE_COMPONENT,
        intent: "Saves the whole roundup, with every item’s own address kept.",
        risk_level: "low",
        model_tier: "none",
      },
    ],
    sources: [...feeds],
    // One connection, `optional: true` (MAR-878): the agent can still be added
    // to DASH and watched working with zero keys held, because nothing it does
    // needs a model — ADR 0032 decision 1's point holds exactly as it did when
    // this was `[]`. What changed is that a person who wants to ask it a
    // question now has a connection to press Connect on, instead of a refusal
    // with nothing behind it.
    connections: [modelProviderConnection(provider)],
    // The next-action half of the same connection (MAR-569) — what puts a line
    // with a Connect button on the Connections page for somebody who has not
    // connected one yet.
    connection_requirements: modelProviderRequirement(),
    contract: {
      consumes: [SOURCES_FILE_NAME],
      emits,
    },
    permissions: {
      read: [
        {
          id: "network",
          label: "Read the sources you choose",
          detail:
            "Fetches the addresses listed in this agent's own sources file. It sends nothing and changes nothing.",
        },
      ],
      write: [
        {
          id: "report_file",
          label: "Save a report inside its own folder",
          detail:
            "Writes one file into the reports folder inside this agent's own folder, and nowhere else.",
        },
      ],
      approval_required_for: [],
    },
    /*
     * The panel this agent asks DASH to draw for it (ADR 0008).
     *
     * Four sections, and the first two are the pair MAR-862 was about. A
     * digest and a brief are two different questions — "what did it find?"
     * and "what does it say about what it found?" — and `lib/views/panel.ts`
     * resolves `artifact_role` against an artifact's own `kind`, so naming
     * both roles is what puts the evidence and the account on one screen
     * beside each other.
     *
     * `metrics` is DASH's question about the agent rather than the agent's
     * about the news: every item is a `dash_fact`, so every value renders
     * attributed to DASH.
     */
    panel: {
      panel_version: 1,
      title: "What it found, and what it makes of it",
      sections: [
        {
          id: "latest_brief",
          type: "report",
          label: "What it makes of this run",
          artifact_role: "brief",
        },
        {
          id: "latest_digest",
          type: "report",
          label: "Everything it collected",
          artifact_role: "digest",
        },
        {
          id: "headlines",
          type: "table",
          label: "Every item in the latest digest",
          source_role: "digest",
          columns: [
            { key: "headline", label: "Headline", kind: "text" },
            { key: "source_name", label: "Source", kind: "text" },
            { key: "published_at", label: "Published", kind: "timestamp" },
          ],
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
      ],
    },
    acceptance: defaultAcceptance(emits),
  };
}

/* ---------------------------------------------------------------------- *
 * The manifest
 * ---------------------------------------------------------------------- */

/**
 * A manifest v2 for a runner-hosted agent with no connections.
 *
 * Exported without the project around it, the way the kit exports its own, so a
 * caller can be shown the document it is about to get before any of it is
 * written.
 */
export function scaffoldManifest(request: ScaffoldRequest): Record<string, unknown> {
  return manifestFromRecipe(recipeFor(request), request.now);
}

/* ---------------------------------------------------------------------- *
 * The rest of the project
 * ---------------------------------------------------------------------- */

function gitignore(): string {
  return [
    "node_modules/",
    "",
    "# What runs of this agent produce. Yours, and not source.",
    "reports/",
    "runs/",
    "",
    "# A single-use proof of possession, written when this agent is handed to",
    "# DASH and never worth committing.",
    "dash-handoff.json",
    "",
  ].join("\n");
}

function readme(request: ScaffoldRequest): string {
  return [
    `# ${request.display_name}`,
    "",
    request.summary,
    "",
    "## Adding it to DASH",
    "",
    "```",
    "npm run open-in-dash",
    "```",
    "",
    "DASH opens and asks before it stores anything. It takes its **own copy** of",
    "this folder — this one stays yours, and stays where it is.",
    "",
    "That matters more than it sounds: DASH swaps an agent's stored folder on",
    "every import rather than editing it, so editing DASH's copy directly loses",
    "the change on the next import. Edit here, then run the command again.",
    "",
    "## What it produces",
    "",
    "Every run emits two documents.",
    "",
    "- A **digest** — the raw roundup. Every item keeps the address it came from.",
    "- A **brief** — a short document about that digest, where every paragraph",
    "  cites the items it is talking about by position.",
    "",
    "The brief carries `derived_from`: the digest's id, its run, how many items it",
    "had, and a fingerprint of them in order. DASH recomputes that fingerprint and",
    "draws the brief with no citations at all if it disagrees, because a link under",
    "a claim it does not support is worse than no link. That is what makes this",
    "agent's output something that can be judged rather than only read.",
    "",
    "## The files",
    "",
    "| File | What it is |",
    "| -- | -- |",
    "| `agent.mjs` | The agent. `runOnce` is yours; the rest is plumbing. |",
    "| `sources.json` | What it reads. Edit freely. |",
    "| `agent.recipe.json` | What this agent is. The manifest is generated from it. |",
    "| `agent.manifest.json` | What it promises DASH. Generated \u2014 edit the recipe instead. |",
    "| `evals/` | Four checks that say whether it still works. |",
    "| `AGENT_BUILDER.md` | The longer version of this table, for whoever changes it next. |",
    "| `dash-agent-sdk.mjs` | **Do not edit.** DASH's runtime, and DASH upgrades it. |",
    "",
    "## Checking it",
    "",
    "```",
    "npm run evals",
    "```",
    "",
    "Four cases with no network and no key: a normal run, a run with nothing to",
    "read, a run where a source fails, and a run where every brokered request is",
    "refused. They spawn this agent the way DASH's runner does.",
    "",
    "## Running it outside DASH",
    "",
    "```",
    "npm start",
    "```",
    "",
    "It starts idle and waits, which is the same thing it does inside DASH. It",
    "speaks newline-delimited JSON on stdout; send it",
    '`{"type":"command","command":"retry","command_id":"1"}` on stdin to make it run.',
    "",
  ].join("\n");
}
