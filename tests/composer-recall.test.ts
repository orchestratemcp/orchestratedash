/**
 * `↑`/`↓` question recall, pure (MAR-742 roadmap item 1, §4.6 addition 1).
 *
 * `sendsOnEnter`'s own reason, restated: every render test in this
 * repository is `renderToStaticMarkup`, which fires no key event, so the
 * walk a key press drives has to be provable independent of a DOM. This
 * tests `recallAt` directly — what the field should show at each step of the
 * walk — which is the same split `composer-in-flight.test.tsx` already makes
 * between "the guard" (a pure function, tested here) and "the real thing"
 * (a person's own fingers, which no test in this repository can imitate).
 */

import { describe, expect, it } from "vitest";

import { recallAt } from "../app/_components/composer";

const QUESTIONS = ["what needs me", "who reads the news", "how is budget digest doing"];

describe("recallAt", () => {
  it("returns the draft when nothing has been recalled yet", () => {
    expect(recallAt(QUESTIONS, 0, "half-typed")).toBe("half-typed");
  });

  it("returns the draft for a negative index too, rather than throwing", () => {
    expect(recallAt(QUESTIONS, -1, "half-typed")).toBe("half-typed");
  });

  it("returns the newest question first", () => {
    expect(recallAt(QUESTIONS, 1, "")).toBe("how is budget digest doing");
  });

  it("walks further back one step per index", () => {
    expect(recallAt(QUESTIONS, 2, "")).toBe("who reads the news");
    expect(recallAt(QUESTIONS, 3, "")).toBe("what needs me");
  });

  it("stays on the oldest question rather than wrapping past it", () => {
    expect(recallAt(QUESTIONS, 4, "")).toBe("what needs me");
    expect(recallAt(QUESTIONS, 100, "")).toBe("what needs me");
  });

  it("returns the draft when there is nothing kept to recall", () => {
    expect(recallAt([], 1, "half-typed")).toBe("half-typed");
  });

  it("walking down from index 1 is the same as index 0 — the draft", () => {
    // `↓`'s own claim: from the newest question, one step forward restores
    // whatever was there before the first `↑`.
    const draft = "half-typed";
    expect(recallAt(QUESTIONS, 1, draft)).toBe("how is budget digest doing");
    expect(recallAt(QUESTIONS, 0, draft)).toBe(draft);
  });
});
