/**
 * The state the runner publishes (MAR-415).
 *
 * This is where the issue's third acceptance criterion lives — "killing an
 * agent process shows it as stopped in DASH within one poll interval, not as
 * healthy". The failure it forbids is specific and easy to write by accident: a
 * dead agent's last self-report says `running`, so any builder that trusts the
 * agent's own status reports a healthy agent forever.
 *
 * Every case below is therefore some version of "the agent said X and the
 * runner observed Y; which one reaches DASH".
 */

import { describe, expect, it } from "vitest";

import { validateState } from "../lib/contracts";
import { buildAgentDomState, type ProcessFacts } from "../runner/state";

const NOW = new Date("2026-07-25T12:00:00Z");

function facts(overrides: Partial<ProcessFacts> = {}): ProcessFacts {
  return {
    agent_id: "fixture-agent",
    pid: 4242,
    lifecycle: "running",
    exit_code: null,
    exit_signal: null,
    started_at: "2026-07-25T11:00:00Z",
    ...overrides,
  };
}

/** What a live agent last said about itself, including a run in flight. */
const LIVE_REPORT = {
  status: "running",
  runs: [
    { id: "run-1", status: "running", started_at: "2026-07-25T11:00:00Z", progress: 0.4 },
  ],
  tasks: [
    {
      id: "task-1",
      run_id: "run-1",
      label: "Draft the reply",
      status: "in_progress",
      created_at: "2026-07-25T11:00:00Z",
    },
  ],
};

describe("a live agent", () => {
  it("may describe itself", () => {
    const state = buildAgentDomState(facts(), { ...LIVE_REPORT, status: "needs_attention" }, NOW);
    expect(state["status"]).toBe("needs_attention");
  });

  it("is 'ready' while it is still starting, whatever it claims", () => {
    const state = buildAgentDomState(facts({ lifecycle: "starting" }), LIVE_REPORT, NOW);
    expect(state["status"]).toBe("ready");
  });

  it("cannot claim a status that is a statement about its process", () => {
    // `offline` and `error` are the runner's to assert. An agent claiming them
    // while its process runs is describing something no observation supports.
    for (const claimed of ["offline", "error", "nonsense"]) {
      const state = buildAgentDomState(facts(), { ...LIVE_REPORT, status: claimed }, NOW);
      expect(state["status"]).toBe("running");
    }
  });

  it("keeps its runs and tasks", () => {
    const state = buildAgentDomState(facts(), LIVE_REPORT, NOW);
    expect(state["runs"]).toHaveLength(1);
    expect((state["runs"] as Array<{ status: string }>)[0]?.status).toBe("running");
  });
});

describe("an agent whose process is gone", () => {
  it("is offline after a clean exit, not whatever it last claimed", () => {
    const state = buildAgentDomState(
      facts({ lifecycle: "exited", pid: null, exit_code: 0 }),
      LIVE_REPORT,
      NOW,
    );
    expect(state["status"]).toBe("offline");
  });

  it("is in error after a non-zero exit", () => {
    const state = buildAgentDomState(
      facts({ lifecycle: "exited", pid: null, exit_code: 1 }),
      LIVE_REPORT,
      NOW,
    );
    expect(state["status"]).toBe("error");
  });

  it("is in error after being killed by a signal", () => {
    // The acceptance criterion's literal case: someone killed the process.
    const state = buildAgentDomState(
      facts({ lifecycle: "exited", pid: null, exit_code: null, exit_signal: "SIGKILL" }),
      LIVE_REPORT,
      NOW,
    );
    expect(state["status"]).toBe("error");
  });

  it("is in error when it never started", () => {
    const state = buildAgentDomState(facts({ lifecycle: "failed_to_start", pid: null }), null, NOW);
    expect(state["status"]).toBe("error");
  });

  it("closes out a run that was still running", () => {
    // Left as `running`, this is the row that would draw a live agent in DASH.
    const state = buildAgentDomState(
      facts({ lifecycle: "exited", pid: null, exit_code: 1 }),
      LIVE_REPORT,
      NOW,
    );
    expect((state["runs"] as Array<{ status: string }>)[0]?.status).toBe("failed");
  });

  it("leaves a run the agent had already finished alone", () => {
    const state = buildAgentDomState(
      facts({ lifecycle: "exited", pid: null, exit_code: 0 }),
      {
        runs: [
          { id: "run-1", status: "completed", started_at: "2026-07-25T11:00:00Z", progress: 1 },
        ],
      },
      NOW,
    );
    expect((state["runs"] as Array<{ status: string }>)[0]?.status).toBe("completed");
  });

  it("offers no controls, because there is nothing to control", () => {
    const state = buildAgentDomState(
      facts({ lifecycle: "exited", pid: null, exit_code: 0 }),
      { ...LIVE_REPORT, actions: [{ id: "a" }], approval_requests: [{ id: "ap" }], choices: [{ id: "c" }] },
      NOW,
    );
    expect(state["actions"]).toEqual([]);
    expect(state["approval_requests"]).toEqual([]);
    expect(state["choices"]).toEqual([]);
  });
});

describe("what the agent is not allowed to set", () => {
  it("cannot name a different agent", () => {
    // An agent that could choose its own id could write state over its
    // neighbour's.
    const state = buildAgentDomState(facts(), { ...LIVE_REPORT, agent_id: "somebody-else" }, NOW);
    expect(state["agent_id"]).toBe("fixture-agent");
  });

  it("cannot choose its own observed_at", () => {
    // DASH's stale-display check binds to this value; an agent picking it could
    // make an old snapshot look current.
    const state = buildAgentDomState(
      facts(),
      { ...LIVE_REPORT, observed_at: "1999-01-01T00:00:00Z" },
      NOW,
    );
    expect(state["observed_at"]).toBe(NOW.toISOString());
  });

  it("cannot inject unknown top-level keys", () => {
    const state = buildAgentDomState(facts(), { ...LIVE_REPORT, surprise: "hello" }, NOW);
    expect(state["surprise"]).toBeUndefined();
  });
});

describe("the document itself", () => {
  it("satisfies the contract for a live agent", () => {
    const validation = validateState(buildAgentDomState(facts(), LIVE_REPORT, NOW));
    expect(validation.ok, JSON.stringify(validation)).toBe(true);
  });

  it("satisfies the contract for an agent that has never run", () => {
    // plan_vs_actual.run_id is required and has a minimum length, so the
    // never-run case is the one most likely to emit an invalid document.
    const validation = validateState(
      buildAgentDomState(facts({ lifecycle: "stopped", pid: null }), null, NOW),
    );
    expect(validation.ok, JSON.stringify(validation)).toBe(true);
  });

  it("satisfies the contract for a crashed agent", () => {
    const validation = validateState(
      buildAgentDomState(
        facts({ lifecycle: "exited", pid: null, exit_signal: "SIGKILL" }),
        LIVE_REPORT,
        NOW,
      ),
    );
    expect(validation.ok, JSON.stringify(validation)).toBe(true);
  });

  it("uses a placeholder run id rather than inventing one", () => {
    const state = buildAgentDomState(facts({ lifecycle: "stopped", pid: null }), null, NOW);
    expect((state["plan_vs_actual"] as { run_id: string }).run_id).toBe("none");
  });

  it("declares no connections rather than guessing at health it cannot see", () => {
    expect(buildAgentDomState(facts(), LIVE_REPORT, NOW)["connections"]).toEqual([]);
  });
});
