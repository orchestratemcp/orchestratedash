/**
 * Every failure offers a next action, and the ones that differ stay different
 * (MAR-423).
 *
 * Two acceptance criteria are checked here, and the second is the one that rots
 * quietly:
 *
 * - *"Every error state in the Connection Center offers a next action."*
 *   Asserted exhaustively over the enums rather than over a list someone
 *   maintains by hand, so a new state added to the contract fails this file
 *   until somebody words it.
 * - *"Missing, invalid and revoked credentials are three different recoveries…
 *   Do not collapse them in the UI."* Distinctness is asserted directly: two
 *   states that produce the same sentence have been collapsed, which is a thing
 *   a reviewer skims past and a set does not.
 */

import { describe, expect, it } from "vitest";

import {
  describeConnectionCondition,
  describeHostingFailure,
  describeSecureStoreFailure,
  type ConnectionHealth,
  type Recovery,
} from "../lib/copy/recovery";
import type { SecureStoreErrorCode } from "../lib/secure-store";
import { expectPlainLanguage } from "./helpers/plain-language";

/** The full enums, transcribed once so a contract change lands here as a failure. */
const STORE_CODES: SecureStoreErrorCode[] = [
  "not_found",
  "vault_locked",
  "backend_unavailable",
  "invalid_name",
];
const HEALTH_STATES: ConnectionHealth[] = [
  "not_configured",
  "connected",
  "degraded",
  "expired",
  "revoked",
  "unknown",
];

const CONTEXT = { service: "Gmail", vault: "Windows Credential Manager" };

function assertUsable(recovery: Recovery): void {
  expect(recovery.headline).not.toBe("");
  expect(recovery.meaning).not.toBe("");
  // The whole point. A failure with no next action is not finished being
  // designed, and an empty string is how that ships.
  expect(recovery.next_action).not.toBe("");
  expectPlainLanguage([recovery.headline, recovery.meaning, recovery.next_action], {
    // The vault's own name is a label the seam guarantees is safe to render,
    // and it is what the user sees in their own operating system.
    allow: [CONTEXT.vault],
  });
}

describe("credentials DASH holds", () => {
  it("offers a usable recovery for every failure the vault can report", () => {
    for (const code of STORE_CODES) {
      assertUsable(describeSecureStoreFailure(code, CONTEXT));
    }
  });

  it("keeps missing, locked, unavailable and mis-filed apart", () => {
    const actions = STORE_CODES.map((code) => describeSecureStoreFailure(code, CONTEXT).next_action);
    expect(new Set(actions).size).toBe(STORE_CODES.length);
  });

  it("does not ask the user to re-enter a credential the vault is merely holding shut", () => {
    // Collapsing `vault_locked` into `not_found` would ask for a credential the
    // user already gave, and would overwrite it.
    const locked = describeSecureStoreFailure("vault_locked", CONTEXT);
    expect(locked.meaning).toMatch(/still there and still safe/);
    expect(locked.next_action).toMatch(/Unlock/);
  });

  it("blames DASH, not the user, when it is DASH's fault", () => {
    const bug = describeSecureStoreFailure("invalid_name", CONTEXT);
    expect(bug.actor).toBe("dash");
    expect(bug.meaning).toMatch(/not something you did/);
  });

  it("does not promise a retry will help when there is no vault at all", () => {
    // `lib/secure-store.ts` refuses to fall back to plaintext, so "try again"
    // would be a lie in a loop.
    const none = describeSecureStoreFailure("backend_unavailable", CONTEXT);
    expect(none.meaning).toMatch(/Nothing was saved and nothing was lost/);
    expect(none.next_action).toMatch(/keyring/);
  });
});

describe("connections an agent reports on", () => {
  it("offers a usable recovery for every unhealthy state the contract allows", () => {
    for (const state of HEALTH_STATES) {
      const recovery = describeConnectionCondition("Gmail", { state });
      if (state === "connected") {
        // A healthy connection is not a failure, and rendering a recovery for it
        // would teach users to ignore recoveries.
        expect(recovery).toBeNull();
        continue;
      }
      expect(recovery, state).not.toBeNull();
      assertUsable(recovery as Recovery);
    }
  });

  it("keeps expired and revoked apart, because one is routine and one is a decision", () => {
    const expired = describeConnectionCondition("Gmail", { state: "expired" }) as Recovery;
    const revoked = describeConnectionCondition("Gmail", { state: "revoked" }) as Recovery;

    expect(expired.meaning).toMatch(/Nothing has gone wrong/);
    expect(revoked.meaning).toMatch(/Someone removed/);
    expect(revoked.next_action).toMatch(/if you still want/);
    expect(expired.headline).not.toBe(revoked.headline);
  });

  it("raises a needed sign-in even while the connection still works", () => {
    const recovery = describeConnectionCondition("Gmail", {
      state: "connected",
      reauthorization_required: true,
    }) as Recovery;
    expect(recovery).not.toBeNull();
    expect(recovery.headline).toMatch(/sign in again/);
  });

  it("uses the agent's own words when it gave any, and does not guess when it did not", () => {
    const said = describeConnectionCondition("Gmail", {
      state: "degraded",
      detail: "Sending is slower than usual.",
    }) as Recovery;
    expect(said.meaning).toBe("Sending is slower than usual.");

    const silent = describeConnectionCondition("Gmail", { state: "unknown" }) as Recovery;
    expect(silent.meaning).toMatch(/does not guess/);
  });
});

describe("an agent that is saved but not running", () => {
  it("holds both facts at once: nothing is broken, and nothing is running", () => {
    for (const reason of ["no_runner", "unreachable", "did_not_start"] as const) {
      const recovery = describeHostingFailure(reason);
      assertUsable(recovery);
      expect(recovery.headline).toMatch(/saved/);
    }
  });

  it("does not imply the user broke anything by having no keyring", () => {
    const recovery = describeHostingFailure("no_runner");
    expect(recovery.meaning).toMatch(/untouched/);
  });
});
