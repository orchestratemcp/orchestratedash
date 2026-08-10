/**
 * What an external editor did to an agent's folder, said in sentences (MAR-584).
 *
 * ## The situation this exists for
 *
 * A person opens Claude Code, Cursor or Codex, points it at the folder DASH
 * keeps for one agent, and asks for a change. The folder is authoritative
 * (ADR 0008) and the runner's working directory really is `code/` inside it
 * (`lib/handoff-flow.ts`), so the edit lands on the program DASH runs. That is
 * the feature — and it is exactly why DASH must not simply pick the change up.
 *
 * **An agent's program is a thing the person approved.** Approval that silently
 * transfers to whatever bytes are on disk at run time is not approval. So this
 * module compares, and something else accepts: the comparison is a read, the
 * acceptance is a command, and nothing between them changes what runs.
 *
 * ## Pure, and it has to stay that way
 *
 * No `node:fs`. Every reading is handed in, for `lib/sample-refresh.ts`'s
 * reason: a decision about two documents is testable against fixtures, and the
 * result of this crosses the IPC boundary into the renderer bundle. The reading
 * half lives in `lib/agent-folders.ts` and in `electron/folder-update.ts`.
 *
 * ## What it deliberately cannot see
 *
 * A file the editor **added**. `readStoredFileDigests` reads the paths DASH
 * recorded and never walks the folder, because the sample agent writes its
 * digests into `code/reports/` and its event log into `code/runs/` — inside the
 * folder a walk would enumerate. Reporting an agent's own output as somebody's
 * edit, on the flagship agent, every single check, is a worse failure than not
 * reporting a new file. The limit is stated to the person in
 * `FOLDER_CHECK_COPY`, not just here.
 */

import { explainImportFailure, type ImportFailureExplanation } from "./import-feedback";
import {
  FOLDER_CHANGED,
  FOLDER_CHANGE_LINES,
  FOLDER_INVALID,
  FOLDER_NO_BASELINE,
  FOLDER_UNCHANGED,
  FOLDER_UNREADABLE,
  type FolderCard,
} from "./copy/folder";
import type { StoredFileReading } from "./agent-folders";

/**
 * Where DASH's own scaffold's sources file ends up once it is stored.
 *
 * Spelled out rather than composed from `AGENT_CODE_DIRECTORY` and
 * `SOURCES_FILE_NAME`, because this module is imported by a `"use client"` tree
 * and `lib/agent-folders.ts` reaches `node:fs` — a *value* imported from there
 * is the packaged-renderer failure `tests/client-bundle.test.ts` exists to
 * prevent. The two are held equal by `tests/folder-changes.test.ts`, which is
 * the same round-trip discipline `REMOTE_DASH_MANAGED_PHRASE` uses for the same
 * reason: a constant that cannot import its counterpart is asserted against it.
 */
export const STORED_SOURCES_PATH = "code/sources.json";

/* ---------------------------------------------------------------------- *
 * What the caller has to have read
 * ---------------------------------------------------------------------- */

/** What DASH accepted, from its own record. */
export interface AcceptedFolder {
  /**
   * The document DASH accepted, parsed. This is the store's row, which is the
   * projection of the folder *as it was accepted* — see
   * `reconcileAgentFolders`, which stops projecting an externally edited folder
   * into it for exactly this reason.
   */
  manifest: unknown;
  /** Absent for every agent registered before this record existed. */
  files: readonly { path: string; sha256: string }[] | undefined;
  /** Absent when the accepted folder had no readable sources file. */
  sources: readonly string[] | undefined;
}

/** How the folder reads right now. */
export type CurrentManifest =
  | { kind: "unreadable" }
  | { kind: "invalid"; errors: string[] }
  | { kind: "readable"; manifest: unknown };

export interface CurrentFolder {
  manifest: CurrentManifest;
  /** One entry per recorded path, in the same order. */
  files: readonly StoredFileReading[];
  /** Null when there is no readable sources file on disk now. */
  sources: readonly string[] | null;
  /** True when the recorded baseline named a stored sources file at all. */
  tracks_sources: boolean;
}

/* ---------------------------------------------------------------------- *
 * The answer
 * ---------------------------------------------------------------------- */

export type FolderChangeKind =
  | "unchanged"
  | "no_baseline"
  | "unreadable"
  | "invalid"
  | "changed";

export interface FolderChangeReport {
  kind: FolderChangeKind;
  card: FolderCard;
  /**
   * One sentence per change, empty for every kind but `changed`.
   *
   * Plain language and never a file name — see `lib/copy/folder.ts`. A change
   * DASH detected but cannot describe still produces a line, because a count
   * with no sentence beside it would be a notice that something happened and a
   * refusal to say what.
   */
  lines: string[];
  /**
   * The validator's own errors, for `invalid` only.
   *
   * MAR-584 requires the refusal to carry **the schema's own error**, and
   * `explainImportFailure` is the existing translation of exactly that — the
   * headline and suggestion are DASH's, `raw` is the validator's, verbatim.
   * Reusing it rather than writing a second explainer is what keeps a folder
   * edit and a first import failing in the same words.
   */
  failure: ImportFailureExplanation | null;
  /** Whether there is something for a person to accept. Only ever `changed`. */
  adoptable: boolean;
}

