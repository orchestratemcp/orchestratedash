/**
 * `create-dash-agent` — the command itself, minus the process.
 *
 * The decisions are in `agent-kit/scaffold.ts` and are pure; this module adds
 * argument parsing and the disk. `agent-kit/bin/create-dash-agent.ts` is the two
 * lines that make it a program.
 *
 * ## Why it refuses to write into a directory that already has anything in it
 *
 * A scaffolder that overwrites is a scaffolder that eventually eats somebody's
 * work, and the recovery is a git history the user may not have. Refusing costs
 * one `mkdir`; the alternative costs a file nobody can get back.
 *
 * The refusal is now made twice, in two places, deliberately. This module keeps
 * its own so the message names the folder the person typed; `planFromRecipe`
 * makes the same one from the `target` this passes it, so a caller that is not
 * this CLI cannot get past it by forgetting. Two refusals of the same thing is
 * cheap; one refusal that only one of three writers performs is how a scaffold
 * eventually eats somebody's work.
 *
 * ## `--check`
 *
 * The second thing this command does (MAR-888): read an agent folder back and
 * say whether `agent.recipe.json` and `agent.manifest.json` still describe the
 * same agent, and whether that manifest would still pass DASH's importer. It is
 * here rather than in a second binary because it is the same audience and the
 * same folder, and `AGENT_BUILDER.md` tells a coding assistant to run it after
 * changing anything.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { validateManifest } from "../lib/contracts";
import { checkManifestConstraints } from "../lib/manifest-constraints";
import {
  RECIPE_FILE_NAME,
  checkRecipeAgainstManifest,
  readTargetState,
  type AgentRecipe,
} from "./recipe";
import { deriveAgentId, planScaffold, type TemplateSources } from "./scaffold";

export interface CliOptions {
  /** Where the kit's own files live: the directory holding `template/`. */
  kitRoot: string;
  kitVersion: string;
  cwd: string;
  now: Date;
}

export interface CliResult {
  code: number;
  output: string;
  /** The directory that was created, when one was. */
  directory?: string;
}

const USAGE = `
  create-dash-agent — make an agent OrchestrateDASH can run

  Usage:
    npx create-dash-agent <folder-name>
    npx create-dash-agent --check <folder-name>

  Then:
    cd <folder-name>
    npm run open-in-dash

  --check reads an agent folder you already have and says whether what it
  promises DASH still matches what it says it is.
`;

export function run(argv: readonly string[], options: CliOptions): CliResult {
  const positional = argv.filter((argument) => !argument.startsWith("-"));
  if (argv.includes("--help") || argv.includes("-h") || positional.length === 0) {
    return { code: positional.length === 0 && !argv.includes("--help") ? 1 : 0, output: USAGE };
  }

  if (argv.includes("--check")) {
    return check(path.resolve(options.cwd, positional[0] as string));
  }

  const requested = positional[0] as string;
  const directory = path.resolve(options.cwd, requested);
  const folderName = path.basename(directory);
  const agentId = deriveAgentId(folderName);

  if (existsSync(directory) && readdirSync(directory).length > 0) {
    return {
      code: 1,
      output: `\n  ${directory} already has files in it. Pick a folder that does not exist yet.\n`,
    };
  }

  let sources: TemplateSources;
  try {
    sources = readTemplates(options.kitRoot);
  } catch (error: unknown) {
    return {
      code: 1,
      output:
        `\n  This copy of create-dash-agent is incomplete: ${error instanceof Error ? error.message : String(error)}\n`,
    };
  }

  const planned = planScaffold(
    {
      directory,
      agent_id: agentId,
      display_name: titleCase(folderName),
      summary: `Reads the news sources you choose and writes you a short summary of what is new, with a link to where each item came from.`,
      kit_version: options.kitVersion,
      now: options.now,
      target: readTargetState(directory),
    },
    sources,
  );

  if (!planned.ok) {
    return { code: 1, output: `\n  ${planned.problem}\n` };
  }

  for (const file of planned.files) {
    const target = path.join(directory, file.path);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, file.contents, "utf8");
  }

  return {
    code: 0,
    directory,
    output: [
      ``,
      `  Created ${folderName}.`,
      ``,
      `  Two commands and it is running in DASH:`,
      ``,
      `    cd ${requested}`,
      `    npm run open-in-dash`,
      ``,
      `  DASH will ask you before it adds anything.`,
      ``,
      `  Changing what it does? Read AGENT_BUILDER.md, then run "npm run evals".`,
      ``,
    ].join("\n"),
  };
}

/* ---------------------------------------------------------------------- *
 * --check
 * ---------------------------------------------------------------------- */

