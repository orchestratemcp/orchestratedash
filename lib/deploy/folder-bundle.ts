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
} from "../agent-folders";
import { validateManifest } from "../contracts";
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

export type FolderBundleProblem =
  | BundleProblem
  | "manifest_only"
  | "folder_unreadable"
  | "manifest_unreadable"
  | "registration_unreadable"
  | "runner_unreadable";

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

function unreadableFolder(): FolderBundleResult {
  return {
    ok: false,
    problem: "folder_unreadable",
    detail: "DASH could not read this agent's folder, so no bundle was made.",
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
