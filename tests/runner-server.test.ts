/**
 * The runner's HTTP surface and its independent enforcement (MAR-415).
 *
 * End to end and real throughout: a real loopback server, a real SQLite store,
 * a real supervised child process, and envelopes built by the same
 * `buildEnvelope` DASH uses. The only thing not present is DASH itself — these
 * tests are the runner being asked to adjudicate, which is precisely the thing
 * the contract says it must do for itself.
 *
 * **Why the checks are repeated at all** is the point of the file.
 * `tests/agent-command.test.ts` already proves DASH refuses an expired command,
 * a replayed nonce and a stale approval. The Agent DOM v2 contract still
 * requires the runner to reject "expired commands, unknown targets,
 * unauthorized capabilities, used nonces, and stale approvals" on its own,
 * because the threat model assumes a compromised DASH "can request any
 * displayed action". A runner that trusted DASH's answers would be that
 * mitigation written down and not implemented.
 */

import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildEnvelope, type AgentCommandEnvelope, type CommandActor } from "../lib/agent-dom/envelope";
import { IPC_ORIGIN, ipcFetch } from "../lib/agent-dom/ipc-fetch";
import { validateState } from "../lib/contracts";
import {
  listenOnEndpoint,
  prepareEndpoint,
  releaseEndpoint,
  runnerEndpoint,
  type RunnerEndpoint,
} from "../runner/endpoint";
import { DASH_LOCAL_PRINCIPAL } from "../runner/execute";
import { RUNNER_BUILD_ID, RUNNER_PROTOCOL_VERSION } from "../runner/identity";
import { createRunnerServer } from "../runner/server";
import { openRunnerStore, readRunnerAudit, type RunnerStore } from "../runner/store";
import { Supervisor, type AgentRegistration } from "../runner/supervisor";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_AGENT = path.join(repoRoot, "tests", "fixtures", "protocol-agent.mjs");

const AGENT = "fixture-agent";
const APPROVAL = "approval-fixture-01";
const TASK = "task-fixture-01";
const TOKEN = "test-channel-token-0123456789";

const workDir = mkdtempSync(path.join(tmpdir(), "dash-runner-http-"));

/**
 * A manifest for the fixture agent, optionally with a narrowed command list.
 *
 * The shipped example declares all seven verbs, which is right for an example
 * and useless for proving a refusal — so the undeclared-capability case gets a
 * manifest that declares fewer. Everything else is the example's own, so the
 * fixture stays valid as the schema evolves.
 */
function writeManifest(name: string, commands?: string[]): string {
  const manifest = JSON.parse(
    readFileSync(
      path.join(repoRoot, "examples", "gmail-meeting-assistant.manifest.v2.example.json"),
      "utf8",
    ),
  ) as { agent_dom: { control: { commands: string[] } } };
  if (commands !== undefined) {
    manifest.agent_dom.control.commands = commands;
  }
  const file = path.join(workDir, `${name}.json`);
  writeFileSync(file, JSON.stringify(manifest), "utf8");
  return file;
}

const MANIFEST = writeManifest("manifest");
/** Declares `approve` and `reject` only, so `pause` is genuinely undeclared. */
const NARROW_MANIFEST = writeManifest("narrow", ["approve", "reject"]);

function registration(
  env: Record<string, string> = {},
  manifestPath: string = MANIFEST,
): AgentRegistration {
  return {
    agent_id: AGENT,
    manifest_path: manifestPath,
    command: process.execPath,
    args: [FIXTURE_AGENT],
    env,
  };
}

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

/* ---------------------------------------------------------------------- *
 * Harness
 * ---------------------------------------------------------------------- */

interface Harness {
  base: string;
  /** Speaks HTTP down this runner's socket or pipe. */
  call: typeof globalThis.fetch;
  endpoint: RunnerEndpoint;
  supervisor: Supervisor;
  store: RunnerStore;
  shutdowns(): number;
  close(): Promise<void>;
}

/**
 * Every test below runs over the **real** local transport (MAR-430).
 *
 * It used to be a loopback port, which was convenient and no longer
 * representative: the shipped runner does not open one. Binding the same
 * endpoint the product binds is what makes this file evidence for the issue's
 * "same message shapes and runner enforcement on every local transport"
 * criterion rather than a suite that happens to agree with it.
 */
