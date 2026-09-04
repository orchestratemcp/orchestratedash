/**
 * `npm run open-in-dash`, inside a scaffolded project.
 *
 * Bundled to `dist/open-in-dash.mjs` and copied verbatim into every scaffold as
 * `scripts/open-in-dash.mjs`, so the author's own command and
 * `dash_agent_install` are **literally the same code**: both call
 * `writeHandoff` in `handoff.ts`, both produce the same document, both end at
 * the same consent dialog.
 *
 * That equality is worth the bundle. A tool that installs an agent through a
 * private door the author does not have is a tool the author has to keep
 * calling; the point of a scaffold is that it leaves behind a project somebody
 * owns.
 *
 * Bundled rather than templated for the reason `scripts/build-agent-kit.mjs`
 * gives about its own copy: a templated string of this logic would drift on its
 * first edit, and a bundle cannot.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { handoffMinutes, openUrl, writeHandoff } from "./handoff";

/**
 * The project this script belongs to.
 *
 * Resolved from the script's own location — `scripts/` inside the project —
 * rather than from `process.cwd()`, which is whatever directory the person
 * happened to be standing in when they typed the command.
 */
function projectDirectory(argv: readonly string[], scriptDir: string): string {
  const explicit = argv.find((argument) => !argument.startsWith("-"));
  return explicit === undefined ? path.resolve(scriptDir, "..") : path.resolve(explicit);
}

function report(displayName: string, url: string, willOpen: boolean): string {
  return [
    "",
    `  ${displayName} is ready.`,
    "",
    ...(willOpen
      ? [
          "  Opening DASH so you can add it. DASH will ask you first.",
          "",
          "  If nothing happens, DASH is probably not installed yet.",
          "  Install it, then run this command again.",
        ]
      : ["  Open this link on the computer where DASH is installed. DASH will ask you first."]),
    "",
    `  The link expires in ${String(handoffMinutes())} minutes:`,
    `  ${url}`,
    "",
  ].join("\n");
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const written = writeHandoff(projectDirectory(argv, scriptDir));

if (!written.ok) {
  process.stderr.write(`\n  ${written.problem}\n\n`);
  process.exitCode = 1;
} else {
  const willOpen = !argv.includes("--no-open");
  process.stdout.write(report(written.handoff.display_name, written.url, willOpen));
  if (willOpen) {
    openUrl(written.url);
  }
}
