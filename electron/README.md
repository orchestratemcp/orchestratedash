# `electron/` — main-process skeleton

Structural slice of the shell decided in [ADR 0001](../docs/adr/0001-installable-shell.md)
(Accepted). It is **not runnable yet**, on purpose.

| File | What it is |
| --- | --- |
| `main.ts` | Window creation, navigation allowlist, one audited IPC channel, actor binding. Wiring only. |
| `preload.ts` | The narrow bridge. One named method per command. No `ipcRenderer`, no channel name, no secrets. |
| `secure-store.ts` | The only file that imports `safeStorage`. Wiring only. |
| `electron-module.d.ts` | **Temporary** ambient types. Delete when `electron` is installed. |

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
[the command channel](../docs/agent-command-channel.md). Note what that means
here: `main.ts` now binds the actor and dispatches seven Agent DOM commands,
**and none of it has ever executed**, because of the three open items below. The
logic is tested without Electron; the wiring in this directory is not tested at
all. No adapter exists either, so an accepted command stops at `noAdapter`.

## Known open items for the packaging phase

1. **No `electron` dependency is installed.** See the header of
   `electron-module.d.ts` for why, and delete that file when it is added.
2. **No build step.** `main.ts`/`preload.ts` are TypeScript and nothing compiles
   them yet; `main.ts` refers to a `preload.js` that no build produces.
3. **`sandbox: true` constrains the preload.** A sandboxed preload cannot use
   arbitrary ESM imports at runtime, so `preload.ts` will need bundling into a
   single file. The security posture is the fixed point here — the build adapts
   to it, not the reverse.
