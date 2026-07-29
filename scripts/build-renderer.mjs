/**
 * Build the packaged app's renderer (MAR-432, DASH-20).
 *
 * `next build` with `DASH_STATIC_EXPORT=1`, which `next.config.mjs` turns into
 * `output: "export"` plus the `pageExtensions` that leave the route handlers
 * out. The result is static HTML in `out/`, which `scripts/build-shell.mjs`
 * copies to `dist/electron/renderer/`.
 *
 * A script rather than an inline environment variable in `package.json`, for the
 * dullest of reasons: `DASH_STATIC_EXPORT=1 next build` is shell syntax that
 * does not work on Windows, which is the platform this project is developed and
 * packaged on. Adding `cross-env` for one variable would put a dependency in a
 * repo whose runtime dependencies are deliberately two.
 *
 * It also deletes `out/` first. A stale export is worse than a missing one: a
 * page removed from the app stays in `out/`, gets copied into the package, and
 * remains reachable in the installed product long after it stopped existing in
 * the source.
 */

import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(repoRoot, "out");

rmSync(outDir, { recursive: true, force: true });

// Next's own entry point, run by this Node rather than through the `.cmd` shim
// a shell would resolve. No shell means no argument-escaping question, and it
// works identically on every platform.
const result = spawnSync(
  process.execPath,
  [path.join(repoRoot, "node_modules", "next", "dist", "bin", "next"), "build"],
  {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, DASH_STATIC_EXPORT: "1" },
  },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`[build-renderer] wrote ${path.relative(repoRoot, outDir)}`);
