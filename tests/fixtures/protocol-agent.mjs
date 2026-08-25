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
 * - `AGENT_TELEMETRY=valid|mixed` emit telemetry candidates for drain tests
 * - `AGENT_CURATE=<n>`   with `AGENT_PENDING=1`, ask the broker to curate `n`
 *                        times when a `retry` lands, and report each answer
 *                        (MAR-784)
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

/*
 * `AGENT_PENDING=1`: start idle with one task waiting to be run (MAR-742 item
 * 8, ADR 0029).
 *
 * This is what the Agent Kit template actually does — it starts idle and stays
 * idle on purpose (MAR-457), publishing the pending task that Run now binds — and
 * it is the shape a schedule fires at. The default state below cannot stand in
 * for it: its one task already carries a `run_id`, so it is a task that is
 * *being* run rather than one waiting to be, and `buildAgentControl`'s predicate
 * correctly refuses to bind it.
 *
 * A separate branch rather than a widened default, so every test that was
 * written against the state below still gets exactly that state.
 *
 * `AGENT_CURATE=<n>` (MAR-784) makes that retry ask for `n` model calls in a
 * row. It exists because the one thing no real agent in this repository can
 * demonstrate is **running out**: the Agent Kit template curates exactly once
 * per run, so a ceiling can only ever be reached by an agent willing to ask past
 * it, and "what happens when a scheduled run hits its ceiling" is half of what
 * ADR 0029 amendment 1 has to prove.
 *
 * It asks serially and reports each answer on its own line, because the fact
 * being proven is an ordering: the first `n` are allowed and the rest are
 * refused with the same word a schedule carrying no allowance at all gets. A
 * burst of parallel asks would prove the same arithmetic and none of the order.
 */
if (process.env.AGENT_PENDING === "1") {
  send({
    type: "state",
    state: {
      status: "idle",
      runs: [],
      tasks: [
        {
          id: "task-waiting-01",
          run_id: null,
          label: "Waiting to be run",
          status: "pending",
          created_at: "2026-08-25T00:00:00Z",
        },
      ],
      actions: [],
      approval_requests: [],
    },
  });
  process.stdin.setEncoding("utf8");
  let pendingBuffer = "";

  /*
   * MAR-784. The pending answers, by request id, so the asks below can be
   * serial. A map rather than a single slot because a later reader will
   * reasonably try to make them parallel, and a single slot would go wrong
   * silently rather than at the type.
   */
  const curateWaiters = new Map();
  const curateCount = Number(process.env.AGENT_CURATE ?? "0");

  /** One brokered ask, resolved when the answer for its id comes back. */
  function askCurate(index) {
    const requestId = `curate-${String(index)}`;
    return new Promise((resolve) => {
      curateWaiters.set(requestId, resolve);
      send({
        type: "broker_request",
        request: {
          request_id: requestId,
          connection_id: "model_provider",
          operation: "openrouter.digest.curate",
          input: {
            material: `1. A lab shipped a smaller model\n2. A round closed at a supervision startup`,
          },
        },
      });
    });
  }

  /**
   * Ask `n` times in a row, then say what happened and finish.
   *
   * The run **completes either way**, which is the half of the degrade worth
   * demonstrating: an agent that ran out of allowance is not an agent that
   * failed, and a fixture that exited non-zero on a refusal would be proving the
   * opposite of ADR 0029 amendment 1's claim.
   */
  async function curateThenFinish() {
    const answers = [];
    for (let index = 1; index <= curateCount; index += 1) {
      answers.push(await askCurate(index));
    }
    const allowed = answers.filter((answer) => answer.ok === true).length;
    const refused = answers.length - allowed;
    console.log(
      `fixture: asked ${String(answers.length)} time(s), ${String(allowed)} allowed, ` +
        `${String(refused)} refused (${answers.map((one) => one.refusal ?? "ok").join(", ")})`,
    );
    send({
      type: "state",
      state: {
        status: "idle",
        runs: [
          {
            id: "run-scheduled-01",
            status: "completed",
            started_at: "2026-08-25T00:00:01Z",
            progress: 1,
          },
        ],
        tasks: [
          {
            id: "task-waiting-01",
            run_id: "run-scheduled-01",
            label: "Waiting to be run",
            status: "completed",
            created_at: "2026-08-25T00:00:00Z",
          },
        ],
        actions: [],
        approval_requests: [],
      },
    });
  }

  process.stdin.on("data", (chunk) => {
    pendingBuffer += chunk;
    let newline = pendingBuffer.indexOf("\n");
    while (newline !== -1) {
      const line = pendingBuffer.slice(0, newline);
      pendingBuffer = pendingBuffer.slice(newline + 1);
      newline = pendingBuffer.indexOf("\n");
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.type === "broker_response") {
        const waiter = curateWaiters.get(message.request_id);
        if (waiter !== undefined) {
          curateWaiters.delete(message.request_id);
          waiter(message);
        }
        continue;
      }
      if (message.type !== "command") {
        continue;
      }
      send({
        type: "ack",
        command_id: message.command_id,
        ok: true,
        detail: "handled by the fixture",
      });
      // The task binds to a run, which is what "the retry actually landed" looks
      // like from outside this process.
      send({
        type: "state",
        state: {
          status: "running",
          runs: [
            {
              id: "run-scheduled-01",
              status: "running",
              started_at: "2026-08-25T00:00:01Z",
              progress: 0.1,
            },
          ],
          tasks: [
            {
              id: "task-waiting-01",
              run_id: "run-scheduled-01",
              label: "Waiting to be run",
              status: "in_progress",
              created_at: "2026-08-25T00:00:00Z",
            },
          ],
          actions: [],
          approval_requests: [],
        },
      });
      // MAR-784. Only when asked for, so every test written against this branch
      // before the flag existed sees exactly what it saw.
      if (curateCount > 0) {
        void curateThenFinish();
      }
    }
  });
  setInterval(() => {}, 60_000);
} else {

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

if (process.env.AGENT_TELEMETRY === "valid" || process.env.AGENT_TELEMETRY === "mixed") {
  send({
    type: "telemetry",
    event: {
      event_version: 1,
      agent: "fixture-agent",
      run_id: "run-telemetry-fixture-01",
      seq: 0,
      ts: "2026-07-29T12:00:00Z",
      type: "run_started",
    },
  });
}

if (process.env.AGENT_TELEMETRY === "mixed") {
  // A valid protocol envelope carrying an invalid telemetry body. DASH must
  // reject this candidate without losing the valid neighbour or stopping us.
  send({ type: "telemetry", event: { event_version: 1 } });
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

}
