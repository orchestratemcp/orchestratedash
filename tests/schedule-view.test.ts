/**
 * What the Settings stage says about a schedule (MAR-742 item 8, ADR 0029).
 *
 * The planner being right and the panel saying something else is the specific
 * way a scheduler loses somebody's trust, because the sentence is the only
 * evidence they have. So the sentence has its own tests.
 */

import { describe, expect, it } from "vitest";

import { AGENT_TRIGGER_COPY } from "../lib/copy/agent-page";
import { buildAgentScheduleView, residentHostLabel } from "../lib/views/agent-schedule";
import type { AgentSchedule, ScheduleSettlement } from "../lib/schedule/plan";

const standing: AgentSchedule = {
  agent: "scout",
  enabled: true,
  kind: "daily",
  at_local: "08:00",
  created_at: "2026-08-24T12:00:00.000Z",
  allowance_calls: 0,
};

/** MAR-784. The same schedule with the switch on. */
const allowing: AgentSchedule = { ...standing, allowance_calls: 2 };

function settled(
  outcome: ScheduleSettlement["outcome"],
  due = "2026-08-25T06:00:00.000Z",
  allowance = 0,
): ScheduleSettlement {
  return {
    agent: "scout",
    due_at: due,
    settled_at: "2026-08-25T06:00:12.000Z",
    outcome,
    detail: "A sentence the runner wrote.",
    allowance_calls: allowance,
  };
}

describe("an agent nobody has scheduled", () => {
  it("says so, and says nothing else", () => {
    const view = buildAgentScheduleView(null, []);
    expect(view.at_local).toBeNull();
    expect(view.standing_line).toBe(AGENT_TRIGGER_COPY.none_standing);
    expect(view.last).toBeNull();
  });

  /**
   * The liveness sentences and the spend sentence are about *your schedule*.
   *
   * Under a panel with none they would be DASH explaining the limits of a
   * feature nobody has asked for — the *"describing its own internals at
   * somebody who came to look at their agent"* failure `ModelChoice` names, and
   * the reason that component draws nothing for an agent with no model.
   */
  it("does not explain the limits of a feature nobody has asked for", () => {
    const view = buildAgentScheduleView(null, []);
    expect(view.liveness).toEqual([]);
    expect(view.spend_line).toBe("");
    // MAR-784. The bound on a permission nobody has is not a sentence anybody
    // needs, and printing it would be the same failure with an extra line.
    expect(view.spend_bound).toBe("");
  });
});

describe("an agent with a schedule", () => {
  it("says the time back in the person's own terms", () => {
    const view = buildAgentScheduleView(standing, []);
    expect(view.at_local).toBe("08:00");
    expect(view.standing_line).toContain("08:00");
    expect(view.standing_line).toContain("this computer");
  });

  it("carries all three liveness sentences and the spend one", () => {
    const view = buildAgentScheduleView(standing, []);
    expect(view.liveness).toHaveLength(3);
    expect(view.spend_line).toBe(AGENT_TRIGGER_COPY.spend.none);
    /*
     * MAR-784. The default schedule says exactly what it said before the
     * ceiling existed — the whole of ADR 0029 decision 6, on screen, for
     * anybody who has not opted in. And no second sentence: the "only while
     * DASH is open" bound is about an allowance, and there is not one.
     */
    expect(view.allowance_calls).toBe(0);
    expect(view.spend_bound).toBe("");
  });

  /**
   * A row with `enabled` false should not exist — turning a schedule off deletes
   * it — so if one ever reaches here it is read as no schedule rather than as a
   * cadence that is somehow standing and off at once.
   */
  it("treats a disabled row as no schedule at all", () => {
    const view = buildAgentScheduleView({ ...standing, enabled: false }, []);
    expect(view.at_local).toBeNull();
    expect(view.standing_line).toBe(AGENT_TRIGGER_COPY.none_standing);
  });
});