/**
 * Read an agent folder back and say whether it still holds together.
 *
 * Two questions, and they are different. *Would DASH still import this?* is
 * `validateManifest` plus `checkManifestConstraints` — the same two functions
 * DASH runs at its own import boundary, so a pass here is a real answer and not
 * a rehearsal of one. *Do the recipe and the manifest still describe the same
 * agent?* is `checkRecipeAgainstManifest`, and it is the question a folder a
 * coding assistant has been editing needs asked: an edit to
 * `agent.manifest.json` is invisible to every test until a run is graded
 * against a route the program stopped following.
 *
 * A folder with no recipe is not a failure. Every agent scaffolded before
 * MAR-888 has one — the manifest is still checked, and the absence is reported
 * as the thing it is.
 */
function check(directory: string): CliResult {
  const manifestFile = path.join(directory, "agent.manifest.json");
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  } catch {
    return {
      code: 1,
      output: `\n  There is no agent at ${directory}. Run create-dash-agent first.\n`,
    };
  }

  const lines: string[] = [""];
  let failed = false;

  const validated = validateManifest(manifest);
  if (!validated.ok) {
    failed = true;
    lines.push("  DASH would refuse this manifest:");
    for (const error of validated.errors) {
      lines.push(`    ${error}`);
    }
  } else {
    const constraints = checkManifestConstraints(validated.value);
    if (constraints.length > 0) {
      failed = true;
      lines.push("  DASH would refuse this manifest:");
      for (const error of constraints) {
        lines.push(`    ${error}`);
      }
    } else {
      lines.push("  The manifest passes DASH's own importer.");
    }
  }

  let recipe: AgentRecipe | null = null;
  try {
    recipe = JSON.parse(readFileSync(path.join(directory, RECIPE_FILE_NAME), "utf8")) as AgentRecipe;
  } catch {
    recipe = null;
  }

  if (recipe === null) {
    lines.push(
      `  There is no ${RECIPE_FILE_NAME} here, so there is nothing to compare the manifest`,
      "  against. An agent made before this file existed is not broken; it just cannot be",
      "  checked this way.",
    );
  } else {
    const drift = checkRecipeAgainstManifest(recipe, manifest);
    if (drift.length === 0) {
      lines.push(`  ${RECIPE_FILE_NAME} and agent.manifest.json describe the same agent.`);
    } else {
      failed = true;
      lines.push("  The recipe and the manifest have come apart:");
      for (const entry of drift) {
        lines.push(`    ${entry.where}`);
        lines.push(`      recipe says:   ${entry.recipe}`);
        lines.push(`      manifest says: ${entry.manifest}`);
      }
      lines.push(
        "",
        `  Edit ${RECIPE_FILE_NAME} and build again, rather than editing the manifest: the`,
        "  manifest is generated from the recipe and the next build discards a change made",
        "  only here.",
      );
    }
  }

  lines.push("");
  return { code: failed ? 1 : 0, output: lines.join("\n") };
}

/**
 * The template files this build carries.
 *
 * `dash-agent-sdk.mjs` is carried verbatim beside `agent.mjs`, because the
 * generated project imports it with a relative path and has no dependencies to
 * resolve it through (ADR 0034).
 *
 * `open-in-dash.mjs` is the *bundle*, not the TypeScript source — a scaffolded
 * project has no compiler and no dependency on this kit, so the script it runs
 * has to be one self-contained file. It is built by
 * `scripts/build-agent-kit.mjs`, from the same `lib/handoff.ts` DASH reads
 * handoffs with, which is what stops the producer and the consumer drifting.
 */
function readTemplates(kitRoot: string): TemplateSources {
  const agentFile = path.join(kitRoot, "template", "agent.mjs");
  const sdkFile = path.join(kitRoot, "template", "dash-agent-sdk.mjs");
  const evalsFile = path.join(kitRoot, "template", "evals", "run-evals.mjs");
  const openFile = path.join(kitRoot, "dist", "open-in-dash.mjs");
  for (const file of [agentFile, sdkFile, evalsFile, openFile]) {
    if (!existsSync(file)) {
      return missing(file);
    }
  }
  return {
    agent: readFileSync(agentFile, "utf8"),
    sdk: readFileSync(sdkFile, "utf8"),
    openInDash: readFileSync(openFile, "utf8"),
    evals: readFileSync(evalsFile, "utf8"),
  };
}

function missing(file: string): never {
  throw new Error(`${file} is missing. Run \`pnpm build:agent-kit\` in the DASH repo.`);
}

/** "folder-digest" becomes "Folder digest": a name, not an identifier. */
function titleCase(value: string): string {
  const words = value.replace(/[-_.]+/g, " ").trim();
  return words.length === 0 ? value : words[0].toUpperCase() + words.slice(1);
}
