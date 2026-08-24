/**
 * Where a document DASH made for a person goes, and how it is listed back
 * (MAR-697).
 *
 * Henrik, after the first real brief export: *"When generating a PDF. Can we
 * have auto path to the agents folder in dash."* So there is no save dialog any
 * more. DASH chooses the place, the place is the same one every time, it is
 * per-agent, and the Output stage lists what is in it.
 *
 * ## `{dataDir}/exports/<agent>/`, and not inside the agent's own folder
 *
 * MAR-697 asked for `{dataDir}/agents/<agent>/`, beside the tree that holds the
 * agent's own `code/runs/events.jsonl`. **That location would lose the files.**
 * `writeAgentFolder` commits by renaming the whole agent folder aside and
 * renaming a freshly staged one into its place — see the swap at the foot of
 * `lib/agent-folders.ts` — so everything under `agents/<agent>/` that was not
 * in the staged input is gone the moment anybody re-imports the agent, presses
 * Accept on an outside edit, or lets DASH refresh a scaffolded agent from its
 * own template. Those are ordinary actions, not repairs. A person's saved
 * briefings disappearing when they accept an edit to the agent that made them
 * is not a trade worth the tidier path.
 *
 * Two smaller reasons point the same way. The agent folder is size- and
 * count-capped by `validateAgentFolderFiles` for deploy, and a year of PDFs
 * would eat that budget; and `folder.check` compares the folder against DASH's
 * stored digest, so exports living inside it would make every save look like an
 * outside edit somebody has to accept.
 *
 * What Henrik asked for is kept: no dialog, one predictable place, per agent,
 * inside DASH's data directory. `exports/` sits beside `agents/` rather than
 * under it, which is also the easier of the two to find by looking.
 *
 * ## DASH writes here and nothing else does
 *
 * No agent, no runner and no adapter has a route to this tree. That is what
 * makes listing it honest: everything in it is a document DASH composed at the
 * moment somebody pressed a button, so the list is DASH's own record — which
 * is ADR 0008's test for what may live in DASH's part of a stage.
 */

import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from "node:fs";
import path from "node:path";

import { containedIn, inspectComponent } from "../runner/path-guard";

/**
 * Typographic punctuation folded to its ASCII equivalent (MAR-740, MAR-697).
 *
 * The table `briefFileName` folds a new title through, moved here because a
 * legacy file already on disk needs the identical fold: the point is that a
 * name built today and a name built a year ago converge on the same string,
 * not that each caller keeps its own idea of what an em dash becomes.
 */
const PUNCTUATION_FOLDS: ReadonlyMap<string, string> = new Map([
  ["‐", "-"],
  ["‑", "-"],
  ["‒", "-"],
  ["–", "-"],
  ["—", "-"],
  ["―", "-"],
  ["‘", "'"],
  ["’", "'"],
  ["‚", "'"],
  ["′", "'"],
  ["“", '"'],
  ["”", '"'],
  ["„", '"'],
  ["″", '"'],
  ["…", "..."],
  [" ", " "],
]);

/**
 * A name's own words, folded and cleaned to what a filesystem will take —
 * the shared half of `briefFileName`'s rule, without the extension or the
 * length cap either side of an extension applies differently.
 */
