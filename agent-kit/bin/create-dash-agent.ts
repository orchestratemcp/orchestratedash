/**
 * The `create-dash-agent` program.
 *
 * Everything above the process boundary is in `agent-kit/cli.ts`, which is why
 * this file is short enough to read in one go. Bundled to
 * `agent-kit/dist/cli.mjs` by `scripts/build-agent-kit.mjs`, which is what
 * `package.json`'s `bin` points at.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { run } from "../cli";

/**
 * Substituted at build time by esbuild's `define`.
 *
 * Declared here rather than read from a `package.json` at runtime, because the
 * bundle is copied around — into `node_modules/.bin`, into a scaffold — and a
 * relative read of a manifest beside it is a guess about where it landed.
 */
declare const __AGENT_KIT_VERSION__: string;

// `fileURLToPath`, not `URL.pathname`: on Windows the latter yields
// "/C:/Users/..." — a string no filesystem call accepts.
const distDir = path.dirname(fileURLToPath(import.meta.url));

const result = run(process.argv.slice(2), {
  // `dist/cli.mjs` sits one level below the kit root, beside `template/`.
  kitRoot: path.resolve(distDir, ".."),
  kitVersion: __AGENT_KIT_VERSION__,
  cwd: process.cwd(),
  now: new Date(),
});

process.stdout.write(result.output);
process.exitCode = result.code;
