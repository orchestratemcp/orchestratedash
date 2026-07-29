/**
 * Your agent.
 *
 * One file, no dependencies, and three things wired for you:
 *
 * 1. **DASH can watch it.** It publishes what it is doing on stdout, in the
 *    shape DASH's runner understands, every couple of seconds.
 * 2. **DASH can control it.** Pause, resume, cancel and retry arrive on stdin
 *    and are acknowledged. An unacknowledged command is reported as
 *    unacknowledged rather than assumed to have worked, so the acknowledgement
 *    below is not a formality.
 * 3. **It records what it did.** Every run appends events to `runs/events.jsonl`
 *    in the telemetry v1 format, and posts them to DASH if this process was
 *    given somewhere to post them.
 *
 * The part that is yours is `runOnce`. Everything else is plumbing you should
 * be able to ignore.
 *
 * ## The one rule worth knowing
 *
 * Write your own logging with `log()`, not `console.log`. Anything that is not
 * one of this protocol's messages is treated as ordinary logging and forwarded
 * to DASH's log — which is fine and deliberate — but a stray `console.log` of a
 * JSON object that happens to have a `type` field would be read as a protocol
 * message. `log()` prefixes its output so that cannot happen.
 */

import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.dirname(fileURLToPath(import.meta.url));
const inboxDir = path.join(projectDir, process.env.DIGEST_FOLDER ?? "inbox");
const reportsDir = path.join(projectDir, "reports");
const runsDir = path.join(projectDir, "runs");

/** How often the agent tells DASH what it is doing. */
const PUBLISH_INTERVAL_MS = 2_000;
/** How long the agent waits between runs when nothing asks it to run. */
const RUN_INTERVAL_MS = 30_000;

/* ---------------------------------------------------------------------- *
 * The work. This part is yours.
 * ---------------------------------------------------------------------- */

/**
 * One run.
 *
 * `report` is how you say what happened; `step` marks a stage of the work so
 * DASH can show progress and so the run's events say more than "it started and
 * then it stopped".
 */
