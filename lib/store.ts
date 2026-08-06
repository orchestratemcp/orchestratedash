import {
  isManifestV2,
  validateArtifact,
  validateEvent,
  validateManifest,
  type AgentManifestV2,
  type AnyAgentManifest,
  type RunArtifact,
  type RunEvent,
} from "./contracts";
import { db, insertEventRow, readRowsTolerantly, transact } from "./db";
import { checkManifestConstraints } from "./manifest-constraints";

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

/**
 * Rows that are in the database and could not be read back out of it.
 *
 * Not an error and not a silence. A store that throws on one damaged row takes
 * down every page at once (see `readStore`); a store that drops it quietly tells
 * the user their agent was never imported, which is a lie about their data. This
 * is the third option: the rest of the store is returned, and what was lost is
 * named so a surface can say so.
 *
 * Agent names are carried and event bodies are only counted, because that is the
 * difference in what can honestly be said. An agent's `name` is its own column
 * and survives damage to `manifest_json`, so "DASH cannot read *this* agent" is
 * checkable. A damaged `event_json` has no readable identity left worth
 * rendering, so it is a number.
 */
export interface UnreadableRows {
  agents: string[];
  events: number;
  /**
   * Agent rows a damaged page put out of reach entirely, so not even their name
   * survived to be listed in `agents` above.
   *
   * A separate number rather than a placeholder pushed into the name list: an
   * invented name would be rendered to a user as if it were their agent's.
   */
  unnamed_agents: number;
}

export interface StoreShape {
  agents: Record<string, StoredAgent>;
  events: RunEvent[];
  /** What this read could not parse. Both empty on a healthy store. */
  unreadable: UnreadableRows;
}

function text(row: Record<string, unknown>, column: string): string {
  return String(row[column]);
}

/**
 * `JSON.parse`, or null.
 *
 * The parser's own message is deliberately discarded rather than propagated.
 * Node quotes the offending input back at you — that is how the truncated
 * manifest that prompted this was identified — and these rows reach a renderer
 * and a log. `lib/db.ts` makes the same argument about the legacy import's
 * failure record, and it holds harder here: the store is where the connection
 * checklist's names and hints live, so a value we by definition could not
 * inspect must never be quoted out of it.
 */
function parseOrNull<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
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
 *
 * ## Why every row is parsed defensively
 *
 * This function used to `JSON.parse` each row unguarded, which was correct about
 * the writers and wrong about the file. Nothing in DASH can *write* an invalid
 * manifest — `importManifest` and the legacy import both stringify an
 * already-validated object, and there is no third writer — so the only way a row
 * gets here unparseable is that the bytes changed underneath us. A manifest
 * larger than a page lives partly in SQLite overflow pages, and a store damaged
 * by an abrupt kill can return a manifest truncated mid-string.
 *
 * That is exactly the case an unguarded parse handles worst. One damaged row
 * threw out of `readStore`, and because all four views call `readStore`, a single
 * bad agent took down the agents list, the runs list, the Connection Center and
 * the work inbox together — including the pages that would have rendered
 * perfectly from rows that were fine. The blast radius was the whole app for one
 * row's worth of damage.
 */
