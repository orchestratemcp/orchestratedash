/**
 * What a path is allowed to be, decided before anything opens it.
 *
 * The task workspace exists so that "the runner grants this run access only to
 * the selected task inputs" is a fact about the filesystem rather than a
 * sentence in a design document. That claim is worth exactly as much as this
 * module: every way of naming a file that resolves somewhere other than where
 * it appears to is a way of turning "only the selected inputs" back into "any
 * file the runner can read".
 *
 * ## Two jobs, two strictnesses, and the reason they differ
 *
 * **Inside the workspace the rules are absolute.** The runner created these
 * directories, minted the names in them, and is the only thing that should ever
 * have written there. A symbolic link or a junction inside a workspace is not a
 * user's filesystem layout; it is something that was put there, and the only
 * candidates are a confused agent or a hostile one. So no component may be a
 * link, and the resolved path must still be inside the root after the operating
 * system has had its say.
 *
 * **A path the user selected is checked differently, and less.** A person's own
 * machine is full of junctions they did not create — `C:\Users\All Users`,
 * `C:\Users\<name>\My Documents`, `/tmp` on macOS — and refusing to read a
 * document because an ancestor directory is a reparse point would be refusing to
 * work on a normal Windows install. What is checked is the *leaf*: a selection
 * whose final component is a link is refused, because that is the case where
 * DASH would show one file's name and size while reading another file's bytes,
 * and a receipt that describes bytes it did not read is the specific dishonesty
 * this whole feature is against.
 *
 * The residual risk is stated rather than hidden: a junction on an ancestor
 * directory of a file the user picked in a dialog is followed. That is
 * deliberate, and it is defensible only because of where selections come from —
 * a human in a file dialog, over the authenticated DASH↔runner channel. **No
 * agent-supplied path is ever admitted**, which is the boundary that makes the
 * relaxation safe. `admitInput` takes a selection from DASH; a child names a
 * single component in its own outbox and nothing else.
 *
 * ## Why the Windows rules run on every platform
 *
 * `NUL`, `\\?\`, `COM1` and `file.txt:stream` mean nothing to Linux, so a check
 * for them guarded by `process.platform === "win32"` would be a check CI never
 * executes — proven by a suite that runs on Linux and enforced on a machine the
 * suite never touches. ADR 0004's rule points the same way: a gate must be able
 * to fail for this repository's own reasons. So the syntax rules below are
 * unconditional and platform-independent, they are tested on every push, and a
 * file genuinely named `NUL` on a Linux volume is refused for a reason nobody
 * will miss.
 */

import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

/**
 * Why a path was refused.
 *
 * Kept apart rather than collapsed into one `invalid_path`, for the reason
 * `lib/copy/recovery.ts` keeps four credential failures apart: these lead
 * somewhere different. "That name is a Windows device, not a file" is something
 * a person fixes by renaming; "that file is a shortcut to somewhere else" is
 * something they fix by picking the real one; "that path leaves the workspace"
 * is not a user error at all and means an agent misbehaved.
 */
export type PathRefusal =
  | "empty"
  | "not_absolute"
  | "traversal"
  | "device_namespace"
  | "unc_path"
  | "reserved_device_name"
  | "alternate_data_stream"
  | "control_character"
  | "trailing_dot_or_space"
  | "not_a_single_component"
  | "not_a_regular_file"
  | "symlink_or_junction"
  | "escapes_workspace"
  | "unreadable";

export interface PathProblem {
  refusal: PathRefusal;
  /** One sentence, safe to show a person. Never quotes the path back. */
  detail: string;
}

/**
 * Windows device names, which are devices at *any* directory depth.
 *
 * `C:\Users\henri\Documents\NUL` is the null device, not a file in Documents,
 * and opening it for writing succeeds and discards everything. An artifact
 * "written" to it would be registered with a real name, a real receipt and no
 * bytes.
 *
 * `COM0` and `LPT0` are included: they were not reserved on older Windows and
 * are on current ones, and the cost of refusing a file somebody named `COM0` is
 * a rename.
 */
