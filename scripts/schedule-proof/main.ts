/**
 * MAR-742 item 8 acceptance proof: the runner fires a schedule with DASH closed
 * (ADR 0029).
 *
 * Launched by `node scripts/prove-schedule.mjs`, which bundles this file and the
 * runner beside it. Deliberately **not** a `package.json` script and
 * deliberately not part of `pnpm test`: it spawns a real detached process and
 * waits out a real minute of wall-clock time, which is exactly what makes it
 * evidence rather than a unit test.
 *
 * ## What it is a proof of, precisely
 *
 * The unit suite already proves that `decideSchedule` picks the right window and
 * that `RunnerSchedule.tick()` starts an agent. Both run **in one process, with
 * an injected clock**. Neither can answer the question this feature is actually
 * judged on:
 *
 * > *With no DASH anywhere on this machine, does an agent start by itself at the
 * > time somebody picked, and can DASH tell them about it afterwards?*
 *
 * So there is no Electron here and no window. A real runner process is spawned
 * detached, told the schedule once, and then **left alone** — the script does
 * not poll it, does not hold the socket open, and does nothing at all while the
 * window comes round. What happens next happens because the runner decided it.
 *
 * Then the script does what DASH's next open would do: one drain, one
 * `recordScheduleRuns`, and one `buildAgentScheduleView` — the same three calls
 * `electron/agent-adapters.ts` and `lib/views/build.ts` make — and prints the
 * panel a person would read.
 *
 * ## Why the schedule is a minute out and not a second
 *
 * `SCHEDULE_TICK_MS` is thirty seconds, so a window less than one tick away
 * could be caught by luck. A minute guarantees at least one full tick lands on
 * the far side of the due moment, which is the thing being proven.
 */

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function say(line: string): void {
  console.log(`[schedule-proof] ${line}`);
}

/**
 * One HTTP request down the runner's own endpoint.
 *
 * Hand-rolled rather than reusing `lib/agent-dom/ipc-fetch.ts`, for one reason:
 * this file is the DASH side of the channel and should reach the runner the way
 * anything else would, over the socket it published, with the credential it
 * minted. Borrowing DASH's own client would make the proof depend on the module
 * whose behaviour is not what is in question here.
 */