export function foldExportBaseName(base: string): string {
  const folded = Array.from(base, (character) => PUNCTUATION_FOLDS.get(character) ?? character).join(
    "",
  );
  return folded
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const EXPORTS_DIRECTORY = "exports";

/**
 * How many are listed on the stage.
 *
 * "The latest exports", in Henrik's words, and a small number on purpose: this
 * is a component on a stage that already draws a briefing, not an archive. The
 * folder keeps everything; the list shows the top of it.
 */
export const RECENT_EXPORTS_LIMIT = 8;

/** One file DASH saved, as facts rather than as sentences. */
export interface AgentExportFile {
  /**
   * The file's own name, and never a path.
   *
   * The same rule `view.browser` keeps for `frame_after`: this is the handle a
   * person's press sends back to main, and main resolves it against the one
   * folder it is allowed to resolve it in. A path here would be a path the
   * renderer could name.
   */
  file: string;
  /** The name without its extension — what the person called the briefing. */
  label: string;
  /** DASH's own clock, as the filesystem recorded it. */
  saved_at: string;
  bytes: number;
}

/**
 * The folder this agent's exports go in, checked.
 *
 * Throws rather than returning null for a name that cannot be a folder
 * component, which is `agentFolderPath`'s choice next door and for its reason:
 * every caller reaches this with an agent id DASH itself stored, so a bad one
 * is a broken invariant rather than a state to render.
 */
export function agentExportsPath(dataDir: string, agent: string): string {
  const problem = inspectComponent(agent);
  if (problem !== null) {
    throw new Error(`The agent name cannot be a folder component: ${problem.refusal}`);
  }
  const root = path.join(dataDir, EXPORTS_DIRECTORY);
  const folder = path.join(root, agent);
  if (!containedIn(root, folder)) {
    throw new Error("The exports folder would leave the exports root.");
  }
  return folder;
}

/**
 * A name nothing in this folder already has.
 *
 * Pure, and separated from the write so the numbering can be tested without a
 * disk. The shape is the one every operating system uses for the same problem —
 * `name (2).pdf` — because a person who exports the same briefing twice is
 * looking for two files they can tell apart, and a stamped-on timestamp would
 * make both of them unrecognisable to save one collision.
 *
 * Overwriting was the alternative and is worse in the one case that matters: an
 * agent that runs daily produces briefings with the same title, so the second
 * day would quietly replace the first day's document with no press, no dialog
 * and nothing on screen to say a file had been lost.
 */
export function unusedExportName(taken: Iterable<string>, desired: string): string {
  const held = new Set<string>();
  for (const name of taken) {
    held.add(name.toLowerCase());
  }
  if (!held.has(desired.toLowerCase())) {
    return desired;
  }

  const extension = path.extname(desired);
  const stem = desired.slice(0, desired.length - extension.length);
  /*
   * Bounded rather than a `while (true)`.
   *
   * A caller that has somehow filled every slot gets a name that may collide
   * rather than a loop that never ends, and the write it is about to attempt is
   * the honest place for that to fail. Nothing on a real machine reaches it.
   */
  for (let index = 2; index <= 999; index += 1) {
    const candidate = `${stem} (${String(index)})${extension}`;
    if (!held.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
  return desired;
}

/**
 * Make the folder, and say what is already in it.
 *
 * One call rather than two because the caller needs both in the same breath —
 * it is about to choose a name that nothing there has — and because creating
 * the folder is what makes the answer "nothing" rather than a thrown `ENOENT`
 * on a first export.
 */
export function prepareAgentExports(dataDir: string, agent: string): {
  folder: string;
  existing: string[];
} {
  const folder = agentExportsPath(dataDir, agent);
  mkdirSync(folder, { recursive: true });
  return { folder, existing: readFoldedExportNames(folder) };
}

/**
 * What DASH has saved for this agent, newest first.
 *
 * An unreadable folder answers with an empty list rather than throwing. This is
 * read on every render of a page that polls, and a directory that has been
 * removed or locked by something else on the machine is not a reason to fail a
 * page — it is a reason for the list to say there is nothing, which is also
 * what the person would see if they opened the folder themselves.
 */
export function listAgentExports(
  dataDir: string,
  agent: string,
  limit: number = RECENT_EXPORTS_LIMIT,
): AgentExportFile[] {
  let folder: string;
  try {
    folder = agentExportsPath(dataDir, agent);
  } catch {
    return [];
  }
  if (!existsSync(folder)) {
    return [];
  }

  const found: AgentExportFile[] = [];
  for (const file of readFoldedExportNames(folder)) {
    let stats;
    try {
      stats = statSync(path.join(folder, file));
    } catch {
      // Removed between the listing and the stat, which is a race a person
      // deleting a file wins fairly. It is simply not in the list.
      continue;
    }
    found.push({
      file,
      label: file.slice(0, file.length - path.extname(file).length),
      saved_at: new Date(stats.mtimeMs).toISOString(),
      bytes: stats.size,
    });
  }

  return found
    .sort((a, b) => Date.parse(b.saved_at) - Date.parse(a.saved_at))
    .slice(0, limit);
}

/**
 * The full path of one export, or null if that name does not name one.
 *
 * **The containment check is the point of this function**, and it is why the
 * renderer may send a file name at all. `inspectComponent` refuses a separator,
 * a traversal, a drive-relative name, a control character and a Windows device
 * name; `containedIn` then refuses anything that resolved outside the folder
 * regardless. So the widest thing a compromised renderer can ask main to open
 * is a file DASH itself put in this agent's own exports folder.
 *
 * Null for a file that is not there, which a stale list produces honestly: the
 * page was drawn a moment ago and somebody has since deleted the document.
 */
export function resolveAgentExport(
  dataDir: string,
  agent: string,
  file: unknown,
): string | null {
  if (typeof file !== "string" || file === "") {
    return null;
  }
  if (inspectComponent(file) !== null) {
    return null;
  }

  let folder: string;
  try {
    folder = agentExportsPath(dataDir, agent);
  } catch {
    return null;
  }

  const candidate = path.join(folder, file);
  if (!containedIn(folder, candidate)) {
    return null;
  }
  try {
    return statSync(candidate).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

/** Regular files only, so a stray directory is never offered as a document. */
function readExportNames(folder: string): string[] {
  try {
    return readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** What a name already on disk becomes once its punctuation is folded. */
function foldedExportFileName(name: string): string {
  const extension = path.extname(name);
  const stem = name.slice(0, name.length - extension.length);
  const cleaned = foldExportBaseName(stem).slice(0, 80);
  return `${cleaned.length === 0 ? "briefing" : cleaned}${extension}`;
}

/**
 * Every name MAR-740 would have written differently, renamed in place to the
 * name it would write today.
 *
 * One-time and idempotent: a name that already equals its own folded form is
 * untouched, so a folder that has already converged costs nothing but a
 * string comparison per file on every list. `unusedExportName` is reused for
 * the same reason it exists on the write path — two mangled names (an en
 * dash and an em dash in the same title, say) can fold to the same string,
 * and the second one must not silently take the first one's place.
 *
 * A rename that fails — another process holding the file, a permission this
 * account does not have — leaves that one entry under its old name rather
 * than dropping it from the list; the fold is a courtesy, not a requirement
 * for the entry to keep being openable by the name it already has.
 */
function foldLegacyExportNames(folder: string, names: string[]): string[] {
  const held = new Set(names.map((name) => name.toLowerCase()));
  return names.map((name) => {
    const folded = foldedExportFileName(name);
    if (folded === name) {
      return name;
    }
    held.delete(name.toLowerCase());
    const finalName = unusedExportName(held, folded);
    try {
      renameSync(path.join(folder, name), path.join(folder, finalName));
      held.add(finalName.toLowerCase());
      return finalName;
    } catch {
      held.add(name.toLowerCase());
      return name;
    }
  });
}

function readFoldedExportNames(folder: string): string[] {
  return foldLegacyExportNames(folder, readExportNames(folder));
}
