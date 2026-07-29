/**
 * Child process supervision (MAR-415).
 *
 * **These spawn real processes.** `tests/fixtures/protocol-agent.mjs` is a
 * separate Node program that the supervisor really starts, really writes to,
 * and really kills — because the questions here are "does a SIGTERM actually
 * stop this" and "is that a real PID", and a fake child answers neither.
 *
 * This is also the part of MAR-415 that CI can run. `electron/README.md`
 * records that no CI job can launch the shell; the runner is plain Node
 * spawning plain Node, so its supervision, protocol and refusals are covered by
 * the suite on every push rather than by a local smoke.
 *
 * Two acceptance criteria are proven here:
 *
 * - "The runner refuses to start an agent whose manifest fails v2 validation."
 * - "Killing an agent process shows it as stopped in DASH" — the supervisor
 *   half of it; `runner-state.test.ts` covers what that turns into.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  Supervisor,
  assertNoRunnerSecrets,
  childEnvironment,
  loadRegistrations,
  type AgentRegistration,
} from "../runner/supervisor";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_AGENT = path.join(repoRoot, "tests", "fixtures", "protocol-agent.mjs");

const workDir = mkdtempSync(path.join(tmpdir(), "dash-runner-sup-"));
afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

/**
 * A valid v2 manifest, derived from the shipped example rather than transcribed.
 *
 * Copying the example keeps this fixture valid as the schema evolves; a
 * hand-written manifest here would drift and start proving that the test's copy
 * of the rules is self-consistent.
 */
function writeManifest(name: string, mutate: (manifest: Record<string, unknown>) => void): string {
  const manifest = JSON.parse(
    readFileSync(path.join(repoRoot, "examples", "gmail-meeting-assistant.manifest.v2.example.json"), "utf8"),
  ) as Record<string, unknown>;
  mutate(manifest);
  const file = path.join(workDir, `${name}.json`);
  writeFileSync(file, JSON.stringify(manifest), "utf8");
  return file;
}

const validManifest = writeManifest("valid", () => {});

function registration(overrides: Partial<AgentRegistration> = {}): AgentRegistration {
  return {
    agent_id: "fixture-agent",
    manifest_path: validManifest,
    command: process.execPath,
    args: [FIXTURE_AGENT],
    ...overrides,
  };
}

