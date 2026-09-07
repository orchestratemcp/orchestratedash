/**
 * The build recipe: one document three scaffolders build the same agent from
 * (MAR-888, stage 2 of MAR-886).
 *
 * ## The problem this exists for
 *
 * Three programs write a DASH agent folder today. `agent-kit/scaffold.ts` for
 * somebody at a terminal, `lib/sample-agent.ts` for DASH's own "Try a sample
 * agent", and `tools/dash-mcp/src/scaffold.ts` for a coding assistant. Stage 1
 * (ADR 0034) closed the fork in the *runtime* those three write; this closes
 * the fork in the *document* they write about it.
 *
 * Before this module, each of the three assembled a manifest v2 literal of its
 * own — the same `manifest_version`, the same `safety_contract`, the same
 * `monitoring` block, the same runtime/trigger/locations/control skeleton,
 * transcribed. Two of them had already drifted in ways nobody chose: one
 * declared `permissions.write` and the other did not, one panel put the metrics
 * section first and the other last. A correction to any of it landed in one
 * copy.
 *
 * So the skeleton is assembled once, here, and what actually differs between
 * the three agents is *data* on an `AgentRecipe`: which steps it runs, what it
 * reads, which connections it declares, what one run emits, and the panel it
 * asks DASH to draw. `planFromRecipe` turns that into the exact file list a
 * scaffolder writes.
 *
 * ## Validated before the first byte
 *
 * `validateRecipe` runs the recipe's own shape rules *and* puts the manifest it
 * would produce through `validateManifest` and `checkManifestConstraints` —
 * DASH's own import verdict — before `planFromRecipe` returns a single file. A
 * scaffolder that validates afterwards has already written a folder somebody
 * now has to clean up; the MCP's `scaffoldAgent` learned that the hard way and
 * this module makes the order structural rather than remembered.
 *
 * ## The recipe travels with the agent
 *
 * `agent.recipe.json` is written into the project beside the manifest, and
 * `checkRecipeAgainstManifest` reads the two back and reports where they
 * disagree. That is what "definition and manifest cannot drift apart
 * unnoticed" means in practice: an assistant that hand-edits
 * `agent.manifest.json` — which `AGENT_BUILDER.md` tells it not to — is caught
 * by `create-dash-agent --check` and by `dash_agent_validate`, rather than by a
 * run three weeks later that grades every step as drift.
 *
 * ## What this module is not
 *
 * It is not a manifest schema and it does not compete with one.
 * `contracts/agent.manifest.v2.schema.json` remains the contract; a recipe is
 * an *input* that happens to be able to produce a document satisfying it. It
 * declares nothing DASH enforces either — `agent_dom.permissions` is the
 * author's claim, and ADR 0002 keeps enforcement in the runner and the broker
 * where it can actually be enforced.
 */

import { lstatSync, readdirSync } from "node:fs";
import path from "node:path";

import { agentsRoot } from "../lib/agent-folders";
import { validateManifest } from "../lib/contracts";
import { checkManifestConstraints } from "../lib/manifest-constraints";
import { isSafeAgentId } from "../lib/handoff";
import { APP_NAME } from "../lib/shell/app-identity";

/**
 * The version of this document's own shape.
 *
 * A number and not a range. Pinned versions everywhere is the rule stage 2 was
 * given — `latest` is not a reproducibility strategy — and that starts with the
 * recipe describing itself.
 */
export const RECIPE_VERSION = 1;

/**
 * The version of the runtime a scaffold from this build carries.
 *
 * A literal here and the exported constant in
 * `agent-kit/template/dash-agent-sdk.mjs` are the same number in two places,
 * which is exactly the shape this repository keeps being bitten by — so
 * `tests/agent-recipe.test.ts` reads the runtime file and pins them against
 * each other. Importing the `.mjs` from TypeScript is the obvious alternative
 * and it is worse: it would put the agent runtime into the shell's own bundle
 * graph, and ADR 0034's whole point is that the runtime is a file that ships
 * inside an agent folder rather than a module DASH links.
 */
export const SDK_VERSION = "1.1.0";

/* ---------------------------------------------------------------------- *
 * The recipe
 * ---------------------------------------------------------------------- */

/** One step of the run, and the sentence saying what it is for. */
export interface RecipeStep {
  /**
   * The registry component id, exactly as the program passes it to `step()`.
   *
   * `lib/analyze.ts` grades a run by matching executed steps to
   * `planned_route[].component_id`, so a value invented here rather than taken
   * from `lib/agent-sources.ts`'s constants turns a correct run into drift.
   */
  component_id: string;
  /** What that step does, in one sentence somebody who will not read the manifest can read. */
  intent: string;
  risk_level: "low" | "medium" | "high";
  model_tier: "none" | "small" | "medium" | "large";
  /** ADR 0011's level, when this step is allowed to reach a model. */
  default_model_level?: "cheap" | "balanced" | "deep";
}

