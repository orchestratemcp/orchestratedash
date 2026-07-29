/**
 * Registrations, and who owns them.
 *
 * `runner/README.md` settled the shape: a registration is a JSON file in
 * `{data-dir}/agents/`, and the control endpoint chooses *which* registration to
 * start, never *what* to run. MAR-415 left every one of those files to be
 * written by hand. MAR-428 has DASH write them, which raises three questions
 * that a hand-written file never had to answer, and this module is the answer
 * to all three:
 *
 * 1. **Who wrote this?** A registration DASH created from a handoff and one a
 *    developer dropped in by hand are not the same object. DASH may delete the
 *    first and must not delete the second, so ownership is recorded in the file
 *    rather than inferred from its existence.
 * 2. **Is this the same registration or a different one?** "Opening the same
 *    handoff twice does not create duplicates" is an acceptance criterion, so
 *    sameness has to be decidable. It is decided on the *material* facts — what
 *    would be spawned, and against which manifest — not on the file's bytes,
 *    which carry a timestamp that changes every time.
 * 3. **What exactly does removing it delete?** "Explicit ownership and cleanup"
 *    means DASH can say what it removed *and what it left alone*, in words a
 *    person can check.
 *
 * ## DASH copies the manifest instead of pointing at the author's
 *
 * The registration's `manifest_path` names a file inside DASH's own data
 * directory, written at the moment the user consented. Three things follow, all
 * of them wanted:
 *
 * - The manifest DASH validated in the consent dialog is byte-for-byte the one
 *   the runner will read. Pointing into the project would leave a window in
 *   which the file could change between the question and the answer.
 * - Editing the manifest in the project does not silently change what an
 *   already-approved agent is allowed to be commanded to do. It takes another
 *   handoff, and therefore another consent.
 * - Cleanup has something it unambiguously owns. Deleting a copy DASH made is
 *   obviously DASH's business; deleting a file in the user's project is not.
 *
 * ## The registration directory is DASH's data directory, deliberately
 *
 * `docs/msix-lifecycle-evidence.md` established that a package-activated MSIX
 * app's AppData is transparently redirected — `app.getPath("userData")` still
 * reads `%APPDATA%\OrchestrateDASH` while the bytes live under
 * `Packages\<family>\LocalCache`. DASH and the runner agree about where that is
 * because main passes the resolved path to the runner as
 * `DASH_RUNNER_DATA_DIR`. Any component that instead *computed* the conventional
 * path — the Agent Kit, say, running outside the package — would write
 * somewhere the packaged app cannot see. That is why the Agent Kit writes its
 * handoff into the user's own project and never into DASH's data directory.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * What the runner needs in order to supervise an agent.
 *
 * Defined here rather than in `runner/supervisor.ts` — which re-exports it —
 * because DASH is now a writer of these documents and the runner is the reader.
 * A shape owned by its only reader is a shape the writer copies, and a copied
 * shape drifts.
 */
export interface AgentRegistration {
  agent_id: string;
  /** Absolute, or relative to the registration file. */
  manifest_path: string;
  command: string;
  args: string[];
  cwd?: string;
  /** Extra environment for the child. Never merged with the runner's own. */
  env?: Record<string, string>;
}

/* ---------------------------------------------------------------------- *
 * The bundled interpreter
 * ---------------------------------------------------------------------- */

/**
 * The one command name that is not a program on this machine.
 *
 * **Why a sentinel and not a path (MAR-423).** An agent the Agent Kit produces
 * is registered with `command: "node"`, resolved against `PATH` at spawn time,
 * and that is right for somebody who typed `npx create-dash-agent` — they
 * demonstrably have Node. It is fatal for the person MAR-423 serves, who
 * installed DASH from the Store and has never installed anything else: the
 * spawn fails and first run ends in a setup.
 *
 * DASH already carries a Node runtime. `electron/runner-process.ts` launches the
 * runner as `process.execPath` with `ELECTRON_RUN_AS_NODE=1`, because the
 * Electron binary *is* Node when asked. So the interpreter exists; the problem is
 * only how to name it in a file that outlives the process that wrote it.
 *
 * It cannot be named by path. `docs/msix-lifecycle-evidence.md` measured the
 * install root as version-stamped — `WindowsApps\OrchestrateDASH_0.1.0.0_x64__…`
 * became `…_0.1.1.0_…` across an update — so a registration holding a real
 * `execPath` is a registration that stops working at the first update. That is
 * the same failure `agent-kit/open-in-dash.ts` avoids by not pinning to a Node
 * install, arriving by a different door.
 *
 * A sentinel is resolved at spawn, by the process doing the spawning, against
 * its own `execPath`. Nothing version-stamped is ever written down.
 *
 * **It grants nothing.** A registration may already name any command; this names
 * strictly one, and it is DASH's own binary rather than anything on disk. The
 * decision about whether an agent may be registered at all is still consent, and
 * still happens before any of this is written.
 */
