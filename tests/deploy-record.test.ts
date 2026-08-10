/**
 * What DASH remembers about a push, and what it must never remember
 * (MAR-584, ADR 0010).
 *
 * MAR-574 wrote "DASH keeps no record of what it has deployed where" into
 * `lib/shell/ipc.ts`, on the correct grounds that DASH has no inventory of
 * somebody else's machine. ADR 0010 keeps that reasoning and narrows the rule to
 * what it actually supports: **a record of DASH's own outbound act is a fact
 * DASH observed; a claim about a remote machine is not.**
 *
 * So these tests are as much about the columns that do not exist as about the
 * ones that do. The shape assertion is deliberate: it fails the day somebody
 * adds `running` or `last_seen_at`, which is the exact edit the ADR exists to
 * stop and the one that would be easiest to make while being helpful.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(path.join(tmpdir(), "dash-deploy-record-"));
process.env.DASH_DATA_DIR = dataDir;

const {
  forgetHostDeploys,
  readAgentDeploys,
  recordAgentDeploy,
  resetStore,
} = await import("../lib/store");
const { closeDb, db } = await import("../lib/db");
const { describeBundleContents } = await import("../lib/deploy/folder-bundle");
const { storedDigestSummary } = await import("../lib/agent-folders");

beforeEach(() => {
  resetStore();
  db().prepare("DELETE FROM agent_deploys").run();
});

afterAll(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("the deploy record", () => {
  it("holds only facts DASH observed about its own act", () => {
    /*
     * The columns, asserted by name. There is no `running`, no `status` and no
     * `last_seen_at`, and the migration says there never will be: those are
     * properties of the remote machine, and a row asserting one would be the
     * inventory MAR-574 was right to refuse.
     */
    const columns = db()
      .prepare("PRAGMA table_info(agent_deploys)")
      .all()
      .map((row) => String(row["name"]))
      .sort();
    expect(columns).toEqual([
      "agent",
      "files_sha256",
      "host_id",
      "manifest_sha256",
      "sent_at",
    ]);
  });

  it("records what went across, with the moment it went", () => {
    recordAgentDeploy(
      {
        agent: "ai-news-scout",
        host_id: "host-1",
        manifest_sha256: "manifest-a",
        files_sha256: "files-a",
      },
      "2026-08-07T09:00:00.000Z",
    );
    expect(readAgentDeploys("ai-news-scout")).toEqual([
      {
        agent: "ai-news-scout",
        host_id: "host-1",
        sent_at: "2026-08-07T09:00:00.000Z",
        manifest_sha256: "manifest-a",
        files_sha256: "files-a",
      },
    ]);
  });

  it("keeps one row per server, newest first", () => {
    // Overwritten rather than appended, for `recordAgentLook`'s reason: the
    // question a surface asks is "did DASH send this there, and was it before
    // the change I just accepted", and no earlier push changes that answer.
    recordAgentDeploy(
      { agent: "scout", host_id: "host-1", manifest_sha256: "a", files_sha256: "a" },
      "2026-08-01T09:00:00.000Z",
    );
    recordAgentDeploy(
      { agent: "scout", host_id: "host-1", manifest_sha256: "b", files_sha256: "b" },
      "2026-08-07T09:00:00.000Z",
    );
    recordAgentDeploy(
      { agent: "scout", host_id: "host-2", manifest_sha256: "b", files_sha256: "b" },
      "2026-08-09T09:00:00.000Z",
    );

    const rows = readAgentDeploys("scout");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.host_id).toBe("host-2");
    expect(rows[1]).toMatchObject({ host_id: "host-1", manifest_sha256: "b" });
  });

  it("holds a null program digest rather than pretending to a comparison", () => {
    // An agent with no recorded baseline cannot have a comparable program
    // digest, and null means *not comparable* to every reader of the record.
    recordAgentDeploy(
      { agent: "legacy", host_id: "host-1", manifest_sha256: "a", files_sha256: null },
      "2026-08-07T09:00:00.000Z",
    );
    expect(readAgentDeploys("legacy")[0]?.files_sha256).toBeNull();
  });

  it("forgets every push to a server DASH no longer holds", () => {
    /*
     * ADR 0010 requires this and it is not tidiness. `host.forget` removes the
     * key and the label; a surviving row would name a server DASH can no longer
     * reach or even name, which could only render as an orphaned claim about a
     * machine.
     */
    recordAgentDeploy(
      { agent: "scout", host_id: "host-1", manifest_sha256: "a", files_sha256: "a" },
      "2026-08-07T09:00:00.000Z",
    );
    recordAgentDeploy(
      { agent: "other", host_id: "host-1", manifest_sha256: "a", files_sha256: "a" },
      "2026-08-07T09:00:00.000Z",
    );
    recordAgentDeploy(
      { agent: "scout", host_id: "host-2", manifest_sha256: "a", files_sha256: "a" },
      "2026-08-07T09:00:00.000Z",
    );

    forgetHostDeploys("host-1");
    expect(readAgentDeploys("scout").map((row) => row.host_id)).toEqual(["host-2"]);
    expect(readAgentDeploys("other")).toEqual([]);
  });
});

