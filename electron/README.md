# `electron/` — main-process skeleton

Structural slice of the shell decided in [ADR 0001](../docs/adr/0001-installable-shell.md)
(Accepted). It is **not runnable yet**, on purpose.

| File | What it is |
| --- | --- |
| `main.ts` | Window creation, navigation allowlist, one audited IPC channel. Wiring only. |
| `preload.ts` | The narrow bridge. Exposes one command, `ping`. No `ipcRenderer`, no channel name, no secrets. |
| `electron-module.d.ts` | **Temporary** ambient types. Delete when `electron` is installed. |

The rules live in pure, unit-tested modules, not here:

- `lib/shell/window.ts` — renderer security posture + the local-only URL allowlist
- `lib/shell/ipc.ts` — command allowlist, review, audit records
- `lib/secure-store.ts` — the `SecureStore` seam (interface only; **no implementation**)

## Not in this slice

No `safeStorage`/keychain implementation, no OAuth, no credential UI, no secret
of any kind through IPC, no local bridge or ingest server, no packaging, no
electron-builder, no code signing. See ADR 0001 → "Not decided here".

## Known open items for the packaging phase

1. **No `electron` dependency is installed.** See the header of
   `electron-module.d.ts` for why, and delete that file when it is added.
2. **No build step.** `main.ts`/`preload.ts` are TypeScript and nothing compiles
   them yet; `main.ts` refers to a `preload.js` that no build produces.
3. **`sandbox: true` constrains the preload.** A sandboxed preload cannot use
   arbitrary ESM imports at runtime, so `preload.ts` will need bundling into a
   single file. The security posture is the fixed point here — the build adapts
   to it, not the reverse.
