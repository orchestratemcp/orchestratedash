/**
 * Setting an agent up again, performed (MAR-705).
 *
 * `tests/folder-repair.test.ts` covers the decision. This covers the *act*: what
 * is actually on disk afterwards, which is the half MAR-705 was filed on.
 *
 * ## Why this can run at all
 *
 * Because `repairHeldAgent` takes a `confirm` port rather than calling Electron.
 * Everything else it touches is DASH's own store and DASH's own folder, and
 * `DASH_DATA_DIR` points both somewhere disposable — the pattern
 * `tests/store-sqlite.test.ts` established. So the branch a person actually
 * walks, including the consent gate, runs on every push instead of behind a
 * native dialog on one developer's Windows box.
 *
 * ## The scenario every case here starts from
 *
 * MAR-703's, reduced to its bones: DASH holds the agent's row and its folder,
 * and its registration is gone. That is what a rebuilt index leaves behind, and
 * before this command the only way out of it was `npm run open-in-dash` from the
 * agent's original project — a terminal, against a folder the person may no
 * longer have.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const AGENT = "ai-news-scout";

function v2Manifest(mutate: (manifest: Record<string, unknown>) => void = () => {}): string {
  const manifest = JSON.parse(
    readFileSync(
      path.join(repoRoot, "examples", "gmail-meeting-assistant.manifest.v2.example.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;
  const agent = manifest["agent"] as { name: string; display_name?: string };
  agent.name = AGENT;
  agent.display_name = "AI News Scout";
  mutate(manifest);
  return JSON.stringify(manifest, null, 2);
}

const opened: Array<{ dataDir: string; closeDb: () => void }> = [];

/**
 * A store holding one agent, with its folder written and its registration
 * deliberately absent.
 *
 * The row is seeded through `importManifest` rather than by hand, so the agent
 * this test repairs is one DASH itself imported — a fixture that wrote the row
 * directly could drift from what the import door actually produces.
 */
