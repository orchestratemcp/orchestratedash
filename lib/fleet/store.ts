/**
 * Reading and writing the two fleet tables (MAR-593, ADR 0013).
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
  connected_at: string;
  updated_at: string;
}

/** What a caller supplies. `connected_at` is the table's to preserve. */
export type FleetConnectionInput = Omit<FleetConnectionRow, "connected_at" | "updated_at">;

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

  // Before the write, so the decisions log records the connection being
  // *made* and not every re-key — `connected_at` surviving the update is the
  // same fact kept for the same reason (ADR 0024 decision 1).
  const isNew = readFleetConnection(input.provider) === null;
  db()
    .prepare(
      "INSERT INTO fleet_connections " +
        "(provider, connector_kind, field_id, secret_name, masked_hint, account_hint, " +
        " scopes, backend, connected_at, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT (provider) DO UPDATE SET " +
        "connector_kind = excluded.connector_kind, field_id = excluded.field_id, " +
        "secret_name = excluded.secret_name, masked_hint = excluded.masked_hint, " +
        "account_hint = excluded.account_hint, scopes = excluded.scopes, " +
        "backend = excluded.backend, updated_at = excluded.updated_at",
    )
    .run(
      input.provider,
      input.connector_kind,
      input.field_id,
      input.secret_name,
      input.masked_hint,
      input.account_hint,
      JSON.stringify(input.scopes),
      input.backend,
      at,
      at,
    );
  if (isNew) {
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
}

export function readFleetConnection(provider: string): FleetConnectionRow | null {
  const row = db()
    .prepare(
      "SELECT provider, connector_kind, field_id, secret_name, masked_hint, account_hint, " +
        " scopes, backend, connected_at, updated_at FROM fleet_connections WHERE provider = ?",
    )
    .get(provider);
  return row === undefined || row === null ? null : toConnection(row as Record<string, unknown>);
}

/** Every fleet connection, oldest first, so the page is stable across reads. */
export function listFleetConnections(): FleetConnectionRow[] {
  return db()
    .prepare(
      "SELECT provider, connector_kind, field_id, secret_name, masked_hint, account_hint, " +
        " scopes, backend, connected_at, updated_at FROM fleet_connections " +
        "ORDER BY connected_at, provider",
    )
    .all()
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
export function forgetFleetConnection(provider: string): void {
  const result = db().prepare("DELETE FROM fleet_connections WHERE provider = ?").run(provider);
  // The grants go unfiled: they are this one decision's cascade, and the
  // withheld rows going with the connection is what the docblock above
  // already argues — one decision, one row (ADR 0024 decision 1).
  db().prepare("DELETE FROM fleet_grants WHERE provider = ?").run(provider);
  if (Number(result.changes) > 0) {
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
}

function toConnection(row: Record<string, unknown>): FleetConnectionRow {
  return {
    provider: String(row["provider"]),
    connector_kind: String(row["connector_kind"]) as ConnectorKindV1,
    field_id: String(row["field_id"]),
    secret_name: String(row["secret_name"]),
    masked_hint: row["masked_hint"] === null ? null : String(row["masked_hint"]),
    account_hint: row["account_hint"] === null ? null : String(row["account_hint"]),
    scopes: parseScopes(row["scopes"]),
    backend: String(row["backend"]),
    connected_at: String(row["connected_at"]),
    updated_at: String(row["updated_at"]),
  };
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
