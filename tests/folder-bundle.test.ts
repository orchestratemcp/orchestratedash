/**
 * The production join from an authoritative agent folder to MAR-487's bundle
 * (MAR-556, ADR 0008 slice 5).
 *
 * The last case is deliberately not a shape-only unit test. It builds
 * MAR-497's standalone artifact, gives the produced install request to
 * MAR-487's real helper, and asks the unchanged runner to start the registered
 * agent. If either relative path is one directory out, if `dash:node` is
 * rewritten, or if the registration is anywhere except `data/agents`, that
 * process never writes its marker.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import type { StdioChannel } from "../lib/agent-dom/ssh-fetch";
import { ipcFetch, IPC_ORIGIN } from "../lib/agent-dom/ipc-fetch";
import {
  MANIFEST_ONLY_DEPLOY_REFUSAL,
  writeAgentFolder,
} from "../lib/agent-folders";
import {
  BUNDLE_AGENT_DIRECTORY,
  BUNDLE_REGISTRATION_DIRECTORY,
  produceAgentFolderBundle,
} from "../lib/deploy/folder-bundle";
import type { DeployAnswer, DeployRequest } from "../lib/deploy/verbs";
import { BUNDLED_NODE_COMMAND, type AgentRegistration } from "../lib/registration";
import { runDeployVerb, type DeploySpawn } from "../electron/ssh-host";
import { buildStandaloneRunner } from "../scripts/build-runner-standalone.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directories: string[] = [];

function freshDir(label: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), `dash-folder-bundle-${label}-`));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    // A just-closed Windows named pipe can hold its directory for one event
    // loop turn after the runner exits. Retry deletion; never signal a process.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        rmSync(directory, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }
});

function manifestJson(): string {
  return readFileSync(
    path.join(repoRoot, "examples", "gmail-meeting-assistant.manifest.v2.example.json"),
    "utf8",
  );
}

function registration(agentId: string): AgentRegistration {
  return {
    agent_id: agentId,
    manifest_path: "agent.manifest.json",
    command: BUNDLED_NODE_COMMAND,
    args: ["agent.mjs", "kept-argument"],
    cwd: "code",
    env: { FOLDER_BUNDLE_VALUE: "kept-environment" },
  };
}

function requestFile(request: Extract<DeployRequest, { verb: "install" }>, name: string): Buffer {
  const file = request.files.find((candidate) => candidate.path === name);
  if (file === undefined) {
    throw new Error(`bundle did not contain ${name}`);
  }
  return Buffer.from(file.content_base64, "base64");
}

function localHelper(helper: string, hostRoot: string): DeploySpawn {
  return (verb, bundleId): StdioChannel => {
    const child = spawn(process.execPath, [helper, verb, ...(bundleId === undefined ? [] : [bundleId])], {
      stdio: ["pipe", "pipe", "inherit"],
      env: { ...process.env, DASH_HOST_ROOT: hostRoot },
    });
    return {
      stdin: child.stdin,
      stdout: child.stdout,
      close: () => {
        child.stdin.end();
        if (child.exitCode === null) {
          child.kill();
        }
      },
    };
  };
}

async function waitForFile(file: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(file) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!existsSync(file)) {
    throw new Error(`timed out waiting for ${path.basename(file)}`);
  }
}

async function waitForLog(file: string, line: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const log = existsSync(file) ? readFileSync(file, "utf8") : "";
    if (log.includes(line)) return;
    if (log.includes("[runner] failed to start:")) {
      throw new Error(log);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${line}`);
}

describe("the folder bundle producer", () => {
  it("puts the standalone runner, authoritative folder and generated registration in one bundle", async () => {
    const dataDir = freshDir("data");
    const artifact = freshDir("artifact");
    const agentId = "folder-agent";
    const original = registration(agentId);
    await buildStandaloneRunner({ repoRoot, outDir: artifact });
    writeAgentFolder({
      dataDir,
      agent: agentId,
      manifestJson: manifestJson(),
      registration: original,
      files: [
        { path: "agent.mjs", contents: "setInterval(() => {}, 1000);\n" },
        { path: "assets/fixture.txt", contents: "asset bytes\n" },
      ],
    });

    const produced = produceAgentFolderBundle({
      data_dir: dataDir,
      agent_id: agentId,
      bundle_id: agentId,
      runner_artifact_dir: artifact,
    });
    expect(produced.ok).toBe(true);
    if (!produced.ok) return;

    const names = produced.request.files.map((file) => file.path);
    expect(names).toContain("start.mjs");
    expect(names).toContain("runner.mjs");
    expect(names).toContain("contracts/agent-command.schema.json");
    expect(names).toContain(`${BUNDLE_AGENT_DIRECTORY}/agent.manifest.json`);
    expect(names).toContain(`${BUNDLE_AGENT_DIRECTORY}/registration.json`);
    expect(names).toContain(`${BUNDLE_AGENT_DIRECTORY}/code/agent.mjs`);
    expect(names).toContain(`${BUNDLE_AGENT_DIRECTORY}/assets/fixture.txt`);

    const generatedName = `${BUNDLE_REGISTRATION_DIRECTORY}/${agentId}.json`;
    expect(names).toContain(generatedName);
    const generated = JSON.parse(requestFile(produced.request, generatedName).toString("utf8")) as AgentRegistration;
    expect(generated).toEqual({
      ...original,
      manifest_path: "../../agent/agent.manifest.json",
      cwd: "../../agent/code",
    });
    expect(generated.command).toBe(BUNDLED_NODE_COMMAND);
    expect(produced.request.runner_build).toBe(produced.runner_build);
  }, 60_000);

  it("renders MAR-553's manifest-only refusal without reading or assembling a runner", () => {
    const dataDir = freshDir("manifest-only");
    const agentId = "manifest-only-agent";
    writeAgentFolder({ dataDir, agent: agentId, manifestJson: manifestJson() });

    const produced = produceAgentFolderBundle({
      data_dir: dataDir,
      agent_id: agentId,
      bundle_id: agentId,
      // Deliberately absent. Standing is decided before a runner byte is read.
      runner_artifact_dir: path.join(dataDir, "not-a-runner"),
    });
    expect(produced).toEqual({
      ok: false,
      problem: "manifest_only",
      detail: MANIFEST_ONLY_DEPLOY_REFUSAL,
    });
  });

  it("is consumed by MAR-497's unchanged standalone runner and starts the folder's agent", async () => {
    const dataDir = freshDir("data");
    const artifact = freshDir("artifact");
    const hostRoot = freshDir("host");
    const agentId = "equivalence-agent";
    await buildStandaloneRunner({ repoRoot, outDir: artifact });
    writeAgentFolder({
      dataDir,
      agent: agentId,
      manifestJson: manifestJson(),
      registration: registration(agentId),
      files: [
        {
          path: "agent.mjs",
          contents: [
            "import { writeFileSync } from 'node:fs';",
            "import path from 'node:path';",
            "writeFileSync(path.join(process.cwd(), 'started.txt'), `${process.execPath}\\n${process.cwd()}\\n${process.env.FOLDER_BUNDLE_VALUE}\\n`, 'utf8');",
            "setInterval(() => {}, 1000);",
          ].join("\n"),
        },
      ],
    });

    const produced = produceAgentFolderBundle({
      data_dir: dataDir,
      agent_id: agentId,
      bundle_id: agentId,
      runner_artifact_dir: artifact,
    });
    if (!produced.ok) throw new Error(produced.detail);

    const send = async (request: DeployRequest): Promise<DeployAnswer> =>
      await runDeployVerb(localHelper(path.join(artifact, "host-helper.mjs"), hostRoot), request);
    const installed = await send(produced.request);
    expect(installed).toMatchObject({ ok: true, verb: "install", bundle_id: agentId });

    const bundleDir = path.join(hostRoot, "bundles", agentId);
    const liveRegistration = path.join(bundleDir, "data", "agents", `${agentId}.json`);
    expect(existsSync(path.join(bundleDir, "contracts", "agent-command.schema.json"))).toBe(true);
    expect(JSON.parse(readFileSync(liveRegistration, "utf8"))).toEqual({
      ...registration(agentId),
      manifest_path: "../../agent/agent.manifest.json",
      cwd: "../../agent/code",
    });

    const started = await send({ verb: "start", bundle_id: agentId });
    expect(started).toMatchObject({ ok: true, verb: "start", bundle_id: agentId });
    const runnerData = path.join(bundleDir, "data");
    let runnerStopped: DeployAnswer | null = null;
    try {
      // The session key is published before registrations are loaded. The log
      // line is the later event that proves the unchanged runner consumed the
      // generated file and is ready to answer.
      await waitForLog(path.join(bundleDir, "runner.log"), "[runner] supervising 1 registered agent(s)");
      await waitForFile(path.join(runnerData, "runner.session.key"));
      const endpoint = (JSON.parse(readFileSync(path.join(runnerData, "runner.json"), "utf8")) as { endpoint: string }).endpoint;
      const token = readFileSync(path.join(runnerData, "runner.session.key"), "utf8").trim();
      const call = ipcFetch(endpoint);

      const listed = await call(`${IPC_ORIGIN}/agents`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(listed.status).toBe(200);
      const listedBody = (await listed.json()) as { agents: Array<{ agent_id: string }> };
      expect(listedBody.agents.map((agent) => agent.agent_id)).toContain(agentId);

      const lifecycle = await call(`${IPC_ORIGIN}/agents/${agentId}/lifecycle`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "start" }),
      });
      expect(lifecycle.status).toBe(200);
      expect((await lifecycle.json()) as { ok: boolean }).toMatchObject({ ok: true });

      const marker = path.join(bundleDir, "agent", "code", "started.txt");
      await waitForFile(marker);
      const [execPath, cwd, env] = readFileSync(marker, "utf8").trim().split(/\r?\n/);
      expect(execPath).toBe(process.execPath);
      expect(cwd).toBe(path.join(bundleDir, "agent", "code"));
      expect(env).toBe("kept-environment");

      const stopAgent = await call(`${IPC_ORIGIN}/agents/${agentId}/lifecycle`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "stop" }),
      });
      expect((await stopAgent.json()) as { ok: boolean }).toMatchObject({ ok: true });
    } finally {
      // The helper uses the runner's authenticated shutdown route. No signal,
      // and no force-kill fallback, even when an assertion above fails.
      runnerStopped = await send({ verb: "stop", bundle_id: agentId });
    }
    expect(runnerStopped).toMatchObject({ ok: true, verb: "stop", stopped: true });
  }, 90_000);
});