/** One feed the agent reads. The same three shapes the templates parse. */
export interface RecipeSource {
  name: string;
  url: string;
  format: "rss" | "atom" | "hn_algolia";
}

/**
 * What one run consumes and what it hands DASH.
 *
 * `emits` is the pair the panel's `artifact_role` bindings resolve against, so
 * a recipe claiming a brief its program never sends produces a panel section
 * that is permanently empty. `checkRecipeAgainstManifest` compares the two.
 */
export interface RecipeContract {
  /** Files inside the project one run reads. Relative, forward slashes. */
  consumes: string[];
  /** The artifact kinds one run sends, with the contract version of each. */
  emits: Array<{ kind: "digest" | "brief"; artifact_version: 1 | 2 }>;
}

/** The four kinds of acceptance case stage 4 asks every agent to carry. */
export type AcceptanceKind =
  | "normal_input"
  | "missing_input"
  | "tool_failure"
  | "denied_permission";

export interface AcceptanceCase {
  kind: AcceptanceKind;
  /** What the fixture puts in front of the agent. */
  fixture: string;
  /** What has to be true afterwards for this case to pass. */
  expect: string;
}

/**
 * Everything three scaffolders need to write the same agent, and nothing about
 * where it is being written.
 *
 * The target directory is deliberately absent: it is a build argument
 * (`RecipeBuild`), not a property of the agent. A recipe carrying an absolute
 * path could not be committed as a fixture, shared between machines, or written
 * into the project it describes without putting somebody's home directory in a
 * file they publish.
 */
export interface AgentRecipe {
  recipe_version: number;
  /** The versions this agent is pinned to. No ranges, no `latest`. */
  runtime: {
    /** `SDK_VERSION` from `agent-kit/template/dash-agent-sdk.mjs`. */
    sdk_version: string;
    /** The generator's own version, recorded in the manifest's provenance. */
    kit_version: string;
    /** What wrote it, verbatim into `provenance.generated_by`. */
    generated_by: string;
    /**
     * `provenance.registry_fingerprint`. Never a real registry build: saying
     * `agent-kit-template` is better than borrowing a fingerprint from a
     * registry this agent was never composed against.
     */
    registry_fingerprint: string;
    /**
     * Package dependencies the generated project needs, by exact version.
     *
     * Empty, and it is the template's most useful property: `npm install` in a
     * scaffold that pulls a tree can fail on somebody's corporate network
     * before they have seen anything work, and the packaged sample is copied
     * as raw bytes with no registry anywhere in the journey. A recipe that ever
     * needs one must name an exact version and say how it is locked; a range
     * or `latest` is refused by `validateRecipe`.
     */
    dependencies: Record<string, string>;
  };
  agent: {
    /** The agent's id, its folder name, and its manifest's `agent.name`. */
    id: string;
    display_name: string;
    /** One sentence a novice can read. Becomes the manifest's `agent.goal`. */
    summary: string;
  };
  steps: RecipeStep[];
  sources: RecipeSource[];
  /**
   * ADR 0013 connection declarations, verbatim as the manifest carries them.
   * `[]` means the agent can be added and watched working with no credential
   * anywhere, which is what makes a template demonstrable.
   */
  connections: Array<Record<string, unknown>>;
  /**
   * The next-action half of the same connections — what puts a line with a
   * Connect button on DASH's Connections page. Omitted when `connections` is
   * empty, because a requirement over an inventory that names nothing is a
   * button with nothing behind it.
   */
  connection_requirements?: Record<string, unknown>;
  contract: RecipeContract;
  /**
   * What the agent claims it may do. A declaration and not a boundary: the
   * runner strips the environment and the broker holds every credential, so no
   * surface built on this may imply DASH enforces it (ADR 0002).
   */
  permissions: {
    read: Array<Record<string, unknown>>;
    write: Array<Record<string, unknown>>;
    approval_required_for: unknown[];
  };
  /** The panel the agent asks DASH to draw for it (ADR 0008). */
  panel: Record<string, unknown>;
  acceptance: AcceptanceCase[];
}

/* ---------------------------------------------------------------------- *
 * Validation
 * ---------------------------------------------------------------------- */

/** One thing wrong with a recipe, addressed the way a validator addresses it. */
export interface RecipeProblem {
  /** A JSON pointer into the recipe, or `(root)`. */
  where: string;
  /** The rule that was broken, named rather than described. */
  constraint: string;
  /** What is wrong, and — where there is one — what to write instead. */
  problem: string;
}

export type RecipeVerdict =
  | { ok: true; problems: readonly [] }
  | { ok: false; problems: RecipeProblem[] };

/** A version range is not a pinned version, and neither is a tag. */
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/**
 * Everything wrong with a recipe, including everything wrong with the manifest
 * it would produce.
 *
 * Two layers, in this order and never the other one. The recipe's own shape
 * first, because a recipe missing `agent.id` produces a manifest whose every
 * complaint is derived from that one absence; then DASH's real import verdict
 * over the assembled manifest, so a recipe that passes here cannot produce a
 * folder DASH refuses.
 */
