/**
 * MAR-595 finding 10: an MCP-planned agent's manifest carries no
 * `agent.display_name`, so DASH rendered its machine slug —
 * `support-mail-digest` — verbatim wherever an agent's name is shown.
 * `humanizeAgentName` is the fallback every such site now shares.
 */

import { describe, expect, it } from "vitest";

import { humanizeAgentName } from "../lib/copy/agent-name";

describe("humanizeAgentName", () => {
  it("turns a hyphenated slug into a sentence-case name", () => {
    expect(humanizeAgentName("support-mail-digest")).toBe("Support mail digest");
  });

  it("turns an underscored slug into a sentence-case name", () => {
    expect(humanizeAgentName("support_mail_digest")).toBe("Support mail digest");
  });

  it("capitalises a single word", () => {
    expect(humanizeAgentName("scout")).toBe("Scout");
  });

  it("leaves an already-readable name alone, beyond the first letter", () => {
    expect(humanizeAgentName("already readable")).toBe("Already readable");
  });

  it("does not touch a name that is already capitalised", () => {
    expect(humanizeAgentName("Already Capitalised")).toBe("Already Capitalised");
  });

  it("falls back to the raw value when there is nothing to humanize", () => {
    expect(humanizeAgentName("")).toBe("");
    expect(humanizeAgentName("---")).toBe("---");
  });
});
