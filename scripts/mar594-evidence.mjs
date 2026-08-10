/** Read-only, redacted exit evidence for MAR-594. Run from PowerShell. */

import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const appData = process.env.APPDATA;
if (appData === undefined || appData.length === 0) {
  console.error("FAIL  APPDATA is unavailable; DASH's installed data directory cannot be resolved.");
  process.exit(1);
}

const databasePath = path.join(appData, "orchestratedash", "dash.sqlite");
if (!existsSync(databasePath)) {
  console.error(`FAIL  DASH database does not exist at ${databasePath}`);
  process.exit(1);
}

const database = new DatabaseSync(databasePath, { readOnly: true });
const agent = "dash-google-proof";

const secret = database
  .prepare(
    "SELECT agent, connection_id, field_id, masked_hint, backend, created_at, updated_at " +
      "FROM connection_secrets WHERE agent = ? AND connection_id = 'gmail' AND field_id = 'gmail-account'",
  )
  .get(agent);
const grant = database
  .prepare(
    "SELECT agent, connection_id, field_id, account_hint, operations, granted_at, last_used_at " +
      "FROM broker_grants WHERE agent = ? AND connection_id = 'gmail'",
  )
  .get(agent);
const audit = database
  .prepare(
    "SELECT id, agent, connection_id, operation, decision, refusal, result_count, " +
      "account_hint, decided_at FROM broker_audit WHERE agent = ? AND connection_id = 'gmail' " +
      "AND operation = 'gmail.search' AND decision = 'allowed' ORDER BY id DESC LIMIT 1",
  )
  .get(agent);

database.close();

function printable(row) {
  if (row === undefined) return null;
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, typeof value === "bigint" ? Number(value) : value]),
  );
}

console.log(`MAR-594 exit evidence read at ${new Date().toISOString()}`);
console.log(`database: ${databasePath}`);
console.log(`connection_secrets: ${JSON.stringify(printable(secret))}`);
console.log(`broker_grants: ${JSON.stringify(printable(grant))}`);
console.log(`broker_audit gmail.search: ${JSON.stringify(printable(audit))}`);

if (secret === undefined || grant === undefined || audit === undefined) {
  console.error("FAIL  one or more required MAR-594 rows are missing.");
  process.exit(1);
}

console.log("PASS  MAR-594 has a protected connection reference, a grant receipt, and an allowed gmail.search audit row.");
