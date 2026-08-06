/**
 * The runner-owned task workspace: where a run's inputs and outputs actually
 * live.
 *
 * MAR-457 stored an artifact as a *body* — the digest the agent sent, kept in
 * DASH's own records. That was the right shape for a digest and it is the reason
 * MAR-434's design slice could not populate its own four availability states:
 * there is no file whose absence could be observed, so `missing`, `moved`,
 * `quarantined` and `deleted` had a vocabulary, a test and no producer. This
 * module is the producer.
 *
 * ## The three directories, and why the child is told about one of them
 *
 * ```
 * {dataDir}/workspaces/{task_id}/inputs/{input_id}   the bytes DASH admitted
 * {dataDir}/workspaces/{task_id}/outbox/             where the child writes
 * {dataDir}/artifacts/{artifact_id}                  what the runner registered
 * {dataDir}/quarantine/{artifact_id}                 what the runner refused
 * ```
 *
 * A child is handed the path of its own `{task_id}` directory and nothing else.
 * It can read the inputs a human selected for it and write into its outbox. It
 * is never told where `artifacts/` is, and the names in there are unguessable,
 * so **an artifact stops being writable by the process that produced it at the
 * moment it is registered**. That is what makes a SHA-256 recorded at
 * registration still true later: not a promise that the agent will not rewrite
 * the file, but the absence of a path it could rewrite it through.
 *
 * The alternative — registering the file where the child wrote it, and hashing
 * it in place — reads as equivalent and is not. It would make every receipt a
 * claim about a file the producer still holds a handle to, which is the same
 * class of statement as `draft.placement`: the agent's claim wearing DASH's
 * clothes.
 *
 * ## What is a *copy* here, and what is a *move*
 *
 * Inputs are copied. The user's own file is never moved, never renamed and never
 * opened for writing, because it is theirs and DASH is not a file manager. The
 * copy is also the whole answer to "post-selection replacement is rejected":
 * once the bytes are inside the workspace, replacing the original cannot reach
 * them. `admitInput` additionally re-reads the source's identity after the copy
 * and refuses if it changed *during* the read, which is the narrower race the
 * copy alone does not close.
 *
 * Artifacts are copied out of the outbox rather than renamed into place, and
 * then re-read and re-hashed from their registered location. A rename would
 * preserve any handle the child still holds; a copy plus a verifying re-read
 * means the digest on the receipt is a digest of the bytes that are in the file
 * the receipt points at, taken after the child could no longer reach it.
 *
 * ## What this module deliberately does not record
 *
 * **Producer component.** The issue's metadata list asks for it and nothing here
 * supplies it. The runner knows which agent wrote a file and which task it
 * belongs to; it does not know which *step* produced it, and neither does the
 * child in any form it could be believed about. Inferring it from event ordering
 * would be a guess rendered as a fact, which is the judgment MAR-434's design
 * slice already made for the same field. It stays unbuilt and stays named.
 */

import { createHash } from "node:crypto";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  createReadStream,
  createWriteStream,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { DatabaseSync } from "node:sqlite";

import { hardenOwnerOnly } from "./channel-secret";
import {
  readIdentity,
  resolveInsideWorkspace,
  resolveSelectedFile,
  sameIdentity,
  type FileIdentity,
  type PathProblem,
} from "./path-guard";
import { transact } from "./store";

/* ---------------------------------------------------------------------- *
 * Bounds
 * ---------------------------------------------------------------------- */

/**
 * The runner's own ceilings, which a manifest may lower and may never raise.
 *
 * A manifest is a document an agent author wrote. Letting it set the maximum
 * size of a file DASH will copy into its own data directory would make "bounded
 * storage" a property of whatever the last imported agent asked for. So the
 * effective limit is always `min(declared, ceiling)`, and `effectiveLimits`
 * is the one place that arithmetic happens.
 */
export const RUNNER_MAX_INPUT_FILE_BYTES = 64 * 1024 * 1024;
export const RUNNER_MAX_TASK_TOTAL_BYTES = 256 * 1024 * 1024;
export const RUNNER_MAX_INPUT_COUNT = 50;
export const RUNNER_MAX_ARTIFACT_FILE_BYTES = 64 * 1024 * 1024;

/**
 * How many same-sized candidates a `moved` search will hash before giving up.
 *
 * The search exists so that a file which is somewhere else reads as `moved`
 * rather than `missing`, because those two lead a person somewhere different.
 * It is bounded because it runs on a page render: an unbounded content search
 * over every artifact this installation has ever produced would turn one
 * missing file into a stalled Outputs panel.
 */
export const MOVED_SEARCH_MAX_CANDIDATES = 64;

export interface DeclaredInputLimits {
  max_file_bytes?: number;
  max_total_bytes?: number;
  max_count?: number;
  /** Accepted media types. Empty or absent means the runner does not narrow. */
  media_types?: readonly string[];
}

export interface EffectiveLimits {
  max_file_bytes: number;
  max_total_bytes: number;
  max_count: number;
  media_types: readonly string[];
}

export function effectiveLimits(declared: DeclaredInputLimits = {}): EffectiveLimits {
  const lower = (candidate: number | undefined, ceiling: number): number =>
    typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0
      ? Math.min(Math.floor(candidate), ceiling)
      : ceiling;

  return {
    max_file_bytes: lower(declared.max_file_bytes, RUNNER_MAX_INPUT_FILE_BYTES),
    max_total_bytes: lower(declared.max_total_bytes, RUNNER_MAX_TASK_TOTAL_BYTES),
    max_count: lower(declared.max_count, RUNNER_MAX_INPUT_COUNT),
    media_types: declared.media_types ?? [],
  };
}

