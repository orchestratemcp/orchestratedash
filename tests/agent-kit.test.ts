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
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { analyzeGrounding } from "../lib/analyze";
import {
  agentFolderCodePath,
  agentFolderManifestPath,
  writeAgentFolder,
} from "../lib/agent-folders";
import type { DigestArtifact } from "../lib/contracts";
import { run } from "../agent-kit/cli";
import { writeHandoff } from "../agent-kit/open-in-dash";
import { deriveAgentId, planScaffold, type TemplateSources } from "../agent-kit/scaffold";
import {
  isManifestV2,
  validateArtifact,
  validateEvent,
  validateManifest,
  validateState,
} from "../lib/contracts";
import { HANDOFF_FILE_NAME, handoffUrl, readHandoff, verifyHandoff } from "../lib/handoff";
import { openHandoff, type HandoffPorts, type HandoffPrompt } from "../lib/handoff-flow";
import { resolvePanel } from "../lib/panel-spec";
import { readRegistration } from "../lib/registration";
import { buildAgentDomState } from "../runner/state";
import { Supervisor } from "../runner/supervisor";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KIT_ROOT = path.join(repoRoot, "agent-kit");
const TEMPLATE_AGENT = readFileSync(path.join(KIT_ROOT, "template", "agent.mjs"), "utf8");