export function validateRecipe(recipe: AgentRecipe, now: Date = new Date()): RecipeVerdict {
  const problems: RecipeProblem[] = [];
  const fail = (where: string, constraint: string, problem: string): void => {
    problems.push({ where, constraint, problem });
  };

  if (recipe.recipe_version !== RECIPE_VERSION) {
    fail(
      "/recipe_version",
      "recipe_version",
      `This build understands recipe_version ${String(RECIPE_VERSION)} and was given ${String(
        recipe.recipe_version,
      )}. A newer recipe needs a newer generator; nothing is guessed.`,
    );
  }

  if (!isSafeAgentId(recipe.agent.id)) {
    fail(
      "/agent/id",
      "agent_id",
      `“${recipe.agent.id}” cannot be used as an agent name. Use lowercase letters, digits, dots, ` +
        "dashes and underscores, starting with a letter or digit.",
    );
  }
  if (recipe.agent.display_name.trim().length === 0) {
    fail("/agent/display_name", "required", "An agent needs a name to be called in DASH.");
  }
  if (recipe.agent.summary.trim().length === 0) {
    fail("/agent/summary", "required", "An agent needs a one-sentence description.");
  }

  for (const [key, version] of Object.entries(recipe.runtime.dependencies)) {
    if (!EXACT_VERSION.test(version)) {
      fail(
        `/runtime/dependencies/${key}`,
        "exact_version",
        `“${version}” is a range or a tag. A scaffold pins exact versions — write one like 1.2.3 ` +
          "and say in the project how the lock file is produced, or drop the dependency.",
      );
    }
  }

  if (recipe.steps.length === 0) {
    fail(
      "/steps",
      "required",
      "A run with no steps reports nothing a person can watch. Name at least one.",
    );
  }
  recipe.steps.forEach((step, index) => {
    if (step.component_id.trim().length === 0) {
      fail(
        `/steps/${String(index)}/component_id`,
        "required",
        "A step needs the registry component id the program passes to step().",
      );
    }
    if (step.intent.trim().length === 0) {
      fail(
        `/steps/${String(index)}/intent`,
        "required",
        `Say in one sentence what “${step.component_id}” is for. A step with no sentence is a ` +
          "route nobody can check the program against.",
      );
    }
  });

  recipe.sources.forEach((source, index) => {
    if (!/^https?:\/\//i.test(source.url)) {
      fail(
        `/sources/${String(index)}/url`,
        "http_url",
        `“${source.url}” is not an http or https address. This agent reads feeds over the ` +
          "network and cannot open a file path or look a site up by name.",
      );
    }
    if (source.name.trim().length === 0) {
      fail(
        `/sources/${String(index)}/name`,
        "required",
        "Give the source a name a person will recognise. Never the address again.",
      );
    }
  });

  if (recipe.contract.emits.length === 0) {
    fail(
      "/contract/emits",
      "required",
      "A run that hands DASH nothing produces no evidence. Emit at least a digest.",
    );
  }
  const emitted = new Set(recipe.contract.emits.map((entry) => entry.kind));
  if (emitted.has("brief") && !emitted.has("digest")) {
    fail(
      "/contract/emits",
      "brief_needs_digest",
      "A brief cites a digest by position and is bound to it by a fingerprint, so a run that " +
        "emits a brief must emit the digest it is about.",
    );
  }

  if (recipe.connections.length === 0 && recipe.connection_requirements !== undefined) {
    fail(
      "/connection_requirements",
      "requires_connections",
      "A connection requirement with no connection declared beside it is a Connect button with " +
        "nothing behind it. Declare the connection, or drop the requirement.",
    );
  }

  const missingAcceptance = acceptanceGaps(recipe.acceptance);
  if (missingAcceptance.length > 0) {
    fail(
      "/acceptance",
      "four_cases",
      `Every agent carries four acceptance cases and this one is missing: ` +
        `${missingAcceptance.join(", ")}. They are what evals/run-evals.mjs runs.`,
    );
  }

  // The manifest DASH would be handed, through DASH's own two checks. Only
  // when the recipe itself is sound: a manifest assembled from a recipe with no
  // agent id complains about the absence in six places.
  if (problems.length === 0) {
    const manifest = manifestFromRecipe(recipe, now);
    const validated = validateManifest(manifest);
    if (!validated.ok) {
      for (const error of validated.errors) {
        problems.push(asManifestProblem(error, "schema"));
      }
    } else {
      for (const error of checkManifestConstraints(validated.value)) {
        problems.push(asManifestProblem(error, "import_constraint"));
      }
    }
  }

  return problems.length === 0 ? { ok: true, problems: [] } : { ok: false, problems };
}

/** Which of the four acceptance kinds this recipe does not carry. */
function acceptanceGaps(cases: readonly AcceptanceCase[]): AcceptanceKind[] {
  const held = new Set(cases.map((entry) => entry.kind));
  return ACCEPTANCE_KINDS.filter((kind) => !held.has(kind));
}

