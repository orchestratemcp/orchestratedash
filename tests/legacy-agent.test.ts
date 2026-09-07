/**
 * An agent that predates the SDK, still working (MAR-887, ADR 0034).
 *
 * Every other test in this packet runs the *new* shape: a program that imports
 * `dash-agent-sdk.mjs` from beside itself. None of them can fail in the way
 * that would matter most, because the thing at risk is not on this branch — it
 * is on other people's disks.
 *
 * ADR 0008 is the reason. An agent is a folder, and DASH swaps that folder only
 * when somebody re-imports it; nothing rewrites `agent.mjs` in place, and the
 * runner spawns whatever program a registration names. So every agent generated
 * before this packet is still a single monolithic file with no import, and it
 * has to keep running with no change to the runner, the protocol or the
 * contracts. That is a claim about compatibility, and the honest way to make it
 * is to spawn those exact bytes.
 *
 * `tests/fixtures/legacy-agent-kit-template.mjs` is `agent-kit/template/agent.mjs`
 * as it stood at `cb2cb1c`, before the split. This file runs it under a real
 * `Supervisor`, speaks the same protocol DASH speaks, and holds it to the same
 * four behaviours the current template is held to in `tests/agent-kit.test.ts`:
 * it starts idle and publishes the task Run now targets, it acknowledges a
 * command it declares and refuses one it does not, it writes telemetry v1 that
 * passes the contract, and the artifact it hands over passes the artifact
 * contract.
 *
 * If this file goes red, agents that exist on people's machines today have
 * stopped working, and no amount of green elsewhere makes up for it.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { scaffoldManifest } from "../agent-kit/scaffold";
import { validateArtifact, validateEvent, validateState } from "../lib/contracts";
import { buildAgentDomState } from "../runner/state";
import { Supervisor } from "../runner/supervisor";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LEGACY_PROGRAM = path.join(repoRoot, "tests", "fixtures", "legacy-agent-kit-template.mjs");
const AGENT_ID = "legacy-digest";

const roots: string[] = [];
const supervisors: Supervisor[] = [];

afterAll(async () => {
  for (const supervisor of supervisors) {
    supervisor.stopAll();
  }
  await waitFor(
    () =>
      supervisors.every((supervisor) =>
        supervisor.list().every((agentId) => supervisor.facts(agentId)?.pid === null),
      ),
    "the legacy agent's process to stop",
  );
  for (const root of roots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // Windows refuses to remove a directory a process still has open, and a
      // temp directory that would not delete is not a failed test. The wait
      // above is the actual fix; this is the belt to that pair of braces.
    }
  }
});

/**
 * A pre-SDK agent folder on disk: the old bytes, and nothing beside them.
 *
 * No `dash-agent-sdk.mjs` is written, deliberately. A folder that happened to
 * contain the runtime would prove nothing about the agents this test exists
 * for, and would hide the very failure it is watching for — a legacy program
 * that had somehow acquired a dependency on a file its author never had.
 *
 * The manifest is the one the kit generates, so what runs here is exactly what
 * a person's own `create-dash-agent` folder holds. `sources.json` is emptied so
 * the run reaches no network and still has to produce a digest.
 */
function legacyProject(): string {
  const root = mkdtempSync(path.join(tmpdir(), "dash-legacy-"));
  roots.push(root);
  const directory = path.join(root, AGENT_ID);
  mkdirSync(directory, { recursive: true });

  writeFileSync(
    path.join(directory, "agent.mjs"),
    readFileSync(LEGACY_PROGRAM, "utf8"),
    "utf8",
  );
  writeFileSync(
    path.join(directory, "agent.manifest.json"),
    `${JSON.stringify(
      scaffoldManifest({
        directory,
        agent_id: AGENT_ID,
        display_name: "Legacy digest",
        summary: "An agent generated before the runtime moved into its own file.",
        kit_version: "0.1.1",
        now: new Date("2026-08-01T12:00:00.000Z"),
      }),
      null,
      2,
    )}\n`,
    "utf8",
  );
  writeFileSync(path.join(directory, "sources.json"), `{ "sources": [] }\n`, "utf8");
  return directory;
}

function startedSupervisor(directory: string): Supervisor {
  const supervisor = new Supervisor(
    [
      {
        agent_id: AGENT_ID,
        manifest_path: path.join(directory, "agent.manifest.json"),
        command: process.execPath,
        args: [path.join(directory, "agent.mjs")],
        cwd: directory,
      },
    ],
    () => {},
  );
  supervisors.push(supervisor);
  supervisor.start(AGENT_ID);
  return supervisor;
}

