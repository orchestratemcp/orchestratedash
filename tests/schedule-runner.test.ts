/**
 * The scheduler firing, in the process that outlives the window (MAR-742 item
 * 8, ADR 0029).
 *
 * **These spawn real processes**, `tests/runner-supervisor.test.ts`' reason
 * unchanged: the claim under test is *"the runner started an agent with nobody
 * watching"*, and a fake child cannot answer it. What runs is the same
 * `tests/fixtures/protocol-agent.mjs`, in the `AGENT_PENDING` mode that
 * publishes the waiting-to-be-run task the Agent Kit template publishes.
 *
 * The clock is injected, so a schedule due "now" and a window missed six hours
 * ago are both reachable without waiting for either.
 *
 * ## What this covers that the planner tests cannot
 *
 * `tests/schedule-plan.test.ts` proves *when*. This proves the two acts ADR 0022
 * composed and ADR 0029 fires: the process is started, the `retry` goes through
 * the runner's own `executeCommand` — its nonce, its idempotency claim, its
 * audit row — and a settlement is spooled whatever happens. The audit assertion
 * is the load-bearing one: a scheduled run must be distinguishable from a
 * pressed one by a column, not by inference.
 */

import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { IPC_ORIGIN, ipcFetch } from "../lib/agent-dom/ipc-fetch";
import {
  listenOnEndpoint,
  prepareEndpoint,
  releaseEndpoint,
  runnerEndpoint,
} from "../runner/endpoint";
import {
  RunnerSchedule,
  SCHEDULE_PRINCIPAL,
  type ScheduleConfiguration,
} from "../runner/schedule";
import { createRunnerServer } from "../runner/server";
import { openRunnerStore, type RunnerStore } from "../runner/store";
import { Supervisor, type AgentRegistration } from "../runner/supervisor";
import { openHealthyRunnerStore } from "./helpers/runner-store";
import type { AgentSchedule } from "../lib/schedule/plan";

const ROUTE_TOKEN = "test-channel-token-0123456789";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_AGENT = path.join(repoRoot, "tests", "fixtures", "protocol-agent.mjs");

const workDir = mkdtempSync(path.join(tmpdir(), "dash-schedule-runner-"));
const manifestPath = path.join(workDir, "valid.manifest.json");
writeFileSync(
  manifestPath,
  readFileSync(
    path.join(repoRoot, "examples", "gmail-meeting-assistant.manifest.v2.example.json"),
    "utf8",
  ),
  "utf8",
);

const open: Array<{ store: RunnerStore; supervisor: Supervisor; dataDir: string }> = [];

afterEach(() => {
  for (const entry of open.splice(0)) {
    entry.supervisor.stopAll();
    entry.store.close();
    rmSync(entry.dataDir, { recursive: true, force: true });
  }
});

function registration(overrides: Partial<AgentRegistration> = {}): AgentRegistration {
  return {
    agent_id: "scout",
    manifest_path: manifestPath,
    command: process.execPath,
    args: [FIXTURE_AGENT],
    env: { AGENT_PENDING: "1" },
    ...overrides,
  };
}

/**
 * A runner with a real store, a real supervisor, and a clock the test moves.
 *
 * `sleep` is a real short wait rather than an instant resolve, because
 * `#waitForPendingTask` is genuinely waiting for another process to write a line
 * down a pipe — resolving instantly would spin the loop against a deadline the
 * injected clock never advances past, which is a hang rather than a fast test.
 */
function harness(options: { registrations?: AgentRegistration[]; now: () => Date }): {
  schedule: RunnerSchedule;
  supervisor: Supervisor;
  database: DatabaseSync;
  logs: string[];
} {
  const dataDir = mkdtempSync(path.join(tmpdir(), "dash-schedule-store-"));
  const opened = openRunnerStore(dataDir);
  if (!opened.ok) {
    throw new Error(`the runner store would not open: ${opened.damage.detail}`);
  }
  const supervisor = new Supervisor(options.registrations ?? [registration()], () => {
    // Silence the runner's logging; the assertions are on the spool.
  });
  open.push({ store: opened.store, supervisor, dataDir });

  const logs: string[] = [];
  const schedule = new RunnerSchedule({
    database: () => opened.store.database,
    supervisor,
    log: (line) => logs.push(line),
    now: options.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 25))),
  });
  return { schedule, supervisor, database: opened.store.database, logs };
}

