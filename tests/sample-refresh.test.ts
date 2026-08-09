/**
 * An agent older than DASH's own template (MAR-576).
 *
 * Two questions, and they are tested apart because they fail apart. *Should
 * DASH say anything?* is a judgement about one document and is the half that
 * must stay narrow — a rule that fired on every panel-less agent would put a
 * notice on almost every workspace in DASH. *What does DASH write instead?* is
 * a judgement about identity, and the failure there is silent: a regenerated
 * manifest that quietly renamed an agent would import cleanly, pass every
 * schema check, and hand the user a stranger.
 *
 * The fixture is **Henrik's own stored manifest**, trimmed to the fields these
 * rules read. It is not a synthetic panel-less document: the whole issue is that
 * a real machine had this exact shape, and a fixture invented to match the rule
 * would have proved the rule agrees with itself.
 */

import { describe, expect, it } from "vitest";

import {
  SCAFFOLD_PROVENANCE_PREFIX,
  describeManifestGap,
  isScaffoldedByDash,
  refreshedManifest,
} from "../lib/sample-refresh";
import { PANEL_PREDATES_CAPABILITY } from "../lib/copy/panel";
import { resolvePanel } from "../lib/panel-spec";

/**
 * `ai-news-scout` as it actually sits in `%APPDATA%/orchestratedash` on the
 * machine this issue was filed from — `create-dash-agent 43.2.0`, generated
 * 2026-08-05, and an `agent_dom` whose keys stop at `memory`.
 */
const STORED = {
  manifest_version: 2,
  agent: {
    name: "ai-news-scout",
    display_name: "AI News Scout",
    goal: "Reads the news sources you choose and writes you a short summary of what is new, with a link to where each item came from.",
    plan_source: "composed",
    playbook_id: "",
    route_id: "",
    build_target: "code",
  },
  provenance: {
    generated_by: "create-dash-agent 43.2.0",
    registry_fingerprint: "agent-kit-template",
    generated_at: "2026-08-05T15:24:29.401Z",
  },
  agent_dom: {
    dom_version: 1,
    connections: [],
    permissions: { read: [], write: [], approval_required_for: [] },
    memory: [],
  },
} as const;

const REQUEST = { kitVersion: "43.2.0", now: new Date("2026-08-08T12:00:00.000Z") };

describe("whose document this is", () => {
  it("recognises DASH's own scaffold by its provenance", () => {
    expect(isScaffoldedByDash(STORED)).toBe(true);
  });

  it("matches the generator as a prefix, because the version follows it", () => {
    // The stored value is `create-dash-agent 43.2.0`. An equality check would
    // have been true on the day it was written and false on every upgrade.
    expect(STORED.provenance.generated_by.startsWith(SCAFFOLD_PROVENANCE_PREFIX)).toBe(true);
    expect(isScaffoldedByDash({ ...STORED, provenance: { generated_by: "create-dash-agent" } })).toBe(
      true,
    );
  });

  it.each([
    ["a document from another tool", "some-other-kit 1.0.0"],
    ["a name that merely contains ours", "not-create-dash-agent 1.0.0"],
    ["nothing at all", undefined],
  ])("does not claim %s", (_case, generatedBy) => {
    expect(isScaffoldedByDash({ ...STORED, provenance: { generated_by: generatedBy } })).toBe(false);
  });

  it("does not fall over on a document that is not one", () => {
    for (const value of [null, undefined, "", 42, [], {}]) {
      expect(isScaffoldedByDash(value)).toBe(false);
    }
  });
});

describe("when DASH says something", () => {
  it("names the gap on the agent this issue was filed about", () => {
    expect(describeManifestGap(STORED)).toEqual({
      card: PANEL_PREDATES_CAPABILITY,
      repairable: true,
    });
  });

  /**
   * The assertion that keeps this from becoming noise.
   *
   * Most agents declare no panel and most never will. For them the absence is
   * the author's choice, and a notice about it would be DASH nagging somebody
   * about a feature they did not ask for. Only a document DASH generated can be
   * behind DASH's own template.
   */
  it("says nothing about a third-party agent that declares no panel", () => {
    const theirs = { ...STORED, provenance: { ...STORED.provenance, generated_by: "hand-written" } };
    expect(describeManifestGap(theirs)).toBeNull();
  });

  it("says nothing once the agent declares a panel", () => {
    const current = {
      ...STORED,
      agent_dom: { ...STORED.agent_dom, panel: { panel_version: 1, sections: [] } },
    };
    expect(describeManifestGap(current)).toBeNull();
  });

  /**
   * A malformed panel is not an old panel, and the two have different answers.
   *
   * `resolvePanel` already reports this one as `unreadable`, and its card says
   * so and offers the same repair. Telling that person their agent is *old* as
   * well would be a second diagnosis of one fault, and the wrong one: the key
   * is there, the document is current, and the contents are broken.
   */
  it("leaves a broken panel to the surface that already reports it", () => {
    const broken = {
      ...STORED,
      agent_dom: { ...STORED.agent_dom, panel: { panel_version: 1, sections: "not an array" } },
    };
    expect(describeManifestGap(broken)).toBeNull();
    expect(resolvePanel(broken).kind).toBe("unreadable");
  });
});

describe("what DASH writes instead", () => {
  it("produces a manifest that declares the panel the old one lacked", () => {
    const result = refreshedManifest(STORED, REQUEST);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Through `resolvePanel` rather than by reading the key, so this asserts the
    // regenerated document is one the renderer will actually draw — the property
    // the button promises — rather than merely that a field exists.
    const resolved = resolvePanel(result.manifest);
    expect(resolved.kind).toBe("v1");
    expect(describeManifestGap(result.manifest)).toBeNull();
  });

  /**
   * The identity fields, held one at a time.
   *
   * `name` is the store's primary key, the folder name and the seed the
   * character is drawn from: a refresh that changed it would not be a refresh,
   * it would be a second agent beside the first. `display_name` and `goal` are
   * what the person reads on the card they have learned to recognise, and a
   * user who retitled their sample must not have DASH rename it back.
   */
  it("keeps the agent's own identity rather than the template's", () => {
    const renamed = {
      ...STORED,
      agent: { ...STORED.agent, display_name: "My news robot", goal: "Whatever I told it to do." },
    };
    const result = refreshedManifest(renamed, REQUEST);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const agent = result.manifest["agent"] as Record<string, unknown>;
    expect(agent["name"]).toBe("ai-news-scout");
    expect(agent["display_name"]).toBe("My news robot");
    expect(agent["goal"]).toBe("Whatever I told it to do.");
  });

  it("records that this kit wrote it, now", () => {
    const result = refreshedManifest(STORED, REQUEST);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const provenance = result.manifest["provenance"] as Record<string, unknown>;
    // Not backdated to the original. The document really was generated now, and
    // provenance is the one field whose whole job is to say which template
    // produced what DASH is holding.
    expect(provenance["generated_at"]).toBe("2026-08-08T12:00:00.000Z");
    expect(provenance["generated_by"]).toBe("create-dash-agent 43.2.0");
  });

  it.each([
    ["no name", { ...STORED, agent: { ...STORED.agent, name: "" } }],
    ["no goal", { ...STORED, agent: { ...STORED.agent, goal: undefined } }],
    ["no agent block at all", { provenance: STORED.provenance }],
  ])("refuses a document with %s rather than inventing one", (_case, input) => {
    const result = refreshedManifest(input, REQUEST);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toMatch(/saved setup/);
  });
});
