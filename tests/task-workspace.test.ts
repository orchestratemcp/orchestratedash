/**
 * The runner-owned task workspace, end to end against a real filesystem.
 *
 * Real directories, real SQLite, real bytes, real SHA-256. Nothing here is
 * mocked, because every claim this feature makes is a claim about what the
 * operating system will actually do with a path — and a fake filesystem that
 * behaved the way the code expects would prove only that the expectations are
 * self-consistent.
 *
 * The five availability states are the reason the file exists. MAR-434's design
 * slice shipped their vocabulary, a test that the four recoveries are four
 * distinct strings, and no producer at all: MAR-457 stores an artifact as a
 * body, so there was no file whose absence anything could observe. Each state is
 * driven here by making the thing that produces it actually happen.
 */

import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openRunnerStore, readRunnerAudit, type RunnerStore } from "../runner/store";
import { createTaskWorkspaceApi, type TaskWorkspaceApi } from "../runner/task-api";
import {
  admitInput,
  artifactAvailability,
  bindTaskRun,
  createTask,
  deleteArtifact,
  effectiveLimits,
  isOpaqueId,
  openWorkspaceRoot,
  outboxDirectory,
  readArtifact,
  readInputs,
  registerArtifact,
  resolveInput,
  RUNNER_MAX_INPUT_FILE_BYTES,
  sniffMediaType,
  verifyArtifact,
  type WorkspaceRoot,
} from "../runner/workspace";

const AGENT = "offert-agent";
const RUN = "run-2026-08-06-01";

let scratch: string;
let dataDir: string;
let userFiles: string;
let store: RunnerStore;
let root: WorkspaceRoot;

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * JSON with its backslash escaping undone, for asserting a path is *absent*.
 *
 * `JSON.stringify` turns `C:\Users\henri` into `C:\\Users\\henri`, so
 * `expect(JSON.stringify(x)).not.toContain("C:\\Users\\henri")` — which is what
 * the obvious spelling produces — is true of every document on Windows,
 * including one that leaked the path in full. A negative assertion that cannot
 * fail is worse than no assertion, because it reads in review as coverage.
 */
function serialised(value: unknown): string {
  return JSON.stringify(value).replace(/\\\\/g, "\\");
}

/** A file in the user's own territory, outside anything the runner owns. */
function userFile(name: string, contents: Buffer | string): string {
  const file = path.join(userFiles, name);
  writeFileSync(file, contents);
  return file;
}

beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), "dash-workspace-"));
  dataDir = path.join(scratch, "data");
  userFiles = path.join(scratch, "documents");
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(userFiles, { recursive: true });
  store = openRunnerStore(dataDir);
  root = openWorkspaceRoot(dataDir);
});

afterEach(() => {
  store.close();
  rmSync(scratch, { recursive: true, force: true });
});

/* ---------------------------------------------------------------------- *
 * Limits
 * ---------------------------------------------------------------------- */

describe("limits", () => {
  it("lets a manifest lower a ceiling and refuses to let it raise one", () => {
    // The whole argument for `effectiveLimits` existing: a manifest is a
    // document an agent author wrote, and it must not be able to decide how
    // large a file DASH copies into its own data directory.
    expect(effectiveLimits({ max_file_bytes: 1024 }).max_file_bytes).toBe(1024);
    expect(effectiveLimits({ max_file_bytes: 1e18 }).max_file_bytes).toBe(RUNNER_MAX_INPUT_FILE_BYTES);
    expect(effectiveLimits({ max_file_bytes: -5 }).max_file_bytes).toBe(RUNNER_MAX_INPUT_FILE_BYTES);
    expect(effectiveLimits().max_file_bytes).toBe(RUNNER_MAX_INPUT_FILE_BYTES);
  });
});

describe("media types", () => {
  it("reads the bytes rather than believing the name", () => {
    expect(sniffMediaType(Buffer.from("%PDF-1.7\n"))).toBe("application/pdf");
    expect(sniffMediaType(Buffer.from([0x4d, 0x5a, 0x90, 0x00]))).toBe(
      "application/vnd.microsoft.portable-executable",
    );
    expect(sniffMediaType(Buffer.from("Hello, kund.\n"))).toBe("text/plain");
    expect(sniffMediaType(Buffer.from([0x00, 0x01, 0x02]))).toBe("application/octet-stream");
  });
});

/* ---------------------------------------------------------------------- *
 * Inputs
 * ---------------------------------------------------------------------- */