export const ACCEPTANCE_KINDS: readonly AcceptanceKind[] = [
  "normal_input",
  "missing_input",
  "tool_failure",
  "denied_permission",
];

/**
 * A validator string from `lib/`, re-addressed at the manifest it came from.
 *
 * The pointer stays the manifest's rather than being translated into a recipe
 * pointer. A translation would be a guess — several manifest locations are
 * assembled from more than one recipe field — and a confident wrong pointer is
 * worse than an honest one that names the document it is actually about.
 */
function asManifestProblem(error: string, constraint: string): RecipeProblem {
  const space = error.indexOf(" ");
  const where = space === -1 ? "(root)" : error.slice(0, space);
  const problem = space === -1 ? error : error.slice(space + 1);
  return {
    where: `manifest:${where}`,
    constraint,
    problem: `The manifest this recipe would write is refused by DASH's own validator: ${problem}`,
  };
}

/* ---------------------------------------------------------------------- *
 * The build
 * ---------------------------------------------------------------------- */

/** What is already at the target, read off a disk by whoever is about to write. */
export interface TargetState {
  /** File and directory names directly inside the target, if it exists. */
  existing: readonly string[];
  /** True when the target itself is a symbolic link. */
  symlink: boolean;
}

export interface RecipeBuild {
  /** Absolute path of the project directory. */
  directory: string;
  now: Date;
  /**
   * Files this build may replace. Empty by default, and a user file is never
   * in it by default: `agent.mjs`, `sources.json` and `evals/` are the three
   * things an author edits, so overwriting one silently is the failure this
   * whole check exists for.
   */
  overwrite?: readonly string[];
  /**
   * What is at the target now. A caller that is about to write must pass a real
   * one — `readTargetState` produces it — or the emptiness check cannot run.
   */
  target?: TargetState;
  /**
   * DASH's own agents directory, so the planner can refuse to write inside it.
   * Omitted means "do not check", which is right for a caller that has already
   * refused for itself.
   */
  dashAgentsRoot?: string;
}

/**
 * What is at `directory` right now, for a caller that is about to write there.
 *
 * The one place this module touches a disk, and it is separated from the
 * planner deliberately: `planFromRecipe` stays pure and testable, and the fact
 * that reads a real file system is one small function every writer calls with
 * the same three lines. A directory that does not exist is empty and not a
 * link, which is the ordinary case and not a problem.
 */
export function readTargetState(directory: string): TargetState {
  let symlink = false;
  try {
    symlink = lstatSync(directory).isSymbolicLink();
  } catch {
    return { existing: [], symlink: false };
  }
  let existing: string[] = [];
  try {
    existing = readdirSync(directory);
  } catch {
    existing = [];
  }
  return { existing, symlink };
}

/** Relative to the project, forward slashes, exactly as a handoff records it. */
export interface RecipeFile {
  path: string;
  contents: string;
}

export type RecipePlan =
  | { ok: true; files: RecipeFile[] }
  | { ok: false; problem: string; problems?: RecipeProblem[] };

/**
 * The template bytes and the two rendered documents one plan needs.
 *
 * `agent`, `sdk`, `openInDash` and `evals` are files read off a disk verbatim.
 * `readme` and `gitignore` are rendered by the scaffolder, because the README
 * belongs to the *program*: the Agent Kit's template and the MCP's are two
 * different agents and their READMEs describe two different things. Everything
 * that is not prose about the program is in the recipe.
 */
export interface RecipeSources {
  /** The program: `agent.mjs`. */
  agent: string;
  /** The runtime, verbatim: `dash-agent-sdk.mjs` (ADR 0034). */
  sdk: string;
  /** The bundled `open-in-dash.mjs`, copied into the project's `scripts/`. */
  openInDash: string;
  /** `agent-kit/template/evals/run-evals.mjs`, copied verbatim. */
  evals: string;
  readme: string;
  gitignore: string;
}

/**
 * Names a project file may never have.
 *
 * Every path this module produces is a literal below, so this guards the one
 * thing a caller supplies: `overwrite`. A caller that names `../package.json`
 * is either confused or hostile and gets the same answer either way.
 */
function unsafeRelativePath(candidate: string): string | null {
  if (candidate.length === 0) {
    return "A build cannot name an empty file.";
  }
  if (path.isAbsolute(candidate) || /^[A-Za-z]:/.test(candidate)) {
    return (
      `“${candidate}” is a full path. A file this build may replace is named relative to ` +
      "the project directory."
    );
  }
  if (candidate.includes("\\")) {
    return `“${candidate}” uses backslashes; project files are named with forward slashes.`;
  }
  for (const segment of candidate.split("/")) {
    if (segment === ".." || segment === "." || segment.length === 0) {
      return `“${candidate}” walks out of the project directory.`;
    }
  }
  return null;
}

/**
 * Turn a recipe into the exact files a scaffolder writes — or refuse, having
 * written nothing.
 *
 * Everything is decided before anything is returned, which is what makes "no
 * half-written project after a refusal" a property of the design rather than a
 * discipline each of the three writers has to keep separately. The caller
 * receives a complete list or a problem, and there is no third outcome in which
 * some of the list exists.
 */