/* ---------------------------------------------------------------------- *
 * Reading the two documents
 * ---------------------------------------------------------------------- */

interface DomShape {
  agent?: { name?: unknown; display_name?: unknown; goal?: unknown };
  agent_dom?: {
    trigger?: { type?: unknown; expected_interval_seconds?: unknown };
    permissions?: unknown;
    connections?: unknown;
  };
}

function agentOf(manifest: unknown): NonNullable<DomShape["agent"]> {
  return (manifest as DomShape | null)?.agent ?? {};
}

function domOf(manifest: unknown): NonNullable<DomShape["agent_dom"]> {
  return (manifest as DomShape | null)?.agent_dom ?? {};
}

function textOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

/**
 * Two documents' worth of one field, compared as JSON.
 *
 * Stable over key order, which matters here more than it usually would: the
 * edit under comparison was made by a *code formatter's* idea of JSON, and
 * reporting "what it needs connected has changed" because an editor reordered
 * two keys would train a person to press accept without reading.
 */
function sameShape(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right);
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

/** Members of `left` that are not in `right`, order preserved. */
function missingFrom(left: readonly string[], right: readonly string[]): string[] {
  const present = new Set(right);
  return left.filter((name) => !present.has(name));
}

/* ---------------------------------------------------------------------- *
 * The comparison
 * ---------------------------------------------------------------------- */

/**
 * Everything that is different between what DASH accepted and what is there.
 *
 * The order of the checks is the order a person reads them in, and it is
 * deliberate: what the agent *does* first, what it *is allowed to do* second,
 * what it *is* third, and the countable program change last. A list that opened
 * with "2 files have changed" would bury the sentence the person came for.
 */
export function describeFolderChanges(
  accepted: AcceptedFolder,
  current: CurrentFolder,
): FolderChangeReport {
  if (current.manifest.kind === "unreadable") {
    return report("unreadable", FOLDER_UNREADABLE);
  }
  if (current.manifest.kind === "invalid") {
    return {
      kind: "invalid",
      card: FOLDER_INVALID,
      lines: [],
      failure: explainImportFailure(current.manifest.errors),
      adoptable: false,
    };
  }
  /*
   * The baseline check comes after the two readings above and before any
   * comparison, and the order is the argument. An agent with no baseline whose
   * folder is *unreadable* has a real problem DASH can state without a
   * baseline, and saying "DASH never wrote down what it was handed" over a
   * missing folder would answer a question nobody asked. But an agent with no
   * baseline whose folder reads fine cannot be compared at all, and every line
   * below would be computed against `undefined`.
   */
  if (accepted.files === undefined) {
    return report("no_baseline", FOLDER_NO_BASELINE);
  }

  const before = accepted.manifest;
  const after = current.manifest.manifest;
  const lines: string[] = [];

  /*
   * Decided once and shared, because the sources sentence and the program count
   * have to agree about the same file. Two independent decisions here is how a
   * person ends up told they added two feeds *and* that one file of the program
   * changed — the same event, reported twice, in two vocabularies.
   */
  const sources = compareSources(accepted, current);
  lines.push(...sources.lines);
  lines.push(...triggerLines(before, after));

  const beforeDom = domOf(before);
  const afterDom = domOf(after);
  if (!sameShape(beforeDom.permissions, afterDom.permissions)) {
    lines.push(FOLDER_CHANGE_LINES.permissionsChanged);
  }
  if (!sameShape(beforeDom.connections, afterDom.connections)) {
    lines.push(FOLDER_CHANGE_LINES.connectionsChanged);
  }

  const beforeAgent = agentOf(before);
  const afterAgent = agentOf(after);
  const beforeName = textOr(beforeAgent.display_name, textOr(beforeAgent.name, ""));
  const afterName = textOr(afterAgent.display_name, textOr(afterAgent.name, ""));
  if (beforeName !== afterName && beforeName !== "" && afterName !== "") {
    lines.push(FOLDER_CHANGE_LINES.nameChanged(beforeName, afterName));
  }
  if (textOr(beforeAgent.goal, "") !== textOr(afterAgent.goal, "")) {
    lines.push(FOLDER_CHANGE_LINES.goalChanged);
  }

  lines.push(...programLines(accepted.files, current, sources.summarised));

  return lines.length === 0
    ? report("unchanged", FOLDER_UNCHANGED)
    : { kind: "changed", card: FOLDER_CHANGED, lines, failure: null, adoptable: true };
}

function report(kind: FolderChangeKind, card: FolderCard): FolderChangeReport {
  return { kind, card, lines: [], failure: null, adoptable: false };
}