describe("what a bundle records about itself", () => {
  /** An install request shaped the way `assembleBundle` produces one. */
  function request(files: Array<{ path: string; sha256: string }>) {
    return {
      verb: "install" as const,
      bundle_id: "scout",
      agent_id: "scout",
      runner_build: "runner-1",
      files: files.map((file) => ({
        ...file,
        content_base64: "",
        mode: 0o644,
      })),
    };
  }

  it("digests exactly the tracked program files, and the manifest separately", () => {
    const tracked = ["code/agent.mjs", "code/sources.json"];
    const contents = describeBundleContents(
      request([
        { path: "runner/index.mjs", sha256: "runner" },
        { path: "agent/agent.manifest.json", sha256: "manifest" },
        { path: "agent/registration.json", sha256: "registration" },
        { path: "agent/code/agent.mjs", sha256: "program" },
        { path: "agent/code/sources.json", sha256: "sources" },
      ]),
      tracked,
    );

    expect(contents.manifest_sha256).toBe("manifest");
    // The same value the baseline reduces to, which is the whole point: two
    // moments, one function, one path space.
    expect(contents.files_sha256).toBe(
      storedDigestSummary([
        { path: "code/agent.mjs", sha256: "program" },
        { path: "code/sources.json", sha256: "sources" },
      ]),
    );
  });

  it("ignores the runner, so a DASH upgrade is not a change to the agent", () => {
    const tracked = ["code/agent.mjs"];
    const withOldRunner = describeBundleContents(
      request([
        { path: "runner/index.mjs", sha256: "runner-old" },
        { path: "agent/agent.manifest.json", sha256: "manifest" },
        { path: "agent/code/agent.mjs", sha256: "program" },
      ]),
      tracked,
    );
    const withNewRunner = describeBundleContents(
      request([
        { path: "runner/index.mjs", sha256: "runner-new" },
        { path: "agent/agent.manifest.json", sha256: "manifest" },
        { path: "agent/code/agent.mjs", sha256: "program" },
      ]),
      tracked,
    );
    expect(withNewRunner).toEqual(withOldRunner);
  });

  it("ignores what the agent produced, which the bundle carries and the baseline does not", () => {
    /*
     * A bundle ships the whole of `code/`, including `code/reports/` and
     * `code/runs/`. A digest over all of it would differ on every push, so "the
     * server has an older copy" would become true the moment the agent ran once
     * — which is not a fact about its program at all.
     */
    const tracked = ["code/agent.mjs"];
    const before = describeBundleContents(
      request([
        { path: "agent/agent.manifest.json", sha256: "manifest" },
        { path: "agent/code/agent.mjs", sha256: "program" },
      ]),
      tracked,
    );
    const afterARun = describeBundleContents(
      request([
        { path: "agent/agent.manifest.json", sha256: "manifest" },
        { path: "agent/code/agent.mjs", sha256: "program" },
        { path: "agent/code/reports/2026-08-09.json", sha256: "a-digest-it-wrote" },
        { path: "agent/code/runs/events.jsonl", sha256: "its-own-log" },
      ]),
      tracked,
    );
    expect(afterARun).toEqual(before);
  });

  it("records a null program digest when there is no baseline to compare against", () => {
    const contents = describeBundleContents(
      request([
        { path: "agent/agent.manifest.json", sha256: "manifest" },
        { path: "agent/code/agent.mjs", sha256: "program" },
      ]),
      [],
    );
    expect(contents.manifest_sha256).toBe("manifest");
    expect(contents.files_sha256).toBeNull();
  });
});
