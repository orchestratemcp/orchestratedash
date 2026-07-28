/**
 * Finding a deep link in an argument vector (MAR-428).
 *
 * Small, and worth its own file because the inputs are real: the argv shapes
 * below are what Windows actually hands a second instance on the packaged path
 * and on the developer path, and getting either wrong means the user clicks
 * "Open in DASH" and nothing happens.
 */

import { describe, expect, it } from "vitest";

import { findDeepLink } from "../lib/shell/deep-link";

const URL = "dash://handoff?v=1&file=C%3A%5Cprojects%5Ca%5Cdash-handoff.json&nonce=" + "a".repeat(64);

describe("findDeepLink", () => {
  it("finds the link a packaged Windows launch appends", () => {
    expect(findDeepLink(["C:\\Program Files\\WindowsApps\\OrchestrateDASH.exe", URL])).toBe(URL);
  });

  it("finds it past the developer path's own arguments", () => {
    // `electron.exe <project> <url>` — an earlier argument is a real path, and
    // preferring the last match is what keeps that from being mistaken for one.
    expect(
      findDeepLink(["C:\\...\\electron.exe", "C:\\projects\\orchestratedash", URL]),
    ).toBe(URL);
  });

  it("finds nothing in an ordinary launch", () => {
    expect(findDeepLink(["electron.exe", "."])).toBeNull();
    expect(findDeepLink([])).toBeNull();
  });

  it("is not fooled by a scheme that merely starts the same way", () => {
    expect(findDeepLink(["dashboard://something"])).toBeNull();
  });

  it("hands on a malformed DASH link rather than dropping it", () => {
    // A link silently dropped here looks, to the person who clicked it, exactly
    // like DASH being broken. The refusal belongs in lib/handoff-flow.ts, where
    // it can be explained.
    expect(findDeepLink(["dash://handoff?nonsense"])).toBe("dash://handoff?nonsense");
  });
});
