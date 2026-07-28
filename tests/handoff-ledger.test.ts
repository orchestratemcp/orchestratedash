/**
 * The handoff ledger and forgetting an agent (MAR-428).
 *
 * Against the real store, in its own data directory, for the reason
 * `tests/store-sqlite.test.ts` gives: `lib/db.ts` resolves its location once at
 * import time, so a scenario that needs its own directory needs its own module
 * instance too.
 *
 * The assertion that matters most here is a negative one: removing an agent
 * must not remove the record of what it did. A monitor that erases its own
 * history because the thing it happened to is gone is not a monitor.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The shipped example's own agent name, not a transcription of it. */
const AGENT = "synthetic-gmail-meeting-assistant";

const opened: Array<{ dataDir: string; closeDb: () => void }> = [];
afterAll(() => {
  for (const entry of opened) {
    entry.closeDb();
    rmSync(entry.dataDir, { recursive: true, force: true });
  }
});

async function freshStore(): Promise<{
  store: typeof import("../lib/store");
  ledger: typeof import("../lib/handoff-ledger");
}> {
  const dataDir = mkdtempSync(path.join(tmpdir(), "dash-ledger-"));
  process.env.DASH_DATA_DIR = dataDir;
  vi.resetModules();
  const db = await import("../lib/db");
  const store = await import("../lib/store");
  const ledger = await import("../lib/handoff-ledger");
  opened.push({ dataDir, closeDb: db.closeDb });
  return { store, ledger };
}

function example(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(repoRoot, "examples", name), "utf8")) as Record<
    string,
    unknown
  >;
}

function record(overrides: Record<string, unknown> = {}): Parameters<
  typeof import("../lib/handoff-ledger").recordHandoff
>[0] {
  return {
    handoff_id: "b".repeat(32),
    agent: AGENT,
    outcome: "registered",
    source: "/projects/gmail-meeting-assistant",
    decided_at: "2026-07-28T12:00:00.000Z",
    ...overrides,
  } as Parameters<typeof import("../lib/handoff-ledger").recordHandoff>[0];
}

describe("the handoff ledger", () => {
  it("records a decision and reads it back", async () => {
    const { ledger } = await freshStore();
    ledger.recordHandoff(record());
    expect(ledger.readHandoffRecord("b".repeat(32))).toMatchObject({
      outcome: "registered",
      source: "/projects/gmail-meeting-assistant",
    });
  });

  it("keeps the first decision when a handoff is opened again", async () => {
    // The interesting fact about a replayed handoff is what happened the *first*
    // time. Letting a replay overwrite it would erase the registration event
    // behind an "unchanged".
    const { ledger } = await freshStore();
    ledger.recordHandoff(record());
    ledger.recordHandoff(record({ outcome: "unchanged", detail: "opened again" }));
    expect(ledger.readHandoffRecord("b".repeat(32))?.outcome).toBe("registered");
  });

  it("records refusals too", async () => {
    const { ledger } = await freshStore();
    ledger.recordHandoff(record({ outcome: "refused", detail: "expired" }));
    // "Nothing happened when I clicked that" has to be answerable.
    expect(ledger.readHandoffHistory(AGENT)).toHaveLength(1);
  });

  it("never stores the nonce", async () => {
    // Asserted on the shape rather than trusted to the migration comment: the
    // nonce is single-use proof of possession and has no purpose after the
    // decision. There is nowhere in the record to put it.
    const { ledger } = await freshStore();
    ledger.recordHandoff(record());
    expect(Object.keys(ledger.readHandoffRecord("b".repeat(32)) ?? {})).not.toContain("nonce");
  });
});

describe("forgetting an agent", () => {
  it("drops the manifest and reports that there was one", async () => {
    const { store } = await freshStore();
    store.importManifest(example("gmail-meeting-assistant.manifest.v2.example.json"));
    expect(store.listAgents()).toHaveLength(1);

    expect(store.forgetAgent(AGENT)).toEqual({ existed: true });
    expect(store.listAgents()).toHaveLength(0);
  });

  it("keeps the history of what the agent did", async () => {
    const { store } = await freshStore();
    const manifest = example("gmail-meeting-assistant.manifest.v2.example.json");
    store.importManifest(manifest);
    store.ingestEvents(example("run-event.example.json"));
    const runsBefore = store.listRuns().length;
    expect(runsBefore).toBeGreaterThan(0);

    store.forgetAgent(AGENT);

    // Still there, and now correctly reported as belonging to an agent DASH no
    // longer knows — which is a fact, not a defect.
    expect(store.listRuns()).toHaveLength(runsBefore);
  });

  it("says plainly when there was nothing to forget", async () => {
    const { store } = await freshStore();
    expect(store.forgetAgent("never-existed")).toEqual({ existed: false });
  });
});
