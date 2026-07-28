/**
 * Registrations, ownership and cleanup (MAR-428).
 *
 * Two acceptance criteria live here. "Opening the same handoff twice does not
 * create duplicates" is the `unchanged` outcome, and it is asserted to write
 * *nothing* rather than to write the same bytes again. "Show explicit ownership
 * and cleanup when an agent or registration is removed" is the refusal to delete
 * somebody else's registration, plus the report that names what survived.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  describeRegistrationChange,
  listRegistrations,
  managedManifestPath,
  readRegistration,
  registrationPath,
  registrationsDirectory,
  removeRegistration,
  sameRegistration,
  writeRegistration,
  type AgentRegistration,
} from "../lib/registration";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

function dataDir(): string {
  const root = mkdtempSync(path.join(tmpdir(), "dash-registration-"));
  roots.push(root);
  return root;
}

const MANIFEST = JSON.stringify({ manifest_version: 2, agent: { name: "folder-digest" } });

function input(overrides: Partial<AgentRegistration> = {}, manifestJson = MANIFEST) {
  return {
    registration: {
      agent_id: "folder-digest",
      manifest_path: "/authored/agent.manifest.json",
      command: "node",
      args: ["dist/agent.mjs"],
      cwd: "/projects/folder-digest",
      env: { DIGEST_FOLDER: "inbox" },
      ...overrides,
    },
    ownership: {
      owner: "dash_handoff" as const,
      handoff_id: "b".repeat(32),
      source_project: "/projects/folder-digest",
      display_name: "Folder digest",
      summary: "Counts what is in a folder.",
      registered_at: "2026-07-28T10:00:00.000Z",
    },
    manifestJson,
  };
}

describe("writing a registration", () => {
  it("writes the registration and DASH's own copy of the manifest", () => {
    const root = dataDir();
    const result = writeRegistration(root, input());

    expect(result.outcome).toBe("created");
    expect(existsSync(registrationPath(root, "folder-digest"))).toBe(true);
    expect(readFileSync(managedManifestPath(root, "folder-digest"), "utf8")).toBe(MANIFEST);
  });

  it("points the registration at DASH's copy, not the author's file", () => {
    // What DASH validated in the consent dialog is byte-for-byte what the runner
    // will read. Pointing into the project would leave a window between the
    // question and the answer.
    const root = dataDir();
    const result = writeRegistration(root, input());
    expect(result.registration.manifest_path).toBe(managedManifestPath(root, "folder-digest"));
    expect(result.registration.manifest_path).not.toBe("/authored/agent.manifest.json");
  });

  it("keeps the manifest copy out of the runner's registration scan", () => {
    // Every `.json` directly in the registration directory is loaded as a
    // registration. A sibling `*.manifest.json` would be skipped and warned
    // about on every runner start, forever.
    const root = dataDir();
    writeRegistration(root, input());
    expect(path.dirname(managedManifestPath(root, "folder-digest"))).not.toBe(
      registrationsDirectory(root),
    );
  });

  it("is idempotent: the same facts write nothing at all", () => {
    const root = dataDir();
    writeRegistration(root, input());
    const before = statSync(registrationPath(root, "folder-digest")).mtimeMs;

    const again = writeRegistration(root, input());

    expect(again.outcome).toBe("unchanged");
    expect(again.changes).toEqual([]);
    // Not "wrote identical bytes" — did not write. "Has this been touched since
    // I approved it" stays a question the filesystem can answer.
    expect(statSync(registrationPath(root, "folder-digest")).mtimeMs).toBe(before);
  });

  it("is idempotent across a rebuild, which changes the timestamp and the handoff", () => {
    const root = dataDir();
    const first = input();
    writeRegistration(root, first);

    const rebuilt = input();
    rebuilt.ownership.handoff_id = "c".repeat(32);
    rebuilt.ownership.registered_at = "2026-07-28T12:00:00.000Z";

    expect(writeRegistration(root, rebuilt).outcome).toBe("unchanged");
  });

  it("reports a real change in words a person can act on", () => {
    const root = dataDir();
    writeRegistration(root, input());

    const moved = writeRegistration(root, input({ args: ["dist/agent-v2.mjs"] }));
    expect(moved.outcome).toBe("updated");
    expect(moved.changes).toContain("what DASH would run has changed");
    expect(moved.changes.join(" ")).not.toMatch(/manifest_path|sha256|agent_dom/);
  });

  it("notices when the plan changed even though the command did not", () => {
    const root = dataDir();
    writeRegistration(root, input());
    const replanned = writeRegistration(
      root,
      input({}, JSON.stringify({ manifest_version: 2, agent: { name: "folder-digest" }, extra: 1 })),
    );
    expect(replanned.changes).toContain("what the agent plans to do has changed");
  });
});

describe("ownership", () => {
  it("treats a hand-written registration as external", () => {
    // The four-field file `runner/README.md` documents. People have written
    // them; DASH must neither refuse them nor claim to own them.
    const root = dataDir();
    mkdirSync(registrationsDirectory(root), { recursive: true });
    writeFileSync(
      registrationPath(root, "hand-made"),
      JSON.stringify({
        agent_id: "hand-made",
        manifest_path: "./hand-made.manifest.json",
        command: "node",
        args: ["./hand-made.mjs"],
      }),
      "utf8",
    );

    expect(readRegistration(root, "hand-made")?.dash.owner).toBe("external");
  });

  it("lists DASH's own and everyone else's together", () => {
    const root = dataDir();
    writeRegistration(root, input());
    writeFileSync(
      registrationPath(root, "hand-made"),
      JSON.stringify({ agent_id: "hand-made", manifest_path: "x", command: "node", args: [] }),
      "utf8",
    );

    // A list that showed only DASH's own would tell a user "no agents" while
    // the runner supervised two.
    expect(listRegistrations(root).map((entry) => entry.agent_id)).toEqual([
      "folder-digest",
      "hand-made",
    ]);
  });

  it("ignores a file it cannot read rather than throwing", () => {
    const root = dataDir();
    mkdirSync(registrationsDirectory(root), { recursive: true });
    writeFileSync(path.join(registrationsDirectory(root), "broken.json"), "{ not json", "utf8");
    expect(listRegistrations(root)).toEqual([]);
  });
});

describe("removing", () => {
  it("removes what DASH owns and says what it left alone", () => {
    const root = dataDir();
    writeRegistration(root, input());

    const report = removeRegistration(root, "folder-digest");

    expect(report.ok).toBe(true);
    expect(existsSync(registrationPath(root, "folder-digest"))).toBe(false);
    expect(existsSync(managedManifestPath(root, "folder-digest"))).toBe(false);
    // The anxiety an uninstall dialog must not create: "did that delete my work?"
    expect(report.left_alone.join(" ")).toContain("/projects/folder-digest");
    expect(report.removed.length).toBeGreaterThan(0);
  });

  it("refuses to delete a registration it did not create", () => {
    const root = dataDir();
    mkdirSync(registrationsDirectory(root), { recursive: true });
    writeFileSync(
      registrationPath(root, "hand-made"),
      JSON.stringify({ agent_id: "hand-made", manifest_path: "x", command: "node", args: [] }),
      "utf8",
    );

    const report = removeRegistration(root, "hand-made");

    expect(report.ok).toBe(false);
    expect(existsSync(registrationPath(root, "hand-made"))).toBe(true);
    // And it says where the file is, so the person can do it themselves.
    expect(report.refusal).toContain(registrationPath(root, "hand-made"));
  });

  it("says plainly when there was nothing to remove", () => {
    const report = removeRegistration(dataDir(), "never-existed");
    expect(report).toMatchObject({ ok: false });
    expect(report.refusal).toContain("never-existed");
  });
});

describe("sameness, as the runner asks it", () => {
  const base: AgentRegistration = {
    agent_id: "a",
    manifest_path: "/data/agents/manifests/a.manifest.json",
    command: "node",
    args: ["agent.mjs"],
    cwd: "/projects/a",
  };

  it("is true for two readings of one file", () => {
    expect(sameRegistration(base, { ...base })).toBe(true);
  });

  it("is false when anything that would be spawned differs", () => {
    expect(sameRegistration(base, { ...base, command: "python" })).toBe(false);
    expect(sameRegistration(base, { ...base, args: ["other.mjs"] })).toBe(false);
    expect(sameRegistration(base, { ...base, cwd: "/elsewhere" })).toBe(false);
    expect(sameRegistration(base, { ...base, env: { A: "1" } })).toBe(false);
  });

  it("describes a change without naming an internal field", () => {
    const managed = writeRegistration(dataDir(), input()).registration;
    const changed = { ...managed, command: "python" };
    expect(describeRegistrationChange(managed, changed)).toEqual([
      "what DASH would run has changed",
    ]);
  });
});
