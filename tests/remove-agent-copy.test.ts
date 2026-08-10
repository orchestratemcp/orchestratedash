/**
 * MAR-595 finding 18: DASH had a removal backend (`removeAgentWithReport`,
 * `removeAgentFolder`) that no UI reached, and Henrik asked for two distinct
 * actions rather than one button with a hidden mode. This pins the copy each
 * one shows before it does anything — the two sentences must not agree about
 * whether the agent's files survive, because that is the one fact separating
 * them.
 */

import { describe, expect, it } from "vitest";

import { describeAgentRemoval } from "../lib/copy/remove-agent";
import { expectPlainLanguage } from "./helpers/plain-language";

describe("describeAgentRemoval", () => {
  it("says the files stay, for the keep-files mode", () => {
    const copy = describeAgentRemoval("Folder digest", "keep_files");
    expect(copy.headline).toContain("Folder digest");
    expect(copy.detail).toMatch(/stays on this computer/);
    expect(copy.confirm_label).toBe("Remove from DASH");
  });

  it("says the files are deleted, for the delete-files mode", () => {
    const copy = describeAgentRemoval("Folder digest", "delete_files");
    expect(copy.headline).toContain("Folder digest");
    expect(copy.detail).toMatch(/delete DASH's own copy/);
    expect(copy.confirm_label).toBe("Remove and delete all files");
  });

  it("never claims the other mode's outcome", () => {
    const keep = describeAgentRemoval("Folder digest", "keep_files");
    const remove = describeAgentRemoval("Folder digest", "delete_files");
    expect(keep.detail).not.toMatch(/delete/i);
    expect(remove.detail).toMatch(/delete/i);
  });

  it("never claims to touch the agent's original project", () => {
    for (const mode of ["keep_files", "delete_files"] as const) {
      const copy = describeAgentRemoval("Folder digest", mode);
      expect(copy.detail).toMatch(/does not touch the project you built it in/);
    }
  });

  it("stays in plain language", () => {
    for (const mode of ["keep_files", "delete_files"] as const) {
      const copy = describeAgentRemoval("Folder digest", mode);
      expectPlainLanguage([copy.headline, copy.detail, copy.confirm_label]);
    }
  });
});