describe("admitting inputs", () => {
  it("copies the bytes, mints an opaque id, and records the digest", async () => {
    const task = createTask(store.database, root, AGENT);
    const bytes = "%PDF-1.7\nCustomer brief\n";
    const source = userFile("kund-brief.pdf", bytes);

    const result = await admitInput(store.database, root, {
      task_id: task.task_id,
      role: "customer_brief",
      source_path: source,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    // Opaque: the id carries nothing about where the file came from. That is the
    // contract's "file bytes, absolute paths, and raw contents do not enter
    // manifests, telemetry, command URLs, logs, or Chief transcripts".
    expect(isOpaqueId(result.input.input_id, "in")).toBe(true);
    expect(result.input.input_id).not.toContain("kund");
    expect(serialised(result.input)).not.toContain(userFiles);

    expect(result.input.sha256).toBe(sha256(bytes));
    expect(result.input.byte_size).toBe(Buffer.byteLength(bytes));
    expect(result.input.media_type).toBe("application/pdf");
    // The display name is the basename and nothing else.
    expect(result.input.display_name).toBe("kund-brief.pdf");

    // The copy is real, and it is the copy the digest describes.
    const resolved = resolveInput(store.database, root, task.task_id, result.input.input_id);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(readFileSync(resolved.path, "utf8")).toBe(bytes);
    }
  });

  it("leaves the user's own file exactly where it was", async () => {
    const task = createTask(store.database, root, AGENT);
    const source = userFile("prislista.txt", "1 unit = 10 SEK");
    const before = statSync(source);

    await admitInput(store.database, root, {
      task_id: task.task_id,
      role: "price_list",
      source_path: source,
    });

    // DASH is not a file manager. Admission copies; it never moves, renames or
    // opens the original for writing.
    expect(statSync(source).size).toBe(before.size);
    expect(readFileSync(source, "utf8")).toBe("1 unit = 10 SEK");
  });

  it("refuses a file past the per-file limit before copying anything", async () => {
    const task = createTask(store.database, root, AGENT);
    const source = userFile("big.bin", Buffer.alloc(4096, 1));

    const result = await admitInput(store.database, root, {
      task_id: task.task_id,
      role: "customer_brief",
      source_path: source,
      limits: { max_file_bytes: 1024 },
    });

    expect(result).toMatchObject({ ok: false, refusal: "file_too_large" });
    expect(readInputs(store.database, task.task_id)).toHaveLength(0);
  });

  it("refuses the file that would take the task past its total", async () => {
    const task = createTask(store.database, root, AGENT);
    const limits = { max_total_bytes: 1500 };
    await admitInput(store.database, root, {
      task_id: task.task_id,
      role: "a",
      source_path: userFile("one.bin", Buffer.alloc(1000, 1)),
      limits,
    });

    const second = await admitInput(store.database, root, {
      task_id: task.task_id,
      role: "b",
      source_path: userFile("two.bin", Buffer.alloc(1000, 2)),
      limits,
    });

    expect(second).toMatchObject({ ok: false, refusal: "task_too_large" });
    // The first one survives. A budget refusal is not a reason to lose what was
    // already admitted.
    expect(readInputs(store.database, task.task_id)).toHaveLength(1);
  });

  it("refuses more files than the declared count", async () => {
    const task = createTask(store.database, root, AGENT);
    await admitInput(store.database, root, {
      task_id: task.task_id,
      role: "a",
      source_path: userFile("one.txt", "one"),
      limits: { max_count: 1 },
    });
    const second = await admitInput(store.database, root, {
      task_id: task.task_id,
      role: "b",
      source_path: userFile("two.txt", "two"),
      limits: { max_count: 1 },
    });
    expect(second).toMatchObject({ ok: false, refusal: "too_many_inputs" });
  });

  it("refuses a renamed executable against a declared PDF role", async () => {
    const task = createTask(store.database, root, AGENT);
    // `MZ` is a Windows PE. The name says .pdf, the bytes do not.
    const source = userFile("offert.pdf", Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]));

    const result = await admitInput(store.database, root, {
      task_id: task.task_id,
      role: "customer_brief",
      source_path: source,
      limits: { media_types: ["application/pdf"] },
    });

    expect(result).toMatchObject({ ok: false, refusal: "media_type_not_accepted" });
    // Nothing is left behind by a refusal.
    expect(readInputs(store.database, task.task_id)).toHaveLength(0);
  });

  it("refuses a path that leaves the workspace or names a device", async () => {
    const task = createTask(store.database, root, AGENT);
    for (const [candidate, refusal] of [
      ["../../etc/passwd", "not_absolute"],
      ["C:\\work\\..\\Windows\\System32\\config\\SAM", "traversal"],
      ["\\\\?\\C:\\Windows\\System32\\config\\SAM", "device_namespace"],
      ["\\\\server\\share\\brief.docx", "unc_path"],
      [path.join(userFiles, "NUL"), "reserved_device_name"],
      [`${path.join(userFiles, "brief.docx")}:hidden`, "alternate_data_stream"],
    ] as const) {
      const result = await admitInput(store.database, root, {
        task_id: task.task_id,
        role: "customer_brief",
        source_path: candidate,
      });
      expect(result, `expected ${candidate} to be refused as ${refusal}`).toMatchObject({
        ok: false,
        refusal,
      });
    }
  });

  it("refuses an input once the task has been dispatched", async () => {
    const task = createTask(store.database, root, AGENT);
    const api = createTaskWorkspaceApi({
      database: store.database,
      root,
      dispatchToChild: () => true,
    });
    bindTaskRun(store.database, task.task_id, RUN);
    store.database
      .prepare("UPDATE task_workspaces SET closed_at = ? WHERE task_id = ?")
      .run(new Date().toISOString(), task.task_id);

    const result = await api.admit(AGENT, task.task_id, {
      role: "customer_brief",
      source_path: userFile("late.txt", "added after the run started"),
    });

    // The input set a run reads must be the input set the person approved.
    expect(result).toMatchObject({ ok: false, refusal: "task_closed" });
  });

  it("will not resolve an input id that belongs to another task", async () => {
    const mine = createTask(store.database, root, AGENT);
    const theirs = createTask(store.database, root, "other-agent");
    const admitted = await admitInput(store.database, root, {
      task_id: theirs.task_id,
      role: "customer_brief",
      source_path: userFile("theirs.txt", "not yours"),
    });
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) {
      return;
    }

    expect(resolveInput(store.database, root, mine.task_id, admitted.input.input_id)).toMatchObject({
      ok: false,
      refusal: "unknown_input",
    });
  });

  it("refuses an input id that was not minted here", () => {
    const task = createTask(store.database, root, AGENT);
    // The shape check runs before the row lookup, so a path fragment is refused
    // as not-an-id rather than reaching the filesystem at all.
    expect(resolveInput(store.database, root, task.task_id, "../../../runner.key")).toMatchObject({
      ok: false,
      refusal: "unknown_input",
    });
  });
});

