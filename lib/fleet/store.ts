/**
 * Reading and writing the fleet connection, assignment, and grant tables
 * (MAR-593, MAR-643, ADR 0013).
 *
 * The only impure module under `lib/fleet/`, and deliberately the thinnest, in
 * `lib/broker/store.ts`'s shape: it writes rows the action layer already decided
 * and reads them back for whoever is drawing a card. No policy lives here. A
 * function in this file that decided which agents a connection reaches would be
 * a second authority beside `lib/fleet/grants.ts`, free to drift from it.
 *
 * ## The row is the consent, never the permission
 *
 * Nothing consults `fleet_connections` to decide whether a request may be made.
 * The broker resolves a grant from the agent's own manifest and the live
 * credential on every call, against a vault name this table has no say in — so a
 * row here that has gone stale shows out-of-date wording and grants nobody
 * anything. That is the same argument `broker_grants` makes about a receipt, and
 * it is what makes it safe for this to be a record rather than a gate.
 *
 * ## What cannot be written
 *
 * `masked_hint` and `account_hint` go through `isDisplayableHint`, which is
 * `lib/secret-refs.ts`'s gate and which a raw credential cannot pass; a caller
 * who hands over a value gets an error rather than a row. `secret_name` goes
 * through `assertValidSecretName`. Nothing in this file ever receives a secret
 * to mask, so nothing in it can leak one — `recordSecretReference`'s property,
 * kept rather than re-argued.
 */

import { describeFleetConnected, describeFleetDisconnected } from "../copy/decisions";
import { db } from "../db";
import { isDisplayableHint } from "../secret-refs";
import { assertValidSecretName } from "../secure-store";
import type { ConnectorKindV1 } from "../connection-spec";
import { fileDecision } from "./decisions-store";

/* ---------------------------------------------------------------------- *
 * The connection
 * ---------------------------------------------------------------------- */

export interface FleetConnectionRow {
  provider: string;
  /** Opaque local identity. Never derived from the account name or credential. */
  account_id: string;
  connector_kind: ConnectorKindV1;
  field_id: string;
  /** The key into the OS vault. A name, not a value. */
  secret_name: string;
  masked_hint: string | null;
  /** Masked, e.g. `he••@gmail.com`. Null for a key, which identifies nobody. */
  account_hint: string | null;
  /** What the consent issued, for the readable projection. */
  scopes: string[];
  backend: string;
  /** Exactly one row per provider is the fallback for an unassigned agent. */
  is_default: boolean;
  connected_at: string;
  updated_at: string;
}

/** What a caller supplies. `connected_at` is the table's to preserve. */
export type FleetConnectionInput = Omit<
  FleetConnectionRow,
  "connected_at" | "updated_at" | "account_id" | "is_default"
> &
  Partial<Pick<FleetConnectionRow, "account_id" | "is_default">>;

/** The non-secret id migration 24 gives the one account older stores held. */
export const LEGACY_FLEET_ACCOUNT_ID = "account-1";

