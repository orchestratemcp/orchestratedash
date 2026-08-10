/**
 * The three surfaces the cast now stands on (MAR-501, MAR-502, MAR-503).
 *
 * `tests/o-cast.test.ts` proves the *store* keeps a character it did not
 * compute. This proves the three things that could still go wrong between that
 * column and a screen:
 *
 * 1. the projections carry the stored character rather than deriving one — the
 *    same assertion pointed one layer up, and it is worth repeating exactly
 *    because `oFor` is a pure function of the name that any of these files
 *    could have called instead;
 * 2. the portrait reserves its box when there is no character, because a header
 *    that reflowed on a short database read would move the agent's name under
 *    the user's cursor;
 * 3. the strip's order, bound and destinations, which are the whole of what it
 *    does and none of which needs a browser to be wrong.
 *
 * The pre-paint script is checked against the module constants rather than
 * against a string, because a script that reads a key nothing writes is a
 * setting that silently stops surviving a restart — and that is the one part of
 * this feature no screenshot would catch.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { SAMPLE_AGENT_SEED } from "../app/page";
import { AgentPortrait } from "../app/agents/detail/page";
import { FleetStripScript, fleetStripLinks } from "../app/_components/fleet-strip";
import { agentWorkspaceHref } from "../app/_data/routes";
import { SAMPLE_AGENT_ID } from "../lib/sample-agent";
import { NOTHING_STRANDED } from "../lib/deploy/connection-travel";
import { GLANCE_ALL_CLEAR } from "../lib/copy/glance";
import { O_NAMES, oFor, type OName } from "../lib/brand/o-cast";
import {
  DEFAULT_FLEET_STRIP,
  FLEET_STRIP_ATTRIBUTE,
  FLEET_STRIP_SLOT,
  FLEET_STRIP_STORAGE_KEY,
  describeFleetCount,
  describeFleetStrip,
  fleetStripSlots,
  nextFleetStripSetting,
  parseFleetStripSetting,
} from "../lib/views/fleet-strip";
import type { AgentRow } from "../lib/views/types";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function example(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(repoRoot, "examples", name), "utf8")) as Record<
    string,
    unknown
  >;
}

/** Any character except this one — what a store nothing recomputed would keep. */
function notThe(character: OName): OName {
  const other = O_NAMES.find((candidate) => candidate !== character);
  if (other === undefined) {
    throw new Error("the cast has one member, so nothing can disagree with the seed");
  }
  return other;
}

const opened: Array<{ dataDir: string; closeDb: () => void }> = [];

async function freshStore(): Promise<{
  dataDir: string;
  db: typeof import("../lib/db");
  store: typeof import("../lib/store");
  views: typeof import("../lib/views/build");
}> {
  const dataDir = mkdtempSync(path.join(tmpdir(), "dash-brand-surface-"));
  process.env.DASH_DATA_DIR = dataDir;
  vi.resetModules();
  const db = await import("../lib/db");
  const store = await import("../lib/store");
  const views = await import("../lib/views/build");
  opened.push({ dataDir, closeDb: db.closeDb });
  return { dataDir, db, store, views };
}