function scheduleFor(at: string, created: string): AgentSchedule {
  return { agent: "scout", enabled: true, kind: "daily", at_local: at, created_at: created };
}

/** `HH:MM` for a `Date`, in the local clock the planner reads. */
function hhmm(when: Date): string {
  return `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
}

describe("a window that has just come round", () => {
  /**
   * The whole feature in one test: nobody pressed anything and the agent is
   * running.
   */
  it("starts the agent, delivers the retry, and spools the run", async () => {
    const due = new Date();
    due.setSeconds(10, 0);
    const now = new Date(due.getTime() + 20_000);
    const { schedule, supervisor } = harness({ now: () => now });

    schedule.configure({
      schedules: [scheduleFor(hhmm(due), new Date(due.getTime() - 3_600_000).toISOString())],
      since: { scout: new Date(due.getTime() - 86_400_000).toISOString() },
    });

    expect(supervisor.facts("scout")?.pid).toBeNull();
    await schedule.tick();

    // Act one: there is a real process, with a real pid, that nobody pressed a
    // button to start.
    expect(supervisor.facts("scout")?.pid).toBeGreaterThan(0);

    // Act two: the retry was adjudicated and acknowledged.
    const settled = schedule.drain();
    expect(settled).toHaveLength(1);
    expect(settled[0]).toMatchObject({ agent: "scout", outcome: "ran" });
    expect(settled[0]?.detail).toContain("daily schedule");
  });

  /**
   * ADR 0029 decision 5, and the reason it is a column rather than a convention:
   * `runner_audit` is what somebody reads afterwards to ask who did this, and a
   * scheduled fire that recorded `dash_session` would be the runner inventing a
   * person who was not there.
   */
  it("files the audit row under the schedule's own actor, never a DASH session", async () => {
    const due = new Date();
    due.setSeconds(10, 0);
    const now = new Date(due.getTime() + 20_000);
    const { schedule, database } = harness({ now: () => now });

    schedule.configure({
      schedules: [scheduleFor(hhmm(due), new Date(due.getTime() - 3_600_000).toISOString())],
      since: { scout: new Date(due.getTime() - 86_400_000).toISOString() },
    });
    await schedule.tick();

    const rows = database
      .prepare("SELECT agent, command, actor_id, decision FROM runner_audit ORDER BY id")
      .all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      agent: "scout",
      command: "retry",
      actor_id: "dash-schedule",
      decision: "accepted",
    });
  });

  it("stands under a principal that may assert a runtime and nothing else", () => {
    expect(SCHEDULE_PRINCIPAL.channel_id).toBe("dash-schedule");
    expect(SCHEDULE_PRINCIPAL.may_assert).toEqual(["runtime_adapter"]);
    // The other direction is the half that matters: this channel may not claim
    // a person's session, so the audit trail cannot be made to say one was here.
    expect(SCHEDULE_PRINCIPAL.may_assert).not.toContain("dash_session");
  });

  it("does not fire the same window twice", async () => {
    const due = new Date();
    due.setSeconds(10, 0);
    const now = new Date(due.getTime() + 20_000);
    const { schedule } = harness({ now: () => now });

    schedule.configure({
      schedules: [scheduleFor(hhmm(due), new Date(due.getTime() - 3_600_000).toISOString())],
      since: { scout: new Date(due.getTime() - 86_400_000).toISOString() },
    });
    await schedule.tick();
    await schedule.tick();

    expect(schedule.drain()).toHaveLength(1);
  });
});

describe("a window nobody was there for", () => {
  /**
   * ADR 0029 decision 7. The row is written and **nothing is started**, which is
   * the half a scheduler gets wrong by helpfully catching up.
   */
  it("records it as missed and starts nothing", async () => {
    const due = new Date();
    due.setSeconds(0, 0);
    // Six hours after the window: the machine was asleep.
    const now = new Date(due.getTime() + 6 * 3_600_000);
    const { schedule, supervisor } = harness({ now: () => now });

    schedule.configure({
      schedules: [scheduleFor(hhmm(due), new Date(due.getTime() - 3_600_000).toISOString())],
      since: { scout: new Date(due.getTime() - 86_400_000).toISOString() },
    });
    await schedule.tick();

    expect(supervisor.facts("scout")?.pid).toBeNull();
    const settled = schedule.drain();
    expect(settled).toHaveLength(1);
    expect(settled[0]).toMatchObject({ agent: "scout", outcome: "missed" });
    expect(settled[0]?.due_at).toBe(due.toISOString());
    expect(settled[0]?.settled_at).toBe(now.toISOString());
  });
});

describe("a fire that could not happen", () => {
  /**
   * Every exit is a settlement. A window with no row is a window a person cannot
   * tell apart from a scheduler that is not running, and that indistinguishability
   * is the thing ADR 0029 exists to remove.
   */
  it("still settles when there is no such agent", async () => {
    const due = new Date();
    due.setSeconds(10, 0);
    const now = new Date(due.getTime() + 20_000);
    const { schedule } = harness({ registrations: [], now: () => now });

    schedule.configure({
      schedules: [scheduleFor(hhmm(due), new Date(due.getTime() - 3_600_000).toISOString())],
      since: { scout: new Date(due.getTime() - 86_400_000).toISOString() },
    });
    await schedule.tick();

    const settled = schedule.drain();
    expect(settled).toHaveLength(1);
    expect(settled[0]?.outcome).toBe("refused");
    expect(settled[0]?.detail).toContain("no registered setup");
  });

  /**
   * An agent that starts and publishes nothing to run is settled as `refused`
   * rather than left silent — the shape MAR-657 named on the button path,
   * arriving where nobody can see it.
   */
  it("settles as refused when the agent publishes nothing to run", async () => {
    const due = new Date();
    due.setSeconds(10, 0);
    const now = new Date(due.getTime() + 20_000);
    const { schedule } = harness({
      // The default fixture mode: its one task already carries a run id, so
      // there is nothing waiting for a retry to bind.
      registrations: [registration({ env: {} })],
      now: () => now,
    });

    schedule.configure({
      schedules: [scheduleFor(hhmm(due), new Date(due.getTime() - 3_600_000).toISOString())],
      since: { scout: new Date(due.getTime() - 86_400_000).toISOString() },
    });
    await schedule.tick();

    const settled = schedule.drain();
    expect(settled).toHaveLength(1);
    expect(settled[0]?.outcome).toBe("refused");
    expect(settled[0]?.detail).toContain("did not publish anything to run");
  }, 40_000);
});

describe("the routes DASH pushes and drains over", () => {
  /**
   * A real endpoint, `tests/runner-server.test.ts`' arrangement, because what is
   * under test is the parser at the trust boundary — and a parser called
   * directly is a parser that never met a body somebody else serialised.
   */
  async function servedSchedule(): Promise<{
    call: ReturnType<typeof ipcFetch>;
    taken: ScheduleConfiguration[];
    close: () => Promise<void>;
  }> {
    const dataDir = mkdtempSync(path.join(tmpdir(), "dash-schedule-route-"));
    const store = openHealthyRunnerStore(dataDir);
    const supervisor = new Supervisor([], () => {});
    open.push({ store, supervisor, dataDir });

    const taken: ScheduleConfiguration[] = [];
    const server = createRunnerServer({
      supervisor,
      database: store.database,
      token: ROUTE_TOKEN,
      principal: SCHEDULE_PRINCIPAL,
      configureSchedules: (configuration) => taken.push(configuration),
      drainSchedules: () => [],
      log: () => {},
    });
    const endpoint = runnerEndpoint(dataDir, randomBytes(8).toString("hex"));
    await prepareEndpoint(endpoint);
    await listenOnEndpoint(server, endpoint);

    return {
      call: ipcFetch(endpoint.path),
      taken,
      close: () =>
        new Promise<void>((resolve) => {
          server.close(() => {
            releaseEndpoint(endpoint);
            resolve();
          });
        }),
    };
  }

  it("takes a whole set, disabled members included", async () => {
    const served = await servedSchedule();
    try {
      const response = await served.call(`${IPC_ORIGIN}/schedules`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${ROUTE_TOKEN}` },
        body: JSON.stringify({
          schedules: [
            { agent: "scout", enabled: true, kind: "daily", at_local: "08:00", created_at: "x" },
            { agent: "digest", enabled: false, kind: "daily", at_local: "17:30", created_at: "x" },
          ],
          since: { scout: "2026-08-25T06:00:00.000Z" },
        }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, taken: 2, enabled: 1 });
      expect(served.taken[0]?.schedules).toHaveLength(2);
      expect(served.taken[0]?.since).toEqual({ scout: "2026-08-25T06:00:00.000Z" });
    } finally {
      await served.close();
    }
  });

  /**
   * The stated difference from `POST /chief/discord`, which refuses the whole
   * bridge on a bad member: one corrupt row on somebody's disk must not silently
   * stop every *other* agent's schedule, because a scheduler that stops without
   * saying so is the failure this feature is against.
   */
  it("drops a member it cannot read and keeps the rest", async () => {
    const served = await servedSchedule();
    try {
      const response = await served.call(`${IPC_ORIGIN}/schedules`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${ROUTE_TOKEN}` },
        body: JSON.stringify({
          schedules: [
            { agent: "scout", enabled: true, kind: "daily", at_local: "08:00", created_at: "x" },
            { agent: "broken", enabled: true, kind: "daily", at_local: "25:99", created_at: "x" },
            { agent: "weekly", enabled: true, kind: "weekly", at_local: "08:00", created_at: "x" },
            { enabled: true, kind: "daily", at_local: "08:00", created_at: "x" },
          ],
          since: {},
        }),
      });
      expect(await response.json()).toMatchObject({ ok: true, taken: 1 });
      expect(served.taken[0]?.schedules.map((entry) => entry.agent)).toEqual(["scout"]);
    } finally {
      await served.close();
    }
  });

  it("refuses a body that is not a set at all", async () => {
    const served = await servedSchedule();
    try {
      const response = await served.call(`${IPC_ORIGIN}/schedules`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${ROUTE_TOKEN}` },
        body: JSON.stringify({ schedules: "all of them" }),
      });
      expect(response.status).toBe(400);
      expect(served.taken).toEqual([]);
    } finally {
      await served.close();
    }
  });

  /** The channel credential is the gate here as everywhere else on this server. */
  it("refuses an unauthenticated push", async () => {
    const served = await servedSchedule();
    try {
      const response = await served.call(`${IPC_ORIGIN}/schedules`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ schedules: [], since: {} }),
      });
      expect(response.status).toBe(401);
      expect(served.taken).toEqual([]);
    } finally {
      await served.close();
    }
  });
});

describe("the spool", () => {
  it("is emptied by the drain, so DASH takes each window exactly once", async () => {
    const due = new Date();
    due.setSeconds(0, 0);
    const now = new Date(due.getTime() + 6 * 3_600_000);
    const { schedule } = harness({ now: () => now });

    schedule.configure({
      schedules: [scheduleFor(hhmm(due), new Date(due.getTime() - 3_600_000).toISOString())],
      since: { scout: new Date(due.getTime() - 86_400_000).toISOString() },
    });
    await schedule.tick();

    expect(schedule.drain()).toHaveLength(1);
    expect(schedule.drain()).toEqual([]);
  });

  it("fires nothing at all until DASH has pushed a set", async () => {
    const now = new Date();
    const { schedule, supervisor } = harness({ now: () => now });
    await schedule.tick();
    expect(supervisor.facts("scout")?.pid).toBeNull();
    expect(schedule.drain()).toEqual([]);
    expect(schedule.describe()).toMatchObject({ schedules: 0, enabled: 0 });
  });
});
