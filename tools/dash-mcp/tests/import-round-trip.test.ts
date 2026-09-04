/**
 * Scaffold, install, import — through DASH's own code (MAR-862).
 *
 * This is the closest thing to the packet's behavioural proof that a test can
 * be, and it is worth being precise about what it does and does not show.
 *
 * **It runs DASH's real import.** `openHandoff` is the function Electron main
 * calls when a `dash://handoff` link arrives, and `importManifest` is the store
 * write behind it. The ports are injected — that is `lib/handoff-flow.ts`'s own
 * design, so that the decision could be tested without Electron — so what runs
 * here is DASH's decision, not a re-enactment of it.
 *
 * **It does not show the window.** The consent dialog is a real person's press
 * and `confirm` answers it here. So this proves the import path accepts what
 * this tool produces, with zero validation failures, and stores it. It does not
 * prove the installed build draws it in the fleet; that needs the person.
 *
 * The store is a scratch one. `lib/db.ts` reads `DASH_DATA_DIR` at module load,
 * so the environment is set before the dynamic imports below — the convention
 * every store test in this repository uses.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { scaffoldAgent, installAgent } from "../src/agent-tools";
import { repoRoot } from "../src/paths";

const scratch = mkdtempSync(path.join(tmpdir(), "dash-mcp-import-"));
const dataDir = path.join(scratch, "data");
process.env.DASH_DATA_DIR = dataDir;

const { closeDb } = await import("../../../lib/db");
const { importManifest, forgetAgent, listAgents } = await import("../../../lib/store");
const { openHandoff } = await import("../../../lib/handoff-flow");
const { recordHandoff, readHandoffRecord } = await import("../../../lib/handoff-ledger");
const { agentFolderPath } = await import("../../../lib/agent-folders");

const projectDir = path.join(scratch, "example-agent");
const log: string[] = [];

beforeAll(() => {
  if (!existsSync(path.join(repoRoot(), "tools", "dash-mcp", "dist", "open-in-dash.mjs"))) {
    execFileSync(process.execPath, [path.join(repoRoot(), "tools", "dash-mcp", "build.mjs")], {
      cwd: repoRoot(),
      stdio: "pipe",
    });
  }
}, 60_000);

afterAll(() => {
  closeDb();
  rmSync(scratch, { recursive: true, force: true });
});

/**
 * Everything Electron main provides, with the two interesting ones answered
 * honestly: the person says yes, and there is no runner on this machine.
 *
 * A null `runner` is the harsher case on purpose. It is what a machine without
 * a started runner looks like, and an import that only succeeds when a runner
 * happens to be up is an import with a dependency nobody declared.
 */
function ports(confirm: boolean | "expired" = true) {
  return {
    dataDir,
    now: () => new Date(),
    confirm: async () => confirm,
    importManifest,
    forgetAgent,
    recordHandoff,
    readHandoffRecord,
    runner: null,
    log: (line: string) => log.push(line),
  };
}

describe("an agent this plugin built, imported by DASH", () => {
  it("is scaffolded, staged and handed over without a single refusal", async () => {
    const built = scaffoldAgent({
      directory: projectDir,
      name: "example-agent",
      display_name: "Example agent",
      summary: "Reads a few public sources and says what came in.",
    });
    expect(built.ok).toBe(true);

    const staged = installAgent({ directory: projectDir, open: false });
    expect(staged.ok).toBe(true);

    const report = await openHandoff(String(staged.url), ports());
    expect(report.headline).toBeTypeOf("string");
    expect({ ok: report.ok, outcome: report.outcome, headline: report.headline }).toMatchObject({
      ok: true,
      outcome: "registered",
    });
    expect(report.agent_id).toBe("example-agent");
  }, 60_000);

  it("appears in the store DASH reads its fleet from", () => {
    expect(listAgents().map((agent) => agent.name)).toContain("example-agent");
  });

  it("has a folder holding the program and the fingerprint mirror it imports", () => {
    const stored = agentFolderPath(dataDir, "example-agent");
    expect(existsSync(path.join(stored, "agent.manifest.json"))).toBe(true);
    expect(existsSync(path.join(stored, "code", "agent.mjs"))).toBe(true);
    expect(existsSync(path.join(stored, "code", "brief-fingerprint.mjs"))).toBe(true);
  });

  /**
   * ADR 0008's startable standing. A folder carrying `agent.mjs` gets a
   * registration; one without gets none and DASH says so. The registration is a
   * file rather than a store row, which is why it is checked on disk.
   */
  it("is registered as startable, since it carries a program", () => {
    const registrationPath = path.join(agentFolderPath(dataDir, "example-agent"), "registration.json");
    expect(existsSync(registrationPath)).toBe(true);
    const registration: unknown = JSON.parse(readFileSync(registrationPath, "utf8"));
    expect(registration).toMatchObject({ command: "node", args: ["agent.mjs"], cwd: "code" });
  });

  it("leaves the author's own folder where it was, because DASH takes a copy", () => {
    expect(existsSync(path.join(projectDir, "agent.mjs"))).toBe(true);
  });

  /**
   * Installing twice is the ordinary case, not an edge one: a coding agent
   * edits `agent.mjs` and installs again. DASH's answer to a handoff whose
   * facts have not changed is `ok` with nothing written — `lib/handoff-flow.ts`
   * says so in its own header — so the property worth holding is that a repeat
   * install is *harmless*, not that it is refused.
   */
  it("is harmless to install again when nothing has changed", async () => {
    const staged = installAgent({ directory: projectDir, open: false });
    expect(staged.ok).toBe(true);

    const again = await openHandoff(String(staged.url), ports());
    expect(again.ok).toBe(true);
    expect(again.headline).toContain("already in DASH");
    expect(listAgents().filter((agent) => agent.name === "example-agent")).toHaveLength(1);
  }, 60_000);
});
