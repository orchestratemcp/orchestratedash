/**
 * The MAR-426 contract fixture, consumed without translation (MAR-428).
 *
 * `conformance/v2/mar-426.runner-hosted.agent.manifest.json` is the exact
 * `export_build_brief` output asserted by OrchestrateMCP's own fixture test,
 * pinned at the merge commit recorded on MAR-426. It lives in this repo so that
 * the two sides cannot drift silently: if the emitter changes shape, this file
 * is what has to be updated, and updating it is a reviewable diff rather than a
 * discovery made when somebody's agent will not start.
 *
 * The acceptance criterion it stands for is "a build brief from MAR-426 can be
 * consumed without schema translation". So the assertions are deliberately about
 * *no translation happening*: it validates as-is, the runner reads its commands
 * as-is, and DASH registers it as-is.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { isManifestV2, validateManifest } from "../lib/contracts";
import { buildHandoff, handoffUrl, HANDOFF_FILE_NAME } from "../lib/handoff";
import { openHandoff, type HandoffPorts, type HandoffPrompt } from "../lib/handoff-flow";
import { readRegistration } from "../lib/registration";
import { Supervisor } from "../runner/supervisor";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = path.join(
  repoRoot,
  "conformance",
  "v2",
  "mar-426.runner-hosted.agent.manifest.json",
);
const FIXTURE_JSON = readFileSync(FIXTURE, "utf8");
const AGENT_ID = "hubspot-contact-reporter";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

function temporary(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

describe("the MAR-426 emitted manifest", () => {
  it("validates against DASH's v2 schema with nothing rewritten", () => {
    const result = validateManifest(JSON.parse(FIXTURE_JSON));
    expect(result.ok).toBe(true);
    expect(result.ok && isManifestV2(result.value)).toBe(true);
  });

  it("keeps telemetry v1 as the event contract", () => {
    // v2 is additive, not a telemetry rewrite. The seven event types are the
    // same ones `run-event.schema.json` has always accepted.
    const manifest = JSON.parse(FIXTURE_JSON) as { monitoring: { events: string[] } };
    expect(manifest.monitoring.events).toHaveLength(7);
  });

  it("is read by the runner as declaring exactly its four commands", () => {
    // Read through the supervisor, which is the code that actually decides what
    // an agent may be commanded to do — not by re-parsing the file here.
    const supervisor = new Supervisor(
      [
        {
          agent_id: AGENT_ID,
          manifest_path: FIXTURE,
          command: process.execPath,
          args: ["--version"],
        },
      ],
      () => {},
    );
    expect(supervisor.commands(AGENT_ID)).toEqual(["retry", "pause", "resume", "cancel"]);
  });

  it("declares a runtime that survives the DASH window closing", () => {
    const manifest = JSON.parse(FIXTURE_JSON) as {
      agent_dom: { runtime: { class: string; continues_when_dash_closed: boolean } };
    };
    expect(manifest.agent_dom.runtime.class).toBe("local_process");
    expect(manifest.agent_dom.runtime.continues_when_dash_closed).toBe(true);
  });
});

describe("registering it through a handoff", () => {
  it("goes from build brief to registered agent with no translation step", async () => {
    const project = temporary("mar-426-project-");
    const manifestPath = path.join(project, "agent.manifest.json");
    writeFileSync(manifestPath, FIXTURE_JSON, "utf8");

    const built = buildHandoff(
      {
        agent_id: AGENT_ID,
        display_name: "HubSpot contact reporter",
        summary: "Read HubSpot contacts on request and write a local JSON report.",
        project_dir: project,
        manifest_path: manifestPath,
        command: "node",
        args: ["agent.mjs"],
        produced_by: "export_build_brief (fixture)",
      },
      { handoff_id: "b".repeat(32), nonce: "a".repeat(64) },
    );
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }
    const handoffFile = path.join(project, HANDOFF_FILE_NAME);
    writeFileSync(handoffFile, JSON.stringify(built.value), "utf8");

    const dataDir = temporary("mar-426-data-");
    const prompts: HandoffPrompt[] = [];
    const ports: HandoffPorts = {
      dataDir,
      now: () => new Date(),
      confirm: async (prompt) => {
        prompts.push(prompt);
        return true;
      },
      importManifest: () => ({ ok: true }),
      forgetAgent: () => ({ existed: false }),
      recordHandoff: () => {},
      readHandoffRecord: () => null,
      runner: {
        reload: async () => ({ ok: true }),
        start: async () => ({ ok: true }),
        stop: async () => ({ ok: true }),
      },
      log: () => {},
    };

    const report = await openHandoff(handoffUrl(handoffFile, "a".repeat(64)), ports);

    expect(report).toMatchObject({ ok: true, outcome: "registered", agent_id: AGENT_ID });
    expect(readRegistration(dataDir, AGENT_ID)?.dash.owner).toBe("dash_handoff");
  });

  it("names the account it will need by label, never by scope", async () => {
    // The fixture's connection carries `provider_scopes` under `technical`. A
    // fresh user must never see them, and the label is what they see instead.
    const project = temporary("mar-426-project-");
    const manifestPath = path.join(project, "agent.manifest.json");
    writeFileSync(manifestPath, FIXTURE_JSON, "utf8");

    const built = buildHandoff(
      {
        agent_id: AGENT_ID,
        display_name: "HubSpot contact reporter",
        summary: "Read HubSpot contacts on request and write a local JSON report.",
        project_dir: project,
        manifest_path: manifestPath,
        command: "node",
        args: ["agent.mjs"],
        produced_by: "export_build_brief (fixture)",
      },
      { handoff_id: "c".repeat(32), nonce: "d".repeat(64) },
    );
    if (!built.ok) {
      throw new Error(built.detail);
    }
    const handoffFile = path.join(project, HANDOFF_FILE_NAME);
    writeFileSync(handoffFile, JSON.stringify(built.value), "utf8");

    const prompts: HandoffPrompt[] = [];
    await openHandoff(handoffUrl(handoffFile, "d".repeat(64)), {
      dataDir: temporary("mar-426-data-"),
      now: () => new Date(),
      confirm: async (prompt) => {
        prompts.push(prompt);
        return false;
      },
      importManifest: () => ({ ok: true }),
      forgetAgent: () => ({ existed: false }),
      recordHandoff: () => {},
      readHandoffRecord: () => null,
      runner: null,
      log: () => {},
    });

    const detail = (prompts[0] as HandoffPrompt).detail;
    expect(detail).toContain("HubSpot");
    expect(detail).not.toMatch(/crm\.objects|provider_scopes|oauth_reauthorization/);
  });
});
