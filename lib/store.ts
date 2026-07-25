import {
  isManifestV2,
  validateEvent,
  validateManifest,
  type AgentManifestV2,
  type AnyAgentManifest,
  type RunEvent,
} from "./contracts";
import { db, insertEventRow, transact } from "./db";

/**
 * The store's query layer.
 *
 * Storage moved to SQLite in MAR-416 (`lib/db.ts`); this module's job is
 * unchanged — validate, write, and project the store into the shapes the pages
 * and API routes render. The exported surface is deliberately identical to the
 * JSON-file version it replaces, so the swap is a storage change and not a
 * behaviour change, and so the existing tests exercise the new engine as-is.
 *
 * No credential passes through here. `connection_secrets` holds references and
 * masked hints and is written only by `lib/secret-refs.ts`.
 */

export interface StoredAgent {
  /**
   * v1 or v2 as imported. The manifest is stored verbatim rather than
   * normalised to one version: it is the agent author's document, and the
   * Connection Center's honesty rules depend on being able to say "the manifest
   * declared this" without a migration step in between.
   */
  manifest: AnyAgentManifest;
  imported_at: string;
}

export interface StoreShape {
  agents: Record<string, StoredAgent>;
  events: RunEvent[];
}

function text(row: Record<string, unknown>, column: string): string {
  return String(row[column]);
}

/**
 * The whole store, materialised.
 *
 * Kept because four pages and routes take a `StoreShape` and hand it to the
 * projections below and to `lib/insights.ts`. It is the one call that gains
 * nothing from SQLite, and narrowing it is worth doing — but the callers are
 * blocked behind the analysis layer's signatures, so it is a change to the
 * render path rather than to the store, and folding that into a storage swap
 * would make both unreviewable.
 *
 * Targeted queries are deliberately not added here in advance of a caller. The
 * schema keeps the headroom; the read API can grow when something needs it.
 */
export function readStore(): StoreShape {
  const database = db();
  const agents: Record<string, StoredAgent> = {};

  for (const row of database.prepare("SELECT name, manifest_json, imported_at FROM agents").all()) {
    agents[text(row, "name")] = {
      manifest: JSON.parse(text(row, "manifest_json")) as AnyAgentManifest,
      imported_at: text(row, "imported_at"),
    };
  }

  // Ordered by arrival, which is what the JSON store's array order meant.
  const events = database
    .prepare("SELECT event_json FROM events ORDER BY id")
    .all()
    .map((row) => JSON.parse(text(row, "event_json")) as RunEvent);

  return { agents, events };
}

/**
 * Empty the store. Tests use it between cases; nothing in the app calls it.
 *
 * Deletes rather than dropping the file so schema version, migration record and
 * the "we already imported dash.json" marker survive — re-running a completed
 * migration because a test truncated a table would be a surprising way to lose
 * the property that migration happens exactly once.
 */
export function resetStore(): void {
  const database = db();
  transact(database, () => {
    database.exec("DELETE FROM events");
    database.exec("DELETE FROM runs");
    database.exec("DELETE FROM agents");
    database.exec("DELETE FROM connection_secrets");
    database.exec("DELETE FROM agent_dom_state");
    database.exec("DELETE FROM command_nonces");
    database.exec("DELETE FROM command_results");
    database.exec("DELETE FROM command_audit");
  });
}

/**
 * One agent's manifest, or null when DASH has never imported it.
 *
 * The first targeted read in this module. `readStore` deliberately materialises
 * everything for the pages, but the command channel asks about one agent per
 * command and answering that by loading every manifest and every event would
 * make the cost of a command scale with the size of the store.
 */
export function readAgentManifest(name: string): AnyAgentManifest | null {
  const row = db().prepare("SELECT manifest_json FROM agents WHERE name = ?").get(name);
  return row === undefined ? null : (JSON.parse(text(row, "manifest_json")) as AnyAgentManifest);
}

export type ImportResult =
  | { ok: true; agent: string; replaced: boolean }
  | { ok: false; errors: string[] };

export function importManifest(input: unknown): ImportResult {
  const result = validateManifest(input);
  if (!result.ok) {
    return { ok: false, errors: result.errors };
  }

  const database = db();
  const manifest = result.value;
  const name = manifest.agent.name;

  return transact(database, () => {
    const existing = database.prepare("SELECT 1 FROM agents WHERE name = ?").get(name);
    database
      .prepare(
        "INSERT INTO agents (name, manifest_version, manifest_json, imported_at) " +
          "VALUES (?, ?, ?, ?) ON CONFLICT (name) DO UPDATE SET " +
          "manifest_version = excluded.manifest_version, " +
          "manifest_json = excluded.manifest_json, " +
          "imported_at = excluded.imported_at",
      )
      .run(name, manifest.manifest_version, JSON.stringify(manifest), new Date().toISOString());
    return { ok: true as const, agent: name, replaced: existing !== undefined };
  });
}

export interface IngestResult {
  accepted: number;
  rejected: Array<{ index: number; errors: string[] }>;
}

