/**
 * Turn one authoritative agent folder into the bundle MAR-487 can install
 * (ADR 0008, MAR-556).
 *
 * This is the production caller `assembleBundle` was missing. It composes
 * exactly three existing things:
 *
 * 1. the standalone runner artifact built by MAR-497;
 * 2. the four-path agent-folder layout built by MAR-553, under `agent/`; and
 * 3. one generated live registration at `data/agents/{agent_id}.json`.
 *
 * The generated registration is the join. The standalone runner already reads
 * registrations from `{DASH_RUNNER_DATA_DIR}/agents`, while the host helper
 * already sets that data directory to the installed bundle's `data/` folder.
 * Relative paths therefore make the installed layout self-contained without a
 * runner branch for deployment. `tests/folder-bundle.test.ts` executes that
 * equivalence against MAR-497's unchanged artifact.
 *
 * No deploy guard is copied here. The producer reads bytes and names their
 * fixed locations; `assembleBundle` remains the one sender-side validator and
 * the host helper remains the receiving-side validator. The only earlier
 * refusal is standing: a manifest-only folder has no program to send, and its
 * sentence belongs to MAR-553 rather than to this module.
 */

import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  MANIFEST_ONLY_DEPLOY_REFUSAL,
  agentFolderAssetsPath,
  agentFolderCodePath,
  agentFolderManifestPath,
  agentFolderRegistrationPath,
  inspectAgentFolderStanding,
  storedDigestSummary,
} from "../agent-folders";
import {
  MODEL_KEY_STAYS_HOME_REFUSAL,
  type BundledModelChoice,
} from "../ai/model-choice";
import { planNeedsAModel } from "../ai/model-levels";
import { aiProviderFor } from "../ai/providers";
import type { ManifestConnection } from "../connections";
import { validateManifest, type AnyAgentManifest } from "../contracts";
import type { AgentRegistration } from "../registration";
import {
  BUNDLE_ENTRY_POINT,
  assembleBundle,
  type BundleProblem,
  type SourceFile,
} from "./bundle";
import type { InstallRequest } from "./verbs";

export const BUNDLE_AGENT_DIRECTORY = "agent";
export const BUNDLE_REGISTRATION_DIRECTORY = "data/agents";
/**
 * Where the model choice lands (MAR-583).
 *
 * Beside the generated registration and under `data/` rather than inside
 * `agent/`, and the split is ADR 0008's: `agent/` is the author's folder,
 * byte-for-byte as DASH holds it, and `data/` is what DASH generates for this
 * particular installation. A setting a person chose in DASH is DASH's document,
 * not the author's, and writing it into `agent/` would make the folder DASH sent
 * differ from the folder DASH has — which is the comparison MAR-584 relies on.
 */
export const BUNDLE_MODEL_DIRECTORY = "data/models";

export type FolderBundleProblem =
  | BundleProblem
  | "manifest_only"
  | "folder_unreadable"
  | "manifest_unreadable"
  | "registration_unreadable"
  | "runner_unreadable"
  /** MAR-583: the plan needs a model and the key for it is not going. */
  | "model_key_stays_home";

export type FolderBundleResult =
  | {
      ok: true;
      request: InstallRequest;
      bytes: number;
      runner_build: string;
    }
  | { ok: false; problem: FolderBundleProblem; detail: string };

export interface ProduceFolderBundleOptions {
  data_dir: string;
  agent_id: string;
  bundle_id: string;
  /** Root of `dist/runner-standalone`, or its packaged sibling. */
  runner_artifact_dir: string;
  /**
   * Which model this agent is set to use (MAR-583).
   *
   * Passed in rather than read here, so this module stays what it already is: a
   * reader of one folder and a writer of two generated files, with no store
   * behind it. The caller resolves it through `readAgentModelChoice` and
   * `resolveModelSteps`, which is the one place a level is decided.
   *
   * Omitted means "this agent has no model setting to send", which is the
   * ordinary case and produces no extra file. It is not the same as a document
   * saying `match_each_step`: that one records a decision, and an absence
   * records that there was nothing to decide.
   */
  models?: BundledModelChoice;
}

/**
 * Produce one install request, or one renderable refusal. Nothing is written.
 */
