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
 */

import path from "node:path";

import { FEED_FETCH_COMPONENT, DIGEST_WRITE_COMPONENT, SOURCES_FILE_NAME } from "../../../lib/agent-sources";
import { isSafeAgentId } from "../../../lib/handoff";

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
const BRIEF_COMPOSE_COMPONENT = "brief_compose";

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
  /** `tools/dash-mcp/template/brief-fingerprint.mjs`. Copied verbatim. */
  fingerprint: string;
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
  if (!isSafeAgentId(request.agent_id)) {
    return {
      ok: false,
      problem:
        `“${request.agent_id}” cannot be used as an agent name. ` +
        "Use lowercase letters, digits, dots, dashes and underscores, starting with a letter or digit.",
    };
  }
  if (!path.isAbsolute(request.directory)) {
    return { ok: false, problem: "The project directory must be a full path." };
  }
  if (request.display_name.trim().length === 0 || request.summary.trim().length === 0) {
    return { ok: false, problem: "An agent needs a name and a one-sentence description." };
  }

  const feeds = request.sources.length === 0 ? TEMPLATE_SOURCES : request.sources;

  return {
    ok: true,
    files: [
      {
        path: "agent.manifest.json",
        contents: `${JSON.stringify(scaffoldManifest(request), null, 2)}\n`,
      },
      { path: "package.json", contents: `${JSON.stringify(projectPackage(request), null, 2)}\n` },
      { path: "agent.mjs", contents: sources.agent },
      { path: "brief-fingerprint.mjs", contents: sources.fingerprint },
      { path: "scripts/open-in-dash.mjs", contents: sources.openInDash },
      { path: SOURCES_FILE_NAME, contents: `${JSON.stringify({ sources: feeds }, null, 2)}\n` },
      { path: "README.md", contents: readme(request) },
      { path: ".gitignore", contents: gitignore() },
    ],
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
  return {
    manifest_version: 2,
    agent: {
      name: request.agent_id,
      display_name: request.display_name,
      goal: request.summary,
      plan_source: "composed",
      playbook_id: "",
      route_id: "",
      build_target: "code",
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
    planned_route: [
      { step: 1, component_id: FEED_FETCH_COMPONENT, risk_level: "low", model_tier: "none" },
      { step: 2, component_id: BRIEF_COMPOSE_COMPONENT, risk_level: "low", model_tier: "none" },
      { step: 3, component_id: DIGEST_WRITE_COMPONENT, risk_level: "low", model_tier: "none" },
    ],
    safety_contract: {
      // L1: it acts on its own folder and nothing else, and there is no
      // irreversible component to gate. Claiming a higher clearance for a
      // template would teach every agent built from it to overstate itself.
      automation_clearance: "L1",
      enforced_approval_gates: [],
      irreversible_components: [],
    },
    monitoring: {
      events: [
        "run_started",
        "step_started",
        "step_completed",
        "gate_requested",
        "gate_resolved",
        "run_completed",
        "run_failed",
      ],
      endpoint_env: "DASH_INGEST_URL",
      token_env: "DASH_INGEST_TOKEN",
      output_location: "runs/events.jsonl inside the agent's own folder",
    },
    provenance: {
      generated_by: "dash-mcp dash_agent_scaffold",
      // Not a registry build. Saying so is better than borrowing a fingerprint
      // from a registry this agent was never composed against.
      registry_fingerprint: "dash-mcp-template",
      generated_at: request.now.toISOString(),
    },
    agent_dom: {
      dom_version: 1,
      runtime: {
        class: "local_process",
        label: "DASH Agent Runner on this computer",
        availability: "on_demand",
        continues_when_dash_closed: true,
      },
      trigger: {
        type: "manual",
        label: "Only when you ask it to run",
        technical: {
          what_wakes_it_up: "The runner starts this process when a person asks DASH to.",
          offline_behavior: "No run starts while the computer or the runner is off.",
          limitation: "No schedule and no inbound event is configured.",
        },
      },
      locations: {
        runtime: {
          id: `${request.agent_id}-runtime`,
          label: "DASH Agent Runner on this computer",
          kind: "local",
          offline_behavior:
            "Continues after the DASH window closes while this computer and runner remain on.",
        },
        control: [
          {
            id: "dash_agent_runner_control",
            label: "DASH Agent Runner control adapter",
            kind: "dash",
            offline_behavior: "Unavailable while the computer or the runner is off.",
          },
        ],
        interaction: [
          {
            id: "dash_workspace",
            label: "DASH agent workspace",
            kind: "dash",
            offline_behavior: "Last safe state is read-only while the runner is unavailable.",
          },
        ],
      },
      // Empty, and that is this template's most useful property: it can be
      // added to DASH and watched working without anybody having a credential.
      // ADR 0032 decision 1 — a scaffold that needed a key before it could show
      // anything would be a scaffold nobody finishes.
      connections: [],
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
      control: {
        supported: true,
        command_version: 1,
        location_id: "dash_agent_runner_control",
        commands: ["retry", "pause", "resume", "cancel"],
      },
      memory: [],
      /*
       * The panel this agent asks DASH to draw for it (ADR 0008).
       *
       * Four sections, and the first two are the pair this packet is about. A
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
    },
  };
}

/* ---------------------------------------------------------------------- *
 * The rest of the project
 * ---------------------------------------------------------------------- */

function projectPackage(request: ScaffoldRequest): Record<string, unknown> {
  return {
    name: request.agent_id,
    version: "0.1.0",
    private: true,
    description: request.summary,
    type: "module",
    scripts: {
      "open-in-dash": "node scripts/open-in-dash.mjs",
      start: "node agent.mjs",
    },
    engines: { node: ">=20.0.0" },
    dependencies: {},
  };
}

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
    "| `agent.manifest.json` | What it promises DASH. |",
    "| `brief-fingerprint.mjs` | **Do not edit.** One half of a function DASH holds the other half of. |",
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
