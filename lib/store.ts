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
import { isOName, oFor, type OName } from "./brand/o-cast";
import { agentDisplayName } from "./copy/agent-name";
import type { AgentModelChoice } from "./ai/model-choice";
import { readAgentModelChoice, recordRunModel } from "./ai/model-store";
import {
  clearAgentFolderIssue,
  dataDir,
  db,
  describeAgentFolderReconciliation,
  insertEventRow,
  readRowsTolerantly,
  transact,
  type AgentFolderIssue,
} from "./db";
import {
  checkHostRecord,
  describeDuplicateHost,
  findDuplicateHost,
  type HostRecord,
} from "./hosts";
import { checkManifestConstraints } from "./manifest-constraints";
import { NO_NOTIFICATIONS, type NotificationSettings } from "./notify/settings";
import { isMaskedHint } from "./secret-refs";
import {
  AgentFolderValidationError,
  isAgentFolderLocked,
  listAgentFolderNames,
  removeAgentFolder,
  writeAgentFolder,
  type AgentFolderFile,
} from "./agent-folders";
import type { AgentRegistration } from "./registration";

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
  /**
   * Which of the O's this agent wears (MAR-500).
   *
   * Read from the `avatar` column, which was written once when the agent was
   * created. It is not recomputed here and must not be recomputed anywhere: a
   * character derived on the render path is a character that changes when its
   * seed does, and MAR-435 asks for one that does not.
   *
   * Falls back to `oFor(name)` for the two cases a column can be empty — a row
   * a damaged page returned without it, and a value naming a character this
   * build does not ship (a downgrade, a hand-edited store). Both are better
   * answered with the character creation would have chosen than with a broken
   * image, and neither is silent: the fallback is the same deterministic seed,
   * so the answer is stable rather than merely present.
   */
  avatar: OName;
  /**
   * A name DASH itself owns, or null when nobody has renamed this agent
   * (MAR-589).
   *
   * Read from the `display_name` column, which starts null and is written only
   * by `renameAgent`. Never derived here — `agentDisplayName` is where the
   * precedence this column exists for is decided: the column first, the
   * manifest's own `display_name` second, the humanized id last.
   */
  display_name: string | null;
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
  /** Folder/index disagreements found and surfaced at startup (ADR 0008). */
  agent_folders?: AgentFolderIssue[];
}

