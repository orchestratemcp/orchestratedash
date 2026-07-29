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
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

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

  Then:
    cd <folder-name>
    npm run open-in-dash
`;

export function run(argv: readonly string[], options: CliOptions): CliResult {
  const positional = argv.filter((argument) => !argument.startsWith("-"));
  if (argv.includes("--help") || argv.includes("-h") || positional.length === 0) {
    return { code: positional.length === 0 && !argv.includes("--help") ? 1 : 0, output: USAGE };
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
      summary: `Counts what is in its inbox folder and writes a short report.`,
      kit_version: options.kitVersion,
      now: options.now,
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
    ].join("\n"),
  };
}

/**
 * The template files this build carries.
 *
 * `open-in-dash.mjs` is the *bundle*, not the TypeScript source — a scaffolded
 * project has no compiler and no dependency on this kit, so the script it runs
 * has to be one self-contained file. It is built by
 * `scripts/build-agent-kit.mjs`, from the same `lib/handoff.ts` DASH reads
 * handoffs with, which is what stops the producer and the consumer drifting.
 */
function readTemplates(kitRoot: string): TemplateSources {
  const agentFile = path.join(kitRoot, "template", "agent.mjs");
  const openFile = path.join(kitRoot, "dist", "open-in-dash.mjs");
  for (const file of [agentFile, openFile]) {
    if (!existsSync(file)) {
      return missing(file);
    }
  }
  return {
    agent: readFileSync(agentFile, "utf8"),
    openInDash: readFileSync(openFile, "utf8"),
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
