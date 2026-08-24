/**
 * MAR-748: `scripts/verify-shell.mjs` must never let a zero-proof `shell:smoke`
 * run read as a pass. `scripts/verify-shell-lib.mjs` holds the pure judgment —
 * counting PASS/FAIL lines and recognising the lock-loss message
 * `electron/main.ts` logs — so it is driven here with fixture strings instead
 * of an actual Electron spawn.
 */

import { describe, expect, it } from "vitest";

import { countProofLines, describeSmokeFailure, LOCK_HELD_MARKER } from "../scripts/verify-shell-lib.mjs";

const REAL_PROOF_OUTPUT = [
  "[smoke] store: C:\\Users\\dev\\AppData\\Roaming\\orchestratedash",
  "PASS  0. store location: {\"resolved\":true}",
  "FAIL  1a. ping round trip: {\"ok\":false}",
  "PASS  1b. preload bridge: {\"ok\":true}",
  "",
  "[smoke] FAILED: 1a. ping round trip",
].join("\n");

const LOCK_LOSS_OUTPUT = [
  "[dash-shell] store: C:\\Users\\dev\\AppData\\Roaming\\orchestratedash (app_name=orchestratedash)",
  `[dash-shell] ${LOCK_HELD_MARKER} for userData "C:\\Users\\dev\\AppData\\Roaming\\orchestratedash" — quitting (exit 0 by design, MAR-428).`,
].join("\n");

describe("countProofLines", () => {
  it("counts every PASS and FAIL line", () => {
    expect(countProofLines(REAL_PROOF_OUTPUT)).toBe(3);
  });

  it("is zero for output with no check() lines at all", () => {
    expect(countProofLines(LOCK_LOSS_OUTPUT)).toBe(0);
    expect(countProofLines("")).toBe(0);
  });

  it("does not match PASS/FAIL as a substring of another word", () => {
    expect(countProofLines("this is a PASSING mention, not a check() line\nFAILURE too")).toBe(0);
  });
});

describe("describeSmokeFailure", () => {
  it("trusts a run that produced at least one proof line, regardless of exit code", () => {
    expect(describeSmokeFailure(REAL_PROOF_OUTPUT, 1)).toBeNull();
    expect(describeSmokeFailure(REAL_PROOF_OUTPUT, 0)).toBeNull();
  });

  it("names the single-instance lock when that message is present and nothing ran", () => {
    const reason = describeSmokeFailure(LOCK_LOSS_OUTPUT, 0);
    expect(reason).not.toBeNull();
    expect(reason).toContain("single-instance lock");
    expect(reason).toContain("never force-kill");
  });

  it("still fails a silent zero-proof exit 0 that carries no lock message", () => {
    const reason = describeSmokeFailure("some unrelated crash output\n", 0);
    expect(reason).not.toBeNull();
    expect(reason).toContain("0 shell proofs ran");
    expect(reason).not.toContain("single-instance lock");
  });

  it("fails a zero-proof run even when the child's own exit code was non-zero", () => {
    // A crash before the first check() call must not read as "the smoke
    // failed correctly" either — there is nothing here to trust either way.
    const reason = describeSmokeFailure("Fatal error: could not find app entry\n", 1);
    expect(reason).not.toBeNull();
  });
});
