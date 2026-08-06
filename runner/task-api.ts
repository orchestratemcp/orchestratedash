/**
 * The task workspace, as operations the runner's HTTP surface can route to.
 *
 * `runner/workspace.ts` decides what is allowed; this decides what is *recorded*
 * and answers in the shapes a route sends. The split is the one
 * `runner/server.ts` already keeps between routing and `runner/execute.ts`: a
 * router that also enforced would be a router nobody could read.
 *
 * ## Every refusal is audited, and that is the point rather than a nicety
 *
 * The issue's acceptance criterion is that traversal, symlink escape, oversized
 * input and output, MIME mismatch, replaced-after-selection input and spoofed
 * identity are "rejected **and audited**". A boundary whose refusals leave no
 * trace cannot be investigated, and — the sharper half — cannot be *distinguished
 * from a boundary that was never reached*. Proof `7n`'s lesson: the evidence that
 * something was refused has to exist independently of the thing refusing.
 *
 * The audit rows go in `runner_audit`, beside the command channel's, because a
 * user asking "what did this agent try to do" should get one answer rather than
 * two tables to reconcile. They share the correlation column, so an input
 * admitted for a task and an artifact refused during its run join up.
 *
 * ## What is never written down
 *
 * The user's own file path. It arrives on this channel, is resolved, is read,
 * and is not stored in any column or any audit detail. `display_name` is the
 * basename and nothing more. This is the issue's "file bytes, absolute paths,
 * and raw contents do not enter manifests, telemetry, command URLs, logs, or
 * Chief transcripts", and the runner's audit trail is the place it would most
 * plausibly leak into by accident.
 */

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { AgentArtifactFileMessage } from "./protocol";
import { writeRunnerAudit } from "./store";
import {
  admitInput,
  allArtifacts,
  artifactAvailability,
  artifactsForRun,
  bindTaskRun,
  createTask,
  deleteArtifact,
  effectiveLimits,
  readArtifact,
  readInputs,
  readTask,
  registerArtifact,
  resolveInput,
  verifyArtifact,
  type ArtifactAvailability,
  type DeclaredInputLimits,
  type InputRecord,
  type TaskRecord,
  type WorkspaceArtifact,
  type WorkspaceRoot,
} from "./workspace";

/**
 * What a task looks like from outside the runner.
 *
 * Note the absence of `directory`. DASH does not need the workspace path — it
 * never opens these files, it renders a receipt about them — and a field DASH
 * holds is a field that ends up in a view model and then on a page. The runner
 * is the only process that resolves an opaque id to a location, which is what
 * makes "the runner owns the workspace" a true sentence rather than an
 * arrangement.
 */
export interface TaskView {
  task_id: string;
  agent: string;
  run_id: string | null;
  created_at: string;
  closed_at: string | null;
  inputs: InputRecord[];
  total_bytes: number;
}

export interface ArtifactView {
  artifact_id: string;
  agent: string;
  run_id: string;
  task_id: string;
  role: string;
  display_name: string;
  media_type: string;
  byte_size: number;
  sha256: string;
  registered_at: string;
  retention: string;
  availability: ArtifactAvailability;
}

export interface TaskWorkspaceApi {
  create(agent: string): TaskView;
  admit(
    agent: string,
    taskId: string,
    request: { role: string; source_path: string; limits?: DeclaredInputLimits },
  ): Promise<{ ok: true; input: InputRecord } | { ok: false; refusal: string; detail: string }>;
  dispatch(
    agent: string,
    taskId: string,
    runId: string,
  ): { ok: true } | { ok: false; refusal: string; detail: string };
  describe(agent: string, taskId: string): TaskView | null;
  artifacts(agent: string, runId: string): ArtifactView[];
  /**
   * The whole index, with availability recomputed, for DASH's five-second poll.
   *
   * Bounded and says so. `truncated` is returned rather than left to the caller
   * to infer from a length, because a silent cap on this route would make an
   * Outputs panel that has quietly stopped listing a person's older files look
   * exactly like one that has listed all of them.
   */
  index(): { artifacts: ArtifactView[]; truncated: boolean };
  verify(artifactId: string): { ok: boolean; sha256: string | null; expected: string } | null;
  remove(agent: string, artifactId: string): { ok: boolean; detail: string };
  /** Called by the supervisor the moment a child says it wrote something. */
  onArtifactFile(agentId: string, message: AgentArtifactFileMessage): void;
}

export interface TaskWorkspaceOptions {
  database: DatabaseSync;
  root: WorkspaceRoot;
  /** Write one already-resolved task message to a child. The supervisor's. */
  dispatchToChild: (agentId: string, task: DispatchPayload) => boolean;
  log?: (line: string) => void;
  now?: () => Date;
}

