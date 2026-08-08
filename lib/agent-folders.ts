/**
 * The authoritative per-agent folder (ADR 0008, MAR-553).
 *
 * The SQLite `agents` row remains a complete, damage-tolerant projection, but
 * it is no longer the source of truth. New imports land here first and only
 * then touch the row. A crash after the folder commit therefore leaves the
 * recoverable disagreement: startup can project the folder into SQLite. The
 * opposite ordering would leave a row pointing at bytes DASH never acquired.
 *
 * `{dataDir}/agents` is also the runner's long-standing registration directory.
 * The two layouts coexist deliberately:
 *
 * - `{dataDir}/agents/<agent>.json` is the live runner registration;
 * - `{dataDir}/agents/manifests/**` is the pre-ADR managed-manifest location;
 * - `{dataDir}/agents/<agent>/` is the authoritative agent folder.
 *
 * The runner reads only top-level `.json` files, so the directories are not a
 * second registration path and require no runner change.
 */

import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

import { containedIn, inspectComponent, type PathProblem } from "../runner/path-guard";
import type { AgentRegistration } from "./registration";

export const AGENT_MANIFEST_FILE = "agent.manifest.json";
export const AGENT_REGISTRATION_FILE = "registration.json";
export const AGENT_CODE_DIRECTORY = "code";
export const AGENT_ASSETS_DIRECTORY = "assets";

/** The old managed-manifest directory is not an agent folder. */
const LEGACY_MANIFESTS_DIRECTORY = "manifests";
const TRANSACTIONS_DIRECTORY = ".folder-transactions";

/** Same ceiling the deploy bundle enforces, before JSON/base64 transport. */
export const MAX_AGENT_FOLDER_BYTES = 64 * 1024 * 1024;
export const MAX_AGENT_FOLDER_FILES = 1_024;
export const MAX_AGENT_MANIFEST_BYTES = 524_288;

/** Slice 5 consumes this sentence when a folder has no program to bundle. */
export const MANIFEST_ONLY_DEPLOY_REFUSAL =
  "This agent's build lives outside DASH; re-import it to put a copy in DASH's keeping.";

export interface AgentFolderFile {
  /** Project-relative, with either separator accepted and neither trusted. */
  path: string;
  /** The Agent Kit handoff contract is text in this slice. */
  contents: string;
}

/** Stable over file ordering, and ambiguous neither on path nor content length. */
export function agentFolderFilesDigest(files: readonly AgentFolderFile[]): string {
  const hash = createHash("sha256");
  const ordered = [...files].sort((a, b) => a.path.localeCompare(b.path));
  for (const file of ordered) {
    const contents = Buffer.from(file.contents, "utf8");
    hash.update(Buffer.from(file.path, "utf8"));
    hash.update(Buffer.from([0]));
    hash.update(String(contents.length));
    hash.update(Buffer.from([0]));
    hash.update(contents);
    hash.update(Buffer.from([0]));
  }
  return hash.digest("hex");
}

export interface AgentFolderWriteInput {
  dataDir: string;
  agent: string;
  /** The validated author document, kept byte-for-byte. */
  manifestJson: string;
  /** Present for a folder-carrying import; absent for a migrated standing. */
  registration?: AgentRegistration;
  /** Project files. Root files are placed under `code/`; `assets/**` stays so. */
  files?: readonly AgentFolderFile[];
}

export interface AgentFolderWriteResult {
  folder: string;
  manifest_path: string;
  registration_path: string | null;
  code_path: string;
  assets_path: string;
  files_written: number;
}

export type AgentFolderStanding =
  | {
      kind: "complete";
      folder: string;
      manifest_path: string;
      registration_path: string;
      code_path: string;
      assets_path: string;
    }
  | {
      kind: "manifest_only";
      folder: string;
      manifest_path: string;
      refusal: typeof MANIFEST_ONLY_DEPLOY_REFUSAL;
    }
  | { kind: "unreadable"; folder: string };

export function agentsRoot(dataDir: string): string {
  return path.join(dataDir, "agents");
}

export function inspectAgentFolderName(agent: string): PathProblem | null {
  return inspectComponent(agent);
}

