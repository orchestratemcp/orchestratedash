/**
 * The exact identity of the runner bytes, computed in one place (MAR-497).
 *
 * `runner_build` is what `electron/runner-process.ts` compares before adopting
 * a runner that is already up, and what `runner/main.ts` writes into
 * `runner.json` and answers on `/health`. Two builds of the same source must
 * produce the same string or that comparison is noise; two builds of different
 * source must not, or it is worse than noise.
 *
 * This module exists because there are now two builds — the shell's bundled
 * runner (`scripts/build-shell.mjs`) and the standalone host artifact
 * (`scripts/build-runner-standalone.mjs`) — and a second transcription of a
 * fingerprint algorithm is how two things that must agree quietly stop
 * agreeing.
 *
 * ## Two normalisations, and both are corrections rather than tidying
 *
 * The algorithm was written when only one machine ever computed it, so it hashed
 * whatever `readFileSync` and `path.relative` happened to produce. Both are
 * platform-dependent, and the standalone artifact is the first thing that makes
 * that matter: it is built on Linux for a Linux host, beside a shell built on
 * Windows, from the identical commit.
 *
 * - **Path separators are folded to `/`.** `path.relative` answers
 *   `runner\main.ts` on Windows and `runner/main.ts` everywhere else, so the
 *   same tree hashed differently depending on who hashed it.
 * - **CRLF is folded to LF.** This repository has no `.gitattributes`, and
 *   `core.autocrlf` is on by default on Windows, so a Windows checkout holds
 *   CRLF for every source file and a Linux checkout holds LF. The bytes esbuild
 *   compiles are the same program either way; the digest of them was not.
 *
 * Without these, "the host is running the same runner build as this DASH" is a
 * claim that would be false whenever the two were built on different platforms
 * — which is the ordinary case for a deploy and the only case anyone would ask
 * the question in. Every input here is TypeScript or JSON, so folding line
 * endings cannot corrupt a binary; there are none.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/** The directories whose contents define the runner. Ordered, and hashed in order. */
const INPUT_DIRECTORIES = ["runner", "lib", "contracts"];

function sourceFiles(directory) {
  return readdirSync(directory)
    .flatMap((name) => {
      const file = path.join(directory, name);
      return statSync(file).isDirectory() ? sourceFiles(file) : [file];
    })
    .filter((file) => /\.(?:ts|json)$/.test(file))
    .sort();
}

/**
 * Fingerprint the runner's source and contract inputs.
 *
 * `version` is included so a release with no source change is still a different
 * runner, which is what `runner.json` is read for after an update.
 */
export function computeRunnerBuildId(repoRoot, version) {
  const hash = createHash("sha256");
  hash.update(String(version));
  for (const directory of INPUT_DIRECTORIES) {
    for (const file of sourceFiles(path.join(repoRoot, directory))) {
      hash.update(path.relative(repoRoot, file).split(path.sep).join("/"));
      hash.update(readFileSync(file, "utf8").replace(/\r\n/g, "\n"));
    }
  }
  return hash.digest("hex").slice(0, 20);
}
