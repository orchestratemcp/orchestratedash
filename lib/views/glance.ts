/**
 * The four facts behind a fleet card's chips, read out of the store (MAR-586).
 *
 * `lib/copy/glance.ts` turns facts into sentences and can be proved right
 * without a database. This is the other half: it asks four questions of four
 * different records and hands the answers over. Nothing here writes a sentence,
 * and nothing there reads a disk.
 *
 * ## Where each answer comes from, and what DASH refuses to guess
 *
 * | question             | record                                                    |
 * | -------------------- | --------------------------------------------------------- |
 * | has it new output?   | `run_artifacts.received_at` against `agent_looks`          |
 * | does it need you?    | the Agent DOM snapshot, through `buildWorkInbox`           |
 * | is it connected?     | MAR-569's resolution, or the declared checklist beneath it  |
 * | is it overdue?       | the manifest's declared interval against DASH's own runs    |
 *
 * Three of the four were already recorded and are derived here at render time.
 * The fourth needed a new fact — when the person last opened an agent's page —
 * and that is the one thing MAR-586 stores. MAR-547's ruling is why the table
 * has a column headed "record" at all: every chip is a fact somebody wrote down,
 * and a question with no record behind it produces no chip.
 *
 * ## This module reads the disk and must never be imported by a page
 *
 * Same standing as `lib/views/build.ts`, which is its only caller in production.
 * Pages import `GlanceChip` from `lib/copy/glance.ts`, which is pure.
 *
 * ## Why the connection rows arrive as a parameter
 *
 * `connectionRowsFor` lives in `lib/views/build.ts`, and `build.ts` calls this
 * module — so importing it back would be a cycle. Injecting it is the pattern
 * `runsView` already uses for `pulls` and `runView` for the availability
 * producer: production passes the real thing, and a test drives the states
 * without a broker, a vault or a receipt.
 */

import { describeGlance, type GlanceChip, type GlanceFacts } from "../copy/glance";
import { resolveRequirements } from "../connection-requirements";
import { resolveConnectionRequirements } from "../connection-spec";
import type { ConnectionSourceManifest } from "../connections";
import { readAgentDomState } from "../agent-dom/store";
import {
  artifactArrivals,
  listRuns,
  readAgentLooks,
  type StoreShape,
} from "../store";
import {
  buildWorkInbox,
  hasActiveRun,
  pastScheduleExpectation,
  type WorkspaceManifest,
} from "../workspace";
import type { ConnectionRowWithCredential } from "./types";

/**
 * The one thing this module cannot read for itself.
 *
 * See the header. A named interface rather than a bare function parameter so the
 * injection point has somewhere to carry that explanation, and so a second
 * source — should one ever be needed — arrives as a field rather than as another
 * positional argument.
 */
export interface GlanceSources {
  /** MAR-569's resolved connection rows for one agent, as `connectionsView` builds them. */
  connectionRows(agent: string, manifest: ConnectionSourceManifest): ConnectionRowWithCredential[];
}

/**
 * Read the store once, then answer per agent.
 *
 * A reader rather than a function of one agent, because the fleet draws every
 * agent and two of the four questions are cheaper asked once for all of them:
 * `readAgentLooks` is a whole small table, and `listRuns` walks every event in
 * the store. Called per card, those two would make the cost of the agents list
 * quadratic in the size of the store — which is the same argument
 * `resolveArtifactAvailability` makes about resolving once per run rather than
 * once per artifact.
 *
 * `now` is a parameter with a production default, like `workspaceView`'s. Every
 * time-dependent answer in DASH takes an explicit clock, because a projection
 * that reads the time internally cannot be tested at a boundary, and every
 * interesting overdue case *is* a boundary.
 */
