/**
 * "Choose a folder", performed (MAR-598).
 *
 * ## Why this is a module and not four functions in `electron/main.ts`
 *
 * `electron/folder-update.ts`'s reason exactly, one door along: main is the
 * process that may open a dialog and touch the disk, and it is already the file
 * every feature adds to. What lives here is the *reading* and the *doing* half
 * of a flow whose deciding half is pure — `lib/folder-import.ts` — and keeping
 * the two apart is what makes the decision testable against fixtures instead of
 * against a directory a test has to build and a dialog a test cannot press.
 *
 * `main.ts` gains nothing at all. This rides `folderAction`, the dependency it
 * already injects, which is why a fourth folder verb needed no line there.
 *
 * ## What crosses the boundary, in each direction
 *
 * **Inward: nothing.** `folder.choose` has an empty payload. The renderer cannot
 * name a folder, cannot cause a particular folder to be read, and cannot learn
 * which one was offered — the chooser is a window the operating system draws,
 * which page script can neither see nor dismiss.
 *
 * **Outward: one path, on purpose.** The receipt names where DASH put its copy,
 * because a copy nobody can find is a copy nobody can edit, and editing it is
 * the whole of MAR-584's update story. `removeAgent` already names the same
 * directory in its own report. Nothing else leaves: not the folder the person
 * chose, not a digest, not a byte of any file.
 *
 * ## The order, which is the safety argument
 *
 * 1. **Ask which folder.** Nothing has been read.
 * 2. **Read it**, bounded, skipping what is never part of an agent.
 * 3. **Decide** — `inspectChosenFolder`. Still nothing written.
 * 4. **Ask the person**, naming what will be copied, where it will go, and what
 *    will run.
 * 5. Only then import, and only then write a registration.
 *
 * There is no branch here that writes without step 4 returning true, which is
 * the same guarantee `lib/handoff-flow.ts` states about its own consent gate.
 */

import { closeSync, lstatSync, openSync, readFileSync, readSync, readdirSync } from "node:fs";
import path from "node:path";

import { dialog } from "electron";

import { appWindow } from "./app-window";

import {
  AGENT_MANIFEST_FILE,
  MAX_AGENT_FOLDER_BYTES,
  MAX_AGENT_FOLDER_FILES,
  MAX_AGENT_MANIFEST_BYTES,
  agentFolderCodePath,
  agentFolderFilesDigest,
  agentFolderManifestPath,
  storedFileDigests,
  storedRelativePath,
  type AgentFolderFile,
} from "../lib/agent-folders";
import { readSourceNames } from "../lib/agent-sources";
import {
  CHOOSE_FOLDER_COPY,
  FOLDER_DECLINED,
  describeFolderAdded,
  describeFolderNotRead,
  describeFolderNotStored,
} from "../lib/copy/add-agent";
import { STORED_SOURCES_PATH } from "../lib/folder-changes";
import {
  SKIPPED_HANDOFF_FILE,
  describeFolderTooBig,
  inspectChosenFolder,
  isSkippedFolderEntry,
} from "../lib/folder-import";
import type { RunnerPort } from "../lib/handoff-flow";
import { explainImportFailure } from "../lib/import-feedback";
import { writeRegistration } from "../lib/registration";
import { importManifest, readAgentManifest } from "../lib/store";
import type { FolderActionResult } from "../lib/shell/ipc";

/**
 * Ask for a folder, then add what is in it.
 *
 * Async because two native dialogs sit inside it, which is the one thing about
 * this command that differs from its three siblings — and the reason
 * `performFolderAction` returns a union of a value and a promise rather than
 * making the other three pretend to be asynchronous.
 *
 * `runner` is the same port the handoff door already holds (MAR-616): after a
 * registration is written, the supervisor is asked to re-read its list, so a
 * Start press in this same session reaches the agent that was just added
 * instead of being refused as unknown. The receipt reports which claim is true.
 */
