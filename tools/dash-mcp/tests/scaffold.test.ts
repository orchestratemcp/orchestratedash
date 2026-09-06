/**
 * What the scaffold writes, judged by the validator DASH imports with
 * (MAR-862).
 *
 * The first test is the one that matters and it is the whole reason the
 * template is data rather than prose: the manifest this tool produces is run
 * through `validateManifest` and `checkManifestConstraints` — the same two
 * functions `importManifest` runs — so a template that has drifted from
 * `contracts/` fails here rather than in somebody's import dialog.
 */

import { describe, expect, it } from "vitest";

import { validateManifest, isManifestV2 } from "../../../lib/contracts";
import { checkManifestConstraints } from "../../../lib/manifest-constraints";
import { deriveAgentId, planScaffold, scaffoldManifest, TEMPLATE_SOURCES } from "../src/scaffold";

const NOW = new Date("2026-09-04T12:00:00.000Z");

function request(overrides: Partial<Parameters<typeof scaffoldManifest>[0]> = {}) {
  return {
    directory: "/tmp/example-agent",
    agent_id: "example-agent",
    display_name: "Example agent",
    summary: "Reads a few public sources and says what came in.",
    sources: [],
    now: NOW,
    ...overrides,
  };
}

const TEMPLATES = {
  agent: "// agent\n",
  fingerprint: "// fingerprint\n",
  openInDash: "// open in dash\n",
};

describe("the scaffolded manifest", () => {
  it("passes DASH's own validator", () => {
    const validated = validateManifest(scaffoldManifest(request()));
    expect(validated.ok ? [] : validated.errors).toEqual([]);
  });

  it("passes the constraints no schema can express", () => {
    const validated = validateManifest(scaffoldManifest(request()));
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      return;
    }
    expect(checkManifestConstraints(validated.value)).toEqual([]);
  });

  it("is version 2, so it carries an Agent DOM", () => {
    const validated = validateManifest(scaffoldManifest(request()));
    expect(validated.ok && isManifestV2(validated.value)).toBe(true);
  });

  /**
   * The correspondence `lib/analyze.ts` grades against. If `template/agent.mjs`
   * gains or reorders a `step()` call without this list following it, every run
   * of every scaffolded agent reports drift while doing exactly what it said.
   */
  it("declares exactly the steps the template's program emits, in order", () => {
    const manifest = scaffoldManifest(request()) as {
      planned_route: { step: number; component_id: string }[];
    };
    expect(manifest.planned_route.map((entry) => entry.component_id)).toEqual([
      "public_feed_fetch",
      "brief_compose",
      "local_file_write",
    ]);
    expect(manifest.planned_route.map((entry) => entry.step)).toEqual([1, 2, 3]);
  });

  it("declares no control it does not implement", () => {
    const manifest = scaffoldManifest(request()) as {
      agent_dom: { control: { commands: string[] } };
    };
    expect(manifest.agent_dom.control.commands).toEqual(["retry", "pause", "resume", "cancel"]);
  });

  it("binds a panel section to the brief, so the document has somewhere to render", () => {
    const manifest = scaffoldManifest(request()) as {
      agent_dom: { panel: { sections: { artifact_role?: string; source_role?: string }[] } };
    };
    const roles = manifest.agent_dom.panel.sections.map(
      (section) => section.artifact_role ?? section.source_role,
    );
    expect(roles).toContain("brief");
    expect(roles).toContain("digest");
  });

  /**
   * MAR-878: the scaffold now declares a `model_provider` connection so the
   * agent can be asked a question at all — `lib/views/ask.ts` refuses
   * `no_provider` on an agent whose manifest declares none. `optional: true`
   * is the reason "asks for" and "can be added without a credential" are not a
   * contradiction: nothing here blocks import with zero keys held.
   */
  it("declares one optional model-provider connection, so it can still be added without a credential", () => {
    const manifest = scaffoldManifest(request()) as {
      agent_dom: {
        connections: {
          id: string;
          provider: string;
          ownership: string;
          capabilities: { id: string; access: string }[];
          fields: { id: string; kind: string; required: boolean }[];
        }[];
        connection_requirements: { requirements: { id: string; connection_id: string; optional: boolean }[] };
      };
    };
    expect(manifest.agent_dom.connections).toHaveLength(1);
    const [connection] = manifest.agent_dom.connections;
    expect(connection).toMatchObject({
      id: "model_provider",
      provider: "openrouter",
      ownership: "dash_managed",
    });
    expect(connection.capabilities).toEqual([
      expect.objectContaining({ id: "openrouter.chat.completion", access: "spend" }),
    ]);
    expect(connection.fields).toEqual([
      expect.objectContaining({ id: "api_key", kind: "secret", required: true }),
    ]);

    expect(manifest.agent_dom.connection_requirements.requirements).toEqual([
      expect.objectContaining({ id: "model_provider", connection_id: "model_provider", optional: true }),
    ]);
  });

  it("declares the connection for whichever provider was asked for", () => {
    const manifest = scaffoldManifest(request({ model_provider: "anthropic" })) as {
      agent_dom: { connections: { provider: string; capabilities: { id: string }[] }[] };
    };
    expect(manifest.agent_dom.connections[0]?.provider).toBe("anthropic");
    expect(manifest.agent_dom.connections[0]?.capabilities[0]?.id).toBe("anthropic.chat.completion");
  });

  it("never puts a delivery variable on the model-provider field, since DASH spends it itself", () => {
    const manifest = scaffoldManifest(request()) as {
      agent_dom: { connections: { fields: { technical?: unknown }[] }[] };
    };
    expect(manifest.agent_dom.connections[0]?.fields[0]?.technical).toBeUndefined();
  });
});