/** Poll until `predicate` holds, or fail loudly rather than hanging forever. */
async function waitFor(predicate: () => boolean, label: string, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

let supervisor: Supervisor;
const started: Supervisor[] = [];

function makeSupervisor(registrations: AgentRegistration[]): Supervisor {
  const instance = new Supervisor(registrations, () => {
    // Silence the runner's logging in tests; the assertions are on state.
  });
  started.push(instance);
  return instance;
}

afterAll(() => {
  for (const instance of started) {
    instance.stopAll();
  }
});

beforeEach(() => {
  supervisor = makeSupervisor([registration()]);
});

describe("refusing to start", () => {
  it("refuses an agent nobody registered", () => {
    const result = supervisor.start("not-registered");
    expect(result).toMatchObject({ ok: false, problem: "unknown_agent" });
  });

  it("refuses an agent whose manifest fails v2 validation", async () => {
    // The acceptance criterion, and the order is the point: nothing is spawned.
    const broken = writeManifest("broken", (manifest) => {
      delete manifest["agent_dom"];
    });
    const instance = makeSupervisor([registration({ manifest_path: broken })]);

    const result = instance.start("fixture-agent");
    expect(result).toMatchObject({ ok: false, problem: "invalid_manifest" });
    expect(instance.facts("fixture-agent")?.pid).toBeNull();

    // And it stays refused rather than the process appearing a moment later.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(instance.facts("fixture-agent")?.lifecycle).toBe("failed_to_start");
  });

  it("refuses a v1 manifest, which cannot declare commands at all", () => {
    const v1 = path.join(workDir, "v1.json");
    writeFileSync(
      v1,
      readFileSync(path.join(repoRoot, "examples", "agent.manifest.example.json"), "utf8"),
      "utf8",
    );
    const instance = makeSupervisor([registration({ manifest_path: v1 })]);

    const result = instance.start("fixture-agent");
    expect(result).toMatchObject({ ok: false, problem: "invalid_manifest" });
    expect(result.ok ? "" : result.detail).toContain("v1");
  });

  it("refuses a manifest that is not readable", () => {
    const instance = makeSupervisor([
      registration({ manifest_path: path.join(workDir, "does-not-exist.json") }),
    ]);
    expect(instance.start("fixture-agent")).toMatchObject({
      ok: false,
      problem: "invalid_manifest",
    });
  });

  it("refuses to start an agent twice", async () => {
    expect(supervisor.start("fixture-agent").ok).toBe(true);
    await waitFor(() => supervisor.facts("fixture-agent")?.lifecycle === "running", "startup");
    expect(supervisor.start("fixture-agent")).toMatchObject({
      ok: false,
      problem: "already_running",
    });
  });
});

describe("a running agent", () => {
  it("reports a real process id", async () => {
    const result = supervisor.start("fixture-agent");
    expect(result.ok).toBe(true);

    const pid = supervisor.facts("fixture-agent")?.pid;
    expect(typeof pid).toBe("number");
    // Real enough for the OS to admit it exists. `kill(pid, 0)` tests presence
    // without signalling.
    expect(() => process.kill(pid as number, 0)).not.toThrow();
  });

  it("records the commands its manifest declared", async () => {
    supervisor.start("fixture-agent");
    await waitFor(() => supervisor.commands("fixture-agent").length > 0, "manifest commands");
    expect(supervisor.commands("fixture-agent")).toContain("approve");
  });

  it("receives the agent's own state report", async () => {
    supervisor.start("fixture-agent");
    await waitFor(() => supervisor.report("fixture-agent") !== null, "a state report");
    expect(supervisor.report("fixture-agent")?.["status"]).toBe("running");
  });

  it("tolerates ordinary logging on stdout", async () => {
    const instance = makeSupervisor([registration({ env: { AGENT_NOISE: "1" } })]);
    instance.start("fixture-agent");
    // The fixture writes two non-protocol lines before its state message. If
    // those broke the reader, the report would never arrive.
    await waitFor(() => instance.report("fixture-agent") !== null, "a state report after noise");
    expect(instance.report("fixture-agent")?.["status"]).toBe("running");
  });

  it("buffers valid and malformed telemetry candidates without stopping the agent", async () => {
    const instance = makeSupervisor([registration({ env: { AGENT_TELEMETRY: "mixed" } })]);
    instance.start("fixture-agent");
    await waitFor(() => instance.report("fixture-agent") !== null, "startup");
    // The fixture writes both telemetry lines immediately after its state line.
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(instance.drainTelemetry()).toEqual({
      events: [
        {
          agent_id: "fixture-agent",
          event: expect.objectContaining({ run_id: "run-telemetry-fixture-01" }),
        },
        { agent_id: "fixture-agent", event: { event_version: 1 } },
      ],
      dropped: 0,
    });
    expect(instance.drainTelemetry()).toEqual({ events: [], dropped: 0 });
    expect(instance.facts("fixture-agent")?.lifecycle).toBe("running");
  });
});

describe("delivering a command", () => {
  const message = {
    command_id: "cmd-1",
    command: "approve" as const,
    target: { agent_id: "fixture-agent", approval_id: "approval-fixture-01" },
  };

  it("resolves when the agent acknowledges", async () => {
    supervisor.start("fixture-agent");
    await waitFor(() => supervisor.report("fixture-agent") !== null, "startup");

    const result = await supervisor.deliver("fixture-agent", message);
    expect(result).toMatchObject({ ok: true, detail: "handled by the fixture" });
  });

  it("reports a refusal as a refusal, not a failure to deliver", async () => {
    const instance = makeSupervisor([registration({ env: { AGENT_ACK: "refuse" } })]);
    instance.start("fixture-agent");
    await waitFor(() => instance.report("fixture-agent") !== null, "startup");

    const result = await instance.deliver("fixture-agent", message);
    expect(result).toMatchObject({ ok: false, problem: "refused" });
  });

  it("reports an unacknowledged command rather than assuming it worked", async () => {
    // The honesty property: a line written to a pipe proves nothing about
    // whether the agent read it.
    const instance = makeSupervisor([registration({ env: { AGENT_ACK: "never" } })]);
    instance.start("fixture-agent");
    await waitFor(() => instance.report("fixture-agent") !== null, "startup");

    const result = await instance.deliver("fixture-agent", message, 300);
    expect(result).toMatchObject({ ok: false, problem: "unacknowledged" });
  });

  it("refuses to deliver to an agent that is not running", async () => {
    const result = await supervisor.deliver("fixture-agent", message);
    expect(result).toMatchObject({ ok: false, problem: "not_running" });
  });

  it("resolves a pending command when the agent exits under it", async () => {
    const instance = makeSupervisor([registration({ env: { AGENT_ACK: "never" } })]);
    instance.start("fixture-agent");
    await waitFor(() => instance.report("fixture-agent") !== null, "startup");

    // A long timeout that we should not have to wait for: the exit resolves it.
    const pending = instance.deliver("fixture-agent", message, 30_000);
    instance.stop("fixture-agent");

    const result = await pending;
    expect(result).toMatchObject({ ok: false, problem: "not_running" });
  });
});

describe("stopping an agent", () => {
  it("stops the actual process", async () => {
    supervisor.start("fixture-agent");
    await waitFor(() => supervisor.facts("fixture-agent")?.lifecycle === "running", "startup");
    const pid = supervisor.facts("fixture-agent")?.pid as number;

    supervisor.stop("fixture-agent");
    await waitFor(() => supervisor.facts("fixture-agent")?.lifecycle === "exited", "exit");

    expect(supervisor.facts("fixture-agent")?.pid).toBeNull();
    // The OS agrees it is gone. This is the sentence the issue is about.
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it("is harmless when the agent was not running", () => {
    expect(supervisor.stop("fixture-agent")).toMatchObject({ ok: true });
  });

  it.skipIf(process.platform === "win32")(
    "escalates to SIGKILL when the agent ignores SIGTERM",
    async () => {
      // Skipped on Windows because there is no signal to ignore: Node emulates
      // `kill` with TerminateProcess, so an agent cannot decline it and the
      // escalation this proves has nothing to escalate from.
      const instance = makeSupervisor([registration({ env: { AGENT_IGNORE_TERM: "1" } })]);
      instance.start("fixture-agent");
      await waitFor(() => instance.facts("fixture-agent")?.lifecycle === "running", "startup");

      instance.stop("fixture-agent");
      await waitFor(
        () => instance.facts("fixture-agent")?.lifecycle === "exited",
        "SIGKILL escalation",
        15_000,
      );
      expect(instance.facts("fixture-agent")?.exit_signal).toBe("SIGKILL");
    },
    20_000,
  );
});

describe("the child environment", () => {
  it("never carries the runner's channel token", () => {
    const environment = childEnvironment(registration(), {
      PATH: "/usr/bin",
      DASH_RUNNER_TOKEN: "super-secret",
    });
    expect(environment["PATH"]).toBe("/usr/bin");
    expect(environment["DASH_RUNNER_TOKEN"]).toBeUndefined();
    expect(Object.values(environment)).not.toContain("super-secret");
  });

  it("does not inherit DASH telemetry variables from the runner environment", () => {
    const environment = childEnvironment(registration(), {
      PATH: "/usr/bin",
      DASH_INGEST_URL: "http://should-not-arrive.invalid/api/events",
      DASH_INGEST_TOKEN: "should-not-arrive",
    });
    expect(Object.keys(environment).filter((key) => key.startsWith("DASH_"))).toEqual([]);
  });

  it("refuses DASH telemetry variables in an external registration too", () => {
    expect(() =>
      childEnvironment(
        registration({
          env: {
            DASH_INGEST_URL: "http://should-not-arrive.invalid/api/events",
            DASH_INGEST_TOKEN: "should-not-arrive",
          },
        }),
        { PATH: "/usr/bin" },
      ),
    ).toThrow(/DASH-owned environment variable/);
  });

  it("refuses a registration that tries to set one", () => {
    // A registration file could otherwise exfiltrate the control token to a
    // child, which would let any agent impersonate DASH to the runner.
    expect(() =>
      childEnvironment(registration({ env: { DASH_RUNNER_TOKEN: "mine-now" } }), { PATH: "/usr/bin" }),
    ).toThrow(/reserved for the runner/);
  });

  it("passes through what the registration legitimately declared", () => {
    const environment = childEnvironment(registration({ env: { AGENT_ACK: "refuse" } }), {
      PATH: "/usr/bin",
    });
    expect(environment["AGENT_ACK"]).toBe("refuse");
  });

  it("rejects any reserved prefix", () => {
    expect(() => assertNoRunnerSecrets({ DASH_SHELL_URL: "http://evil" })).toThrow();
    expect(() => assertNoRunnerSecrets({ SAFE: "yes" })).not.toThrow();
  });
});

describe("loading registrations", () => {
  it("returns nothing when the directory does not exist", () => {
    // The normal first-run state, not a fault.
    const result = loadRegistrations(path.join(workDir, "no-such-dir"));
    expect(result.registrations).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it("skips a malformed registration without losing the others", () => {
    const dir = mkdtempSync(path.join(workDir, "regs-"));
    writeFileSync(path.join(dir, "good.json"), JSON.stringify(registration()), "utf8");
    writeFileSync(path.join(dir, "bad.json"), "{ not json", "utf8");
    writeFileSync(path.join(dir, "incomplete.json"), JSON.stringify({ agent_id: "x" }), "utf8");

    const result = loadRegistrations(dir);
    expect(result.registrations).toHaveLength(1);
    expect(result.registrations[0]?.agent_id).toBe("fixture-agent");
    expect(result.skipped).toHaveLength(2);
  });
});
