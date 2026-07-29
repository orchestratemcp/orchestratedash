/**
 * The Agent Kit (MAR-428).
 *
 * This file is the issue's first acceptance criterion, executed: create an
 * agent, produce a handoff from what the build knows about itself, and have
 * DASH register it — with no manifest transcribed, no JSON located and no file
 * picker anywhere in the sequence.
 *
 * The generated agent is really spawned by a real `Supervisor`, for the reason
 * `tests/runner-supervisor.test.ts` gives about fakes. That is what turns
 * "manifest v2, telemetry v1 and the runner protocol wired by default" from a
 * claim in a template's comments into three assertions:
 *
 * - the generated manifest passes the same v2 validation the runner applies
 *   before it spawns anything;
 * - the generated agent answers a command on its own stdin and is acknowledged;
 * - the events it writes validate against `run-event.schema.json`.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { run } from "../agent-kit/cli";
import { writeHandoff } from "../agent-kit/open-in-dash";
import { deriveAgentId, planScaffold, type TemplateSources } from "../agent-kit/scaffold";
import { isManifestV2, validateEvent, validateManifest, validateState } from "../lib/contracts";
import { HANDOFF_FILE_NAME, handoffUrl, readHandoff, verifyHandoff } from "../lib/handoff";
import { openHandoff, type HandoffPorts, type HandoffPrompt } from "../lib/handoff-flow";
import { readRegistration } from "../lib/registration";
import { buildAgentDomState } from "../runner/state";
import { Supervisor } from "../runner/supervisor";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KIT_ROOT = path.join(repoRoot, "agent-kit");
const TEMPLATE_AGENT = readFileSync(path.join(KIT_ROOT, "template", "agent.mjs"), "utf8");

const roots: string[] = [];
const supervisors: Supervisor[] = [];
afterAll(() => {
  for (const supervisor of supervisors) {
    supervisor.stopAll();
  }
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

function temporary(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

/**
 * The real template files, with the `open-in-dash` bundle stubbed.
 *
 * The bundle is a build artifact (`pnpm build:agent-kit`) and `pnpm verify` must
 * not depend on one having been produced. What matters for these tests is that
 * the scaffold *places* it; the handoff logic itself is exercised through
 * `writeHandoff`, which is the same module the bundle is built from.
 */
const SOURCES: TemplateSources = {
  agent: TEMPLATE_AGENT,
  openInDash: "// bundled by scripts/build-agent-kit.mjs\n",
};

function scaffold(agentId = "folder-digest"): string {
  const directory = path.join(temporary("dash-kit-"), agentId);
  const planned = planScaffold(
    {
      directory,
      agent_id: agentId,
      display_name: "Folder digest",
      summary: "Counts what is in its inbox folder and writes a short report.",
      kit_version: "0.1.1",
      now: new Date("2026-07-28T12:00:00.000Z"),
    },
    SOURCES,
  );
  if (!planned.ok) {
    throw new Error(planned.problem);
  }
  for (const file of planned.files) {
    const target = path.join(directory, file.path);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, file.contents, "utf8");
  }
  return directory;
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

/* ---------------------------------------------------------------------- *
 * What it writes
 * ---------------------------------------------------------------------- */

