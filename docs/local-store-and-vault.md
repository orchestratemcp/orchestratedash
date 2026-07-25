# Local store and vault

How DASH keeps state on your machine, what happens when it restarts, and where
credentials actually live.

- **Issue:** MAR-416 (DASH-12)
- **Decided by:** [ADR 0001](adr/0001-installable-shell.md)
- **Seam:** [`lib/secure-store.ts`](../lib/secure-store.ts)

## Two stores, on purpose

| | Holds | Where | Module |
| --- | --- | --- | --- |
| **Store** | Agents, events, runs, connection *references* | `<data dir>/dash.sqlite` | `lib/db.ts`, `lib/store.ts` |
| **Vault** | Credential values, encrypted by the OS | `<data dir>/vault/` | `lib/vault.ts` |

The data directory is `.data/` beside the repo on the `pnpm dev` path, and the
OS per-user application data directory in the packaged app. `DASH_DATA_DIR`
overrides both.

**No secret value is ever written to the store.** Not in plaintext and not
encrypted. The store holds the *name* a credential is filed under and a masked
hint (`••••4f2a`); the value itself only ever exists in the OS vault. The rule
has no carve-out for ciphertext specifically so that it can be checked — and it
is checked, by a test that scans the database bytes for a known value
(`tests/redaction.test.ts`).

## Crash safety

The store this replaced wrote a whole JSON document to a temp file and renamed
it, so a crash could not truncate it. SQLite keeps that property and sharpens
it:

- **WAL journalling** — a crash mid-write leaves a replayable log, never a torn
  database file.
- **`synchronous = FULL`** — a committed write is on disk before it is
  acknowledged.
- **One transaction per operation** — a fifty-event batch now commits atomically
  where it used to be a rewrite of the entire document. Half a batch is not a
  state that can exist.

The vault keeps literal write-then-rename, one file per secret, so a crash
during a credential write cannot damage any other stored credential.

## Restart

Everything survives, and nothing is held in memory that matters:

- The database is reopened and its schema version checked. Migrations already
  applied do not re-run.
- The vault is a directory of files; a new process reads the same files.
- **An upgrade is a restart that also replaces the application.** Both paths sit
  under the per-user data directory and neither contains a version number, so an
  upgrade cannot orphan them. `tests/vault.test.ts` asserts this on the actual
  path rather than trusting it.

## Offline

DASH is a monitor, not a runtime, and nothing on the local path needs the
network:

- The store is a file. Reads and writes work with no connection.
- The vault is the OS's own credential service, reached over a local IPC or
  library call — Keychain, DPAPI and libsecret are all local.
- Ingest is a loopback HTTP endpoint. An agent that cannot reach DASH gets no
  answer and, by the telemetry contract, carries on anyway: monitoring is
  fire-and-forget and an unreachable DASH must never break a run.

What does *not* work offline is anything that talks to a provider — validating a
connection, refreshing an OAuth token. Those report a connection error; they do
not report a missing credential, and they do not clear one.

## Migrating from `dash.json`

On first run, if `<data dir>/dash.json` exists and has not already been
imported, its agents and events are re-validated against the contract schemas
and inserted in a single transaction.

Three properties worth knowing:

1. **The original file is never touched.** Not renamed, not moved, not deleted.
   Downgrading to a build that predates SQLite finds the JSON store exactly
   where it was.
2. **The marker lives in the database.** A marker *file* would be invisible to
   the older build and would outlive deleting the database; a row in
   `store_meta` is scoped to the store that needs to know. Delete
   `dash.sqlite` and the migration simply runs again.
3. **It is all-or-nothing.** A crash part way through leaves either a migrated
   database or an untouched one that retries next launch.

A manifest that no longer passes validation is skipped and recorded by name
rather than dropped silently; `describeLegacyImport()` returns what happened.
This should be unreachable — the JSON store only ever wrote validated
documents — which is exactly why it is recorded rather than assumed.

## The three failures, and what to do about each

The whole reason `SecureStoreErrorCode` has separate members is that they need
separate recoveries. Collapsing any two produces a real bug.

| Code | What happened | Recovery |
| --- | --- | --- |
| `not_found` | Nothing is filed under that name. Ordinary on first run. | Ask the user to connect. |
| `vault_locked` | The vault holds it and the OS will not release it now. | Ask the user to unlock, then retry. **Never** overwrite. |
| `backend_unavailable` | There is no usable vault at all. | Refuse the operation and explain. Never fall back to a file. |
| `invalid_name` | A caller passed something that is not a valid secret name. | A programming error. Surfaced, not normalised away. |

Two of these are easy to get wrong:

**A locked vault must not be reported as `not_found`.** That would prompt the
user for a credential they already gave, and the reconnect would overwrite the
good one. When the evidence is genuinely ambiguous — the entry is intact and
decryption failed — `lib/vault.ts` takes the reading whose wrong answer destroys
nothing, and reports `vault_locked`.

**`isEncryptionAvailable()` returning true is not sufficient.** On Linux with no
keyring service running, it returns `true` and encryption still "works", using a
key compiled into Chromium. DASH checks `getSelectedStorageBackend()` and treats
`basic_text` as no vault at all: `os_backed: false`, and writes are refused.
This is the case ADR 0001 rejected the local-service option over, and reporting
success for it would be worse than the option that was rejected.

## What is deliberately not here yet

- **Credential UI.** DASH-08's Connection Center can now be given a real
  backing; the input flow is its own work.
- **Command audit and transcripts.** DASH-13 and DASH-15. The schema has a
  versioned migration list and a `runs` table to anchor them to; their columns
  get designed by the issues that own them, not guessed here.
- **Event retention.** Nothing prunes `events` yet.