/**
 * Accepts one event or a batch. Each item is validated independently so a
 * single malformed event cannot discard the rest of a batch.
 *
 * The accepted items go in as one transaction: a batch is now atomic, where the
 * JSON store rewrote the whole document and a crash mid-write risked the lot.
 */
export function ingestEvents(input: unknown): IngestResult {
  const items = Array.isArray(input) ? input : [input];
  const accepted: RunEvent[] = [];
  const rejected: IngestResult["rejected"] = [];

  items.forEach((item, index) => {
    const result = validateEvent(item);
    if (result.ok) {
      accepted.push(result.value);
    } else {
      rejected.push({ index, errors: result.errors });
    }
  });

  if (accepted.length > 0) {
    const database = db();
    const receivedAt = new Date().toISOString();
    transact(database, () => {
      for (const event of accepted) {
        insertEventRow(database, event, receivedAt);
      }
    });
  }

  return { accepted: accepted.length, rejected };
}

export interface AgentSummary {
  name: string;
  /**
   * Which manifest version was imported. Surfaced because it decides what DASH
   * can honestly show: only v2 declares connections, so a v1 agent has no
   * checklist rather than an empty one.
   */
  manifest_version: 1 | 2;
  goal: string;
  plan_source: string;
  build_target: string;
  planned_steps: number;
  automation_clearance: string;
  imported_at: string;
  run_count: number;
}

export function listAgents(store: StoreShape = readStore()): AgentSummary[] {
  const runsByAgent = new Map<string, Set<string>>();
  for (const event of store.events) {
    const runs = runsByAgent.get(event.agent) ?? new Set<string>();
    runs.add(event.run_id);
    runsByAgent.set(event.agent, runs);
  }

  return Object.values(store.agents)
    .map(({ manifest, imported_at }) => ({
      name: manifest.agent.name,
      manifest_version: manifest.manifest_version,
      goal: manifest.agent.goal,
      plan_source: manifest.agent.plan_source,
      build_target: manifest.agent.build_target,
      planned_steps: manifest.planned_route.length,
      automation_clearance: manifest.safety_contract.automation_clearance,
      imported_at,
      run_count: runsByAgent.get(manifest.agent.name)?.size ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The v2 manifests, which are the only ones with declared connections.
 *
 * Returned as a list of `{ name, manifest }` rather than raw manifests so the
 * caller does not have to reach back into the store to label a checklist. v1
 * agents are omitted, not included as empty: "this agent declares no
 * connections" and "this manifest is too old to declare any" are different
 * claims, and the Connection Center must not make the first when it means the
 * second.
 */
export function listConnectionCapableAgents(
  store: StoreShape = readStore(),
): Array<{ name: string; manifest: AgentManifestV2 }> {
  return Object.values(store.agents)
    .map(({ manifest }) => manifest)
    .filter(isManifestV2)
    .map((manifest) => ({ name: manifest.agent.name, manifest }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type RunStatus = "running" | "completed" | "failed";

export interface RunSummary {
  agent: string;
  run_id: string;
  status: RunStatus;
  event_count: number;
  started_at: string;
  last_event_at: string;
  /**
   * True when received sequence numbers are not a contiguous 0..n run. The v1
   * contract makes seq monotonic precisely so a monitor can spot gaps and
   * out-of-order delivery; this is a transport observation, not plan-vs-actual
   * analysis (that is DASH-04).
   */
  has_sequence_gap: boolean;
  /** Whether the agent's manifest has been imported into this DASH. */
  known_agent: boolean;
}

/**
 * Runs, derived from the events.
 *
 * Still derived, now that a `runs` table exists, and on purpose: that table
 * records a run's *identity* so later features have something to reference. The
 * moment it also cached status or counts it would become a second source of
 * truth, free to disagree with the events it was computed from.
 */
export function listRuns(store: StoreShape = readStore()): RunSummary[] {
  const grouped = new Map<string, RunEvent[]>();
  for (const event of store.events) {
    const key = `${event.agent} ${event.run_id}`;
    const bucket = grouped.get(key) ?? [];
    bucket.push(event);
    grouped.set(key, bucket);
  }

  const runs: RunSummary[] = [];
  for (const events of grouped.values()) {
    const ordered = [...events].sort((a, b) => a.seq - b.seq);
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    if (first === undefined || last === undefined) {
      continue;
    }

    const types = new Set(ordered.map((event) => event.type));
    const status: RunStatus = types.has("run_failed")
      ? "failed"
      : types.has("run_completed")
        ? "completed"
        : "running";

    const seen = new Set(ordered.map((event) => event.seq));

    runs.push({
      agent: first.agent,
      run_id: first.run_id,
      status,
      event_count: ordered.length,
      started_at: ordered.reduce(
        (earliest, event) => (event.ts < earliest ? event.ts : earliest),
        first.ts,
      ),
      last_event_at: ordered.reduce(
        (latest, event) => (event.ts > latest ? event.ts : latest),
        first.ts,
      ),
      has_sequence_gap: seen.size !== last.seq - first.seq + 1,
      known_agent: Object.hasOwn(store.agents, first.agent),
    });
  }

  return runs.sort((a, b) => b.started_at.localeCompare(a.started_at));
}