afterEach(() => {
  const entries = opened.splice(0);
  for (const { closeDb } of entries) {
    closeDb();
  }
  for (const dataDir of new Set(entries.map((entry) => entry.dataDir))) {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

function row(name: string, avatar: OName): AgentRow {
  return {
    name,
    goal: "does a thing",
    plan_source: "orchestratekit",
    build_target: "node",
    planned_steps: 1,
    automation_clearance: "manual",
    run_count: 0,
    origin: { kind: "watched_only" },
    compliance: {
      runs_considered: 0,
      gate_violation_runs: 0,
      drifted_runs: 0,
      clearance_flagged_runs: 0,
    },
    avatar,
    // MAR-577. Nothing in this file renders it; the field is required on the row
    // so that a surface which does cannot be given one without an answer.
    deploy: {
      deployable: false,
      refusal: "This agent's build lives outside DASH.",
      travel: NOTHING_STRANDED,
    },
    // MAR-586. Same standing as `deploy` directly above: this file is about the
    // characters, and a row with no answer to the four questions is not a row
    // any surface may be handed.
    glance: [GLANCE_ALL_CLEAR],
  };
}

describe("the projections carry the stored character (MAR-501, MAR-502)", () => {
  it("hands the fleet row the character the column holds, not the one the name implies", async () => {
    /*
     * The load-bearing assertion, and the reason it is worth writing twice.
     * `oFor(name)` equals the stored value at creation, so a projection that
     * recomputed would pass any test that only compared the two. Writing a
     * character the seed would never have chosen is what makes a recompute
     * visible — and every surface in this file reads its avatar through one of
     * these two projections, so this is the seam that would have to break.
     */
    const { db, store, views } = await freshStore();
    const manifest = example("agent.manifest.example.json") as { agent: { name: string } };
    const name = manifest.agent.name;
    expect(store.importManifest(manifest).ok).toBe(true);

    const different = notThe(oFor(name));
    db.db().prepare("UPDATE agents SET avatar = ? WHERE name = ?").run(different, name);

    const agents = views.agentsView().agents;
    expect(agents.find((agent) => agent.name === name)?.avatar).toBe(different);
  });

  it("hands the workspace the same character, from the store rather than the manifest", async () => {
    const { db, store, views } = await freshStore();
    const manifest = example("agent.manifest.example.json") as { agent: { name: string } };
    const name = manifest.agent.name;
    expect(store.importManifest(manifest).ok).toBe(true);

    const different = notThe(oFor(name));
    db.db().prepare("UPDATE agents SET avatar = ? WHERE name = ?").run(different, name);

    const view = views.workspaceView(name);
    expect(view.found && view.avatar).toBe(different);
  });

  it("leaves the portrait alone when the author retitles the agent", async () => {
    /*
     * MAR-502's own acceptance. `title` is the author's `display_name` and moves
     * whenever they publish; the character is DASH's record and must not. The
     * re-import path omits `avatar` from its `ON CONFLICT DO UPDATE` for exactly
     * this, and this is that decision asserted from the surface that renders it.
     */
    const { db, store, views } = await freshStore();
    const manifest = example("agent.manifest.example.json") as {
      agent: { name: string; display_name?: string };
    };
    const name = manifest.agent.name;
    expect(store.importManifest(manifest).ok).toBe(true);

    const different = notThe(oFor(name));
    db.db().prepare("UPDATE agents SET avatar = ? WHERE name = ?").run(different, name);

    const renamed = { ...manifest, agent: { ...manifest.agent, display_name: "Something Else" } };
    expect(store.importManifest(renamed).ok).toBe(true);

    const view = views.workspaceView(name);
    expect(view.found && view.title).toBe("Something Else");
    expect(view.found && view.avatar).toBe(different);
  });

  it("gives the fleet a stable order, which is the order the strip stands in", async () => {
    const { store, views } = await freshStore();
    const manifest = example("agent.manifest.example.json") as { agent: { name: string } };
    for (const name of ["zeta-agent", "alpha-agent", "mid-agent"]) {
      expect(store.importManifest({ ...manifest, agent: { ...manifest.agent, name } }).ok).toBe(
        true,
      );
    }

    expect(views.agentsView().agents.map((agent) => agent.name)).toEqual([
      "alpha-agent",
      "mid-agent",
      "zeta-agent",
    ]);
  });
});

describe("the workspace portrait (MAR-502)", () => {
  it("draws the persisted character at exactly 2x, decoratively", () => {
    const markup = renderToStaticMarkup(<AgentPortrait avatar="wizard" />);
    expect(markup).toContain('src="/o/1x/wizard.png"');
    expect(markup).toContain("--o-size:100px");
    // Decorative: the agent's name is the heading beside it, and a screen
    // reader announcing "wizard" there would add a costume nobody asked about.
    expect(markup).toContain('alt=""');
    expect(markup).toContain('aria-hidden="true"');
  });

  it("reserves the box and draws nothing when there is no character", () => {
    /*
     * Not a placeholder character and not a collapsed header. An invented
     * character could disagree with the one on the fleet card this agent was
     * reached from, and the whole value of a costume is that it is the same
     * every time.
     */
    const markup = renderToStaticMarkup(<AgentPortrait avatar={null} />);
    expect(markup).toContain("o-portrait-empty");
    expect(markup).not.toContain("<img");
    expect(markup).toContain('aria-hidden="true"');
  });
});

describe("the sample teaser's character (MAR-501)", () => {
  it("is the character the sample agent will actually be given", () => {
    /*
     * `app/page.tsx` cannot import `lib/sample-agent.ts` — it reaches `node:fs`
     * and `tests/client-bundle.test.ts` exists because of what happens when a
     * module like that gets into the renderer bundle. So the seed is written out
     * there and pinned here, and this assertion is the only thing keeping the
     * character on the empty-state card and the character on the first fleet
     * card the same one.
     */
    expect(SAMPLE_AGENT_SEED).toBe(SAMPLE_AGENT_ID);
  });
});

describe("who stands on the rule (MAR-503)", () => {
  const five = [
    row("alpha", "ninja"),
    row("bravo", "nerd"),
    row("charlie", "cowboy"),
    row("delta", "wizard"),
    row("echo", "knight"),
  ];

  it("keeps the fleet's own order and sends each character to its workspace", () => {
    const { links, overflow } = fleetStripLinks(five, FLEET_STRIP_SLOT * 5);
    expect(overflow).toBe(0);
    expect(links.map((link) => link.name)).toEqual([
      "alpha",
      "bravo",
      "charlie",
      "delta",
      "echo",
    ]);
    expect(links.map((link) => link.avatar)).toEqual([
      "ninja",
      "nerd",
      "cowboy",
      "wizard",
      "knight",
    ]);
    for (const link of links) {
      expect(link.href).toBe(agentWorkspaceHref(link.name));
    }
  });

  it("spends a slot on the count rather than drawing a character off the edge", () => {
    // Room for four things and five agents: three characters and "+2", never
    // four characters and a "+1" that does not fit.
    const { links, overflow } = fleetStripLinks(five, FLEET_STRIP_SLOT * 4);
    expect(links).toHaveLength(3);
    expect(overflow).toBe(2);
    expect(links[links.length - 1]?.name).toBe("charlie");
  });

  it("stays bounded with a large fleet and never shrinks a sprite", () => {
    /*
     * MAR-503's own acceptance names ten. The answer is always "as many as fit,
     * and a number" — the sprite size is not a variable, because
     * `image-rendering: pixelated` makes a fractional scale look like a
     * rendering fault rather than a smaller character.
     */
    const many = Array.from({ length: 40 }, (_, index) =>
      row(`agent-${String(index).padStart(2, "0")}`, "robot"),
    );
    for (const width of [200, 375, 768, 1280]) {
      const { links, overflow } = fleetStripLinks(many, width);
      expect(links.length).toBeLessThanOrEqual(Math.floor(width / FLEET_STRIP_SLOT));
      expect(links.length + overflow).toBe(many.length);
      expect(links.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("shows a character rather than only a count in a window nothing fits in", () => {
    const { links, overflow } = fleetStripLinks(five, 10);
    expect(links).toHaveLength(1);
    expect(overflow).toBe(4);
  });

  it("says nothing at all when there are no agents", () => {
    expect(fleetStripSlots(1280, 0)).toEqual({ shown: 0, overflow: 0 });
    expect(fleetStripLinks([], 1280).links).toHaveLength(0);
  });

  it("counts in words a person would use", () => {
    expect(describeFleetCount(1, 0)).toBe("1 agent");
    expect(describeFleetCount(5, 0)).toBe("5 agents");
    expect(describeFleetCount(5, 2)).toBe("5 agents · 2 not shown");
  });
});

describe("the strip's setting (MAR-503)", () => {
  it("is shown by default and toggles to exactly one other state", () => {
    expect(DEFAULT_FLEET_STRIP).toBe("shown");
    expect(nextFleetStripSetting("shown")).toBe("hidden");
    expect(nextFleetStripSetting("hidden")).toBe("shown");
  });

  it("refuses a stored value that is not one of ours", () => {
    expect(parseFleetStripSetting("hidden")).toBe("hidden");
    expect(parseFleetStripSetting("off")).toBe(DEFAULT_FLEET_STRIP);
    expect(parseFleetStripSetting(null)).toBe(DEFAULT_FLEET_STRIP);
    expect(parseFleetStripSetting(1)).toBe(DEFAULT_FLEET_STRIP);
  });

  it("labels the control with what pressing it gives you, in both directions", () => {
    const shown = describeFleetStrip("shown");
    const hidden = describeFleetStrip("hidden");
    expect(shown.label).not.toBe(hidden.label);
    // The visible word may be shorter than the accessible name; it may never be
    // shorter than nothing, and neither state may be unlabelled.
    expect(shown.visible.length).toBeGreaterThan(0);
    expect(hidden.visible.length).toBeGreaterThan(0);
    expect(shown.label.length).toBeGreaterThanOrEqual(shown.visible.length);
    expect(hidden.label.length).toBeGreaterThanOrEqual(hidden.visible.length);
  });

  it("pre-paints from the same key and attribute the toggle writes", () => {
    /*
     * The one part of this feature a screenshot cannot check. If the script read
     * a key the toggle does not write, the setting would apply for the session
     * and silently stop surviving a restart — which looks exactly like a person
     * having changed their mind.
     */
    const markup = renderToStaticMarkup(<FleetStripScript />);
    expect(markup).toContain(JSON.stringify(FLEET_STRIP_STORAGE_KEY));
    expect(markup).toContain(JSON.stringify(FLEET_STRIP_ATTRIBUTE));
    expect(markup).toContain('"hidden"');
    // Nothing from storage is interpolated into the script — the stored value is
    // only ever compared against a literal.
    expect(markup).toContain("localStorage.getItem");
    expect(markup).toContain("setAttribute");
  });
});