async function callRunner(
  endpoint: string,
  token: string,
  route: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const socket = connect(endpoint);
    let raw = "";
    socket.on("error", reject);
    socket.on("connect", () => {
      socket.write(
        `POST ${route} HTTP/1.1\r\n` +
          "Host: 127.0.0.1\r\n" +
          `Authorization: Bearer ${token}\r\n` +
          "Content-Type: application/json\r\n" +
          `Content-Length: ${String(Buffer.byteLength(payload))}\r\n` +
          "Connection: close\r\n\r\n" +
          payload,
      );
    });
    socket.on("data", (chunk) => {
      raw += chunk.toString("utf8");
    });
    socket.on("close", () => {
      const split = raw.indexOf("\r\n\r\n");
      const head = raw.slice(0, split);
      const rest = raw.slice(split + 4);
      if (!head.startsWith("HTTP/1.1 200")) {
        reject(new Error(`the runner answered: ${head.split("\r\n")[0] ?? "nothing"}`));
        return;
      }
      /*
       * `Connection: close` with no `Content-Length` means the body may arrive
       * chunked. Rather than implement the framing, find the JSON: the runner's
       * replies are one object and nothing else on the wire looks like one.
       */
      const start = rest.indexOf("{");
      const end = rest.lastIndexOf("}");
      if (start < 0 || end < start) {
        reject(new Error("the runner's reply carried no JSON"));
        return;
      }
      try {
        resolve(JSON.parse(rest.slice(start, end + 1)) as Record<string, unknown>);
      } catch (error: unknown) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const runnerBundle = process.env["DASH_PROOF_RUNNER"];
  if (runnerBundle === undefined) {
    throw new Error("DASH_PROOF_RUNNER must name the bundled runner. Use scripts/prove-schedule.mjs.");
  }

  /*
   * A scratch directory and nothing else. This proof never resolves the
   * installed store — project memory, twice over: a damaged `dash.sqlite` is the
   * one thing this repository has already paid for, and a harness that could
   * open it is a harness that will one day be run with DASH open.
   */
  const dataDir = mkdtempSync(path.join(tmpdir(), "dash-schedule-proof-"));
  process.env["DASH_DATA_DIR"] = dataDir;
  say(`scratch store: ${dataDir}`);

  /* ------------------------------------------------------------------ *
   * 1. An agent the runner can actually start
   * ------------------------------------------------------------------ */

  const agentsDir = path.join(dataDir, "agents");
  mkdirSync(agentsDir, { recursive: true });
  const manifestPath = path.join(dataDir, "scout.manifest.json");
  writeFileSync(
    manifestPath,
    readFileSync(
      path.join(repoRoot, "examples", "gmail-meeting-assistant.manifest.v2.example.json"),
      "utf8",
    ),
    "utf8",
  );
  writeFileSync(
    path.join(agentsDir, "scout.json"),
    JSON.stringify(
      {
        agent_id: "scout",
        manifest_path: manifestPath,
        command: process.execPath,
        args: [path.join(repoRoot, "tests", "fixtures", "protocol-agent.mjs")],
        // The mode that publishes a waiting-to-be-run task, which is what the
        // Agent Kit template does and what a schedule fires at.
        env: { AGENT_PENDING: "1" },
      },
      null,
      2,
    ),
    "utf8",
  );
  say("registered one agent, stopped, with nothing running");

  /* ------------------------------------------------------------------ *
   * 2. A runner, detached, with no DASH anywhere
   * ------------------------------------------------------------------ */

  const runner = spawn(process.execPath, [runnerBundle], {
    env: { ...process.env, DASH_RUNNER_DATA_DIR: dataDir },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  runner.stdout?.on("data", (chunk: Buffer) => {
    process.stdout.write(`[runner] ${chunk.toString("utf8")}`);
  });
  runner.stderr?.on("data", (chunk: Buffer) => {
    process.stdout.write(`[runner] ${chunk.toString("utf8")}`);
  });

  const endpointFile = path.join(dataDir, "runner.json");
  let endpoint: string | null = null;
  for (let look = 0; look < 60 && endpoint === null; look += 1) {
    await sleep(250);
    try {
      endpoint = (JSON.parse(readFileSync(endpointFile, "utf8")) as { endpoint: string }).endpoint;
    } catch {
      // Not listening yet.
    }
  }
  if (endpoint === null) {
    throw new Error("the runner never published an endpoint");
  }
  const token = readFileSync(path.join(dataDir, "runner.key"), "utf8").trim();
  say(`runner listening, pid ${String(runner.pid)}`);

  /* ------------------------------------------------------------------ *
   * 3. One push, as DASH's poll would make it — then DASH goes away
   * ------------------------------------------------------------------ */

  const { db } = await import("../../lib/db");
  const { writeAgentSchedule, readAgentSchedule, readAgentSchedules, recordScheduleRuns, readScheduleRuns } =
    await import("../../lib/schedule/store");
  const { buildAgentScheduleView } = await import("../../lib/views/agent-schedule");

  // Touch the store so the migration runs and the two tables exist.
  db();

  const due = new Date(Date.now() + 60_000);
  due.setSeconds(0, 0);
  const at = `${String(due.getHours()).padStart(2, "0")}:${String(due.getMinutes()).padStart(2, "0")}`;
  const saved = writeAgentSchedule("scout", at, new Date(Date.now() - 60_000).toISOString());
  if (!saved.ok) {
    throw new Error(`the schedule would not save: ${saved.refusal ?? "no reason"}`);
  }
  say(`schedule saved: every day at ${at} (next window ${due.toISOString()})`);
  say(`store says: ${JSON.stringify(readAgentSchedule("scout"))}`);

  const pushed = await callRunner(endpoint, token, "/schedules", {
    schedules: readAgentSchedules(),
    since: {},
  });
  say(`pushed to the runner: ${JSON.stringify(pushed)}`);

  /* ------------------------------------------------------------------ *
   * 4. Nothing. This is the part that is the proof.
   * ------------------------------------------------------------------ */

  const waitMs = Math.max(0, due.getTime() - Date.now()) + 45_000;
  say(`DASH is now closed. Waiting ${String(Math.round(waitMs / 1000))}s with nothing polling…`);
  await sleep(waitMs);

  /* ------------------------------------------------------------------ *
   * 5. DASH reopens: one drain, one write, one view
   * ------------------------------------------------------------------ */

  const drained = (await callRunner(endpoint, token, "/schedules/drain", {})) as {
    settled?: Array<Record<string, unknown>>;
  };
  const settled = drained.settled ?? [];
  say(`the runner had ${String(settled.length)} settled window(s) waiting`);
  for (const row of settled) {
    say(`  ${JSON.stringify(row)}`);
  }

  const written = recordScheduleRuns(settled as never);
  say(`wrote ${String(written)} row(s) into dash.sqlite`);

  const rows = db()
    .prepare("SELECT agent, due_at, settled_at, outcome, detail FROM agent_schedule_runs ORDER BY id")
    .all();
  say(`agent_schedule_runs now holds: ${JSON.stringify(rows)}`);

  const view = buildAgentScheduleView(readAgentSchedule("scout"), readScheduleRuns("scout"));
  say("");
  say("── what the agent page draws on reopen ──────────────────────");
  say(view.standing_line);
  for (const sentence of view.liveness) {
    say(`  · ${sentence}`);
  }
  say(`  · ${view.no_spend}`);
  if (view.last === null) {
    say("Scheduled runs: nothing has come round yet.");
  } else {
    say(`Scheduled runs: [${view.last.outcome_label}] ${view.last.due_at}`);
    say(`  ${view.last.detail}`);
  }
  say("─────────────────────────────────────────────────────────────");
  say("");

  /* ------------------------------------------------------------------ *
   * 6. The verdict
   * ------------------------------------------------------------------ */

  const ran = settled.some((row) => row["outcome"] === "ran");
  if (!ran) {
    say("FAIL: the runner did not report a run for this window.");
    process.exitCode = 1;
  } else if (view.last?.outcome !== "ran") {
    say("FAIL: the run did not reach the agent page.");
    process.exitCode = 1;
  } else {
    say("PASS: the runner started the agent with DASH closed, and the page says so.");
  }

  // The runner is asked to stop rather than killed — it is a process holding a
  // SQLite handle, and this repository's rule about not force-killing one is not
  // suspended because the store is a scratch one.
  try {
    await callRunner(endpoint, token, "/shutdown", {});
  } catch {
    // A runner that closed the socket on its way out is a runner that stopped.
  }
  say(`scratch store left at ${dataDir} for reading`);
}

void main().catch((error: unknown) => {
  console.error(
    `[schedule-proof] failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
  );
  process.exit(1);
});
