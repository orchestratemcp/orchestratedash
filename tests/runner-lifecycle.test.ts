/**
 * MAR-597. When is a stop true?
 *
 * The finding: two manifest-only agents nobody could remove, because removal
 * asks the runner to stop them, the runner has never heard of them, and its
 * refusal was read as "could not confirm the stop". These tests pin the
 * decision extracted into lib/runner-lifecycle.ts: the runner's own list is
 * the authority, in both directions.
 */
import { describe, expect, it } from "vitest";

import { runnerLifecycle, type RunnerCall } from "../lib/runner-lifecycle";

const ORIGIN = "http://runner.test";
const AUTH = { authorization: "Bearer test-token" };

interface Script {
  /** What POST /agents/{id}/lifecycle answers. */
  lifecycle: { ok?: boolean; detail?: string };
  /** What GET /agents lists, per call, last entry repeating. */
  lists: Array<Array<{ agent_id: string; lifecycle: string }>>;
  /** When true, GET /agents answers with a non-ok response. */
  listFails?: boolean;
}

function scripted(script: Script): { call: RunnerCall; counts: { lifecycle: number; list: number } } {
  const counts = { lifecycle: 0, list: 0 };
  const call: RunnerCall = (url) => {
    if (url.includes("/lifecycle")) {
      counts.lifecycle += 1;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(script.lifecycle),
      });
    }
    counts.list += 1;
    if (script.listFails === true) {
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    }
    const index = Math.min(counts.list - 1, script.lists.length - 1);
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ agents: script.lists[index] ?? [] }),
    });
  };
  return { call, counts };
}

const fast = { waitMs: 200, pollMs: 10 };

describe("a stop the runner refused", () => {
  it("is true anyway for an agent absent from the runner's list — the MAR-597 case", async () => {
    const { call, counts } = scripted({
      lifecycle: { ok: false, detail: "unknown agent" },
      lists: [[]],
    });
    const { lifecycle } = runnerLifecycle(call, ORIGIN, AUTH, fast);
    const outcome = await lifecycle("mar421-approval-proof", "stop");
    expect(outcome.ok).toBe(true);
    // One look, not a poll: the refusal path consults the list exactly once.
    expect(counts.list).toBe(1);
  });

  it("is true for an agent the list shows already stopped", async () => {
    const { call } = scripted({
      lifecycle: { ok: false, detail: "not running" },
      lists: [[{ agent_id: "old-scout", lifecycle: "exited" }]],
    });
    const { lifecycle } = runnerLifecycle(call, ORIGIN, AUTH, fast);
    expect((await lifecycle("old-scout", "stop")).ok).toBe(true);
  });

  it("stays refused for an agent the list shows running — the guard is not weakened", async () => {
    const { call } = scripted({
      lifecycle: { ok: false, detail: "stop failed" },
      lists: [[{ agent_id: "live-agent", lifecycle: "running" }]],
    });
    const { lifecycle } = runnerLifecycle(call, ORIGIN, AUTH, fast);
    const outcome = await lifecycle("live-agent", "stop");
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toBe("stop failed");
  });

  it("stays refused when the list itself does not answer", async () => {
    const { call } = scripted({
      lifecycle: { ok: false, detail: "stop failed" },
      lists: [],
      listFails: true,
    });
    const { lifecycle } = runnerLifecycle(call, ORIGIN, AUTH, fast);
    expect((await lifecycle("any-agent", "stop")).ok).toBe(false);
  });
});

describe("a stop the runner accepted", () => {
  it("is only true once the list agrees", async () => {
    const { call } = scripted({
      lifecycle: { ok: true },
      lists: [
        [{ agent_id: "winding-down", lifecycle: "running" }],
        [{ agent_id: "winding-down", lifecycle: "stopped" }],
      ],
    });
    const { lifecycle } = runnerLifecycle(call, ORIGIN, AUTH, fast);
    expect((await lifecycle("winding-down", "stop")).ok).toBe(true);
  });

  it("is refused when the list never agrees within the wait", async () => {
    const { call } = scripted({
      lifecycle: { ok: true },
      lists: [[{ agent_id: "stuck", lifecycle: "running" }]],
    });
    const { lifecycle } = runnerLifecycle(call, ORIGIN, AUTH, fast);
    const outcome = await lifecycle("stuck", "stop");
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain("did not confirm");
  });
});

describe("a start", () => {
  it("passes the route's answer through untouched", async () => {
    const { call, counts } = scripted({ lifecycle: { ok: true }, lists: [] });
    const { lifecycle } = runnerLifecycle(call, ORIGIN, AUTH, fast);
    expect((await lifecycle("any-agent", "start")).ok).toBe(true);
    expect(counts.list).toBe(0);
  });
});
