/**
 * Adding an agent by choosing its folder: the whole decision, in one testable
 * place (MAR-598).
 *
 * `electron/folder-import.ts` opens the operating system's folder chooser, reads
 * what is inside, and hands the bytes here. Everything that *decides* anything
 * happens in this module — is this an agent, may DASH store it, does it carry a
 * program, where does the copy go, and what is the person about to be asked —
 * so the paths that matter are covered by the suite that runs on every push
 * rather than by a local Electron run somebody has to remember to do.
 *
 * That split is `lib/handoff-flow.ts`'s and it is deliberate that this reads
 * like it: **this is the same import, through a third door.** `open-in-dash`
 * arrives as a deep link, an outside editor arrives through `folder.adopt`, and
 * a person pointing at a folder arrives here. All three end at
 * `importManifest`, all three refuse with `explainImportFailure`'s words, and
 * all three ask before writing anything.
 *
 * ## What this door has that the handoff does not, and what it lacks
 *
 * It **lacks a nonce**, and that is correct rather than a gap. The nonce exists
 * because a `dash://` URL is attacker-authored: it proves the opener could read
 * a file on this disk, which a drive-by web page cannot. Nothing here is
 * attacker-authored — the folder was named by a person in their own operating
 * system's chooser, a window DASH does not draw and page script cannot reach.
 * The question "who asked" is answered by the chooser itself; the question
 * "should it happen" is answered by the same consent dialog every other import
 * ends at, which is not weakened by a byte.
 *
 * It **has a copy step** the handoff performs implicitly. A handoff carries its
 * own file contents; a chosen folder is a place on somebody's disk, and DASH
 * takes its own copy of it. `describeChosenFolder` says so before the copy, and
 * `lib/copy/add-agent.ts` says where it went afterwards. Copy and never move:
 * taking a person's folder away is a decision they did not make.
 */

import path from "node:path";

import {
  AGENT_CODE_DIRECTORY,
  AGENT_MANIFEST_FILE,
  MAX_AGENT_FOLDER_BYTES,
  MAX_AGENT_FOLDER_FILES,
  agentFolderPath,
  agentsRoot,
  storedRelativePath,
  validateAgentFolderFiles,
  type AgentFolderFile,
} from "./agent-folders";
import { isManifestV2, validateManifest, type AnyAgentManifest } from "./contracts";
import {
  CANNOT_START,
  FOLDER_ALREADY_IN_DASH,
  FOLDER_CANNOT_BE_STORED,
  FOLDER_NOT_AN_AGENT,
  WILL_START,
  type AddAgentCard,
} from "./copy/add-agent";
import { humanizeAgentName } from "./copy/agent-name";
import {
  explainImportFailure,
  explainNoAgentInFolder,
  explainNotJson,
  type ImportFailureExplanation,
} from "./import-feedback";
import {
  connectionSentence,
  permissionLines,
  startSentence,
  type HandoffPrompt,
} from "./handoff-flow";
import { checkManifestConstraints } from "./manifest-constraints";
import { BUNDLED_NODE_COMMAND, type AgentRegistration } from "./registration";
import { containedIn } from "../runner/path-guard";

/**
 * Directories DASH never copies out of a folder somebody chose.
 *
 * The ceilings below are the safety rail; this list is the reason a person does
 * not hit them on an ordinary project. An agent's dependencies, its version
 * history and its build output are all reproducible from the program, all
 * routinely larger than everything else combined, and none of them is what
 * anybody means when they say "this agent's folder".
 *
 * `dash-handoff.json` is skipped for a different reason and it is worth stating
 * separately: it carries a single-use proof of possession minted by the Agent
 * Kit, and copying somebody's nonce into a second directory DASH then owns
 * forever is the kind of quiet duplication `lib/handoff.ts` writes that file
 * 0600 to prevent.
 */
export const SKIPPED_FROM_CHOSEN_FOLDER = [
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".venv",
  "__pycache__",
] as const;

/** The single-use proof of possession the Agent Kit writes. Never copied. */
export const SKIPPED_HANDOFF_FILE = "dash-handoff.json";

/** True for a path segment DASH will not walk into. */
export function isSkippedFolderEntry(name: string): boolean {
  return (SKIPPED_FROM_CHOSEN_FOLDER as readonly string[]).includes(name);
}

