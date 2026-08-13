/**
 * Durable, secret-free receipts for ADR 0018's attended key placement.
 *
 * A receipt proves one fact only: the enrolled helper accepted an owner-only
 * copy at a time. It does not say the runner can find the file, the agent can
 * use it, or a provider request succeeded. MAR-629 owns those later claims.
 */

import { db } from "../db";

export interface ProviderKeyPlacement {
  host_id: string;
  connection_id: string;
  field_id: string;
}

export interface KeyCustodyReceipt {
  receipt_id: number;
  agent: string;
  host_id: string;
  host_label: string;
  host_address: string;
  host_fingerprint: string;
  connection_id: string;
  field_id: string;
  connection_label: string;
  provider_id: string;
  provider_label: string;
  local_key_version: string;
  installed_at: string;
  owner_only: true;
  /** Whether this receipt names the value currently behind the local key record. */
  current_local_key: boolean;
}

export type NewKeyCustodyReceipt = Omit<
  KeyCustodyReceipt,
  "receipt_id" | "current_local_key"
>;

/** The non-secret version of one local vault reference, or null when it is not held. */
export function localKeyVersion(
  agent: string,
  connectionId: string,
  fieldId: string,
): string | null {
  const row = db()
    .prepare(
      "SELECT updated_at FROM connection_secrets " +
        "WHERE agent = ? AND connection_id = ? AND field_id = ?",
    )
    .get(agent, connectionId, fieldId);
  return row === undefined ? null : String(row["updated_at"]);
}

export function recordKeyCustodyReceipt(receipt: NewKeyCustodyReceipt): void {
  db()
    .prepare(
      "INSERT INTO host_key_custody_receipts " +
        "(agent, host_id, host_label, host_address, host_fingerprint, connection_id, field_id, " +
        "connection_label, provider_id, provider_label, local_key_version, installed_at, owner_only) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
    )
    .run(
      receipt.agent,
      receipt.host_id,
      receipt.host_label,
      receipt.host_address,
      receipt.host_fingerprint,
      receipt.connection_id,
      receipt.field_id,
      receipt.connection_label,
      receipt.provider_id,
      receipt.provider_label,
      receipt.local_key_version,
      receipt.installed_at,
    );
}

/** Current placements for deployment admission. A different key version never matches. */
export function currentProviderKeyPlacements(
  agent: string,
  hostId?: string,
): ProviderKeyPlacement[] {
  const receipts = readLatestKeyCustodyReceipts(agent).filter(
    (receipt) => receipt.current_local_key && (hostId === undefined || receipt.host_id === hostId),
  );
  return receipts.map((receipt) => ({
    host_id: receipt.host_id,
    connection_id: receipt.connection_id,
    field_id: receipt.field_id,
  }));
}

/** Latest physical shadow per host and declared field; older replacements remain as history. */
export function readLatestKeyCustodyReceipts(agent: string): KeyCustodyReceipt[] {
  const rows = db()
    .prepare(
      "SELECT r.receipt_id, r.agent, r.host_id, r.host_label, r.host_address, " +
        "r.host_fingerprint, r.connection_id, r.field_id, r.connection_label, r.provider_id, " +
        "r.provider_label, r.local_key_version, r.installed_at, r.owner_only, " +
        "CASE WHEN s.updated_at = r.local_key_version THEN 1 ELSE 0 END AS current_local_key " +
        "FROM host_key_custody_receipts r " +
        "LEFT JOIN connection_secrets s ON s.agent = r.agent AND s.connection_id = r.connection_id " +
        "AND s.field_id = r.field_id " +
        "WHERE r.agent = ? AND r.receipt_id = (" +
        "SELECT MAX(newer.receipt_id) FROM host_key_custody_receipts newer " +
        "WHERE newer.agent = r.agent AND newer.host_id = r.host_id " +
        "AND newer.connection_id = r.connection_id AND newer.field_id = r.field_id" +
        ") ORDER BY r.installed_at DESC, r.receipt_id DESC",
    )
    .all(agent);
  return rows.map((row) => ({
    receipt_id: Number(row["receipt_id"]),
    agent: String(row["agent"]),
    host_id: String(row["host_id"]),
    host_label: String(row["host_label"]),
    host_address: String(row["host_address"]),
    host_fingerprint: String(row["host_fingerprint"]),
    connection_id: String(row["connection_id"]),
    field_id: String(row["field_id"]),
    connection_label: String(row["connection_label"]),
    provider_id: String(row["provider_id"]),
    provider_label: String(row["provider_label"]),
    local_key_version: String(row["local_key_version"]),
    installed_at: String(row["installed_at"]),
    owner_only: true,
    current_local_key: Number(row["current_local_key"]) === 1,
  }));
}