/** Ask it to run, the way DASH's Run now does: at the task, not at a run. */
async function runNow(supervisor: Supervisor): Promise<{ ok: boolean }> {
  return supervisor.deliver(AGENT_ID, {
    command_id: `cmd-legacy-${String(Date.now())}`,
    command: "retry",
    target: { agent_id: AGENT_ID, task_id: "waiting-to-be-run" },
  });
}

async function waitFor(
  predicate: () => boolean,
  label: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

describe("the fixture itself", () => {
  it("is the monolithic program, carrying no import of the runtime", () => {
    // The invariant that makes every assertion below mean what it says. If
    // somebody "helpfully" refreshed this fixture from the current template,
    // the file would import `dash-agent-sdk.mjs`, this suite would be testing
    // the new shape twice, and the compatibility claim would be unproven while
    // reading green.
    const source = readFileSync(LEGACY_PROGRAM, "utf8");
    expect(source).not.toContain("dash-agent-sdk.mjs");
    expect(source).toContain("async function runOnce({ step, artifact })");
    expect(source).toContain("setInterval(publish, PUBLISH_INTERVAL_MS)");
  });
});

describe("an agent generated before the SDK existed", () => {
  it("starts, reports itself, and the runner builds a valid state from it", async () => {
    const supervisor = startedSupervisor(legacyProject());

    await waitFor(() => supervisor.report(AGENT_ID) !== null, "a state report");

    const facts = supervisor.facts(AGENT_ID);
    expect(facts).not.toBeNull();
    const state = buildAgentDomState(
      facts as NonNullable<typeof facts>,
      supervisor.report(AGENT_ID),
      new Date(),
    );
    expect(validateState(state)).toMatchObject({ ok: true });
  }, 20_000);

  it("stays idle and publishes the task Run now targets", async () => {
    const directory = legacyProject();
    const supervisor = startedSupervisor(directory);

    await waitFor(() => supervisor.report(AGENT_ID) !== null, "startup");
    await new Promise((resolve) => setTimeout(resolve, 3_000));

    expect(existsSync(path.join(directory, "runs", "events.jsonl"))).toBe(false);
    expect(existsSync(path.join(directory, "reports"))).toBe(false);

    const report = supervisor.report(AGENT_ID) as { tasks?: Array<{ id: string }> };
    expect(report.tasks?.some((task) => task.id === "waiting-to-be-run")).toBe(true);
  }, 20_000);

  it("acknowledges a command it declares and refuses one it does not", async () => {
    const supervisor = startedSupervisor(legacyProject());
    await waitFor(() => supervisor.report(AGENT_ID) !== null, "startup");

    const paused = await supervisor.deliver(AGENT_ID, {
      command_id: "cmd-legacy-0001",
      command: "pause",
      target: { agent_id: AGENT_ID },
    });
    expect(paused).toMatchObject({ ok: true });

    const approved = await supervisor.deliver(AGENT_ID, {
      command_id: "cmd-legacy-0002",
      command: "approve",
      target: { agent_id: AGENT_ID },
    });
    expect(approved).toMatchObject({ ok: false, problem: "refused" });
  }, 20_000);

  it("writes telemetry v1 that passes the contract, once asked", async () => {
    const directory = legacyProject();
    const supervisor = startedSupervisor(directory);
    await waitFor(() => supervisor.report(AGENT_ID) !== null, "startup");
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

  it("hands the runner an artifact that passes the artifact contract", async () => {
    const supervisor = startedSupervisor(legacyProject());
    await waitFor(() => supervisor.report(AGENT_ID) !== null, "startup");
    expect(await runNow(supervisor)).toMatchObject({ ok: true });

    // Drained into a local list because draining empties the buffer: polling it
    // inside the predicate would throw away the artifact the next poll waits
    // for.
    const drained: unknown[] = [];
    await waitFor(() => {
      for (const entry of supervisor.drainArtifacts().artifacts) {
        drained.push(entry.artifact);
      }
      return drained.length > 0;
    }, "an artifact to reach the runner");

    expect(validateArtifact(drained[0])).toMatchObject({ ok: true });
    const digest = drained[0] as { agent: string; kind: string; sources_fetched?: unknown[] };
    expect(digest.agent).toBe(AGENT_ID);
    expect(digest.kind).toBe("digest");
    expect(digest.sources_fetched).toEqual([]);
  }, 20_000);
});
