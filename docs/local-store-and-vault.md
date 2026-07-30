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

## Uninstall

**Measured, MAR-429 (DASH-18a): uninstall performs a full wipe, not
retention.** This corrects an earlier draft of this section, written from a
launch that turned out not to be representative — see below.

A full-trust MSIX app activated the way a real user actually launches it (the
Start Menu tile) runs under **package identity**, and Windows transparently
virtualises its AppData: `app.getPath("userData")` still reports the ordinary-
looking `%APPDATA%\OrchestrateDASH`, but every read and write is silently
redirected to
`%LOCALAPPDATA%\Packages\OrchestrateDASH_<publisherId>\LocalCache\Roaming\OrchestrateDASH`.
The app never sees the redirected path; only the real filesystem underneath it
does. Measured directly: `dash.sqlite`, `runner.sqlite`, `runner.key` and
everything else DASH writes live there, not at the naive path.

That redirected folder belongs to the package's own machine-wide registration,
not to the app. Removing the package — `Remove-AppxPackage`, or Settings →
Uninstall — deletes the whole `Packages\<PackageFamilyName>` tree as part of
deregistering it. Measured directly on `dashtest`: after
`Get-AppxPackage OrchestrateDASH | Remove-AppxPackage`, `Test-Path` on the
package folder returned `False` — `dash.sqlite`, `vault/` (if it existed) and
`runner.key` are gone, not merely unreachable.

**Why the earlier conclusion was wrong.** An earlier session recorded
`runner.key` surviving uninstall at the naive `%APPDATA%\OrchestrateDASH`
path. That is only possible if that session's launch bypassed package
activation — running the staged `.exe` directly rather than through the Start
Menu tile — which gets no AppData redirection at all and writes to the real
path for real. A real user has no such path available; the Start Menu tile is
the only entry point that ships. So the behavior that matters is the
redirected one, and it says the opposite of what was first written down.

**Consequences, now that this is the actual behavior:**

- **No retention policy is needed.** There is nothing to decide, and nothing
  to build — a full wipe is what Windows already does, for free, on every
  uninstall.
- `runner.key` needs no special handling either way: it never survives to be a
  concern.
- **The real risk moved from "stale credential lingers" to "silent data
  loss."** A user who uninstalls DASH to fix a bad update, meaning to
  reinstall it a minute later, loses every agent, connection and approval
  record with no prompt warning them first — Windows' own uninstall
  confirmation says nothing about it, and DASH has no opportunity to say
  anything either, since no app code runs on the way out. That is worth
  knowing before shipping, not a UX gap DASH can currently close: there is no
  hook to show a warning from, the same way there is no hook to run cleanup
  from.

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

## Connecting a credential (MAR-383)

The Connection Center takes credentials as of MAR-383, and the path a value
takes is deliberately short and one-way.

1. The user presses **Connect** on a row. The renderer sends three ids —
   agent, connection, field — through the audited command channel. No value.
2. Main resolves those ids against the agent's **validated manifest**. DASH
   takes a credential only for a connection declared `ownership: "dash_managed"`,
   and only for a field declared either `kind: "secret"` or —  since MAR-446 —
   `kind: "oauth_reauthorization"` for a provider DASH has a sign-in flow for.
   An agent-managed connection, the inferred model-provider row, an OAuth field
   for an unknown provider, and one whose manifest declared no permissions (or
   permissions outside the provider's allowlist) are all refused, each with its
   own sentence.
3. Main opens a **separate modal window** with its own preload
   (`electron/credential-preload.ts`). This is the only bridge in DASH a secret
   crosses. That window renders one page and has no `dashData` or `dashShell`.
4. The value goes from that window to `SecureStore.set`, and a masked hint plus
   the vault key go to `connection_secrets`. The plaintext is never returned to
   either renderer, never logged, and never written to `dash.sqlite`.

**Delivery.** At `runner.start`, main reads the vault for the fields whose
manifest declares `technical.environment_name`, and sends them down the runner's
authenticated socket or pipe for that one spawn. They are merged into the child
environment by `runner/supervisor.ts` and are never written into the
registration file — a registration is plaintext on disk and outlives the
process, which is the opposite of what the vault is for. A name in the `DASH_`
namespace, or one like `PATH` or `NODE_OPTIONS`, is refused when the user
connects rather than at spawn, so the message can explain it.

**Check** reads the vault and drops the value. For a typed secret it answers
whether DASH can still *read* the credential — gone, locked, or present — and
contacts no provider, because DASH holds an opaque string for a service it has
no client for. Whether that provider accepts it is a separate fact, reported by
the agent in its Agent DOM state and rendered through
`describeConnectionCondition`.

For an OAuth connection it does contact the provider, because there the argument
above does not hold: DASH *is* a client and holds a grant in its own name, so a
token refresh is a real question with an unambiguous answer. It is also the only
way a withdrawn grant can surface as `revoked` rather than as a generic failure
(MAR-446). A network failure is deliberately not reported as revocation.

**Disconnect** deletes from the vault first and forgets the row second. The
other order would leave a credential nothing in DASH remembers or can delete.

## What is deliberately not here yet

- **OAuth beyond Google.** MAR-446 added a loopback + PKCE flow, and
  `lib/oauth/providers.ts` lists exactly one provider. An `oauth_reauthorization`
  field for anything else is still refused rather than offered a text box that
  would take a token DASH could never refresh.
- **Long runs.** A delivered OAuth credential is an access token minted at
  spawn, good for about an hour. A run that outlives one sees it expire; a
  DASH-side token endpoint is its own issue.
- **Google verification.** The Gmail scopes are restricted, so the flow works
  today for accounts added as test users on the Cloud project and for nobody
  else.
- **Transcripts.** DASH-15. The schema has a versioned migration list; its
  columns get designed by the issue that owns it, not guessed here.
- **Event retention.** Nothing prunes `events` yet — and, since MAR-417, nothing
  prunes `command_nonces` or `command_results` either.

The command audit arrived in MAR-417 as migration 1: `agent_dom_state`,
`command_nonces`, `command_results` and `command_audit`. See
[the Agent DOM command channel](agent-command-channel.md), including why that
audit table deliberately does *not* foreign-key to `runs`.
