/**
 * Child process supervision: the thing that makes "stopping an agent stops a
 * process" a true sentence rather than a UI state.
 *
 * The runner starts agents, holds their pipes, watches them exit, and delivers
 * commands to them. DASH does none of that and after this issue still does not:
 * ADR 0001 keeps DASH a control surface, and the runner is the separate process
 * that was always going to have to exist for an agent to be hosted at all.
 *
 * ## What a child does and does not inherit
 *
 * **Not the runner's environment.** `process.env` in this process contains the
 * bearer token DASH authenticates the control channel with, and handing that to
 * every agent would mean any agent could impersonate DASH to the runner and
 * approve its own gates. Children get a constructed environment: a small
 * allowlist of the variables a program needs to run at all, plus whatever the
 * registration declared. `DASH_RUNNER_TOKEN` is never in it, and
 * `assertNoRunnerSecrets` is the assertion rather than the intention.
 *
 * ## Why a registration file rather than a command over HTTP
 *
 * "Start this agent" naming an arbitrary command line would make the control
 * endpoint a remote shell with extra steps — a `POST` that runs anything, on a
 * port, behind one bearer token. Registrations are files the user's own machine
 * already holds, and the API can only start an agent that was registered. The
 * command endpoint chooses *which* registration, never *what* to run.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { isManifestV2, validateManifest } from "../lib/contracts";
import { resolveSpawnCommand, sameRegistration, type AgentRegistration } from "../lib/registration";
import type { AgentCommand } from "../lib/workspace";
import { createLineReader, encodeCommand, parseAgentMessage } from "./protocol";
import type { ProcessFacts } from "./state";

/* ---------------------------------------------------------------------- *
 * Registrations
 * ---------------------------------------------------------------------- */

/**
 * The shape moved to `lib/registration.ts` in MAR-428 and is re-exported here.
 *
 * DASH writes these files now, so the definition belongs where both the writer
 * and the reader can see it. Re-exporting keeps every existing import — and the
 * documentation in this file about *why* a registration is a file — working
 * unchanged.
 */
export type { AgentRegistration };

/**
 * Load every registration in a directory, skipping the ones that are unusable.
 *
 * A bad registration is reported and skipped rather than fatal: one malformed
 * file must not stop every other agent on the machine from being supervised.
 */
export function loadRegistrations(directory: string): {
  registrations: AgentRegistration[];
  skipped: Array<{ file: string; problem: string }>;
} {
  const registrations: AgentRegistration[] = [];
  const skipped: Array<{ file: string; problem: string }> = [];

  let entries: string[];
  try {
    entries = readdirSync(directory).filter((name) => name.endsWith(".json"));
  } catch {
    // No registration directory yet is the normal first-run state, not a fault.
    return { registrations, skipped };
  }

  for (const entry of entries) {
    const file = path.join(directory, entry);
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<AgentRegistration>;
      const problem = registrationProblem(parsed);
      if (problem !== null) {
        skipped.push({ file: entry, problem });
        continue;
      }
      const registration = parsed as AgentRegistration;
      registrations.push({
        ...registration,
        manifest_path: path.resolve(directory, registration.manifest_path),
        cwd: registration.cwd === undefined ? undefined : path.resolve(directory, registration.cwd),
      });
    } catch {
      skipped.push({ file: entry, problem: "not readable as JSON" });
    }
  }

  return { registrations, skipped };
}

function registrationProblem(value: Partial<AgentRegistration>): string | null {
  if (typeof value.agent_id !== "string" || value.agent_id.length === 0) {
    return "agent_id is missing";
  }
  if (typeof value.manifest_path !== "string" || value.manifest_path.length === 0) {
    return "manifest_path is missing";
  }
  if (typeof value.command !== "string" || value.command.length === 0) {
    return "command is missing";
  }
  if (value.args !== undefined && !Array.isArray(value.args)) {
    return "args must be an array";
  }
  return null;
}

/* ---------------------------------------------------------------------- *
 * The child environment
 * ---------------------------------------------------------------------- */

/**
 * Variables a child needs in order to be a working process at all.
 *
 * Nothing DASH-specific, and nothing carrying a credential. The list is short
 * on purpose: every addition is a decision to share something with every agent
 * on the machine.
 */
