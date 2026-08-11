/**
 * The words DASH uses about which window you are in (MAR-432, DASH-20).
 *
 * These strings exist because the packaged app and a browser tab can do
 * different things, and `docs/design-brief.md` requires a developer surface to
 * be marked as one rather than quietly offering less. They are on the guided
 * path — a novice can reach every page that carries them — so they are held to
 * the same rule as everything else there.
 */

import { describe, expect, it } from "vitest";

import { describeImportUnavailable, describeReadOnlyHost } from "../lib/copy/host";
import { describeViewFailure } from "../lib/copy/recovery";
import { expectPlainLanguage } from "./helpers/plain-language";

describe("describeReadOnlyHost", () => {
  it("says nothing in the window that can act", () => {
    expect(describeReadOnlyHost("shell")).toBeNull();
  });

  it("says what the browser cannot do, and does not call it a mode", () => {
    const notice = describeReadOnlyHost("browser");
    expect(notice).not.toBeNull();
    // "Read-only mode" sounds like a setting somebody could turn off. It is not
    // a mode; it is which window you are standing in.
    expect(`${notice?.headline ?? ""} ${notice?.meaning ?? ""}`).not.toMatch(/mode/i);
  });

  it("is plain language", () => {
    const notice = describeReadOnlyHost("browser");
    expectPlainLanguage([notice?.headline ?? "", notice?.meaning ?? ""]);
  });
});

describe("describeImportUnavailable", () => {
  it("says nothing where the form works", () => {
    expect(describeImportUnavailable("browser")).toBeNull();
  });

  it("offers the path that does work here, rather than only naming the gap", () => {
    const notice = describeImportUnavailable("shell");
    expect(notice).not.toBeNull();
    /*
     * A failure with no next action is not finished being designed. The next
     * action here is the page's own primary control.
     *
     * MAR-598 moved it. This used to assert "two steps above", which described
     * two terminal commands at the top of the page — and after that page led
     * with a button instead, the sentence pointed at the wrong part of the
     * screen for the wrong thing. Asserted as *naming the folder*, which is what
     * the control does, rather than as a position, which is what went stale.
     */
    expect(notice?.meaning).toMatch(/choosing the agent's folder/);
    expect(notice?.meaning).not.toMatch(/steps above/);
  });

  it("is plain language", () => {
    const notice = describeImportUnavailable("shell");
    expectPlainLanguage([notice?.headline ?? "", notice?.meaning ?? ""]);
  });
});

describe("describeViewFailure", () => {
  it("names all three things a failure has to name", () => {
    for (const reason of ["unreachable", "refused"] as const) {
      const recovery = describeViewFailure(reason);
      expect(recovery.headline.length).toBeGreaterThan(0);
      expect(recovery.meaning.length).toBeGreaterThan(0);
      expect(recovery.next_action.length).toBeGreaterThan(0);
    }
  });

  it("never blames the user for either", () => {
    // Neither of these can be the user's doing. `refused` is DASH's outright,
    // and says so — "not something you did" is the same exoneration
    // `describeSecureStoreFailure` gives the fault it owns.
    expect(describeViewFailure("refused").actor).toBe("dash");
    for (const reason of ["unreachable", "refused"] as const) {
      const recovery = describeViewFailure(reason);
      // "Invalid" is the word the design brief names as an accusation with no
      // next step. Nothing here may reach for it.
      expect(`${recovery.headline} ${recovery.meaning}`).not.toMatch(/\binvalid\b/i);
    }
  });

  it("is plain language", () => {
    for (const reason of ["unreachable", "refused"] as const) {
      const recovery = describeViewFailure(reason);
      expectPlainLanguage([recovery.headline, recovery.meaning, recovery.next_action]);
    }
  });
});
