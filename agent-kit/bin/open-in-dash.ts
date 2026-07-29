/**
 * The `open-in-dash` program, copied into every scaffold as
 * `scripts/open-in-dash.mjs`.
 *
 * The bundle produced from this entry is the file a scaffolded project actually
 * runs. It has no dependencies and no build step of its own, which is what lets
 * a project created by the Agent Kit stay a folder with one `agent.mjs` in it.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { main, openUrl } from "../open-in-dash";

/** Substituted at build time by esbuild's `define`. */
declare const __AGENT_KIT_VERSION__: string;

// `fileURLToPath`, not `URL.pathname`: on Windows the latter yields
// "/C:/Users/..." — a string no filesystem call accepts.
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const result = main(argv, __AGENT_KIT_VERSION__, scriptDir);

/**
 * `--no-open` writes the handoff and prints the link without asking the OS to
 * follow it.
 *
 * For anywhere the OS cannot usefully open anything: a CI job, an SSH session,
 * a machine where DASH is not installed yet. Without it, the only way to get
 * the link is to trigger a "no app is associated with this file" dialog first.
 */
if (result.code === 0 && result.url !== undefined) {
  // Printed first, opened second. If DASH is not installed, opening does
  // nothing visible — and a terminal that has already shown the link and said
  // what to do turns a dead end into a next step.
  process.stdout.write(result.output);
  if (!argv.includes("--no-open")) {
    openUrl(result.url);
  }
} else {
  process.stderr.write(result.output);
}

process.exitCode = result.code;