export function produceAgentFolderBundle(
  options: ProduceFolderBundleOptions,
): FolderBundleResult {
  let standing: ReturnType<typeof inspectAgentFolderStanding>;
  try {
    standing = inspectAgentFolderStanding(options.data_dir, options.agent_id);
  } catch {
    return unreadableFolder();
  }

  // First, deliberately. A migrated folder with no acquired build refuses
  // even when the standalone artifact is missing or stale; assembly never
  // begins and the caller receives MAR-553's exact sentence.
  if (standing.kind === "manifest_only") {
    return {
      ok: false,
      problem: "manifest_only",
      detail: MANIFEST_ONLY_DEPLOY_REFUSAL,
    };
  }
  if (standing.kind === "unreadable") {
    return unreadableFolder();
  }

  // Use the four public paths rather than reconstructing the layout from the
  // standing's folder. These are MAR-553's consumer contract, and keeping the
  // producer on it means a layout change has one compiler-visible join.
  let manifestPath: string;
  let registrationPath: string;
  let codePath: string;
  let assetsPath: string;
  try {
    manifestPath = agentFolderManifestPath(options.data_dir, options.agent_id);
    registrationPath = agentFolderRegistrationPath(options.data_dir, options.agent_id);
    codePath = agentFolderCodePath(options.data_dir, options.agent_id);
    assetsPath = agentFolderAssetsPath(options.data_dir, options.agent_id);
  } catch {
    return unreadableFolder();
  }

  let manifestBytes: Buffer;
  let manifest: ReturnType<typeof validateManifest>;
  try {
    manifestBytes = readRegularFile(manifestPath);
    manifest = validateManifest(JSON.parse(manifestBytes.toString("utf8")) as unknown);
  } catch {
    return {
      ok: false,
      problem: "manifest_unreadable",
      detail: "DASH could not read this agent's stored manifest, so no bundle was made.",
    };
  }
  if (!manifest.ok) {
    return {
      ok: false,
      problem: "manifest_unreadable",
      detail: "This agent's stored manifest is no longer valid, so no bundle was made.",
    };
  }

  /*
   * MAR-583. The plan needs a model and the key for it is one DASH holds.
   *
   * Second only to the manifest-only refusal, and before the runner is read for
   * the same reason that one is: there is no half-bundle to accidentally send,
   * and the sentence reaches the audited command result rather than a partial
   * push somebody has to undo.
   *
   * **What it is checking, exactly.** Not whether DASH holds a key right now —
   * that is a fact about this computer's vault, and a deploy that succeeded or
   * failed depending on whether somebody had connected yet would be a rule
   * nobody could predict. It checks the *shape of the arrangement*: this agent
   * asks DASH to hold its model key, and DASH does not send keys to servers. That
   * is true whether or not a key has been typed, so the refusal is stable.
   *
   * An agent that manages its own model key is not refused. It reaches a provider
   * by arrangements DASH has no part in, wherever it runs, and DASH has no
   * standing to stop it.
   *
   * The general case — a `dash_managed` connection of any kind on an agent going
   * to a server — is wider than this issue and is **not** fixed here. It is named
   * in this repository's state packet rather than quietly half-solved: making the
   * model choice travel is what created the obligation to say something about the
   * model key, and inventing a rule for Gmail on the way past would be a decision
   * taken in the wrong issue.
   */
  if (dashHeldModelKey(manifest.value)) {
    return {
      ok: false,
      problem: "model_key_stays_home",
      detail: MODEL_KEY_STAYS_HOME_REFUSAL,
    };
  }

  let registrationBytes: Buffer;
  let registration: AgentRegistration;
  try {
    registrationBytes = readRegularFile(registrationPath);
    registration = readFolderRegistration(registrationBytes);
  } catch {
    return {
      ok: false,
      problem: "registration_unreadable",
      detail: "DASH could not read this agent's stored registration, so no bundle was made.",
    };
  }
  if (registration.agent_id !== options.agent_id) {
    return {
      ok: false,
      problem: "registration_unreadable",
      detail: "This agent's folder and registration name different agents, so no bundle was made.",
    };
  }

  let runnerBuild: string;
  let runnerFiles: SourceFile[];
  try {
    runnerBuild = readRunnerBuild(options.runner_artifact_dir);
    runnerFiles = readTree(options.runner_artifact_dir, "");
  } catch {
    return {
      ok: false,
      problem: "runner_unreadable",
      detail: "DASH could not read the runner artifact it would put on the server. Nothing was sent.",
    };
  }

  let folderFiles: SourceFile[];
  try {
    folderFiles = [
      sourceFile(`${BUNDLE_AGENT_DIRECTORY}/agent.manifest.json`, manifestBytes),
      sourceFile(`${BUNDLE_AGENT_DIRECTORY}/registration.json`, registrationBytes),
      ...readTree(codePath, `${BUNDLE_AGENT_DIRECTORY}/code`),
      ...(existsSync(assetsPath)
        ? readTree(assetsPath, `${BUNDLE_AGENT_DIRECTORY}/assets`)
        : []),
      sourceFile(
        `${BUNDLE_REGISTRATION_DIRECTORY}/${options.agent_id}.json`,
        Buffer.from(
          `${JSON.stringify(bundleRegistration(registration), null, 2)}\n`,
          "utf8",
        ),
      ),
      // MAR-583. The second generated file, and the only one whose contents came
      // from a person rather than from the folder. No file at all when there is
      // no setting to send — see `ProduceFolderBundleOptions.models`.
      ...(options.models === undefined
        ? []
        : [
            sourceFile(
              `${BUNDLE_MODEL_DIRECTORY}/${options.agent_id}.json`,
              Buffer.from(`${JSON.stringify(options.models, null, 2)}\n`, "utf8"),
            ),
          ]),
    ];
  } catch {
    return {
      ok: false,
      problem: "folder_unreadable",
      detail: "DASH could not read this agent's folder, so no bundle was made.",
    };
  }

  const files = [...runnerFiles, ...folderFiles];

  // The SourceFile[] above is handed over unchanged. Hashing, the size ceiling,
  // the manifest constraint, modes and bundle-path rules remain assembleBundle's.
  const assembled = assembleBundle({
    bundle_id: options.bundle_id,
    agent_id: options.agent_id,
    runner_build: runnerBuild,
    manifest: manifest.value,
    files,
  });
  return assembled.ok ? { ...assembled, runner_build: runnerBuild } : assembled;
}