export function planFromRecipe(
  recipe: AgentRecipe,
  sources: RecipeSources,
  build: RecipeBuild,
): RecipePlan {
  if (!path.isAbsolute(build.directory)) {
    return { ok: false, problem: "The project directory must be a full path." };
  }
  // Read before `path.resolve`, deliberately: resolving a path is what makes a
  // traversal disappear, so a check made afterwards can never see one. The
  // caller wrote `..`, and whether it happens to normalise somewhere harmless
  // is not the question — a scaffolder should write where it was told and
  // refuse anything it would have to interpret.
  if (build.directory.split(/[\\/]/).includes("..")) {
    return {
      ok: false,
      problem: `“${build.directory}” walks out of itself. Give the whole path to the folder.`,
    };
  }
  const directory = path.resolve(build.directory);

  if (build.dashAgentsRoot !== undefined && isInside(build.dashAgentsRoot, directory)) {
    return {
      ok: false,
      problem:
        `“${directory}” is inside the folder DASH owns (${build.dashAgentsRoot}). DASH swaps an ` +
        "agent's folder on import rather than editing it, so anything written there is discarded " +
        "the next time that agent is imported — the write succeeds and the change does not " +
        "survive (ADR 0008). Build the agent in an ordinary project folder of your own.",
    };
  }

  const overwrite = build.overwrite ?? [];
  for (const candidate of overwrite) {
    const unsafe = unsafeRelativePath(candidate);
    if (unsafe !== null) {
      return { ok: false, problem: unsafe };
    }
    if (NEVER_OVERWRITTEN.includes(candidate)) {
      return {
        ok: false,
        problem:
          `“${candidate}” is a file the author edits, so this build will not replace it. Move ` +
          "the folder aside, or scaffold into an empty directory.",
      };
    }
  }

  const target = build.target;
  if (target !== undefined) {
    if (target.symlink) {
      return {
        ok: false,
        problem:
          `“${directory}” is a link to somewhere else, so what would be written is not where it ` +
          "looks like it is going. Give the real folder.",
      };
    }
    const blocking = target.existing.filter((entry) => !overwrite.includes(entry));
    if (blocking.length > 0) {
      return {
        ok: false,
        problem:
          `${directory} already has files in it (${blocking.slice(0, 5).join(", ")}${
            blocking.length > 5 ? ", …" : ""
          }). Pick a folder that does not exist yet, so nothing of yours is replaced.`,
      };
    }
  }

  const verdict = validateRecipe(recipe, build.now);
  if (!verdict.ok) {
    return {
      ok: false,
      problem:
        "This recipe does not describe an agent DASH would accept, so nothing was written.",
      problems: verdict.problems,
    };
  }

  const manifest = manifestFromRecipe(recipe, build.now);

  return {
    ok: true,
    files: [
      { path: "agent.manifest.json", contents: `${JSON.stringify(manifest, null, 2)}\n` },
      { path: RECIPE_FILE_NAME, contents: `${JSON.stringify(recipe, null, 2)}\n` },
      { path: "package.json", contents: `${JSON.stringify(projectPackage(recipe), null, 2)}\n` },
      { path: "agent.mjs", contents: sources.agent },
      { path: "dash-agent-sdk.mjs", contents: sources.sdk },
      { path: "scripts/open-in-dash.mjs", contents: sources.openInDash },
      {
        path: "sources.json",
        contents: `${JSON.stringify({ sources: recipe.sources }, null, 2)}\n`,
      },
      { path: "evals/run-evals.mjs", contents: sources.evals },
      { path: "evals/cases.json", contents: `${JSON.stringify(evalCases(recipe), null, 2)}\n` },
      { path: "AGENT_BUILDER.md", contents: agentBuilderDocument(recipe) },
      { path: "README.md", contents: sources.readme },
      { path: ".gitignore", contents: sources.gitignore },
    ],
  };
}

/** The recipe, as it is written into the project it describes. */
export const RECIPE_FILE_NAME = "agent.recipe.json";

/**
 * The three files a scaffold will not replace even when asked.
 *
 * They are the three an author owns: the program, what it reads, and the checks
 * they wrote about it. `agent.manifest.json` is deliberately absent — it is
 * generated from the recipe and replacing it is the whole point of re-running a
 * build.
 */
const NEVER_OVERWRITTEN: readonly string[] = ["agent.mjs", "sources.json", "evals"];

/**
 * The folder DASH owns, on this machine, resolved the way DASH resolves it.
 *
 * Known here **only so that a scaffolder can refuse to write into it**. Nothing
 * in this module opens a store, reads a registration or lists what is
 * installed; ADR 0027 draws that line and this stays outside it. The refusal
 * has to be explicit rather than left to good manners, because ADR 0008 swaps
 * an agent's stored folder on import rather than editing it: a scaffold written
 * there succeeds, appears on screen, and is discarded on the next import with
 * nothing anywhere saying why.
 *
 * `tools/dash-mcp/src/paths.ts` resolves the same directory for the same reason
 * and does not import this: that package refuses at its own tool boundary,
 * before a recipe exists, and the two refusals are deliberately independent.
 */
