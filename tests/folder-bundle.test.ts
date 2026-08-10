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
import { MODEL_KEY_STAYS_HOME_REFUSAL } from "../lib/ai/model-choice";
import {
  BUNDLE_AGENT_DIRECTORY,
  BUNDLE_MODEL_DIRECTORY,
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

/**
 * The shipped example, with a model-provider connection grafted on (MAR-583).
 *
 * Built from the real example rather than written from scratch so it stays a
 * manifest the validator accepts for every other reason — the refusal under test
 * has to be the one that fired, not a schema failure wearing its name.
 */
function keyedManifest(ownership = "dash_managed"): Record<string, unknown> {
  const manifest = JSON.parse(manifestJson()) as Record<string, unknown>;
  const agentDom = manifest["agent_dom"] as Record<string, unknown>;
  agentDom["connections"] = [
    ...((agentDom["connections"] as unknown[] | undefined) ?? []),
    {
      id: "models",
      provider: "openrouter",
      label: "Your model provider",
      purpose: "Write the summary",
      ownership,
      capabilities: [{ id: "model.completion", label: "Write text", access: "write" }],
      fields: [
        {
          id: "key",
          label: "API key",
          purpose: "So DASH can reach the provider for this agent",
          kind: "secret",
          required: true,
        },
      ],
      validation_action: { id: "check", label: "Check", behavior: "test" },
    },
  ];
  return manifest;
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

  /* ------------------------------------------------------------------ *
   * MAR-583: the model choice travels, and the key does not
   * ------------------------------------------------------------------ */

  it("carries the model choice as a generated file beside the registration", async () => {
    const dataDir = freshDir("model-choice");
    const artifact = freshDir("model-artifact");
    const agentId = "model-agent";
    await buildStandaloneRunner({ repoRoot, outDir: artifact });
    writeAgentFolder({
      dataDir,
      agent: agentId,
      manifestJson: manifestJson(),
      registration: registration(agentId),
      files: [{ path: "agent.mjs", contents: "setInterval(() => {}, 1000);\n" }],
    });

    const choice = {
      agent_id: agentId,
      choice: "one_model" as const,
      provider_id: "openrouter",
      model_id: "anthropic/claude-sonnet-5",
      steps: [{ step: 3, level: "frontier" as const }],
    };
    const produced = produceAgentFolderBundle({
      data_dir: dataDir,
      agent_id: agentId,
      bundle_id: agentId,
      runner_artifact_dir: artifact,
      models: choice,
    });
    expect(produced.ok).toBe(true);
    if (!produced.ok) return;

    const name = `${BUNDLE_MODEL_DIRECTORY}/${agentId}.json`;
    expect(produced.request.files.map((file) => file.path)).toContain(name);
    expect(JSON.parse(requestFile(produced.request, name).toString("utf8"))).toEqual(choice);

    /*
     * Under `data/` and never under `agent/`. ADR 0008 makes `agent/` the
     * author's folder byte-for-byte, and MAR-584 compares what DASH sent against
     * what DASH holds by hashing exactly those paths — so a DASH-generated file
     * inside it would make every agent read as changed the moment somebody
     * picked a model.
     */
    expect(produced.request.files.map((file) => file.path)).not.toContain(
      `${BUNDLE_AGENT_DIRECTORY}/${agentId}.json`,
    );
  }, 60_000);

  it("sends no model file when there is no setting to send", async () => {
    const dataDir = freshDir("no-model");
    const artifact = freshDir("no-model-artifact");
    const agentId = "plain-agent";
    await buildStandaloneRunner({ repoRoot, outDir: artifact });
    writeAgentFolder({
      dataDir,
      agent: agentId,
      manifestJson: manifestJson(),
      registration: registration(agentId),
      files: [{ path: "agent.mjs", contents: "setInterval(() => {}, 1000);\n" }],
    });

    const produced = produceAgentFolderBundle({
      data_dir: dataDir,
      agent_id: agentId,
      bundle_id: agentId,
      runner_artifact_dir: artifact,
    });
    expect(produced.ok).toBe(true);
    if (!produced.ok) return;
    // An absence, not a document saying "the default". The two are different
    // facts — see `ProduceFolderBundleOptions.models`.
    expect(
      produced.request.files.some((file) => file.path.startsWith(BUNDLE_MODEL_DIRECTORY)),
    ).toBe(false);
  }, 60_000);

  it("refuses when the plan needs a model whose key DASH keeps in this computer's vault", () => {
    /*
     * The refusal is the whole point of making the choice travel: a setting that
     * arrives somewhere it cannot be honoured is worse than no setting. DASH does
     * not send keys to servers, so an agent that asks DASH to hold its model key
     * would land there with a model named and nothing to reach it with.
     *
     * Decided before a runner byte is read, like the manifest-only refusal above
     * and for the same reason: there is no half-bundle to accidentally send.
     */
    const dataDir = freshDir("dash-held-key");
    const agentId = "keyed-agent";
    writeAgentFolder({
      dataDir,
      agent: agentId,
      manifestJson: JSON.stringify(keyedManifest()),
      registration: registration(agentId),
      files: [{ path: "agent.mjs", contents: "setInterval(() => {}, 1000);\n" }],
    });

    const produced = produceAgentFolderBundle({
      data_dir: dataDir,
      agent_id: agentId,
      bundle_id: agentId,
      runner_artifact_dir: path.join(dataDir, "not-a-runner"),
    });
    expect(produced).toEqual({
      // MAR-591 renamed the code when the model key stopped being the only
      // credential that cannot travel. The **sentence** is unchanged and still
      // asserted by value here, which is the half MAR-583's proof was about.
      ok: false,
      problem: "credential_stays_home",
      detail: MODEL_KEY_STAYS_HOME_REFUSAL,
    });
  });

  it("does not refuse an agent that brings its own model key", async () => {
    // It reaches a provider by arrangements DASH has no part in, wherever it
    // runs, and DASH has no standing to stop it.
    const dataDir = freshDir("agent-held-key");
    const artifact = freshDir("agent-held-artifact");
    const agentId = "own-key-agent";
    await buildStandaloneRunner({ repoRoot, outDir: artifact });
    writeAgentFolder({
      dataDir,
      agent: agentId,
      manifestJson: JSON.stringify(keyedManifest("agent_managed")),
      registration: registration(agentId),
      files: [{ path: "agent.mjs", contents: "setInterval(() => {}, 1000);\n" }],
    });

    const produced = produceAgentFolderBundle({
      data_dir: dataDir,
      agent_id: agentId,
      bundle_id: agentId,
      runner_artifact_dir: artifact,
    });
    expect(produced.ok).toBe(true);
  }, 60_000);

  it("does not refuse an agent whose plan needs no model at all", async () => {
    const dataDir = freshDir("no-model-needed");
    const artifact = freshDir("no-model-needed-artifact");
    const agentId = "fixed-agent";
    await buildStandaloneRunner({ repoRoot, outDir: artifact });
    const manifest = keyedManifest();
    // Every step deterministic, with the model connection still declared.
    manifest["planned_route"] = [
      { step: 1, component_id: "public_feed_fetch", risk_level: "low", model_tier: "none" },
    ];
    writeAgentFolder({
      dataDir,
      agent: agentId,
      manifestJson: JSON.stringify(manifest),
      registration: registration(agentId),
      files: [{ path: "agent.mjs", contents: "setInterval(() => {}, 1000);\n" }],
    });

    const produced = produceAgentFolderBundle({
      data_dir: dataDir,
      agent_id: agentId,
      bundle_id: agentId,
      runner_artifact_dir: artifact,
    });
    expect(produced.ok).toBe(true);
  }, 60_000);

  it("refuses any connection the agent's own file says it needs, not only a model key", async () => {
    /*
     * MAR-591. The general case MAR-583 named and deliberately did not fix.
     *
     * The example manifest's Gmail is `dash_managed` and MAR-569's block is
     * added declaring it required, so DASH's own document says every run needs
     * something DASH will not send. The sentence is the general one — MAR-583's
     * is reserved for the model key alone, and a test above pins it by value.
     */
    const dataDir = freshDir("needed-connection");
    const artifact = freshDir("needed-connection-artifact");
    const agentId = "gmail-agent";
    await buildStandaloneRunner({ repoRoot, outDir: artifact });
    const manifest = JSON.parse(manifestJson()) as Record<string, unknown>;
    const agentDom = manifest["agent_dom"] as Record<string, unknown>;
    agentDom["connection_requirements"] = {
      requirements_version: 1,
      requirements: [
        {
          id: "gmail_access",
          name: "Your Gmail",
          connector_kind: "google_oauth_broker",
          connection_id: "gmail",
        },
      ],
    };
    writeAgentFolder({
      dataDir,
      agent: agentId,
      manifestJson: JSON.stringify(manifest),
      registration: registration(agentId),
      files: [{ path: "agent.mjs", contents: "setInterval(() => {}, 1000);\n" }],
    });

    const produced = produceAgentFolderBundle({
      data_dir: dataDir,
      agent_id: agentId,
      bundle_id: agentId,
      runner_artifact_dir: artifact,
    });
    expect(produced.ok).toBe(false);
    if (produced.ok) return;
    expect(produced.problem).toBe("credential_stays_home");
    expect(produced.detail).toContain("Gmail");
    expect(produced.detail).toContain("Nothing was sent.");
    expect(produced.detail).not.toBe(MODEL_KEY_STAYS_HOME_REFUSAL);
  }, 60_000);

  it("still sends an agent whose file never says a run needs what stays here", async () => {
    /*
     * The other half of MAR-591's rule, and the one a safety-minded reading gets
     * wrong. The shipped example has two `dash_managed` sign-ins and no
     * requirements block, so DASH does not know whether a run needs them — and
     * refusing on that would refuse every agent of this shape that exists. The
     * panel warns; the producer sends.
     */
    const dataDir = freshDir("undeclared-connection");
    const artifact = freshDir("undeclared-connection-artifact");
    const agentId = "undeclared-agent";
    await buildStandaloneRunner({ repoRoot, outDir: artifact });
    writeAgentFolder({
      dataDir,
      agent: agentId,
      manifestJson: manifestJson(),
      registration: registration(agentId),
      files: [{ path: "agent.mjs", contents: "setInterval(() => {}, 1000);\n" }],
    });

    const produced = produceAgentFolderBundle({
      data_dir: dataDir,
      agent_id: agentId,
      bundle_id: agentId,
      runner_artifact_dir: artifact,
    });
    expect(produced.ok).toBe(true);
  }, 60_000);

  it("puts no credential in the bundle it does send", async () => {
    /*
     * The assertion the whole issue rests on, made over the bytes rather than
     * over the design. Nothing under `agent/` or `data/` may carry a vault name
     * or a delivery variable's value — MAR-591 is an honesty layer over a
     * boundary that must already hold, and a bundle that quietly carried a
     * secret would make every sentence above a lie in the safe direction.
     */
    const dataDir = freshDir("no-credential");
    const artifact = freshDir("no-credential-artifact");
    const agentId = "clean-agent";
    await buildStandaloneRunner({ repoRoot, outDir: artifact });
    writeAgentFolder({
      dataDir,
      agent: agentId,
      manifestJson: manifestJson(),
      registration: registration(agentId),
      files: [{ path: "agent.mjs", contents: "setInterval(() => {}, 1000);\n" }],
    });

    const produced = produceAgentFolderBundle({
      data_dir: dataDir,
      agent_id: agentId,
      bundle_id: agentId,
      runner_artifact_dir: artifact,
    });
    expect(produced.ok).toBe(true);
    if (!produced.ok) return;
    const generated = produced.request.files.filter((file) => file.path.startsWith("data/"));
    expect(generated.length).toBeGreaterThan(0);
    for (const file of generated) {
      expect(Buffer.from(file.content_base64, "base64").toString("utf8")).not.toContain(
        "dash.connection.",
      );
    }
  }, 60_000);

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