const INHERITED_ENVIRONMENT = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "SystemRoot",
  "TEMP",
  "TMP",
  "LANG",
  "TZ",
  "NODE_OPTIONS",
] as const;

/** Prefixes an agent must never receive, whatever a registration asks for. */
const FORBIDDEN_ENVIRONMENT = ["DASH_RUNNER_TOKEN", "DASH_SHELL_", "DASH_CONTRACTS_DIR"];

export function childEnvironment(
  registration: AgentRegistration,
  source: Record<string, string | undefined> = process.env,
  execPath: string = process.execPath,
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const key of INHERITED_ENVIRONMENT) {
    const value = source[key];
    if (typeof value === "string") {
      environment[key] = value;
    }
  }
  for (const [key, value] of Object.entries(registration.env ?? {})) {
    environment[key] = value;
  }
  // Applied *after* the registration's own block, so a registration cannot ask
  // for DASH's interpreter and then unset the one variable that makes it an
  // interpreter — which would spawn the DASH shell itself, windows and all,
  // with an agent's script as its argument.
  Object.assign(environment, resolveSpawnCommand(registration.command, execPath).env);
  assertNoRunnerSecrets(environment);
  return environment;
}

/**
 * Fail loudly rather than start an agent holding the runner's credential.
 *
 * A registration can name any environment variable, including one of ours. This
 * turns "a registration file could exfiltrate the control token to a child" from
 * something a reviewer has to notice into something the process refuses to do.
 */
export function assertNoRunnerSecrets(environment: Record<string, string>): void {
  for (const key of Object.keys(environment)) {
    if (FORBIDDEN_ENVIRONMENT.some((forbidden) => key.startsWith(forbidden))) {
      throw new Error(
        `Refusing to start an agent with "${key}" in its environment: that name is reserved for the runner's own credentials.`,
      );
    }
  }
}

/* ---------------------------------------------------------------------- *
 * Supervision
 * ---------------------------------------------------------------------- */

export type StartResult =
  | { ok: true; pid: number | null }
  | { ok: false; problem: "unknown_agent" | "already_running" | "invalid_manifest" | "spawn_failed"; detail: string };

export type DeliveryResult =
  | { ok: true; detail?: string }
  | { ok: false; problem: "not_running" | "unacknowledged" | "refused"; detail: string };

/** What one pass of `adopt` changed, and what it declined to change. */
export interface AdoptionResult {
  added: string[];
  updated: string[];
  removed: string[];
  /**
   * Changes a live process prevented. Reported rather than applied, and
   * reported rather than dropped: a caller that asked for a change and got
   * silence would have no way to tell it from a change that happened.
   */
  deferred: Array<{
    agent_id: string;
    reason: "running_registration_changed" | "running_registration_removed";
  }>;
}

interface Supervised {
  registration: AgentRegistration;
  child: ChildProcess | null;
  facts: ProcessFacts;
  /** The agent's most recent self-report, or null if it has not sent one. */
  report: Record<string, unknown> | null;
  commands: AgentCommand[];
  pending: Map<string, (result: DeliveryResult) => void>;
}

/**
 * How long an agent has to acknowledge a command before the runner reports it
 * unacknowledged.
 *
 * Deliberately shorter than DASH's envelope TTL: an answer that arrives after
 * the envelope expired is not an answer anyone can act on.
 */
export const ACK_TIMEOUT_MS = 15_000;

/** How long a stopping agent gets to exit on its own before it is killed. */
export const STOP_GRACE_MS = 5_000;

export class Supervisor {
  private readonly agents = new Map<string, Supervised>();

  constructor(
    registrations: readonly AgentRegistration[],
    private readonly log: (line: string) => void = (line) => {
      console.warn(line);
    },
  ) {
    for (const registration of registrations) {
      this.agents.set(registration.agent_id, this.entryFor(registration));
    }
  }

  list(): string[] {
    return [...this.agents.keys()];
  }