describe("what became of the last window", () => {
  it("shows the newest and counts what is behind it", () => {
    const view = buildAgentScheduleView(standing, [
      settled("missed", "2026-08-27T06:00:00.000Z"),
      settled("ran", "2026-08-26T06:00:00.000Z"),
      settled("ran", "2026-08-25T06:00:00.000Z"),
    ]);
    expect(view.last?.due_at).toBe("2026-08-27T06:00:00.000Z");
    expect(view.settled_count).toBe(3);
  });

  it("words each outcome", () => {
    expect(buildAgentScheduleView(standing, [settled("ran")]).last?.outcome_label).toBe("Ran");
    expect(buildAgentScheduleView(standing, [settled("missed")]).last?.outcome_label).toBe("Missed");
    expect(buildAgentScheduleView(standing, [settled("refused")]).last?.outcome_label).toBe(
      "Did not start",
    );
  });

  /**
   * A missed window is a warning and not an error, and the distinction is the
   * whole content of the two values: the computer was not there, nothing is
   * broken, and colouring it red would send somebody to fix a laptop that was
   * asleep because they closed it.
   *
   * ## MAR-874 moved `refused` onto the same side, for the same reason
   *
   * It used to be `err`. The argument for red — DASH tried and something said
   * no — assumed the person could do something about the no, and on the case
   * this issue was filed from they cannot: a scheduled window for an agent
   * living on a server settles as *Did not start* because the remote start is
   * MAR-864's gap, and DASH painted that red on the person's own Settings stage
   * as though they had misconfigured something.
   *
   * The invariant the assertion protects is unchanged, and it is now asserted
   * directly: **red on this page means you have something to fix**, so nothing
   * an ordinary person cannot act on may claim it. The finer answer, a tone per
   * refusal reason, needs the settlement to carry one and it does not.
   *
   * The sentence is untouched either way — `detail` is the runner's own words
   * and the test below still pins them verbatim — so a colour that is honest
   * about whose problem this is hides nothing.
   */
  it("keeps every outcome a person cannot act on out of the error colour", () => {
    expect(buildAgentScheduleView(standing, [settled("ran")]).last?.outcome_tone).toBe("ok");
    expect(buildAgentScheduleView(standing, [settled("missed")]).last?.outcome_tone).toBe("warn");
    expect(buildAgentScheduleView(standing, [settled("refused")]).last?.outcome_tone).toBe("warn");
    for (const outcome of ["ran", "missed", "refused"] as const) {
      expect(
        buildAgentScheduleView(standing, [settled(outcome)]).last?.outcome_tone,
        outcome,
      ).not.toBe("err");
    }
  });

  /**
   * The runner's own sentence, verbatim.
   *
   * A receipt in ADR 0012's sense: the detail says what happened and DASH's
   * paraphrase of it would be a second account of an event nobody watched.
   */
  it("keeps the runner's own sentence rather than restating it", () => {
    const view = buildAgentScheduleView(standing, [settled("missed")]);
    expect(view.last?.detail).toBe("A sentence the runner wrote.");
  });

  /**
   * ADR 0029: the history outlives the instruction, so the panel still shows it
   * after somebody turns the cadence off — which is exactly when they are
   * looking for it.
   */
  it("survives the schedule being turned off", () => {
    const view = buildAgentScheduleView(null, [settled("refused")]);
    expect(view.standing_line).toBe(AGENT_TRIGGER_COPY.none_standing);
    expect(view.last?.outcome).toBe("refused");
  });
});

/**
 * Which machine the panel names (MAR-874).
 *
 * ## The defect
 *
 * Every sentence this view composed said *this computer* — three times in
 * `liveness`, once in `standing_line`, once in the field's hint. For an agent
 * DASH has **enrolled** on a server all of them were about the wrong machine:
 * `splitSchedules` in `electron/host-residency.ts` takes an enrolled agent's
 * schedule out of the local runner's push and sends it to that server's own
 * runner, deliberately, so one instruction cannot produce two runs. So the
 * panel was promising a helper on a laptop that is no longer told about the
 * row, and warning about that laptop being asleep.
 *
 * ## The predicate is residency, not deployment
 *
 * That distinction is the one a reader of these tests most needs. Residency is
 * a switch that is off until somebody presses it, so an agent merely *sent* to
 * a server still runs its schedule here — which is why `residentHostLabel`
 * takes the resident set rather than the deploy rows.
 *
 * ## What is not fixed here
 *
 * `at_local` still carries no timezone, and on a server it still means that
 * server's local time rather than the person's. That conversion is MAR-872's,
 * and none of these assertions pretends otherwise: what they pin is that DASH
 * stops naming the wrong clock, which is the half that can be told today.
 */
