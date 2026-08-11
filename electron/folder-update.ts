/**
 * The three folder commands, performed (MAR-584).
 *
 * ## Why this is a module and not four functions in `electron/main.ts`
 *
 * The same reason `electron/credential-prompt.ts` and `electron/ssh-host.ts`
 * are: main is the process that may touch the disk, and it is already the file
 * every feature adds to. What lives here is the *reading* half of a comparison
 * whose deciding half is pure — `lib/folder-changes.ts` — and keeping the two
 * apart is what makes the decision testable against fixtures rather than against
 * a directory a test has to build.
 *
 * `main.ts` gains one entry in the dispatch context and nothing else.
 *
 * ## What each command may reach
 *
 * `check` reads. It opens the folder manifest and exactly the files DASH
 * recorded — never a walk, see `readStoredFileDigests` — and returns worded
 * sentences. Nothing it produces carries a path, a digest or a byte of file
 * content: the renderer learns that two files of the program changed, not which
 * or where.
 *
 * `adopt` writes DASH's *record* and never the folder. That is not an
 * optimisation; `importManifest` would stage a complete replacement folder and
 * swap it in, deleting everything not re-declared — including the agent's own
 * reports. See `acceptFolderManifest` for the whole argument.
 *
 * `reveal` opens a window. It is the only one that takes an action on the user's
 * machine outside DASH, and the path it opens is resolved here from an agent
 * name: no path crosses the boundary in either direction, which is
 * `workspace.download`'s discipline applied to the other command that turns a
 * click into a place on disk.
 *
 * `choose` (MAR-598) is the fourth and lives in `electron/folder-import.ts`
 * rather than here. It is routed from this file because it is a folder command
 * and shares this file's seam, but it is the only one that names no agent, opens
 * two dialogs and waits for a person — so it is a module of its own for the same
 * reason this one is a module and not four functions in main.
 */

import { existsSync } from "node:fs";

import { shell } from "electron";

import {
  agentFolderPath,
  readAgentFolderManifest,
  readStoredFile,
  readStoredFileDigests,
} from "../lib/agent-folders";
import { readSourceNames } from "../lib/agent-sources";
import { validateManifest } from "../lib/contracts";
import {
  describeFolderChanges,
  STORED_SOURCES_PATH,
  type CurrentFolder,
  type CurrentManifest,
} from "../lib/folder-changes";
import { chooseAgentFolder } from "./folder-import";
import { checkManifestConstraints } from "../lib/manifest-constraints";
import { readRegistration, writeRegistration } from "../lib/registration";
import { acceptFolderManifest, readAgentManifest } from "../lib/store";
import type { FolderAction, FolderActionResult } from "../lib/shell/ipc";

/** Every refusal these three can produce, named once. */
const NO_SUCH_AGENT: FolderActionResult = {
  ok: false,
  refusal: "unknown_agent",
  detail: "DASH has no saved setup for that agent.",
};

/**
 * Route one folder command.
 *
 * The switch is exhaustive over `FolderAction` rather than defaulting, so adding
 * a fifth verb to `FOLDER_ACTIONS` is a compile error here instead of a command
 * that is accepted at the boundary and silently does nothing. MAR-598's
 * `choose` is the fourth, and it arrived through exactly that failure.
 *
 * ## Two signatures widened, and neither is a loosening
 *
 * `agentId` is optional because `choose` names no agent — there is no agent yet,
 * which is that command's whole situation. The other three refuse an absent one
 * with the refusal they already had for an unknown agent, so a request that
 * somehow reached here without the field main was promised gets a sentence
 * rather than a lookup on the word "undefined".
 *
 * The return type gained a promise for the same one command, because it opens
 * two native dialogs and waits for a person. Main already wraps this call in
 * `Promise.resolve`, which flattens one and passes the other three through
 * untouched — so this needed no line in `electron/main.ts`.
 *
 * `runner` is `choose`'s alone (MAR-616): the door that writes a registration is
 * the door that must ask the supervisor to re-read its list. The other three
 * verbs never register anything, so none of them takes the port.
 */