export interface StoreShape {
  agents: Record<string, StoredAgent>;
  /**
   * Servers DASH can reach, keyed by their opaque id.
   *
   * This record deliberately contains a key *name*, never a path or key
   * material. `electron/ssh-host.ts` resolves the name only in main.
   */
  hosts: Record<string, HostRecord>;
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
 * The stored character, or the one creation would have chosen (MAR-500).
 *
 * The column is the answer whenever it holds a character this build ships —
 * including when it disagrees with `oFor(name)`, which is the case that proves
 * nothing recomputes. `tests/o-cast.test.ts` writes a deliberately "wrong"
 * character and asserts it comes back.
 */
function storedAvatar(value: unknown, name: string): OName {
  return isOName(value) ? value : oFor(name);
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
  const hosts: Record<string, HostRecord> = {};
  const unreadable: UnreadableRows = { agents: [], events: 0, unnamed_agents: 0 };

  // Both tables are read tolerantly, because damage arrives in two shapes and
  // the store that prompted this had one of each: a row that comes back
  // truncated, and a page that will not be read at all. The JSON guard below
  // handles the first; `readRowsTolerantly` handles the second.
  const agentRows = readRowsTolerantly(database, {
    table: "agents",
    bulk: "SELECT rowid, name, manifest_json, imported_at, avatar, display_name FROM agents",
    byRowid:
      "SELECT rowid, name, manifest_json, imported_at, avatar, display_name FROM agents WHERE rowid = ?",
  });
  for (const row of agentRows.rows) {
    const name = text(row, "name");
    const manifest = parseOrNull<AnyAgentManifest>(text(row, "manifest_json"));
    if (manifest === null) {
      unreadable.agents.push(name);
      continue;
    }
    agents[name] = {
      manifest,
      imported_at: text(row, "imported_at"),
      avatar: storedAvatar(row["avatar"], name),
      display_name: row["display_name"] === null ? null : text(row, "display_name"),
    };
  }

  // Hosts are independent of agents: a server is not an agent's property, and
  // joining it into `agents` would make forgetting an agent erase the route to
  // a machine it may have shared with another one. Validate on every read just
  // as a record about ssh's argv is validated before every use; a hand-edited
  // or damaged row cannot become a string that `ssh` interprets as an option.
  const hostRows = readRowsTolerantly(database, {
    table: "hosts",
    bulk:
      "SELECT host_id, label, address, port, username, key_name, host_fingerprint, added_at FROM hosts",
    byRowid:
      "SELECT host_id, label, address, port, username, key_name, host_fingerprint, added_at FROM hosts WHERE rowid = ?",
  });
  for (const row of hostRows.rows) {
    const candidate: HostRecord = {
      host_id: text(row, "host_id"),
      label: text(row, "label"),
      address: text(row, "address"),
      port: Number(row["port"]),
      username: text(row, "username"),
      key_name: text(row, "key_name"),
      host_fingerprint: row["host_fingerprint"] === null ? null : text(row, "host_fingerprint"),
      added_at: text(row, "added_at"),
    };
    const checked = checkHostRecord(candidate);
    if (checked.ok) {
      hosts[candidate.host_id] = checked.record;
    }
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

  const folderReconciliation = describeAgentFolderReconciliation();
  if ((folderReconciliation?.issues.length ?? 0) > 0) {
    unreadable.agent_folders = folderReconciliation?.issues ?? [];
  }

  return { agents, hosts, events, unreadable };
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
  const folderNames = new Set([
    ...listAgentFolderNames(dataDir),
    ...database.prepare("SELECT name FROM agents").all().map((row) => text(row, "name")),
  ]);
  for (const name of folderNames) {
    removeAgentFolder(dataDir, name);
  }
  transact(database, () => {
    database.exec("DELETE FROM events");
    database.exec("DELETE FROM runs");
    database.exec("DELETE FROM agents");
    database.exec("DELETE FROM hosts");
    database.exec("DELETE FROM connection_secrets");
    database.exec("DELETE FROM agent_dom_state");
    database.exec("DELETE FROM command_nonces");
    database.exec("DELETE FROM command_results");
    database.exec("DELETE FROM command_audit");
    database.exec("DELETE FROM agent_handoffs");
    database.exec("DELETE FROM run_artifacts");
    database.exec("DELETE FROM workspace_artifacts");
    // MAR-488. DASH's record of its own reading goes with the thing it was a
    // reading of: a reset that kept it would leave the Runs page disclosing a
    // gap in evidence that is no longer there.
    database.exec("DELETE FROM evidence_pulls");
    database
      .prepare("DELETE FROM store_meta WHERE key = ?")
      .run("agent_folder_reconciliation");
  });
}

/* ---------------------------------------------------------------------- *
 * Hosts (MAR-536)
 * ---------------------------------------------------------------------- */

/** Read one host by the opaque id the renderer holds, or null when it is gone. */
export function readHost(hostId: string): HostRecord | null {
  return readStore().hosts[hostId] ?? null;
}

/**
 * Every saved host, oldest first (MAR-574).
 *
 * Named rather than left to callers spreading `readStore().hosts`, so that the
 * duplicate check in main and the projection in `lib/views/build.ts` are asking
 * one function the same question.
 */
export function listHosts(): HostRecord[] {
  return Object.values(readStore().hosts).sort(
    (one, other) =>
      one.added_at.localeCompare(other.added_at) || one.host_id.localeCompare(other.host_id),
  );
}

/**
 * Persist a host only after its argv-facing fields have passed the one shared
 * validator, and only when it is not a server DASH already has.
 *
 * Defence in depth twice over: main validates the renderer's draft before
 * minting a key and refuses a duplicate before creating one, and this refuses a
 * future direct caller that bypassed either door. MAR-574's evidence for why
 * the second refusal is worth a query on every write is a real store holding
 * four rows for one machine — the wizard was the only writer, and it wrote them
 * all quite happily.
 */
export function saveHost(record: HostRecord): void {
  const duplicate = findDuplicateHost(listHosts(), record);
  if (duplicate !== null) {
    throw new Error(`Refusing to save this server: ${describeDuplicateHost(duplicate.label).headline}`);
  }
  const checked = checkHostRecord(record);
  if (!checked.ok) {
    throw new Error(`Refusing to save this server: ${checked.detail}`);
  }
  db()
    .prepare(
      "INSERT INTO hosts (host_id, label, address, port, username, key_name, host_fingerprint, added_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      record.host_id,
      record.label,
      record.address,
      record.port,
      record.username,
      record.key_name,
      record.host_fingerprint,
      record.added_at,
    );
}

/**
 * The saved server at one address, or null (MAR-572).
 *
 * Enrollment has to be resumable, and this is what makes it so. The 2026-08-08
 * run reset the wizard to its first step on every failure, and walking forward
 * again minted a *new* key each time — leaving the previous one unusable in
 * DASH's store and its public half stale in the server's allowed-keys file. The
 * fix is for "add this server" to find the server it already added instead of
 * making a second one.
 *
 * Matched on the three facts that identify a way in — address, port, account —
 * and deliberately not on the label, which is what a person calls it and may
 * well change between attempts.
 */
export function findHostByConnection(connection: {
  address: string;
  port: number;
  username: string;
}): HostRecord | null {
  const hosts = Object.values(readStore().hosts);
  return (
    hosts.find(
      (host) =>
        host.address === connection.address &&
        host.port === connection.port &&
        host.username === connection.username,
    ) ?? null
  );
}

/**
 * Record that a person confirmed this server's identity (MAR-572).
 *
 * The one column this function writes, and it writes it once: the update is
 * conditional on the fingerprint still being null, so a second call cannot move
 * a pin that already exists. That is the same refusal `pinHostKey` makes about
 * the file, kept in the database too — the two have to agree, and the way to
 * make them agree is for neither to have a path that overwrites.
 *
 * Returns whether the pin was recorded. False means it was already pinned,
 * which the caller must treat as the alarm it is rather than as success.
 */
export function pinHostFingerprint(hostId: string, fingerprint: string): boolean {
  const changes = db()
    .prepare("UPDATE hosts SET host_fingerprint = ? WHERE host_id = ? AND host_fingerprint IS NULL")
    .run(fingerprint, hostId).changes;
  return Number(changes) === 1;
}

/**
 * Remove DASH's record of one server and return the key name main must retire.
 *
 * No path travels out of this query layer. The caller receives the record only
 * inside Electron main, where `forgetHostKey` derives the one owned file from
 * its name; the renderer receives just an id and a human label.
 */
export function forgetHost(hostId: string): HostRecord | null {
  const record = readHost(hostId);
  if (record === null) {
    return null;
  }
  db().prepare("DELETE FROM hosts WHERE host_id = ?").run(hostId);
  return record;
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
 *
 * `deleteFolder` (MAR-595 finding 18) is the switch between DASH's two removal
 * actions. Default `true` because every existing caller — the real
 * `runner.remove` path and every cleanup call in `electron/smoke.ts` — already
 * depends on the folder going with the row; only "remove from DASH, keep
 * files" passes `false`.
 */
export function forgetAgent(
  name: string,
  options: { deleteFolder?: boolean } = {},
): { existed: boolean } {
  const database = db();
  const deleteFolder = options.deleteFolder ?? true;
  // Folder first, row second: if the process stops between them, the surviving
  // row renders as named damage instead of a folder resurrecting an agent the
  // user removed. Skipped entirely for "remove from DASH, keep files" — the
  // whole point of that action is that this call leaves the folder alone.
  const folderExisted = deleteFolder && removeAgentFolder(dataDir, name);
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
    clearAgentFolderIssue(database, name);
    return { existed: existed || folderExisted };
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
 * One agent's persisted character (MAR-502).
 *
 * A targeted read for the reason `readAgentManifest` above is one: the agent
 * workspace is built from the manifest and a snapshot, and materialising every
 * manifest and every event to learn one string would make a poll on that page
 * cost the size of the whole store.
 *
 * Null when there is no such row — not a character. The workspace already
 * answers `found: false` for an agent DASH has never imported, and inventing a
 * costume for one would be the render path assigning an avatar, which is the
 * one thing `storedAvatar`'s own note says must never happen. A row that exists
 * with an empty or unrecognised column still falls back to the creation seed,
 * because that is a stored agent whose column is unreadable rather than an
 * agent that is not there.
 */
export function readAgentAvatar(name: string): OName | null {
  const row = db().prepare("SELECT avatar FROM agents WHERE name = ?").get(name);
  return row === undefined ? null : storedAvatar(row["avatar"], name);
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
  | { ok: false; errors: string[]; locked?: boolean };

export interface ImportManifestOptions {
  /** Folder-carrying handoff files. Omitted for a manifest-only import. */
  files?: readonly AgentFolderFile[];
  /** The spawn recipe stored in the folder. Omitted for a manifest-only import. */
  registration?: AgentRegistration;
  /** The exact validated bytes from a handoff, kept verbatim in folder and row. */
  manifestJson?: string;
}

export function importManifest(input: unknown, options: ImportManifestOptions = {}): ImportResult {
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
  let manifestJson = JSON.stringify(manifest);

  if (options.manifestJson !== undefined) {
    let source: unknown;
    try {
      source = JSON.parse(options.manifestJson);
    } catch {
      return { ok: false, errors: ["/manifest source is not readable JSON"] };
    }
    const sourceValidation = validateManifest(source);
    if (
      !sourceValidation.ok ||
      JSON.stringify(sourceValidation.value) !== JSON.stringify(manifest)
    ) {
      return {
        ok: false,
        errors: ["/manifest source disagrees with the manifest DASH validated"],
      };
    }
    manifestJson = options.manifestJson;
  }

  const declaredManifest = options.files?.find(
    (file) => file.path.replace(/\\/g, "/") === "agent.manifest.json",
  );
  if (declaredManifest !== undefined && declaredManifest.contents !== manifestJson) {
    return {
      ok: false,
      errors: ["/files declares a different agent.manifest.json than DASH validated"],
    };
  }
  if (options.registration !== undefined && options.registration.agent_id !== name) {
    return { ok: false, errors: ["/registration agent_id must match /agent/name"] };
  }

  try {
    writeAgentFolder({
      dataDir,
      agent: name,
      manifestJson,
      registration: options.registration,
      files: options.files,
    });
  } catch (error: unknown) {
    if (error instanceof AgentFolderValidationError) {
      return { ok: false, errors: error.errors };
    }
    // MAR-595 finding 15. The agent runs from this exact folder
    // (`AGENT_CODE_DIRECTORY`), so an EBUSY here almost always means the
    // running copy still has a file open — distinct from every other write
    // failure, and worth telling apart so the caller can say so honestly
    // rather than blaming a "build" that was never the problem.
    if (isAgentFolderLocked(error)) {
      return {
        ok: false,
        errors: ["DASH could not replace the agent's folder because it is running."],
        locked: true,
      };
    }
    return {
      ok: false,
      errors: ["DASH could not finish writing the agent folder."],
    };
  }

  return transact(database, () => {
    const existing = database.prepare("SELECT 1 FROM agents WHERE name = ?").get(name);
    database
      .prepare(
        "INSERT INTO agents (name, manifest_version, manifest_json, imported_at, avatar, display_name) " +
          "VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (name) DO UPDATE SET " +
          "manifest_version = excluded.manifest_version, " +
          "manifest_json = excluded.manifest_json, " +
          "imported_at = excluded.imported_at",
      )
      .run(
        name,
        manifest.manifest_version,
        manifestJson,
        new Date().toISOString(),
        // MAR-500. The insert assigns; the update clause above deliberately
        // omits `avatar`, so re-importing a manifest never re-costumes an agent
        // that already exists. That is the case worth protecting: `display_name`
        // is what a person reads and is free to change, and an agent whose
        // character moved because its author retitled it would be an agent the
        // user has to learn to recognise twice.
        //
        // The seed is `agent.name` — the primary key, and the same string SITE
        // seeds with — so the character DASH assigns on day one is the one SITE
        // would have drawn for the same agent.
        oFor(name),
        // MAR-589. Null on every insert, renamed or not: a fresh import has never
        // been renamed, and the update clause above omits this column for the
        // same reason it omits `avatar` — an author republishing their manifest
        // must not silently rename an agent the user already renamed.
        null,
      );
    clearAgentFolderIssue(database, name);
    return { ok: true as const, agent: name, replaced: existing !== undefined };
  });
}

/**
 * Accept the document already in the folder as this agent's setup (MAR-584).
 *
 * ## Why this is not `importManifest`
 *
 * It looks like the same operation and it is nearly the opposite one.
 * `importManifest` **writes the folder** — `writeAgentFolder` stages a complete
 * replacement and swaps it in, so anything not declared in the call is gone
 * afterwards, including `code/reports/` and `code/runs/`, which is where the
 * sample agent keeps everything it has ever produced. Routing an externally
 * edited folder through that door would mean re-declaring every file back to
 * DASH in order to keep it, and getting that wrong once would delete an agent's
 * work as a side effect of accepting a change to it.
 *
 * There is also nothing to write. The person's own editor already put the new
 * bytes in the folder, and the folder is authoritative (ADR 0008). What was out
 * of date is DASH's projection of it, and this updates exactly that.
 *
 * ## The gates are `importManifest`'s, deliberately not a second set
 *
 * Schema first, then `checkManifestConstraints` — the same two, in the same
 * order, from the same functions. An edit that would have been refused at first
 * import is refused here, and refused in the same words, which is the property
 * MAR-584 needs for "an invalid external edit refuses with the schema's own
 * error": there is one validator and one vocabulary, not one for the front door
 * and a lenient one for the side.
 *
 * The name must also still be the agent's. A folder whose document has been
 * renamed is not an update to this agent, it is a different agent in this
 * agent's folder, and accepting it would leave a row keyed on one name holding a
 * document naming another — the disagreement `reconcileAgentFolders` refuses to
 * create for itself.
 */
export function acceptFolderManifest(agent: string, manifestJson: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestJson);
  } catch {
    return { ok: false, errors: ["/manifest is not readable JSON"] };
  }

  const result = validateManifest(parsed);
  if (!result.ok) {
    return { ok: false, errors: result.errors };
  }
  const contradictions = checkManifestConstraints(result.value);
  if (contradictions.length > 0) {
    return { ok: false, errors: contradictions };
  }
  if (result.value.agent.name !== agent) {
    return {
      ok: false,
      errors: [
        "/agent/name no longer matches the agent this folder belongs to, so this is a different agent rather than an update to this one",
      ],
    };
  }

  const database = db();
  return transact(database, () => {
    const existing = database.prepare("SELECT 1 FROM agents WHERE name = ?").get(agent);
    if (existing === undefined) {
      return { ok: false as const, errors: ["DASH has no record of that agent."] };
    }
    database
      .prepare(
        "UPDATE agents SET manifest_version = ?, manifest_json = ? WHERE name = ?",
      )
      .run(result.value.manifest_version, manifestJson, agent);
    // `avatar` and `imported_at` are untouched, which is stronger than
    // `importManifest`'s `ON CONFLICT` omission of the first: this statement
    // names two columns and cannot reach the others. The character survives an
    // accepted edit for MAR-500's reason, and the day the agent was added is
    // still the day it was added.
    clearAgentFolderIssue(database, agent);
    return { ok: true as const, agent, replaced: true };
  });
}

export type RenameAgentResult = { ok: true } | { ok: false; errors: string[] };

/** A person is allowed to type a lot; a database row is not allowed to hold a document. */
const MAX_DISPLAY_NAME_LENGTH = 200;

/**
 * Set — or clear — the name DASH itself holds for one agent (MAR-589).
 *
 * ## Clearing is an absent argument, not an empty one
 *
 * `displayName === undefined` writes `NULL`, which is how a person puts an
 * agent back to reading its author's own `display_name`. An *empty string*
 * after trimming is refused rather than treated as a clear: `reviewCommand` in
 * `lib/shell/ipc.ts` already denies an empty string as "present but absent" for
 * every other command, and a rename command that read "" as "reset" would be
 * the one field on the whole bridge whose meaning depended on which of two
 * absent-looking values arrived — the renderer's `dropUnset` is what turns "the
 * person cleared the field" into "the key was never sent" before this is ever
 * called.
 *
 * ## What is not validated
 *
 * There is no charset check and no `minLength` beyond "not only whitespace".
 * The manifest schema's own `display_name` asks for nothing more than
 * `minLength: 1`, and a person renaming their own agent is entitled to at least
 * what an author publishing one already gets.
 */
export function renameAgent(agent: string, displayName: string | undefined): RenameAgentResult {
  const database = db();
  const existing = database.prepare("SELECT 1 FROM agents WHERE name = ?").get(agent);
  if (existing === undefined) {
    return { ok: false, errors: ["DASH has no record of that agent."] };
  }

  if (displayName === undefined) {
    database.prepare("UPDATE agents SET display_name = NULL WHERE name = ?").run(agent);
    return { ok: true };
  }

  const trimmed = displayName.trim();
  if (trimmed === "") {
    return { ok: false, errors: ["A name cannot be blank."] };
  }
  if (trimmed.length > MAX_DISPLAY_NAME_LENGTH) {
    return { ok: false, errors: [`A name cannot be longer than ${String(MAX_DISPLAY_NAME_LENGTH)} characters.`] };
  }

  database.prepare("UPDATE agents SET display_name = ? WHERE name = ?").run(trimmed, agent);
  return { ok: true };
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
    /*
     * MAR-583. Which model each agent was set to, resolved once for the batch.
     *
     * Read outside the transaction and before it, so a batch of a hundred events
     * costs one lookup per distinct agent rather than one per event. The value is
     * DASH's own setting at this instant, which is exactly what the row is a
     * record of; `recordRunModel` then refuses to overwrite an existing row, so a
     * later batch for the same run cannot revise it.
     *
     * Recorded for every run rather than only for runs whose plan needs a model.
     * Deciding that here would mean reading and parsing a manifest on the ingest
     * path — and the honest place for it is the read side, where the same
     * manifest is already open and where a plan that has since changed is
     * visible. `runModelForRun` in `lib/views/build.ts` is what draws the line.
     */
    const choices = new Map<string, AgentModelChoice>();
    for (const event of accepted) {
      if (!choices.has(event.agent)) {
        choices.set(event.agent, readAgentModelChoice(event.agent));
      }
    }
    transact(database, () => {
      for (const event of accepted) {
        insertEventRow(database, event, receivedAt);
        const choice = choices.get(event.agent);
        if (choice !== undefined) {
          recordRunModel(database, event.agent, event.run_id, choice, receivedAt);
        }
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
 * How many of an agent's artifacts the declarative panel is fed (MAR-548).
 *
 * Twenty because that is `max_items`'s own maximum in
 * `contracts/agent.manifest.v2.schema.json` — the largest number of records any
 * section in the panel vocabulary can ask to draw. Setting DASH's fetch bound
 * to exactly the vocabulary's own bound means a truncation a person sees is
 * always the *author's* cap biting, never DASH's, so `describeOutputsCap`'s
 * sentence is never quietly wrong about whose choice hid something.
 */
export const PANEL_ARTIFACT_LIMIT = 20;

/**
 * What an agent has produced, newest first, for the panel to bind roles against
 * (MAR-548, ADR 0008).
 *
 * Across every run rather than scoped to one, which is the difference between
 * this and the Outputs area beside it. The Outputs area answers "what happened
 * last time?" and is deliberately one run's worth; a panel binds by *role* —
 * "the newest artifact whose kind is `digest`" — and a role a person declared
 * must not appear empty because the most recent run happened to produce a
 * different kind of thing.
 *
 * ## Why two queries, and why the second one is not an optimisation
 *
 * The first takes the newest `limit` records, which is what an `outputs`
 * section draws. On its own it has a hole: an agent that has written twenty
 * drafts since its last digest would push that digest out of the window, and a
 * `report` bound to `digest` would render its stated empty state — the surface
 * saying "nothing yet" about something DASH is holding. That is a silent wrong
 * answer, which is the one failure this codebase keeps paying for.
 *
 * The second query closes it by construction: the newest record of *every*
 * kind, whatever its position. `kind` is a column, so this costs an index seek
 * per kind rather than a scan of the bodies. The two are merged and deduped on
 * `(run_id, artifact_id)`, which is the identity the table's own primary key
 * uses, so a record that both queries return is one record here.
 *
 * A damaged row is skipped rather than thrown, exactly as `artifactsForRun`
 * treats one.
 */
export function artifactRecordsForAgent(
  agent: string,
  limit: number = PANEL_ARTIFACT_LIMIT,
): RunArtifactRecord[] {
  const newest = db()
    .prepare(
      "SELECT run_id, artifact_id, artifact_json, generated_at, received_at FROM run_artifacts " +
        "WHERE agent = ? ORDER BY generated_at DESC LIMIT ?",
    )
    .all(agent, limit) as Array<Record<string, unknown>>;

  const newestOfEachKind = db()
    .prepare(
      "SELECT run_id, artifact_id, artifact_json, generated_at, received_at FROM run_artifacts a " +
        "WHERE a.agent = ? AND a.generated_at = " +
        "(SELECT MAX(b.generated_at) FROM run_artifacts b WHERE b.agent = a.agent AND b.kind = a.kind)",
    )
    .all(agent) as Array<Record<string, unknown>>;

  const seen = new Set<string>();
  const rows: Array<{ row: Record<string, unknown>; generated_at: string }> = [];
  for (const row of [...newest, ...newestOfEachKind]) {
    const identity = `${text(row, "run_id")} ${text(row, "artifact_id")}`;
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    rows.push({ row, generated_at: text(row, "generated_at") });
  }

  // Newest first over the merged set. `artifactRecordsForRun` gets this from
  // its own ORDER BY; here two orderings arrive and one of them has to win, so
  // it is stated rather than inherited — `lib/views/panel.ts` documents that
  // every binding resolves against records in this order.
  rows.sort((a, b) => b.generated_at.localeCompare(a.generated_at));

  const records: RunArtifactRecord[] = [];
  for (const { row } of rows) {
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

/* ---------------------------------------------------------------------- *
 * How complete the record above is (MAR-488)
 * ---------------------------------------------------------------------- */

/**
 * When DASH last looked at one runner, and what had already gone.
 *
 * Deliberately not shaped like anything else in this file. Every other record
 * here is *what an agent did*; this is **DASH's account of its own reading**, so
 * it carries no agent, no run and no artifact id — the same structural
 * separation ADR 0005 gives `broker_lapses`, for the same reason: a row that
 * could be joined into a run would eventually be rendered as one.
 */
export interface EvidencePullRecord {
  source: string;
  kind: "this_machine" | "another_machine";
  observed_at: string;
  reached: boolean;
  telemetry_dropped: number;
  artifacts_dropped: number;
  workspace_truncated: boolean;
}

/**
 * Record one pass, overwriting the previous one for that source.
 *
 * A state and not a history — see the migration's own note. The number that
 * matters is cumulative in the only sense a user cares about ("is what I am
 * looking at everything?"), and a table of every five-second poll would answer
 * that worse.
 */
export function recordEvidencePull(pull: EvidencePullRecord): void {
  db()
    .prepare(
      "INSERT INTO evidence_pulls " +
        "(source, kind, observed_at, reached, telemetry_dropped, artifacts_dropped, workspace_truncated) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT (source) DO UPDATE SET " +
        "kind = excluded.kind, " +
        "observed_at = excluded.observed_at, " +
        "reached = excluded.reached, " +
        "telemetry_dropped = excluded.telemetry_dropped, " +
        "artifacts_dropped = excluded.artifacts_dropped, " +
        "workspace_truncated = excluded.workspace_truncated",
    )
    .run(
      pull.source,
      pull.kind,
      pull.observed_at,
      pull.reached ? 1 : 0,
      pull.telemetry_dropped,
      pull.artifacts_dropped,
      pull.workspace_truncated ? 1 : 0,
    );
}

/** Every source DASH has ever pulled from, newest look first. */
export function readEvidencePulls(): EvidencePullRecord[] {
  const rows = db()
    .prepare("SELECT * FROM evidence_pulls ORDER BY observed_at DESC")
    .all();
  return rows.map((row) => ({
    source: String(row["source"]),
    kind: row["kind"] === "another_machine" ? "another_machine" : "this_machine",
    observed_at: String(row["observed_at"]),
    reached: Number(row["reached"]) === 1,
    telemetry_dropped: Number(row["telemetry_dropped"] ?? 0),
    artifacts_dropped: Number(row["artifacts_dropped"] ?? 0),
    workspace_truncated: Number(row["workspace_truncated"] ?? 0) === 1,
  }));
}

/* ---------------------------------------------------------------------- *
 * When the reader last looked (MAR-586)
 * ---------------------------------------------------------------------- */

/**
 * Record that somebody has just opened this agent's page.
 *
 * The one fact MAR-586 adds to the store, and it is a fact about the *reader*
 * rather than about the agent — see the migration's own note for why it is its
 * own table and not a column on `agents`.
 *
 * `at` is a parameter with a production default, the pattern `runsView` uses for
 * `pulls`: production passes nothing and gets DASH's clock, and a test drives the
 * boundary — an output that arrived one second before a look and one second
 * after it — without waiting for a real second to pass.
 *
 * Overwrites. A second look replaces the first, because what the fleet card asks
 * is "has anything arrived since the last one", and the answer to that never
 * involves the look before it.
 */
export function recordAgentLook(agent: string, at: string = new Date().toISOString()): void {
  db()
    .prepare(
      "INSERT INTO agent_looks (agent, last_looked_at) VALUES (?, ?) " +
        "ON CONFLICT (agent) DO UPDATE SET last_looked_at = excluded.last_looked_at",
    )
    .run(agent, at);
}

/**
 * When each agent's page was last opened, keyed by agent.
 *
 * Read whole rather than one at a time because the caller is the fleet — a page
 * that draws every agent — and one statement beats one per card. An agent with no
 * entry is simply absent from the map, which is the state that means *nobody has
 * ever opened this agent's page*, and it is deliberately not folded into "looked
 * at the beginning of time": the two produce different sentences, and
 * `lib/copy/glance.ts` says why.
 */
export function readAgentLooks(): Map<string, string> {
  const rows = db().prepare("SELECT agent, last_looked_at FROM agent_looks").all();
  return new Map(rows.map((row) => [text(row, "agent"), text(row, "last_looked_at")]));
}

/* ---------------------------------------------------------------------- *
 * What DASH sent to a server (MAR-584, ADR 0010)
 * ---------------------------------------------------------------------- */

/**
 * One past deploy, as DASH observed it happen.
 *
 * Every field is something DASH knew at the moment it acted. There is nothing
 * here about the server's current state and the type is the place that has to
 * keep it that way — see ADR 0010, and the migration's note on why no `running`
 * column will ever be added.
 */
export interface AgentDeployRecord {
  agent: string;
  host_id: string;
  sent_at: string;
  /** Of the document that went across, so "is this still current" is answerable. */
  manifest_sha256: string;
  /** Of the program that went with it. Null for a manifest-only bundle. */
  files_sha256: string | null;
}

/**
 * Write down that DASH sent this agent to this server.
 *
 * Called after the push succeeded, never before it and never on a refusal. A
 * deploy is three steps behind one answer — bundle, install, start — and
 * `lib/deploy/deploying.ts` explains why DASH cannot tell which of them a
 * failure stopped at. A row written on a failed attempt would claim DASH sent
 * something when it may not have; a row written only on success claims the one
 * thing DASH does know, which is that the server accepted the push and said so.
 *
 * Overwrites per (agent, server), for `recordAgentLook`'s reason: the question
 * is "did DASH send this there, and was it before the change I just accepted",
 * and no earlier push changes that answer.
 */
export function recordAgentDeploy(
  record: Omit<AgentDeployRecord, "sent_at">,
  at: string = new Date().toISOString(),
): void {
  db()
    .prepare(
      "INSERT INTO agent_deploys (agent, host_id, sent_at, manifest_sha256, files_sha256) " +
        "VALUES (?, ?, ?, ?, ?) ON CONFLICT (agent, host_id) DO UPDATE SET " +
        "sent_at = excluded.sent_at, manifest_sha256 = excluded.manifest_sha256, " +
        "files_sha256 = excluded.files_sha256",
    )
    .run(record.agent, record.host_id, at, record.manifest_sha256, record.files_sha256);
}

/** Every server DASH has sent this agent to, most recent first. */
export function readAgentDeploys(agent: string): AgentDeployRecord[] {
  const rows = db()
    .prepare(
      "SELECT agent, host_id, sent_at, manifest_sha256, files_sha256 FROM agent_deploys " +
        "WHERE agent = ? ORDER BY sent_at DESC",
    )
    .all(agent);
  return rows.map((row) => ({
    agent: text(row, "agent"),
    host_id: text(row, "host_id"),
    sent_at: text(row, "sent_at"),
    manifest_sha256: text(row, "manifest_sha256"),
    files_sha256: row["files_sha256"] === null ? null : text(row, "files_sha256"),
  }));
}

/**
 * Every agent DASH has sent to one server, most recent first (MAR-606).
 *
 * The other way through the same table. `readAgentDeploys` answers *which
 * servers has this agent been to*, which is an agent page's question; this
 * answers *what has DASH put on this server*, which is a server card's — and
 * until MAR-606 nothing asked it, so the Servers page could not say what DASH
 * had sent even though DASH had recorded every push.
 *
 * `agent_deploys_by_agent` does not serve this direction. No second index: the
 * table holds one row per (agent, server) and a person owns a handful of each,
 * so a scan is the honest answer rather than an index nothing else would use.
 */
export function readHostDeploys(hostId: string): AgentDeployRecord[] {
  const rows = db()
    .prepare(
      "SELECT agent, host_id, sent_at, manifest_sha256, files_sha256 FROM agent_deploys " +
        "WHERE host_id = ? ORDER BY sent_at DESC",
    )
    .all(hostId);
  return rows.map((row) => ({
    agent: text(row, "agent"),
    host_id: text(row, "host_id"),
    sent_at: text(row, "sent_at"),
    manifest_sha256: text(row, "manifest_sha256"),
    files_sha256: row["files_sha256"] === null ? null : text(row, "files_sha256"),
  }));
}

/**
 * Forget every deploy to one server.
 *
 * ADR 0010 requires this and it is not tidiness. `host.forget` removes the key
 * and the label, and a surviving row would name a server DASH can no longer
 * reach or even name — which could only ever render as an orphaned claim about
 * a machine, the exact thing the ADR bounds DASH away from.
 */
export function forgetHostDeploys(hostId: string): void {
  db().prepare("DELETE FROM agent_deploys WHERE host_id = ?").run(hostId);
}

/* ---------------------------------------------------------------------- *
 * Discord notifications (MAR-588)
 * ---------------------------------------------------------------------- */

/**
 * What DASH is set up to post, and where it is *not* recorded.
 *
 * Everything in `NotificationSettings` except the two switches is derived from
 * the presence of a row: a row exists exactly when a webhook address is in the
 * vault, so `configured` is a fact about the store and about the vault agreeing.
 * They can disagree — a vault wiped by a profile move, a row lost to store
 * damage — and the honest answer is that this reports what the store holds while
 * `notify.test` is the only thing that reports what the vault holds. Two
 * different questions, answered by two different things, neither pretending to
 * be the other.
 */
export function readNotificationSettings(): NotificationSettings {
  const row = db()
    .prepare(
      "SELECT masked_hint, configured_at, send_approvals, send_reports FROM notify_discord WHERE id = 1",
    )
    .get() as Record<string, unknown> | undefined;

  if (row === undefined) {
    return NO_NOTIFICATIONS;
  }

  const hint = text(row, "masked_hint");
  return {
    // Re-checked on the way out, the same discipline `Vault.listNames` applies
    // to its own directory: this column is on the user's disk and anything could
    // have been written into it. A hint that would not have been accepted going
    // in is not handed to a page as if DASH had produced it.
    configured: isMaskedHint(hint),
    masked_hint: isMaskedHint(hint) ? hint : null,
    configured_at: text(row, "configured_at"),
    send_approvals: row["send_approvals"] !== 0,
    send_reports: row["send_reports"] !== 0,
  };
}

/**
 * Record that an address is now in the vault.
 *
 * Refuses anything that is not a mask. A caller that reached here with a real
 * credential in hand has made the one mistake this whole feature is shaped
 * around, and it should fail loudly at the call rather than land in a column
 * that `tests/redaction.test.ts` then finds by scanning the database bytes.
 *
 * The two switches are preserved across a re-connect: somebody replacing an
 * address they had turned reports off for did not ask for reports back.
 */
export function recordNotificationWebhook(
  maskedHint: string,
  at: string = new Date().toISOString(),
): void {
  if (!isMaskedHint(maskedHint)) {
    throw new Error("recordNotificationWebhook was given something that is not a masked hint.");
  }
  db()
    .prepare(
      "INSERT INTO notify_discord (id, masked_hint, configured_at) VALUES (1, ?, ?) " +
        "ON CONFLICT (id) DO UPDATE SET masked_hint = excluded.masked_hint, " +
        "configured_at = excluded.configured_at",
    )
    .run(maskedHint, at);
}

/** Turn one kind of message on or off. No effect when nothing is configured. */
export function setNotificationKind(
  kind: "needs_approval" | "new_report",
  enabled: boolean,
): void {
  const column = kind === "needs_approval" ? "send_approvals" : "send_reports";
  db()
    .prepare(`UPDATE notify_discord SET ${column} = ? WHERE id = 1`)
    .run(enabled ? 1 : 0);
}

/**
 * Forget the channel.
 *
 * The row goes, including the switches. Deliberately not "keep the preferences
 * in case they come back": a person who disconnected asked DASH to stop knowing
 * about their channel, and a surviving row would be DASH remembering something
 * about a connection it was told to forget. Removing the vault entry is the
 * caller's job and happens first — see `electron/main.ts`.
 */
export function forgetNotificationWebhook(): void {
  db().prepare("DELETE FROM notify_discord WHERE id = 1").run();
}

/**
 * How much this agent has produced, and how much of it is newer than a moment.
 *
 * **`received_at` and not `generated_at`**, and the choice is the whole
 * correctness of the "new output" chip. `generated_at` is the *agent's* claim
 * about when it made something, from a clock DASH does not set; `received_at` is
 * DASH's own clock when the artifact arrived, and a look is stamped from that
 * same clock. Comparing DASH's record of a look against an agent's account of its
 * own past would let an agent with a wrong clock either hide its output forever
 * or announce every old artifact as new.
 *
 * `since` of null means nobody has looked, and every artifact counts — which is
 * true, and is the state a first-run fleet is in.
 *
 * One statement rather than two, because both numbers are aggregates over the
 * same rows and this is called once per card.
 */
export function artifactArrivals(
  agent: string,
  since: string | null,
): { total: number; since_count: number } {
  const row = db()
    .prepare(
      "SELECT count(*) AS total, " +
        "sum(CASE WHEN received_at > ? THEN 1 ELSE 0 END) AS since_count " +
        "FROM run_artifacts WHERE agent = ?",
    )
    // The empty string sorts below every ISO-8601 instant, so "nobody has
    // looked" and "everything is newer than the look" are the same query.
    .get(since ?? "", agent) as Record<string, unknown> | undefined;

  return {
    total: Number(row?.["total"] ?? 0),
    // `sum` over no rows is NULL rather than 0 in SQLite, which `Number(null)`
    // would turn into 0 anyway — stated because the coalesce is load-bearing
    // for an agent that has produced nothing at all.
    since_count: Number(row?.["since_count"] ?? 0),
  };
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
  /**
   * Which of the O's this agent wears (MAR-500, surfaced by MAR-501/502/503).
   *
   * Carried through from `StoredAgent.avatar`, which is the column, rather than
   * recomputed from `name` here. A summary that recomputed it would be a second
   * assignment rule sitting on the render path, and it would agree with the
   * stored one for exactly as long as nobody ever changed an agent's character.
   */
  avatar: OName;
  /**
   * The one name a person reads for this agent (MAR-589).
   *
   * `agentDisplayName`'s answer, with the stored column preferred over the
   * manifest's own `display_name` — the precedence a rename exists to have.
   * Computed here, once per agent per read, so every surface that lists agents
   * draws the same title a rename actually changed, rather than each deriving
   * its own from a manifest that a stored rename has already superseded.
   */
  title: string;
}

export function listAgents(store: StoreShape = readStore()): AgentSummary[] {
  const runsByAgent = new Map<string, Set<string>>();
  for (const event of store.events) {
    const runs = runsByAgent.get(event.agent) ?? new Set<string>();
    runs.add(event.run_id);
    runsByAgent.set(event.agent, runs);
  }

  return Object.values(store.agents)
    .map(({ manifest, imported_at, avatar, display_name }) => ({
      name: manifest.agent.name,
      manifest_version: manifest.manifest_version,
      goal: manifest.agent.goal,
      plan_source: manifest.agent.plan_source,
      build_target: manifest.agent.build_target,
      planned_steps: manifest.planned_route.length,
      automation_clearance: manifest.safety_contract.automation_clearance,
      imported_at,
      run_count: runsByAgent.get(manifest.agent.name)?.size ?? 0,
      avatar,
      title: agentDisplayName({
        name: manifest.agent.name,
        display_name: display_name ?? manifest.agent.display_name,
      }),
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