export function dashAgentsRootForThisMachine(): string {
  const override = process.env.DASH_DATA_DIR;
  if (override !== undefined && override.length > 0) {
    return agentsRoot(path.resolve(override));
  }
  return agentsRoot(path.join(appDataRoot(), APP_NAME));
}

function appDataRoot(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? process.cwd();
  if (process.platform === "win32") {
    return process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support");
  }
  return process.env.XDG_CONFIG_HOME ?? path.join(home, ".config");
}

/** True when `candidate` is inside `parent`, or is `parent` itself. */
function isInside(parent: string, candidate: string): boolean {
  const normalise = (value: string): string => {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  const base = normalise(parent);
  const target = normalise(candidate);
  return target === base || target.startsWith(base + path.sep);
}

/* ---------------------------------------------------------------------- *
 * The manifest
 * ---------------------------------------------------------------------- */

/**
 * A manifest v2 for a runner-hosted agent, assembled from the recipe.
 *
 * Everything not on the recipe is the same for every agent these three
 * scaffolders build, and that is the claim this function makes: the runtime
 * class, the manual trigger, the three location blocks, the four commands, the
 * L1 safety contract and telemetry v1's full event set are not choices a
 * recipe gets to make, because a template that varied them would be a template
 * teaching every agent built from it to overstate itself.
 *
 * `retry`, `pause`, `resume` and `cancel` — and not `approve`, `reject` or
 * `choose`. A template with no approval gates that declared `approve` would be
 * offering DASH a button with nothing behind it, which
 * `docs/agent-dom-contract-v2.md` calls out as the failure to avoid.
 *
 * Exported because MAR-576 needs the document without the project around it:
 * re-importing an agent DASH scaffolded means producing the manifest the
 * template writes *today* for an agent that already exists.
 */
export function manifestFromRecipe(recipe: AgentRecipe, now: Date): Record<string, unknown> {
  const agentDom: Record<string, unknown> = {
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
        id: `${recipe.agent.id}-runtime`,
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
    connections: recipe.connections,
    ...(recipe.connection_requirements === undefined
      ? {}
      : { connection_requirements: recipe.connection_requirements }),
    permissions: recipe.permissions,
    control: {
      supported: true,
      command_version: 1,
      location_id: "dash_agent_runner_control",
      commands: ["retry", "pause", "resume", "cancel"],
    },
    memory: [],
    panel: recipe.panel,
  };

  return {
    manifest_version: 2,
    agent: {
      name: recipe.agent.id,
      display_name: recipe.agent.display_name,
      goal: recipe.agent.summary,
      plan_source: "composed",
      playbook_id: "",
      route_id: "",
      build_target: "code",
    },
    planned_route: recipe.steps.map((step, index) => ({
      step: index + 1,
      component_id: step.component_id,
      risk_level: step.risk_level,
      model_tier: step.model_tier,
      ...(step.default_model_level === undefined
        ? {}
        : { default_model_level: step.default_model_level }),
    })),
    safety_contract: {
      // L1: it acts on its own folder and nothing else, and there is no
      // irreversible component to gate.
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
      generated_by: recipe.runtime.generated_by,
      registry_fingerprint: recipe.runtime.registry_fingerprint,
      generated_at: now.toISOString(),
    },
    agent_dom: agentDom,
  };
}

function projectPackage(recipe: AgentRecipe): Record<string, unknown> {
  return {
    name: recipe.agent.id,
    version: "0.1.0",
    private: true,
    description: recipe.agent.summary,
    type: "module",
    scripts: {
      // The name a person will type. Not `postinstall` and not `prepare`:
      // adding something to DASH is a decision, and a decision does not belong
      // on a hook that fires during `npm install`.
      "open-in-dash": "node scripts/open-in-dash.mjs",
      evals: "node evals/run-evals.mjs",
      start: "node agent.mjs",
    },
    engines: { node: ">=20.0.0" },
    dependencies: recipe.runtime.dependencies,
  };
}

/* ---------------------------------------------------------------------- *
 * Drift
 * ---------------------------------------------------------------------- */

/** One place the recipe and the manifest disagree. */
export interface RecipeDrift {
  /** A JSON pointer into the manifest, so the fix has an address. */
  where: string;
  /** What the recipe says. */
  recipe: string;
  /** What the manifest says. */
  manifest: string;
}

/**
 * Where the definition and the document have come apart.
 *
 * Pure, and deliberately narrow: it compares the facts a run is graded against
 * and the facts a person consents to, not every byte. `provenance.generated_at`
 * moves on every build and comparing it would report drift on a folder nothing
 * is wrong with; the panel's prose is the author's to edit. What is compared is
 * the identity, the route, the connections and the artifact kinds — the four
 * things whose disagreement is invisible until a run is already wrong.
 *
 * An empty array means they agree. It never throws: a manifest that cannot be
 * read as an object is reported as drift at `(root)`, because "the manifest is
 * unreadable" is exactly the answer the caller asked for.
 */
export function checkRecipeAgainstManifest(
  recipe: AgentRecipe,
  manifest: unknown,
): RecipeDrift[] {
  const drift: RecipeDrift[] = [];
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    return [
      {
        where: "(root)",
        recipe: `an agent called ${recipe.agent.id}`,
        manifest: "a document that is not a manifest",
      },
    ];
  }
  const document = manifest as Record<string, unknown>;

  const agent = asRecord(document["agent"]);
  compare(drift, "/agent/name", recipe.agent.id, asText(agent?.["name"]));
  compare(drift, "/agent/display_name", recipe.agent.display_name, asText(agent?.["display_name"]));
  compare(drift, "/agent/goal", recipe.agent.summary, asText(agent?.["goal"]));

  const route = Array.isArray(document["planned_route"]) ? document["planned_route"] : [];
  compare(
    drift,
    "/planned_route",
    recipe.steps.map((step) => step.component_id).join(" → "),
    route.map((step) => asText(asRecord(step)?.["component_id"])).join(" → "),
  );

  const dom = asRecord(document["agent_dom"]);
  const connections = Array.isArray(dom?.["connections"]) ? dom["connections"] : [];
  compare(
    drift,
    "/agent_dom/connections",
    describeConnections(recipe.connections),
    describeConnections(connections as Array<Record<string, unknown>>),
  );

  compare(
    drift,
    "/agent_dom/panel",
    recipe.contract.emits.map((entry) => entry.kind).sort().join(", "),
    panelRoles(dom?.["panel"]).join(", "),
  );

  return drift;
}