/**
 * Whether this agent asks DASH to hold a key for a model provider (MAR-583).
 *
 * Two conditions and both are read off the manifest alone: the plan has a step
 * above `model_tier: "none"`, and at least one `dash_managed` connection names a
 * provider `lib/ai/providers.ts` knows. The second is what makes it a *model*
 * key rather than any credential — a `dash_managed` ledger secret is somebody
 * else's problem and not this refusal's.
 *
 * `planNeedsAModel` and not `stepsNeedingAModel`, deliberately. An agent
 * exported before MAR-583's emitter declares no levels at all and still needs a
 * model; refusing only the agents whose steps say so would let exactly the older
 * agents through, which is the wrong way round for a safety refusal.
 */
function dashHeldModelKey(manifest: AnyAgentManifest): boolean {
  if (!planNeedsAModel(manifest.planned_route)) {
    return false;
  }
  const connections = (manifest as { agent_dom?: { connections?: ManifestConnection[] } }).agent_dom
    ?.connections;
  return (connections ?? []).some(
    (connection) =>
      connection.ownership === "dash_managed" && aiProviderFor(connection.provider) !== null,
  );
}

function unreadableFolder(): FolderBundleResult {
  return {
    ok: false,
    problem: "folder_unreadable",
    detail: "DASH could not read this agent's folder, so no bundle was made.",
  };
}

/**
 * What went across, as two digests DASH can compare against later (MAR-584,
 * ADR 0010).
 *
 * Derived from the install request rather than re-read from the folder, and the
 * difference is the whole point of computing it here. A second read could see
 * different bytes — an editor is, by hypothesis, capable of changing this folder
 * at any moment — and the record would then describe a push that did not happen.
 * These are the digests of the files that were in the request, computed by
 * `assembleBundle` over the bytes it encoded.
 *
 * ## `tracked` is what makes the program digest mean anything
 *
 * A bundle carries the whole of `code/`, and for the sample agent that includes
 * `code/reports/` and `code/runs/` — everything it has ever produced. A digest
 * over all of it would differ on every single push, so "the server has an older
 * copy" would be true the moment the agent ran once, which is not a fact about
 * the agent's program at all.
 *
 * So the caller passes the stored paths DASH recorded as this agent's program
 * (`accepted_files`), and only those are hashed, through the same
 * `storedDigestSummary` the baseline itself reduces through. That is what makes
 * the two comparable: same paths, same function, two moments. The runner is
 * excluded by the same rule — DASH replaces it on every push, and it is not in
 * any agent's baseline.
 *
 * Null when nothing was tracked, which is every agent registered before MAR-584
 * kept a baseline. Null means *not comparable* to every reader of the record,
 * and the surface says it cannot tell rather than guessing either way.
 */