const RESERVED_DEVICE_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "CONIN$",
  "CONOUT$",
  ...Array.from({ length: 10 }, (_unused, index) => `COM${String(index)}`),
  ...Array.from({ length: 10 }, (_unused, index) => `LPT${String(index)}`),
]);

const REFUSAL_DETAIL: Record<PathRefusal, string> = {
  empty: "No file was named.",
  not_absolute: "That is not a full path, so DASH cannot tell which file it means.",
  traversal: "That path steps outside the folder it starts in.",
  device_namespace: "That path addresses a device rather than a file.",
  unc_path: "That path is on a network share. DASH works with files on this computer.",
  reserved_device_name: "Part of that path is a reserved Windows device name rather than a file.",
  alternate_data_stream: "That path names a hidden stream attached to a file rather than the file.",
  control_character: "That path contains characters no file name can contain.",
  trailing_dot_or_space:
    "Part of that path ends in a dot or a space, which Windows silently removes — so the file opened would not be the file named.",
  not_a_single_component: "That name is a path rather than a file name.",
  not_a_regular_file: "That is not an ordinary file.",
  symlink_or_junction:
    "That is a shortcut to another file. DASH reads the file you pick, so pick the one it points at.",
  escapes_workspace: "That path leads outside the workspace this task owns.",
  unreadable: "That file could not be read.",
};

function refuse(refusal: PathRefusal): PathProblem {
  return { refusal, detail: REFUSAL_DETAIL[refusal] };
}

/* ---------------------------------------------------------------------- *
 * Syntax: no I/O, no platform branch
 * ---------------------------------------------------------------------- */

/**
 * Split a path into a root and its components, understanding both separators.
 *
 * Deliberately not `path.parse`: on Linux that treats `C:\Users\x` as one
 * component named `C:\Users\x`, so every Windows rule below would silently pass
 * on the platform CI runs. Reading both separators everywhere is what makes the
 * rules testable where they are not enforced.
 */
function splitPath(candidate: string): { root: string; components: string[] } {
  const driveMatch = /^[A-Za-z]:[\\/]/.exec(candidate);
  if (driveMatch !== null) {
    return {
      root: candidate.slice(0, 3),
      components: candidate.slice(3).split(/[\\/]/).filter((part) => part.length > 0),
    };
  }
  if (candidate.startsWith("\\\\") || candidate.startsWith("//")) {
    return {
      root: candidate.slice(0, 2),
      components: candidate.slice(2).split(/[\\/]/).filter((part) => part.length > 0),
    };
  }
  if (candidate.startsWith("/") || candidate.startsWith("\\")) {
    return {
      root: candidate.slice(0, 1),
      components: candidate.slice(1).split(/[\\/]/).filter((part) => part.length > 0),
    };
  }
  return { root: "", components: candidate.split(/[\\/]/).filter((part) => part.length > 0) };
}

/**
 * The syntactic half of the guard: everything decidable without touching disk.
 *
 * Returns null when nothing is wrong. Runs before any `stat`, deliberately — a
 * device path is a path you must not open in order to ask what it is, because
 * asking is the side effect.
 */
export function inspectPathSyntax(candidate: string): PathProblem | null {
  if (candidate.length === 0) {
    return refuse("empty");
  }
  // NUL and the C0 range. A NUL byte truncates the name inside almost every
  // native filesystem call, so `brief.docx\0.exe` is checked as one string and
  // opened as another.
  if (/[\u0000-\u001f]/.test(candidate)) {
    return refuse("control_character");
  }

  const { root, components } = splitPath(candidate);

  // `\\?\` and `\\.\` reach the object manager rather than the filesystem, and
  // `\\?\` additionally turns off the normalisation every other rule here
  // assumes is happening.
  if (/^[\\/]{2}[?.][\\/]/.test(candidate)) {
    return refuse("device_namespace");
  }
  if (root === "\\\\" || root === "//") {
    return refuse("unc_path");
  }
  if (root === "") {
    return refuse("not_absolute");
  }

  for (const component of components) {
    if (component === "." || component === "..") {
      return refuse("traversal");
    }
    // A colon anywhere past the drive letter opens an alternate data stream:
    // `offert.pdf:payload` is a second, invisible file hanging off the first,
    // and `offert.pdf::$DATA` is the first file under a name that defeats a
    // check written against the visible one.
    if (component.includes(":")) {
      return refuse("alternate_data_stream");
    }
    // Win32 strips these before the filesystem sees the name, so `brief.docx.`
    // and `brief.docx` are the same file while being different strings — which
    // is how a check on one and an open of the other disagree.
    if (/[. ]$/.test(component)) {
      return refuse("trailing_dot_or_space");
    }
    if (isReservedDeviceName(component)) {
      return refuse("reserved_device_name");
    }
  }

  return null;
}