async function startRunner(
  env: Record<string, string> = {},
  manifestPath: string = MANIFEST,
): Promise<Harness> {
  const dataDir = mkdtempSync(path.join(workDir, "store-"));
  const store = openRunnerStore(dataDir);
  const supervisor = new Supervisor([registration(env, manifestPath)], () => {
    // Quiet: assertions are on state and on the audit table.
  });
  let shutdownCount = 0;
  const server: Server = createRunnerServer({
    supervisor,
    database: store.database,
    token: TOKEN,
    principal: DASH_LOCAL_PRINCIPAL,
    shutdown: () => {
      shutdownCount += 1;
    },
    log: () => {},
  });

  const endpoint = runnerEndpoint(dataDir, randomBytes(8).toString("hex"));
  await prepareEndpoint(endpoint);
  await listenOnEndpoint(server, endpoint);

  return {
    base: IPC_ORIGIN,
    call: ipcFetch(endpoint.path),
    endpoint,
    supervisor,
    store,
    shutdowns: () => shutdownCount,
    close(): Promise<void> {
      supervisor.stopAll();
      return new Promise<void>((resolve) => {
        server.close(() => {
          store.close();
          releaseEndpoint(endpoint);
          resolve();
        });
      });
    },
  };
}

let harness: Harness;

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

/* ---------------------------------------------------------------------- *
 * Envelopes
 * ---------------------------------------------------------------------- */

const ACTOR: CommandActor = {
  id: "test-user",
  type: "user",
  authenticated_by: "dash_session",
  display_name: "Test User",
};

let nonceCounter = 0;
function freshNonce(): string {
  nonceCounter += 1;
  return `nonce-${String(nonceCounter).padStart(4, "0")}-abcdefghijklmnop`;
}

/** The contract puts a floor of 8 characters on a command id. */
function freshCommandId(): string {
  return `cmd-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * An `approve` envelope for the fixture's open approval.
 *
 * `task_id` is not optional here even though the runner does not read it: the
 * contract requires `approve` and `reject` to name the task as well as the
 * approval, and an envelope that omits it is refused as invalid long before any
 * of these tests' subjects get a say.
 */
function envelope(overrides: Partial<Parameters<typeof buildEnvelope>[0]> = {}): AgentCommandEnvelope {
  return buildEnvelope({
    command: "approve",
    target: { agent_id: AGENT, task_id: TASK, approval_id: APPROVAL },
    actor: ACTOR,
    observed_at: new Date().toISOString(),
    correlation_id: "corr-fixture-01",
    command_id: freshCommandId(),
    nonce: freshNonce(),
    now: new Date(),
    ...overrides,
  });
}

interface CommandResponse {
  ok: boolean;
  detail?: string;
  reason?: string;
  duplicate?: boolean;
}

async function postCommand(
  runner: Harness,
  body: unknown,
  token: string = TOKEN,
): Promise<{ status: number; body: CommandResponse }> {
  const response = await runner.call(`${runner.base}/agents/${AGENT}/commands`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as CommandResponse };
}

/* ---------------------------------------------------------------------- *
 * Authentication
 * ---------------------------------------------------------------------- */

describe("authentication", () => {
  beforeAll(async () => {
    harness = await startRunner();
  });
  afterAll(async () => {
    await harness.close();
  });

  it("serves /health without a token", async () => {
    const response = await harness.call(`${harness.base}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      runner_protocol: RUNNER_PROTOCOL_VERSION,
      runner_build: RUNNER_BUILD_ID,
    });
  });

  it("requires authentication and then requests graceful shutdown", async () => {
    expect(
      (await harness.call(`${harness.base}/shutdown`, { method: "POST" })).status,
    ).toBe(401);

    const response = await harness.call(`${harness.base}/shutdown`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(response.status).toBe(202);
    await new Promise((resolve) => setImmediate(resolve));
    expect(harness.shutdowns()).toBe(1);
  });

  it("refuses a state read with no token", async () => {
    expect((await harness.call(`${harness.base}/agents/${AGENT}`)).status).toBe(401);
  });

  it("refuses a wrong token", async () => {
    const response = await harness.call(`${harness.base}/agents/${AGENT}`, {
      headers: { authorization: "Bearer not-the-token" },
    });
    expect(response.status).toBe(401);
  });

  it("refuses a token of the right length but the wrong value", async () => {
    // The constant-time comparison's own case: same length, different bytes.
    const wrong = `${"x".repeat(TOKEN.length - 1)}y`;
    const response = await harness.call(`${harness.base}/agents/${AGENT}`, {
      headers: { authorization: `Bearer ${wrong}` },
    });
    expect(response.status).toBe(401);
  });

  it("says nothing about why a token failed", async () => {
    const response = await harness.call(`${harness.base}/agents/${AGENT}`, {
      headers: { authorization: "Bearer wrong" },
    });
    const body = (await response.json()) as { detail?: string };
    expect(body.detail).toBe("Unauthorized.");
  });
});

