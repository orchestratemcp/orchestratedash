/**
 * Opening a handoff: the whole decision, in one testable place.
 *
 * `electron/main.ts` receives a `dash://handoff?…` URL from the operating system
 * and passes it here. Everything that decides anything happens in this module,
 * against injected ports, so the paths that matter most — an expired link, a
 * link whose nonce does not match, a second click on the same link, a manifest
 * that is not v2, an agent somebody registered by hand — are covered by the test
 * suite that runs on every push rather than by a local Electron smoke.
 *
 * ## The order of the checks is the security argument
 *
 * 1. **Parse the URL.** Attacker-authored by construction.
 * 2. **Read the file it names**, bounded, and validate its shape.
 * 3. **Verify the nonce**, in constant time, against the file's own copy. This
 *    is what makes the link unusable by anyone who could not read the file — a
 *    web page that guesses a project path cannot guess this.
 * 4. **Read and validate the manifest** the handoff names, and refuse anything
 *    that is not v2. The runner would refuse it later anyway; refusing here
 *    means the user is never asked to approve something that cannot work.
 * 5. **Check the manifest agrees with the handoff** about which agent this is.
 * 6. **Record that the question arrived**, without any command or credential.
 * 7. **Ask the user**, in plain language, naming what will run. The question
 *    expires with the handoff rather than waiting forever.
 * 8. Only after consent write a registration or import a manifest.
 *
 * Nothing before step 6 changes any state. The pending ledger row is the one
 * deliberate exception to "consent before writes": it grants no capability and
 * records only that consent was requested, so a crash cannot make an arrived
 * handoff indistinguishable from one DASH never saw.
 *
 * ## Why consent is not optional, ever
 *
 * Registering an agent hands the runner a command line to spawn. The nonce
 * narrows *who may ask* to someone who can already read files in the user's
 * project; consent decides *whether it happens*. Neither substitutes for the
 * other, and there is no branch in this module that writes a registration
 * without `confirm` having returned true.
 *
 * The one apparent exception is not one: a replayed handoff for an agent that is
 * already registered with identical facts writes nothing at all, and so needs no
 * consent for the same reason reading a file needs none.
 */

import { readFileSync, statSync } from "node:fs";

import { isManifestV2, validateManifest, type AnyAgentManifest } from "./contracts";
import {
  AGENT_CODE_DIRECTORY,
  AGENT_MANIFEST_FILE,
  agentFolderCodePath,
  agentFolderFilesDigest,
  agentFolderMatchesImport,
  agentFolderManifestPath,
  agentFolderPath,
  inspectAgentFolderName,
  storedFileDigests,
  storedRelativePath,
  validateAgentFolderFiles,
  type AgentFolderFile,
} from "./agent-folders";
import { readSourceNames } from "./agent-sources";
import { resolveConnectionRequirements } from "./connection-spec";
import { STORED_SOURCES_PATH } from "./folder-changes";
import type { HandoffOutcome, HandoffRecord } from "./handoff-ledger";
import { explainImportFailure, formatExplanationDetail } from "./import-feedback";
import { checkManifestConstraints } from "./manifest-constraints";
import {
  parseHandoffUrl,
  readHandoff,
  verifyHandoff,
  type AgentHandoff,
} from "./handoff";
import {
  BUNDLED_NODE_COMMAND,
  describeRegistrationChange,
  manifestDigest,
  readRegistration,
  removeRegistration,
  writeRegistration,
  type AgentRegistration,
  type CleanupReport,
  type ManagedRegistration,
} from "./registration";

/** A manifest is a plan, not a payload. Anything larger is not one. */
export const MAX_MANIFEST_BYTES = 524_288;

/* ---------------------------------------------------------------------- *
 * What the user is shown
 * ---------------------------------------------------------------------- */

/**
 * A question DASH asks, in the words it asks it.
 *
 * Built as data rather than rendered here so the copy is unit-testable against
 * the acceptance criterion "a fresh user never sees `manifest_path`, component
 * IDs, env-var names or raw scopes" — a property of strings, checkable as one.
 *
 * What *is* shown, and why it is not a violation of that rule: the program that
 * will run, and the folder it runs in. A dialog that asks permission to execute
 * something while declining to say what would be worse than the technical
 * jargon it was avoiding, and neither a command name nor a folder the user
 * themselves created is jargon. The rule is about DASH's internal vocabulary
 * leaking out, not about hiding what is about to happen.
 */
export interface HandoffPrompt {
  title: string;
  /** The question. One sentence. */
  message: string;
  /** Supporting facts. Plain language, newline-separated. */
  detail: string;
  confirm_label: string;
  cancel_label: string;
}

export interface HandoffReport {
  ok: boolean;
  outcome: HandoffOutcome;
  agent_id?: string;
  /** One sentence for the user. Always present, always plain language. */
  headline: string;
  /** Supporting detail, when there is any worth giving. */
  detail?: string;
  /** True when the agent's process is running as a result of this. */
  running?: boolean;
}

