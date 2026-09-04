/**
 * Where this tool may write, and the one place it may not (MAR-862, ADR 0032
 * decision 1).
 *
 * The whole safety property of this package is negative: it knows the address
 * of DASH's agents directory **only so that it can refuse to write there**. It
 * opens no store, reads no registration and lists nothing that is installed.
 * ADR 0027 draws that line for a checkout; this package sits outside it by
 * construction.
 *
 * The reason the refusal has to be explicit, rather than left to good manners,
 * is ADR 0008: `<dataDir>/agents/<name>/` is **swapped** on import, not edited.
 * A tool that helpfully corrected a manifest in place would appear to work —
 * the bytes are on disk, the agent is on screen — and would lose the edit on the
 * next re-import with nothing anywhere saying why. A write that succeeds and a
 * change that does not survive is the worst failure this codebase collects, and
 * it is invisible from the writer's side.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { agentsRoot } from "../../../lib/agent-folders";
import { APP_NAME } from "../../../lib/shell/app-identity";

/**
 * The repository this package was launched from.
 *
 * Both the TypeScript source (`tools/dash-mcp/src/`) and the bundle
 * (`tools/dash-mcp/dist/`) sit three levels below the repository root, so one
 * expression is correct under Vitest and under the launcher without either
 * needing to know which it is. `DASH_MCP_REPO_ROOT` overrides it, and
 * `launch.mjs` sets that from its own committed location — a fact, where this
 * is an inference.
 */
export function repoRoot(): string {
  const override = process.env.DASH_MCP_REPO_ROOT;
  if (override !== undefined && override.length > 0) {
    return path.resolve(override);
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

/** Where the scaffold's template files live. */
export function templateRoot(): string {
  return path.join(repoRoot(), "tools", "dash-mcp", "template");
}

/**
 * DASH's data directory, resolved the way DASH resolves it.
 *
 * `DASH_DATA_DIR` first, because that is the override every harness and every
 * scratch store in this repository already uses. Otherwise Electron's own
 * convention — `<appData>/<app name>` — with the name imported from
 * `lib/shell/app-identity.ts` rather than typed here. That module's whole
 * subject is what happens when the name is wrong, and a second copy of the
 * string is how it gets wrong.
 */
export function dashDataDir(): string {
  const override = process.env.DASH_DATA_DIR;
  if (override !== undefined && override.length > 0) {
    return path.resolve(override);
  }
  return path.join(appDataRoot(), APP_NAME);
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

/**
 * True when `candidate` is inside `parent`, or is `parent` itself.
 *
 * Compared on resolved paths with a separator appended, so `/agentsmith` is not
 * read as being inside `/agents`. Case-insensitively on Windows, because
 * `%APPDATA%\OrchestrateDash` and `%appdata%\orchestratedash` are one directory
 * and a check that says otherwise is a check that can be walked around by
 * typing the path differently.
 */
export function isInside(parent: string, candidate: string): boolean {
  const normalise = (value: string): string => {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  const base = normalise(parent);
  const target = normalise(candidate);
  return target === base || target.startsWith(base + path.sep);
}

/**
 * The refusal ADR 0032 decision 1 exists to make, or null when the directory is
 * an ordinary place to build an agent.
 *
 * A refusal and never a redirect. Choosing a different directory on the
 * author's behalf answers a question they asked badly, and the author here is a
 * coding agent that will ask it the same way again tomorrow.
 */
export function refuseStagingDirectory(directory: string): string | null {
  // Checked on what the caller wrote, before anything resolves it. `path.resolve`
  // turns a relative path into an absolute one against `process.cwd()`, which
  // for this server is the repository it was launched from — so a caller
  // passing `my-agent` would scaffold an agent into DASH's own checkout, having
  // named no directory at all and been told nothing.
  if (!path.isAbsolute(directory)) {
    return (
      `“${directory}” is not a full path. Give the whole path to the folder the ` +
      "agent should be built in, so there is no question which directory is meant."
    );
  }

  const agents = agentsRoot(dashDataDir());
  if (isInside(agents, directory)) {
    return (
      `“${directory}” is inside the folder DASH owns (${agents}). DASH swaps an ` +
      "agent's folder on import rather than editing it, so anything written there " +
      "is discarded the next time that agent is imported — the write succeeds and " +
      "the change does not survive (ADR 0008). Build the agent in an ordinary " +
      "project folder of your own and install it with dash_agent_install, which " +
      "hands DASH the import instead of performing it."
    );
  }

  if (isInside(dashDataDir(), directory)) {
    return (
      `“${directory}” is inside DASH's own data directory (${dashDataDir()}). ` +
      "Nothing this tool writes belongs there. Build the agent in a project " +
      "folder of your own."
    );
  }

  return null;
}
