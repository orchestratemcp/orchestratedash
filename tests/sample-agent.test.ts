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
import { writeAgentFolder } from "../lib/agent-folders";
import { DIGEST_WRITE_COMPONENT, FEED_FETCH_COMPONENT } from "../lib/agent-sources";
import { stepsNeedingAModel } from "../lib/ai/model-levels";
import { operationById } from "../lib/broker/operations";
import { validateManifest } from "../lib/contracts";
import { BUNDLED_NODE_COMMAND, readRegistration, resolveSpawnCommand } from "../lib/registration";
import {
  createSampleAgent,
  CURATE_OPERATION_ID,
  MODEL_CONNECTION_ID,
  SAMPLE_AGENT_ID,
  planSampleAgent,
} from "../lib/sample-agent";
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
    for (const file of ["agent.manifest.json", "agent.mjs", "dash-handoff.json", "sources.json"]) {
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
        importManifest: (_manifest, options) => {
          if (options?.files === undefined || options.registration === undefined) {
            return { ok: false, errors: ["the sample handoff did not carry its folder"] };
          }
          writeAgentFolder({
            dataDir,
            agent: options.registration.agent_id,
            manifestJson: options.manifestJson ?? "",
            registration: options.registration,
            files: options.files,
          });
          return { ok: true };
        },
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

  it("says what the agent will do before asking whether to add it", async () => {
    // Asserted as presence, not only as plain language. A permission receipt
    // that quietly disappeared would still pass the plain-language scan —
    // silence contains no raw identifiers — so the rule that copy is verified
    // over the rendered output needs the positive half too.
    const parent = tempDir("dash-samples-");
    const dataDir = tempDir("dash-sample-data-");
    const created = createSampleAgent(request(parent));
    if (!created.ok) throw new Error(created.problem);

    const context = harness(dataDir);
    await openHandoff(created.value.url, context.ports);
    const prompt = context.prompts[0] as HandoffPrompt;

    expect(prompt.detail).toContain("Read the news sources you choose");
    // Attributed to the agent. DASH renders a declaration here; it does not
    // enforce one, and the consent dialog is the worst possible place to imply
    // otherwise — see ADR 0002 on contract claims dressed as firewalls.
    expect(prompt.detail).toMatch(/It says this is what it will do/);
    expect(prompt.detail).not.toMatch(/DASH (only )?(lets|allows|restricts|limits)/i);
    /*
     * And it still says the thing a novice most needs to hear — which MAR-619
     * had to work to keep true rather than inherit.
     *
     * The sample declares a model provider now, so the branch that produced
     * "It needs no accounts and no passwords." no longer fires for it, and the
     * plain "later, it will ask you to connect" branch would have been the
     * whole of what a first-time user read on this dialog. The requirement is
     * declared `optional`, and this asserts the dialog says so: the agent runs
     * with nothing connected, and the offer follows the reassurance rather than
     * replacing it.
     */
    expect(prompt.detail).toContain("It needs no accounts and no passwords to run.");
    expect(prompt.detail).toContain("it works without it");
    expect(prompt.detail).toContain("Your model provider");
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
  /*
   * MAR-619. The sample declares exactly one connection, it is the model
   * provider, and it is optional.
   *
   * This test used to assert `connections` was empty, with the reasoning that
   * the sample needs no credential to run. **That reasoning survives and this
   * is what now protects it**: the connection is declared so the fleet fan-out
   * can reach the scout with the OpenRouter key Henrik already connected —
   * `fleetReach` matches on `connections[].provider` and on nothing else — and
   * the requirement beside it is declared `optional` so every surface still
   * says the agent runs without one. An assertion that the list is empty could
   * only be kept by not shipping the feature; an assertion that the one entry
   * is optional keeps the property the old one was really about.
   */
  it("declares one optional connection, so the sample still needs no credential to run", () => {
    const parent = tempDir("dash-samples-");
    const created = createSampleAgent(request(parent));
    if (!created.ok) throw new Error(created.problem);

    const manifest = JSON.parse(
      readFileSync(path.join(created.value.directory, "agent.manifest.json"), "utf8"),
    ) as {
      agent_dom: {
        connections: Array<{ id: string; provider: string; ownership: string }>;
        connection_requirements: {
          requirements_version: number;
          requirements: Array<{ connection_id: string; connector_kind: string; optional?: boolean }>;
        };
      };
    };

    expect(manifest.agent_dom.connections).toHaveLength(1);
    const [connection] = manifest.agent_dom.connections;
    expect(connection?.id).toBe(MODEL_CONNECTION_ID);
    expect(connection?.provider).toBe("openrouter");
    // DASH holds the key and spends it; the agent never receives one. The whole
    // reason `resolveCredentialTarget` refuses a delivery variable here.
    expect(connection?.ownership).toBe("dash_managed");

    const { connection_requirements: requirements } = manifest.agent_dom;
    expect(requirements.requirements_version).toBe(1);
    expect(requirements.requirements).toHaveLength(1);
    const [requirement] = requirements.requirements;
    expect(requirement?.connection_id).toBe(MODEL_CONNECTION_ID);
    expect(requirement?.connector_kind).toBe("api_key");
    // The load-bearing one. Required would make DASH show a working agent as
    // broken on every machine where nobody has connected a key.
    expect(requirement?.optional).toBe(true);
  });

  it("names an operation the broker actually implements", () => {
    /*
     * The cross-file contract this could get wrong quietly. The capability id
     * in the manifest is what `agent-kit/template/agent.mjs` finds by suffix
     * and hands straight to the broker, so a manifest naming an operation
     * nothing implements is an agent whose every run is refused with
     * `unknown_operation` — and the digest would still be written, so nothing
     * would look broken. `lib/agent-sources.ts` opens by describing this exact
     * class of failure for component ids.
     */
    const parent = tempDir("dash-samples-");
    const created = createSampleAgent(request(parent));
    if (!created.ok) throw new Error(created.problem);

    const manifest = JSON.parse(
      readFileSync(path.join(created.value.directory, "agent.manifest.json"), "utf8"),
    ) as {
      agent_dom: { connections: Array<{ capabilities: Array<{ id: string; access: string }> }> };
    };
    const declared = manifest.agent_dom.connections[0]?.capabilities ?? [];
    expect(declared.map((one) => one.id)).toContain(CURATE_OPERATION_ID);
    for (const capability of declared) {
      const operation = operationById(capability.id);
      expect(operation).not.toBeNull();
      // And it is declared as what it is. `write` would claim something turns
      // up in an account, which is the one thing a completion does not do.
      expect(operation?.access).toBe(capability.access);
    }
  });

  /*
   * MAR-603 / ADR 0011 / finding 29 (`docs/mar-489-attended-run-2026-08-10-evening.md`):
   * a sample with no `default_model_level` anywhere is a sample DASH's own
   * conversation feature refuses with "nothing to do here, whoever built it
   * would have to give it one" — which for this agent is DASH itself.
   */
  it("declares a level for its digest step, so its own conversation feature has one to read", () => {
    const parent = tempDir("dash-samples-");
    const created = createSampleAgent(request(parent));
    if (!created.ok) throw new Error(created.problem);

    const manifest = JSON.parse(
      readFileSync(path.join(created.value.directory, "agent.manifest.json"), "utf8"),
    ) as {
      planned_route: Array<{
        step: number;
        component_id: string;
        model_tier: string;
        default_model_level?: string;
      }>;
    };

    // Still a valid v2 manifest — the level is additive, not a rewrite of the
    // document's shape.
    expect(validateManifest(manifest).ok).toBe(true);

    const digestStep = manifest.planned_route.find(
      (step) => step.component_id === DIGEST_WRITE_COMPONENT,
    );
    expect(digestStep).toMatchObject({ model_tier: "small", default_model_level: "cheap" });

    // Fetching the feeds needs no judgment and still declares nothing — only
    // the step this promise is about gained a level.
    const fetchStep = manifest.planned_route.find(
      (step) => step.component_id === FEED_FETCH_COMPONENT,
    );
    expect(fetchStep).toMatchObject({ model_tier: "none" });
    expect(fetchStep?.default_model_level).toBeUndefined();

    expect(stepsNeedingAModel(manifest.planned_route).map((step) => step.level)).toEqual(["cheap"]);
  });
});
