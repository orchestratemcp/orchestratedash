/**
 * Opening a handoff, end to end (MAR-428).
 *
 * The flow is written against injected ports precisely so this file can exist:
 * every branch a user can reach — a stale link, a tampered one, a second click,
 * a rebuild, a machine that cannot host agents, a name somebody already used by
 * hand — is exercised here on every push, rather than by clicking a link on one
 * developer's Windows box.
 *
 * The assertions come in two flavours and both matter:
 *
 * - **Nothing happened.** For every refusal, the registration directory is
 *   checked to be untouched and the consent prompt to have never been shown.
 *   "It failed safely" is a claim about what was *not* written.
 * - **The words.** The consent prompt is asserted against the acceptance
 *   criterion "a fresh user never sees `manifest_path`, component IDs, env-var
 *   names or raw scopes", because a rule about copy that nothing checks is a
 *   rule that lasts until the next hurried edit.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { HANDOFF_FILE_NAME, buildHandoff, handoffUrl, type AgentHandoff } from "../lib/handoff";
import {
  AGENT_CODE_DIRECTORY,
  AGENT_MANIFEST_FILE,
  agentFolderCodePath,
  agentFolderManifestPath,
} from "../lib/agent-folders";
import type { HandoffRecord } from "../lib/handoff-ledger";
import {
  openHandoff,
  removeAgent,
  type HandoffPorts,
  type HandoffPrompt,
  type RunnerPort,
} from "../lib/handoff-flow";
import { listRegistrations, readRegistration, registrationPath } from "../lib/registration";
import { expectPlainLanguage } from "./helpers/plain-language";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const roots: string[] = [];
afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const AGENT_ID = "folder-digest";
const NONCE = "a".repeat(64);

/* ---------------------------------------------------------------------- *
 * A project on disk, as the Agent Kit would leave it
 * ---------------------------------------------------------------------- */

interface Project {
  dir: string;
  handoffFile: string;
  manifestFile: string;
  handoff: AgentHandoff;
  url: string;
}