function checkedAgentFolder(dataDir: string, agent: string): string {
  const problem = inspectAgentFolderName(agent);
  if (problem !== null) {
    throw new Error(`The agent name cannot be a folder component: ${problem.refusal}`);
  }
  const root = agentsRoot(dataDir);
  const folder = path.join(root, agent);
  if (!containedIn(root, folder)) {
    throw new Error("The agent folder would leave the agents root.");
  }
  return folder;
}

export function agentFolderPath(dataDir: string, agent: string): string {
  return checkedAgentFolder(dataDir, agent);
}

export function agentFolderManifestPath(dataDir: string, agent: string): string {
  return path.join(checkedAgentFolder(dataDir, agent), AGENT_MANIFEST_FILE);
}

export function agentFolderRegistrationPath(dataDir: string, agent: string): string {
  return path.join(checkedAgentFolder(dataDir, agent), AGENT_REGISTRATION_FILE);
}

export function agentFolderCodePath(dataDir: string, agent: string): string {
  return path.join(checkedAgentFolder(dataDir, agent), AGENT_CODE_DIRECTORY);
}

export function agentFolderAssetsPath(dataDir: string, agent: string): string {
  return path.join(checkedAgentFolder(dataDir, agent), AGENT_ASSETS_DIRECTORY);
}

/**
 * The first deploy-plane guard, exposed so the watched-failing pair is testable
 * independently of the filesystem write.
 */
export function inspectAgentFilePath(candidate: string): PathProblem | null {
  const segments = candidate.split(/[\\/]/);
  for (const segment of segments) {
    const problem = inspectComponent(segment);
    if (problem !== null) {
      return problem;
    }
  }
  return null;
}

/**
 * Map an Agent Kit project path into the folder.
 *
 * The manifest has its own authoritative location. `code/` and `assets/` are
 * accepted explicitly; every other project file belongs under `code/`, which
 * keeps the program's relative layout intact (so `agent.mjs` remains the
 * registration's argument and `sources.json` remains beside it).
 */
function mappedSegments(candidate: string): string[] {
  const segments = candidate.split(/[\\/]/);
  if (segments.length === 1 && segments[0] === AGENT_MANIFEST_FILE) {
    return [AGENT_MANIFEST_FILE];
  }
  if (segments[0] === AGENT_CODE_DIRECTORY || segments[0] === AGENT_ASSETS_DIRECTORY) {
    return segments;
  }
  return [AGENT_CODE_DIRECTORY, ...segments];
}

/**
 * The second deploy-plane guard: join first, then re-check containment.
 *
 * It checks both the per-agent folder and the agents root. The first prevents
 * one agent overwriting a sibling; the second is the ADR's explicit backstop
 * against leaving `{userData}/agents` altogether.
 */
export function agentFileIsContained(dataDir: string, agent: string, candidate: string): boolean {
  let folder: string;
  try {
    folder = checkedAgentFolder(dataDir, agent);
  } catch {
    return false;
  }
  const target = path.join(folder, ...mappedSegments(candidate));
  return containedIn(agentsRoot(dataDir), target) && containedIn(folder, target);
}

export function validateAgentFolderFiles(
  dataDir: string,
  agent: string,
  files: readonly AgentFolderFile[],
): string[] {
  const errors: string[] = [];
  const nameProblem = inspectAgentFolderName(agent);
  if (nameProblem !== null) {
    errors.push(`/agent/name cannot be used as a folder name (${nameProblem.refusal})`);
    return errors;
  }
  if (files.length > MAX_AGENT_FOLDER_FILES) {
    errors.push(`/files has more than ${String(MAX_AGENT_FOLDER_FILES)} entries`);
    return errors;
  }

  let bytes = 0;
  const targets = new Set<string>();
  files.forEach((file, index) => {
    if (
      typeof file !== "object" ||
      file === null ||
      typeof file.path !== "string" ||
      typeof file.contents !== "string"
    ) {
      errors.push(`/files/${String(index)} must have text path and contents`);
      return;
    }

    bytes += Buffer.byteLength(file.contents, "utf8");
    const componentProblem = inspectAgentFilePath(file.path);
    if (componentProblem !== null) {
      errors.push(`/files/${String(index)}/path is unsafe (${componentProblem.refusal})`);
    }
    if (!agentFileIsContained(dataDir, agent, file.path)) {
      errors.push(`/files/${String(index)}/path leaves the agent folder`);
    }

    const key = mappedSegments(file.path).join("/");
    const collisionKey = process.platform === "win32" ? key.toLowerCase() : key;
    if (targets.has(collisionKey)) {
      errors.push(`/files/${String(index)}/path names the same stored file twice`);
    }
    targets.add(collisionKey);
  });

  if (bytes > MAX_AGENT_FOLDER_BYTES) {
    errors.push(`/files contain more than ${String(MAX_AGENT_FOLDER_BYTES)} bytes`);
  }
  return errors;
}

