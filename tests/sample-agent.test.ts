/**
 * The sample agent, and the interpreter it does not make anyone install
 * (MAR-423).
 *
 * The acceptance criterion is that *"someone who has never seen DASH reaches a
 * completed sample run without assistance and without opening a terminal"*. Two
 * separable claims live in here:
 *
 * - **It is the same path.** The sample produces a real handoff that goes
 *   through the real `openHandoff`, so it cannot skip the consent, the nonce or
 *   the ledger. That is asserted end to end rather than by reading the code,
 *   because a second registration path is exactly the kind of thing that gets
 *   added later "just for the sample".
 * - **It runs on a machine with no Node.** The sentinel is resolved at spawn
 *   time and never written down, so an MSIX update — which moves the install
 *   root, measured in `docs/msix-lifecycle-evidence.md` — cannot strand it.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { openHandoff, type HandoffPorts, type HandoffPrompt } from "../lib/handoff-flow";
import { BUNDLED_NODE_COMMAND, readRegistration, resolveSpawnCommand } from "../lib/registration";
import { createSampleAgent, SAMPLE_AGENT_ID, planSampleAgent } from "../lib/sample-agent";
import { childEnvironment } from "../runner/supervisor";
import { expectPlainLanguage } from "./helpers/plain-language";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

/**
 * Stand-ins for the two files the Agent Kit carries. Their *contents* are the
 * Kit's business and `tests/agent-kit.test.ts` covers them; what matters here is
 * that they are copied through untouched.
 */
const SOURCES = { agent: "// the agent\n", openInDash: "// open in dash\n" };

const IDS = { handoff_id: "a".repeat(32), nonce: "b".repeat(64) };
const NOW = new Date("2026-07-29T10:00:00.000Z");

function request(parentDir: string) {
  return { parentDir, sources: SOURCES, kitVersion: "0.1.1", now: NOW, ids: IDS };
}

/* ---------------------------------------------------------------------- *
 * The interpreter
 * ---------------------------------------------------------------------- */

describe("the bundled interpreter", () => {
  it("resolves to the spawning process's own binary, in Node mode", () => {
    expect(resolveSpawnCommand(BUNDLED_NODE_COMMAND, "C:\\Apps\\DASH_1.2.3\\DASH.exe")).toEqual({
      command: "C:\\Apps\\DASH_1.2.3\\DASH.exe",
      env: { ELECTRON_RUN_AS_NODE: "1" },
    });
  });

  it("leaves every other command exactly as the registration wrote it", () => {
    expect(resolveSpawnCommand("node", "C:\\Apps\\DASH.exe")).toEqual({
      command: "node",
      env: {},
    });
  });

  it("survives the install root moving, because no path was ever stored", () => {
    // The measured MSIX failure: `WindowsApps\OrchestrateDASH_0.1.0.0_x64__…`
    // became `…_0.1.1.0_…` across an update. A registration holding the old path
    // would be dead; a sentinel resolves against whatever is running now.
    const before = resolveSpawnCommand(BUNDLED_NODE_COMMAND, "/apps/DASH_0.1.0.0/dash");
    const after = resolveSpawnCommand(BUNDLED_NODE_COMMAND, "/apps/DASH_0.1.1.0/dash");
    expect(before.command).not.toBe(after.command);
    expect(after.command).toBe("/apps/DASH_0.1.1.0/dash");
  });

  it("cannot be disarmed by a registration that asks for it and then unsets it", () => {
    // Without this ordering the child would be the DASH shell itself, windows
    // and all, with an agent's script as its argument.
    const environment = childEnvironment(
      {
        agent_id: "x",
        manifest_path: "m",
        command: BUNDLED_NODE_COMMAND,
        args: [],
        env: { ELECTRON_RUN_AS_NODE: "0" },
      },
      { PATH: "/usr/bin" },
      "/apps/dash",
    );
    expect(environment["ELECTRON_RUN_AS_NODE"]).toBe("1");
  });

  it("does not put the flag in the environment of an ordinary agent", () => {
    const environment = childEnvironment(
      { agent_id: "x", manifest_path: "m", command: "node", args: [] },
      { PATH: "/usr/bin" },
      "/apps/dash",
    );
    expect(environment["ELECTRON_RUN_AS_NODE"]).toBeUndefined();
  });
});

/* ---------------------------------------------------------------------- *
 * What DASH creates
 * ---------------------------------------------------------------------- */

