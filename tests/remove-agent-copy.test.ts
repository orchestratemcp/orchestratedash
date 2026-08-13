/**
 * MAR-595 finding 18: DASH had a removal backend (`removeAgentWithReport`,
 * `removeAgentFolder`) that no UI reached, and Henrik asked for two distinct
 * actions rather than one button with a hidden mode. This pins the copy each
 * one shows before it does anything — the two sentences must not agree about
 * whether the agent's files survive, because that is the one fact separating
 * them.
 */

import { describe, expect, it } from "vitest";

import { describeAgentRemoval, describeStrandedByRemoval } from "../lib/copy/remove-agent";
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

/**
 * MAR-611, ADR 0017. The gate Henrik asked for on the bring-home issue: a
 * removal that would strand a copy on a server has to say so before either of
 * `describeAgentRemoval`'s two sentences are offered.
 */
describe("describeStrandedByRemoval", () => {
  it("names the one server", () => {
    const copy = describeStrandedByRemoval("Folder digest", ["My server"]);
    expect(copy.headline).toContain("Folder digest");
    expect(copy.headline).toContain("My server");
    expect(copy.detail).toMatch(/that server/);
    expect(copy.detail).not.toMatch(/those servers/);
  });

  it("names two servers with 'and', and more than two as a list", () => {
    const two = describeStrandedByRemoval("Folder digest", ["First", "Second"]);
    expect(two.headline).toContain("First and Second");

    const three = describeStrandedByRemoval("Folder digest", ["First", "Second", "Third"]);
    expect(three.headline).toContain("First, Second, and Third");
    expect(three.detail).toMatch(/those servers/);
  });

  it("never claims removal here touches the copy there", () => {
    const copy = describeStrandedByRemoval("Folder digest", ["My server"]);
    expect(copy.detail).toMatch(/does not touch the copy/);
    expect(copy.detail).toMatch(/keeps running there/);
  });

  it("offers bringing it home before offering to proceed", () => {
    const copy = describeStrandedByRemoval("Folder digest", ["My server"]);
    expect(copy.bring_home_label).toMatch(/bring it home/i);
    expect(copy.proceed_label).toMatch(/remove/i);
  });

  it("stays in plain language", () => {
    const copy = describeStrandedByRemoval("Folder digest", ["First", "Second"]);
    expectPlainLanguage([copy.headline, copy.detail, copy.bring_home_label, copy.proceed_label]);
  });
});