async function heldAgent(options: { program?: boolean } = {}) {
  const dataDir = mkdtempSync(path.join(tmpdir(), "dash-repair-"));
  process.env.DASH_DATA_DIR = dataDir;
  vi.resetModules();

  const db = await import("../lib/db");
  const store = await import("../lib/store");
  const registration = await import("../lib/registration");
  const repair = await import("../lib/folder-repair");
  opened.push({ dataDir, closeDb: db.closeDb });

  const files =
    options.program === false
      ? [{ path: "sources.json", contents: '{"sources":[]}' }]
      : [
          { path: "agent.mjs", contents: "// the agent\n" },
          { path: "sources.json", contents: '{"sources":[]}' },
        ];

  const imported = store.importManifest(JSON.parse(v2Manifest()), {
    files,
    manifestJson: v2Manifest(),
  });
  expect(imported.ok).toBe(true);

  return { dataDir, store, registration, repair };
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

function ports(
  dataDir: string,
  over: { agreed?: boolean; reload?: () => Promise<{ ok: boolean }> } = {},
) {
  const asked: string[] = [];
  return {
    asked,
    value: {
      dataDir,
      now: () => new Date("2026-08-19T20:00:00.000Z"),
      confirm: async (prompt: { message: string }) => {
        asked.push(prompt.message);
        return over.agreed ?? true;
      },
      runner: { reload: over.reload ?? (async () => ({ ok: true })) },
    },
  };
}

describe("repairing an agent whose registration is gone", () => {
  /**
   * MAR-705 in one test, and MAR-703's way out of its own dead end.
   *
   * The registration is what `runner.start` needs and what `startable` reads, so
   * putting it back is the difference between an agent with no run control and
   * one with a working button.
   */
  it("writes the registration back, pointing at DASH's own copy", async () => {
    const { dataDir, registration, repair } = await heldAgent();
    // The state a rebuilt index leaves behind.
    rmSync(registration.registrationPath(dataDir, AGENT), { force: true });
    expect(registration.readRegistration(dataDir, AGENT)).toBeNull();

    const port = ports(dataDir);
    const result = await repair.repairHeldAgent(AGENT, port.value);

    expect(result.ok).toBe(true);
    const written = registration.readRegistration(dataDir, AGENT);
    expect(written).not.toBeNull();
    // Not `node`: the person this button is for has never installed one.
    expect(written?.command).toBe(registration.BUNDLED_NODE_COMMAND);
    expect(written?.args).toEqual(["agent.mjs"]);
    // DASH's own copy, not the author's project.
    expect(written?.cwd).toBe(path.join(dataDir, "agents", AGENT, "code"));
    expect(written?.dash.owner).toBe("dash_handoff");
  });

  /**
   * The consent gate, and it is not decorative.
   *
   * This command changes what DASH will spawn, and a control that re-pointed
   * that silently would be the one place in the product where it happened
   * without asking.
   */
  it("writes nothing at all when the person says no", async () => {
    const { dataDir, registration, repair } = await heldAgent();
    rmSync(registration.registrationPath(dataDir, AGENT), { force: true });

    const port = ports(dataDir, { agreed: false });
    const result = await repair.repairHeldAgent(AGENT, port.value);

    expect(result.ok).toBe(false);
    expect(result.refusal).toBe("cancelled");
    expect(port.asked).toHaveLength(1);
    // The gate held: still gone.
    expect(registration.readRegistration(dataDir, AGENT)).toBeNull();
  });

  /**
   * The folder is the source of everything read here, so it must come out
   * untouched — that is the whole reason this door is not a re-import, and the
   * reason `inspectChosenFolder`'s refusal of DASH's own folder stays in place.
   */
  it("leaves the agent's folder exactly as it was", async () => {
    const { dataDir, registration, repair } = await heldAgent();
    const code = path.join(dataDir, "agents", AGENT, "code");
    // Something no walk would re-declare and a folder swap would delete: the
    // kind of file an agent writes while it runs.
    const report = path.join(code, "reports");
    mkdirSync(report, { recursive: true });
    writeFileSync(path.join(report, "briefing.md"), "# what it found\n");
    rmSync(registration.registrationPath(dataDir, AGENT), { force: true });

    await repair.repairHeldAgent(AGENT, ports(dataDir).value);

    expect(existsSync(path.join(report, "briefing.md"))).toBe(true);
    expect(readFileSync(path.join(report, "briefing.md"), "utf8")).toBe("# what it found\n");
    // And the program it was registered against is still there.
    expect(existsSync(path.join(code, "agent.mjs"))).toBe(true);
  });

  /**
   * MAR-616's rule at this door: the door that writes a registration is the door
   * that asks the supervisor to re-read its list. Without it, a Start press in
   * the same session is refused as unknown.
   */
  it("asks the runner to re-read its list, and says so", async () => {
    const { dataDir, registration, repair } = await heldAgent();
    rmSync(registration.registrationPath(dataDir, AGENT), { force: true });

    let reloaded = 0;
    const result = await repair.repairHeldAgent(
      AGENT,
      ports(dataDir, {
        reload: async () => {
          reloaded += 1;
          return { ok: true };
        },
      }).value,
    );

    expect(reloaded).toBe(1);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("you can start it now");
  });

  /**
   * `chooseAgentFolder`'s distinction, kept: an unreachable runner changes
   * nothing about what was written, so the repair still succeeded and only the
   * claim is weaker.
   */
  it("still reports success when the runner cannot be reached", async () => {
    const { dataDir, registration, repair } = await heldAgent();
    rmSync(registration.registrationPath(dataDir, AGENT), { force: true });

    const result = await repair.repairHeldAgent(
      AGENT,
      ports(dataDir, { reload: async () => ({ ok: false }) }).value,
    );

    expect(result.ok).toBe(true);
    expect(result.detail).toContain("Close DASH and open it once");
    // Written regardless — that is the point of the weaker sentence.
    expect(registration.readRegistration(dataDir, AGENT)).not.toBeNull();
  });
});

describe("what it refuses to take over", () => {
  /**
   * A hand-written registration is somebody's own.
   *
   * `runner/README.md` documents the four-field file and people have written
   * them; `ownershipOf` reads one with no `dash` block as `external`, meaning
   * DASH must leave it alone. Rewriting it with DASH's interpreter and DASH's
   * paths would be this button quietly taking ownership of a program somebody
   * else set up.
   */
  it("keeps what somebody registered by hand, and refreshes only the plan", async () => {
    const { dataDir, registration, repair } = await heldAgent();
    writeFileSync(
      registration.registrationPath(dataDir, AGENT),
      JSON.stringify(
        {
          agent_id: AGENT,
          manifest_path: "/somewhere/else/agent.manifest.json",
          command: "/usr/bin/python3",
          args: ["main.py"],
          cwd: "/somewhere/else",
        },
        null,
        2,
      ),
    );
    expect(registration.readRegistration(dataDir, AGENT)?.dash.owner).toBe("external");

    const result = await repair.repairHeldAgent(AGENT, ports(dataDir).value);

    expect(result.ok).toBe(true);
    const written = registration.readRegistration(dataDir, AGENT);
    expect(written?.command).toBe("/usr/bin/python3");
    expect(written?.args).toEqual(["main.py"]);
    expect(written?.dash.owner).toBe("external");
  });

  /**
   * ADR 0008's manifest-only standing: the record is repaired, and DASH says
   * plainly that there is still nothing to run rather than reporting a cheerful
   * success over an agent that will not start.
   */
  it("repairs the plan and says so when there is no program to run", async () => {
    const { dataDir, registration, repair } = await heldAgent({ program: false });
    rmSync(registration.registrationPath(dataDir, AGENT), { force: true });

    const result = await repair.repairHeldAgent(AGENT, ports(dataDir).value);

    expect(result.ok).toBe(true);
    expect(result.detail).toContain("still cannot be started");
    expect(registration.readRegistration(dataDir, AGENT)).toBeNull();
  });

  it("refuses an agent DASH has no record of, before asking anybody", async () => {
    const { dataDir, repair } = await heldAgent();

    const port = ports(dataDir);
    const result = await repair.repairHeldAgent("an-agent-dash-never-had", port.value);

    expect(result.ok).toBe(false);
    expect(result.refusal).toBe("unknown_agent");
    // Nobody was asked a question about an agent that does not exist.
    expect(port.asked).toHaveLength(0);
  });
});
