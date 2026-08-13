/**
 * The four marks a fleet card is allowed to draw (status + local/cloud).
 */

import { describe, expect, it } from "vitest";

import { GLANCE_ALL_CLEAR, type GlanceChip } from "../lib/copy/glance";
import {
  describeFleetCardStatus,
  describeFleetPlace,
} from "../lib/copy/fleet-status";
import { expectPlainLanguage } from "./helpers/plain-language";

function chip(over: Partial<GlanceChip>): GlanceChip {
  return {
    question: "needs_you",
    label: "needs your approval",
    meaning: "One thing is waiting for you.",
    tone: "warn",
    ...over,
  };
}

describe("the one status a card draws", () => {
  it("puts something waiting on you above a run in flight", () => {
    const status = describeFleetCardStatus({
      running: true,
      run_count: 3,
      glance: [chip({ question: "needs_you" })],
    });
    expect(status?.id).toBe("needs_input");
    expect(status?.label).toBe("Needs input");
  });

  it("says working when a run is in flight and nothing is waiting", () => {
    expect(
      describeFleetCardStatus({
        running: true,
        run_count: 1,
        glance: [GLANCE_ALL_CLEAR],
      })?.id,
    ).toBe("working");
  });

  it("says ready for review when there is new output", () => {
    expect(
      describeFleetCardStatus({
        running: false,
        run_count: 2,
        glance: [chip({ question: "new_output", tone: "accent", label: "new output" })],
      })?.label,
    ).toBe("Ready for review");
  });

  it("says completed only after the agent has actually run", () => {
    expect(
      describeFleetCardStatus({
        running: false,
        run_count: 4,
        glance: [GLANCE_ALL_CLEAR],
      })?.id,
    ).toBe("completed");
    expect(
      describeFleetCardStatus({
        running: false,
        run_count: 0,
        glance: [GLANCE_ALL_CLEAR],
      }),
    ).toBeNull();
  });

  it("speaks plain language", () => {
    const labels = [
      describeFleetCardStatus({ running: true, run_count: 1, glance: [GLANCE_ALL_CLEAR] })?.label,
      describeFleetCardStatus({
        running: false,
        run_count: 1,
        glance: [chip({ question: "needs_you" })],
      })?.label,
      describeFleetPlace([]).label,
      describeFleetPlace([{ host_id: "h1" }]).label,
    ];
    expectPlainLanguage(labels.filter((one): one is string => one !== undefined));
  });
});

describe("local or cloud", () => {
  it("is local when DASH has never sent the agent anywhere", () => {
    expect(describeFleetPlace([])).toEqual({ id: "local", label: "Local" });
  });

  it("is cloud when DASH has sent it to a server", () => {
    expect(describeFleetPlace([{ host_id: "h1" }])).toEqual({ id: "cloud", label: "Cloud" });
  });
});