describe("creating the sample", () => {
  it("writes a project and a handoff beside it, needing no terminal", () => {
    const parent = tempDir("dash-samples-");
    const created = createSampleAgent(request(parent));

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(path.basename(created.value.directory)).toBe(SAMPLE_AGENT_ID);
    for (const file of ["agent.manifest.json", "agent.mjs", "dash-handoff.json", "inbox/README.md"]) {
      expect(existsSync(path.join(created.value.directory, file)), file).toBe(true);
    }
    expect(created.value.handoff.command).toBe(BUNDLED_NODE_COMMAND);
  });

  it("never overwrites a sample that is already there", () => {
    const parent = tempDir("dash-samples-");
    const first = createSampleAgent(request(parent));
    const second = createSampleAgent(request(parent));

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value.directory).not.toBe(first.value.directory);
    expect(path.basename(second.value.directory)).toBe(`${SAMPLE_AGENT_ID}-2`);
    // The agent id follows the folder, or DASH would refuse its own second
    // sample as a conflicting registration.
    expect(second.value.handoff.agent_id).toBe(`${SAMPLE_AGENT_ID}-2`);
  });

  it("plans without touching a disk", () => {
    const planned = planSampleAgent({ ...request(path.resolve("/samples")), taken: [] });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.value.files.some((file) => file.path === "agent.manifest.json")).toBe(true);
    expect(existsSync(planned.value.directory)).toBe(false);
  });
});

/* ---------------------------------------------------------------------- *
 * Adding it is the same path a terminal takes
 * ---------------------------------------------------------------------- */

describe("adding the sample", () => {
  function harness(dataDir: string): { ports: HandoffPorts; prompts: HandoffPrompt[]; calls: string[] } {
    const prompts: HandoffPrompt[] = [];
    const calls: string[] = [];
    return {
      prompts,
      calls,
      ports: {
        dataDir,
        now: () => NOW,
        confirm: async (prompt) => {
          prompts.push(prompt);
          return true;
        },
        importManifest: () => ({ ok: true }),
        forgetAgent: () => ({ existed: false }),
        recordHandoff: () => {},
        readHandoffRecord: () => null,
        runner: {
          reload: async () => {
            calls.push("reload");
            return { ok: true };
          },
          start: async (agentId) => {
            calls.push(`start:${agentId}`);
            return { ok: true };
          },
          stop: async () => ({ ok: true }),
        },
        log: () => {},
      },
    };
  }

  it("goes through the real handoff, consent and all", async () => {
    const parent = tempDir("dash-samples-");
    const dataDir = tempDir("dash-sample-data-");
    const created = createSampleAgent(request(parent));
    if (!created.ok) throw new Error(created.problem);

    const context = harness(dataDir);
    const report = await openHandoff(created.value.url, context.ports);

    expect(report).toMatchObject({ ok: true, outcome: "registered", agent_id: SAMPLE_AGENT_ID });
    // The consent dialog is not skipped for DASH's own sample. If it ever is,
    // there are two ways to register an agent and only one of them was reviewed.
    expect(context.prompts).toHaveLength(1);
    expect(context.calls).toEqual(["reload", `start:${SAMPLE_AGENT_ID}`]);

    const stored = readRegistration(dataDir, SAMPLE_AGENT_ID);
    // The sentinel reaches the file the runner reads, unresolved.
    expect(stored?.command).toBe(BUNDLED_NODE_COMMAND);
    expect(stored?.dash.owner).toBe("dash_handoff");
  });

  it("does not put DASH's own vocabulary in the question it asks", async () => {
    const parent = tempDir("dash-samples-");
    const dataDir = tempDir("dash-sample-data-");
    const created = createSampleAgent(request(parent));
    if (!created.ok) throw new Error(created.problem);

    const context = harness(dataDir);
    await openHandoff(created.value.url, context.ports);
    const prompt = context.prompts[0] as HandoffPrompt;

    // `dash:node` is not a program on this machine and must never be printed.
    expect(`${prompt.message} ${prompt.detail}`).not.toContain(BUNDLED_NODE_COMMAND);
    // What is about to run is still named, and the reassurance is the point.
    expect(prompt.detail).toContain("agent.mjs");
    expect(prompt.detail).toMatch(/you do not need to install anything/);

    expectPlainLanguage([prompt.title, prompt.message, prompt.detail], {
      allow: [created.value.directory, "agent.mjs"],
    });
  });

  it("still refuses a second identical sample handoff as already added", async () => {
    const parent = tempDir("dash-samples-");
    const dataDir = tempDir("dash-sample-data-");
    const created = createSampleAgent(request(parent));
    if (!created.ok) throw new Error(created.problem);

    const context = harness(dataDir);
    await openHandoff(created.value.url, context.ports);
    const again = await openHandoff(created.value.url, context.ports);

    expect(again.outcome).toBe("unchanged");
    expect(context.prompts).toHaveLength(1);
  });
});

describe("the manifest DASH generates for itself", () => {
  it("declares no connections, so the sample needs no credential to run", () => {
    const parent = tempDir("dash-samples-");
    const created = createSampleAgent(request(parent));
    if (!created.ok) throw new Error(created.problem);

    const manifest = JSON.parse(
      readFileSync(path.join(created.value.directory, "agent.manifest.json"), "utf8"),
    ) as { agent_dom: { connections: unknown[] } };
    expect(manifest.agent_dom.connections).toEqual([]);
  });
});