  /**
   * Take up a fresh reading of the registration directory (MAR-428).
   *
   * Before this, the set of supervised agents was decided once, at process
   * start. That was tolerable while every registration was hand-written — you
   * had already opened an editor, so restarting the runner was no imposition.
   * It is not tolerable once DASH writes registrations itself: the acceptance
   * criterion is that approving a handoff "produces one registered agent with
   * live state", and a criterion met only after the user restarts something is
   * not met.
   *
   * **A running agent is never disturbed.** Not restarted, not re-parented, not
   * silently re-pointed at a different command line. The runner's whole claim is
   * that it owns lifecycle facts because it started the process; quietly
   * swapping the registration underneath a live child would make its own record
   * of what it started a guess. So a change to a running agent is *deferred* and
   * reported as deferred, and it takes effect the next time that agent starts.
   *
   * Removal follows the same rule for the same reason. A registration file that
   * vanished under a running agent leaves the agent supervised — a process
   * nobody has a record of is strictly worse than a record of a process the user
   * meant to delete, and `lib/handoff-flow.ts` stops before it deletes precisely
   * so this branch stays an edge case rather than the normal path.
   */
  adopt(registrations: readonly AgentRegistration[]): AdoptionResult {
    const result: AdoptionResult = { added: [], updated: [], removed: [], deferred: [] };
    const incoming = new Map(registrations.map((entry) => [entry.agent_id, entry]));

    for (const [agentId, registration] of incoming) {
      const existing = this.agents.get(agentId);
      if (existing === undefined) {
        this.agents.set(agentId, this.entryFor(registration));
        result.added.push(agentId);
        continue;
      }
      if (sameRegistration(existing.registration, registration)) {
        continue;
      }
      if (existing.child !== null) {
        result.deferred.push({
          agent_id: agentId,
          reason: "running_registration_changed",
        });
        continue;
      }
      this.agents.set(agentId, this.entryFor(registration));
      result.updated.push(agentId);
    }

    for (const [agentId, entry] of [...this.agents]) {
      if (incoming.has(agentId)) {
        continue;
      }
      if (entry.child !== null) {
        result.deferred.push({ agent_id: agentId, reason: "running_registration_removed" });
        continue;
      }
      this.agents.delete(agentId);
      result.removed.push(agentId);
    }

    return result;
  }

  private entryFor(registration: AgentRegistration): Supervised {
    // The manifest is read now, not only at start. What an agent may be
    // commanded to do is a property of its manifest, not of whether its
    // process happens to be up — and a runner that only learned the command
    // list at spawn time would refuse a command against a stopped agent with
    // "it never declared that", which is both wrong and the more alarming of
    // the two messages. A stopped agent should be told it is stopped.
    //
    // A manifest that fails to load here is left as no commands and no
    // complaint: `start` reads it again and is the place that reports why.
    const manifest = this.readManifest(registration);

    return {
      registration,
      child: null,
      facts: {
        agent_id: registration.agent_id,
        pid: null,
        lifecycle: "stopped",
        exit_code: null,
        exit_signal: null,
        started_at: null,
      },
      report: null,
      commands: manifest.ok ? manifest.commands : [],
      pending: new Map(),
    };
  }

  facts(agentId: string): ProcessFacts | null {
    return this.agents.get(agentId)?.facts ?? null;
  }

  report(agentId: string): Record<string, unknown> | null {
    return this.agents.get(agentId)?.report ?? null;
  }

  commands(agentId: string): AgentCommand[] {
    return this.agents.get(agentId)?.commands ?? [];
  }