/** The first unused opaque local id. It contains no account or credential data. */
export function nextFleetAccountId(provider: string): string {
  const used = new Set(listFleetConnections(provider).map((one) => one.account_id));
  for (let index = 1; ; index += 1) {
    const candidate = `account-${String(index)}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
}

/**
 * Write or refresh one fleet connection.
 *
 * `connected_at` survives an update, for `recordReceipt`'s reason exactly: the
 * date a person first approved this is the fact the row exists to carry, and
 * overwriting it on every re-key would make every connection look like it was
 * made this morning — which is the one number somebody would use to notice
 * access they no longer remember giving.
 *
 * Everything else is replaced, because everything else is current state: the
 * account changes when somebody reconnects with a different one, and the scope
 * set shrinks when they untick a box.
 */
export function recordFleetConnection(input: FleetConnectionInput, at: string): void {
  assertValidSecretName(input.secret_name);
  for (const hint of [input.masked_hint, input.account_hint]) {
    if (hint !== null && !isDisplayableHint(hint)) {
      // Not echoed into the message: if a caller passed a raw value by mistake,
      // saying so with the value attached would put it in a log — the failure
      // this check exists to prevent.
      throw new Error(
        "a fleet connection's hints must be masked. The store never accepts a raw value.",
      );
    }
  }

  const database = db();
  const accountId = input.account_id ?? LEGACY_FLEET_ACCOUNT_ID;
  const existingCount = Number(
    (database
      .prepare("SELECT COUNT(*) AS count FROM fleet_connections WHERE provider = ?")
      .get(input.provider) as { count?: number } | undefined)?.count ?? 0,
  );
  // Computed before the write, so the decisions log records the connection
  // being *made* and not every re-key — `connected_at` surviving the update is
  // the same fact kept for the same reason (ADR 0024 decision 1). Provider-level
  // on purpose, now that a provider can hold several accounts: adding a second
  // account re-keys the person's standing decision to have this provider
  // connected rather than making a new one.
  const isNew = existingCount === 0;
  const isDefault = input.is_default ?? existingCount === 0;

  database.exec("BEGIN IMMEDIATE");
  try {
    if (isDefault) {
      database
        .prepare("UPDATE fleet_connections SET is_default = 0 WHERE provider = ?")
        .run(input.provider);
    }
    database
      .prepare(
      "INSERT INTO fleet_connections " +
        "(provider, account_id, connector_kind, field_id, secret_name, masked_hint, account_hint, " +
        " scopes, backend, is_default, connected_at, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT (provider, account_id) DO UPDATE SET " +
        "connector_kind = excluded.connector_kind, field_id = excluded.field_id, " +
        "secret_name = excluded.secret_name, masked_hint = excluded.masked_hint, " +
        "account_hint = excluded.account_hint, scopes = excluded.scopes, " +
        "backend = excluded.backend, is_default = excluded.is_default, " +
        "updated_at = excluded.updated_at",
      )
      .run(
        input.provider,
        accountId,
        input.connector_kind,
        input.field_id,
        input.secret_name,
        input.masked_hint,
        input.account_hint,
        JSON.stringify(input.scopes),
        input.backend,
        isDefault ? 1 : 0,
        at,
        at,
      );
    if (isNew) {
      // Inside the same transaction, which is ADR 0024's write-site rule:
      // the decision is filed where it is made, or neither happens.
      fileDecision({
        decided_at: at,
        subject_kind: "connection",
        subject_id: input.provider,
        kind: "fleet_connection",
        topic: "",
        summary: describeFleetConnected(input.provider),
        outcome: { state: "connected", provider: input.provider },
        decided_by: "person",
        rule: null,
        reason: null,
        receipts: [`fleet_connections ${input.provider}`],
      });
    }
    database.exec("COMMIT");
  } catch (error: unknown) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function readFleetConnection(
  provider: string,
  accountId?: string,
): FleetConnectionRow | null {
  const row = accountId === undefined
    ? db()
      .prepare(
      "SELECT provider, connector_kind, field_id, secret_name, masked_hint, account_hint, " +
        " account_id, scopes, backend, is_default, connected_at, updated_at " +
        "FROM fleet_connections WHERE provider = ? " +
        "ORDER BY is_default DESC, connected_at, account_id LIMIT 1",
      )
      .get(provider)
    : db()
      .prepare(
        "SELECT provider, connector_kind, field_id, secret_name, masked_hint, account_hint, " +
          " account_id, scopes, backend, is_default, connected_at, updated_at " +
          "FROM fleet_connections WHERE provider = ? AND account_id = ?",
      )
      .get(provider, accountId);
  return row === undefined || row === null ? null : toConnection(row as Record<string, unknown>);
}

/** Every fleet connection, oldest first, so the page is stable across reads. */
export function listFleetConnections(provider?: string): FleetConnectionRow[] {
  const rows = provider === undefined
    ? db().prepare(
      "SELECT provider, connector_kind, field_id, secret_name, masked_hint, account_hint, " +
        " account_id, scopes, backend, is_default, connected_at, updated_at " +
        "FROM fleet_connections ORDER BY connected_at, provider, account_id",
      ).all()
    : db().prepare(
      "SELECT provider, connector_kind, field_id, secret_name, masked_hint, account_hint, " +
        " account_id, scopes, backend, is_default, connected_at, updated_at " +
        "FROM fleet_connections WHERE provider = ? " +
        "ORDER BY is_default DESC, connected_at, account_id",
      ).all(provider);
  return rows
    .map((row) => toConnection(row as Record<string, unknown>));
}

/**
 * Forget one fleet connection.
 *
 * Called by disconnect, after the credential is gone from the vault and after
 * every materialization has been withdrawn — `forgetReceipt`'s order, and for
 * its reason: a record of consent that outlived the credential it is a record of
 * would tell somebody they are connected to something DASH cannot reach.
 *
 * The grants go with it. A withheld row is a decision about *this* connection,
 * and keeping it would mean an agent somebody once revoked stayed silently
 * excluded from a connection made months later — a consequence of a decision
 * nobody could see any more.
 */
export function forgetFleetConnection(provider: string, accountId?: string): void {
  const database = db();
  if (accountId === undefined) {
    const result = database
      .prepare("DELETE FROM fleet_connections WHERE provider = ?")
      .run(provider);
    database.prepare("DELETE FROM fleet_account_assignments WHERE provider = ?").run(provider);
    // The grants go unfiled: they are this one decision's cascade, and the
    // withheld rows going with the connection is what the docblock above
    // already argues — one decision, one row (ADR 0024 decision 1).
    database.prepare("DELETE FROM fleet_grants WHERE provider = ?").run(provider);
    if (Number(result.changes) > 0) {
      fileFleetDisconnected(provider);
    }
    return;
  }
  database
    .prepare("DELETE FROM fleet_connections WHERE provider = ? AND account_id = ?")
    .run(provider, accountId);
  database
    .prepare("DELETE FROM fleet_account_assignments WHERE provider = ? AND account_id = ?")
    .run(provider, accountId);
  if (listFleetConnections(provider).length === 0) {
    database.prepare("DELETE FROM fleet_grants WHERE provider = ?").run(provider);
    // Removing one account while others remain re-keys the person's standing
    // decision to have this provider connected; removing the last one is the
    // provider ceasing to be connected, and that is the decision (ADR 0024
    // decision 1, provider-level for saveFleetConnection's own reason).
    fileFleetDisconnected(provider);
  }
}

/** The disconnect decision, filed once per provider from either removal path. */
function fileFleetDisconnected(provider: string): void {
  fileDecision({
    decided_at: new Date().toISOString(),
    subject_kind: "connection",
    subject_id: provider,
    kind: "fleet_connection",
    topic: "",
    summary: describeFleetDisconnected(provider),
    outcome: { state: "disconnected", provider },
    decided_by: "person",
    rule: null,
    reason: null,
    receipts: [`fleet_connections ${provider}`],
  });
}

/** Make one existing account the fallback. Existing explicit assignments do not move. */
export function setDefaultFleetConnection(provider: string, accountId: string): boolean {
  if (readFleetConnection(provider, accountId) === null) {
    return false;
  }
  const database = db();
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare("UPDATE fleet_connections SET is_default = 0 WHERE provider = ?").run(provider);
    database
      .prepare(
        "UPDATE fleet_connections SET is_default = 1 WHERE provider = ? AND account_id = ?",
      )
      .run(provider, accountId);
    database.exec("COMMIT");
    return true;
  } catch (error: unknown) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function toConnection(row: Record<string, unknown>): FleetConnectionRow {
  return {
    provider: String(row["provider"]),
    account_id: String(row["account_id"]),
    connector_kind: String(row["connector_kind"]) as ConnectorKindV1,
    field_id: String(row["field_id"]),
    secret_name: String(row["secret_name"]),
    masked_hint: row["masked_hint"] === null ? null : String(row["masked_hint"]),
    account_hint: row["account_hint"] === null ? null : String(row["account_hint"]),
    scopes: parseScopes(row["scopes"]),
    backend: String(row["backend"]),
    is_default: Number(row["is_default"]) === 1,
    connected_at: String(row["connected_at"]),
    updated_at: String(row["updated_at"]),
  };
}

/* ---------------------------------------------------------------------- *
 * The per-agent account selection
 * ---------------------------------------------------------------------- */

export interface FleetAccountAssignmentRow {
  provider: string;
  agent: string;
  account_id: string;
  decided_at: string;
}

export function recordFleetAccountAssignment(
  provider: string,
  agent: string,
  accountId: string,
  at: string,
): boolean {
  if (readFleetConnection(provider, accountId) === null) {
    return false;
  }
  db().prepare(
    "INSERT INTO fleet_account_assignments (provider, agent, account_id, decided_at) " +
      "VALUES (?, ?, ?, ?) ON CONFLICT (provider, agent) DO UPDATE SET " +
      "account_id = excluded.account_id, decided_at = excluded.decided_at",
  ).run(provider, agent, accountId, at);
  return true;
}

export function readFleetAccountAssignment(
  provider: string,
  agent: string,
): FleetAccountAssignmentRow | null {
  const row = db().prepare(
    "SELECT provider, agent, account_id, decided_at FROM fleet_account_assignments " +
      "WHERE provider = ? AND agent = ?",
  ).get(provider, agent) as Record<string, unknown> | undefined;
  return row === undefined ? null : {
    provider: String(row["provider"]),
    agent: String(row["agent"]),
    account_id: String(row["account_id"]),
    decided_at: String(row["decided_at"]),
  };
}

export function forgetFleetAccountAssignment(provider: string, agent: string): void {
  db().prepare(
    "DELETE FROM fleet_account_assignments WHERE provider = ? AND agent = ?",
  ).run(provider, agent);
}

export function assignedFleetConnection(
  provider: string,
  agent: string,
): FleetConnectionRow | null {
  const assignment = readFleetAccountAssignment(provider, agent);
  return assignment === null
    ? readFleetConnection(provider)
    : readFleetConnection(provider, assignment.account_id) ?? readFleetConnection(provider);
}

/**
 * A stored scope list, or an empty one.
 *
 * A damaged value yields no scopes rather than a throw, for `parseOperations`'
 * reason: a connection whose projection cannot be read should render as one with
 * nothing listed — which somebody can act on — rather than taking down the page
 * that would have let them disconnect it.
 */
function parseScopes(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

/* ---------------------------------------------------------------------- *
 * The per-agent decision
 * ---------------------------------------------------------------------- */

/**
 * What somebody decided about one agent's access to one fleet connection.
 *
 * Two values and no third for "never decided", because never decided is the
 * **absence of a row**. A stored `undecided` would be a decision record
 * recording that no decision was made, and `lib/fleet/grants.ts` would then have
 * two ways to spell the ordinary case.
 */
export type FleetGrantStanding = "granted" | "withheld";

export interface FleetGrantRow {
  provider: string;
  agent: string;
  standing: FleetGrantStanding;
  decided_at: string;
}

export function recordFleetGrant(
  provider: string,
  agent: string,
  standing: FleetGrantStanding,
  at: string,
): void {
  db()
    .prepare(
      "INSERT INTO fleet_grants (provider, agent, standing, decided_at) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT (provider, agent) DO UPDATE SET " +
        "standing = excluded.standing, decided_at = excluded.decided_at",
    )
    .run(provider, agent, standing, at);
}

/** Every decision made about one fleet connection. Absence of an agent means undecided. */
export function readFleetGrants(provider: string): FleetGrantRow[] {
  return db()
    .prepare(
      "SELECT provider, agent, standing, decided_at FROM fleet_grants WHERE provider = ? " +
        "ORDER BY agent",
    )
    .all(provider)
    .map((row) => toGrant(row as Record<string, unknown>));
}

/**
 * The agents somebody has withheld from one connection.
 *
 * The shape `lib/fleet/grants.ts` actually wants, computed here so no caller has
 * to remember that a row reading `granted` is not one to skip. A stored standing
 * this build does not recognise is treated as **withheld**, which is the safe
 * direction: the alternative is materializing a credential against a decision
 * DASH could not read.
 */
export function withheldAgents(provider: string): Set<string> {
  return new Set(
    readFleetGrants(provider)
      .filter((row) => row.standing !== "granted")
      .map((row) => row.agent),
  );
}

/**
 * Forget one agent's decisions across every connection.
 *
 * Called when the agent is removed. Deliberately not called by a disconnect: a
 * person who withheld an agent from Gmail and then disconnected Gmail has not
 * changed their mind about the agent — but the connection those rows describe is
 * gone, which is why `forgetFleetConnection` clears them by provider instead.
 */
export function forgetAgentFleetGrants(agent: string): void {
  db().prepare("DELETE FROM fleet_grants WHERE agent = ?").run(agent);
}

/**
 * Undo one agent's decision on one connection, restoring "never decided" (MAR-624).
 *
 * `recordFleetGrant` has one caller that writes before it knows the outcome —
 * `adoptFleetCredential` records `granted` so a revoked agent is no longer
 * withheld by the time materialization reads the set, then materializes. When
 * that materialization does not actually produce a record for this agent, the
 * `granted` row it just wrote would be exactly the wiring defect MAR-624 found:
 * a decision DASH claims to have acted on and did not, disagreeing with
 * `connection_secrets` and `broker_grants` for as long as the row survives. This
 * is the undo for that path — narrower than `forgetAgentFleetGrants`, which
 * clears every connection, and than `forgetFleetConnection`'s per-provider
 * sweep, because only the one row a caller just wrote should come back out.
 */
export function forgetOneFleetGrant(provider: string, agent: string): void {
  db().prepare("DELETE FROM fleet_grants WHERE provider = ? AND agent = ?").run(provider, agent);
}

function toGrant(row: Record<string, unknown>): FleetGrantRow {
  const standing = String(row["standing"]);
  return {
    provider: String(row["provider"]),
    agent: String(row["agent"]),
    standing: standing === "granted" ? "granted" : "withheld",
    decided_at: String(row["decided_at"]),
  };
}