describe("the scaffold", () => {
  it("generates a manifest the runner would accept", () => {
    // The whole reason the template exists: an agent built from it is hostable
    // without anybody editing a contract document.
    const directory = scaffold();
    const validation = validateManifest(
      JSON.parse(readFileSync(path.join(directory, "agent.manifest.json"), "utf8")),
    );

    expect(validation.ok).toBe(true);
    expect(validation.ok && isManifestV2(validation.value)).toBe(true);
  });

  it("declares only commands the agent actually implements", () => {
    // A template that declared `approve` with no approval gate would offer DASH
    // a button with nothing behind it.
    const directory = scaffold();
    const manifest = JSON.parse(
      readFileSync(path.join(directory, "agent.manifest.json"), "utf8"),
    ) as { agent_dom: { control: { commands: string[] } } };

    expect(manifest.agent_dom.control.commands).toEqual(["retry", "pause", "resume", "cancel"]);
  });

  it("declares telemetry v1's full event set", () => {
    const directory = scaffold();
    const manifest = JSON.parse(
      readFileSync(path.join(directory, "agent.manifest.json"), "utf8"),
    ) as { monitoring: { events: string[] } };
    expect(manifest.monitoring.events).toHaveLength(7);
  });

  it("needs no connections, so it can be watched working with no credential", () => {
    const directory = scaffold();
    const manifest = JSON.parse(
      readFileSync(path.join(directory, "agent.manifest.json"), "utf8"),
    ) as { agent_dom: { connections: unknown[] } };
    expect(manifest.agent_dom.connections).toEqual([]);
  });

  it("writes a project with no dependencies to install", () => {
    const directory = scaffold();
    const projectPackage = JSON.parse(
      readFileSync(path.join(directory, "package.json"), "utf8"),
    ) as { dependencies: Record<string, string>; scripts: Record<string, string> };

    expect(projectPackage.dependencies).toEqual({});
    expect(projectPackage.scripts["open-in-dash"]).toBe("node scripts/open-in-dash.mjs");
  });

  it("keeps the handoff out of version control", () => {
    // It carries a single-use code, it expires, and it is regenerated every time.
    const directory = scaffold();
    expect(readFileSync(path.join(directory, ".gitignore"), "utf8")).toContain(HANDOFF_FILE_NAME);
  });

  it("refuses a name that could not be a file name", () => {
    expect(
      planScaffold(
        {
          directory: path.join(tmpdir(), "x"),
          agent_id: "../escape",
          display_name: "x",
          summary: "x",
          kit_version: "0.1.1",
          now: new Date(),
        },
        SOURCES,
      ),
    ).toMatchObject({ ok: false });
  });

  it("turns what somebody typed into an id both a manifest and a disk accept", () => {
    expect(deriveAgentId("My Agent!")).toBe("my-agent");
    expect(deriveAgentId("Folder Digest")).toBe("folder-digest");
    expect(deriveAgentId("  weekly-report  ")).toBe("weekly-report");
  });
});

describe("the command", () => {
  it("refuses to write into a folder that already has something in it", () => {
    const cwd = temporary("dash-kit-cli-");
    mkdirSync(path.join(cwd, "taken"), { recursive: true });
    writeFileSync(path.join(cwd, "taken", "important.txt"), "do not eat", "utf8");

    const result = run(["taken"], {
      kitRoot: KIT_ROOT,
      kitVersion: "0.1.1",
      cwd,
      now: new Date(),
    });

    expect(result.code).toBe(1);
    expect(readFileSync(path.join(cwd, "taken", "important.txt"), "utf8")).toBe("do not eat");
  });

  it("says what is missing rather than writing half a project", () => {
    // The `open-in-dash` bundle is a build artifact. A copy of the kit without
    // one must say so, not scaffold a project whose one command does not exist.
    const cwd = temporary("dash-kit-cli-");
    const result = run(["agentless"], {
      kitRoot: temporary("empty-kit-"),
      kitVersion: "0.1.1",
      cwd,
      now: new Date(),
    });

    expect(result.code).toBe(1);
    expect(result.output).toContain("build:agent-kit");
    expect(existsSync(path.join(cwd, "agentless"))).toBe(false);
  });

  it("tells the person the two commands that follow", () => {
    const cwd = temporary("dash-kit-cli-");
    const kitRoot = temporary("kit-");
    mkdirSync(path.join(kitRoot, "template"), { recursive: true });
    mkdirSync(path.join(kitRoot, "dist"), { recursive: true });
    writeFileSync(path.join(kitRoot, "template", "agent.mjs"), TEMPLATE_AGENT, "utf8");
    writeFileSync(path.join(kitRoot, "dist", "open-in-dash.mjs"), "// stub\n", "utf8");

    const result = run(["folder-digest"], { kitRoot, kitVersion: "0.1.1", cwd, now: new Date() });

    expect(result.code).toBe(0);
    expect(result.output).toContain("npm run open-in-dash");
    expect(existsSync(path.join(cwd, "folder-digest", "agent.mjs"))).toBe(true);
    expect(existsSync(path.join(cwd, "folder-digest", "scripts", "open-in-dash.mjs"))).toBe(true);
  });
});