/**
 * Whether the bytes DASH already holds are the bytes this import proposes.
 *
 * The registration's stored digest describes what DASH wrote last time; it
 * cannot prove the folder still contains those bytes. This comparison reads
 * only the explicitly declared files (never runtime-created reports or runs),
 * so reopening the same handoff repairs drift without treating an agent's own
 * output as a build change.
 */
export function agentFolderMatchesImport(input: AgentFolderWriteInput): boolean {
  if (validateAgentFolderFiles(input.dataDir, input.agent, input.files ?? []).length > 0) {
    return false;
  }
  try {
    if (readFileSync(agentFolderManifestPath(input.dataDir, input.agent), "utf8") !== input.manifestJson) {
      return false;
    }
    if (input.registration !== undefined) {
      const expected = `${JSON.stringify(input.registration, null, 2)}\n`;
      if (readFileSync(agentFolderRegistrationPath(input.dataDir, input.agent), "utf8") !== expected) {
        return false;
      }
    }
    const folder = checkedAgentFolder(input.dataDir, input.agent);
    for (const file of input.files ?? []) {
      const mapped = mappedSegments(file.path);
      if (mapped.length === 1 && mapped[0] === AGENT_MANIFEST_FILE) continue;
      const target = path.join(folder, ...mapped);
      const stats = lstatSync(target);
      if (stats.isSymbolicLink() || !stats.isFile()) return false;
      if (readFileSync(target, "utf8") !== file.contents) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Write one file and flush its contents before acknowledging it. */
function durableWrite(file: string, contents: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents, { encoding: "utf8", mode: 0o600 });
  // A read-only Windows handle rejects FlushFileBuffers with EPERM. `r+` does
  // not change the bytes; it gives fsync the write-capable handle the platform
  // requires for a real durability flush.
  const descriptor = openSync(file, "r+");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

/**
 * Flush a directory entry where the platform exposes directory handles.
 *
 * Windows commits file contents through `fsyncSync` above but does not always
 * permit opening a directory with Node's portable flags. The rename is still
 * journalled by NTFS; POSIX gets the additional directory fsync.
 */
function syncDirectory(directory: string): void {
  try {
    const descriptor = openSync(directory, "r");
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  } catch {
    // Unsupported directory handles are a platform fact, not a failed file
    // flush. Every file above has already completed a real fsync.
  }
}

function transactionKey(agent: string): string {
  return Buffer.from(agent, "utf8").toString("base64url");
}

function transactionPath(dataDir: string, agent: string): string {
  return path.join(agentsRoot(dataDir), TRANSACTIONS_DIRECTORY, transactionKey(agent));
}

function recoverOneSwap(dataDir: string, agent: string): void {
  const folder = checkedAgentFolder(dataDir, agent);
  const transaction = transactionPath(dataDir, agent);
  const backup = path.join(transaction, "backup");
  const staging = path.join(transaction, "staging");

  if (!existsSync(transaction)) {
    return;
  }
  if (existsSync(folder)) {
    // The new folder crossed the commit rename. Its row may still be old; that
    // is exactly the disagreement startup reconciliation is built to surface.
    rmSync(transaction, { recursive: true, force: true });
    return;
  }
  if (existsSync(backup)) {
    // The old folder was moved aside but the new one did not commit. Restore
    // the old source of truth, which still agrees with the untouched DB row.
    renameSync(backup, folder);
    syncDirectory(agentsRoot(dataDir));
  }
  rmSync(staging, { recursive: true, force: true });
  rmSync(transaction, { recursive: true, force: true });
}

/** Recover any folder swap interrupted before SQLite could be touched. */
export function recoverAgentFolderSwaps(dataDir: string): void {
  const root = agentsRoot(dataDir);
  const transactions = path.join(root, TRANSACTIONS_DIRECTORY);
  let entries: string[];
  try {
    entries = readdirSync(transactions);
  } catch {
    return;
  }

  for (const entry of entries) {
    let agent: string;
    try {
      agent = Buffer.from(entry, "base64url").toString("utf8");
    } catch {
      continue;
    }
    if (transactionKey(agent) !== entry || inspectAgentFolderName(agent) !== null) {
      continue;
    }
    recoverOneSwap(dataDir, agent);
  }
}

/**
 * Commit a complete replacement folder, then return. SQLite is intentionally
 * not in this module: the caller touches the index only after this succeeds.
 */
export function writeAgentFolder(input: AgentFolderWriteInput): AgentFolderWriteResult {
  const files = input.files ?? [];
  const errors = validateAgentFolderFiles(input.dataDir, input.agent, files);
  if (errors.length > 0) {
    throw new AgentFolderValidationError(errors);
  }
  if (Buffer.byteLength(input.manifestJson, "utf8") > MAX_AGENT_MANIFEST_BYTES) {
    throw new AgentFolderValidationError(["/manifest is too large for an agent manifest"]);
  }

  const root = agentsRoot(input.dataDir);
  const folder = checkedAgentFolder(input.dataDir, input.agent);
  const transaction = transactionPath(input.dataDir, input.agent);
  const staging = path.join(transaction, "staging");
  const backup = path.join(transaction, "backup");

  mkdirSync(root, { recursive: true });
  recoverOneSwap(input.dataDir, input.agent);
  rmSync(transaction, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });

  let filesWritten = 0;
  try {
    durableWrite(path.join(staging, AGENT_MANIFEST_FILE), input.manifestJson);
    filesWritten += 1;

    if (input.registration !== undefined) {
      durableWrite(
        path.join(staging, AGENT_REGISTRATION_FILE),
        `${JSON.stringify(input.registration, null, 2)}\n`,
      );
      filesWritten += 1;
    }

    for (const file of files) {
      const mapped = mappedSegments(file.path);
      // The separately validated manifest is the one door into DASH. Keeping a
      // second copy under `code/` would create a second document free to drift.
      if (mapped.length === 1 && mapped[0] === AGENT_MANIFEST_FILE) {
        continue;
      }
      durableWrite(path.join(staging, ...mapped), file.contents);
      filesWritten += 1;
    }

    // Flush every directory entry from the leaves upward before the commit
    // rename. `syncDirectory` is best-effort only where Node cannot open a
    // directory handle; file contents are never best-effort.
    const directories = new Set<string>([staging]);
    for (const file of files) {
      const mapped = mappedSegments(file.path);
      if (!(mapped.length === 1 && mapped[0] === AGENT_MANIFEST_FILE)) {
        let current = path.dirname(path.join(staging, ...mapped));
        while (containedIn(staging, current)) {
          directories.add(current);
          if (path.resolve(current) === path.resolve(staging)) break;
          current = path.dirname(current);
        }
      }
    }
    [...directories]
      .sort((a, b) => b.length - a.length)
      .forEach(syncDirectory);

    if (existsSync(folder)) {
      renameSync(folder, backup);
    }
    renameSync(staging, folder);
    syncDirectory(root);
    rmSync(transaction, { recursive: true, force: true });
    syncDirectory(root);
  } catch (error: unknown) {
    // Restore the old source of truth when the swap did not commit. If the new
    // folder is already present, leave it: the next startup will reconcile it
    // into the row and surface the disagreement.
    if (!existsSync(folder) && existsSync(backup)) {
      renameSync(backup, folder);
      syncDirectory(root);
    }
    rmSync(transaction, { recursive: true, force: true });
    throw error;
  }

  return {
    folder,
    manifest_path: path.join(folder, AGENT_MANIFEST_FILE),
    registration_path:
      input.registration === undefined ? null : path.join(folder, AGENT_REGISTRATION_FILE),
    code_path: path.join(folder, AGENT_CODE_DIRECTORY),
    assets_path: path.join(folder, AGENT_ASSETS_DIRECTORY),
    files_written: filesWritten,
  };
}

export class AgentFolderValidationError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super("The agent folder input is not safe to store.");
    this.name = "AgentFolderValidationError";
    this.errors = errors;
  }
}