/** `NUL`, `nul.txt` and `NUL.` are all the null device. So is `COM1.anything`. */
export function isReservedDeviceName(component: string): boolean {
  const trimmed = component.replace(/[. ]+$/, "");
  const stem = trimmed.split(".")[0] ?? "";
  return RESERVED_DEVICE_NAMES.has(stem.toUpperCase());
}

/**
 * One path component and nothing else: the shape an agent may name.
 *
 * This is what a child gets to say when it publishes a file. Not a path, not a
 * relative path, not a name with a separator in it — a single entry in the
 * outbox the runner made for it. Everything about resolving that name to a
 * location is the runner's, which is what stops `../../../etc/passwd` and its
 * hundred spellings from being a case anybody has to enumerate.
 */
export function inspectComponent(candidate: string): PathProblem | null {
  if (candidate.length === 0) {
    return refuse("empty");
  }
  if (/[\\/]/.test(candidate)) {
    return refuse("not_a_single_component");
  }
  if (/[\u0000-\u001f]/.test(candidate)) {
    return refuse("control_character");
  }
  if (candidate === "." || candidate === "..") {
    return refuse("traversal");
  }
  if (candidate.includes(":")) {
    return refuse("alternate_data_stream");
  }
  if (/[. ]$/.test(candidate)) {
    return refuse("trailing_dot_or_space");
  }
  if (isReservedDeviceName(candidate)) {
    return refuse("reserved_device_name");
  }
  return null;
}

/* ---------------------------------------------------------------------- *
 * Containment
 * ---------------------------------------------------------------------- */

/**
 * Is `candidate` at or below `root`, as strings?
 *
 * Compared component by component rather than with `startsWith`, because
 * `startsWith` says yes to `/workspaces/task-1-evil` for the root
 * `/workspaces/task-1`. Case-insensitively on Windows, where two spellings of
 * the same path are the same path and a case-sensitive check would refuse a
 * containment that holds.
 *
 * This answers a question about *names*. It says nothing about what the
 * filesystem will do with them — `resolveInsideWorkspace` is where that is
 * settled, and this is one of its steps rather than a check anybody should use
 * alone.
 */
export function containedIn(root: string, candidate: string): boolean {
  const normalise = (value: string): string[] => {
    const resolved = path.resolve(value);
    const parts = resolved.split(/[\\/]/).filter((part) => part.length > 0);
    return process.platform === "win32" ? parts.map((part) => part.toLowerCase()) : parts;
  };

  const rootParts = normalise(root);
  const candidateParts = normalise(candidate);
  if (candidateParts.length < rootParts.length) {
    return false;
  }
  return rootParts.every((part, index) => candidateParts[index] === part);
}

/* ---------------------------------------------------------------------- *
 * Filesystem checks
 * ---------------------------------------------------------------------- */

/**
 * Enough of a file's identity to notice it was swapped.
 *
 * Not a hash — this is taken before and after a copy that may take a while on a
 * large document, and hashing twice to detect a change during the first hash is
 * a race with extra steps. Inode/file-index plus device plus size plus
 * modification time is what the operating system will tell you cheaply, and a
 * replacement that preserves all four is a replacement by a file that is, for
 * every purpose DASH has, the same file.
 */