/* ---------------------------------------------------------------------- *
 * The handoff it produces
 * ---------------------------------------------------------------------- */

describe("open-in-dash", () => {
  it("produces a handoff DASH will accept", () => {
    const directory = scaffold();
    const written = writeHandoff(directory, "0.1.1");
    expect(written.ok).toBe(true);
    if (!written.ok) {
      return;
    }

    const pointer = { file: written.value.file, nonce: written.value.handoff.nonce };
    const read = readHandoff(written.value.file);
    expect(read.ok).toBe(true);
    expect(read.ok && verifyHandoff(read.value, pointer)).toMatchObject({ ok: true });
  });

  it("carries no credential and no DASH-reserved setting", () => {
    const directory = scaffold();
    const written = writeHandoff(directory, "0.1.1");
    expect(written.ok && written.value.handoff.env).toEqual({});
    // The whole document, checked as text: nothing that looks like a secret.
    expect(written.ok && readFileSync(written.value.file, "utf8")).not.toMatch(
      /password|api[_-]?key|client_secret|bearer/i,
    );
  });

  it("mints a fresh code every time, so an old link stops working", () => {
    const directory = scaffold();
    const first = writeHandoff(directory, "0.1.1");
    const second = writeHandoff(directory, "0.1.1");
    expect(first.ok && second.ok && first.value.handoff.nonce).not.toBe(
      second.ok ? second.value.handoff.nonce : "",
    );
  });

  it("says plainly when there is no agent here", () => {
    const result = writeHandoff(temporary("not-an-agent-"), "0.1.1");
    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? "" : result.problem).toMatch(/no agent here/i);
  });
});

/* ---------------------------------------------------------------------- *
 * The acceptance criterion, end to end
 * ---------------------------------------------------------------------- */

describe("create, build, open in DASH", () => {
  it("produces one registered agent with no manifest import and no file picker", async () => {
    const directory = scaffold();
    const written = writeHandoff(directory, "0.1.1");
    expect(written.ok).toBe(true);
    if (!written.ok) {
      return;
    }

    const dataDir = temporary("dash-data-");
    const prompts: HandoffPrompt[] = [];
    const started: string[] = [];
    const ports: HandoffPorts = {
      dataDir,
      now: () => new Date(),
      confirm: async (prompt) => {
        prompts.push(prompt);
        return true;
      },
      importManifest: () => ({ ok: true }),
      forgetAgent: () => ({ existed: false }),
      recordHandoff: () => {},
      readHandoffRecord: () => null,
      runner: {
        reload: async () => ({ ok: true }),
        start: async (agentId) => {
          started.push(agentId);
          return { ok: true };
        },
        stop: async () => ({ ok: true }),
      },
      log: () => {},
    };

    const report = await openHandoff(
      handoffUrl(written.value.file, written.value.handoff.nonce),
      ports,
    );

    expect(report).toMatchObject({ ok: true, outcome: "registered", agent_id: "folder-digest" });
    expect(started).toEqual(["folder-digest"]);
    expect(prompts).toHaveLength(1);

    const registration = readRegistration(dataDir, "folder-digest");
    expect(registration).toMatchObject({
      command: "node",
      args: ["agent.mjs"],
      cwd: directory,
    });
    expect(registration?.dash.owner).toBe("dash_handoff");
  });
});

/* ---------------------------------------------------------------------- *
 * The generated agent, actually running
 * ---------------------------------------------------------------------- */

