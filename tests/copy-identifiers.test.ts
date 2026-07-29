/**
 * The rule that MAR-423's acceptance criterion is checked with (MAR-423).
 *
 * A detector that nothing tests is a detector that can quietly stop detecting,
 * at which point every surface asserting against it passes for the wrong
 * reason — the worst failure mode available to this design, because it is
 * silent and it is green.
 *
 * So this file tests the rule in both directions: the identifiers it must catch,
 * and the ordinary sentences it must not flag.
 */

import { describe, expect, it } from "vitest";

import {
  describeRawIdentifiers,
  isPlainLanguage,
  rawIdentifiersIn,
} from "../lib/copy/identifiers";

function kinds(text: string, options?: Parameters<typeof rawIdentifiersIn>[1]): string[] {
  return rawIdentifiersIn(text, options).map((finding) => `${finding.kind}:${finding.text}`);
}

describe("what counts as a raw identifier", () => {
  it("catches environment variable names", () => {
    expect(kinds("Set DASH_INGEST_URL before starting.")).toEqual([
      "environment_variable:DASH_INGEST_URL",
    ]);
  });

  it("catches internal field names", () => {
    expect(kinds("The manifest_path did not match.")).toEqual(["internal_field:manifest_path"]);
    expect(kinds("agent_dom declares no connections")).toContain("internal_field:agent_dom");
  });

  it("catches provider scopes, as URLs and as dotted strings", () => {
    expect(kinds("Grant https://www.googleapis.com/auth/calendar.events")).toEqual([
      "provider_scope:https://www.googleapis.com/auth/calendar.events",
    ]);
    expect(kinds("Approve calendar.events.readonly for this agent.")).toEqual([
      "provider_scope:calendar.events.readonly",
    ]);
  });

  it("catches the artifact filename the issue names, and blames the right contract", () => {
    // "Import agent.manifest.json" is the exact phrase MAR-423 calls meaningless
    // to a normal person. It is also shaped exactly like a dotted scope, so this
    // asserts the reported *kind* too: a message that sent its reader to the
    // wrong schema would be worse than no message.
    expect(kinds("Import agent.manifest.json to add an agent.")).toEqual([
      "artifact_file:agent.manifest.json",
    ]);
  });

  it("does not flag ordinary sentences", () => {
    const calm = [
      "Folder digest is already in DASH. Nothing was added twice.",
      "That link has expired. Run Open in DASH again from the agent's folder.",
      "It needs no accounts and no passwords.",
      "Your Gmail sign-in has expired. This happens on a schedule Gmail sets.",
      "Windows Credential Manager is locked, so DASH could not read it.",
      "Create invite and save Gmail draft: Tuesday at 10:00 (30 minutes)?",
    ];
    for (const sentence of calm) {
      expect(isPlainLanguage(sentence), sentence).toBe(true);
    }
  });

  it("does not flag a single capitalised word or a hyphenated agent name", () => {
    // `PATH` alone is a word; two segments make it a variable. And every agent
    // the Agent Kit creates is kebab-cased, so a rule that flagged those would
    // fire on copy that is doing the right thing.
    expect(kinds("The PATH is fine and folder-digest is running.")).toEqual([]);
  });
});

describe("exemptions are made at the call site", () => {
  const prompt =
    "It runs from the folder you created: C:\\Users\\sam\\folder-digest\n" +
    "DASH will start it by running: node dist/agent.mjs";

  it("flags a command line and a project folder when nothing allows them", () => {
    // Not because they are wrong to show — the design brief says they are right
    // to show — but because the detector must not decide that for itself.
    expect(rawIdentifiersIn(prompt).length).toBeGreaterThan(0);
  });

  it("passes once the caller says which strings are content", () => {
    expect(
      rawIdentifiersIn(prompt, {
        allow: ["C:\\Users\\sam\\folder-digest", "node dist/agent.mjs"],
      }),
    ).toEqual([]);
  });
});

describe("values a surface must not leak", () => {
  it("catches opaque ids that no general rule could recognise", () => {
    // `approval-meeting-01` is shaped like an ordinary hyphenated word. Only the
    // test rendering that content knows it is an id, which is why `forbid`
    // exists and why it is the caller's job to fill it.
    expect(
      kinds("Approve approval-meeting-01?", { forbid: ["approval-meeting-01"] }),
    ).toEqual(["forbidden_value:approval-meeting-01"]);
  });
});

describe("the failure message", () => {
  it("names the word and what to do instead", () => {
    const message = describeRawIdentifiers(rawIdentifiersIn("Approve calendar.events.readonly"));
    expect(message).toContain("calendar.events.readonly");
    expect(message).toContain("label");
  });

  it("says so plainly when there is nothing wrong", () => {
    expect(describeRawIdentifiers([])).toBe("no raw identifiers");
  });
});