export function readStore(): StoreShape {
  const database = db();
  const agents: Record<string, StoredAgent> = {};
  const unreadable: UnreadableRows = { agents: [], events: 0, unnamed_agents: 0 };

  // Both tables are read tolerantly, because damage arrives in two shapes and
  // the store that prompted this had one of each: a row that comes back
  // truncated, and a page that will not be read at all. The JSON guard below
  // handles the first; `readRowsTolerantly` handles the second.
  const agentRows = readRowsTolerantly(database, {
    table: "agents",
    bulk: "SELECT rowid, name, manifest_json, imported_at FROM agents",
    byRowid: "SELECT rowid, name, manifest_json, imported_at FROM agents WHERE rowid = ?",
  });
  for (const row of agentRows.rows) {
    const name = text(row, "name");
    const manifest = parseOrNull<AnyAgentManifest>(text(row, "manifest_json"));
    if (manifest === null) {
      unreadable.agents.push(name);
      continue;
    }
    agents[name] = { manifest, imported_at: text(row, "imported_at") };
  }

  // Ordered by arrival, which is what the JSON store's array order meant. The
  // rowid walk produces that order too — `events.id` is an alias for the rowid —
  // so the fallback does not quietly reorder a run's events.
  const eventRows = readRowsTolerantly(database, {
    table: "events",
    bulk: "SELECT event_json FROM events ORDER BY id",
    byRowid: "SELECT event_json FROM events WHERE rowid = ?",
  });
  const events: RunEvent[] = [];
  for (const row of eventRows.rows) {
    const event = parseOrNull<RunEvent>(text(row, "event_json"));
    if (event === null) {
      unreadable.events += 1;
      continue;
    }
    events.push(event);
  }

  // A row lost to a damaged page and a row lost to damaged JSON are the same
  // loss to a reader, and are counted together. The agent names cannot be
  // recovered for the first kind — the name column is on the page that would
  // not read — so those are counted as events are: as a number, honestly.
  unreadable.events += eventRows.lost;
  unreadable.unnamed_agents = agentRows.lost;

  return { agents, events, unreadable };
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
    database.exec("DELETE FROM agent_handoffs");
    database.exec("DELETE FROM run_artifacts");
    database.exec("DELETE FROM workspace_artifacts");
  });
}

/**
 * Forget one agent (MAR-428).
 *
 * What goes: the imported manifest, and the last Agent DOM state snapshot. Those
 * are DASH's *current* picture of an agent, and keeping them after the user
 * removed it would leave a ghost in the agent list.
 *
 * What stays, deliberately: the events it emitted, the runs derived from them,
 * and every command audit row naming it. A monitor that erases its own record of
 * what happened, because the thing it happened to is gone, is not a monitor —
 * and the command audit exists precisely to answer questions about agents
 * somebody may since have wanted to be rid of. `removeRegistration`'s cleanup
 * report says so in plain language rather than leaving the user to discover it.
 *
 * Returns whether there was anything to forget, so the caller can tell "removed"
 * from "was never here" instead of reporting both as success.
 */
export function forgetAgent(name: string): { existed: boolean } {
  const database = db();
  return transact(database, () => {
    const existed = database.prepare("SELECT 1 FROM agents WHERE name = ?").get(name) !== undefined;
    database.prepare("DELETE FROM agents WHERE name = ?").run(name);
    database.prepare("DELETE FROM agent_dom_state WHERE agent = ?").run(name);
    // MAR-458. A receipt and a call history for an agent DASH no longer knows
    // are orphans: nothing renders them, nothing can act on them, and they name
    // an account.
    //
    // This is a different question from *disconnecting*, which deliberately
    // keeps the audit — there the agent is still here and the history is what a
    // suspicious user disconnected in order to read. Removing the agent removes
    // the thing the history is about.
    database.prepare("DELETE FROM broker_grants WHERE agent = ?").run(name);
    database.prepare("DELETE FROM broker_audit WHERE agent = ?").run(name);
    return { existed };
  });
}

/**
 * One agent's manifest, or null when DASH has never imported it.
 *
 * The first targeted read in this module. `readStore` deliberately materialises
 * everything for the pages, but the command channel asks about one agent per
 * command and answering that by loading every manifest and every event would
 * make the cost of a command scale with the size of the store.
 *
 * An unreadable row returns null, which the callers already handle as "DASH does
 * not know this agent" — and here that is the *safe* reading rather than merely a
 * convenient one. This function's caller is the command channel, which uses the
 * manifest to decide whether a command is within what the agent declared. A
 * manifest DASH cannot read is not a manifest it may act on, so refusing at
 * `unknown_target` is the correct outcome; throwing would have failed closed too,
 * but as an unhandled error rather than an audited refusal.
 */
export function readAgentManifest(name: string): AnyAgentManifest | null {
  const row = db().prepare("SELECT manifest_json FROM agents WHERE name = ?").get(name);
  return row === undefined ? null : parseOrNull<AnyAgentManifest>(text(row, "manifest_json"));
}

/**
 * Every imported agent's name, and nothing else.
 *
 * A targeted read for the same reason `readAgentManifest` is one: MAR-415's
 * state poller asks "which agents exist" on a timer, and answering that by
 * materialising every manifest and every event would make the cost of a poll
 * scale with the size of the store.
 */