describe("an agent whose schedule a server keeps", () => {
  const onServer = (): ReturnType<typeof buildAgentScheduleView> =>
    buildAgentScheduleView(standing, [], null, "My server");

  it("names the server rather than this computer, in every sentence", () => {
    const view = onServer();
    expect(view.resident_on).toBe("My server");
    expect(view.standing_line).toBe(AGENT_TRIGGER_COPY.standing_on_host("08:00", "My server"));
    expect(view.standing_line).not.toContain("this computer");
    for (const sentence of view.liveness) {
      expect(sentence).not.toContain("this computer");
    }
    expect(view.liveness).toHaveLength(3);
  });

  /**
   * ADR 0029's third sentence, kept whole.
   *
   * The whole risk of moving these onto a server is that the honest admission
   * gets lost with the machine's name. It does not: something being unreachable
   * still runs nothing, DASH still reports the window as missed, and DASH still
   * never quietly catches up.
   */
  it("keeps saying what a schedule cannot survive, about the right machine", () => {
    const sleeping = onServer().liveness[2] ?? "";
    expect(sleeping).toContain("My server");
    expect(sleeping).toContain("nothing runs");
    expect(sleeping).toContain("missed");
    expect(sleeping).toContain("does not run it late");
  });

  /**
   * The field's own label, which is the one sentence that has to be right
   * *before* there is a schedule as well as after.
   *
   * An enrolled agent's new schedule goes to its server the moment it is saved,
   * so this reads `residentOn` rather than the standing schedule — the one
   * place in the builder where those two come apart.
   */
  it("labels the time field with the clock that will read it", () => {
    expect(buildAgentScheduleView(null, [], null, "My server").time_hint).toBe(
      AGENT_TRIGGER_COPY.time_hint_on_host("My server"),
    );
    expect(buildAgentScheduleView(null, []).time_hint).toBe(AGENT_TRIGGER_COPY.time_hint);
  });

  it("says this computer for an agent nobody has enrolled", () => {
    const view = buildAgentScheduleView(standing, []);
    expect(view.resident_on).toBeNull();
    expect(view.liveness).toEqual(AGENT_TRIGGER_COPY.liveness);
    expect(view.standing_line).toBe(AGENT_TRIGGER_COPY.standing("08:00"));
  });
});

/**
 * `residentHostLabel` — the read side of `splitSchedules` (MAR-874).
 *
 * Pure and dependency-injected so the residency rule can be asked about
 * without a store, which is this module's own standing rule about its clock
 * applied to a table.
 */
describe("which server keeps an agent's schedule", () => {
  const label = (id: string): { label: string } | null =>
    id === "vps" ? { label: "My server" } : null;

  it("names the server an enrolled agent is on", () => {
    expect(
      residentHostLabel("scout", [{ host_id: "vps", agents: ["scout", "other"] }], label),
    ).toBe("My server");
  });

  it("says nothing for an agent on a server with residency off", () => {
    expect(residentHostLabel("scout", [], label)).toBeNull();
    expect(
      residentHostLabel("scout", [{ host_id: "vps", agents: ["other"] }], label),
    ).toBeNull();
  });

  /**
   * A host row DASH can no longer read is not an error here.
   *
   * The sentences are the point, and a schedule described as this computer's is
   * the state they were written for and are safe in. Inventing a name, or
   * falling back to an id, would put a machine identifier into prose.
   */
  it("falls back to this computer rather than naming a server it cannot read", () => {
    expect(
      residentHostLabel("scout", [{ host_id: "gone", agents: ["scout"] }], label),
    ).toBeNull();
  });
});
