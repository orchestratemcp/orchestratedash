/** The local run creation seam, including MAR-507's files-first order. */

import { describe, expect, it } from "vitest";

import { startLocalRun, type FreshRunTarget } from "../lib/run-control";

describe("startLocalRun", () => {
  it("starts without manufacturing a task when the agent published none", async () => {
    const calls: string[] = [];
    const targets: FreshRunTarget[] = [];

    const started = await startLocalRun(
      null,
      () => {
        calls.push("dispatch");
        return Promise.resolve(true);
      },
      (target) => {
        calls.push("retry");
        targets.push(target);
        return Promise.resolve();
      },
    );

    expect(started).toBe(true);
    expect(calls).toEqual(["dispatch", "retry"]);
    expect(targets).toEqual([{}]);
  });

  it("keeps a published task as the more specific retry target", async () => {
    const targets: FreshRunTarget[] = [];
    await startLocalRun(
      "task-1",
      () => Promise.resolve(true),
      (target) => {
        targets.push(target);
        return Promise.resolve();
      },
    );

    expect(targets).toEqual([{ task_id: "task-1" }]);
  });

  it("never retries when file dispatch is refused", async () => {
    let retried = false;
    const started = await startLocalRun(
      null,
      () => Promise.resolve(false),
      () => {
        retried = true;
        return Promise.resolve();
      },
    );

    expect(started).toBe(false);
    expect(retried).toBe(false);
  });
});