const roots: string[] = [];
const supervisors: Supervisor[] = [];
const servers: Server[] = [];
afterAll(async () => {
  for (const supervisor of supervisors) {
    supervisor.stopAll();
  }
  for (const server of servers) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await waitFor(
    () =>
      supervisors.every((supervisor) =>
        supervisor.list().every((agentId) => supervisor.facts(agentId)?.pid === null),
      ),
    "generated agent processes to stop",
  );
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
  // No sources, so a run in this suite reaches no network.
  //
  // The shipped default set is three real public feeds, which is right for a
  // person's first agent and wrong for a unit test: it would make `pnpm verify`
  // depend on Google, Hacker News and arXiv all being reachable from whatever
  // machine or CI runner happens to be running it. An empty set exercises the
  // same run path — steps, events, digest, artifact — and asserts nothing about
  // anybody else's uptime. Parsing is covered separately, against fixtures.
  writeFileSync(path.join(directory, "sources.json"), `{ "sources": [] }\n`, "utf8");
  return directory;
}

/** A supervisor with the generated agent already started. */
function startedSupervisor(directory: string, agentId = "folder-digest"): Supervisor {
  const supervisor = new Supervisor(
    [
      {
        agent_id: agentId,
        manifest_path: path.join(directory, "agent.manifest.json"),
        command: process.execPath,
        args: [path.join(directory, "agent.mjs")],
        cwd: directory,
      },
    ],
    () => {},
  );
  supervisors.push(supervisor);
  supervisor.start(agentId);
  return supervisor;
}

/**
 * Ask the agent to run, the way DASH's Run now does.
 *
 * `retry` against the waiting task rather than against a run: a freshly added
 * agent has no runs, and `contracts/agent-command.schema.json` requires the
 * command to name one or the other. That is the whole reason the agent
 * publishes a task it is not yet working on.
 */
async function runNow(
  supervisor: Supervisor,
  agentId = "folder-digest",
): Promise<{ ok: boolean }> {
  return supervisor.deliver(agentId, {
    command_id: `cmd-run-${String(Date.now())}`,
    command: "retry",
    target: { agent_id: agentId, task_id: "waiting-to-be-run" },
  });
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

  /* -------------------------------------------------------------------- *
   * The declared panel (MAR-548, ADR 0008)
   * -------------------------------------------------------------------- */

  it("declares a panel DASH can draw, resolved rather than read", () => {
    /*
     * Through `resolvePanel`, not by reaching into the JSON. This is the
     * document the installed shell actually imports — "Try a sample agent"
     * scaffolds it, and `electron/smoke.ts` proof 6 puts it through the real
     * handoff — so what matters is that the *renderer's own door* accepts it.
     * A test that asserted on the object literal would keep passing on a panel
     * DASH had stopped being able to read.
     */
    const directory = scaffold();
    const resolved = resolvePanel(
      JSON.parse(readFileSync(path.join(directory, "agent.manifest.json"), "utf8")),
    );

    expect(resolved.kind).toBe("v1");
    if (resolved.kind !== "v1") return;
    expect(resolved.sections.map((section) => section.type)).toEqual([
      "report",
      "metrics",
      "table",
    ]);
  });

  it("binds only to roles and members this agent's own output actually has", () => {
    /*
     * The binding half, and the reason it is a separate assertion: a panel that
     * resolves is a panel DASH will *draw*, and a panel that draws the wrong
     * names is a panel of empty cells. `digest` is the artifact kind the
     * template's `artifact()` call emits, and the three column keys are members
     * of the digest item shape in `contracts/run-artifact.schema.json`.
     *
     * Both sides are read here rather than restated: the roles come off the
     * resolved sections, and the item members come out of the schema file, so a
     * schema that renamed `published_at` fails this test instead of quietly
     * emptying a column in the shipped sample.
     */
    const directory = scaffold();
    const resolved = resolvePanel(
      JSON.parse(readFileSync(path.join(directory, "agent.manifest.json"), "utf8")),
    );
    if (resolved.kind !== "v1") throw new Error("the scaffold's panel must resolve as v1");

    const itemMembers = Object.keys(
      (
        JSON.parse(
          readFileSync(path.join(repoRoot, "contracts", "run-artifact.schema.json"), "utf8"),
        ) as { properties: { items: { items: { properties: Record<string, unknown> } } } }
      ).properties.items.items.properties,
    );

    for (const section of resolved.sections) {
      if (section.type === "report") {
        expect(section.artifact_role).toBe("digest");
      }
      if (section.type === "table") {
        expect(section.source_role).toBe("digest");
        for (const column of section.columns) {
          expect(itemMembers, column.key).toContain(column.key);
        }
      }
    }
  });

  it("asks DASH to word the publish date rather than declaring it text", () => {
    /*
     * MAR-533's rule reached through a declaration. `timestamp` is the author
     * telling DASH the value is a moment, which is the licence
     * `lib/views/panel.ts` needs to run it through `plainMoment` instead of
     * printing the machine's spelling of it. Declared `text`, the same column
     * would render `2026-08-05T09:00:00.000Z` and no other test would notice —
     * it would be a valid panel drawing a legal string.
     */
    const directory = scaffold();
    const resolved = resolvePanel(
      JSON.parse(readFileSync(path.join(directory, "agent.manifest.json"), "utf8")),
    );
    if (resolved.kind !== "v1") throw new Error("the scaffold's panel must resolve as v1");

    const table = resolved.sections.find((section) => section.type === "table");
    expect(table?.type === "table" && table.columns.find((c) => c.key === "published_at")?.kind).toBe(
      "timestamp",
    );
  });

  it("declares no metric that would let the agent's own number wear DASH's voice", () => {
    /*
     * Every metric on this sample is a `dash_fact`, so every value it draws is
     * DASH's record and is attributed as such. That is a property of this
     * manifest rather than of the vocabulary — `artifact_field` exists and is
     * legitimate — and it is asserted because the scout has no top-level
     * numeric field to report, so a metric bound to one could only ever render
     * absent while looking like a number the agent had stood behind.
     */
    const directory = scaffold();
    const resolved = resolvePanel(
      JSON.parse(readFileSync(path.join(directory, "agent.manifest.json"), "utf8")),
    );
    if (resolved.kind !== "v1") throw new Error("the scaffold's panel must resolve as v1");

    const metrics = resolved.sections.find((section) => section.type === "metrics");
    expect(metrics?.type === "metrics" && metrics.items.every((i) => i.source.kind === "dash_fact")).toBe(
      true,
    );
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

  it("does not promise the README's own re-run advice always applies (MAR-595 finding 15)", () => {
    // `npm run open-in-dash` on a changed manifest fails honestly now when the
    // agent is still running — DASH cannot replace files a live copy has
    // open — instead of the old generic "could not finish copying" message.
    // The README must say so rather than promising a confirm dialog that a
    // running agent will not actually get.
    const directory = scaffold();
    const readme = readFileSync(path.join(directory, "README.md"), "utf8");

    expect(readme).toMatch(/stopped first/);
    expect(readme).toMatch(/cannot replace files a running copy still has\s+open/);
    // The unqualified claim finding 15 flagged: "DASH will ask you to confirm
    // the change" with no mention of the agent needing to be stopped first.
    expect(readme).not.toContain("DASH will ask you to confirm the change rather than applying it quietly.");
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
    if (!written.ok) return;
    // The acquired source may explain that agents never receive passwords or
    // bearer tokens. The security boundary is the structured environment and
    // the declared file set, not whether safe comments contain those words.
    expect(written.value.handoff.env).toEqual({});
    expect(written.value.handoff.files?.map((file) => file.path)).not.toContain(".env");
    expect(written.value.handoff.files?.some((file) => file.path.includes("node_modules"))).toBe(
      false,
    );
    expect(written.value.handoff.files?.some((file) => file.path.includes("reports"))).toBe(false);
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

  /*
   * MAR-595 finding 9. The scaffold's own README invites rewriting `agent.mjs`
   * to stop reading `sources.json` ("Make it yours"), and a person who then
   * deleted the file they no longer used got "This agent's build is
   * incomplete… Build it again" — a message that sent them rebuilding
   * something that was never broken.
   */
  describe("a scaffold file the agent no longer uses", () => {
    it("still produces a handoff when sources.json is gone", () => {
      const directory = scaffold();
      rmSync(path.join(directory, "sources.json"));

      const written = writeHandoff(directory, "0.1.1");

      expect(written.ok).toBe(true);
      expect(written.ok && written.value.handoff.files?.map((file) => file.path)).not.toContain(
        "sources.json",
      );
    });

    it("still produces a handoff when README.md and .gitignore are gone too", () => {
      const directory = scaffold();
      rmSync(path.join(directory, "sources.json"));
      rmSync(path.join(directory, "README.md"));
      rmSync(path.join(directory, ".gitignore"));

      const written = writeHandoff(directory, "0.1.1");

      expect(written.ok).toBe(true);
      const paths = written.ok ? written.value.handoff.files?.map((file) => file.path) ?? [] : [];
      expect(paths).toContain("agent.mjs");
      expect(paths).not.toContain("sources.json");
      expect(paths).not.toContain("README.md");
      expect(paths).not.toContain(".gitignore");
    });

    it("still refuses honestly when agent.mjs itself is gone", () => {
      const directory = scaffold();
      rmSync(path.join(directory, "agent.mjs"));

      const result = writeHandoff(directory, "0.1.1");

      expect(result).toMatchObject({ ok: false });
      expect(result.ok ? "" : result.problem).toMatch(/build is incomplete/i);
    });
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
      importManifest: (_manifest, options) => {
        if (options?.files === undefined || options.registration === undefined) {
          return { ok: false, errors: ["the folder-carrying handoff lost its files"] };
        }
        writeAgentFolder({
          dataDir,
          agent: "folder-digest",
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
      cwd: agentFolderCodePath(dataDir, "folder-digest"),
    });
    expect(registration?.dash.owner).toBe("dash_handoff");
    expect(registration?.manifest_path).toBe(agentFolderManifestPath(dataDir, "folder-digest"));
    expect(existsSync(path.join(agentFolderCodePath(dataDir, "folder-digest"), "agent.mjs"))).toBe(
      true,
    );

    // The digest in the live registration says what DASH wrote previously; it
    // is not proof the authoritative folder still contains those bytes. The
    // same handoff must therefore notice and repair on-disk code drift.
    writeFileSync(path.join(agentFolderCodePath(dataDir, "folder-digest"), "agent.mjs"), "drift\n");
    const repaired = await openHandoff(
      handoffUrl(written.value.file, written.value.handoff.nonce),
      ports,
    );
    expect(repaired).toMatchObject({ ok: true, outcome: "updated" });
    expect(prompts).toHaveLength(2);
    expect(readFileSync(path.join(agentFolderCodePath(dataDir, "folder-digest"), "agent.mjs"), "utf8"))
      .toBe(TEMPLATE_AGENT);
  });
});

/* ---------------------------------------------------------------------- *
 * The generated agent, actually running
 * ---------------------------------------------------------------------- */

describe("the generated agent", () => {
  it("is startable by the runner and reports what it is doing", async () => {
    const directory = scaffold();
    const supervisor = startedSupervisor(directory);

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
    const supervisor = startedSupervisor(directory);
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

  it("does not run until it is asked to", async () => {
    // The behaviour MAR-457 inverted, and the one a regression would restore
    // silently. The old template called startRun() at startup and again every
    // thirty seconds, so an agent began reaching out to the network before the
    // person who added it had seen what it does — while its own manifest
    // declared a manual trigger. This is the negative proof that they now agree.
    const directory = scaffold();
    const supervisor = startedSupervisor(directory);

    await waitFor(() => supervisor.report("folder-digest") !== null, "startup");
    // Generously longer than a run takes, and far shorter than the old timer.
    await new Promise((resolve) => setTimeout(resolve, 3_000));

    expect(existsSync(path.join(directory, "runs", "events.jsonl"))).toBe(false);
    expect(existsSync(path.join(directory, "reports"))).toBe(false);

    // And it published the task that gives DASH's control something to target.
    const report = supervisor.report("folder-digest") as { tasks?: Array<{ id: string }> };
    expect(report.tasks?.some((task) => task.id === "waiting-to-be-run")).toBe(true);
  }, 20_000);

  it("writes telemetry v1 events that pass the contract, once asked", async () => {
    const directory = scaffold();
    const supervisor = startedSupervisor(directory);
    await waitFor(() => supervisor.report("folder-digest") !== null, "startup");
    expect(await runNow(supervisor)).toMatchObject({ ok: true });

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

  it("writes its digest into its own folder and hands DASH a valid copy", async () => {
    const directory = scaffold();
    const supervisor = startedSupervisor(directory);
    await waitFor(() => supervisor.report("folder-digest") !== null, "startup");
    expect(await runNow(supervisor)).toMatchObject({ ok: true });

    await waitFor(() => existsSync(path.join(directory, "reports")), "a digest on disk");

    // The half Wave 0 could not prove: the digest also reaches DASH, as a
    // document that passes the artifact contract rather than as a file path
    // somebody has to go and find.
    //
    // Drained into a local list because draining empties the buffer — polling
    // it directly inside the predicate would throw away the very artifact the
    // next poll was waiting for.
    const drained: unknown[] = [];
    await waitFor(() => {
      for (const entry of supervisor.drainArtifacts().artifacts) {
        drained.push(entry.artifact);
      }
      return drained.length > 0;
    }, "an artifact to reach the runner");

    expect(validateArtifact(drained[0])).toMatchObject({ ok: true });
    const digest = drained[0] as { agent: string; kind: string; sources_fetched?: unknown[] };
    expect(digest.agent).toBe("folder-digest");
    expect(digest.kind).toBe("digest");
    expect(digest.sources_fetched).toEqual([]);
  }, 20_000);

  it("reads each feed shape, and reports a bad source as a bad source", async () => {
    // The fixtures are served from this machine rather than fetched from the
    // real three. What is being proved is the parsing and the four source
    // outcomes; borrowing Google's, Hacker News's and arXiv's uptime to prove it
    // would make `pnpm verify` fail for reasons that have nothing to do with
    // this repository.
    const server = createServer((request, response) => {
      const url = request.url ?? "";
      if (url.startsWith("/rss")) {
        response.writeHead(200, { "content-type": "application/rss+xml" });
        response.end(
          `<?xml version="1.0"?><rss><channel>` +
            `<item><title>AT&amp;T ships an agent</title><link>https://example.com/a</link>` +
            `<pubDate>Fri, 01 Aug 2026 09:00:00 GMT</pubDate></item>` +
            `<item><title><![CDATA[A bracketed headline]]></title><link>https://example.com/b</link></item>` +
            `</channel></rss>`,
        );
        return;
      }
      if (url.startsWith("/atom")) {
        response.writeHead(200, { "content-type": "application/atom+xml" });
        response.end(
          `<?xml version="1.0"?><feed>` +
            `<entry><title>A paper</title><link href="https://example.com/paper"/>` +
            `<published>2026-08-01T08:00:00Z</published></entry>` +
            `</feed>`,
        );
        return;
      }
      if (url.startsWith("/json")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            hits: [{ title: "A story", url: "https://example.com/story", created_at: "2026-08-01T07:00:00Z" }],
          }),
        );
        return;
      }
      if (url.startsWith("/notafeed")) {
        response.writeHead(200, { "content-type": "text/html" });
        response.end("<html><body>An error page, not a feed.</body></html>");
        return;
      }
      response.writeHead(500);
      response.end("no");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    const port = (server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${String(port)}`;

    const directory = scaffold();
    writeFileSync(
      path.join(directory, "sources.json"),
      JSON.stringify({
        sources: [
          { name: "A news feed", url: `${base}/rss`, format: "rss" },
          { name: "A paper feed", url: `${base}/atom`, format: "atom" },
          { name: "A story feed", url: `${base}/json`, format: "hn_algolia" },
          { name: "Something else", url: `${base}/notafeed`, format: "rss" },
          { name: "A broken one", url: `${base}/boom`, format: "rss" },
        ],
      }),
      "utf8",
    );

    const supervisor = startedSupervisor(directory);
    await waitFor(() => supervisor.report("folder-digest") !== null, "startup");
    expect(await runNow(supervisor)).toMatchObject({ ok: true });

    const drained: unknown[] = [];
    await waitFor(() => {
      for (const entry of supervisor.drainArtifacts().artifacts) {
        drained.push(entry.artifact);
      }
      return drained.length > 0;
    }, "the digest");

    expect(validateArtifact(drained[0])).toMatchObject({ ok: true });
    const digest = drained[0] as {
      items: Array<{ headline: string; item_url?: string; source_name?: string }>;
      sources_fetched: Array<{ source_name: string; status: string }>;
    };

    const headlines = digest.items.map((item) => item.headline);
    // Entities decoded, CDATA unwrapped, and every shape read.
    expect(headlines).toContain("AT&T ships an agent");
    expect(headlines).toContain("A bracketed headline");
    expect(headlines).toContain("A paper");
    expect(headlines).toContain("A story");

    // Every item carries where it came from, which is what a grounded verdict
    // will later be checked against.
    for (const item of digest.items) {
      expect(item.source_name, item.headline).toBeTruthy();
    }
    // Atom puts its address in an attribute rather than in the element's text.
    expect(digest.items.find((item) => item.headline === "A paper")?.item_url).toBe(
      "https://example.com/paper",
    );

    // The two failures are kept apart, because they are two different things
    // for a person to do about them.
    const byName = new Map(digest.sources_fetched.map((s) => [s.source_name, s.status]));
    expect(byName.get("Something else")).toBe("not_a_feed");
    expect(byName.get("A broken one")).toBe("unreachable");
    expect(byName.get("A news feed")).toBe("ok");
  }, 25_000);

  /*
   * The contract the installed gate now rests on (MAR-473).
   *
   * `electron/smoke.ts` proof 6j used to assert only that *a* grounding verdict
   * existed. A digest of zero items from three unreachable sources is reported
   * `grounded` — nothing in it is uncited — so that check passed whether the
   * sources answered or not, and twice in CI it passed with a source silently
   * gone (30736386756 and 30753436632 carried 20 items where 30 were expected).
   *
   * 6j now asserts an exact count against a local feed, which is only a
   * meaningful assertion if the count is deterministic. This is that claim,
   * held here where it costs no network: three sources, one per parser, produce
   * exactly their items, every one traceable to a source that was fetched.
   */
  it("grounds every item of a multi-format local feed, with an exact count", async () => {
    const counts = { rss: 3, hn_algolia: 2, atom: 4 } as const;
    const total = counts.rss + counts.hn_algolia + counts.atom;

    const server = createServer((request, response) => {
      const url = request.url ?? "";
      if (url.startsWith("/rss")) {
        response.writeHead(200, { "content-type": "application/rss+xml" });
        response.end(
          `<rss><channel>` +
            Array.from({ length: counts.rss }, (_unused, index) =>
              `<item><title>rss ${String(index + 1)}</title>` +
              `<link>https://example.com/rss/${String(index + 1)}</link></item>`,
            ).join("") +
            `</channel></rss>`,
        );
        return;
      }
      if (url.startsWith("/hn")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            hits: Array.from({ length: counts.hn_algolia }, (_unused, index) => ({
              title: `hn ${String(index + 1)}`,
              url: `https://example.com/hn/${String(index + 1)}`,
              created_at: "2026-08-01T07:00:00Z",
            })),
          }),
        );
        return;
      }
      if (url.startsWith("/atom")) {
        response.writeHead(200, { "content-type": "application/atom+xml" });
        response.end(
          `<feed>` +
            Array.from({ length: counts.atom }, (_unused, index) =>
              `<entry><title>atom ${String(index + 1)}</title>` +
              `<link href="https://example.com/atom/${String(index + 1)}"/></entry>`,
            ).join("") +
            `</feed>`,
        );
        return;
      }
      response.writeHead(404);
      response.end("no");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    const base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;

    const directory = scaffold();
    writeFileSync(
      path.join(directory, "sources.json"),
      JSON.stringify([
        { name: "Local RSS", url: `${base}/rss`, format: "rss" },
        { name: "Local HN", url: `${base}/hn`, format: "hn_algolia" },
        { name: "Local Atom", url: `${base}/atom`, format: "atom" },
      ]),
      "utf8",
    );

    const supervisor = startedSupervisor(directory);
    await waitFor(() => supervisor.report("folder-digest") !== null, "startup");
    expect(await runNow(supervisor)).toMatchObject({ ok: true });

    const drained: unknown[] = [];
    await waitFor(() => {
      for (const entry of supervisor.drainArtifacts().artifacts) {
        drained.push(entry.artifact);
      }
      return drained.length > 0;
    }, "the digest");

    expect(validateArtifact(drained[0])).toMatchObject({ ok: true });
    const grounding = analyzeGrounding(drained[0] as DigestArtifact);
    expect(grounding.verdict).toBe("grounded");
    expect(grounding.items_total).toBe(total);
    expect(grounding.items_cited).toBe(total);

    // The count is a real assertion only while every source is required to have
    // answered. A source that quietly returned nothing is the failure the live
    // gate could not see, so it is named here.
    const digest = drained[0] as { sources_fetched: Array<{ source_name: string; status: string }> };
    expect(digest.sources_fetched.map((s) => s.status)).toEqual(["ok", "ok", "ok"]);
  }, 25_000);
});