export interface FileIdentity {
  ino: string;
  dev: string;
  size: number;
  mtime_ms: number;
}

export function sameIdentity(before: FileIdentity, after: FileIdentity): boolean {
  return (
    before.ino === after.ino &&
    before.dev === after.dev &&
    before.size === after.size &&
    before.mtime_ms === after.mtime_ms
  );
}

export type SelectionResult =
  | { ok: true; path: string; identity: FileIdentity }
  | { ok: false; problem: PathProblem };

/**
 * Check a path a human picked, and answer with the file to actually read.
 *
 * The order is the whole design. Syntax first, because a device path must be
 * refused without being opened. Then `lstat` rather than `stat`, because `stat`
 * follows the link and would report the *target's* type — which is the one
 * question a check for links must not delegate to the thing it is checking.
 * Only then a `realpath`, and the resolved path is what gets read, so nothing
 * downstream can be handed a name that resolves differently a second time.
 *
 * See the module header for what is deliberately *not* checked here: a link on
 * an ancestor directory. That relaxation is paid for by where selections come
 * from, and by the fact that no agent can reach this function.
 */
export function resolveSelectedFile(candidate: string): SelectionResult {
  const syntax = inspectPathSyntax(candidate);
  if (syntax !== null) {
    return { ok: false, problem: syntax };
  }

  let stats: ReturnType<typeof lstatSync>;
  try {
    stats = lstatSync(candidate);
  } catch {
    return { ok: false, problem: refuse("unreadable") };
  }

  if (stats.isSymbolicLink()) {
    // A junction reports as a symbolic link here too, which is why one branch
    // covers both and why the refusal names both.
    return { ok: false, problem: refuse("symlink_or_junction") };
  }
  if (!stats.isFile()) {
    // Directories, FIFOs, sockets, block and character devices. On Windows this
    // is also where `\\.\PhysicalDrive0` would land if it had somehow survived
    // the syntax pass.
    return { ok: false, problem: refuse("not_a_regular_file") };
  }

  let resolved: string;
  try {
    resolved = realpathSync.native(candidate);
  } catch {
    return { ok: false, problem: refuse("unreadable") };
  }

  return {
    ok: true,
    path: resolved,
    identity: {
      ino: String(stats.ino),
      dev: String(stats.dev),
      size: Number(stats.size),
      mtime_ms: stats.mtimeMs,
    },
  };
}

/** Re-read a file's identity, for the after half of the replacement check. */
export function readIdentity(target: string): FileIdentity | null {
  try {
    const stats = lstatSync(target);
    return {
      ino: String(stats.ino),
      dev: String(stats.dev),
      size: Number(stats.size),
      mtime_ms: stats.mtimeMs,
    };
  } catch {
    return null;
  }
}

export type WorkspaceResolution =
  | { ok: true; path: string; size: number }
  | { ok: false; problem: PathProblem };

/**
 * Resolve one component inside a workspace directory, strictly.
 *
 * This is the function an agent's output goes through, and it is the strict
 * half of the module. Three separate things have to hold, and each catches
 * something the others do not:
 *
 * 1. The name is a single component with no device, stream or traversal syntax
 *    in it. Refused before anything is opened.
 * 2. Nothing on the way down is a link. Checked with `lstat` from the root
 *    outward, so a junction planted as an intermediate directory is caught even
 *    though the leaf is an ordinary file.
 * 3. The path the operating system finally resolves is still inside the root.
 *    This is the one that does not trust the previous two: `realpath` is the
 *    kernel's answer, and any disagreement between it and our arithmetic is
 *    resolved in the kernel's favour, because the kernel is what will open the
 *    file.
 *
 * Check 3 alone would very nearly do. It is not alone because it answers only
 * after resolution, and a `realpath` on `\\.\CON` is not a question worth
 * asking.
 */
