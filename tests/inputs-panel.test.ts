/**
 * The vocabulary and the view model for task inputs (MAR-507).
 *
 * `tests/inputs-render.test.tsx` renders the component; this covers the two
 * things a render cannot show. First, that a role id never becomes a label —
 * which a rendering test can only check for the roles it happens to build.
 * Second, that absence of a `task_inputs` block means *this agent takes no
 * files* rather than *this agent takes anything*, which is a distinction with no
 * visual difference at all and is the one the schema warns about by name.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  INPUTS_PANEL_COPY,
  describeInputRole,
  describeInputState,
} from "../lib/copy/inputs";
import { buildInputRoles, declaredLimitsFor } from "../lib/views/inputs";
import { expectPlainLanguage } from "./helpers/plain-language";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function example(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(repoRoot, "examples", name), "utf8")) as Record<
    string,
    unknown
  >;
}

/** A manifest that declares two roles, the shape MAR-434's schema describes. */
const DECLARING = {
  agent_dom: {
    task_inputs: [
      {
        id: "customer_brief",
        label: "Customer brief",
        description: "The document describing what the customer asked for.",
        required: true,
        max_count: 1,
        media_types: ["application/pdf", "text/plain"],
      },
      {
        id: "price_list",
        label: "Price list",
        required: false,
        max_count: 3,
      },
    ],
  },
};

describe("the declared roles", () => {
  it("reads the manifest's own labels and carries the ids without rendering them", () => {
    const roles = buildInputRoles(DECLARING);
    expect(roles.map((role) => role.label)).toEqual(["Customer brief", "Price list"]);
    // The id travels for the command and is the one field a page must not
    // print — `BrokerCapabilityView.id` is here for the same reason.
    expect(roles.map((role) => role.id)).toEqual(["customer_brief", "price_list"]);
  });

  it("says nothing at all for an agent that declares no block", () => {
    /*
     * The distinction the schema calls out by name: every agent shipped before
     * `task_inputs` existed declares nothing, and absence must never read as an
     * unrestricted agent. An empty list is what the panel turns into "this agent
     * does not take files"; a non-empty one it could not have derived would be a
     * file picker for an agent that has nowhere to put the file.
     */
    expect(buildInputRoles({ agent_dom: {} })).toEqual([]);
    expect(buildInputRoles(null)).toEqual([]);
    expect(buildInputRoles({ agent_dom: { task_inputs: "yes please" } })).toEqual([]);
  });

  it("no shipped example declares one, and that is the honest answer today", () => {
    // Recorded rather than assumed. The panel is invisible in the product until
    // a manifest declares the block, and a test that quietly passed on an
    // example that had grown one would hide the day that changed.
    for (const file of [
      "agent.manifest.example.json",
      "agent-managed.manifest.v2.example.json",
      "gmail-meeting-assistant.manifest.v2.example.json",
      "dash-managed.manifest.v2.example.json",
      "dash-managed-secret.manifest.v2.example.json",
    ]) {
      expect(buildInputRoles(example(file))).toEqual([]);
    }
  });

  it("drops a role that could not be headed with the author's own words", () => {
    // A card headed with a raw id is the leak `lib/copy/identifiers.ts` exists
    // to prevent; a card headed "Untitled" invites a person to hand a document
    // to something that could not describe what it wanted.
    const roles = buildInputRoles({
      agent_dom: {
        task_inputs: [
          { id: "no_label", required: true },
          { label: "No id", required: true },
          { id: "good", label: "Good", required: true },
        ],
      },
    });
    expect(roles.map((role) => role.id)).toEqual(["good"]);
  });

  it("reads an absent `required` as needed", () => {
    // The safe direction, and the schema's own argument: a renderer guessing
    // `false` lets a task start missing the file it exists to read.
    const [role] = buildInputRoles({
      agent_dom: { task_inputs: [{ id: "x", label: "X" }] },
    });
    expect(role?.required).toBe(true);
    expect(role?.requirement).toContain("cannot start without");
  });
});

