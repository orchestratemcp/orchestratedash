/**
 * Where a credential is, never what it is.
 *
 * A connection needs two things recorded: the vault key its secret lives under,
 * and enough of a hint that a user can tell "the key ending 4f2a" from "the
 * other one". Neither is the secret. This module is the only writer of the
 * `connection_secrets` table, so the rule has one place to be enforced instead
 * of being re-argued at every call site.
 *
 * The enforcement is structural rather than advisory:
 *
 * - `secret_name` goes through the seam's own name validation, which a pasted
 *   credential cannot pass — real secrets contain characters it rejects.
 * - `masked_hint` is accepted only in masked form, checked against the shape
 *   `maskSecret` produces. A caller who passes the raw value gets an error, not
 *   a row. This is the point of taking a hint rather than a value: no function
 *   in this file ever receives a secret to mask, so none can leak one.
 */

import { db } from "./db";
import { assertValidSecretName } from "./secure-store";

/** Enough characters to disambiguate, few enough to be useless on their own. */
const REVEALED = 4;
const MASK = "••••";

/**
 * Turn a secret into a display hint.
 *
 * Called at the point the user types the value — in the main process, next to
 * the vault write — and never afterwards. The result is what gets stored.
 *
 * Short values reveal nothing at all: four trailing characters of a six
 * character value is most of it, and "we only show the last four" stops being
 * true at exactly the point it starts mattering.
 */
export function maskSecret(secret: string): string {
  return secret.length >= REVEALED * 2 ? `${MASK}${secret.slice(-REVEALED)}` : MASK;
}

/**
 * Does this look like something `maskSecret` produced?
 *
 * The gate on the way into the database. A raw credential cannot satisfy it:
 * it would have to begin with four bullet characters and be at most eight
 * characters long.
 */
export function isMaskedHint(hint: string): boolean {
  return new RegExp(`^${MASK}.{0,${REVEALED}}$`, "u").test(hint);
}

export interface SecretReference {
  /** Null when the connection belongs to DASH itself rather than to an agent. */
  agent: string | null;
  connection_id: string;
  field_id: string;
  /** The key into the OS vault. A name, not a value. */
  secret_name: string;
  masked_hint: string | null;
  /** Which backing held it when it was stored. */
  backend: string;
}

/**
 * Record — or update — where a connection's secret lives.
 *
 * Note what this function cannot do: it has no access to the vault and never
 * receives a secret value, so recording a reference and storing a credential
 * are two separate calls with two separate failure modes. That is deliberate.
 * A combined "store and record" helper would have to hold the plaintext and a
 * database handle at the same time, which is the exact adjacency worth not
 * having.
 */
export function recordSecretReference(reference: SecretReference): void {
  assertValidSecretName(reference.secret_name);

  if (reference.masked_hint !== null && !isMaskedHint(reference.masked_hint)) {
    // Not echoed into the message: if a caller passed the raw secret, saying so
    // with the value attached would put it in a log — the failure this check
    // exists to prevent.
    throw new Error(
      "masked_hint must be produced by maskSecret(). The store never accepts a raw value.",
    );
  }

  const now = new Date().toISOString();
  db()
    .prepare(
      "INSERT INTO connection_secrets " +
        "(agent, connection_id, field_id, secret_name, masked_hint, backend, created_at, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT (agent, connection_id, field_id) DO UPDATE SET " +
        "secret_name = excluded.secret_name, masked_hint = excluded.masked_hint, " +
        "backend = excluded.backend, updated_at = excluded.updated_at",
    )
    .run(
      reference.agent,
      reference.connection_id,
      reference.field_id,
      reference.secret_name,
      reference.masked_hint,
      reference.backend,
      now,
      now,
    );
}

/**
 * References for one agent, or for DASH itself when `agent` is null.
 *
 * Safe to render and safe to log in full — by construction there is nothing in
 * a row that a secret value could have reached.
 */
export function listSecretReferences(agent: string | null): SecretReference[] {
  return db()
    .prepare(
      "SELECT agent, connection_id, field_id, secret_name, masked_hint, backend " +
        "FROM connection_secrets WHERE agent IS ? ORDER BY connection_id, field_id",
    )
    .all(agent)
    .map((row) => ({
      agent: row["agent"] === null ? null : String(row["agent"]),
      connection_id: String(row["connection_id"]),
      field_id: String(row["field_id"]),
      secret_name: String(row["secret_name"]),
      masked_hint: row["masked_hint"] === null ? null : String(row["masked_hint"]),
      backend: String(row["backend"]),
    }));
}

/**
 * Drop a reference.
 *
 * Deleting the row does not delete the credential — the caller must also call
 * `SecureStore.delete`, and the two are separate for the same reason as above.
 * Returns whether a row was actually removed so a disconnect flow can tell "I
 * forgot it" from "there was nothing to forget".
 */
export function forgetSecretReference(
  agent: string | null,
  connectionId: string,
  fieldId: string,
): boolean {
  const result = db()
    .prepare(
      "DELETE FROM connection_secrets WHERE agent IS ? AND connection_id = ? AND field_id = ?",
    )
    .run(agent, connectionId, fieldId);
  return Number(result.changes) > 0;
}