export const BUNDLED_NODE_COMMAND = "dash:node";

/**
 * What to actually spawn, and what the child needs in its environment for it to
 * mean anything.
 *
 * Pure, and takes `execPath` as an argument rather than reading
 * `process.execPath`, so the resolution is testable without being inside the
 * runner and so it is obvious that the *spawning* process supplies it — a value
 * resolved by DASH and handed to the runner would be the version-stamped path
 * again, one hop further away from where it goes stale.
 */
export function resolveSpawnCommand(
  command: string,
  execPath: string,
): { command: string; env: Record<string, string> } {
  if (command !== BUNDLED_NODE_COMMAND) {
    return { command, env: {} };
  }
  return { command: execPath, env: { ELECTRON_RUN_AS_NODE: "1" } };
}

export type RegistrationOwner =
  /** DASH wrote this from a handoff the user approved. DASH may remove it. */
  | "dash_handoff"
  /** Somebody put this here by hand. DASH reports it and leaves it alone. */
  | "external";

/**
 * DASH's own block inside a registration file.
 *
 * Additive, and invisible to the runner: `loadRegistrations` reads the fields it
 * knows and carries the rest through untouched, so recording ownership here
 * costs the runner nothing and needs no second file to fall out of sync with.
 */
export interface RegistrationOwnership {
  owner: RegistrationOwner;
  /** The handoff this came from. Absent for anything DASH did not create. */
  handoff_id?: string;
  /** Where the agent's own code lives. DASH never deletes this. */
  source_project?: string;
  /** Plain-language name, for the UI and for the cleanup report. */
  display_name: string;
  /** One sentence about what the agent does. */
  summary: string;
  registered_at: string;
  /** Of the manifest DASH copied, so a changed plan is detectable. */
  manifest_sha256: string;
}

export interface ManagedRegistration extends AgentRegistration {
  dash: RegistrationOwnership;
}

export function registrationsDirectory(dataDir: string): string {
  return path.join(dataDir, "agents");
}

export function registrationPath(dataDir: string, agentId: string): string {
  return path.join(registrationsDirectory(dataDir), `${agentId}.json`);
}

/**
 * Where DASH keeps its copy of an agent's manifest.
 *
 * A subdirectory rather than a sibling file, because the runner treats *every*
 * `.json` in the registration directory as a registration. A
 * `my-agent.manifest.json` sitting beside `my-agent.json` would be loaded,
 * rejected as "agent_id is missing", and logged as a skipped registration on
 * every single runner start — a permanent warning about a file that is exactly
 * where it belongs. A directory is not read as a registration at all.
 */
export function managedManifestPath(dataDir: string, agentId: string): string {
  return path.join(registrationsDirectory(dataDir), "manifests", `${agentId}.manifest.json`);
}

export function manifestDigest(manifestJson: string): string {
  return createHash("sha256").update(manifestJson, "utf8").digest("hex");
}

/* ---------------------------------------------------------------------- *
 * Reading
 * ---------------------------------------------------------------------- */

/**
 * One registration, or null when there is none DASH can read.
 *
 * A file that exists but does not parse returns null rather than throwing. The
 * caller's question is "is there already an agent by this name", and the honest
 * answer for an unreadable file is "not one DASH can reason about" — the
 * runner's own loader reaches the same conclusion and skips it.
 */
export function readRegistration(dataDir: string, agentId: string): ManagedRegistration | null {
  try {
    const parsed = JSON.parse(
      readFileSync(registrationPath(dataDir, agentId), "utf8"),
    ) as Partial<ManagedRegistration>;
    if (typeof parsed.agent_id !== "string" || typeof parsed.command !== "string") {
      return null;
    }
    return {
      agent_id: parsed.agent_id,
      manifest_path: String(parsed.manifest_path ?? ""),
      command: parsed.command,
      args: Array.isArray(parsed.args) ? parsed.args.map(String) : [],
      cwd: typeof parsed.cwd === "string" ? parsed.cwd : undefined,
      env: isStringMap(parsed.env) ? parsed.env : undefined,
      dash: ownershipOf(parsed),
    };
  } catch {
    return null;
  }
}