export function describeBundleContents(
  request: InstallRequest,
  tracked: readonly string[],
): { manifest_sha256: string; files_sha256: string | null } {
  const prefix = `${BUNDLE_AGENT_DIRECTORY}/`;
  const wanted = new Set(tracked);
  const manifest = request.files.find(
    (file) => file.path === `${prefix}agent.manifest.json`,
  );

  const program = request.files
    .filter((file) => file.path.startsWith(prefix))
    .map((file) => ({ path: file.path.slice(prefix.length), sha256: file.sha256 }))
    .filter((file) => wanted.has(file.path));

  return {
    manifest_sha256: manifest?.sha256 ?? "",
    files_sha256: storedDigestSummary(program),
  };
}

/**
 * Paths are relative to the generated registration file in `data/agents/`.
 * The original `command`, arguments and environment are carried byte-for-value;
 * in particular `dash:node` stays `dash:node`, so MAR-497 resolves it against
 * the host's own Node rather than a path from this computer.
 */
function bundleRegistration(registration: AgentRegistration): AgentRegistration {
  return {
    ...registration,
    manifest_path: path.posix.relative(
      BUNDLE_REGISTRATION_DIRECTORY,
      `${BUNDLE_AGENT_DIRECTORY}/agent.manifest.json`,
    ),
    cwd: path.posix.relative(
      BUNDLE_REGISTRATION_DIRECTORY,
      `${BUNDLE_AGENT_DIRECTORY}/code`,
    ),
  };
}

function readFolderRegistration(bytes: Buffer): AgentRegistration {
  const parsed = JSON.parse(bytes.toString("utf8")) as Partial<AgentRegistration>;
  if (
    typeof parsed.agent_id !== "string" ||
    parsed.agent_id.length === 0 ||
    typeof parsed.manifest_path !== "string" ||
    parsed.manifest_path.length === 0 ||
    typeof parsed.command !== "string" ||
    parsed.command.length === 0 ||
    !Array.isArray(parsed.args) ||
    !parsed.args.every((item) => typeof item === "string") ||
    (parsed.cwd !== undefined && typeof parsed.cwd !== "string") ||
    (parsed.env !== undefined &&
      (typeof parsed.env !== "object" ||
        parsed.env === null ||
        Array.isArray(parsed.env) ||
        !Object.values(parsed.env).every((item) => typeof item === "string")))
  ) {
    throw new Error("invalid registration");
  }
  return parsed as AgentRegistration;
}

function readRunnerBuild(directory: string): string {
  const parsed = JSON.parse(readRegularFile(path.join(directory, "package.json")).toString("utf8")) as {
    dash?: { runner_build?: unknown };
  };
  const build = parsed.dash?.runner_build;
  if (typeof build !== "string" || build.length === 0) {
    throw new Error("runner build is missing");
  }
  return build;
}

function readRegularFile(file: string): Buffer {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("not a regular file");
  }
  return readFileSync(file);
}

function readTree(directory: string, prefix: string): SourceFile[] {
  const root = lstatSync(directory);
  if (!root.isDirectory() || root.isSymbolicLink()) {
    throw new Error("not a regular directory");
  }

  const found: SourceFile[] = [];
  const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    const bundlePath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...readTree(file, bundlePath));
      continue;
    }
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error("the tree contains a non-file entry");
    }
    found.push(sourceFile(bundlePath, readFileSync(file)));
  }
  return found;
}

function sourceFile(bundlePath: string, content: Buffer): SourceFile {
  return {
    path: bundlePath.replaceAll("\\", "/"),
    content,
    executable: bundlePath === BUNDLE_ENTRY_POINT,
  };
}