describe("what a card says", () => {
  it("is plain language throughout", () => {
    for (const role of buildInputRoles(DECLARING)) {
      expectPlainLanguage(
        [role.label, role.purpose ?? "", role.requirement, role.accepts ?? ""],
      );
    }
    expectPlainLanguage(Object.values(INPUTS_PANEL_COPY));
  });

  it("never prints a media type", () => {
    // `application/pdf` is a technical identifier by this project's own rule,
    // and a card that printed it would be exactly the leak the copy test exists
    // for.
    const [brief] = buildInputRoles(DECLARING);
    expect(brief?.accepts).toBe("Accepts PDF and plain text files.");
    expect(brief?.accepts).not.toContain("/");
  });

  it("says nothing about types when the manifest narrowed none", () => {
    // Null reads as "not narrowed", which is true. "Any file" would promise a
    // person that a 4 GiB video is welcome, when the runner's own ceilings still
    // apply.
    expect(buildInputRoles(DECLARING)[1]?.accepts).toBeNull();
    expect(describeInputRole({ label: "X", required: true, media_types: [] }).accepts).toBeNull();
    // Every declared type unmapped is also "not narrowed" rather than "narrowed
    // to nothing" — the alternative would be a card claiming the agent accepts
    // no files at all.
    expect(
      describeInputRole({ label: "X", required: true, media_types: ["application/x-vnd.acme"] })
        .accepts,
    ).toBeNull();
  });

  it("keeps one name for the formats DASH cannot tell apart", () => {
    // The schema's own caveat, kept true on screen: DASH sniffs bytes and does
    // not open the container, so every Office format arrives as a ZIP.
    expect(
      describeInputRole({
        label: "X",
        required: true,
        media_types: ["application/zip", "application/zip"],
      }).accepts,
    ).toBe("Accepts Office or zipped files.");
  });

  it("has no purpose to show when the author wrote none", () => {
    // Null rather than a generic stand-in: "why this agent wants it" is a
    // question only the author can answer, and DASH inventing a sentence would
    // be DASH attributing a purpose to somebody else's agent.
    expect(buildInputRoles(DECLARING)[1]?.purpose).toBeNull();
  });
});

describe("what a selected file says", () => {
  it("tells the person the copy is DASH's, which nobody would guess", () => {
    // The fact that makes the whole workspace design worth having: moving or
    // editing the original after this point changes nothing.
    expect(describeInputState("copied").sentence).toBe(INPUTS_PANEL_COPY.copied_note);
    expect(describeInputState("copied").sentence).toContain("will not change what the agent reads");
  });

  it("renders the runner's own refusal sentence rather than a rewording", () => {
    // The runner is what decided and its limits are what move. A second
    // vocabulary here is the thing that stays wrong when they change.
    const detail = "That file is larger than this agent accepts.";
    expect(describeInputState("rejected", { detail }).sentence).toBe(detail);
  });

  it("admits it does not know why, rather than inventing a reason", () => {
    expect(describeInputState("rejected").sentence).toContain("did not say why");
  });

  it("is plain language in all three states", () => {
    for (const state of ["selected", "copied", "rejected"] as const) {
      const copy = describeInputState(state);
      expectPlainLanguage([copy.label, copy.sentence]);
    }
  });
});

describe("the limits a command may carry", () => {
  it("comes from the manifest and refuses a role the agent never declared", () => {
    // Main reads this; the renderer never sends it. A payload-supplied limit
    // could only be obeyed — letting a page widen what the author declared — or
    // ignored, which is a field on the wire that means nothing.
    expect(declaredLimitsFor(DECLARING, "customer_brief")).toEqual({
      max_count: 1,
      media_types: ["application/pdf", "text/plain"],
    });
    expect(declaredLimitsFor(DECLARING, "not_a_role")).toBeNull();
    expect(declaredLimitsFor({ agent_dom: {} }, "customer_brief")).toBeNull();
  });

  it("carries an empty block for a role that narrowed nothing", () => {
    // Not null: the role exists, so the file may be offered. Null would refuse
    // it before the picker opened.
    expect(declaredLimitsFor(DECLARING, "price_list")).toEqual({ max_count: 3 });
  });
});