describe("the file plan", () => {
  it("carries the program, the fingerprint mirror and the author's own install script", () => {
    const plan = planScaffold(request(), TEMPLATES);
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    expect(plan.files.map((file) => file.path).sort()).toEqual([
      ".gitignore",
      "README.md",
      "agent.manifest.json",
      "agent.mjs",
      "brief-fingerprint.mjs",
      "package.json",
      "scripts/open-in-dash.mjs",
      "sources.json",
    ]);
  });

  it("copies the template sources verbatim rather than templating them", () => {
    const plan = planScaffold(request(), TEMPLATES);
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    const byPath = new Map(plan.files.map((file) => [file.path, file.contents]));
    expect(byPath.get("agent.mjs")).toBe(TEMPLATES.agent);
    expect(byPath.get("brief-fingerprint.mjs")).toBe(TEMPLATES.fingerprint);
    expect(byPath.get("scripts/open-in-dash.mjs")).toBe(TEMPLATES.openInDash);
  });

  it("writes the sources it was given, and a working default when given none", () => {
    const given = planScaffold(
      request({
        sources: [{ name: "A feed", url: "https://example.test/a.atom", format: "atom" }],
      }),
      TEMPLATES,
    );
    expect(given.ok).toBe(true);
    if (!given.ok) {
      return;
    }
    const sources = JSON.parse(
      given.files.find((file) => file.path === "sources.json")?.contents ?? "{}",
    ) as { sources: { name: string }[] };
    expect(sources.sources.map((source) => source.name)).toEqual(["A feed"]);

    const defaulted = planScaffold(request(), TEMPLATES);
    expect(defaulted.ok).toBe(true);
    if (!defaulted.ok) {
      return;
    }
    const fallback = JSON.parse(
      defaulted.files.find((file) => file.path === "sources.json")?.contents ?? "{}",
    ) as { sources: unknown[] };
    expect(fallback.sources).toEqual(TEMPLATE_SOURCES);
  });

  it("refuses a name a file system cannot hold, rather than mangling it", () => {
    const plan = planScaffold(request({ agent_id: "Not A Name" }), TEMPLATES);
    expect(plan.ok).toBe(false);
    expect(plan.ok ? "" : plan.problem).toContain("cannot be used as an agent name");
  });

  it("refuses a relative directory", () => {
    const plan = planScaffold(request({ directory: "./somewhere" }), TEMPLATES);
    expect(plan.ok).toBe(false);
  });

  it("ignores runtime output, which the .gitignore says out loud", () => {
    const plan = planScaffold(request(), TEMPLATES);
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    const ignored = plan.files.find((file) => file.path === ".gitignore")?.contents ?? "";
    expect(ignored).toContain("reports/");
    expect(ignored).toContain("runs/");
    expect(ignored).toContain("dash-handoff.json");
  });
});

describe("deriveAgentId", () => {
  it("makes an ordinary name into an ordinary id", () => {
    expect(deriveAgentId("My Agent!")).toBe("my-agent");
  });

  it("leaves an id that is already one alone", () => {
    expect(deriveAgentId("news-scout")).toBe("news-scout");
  });

  it("produces something the manifest's own name rule accepts", () => {
    const derived = deriveAgentId("  Weekly  Competitor Scout  ");
    const validated = validateManifest(scaffoldManifest(request({ agent_id: derived })));
    expect(validated.ok ? [] : validated.errors).toEqual([]);
  });
});