export function glanceReader(
  store: StoreShape,
  sources: GlanceSources,
  now: Date = new Date(),
): (agent: string) => GlanceChip[] {
  const looks = readAgentLooks();

  // Newest first, so the first entry per agent is its last run. `started_at` is
  // what "when did it last run" means — not when the last event about it
  // happened to arrive, which is the distinction `dashFactsForAgent` already
  // draws for the panel's own `last_run_at`.
  const lastRun = new Map<string, { started_at: string; status: string }>();
  for (const run of listRuns(store)) {
    if (!lastRun.has(run.agent)) {
      lastRun.set(run.agent, { started_at: run.started_at, status: run.status });
    }
  }

  return (agent: string): GlanceChip[] =>
    describeGlance(glanceFacts(agent, store, sources, now, looks, lastRun));
}

function glanceFacts(
  agent: string,
  store: StoreShape,
  sources: GlanceSources,
  now: Date,
  looks: ReadonlyMap<string, string>,
  lastRun: ReadonlyMap<string, { started_at: string; status: string }>,
): GlanceFacts {
  const manifest = store.agents[agent]?.manifest ?? null;
  const snapshot = readAgentDomState(agent);

  const look = looks.get(agent) ?? null;
  const arrivals = artifactArrivals(agent, look);

  const waiting = waitingOn(manifest, snapshot, now);
  const connections = connectionsShort(agent, manifest, sources);

  return {
    new_outputs: arrivals.since_count,
    total_outputs: arrivals.total,
    never_looked: look === null,
    approvals: waiting.approvals,
    choices: waiting.choices,
    expired: waiting.expired,
    unconnected: connections.unconnected,
    self_contradicting: connections.self_contradicting,
    overdue: overdueFor(agent, manifest, snapshot, lastRun, now),
  };
}

/**
 * What is waiting on the person, from the agent's own published state.
 *
 * `buildWorkInbox` rather than a count of `approval_requests`, and that is the
 * load-bearing choice: it is the one place that drops an approval the runner
 * will not independently enforce, and a card that counted the raw requests would
 * offer a chip for an approval DASH is deliberately refusing to show anywhere
 * else. Zero for an agent that has published nothing, which is the honest answer
 * — DASH has no evidence of anything waiting, rather than evidence of nothing.
 */
function waitingOn(
  manifest: unknown,
  snapshot: ReturnType<typeof readAgentDomState>,
  now: Date,
): { approvals: number; choices: number; expired: number } {
  if (manifest === null || snapshot === null) {
    return { approvals: 0, choices: 0, expired: 0 };
  }
  let approvals = 0;
  let choices = 0;
  let expired = 0;
  for (const item of buildWorkInbox(manifest as WorkspaceManifest, snapshot.state, now)) {
    if (item.kind === "approval") {
      approvals += 1;
    } else {
      choices += 1;
    }
    if (item.expired) {
      expired += 1;
    }
  }
  return { approvals, choices, expired };
}

/**
 * How much of what this agent needs connected is not connected.
 *
 * ## Two records, in a stated order, and never both
 *
 * MAR-569's `connection_requirements` block is asked first and is authoritative
 * once an author has declared one. Where there is none, the declared
 * `agent_dom.connections` checklist answers instead. That is the same shape of
 * rule `panelDocument` states for the panel — the newer, finer document wins,
 * and the older one keeps answering for every agent exported before it existed
 * — and it matters here because most agents on any real machine today predate
 * the requirements block entirely. A card that consulted only the newer record
 * would be silent about every one of them, which is not the same as saying they
 * need nothing.
 *
 * Neither record is a guess. A requirement is a declaration; a checklist row is
 * a declaration; whether DASH holds a credential for one is a row in
 * `connection_secrets`. What DASH refuses to do is infer a connection from a
 * value, and nothing here does.
 *
 * ## Optional requirements count, and the sentence is why
 *
 * `lib/copy/glance.ts` says "before it can do all of its work", which is exactly
 * true of an unconnected optional requirement: the agent runs, and part of what
 * it offers does not. Dropping them would make an agent silently do less with
 * nothing on its card to say so, which is the failure `describeManifestGap`
 * exists to prevent one page over.
 */