export async function chooseAgentFolder(
  dataDir: string,
  runner: Pick<RunnerPort, "reload"> | null,
): Promise<FolderActionResult> {
  const chosen = await askForFolder();
  if (chosen === null) {
    /*
     * Cancelled, and deliberately silent.
     *
     * A person who opened a chooser and closed it again has not failed at
     * anything, and a notice under the button saying so would be DASH reporting
     * on a decision that was already theirs. `ok: false` with no card is what
     * the page renders as nothing at all.
     */
    return { ok: false, refusal: "cancelled" };
  }

  const read = readChosenFolder(chosen);
  if (!read.ok) {
    return {
      ok: false,
      refusal: read.refusal,
      added: {
        ok: false,
        // No validator ran and none could have — DASH never reached a plan. A
        // block of schema errors here would be evidence for a claim nothing
        // made.
        card: describeFolderNotRead(read.detail),
        failure: null,
      },
    };
  }

  const decision = inspectChosenFolder({
    dataDir,
    folder: chosen,
    manifestJson: read.manifestJson,
    files: read.files,
    skipped: read.skipped,
    // The row rather than the folder: "does DASH already hold an agent by this
    // name" is a question about DASH's index, and asking the filesystem would
    // answer a different one — whether a directory happens to exist.
    known: read.manifestJson !== null && agentIsKnown(read.manifestJson),
  });

  if (!decision.ok) {
    return {
      ok: false,
      refusal: decision.refusal,
      added: { ok: false, card: decision.card, failure: decision.explanation },
    };
  }

  const agreed = await askUser(decision.prompt);
  if (!agreed) {
    return {
      ok: false,
      refusal: "declined",
      added: { ok: false, card: FOLDER_DECLINED, failure: null },
    };
  }

  // Folder first, SQLite index second — ADR 0008's order, which `importManifest`
  // performs internally. Nothing above this line has written anything.
  const imported = importManifest(decision.manifest, {
    files: decision.files,
    registration: decision.registration,
    manifestJson: decision.manifestJson,
  });
  if (!imported.ok) {
    return {
      ok: false,
      refusal: imported.locked === true ? "agent_running" : "not_stored",
      added: {
        ok: false,
        card: describeFolderNotStored(
          imported.locked === true
            ? "That agent is running and is holding its own files open. Stop it, then choose the folder again."
            : "DASH could not write its copy.",
        ),
        /*
         * The store's own errors, translated by the same function the other two
         * doors use. Reaching here at all means something the decision could not
         * see went wrong at the write — the plan was already validated and the
         * files already checked — so the raw errors travel underneath rather
         * than being paraphrased into a guess about the cause.
         */
        failure: imported.errors.length === 0 ? null : explainImportFailure(imported.errors),
      },
    };
  }

  /*
   * The re-read, and why its failure is not one.
   *
   * A runner that cannot be reached right now changes nothing about what was
   * just stored — the registration is on disk and the next DASH open reads it,
   * which is exactly the sentence the receipt falls back to. So an unreachable
   * runner degrades the *claim*, never the import: `"next_open"` is the old
   * receipt, still true, rather than an error about a step the person did not
   * ask for.
   */
  let start: "ready" | "next_open" | "none" = "none";
  if (decision.registration !== undefined) {
    recordRegistration(dataDir, decision.agent, decision);
    start = runner !== null && (await runner.reload()).ok ? "ready" : "next_open";
  }

  return {
    ok: true,
    added: {
      ok: true,
      card: describeFolderAdded({
        display_name: decision.display_name,
        destination: decision.destination,
        replaced: decision.replaced,
        start,
      }),
      failure: null,
    },
  };
}

/* ---------------------------------------------------------------------- *
 * The two dialogs
 * ---------------------------------------------------------------------- */

/**
 * The operating system's own folder chooser.
 *
 * `openDirectory` alone, so there is no way to arrive here with a file. The
 * button label is DASH's own words rather than the platform's default "Open",
 * which on this screen would be a verb about a folder somebody is not opening.
 *
 * Modal on the DASH window when there is one, for `askUser`'s reason in
 * `electron/handoff-host.ts`: a chooser that can be lost behind the window it
 * belongs to is a chooser somebody reports as a hang.
 */
async function askForFolder(): Promise<string | null> {
  const parent = appWindow();
  const options = {
    title: CHOOSE_FOLDER_COPY.action,
    buttonLabel: CHOOSE_FOLDER_COPY.action,
    properties: ["openDirectory" as const],
  };
  const answer =
    parent === null
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(parent, options);
  const folder = answer.filePaths[0];
  return answer.canceled || folder === undefined ? null : folder;
}

/**
 * Ask the person, modally, on top of the DASH window if there is one.
 *
 * `cancelId` and `defaultId` both point at "no", for the reason
 * `electron/handoff-host.ts` gives: a dialog that copies a folder and registers
 * a program when somebody hits Return by reflex is not a consent dialog, and
 * the cost of getting it wrong is asymmetric.
 *
 * **No expiry, unlike the handoff's**, and the difference is real rather than an
 * omission. A handoff is a proposal that arrived from somewhere else and may
 * have been sitting in a queue; this question is about a folder the person named
 * themselves, seconds ago, in a window they are still looking at. A timeout
 * would close a dialog underneath somebody reading it.
 */