/**
 * Migration helper: create only the manifest folder, and never replace a full
 * folder that may have arrived during a crash between folder and row commits.
 */
export function materializeManifestOnlyFolder(
  dataDir: string,
  agent: string,
  manifestJson: string,
): { created: boolean; folder: string } {
  const folder = checkedAgentFolder(dataDir, agent);
  if (existsSync(folder)) {
    return { created: false, folder };
  }
  writeAgentFolder({ dataDir, agent, manifestJson });
  return { created: true, folder };
}

export function listAgentFolderNames(dataDir: string): string[] {
  const root = agentsRoot(dataDir);
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        entry.name !== LEGACY_MANIFESTS_DIRECTORY &&
        entry.name !== TRANSACTIONS_DIRECTORY &&
        inspectAgentFolderName(entry.name) === null,
    )
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

export type AgentFolderManifestRead =
  | { ok: true; json: string; path: string }
  | { ok: false; problem: "missing" | "not_a_file" | "too_large" | "unreadable" };

export function readAgentFolderManifest(dataDir: string, agent: string): AgentFolderManifestRead {
  let folder: string;
  try {
    folder = checkedAgentFolder(dataDir, agent);
  } catch {
    return { ok: false, problem: "unreadable" };
  }
  const file = path.join(folder, AGENT_MANIFEST_FILE);
  try {
    const folderStats = lstatSync(folder);
    const fileStats = lstatSync(file);
    if (
      folderStats.isSymbolicLink() ||
      !folderStats.isDirectory() ||
      fileStats.isSymbolicLink() ||
      !fileStats.isFile()
    ) {
      return { ok: false, problem: "not_a_file" };
    }
    if (fileStats.size > MAX_AGENT_MANIFEST_BYTES) {
      return { ok: false, problem: "too_large" };
    }
    return { ok: true, json: readFileSync(file, "utf8"), path: file };
  } catch (error: unknown) {
    return {
      ok: false,
      problem: existsSync(file) ? "unreadable" : "missing",
    };
  }
}