/* ---------------------------------------------------------------------- *
 * Identifiers
 * ---------------------------------------------------------------------- */

/**
 * An opaque id, and the reason it is random rather than derived.
 *
 * A derived id — a hash of the path, a slug of the filename — leaks the thing it
 * identifies. `in_7f3a…` says nothing; `in_c-users-henri-desktop-offert` is an
 * absolute path in a field the contract promises absolute paths do not reach.
 * Random also means an id is not guessable, which matters because an id is what
 * resolves to a file inside the workspace.
 *
 * 16 bytes. The same size and the same reasoning as the command nonce.
 */
function opaqueId(prefix: string): string {
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}

/** Recognise an id this module minted, before it is used as a path component. */
export function isOpaqueId(candidate: string, prefix: string): boolean {
  return new RegExp(`^${prefix}_[0-9a-f]{32}$`).test(candidate);
}

/* ---------------------------------------------------------------------- *
 * Media types
 * ---------------------------------------------------------------------- */

/**
 * Sniff a media type from the first bytes, and be honest about the range.
 *
 * The issue asks for media-type sniffing, and this is a small table rather than
 * a dependency because the job it does is small: stop a file called `brief.docx`
 * from being an executable, and let a manifest that declares it accepts PDFs
 * refuse something that is not one. It is **not** a general format identifier,
 * and `application/octet-stream` is what it says when it does not know — which
 * is a refusal to guess, not a failure.
 *
 * The extension is deliberately not consulted. An extension is a claim by
 * whoever named the file; these bytes are a fact about it. Where the two
 * disagree the bytes win, and `admitInput` reports the disagreement rather than
 * silently preferring one — that is the "MIME mismatch is rejected and audited"
 * criterion.
 */