async function askUser(prompt: {
  title: string;
  message: string;
  detail: string;
  confirm_label: string;
  cancel_label: string;
}): Promise<boolean> {
  const parent = appWindow();
  const options = {
    type: "question" as const,
    title: prompt.title,
    message: prompt.message,
    detail: prompt.detail,
    buttons: [prompt.confirm_label, prompt.cancel_label],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  };
  const answer =
    parent === null
      ? await dialog.showMessageBox(options)
      : await dialog.showMessageBox(parent, options);
  return answer.response === 0;
}

/* ---------------------------------------------------------------------- *
 * Reading the folder
 * ---------------------------------------------------------------------- */

type ChosenFolderContents =
  | { ok: true; manifestJson: string | null; files: AgentFolderFile[]; skipped: number }
  | { ok: false; refusal: "unreadable" | "too_big"; detail: string };

/**
 * Whether a file is text DASH can store, decided on its first bytes.
 *
 * A NUL byte in the first block is the classic test and it is the right one
 * here: every format the folder store can hold is source, configuration or
 * prose, and none of those contains a NUL. Cheap, and wrong only in the safe
 * direction — a text file misread as binary is left alone and counted, where a
 * binary file misread as text would be copied corrupted and counted as fine.
 */
function isProbablyText(head: Buffer): boolean {
  return !head.includes(0);
}

/**
 * The first block of a file, so a large one can be classified without loading
 * it.
 *
 * An empty buffer for anything that cannot be opened, which classifies as text
 * and lets the full read below produce the real outcome — one place deciding
 * that a file is unreadable is better than two disagreeing about it.
 */
function headOf(file: string): Buffer {
  const buffer = Buffer.alloc(8192);
  let handle: number;
  try {
    handle = openSync(file, "r");
  } catch {
    return Buffer.alloc(0);
  }
  try {
    const read = readSync(handle, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, read);
  } catch {
    return Buffer.alloc(0);
  } finally {
    closeSync(handle);
  }
}

/**
 * Everything DASH would copy out of one chosen folder, or why it will not.
 *
 * ## Why this walks, when `readStoredFileDigests` is emphatic about never
 * walking
 *
 * That rule is about *comparison*: DASH must re-read exactly the files it was
 * handed, because an agent writes its own reports into the folder it runs in
 * and a walk would report those as somebody's edit. This is *acquisition*, the
 * one moment where there is no previous list to re-read — the person is
 * handing DASH a folder it has never seen, and the only way to find out what is
 * in it is to look.
 *
 * What keeps that honest is the pair below: a skip list so an ordinary project's
 * dependencies and version history are never mistaken for the agent, and hard
 * ceilings so a folder that is not one agent is refused with a sentence rather
 * than copied for a minute and a half. Both are `lib/folder-import.ts`'s, so a
 * test can state what DASH will and will not take without an Electron process.
 *
 * Symbolic links are skipped entirely, not followed. A link is the one entry
 * that can leave the folder the person chose, and DASH taking a copy of
 * something outside the folder it was pointed at is exactly the surprise this
 * whole flow exists to avoid.
 */
function readChosenFolder(folder: string): ChosenFolderContents {
  let manifestJson: string | null = null;
  const files: AgentFolderFile[] = [];
  let bytes = 0;
  let skipped = 0;

  const walk = (directory: string, prefix: string): ChosenFolderContents | null => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return prefix === ""
        ? { ok: false, refusal: "unreadable", detail: "DASH could not read that folder." }
        : // A subdirectory DASH cannot read is not a reason to refuse the whole
          // agent: the copy is simply missing that part, and the consent dialog
          // already says how many files DASH is about to take.
          null;
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink() || isSkippedFolderEntry(entry.name)) {
        continue;
      }
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const absolute = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        const refused = walk(absolute, relative);
        if (refused !== null) {
          return refused;
        }
        continue;
      }
      if (!entry.isFile() || relative === SKIPPED_HANDOFF_FILE) {
        continue;
      }

      let size: number;
      try {
        size = lstatSync(absolute).size;
      } catch {
        continue;
      }
      if (relative === AGENT_MANIFEST_FILE && size > MAX_AGENT_MANIFEST_BYTES) {
        return {
          ok: false,
          refusal: "too_big",
          detail: describeFolderTooBig("bytes"),
        };
      }
      /*
       * Text only, and skipped rather than mangled — decided before this file
       * counts towards anything.
       *
       * `AgentFolderFile.contents` is a string and the folder store writes it
       * back as UTF-8 — the handoff contract is text in this slice, which is
       * fine for a handoff because the Agent Kit only ever declares text files.
       * A folder somebody chose has no such guarantee: it can hold an icon, a
       * font, a compiled thing. Reading one as UTF-8 and writing it back
       * produces a file of the right name and the wrong bytes, which is worse
       * than not copying it, because nothing downstream can tell.
       *
       * **Classified before the ceilings, not after**, and the order is the
       * whole point. Counting a file DASH is not going to copy would let a
       * single large asset — a video in an agent's own `assets` folder — refuse
       * a perfectly ordinary agent with a sentence telling its author to choose
       * a folder holding one agent, which is what they already did. What is
       * bounded is what DASH keeps.
       */
      if (!isProbablyText(headOf(absolute))) {
        skipped += 1;
        continue;
      }

      bytes += size;
      if (files.length >= MAX_AGENT_FOLDER_FILES) {
        return { ok: false, refusal: "too_big", detail: describeFolderTooBig("files") };
      }
      if (bytes > MAX_AGENT_FOLDER_BYTES) {
        return { ok: false, refusal: "too_big", detail: describeFolderTooBig("bytes") };
      }

      let contents: string;
      try {
        contents = readFileSync(absolute, "utf8");
      } catch {
        // One unreadable file, not a refusal — see the directory case above.
        continue;
      }
      if (relative === AGENT_MANIFEST_FILE) {
        manifestJson = contents;
      }
      files.push({ path: relative, contents });
    }
    return null;
  };

  const refused = walk(folder, "");
  if (refused !== null) {
    return refused;
  }
  return { ok: true, manifestJson, files, skipped };
}