/**
 * The program file an Agent Kit project is started from.
 *
 * Named here rather than inferred from the manifest because the manifest does
 * not carry one: `agent_dom.runtime` describes what *kind* of thing an agent is
 * — a local process, a scheduled job — and deliberately not which file to
 * spawn. Every folder DASH can start therefore has to be recognised by its
 * shape, and this is the shape both `agent-kit/open-in-dash.ts` and DASH's own
 * scaffold produce.
 */
export const AGENT_PROGRAM_FILE = "agent.mjs";

/** Where `AGENT_PROGRAM_FILE` ends up once the folder is stored. */
const STORED_PROGRAM_PATH = `${AGENT_CODE_DIRECTORY}/${AGENT_PROGRAM_FILE}`;

/** What the Electron half read out of the folder the person chose. */
export interface ChosenFolderRead {
  /** DASH's data directory — the resolved one, never a computed convention. */
  dataDir: string;
  /** The folder the person picked, exactly as the operating system reported it. */
  folder: string;
  /**
   * `agent.manifest.json` at the folder's root, or null when there is none.
   *
   * Null rather than an empty string, so "there is no agent here" and "there is
   * an agent here whose plan is empty" stay different answers with different
   * sentences.
   */
  manifestJson: string | null;
  /** Every file DASH would copy, project-relative, already read and bounded. */
  files: readonly AgentFolderFile[];
  /**
   * How many files the read left behind because they are not text.
   *
   * Carried so the consent dialog can say it. The folder store holds text, so a
   * chosen folder's icon or compiled artifact is skipped rather than copied
   * corrupted — and a person approving a copy is owed the number, because "DASH
   * took a copy of your folder" and "DASH took a copy of most of your folder"
   * are different promises.
   */
  skipped: number;
  /** True when DASH already holds an agent under the manifest's own name. */
  known: boolean;
}

export type ChosenFolder =
  | {
      ok: true;
      agent: string;
      display_name: string;
      manifest: AnyAgentManifest;
      manifestJson: string;
      files: readonly AgentFolderFile[];
      /**
       * Present only for a folder DASH can actually start.
       *
       * Absent leaves the agent in ADR 0008's manifest-only standing: DASH knows
       * what it plans to do and says plainly that it cannot run it, rather than
       * writing a registration the runner would refuse at spawn.
       */
      registration: AgentRegistration | undefined;
      /** Where DASH's copy will live. */
      destination: string;
      /** True when DASH already holds an agent by this name. */
      replaced: boolean;
      prompt: HandoffPrompt;
    }
  | {
      ok: false;
      refusal: "not_an_agent" | "already_stored" | "cannot_store";
      /** Worded by `lib/copy/add-agent.ts` and nowhere else. */
      card: AddAgentCard;
      /** `explainImportFailure`'s own account, or null when no validator ran. */
      explanation: ImportFailureExplanation | null;
    };

/**
 * Decide what a chosen folder is, and what the person is about to be asked.
 *
 * The order of the checks is the same argument `openHandoff` opens with: read,
 * validate, refuse anything the runner would refuse later, and only then compose
 * a question. Nothing in this function writes, and nothing that follows it may
 * write before `prompt` has been answered.
 */