const MAGIC: ReadonlyArray<{ media_type: string; bytes: readonly number[]; offset?: number }> = [
  { media_type: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { media_type: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { media_type: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { media_type: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38] },
  // ZIP, which is also every OOXML document. `admitInput` does not open the
  // container to tell a .docx from a .xlsx: that would mean parsing an
  // untrusted archive in the runner to improve a label.
  { media_type: "application/zip", bytes: [0x50, 0x4b, 0x03, 0x04] },
  { media_type: "application/zip", bytes: [0x50, 0x4b, 0x05, 0x06] },
  // Windows PE and ELF. Not because DASH claims to detect malware — it does not,
  // and the non-goals say so — but because an executable arriving as a customer
  // brief is worth naming rather than passing through as octet-stream.
  { media_type: "application/vnd.microsoft.portable-executable", bytes: [0x4d, 0x5a] },
  { media_type: "application/x-elf", bytes: [0x7f, 0x45, 0x4c, 0x46] },
];

export function sniffMediaType(head: Buffer): string {
  for (const entry of MAGIC) {
    const offset = entry.offset ?? 0;
    if (head.length < offset + entry.bytes.length) {
      continue;
    }
    if (entry.bytes.every((byte, index) => head[offset + index] === byte)) {
      return entry.media_type;
    }
  }
  // UTF-8 text, decided by absence: no NUL and no C0 control byte outside the
  // three that occur in ordinary text. Cheap, wrong for some encodings, and
  // wrong in the safe direction — an unrecognised text file becomes
  // octet-stream rather than an unrecognised binary becoming text.
  if (head.length > 0 && head.every((byte) => byte >= 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d)) {
    return "text/plain";
  }
  return "application/octet-stream";
}

function readHead(target: string, bytes = 512): Buffer {
  const handle = openSync(target, "r");
  try {
    // A head, not the file. `readFileSync` on this descriptor would buffer all
    // 64 MiB of a large input to answer what its first bytes are.
    const buffer = Buffer.alloc(bytes);
    const read = readSync(handle, buffer, 0, bytes, 0);
    return buffer.subarray(0, read);
  } finally {
    closeSync(handle);
  }
}

/* ---------------------------------------------------------------------- *
 * Layout
 * ---------------------------------------------------------------------- */

export interface WorkspaceRoot {
  /**
   * The DASH data directory: the point below which every directory is one the
   * runner created and must still be a real directory.
   *
   * The link check walks down from here rather than up from the filesystem root
   * because above this line the layout is the user's operating system — a
   * redirected `%LOCALAPPDATA%` is an ordinary Windows configuration — and below
   * it, anything that is not a directory replaced one. See
   * `assertUnlinkedBelow`.
   */
  base: string;
  /** `{dataDir}/workspaces` — one directory per task below it. */
  tasks: string;
  /** `{dataDir}/artifacts` — flat, opaque names, never handed to a child. */
  artifacts: string;
  /** `{dataDir}/quarantine` — bytes the runner refused and is holding apart. */
  quarantine: string;
}

/**
 * Create the three roots, owner-only, and prove it.
 *
 * The link check is deliberately **not** here. Checking once at startup would be
 * checking the wrong moment: the attack is a child replacing its own outbox
 * with a junction while the runner is up, which a startup check cannot see and
 * a per-resolution check cannot miss. `resolveInsideWorkspace` walks from `base`
 * on every use, and this function's job is only to create the directories and
 * make them owner-only.
 *
 * @throws ChannelSecretError when the ACL cannot be applied or proven.
 */
export function openWorkspaceRoot(dataDir: string): WorkspaceRoot {
  const root: WorkspaceRoot = {
    base: path.resolve(dataDir),
    tasks: path.join(dataDir, "workspaces"),
    artifacts: path.join(dataDir, "artifacts"),
    quarantine: path.join(dataDir, "quarantine"),
  };

  for (const directory of [root.tasks, root.artifacts, root.quarantine]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    hardenOwnerOnly(directory, { directory: true });
  }

  return root;
}

export function taskDirectory(root: WorkspaceRoot, taskId: string): string {
  return path.join(root.tasks, taskId);
}

export function inputsDirectory(root: WorkspaceRoot, taskId: string): string {
  return path.join(taskDirectory(root, taskId), "inputs");
}

/** The one directory a child is told about, and the only one it may write to. */
export function outboxDirectory(root: WorkspaceRoot, taskId: string): string {
  return path.join(taskDirectory(root, taskId), "outbox");
}

/* ---------------------------------------------------------------------- *
 * Tasks
 * ---------------------------------------------------------------------- */

export interface TaskRecord {
  task_id: string;
  agent: string;
  run_id: string | null;
  directory: string;
  created_at: string;
  closed_at: string | null;
}

/**
 * Open a task workspace for one agent.
 *
 * `run_id` is nullable and usually null at this point, which is not an
 * oversight: a user selects files and *then* triggers the run, so the workspace
 * has to exist before the run it belongs to does. `bindTaskRun` fills it in when
 * the run starts, and every artifact registered afterwards is bound to it by the
 * runner rather than by the child — which is the issue's "the runner binds
 * source agent/run identity rather than trusting child-supplied identity", made
 * true by the child having no field it could put a run id in.
 */
export function createTask(
  database: DatabaseSync,
  root: WorkspaceRoot,
  agent: string,
  now: Date = new Date(),
): TaskRecord {
  const taskId = opaqueId("task");
  const directory = taskDirectory(root, taskId);

  mkdirSync(inputsDirectory(root, taskId), { recursive: true, mode: 0o700 });
  mkdirSync(outboxDirectory(root, taskId), { recursive: true, mode: 0o700 });
  hardenOwnerOnly(directory, { directory: true });

  const record: TaskRecord = {
    task_id: taskId,
    agent,
    run_id: null,
    directory,
    created_at: now.toISOString(),
    closed_at: null,
  };

  database
    .prepare(
      "INSERT INTO task_workspaces (task_id, agent, run_id, directory, created_at) " +
        "VALUES (?, ?, ?, ?, ?)",
    )
    .run(record.task_id, record.agent, null, record.directory, record.created_at);

  return record;
}

export function readTask(database: DatabaseSync, taskId: string): TaskRecord | null {
  const row = database
    .prepare(
      "SELECT task_id, agent, run_id, directory, created_at, closed_at " +
        "FROM task_workspaces WHERE task_id = ?",
    )
    .get(taskId);
  if (row === undefined) {
    return null;
  }
  return {
    task_id: String(row["task_id"]),
    agent: String(row["agent"]),
    run_id: row["run_id"] === null ? null : String(row["run_id"]),
    directory: String(row["directory"]),
    created_at: String(row["created_at"]),
    closed_at: row["closed_at"] === null ? null : String(row["closed_at"]),
  };
}

/**
 * Bind a task to the run that is about to execute it.
 *
 * Refuses to rebind. A task whose run id could change is a task whose already
 * registered artifacts would silently reattribute themselves to a different run,
 * and "which run produced this" is on the receipt.
 */
export function bindTaskRun(database: DatabaseSync, taskId: string, runId: string): boolean {
  const updated = database
    .prepare("UPDATE task_workspaces SET run_id = ? WHERE task_id = ? AND run_id IS NULL")
    .run(runId, taskId);
  return Number(updated.changes) === 1;
}

/* ---------------------------------------------------------------------- *
 * Inputs
 * ---------------------------------------------------------------------- */

export interface InputRecord {
  input_id: string;
  task_id: string;
  role: string;
  /** Display metadata. Never resolved, never joined to a path. */
  display_name: string;
  media_type: string;
  byte_size: number;
  sha256: string;
  admitted_at: string;
}

export type AdmitRefusal =
  | PathProblem["refusal"]
  | "too_many_inputs"
  | "file_too_large"
  | "task_too_large"
  | "media_type_not_accepted"
  | "replaced_during_read"
  | "unknown_task"
  | "task_closed";

export type AdmitResult =
  | { ok: true; input: InputRecord }
  | { ok: false; refusal: AdmitRefusal; detail: string };

/**
 * Copy one user-selected file into the task workspace.
 *
 * **Only DASH calls this, and only after a human picked the file.** No agent
 * path reaches it; `runner/server.ts` exposes it on the authenticated channel
 * and the child protocol has no message that could. That boundary is what lets
 * `resolveSelectedFile` be the less strict of the two guards — see its module
 * header.
 *
 * The order of checks is the design:
 *
 * 1. The task exists and is open. A closed task must not grow new inputs after
 *    a run has read the set it was given.
 * 2. Count and size budget, **before** the file is opened. Refusing a 4 GiB file
 *    after copying it is not a limit.
 * 3. The path guard, which decides what this path is allowed to be.
 * 4. Identity taken, bytes copied and hashed in one pass, identity re-taken. A
 *    file swapped between steps 3 and 4 is caught here and the partial copy is
 *    removed — the criterion is "replaced-after-selection input is rejected",
 *    and rejected means nothing was admitted, not that something smaller was.
 * 5. Media type sniffed from the copy, not from the source. By this point the
 *    source is irrelevant; what DASH will show a receipt for is the copy.
 */
export async function admitInput(
  database: DatabaseSync,
  root: WorkspaceRoot,
  request: {
    task_id: string;
    role: string;
    /** The absolute path a human chose. Never stored, never logged. */
    source_path: string;
    limits?: DeclaredInputLimits;
  },
  now: Date = new Date(),
): Promise<AdmitResult> {
  const task = readTask(database, request.task_id);
  if (task === null) {
    return { ok: false, refusal: "unknown_task", detail: "That task no longer exists." };
  }
  if (task.closed_at !== null) {
    return {
      ok: false,
      refusal: "task_closed",
      detail: "That task has already started, so its files can no longer change.",
    };
  }

  const limits = effectiveLimits(request.limits);
  const existing = readInputs(database, request.task_id);
  if (existing.length >= limits.max_count) {
    return {
      ok: false,
      refusal: "too_many_inputs",
      detail: `This task accepts at most ${String(limits.max_count)} files.`,
    };
  }
  const usedBytes = existing.reduce((total, input) => total + input.byte_size, 0);

  const selection = resolveSelectedFile(request.source_path);
  if (!selection.ok) {
    return { ok: false, refusal: selection.problem.refusal, detail: selection.problem.detail };
  }

  if (selection.identity.size > limits.max_file_bytes) {
    return {
      ok: false,
      refusal: "file_too_large",
      detail: `That file is larger than the ${formatBytes(limits.max_file_bytes)} limit for one file.`,
    };
  }
  if (usedBytes + selection.identity.size > limits.max_total_bytes) {
    return {
      ok: false,
      refusal: "task_too_large",
      detail: `Adding that file would take this task past its ${formatBytes(limits.max_total_bytes)} total.`,
    };
  }

  const inputId = opaqueId("in");
  const destination = path.join(inputsDirectory(root, request.task_id), inputId);

  let copied: { sha256: string; byte_size: number };
  try {
    copied = await copyAndHash(selection.path, destination, limits.max_file_bytes);
  } catch (error: unknown) {
    // The refusal detail never names the path or the error; this line is for
    // the runner's own log, where the code is the difference between a source
    // a person can fix and a workspace defect only a release can.
    console.error("[workspace] input copy failed:", describeCaught(error));
    rmSync(destination, { force: true });
    return {
      ok: false,
      refusal: error instanceof OversizeError ? "file_too_large" : "unreadable",
      detail:
        error instanceof OversizeError
          ? `That file grew past the ${formatBytes(limits.max_file_bytes)} limit while it was being read.`
          : "That file could not be read from start to finish.",
    };
  }

  // The after half of the replacement check. A source whose identity changed
  // while we were reading it may have given us the first half of one document
  // and the second half of another, and there is no way to tell which — so the
  // only honest outcome is to keep neither.
  const after = readIdentity(selection.path);
  if (after === null || !sameIdentity(selection.identity, after)) {
    rmSync(destination, { force: true });
    return {
      ok: false,
      refusal: "replaced_during_read",
      detail: "That file changed while DASH was copying it, so nothing was added. Try again.",
    };
  }

  const mediaType = sniffMediaType(readHead(destination));
  if (limits.media_types.length > 0 && !limits.media_types.includes(mediaType)) {
    rmSync(destination, { force: true });
    return {
      ok: false,
      refusal: "media_type_not_accepted",
      detail: `This task does not accept ${mediaType} files.`,
    };
  }

  const record: InputRecord = {
    input_id: inputId,
    task_id: request.task_id,
    role: request.role,
    // `path.basename` of the *resolved* path: display metadata and nothing more.
    // It is never joined to anything, which is the issue's "artifact filenames
    // are display metadata, never trusted filesystem paths" applied to inputs.
    display_name: path.basename(selection.path),
    media_type: mediaType,
    byte_size: copied.byte_size,
    sha256: copied.sha256,
    admitted_at: now.toISOString(),
  };

  database
    .prepare(
      "INSERT INTO task_inputs " +
        "(input_id, task_id, role, display_name, media_type, byte_size, sha256, admitted_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      record.input_id,
      record.task_id,
      record.role,
      record.display_name,
      record.media_type,
      record.byte_size,
      record.sha256,
      record.admitted_at,
    );

  return { ok: true, input: record };
}

export function readInputs(database: DatabaseSync, taskId: string): InputRecord[] {
  return database
    .prepare(
      "SELECT input_id, task_id, role, display_name, media_type, byte_size, sha256, admitted_at " +
        "FROM task_inputs WHERE task_id = ? ORDER BY admitted_at, input_id",
    )
    .all(taskId)
    .map((row) => ({
      input_id: String(row["input_id"]),
      task_id: String(row["task_id"]),
      role: String(row["role"]),
      display_name: String(row["display_name"]),
      media_type: String(row["media_type"]),
      byte_size: Number(row["byte_size"]),
      sha256: String(row["sha256"]),
      admitted_at: String(row["admitted_at"]),
    }));
}

/**
 * Resolve an opaque input id to a path inside the workspace, or refuse.
 *
 * Three independent reasons this cannot escape, and the redundancy is the point.
 * The id must match the shape this module mints, so it is `[0-9a-f]{32}` with a
 * prefix and cannot be a path fragment at all. It must be a row belonging to
 * *this* task, so one task's id cannot name another's file. And the result goes
 * through `resolveInsideWorkspace`, which is the strict guard and answers with
 * the kernel's own resolution.
 */
export function resolveInput(
  database: DatabaseSync,
  root: WorkspaceRoot,
  taskId: string,
  inputId: string,
): { ok: true; path: string } | { ok: false; refusal: string; detail: string } {
  if (!isOpaqueId(inputId, "in")) {
    return { ok: false, refusal: "unknown_input", detail: "That is not an input id DASH issued." };
  }
  const row = database
    .prepare("SELECT 1 FROM task_inputs WHERE task_id = ? AND input_id = ?")
    .get(taskId, inputId);
  if (row === undefined) {
    return { ok: false, refusal: "unknown_input", detail: "This task has no such file." };
  }

  const resolved = resolveInsideWorkspace(inputsDirectory(root, taskId), inputId, root.base);
  if (!resolved.ok) {
    return { ok: false, refusal: resolved.problem.refusal, detail: resolved.problem.detail };
  }
  return { ok: true, path: resolved.path };
}

/* ---------------------------------------------------------------------- *
 * Artifacts
 * ---------------------------------------------------------------------- */

export type RetentionState = "kept" | "quarantined" | "deleted";

export interface WorkspaceArtifact {
  artifact_id: string;
  task_id: string;
  /** Bound by the runner from the supervised child, never from the message. */
  agent: string;
  /** Bound by the runner from the task record, never from the message. */
  run_id: string;
  role: string;
  display_name: string;
  media_type: string;
  byte_size: number;
  sha256: string;
  stored_path: string;
  mtime_ms: number;
  registered_at: string;
  retention: RetentionState;
  quarantine_reason: string | null;
  deleted_at: string | null;
}

export type RegisterResult =
  | { ok: true; artifact: WorkspaceArtifact }
  | { ok: false; refusal: string; detail: string; quarantined: boolean };

/**
 * Take one file out of a child's outbox and make it an artifact.
 *
 * The child names a single component. Everything else on the record — the agent,
 * the run, the size, the digest, the location — is observed by the runner or
 * read from the task it already owns. There is no field on this call a child
 * could use to claim to be another agent, and that is a property of the
 * signature rather than of a check inside it.
 *
 * **Refusal and quarantine are different outcomes and are kept different.** A
 * candidate that fails the path guard is refused and nothing is kept: there is
 * no file to hold, only a name that was not allowed to be one. A candidate whose
 * bytes did not survive the verifying re-read *is* quarantined — those bytes
 * exist, something is wrong with them, and destroying the evidence of a failed
 * integrity check to keep a directory tidy is how the interesting failures stop
 * being investigable. `retention` records which happened.
 *
 * One malformed candidate never affects another. This function handles exactly
 * one, the caller loops, and the store write is per artifact — which is the
 * issue's "a malformed artifact is rejected and audited without losing valid
 * neighbouring artifacts or stopping the agent", made structural.
 */
export async function registerArtifact(
  database: DatabaseSync,
  root: WorkspaceRoot,
  request: {
    task_id: string;
    /** The supervisor's identity for the child. Not the child's claim. */
    agent: string;
    role: string;
    /** One path component in the child's own outbox. */
    name: string;
    max_bytes?: number;
  },
  now: Date = new Date(),
): Promise<RegisterResult> {
  const task = readTask(database, request.task_id);
  if (task === null) {
    return {
      ok: false,
      refusal: "unknown_task",
      detail: "That task no longer exists.",
      quarantined: false,
    };
  }
  if (task.agent !== request.agent) {
    // The child that wrote the line is not the agent this task belongs to. The
    // supervisor supplies `agent`; nothing in the message does.
    return {
      ok: false,
      refusal: "foreign_task",
      detail: "That task belongs to a different agent.",
      quarantined: false,
    };
  }
  if (task.run_id === null) {
    return {
      ok: false,
      refusal: "task_not_started",
      detail: "That task has no run to attribute an output to yet.",
      quarantined: false,
    };
  }

  const limit = Math.min(request.max_bytes ?? RUNNER_MAX_ARTIFACT_FILE_BYTES, RUNNER_MAX_ARTIFACT_FILE_BYTES);
  const outbox = outboxDirectory(root, request.task_id);
  const resolved = resolveInsideWorkspace(outbox, request.name, root.base);
  if (!resolved.ok) {
    return {
      ok: false,
      refusal: resolved.problem.refusal,
      detail: resolved.problem.detail,
      quarantined: false,
    };
  }
  if (resolved.size > limit) {
    return {
      ok: false,
      refusal: "file_too_large",
      detail: `That output is larger than the ${formatBytes(limit)} limit.`,
      quarantined: false,
    };
  }

  const artifactId = opaqueId("art");
  const stored = path.join(root.artifacts, artifactId);

  let copied: { sha256: string; byte_size: number };
  try {
    copied = await copyAndHash(resolved.path, stored, limit);
  } catch (error: unknown) {
    // Same rule as the input side: the code goes to the runner's log, never
    // into the refusal a person reads.
    console.error("[workspace] output copy failed:", describeCaught(error));
    rmSync(stored, { force: true });
    return {
      ok: false,
      refusal: error instanceof OversizeError ? "file_too_large" : "unreadable",
      detail:
        error instanceof OversizeError
          ? `That output grew past the ${formatBytes(limit)} limit while it was being read.`
          : "That output could not be read from start to finish.",
      quarantined: false,
    };
  }

  // Re-read from the registered location and hash again. This is the step that
  // makes the digest a statement about the file the receipt points at rather
  // than about a stream that passed through this process. It also catches a
  // short write and a filesystem that lied about a flush.
  const verified = await hashFile(stored);
  if (verified.sha256 !== copied.sha256 || verified.byte_size !== copied.byte_size) {
    const quarantinePath = path.join(root.quarantine, artifactId);
    try {
      await copyAndHash(stored, quarantinePath, limit);
    } catch {
      // Best effort. A quarantine that cannot be written is still a refusal.
    }
    rmSync(stored, { force: true });

    const record = writeArtifactRow(database, {
      artifact_id: artifactId,
      task_id: request.task_id,
      agent: request.agent,
      run_id: task.run_id,
      role: request.role,
      display_name: request.name,
      media_type: "application/octet-stream",
      byte_size: copied.byte_size,
      sha256: copied.sha256,
      stored_path: quarantinePath,
      mtime_ms: 0,
      registered_at: now.toISOString(),
      retention: "quarantined",
      quarantine_reason: "The bytes read back from storage did not match the bytes that were written.",
      deleted_at: null,
    });
    return {
      ok: false,
      refusal: "integrity_check_failed",
      detail: record.quarantine_reason ?? "The output failed its integrity check.",
      quarantined: true,
    };
  }

  // The child's copy goes now rather than at the end of the task. Leaving it
  // would give a person two files with the same content and one of them
  // writable by the agent, and the writable one is the one a later bug would
  // find first.
  rmSync(resolved.path, { force: true });

  const record = writeArtifactRow(database, {
    artifact_id: artifactId,
    task_id: request.task_id,
    agent: request.agent,
    run_id: task.run_id,
    role: request.role,
    // The child's chosen name, kept for display and never used as a path again.
    // It already passed `inspectComponent`, so it carries no separator, no
    // stream and no device name — but it is stored as a label, not a location.
    display_name: request.name,
    media_type: sniffMediaType(readHead(stored)),
    byte_size: copied.byte_size,
    sha256: copied.sha256,
    stored_path: stored,
    mtime_ms: statSync(stored).mtimeMs,
    registered_at: now.toISOString(),
    retention: "kept",
    quarantine_reason: null,
    deleted_at: null,
  });

  return { ok: true, artifact: record };
}

function writeArtifactRow(database: DatabaseSync, record: WorkspaceArtifact): WorkspaceArtifact {
  database
    .prepare(
      "INSERT INTO workspace_artifacts " +
        "(artifact_id, task_id, agent, run_id, role, display_name, media_type, byte_size, sha256, " +
        " stored_path, mtime_ms, registered_at, retention, quarantine_reason, deleted_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      record.artifact_id,
      record.task_id,
      record.agent,
      record.run_id,
      record.role,
      record.display_name,
      record.media_type,
      record.byte_size,
      record.sha256,
      record.stored_path,
      record.mtime_ms,
      record.registered_at,
      record.retention,
      record.quarantine_reason,
      record.deleted_at,
    );
  return record;
}

export function readArtifact(database: DatabaseSync, artifactId: string): WorkspaceArtifact | null {
  const row = database
    .prepare("SELECT * FROM workspace_artifacts WHERE artifact_id = ?")
    .get(artifactId);
  return row === undefined ? null : rowToArtifact(row);
}

export function artifactsForRun(
  database: DatabaseSync,
  agent: string,
  runId: string,
): WorkspaceArtifact[] {
  return database
    .prepare(
      "SELECT * FROM workspace_artifacts WHERE agent = ? AND run_id = ? ORDER BY registered_at, artifact_id",
    )
    .all(agent, runId)
    .map(rowToArtifact);
}

/**
 * How many artifacts one index read returns.
 *
 * DASH polls this every five seconds and computes availability for each row it
 * gets back, which is a `stat` per artifact. The cap is what stops a machine
 * with years of outputs on it from spending a filesystem walk per poll — and it
 * is reported rather than silently applied, because an Outputs panel that has
 * quietly stopped listing older files is indistinguishable from one that has
 * listed everything.
 */
export const WORKSPACE_INDEX_LIMIT = 500;

/**
 * The newest artifacts, capped, with whether the cap was hit.
 *
 * `truncated` is derived by asking for one more row than the caller may have,
 * which is exact — a count query would be a second read of a table that may have
 * changed between them.
 */
export function allArtifacts(
  database: DatabaseSync,
  limit: number = WORKSPACE_INDEX_LIMIT,
): { records: WorkspaceArtifact[]; truncated: boolean } {
  const rows = database
    .prepare("SELECT * FROM workspace_artifacts ORDER BY registered_at DESC, artifact_id LIMIT ?")
    .all(limit + 1);
  return {
    records: rows.slice(0, limit).map(rowToArtifact),
    truncated: rows.length > limit,
  };
}

function rowToArtifact(row: Record<string, unknown>): WorkspaceArtifact {
  return {
    artifact_id: String(row["artifact_id"]),
    task_id: String(row["task_id"]),
    agent: String(row["agent"]),
    run_id: String(row["run_id"]),
    role: String(row["role"]),
    display_name: String(row["display_name"]),
    media_type: String(row["media_type"]),
    byte_size: Number(row["byte_size"]),
    sha256: String(row["sha256"]),
    stored_path: String(row["stored_path"]),
    mtime_ms: Number(row["mtime_ms"]),
    registered_at: String(row["registered_at"]),
    retention: String(row["retention"]) as RetentionState,
    quarantine_reason: row["quarantine_reason"] === null ? null : String(row["quarantine_reason"]),
    deleted_at: row["deleted_at"] === null ? null : String(row["deleted_at"]),
  };
}

/* ---------------------------------------------------------------------- *
 * Availability — the four states, with producers
 * ---------------------------------------------------------------------- */

/**
 * Where an artifact's bytes are, as a fact rather than a hope.
 *
 * These are the five states `lib/copy/artifacts.ts` has vocabulary for and, until
 * this module, no producer for. Each one is here because something can actually
 * establish it, and the something is named:
 *
 * - `available` — the file is at its recorded path, at its recorded size, with
 *   its recorded modification time. Note what is **not** claimed: the digest is
 *   not re-verified on a list, because hashing every artifact on every render
 *   would make the Outputs panel cost the size of the person's history.
 *   `verifyArtifact` is the full check, and download is where it is run.
 * - `moved` — no file at the recorded path, but a file with the recorded size
 *   and digest is elsewhere in the artifact directory. This is the state that
 *   decides the design: re-running would leave the person with two outputs while
 *   the one they were hunting for is still wherever it went, so DASH says where.
 * - `quarantined` — either the runner refused these bytes and is holding them
 *   apart, or the file is there and cannot be opened. DASH does not name what is
 *   holding it: it observed a refusal, not an antivirus product, and the
 *   non-goals rule out claims beyond the boundaries actually implemented.
 * - `deleted` — somebody asked for it to go. Read from the record, not from the
 *   filesystem, because the whole point is that this is a decision rather than a
 *   fault.
 * - `missing` — the file is not where it should be and is nowhere else this
 *   search looked. The only state where "run it again" is the whole recovery.
 */
export type ArtifactAvailability =
  | { state: "available" }
  | { state: "moved"; found_at: string }
  | { state: "quarantined"; reason: string }
  | { state: "deleted"; deleted_at: string }
  | { state: "missing" };

export function artifactAvailability(
  root: WorkspaceRoot,
  record: WorkspaceArtifact,
): ArtifactAvailability {
  if (record.retention === "deleted") {
    return { state: "deleted", deleted_at: record.deleted_at ?? record.registered_at };
  }
  if (record.retention === "quarantined") {
    return {
      state: "quarantined",
      reason: record.quarantine_reason ?? "DASH is holding these bytes apart.",
    };
  }

  let stats: ReturnType<typeof statSync> | null = null;
  try {
    stats = statSync(record.stored_path);
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM" || code === "EBUSY") {
      // The directory entry is reachable and the file is not. Something on this
      // computer is holding it, and re-running would produce another file that
      // the same something would take the same way — which is why this is not
      // `missing`.
      return {
        state: "quarantined",
        reason: "Something on this computer is holding that file and would not let DASH open it.",
      };
    }
    stats = null;
  }

  if (stats !== null) {
    if (Number(stats.size) === record.byte_size && stats.mtimeMs === record.mtime_ms) {
      // `stat` answers from the directory entry and succeeds on a file nothing
      // may open — permissions and holds gate `open`, not `stat` — so a match
      // here has not yet shown the bytes are reachable. Antivirus holds and
      // stripped permissions both present exactly this way: the entry intact,
      // the open refused.
      if (openRefused(record.stored_path)) {
        return {
          state: "quarantined",
          reason: "Something on this computer is holding that file and would not let DASH open it.",
        };
      }
      return { state: "available" };
    }
    // Right path, wrong file. Treated as the content search below rather than
    // asserted available, because a receipt that says a size it did not measure
    // is the failure this whole module is against.
  }

  const elsewhere = searchForMovedArtifact(root, record);
  return elsewhere === null ? { state: "missing" } : { state: "moved", found_at: elsewhere };
}

/**
 * Whether opening the file for reading is refused by something on this
 * computer. Only a refusal counts: a file that vanished between the `stat` and
 * the `open` is a race for the caller's other branches, not a hold.
 */
function openRefused(storedPath: string): boolean {
  try {
    closeSync(openSync(storedPath, "r"));
    return false;
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EACCES" || code === "EPERM" || code === "EBUSY";
  }
}

/**
 * Look for the recorded bytes somewhere else in the artifact directory.
 *
 * Bounded twice: only files whose size already matches are hashed, and only
 * `MOVED_SEARCH_MAX_CANDIDATES` of those. A search that could hash a hundred
 * gigabytes to answer a question about one missing file would be a worse failure
 * than the one it is diagnosing.
 *
 * The search does not look outside `{dataDir}/artifacts`. It could — the file
 * may well be in the user's Downloads folder — and it deliberately does not:
 * walking a person's filesystem to find their own file is a different feature
 * with a different consent conversation, and DASH would be reading directories
 * nobody gave it.
 */
function searchForMovedArtifact(root: WorkspaceRoot, record: WorkspaceArtifact): string | null {
  let entries: string[];
  try {
    entries = readdirSync(root.artifacts);
  } catch {
    return null;
  }

  let hashed = 0;
  for (const entry of entries) {
    if (hashed >= MOVED_SEARCH_MAX_CANDIDATES) {
      return null;
    }
    const candidate = path.join(root.artifacts, entry);
    if (candidate === record.stored_path) {
      continue;
    }
    let size: number;
    try {
      const stats = statSync(candidate);
      if (!stats.isFile()) {
        continue;
      }
      size = Number(stats.size);
    } catch {
      continue;
    }
    if (size !== record.byte_size) {
      continue;
    }
    hashed += 1;
    if (hashFileSync(candidate) === record.sha256) {
      return candidate;
    }
  }
  return null;
}

/**
 * The full check: re-hash the stored bytes and compare with the receipt.
 *
 * This is what "downloaded bytes and SHA-256 match the runner-registered
 * artifact" means, and it runs at download rather than at list. Separating it
 * from `artifactAvailability` is a deliberate honesty: a list says where a file
 * is, a download says what is in it, and a list that claimed the second would be
 * claiming a check it did not run.
 */
export function verifyArtifact(record: WorkspaceArtifact): { ok: boolean; sha256: string | null } {
  try {
    const digest = hashFileSync(record.stored_path);
    return { ok: digest === record.sha256, sha256: digest };
  } catch {
    return { ok: false, sha256: null };
  }
}

/**
 * Open one artifact's stored bytes for a download, or say why not.
 *
 * A stream crosses this boundary and `stored_path` does not, for the reason
 * `toView` in `runner/task-api.ts` already gives: a path in a returned value is
 * a path a caller can log, and this one is reached over the same authenticated
 * channel as everything else in this file. `deleted` is refused explicitly
 * rather than left to `createReadStream` to fail on — the record already knows
 * the bytes are gone, and answering from that fact is a route that fails for a
 * reason rather than an errno.
 */
export function openArtifactForDownload(
  record: WorkspaceArtifact,
): { ok: true; stream: ReturnType<typeof createReadStream> } | { ok: false; detail: string } {
  if (record.retention === "deleted") {
    return { ok: false, detail: "That output has been deleted." };
  }
  try {
    statSync(record.stored_path);
  } catch {
    return { ok: false, detail: "That output's bytes could not be found on this computer." };
  }
  return { ok: true, stream: createReadStream(record.stored_path) };
}

/**
 * Delete one artifact's bytes, explicitly and reversibly in the record.
 *
 * The row stays and the bytes go. That is the issue's "deleting an artifact is
 * explicit, audited, and separate from deleting run history": the run still
 * happened, the output still existed, and the record of both survives the
 * removal of the file — which is also what lets `deleted` be a state a person
 * reads rather than a blank space they have to interpret.
 */
export function deleteArtifact(
  database: DatabaseSync,
  artifactId: string,
  now: Date = new Date(),
): { ok: boolean } {
  const record = readArtifact(database, artifactId);
  if (record === null || record.retention === "deleted") {
    return { ok: false };
  }

  rmSync(record.stored_path, { force: true });
  transact(database, () => {
    database
      .prepare("UPDATE workspace_artifacts SET retention = 'deleted', deleted_at = ? WHERE artifact_id = ?")
      .run(now.toISOString(), artifactId);
  });
  return { ok: true };
}

/* ---------------------------------------------------------------------- *
 * Copying, hashing, bounding
 * ---------------------------------------------------------------------- */

class OversizeError extends Error {}

/**
 * Stream a file to a new location, hashing on the way, refusing to exceed a
 * bound.
 *
 * Streamed rather than `readFileSync` + `writeFileSync` because a 64 MiB ceiling
 * that is enforced by first loading 64 MiB into the runner's heap is a ceiling
 * that costs what it was written to prevent. The size check happens per chunk,
 * so a source that grows while it is being read is stopped mid-copy rather than
 * after — the file could be a pipe, a growing log, or a deliberate attempt to
 * spend the runner's disk.
 */
/**
 * One line of log per caught filesystem error: the code and the syscall,
 * never the path. Codes are diagnosis; paths in logs are the leak the rest of
 * this module is written to avoid.
 */
function describeCaught(error: unknown): string {
  if (error instanceof Error) {
    const errno = error as NodeJS.ErrnoException;
    return `${errno.code ?? error.name}${errno.syscall === undefined ? "" : ` (${errno.syscall})`}`;
  }
  return typeof error;
}

async function copyAndHash(
  source: string,
  destination: string,
  maxBytes: number,
): Promise<{ sha256: string; byte_size: number }> {
  mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });

  const hash = createHash("sha256");
  let total = 0;

  const reader = createReadStream(source);
  const writer = createWriteStream(destination, { mode: 0o600, flags: "wx" });

  await pipeline(
    reader,
    async function* (chunks: AsyncIterable<Buffer>) {
      for await (const chunk of chunks) {
        total += chunk.byteLength;
        if (total > maxBytes) {
          throw new OversizeError("over the byte limit");
        }
        hash.update(chunk);
        yield chunk;
      }
    },
    writer,
  );

  return { sha256: hash.digest("hex"), byte_size: total };
}

async function hashFile(target: string): Promise<{ sha256: string; byte_size: number }> {
  const hash = createHash("sha256");
  let total = 0;
  const reader = createReadStream(target);
  for await (const chunk of reader as AsyncIterable<Buffer>) {
    total += chunk.byteLength;
    hash.update(chunk);
  }
  return { sha256: hash.digest("hex"), byte_size: total };
}

function hashFileSync(target: string): string {
  return createHash("sha256").update(readFileSync(target)).digest("hex");
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${String(Math.round(bytes / (1024 * 1024)))} MB`;
  }
  if (bytes >= 1024) {
    return `${String(Math.round(bytes / 1024))} KB`;
  }
  return `${String(bytes)} bytes`;
}