async function runOnce({ step }) {
  step("local_folder_read", "Reading the inbox folder");
  let entries = [];
  try {
    entries = readdirSync(inboxDir, { withFileTypes: true }).filter((entry) => entry.isFile());
  } catch {
    // A missing inbox is an empty inbox, not a failure. An agent that crashes
    // because a folder it was told to watch does not exist yet is an agent
    // nobody trusts to run unattended.
    entries = [];
  }

  step("local_file_write", "Writing the report");
  const summary = {
    generated_at: new Date().toISOString(),
    folder: inboxDir,
    file_count: entries.length,
    files: entries.map((entry) => entry.name).sort(),
  };

  mkdirSync(reportsDir, { recursive: true });
  const reportFile = path.join(reportsDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(reportFile, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  return `Counted ${String(entries.length)} file${entries.length === 1 ? "" : "s"}.`;
}

/* ---------------------------------------------------------------------- *
 * Talking to DASH
 * ---------------------------------------------------------------------- */

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

/** Ordinary logging. Goes to DASH's log; never mistaken for a protocol message. */
function log(line) {
  process.stdout.write(`[agent] ${line}\n`);
}

/* ---------------------------------------------------------------------- *
 * Telemetry v1
 * ---------------------------------------------------------------------- */

/**
 * The agent's own name, read from the manifest beside this file.
 *
 * Read rather than hard-coded so that renaming the agent is one edit in one
 * place — and the place is the manifest, which is the document DASH holds this
 * agent to. A fallback rather than a crash: the name is a monitoring detail,
 * not a precondition for doing the work.
 */
const AGENT_NAME = (() => {
  try {
    const manifest = JSON.parse(
      readFileSync(path.join(projectDir, "agent.manifest.json"), "utf8"),
    );
    return String(manifest?.agent?.name ?? "agent");
  } catch {
    return "agent";
  }
})();

const ingestUrl = process.env.DASH_INGEST_URL;
const ingestToken = process.env.DASH_INGEST_TOKEN;

/**
 * Emit one telemetry v1 event.
 *
 * Always to disk, and to DASH as well when this process was given somewhere to
 * post. The local file is the primary record on purpose: an agent whose history
 * exists only in whatever happened to be listening is an agent with no history.
 *
 * `seq` is monotonic within a run, which is what lets a monitor spot a gap.
 */
function emit(event) {
  const line = JSON.stringify({ event_version: 1, agent: AGENT_NAME, ...event });
  try {
    mkdirSync(runsDir, { recursive: true });
    appendFileSync(path.join(runsDir, "events.jsonl"), `${line}\n`, "utf8");
  } catch (error) {
    log(`could not record an event: ${String(error)}`);
  }

  if (ingestUrl === undefined) {
    return;
  }
  const headers = { "content-type": "application/json" };
  if (ingestToken !== undefined) {
    headers.authorization = `Bearer ${ingestToken}`;
  }
  // Fire and forget: a monitor that is not listening must not stop the work.
  fetch(ingestUrl, { method: "POST", headers, body: line }).catch(() => {});
}

/* ---------------------------------------------------------------------- *
 * State
 * ---------------------------------------------------------------------- */

const state = {
  /** "running" | "paused" | "ready" — what a live agent may call itself. */
  status: "ready",
  runs: [],
  tasks: [],
  paused: false,
  /** Set while a run is in flight, so a cancel can reach it. */
  current: null,
};

/**
 * Publish what the agent knows about itself.
 *
 * Note what is *not* here: any claim about whether this process is alive. The
 * runner owns that, because it started the process and this process cannot
 * honestly report its own death. Sending `status: "running"` from a program
 * that is about to crash is exactly the report that would make DASH draw a
 * healthy agent forever.
 */
function publish() {
  send({
    type: "state",
    state: {
      status: state.paused ? "paused" : state.status,
      runs: state.runs.slice(-10),
      tasks: state.tasks.slice(-20),
    },
  });
}

function startRun() {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  let seq = 0;

  const run = { id: runId, status: "running", started_at: startedAt, progress: 0 };
  state.runs.push(run);
  state.status = "running";
  emit({ run_id: runId, seq: seq++, ts: startedAt, type: "run_started" });

  const step = (componentId, label) => {
    const ts = new Date().toISOString();
    state.tasks.push({
      id: randomUUID(),
      run_id: runId,
      label,
      status: "in_progress",
      created_at: ts,
    });
    run.current_step = componentId;
    run.progress = Math.min(0.9, run.progress + 0.4);
    emit({ run_id: runId, seq: seq++, ts, type: "step_started", component_id: componentId });
    publish();
  };

  const finish = (type, detail, status) => {
    run.status = status;
    run.progress = 1;
    run.finished_at = new Date().toISOString();
    for (const task of state.tasks) {
      if (task.run_id === runId && task.status === "in_progress") {
        task.status = status === "completed" ? "completed" : status;
      }
    }
    state.status = "ready";
    state.current = null;
    emit({ run_id: runId, seq: seq++, ts: run.finished_at, type, detail });
    publish();
  };

  state.current = { runId, cancel: () => finish("run_failed", "Cancelled from DASH.", "cancelled") };

  runOnce({ step })
    .then((detail) => {
      if (state.current?.runId === runId || run.status === "running") {
        finish("run_completed", detail, "completed");
      }
    })
    .catch((error) => {
      finish("run_failed", String(error instanceof Error ? error.message : error), "failed");
    });

  return runId;
}

/* ---------------------------------------------------------------------- *
 * Commands from DASH
 * ---------------------------------------------------------------------- */

/**
 * Handle one command and say what happened.
 *
 * Returning `{ ok: false }` is a refusal, and DASH shows it as one. That is a
 * better answer than silently ignoring a command DASH offered — a control that
 * does nothing is worse than a control that says no.
 */
function handleCommand(message) {
  switch (message.command) {
    case "retry":
      if (state.current !== null) {
        return { ok: false, detail: "A run is already in progress." };
      }
      startRun();
      return { ok: true, detail: "Started a new run." };

    case "pause":
      state.paused = true;
      publish();
      return { ok: true, detail: "Paused. No new runs will start." };

    case "resume":
      state.paused = false;
      publish();
      return { ok: true, detail: "Resumed." };

    case "cancel":
      if (state.current === null) {
        return { ok: false, detail: "There is no run to cancel." };
      }
      state.current.cancel();
      return { ok: true, detail: "Cancelled the current run." };

    default:
      // Everything else, including the three approval verbs this agent's
      // manifest deliberately does not declare.
      return { ok: false, detail: `This agent does not support "${String(message.command)}".` };
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\n");
  while (newline !== -1) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    newline = buffer.indexOf("\n");

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message?.type !== "command") {
      continue;
    }

    const result = handleCommand(message);
    // Acknowledgement is mandatory. A line written to a pipe proves nothing
    // about whether this process read it, so DASH settles an unacknowledged
    // command as unacknowledged rather than as success.
    send({ type: "ack", command_id: message.command_id, ok: result.ok, detail: result.detail });
  }
});

/* ---------------------------------------------------------------------- *
 * Running
 * ---------------------------------------------------------------------- */

process.on("SIGTERM", () => {
  log("stopping");
  process.exit(0);
});

log(`watching ${inboxDir}`);
publish();
startRun();

setInterval(publish, PUBLISH_INTERVAL_MS).unref?.();
setInterval(() => {
  if (!state.paused && state.current === null) {
    startRun();
  }
}, RUN_INTERVAL_MS);