/** Whether DASH's index already holds the agent this folder's plan names. */
function agentIsKnown(manifestJson: string): boolean {
  try {
    const name = (JSON.parse(manifestJson) as { agent?: { name?: unknown } }).agent?.name;
    return typeof name === "string" && readAgentManifest(name) !== null;
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------------- *
 * Recording what DASH accepted
 * ---------------------------------------------------------------------- */

/**
 * Write the registration and the baseline MAR-584's detector compares against.
 *
 * Deliberately the same three values `lib/handoff-flow.ts` records at the same
 * moment and for its stated reason: this is the one instant DASH is certain what
 * it accepted, because `importManifest` has just written those exact bytes.
 * Recomputing the baseline later from the folder would be recording whatever is
 * there then and calling it approved.
 *
 * `owner` is `dash_handoff` and that is not a lie about where this came from —
 * it is the ownership flag meaning *DASH wrote this and DASH may remove it*, as
 * against `external`, which means somebody put a registration here by hand and
 * DASH must leave it alone. An agent added through this door is DASH's to
 * remove, which is what `removeAgent` needs to be true.
 */
function recordRegistration(
  dataDir: string,
  agent: string,
  decision: {
    display_name: string;
    manifestJson: string;
    files: readonly AgentFolderFile[];
    registration: { command: string; args: string[]; env?: Record<string, string> } | undefined;
    manifest: { agent: { goal: string } };
  },
): void {
  if (decision.registration === undefined) {
    return;
  }
  writeRegistration(dataDir, {
    registration: {
      agent_id: agent,
      manifest_path: agentFolderManifestPath(dataDir, agent),
      command: decision.registration.command,
      args: decision.registration.args,
      cwd: agentFolderCodePath(dataDir, agent),
      env: decision.registration.env,
    },
    ownership: {
      owner: "dash_handoff",
      // No handoff document was involved, and saying so with a value that looks
      // like one would put a fabricated id into a durable artifact. Absent is
      // the honest record of "this agent was chosen, not handed over".
      handoff_id: undefined,
      source_project: undefined,
      display_name: decision.display_name,
      summary: decision.manifest.agent.goal,
      registered_at: new Date().toISOString(),
    },
    manifestJson: decision.manifestJson,
    storedManifestPath: agentFolderManifestPath(dataDir, agent),
    filesDigest: agentFolderFilesDigest(decision.files),
    acceptedFiles: storedFileDigests(decision.files),
    acceptedSources: acceptedSourceNames(decision.files),
  });
}

/**
 * The source names in the folder DASH is accepting, or undefined (MAR-584).
 *
 * `lib/handoff-flow.ts`'s function of the same name, and undefined means the
 * same thing here: DASH has no previous list to compare against later, so the
 * detector says exactly that rather than inventing an empty one.
 */
function acceptedSourceNames(files: readonly AgentFolderFile[]): string[] | undefined {
  for (const file of files) {
    if (storedRelativePath(file.path) === STORED_SOURCES_PATH) {
      return readSourceNames(file.contents) ?? undefined;
    }
  }
  return undefined;
}
