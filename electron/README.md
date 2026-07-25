# `electron/` — the main process

The shell decided in [ADR 0001](../docs/adr/0001-installable-shell.md)
(Accepted). It **runs** as of MAR-424 (DASH-14a); before that it was a skeleton
that had never executed.

| File | What it is |
| --- | --- |
| `main.ts` | Window creation, navigation allowlist, one audited IPC channel, actor binding. Wiring only. |
| `preload.ts` | The narrow bridge. One named method per command. No `ipcRenderer`, no channel name, no secrets. |
| `secure-store.ts` | The only file that imports `safeStorage`. Wiring only. |
| `data-dir.ts` | Points the store at `userData`. **Exists for its import position** — see below. |
| `smoke.ts` | The MAR-424 proof harness. Not part of the shipped shell. |
| `smoke-identity.ts` | Gives the harness the app name a real launch would have. |

## Running it

```
pnpm dev          # the renderer, in another terminal
pnpm shell        # build the bundles, then launch
pnpm shell:smoke  # build, then run the three proofs and exit non-zero on failure
```

`pnpm build:shell` produces three bundles in `dist/electron/` via esbuild, and
the formats are not uniform on purpose:

| Output | Format | Why |
| --- | --- | --- |
| `main.mjs` | ESM | No sandbox constraint. Real `import.meta.url`, which is how the preload path resolves correctly on Windows. |
| `preload.js` | **CJS, self-contained** | `sandbox: true` forbids ESM and runtime imports in a preload. |
| `smoke.mjs` | ESM | Proof harness. Never on the `electron .` path. |

The preload bundle is 2.8 kB and contains no Node built-ins — `lib/shell/ipc.ts`
is its only non-`electron` import and every import *that* file has is
`import type`, so all of it erases. The security posture is the fixed point and
the build adapts to it; nothing here wants `sandbox` relaxed.

## Three traps that only a real launch finds

Recorded because each one was invisible to a test suite, and the next person
writing shell code will meet at least one of them.

1. **`await app.whenReady()` at the top level of an ESM main deadlocks.**
   Electron dispatches `ready` only after the entry module finishes evaluating,
   so a module awaiting it is waiting for an event that cannot fire until it
   stops waiting. There is no error and no output — it just hangs. `main.ts`'s
   `void app.whenReady().then(...)` is load-bearing, not stylistic.
2. **The store's location is decided by import order.** `lib/db.ts` resolves
   `dataDir` at module-evaluation time, and `main.ts` imports the Agent DOM
   runner, which imports `lib/db.ts`. So the old `useUserDataDirectory()` call
   inside `whenReady` was not merely late — it was unreachable in time. The fix
   is `import "./data-dir"` as the *first* import in `main.ts`, which ES module
   evaluation order guarantees runs first, plus `assertStoreLocation()` at
   startup so a re-ordered import list fails loudly instead of silently writing
   the user's data beside the source tree.
3. **`app.getPath("userData")` depends on the app name, which depends on how you
   launched.** `electron .` reads the root package.json and gets
   `.../Roaming/orchestratedash`; launching a file directly gets
   `.../Roaming/Electron`. A proof harness that does not account for this passes
   every assertion about a directory the installed app never opens.

## What `pnpm shell:smoke` writes

It seeds the synthetic Gmail example manifest and a state snapshot into the
**real** user-data store, because MAR-424's acceptance criterion is about the
real directory and a temp one would prove nothing. It does not clean up: the
agent is named `synthetic-gmail-meeting-assistant` so it is identifiable, and
leaving the rows behind is what makes the audit trail inspectable afterwards.

The example snapshot's own deadlines are fixed dates in July 2026 and have since
passed, so the harness moves them forward before storing. Without that, the
`approve` is refused at `approval_expired` — a real rejection, and the wrong one
to be proving.

The rules live in pure, unit-tested modules, not here:

- `lib/shell/window.ts` — renderer security posture + the local-only URL allowlist
- `lib/shell/ipc.ts` — command allowlist, review, audit records
- `lib/secure-store.ts` — the `SecureStore` seam (interface only)
- `lib/vault.ts` — the `safeStorage` implementation behind that seam, over an
  injected port so it is testable without launching Electron

`electron/secure-store.ts` lives here rather than in `lib/` on purpose: a
credential store that renderer code can reach by following an import is what
`contextIsolation` and the narrow preload exist to prevent, and placement makes
that a property of the tree rather than a convention. Nothing under `app/` may
import it, and `tests/redaction.test.ts` enforces that.

## Not in this slice

No OAuth, no credential UI, no secret of any kind through IPC, no local bridge
or ingest server, no packaging, no electron-builder, no code signing. See
ADR 0001 → "Not decided here".

Secret *storage* is now implemented (MAR-416) — see
[local store and vault](../docs/local-store-and-vault.md).

The Agent DOM command channel is implemented (MAR-417) — see
[the command channel](../docs/agent-command-channel.md). As of MAR-424 it has
executed: a real renderer's `approve` passes enforcement, reaches `noAdapter`,
and both the authorisation and the refusal are in `command_audit` on disk. No
adapter exists yet, so that is where every accepted command still stops. The
bundled runner is MAR-415 (DASH-11).

## Known open items for the packaging phase

MAR-424 closed the three that blocked the shell from running at all. What is
left is genuinely packaging work:

1. **`lib/contracts.ts` finds its schemas relative to `process.cwd()`.** That
   holds for `pnpm shell` and `pnpm dev`, both of which run from the repo root,
   and it breaks outright in a packaged app where the working directory is
   arbitrary. Deliberately not worked around here — a bundling trick would have
   hidden it from the phase that has to solve it properly.
2. **No electron-builder, signing, notarisation or auto-update.** Out of scope
   for MAR-424 by its own terms. ADR 0001 records that signing certificates are
   not yet arranged.
3. **CI cannot run the shell.** `ELECTRON_SKIP_BINARY_DOWNLOAD=1` keeps the
   ~138 MB platform zip out of CI, which means the proofs are a local
   `pnpm shell:smoke` rather than a job. Worth revisiting if the shell grows
   logic that unit tests cannot reach.
