/**
 * Every sentence DASH can say about which machine (MAR-602, ADR 0014).
 *
 * The rule under test is not "the strings read well". It is that **DASH never
 * claims to know where a run happened when it does not**, and that the one
 * place it could get away with a plausible guess — a store holding runs and a
 * deploy record naming a server — produces a limit rather than a guess.
 *
 * Swept over the reachable states rather than over a list somebody maintains,
 * for `tests/evidence-copy.test.ts`'s reason: a state added without being
 * described should still be seen here.
 */

import { describe, expect, it } from "vitest";

import { rawIdentifiersIn } from "../lib/copy/identifiers";
import {
  describeRunOrigin,
  describeRunTarget,
  type RunOriginNotice,
} from "../lib/copy/where-it-ran";
import type { EvidencePullRecord } from "../lib/store";

function pull(overrides: Partial<EvidencePullRecord> = {}): EvidencePullRecord {
  return {
    source: "local",
    kind: "this_machine",
    observed_at: "2026-08-11T09:00:00.000Z",
    reached: true,
    telemetry_dropped: 0,
    artifacts_dropped: 0,
    workspace_truncated: false,
    ...overrides,
  };
}

const HOST_PULL = pull({ source: "host-e3fa1674", kind: "another_machine" });

describe("which machine a run control will use", () => {
  it("says nothing when the agent lives in one place", () => {
    expect(describeRunTarget([])).toBeNull();
  });

  /**
   * The attended run's second consequence, answered. One button meant the local
   * copy and nothing said so, on a page that also showed the deploy.
   */
  it("names this computer, and admits the other copy cannot be started", () => {
    const said = describeRunTarget([{ label: "Hostinger" }]);
    expect(said).toContain("copy on this computer");
    expect(said).toContain("Hostinger");
    expect(said).toContain("cannot start");
    // Names the control, so the sentence is tied to a button rather than
    // floating near one. See the module note about why this is not a suffix.
    expect(said).toContain("Run now");
  });

  it("names every server rather than the first one", () => {
    const said = describeRunTarget([{ label: "Hostinger" }, { label: "the office box" }]);
    expect(said).toContain("Hostinger");
    expect(said).toContain("the office box");
    expect(said).toContain("copies");
  });

  /**
   * ADR 0010's line, asserted from the copy side. `describeRunTarget` is handed
   * only a label by its own parameter type, so there is nothing here that could
   * become "this agent is running on Hostinger" — this pins that the sentence
   * makes no claim about the server's present state either.
   */
  it("claims nothing about what the server is doing", () => {
    const said = describeRunTarget([{ label: "Hostinger" }]) ?? "";
    for (const forbidden of ["is running", "running on", "is live", "is up"]) {
      expect(said).not.toContain(forbidden);
    }
  });
});

describe("which machine a run happened on", () => {
  /**
   * The load-bearing one. An empty record is not evidence that everything ran
   * here — a store can hold runs from before DASH recorded a pull at all — and
   * reading it as a local guarantee would invent the fact this module exists to
   * stop inventing.
   */
  it("says nothing when DASH has never recorded collecting anything", () => {
    expect(describeRunOrigin([])).toBeNull();
  });

  /**
   * True of every store this project has produced: `evidence_pulls` holds one
   * row, `source=local`, and MAR-488's remote drain has never executed against
   * a real host.
   */
  it("states the machine when every source DASH has ever read is this one", () => {
    const said = describeRunOrigin([pull()]) as RunOriginNotice;
    expect(said.unknown).toBe(false);
    expect(said.headline).toContain("this computer");
  });

  it("admits it cannot tell, rather than guessing, once a server is a source", () => {
    const said = describeRunOrigin([pull(), HOST_PULL]) as RunOriginNotice;
    expect(said.unknown).toBe(true);
    expect(said.headline).toContain("cannot tell");
    // The guess it declines to make, in the words it would have used.
    expect(said.headline).not.toContain("ran on this computer");
  });

  it("counts servers without naming one", () => {
    const said = describeRunOrigin([
      pull(),
      HOST_PULL,
      pull({ source: "host-9c02297", kind: "another_machine" }),
    ]) as RunOriginNotice;
    expect(said.meaning).toContain("2 servers");
    expect(said.meaning).not.toContain("host-");
  });
});

describe("plain language", () => {
  /**
   * Both tenses, every reachable state, through the one definition of the rule
   * in the repository. A host id or a source id reaching a screen is exactly the
   * failure `lib/copy/identifiers.ts` was written for, and this module handles
   * two kinds of id.
   */
  it("says nothing a person would have to look up", () => {
    const sentences: string[] = [];

    for (const targets of [[{ label: "Hostinger" }], [{ label: "Hostinger" }, { label: "box two" }]]) {
      const said = describeRunTarget(targets);
      if (said !== null) {
        sentences.push(said);
      }
    }

    for (const pulls of [[pull()], [pull(), HOST_PULL], [HOST_PULL]]) {
      const said = describeRunOrigin(pulls);
      if (said !== null) {
        sentences.push(said.headline, said.meaning);
      }
    }

    expect(sentences.length).toBeGreaterThan(0);
    for (const sentence of sentences) {
      expect(rawIdentifiersIn(sentence, { allow: ["Hostinger", "box two"] })).toEqual([]);
    }
  });
});