export function performFolderAction(
  dataDir: string,
  action: FolderAction,
  agentId: string | undefined,
  runner: Parameters<typeof chooseAgentFolder>[1],
): FolderActionResult | Promise<FolderActionResult> {
  if (action === "choose") {
    return chooseAgentFolder(dataDir, runner);
  }
  if (agentId === undefined) {
    return NO_SUCH_AGENT;
  }
  switch (action) {
    case "check":
      return checkFolder(dataDir, agentId);
    case "adopt":
      return adoptFolder(dataDir, agentId);
    case "reveal":
      return revealFolder(dataDir, agentId);
  }
}

/* ---------------------------------------------------------------------- *
 * Reading the folder as it is now
 * ---------------------------------------------------------------------- */

/**
 * How the folder's document reads, in the three states the comparison knows.
 *
 * Both gates run — the schema and then `checkManifestConstraints` — because both
 * run at import, and a change that would be refused at the front door must not
 * be accepted through this one. Their errors go into the same `invalid` case, so
 * `explainImportFailure` translates an externally edited folder exactly as it
 * translates a first import: the same headline, the same suggestion, the same
 * validator output underneath.
 */
function readCurrentManifest(dataDir: string, agent: string): CurrentManifest {
  const read = readAgentFolderManifest(dataDir, agent);
  if (!read.ok) {
    return { kind: "unreadable" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(read.json);
  } catch {
    return { kind: "invalid", errors: ["/manifest is not readable JSON"] };
  }
  const validation = validateManifest(parsed);
  if (!validation.ok) {
    return { kind: "invalid", errors: validation.errors };
  }
  const contradictions = checkManifestConstraints(validation.value);
  if (contradictions.length > 0) {
    return { kind: "invalid", errors: contradictions };
  }
  return { kind: "readable", manifest: parsed };
}

/**
 * The source names on disk right now, or null.
 *
 * Null covers both "there is no such file" and "it is there and is not a list
 * DASH can read" — the two cases `readSourceNames` deliberately collapses, so a
 * reformatted file produces the summary-unavailable sentence rather than
 * "every source was removed".
 *
 * Through `readStoredFile` rather than a `path.join` here: the one place in DASH
 * that turns a stored relative path into a location is `lib/agent-folders.ts`,
 * and a second one in the process that reads user-influenced folders is how a
 * containment check comes to have an exception.
 */
function readCurrentSources(dataDir: string, agent: string): string[] | null {
  const read = readStoredFile(dataDir, agent, STORED_SOURCES_PATH);
  return read.ok ? readSourceNames(read.contents) : null;
}

/* ---------------------------------------------------------------------- *
 * check
 * ---------------------------------------------------------------------- */

function checkFolder(dataDir: string, agent: string): FolderActionResult {
  const row = readAgentManifest(agent);
  if (row === null) {
    return NO_SUCH_AGENT;
  }
  const registration = readRegistration(dataDir, agent);
  const baseline = registration?.dash.accepted_files;
  const paths = (baseline ?? []).map((file) => file.path);

  const current: CurrentFolder = {
    manifest: readCurrentManifest(dataDir, agent),
    files: readStoredFileDigests(dataDir, agent, paths),
    sources: readCurrentSources(dataDir, agent),
    tracks_sources: paths.includes(STORED_SOURCES_PATH),
  };

  const report = describeFolderChanges(
    {
      // The row, which is DASH's projection of the folder *as it was accepted* —
      // and stays that way because `reconcileAgentFolders` no longer projects an
      // externally edited folder over it. Reading the folder for both sides of
      // this comparison would compare a document with itself.
      manifest: row,
      files: baseline,
      sources: registration?.dash.accepted_sources,
    },
    current,
  );
  return { ok: true, report };
}

/* ---------------------------------------------------------------------- *
 * adopt
 * ---------------------------------------------------------------------- */

/**
 * Accept what is in the folder, and move the baseline to match.
 *
 * The order is the same one ADR 0008 requires of an import and for the same
 * reason: the durable source of truth first, its projection second. Here the
 * folder is already the source of truth — the person's editor wrote it — so the
 * first step is the row, and the registration's baseline follows it. A failure
 * between them leaves a row that agrees with the folder and a baseline that does
 * not, which the next check reports as a change the person has already accepted:
 * confusing, and honest. The other order would leave DASH describing the agent
 * with a document nobody accepted, which is the state this whole issue exists to
 * prevent.
 */
function adoptFolder(dataDir: string, agent: string): FolderActionResult {
  if (readAgentManifest(agent) === null) {
    return NO_SUCH_AGENT;
  }
  const read = readAgentFolderManifest(dataDir, agent);
  if (!read.ok) {
    return {
      ok: false,
      refusal: "folder_unreadable",
      detail: "DASH cannot read what it saved for this agent, so there is nothing to accept.",
    };
  }

  const accepted = acceptFolderManifest(agent, read.json);
  if (!accepted.ok) {
    return {
      ok: false,
      refusal: "refused_at_import",
      // The validator's own account travels on `folder.check`, which is where a
      // person reads it. This is the one sentence the button needs, and it says
      // the thing they will want to know first.
      detail: "DASH could not accept this setup, so nothing was changed.",
    };
  }

  moveBaseline(dataDir, agent, read.json);
  return { ok: true };
}

/**
 * Re-record what DASH has just accepted.
 *
 * Reads the current bytes of exactly the paths the old baseline named, which is
 * the same set the comparison ran over. A file the editor *added* is still not
 * tracked afterwards — the limit `readStoredFileDigests` states and
 * `FOLDER_CHECK_COPY` tells the person about — and a file it *removed* is
 * dropped from the baseline here rather than being carried forward as a
 * permanent "1 file is no longer there".
 *
 * Silent when there is no registration or no previous baseline. Those are the
 * standings that have no record to move, and inventing one from a folder DASH
 * did not write would be recording an edit as an approval.
 */
function moveBaseline(dataDir: string, agent: string, manifestJson: string): void {
  const registration = readRegistration(dataDir, agent);
  const previous = registration?.dash.accepted_files;
  if (registration === null || previous === undefined) {
    return;
  }

  const readings = readStoredFileDigests(
    dataDir,
    agent,
    previous.map((file) => file.path),
  );
  const files = readings
    .filter((reading): reading is { path: string; sha256: string } => reading.sha256 !== null)
    .map((reading) => ({ path: reading.path, sha256: reading.sha256 }));

  writeRegistration(dataDir, {
    registration: {
      agent_id: registration.agent_id,
      manifest_path: registration.manifest_path,
      command: registration.command,
      args: registration.args,
      cwd: registration.cwd,
      env: registration.env,
    },
    ownership: {
      owner: registration.dash.owner,
      handoff_id: registration.dash.handoff_id,
      source_project: registration.dash.source_project,
      display_name: registration.dash.display_name,
      summary: registration.dash.summary,
      registered_at: registration.dash.registered_at,
    },
    manifestJson,
    // DASH's copy is the folder's own file, which is where it already was. Named
    // rather than left to default, so this never falls back to the pre-ADR 0008
    // managed-manifest location and starts a second document.
    storedManifestPath: registration.manifest_path,
    filesDigest: registration.dash.files_sha256,
    acceptedFiles: files,
    acceptedSources: readCurrentSources(dataDir, agent) ?? undefined,
  });
}

/* ---------------------------------------------------------------------- *
 * reveal
 * ---------------------------------------------------------------------- */

function revealFolder(dataDir: string, agent: string): FolderActionResult {
  let folder: string;
  try {
    folder = agentFolderPath(dataDir, agent);
  } catch {
    return NO_SUCH_AGENT;
  }
  if (!existsSync(folder)) {
    return {
      ok: false,
      refusal: "folder_missing",
      detail:
        "DASH has no folder of its own for this agent yet, so there is nothing to open. Add it again from its own folder.",
    };
  }
  // `openPath` and not `showItemInFolder`: the person is being sent *into* this
  // folder to point an editor at it, not shown it highlighted in its parent.
  void shell.openPath(folder);
  return { ok: true };
}