export function inspectAgentFolderStanding(dataDir: string, agent: string): AgentFolderStanding {
  const folder = checkedAgentFolder(dataDir, agent);
  const manifest = readAgentFolderManifest(dataDir, agent);
  if (!manifest.ok) {
    return { kind: "unreadable", folder };
  }

  const registration = path.join(folder, AGENT_REGISTRATION_FILE);
  const code = path.join(folder, AGENT_CODE_DIRECTORY);
  let complete = false;
  try {
    complete = statSync(registration).isFile() && statSync(code).isDirectory();
  } catch {
    complete = false;
  }
  if (!complete) {
    return {
      kind: "manifest_only",
      folder,
      manifest_path: manifest.path,
      refusal: MANIFEST_ONLY_DEPLOY_REFUSAL,
    };
  }
  return {
    kind: "complete",
    folder,
    manifest_path: manifest.path,
    registration_path: registration,
    code_path: code,
    assets_path: path.join(folder, AGENT_ASSETS_DIRECTORY),
  };
}

/** Remove only the checked per-agent directory, never the shared agents root. */
export function removeAgentFolder(dataDir: string, agent: string): boolean {
  let folder: string;
  try {
    folder = checkedAgentFolder(dataDir, agent);
  } catch {
    // A legacy row whose name cannot be a component has no folder by design.
    return false;
  }
  if (!existsSync(folder)) {
    return false;
  }
  const stats = lstatSync(folder);
  rmSync(folder, { recursive: stats.isDirectory() && !stats.isSymbolicLink(), force: true });
  syncDirectory(agentsRoot(dataDir));
  return true;
}
