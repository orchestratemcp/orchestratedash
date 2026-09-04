/**
 * What the plugin actually spawns.
 *
 * Committed, plain JavaScript, and deliberately the only file in this package
 * that a client's command line names. Its whole job is to make sure the bundle
 * beside it is not older than the code it was built from, and then to hand over.
 *
 * ## Why a bootstrapper rather than a committed bundle
 *
 * ADR 0032 decision 4: this tool holds DASH's real validator, so that it cannot
 * drift from `contracts/`. A committed bundle would reintroduce the drift as a
 * build product — correct on the day somebody ran the build, quietly wrong
 * afterwards, and with nothing on screen to say which. Rebuilding when an input
 * is newer costs about a tenth of a second on a cold start and removes the
 * whole failure mode.
 *
 * ## stdout belongs to the protocol
 *
 * Everything this file says goes to stderr. A single line of build output on
 * stdout would be a line the MCP client tries to parse as a JSON-RPC message,
 * and the resulting failure looks like a broken server rather than like a log.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageRoot, "..", "..");
const outDir = path.join(packageRoot, "dist");
const serverBundle = path.join(outDir, "server.mjs");
const inputsFile = path.join(outDir, "inputs.json");

/**
 * True when the bundles are missing, or when anything they were built from has
 * changed since.
 *
 * The input list is esbuild's own metafile rather than a hand-kept list of
 * directories, so a new import in `src/` — or a change in `lib/contracts.ts`
 * three levels down its own import graph — is noticed without anybody having
 * remembered to widen a glob.
 */
function needsBuild() {
  if (!existsSync(serverBundle) || !existsSync(path.join(outDir, "open-in-dash.mjs"))) {
    return true;
  }

  let inputs;
  try {
    inputs = JSON.parse(readFileSync(inputsFile, "utf8")).inputs;
  } catch {
    return true;
  }
  if (!Array.isArray(inputs) || inputs.length === 0) {
    return true;
  }

  let builtAt;
  try {
    builtAt = statSync(serverBundle).mtimeMs;
  } catch {
    return true;
  }

  for (const input of inputs) {
    // esbuild records inputs relative to the working directory the build ran
    // in, which was the repository root.
    const absolute = path.resolve(repoRoot, input);
    try {
      if (statSync(absolute).mtimeMs > builtAt) {
        return true;
      }
    } catch {
      // An input that has since been deleted or moved is a changed build.
      return true;
    }
  }

  return false;
}

if (needsBuild()) {
  process.stderr.write("dash-mcp: building the server bundle…\n");
  const built = spawnSync(process.execPath, [path.join(packageRoot, "build.mjs")], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "inherit"],
  });
  // esbuild's own stdout, moved off the protocol channel.
  if (built.stdout !== null && built.stdout.length > 0) {
    process.stderr.write(built.stdout.toString());
  }
  if (built.status !== 0) {
    process.stderr.write(
      "\ndash-mcp could not build itself.\n\n" +
        `It needs this repository's dependencies installed: run "pnpm install" in ${repoRoot}.\n` +
        "This server holds DASH's own validator rather than a copy of it, so it is built from\n" +
        "the checkout it was started from — see docs/adr/0032.\n\n",
    );
    process.exit(1);
  }
}

// A fact, where the server would otherwise have to infer it from its own
// location. `lib/contracts.ts` searches for the schemas; naming the directory
// removes the search and every way it could land somewhere unintended.
process.env.DASH_MCP_REPO_ROOT = repoRoot;
process.env.DASH_CONTRACTS_DIR ??= path.join(repoRoot, "contracts");

await import(pathToFileURL(serverBundle).href);