export function resolveInsideWorkspace(
  root: string,
  component: string,
  base?: string,
): WorkspaceResolution {
  const syntax = inspectComponent(component);
  if (syntax !== null) {
    return { ok: false, problem: syntax };
  }

  // Check 0, and it was missing from the first draft of this module.
  //
  // Everything below compares `realpath(root)` with `realpath(target)`, which
  // holds perfectly when the *root itself* has been replaced by a junction: both
  // sides resolve through it, the file genuinely is inside the directory the
  // junction points at, and containment is true. The runner would then publish
  // whatever is in `C:\Users\<name>\Documents` as the agent's own output.
  //
  // It is not hypothetical. A child runs as the same user as the runner, so it
  // can remove the outbox the runner made for it and recreate it as a junction —
  // and on Windows a junction needs no elevation and no Developer Mode, which is
  // exactly why the symlink half of this was never the interesting case.
  //
  // So every directory the runner created is walked and required to be a real
  // directory. The walk starts at `base` rather than at the filesystem root: the
  // data directory's own ancestry is the user's profile layout, where a redirected
  // `%LOCALAPPDATA%` is an ordinary Windows configuration and not an attack.
  if (base !== undefined) {
    const ancestry = assertUnlinkedBelow(base, root);
    if (ancestry !== null) {
      return { ok: false, problem: ancestry };
    }
  }

  const target = path.join(root, component);
  if (!containedIn(root, target)) {
    return { ok: false, problem: refuse("escapes_workspace") };
  }

  let stats: ReturnType<typeof lstatSync>;
  try {
    stats = lstatSync(target);
  } catch {
    return { ok: false, problem: refuse("unreadable") };
  }
  if (stats.isSymbolicLink()) {
    return { ok: false, problem: refuse("symlink_or_junction") };
  }
  if (!stats.isFile()) {
    return { ok: false, problem: refuse("not_a_regular_file") };
  }

  let resolvedRoot: string;
  let resolvedTarget: string;
  try {
    resolvedRoot = realpathSync.native(root);
    resolvedTarget = realpathSync.native(target);
  } catch {
    return { ok: false, problem: refuse("unreadable") };
  }
  if (!containedIn(resolvedRoot, resolvedTarget)) {
    // The names said one thing and the filesystem said another. That is a
    // reparse point somewhere above the leaf, and it is the case `containedIn`
    // on unresolved names cannot see.
    return { ok: false, problem: refuse("escapes_workspace") };
  }

  return { ok: true, path: resolvedTarget, size: Number(stats.size) };
}

/**
 * Every directory from `base` down to `target` must be a real directory.
 *
 * The rule the workspace rests on, and the reason it stops at `base`. Above the
 * DASH data directory the path belongs to the user's operating system: a
 * redirected `%LOCALAPPDATA%`, a roaming profile, `/tmp` symlinked to
 * `/private/tmp` on macOS. Refusing to run there would be refusing to run on
 * ordinary machines. Below it, every directory was created by the runner, so
 * anything that is *not* a directory is something that replaced one.
 *
 * A component that does not exist yet ends the walk successfully: the caller is
 * about to create it, and there is nothing there to have been substituted.
 */
export function assertUnlinkedBelow(base: string, target: string): PathProblem | null {
  const resolvedBase = path.resolve(base);
  const resolvedTarget = path.resolve(target);
  if (!containedIn(resolvedBase, resolvedTarget)) {
    return refuse("escapes_workspace");
  }

  const relative = path.relative(resolvedBase, resolvedTarget);
  const components = relative.split(/[\\/]/).filter((part) => part.length > 0);

  let walked = resolvedBase;
  for (const component of components) {
    walked = path.join(walked, component);
    let stats: ReturnType<typeof lstatSync>;
    try {
      stats = lstatSync(walked);
    } catch {
      return null;
    }
    if (stats.isSymbolicLink()) {
      // A Windows junction reports here too, which is the case that matters:
      // it is the one an unprivileged child can actually create.
      return refuse("symlink_or_junction");
    }
    if (!stats.isDirectory()) {
      return refuse("not_a_regular_file");
    }
  }
  return null;
}