/**
 * Every registration in the directory, including the ones DASH does not own.
 *
 * The externals are the point: a UI that lists only DASH's own registrations
 * would show a user "no agents" while the runner supervised three, which is the
 * kind of quiet disagreement between two views of one directory that this
 * project keeps refusing to ship.
 */
export function listRegistrations(dataDir: string): ManagedRegistration[] {
  let entries: string[];
  try {
    entries = readdirSync(registrationsDirectory(dataDir)).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }

  const found: ManagedRegistration[] = [];
  for (const entry of entries) {
    const registration = readRegistration(dataDir, entry.slice(0, -".json".length));
    if (registration !== null) {
      found.push(registration);
    }
  }
  return found.sort((a, b) => a.agent_id.localeCompare(b.agent_id));
}

function isStringMap(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}

/**
 * A registration with no `dash` block was written by something other than DASH.
 *
 * Treating an absent block as "external" rather than as a defect is what keeps
 * the hand-written path from MAR-415 working: `runner/README.md` documents a
 * four-field registration file, people have written them, and DASH must neither
 * refuse them nor claim to own them.
 */
function ownershipOf(parsed: Partial<ManagedRegistration>): RegistrationOwnership {
  const block = parsed.dash;
  if (
    typeof block !== "object" ||
    block === null ||
    (block.owner !== "dash_handoff" && block.owner !== "external")
  ) {
    return {
      owner: "external",
      display_name: String(parsed.agent_id ?? "this agent"),
      summary: "Registered outside DASH, by hand.",
      registered_at: "",
      manifest_sha256: "",
    };
  }
  return {
    owner: block.owner,
    handoff_id: typeof block.handoff_id === "string" ? block.handoff_id : undefined,
    source_project: typeof block.source_project === "string" ? block.source_project : undefined,
    display_name: String(block.display_name ?? parsed.agent_id ?? "this agent"),
    summary: String(block.summary ?? ""),
    registered_at: String(block.registered_at ?? ""),
    manifest_sha256: String(block.manifest_sha256 ?? ""),
  };
}

/* ---------------------------------------------------------------------- *
 * Sameness
 * ---------------------------------------------------------------------- */

/**
 * What would change if `proposed` replaced `existing`, in words.
 *
 * An empty list means the two are the same registration, which is what makes
 * re-opening a handoff idempotent rather than merely repeated. The comparison is
 * on what would be spawned and against what plan — never on `registered_at`,
 * `handoff_id` or the file's bytes, all of which differ on every rebuild while
 * describing exactly the same agent.
 *
 * The strings are plain language because they are shown to the person deciding
 * whether to accept the change, not to a developer reading a diff.
 */
export function describeRegistrationChange(
  existing: ManagedRegistration,
  proposed: ManagedRegistration,
): string[] {
  const changes: string[] = [];

  if (existing.command !== proposed.command || !sameList(existing.args, proposed.args)) {
    changes.push("what DASH would run has changed");
  }
  if (path.resolve(existing.cwd ?? "") !== path.resolve(proposed.cwd ?? "")) {
    changes.push("the folder it runs in has changed");
  }
  if (!sameMap(existing.env ?? {}, proposed.env ?? {})) {
    changes.push("its settings have changed");
  }
  if (existing.dash.manifest_sha256 !== proposed.dash.manifest_sha256) {
    changes.push("what the agent plans to do has changed");
  }
  return changes;
}

/**
 * Would these two registrations spawn the same thing against the same manifest?
 *
 * The runner's question, as opposed to DASH's: it has no ownership block to
 * compare and no interest in display names, only in whether the supervised
 * entry it already holds still describes the file on disk.
 */