/**
 * The sources sentence, which is the one MAR-584 was opened for — and whether
 * it was produced, so the program count can leave that file alone.
 *
 * Three outcomes, and the middle one is the reason this returns a pair rather
 * than a list of strings:
 *
 * - **Not tracked.** The baseline named no stored sources file, so this agent
 *   has none and any change to it is somebody else's file, counted as program.
 * - **Tracked but not summarisable.** One of the two versions is not a readable
 *   list — `readSourceNames` returns null for a reformatted or malformed file
 *   rather than an empty list, precisely so this case exists instead of
 *   "every source was removed". The change still gets a sentence when the bytes
 *   really moved, and `summarised: false` hands the file back to the count so
 *   it can never go unreported.
 * - **Summarised.** Names added and names removed, and the file is excluded
 *   from the program count.
 */
function compareSources(
  accepted: AcceptedFolder,
  current: CurrentFolder,
): { lines: string[]; summarised: boolean } {
  if (!current.tracks_sources) {
    return { lines: [], summarised: false };
  }

  const before = accepted.sources;
  const after = current.sources;
  if (before === undefined || after === null) {
    const moved = sourcesFileMoved(accepted, current);
    return { lines: moved ? [FOLDER_CHANGE_LINES.sourcesUnreadable] : [], summarised: false };
  }

  const lines: string[] = [];
  const added = missingFrom(after, before);
  const removed = missingFrom(before, after);
  if (added.length > 0) {
    lines.push(FOLDER_CHANGE_LINES.sourcesAdded(added));
  }
  if (removed.length > 0) {
    lines.push(FOLDER_CHANGE_LINES.sourcesRemoved(removed));
  }
  /*
   * Summarised even when both lists match. The file's bytes may still have
   * moved — a reformat, an edited address behind an unchanged name — and
   * `summarised` says "the sources sentence owns this file", not "the sources
   * sentence had something to say". Handing it back to the count here would
   * report "1 file of the program has changed" over a whitespace edit to a list
   * DASH just confirmed is the same list.
   */
  return { lines, summarised: true };
}

/** Whether the stored sources file's bytes differ from the ones DASH accepted. */
function sourcesFileMoved(accepted: AcceptedFolder, current: CurrentFolder): boolean {
  const baseline = accepted.files?.find((file) => file.path === STORED_SOURCES_PATH);
  const reading = current.files.find((file) => file.path === STORED_SOURCES_PATH);
  if (baseline === undefined || reading === undefined) {
    return false;
  }
  return reading.sha256 !== baseline.sha256;
}

/**
 * How often it runs, before and after.
 *
 * The interval and not the author's own `label`, for `describeExpectedInterval`'s
 * stated reason: the label is free text DASH does not parse, and quoting it in
 * DASH's own change list would put somebody else's sentence in DASH's voice.
 * When a schedule exists on both sides but neither declares an interval DASH can
 * read, the change is still real and gets the vaguer sentence rather than none.
 */
function triggerLines(before: unknown, after: unknown): string[] {
  const beforeTrigger = domOf(before).trigger;
  const afterTrigger = domOf(after).trigger;
  if (sameShape(beforeTrigger, afterTrigger)) {
    return [];
  }

  const wasScheduled = beforeTrigger?.type === "schedule";
  const isScheduled = afterTrigger?.type === "schedule";
  const afterSeconds = afterTrigger?.expected_interval_seconds;
  const readableAfter = typeof afterSeconds === "number" && afterSeconds > 0;

  if (!wasScheduled && isScheduled) {
    return [
      readableAfter
        ? FOLDER_CHANGE_LINES.scheduleAdded(afterSeconds)
        : FOLDER_CHANGE_LINES.scheduleUnclear,
    ];
  }
  if (wasScheduled && !isScheduled) {
    return [FOLDER_CHANGE_LINES.scheduleRemoved];
  }
  if (wasScheduled && isScheduled) {
    return [
      readableAfter
        ? FOLDER_CHANGE_LINES.scheduleChanged(afterSeconds)
        : FOLDER_CHANGE_LINES.scheduleUnclear,
    ];
  }
  // Neither side is a schedule and yet the trigger moved — a webhook became an
  // event, say. Real, and not something DASH has words for beyond this.
  return [FOLDER_CHANGE_LINES.scheduleUnclear];
}

/**
 * The program, counted.
 *
 * The sources file is excluded from the count when its own sentence was already
 * produced, so a person who added two feeds is told they added two feeds rather
 * than being told that and *also* that one file of the program changed. When the
 * sources summary could not be produced, the file is counted like any other, so
 * the change is never invisible.
 */
function programLines(
  baseline: readonly { path: string; sha256: string }[],
  current: CurrentFolder,
  summarised: boolean,
): string[] {
  const readings = new Map(current.files.map((file) => [file.path, file]));

  let changed = 0;
  let missing = 0;
  for (const file of baseline) {
    if (summarised && file.path === STORED_SOURCES_PATH) {
      // Owned by the sources sentence. See `compareSources`.
      continue;
    }
    const reading = readings.get(file.path);
    if (reading === undefined || reading.sha256 === null) {
      missing += 1;
      continue;
    }
    if (reading.sha256 !== file.sha256) {
      changed += 1;
    }
  }

  const lines: string[] = [];
  if (changed > 0) {
    lines.push(FOLDER_CHANGE_LINES.programChanged(changed));
  }
  if (missing > 0) {
    lines.push(FOLDER_CHANGE_LINES.programMissing(missing));
  }
  return lines;
}
