/**
 * The quit path's one rule: it always reaches the end (MAR-678).
 *
 * A thrown error inside a `before-quit` listener does not fail loudly — it
 * cancels the quit, and DASH becomes a windowless process that only a machine
 * restart can clear. So what is asserted here is not that the steps work; it is
 * that a step which does not work cannot stop the ones after it, and cannot stop
 * the exit.
 */

import { describe, expect, it } from "vitest";

import { describeShutdown, runShutdownSteps } from "../lib/shell/shutdown";

describe("the shutdown sequence", () => {
  it("runs every step in order", () => {
    const order: string[] = [];
    const outcome = runShutdownSteps(
      [
        { name: "polling", run: () => order.push("polling") },
        { name: "broker", run: () => order.push("broker") },
        { name: "store", run: () => order.push("store") },
      ],
      () => undefined,
    );

    expect(order).toEqual(["polling", "broker", "store"]);
    expect(outcome.completed).toEqual(["polling", "broker", "store"]);
    expect(outcome.failed).toEqual([]);
  });

  it("keeps going when a step throws, and names the one that did", () => {
    const order: string[] = [];
    const lines: string[] = [];
    const outcome = runShutdownSteps(
      [
        { name: "polling", run: () => order.push("polling") },
        {
          name: "broker",
          run: () => {
            throw new Error("the broker was already gone");
          },
        },
        { name: "store", run: () => order.push("store") },
      ],
      (line) => lines.push(line),
    );

    // The step after the failure is the point. Without this, one bad teardown
    // means the store is never checkpointed and the app never exits.
    expect(order).toEqual(["polling", "store"]);
    expect(outcome.completed).toEqual(["polling", "store"]);
    expect(outcome.failed).toEqual([{ name: "broker", detail: "the broker was already gone" }]);
    expect(lines).toEqual([
      '[dash-shell] shutdown step "broker" failed: the broker was already gone',
    ]);
  });

  it("describes a throw that is not an Error", () => {
    const outcome = runShutdownSteps(
      [
        {
          name: "browser",
          run: () => {
            throw "gone";
          },
        },
      ],
      () => undefined,
    );

    expect(outcome.failed).toEqual([{ name: "browser", detail: "gone" }]);
  });

  it("summarises what ran and what did not", () => {
    expect(describeShutdown({ completed: ["a", "b"], failed: [] })).toBe("2 steps ok");
    expect(describeShutdown({ completed: ["a"], failed: [] })).toBe("1 step ok");
    expect(
      describeShutdown({ completed: ["a"], failed: [{ name: "b", detail: "no" }] }),
    ).toBe("1 step ok, failed: b");
  });
});