  /**
   * Start an agent, refusing one whose manifest does not validate.
   *
   * The manifest is read and checked *before* the process is spawned, which is
   * the issue's acceptance criterion — "the runner refuses to start an agent
   * whose manifest fails v2 validation" — and the order is the whole point.
   * Validating after spawning would mean the refusal happened after the agent
   * had already run, which is not a refusal.
   */
  start(agentId: string): StartResult {
    const entry = this.agents.get(agentId);
    if (entry === undefined) {
      return {
        ok: false,
        problem: "unknown_agent",
        detail: `No agent is registered as "${agentId}".`,
      };
    }
    if (entry.child !== null) {
      return {
        ok: false,
        problem: "already_running",
        detail: `"${agentId}" is already running as pid ${String(entry.facts.pid)}.`,
      };
    }

    const manifest = this.readManifest(entry.registration);
    if (!manifest.ok) {
      entry.facts = { ...entry.facts, lifecycle: "failed_to_start" };
      return { ok: false, problem: "invalid_manifest", detail: manifest.detail };
    }
    entry.commands = manifest.commands;

    // Resolved here, at the moment of spawning, and never written down: see
    // `BUNDLED_NODE_COMMAND`. The runner still chooses nothing about *what*
    // runs — the registration names the script and the arguments — only how to
    // reach the interpreter DASH ships.
    const spawning = resolveSpawnCommand(entry.registration.command, process.execPath);

    let child: ChildProcess;
    try {
      child = spawn(spawning.command, entry.registration.args, {
        cwd: entry.registration.cwd,
        // `NodeJS.ProcessEnv` is augmented in this repo (via Next's types) to
        // require NODE_ENV. A child environment built from an allowlist
        // legitimately may not carry it, and inventing one to satisfy the type
        // would be handing every agent a value DASH made up.
        env: childEnvironment(entry.registration) as NodeJS.ProcessEnv,
        stdio: ["pipe", "pipe", "pipe"],
        // The agent is a child of the runner, not of a shell. `shell: true`
        // would make every registration a command-injection surface for the
        // sake of convenience nobody asked for.
        shell: false,
      });
    } catch (error: unknown) {
      entry.facts = { ...entry.facts, lifecycle: "failed_to_start" };
      return {
        ok: false,
        problem: "spawn_failed",
        detail: error instanceof Error ? error.message : "The agent could not be started.",
      };
    }

    entry.child = child;
    entry.facts = {
      agent_id: agentId,
      pid: child.pid ?? null,
      lifecycle: "starting",
      exit_code: null,
      exit_signal: null,
      started_at: new Date().toISOString(),
    };

    this.attach(entry, child);
    return { ok: true, pid: child.pid ?? null };
  }

  /**
   * Stop an agent: SIGTERM, then SIGKILL if it is still there.
   *
   * The grace period is what makes this a stop rather than a kill — an agent
   * mid-write to its own store deserves the chance to finish. The escalation is
   * what makes it a stop rather than a request: "stopping an agent stops a
   * process" must not be contingent on the agent's cooperation.
   */
  stop(agentId: string): { ok: boolean; detail: string } {
    const entry = this.agents.get(agentId);
    if (entry === undefined) {
      return { ok: false, detail: `No agent is registered as "${agentId}".` };
    }
    const child = entry.child;
    if (child === null) {
      return { ok: true, detail: `"${agentId}" was not running.` };
    }

    entry.facts = { ...entry.facts, lifecycle: "stopping" };
    child.kill("SIGTERM");

    const timer = setTimeout(() => {
      if (entry.child === child) {
        this.log(`[runner] ${agentId} did not exit within ${String(STOP_GRACE_MS)} ms; sending SIGKILL`);
        child.kill("SIGKILL");
      }
    }, STOP_GRACE_MS);
    // Do not hold the event loop open for a process that already exited.
    timer.unref?.();

    return { ok: true, detail: `Asked "${agentId}" (pid ${String(entry.facts.pid)}) to stop.` };
  }

  /** Stop everything. Used when the runner itself is shutting down. */
  stopAll(): void {
    for (const agentId of this.agents.keys()) {
      this.stop(agentId);
    }
  }