export function sameRegistration(a: AgentRegistration, b: AgentRegistration): boolean {
  return (
    a.agent_id === b.agent_id &&
    a.command === b.command &&
    sameList(a.args, b.args) &&
    path.resolve(a.manifest_path) === path.resolve(b.manifest_path) &&
    path.resolve(a.cwd ?? "") === path.resolve(b.cwd ?? "") &&
    sameMap(a.env ?? {}, b.env ?? {})
  );
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function sameMap(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

/* ---------------------------------------------------------------------- *
 * Writing
 * ---------------------------------------------------------------------- */

export type WriteOutcome = "created" | "updated" | "unchanged";

export interface WriteRegistrationInput {
  registration: AgentRegistration;
  ownership: Omit<RegistrationOwnership, "manifest_sha256">;
  /** The manifest, already validated as v2 by the caller. Stored verbatim. */
  manifestJson: string;
}

/**
 * Write a registration and DASH's copy of its manifest, idempotently.
 *
 * `unchanged` is returned *without writing anything*, which is stronger than
 * writing identical bytes: it means a replayed handoff leaves the file's
 * modification time alone, so "has this agent been touched since I approved it"
 * stays a question the filesystem can answer.
 *
 * Mode 0o600 on the files matters on POSIX and is ignored on Windows, where the
 * data directory is inside the user's profile and, in a packaged install, inside
 * the package's own per-user store. Nothing secret is in either file — that is
 * enforced upstream in `lib/handoff.ts` — so this is defence in depth rather
 * than the defence.
 */
export function writeRegistration(
  dataDir: string,
  input: WriteRegistrationInput,
): { outcome: WriteOutcome; changes: string[]; registration: ManagedRegistration } {
  const agentId = input.registration.agent_id;
  const manifestFile = managedManifestPath(dataDir, agentId);

  const proposed: ManagedRegistration = {
    ...input.registration,
    // DASH's copy, not the author's. See the module header.
    manifest_path: manifestFile,
    dash: {
      ...input.ownership,
      manifest_sha256: manifestDigest(input.manifestJson),
    },
  };

  const existing = readRegistration(dataDir, agentId);
  if (existing !== null) {
    const changes = describeRegistrationChange(existing, proposed);
    if (changes.length === 0) {
      return { outcome: "unchanged", changes, registration: existing };
    }
    persist(dataDir, proposed, input.manifestJson);
    return { outcome: "updated", changes, registration: proposed };
  }

  persist(dataDir, proposed, input.manifestJson);
  return { outcome: "created", changes: [], registration: proposed };
}

function persist(dataDir: string, registration: ManagedRegistration, manifestJson: string): void {
  const manifestFile = managedManifestPath(dataDir, registration.agent_id);
  mkdirSync(path.dirname(manifestFile), { recursive: true });
  writeFileSync(manifestFile, manifestJson, { encoding: "utf8", mode: 0o600 });

  const file = registrationPath(dataDir, registration.agent_id);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(registration, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

/* ---------------------------------------------------------------------- *
 * Removal
 * ---------------------------------------------------------------------- */

export interface CleanupReport {
  ok: boolean;
  agent_id: string;
  /** Plain-language list of what DASH deleted. */
  removed: string[];
  /**
   * Plain-language list of what DASH deliberately did **not** touch.
   *
   * Present on purpose, and not only when it is interesting. "Explicit
   * ownership" means a user who removes an agent learns that their own project
   * folder is still there — silence would leave them guessing whether DASH just
   * deleted their work, which is the exact anxiety an uninstall dialog should
   * not create.
   */
  left_alone: string[];
  /** Set when DASH declined to remove anything. */
  refusal?: string;
}

/**
 * Remove a registration DASH owns, and say what happened.
 *
 * Refuses to remove one it does not own. A hand-written registration is
 * somebody's deliberate configuration, and a monitor that deletes configuration
 * it did not create is not a monitor. The refusal names the file so the person
 * can remove it themselves.
 *
 * Stopping the agent's process is **not** done here: this module has no runner
 * and no supervisor. `lib/handoff-flow.ts` stops first and then calls this, in
 * that order, because deleting a registration under a running agent would leave
 * a process nobody has a record of.
 */
export function removeRegistration(dataDir: string, agentId: string): CleanupReport {
  const existing = readRegistration(dataDir, agentId);
  if (existing === null) {
    return {
      ok: false,
      agent_id: agentId,
      removed: [],
      left_alone: [],
      refusal: `DASH has no agent called “${agentId}”.`,
    };
  }

  if (existing.dash.owner !== "dash_handoff") {
    return {
      ok: false,
      agent_id: agentId,
      removed: [],
      left_alone: ["everything — DASH changed nothing"],
      refusal:
        `“${agentId}” was set up by hand rather than added through DASH, so DASH will not delete it. ` +
        `Remove ${registrationPath(dataDir, agentId)} yourself if you no longer want it.`,
    };
  }

  const removed: string[] = [];
  rmSync(registrationPath(dataDir, agentId), { force: true });
  removed.push("the instruction that lets DASH start this agent");
  rmSync(managedManifestPath(dataDir, agentId), { force: true });
  removed.push("DASH's copy of what the agent plans to do");

  const leftAlone = [
    existing.dash.source_project === undefined
      ? "the agent's own folder and everything in it"
      : `the agent's own folder (${existing.dash.source_project}) and everything in it`,
    "anything the agent itself has written, including its reports",
  ];

  return { ok: true, agent_id: agentId, removed, left_alone: leftAlone };
}