/* ---------------------------------------------------------------------- *
 * Ports
 * ---------------------------------------------------------------------- */

export interface RunnerPort {
  /** Ask the runner to re-read its registration directory. */
  reload(): Promise<{ ok: boolean; detail?: string }>;
  start(agentId: string): Promise<{ ok: boolean; detail?: string }>;
  stop(agentId: string): Promise<{ ok: boolean; detail?: string }>;
}

export interface HandoffPorts {
  /** DASH's data directory — the resolved one, never a computed convention. */
  dataDir: string;
  now(): Date;
  /** Ask the person. The native question must close when the handoff expires. */
  confirm(prompt: HandoffPrompt, expiresAt: string): Promise<boolean | "expired">;
  /** Store the manifest so the rest of DASH can see the agent. */
  importManifest(
    manifest: unknown,
    options?: {
      files?: readonly AgentFolderFile[];
      registration?: AgentRegistration;
      manifestJson?: string;
    },
  ): { ok: boolean; errors?: string[]; locked?: boolean };
  /** Drop DASH's current picture of an agent. History is kept; see lib/store.ts. */
  forgetAgent(
    agentId: string,
    options?: { deleteFolder?: boolean },
  ): { existed: boolean };
  recordHandoff(record: HandoffRecord): void;
  readHandoffRecord(handoffId: string): HandoffRecord | null;
  /** Null on a machine where DASH could not start a runner. */
  runner: RunnerPort | null;
  log(line: string): void;
}

/* ---------------------------------------------------------------------- *
 * Opening a handoff
 * ---------------------------------------------------------------------- */

export async function openHandoff(url: string, ports: HandoffPorts): Promise<HandoffReport> {
  const pointer = parseHandoffUrl(url);
  if (!pointer.ok) {
    ports.log(`[dash-shell] refused a handoff link: ${pointer.problem}`);
    return { ok: false, outcome: "refused", headline: pointer.detail };
  }

  const document = readHandoff(pointer.value.file);
  if (!document.ok) {
    ports.log(`[dash-shell] refused a handoff file: ${document.problem}`);
    return { ok: false, outcome: "refused", headline: document.detail };
  }

  const verified = verifyHandoff(document.value, pointer.value, ports.now());
  if (!verified.ok) {
    // Recorded, because "nothing happened when I clicked the link" is a question
    // an expired handoff should be able to answer for itself later.
    ports.recordHandoff({
      handoff_id: document.value.handoff_id,
      agent: document.value.agent_id,
      outcome: "refused",
      source: document.value.project_dir,
      detail: verified.problem,
      decided_at: ports.now().toISOString(),
    });
    ports.log(`[dash-shell] refused a handoff: ${verified.problem}`);
    return {
      ok: false,
      outcome: "refused",
      agent_id: document.value.agent_id,
      headline: verified.detail,
    };
  }

  const handoff = verified.value;
  const manifest = readManifestFor(handoff, ports.dataDir);
  if (!manifest.ok) {
    return refuse(ports, handoff, manifest.headline, manifest.detail);
  }

  return register(handoff, manifest.value, manifest.json, ports);
}

function refuse(
  ports: HandoffPorts,
  handoff: AgentHandoff,
  headline: string,
  detail?: string,
): HandoffReport {
  ports.recordHandoff({
    handoff_id: handoff.handoff_id,
    agent: handoff.agent_id,
    outcome: "refused",
    source: handoff.project_dir,
    detail: headline,
    decided_at: ports.now().toISOString(),
  });
  return { ok: false, outcome: "refused", agent_id: handoff.agent_id, headline, detail };
}

/**
 * Read the manifest a handoff names, and hold it to the same bar the runner
 * would.
 *
 * The v1 refusal is the runner's, repeated here on purpose. `runner/README.md`
 * says hosting requires v2 "and it checks that **before** spawning anything — a
 * refusal that happened after the agent ran would not be a refusal". The same
 * logic one step earlier: a refusal that happens after the user approved is a
 * dialog that wasted their time and taught them that approving is meaningless.
 */