  /**
   * Deliver a command to a running agent and wait for it to be acknowledged.
   *
   * The timeout resolving to `unacknowledged` rather than to success is the
   * honest half of this module. A line written to a pipe proves nothing about
   * whether the agent read it, and reporting delivery as completion is exactly
   * the "reports a delivered effect that nothing performed" failure the command
   * channel's docs were written to prevent.
   */
  deliver(
    agentId: string,
    message: Parameters<typeof encodeCommand>[0],
    timeoutMs: number = ACK_TIMEOUT_MS,
  ): Promise<DeliveryResult> {
    const entry = this.agents.get(agentId);
    if (entry === undefined || entry.child === null || entry.child.stdin === null) {
      return Promise.resolve({
        ok: false,
        problem: "not_running",
        detail: `"${agentId}" is not running, so there is nothing to deliver the command to.`,
      });
    }

    return new Promise<DeliveryResult>((resolve) => {
      const commandId = message.command_id;
      const timer = setTimeout(() => {
        entry.pending.delete(commandId);
        resolve({
          ok: false,
          problem: "unacknowledged",
          detail: `"${agentId}" did not acknowledge the command within ${String(timeoutMs)} ms.`,
        });
      }, timeoutMs);

      entry.pending.set(commandId, (result) => {
        clearTimeout(timer);
        resolve(result);
      });

      entry.child?.stdin?.write(encodeCommand(message), (error) => {
        if (error) {
          clearTimeout(timer);
          entry.pending.delete(commandId);
          resolve({
            ok: false,
            problem: "not_running",
            detail: `Writing to "${agentId}" failed: its input stream is closed.`,
          });
        }
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * Internals
   * ------------------------------------------------------------------ */

  private readManifest(
    registration: AgentRegistration,
  ): { ok: true; commands: AgentCommand[] } | { ok: false; detail: string } {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(registration.manifest_path, "utf8"));
    } catch {
      return {
        ok: false,
        detail: `The manifest at ${registration.manifest_path} could not be read as JSON.`,
      };
    }

    const validation = validateManifest(raw);
    if (!validation.ok) {
      return {
        ok: false,
        detail: `The manifest is not valid: ${validation.errors.slice(0, 5).join("; ")}`,
      };
    }
    if (!isManifestV2(validation.value)) {
      // A v1 manifest is not an agent with no commands; it is an agent this
      // contract generation cannot describe. `docs/agent-dom-contract-v2.md`:
      // "missing controls mean read-only, not inferred controls".
      return {
        ok: false,
        detail: "The manifest is v1. Hosting an agent requires a v2 manifest with an agent_dom block.",
      };
    }

    const control = validation.value.agent_dom["control"] as { commands?: unknown } | undefined;
    const commands = Array.isArray(control?.commands)
      ? (control.commands as AgentCommand[])
      : [];
    return { ok: true, commands };
  }

  private attach(entry: Supervised, child: ChildProcess): void {
    const agentId = entry.registration.agent_id;
    const reader = createLineReader();

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (entry.facts.lifecycle === "starting") {
        entry.facts = { ...entry.facts, lifecycle: "running" };
      }
      for (const line of reader.push(chunk)) {
        this.handleLine(entry, line);
      }
      if (reader.overflowed()) {
        this.log(`[runner] ${agentId} wrote an over-long line; it was dropped`);
      }
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      this.log(`[agent:${agentId}] ${chunk.trimEnd()}`);
    });

    child.on("error", (error: Error) => {
      this.log(`[runner] ${agentId} failed: ${error.message}`);
    });

    child.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      entry.child = null;
      entry.facts = {
        ...entry.facts,
        pid: null,
        lifecycle: "exited",
        exit_code: code,
        exit_signal: signal,
      };
      // Anything still waiting for an ack will never get one. Resolving now
      // rather than letting each caller time out is the difference between a
      // command that reports a dead agent and one that reports a slow one.
      for (const [commandId, resolve] of entry.pending) {
        entry.pending.delete(commandId);
        resolve({
          ok: false,
          problem: "not_running",
          detail: `"${agentId}" exited before acknowledging the command.`,
        });
      }
      this.log(
        `[runner] ${agentId} exited code=${String(code)} signal=${String(signal)}`,
      );
    });
  }

  private handleLine(entry: Supervised, line: string): void {
    const message = parseAgentMessage(line);
    if (message === null) {
      // Ordinary agent logging. See `runner/protocol.ts` on why this is not an
      // error.
      if (line.trim().length > 0) {
        this.log(`[agent:${entry.registration.agent_id}] ${line.trimEnd()}`);
      }
      return;
    }

    if (message.type === "state") {
      entry.report = message.state;
      return;
    }

    const resolve = entry.pending.get(message.command_id);
    if (resolve === undefined) {
      // An ack for something we are not waiting for: a late answer after a
      // timeout, or a confused agent. Logged, not acted on — the command it
      // refers to has already been settled one way or another.
      this.log(
        `[runner] ${entry.registration.agent_id} acknowledged an unknown command ${message.command_id}`,
      );
      return;
    }
    entry.pending.delete(message.command_id);
    resolve(
      message.ok
        ? { ok: true, detail: message.detail }
        : {
            ok: false,
            problem: "refused",
            detail: message.detail ?? "The agent refused the command.",
          },
    );
  }
}