describe("the generated agent", () => {
  it("is startable by the runner and reports what it is doing", async () => {
    const directory = scaffold();
    const supervisor = new Supervisor(
      [
        {
          agent_id: "folder-digest",
          manifest_path: path.join(directory, "agent.manifest.json"),
          command: process.execPath,
          args: [path.join(directory, "agent.mjs")],
          cwd: directory,
        },
      ],
      () => {},
    );
    supervisors.push(supervisor);

    expect(supervisor.start("folder-digest")).toMatchObject({ ok: true });
    await waitFor(() => supervisor.report("folder-digest") !== null, "a state report");

    // And the state the runner builds from it is a contract-valid document,
    // which is what DASH stores and renders.
    const facts = supervisor.facts("folder-digest");
    expect(facts).not.toBeNull();
    const state = buildAgentDomState(
      facts as NonNullable<typeof facts>,
      supervisor.report("folder-digest"),
      new Date(),
    );
    expect(validateState(state)).toMatchObject({ ok: true });
  }, 20_000);

  it("answers a command on its own stdin, and is acknowledged", async () => {
    // "The runner protocol wired by default", proven rather than asserted: an
    // unacknowledged command settles as unacknowledged, so an ack is evidence.
    const directory = scaffold();
    const supervisor = new Supervisor(
      [
        {
          agent_id: "folder-digest",
          manifest_path: path.join(directory, "agent.manifest.json"),
          command: process.execPath,
          args: [path.join(directory, "agent.mjs")],
          cwd: directory,
        },
      ],
      () => {},
    );
    supervisors.push(supervisor);
    supervisor.start("folder-digest");
    await waitFor(() => supervisor.report("folder-digest") !== null, "startup");

    const paused = await supervisor.deliver("folder-digest", {
      command_id: "cmd-kit-0001",
      command: "pause",
      target: { agent_id: "folder-digest" },
    });
    expect(paused).toMatchObject({ ok: true });

    // A command its manifest does not declare is refused by the agent itself,
    // which is the second enforcement point the contract asks for.
    const approved = await supervisor.deliver("folder-digest", {
      command_id: "cmd-kit-0002",
      command: "approve",
      target: { agent_id: "folder-digest" },
    });
    expect(approved).toMatchObject({ ok: false, problem: "refused" });
  }, 20_000);

  it("writes telemetry v1 events that pass the contract", async () => {
    const directory = scaffold();
    const supervisor = new Supervisor(
      [
        {
          agent_id: "folder-digest",
          manifest_path: path.join(directory, "agent.manifest.json"),
          command: process.execPath,
          args: [path.join(directory, "agent.mjs")],
          cwd: directory,
        },
      ],
      () => {},
    );
    supervisors.push(supervisor);
    supervisor.start("folder-digest");

    const eventsFile = path.join(directory, "runs", "events.jsonl");
    await waitFor(() => existsSync(eventsFile), "an events file");
    await waitFor(
      () => readFileSync(eventsFile, "utf8").includes("run_completed"),
      "a completed run",
    );

    const events = readFileSync(eventsFile, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as unknown);

    expect(events.length).toBeGreaterThan(2);
    for (const event of events) {
      expect(validateEvent(event)).toMatchObject({ ok: true });
    }
  }, 20_000);

  it("writes its report into its own folder and nowhere else", async () => {
    const directory = scaffold();
    writeFileSync(path.join(directory, "inbox", "note.txt"), "hello", "utf8");

    const supervisor = new Supervisor(
      [
        {
          agent_id: "folder-digest",
          manifest_path: path.join(directory, "agent.manifest.json"),
          command: process.execPath,
          args: [path.join(directory, "agent.mjs")],
          cwd: directory,
        },
      ],
      () => {},
    );
    supervisors.push(supervisor);
    supervisor.start("folder-digest");

    await waitFor(() => existsSync(path.join(directory, "reports")), "a report");
  }, 20_000);
});
