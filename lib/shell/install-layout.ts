/**
 * "The packaged app reads its resources from its own install" (MAR-429), made
 * checkable.
 *
 * Pure, and here rather than in `electron/resources.ts`, for the reason
 * `electron/README.md` gives about every other rule in the shell: the module
 * that touches Electron should be wiring, and the part with a decision in it
 * should be testable without launching a browser process. This one especially,
 * because the failure it guards against is one that *cannot* reproduce on the
 * machine that would notice it — a build box where the development tree still
 * exists is exactly where "found the schemas somewhere else and carried on"
 * looks like success.
 */

import path from "node:path";

/**
 * Is `candidate` inside `root`?
 *
 * `path.relative` rather than a string prefix, which gets two cases wrong that
 * matter here:
 *
 * - **Sibling prefixes.** `startsWith` says `C:\app\resources-old` is inside
 *   `C:\app\resources`. It is not, and on an update — the one lifecycle step
 *   MAR-429 exists to prove — versioned sibling directories are precisely what
 *   the filesystem is full of.
 * - **Traversal.** A resolved path containing `..` can point back out of the
 *   root while still starting with it.
 *
 * Both come back from `path.relative` as a leading `..`, and a candidate on a
 * different Windows drive comes back absolute, which is why both are checked.
 *
 * The empty string — `candidate` *is* `root` — counts as inside. A resources
 * directory that is the install root is unusual but not wrong, and reporting it
 * as an escape would be a false alarm.
 */
export function isInsideInstallRoot(root: string, candidate: string): boolean {
  // Normalises separators and resolves `.`/`..` segments, so callers may pass
  // whatever the platform handed them.
  const relative = path.relative(path.resolve(root), path.resolve(candidate));

  if (relative === "") {
    return true;
  }
  if (path.isAbsolute(relative)) {
    return false;
  }
  // `..` alone, or any segment of it. Checking the first segment rather than
  // `startsWith("..")` keeps a legitimate directory named `..config` inside.
  return relative.split(path.sep)[0] !== "..";
}