/* ---------------------------------------------------------------------- *
 * Artifacts
 * ---------------------------------------------------------------------- */

/** Put a file in the child's outbox, as a running agent would. */
function writeToOutbox(taskId: string, name: string, contents: Buffer | string): void {
  writeFileSync(path.join(outboxDirectory(root, taskId), name), contents);
}

async function startedTask(): Promise<string> {
  const task = createTask(store.database, root, AGENT);
  bindTaskRun(store.database, task.task_id, RUN);
  return task.task_id;
}

describe("registering artifacts", () => {
  it("binds the agent and run from the runner, never from the child", async () => {
    const taskId = await startedTask();
    writeToOutbox(taskId, "offert.pdf", "%PDF-1.7\nOffert\n");

    const result = await registerArtifact(store.database, root, {
      task_id: taskId,
      agent: AGENT,
      role: "finished_offert",
      name: "offert.pdf",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    // There is nowhere in the child's message to put either of these, which is
    // stronger than checking that they match.
    expect(result.artifact.agent).toBe(AGENT);
    expect(result.artifact.run_id).toBe(RUN);
    expect(result.artifact.sha256).toBe(sha256("%PDF-1.7\nOffert\n"));
    expect(isOpaqueId(result.artifact.artifact_id, "art")).toBe(true);
  });

  it("refuses a task that belongs to a different agent", async () => {
    const taskId = await startedTask();
    writeToOutbox(taskId, "offert.pdf", "%PDF-1.7");

    const result = await registerArtifact(store.database, root, {
      task_id: taskId,
      agent: "some-other-agent",
      role: "finished_offert",
      name: "offert.pdf",
    });

    expect(result).toMatchObject({ ok: false, refusal: "foreign_task" });
  });

  it("takes the file out of the child's reach", async () => {
    const taskId = await startedTask();
    writeToOutbox(taskId, "offert.pdf", "%PDF-1.7\nOffert\n");
    const result = await registerArtifact(store.database, root, {
      task_id: taskId,
      agent: AGENT,
      role: "finished_offert",
      name: "offert.pdf",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    // The outbox copy is gone, and the registered copy is somewhere the child
    // was never told about. That absence is what makes the recorded digest
    // still true later.
    expect(() => statSync(path.join(outboxDirectory(root, taskId), "offert.pdf"))).toThrow();
    expect(result.artifact.stored_path.startsWith(root.artifacts)).toBe(true);
    expect(result.artifact.stored_path).not.toContain(taskId);
    expect(verifyArtifact(result.artifact).ok).toBe(true);
  });

  it("refuses a name that is a path, a device, or a stream", async () => {
    const taskId = await startedTask();
    for (const [name, refusal] of [
      ["../../../runner.key", "not_a_single_component"],
      ["sub/offert.pdf", "not_a_single_component"],
      ["NUL", "reserved_device_name"],
      ["offert.pdf:hidden", "alternate_data_stream"],
      ["offert.pdf.", "trailing_dot_or_space"],
    ] as const) {
      const result = await registerArtifact(store.database, root, {
        task_id: taskId,
        agent: AGENT,
        role: "finished_offert",
        name,
      });
      expect(result, `expected ${name} to be refused as ${refusal}`).toMatchObject({
        ok: false,
        refusal,
      });
    }
  });

  it("rejects one malformed candidate without losing a valid neighbour", async () => {
    const taskId = await startedTask();
    writeToOutbox(taskId, "good.pdf", "%PDF-1.7\nGood\n");

    const bad = await registerArtifact(store.database, root, {
      task_id: taskId,
      agent: AGENT,
      role: "finished_offert",
      name: "../escape.pdf",
    });
    const good = await registerArtifact(store.database, root, {
      task_id: taskId,
      agent: AGENT,
      role: "finished_offert",
      name: "good.pdf",
    });

    // The issue's criterion: "a neighbouring malformed artifact candidate is
    // rejected and recorded while the valid artifact remains available and the
    // agent continues."
    expect(bad.ok).toBe(false);
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(artifactAvailability(root, good.artifact)).toEqual({ state: "available" });
    }
  });

  it("refuses an output past the byte limit", async () => {
    const taskId = await startedTask();
    writeToOutbox(taskId, "huge.bin", Buffer.alloc(4096, 7));

    const result = await registerArtifact(store.database, root, {
      task_id: taskId,
      agent: AGENT,
      role: "finished_offert",
      name: "huge.bin",
      max_bytes: 1024,
    });

    expect(result).toMatchObject({ ok: false, refusal: "file_too_large" });
  });

  it("refuses to attribute an output to a task that has no run", async () => {
    const task = createTask(store.database, root, AGENT);
    writeToOutbox(task.task_id, "early.pdf", "%PDF-1.7");

    const result = await registerArtifact(store.database, root, {
      task_id: task.task_id,
      agent: AGENT,
      role: "finished_offert",
      name: "early.pdf",
    });

    expect(result).toMatchObject({ ok: false, refusal: "task_not_started" });
  });

  it("refuses to rebind a task to a second run", async () => {
    const task = createTask(store.database, root, AGENT);
    expect(bindTaskRun(store.database, task.task_id, RUN)).toBe(true);
    // A task whose run id could change would silently reattribute artifacts
    // already registered under the first one.
    expect(bindTaskRun(store.database, task.task_id, "run-two")).toBe(false);
  });
});

/* ---------------------------------------------------------------------- *
 * The five availability states, each driven by its producer
 * ---------------------------------------------------------------------- */

describe("availability", () => {
  async function registered(name = "offert.pdf", contents = "%PDF-1.7\nOffert\n") {
    const taskId = await startedTask();
    writeToOutbox(taskId, name, contents);
    const result = await registerArtifact(store.database, root, {
      task_id: taskId,
      agent: AGENT,
      role: "finished_offert",
      name,
    });
    if (!result.ok) {
      throw new Error(`registration failed: ${result.refusal}`);
    }
    return result.artifact;
  }

  it("available: the bytes are where the receipt says", async () => {
    const artifact = await registered();
    expect(artifactAvailability(root, artifact)).toEqual({ state: "available" });
  });

  it("missing: the file is gone and is nowhere else", async () => {
    const artifact = await registered();
    rmSync(artifact.stored_path);
    // The only state where "run it again" is the whole recovery.
    expect(artifactAvailability(root, artifact)).toEqual({ state: "missing" });
  });

  it("moved: the bytes are elsewhere, and DASH says where", async () => {
    const artifact = await registered();
    const elsewhere = path.join(root.artifacts, `art_${randomBytes(16).toString("hex")}`);
    renameSync(artifact.stored_path, elsewhere);

    // The state that decides the design: re-running would leave the person with
    // two outputs while the one they were hunting for is still where it went.
    const availability = artifactAvailability(root, artifact);
    expect(availability.state).toBe("moved");
    expect(availability).toMatchObject({ found_at: elsewhere });
  });

  it("moved is decided by content, not by size alone", async () => {
    const artifact = await registered("offert.pdf", "%PDF-1.7\nA\n");
    // A decoy of exactly the same length. If the search compared sizes and
    // stopped there, this would be reported as the missing file.
    writeFileSync(
      path.join(root.artifacts, `art_${randomBytes(16).toString("hex")}`),
      "%PDF-1.7\nB\n",
    );
    rmSync(artifact.stored_path);

    expect(artifactAvailability(root, artifact)).toEqual({ state: "missing" });
  });

  it("deleted: somebody asked for it to go, and the run's record survives", async () => {
    const artifact = await registered();
    expect(deleteArtifact(store.database, artifact.artifact_id).ok).toBe(true);

    const after = readArtifact(store.database, artifact.artifact_id);
    expect(after).not.toBeNull();
    if (after === null) {
      return;
    }
    // The bytes go and the row stays: "deleting an artifact is explicit,
    // audited, and separate from deleting run history".
    expect(after.retention).toBe("deleted");
    expect(artifactAvailability(root, after).state).toBe("deleted");
    expect(() => statSync(artifact.stored_path)).toThrow();
    // And it is not reported as a fault.
    expect(artifactAvailability(root, after)).toMatchObject({ deleted_at: expect.any(String) });
  });

  it("deleting twice is refused rather than reported as a second success", async () => {
    const artifact = await registered();
    expect(deleteArtifact(store.database, artifact.artifact_id).ok).toBe(true);
    expect(deleteArtifact(store.database, artifact.artifact_id).ok).toBe(false);
  });

  it("quarantined: the runner is holding bytes it refused", async () => {
    const artifact = await registered();
    // The state the runner produces itself, when an integrity check fails and
    // the bytes are kept apart rather than destroyed.
    store.database
      .prepare(
        "UPDATE workspace_artifacts SET retention = 'quarantined', quarantine_reason = ? " +
          "WHERE artifact_id = ?",
      )
      .run("The bytes read back from storage did not match the bytes that were written.", artifact.artifact_id);

    const after = readArtifact(store.database, artifact.artifact_id);
    expect(after).not.toBeNull();
    if (after === null) {
      return;
    }
    const availability = artifactAvailability(root, after);
    expect(availability.state).toBe("quarantined");
    // The reason names what DASH observed and does not name a product. The
    // non-goals rule out antivirus claims beyond the boundaries implemented.
    expect(availability).toMatchObject({ reason: expect.stringContaining("did not match") });
  });

  it("quarantined: the file is there and cannot be opened", async () => {
    if (process.platform === "win32") {
      // chmod does not remove read access on Windows; the equivalent needs an
      // ACL change, and the runner-produced quarantine above covers the state.
      return;
    }
    const artifact = await registered();
    chmodSync(artifact.stored_path, 0o000);
    try {
      const availability = artifactAvailability(root, artifact);
      // Distinguished from `missing` because re-running would produce another
      // file that the same something would take the same way.
      expect(availability.state).toBe("quarantined");
    } finally {
      chmodSync(artifact.stored_path, 0o600);
    }
  });

  it("a file replaced in place is not reported as available", async () => {
    const artifact = await registered();
    writeFileSync(artifact.stored_path, "%PDF-1.7\nsomething else entirely\n");
    // Right path, wrong bytes. A receipt that asserted a size it had not
    // measured is the failure this whole module is against.
    expect(artifactAvailability(root, artifact).state).not.toBe("available");
    expect(verifyArtifact(artifact).ok).toBe(false);
  });
});

/* ---------------------------------------------------------------------- *
 * The API layer: audit, dispatch, and what DASH is told
 * ---------------------------------------------------------------------- */

describe("the task API", () => {
  let api: TaskWorkspaceApi;
  let dispatched: Array<{ agentId: string; task: unknown }>;

  beforeEach(() => {
    dispatched = [];
    api = createTaskWorkspaceApi({
      database: store.database,
      root,
      dispatchToChild: (agentId, task) => {
        dispatched.push({ agentId, task });
        return true;
      },
      log: () => {},
    });
  });

  it("audits a refusal without writing the user's path anywhere", async () => {
    const task = api.create(AGENT);
    await api.admit(AGENT, task.task_id, {
      role: "customer_brief",
      source_path: "\\\\?\\C:\\Windows\\System32\\config\\SAM",
    });

    const audit = readRunnerAudit(store.database, AGENT);
    const refusal = audit.find((row) => row.decision === "refused");
    expect(refusal).toBeDefined();
    expect(refusal?.reason_code).toBe("device_namespace");
    // The reason code is a fact about the boundary; the path is a fact about
    // the user's disk and belongs in neither a column nor a log line.
    expect(serialised(audit)).not.toContain("System32");
  });

  it("hands the child resolved paths and never the user's own", async () => {
    const task = api.create(AGENT);
    await api.admit(AGENT, task.task_id, {
      role: "customer_brief",
      source_path: userFile("kund-brief.pdf", "%PDF-1.7\nbrief\n"),
    });

    expect(api.dispatch(AGENT, task.task_id, RUN)).toEqual({ ok: true });
    expect(dispatched).toHaveLength(1);

    const payload = dispatched[0]?.task as {
      directory: string;
      inputs: Array<{ path: string; display_name: string }>;
    };

    // The agent learns where its own copy is, and every path it is given is
    // inside the workspace the runner made for it.
    expect(payload.directory.startsWith(root.tasks)).toBe(true);
    expect(payload.inputs).toHaveLength(1);
    for (const input of payload.inputs) {
      expect(input.path.startsWith(root.tasks)).toBe(true);
    }
    // Display metadata travels; it is what the agent puts in its own prompts.
    expect(payload.inputs[0]?.display_name).toBe("kund-brief.pdf");

    // And it does not learn that the brief came from the user's documents
    // folder. Asserted against `serialised`, which undoes JSON's backslash
    // escaping first — a plain `JSON.stringify(...)` contains `C:\\Users\\…`
    // and would therefore *never* contain a Windows path, so the check would
    // pass for a payload that leaked every one of them.
    expect(serialised(payload)).not.toContain(userFiles);
  });

  it("refuses a second dispatch of the same task", async () => {
    const task = api.create(AGENT);
    expect(api.dispatch(AGENT, task.task_id, RUN)).toEqual({ ok: true });
    expect(api.dispatch(AGENT, task.task_id, "run-two")).toMatchObject({
      ok: false,
      refusal: "already_dispatched",
    });
  });

  it("closes the task at dispatch so its inputs cannot change under the run", async () => {
    const task = api.create(AGENT);
    api.dispatch(AGENT, task.task_id, RUN);

    const late = await api.admit(AGENT, task.task_id, {
      role: "customer_brief",
      source_path: userFile("late.pdf", "%PDF-1.7\nlate\n"),
    });
    expect(late).toMatchObject({ ok: false, refusal: "task_closed" });
  });

  it("does not report a task belonging to another agent", () => {
    const task = api.create(AGENT);
    expect(api.describe("someone-else", task.task_id)).toBeNull();
    expect(api.describe(AGENT, task.task_id)).not.toBeNull();
  });

  it("reports the index without a stored path in it", async () => {
    const task = api.create(AGENT);
    api.dispatch(AGENT, task.task_id, RUN);
    writeToOutbox(task.task_id, "offert.pdf", "%PDF-1.7\nOffert\n");
    await registerArtifact(store.database, root, {
      task_id: task.task_id,
      agent: AGENT,
      role: "finished_offert",
      name: "offert.pdf",
    });

    const index = api.index();
    expect(index.truncated).toBe(false);
    expect(index.artifacts).toHaveLength(1);
    // DASH renders a receipt about these files and never opens them, so it is
    // never told where they are.
    expect(serialised(index)).not.toContain(root.artifacts);
    expect(index.artifacts[0]?.availability).toEqual({ state: "available" });
  });
});