function v2Manifest(mutate: (manifest: Record<string, unknown>) => void = () => {}): string {
  // Derived from the shipped example rather than transcribed, so it stays valid
  // as the schema evolves.
  const manifest = JSON.parse(
    readFileSync(
      path.join(repoRoot, "examples", "gmail-meeting-assistant.manifest.v2.example.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;
  (manifest["agent"] as { name: string }).name = AGENT_ID;
  mutate(manifest);
  return JSON.stringify(manifest, null, 2);
}

function makeProject(options: {
  handoffId?: string;
  nonce?: string;
  args?: string[];
  manifestJson?: string;
  files?: AgentHandoff["files"];
  now?: Date;
  ttlMs?: number;
} = {}): Project {
  const dir = mkdtempSync(path.join(tmpdir(), "dash-project-"));
  roots.push(dir);

  const manifestFile = path.join(dir, "agent.manifest.json");
  writeFileSync(manifestFile, options.manifestJson ?? v2Manifest(), "utf8");

  const built = buildHandoff(
    {
      agent_id: AGENT_ID,
      display_name: "Folder digest",
      summary: "Counts what is in a folder and writes a short report.",
      project_dir: dir,
      manifest_path: manifestFile,
      command: "node",
      args: options.args ?? ["dist/agent.mjs"],
      files: options.files,
      produced_by: "create-dash-agent (test)",
    },
    { handoff_id: options.handoffId ?? "b".repeat(32), nonce: options.nonce ?? NONCE },
    options.now,
    options.ttlMs,
  );
  if (!built.ok) {
    throw new Error(`the fixture itself is invalid: ${built.detail}`);
  }

  const handoffFile = path.join(dir, HANDOFF_FILE_NAME);
  writeFileSync(handoffFile, JSON.stringify(built.value, null, 2), "utf8");

  return {
    dir,
    handoffFile,
    manifestFile,
    handoff: built.value,
    url: handoffUrl(handoffFile, built.value.nonce),
  };
}

/* ---------------------------------------------------------------------- *
 * Ports
 * ---------------------------------------------------------------------- */

interface Harness {
  ports: HandoffPorts;
  dataDir: string;
  prompts: HandoffPrompt[];
  ledger: HandoffRecord[];
  imported: Array<{ manifest: unknown; options: Parameters<HandoffPorts["importManifest"]>[1] }>;
  forgotten: string[];
  runnerCalls: string[];
  answer: boolean;
  now: Date;
}

function harness(
  options: { answer?: boolean; runner?: boolean; startOk?: boolean; stopOk?: boolean } = {},
): Harness {
  const dataDir = mkdtempSync(path.join(tmpdir(), "dash-flow-data-"));
  roots.push(dataDir);

  const state: Harness = {
    dataDir,
    prompts: [],
    ledger: [],
    imported: [],
    forgotten: [],
    runnerCalls: [],
    answer: options.answer ?? true,
    now: new Date("2026-07-28T12:00:00.000Z"),
    ports: undefined as unknown as HandoffPorts,
  };

  const runner: RunnerPort = {
    reload: async () => {
      state.runnerCalls.push("reload");
      return { ok: true };
    },
    start: async (agentId) => {
      state.runnerCalls.push(`start:${agentId}`);
      return options.startOk === false
        ? { ok: false, detail: "The agent exited immediately." }
        : { ok: true };
    },
    stop: async (agentId) => {
      state.runnerCalls.push(`stop:${agentId}`);
      return options.stopOk === false
        ? { ok: false, detail: "The runner did not confirm the stop." }
        : { ok: true };
    },
  };

  state.ports = {
    dataDir,
    now: () => state.now,
    confirm: async (prompt) => {
      state.prompts.push(prompt);
      return state.answer;
    },
    importManifest: (manifest, options) => {
      state.imported.push({ manifest, options });
      return { ok: true };
    },
    forgetAgent: (agentId) => {
      state.forgotten.push(agentId);
      return { existed: true };
    },
    recordHandoff: (record) => {
      const existing = state.ledger.findIndex((entry) => entry.handoff_id === record.handoff_id);
      if (existing === -1) {
        state.ledger.push(record);
      } else if (state.ledger[existing]?.outcome === "pending" && record.outcome !== "pending") {
        state.ledger[existing] = record;
      }
    },
    readHandoffRecord: (handoffId) =>
      state.ledger.find((entry) => entry.handoff_id === handoffId) ?? null,
    runner: options.runner === false ? null : runner,
    log: () => {},
  };

  return state;
}

let context: Harness;
beforeEach(() => {
  context = harness();
});

/* ---------------------------------------------------------------------- *
 * The happy path
 * ---------------------------------------------------------------------- */

describe("adding an agent", () => {
  it("registers, imports, reloads and starts it", async () => {
    const project = makeProject();

    const report = await openHandoff(project.url, context.ports);

    expect(report).toMatchObject({ ok: true, outcome: "registered", agent_id: AGENT_ID });
    expect(report.running).toBe(true);
    // No file picker, no manifest import step, no transcribed command line.
    expect(context.prompts).toHaveLength(1);
    expect(existsSync(registrationPath(context.dataDir, AGENT_ID))).toBe(true);
    expect(context.imported).toHaveLength(1);
    // The reload is what turns a file DASH just wrote into a supervised agent.
    expect(context.runnerCalls).toEqual(["reload", `start:${AGENT_ID}`]);
  });

  it("records what it will run, and where, in DASH's own copy", async () => {
    const project = makeProject();
    await openHandoff(project.url, context.ports);

    const stored = readRegistration(context.dataDir, AGENT_ID);
    expect(stored).toMatchObject({
      agent_id: AGENT_ID,
      command: "node",
      args: ["dist/agent.mjs"],
      cwd: project.dir,
    });
    expect(stored?.dash).toMatchObject({
      owner: "dash_handoff",
      source_project: project.dir,
      display_name: "Folder digest",
    });
    // The registration points at DASH's copy of the plan, not the author's file.
    expect(stored?.manifest_path).not.toBe(project.manifestFile);
  });

  it("asks before copying a bounded file set, then passes that exact set to the folder import", async () => {
    const manifestJson = v2Manifest();
    const files = [
      { path: AGENT_MANIFEST_FILE, contents: manifestJson },
      { path: "dist/agent.mjs", contents: "process.stdout.write('ready')\n" },
    ];
    const project = makeProject({ manifestJson, files });

    await openHandoff(project.url, context.ports);

    expect((context.prompts[0] as HandoffPrompt).detail).toContain(
      "DASH is about to take a copy of these files. Changing the originals later will not change the copy DASH runs.",
    );
    expect(context.imported).toHaveLength(1);
    expect(context.imported[0]).toMatchObject({
      options: {
        files,
        manifestJson,
        registration: {
          agent_id: AGENT_ID,
          manifest_path: AGENT_MANIFEST_FILE,
          cwd: AGENT_CODE_DIRECTORY,
          command: "node",
          args: ["dist/agent.mjs"],
        },
      },
    });
    expect(readRegistration(context.dataDir, AGENT_ID)).toMatchObject({
      manifest_path: agentFolderManifestPath(context.dataDir, AGENT_ID),
      cwd: agentFolderCodePath(context.dataDir, AGENT_ID),
    });
  });

  it("asks in plain language, with no internal vocabulary in it", async () => {
    const project = makeProject();
    await openHandoff(project.url, context.ports);

    const prompt = context.prompts[0] as HandoffPrompt;
    const words = `${prompt.title} ${prompt.message} ${prompt.detail}`;

    // The acceptance criterion, asserted — against MAR-423's single definition
    // of the rule rather than against the three regexes this test used to carry.
    // The two exemptions are named here, at the call site, because the design
    // brief makes them deliberately: a dialog that asks permission to run
    // something while declining to say what, or from where, would be worse than
    // the jargon it was avoiding.
    expectPlainLanguage([prompt.title, prompt.message, prompt.detail, prompt.confirm_label, prompt.cancel_label], {
      allow: [project.dir, "node dist/agent.mjs"],
    });

    // And it does say what is about to happen, which is not jargon.
    expect(words).toContain("Folder digest");
    expect(words).toContain("node dist/agent.mjs");
    expect(words).toContain(project.dir);
    expect(words).toMatch(/keeps running when you close DASH/);
  });

  it("names the accounts it will later ask for, by label and never by scope", async () => {
    const project = makeProject();
    await openHandoff(project.url, context.ports);
    const detail = (context.prompts[0] as HandoffPrompt).detail;
    expect(detail).toMatch(/ask you to connect/);
    expect(detail).toMatch(/Nothing is connected by adding it/);
  });

  it("says it needs no accounts when the manifest declares none", async () => {
    const project = makeProject({
      manifestJson: v2Manifest((manifest) => {
        (manifest["agent_dom"] as { connections: unknown[] }).connections = [];
      }),
    });
    await openHandoff(project.url, context.ports);
    expect((context.prompts[0] as HandoffPrompt).detail).toContain(
      "It needs no accounts and no passwords.",
    );
  });

  it("registers nothing when the user says no", async () => {
    context.answer = false;
    const project = makeProject();

    const report = await openHandoff(project.url, context.ports);

    expect(report).toMatchObject({ ok: false, outcome: "declined" });
    expect(report.detail).toContain("Nothing was changed");
    expect(listRegistrations(context.dataDir)).toEqual([]);
    expect(context.runnerCalls).toEqual([]);
    expect(context.imported).toEqual([]);
  });

  it("records that the consent question arrived before waiting for an answer", async () => {
    const project = makeProject();
    let answer: ((value: boolean) => void) | undefined;
    context.ports.confirm = async () =>
      await new Promise<boolean>((resolve) => {
        answer = resolve;
      });

    const opening = openHandoff(project.url, context.ports);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(context.ledger).toHaveLength(1);
    expect(context.ledger[0]).toMatchObject({ outcome: "pending", detail: "waiting for confirmation" });
    expect(listRegistrations(context.dataDir)).toEqual([]);

    answer?.(true);
    await expect(opening).resolves.toMatchObject({ ok: true, outcome: "registered" });
    expect(context.ledger[0]?.outcome).toBe("registered");
  });

  it("expires an unanswered consent question and replaces pending with a refusal", async () => {
    const project = makeProject({
      now: new Date("2026-07-28T12:00:00.000Z"),
      ttlMs: 60_000,
    });
    context.ports.confirm = async () => "expired";

    const report = await openHandoff(project.url, context.ports);

    expect(report).toMatchObject({ ok: false, outcome: "refused" });
    expect(report.headline).toMatch(/expired while it was waiting/i);
    expect(context.ledger).toHaveLength(1);
    expect(context.ledger[0]).toMatchObject({
      outcome: "refused",
      detail: "expired while waiting for confirmation",
    });
    expect(listRegistrations(context.dataDir)).toEqual([]);
  });

  it("refuses consent that arrives after the handoff expiry", async () => {
    const project = makeProject({
      now: new Date("2026-07-28T12:00:00.000Z"),
      ttlMs: 60_000,
    });
    context.ports.confirm = async () => {
      context.now = new Date("2026-07-28T12:02:00.000Z");
      return true;
    };

    const report = await openHandoff(project.url, context.ports);

    expect(report).toMatchObject({ ok: false, outcome: "refused" });
    expect(listRegistrations(context.dataDir)).toEqual([]);
  });
});

/* ---------------------------------------------------------------------- *
 * Duplicates
 * ---------------------------------------------------------------------- */

describe("opening the same handoff twice", () => {
  it("does not create a second agent and does not ask again", async () => {
    const project = makeProject();
    await openHandoff(project.url, context.ports);
    context.runnerCalls.length = 0;

    const second = await openHandoff(project.url, context.ports);

    expect(second).toMatchObject({ ok: true, outcome: "unchanged" });
    expect(second.headline).toContain("already in DASH");
    expect(context.prompts).toHaveLength(1);
    expect(listRegistrations(context.dataDir)).toHaveLength(1);
  });

  it("still makes sure the agent is actually running", async () => {
    // Idempotent means the same end state, not "did nothing". An agent that is
    // registered and stopped is not "already added" in any sense a user means.
    const project = makeProject();
    await openHandoff(project.url, context.ports);
    context.runnerCalls.length = 0;

    const second = await openHandoff(project.url, context.ports);

    expect(second.running).toBe(true);
    expect(context.runnerCalls).toContain(`start:${AGENT_ID}`);
  });

  it("treats a rebuild with the same facts as the same agent", async () => {
    // Every rebuild mints a new handoff id, a new nonce and a new timestamp. If
    // sameness were decided on the document, no agent would ever be recognised.
    const first = makeProject({ handoffId: "b".repeat(32) });
    await openHandoff(first.url, context.ports);

    const rebuilt = makeProject({ handoffId: "c".repeat(32), nonce: "d".repeat(64) });
    // Same agent id, same command; a different project directory is a real
    // change, so re-point the rebuild at the original folder.
    writeFileSync(
      path.join(rebuilt.dir, HANDOFF_FILE_NAME),
      JSON.stringify({ ...rebuilt.handoff, project_dir: first.dir, manifest_path: first.manifestFile }),
      "utf8",
    );

    const second = await openHandoff(
      handoffUrl(path.join(rebuilt.dir, HANDOFF_FILE_NAME), rebuilt.handoff.nonce),
      context.ports,
    );

    expect(second.outcome).toBe("unchanged");
    expect(context.prompts).toHaveLength(1);
  });

  it("asks again, in the language of an update, when the agent really changed", async () => {
    const first = makeProject();
    await openHandoff(first.url, context.ports);

    // The same project, rebuilt to run something different.
    const changed = { ...first.handoff, args: ["dist/agent-v2.mjs"], handoff_id: "e".repeat(32) };
    writeFileSync(first.handoffFile, JSON.stringify(changed), "utf8");

    const second = await openHandoff(handoffUrl(first.handoffFile, NONCE), context.ports);

    expect(second).toMatchObject({ ok: true, outcome: "updated" });
    expect(context.prompts).toHaveLength(2);
    expect((context.prompts[1] as HandoffPrompt).message).toContain("Update it?");
    expect((context.prompts[1] as HandoffPrompt).detail).toContain(
      "what DASH would run has changed",
    );
  });
});

/* ---------------------------------------------------------------------- *
 * Refusals
 * ---------------------------------------------------------------------- */

describe("refusing a handoff", () => {
  function assertNothingHappened(): void {
    expect(context.prompts).toEqual([]);
    expect(listRegistrations(context.dataDir)).toEqual([]);
    expect(context.runnerCalls).toEqual([]);
    expect(context.imported).toEqual([]);
  }

  it("refuses an escaping declared file before consent or any import", async () => {
    const manifestJson = v2Manifest();
    const project = makeProject({
      manifestJson,
      files: [
        { path: AGENT_MANIFEST_FILE, contents: manifestJson },
        { path: "..\\another-agent\\agent.mjs", contents: "outside\n" },
      ],
    });

    const report = await openHandoff(project.url, context.ports);

    expect(report).toMatchObject({ ok: false, outcome: "refused" });
    expect(report.headline).toMatch(/outside its own folder/i);
    assertNothingHappened();
  });

  it("refuses an unsafe agent-folder name at the handoff door", async () => {
    const manifestJson = v2Manifest((manifest) => {
      (manifest["agent"] as { name: string }).name = "con";
    });
    const project = makeProject({ manifestJson });
    writeFileSync(
      project.handoffFile,
      JSON.stringify({ ...project.handoff, agent_id: "con" }),
      "utf8",
    );

    const report = await openHandoff(handoffUrl(project.handoffFile, NONCE), context.ports);

    expect(report).toMatchObject({ ok: false, outcome: "refused" });
    expect(report.headline).toMatch(/name DASH cannot use for its folder/i);
    assertNothingHappened();
  });

  it("refuses a link that expired, and blames nobody", async () => {
    const project = makeProject({ now: new Date("2026-07-28T09:00:00.000Z"), ttlMs: 60_000 });

    const report = await openHandoff(project.url, context.ports);

    expect(report).toMatchObject({ ok: false, outcome: "refused" });
    expect(report.headline).toMatch(/expired/i);
    expect(report.headline).toMatch(/nothing is wrong with the agent/i);
    assertNothingHappened();
    // Recorded, so "nothing happened when I clicked that" is answerable later.
    expect(context.ledger).toHaveLength(1);
    expect(context.ledger[0]).toMatchObject({ outcome: "refused", detail: "expired" });
  });

  it("refuses a link whose nonce does not match the file", async () => {
    // What a page that guessed the project path, but could not read the file,
    // would produce.
    const project = makeProject();

    const report = await openHandoff(
      handoffUrl(project.handoffFile, "f".repeat(64)),
      context.ports,
    );

    expect(report).toMatchObject({ ok: false, outcome: "refused" });
    assertNothingHappened();
  });

  it("refuses a link pointing at a file that is not there", async () => {
    const report = await openHandoff(
      handoffUrl(path.join(tmpdir(), "no-such-project", HANDOFF_FILE_NAME), NONCE),
      context.ports,
    );
    expect(report).toMatchObject({ ok: false, outcome: "refused" });
    assertNothingHappened();
  });

  it("refuses a v1 manifest before asking, not after", async () => {
    const project = makeProject({
      manifestJson: readFileSync(
        path.join(repoRoot, "examples", "agent.manifest.example.json"),
        "utf8",
      ),
    });

    const report = await openHandoff(project.url, context.ports);

    expect(report).toMatchObject({ ok: false, outcome: "refused" });
    expect(report.headline).toMatch(/older version of DASH/);
    // A refusal after the user approved is a dialog that taught them approving
    // is meaningless.
    assertNothingHappened();
  });

  it("refuses a handoff whose manifest is for a different agent", async () => {
    // Otherwise an agent could inherit a different agent's declared commands.
    const project = makeProject({
      manifestJson: v2Manifest((manifest) => {
        (manifest["agent"] as { name: string }).name = "somebody-else";
      }),
    });

    const report = await openHandoff(project.url, context.ports);

    expect(report).toMatchObject({ ok: false, outcome: "refused" });
    expect(report.headline).toMatch(/does not match the agent's own plan/);
    assertNothingHappened();
  });

  it("refuses a remote agent asking DASH to manage its sign-ins, before asking (MAR-482)", async () => {
    // ADR 0006's import-time refusal, at this door too. The Gmail example's
    // connections are DASH-managed; declaring its runtime remote makes it the
    // contradiction — and it is refused before the consent dialog, because a
    // refusal after the user approved is a dialog that wasted their time.
    const project = makeProject({
      manifestJson: v2Manifest((manifest) => {
        const dom = manifest["agent_dom"] as { locations: { runtime: { kind: string } } };
        dom.locations.runtime.kind = "remote";
      }),
    });

    const report = await openHandoff(project.url, context.ports);

    expect(report).toMatchObject({ ok: false, outcome: "refused" });
    expect(report.headline).toMatch(/runs on another computer/);
    assertNothingHappened();
  });

  it("refuses a damaged manifest", async () => {
    const project = makeProject({ manifestJson: "{ not json" });
    expect(await openHandoff(project.url, context.ports)).toMatchObject({
      ok: false,
      outcome: "refused",
    });
    assertNothingHappened();
  });

  it("will not overwrite a registration somebody wrote by hand", async () => {
    mkdirSync(path.join(context.dataDir, "agents"), { recursive: true });
    writeFileSync(
      registrationPath(context.dataDir, AGENT_ID),
      JSON.stringify({ agent_id: AGENT_ID, manifest_path: "x", command: "node", args: [] }),
      "utf8",
    );
    const project = makeProject();

    const report = await openHandoff(project.url, context.ports);

    expect(report).toMatchObject({ ok: false, outcome: "refused" });
    expect(report.headline).toMatch(/by hand/);
    expect(context.prompts).toEqual([]);
    // Untouched: still the four-field file somebody wrote.
    expect(readRegistration(context.dataDir, AGENT_ID)?.dash.owner).toBe("external");
  });
});

/* ---------------------------------------------------------------------- *
 * A machine that cannot host agents
 * ---------------------------------------------------------------------- */

describe("when there is no runner", () => {
  it("still saves the agent, and says plainly that it is not running", async () => {
    const noRunner = harness({ runner: false });
    const project = makeProject();

    const report = await openHandoff(project.url, noRunner.ports);

    expect(report).toMatchObject({ ok: true, outcome: "registered", running: false });
    expect(report.detail).toMatch(/could not start it/i);
    expect(existsSync(registrationPath(noRunner.dataDir, AGENT_ID))).toBe(true);
  });

  it("does not claim an agent is running when it failed to start", async () => {
    const failing = harness({ startOk: false });
    const project = makeProject();

    const report = await openHandoff(project.url, failing.ports);

    expect(report.running).toBe(false);
    expect(report.detail).toContain("did not start");
  });
});

/* ---------------------------------------------------------------------- *
 * Removal
 * ---------------------------------------------------------------------- */

describe("removing an agent", () => {
  it("stops it first, then deletes what DASH owns, then reloads", async () => {
    const project = makeProject();
    await openHandoff(project.url, context.ports);
    context.runnerCalls.length = 0;

    const report = await removeAgent(AGENT_ID, context.ports);

    expect(report.ok).toBe(true);
    // The order is the safety property: deleting a registration under a running
    // agent leaves a process nobody has a record of.
    expect(context.runnerCalls).toEqual([`stop:${AGENT_ID}`, "reload"]);
    expect(existsSync(registrationPath(context.dataDir, AGENT_ID))).toBe(false);
    expect(context.forgotten).toEqual([AGENT_ID]);
  });

  it("says what it left alone, including the user's own folder", async () => {
    const project = makeProject();
    await openHandoff(project.url, context.ports);

    const report = await removeAgent(AGENT_ID, context.ports);

    expect(report.left_alone.join(" ")).toContain(project.dir);
    expect(report.left_alone.join(" ")).toMatch(/history of what it did/);
    expect(report.headline).toContain("Folder digest");
  });

  it("keeps the registration when the runner cannot confirm the stop", async () => {
    const refusing = harness({ stopOk: false });
    const project = makeProject();
    await openHandoff(project.url, refusing.ports);
    refusing.runnerCalls.length = 0;

    const report = await removeAgent(AGENT_ID, refusing.ports);

    expect(report.ok).toBe(false);
    expect(report.refusal).toMatch(/removed nothing/i);
    expect(refusing.runnerCalls).toEqual([`stop:${AGENT_ID}`]);
    expect(existsSync(registrationPath(refusing.dataDir, AGENT_ID))).toBe(true);
    expect(refusing.forgotten).toEqual([]);
  });

  it("refuses to remove one it did not add", async () => {
    mkdirSync(path.join(context.dataDir, "agents"), { recursive: true });
    writeFileSync(
      registrationPath(context.dataDir, "hand-made"),
      JSON.stringify({ agent_id: "hand-made", manifest_path: "x", command: "node", args: [] }),
      "utf8",
    );

    const report = await removeAgent("hand-made", context.ports);

    expect(report.ok).toBe(false);
    expect(existsSync(registrationPath(context.dataDir, "hand-made"))).toBe(true);
    expect(context.forgotten).toEqual([]);
  });
});