function connectionsShort(
  agent: string,
  manifest: unknown,
  sources: GlanceSources,
): { unconnected: number; self_contradicting: number } {
  if (manifest === null) {
    return { unconnected: 0, self_contradicting: 0 };
  }

  const source = manifest as ConnectionSourceManifest;
  const rows = sources.connectionRows(agent, source);
  const resolution = resolveConnectionRequirements(manifest);

  if (resolution.kind === "v1") {
    let unconnected = 0;
    let self_contradicting = 0;
    for (const resolved of resolveRequirements(resolution.requirements, agent, rows)) {
      if (resolved.flow_refusal === "connection_not_declared") {
        // Not folded into `unconnected`: no sign-in clears it, and the sentence
        // for it has to send the reader to a re-export instead of to a button.
        self_contradicting += 1;
      } else if (resolved.standing !== "allowed") {
        unconnected += 1;
      }
    }
    return { unconnected, self_contradicting };
  }

  /*
   * The older record. A row counts as not connected when DASH may hold a
   * credential for it and does not — `dash_can_hold` without a `masked_hint`,
   * which is precisely the state the Connection Center draws a Connect button
   * beside.
   *
   * A row DASH cannot hold a credential for is deliberately not counted. Those
   * are the agent's own or somebody else's to arrange, DASH has no button for
   * them, and a chip that counted them would be telling a person to go and do
   * something DASH cannot help with and will never mark as done.
   */
  let unconnected = 0;
  for (const row of rows) {
    if (row.dash_can_hold && row.masked_hint === null) {
      unconnected += 1;
    }
  }
  return { unconnected, self_contradicting: 0 };
}

/**
 * Whether this agent has missed its own schedule, and the two states that say
 * "not now" even when the arithmetic says yes.
 *
 * The arithmetic itself is `pastScheduleExpectation` in `lib/workspace.ts`, the
 * same function `deriveStatus` uses for the workspace's `stalled` status. One
 * definition, two callers — a card and a status field that disagreed about
 * whether the same agent was late would be worse than either of them being
 * wrong.
 *
 * What it is measured against is **DASH's own record of when the agent last
 * ran**, not the snapshot's `last_activity_at`. The two answer different
 * questions: activity includes tasks and audit events, and MAR-586 asks about
 * runs. DASH's runs table also outlives the process, so an agent that is
 * stopped, restarted or simply not publishing still has an answer.
 *
 * Two refusals:
 *
 * - **A run is happening now.** Asked of both records, because either may know
 *   first: the snapshot sees a queued run before DASH has an event for it, and
 *   DASH's own events see a run from an agent that has published no snapshot.
 * - **The person paused it.** A card calling a deliberately paused agent overdue
 *   would be reporting the user's own decision back at them as a problem. This
 *   is `deriveStatus`'s `NEVER_OVERRIDE`, narrowed: `offline` and `error` are
 *   deliberately *not* here, because an agent whose process is confirmed gone
 *   really has missed its schedule and the card has room to say both.
 */
function overdueFor(
  agent: string,
  manifest: unknown,
  snapshot: ReturnType<typeof readAgentDomState>,
  lastRun: ReadonlyMap<string, { started_at: string; status: string }>,
  now: Date,
): GlanceFacts["overdue"] {
  const trigger = (manifest as WorkspaceManifest | null)?.agent_dom?.trigger;
  const interval = trigger?.expected_interval_seconds;
  if (trigger === undefined || interval === undefined) {
    return null;
  }

  const run = lastRun.get(agent) ?? null;
  if (run?.status === "running" || (snapshot !== null && hasActiveRun(snapshot.state))) {
    return null;
  }
  if (snapshot?.state.status === "paused") {
    return null;
  }

  const startedAt = run?.started_at ?? null;
  return pastScheduleExpectation(trigger, startedAt, now)
    ? { last_run_at: startedAt, every_seconds: interval }
    : null;
}
