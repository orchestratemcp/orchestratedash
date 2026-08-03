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

import { checkEnvironmentName } from "../lib/connection-credentials";
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

/**
 * Credentials DASH read from the OS vault for this one spawn (MAR-383).
 *
 * A map of environment name to value, held in memory for the length of a
 * `start` call and never written anywhere. Deliberately *not* merged into
 * `registration.env`: a registration is a file on disk, and putting a
 * credential there would move it out of the OS vault into plaintext — the
 * opposite of what holding it in the vault was for.
 */
export type SpawnCredentials = Readonly<Record<string, string>>;

export function childEnvironment(
  registration: AgentRegistration,
  source: Record<string, string | undefined> = process.env,
  execPath: string = process.execPath,
  credentials: SpawnCredentials = {},
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const key of INHERITED_ENVIRONMENT) {
    const value = source[key];
    if (typeof value === "string") {
      environment[key] = value;
    }
  }
  for (const [key, value] of Object.entries(registration.env ?? {})) {
    // A handoff already refuses these names. Repeat the invariant here for
    // externally-authored registration files so no child can recover the old
    // HTTP telemetry path (or any other DASH-owned setting) by bypassing the
    // handoff. `assertNoRunnerSecrets` below stays intact as the credential
    // guard; this is the broader namespace boundary.
    if (key.toUpperCase().startsWith("DASH_")) {
      throw new Error(
        `Refusing to start an agent with a DASH-owned environment variable: that namespace is reserved for the runner/DASH boundary.`,
      );
    }
    environment[key] = value;
  }
  // After the registration block, so a registration cannot pre-empt a
  // DASH-managed credential by declaring the same name and having its plaintext
  // value win. DASH is authoritative for the connections it holds.
  //
  // The name rules are `lib/connection-credentials.ts`'s, imported rather than
  // restated: DASH already refused a reserved or unsafe name when the user
  // connected, and this is the same check at the boundary that enforces it. A
  // caller reaching here with a bad name is a bug on the DASH side, so it
  // throws rather than skipping the entry — a credential silently not delivered
  // is an agent that fails for a reason nobody can see.
  for (const [key, value] of Object.entries(credentials)) {
    const refusal = checkEnvironmentName(key);
    if (refusal !== null) {
      throw new Error(
        `Refusing to deliver a credential as "${key}": ${refusal.replace(/_/g, " ")}.`,
      );
    }
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

/** One agent-emitted telemetry candidate waiting for DASH to validate it. */
export interface BufferedTelemetryEvent {
  /**
   * The supervisor identity, kept beside the untrusted event so ingest can bind
   * a schema-valid `event.agent` to the child process that actually emitted it.
   */
  agent_id: string;
  event: unknown;
}

export interface TelemetryDrain {
  events: BufferedTelemetryEvent[];
  /** Candidates refused because the bounded buffer was already full. */
  dropped: number;
}

/** One agent-emitted artifact candidate waiting for DASH to validate it. */
export interface BufferedArtifact {
  /**
   * The supervisor identity, for the same reason telemetry carries it — and it
   * matters more here. An artifact is the document a person reads and acts on,
   * so binding it to the child that actually emitted it is what stops one agent
   * publishing a digest under another agent's name.
   */
  agent_id: string;
  artifact: unknown;
}

export interface ArtifactDrain {
  artifacts: BufferedArtifact[];
  dropped: number;
}

/** One brokered-operation request waiting for DASH to adjudicate it (MAR-458). */
export interface BufferedBrokerRequest {
  /**
   * The supervisor identity of the child that wrote the line.
   *
   * This is the single most load-bearing field in the broker's transport. DASH
   * looks up *this* agent's manifest and *this* agent's credential, so an agent
   * naming another agent's connection id gets its own manifest consulted and is
   * refused. Nothing in the request body can change it, because it is not in the
   * request body.
   */
  agent_id: string;
  request: unknown;
}

/**
 * What the runner destroyed, and whose it was (MAR-467).
 *
 * The aggregate `dropped` count came first and says only that something was
 * lost. That is enough to log and not enough to show anyone: a user asking why
 * an agent did less than it should needs to know it was *their* agent, and
 * when.
 *
 * The operation is deliberately absent, and not because it would be hard to
 * obtain. The runner does not parse a broker request — `runner/server.ts` says
 * why, and `lib/broker/protocol.ts` is the parser, on the DASH side where the
 * allowlist and the vault are. Parsing one here in order to label a drop would
 * put a second reader of an untrusted agent-authored body in the one process
 * that talks to every agent, to improve a diagnostic. The count is honest about
 * being a count of things nobody read.
 */
export interface BrokerDropTally {
  agent_id: string;
  count: number;
  /** ISO 8601. When this agent's first still-unreported drop happened. */
  first_at: string;
  /** ISO 8601. And its most recent. Equal to `first_at` when count is 1. */
  last_at: string;
}

export interface BrokerDrain {
  requests: BufferedBrokerRequest[];
  dropped: number;
  /**
   * The same drops, attributed. `dropped` is the sum of these `count`s and is
   * kept rather than replaced: it is the field the runner's own logging reads,
   * and a drain is consumed by exactly one caller who should not have to add up
   * an array to answer "was anything lost".
   */
  dropped_detail: BrokerDropTally[];
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

/**
 * A hostile or broken child must not turn telemetry into unbounded runner
 * memory. The line reader already caps one candidate at 256 KiB; this caps the
 * aggregate between DASH's five-second polls.
 */
export const MAX_TELEMETRY_BUFFER_BYTES = 4 * 1024 * 1024;
export const MAX_TELEMETRY_BUFFER_EVENTS = 10_000;

/**
 * Artifacts get their own bound, not a share of telemetry's (MAR-457).
 *
 * One buffer would mean a chatty agent's events could starve the digest a user
 * is waiting to read, and an agent emitting large digests could silently cost
 * every agent on the machine its telemetry. They are different populations with
 * different sizes and different consequences for being dropped, so they are
 * bounded and drained separately.
 *
 * The count is low on purpose. A run produces one artifact, or a handful if it
 * revises one; an agent producing thousands between two five-second polls is
 * misbehaving, and the bound is where that gets noticed rather than absorbed.
 */
export const MAX_ARTIFACT_BUFFER_BYTES = 4 * 1024 * 1024;
export const MAX_ARTIFACT_BUFFER_COUNT = 200;

/**
 * The broker's own bound (MAR-458).
 *
 * Much smaller than the other two, and smaller on purpose. Telemetry and
 * artifacts are things an agent *produces*, so a generous buffer costs memory.
 * A brokered request is a thing an agent *wants done to a user's account*, so a
 * generous buffer costs a queue of pending reads against somebody's mailbox that
 * DASH would work through after the fact — including after the user pressed
 * Disconnect, if it were deep enough to outlive their attention.
 *
 * `lib/broker/execute.ts` re-resolves the grant per request, so a queued request
 * against a revoked grant is refused rather than served; this bound is the
 * second half of the same argument, which is that the queue should not be able
 * to get deep in the first place.
 */
export const MAX_BROKER_BUFFER_BYTES = 256 * 1024;
export const MAX_BROKER_BUFFER_COUNT = 64;

interface BufferedTelemetryEntry extends BufferedTelemetryEvent {
  bytes: number;
}

interface BufferedArtifactEntry extends BufferedArtifact {
  bytes: number;
}

interface BufferedBrokerEntry extends BufferedBrokerRequest {
  bytes: number;
}

export class Supervisor {
  private readonly agents = new Map<string, Supervised>();
  private readonly telemetry: BufferedTelemetryEntry[] = [];
  private telemetryBytes = 0;
  private droppedTelemetry = 0;
  private readonly artifacts: BufferedArtifactEntry[] = [];
  private artifactBytes = 0;
  private droppedArtifacts = 0;
  private readonly brokerRequests: BufferedBrokerEntry[] = [];
  private brokerBytes = 0;
  private droppedBrokerRequests = 0;
  /**
   * Per-agent drop tallies, cleared with the drain that reports them (MAR-467).
   *
   * A map keyed by agent id, so its size is bounded by the number of registered
   * agents rather than by how badly one of them is behaving. That matters: the
   * buffer bound exists to stop a runaway agent costing unbounded memory, and a
   * record *of* the dropping that grew per dropped request would reintroduce the
   * cost the bound was protecting against.
   */
  private readonly droppedBrokerByAgent = new Map<string, BrokerDropTally>();

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
   * Remove every currently buffered candidate in one bounded batch.
   *
   * Delivery is intentionally fire-and-forget: the agent's JSONL file remains
   * the primary record. Draining is kept separate from state so telemetry volume
   * cannot make an Agent DOM snapshot fail its own schema.
   */
  drainTelemetry(): TelemetryDrain {
    const events = this.telemetry.map(({ agent_id, event }) => ({ agent_id, event }));
    const dropped = this.droppedTelemetry;
    this.telemetry.length = 0;
    this.telemetryBytes = 0;
    this.droppedTelemetry = 0;
    return { events, dropped };
  }

  /**
   * The same bounded drain for artifacts (MAR-457).
   *
   * Separate from `drainTelemetry` rather than folded into it: the two are
   * validated against different schemas at different ingest boundaries, and a
   * single drain returning both would force the caller to sort them back out by
   * inspecting untrusted bodies — which is the one thing the supervisor is
   * supposed to have already answered.
   */
  drainArtifacts(): ArtifactDrain {
    const artifacts = this.artifacts.map(({ agent_id, artifact }) => ({ agent_id, artifact }));
    const dropped = this.droppedArtifacts;
    this.artifacts.length = 0;
    this.artifactBytes = 0;
    this.droppedArtifacts = 0;
    return { artifacts, dropped };
  }

  /**
   * Take every brokered request waiting for an answer (MAR-458).
   *
   * Unlike telemetry and artifacts this is not fire-and-forget: the agent is
   * blocked on an answer, so a drained request that DASH never responds to is an
   * agent that waits until its own timeout. That is the correct failure — DASH
   * being closed means the broker is closed, and there is no honest way for a
   * request to succeed while the process that holds the vault is not running —
   * but it is a failure, not a no-op, and the agent kit's client says so.
   */
  drainBrokerRequests(): BrokerDrain {
    const requests = this.brokerRequests.map(({ agent_id, request }) => ({ agent_id, request }));
    const dropped = this.droppedBrokerRequests;
    // Copied out before the map is cleared. The tallies are handed to a caller
    // that will write them down; leaking the live objects would let a later drop
    // mutate a record already reported, which is the sort of thing that makes a
    // count disagree with itself between two screens.
    const droppedDetail = [...this.droppedBrokerByAgent.values()].map((tally) => ({ ...tally }));
    this.brokerRequests.length = 0;
    this.brokerBytes = 0;
    this.droppedBrokerRequests = 0;
    this.droppedBrokerByAgent.clear();
    return { requests, dropped, dropped_detail: droppedDetail };
  }

  /**
   * Deliver one broker answer to the agent that asked (MAR-458).
   *
   * Written to the child's stdin, exactly as a command is, so the answer arrives
   * on the channel the request left by and cannot reach any other process. There
   * is no acknowledgement and no retry: an agent that has exited is an agent
   * with nothing to answer, and buffering a reply for a process that is gone
   * would mean a future process with the same registration receiving an answer
   * to a question it never asked.
   *
   * Returns whether the line was handed to a live pipe. False is not an error
   * worth surfacing to a user — it means the agent stopped while DASH was
   * deciding — but it is worth the caller being able to see.
   */
  respondToBroker(agentId: string, line: string): boolean {
    const entry = this.agents.get(agentId);
    if (entry === undefined || entry.child === null || entry.child.stdin === null) {
      return false;
    }
    entry.child.stdin.write(line);
    return true;
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
  /**
   * @param credentials Vault-held values for this spawn only (MAR-383). Held in
   * memory for the length of this call, never stored on the entry and never
   * logged, so a later `list` or `status` cannot read back what was delivered.
   */
  start(agentId: string, credentials: SpawnCredentials = {}): StartResult {
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
        env: childEnvironment(
          entry.registration,
          process.env,
          process.execPath,
          credentials,
        ) as NodeJS.ProcessEnv,
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

    if (message.type === "telemetry") {
      this.bufferTelemetry(
        entry.registration.agent_id,
        message.event,
        Buffer.byteLength(line, "utf8"),
      );
      return;
    }

    if (message.type === "artifact") {
      this.bufferArtifact(
        entry.registration.agent_id,
        message.artifact,
        Buffer.byteLength(line, "utf8"),
      );
      return;
    }

    if (message.type === "broker_request") {
      this.bufferBrokerRequest(
        entry.registration.agent_id,
        message.request,
        Buffer.byteLength(line, "utf8"),
      );
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

  private bufferTelemetry(agentId: string, event: unknown, bytes: number): void {
    if (
      this.telemetry.length >= MAX_TELEMETRY_BUFFER_EVENTS ||
      this.telemetryBytes + bytes > MAX_TELEMETRY_BUFFER_BYTES
    ) {
      this.droppedTelemetry += 1;
      this.log(
        `[runner] ${agentId} emitted telemetry while the bounded buffer was full; the candidate was dropped`,
      );
      return;
    }

    this.telemetry.push({ agent_id: agentId, event, bytes });
    this.telemetryBytes += bytes;
  }

  private bufferArtifact(agentId: string, artifact: unknown, bytes: number): void {
    if (
      this.artifacts.length >= MAX_ARTIFACT_BUFFER_COUNT ||
      this.artifactBytes + bytes > MAX_ARTIFACT_BUFFER_BYTES
    ) {
      this.droppedArtifacts += 1;
      // Logged rather than swallowed. A digest that never reached DASH is a
      // blank space on a page the user is looking at, so the reason has to
      // survive somewhere they or a support session can find it.
      this.log(
        `[runner] ${agentId} emitted an artifact while the bounded buffer was full; the candidate was dropped`,
      );
      return;
    }

    this.artifacts.push({ agent_id: agentId, artifact, bytes });
    this.artifactBytes += bytes;
  }

  private bufferBrokerRequest(agentId: string, request: unknown, bytes: number): void {
    if (
      this.brokerRequests.length >= MAX_BROKER_BUFFER_COUNT ||
      this.brokerBytes + bytes > MAX_BROKER_BUFFER_BYTES
    ) {
      this.droppedBrokerRequests += 1;
      // Tallied per agent as well as counted, so DASH can say whose request was
      // lost and when rather than only that something was (MAR-467). Logged too:
      // the log line is what a support session greps, and the tally is what the
      // Connections page renders, and neither replaces the other.
      const at = new Date().toISOString();
      const tally = this.droppedBrokerByAgent.get(agentId);
      if (tally === undefined) {
        this.droppedBrokerByAgent.set(agentId, { agent_id: agentId, count: 1, first_at: at, last_at: at });
      } else {
        tally.count += 1;
        tally.last_at = at;
      }
      this.log(
        `[runner] ${agentId} asked the broker for something while the bounded buffer was full; the request was dropped`,
      );
      return;
    }

    this.brokerRequests.push({ agent_id: agentId, request, bytes });
    this.brokerBytes += bytes;
  }
}
