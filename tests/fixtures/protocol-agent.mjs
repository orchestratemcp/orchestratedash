/**
 * A minimal agent that speaks the runner protocol.
 *
 * Not a mock of the runner's own code — a real, separate Node process that the
 * supervisor really spawns, really writes to, and really kills. That is the
 * point: the supervision tests would prove very little against a fake child,
 * because "does a SIGTERM actually stop this" is the question.
 *
 * The Agent Kit (MAR-415's second slice) is what makes real Claude Agent SDK
 * agents speak this. This fixture speaks the same protocol in thirty lines so
 * the runner can be proven before the Kit exists.
 *
 * Behaviour is switched by environment variable so one fixture covers the
 * cases:
 *
 * - `AGENT_ACK=refuse`   acknowledge every command with `ok: false`
 * - `AGENT_ACK=never`    never acknowledge, to exercise the delivery timeout
 * - `AGENT_IGNORE_TERM=1` ignore SIGTERM, to exercise the SIGKILL escalation
 * - `AGENT_NOISE=1`      write non-protocol lines, which must be tolerated
 */

const ack = process.env.AGENT_ACK ?? "ok";

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

if (process.env.AGENT_IGNORE_TERM === "1") {
  process.on("SIGTERM", () => {
    send({ type: "state", state: { status: "running" } });
  });
}

if (process.env.AGENT_NOISE === "1") {
  console.log("starting up, this is ordinary agent logging");
  console.log("{ not json either");
}

// The agent's contribution to its own Agent DOM state. The runner merges this
// with what it observed; nothing here can claim the process is alive.
send({
  type: "state",
  state: {
    status: "running",
    runs: [
      {
        id: "run-fixture-01",
        status: "running",
        started_at: "2026-07-25T10:00:00Z",
        progress: 0.5,
      },
    ],
    tasks: [
      {
        id: "task-fixture-01",
        run_id: "run-fixture-01",
        label: "Draft the reply",
        status: "waiting_for_approval",
        created_at: "2026-07-25T10:00:00Z",
      },
    ],
    actions: [
      {
        id: "action-fixture-01",
        task_id: "task-fixture-01",
        label: "Send the reply",
        command: "approve",
        approval_required: true,
        approval: { enforcement: "runner_enforced", request_id: "approval-fixture-01" },
      },
    ],
    approval_requests: [
      {
        id: "approval-fixture-01",
        task_id: "task-fixture-01",
        action_id: "action-fixture-01",
        label: "Send the reply",
        status: "pending",
        requested_at: "2026-07-25T10:00:00Z",
        expires_at: process.env.AGENT_APPROVAL_EXPIRES_AT ?? "2099-01-01T00:00:00Z",
        runner_enforced: true,
        audit: { correlation_id: "corr-fixture-01" },
      },
    ],
  },
});

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
    if (message.type !== "command" || ack === "never") {
      continue;
    }
    send({
      type: "ack",
      command_id: message.command_id,
      ok: ack !== "refuse",
      detail: ack === "refuse" ? "the fixture was told to refuse" : "handled by the fixture",
    });
  }
});

// Stay alive until something stops us. This is what makes the process real
// enough for a kill to mean something.
setInterval(() => {}, 60_000);