export interface DispatchPayload {
  task_id: string;
  directory: string;
  inputs: Array<{
    input_id: string;
    role: string;
    display_name: string;
    media_type: string;
    byte_size: number;
    sha256: string;
    path: string;
  }>;
}

export function createTaskWorkspaceApi(options: TaskWorkspaceOptions): TaskWorkspaceApi {
  const { database, root, dispatchToChild } = options;
  const log = options.log ?? ((line: string) => { console.warn(line); });
  const clock = options.now ?? ((): Date => new Date());

  function audit(
    agent: string,
    command: string,
    decision: "accepted" | "refused",
    correlationId: string,
    reasonCode?: string,
    detail?: string,
  ): void {
    writeRunnerAudit(database, {
      command_id: randomUUID(),
      correlation_id: correlationId,
      agent,
      command,
      // The workspace is reached over the same authenticated channel the command
      // envelope is, so the actor is the same local principal. It is written out
      // rather than left blank because a row with no actor reads as a row nobody
      // could attribute.
      actor_id: "dash-local",
      decision,
      reason_code: reasonCode,
      detail,
      decided_at: clock().toISOString(),
    });
  }

  /**
   * One stored record plus a fresh look at where its bytes are.
   *
   * `stored_path` is deliberately absent from the result. DASH never opens these
   * files — it renders a receipt about them — and a path in a view model is a
   * path in a page.
   */
  function toView(record: WorkspaceArtifact): ArtifactView {
    return {
      artifact_id: record.artifact_id,
      agent: record.agent,
      run_id: record.run_id,
      task_id: record.task_id,
      role: record.role,
      display_name: record.display_name,
      media_type: record.media_type,
      byte_size: record.byte_size,
      sha256: record.sha256,
      registered_at: record.registered_at,
      retention: record.retention,
      availability: artifactAvailability(root, record),
    };
  }

  function view(task: TaskRecord): TaskView {
    const inputs = readInputs(database, task.task_id);
    return {
      task_id: task.task_id,
      agent: task.agent,
      run_id: task.run_id,
      created_at: task.created_at,
      closed_at: task.closed_at,
      inputs,
      total_bytes: inputs.reduce((total, input) => total + input.byte_size, 0),
    };
  }

  /**
   * Read a task and check it belongs to the agent the route named.
   *
   * The ownership check is not redundant with the route. A task id is opaque and
   * unguessable, so this is unlikely to be reached by an attacker — but "hard to
   * guess" is not an authorization model, and the cost of asking is one row.
   */
  function ownedTask(agent: string, taskId: string): TaskRecord | null {
    const task = readTask(database, taskId);
    return task === null || task.agent !== agent ? null : task;
  }

  return {
    create(agent: string): TaskView {
      const task = createTask(database, root, agent, clock());
      audit(agent, "task.create", "accepted", task.task_id);
      return view(task);
    },

    async admit(agent, taskId, request) {
      const task = ownedTask(agent, taskId);
      if (task === null) {
        audit(agent, "task.input.admit", "refused", taskId, "unknown_task");
        return { ok: false, refusal: "unknown_task", detail: "That task no longer exists." };
      }

      const result = await admitInput(
        database,
        root,
        { task_id: taskId, role: request.role, source_path: request.source_path, limits: request.limits },
        clock(),
      );

      if (!result.ok) {
        // The refusal reason is recorded; the path that caused it is not. A
        // reason code is a fact about the boundary, and a path is a fact about
        // the user's disk.
        audit(agent, "task.input.admit", "refused", taskId, result.refusal, `role=${request.role}`);
        return { ok: false, refusal: result.refusal, detail: result.detail };
      }

      audit(
        agent,
        "task.input.admit",
        "accepted",
        taskId,
        undefined,
        `role=${request.role} input=${result.input.input_id} bytes=${String(result.input.byte_size)}`,
      );
      return { ok: true, input: result.input };
    },

    dispatch(agent, taskId, runId) {
      const task = ownedTask(agent, taskId);
      if (task === null) {
        audit(agent, "task.dispatch", "refused", taskId, "unknown_task");
        return { ok: false, refusal: "unknown_task", detail: "That task no longer exists." };
      }
      if (!bindTaskRun(database, taskId, runId)) {
        // Already bound. Refused rather than re-dispatched: a task whose run id
        // could change would silently reattribute artifacts already registered
        // under the first one, and "which run produced this" is on the receipt.
        audit(agent, "task.dispatch", "refused", taskId, "already_dispatched");
        return {
          ok: false,
          refusal: "already_dispatched",
          detail: "That task has already been given to the agent.",
        };
      }

      // Closed at dispatch, so the input set the run reads is the input set the
      // person approved. An input admitted after this point would be a file the
      // user added to a task that was already running, which is a different
      // feature and a different consent.
      database
        .prepare("UPDATE task_workspaces SET closed_at = ? WHERE task_id = ?")
        .run(clock().toISOString(), taskId);

      const inputs = readInputs(database, taskId);
      const resolved: DispatchPayload["inputs"] = [];
      for (const input of inputs) {
        const location = resolveInput(database, root, taskId, input.input_id);
        if (!location.ok) {
          // One input that will not resolve fails the dispatch rather than
          // being dropped from it. An agent given three of the four files a
          // person selected would produce an offert from an incomplete price
          // list and report success.
          audit(agent, "task.dispatch", "refused", taskId, location.refusal, `input=${input.input_id}`);
          return { ok: false, refusal: location.refusal, detail: location.detail };
        }
        resolved.push({
          input_id: input.input_id,
          role: input.role,
          display_name: input.display_name,
          media_type: input.media_type,
          byte_size: input.byte_size,
          sha256: input.sha256,
          path: location.path,
        });
      }

      const delivered = dispatchToChild(agent, {
        task_id: taskId,
        directory: task.directory,
        inputs: resolved,
      });
      if (!delivered) {
        audit(agent, "task.dispatch", "refused", taskId, "not_running");
        return {
          ok: false,
          refusal: "not_running",
          detail: "That agent is not running, so it cannot be given the task.",
        };
      }

      audit(agent, "task.dispatch", "accepted", taskId, undefined, `run=${runId} inputs=${String(resolved.length)}`);
      return { ok: true };
    },

    describe(agent, taskId) {
      const task = ownedTask(agent, taskId);
      return task === null ? null : view(task);
    },

    artifacts(agent, runId) {
      return artifactsForRun(database, agent, runId).map(toView);
    },

    index() {
      const { records, truncated } = allArtifacts(database);
      return { artifacts: records.map(toView), truncated };
    },

    verify(artifactId) {
      const record = readArtifact(database, artifactId);
      if (record === null) {
        return null;
      }
      const result = verifyArtifact(record);
      audit(
        record.agent,
        "artifact.verify",
        result.ok ? "accepted" : "refused",
        record.task_id,
        result.ok ? undefined : "digest_mismatch",
        `artifact=${artifactId}`,
      );
      return { ...result, expected: record.sha256 };
    },

    remove(agent, artifactId) {
      const record = readArtifact(database, artifactId);
      if (record === null || record.agent !== agent) {
        return { ok: false, detail: "There is no such output." };
      }
      const removed = deleteArtifact(database, artifactId, clock());
      audit(
        agent,
        "artifact.delete",
        removed.ok ? "accepted" : "refused",
        record.task_id,
        removed.ok ? undefined : "already_deleted",
        `artifact=${artifactId}`,
      );
      return {
        ok: removed.ok,
        detail: removed.ok
          ? "That output has been deleted. The record of the run that made it is unchanged."
          : "That output was already deleted.",
      };
    },

    onArtifactFile(agentId, message) {
      // Fire and forget from the supervisor's point of view: the child is not
      // waiting for an answer and blocking the pipe reader on a file copy would
      // stall every other line that agent is writing. Failures are audited and
      // logged, which is where they are meant to be read.
      void (async () => {
        const task = ownedTask(agentId, message.task_id);
        if (task === null) {
          audit(agentId, "artifact.register", "refused", message.task_id, "unknown_task");
          log(`[runner] ${agentId} published a file against a task it does not own`);
          return;
        }

        const limits = effectiveLimits();
        const result = await registerArtifact(
          database,
          root,
          {
            task_id: message.task_id,
            agent: agentId,
            role: message.role,
            name: message.name,
            max_bytes: limits.max_file_bytes,
          },
          clock(),
        );

        if (!result.ok) {
          audit(
            agentId,
            "artifact.register",
            "refused",
            message.task_id,
            result.refusal,
            result.quarantined ? "quarantined" : undefined,
          );
          // The child's own name is not echoed into the log. It passed
          // `inspectComponent`, so it is not a path — but it is still a string
          // an agent chose, and a log line is a place strings an agent chose
          // should not appear verbatim.
          log(`[runner] ${agentId} published a file that was refused: ${result.refusal}`);
          return;
        }

        audit(
          agentId,
          "artifact.register",
          "accepted",
          message.task_id,
          undefined,
          `artifact=${result.artifact.artifact_id} bytes=${String(result.artifact.byte_size)}`,
        );
      })();
    },
  };
}
