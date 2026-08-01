import { describe, expect, it } from "vitest";

import { runnerIdentityMatches } from "../electron/runner-process";
import { RUNNER_BUILD_ID, RUNNER_PROTOCOL_VERSION } from "../runner/identity";

describe("runner adoption identity", () => {
  const current = {
    runner_build: RUNNER_BUILD_ID,
    runner_protocol: RUNNER_PROTOCOL_VERSION,
  };

  it("adopts only when the endpoint file and live health both match this build", () => {
    expect(runnerIdentityMatches(current, current)).toBe(true);
  });

  it("does not adopt a pre-identity runner merely because it is alive", () => {
    expect(runnerIdentityMatches({}, {})).toBe(false);
  });

  it("does not adopt when either the file or the answering process is stale", () => {
    expect(runnerIdentityMatches({ ...current, runner_build: "old" }, current)).toBe(false);
    expect(runnerIdentityMatches(current, { ...current, runner_build: "old" })).toBe(false);
    expect(
      runnerIdentityMatches(current, {
        ...current,
        runner_protocol: RUNNER_PROTOCOL_VERSION + 1,
      }),
    ).toBe(false);
  });
});
