/**
 * What `create-dash-agent` writes, decided as data.
 *
 * Pure: it produces a list of files and never touches a disk. `agent-kit/cli.ts`
 * does the writing, and `tests/agent-kit.test.ts` asserts on the files this
 * returns — including that the manifest it generates validates against the same
 * `agent.manifest.v2.schema.json` the runner will hold it to, which is the whole
 * point of the template existing.
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

import path from "node:path";

import {
  DEFAULT_SOURCES,
  DIGEST_WRITE_COMPONENT,
  FEED_FETCH_COMPONENT,
  SOURCES_FILE_NAME,
} from "../lib/agent-sources";
import { isSafeAgentId } from "../lib/handoff";

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
}

/** The raw files the CLI carries and the scaffold copies verbatim. */
export interface TemplateSources {
  /** `agent-kit/template/agent.mjs`. */
  agent: string;
  /** The bundled `open-in-dash.mjs`, copied into the project's `scripts/`. */
  openInDash: string;
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

export function planScaffold(request: ScaffoldRequest, sources: TemplateSources): ScaffoldResult {
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

  return {
    ok: true,
    files: [
      {
        path: "agent.manifest.json",
        contents: `${JSON.stringify(scaffoldManifest(request), null, 2)}\n`,
      },
      { path: "package.json", contents: `${JSON.stringify(projectPackage(request), null, 2)}\n` },
      { path: "agent.mjs", contents: sources.agent },
      { path: "scripts/open-in-dash.mjs", contents: sources.openInDash },
      {
        path: SOURCES_FILE_NAME,
        contents: `${JSON.stringify({ sources: DEFAULT_SOURCES }, null, 2)}\n`,
      },
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
 * The Agent DOM block deliberately mirrors the shape MAR-426's
 * `export_build_brief` emits for a runner-hosted agent — the same runtime class,
 * the same control location id, the same four commands. That is what the issue's
 * "a build brief can be consumed without schema translation" means in practice:
 * a scaffold and a build brief produce documents DASH reads through one path,
 * and if they diverged, one of the two would quietly become the supported one.
 *
 * `retry`, `pause`, `resume` and `cancel` — and not `approve`, `reject` or
 * `choose`. A template with no approval gates that declared `approve` would be
 * offering DASH a button with nothing behind it, which
 * `docs/agent-dom-contract-v2.md` calls out as the failure to avoid: missing
 * controls mean read-only, not inferred controls.
 *
 * **Exported for MAR-576**, which needs the document without the project around
 * it. Re-importing an agent DASH scaffolded means producing the manifest this
 * template writes *today* for an agent that already exists — no directory, no
 * `agent.mjs`, no handoff. Calling `planScaffold` and fishing the manifest back
 * out of its `files` array would have worked and would have required inventing a
 * directory path that nothing writes to, which is the kind of unused argument
 * that later reads as a real one. `directory` is genuinely unread here; the
 * shared `ScaffoldRequest` keeps it because the scaffold proper needs it.
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
    // What this agent actually does, in the order it does it. See
    // `lib/agent-sources.ts` on why these are constants rather than literals,
    // and on why a scheduled-trigger step is deliberately absent while the
    // agent is manual-run-only.
    planned_route: [
      { step: 1, component_id: FEED_FETCH_COMPONENT, risk_level: "low", model_tier: "none" },
      { step: 2, component_id: DIGEST_WRITE_COMPONENT, risk_level: "low", model_tier: "none" },
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
      generated_by: `create-dash-agent ${request.kit_version}`,
      // Not a registry build. Saying so is better than borrowing a fingerprint
      // from a registry this agent was never composed against.
      registry_fingerprint: "agent-kit-template",
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
      // Empty, and that is the template's most useful property: it can be added
      // to DASH and watched working without anybody having a credential to hand.
      connections: [],
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
      control: {
        supported: true,
        command_version: 1,
        location_id: "dash_agent_runner_control",
        commands: ["retry", "pause", "resume", "cancel"],
      },
      memory: [],
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
      // The name a person will type. Not `postinstall` and not `prepare`: adding
      // something to DASH is a decision, and a decision does not belong on a
      // hook that fires during `npm install`.
      "open-in-dash": "node scripts/open-in-dash.mjs",
      start: "node agent.mjs",
    },
    engines: { node: ">=20.0.0" },
    dependencies: {},
  };
}

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

\`agent.mjs\` is the whole agent, in one file with no dependencies. The part
that does the work is \`runOnce\`; everything above it is how DASH watches and
controls it.

If you change what the agent *does* in a way that changes what it is allowed to
do, edit \`agent.manifest.json\` and run \`npm run open-in-dash\` again. DASH
asks you to confirm the change rather than applying it quietly — but only if
the agent is stopped first. DASH cannot replace files a running copy still has
open, and will say so rather than applying the change.
`;
}