function readManifestFor(
  handoff: AgentHandoff,
  dataDir: string,
):
  | { ok: true; value: AnyAgentManifest; json: string }
  | { ok: false; headline: string; detail?: string } {
  if (handoff.files === undefined) {
    return readManifestFromProject(handoff);
  }

  if (inspectAgentFolderName(handoff.agent_id) !== null) {
    return {
      ok: false,
      headline: `“${handoff.display_name}” has a name DASH cannot use for its folder.`,
      detail: "Give the agent a file-name-safe name and build it again. DASH will not silently rename it.",
    };
  }
  const fileErrors = validateAgentFolderFiles(dataDir, handoff.agent_id, handoff.files);
  if (fileErrors.length > 0) {
    return {
      ok: false,
      headline: `“${handoff.display_name}” asks DASH to copy a file outside its own folder.`,
      detail: "Build the agent again with a current Agent Kit. DASH did not copy any files.",
    };
  }
  const declared = handoff.files.find(
    (file) => file.path.replace(/\\/g, "/") === AGENT_MANIFEST_FILE,
  );
  if (declared === undefined) {
    return {
      ok: false,
      headline: `“${handoff.display_name}” did not include the plan it asks DASH to copy.`,
      detail: "Build the agent again, then run “Open in DASH” from its folder.",
    };
  }
  if (Buffer.byteLength(declared.contents, "utf8") > MAX_MANIFEST_BYTES) {
    return {
      ok: false,
      headline: `“${handoff.display_name}” has an implausibly large plan, so DASH did not read it.`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(declared.contents);
  } catch {
    return {
      ok: false,
      headline: `“${handoff.display_name}” has a damaged plan file, so DASH did not add it.`,
      detail: "Build the agent again, then run “Open in DASH” from its folder.",
    };
  }
  const validation = validateManifest(parsed);
  if (!validation.ok) {
    return {
      ok: false,
      headline: `“${handoff.display_name}” does not match what DASH knows how to run.`,
      // The fourth door, finally saying what the other three say. See
      // `formatExplanationDetail`.
      detail: formatExplanationDetail(explainImportFailure(validation.errors)),
    };
  }
  if (!isManifestV2(validation.value)) {
    return {
      ok: false,
      headline: `“${handoff.display_name}” was built for an older version of DASH.`,
      detail:
        "DASH can only run agents built with the current Agent Kit. Older agents can still be imported to watch, but not started.",
    };
  }
  if (validation.value.agent.name !== handoff.agent_id) {
    return {
      ok: false,
      headline: "That handoff does not match the agent's own plan, so DASH did not add it.",
      detail: "Build the agent again, then run “Open in DASH” from its folder.",
    };
  }
  const constraintErrors = checkManifestConstraints(validation.value);
  if (constraintErrors.length > 0) {
    if (inspectAgentFolderName(validation.value.agent.name) !== null) {
      return {
        ok: false,
        headline: `“${handoff.display_name}” has a name DASH cannot use for its folder.`,
        detail:
          "Give the agent a file-name-safe name and build it again. DASH will not silently rename it.",
      };
    }
    return {
      ok: false,
      headline: `“${handoff.display_name}” has a name or runtime declaration DASH cannot import.`,
      detail: formatExplanationDetail(explainImportFailure(constraintErrors)),
    };
  }
  return { ok: true, value: validation.value, json: declared.contents };
}

/** Compatibility path for a handoff written before file sets were carried. */
function readManifestFromProject(
  handoff: AgentHandoff,
):
  | { ok: true; value: AnyAgentManifest; json: string }
  | { ok: false; headline: string; detail?: string } {
  let size: number;
  try {
    size = statSync(handoff.manifest_path).size;
  } catch {
    return {
      ok: false,
      headline: `DASH could not find what “${handoff.display_name}” plans to do.`,
      detail: "Build the agent again, then run “Open in DASH” from its folder.",
    };
  }
  if (size > MAX_MANIFEST_BYTES) {
    return {
      ok: false,
      headline: `“${handoff.display_name}” has an implausibly large plan, so DASH did not read it.`,
    };
  }

  let json: string;
  let parsed: unknown;
  try {
    json = readFileSync(handoff.manifest_path, "utf8");
    parsed = JSON.parse(json);
  } catch {
    return {
      ok: false,
      headline: `“${handoff.display_name}” has a damaged plan file, so DASH did not add it.`,
      detail: "Build the agent again, then run “Open in DASH” from its folder.",
    };
  }

  const validation = validateManifest(parsed);
  if (!validation.ok) {
    return {
      ok: false,
      headline: `“${handoff.display_name}” does not match what DASH knows how to run.`,
      detail: formatExplanationDetail(explainImportFailure(validation.errors)),
    };
  }
  if (!isManifestV2(validation.value)) {
    return {
      ok: false,
      headline: `“${handoff.display_name}” was built for an older version of DASH.`,
      detail:
        "DASH can only run agents built with the current Agent Kit. Older agents can still be imported to watch, but not started.",
    };
  }

  // The manifest and the handoff must agree about which agent this is.
  //
  // Without this, a handoff could name one agent and point at another's plan —
  // and since the plan is what decides which commands DASH will offer, that is
  // an agent inheriting a different agent's permissions. Cheap to check, and
  // impossible to reason about later if it is not.
  if (validation.value.agent.name !== handoff.agent_id) {
    return {
      ok: false,
      headline: "That handoff does not match the agent's own plan, so DASH did not add it.",
      detail: "Build the agent again, then run “Open in DASH” from its folder.",
    };
  }

  // The contradiction ADR 0006 refuses at import (MAR-482), refused at this
  // door too — the same rule at the same moment, one step earlier than the
  // store, because a refusal after the user approved the dialog is a dialog
  // that wasted their time.
  const legacyConstraintErrors = checkManifestConstraints(validation.value);
  if (legacyConstraintErrors.length > 0) {
    if (inspectAgentFolderName(validation.value.agent.name) !== null) {
      return {
        ok: false,
        headline: `“${handoff.display_name}” has a name DASH cannot use for its folder.`,
        detail:
          "Give the agent a file-name-safe name and build it again. DASH will not silently rename it.",
      };
    }
    return {
      ok: false,
      headline: `“${handoff.display_name}” runs on another computer, but asks DASH to manage sign-ins for it.`,
      detail:
        "DASH can only manage a sign-in for an agent it runs on this computer. " +
        "Build the agent again with its connections marked as the agent's own.",
    };
  }

  return { ok: true, value: validation.value, json };
}

async function register(
  handoff: AgentHandoff,
  manifest: AnyAgentManifest,
  manifestJson: string,
  ports: HandoffPorts,
): Promise<HandoffReport> {
  const existing = readRegistration(ports.dataDir, handoff.agent_id);

  if (existing !== null && existing.dash.owner !== "dash_handoff") {
    return refuse(
      ports,
      handoff,
      `An agent called “${handoff.agent_id}” was already set up on this computer by hand.`,
      "DASH will not overwrite it. Remove it yourself, or give this agent a different name and build it again.",
    );
  }

  // The idempotent path. Same agent, same facts: nothing to write and nothing
  // to ask. The end state is still made true — an agent that is registered and
  // not running is not "already added" in any sense the user cares about.
  const changes =
    existing === null ? [] : changesFrom(existing, handoff, manifestJson, ports.dataDir);
  if (
    existing !== null &&
    handoff.files !== undefined &&
    !agentFolderMatchesImport({
      dataDir: ports.dataDir,
      agent: handoff.agent_id,
      manifestJson,
      registration: {
        agent_id: handoff.agent_id,
        manifest_path: AGENT_MANIFEST_FILE,
        command: handoff.command,
        args: handoff.args,
        cwd: AGENT_CODE_DIRECTORY,
        env: handoff.env,
      },
      files: handoff.files,
    }) &&
    !changes.includes("the copy of the agent DASH would run has changed")
  ) {
    changes.push("the copy of the agent DASH would run has changed");
  }

  if (existing !== null && changes.length === 0) {
    const seenBefore = ports.readHandoffRecord(handoff.handoff_id) !== null;
    const started = await ensureRunning(handoff.agent_id, ports);
    ports.recordHandoff({
      handoff_id: handoff.handoff_id,
      agent: handoff.agent_id,
      outcome: "unchanged",
      source: handoff.project_dir,
      detail: seenBefore ? "opened again" : "already registered",
      decided_at: ports.now().toISOString(),
    });
    return {
      ok: true,
      outcome: "unchanged",
      agent_id: handoff.agent_id,
      headline: `“${handoff.display_name}” is already in DASH.`,
      detail: started.running
        ? "It is running. Nothing was added twice."
        : started.detail ?? "Nothing was added twice.",
      running: started.running,
    };
  }

  const prompt =
    existing === null
      ? describeNewAgent(handoff, manifest)
      : describeChangedAgent(handoff, changes);

  ports.recordHandoff({
    handoff_id: handoff.handoff_id,
    agent: handoff.agent_id,
    outcome: "pending",
    source: handoff.project_dir,
    detail: "waiting for confirmation",
    decided_at: ports.now().toISOString(),
  });

  const agreed = await ports.confirm(prompt, handoff.expires_at);
  if (agreed === "expired" || Date.parse(handoff.expires_at) <= ports.now().getTime()) {
    ports.recordHandoff({
      handoff_id: handoff.handoff_id,
      agent: handoff.agent_id,
      outcome: "refused",
      source: handoff.project_dir,
      detail: "expired while waiting for confirmation",
      decided_at: ports.now().toISOString(),
    });
    return {
      ok: false,
      outcome: "refused",
      agent_id: handoff.agent_id,
      headline: `The request to add “${handoff.display_name}” expired while it was waiting for you.`,
      detail: "Nothing was changed. Open the agent in DASH again to make a fresh request.",
    };
  }
  if (!agreed) {
    ports.recordHandoff({
      handoff_id: handoff.handoff_id,
      agent: handoff.agent_id,
      outcome: "declined",
      source: handoff.project_dir,
      decided_at: ports.now().toISOString(),
    });
    return {
      ok: false,
      outcome: "declined",
      agent_id: handoff.agent_id,
      headline: `DASH did not add “${handoff.display_name}”.`,
      detail: "Nothing was changed on this computer.",
    };
  }

  const folderCarrying = handoff.files !== undefined;
  const folderRegistration: AgentRegistration | undefined = folderCarrying
    ? {
        agent_id: handoff.agent_id,
        manifest_path: AGENT_MANIFEST_FILE,
        command: handoff.command,
        args: handoff.args,
        cwd: AGENT_CODE_DIRECTORY,
        env: handoff.env,
      }
    : undefined;

  // Folder first, SQLite index second. `importManifest` performs both in that
  // order; the live runner registration is written only after the durable
  // source and its projection agree.
  const imported = ports.importManifest(manifest, {
    files: handoff.files,
    registration: folderRegistration,
    manifestJson,
  });
  if (!imported.ok) {
    ports.log(`[dash-shell] the store refused an agent folder: ${handoff.agent_id}`);
    // MAR-595 finding 15. `existing !== null` here means this is a re-import
    // over an agent DASH already knows, which is the only shape a running
    // copy's open files can block — a first import has no folder yet to
    // collide with. The old message blamed a bad build even then, which sent
    // people rebuilding something that was never broken.
    if (imported.locked) {
      return refuse(
        ports,
        handoff,
        `DASH could not update “${handoff.display_name}” because it is running.`,
        "Stop the agent, then open it in DASH again to finish updating it.",
      );
    }
    return refuse(
      ports,
      handoff,
      `DASH could not finish copying “${handoff.display_name}”, so it was not added.`,
      "Nothing was started. Build the agent again with a current Agent Kit, then open it in DASH once more.",
    );
  }

  const storedManifest = folderCarrying
    ? agentFolderManifestPath(ports.dataDir, handoff.agent_id)
    : undefined;
  const storedCwd = folderCarrying
    ? agentFolderCodePath(ports.dataDir, handoff.agent_id)
    : handoff.project_dir;
  const filesDigest =
    handoff.files === undefined ? undefined : agentFolderFilesDigest(handoff.files);

  const written = writeRegistration(ports.dataDir, {
    registration: {
      agent_id: handoff.agent_id,
      // Replaced by writeRegistration with DASH's own copy. Passed anyway so the
      // input is a complete registration rather than one with a hole in it.
      manifest_path: handoff.manifest_path,
      command: handoff.command,
      args: handoff.args,
      cwd: storedCwd,
      env: handoff.env,
    },
    ownership: {
      owner: "dash_handoff",
      handoff_id: handoff.handoff_id,
      source_project: handoff.project_dir,
      display_name: handoff.display_name,
      summary: handoff.summary,
      registered_at: ports.now().toISOString(),
    },
    manifestJson,
    storedManifestPath: storedManifest,
    filesDigest,
    // MAR-584. The baseline the folder detector compares against, recorded at
    // the one moment DASH is certain what it accepted: here, immediately after
    // `importManifest` wrote those exact bytes. Recomputing it later from the
    // folder would be recording whatever is there now and calling it approved.
    acceptedFiles: handoff.files === undefined ? undefined : storedFileDigests(handoff.files),
    acceptedSources: handoff.files === undefined ? undefined : acceptedSourceNames(handoff.files),
  });

  const started = await ensureRunning(handoff.agent_id, ports);
  // A folder repair is an update even when the top-level runner registration
  // was already byte-for-byte correct and therefore needed no rewrite.
  const outcome: HandoffOutcome = existing === null ? "registered" : "updated";

  ports.recordHandoff({
    handoff_id: handoff.handoff_id,
    agent: handoff.agent_id,
    outcome,
    source: handoff.project_dir,
    detail: written.outcome,
    decided_at: ports.now().toISOString(),
  });

  return {
    ok: true,
    outcome,
    agent_id: handoff.agent_id,
    headline:
      outcome === "updated"
        ? `“${handoff.display_name}” has been updated.`
        : `“${handoff.display_name}” has been added to DASH.`,
    detail: started.detail,
    running: started.running,
  };
}

/**
 * The source names in the handoff DASH is accepting, or undefined (MAR-584).
 *
 * Undefined for a project with no sources file and for one whose sources file
 * DASH cannot read as a list — two different situations that produce the same
 * answer here on purpose, because both mean *DASH has no previous list to
 * compare against later*, and the detector says exactly that rather than
 * inventing an empty one.
 */
function acceptedSourceNames(files: readonly AgentFolderFile[]): string[] | undefined {
  for (const file of files) {
    if (storedRelativePath(file.path) === STORED_SOURCES_PATH) {
      return readSourceNames(file.contents) ?? undefined;
    }
  }
  return undefined;
}

/**
 * What this handoff would change about an agent DASH already holds.
 *
 * An empty list means "the same agent, described the same way" — which is what
 * makes re-opening a handoff idempotent rather than merely repeated.
 *
 * The comparison itself is `lib/registration.ts`'s, not a second one written
 * here. `writeRegistration` uses the same function to decide whether it has
 * anything to write, and two implementations of "is this the same registration"
 * that disagreed would produce the worst possible pair of outcomes: a dialog
 * asking the user to approve a change, followed by a write that decided there
 * was nothing to change.
 *
 * `manifest_path` is deliberately not part of that comparison. The handoff
 * carries the author's path and the stored registration carries DASH's copy of
 * it, so comparing the two would report a change on every single handoff and no
 * agent would ever be recognised as already added. The manifest's **content** is
 * compared instead, through its digest — which is what anybody actually means by
 * "the plan changed".
 */
function changesFrom(
  existing: ManagedRegistration,
  handoff: AgentHandoff,
  manifestJson: string,
  dataDir: string,
): string[] {
  const filesDigest =
    handoff.files === undefined ? undefined : agentFolderFilesDigest(handoff.files);
  return describeRegistrationChange(existing, {
    ...existing,
    command: handoff.command,
    args: handoff.args,
    cwd:
      handoff.files === undefined
        ? handoff.project_dir
        : agentFolderCodePath(dataDir, handoff.agent_id),
    env: handoff.env,
    dash: {
      ...existing.dash,
      manifest_sha256: manifestDigest(manifestJson),
      files_sha256: filesDigest,
    },
  });
}

/**
 * Make sure the agent is registered *and* running, or say why it is not.
 *
 * The reload is what turns a file DASH just wrote into an agent the runner
 * supervises. Without it, "Open in DASH" would end with a registration nobody
 * had read and a user waiting for a state that would arrive at the next restart.
 */
async function ensureRunning(
  agentId: string,
  ports: HandoffPorts,
): Promise<{ running: boolean; detail?: string }> {
  if (ports.runner === null) {
    return {
      running: false,
      detail:
        "DASH could not start it, because agents cannot be hosted on this computer. It is saved, and DASH will start it when hosting works.",
    };
  }

  const reloaded = await ports.runner.reload();
  if (!reloaded.ok) {
    return {
      running: false,
      detail: "It is saved, but DASH could not reach the part of itself that runs agents.",
    };
  }

  const started = await ports.runner.start(agentId);
  if (!started.ok) {
    return {
      running: false,
      detail: `It is saved, but it did not start. ${started.detail ?? ""}`.trim(),
    };
  }
  return { running: true, detail: "It is running now, and it keeps running when you close DASH." };
}

/* ---------------------------------------------------------------------- *
 * The words
 * ---------------------------------------------------------------------- */

/**
 * The consent prompt for an agent DASH has never seen.
 *
 * Everything here is either the agent author's own plain-language text or a
 * fact the user can check against their own screen. No `manifest_path`, no
 * component ids, no environment variable names, no provider scopes — asserted
 * in `tests/handoff-flow.test.ts`, because a rule about copy that nothing checks
 * is a rule that lasts until the next hurried edit.
 */
export function describeNewAgent(handoff: AgentHandoff, manifest: AnyAgentManifest): HandoffPrompt {
  return {
    title: "Add this agent?",
    message: `Add “${handoff.display_name}” to DASH and start it?`,
    detail: [
      handoff.summary,
      "",
      `Its files come from the folder you just created: ${handoff.project_dir}`,
      ...(handoff.files === undefined
        ? []
        : [
            "DASH is about to take a copy of these files. Changing the originals later will not change the copy DASH runs.",
          ]),
      startSentence(handoff),
      connectionSentence(manifest),
      ...permissionLines(manifest),
      "It keeps running when you close DASH, and you can stop or remove it at any time.",
    ].join("\n"),
    confirm_label: "Add and start",
    cancel_label: "Not now",
  };
}

/** The consent prompt for an agent that already exists and has changed. */
export function describeChangedAgent(handoff: AgentHandoff, changes: string[]): HandoffPrompt {
  return {
    title: "Update this agent?",
    message: `“${handoff.display_name}” is already in DASH. Update it?`,
    detail: [
      `Since you added it, ${joinPlainly(changes)}.`,
      "",
      `Its files come from: ${handoff.project_dir}`,
      ...(handoff.files === undefined
        ? []
        : [
            "DASH is about to take a copy of these files. Changing the originals later will not change the copy DASH runs.",
          ]),
      startSentence(handoff),
      ...(handoff.files === undefined
        ? ["Updating replaces what DASH knows about this agent. Nothing in your project folder is changed."]
        : ["Updating replaces DASH's copy of this agent. Nothing in your original project folder is changed."]),
    ].join("\n"),
    confirm_label: "Update",
    cancel_label: "Keep what I have",
  };
}

/**
 * What DASH will run, said in a way that stays true for both interpreters.
 *
 * The command a handoff carries is normally a program name — `node` — and
 * naming it is right: a dialog that asks permission to execute something while
 * declining to say what would be worse than the jargon it was avoiding.
 *
 * `BUNDLED_NODE_COMMAND` is the exception, because it is not a program on this
 * machine and printing it would put DASH's own vocabulary in front of the person
 * least able to read it. The script and its arguments are still named — that is
 * the part the user is actually approving — and the interpreter is described
 * rather than spelled. The clause about installing nothing is there because for
 * this reader it is the single most reassuring fact available.
 *
 * Exported, with `connectionSentence` and `permissionLines` below, because
 * MAR-598 added a third door onto this same import — a folder the person chose
 * — and a consent dialog that described the same agent in slightly different
 * words depending on how it arrived is exactly the drift `describeRegistrationChange`
 * is shared to prevent one layer down. It takes a program rather than a handoff
 * so the other door can pass the registration it is about to write.
 */
export function startSentence(program: { command: string; args: readonly string[] }): string {
  if (program.command !== BUNDLED_NODE_COMMAND) {
    return `DASH will start it by running: ${[program.command, ...program.args].join(" ")}`;
  }
  return (
    `DASH will start it by running: ${program.args.join(" ")} — ` +
    "using the copy of Node that comes with DASH, so you do not need to install anything."
  );
}

/**
 * What this agent will ask to connect to, named the way its author named it.
 *
 * Labels, never scopes. `agent.manifest.v2.schema.json` keeps provider scopes
 * under `fields[].technical.provider_scopes` precisely so the plain label can be
 * shown on its own, and this is the call site that depends on it.
 */
export function connectionSentence(manifest: AnyAgentManifest): string {
  if (!isManifestV2(manifest)) {
    return "";
  }
  const connections = manifest.agent_dom.connections ?? [];
  const optionalIds = optionalConnectionIds(manifest);
  const labelOf = (connection: { id?: unknown; label?: unknown }): string | null =>
    typeof connection.label === "string" && connection.label.length > 0 ? connection.label : null;

  const needed: string[] = [];
  const extra: string[] = [];
  for (const connection of connections) {
    const label = labelOf(connection);
    if (label === null) {
      continue;
    }
    (typeof connection.id === "string" && optionalIds.has(connection.id) ? extra : needed).push(
      label,
    );
  }

  if (needed.length === 0 && extra.length === 0) {
    return "It needs no accounts and no passwords.";
  }
  if (needed.length === 0) {
    /*
     * MAR-619. The sample agent's own case, and the reason this branch exists.
     *
     * Declaring the scout's model provider made the old sentence — *"Later, it
     * will ask you to connect"* — the whole of what a first-time user read on
     * the consent dialog, which is true and is the wrong emphasis: the sample
     * still runs, still fetches, and still writes a digest with nothing
     * connected at all. Leading with what it does *not* need keeps the
     * reassurance MAR-457 put in that dialog, and the offer follows it.
     *
     * "If you want to" and not "you will need to", because `optional` on the
     * requirement is the author saying this agent runs degraded — and a dialog
     * that reported an optional connection as a coming demand would be DASH
     * overstating somebody else's manifest.
     */
    return (
      `It needs no accounts and no passwords to run. If you want to, you can later connect: ` +
      `${joinPlainly(extra)} — it works without it, and nothing is connected by adding it.`
    );
  }
  const first = `Later, it will ask you to connect: ${joinPlainly(needed)}. Nothing is connected by adding it.`;
  return extra.length === 0
    ? first
    : `${first} It can also use ${joinPlainly(extra)}, and works without it.`;
}

/**
 * Which of this manifest's connections its own author called optional
 * (MAR-619).
 *
 * Read from `agent_dom.connection_requirements`, which is the only block that
 * carries `optional` — the inventory in `agent_dom.connections` describes what
 * a connection *is* and has never said whether the agent needs it.
 *
 * **Absent means required**, which is the conservative reading and the only
 * safe one: every agent exported before MAR-569 declares no requirements at
 * all, and treating that silence as "all optional" would turn a consent dialog
 * for an agent that genuinely cannot work without Gmail into a shrug. A person
 * told they need something they do not is inconvenienced; a person told they
 * do not need something they do is misled about what they just added.
 */
function optionalConnectionIds(manifest: AnyAgentManifest): ReadonlySet<string> {
  const resolved = resolveConnectionRequirements(manifest);
  if (resolved.kind !== "v1") {
    return new Set();
  }
  return new Set(
    resolved.requirements
      .filter((requirement) => requirement.optional === true)
      .map((requirement) => requirement.connection_id),
  );
}

/**
 * What the agent says it will do that needs no account (MAR-457).
 *
 * Attributed, deliberately: *"It says it will"*, not *"it will"* and certainly
 * not *"DASH will only let it"*. The runner strips the environment but spawns an
 * ordinary process with ordinary network access, so this block is a declaration
 * DASH renders and not a boundary DASH enforces. ADR 0002 is explicit that a
 * contract claim must not be dressed as a technical firewall, and the consent
 * dialog is the exact place that lie would be most costly — it is where the user
 * decides whether to trust the thing.
 *
 * Labels, never ids. The schema keeps the registry's `id` beside the readable
 * `label` precisely so a guided surface can show one and not the other.
 *
 * Empty for an agent that declares nothing, rather than "it declares nothing":
 * silence is honest, and a manifest with no permissions block has not promised
 * anything DASH should paraphrase.
 */
export function permissionLines(manifest: AnyAgentManifest): string[] {
  if (!isManifestV2(manifest)) {
    return [];
  }
  const permissions = manifest.agent_dom.permissions;
  const labels = [
    ...(permissions?.read ?? []),
    ...(permissions?.write ?? []),
  ]
    .map((grant) => grant.label)
    .filter((label): label is string => typeof label === "string" && label.length > 0);

  if (labels.length === 0) {
    return [];
  }
  // One per line rather than a joined sentence: this is a list the user is meant
  // to read down and weigh, and three capabilities in one clause is a sentence
  // people skip.
  return ["", "It says this is what it will do:", ...labels.map((label) => `  ${label}`)];
}

function joinPlainly(items: readonly string[]): string {
  if (items.length === 0) {
    return "nothing";
  }
  if (items.length === 1) {
    return items[0] as string;
  }
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1] as string}`;
}

/* ---------------------------------------------------------------------- *
 * Removing
 * ---------------------------------------------------------------------- */

export interface RemovalReport extends CleanupReport {
  headline: string;
}

/**
 * Remove an agent DASH added, in the only order that is safe.
 *
 * Stop, then delete the registration, then forget it, then have the runner take
 * a fresh reading. Any other order leaves a live process whose registration no
 * longer exists — a child nobody has a record of, which is the one outcome worse
 * than failing to remove it.
 *
 * `deleteFiles` (MAR-595 finding 18) is DASH's two removal actions in one
 * function rather than two: "remove from DASH" (`false`) leaves the folder
 * `writeAgentFolder` staged under DASH's data directory exactly where it is —
 * DASH stops running the agent and forgets it, but its copy of the code, the
 * manifest and anything it wrote survives — and "remove and delete all files"
 * (`true`, the default and the only behaviour this function had before this
 * issue) also deletes that folder. Neither one ever touches the agent's
 * *original* project on the user's own disk; DASH only ever took a copy of
 * that, and nothing here or in `removeAgentFolder` has a path to it.
 */
export async function removeAgent(
  agentId: string,
  ports: HandoffPorts,
  options: { deleteFiles?: boolean } = {},
): Promise<RemovalReport> {
  const deleteFiles = options.deleteFiles ?? true;
  const existing = readRegistration(ports.dataDir, agentId);
  const displayName = existing?.dash.display_name ?? agentId;

  if (ports.runner !== null) {
    const stopped = await ports.runner.stop(agentId);
    if (!stopped.ok) {
      ports.log(`[dash-shell] could not stop ${agentId} before removing it: ${stopped.detail ?? ""}`);
      const refusal =
        `DASH could not confirm that "${displayName}" stopped, so it removed nothing. ` +
        (stopped.detail ?? "The runner did not confirm the stop.");
      return {
        ok: false,
        agent_id: agentId,
        removed: [],
        left_alone: ["everything — DASH changed nothing"],
        refusal,
        headline: refusal,
      };
    }
  }

  // A manifest-only agent (ADR 0008 slice 4) has no registration, and
  // `removeRegistration` would answer "DASH has no agent called X" about an
  // agent whose row and folder are plainly there — MAR-597's second wall,
  // found the same evening the first one fell. No registration is nothing to
  // remove at this layer, not a refusal; the store row and folder below are
  // DASH's whole picture of such an agent.
  const cleanup =
    existing === null
      ? { ok: true as const, agent_id: agentId, removed: [], left_alone: [] }
      : removeRegistration(ports.dataDir, agentId);
  if (!cleanup.ok) {
    return { ...cleanup, headline: cleanup.refusal ?? `DASH did not remove “${displayName}”.` };
  }

  const forgotten = ports.forgetAgent(agentId, { deleteFolder: deleteFiles });
  if (existing === null && !forgotten.existed) {
    // Nothing registered, nothing stored: this one really does not exist.
    const refusal = `DASH has no agent called “${displayName}”.`;
    return {
      ok: false,
      agent_id: agentId,
      removed: [],
      left_alone: [],
      refusal,
      headline: refusal,
    };
  }
  if (forgotten.existed) {
    cleanup.removed.push("DASH's record of what it is currently doing");
  }
  cleanup.left_alone.push("the history of what it did, which stays under Runs");
  if (deleteFiles) {
    cleanup.removed.push("DASH's own copy of the agent's code and what it wrote");
  } else {
    cleanup.left_alone.push(
      `DASH's own copy of the agent's code and what it wrote, at ${agentFolderPath(ports.dataDir, agentId)}`,
    );
  }

  if (ports.runner !== null) {
    await ports.runner.reload();
  }

  const headline = deleteFiles
    ? `“${displayName}” and its files have been removed from DASH.`
    : `“${displayName}” has been removed from DASH. Its files are still on this computer.`;
  return { ...cleanup, headline };
}