/* ---------------------------------------------------------------------- *
 * State
 * ---------------------------------------------------------------------- */

describe("GET {control-location-uri}", () => {
  beforeAll(async () => {
    harness = await startRunner();
  });
  afterAll(async () => {
    await harness.close();
  });

  it("404s for an agent nobody registered", async () => {
    const response = await harness.call(`${harness.base}/agents/nope`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(response.status).toBe(404);
  });

  it("serves a snapshot that satisfies the contract before the agent has started", async () => {
    const response = await harness.call(`${harness.base}/agents/${AGENT}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(response.status).toBe(200);

    const state = (await response.json()) as Record<string, unknown>;
    expect(validateState(state).ok, JSON.stringify(validateState(state))).toBe(true);
    expect(state["status"]).toBe("offline");
    expect(state["agent_id"]).toBe(AGENT);
  });

  it("shows a started agent as running, with its own resources", async () => {
    harness.supervisor.start(AGENT);
    await waitFor(() => harness.supervisor.report(AGENT) !== null, "the agent's first report");

    const response = await harness.call(`${harness.base}/agents/${AGENT}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const state = (await response.json()) as Record<string, unknown>;
    expect(validateState(state).ok).toBe(true);
    expect(state["status"]).toBe("running");
    expect(state["approval_requests"]).toHaveLength(1);
  });

  it("shows a killed agent as stopped within the next read, not as healthy", async () => {
    // The issue's third acceptance criterion, over the wire. One poll interval
    // is one GET; this is that GET.
    harness.supervisor.stop(AGENT);
    await waitFor(() => harness.supervisor.facts(AGENT)?.lifecycle === "exited", "exit");

    const response = await harness.call(`${harness.base}/agents/${AGENT}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const state = (await response.json()) as Record<string, unknown>;
    expect(validateState(state).ok).toBe(true);
    expect(["offline", "error"]).toContain(state["status"]);
    expect(state["runs"]).not.toContainEqual(expect.objectContaining({ status: "running" }));
  });
});

/* ---------------------------------------------------------------------- *
 * Telemetry drain
 * ---------------------------------------------------------------------- */

describe("POST /telemetry/drain", () => {
  beforeEach(async () => {
    harness = await startRunner({ AGENT_TELEMETRY: "mixed" });
    harness.supervisor.start(AGENT);
    await waitFor(() => harness.supervisor.report(AGENT) !== null, "the agent's first report");
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  afterEach(async () => {
    await harness.close();
  });

  it("requires the runner credential and preserves the mixed batch", async () => {
    const unauthorized = await harness.call(`${harness.base}/telemetry/drain`, {
      method: "POST",
    });
    expect(unauthorized.status).toBe(401);

    const response = await harness.call(`${harness.base}/telemetry/drain`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      events: [
        {
          agent_id: AGENT,
          event: expect.objectContaining({ run_id: "run-telemetry-fixture-01" }),
        },
        { agent_id: AGENT, event: { event_version: 1 } },
      ],
      dropped: 0,
    });
    expect(harness.supervisor.facts(AGENT)?.lifecycle).toBe("running");
  });

  it("drains candidates exactly once", async () => {
    const options = {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
    };
    await harness.call(`${harness.base}/telemetry/drain`, options);
    const second = await harness.call(`${harness.base}/telemetry/drain`, options);
    expect(await second.json()).toEqual({ ok: true, events: [], dropped: 0 });
  });
});

/* ---------------------------------------------------------------------- *
 * Commands
 * ---------------------------------------------------------------------- */

describe("POST {control-location-uri}/commands", () => {
  beforeEach(async () => {
    harness = await startRunner();
    harness.supervisor.start(AGENT);
    await waitFor(() => harness.supervisor.report(AGENT) !== null, "the agent's first report");
  });
  afterEach(async () => {
    await harness.close();
  });

  it("delivers an accepted command and reports the agent's acknowledgement", async () => {
    const { status, body } = await postCommand(harness, envelope());
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.detail).toBe("handled by the fixture");

    const audit = readRunnerAudit(harness.store.database);
    expect(audit.at(-1)).toMatchObject({ decision: "accepted", agent: AGENT, command: "approve" });
  });

  it("records the approval decision, with the reason, where DASH refuses to", async () => {
    // `docs/agent-command-channel.md` settled that DASH stores keys and never
    // values, and named the runner as where the rationale actually lives.
    await postCommand(harness, envelope({ reason: "spoke to the customer" }));

    const row = harness.store.database
      .prepare("SELECT decision, actor_id, reason FROM approval_decisions WHERE request_id = ?")
      .get(APPROVAL) as Record<string, unknown> | undefined;
    expect(row).toMatchObject({
      decision: "approved",
      actor_id: "test-user",
      reason: "spoke to the customer",
    });
  });

  it("keeps the free-text reason out of its own audit table", async () => {
    await postCommand(harness, envelope({ reason: "sk-live-not-a-real-secret" }));
    const audit = readRunnerAudit(harness.store.database);
    expect(JSON.stringify(audit)).not.toContain("sk-live-not-a-real-secret");
  });

  it("refuses a replayed nonce", async () => {
    const first = envelope();
    expect((await postCommand(harness, first)).body.ok).toBe(true);

    // Same nonce, different everything else, so only the nonce can refuse it.
    const replay = envelope({ nonce: first.nonce });
    const { body } = await postCommand(harness, replay);
    expect(body).toMatchObject({ ok: false, reason: "replayed_nonce" });
  });

  it("returns the stored result for a duplicate rather than acting again", async () => {
    const first = envelope();
    await postCommand(harness, first);

    // A fresh nonce but the same intent: the idempotency key is derived from
    // the intent, so this is the double-click case.
    const duplicate = envelope({ observed_at: first.payload?.observed_at });
    const { body } = await postCommand(harness, duplicate);
    expect(body.duplicate).toBe(true);

    // And the approval was decided exactly once.
    const count = harness.store.database
      .prepare("SELECT COUNT(*) AS n FROM approval_decisions WHERE request_id = ?")
      .get(APPROVAL) as { n: number };
    expect(Number(count.n)).toBe(1);
  });

  it("refuses an expired envelope", async () => {
    const stale = envelope({ now: new Date(Date.now() - 600_000) });
    const { body } = await postCommand(harness, stale);
    expect(body).toMatchObject({ ok: false, reason: "expired_command" });
  });

  it("refuses an actor this channel may not assert", async () => {
    // The local shell is enrolled to say `dash_session` and nothing else. A
    // channel claiming `signed_identity` claims a verification nobody performed.
    const forged = envelope({
      actor: { ...ACTOR, authenticated_by: "signed_identity" },
    });
    const { body } = await postCommand(harness, forged);
    expect(body).toMatchObject({ ok: false, reason: "unassertable_actor" });
  });

  it("refuses a command the agent's manifest never declared", async () => {
    // A narrower manifest, so the refusal is about the declaration rather than
    // about the verb being unknown to the contract.
    const narrow = await startRunner({}, NARROW_MANIFEST);
    narrow.supervisor.start(AGENT);
    await waitFor(() => narrow.supervisor.report(AGENT) !== null, "startup");

    // `pause` is run-scoped, so it names a task rather than an approval.
    const undeclared = envelope({
      command: "pause",
      target: { agent_id: AGENT, task_id: TASK },
    });
    const { body } = await postCommand(narrow, undeclared);
    expect(body).toMatchObject({ ok: false, reason: "undeclared_capability" });

    await narrow.close();
  });

  it("refuses an approval it has already decided", async () => {
    expect((await postCommand(harness, envelope())).body.ok).toBe(true);

    // A genuinely different command against the same, now-resolved approval.
    const again = envelope({ observed_at: new Date(Date.now() + 1_000).toISOString() });
    const { body } = await postCommand(harness, again);
    expect(body).toMatchObject({ ok: false, reason: "approval_not_open" });
  });

  it("refuses an envelope that is not a command at all", async () => {
    const { body } = await postCommand(harness, { hello: "world" });
    expect(body).toMatchObject({ ok: false, reason: "invalid_envelope" });
  });

  it("refuses a body that is not JSON", async () => {
    const response = await harness.call(`${harness.base}/agents/${AGENT}/commands`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: "{ not json",
    });
    expect(response.status).toBe(400);
  });

  it("refuses an oversized body", async () => {
    const response = await harness.call(`${harness.base}/agents/${AGENT}/commands`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ padding: "x".repeat(300_000) }),
    });
    expect(response.status).toBe(413);
  });

  it("audits refusals as well as acceptances", async () => {
    await postCommand(harness, envelope({ now: new Date(Date.now() - 600_000) }));
    const audit = readRunnerAudit(harness.store.database);
    expect(audit.at(-1)).toMatchObject({ decision: "refused", reason_code: "expired_command" });
  });

  it("does not audit an envelope that failed validation", async () => {
    // Deliberate: a document that failed the contract carries no correlation id
    // anyone should trust, so filing a row under one would be inventing the
    // link an investigation is supposed to follow. The refusal is still
    // returned to the caller.
    const before = readRunnerAudit(harness.store.database).length;
    const { body } = await postCommand(harness, { hello: "world" });
    expect(body.reason).toBe("invalid_envelope");
    expect(readRunnerAudit(harness.store.database)).toHaveLength(before);
  });

  it("carries DASH's correlation into its own trail", async () => {
    await postCommand(harness, envelope());
    const audit = readRunnerAudit(harness.store.database);
    expect(audit.at(-1)?.correlation_id).toBe("corr-fixture-01");
  });
});

describe("commands against an agent that is not running", () => {
  beforeEach(async () => {
    harness = await startRunner();
  });
  afterEach(async () => {
    await harness.close();
  });

  it("refuses rather than reporting a delivery that could not happen", async () => {
    const { body } = await postCommand(harness, envelope());
    expect(body).toMatchObject({ ok: false, reason: "agent_not_running" });
  });

  it("refuses a command for an agent nobody registered", async () => {
    const response = await harness.call(`${harness.base}/agents/ghost/commands`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(
        envelope({ target: { agent_id: "ghost", task_id: TASK, approval_id: APPROVAL } }),
      ),
    });
    const body = (await response.json()) as CommandResponse;
    expect(body).toMatchObject({ ok: false, reason: "unknown_target" });
  });
});

/* ---------------------------------------------------------------------- *
 * Lifecycle
 * ---------------------------------------------------------------------- */

describe("POST /agents/{id}/lifecycle", () => {
  beforeEach(async () => {
    harness = await startRunner();
  });
  afterEach(async () => {
    await harness.close();
  });

  async function lifecycle(action: unknown): Promise<{ status: number; body: CommandResponse }> {
    const response = await harness.call(`${harness.base}/agents/${AGENT}/lifecycle`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ action }),
    });
    return { status: response.status, body: (await response.json()) as CommandResponse };
  }

  it("starts and stops a real process", async () => {
    expect((await lifecycle("start")).body.ok).toBe(true);
    await waitFor(() => harness.supervisor.facts(AGENT)?.lifecycle === "running", "startup");
    const pid = harness.supervisor.facts(AGENT)?.pid as number;

    expect((await lifecycle("stop")).body.ok).toBe(true);
    await waitFor(() => harness.supervisor.facts(AGENT)?.lifecycle === "exited", "exit");
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it("rejects an action that is not start or stop", async () => {
    // Lifecycle is not the command channel and does not borrow its vocabulary.
    expect((await lifecycle("approve")).status).toBe(400);
  });

  it("requires the channel token", async () => {
    const response = await harness.call(`${harness.base}/agents/${AGENT}/lifecycle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "start" }),
    });
    expect(response.status).toBe(401);
  });
});