/**
 * The artifact kinds a panel binds to, deduplicated and sorted.
 *
 * Both binding names, because they are the same fact asked twice:
 * `artifact_role` is what a report section renders and `source_role` is what a
 * table reads its rows from, and `lib/views/panel.ts` resolves each against an
 * artifact's own `kind`. A panel that names a kind the run never emits draws a
 * permanently empty section, which is the drift this catches.
 */
function panelRoles(panel: unknown): string[] {
  const sections = asRecord(panel)?.["sections"];
  if (!Array.isArray(sections)) {
    return [];
  }
  const roles = new Set<string>();
  for (const section of sections) {
    const record = asRecord(section);
    for (const key of ["artifact_role", "source_role"]) {
      const role = record?.[key];
      if (typeof role === "string" && role.length > 0) {
        roles.add(role);
      }
    }
  }
  return [...roles].sort();
}

function describeConnections(connections: readonly Record<string, unknown>[]): string {
  if (connections.length === 0) {
    return "none";
  }
  return connections
    .map((connection) => {
      const id = asText(connection["id"]);
      const provider = asText(connection["provider"]);
      const ownership = asText(connection["ownership"]);
      return `${id} (${provider}, ${ownership})`;
    })
    .sort()
    .join("; ");
}

function compare(drift: RecipeDrift[], where: string, expected: string, found: string): void {
  if (expected !== found) {
    drift.push({ where, recipe: expected, manifest: found });
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "(absent)";
}

/* ---------------------------------------------------------------------- *
 * The evals
 * ---------------------------------------------------------------------- */

/**
 * What `evals/run-evals.mjs` is handed.
 *
 * The runner is generic — it is the same file in every project — so everything
 * that varies between agents is here: the id the manifest declares, the steps
 * whose ids the run must report, and the artifact kinds it must send. The four
 * cases carry their own sentences so a failure reads as a sentence about the
 * agent rather than as an assertion about a field.
 */
export function evalCases(recipe: AgentRecipe): Record<string, unknown> {
  return {
    recipe_version: recipe.recipe_version,
    agent: recipe.agent.id,
    steps: recipe.steps.map((step) => ({
      component_id: step.component_id,
      intent: step.intent,
    })),
    emits: recipe.contract.emits,
    cases: recipe.acceptance,
  };
}

/**
 * The four cases every recipe carries, worded for one agent.
 *
 * Offered rather than imposed: `defaultAcceptance` is what the three
 * scaffolders use, and a recipe arriving from somewhere else may word its own —
 * `validateRecipe` only insists that all four kinds are present, because the
 * four kinds are the contract and the sentences are the description.
 */
export function defaultAcceptance(emits: readonly { kind: string }[]): AcceptanceCase[] {
  const documents = emits.map((entry) => entry.kind).join(" and a ");
  return [
    {
      kind: "normal_input",
      fixture: "Two sources that answer with a well-formed feed.",
      expect: `The run completes and sends a ${documents}, with every item carrying the address it came from.`,
    },
    {
      kind: "missing_input",
      fixture: "No sources configured at all.",
      expect:
        "The run completes and says there was nothing to read. It does not fail, and it does " +
        "not send a document claiming to have found something.",
    },
    {
      kind: "tool_failure",
      fixture: "One source answers with an error and the other answers normally.",
      expect:
        "The run completes, the digest names the source that failed, and the items from the " +
        "source that worked are all there. A partial result is reported as partial.",
    },
    {
      kind: "denied_permission",
      fixture: "Every brokered request is refused, the way DASH refuses one it has no key for.",
      expect:
        "The run completes with a complete digest and says it was not summarised. No operation " +
        "outside the ones this agent's own manifest declares is ever asked for.",
    },
  ];
}

/* ---------------------------------------------------------------------- *
 * The instructions
 * ---------------------------------------------------------------------- */

/**
 * The file a coding assistant reads before it edits anything.
 *
 * Short, imperative, and organised by the only question that matters on its
 * first read: which files are mine. Everything else in the project explains
 * itself; the boundary does not, and getting it wrong is the failure that looks
 * like success — an edit to `dash-agent-sdk.mjs` works until the next upgrade
 * replaces the file, and an edit to `agent.manifest.json` works until the next
 * build regenerates it from a recipe that never heard about the change.
 */
export function agentBuilderDocument(recipe: AgentRecipe): string {
  const steps = recipe.steps
    .map((step, index) => `${String(index + 1)}. \`${step.component_id}\` — ${step.intent}`)
    .join("\n");
  const emits = recipe.contract.emits
    .map((entry) => `\`${entry.kind}\` (artifact version ${String(entry.artifact_version)})`)
    .join(" and ");

  return `# Building on ${recipe.agent.display_name}

${recipe.agent.summary}

This file is for whoever changes this agent next, including a coding assistant.
Read it before editing anything.

## Which files are yours

| File | Yours? | What it is |
| -- | -- | -- |
| \`agent.mjs\` | **Yes** | The agent. \`runOnce\` is one run of it. |
| \`sources.json\` | **Yes** | What it reads. |
| \`evals/\` | **Yes** | The checks that say whether it still works. |
| \`${RECIPE_FILE_NAME}\` | **Yes, carefully** | What this agent is. The manifest is generated from it. |
| \`agent.manifest.json\` | **No** | Generated from the recipe. Edit the recipe and build again. |
| \`dash-agent-sdk.mjs\` | **No** | DASH's runtime. DASH replaces this file when it has a newer one, so an edit here is an edit you lose. |
| \`scripts/open-in-dash.mjs\` | **No** | How this folder is handed to DASH. |

## What one run does

${steps}

It hands DASH ${emits} and writes the same thing into \`reports/\`.

## Changing what it does

1. Edit \`runOnce\` in \`agent.mjs\`. Everything the runtime gives it — \`step\`,
   \`digest\`, \`brief\`, \`ask\`, \`log\`, \`signal\` — is documented at the top of
   \`dash-agent-sdk.mjs\`. Read that header once.
2. If the *steps* change, change \`steps\` in \`${RECIPE_FILE_NAME}\` to match, in
   the same order, using the same component ids \`agent.mjs\` passes to \`step()\`.
   DASH grades a run by matching what ran against what the manifest planned, so a
   route that has drifted from the program turns a correct run into a list of
   findings.
3. If what it is *allowed* to do changes — a new connection, a new kind of
   document — change the recipe, not the manifest.
4. Run the checks, then hand DASH the change.

## Running the checks

\`\`\`
node evals/run-evals.mjs
\`\`\`

Four cases, no network, no model, no key: a normal run, a run with nothing to
read, a run where a source fails, and a run where every brokered request is
refused. They spawn this agent the way DASH's runner does and talk to it over
the same protocol, so a pass means the program works, not that a test double
does.

They need Node on your PATH. A folder DASH created for you runs inside DASH
without one; if \`node\` is not a command on this machine, the evals are for
whoever is editing the agent rather than for the person using it.

## Checking the agent still matches its recipe

\`\`\`
npx create-dash-agent --check .
\`\`\`

or, from an assistant with the DASH MCP server, \`dash_agent_validate\`. Either
one reports where \`${RECIPE_FILE_NAME}\` and \`agent.manifest.json\` have come
apart, and runs DASH's real import validator over the manifest.

## Two things that are not true

- **The runtime is not a sandbox.** It runs inside this agent's own process,
  which has an ordinary network stack and an ordinary file system. What actually
  constrains this agent is DASH: the runner strips its environment and the
  broker holds every credential and answers only the operations the manifest
  declares. Do not write anything that implies importing the runtime limits what
  the program can reach.
- **No credential is ever in this folder.** \`ask()\` names an operation and DASH
  performs it. There is no key to add to \`.env\`, and a run that needs one it
  does not have is refused with a reason, which is a normal outcome to handle
  rather than an error to retry.

## Dependencies

There are none, and that is deliberate: this project installs nothing, so it
cannot fail on a network that blocks a registry. If you add one, pin an exact
version — never a range and never \`latest\` — and say in this file how the lock
file is produced. The recipe refuses anything else.
`;
}