export function listAgentNames(): string[] {
  return db()
    .prepare("SELECT name FROM agents ORDER BY name")
    .all()
    .map((row) => text(row, "name"));
}

export type ImportResult =
  | { ok: true; agent: string; replaced: boolean }
  | { ok: false; errors: string[] };

export function importManifest(input: unknown): ImportResult {
  const result = validateManifest(input);
  if (!result.ok) {
    return { ok: false, errors: result.errors };
  }

  // Schema-valid is not importable (MAR-482). The contradiction ADR 0006
  // refuses — a remote runtime asking DASH to manage its connections — is
  // legal to the schema and checked here, at the door, rather than at
  // re-read: `lib/manifest-constraints.ts` explains why the difference
  // matters.
  const contradictions = checkManifestConstraints(result.value);
  if (contradictions.length > 0) {
    return { ok: false, errors: contradictions };
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

export interface IngestOptions {
  /**
   * Optional transport provenance, one entry per candidate.
   *
   * The HTTP ingest path omits this and is unchanged. The runner path supplies
   * it so one hosted child cannot publish a schema-valid event under another
   * agent's name.
   */
  sourceAgents?: readonly string[];
}

/**
 * Accepts one event or a batch. Each item is validated independently so a
 * single malformed event cannot discard the rest of a batch.
 *
 * The accepted items go in as one transaction: a batch is now atomic, where the
 * JSON store rewrote the whole document and a crash mid-write risked the lot.
 */
export function ingestEvents(input: unknown, options: IngestOptions = {}): IngestResult {
  const items = Array.isArray(input) ? input : [input];
  const accepted: RunEvent[] = [];
  const rejected: IngestResult["rejected"] = [];

  items.forEach((item, index) => {
    const result = validateEvent(item);
    if (result.ok) {
      const sourceAgent = options.sourceAgents?.[index];
      if (sourceAgent !== undefined && result.value.agent !== sourceAgent) {
        rejected.push({
          index,
          errors: ["/agent must match the runner-hosted source"],
        });
      } else {
        accepted.push(result.value);
      }
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

/**
 * Accept one run artifact, or a batch (MAR-457).
 *
 * The same boundary discipline as `ingestEvents`, and deliberately the same
 * shape of answer: each candidate is validated on its own, one malformed
 * artifact never discards its neighbours, and the accepted set lands in a single
 * transaction.
 *
 * `sourceAgents` matters more here than it does for events, not less. An
 * artifact is the thing a user reads and acts on, so a hosted child publishing a
 * schema-valid digest under another agent's name would be putting words in
 * another agent's mouth on a surface built to be trusted.
 *
 * Re-sending the same `artifact_id` replaces the body rather than inserting a
 * second row. An agent that revises a digest mid-run is correcting it; keeping
 * both and showing the newest would give the run two answers and no way to say
 * which one the user saw.
 */
export function ingestArtifacts(input: unknown, options: IngestOptions = {}): IngestResult {
  const items = Array.isArray(input) ? input : [input];
  const accepted: RunArtifact[] = [];
  const rejected: IngestResult["rejected"] = [];

  items.forEach((item, index) => {
    const result = validateArtifact(item);
    if (result.ok) {
      const sourceAgent = options.sourceAgents?.[index];
      if (sourceAgent !== undefined && result.value.agent !== sourceAgent) {
        rejected.push({
          index,
          errors: ["/agent must match the runner-hosted source"],
        });
      } else {
        accepted.push(result.value);
      }
    } else {
      rejected.push({ index, errors: result.errors });
    }
  });

  if (accepted.length > 0) {
    const database = db();
    const receivedAt = new Date().toISOString();
    transact(database, () => {
      for (const artifact of accepted) {
        database
          .prepare(
            "INSERT INTO run_artifacts " +
              "(agent, run_id, artifact_id, kind, title, generated_at, artifact_json, received_at) " +
              "VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
              "ON CONFLICT (agent, run_id, artifact_id) DO UPDATE SET " +
              "kind = excluded.kind, title = excluded.title, " +
              "generated_at = excluded.generated_at, " +
              "artifact_json = excluded.artifact_json, " +
              "received_at = excluded.received_at",
          )
          .run(
            artifact.agent,
            artifact.run_id,
            artifact.artifact_id,
            artifact.kind,
            artifact.title,
            artifact.generated_at,
            JSON.stringify(artifact),
            receivedAt,
          );
      }
    });
  }

  return { accepted: accepted.length, rejected };
}

/**
 * Every artifact a run produced, newest first.
 *
 * Read straight from the table rather than from `StoreShape`: artifacts are
 * joined to a run on demand by the pages that show one, and loading every
 * digest body a machine has ever produced into the store snapshot that every
 * page reads would make the agents list pay for the digest viewer.
 *
 * A damaged row is skipped rather than thrown, exactly as `readStore` treats a
 * damaged event — a store that takes down the run page because one digest will
 * not parse is the failure mode MAR-449 already paid for once.
 */
export function artifactsForRun(agent: string, runId: string): RunArtifact[] {
  const rows = db()
    .prepare(
      "SELECT artifact_json FROM run_artifacts WHERE agent = ? AND run_id = ? " +
        "ORDER BY generated_at DESC",
    )
    .all(agent, runId) as Array<Record<string, unknown>>;

  const artifacts: RunArtifact[] = [];
  for (const row of rows) {
    const artifact = parseOrNull<RunArtifact>(text(row, "artifact_json"));
    if (artifact !== null) {
      artifacts.push(artifact);
    }
  }
  return artifacts;
}

/**
 * One artifact, with what DASH knows about receiving it (MAR-434).
 *
 * The distinction this type exists to carry is the one the whole codebase turns
 * on: `generated_at` inside the artifact is **the agent's claim** about when it
 * made this, and `received_at` is **DASH's own record** of when it arrived. A
 * provenance receipt that showed only the first would be repeating an agent's
 * word back to a user as though DASH had checked it — the same mistake
 * `draft.placement` is carefully worded around, where the agent claims a draft
 * reached a mailbox and `broker_audit` is what DASH actually did.
 */
export interface RunArtifactRecord {
  artifact: RunArtifact;
  /** When DASH stored it. DASH's own clock, not the agent's. */
  received_at: string;
  /**
   * How many bytes of artifact DASH is holding.
   *
   * Measured from the stored body rather than from any file, because there is
   * no file: MAR-457's seam stores what the agent sent. The receipt says so.
   */
  stored_bytes: number;
}

/**
 * Every artifact a run produced with its receiving record, newest first.
 *
 * A separate function rather than a wider return type on `artifactsForRun`,
 * because every other caller wants the artifact and nothing else, and widening
 * the common path to serve one page would make three surfaces destructure a
 * field they never read.
 */
export function artifactRecordsForRun(agent: string, runId: string): RunArtifactRecord[] {
  const rows = db()
    .prepare(
      "SELECT artifact_json, received_at FROM run_artifacts WHERE agent = ? AND run_id = ? " +
        "ORDER BY generated_at DESC",
    )
    .all(agent, runId) as Array<Record<string, unknown>>;

  const records: RunArtifactRecord[] = [];
  for (const row of rows) {
    const json = text(row, "artifact_json");
    const artifact = parseOrNull<RunArtifact>(json);
    if (artifact !== null) {
      records.push({
        artifact,
        received_at: text(row, "received_at"),
        stored_bytes: Buffer.byteLength(json, "utf8"),
      });
    }
  }
  return records;
}

/**
 * The most recent digest this agent produced, across every run.
 *
 * What the agent workspace opens on: a person who came back to see what their
 * scout found wants the last answer, not a list of runs to pick from. The run
 * it belongs to travels with it so the page can link to the full record.
 *
 * Null when the agent has never produced one, which is the ordinary state of a
 * manual-first agent nobody has run yet — not a failure and not worded as one.
 */
export function latestArtifactForAgent(agent: string): RunArtifact | null {
  const row = db()
    .prepare(
      "SELECT artifact_json FROM run_artifacts WHERE agent = ? " +
        "ORDER BY generated_at DESC LIMIT 1",
    )
    .get(agent) as Record<string, unknown> | undefined;

  return row === undefined ? null : parseOrNull<RunArtifact>(text(row, "artifact_json"));
}

/* ---------------------------------------------------------------------- *
 * File-backed artifacts, and the availability seam (MAR-434)
 * ---------------------------------------------------------------------- */

/**
 * The five states an output's bytes can be in.
 *
 * `lib/copy/artifacts.ts` has had vocabulary and a test for these since MAR-434's
 * design slice, and had no producer: MAR-457 stores an artifact as a body, so
 * there was no file whose absence anything could observe. `runner/workspace.ts`
 * is the producer, this is how it reaches DASH, and `resolveArtifactAvailability`
 * is what the Outputs panel's `resolveAvailability` parameter is meant to be
 * given.
 *
 * The order below is not alphabetical and is not severity. It is the order of
 * how much DASH knows: `available` and `deleted` are facts it holds directly,
 * `moved` and `quarantined` are observations the runner made about a filesystem,
 * and `missing` is the residue — the state that means nothing else was true.
 */
export type ArtifactAvailability =
  | "available"
  | "deleted"
  | "moved"
  | "quarantined"
  | "missing";

export interface WorkspaceArtifactRecord {
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
  /** Where it was found, or why it could not be read. Null when neither applies. */
  availability_detail: string | null;
  /** When the runner looked. Not when DASH wrote this down. */
  observed_at: string;
}

const AVAILABILITY_STATES = new Set<string>([
  "available",
  "deleted",
  "moved",
  "quarantined",
  "missing",
]);

/**
 * Replace DASH's picture of one runner's file-backed artifacts.
 *
 * An upsert per record rather than a delete-then-insert, because a poll that
 * failed halfway through a truncated table would leave the Outputs panel
 * showing nothing at all — which reads as "this run produced no files" and is
 * the one wrong answer that looks like a right one.
 *
 * Rows the runner no longer reports are **kept**, not pruned. The runner
 * bounding its index page is the likeliest reason a record stops appearing, and
 * deleting a user's record of an output because a paging limit moved would be
 * losing data to an implementation detail. A row that has genuinely gone is
 * covered already: the runner reports it as `deleted` before it stops reporting
 * it at all.
 *
 * Each candidate is validated independently and a malformed one is counted
 * rather than thrown — the same discipline `ingestEvents` and `ingestArtifacts`
 * use, for the same reason.
 */
export function syncWorkspaceArtifacts(
  input: unknown,
  options: IngestOptions = {},
): IngestResult {
  const items = Array.isArray(input) ? input : [input];
  const accepted: WorkspaceArtifactRecord[] = [];
  const rejected: IngestResult["rejected"] = [];

  items.forEach((item, index) => {
    const record = narrowWorkspaceArtifact(item);
    if (record === null) {
      rejected.push({ index, errors: ["not a workspace artifact record"] });
      return;
    }
    const sourceAgent = options.sourceAgents?.[index];
    if (sourceAgent !== undefined && record.agent !== sourceAgent) {
      // The same binding `ingestArtifacts` applies, and it matters as much: an
      // output attributed to the wrong agent is a file a person would go looking
      // for on the wrong page.
      rejected.push({ index, errors: ["/agent must match the runner-hosted source"] });
      return;
    }
    accepted.push(record);
  });

  if (accepted.length > 0) {
    const database = db();
    transact(database, () => {
      for (const record of accepted) {
        database
          .prepare(
            "INSERT INTO workspace_artifacts " +
              "(artifact_id, agent, run_id, task_id, role, display_name, media_type, byte_size, " +
              " sha256, registered_at, retention, availability, availability_detail, observed_at) " +
              "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
              "ON CONFLICT (artifact_id) DO UPDATE SET " +
              "retention = excluded.retention, " +
              "availability = excluded.availability, " +
              "availability_detail = excluded.availability_detail, " +
              "observed_at = excluded.observed_at",
          )
          .run(
            record.artifact_id,
            record.agent,
            record.run_id,
            record.task_id,
            record.role,
            record.display_name,
            record.media_type,
            record.byte_size,
            record.sha256,
            record.registered_at,
            record.retention,
            record.availability,
            record.availability_detail,
            record.observed_at,
          );
      }
    });
  }

  return { accepted: accepted.length, rejected };
}

/**
 * Narrow one candidate from the runner.
 *
 * The runner is a process DASH started and authenticates, which is a good reason
 * to trust it and not a reason to skip this. It is also a *separate build* — the
 * whole point of `RUNNER_BUILD_ID` is that the runner on disk may not be the one
 * this DASH was compiled against — so a field that changed shape between builds
 * arrives here rather than at a renderer.
 *
 * An unrecognised availability becomes `missing` rather than being accepted. The
 * alternative is a state no copy exists for reaching a page that has to say
 * something about it, and `missing` is the state whose recovery — run it again —
 * is correct for the largest number of things that could have gone wrong.
 */
function narrowWorkspaceArtifact(candidate: unknown): WorkspaceArtifactRecord | null {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return null;
  }
  const value = candidate as Record<string, unknown>;
  const stringField = (key: string): string | null =>
    typeof value[key] === "string" && (value[key] as string).length > 0 ? (value[key] as string) : null;

  const artifactId = stringField("artifact_id");
  const agent = stringField("agent");
  const runId = stringField("run_id");
  const taskId = stringField("task_id");
  const sha256 = stringField("sha256");
  const registeredAt = stringField("registered_at");
  if (
    artifactId === null ||
    agent === null ||
    runId === null ||
    taskId === null ||
    sha256 === null ||
    registeredAt === null
  ) {
    return null;
  }

  const availability = value["availability"];
  const state =
    typeof availability === "string" && AVAILABILITY_STATES.has(availability)
      ? (availability as ArtifactAvailability)
      : "missing";

  const detail = value["availability_detail"];
  const observedAt = stringField("observed_at");

  return {
    artifact_id: artifactId,
    agent,
    run_id: runId,
    task_id: taskId,
    role: stringField("role") ?? "output",
    display_name: stringField("display_name") ?? artifactId,
    media_type: stringField("media_type") ?? "application/octet-stream",
    byte_size: typeof value["byte_size"] === "number" ? Math.max(0, Math.floor(value["byte_size"])) : 0,
    sha256,
    registered_at: registeredAt,
    retention: stringField("retention") ?? "kept",
    availability: state,
    availability_detail: typeof detail === "string" && detail.length > 0 ? detail : null,
    observed_at: observedAt ?? registeredAt,
  };
}

/** Every file-backed artifact one run produced, oldest first. */
export function workspaceArtifactsForRun(agent: string, runId: string): WorkspaceArtifactRecord[] {
  return db()
    .prepare(
      "SELECT * FROM workspace_artifacts WHERE agent = ? AND run_id = ? ORDER BY registered_at, artifact_id",
    )
    .all(agent, runId)
    .map((row) => ({
      artifact_id: text(row, "artifact_id"),
      agent: text(row, "agent"),
      run_id: text(row, "run_id"),
      task_id: text(row, "task_id"),
      role: text(row, "role"),
      display_name: text(row, "display_name"),
      media_type: text(row, "media_type"),
      byte_size: Number(row["byte_size"]),
      sha256: text(row, "sha256"),
      registered_at: text(row, "registered_at"),
      retention: text(row, "retention"),
      availability: text(row, "availability") as ArtifactAvailability,
      availability_detail: row["availability_detail"] === null ? null : text(row, "availability_detail"),
      observed_at: text(row, "observed_at"),
    }));
}

/**
 * The lookup the Outputs panel's `resolveAvailability` parameter takes.
 *
 * MAR-434's design slice shipped that parameter with an honest default —
 * production passed nothing and every output read as `available`, which was true
 * because nothing could yet be otherwise. This is what production passes now.
 *
 * **It answers `available` for an artifact it has never heard of, and that is
 * deliberate.** The overwhelming majority of artifacts are MAR-457 bodies stored
 * in `run_artifacts`: there is no file, so there is nothing that could be
 * missing, and reporting them as `missing` because they are absent from a table
 * about files would turn every existing digest on every existing run page red.
 * A caller that needs to distinguish "this is a body" from "this is a file the
 * runner is holding" should ask `workspaceArtifactsForRun`, which returns only
 * the second kind.
 */
export function resolveArtifactAvailability(
  agent: string,
  runId: string,
): (artifactId: string) => ArtifactAvailability {
  const byId = new Map(
    workspaceArtifactsForRun(agent, runId).map((record) => [record.artifact_id, record.availability]),
  );
  return (artifactId: string): ArtifactAvailability => byId.get(artifactId) ?? "available";
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