export function inspectChosenFolder(read: ChosenFolderRead): ChosenFolder {
  if (read.manifestJson === null) {
    return {
      ok: false,
      refusal: "not_an_agent",
      card: FOLDER_NOT_AN_AGENT,
      explanation: explainNoAgentInFolder("no agent plan was found in the chosen folder"),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(read.manifestJson);
  } catch (error: unknown) {
    return {
      ok: false,
      refusal: "not_an_agent",
      card: FOLDER_NOT_AN_AGENT,
      explanation: explainNotJson(error instanceof Error ? error.message : String(error)),
    };
  }

  const validation = validateManifest(parsed);
  if (!validation.ok) {
    return refusedByValidator(validation.errors);
  }
  // The contradiction ADR 0006 refuses at import, refused at this door too, for
  // `readManifestFor`'s reason: a refusal that happens after the user approved
  // the dialog is a dialog that wasted their time.
  const contradictions = checkManifestConstraints(validation.value);
  if (contradictions.length > 0) {
    return refusedByValidator(contradictions);
  }

  const manifest = validation.value;
  const agent = manifest.agent.name;
  const destination = agentFolderPath(read.dataDir, agent);

  /*
   * The folder is already DASH's own, and this is a refusal rather than a
   * no-op copy.
   *
   * Re-importing DASH's own folder from itself would stage a complete
   * replacement and swap it in — the exact hazard `acceptFolderManifest` exists
   * to avoid, which would take the agent's own reports and run history with it.
   * The door that belongs to this situation already exists and is one press away
   * on the agent's own page, so this says which one rather than doing something
   * clever.
   */
  if (isInsideDashKeeping(read.dataDir, read.folder)) {
    return {
      ok: false,
      refusal: "already_stored",
      card: FOLDER_ALREADY_IN_DASH,
      explanation: null,
    };
  }

  // The same guard the write will apply, applied before the person is asked.
  const fileErrors = validateAgentFolderFiles(read.dataDir, agent, read.files);
  if (fileErrors.length > 0) {
    return {
      ok: false,
      refusal: "cannot_store",
      card: FOLDER_CANNOT_BE_STORED,
      explanation: explainImportFailure(fileErrors),
    };
  }

  /*
   * MAR-595 finding 10, at this door. `display_name` is optional in the schema
   * and absent from the validated type, so it is read off the parsed document
   * rather than the narrowed one — and when it is missing DASH shows a humanised
   * name instead of the raw slug it would otherwise store and display verbatim.
   */
  const declaredName = (parsed as { agent?: { display_name?: unknown } }).agent?.display_name;
  const display_name =
    typeof declaredName === "string" && declaredName.length > 0
      ? declaredName
      : humanizeAgentName(agent);

  /*
   * A program, or honestly none.
   *
   * v1 is deliberately never startable. `runner/README.md` requires v2 before
   * spawning anything, so registering a v1 agent would write a registration the
   * runner refuses — a button that looks like it works and does not. DASH still
   * takes the plan, which is exactly what importing a v1 manifest has always
   * meant on the paste path.
   */
  const carriesProgram = read.files.some(
    (file) => storedRelativePath(file.path) === STORED_PROGRAM_PATH,
  );
  const startable = carriesProgram && isManifestV2(manifest);
  const registration: AgentRegistration | undefined = startable
    ? {
        agent_id: agent,
        // DASH's own copy, named the same way a folder-carrying handoff names
        // it. Not the author's path: that folder is theirs and DASH does not run
        // out of it.
        manifest_path: AGENT_MANIFEST_FILE,
        // The bundled interpreter rather than `node`, and this is the whole
        // reason a novice can use this button. The Agent Kit registers `node`
        // because somebody who typed `npx` demonstrably has it; the person this
        // page is for installed DASH from the Store and has never installed
        // anything else. See `BUNDLED_NODE_COMMAND`.
        command: BUNDLED_NODE_COMMAND,
        args: [AGENT_PROGRAM_FILE],
        cwd: AGENT_CODE_DIRECTORY,
      }
    : undefined;

  return {
    ok: true,
    agent,
    display_name,
    manifest,
    manifestJson: read.manifestJson,
    files: read.files,
    registration,
    destination,
    replaced: read.known,
    prompt: describeChosenFolder({
      display_name,
      summary: manifest.agent.goal,
      source: read.folder,
      destination,
      manifest,
      registration,
      replaced: read.known,
      files: read.files.length,
      skipped: read.skipped,
    }),
  };
}

function refusedByValidator(errors: string[]): ChosenFolder {
  return {
    ok: false,
    refusal: "not_an_agent",
    card: FOLDER_NOT_AN_AGENT,
    explanation: explainImportFailure(errors),
  };
}

/**
 * Whether the chosen folder is inside the directory DASH keeps its own copies
 * in.
 *
 * The whole root and not just this agent's folder within it. A person who
 * navigated into DASH's keeping and picked a *sibling* agent's folder, or the
 * root itself, is in the same situation for the same reason — and a check that
 * only recognised the exact destination would let the two neighbouring cases
 * through into a self-overwriting import.
 */
function isInsideDashKeeping(dataDir: string, folder: string): boolean {
  const root = agentsRoot(dataDir);
  return path.resolve(root) === path.resolve(folder) || containedIn(root, folder);
}

/* ---------------------------------------------------------------------- *
 * The words
 * ---------------------------------------------------------------------- */

/**
 * The consent question for a folder somebody just chose.
 *
 * Deliberately `describeNewAgent`'s shape, sentence for sentence, because it is
 * the same decision: what it is, where its files come from, what will run, what
 * it will ask to connect to, what it says it will do. Three of those sentences
 * are literally the handoff's own functions rather than copies, so the two doors
 * cannot start describing the same agent differently.
 *
 * Two clauses are this door's own. The **copy** clause has to be here because
 * this is the only import where the person is looking at a folder they own and
 * needs to know DASH is not about to take it. The **cannot start it** clause
 * replaces the start sentence when the folder carries no program DASH can run,
 * rather than being omitted — a dialog that quietly said less would let somebody
 * approve adding a thing on the understanding that it was about to do something.
 */
export function describeChosenFolder(input: {
  display_name: string;
  summary: string;
  source: string;
  destination: string;
  manifest: AnyAgentManifest;
  registration: AgentRegistration | undefined;
  replaced: boolean;
  /** How many files DASH is about to copy. */
  files: number;
  /** How many it is leaving behind because they are not text. */
  skipped: number;
}): HandoffPrompt {
  // Bound to a const so the narrowing survives into `startSentence` below: a
  // parameter is a mutable binding, and TypeScript will not carry a null check
  // on one across the array literal.
  const program = input.registration;
  const startable = program !== undefined;
  /*
   * The count, and the honest footnote when there is one.
   *
   * "DASH is about to take a copy of your folder" is the promise this dialog
   * makes, and it is only exactly true when everything in the folder is coming.
   * Dependencies, version history and build output are skipped by design and
   * nobody means those when they say "my agent's folder" — but a file left
   * behind because DASH cannot store it is a real gap in the promise, so it is
   * said, with its number, before anybody agrees to anything.
   */
  const copyLines = [
    `Its files come from the folder you chose: ${input.source}`,
    `DASH will copy ${plural(input.files, "file", "files")} into a folder of its own: ${input.destination}`,
    ...(input.skipped === 0
      ? []
      : [
          `${plural(input.skipped, "file is", "files are")} not being copied, because ${input.skipped === 1 ? "it is" : "they are"} not text DASH can keep.`,
        ]),
    "Your folder is not moved, changed or deleted. DASH runs its copy, so later edits to your folder do not reach it.",
  ];

  /*
   * What will run, and when — two sentences, never one.
   *
   * `startSentence` is the handoff's own and answers *what*: the program DASH
   * will spawn, named, because a dialog that asks permission to execute
   * something while declining to say what would be worse than the jargon it was
   * avoiding. `WILL_START` answers *when*, and the honest answer is not "now":
   * the part of DASH that supervises agents reads its list when DASH opens, and
   * this command does not make it re-read. A button labelled "Add and start"
   * over that would be a promise nothing here keeps.
   */
  const programLines = program === undefined ? [CANNOT_START] : [startSentence(program), WILL_START];

  if (input.replaced) {
    return {
      title: "Update this agent?",
      message: `“${input.display_name}” is already in DASH. Replace it with what is in that folder?`,
      detail: [
        ...copyLines,
        ...programLines,
        "Replacing changes what DASH runs and what it shows for this agent. Its character, everything it has produced and any connected accounts are kept.",
      ].join("\n"),
      confirm_label: "Replace it",
      cancel_label: "Keep what I have",
    };
  }

  return {
    title: "Add this agent?",
    message: `Add “${input.display_name}” to DASH?`,
    detail: [
      input.summary,
      "",
      ...copyLines,
      ...programLines,
      connectionSentence(input.manifest),
      ...permissionLines(input.manifest),
      ...(startable
        ? ["It keeps running when you close DASH, and you can stop or remove it at any time."]
        : ["You can remove it at any time."]),
    ].join("\n"),
    confirm_label: "Add it",
    cancel_label: "Not now",
  };
}

/** "1 file", "4 files". Spelled out rather than left as a bare number under a label. */
function plural(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

/** The ceilings, worded once, for the sentence that refuses an oversized folder. */
export function describeFolderTooBig(kind: "files" | "bytes"): string {
  return kind === "files"
    ? `That folder holds more than ${String(MAX_AGENT_FOLDER_FILES)} files, which is more than DASH will copy for one agent. Choose the folder of a single agent rather than one holding several.`
    : `That folder holds more than ${String(Math.round(MAX_AGENT_FOLDER_BYTES / (1024 * 1024)))} megabytes, which is more than DASH will copy for one agent. Choose the folder of a single agent rather than one holding several.`;
}
