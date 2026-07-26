# ADR 0001 — Installable shell for DASH

- **Status:** **Accepted** — approved by Henrik, 2026-07-19
- **Date:** 2026-07-19
- **Issue:** MAR-383 (DASH-08) — Local-first installable shell + agent discovery + Connection Center
- **Scope:** This ADR **decides only**. No packaging, shell, vault or OAuth code ships with it.

> Accepting this ADR settles *which* shell DASH targets. It does not schedule the
> build: secret storage, OAuth, the credential UI and packaging remain unstarted
> and are tracked as later phases of MAR-383.
>
> The Tauri rejection stays revisitable on the terms set out below. If the local
> bridge's surface stabilises and stays small, revisit — this decision is not a
> commitment to Chromium forever, and the `SecureStore` seam exists to keep that
> door open.

## Context

DASH today is a Next.js app you run with `pnpm dev`. MAR-383 says that path may
continue to exist for developers, but it is explicitly **not** the core-user
onboarding. The downloadable product is the target.

The first-install journey in MAR-383 requires a shell that can:

1. **Provide a local UI** — the Connection Center and agent workspace.
2. **Store secrets through an OS-backed vault or a replaceable secure-store
   adapter** — Keychain / DPAPI / libsecret, with the adapter seam so the store
   can be swapped without rewriting callers.
3. **Run a local bridge/background service** — the process that talks to agent
   runtimes and survives the UI window being closed.
4. **Receive agent events and send audited commands** — the telemetry v1
   ingest plus the Agent DOM v1 command channel from MAR-382.
5. **Upgrade safely** — signed, verifiable updates that never silently
   invalidate stored credentials.

Two constraints shape the decision more than any technical benchmark:

- **DASH is local-first.** It must not imply hosted execution or a
  multi-tenant vault. Anything that pushes us toward a server is wrong.
- **DASH is not the agent runtime.** The shell hosts a monitor and a control
  surface. It does not execute agents, so raw compute performance of the shell
  is close to irrelevant. What matters is secret custody, event ingest, and
  update integrity.

## Decision

**Adopt Electron** as the installable shell, structured as:

- an Electron **main process** that owns the secure-store adapter and hosts the
  local bridge (HTTP ingest on loopback + the Agent DOM command client);
- a **renderer** that keeps rendering the existing Next.js UI, loaded from a
  local static export or a loopback dev server;
- a thin **`SecureStore` interface** in `lib/` with an Electron `safeStorage`
  implementation behind it, so the OS vault is a replaceable detail.

The existing `pnpm dev` path stays as the developer entry point. The same UI
code serves both; only the host differs.

## Reasoning

**Electron is the smallest architecture that already satisfies all five
requirements without adding anything we would then have to maintain.**

- **UI (1):** the renderer runs the React/Next UI we already have. There is no
  second UI stack, no rewrite, and no divergence between the dev path and the
  installed product — the largest single cost avoided here.
- **Secrets (2):** `safeStorage` binds directly to DPAPI on Windows, Keychain
  on macOS and libsecret on Linux. It is OS-backed on day one, and because we
  put it behind a `SecureStore` interface it stays replaceable. "Smallest
  supported" means the vault requirement is met by the platform, not by us.
- **Bridge (3):** the main process is already a long-lived Node process. A
  background service is a module in it, not a separate installed daemon with
  its own lifecycle, permissions and uninstall story.
- **Events and audited commands (4):** the ingest server and the command client
  both run in main, on the trusted side of the process boundary. The renderer
  reaches them over IPC, so a compromised renderer cannot forge a command
  without crossing an auditable seam — the natural place to enforce and log
  the "audited" part.
- **Upgrades (5):** `electron-updater` with signed artifacts is a well-worn,
  documented path. Updating the app does not touch the OS vault, so credentials
  survive upgrades by construction.

**Node parity is the deciding technical factor.** The bridge must run Ajv
against the same `contracts/*.schema.json` files the tests use, and reuse
`lib/contracts.ts`, `lib/analyze.ts` and `lib/connections.ts` unchanged.
Electron's main process is Node, so this is free. Any shell with a non-Node
backend makes the contract layer a port — and a ported contract validator that
drifts from the schema is precisely the failure DASH exists to catch.

**We are paying Electron's known costs knowingly.** A ~150 MB installer and a
Chromium footprint are real. For a monitor that sits open beside the agents it
watches, on a developer-class workstation, they are acceptable. We are not
shipping to constrained devices, and the shell does no heavy compute.

## Alternatives considered

### Tauri — rejected (for now)

Tauri is the better answer on every axis we are not optimising for: installers
in the single-digit MB, far lower idle memory, a system webview instead of a
bundled Chromium, and a genuinely strong security posture (explicit allowlists,
Rust core).

Rejected because the backend is **Rust, not Node**. Every requirement above is
satisfiable, but the bridge, the ingest server and the schema validation would
have to be either rewritten in Rust or run as a Node sidecar shipped alongside
the Rust core. The first duplicates the contract layer we deliberately keep
single-sourced; the second reintroduces Electron's bundle size while keeping
Tauri's complexity, which is the worst of both.

There is a second, smaller cost: the system webview means the UI renders on
WebKit on macOS, WebView2 on Windows and WebKitGTK on Linux. That is a real
cross-browser test matrix for a one-person project.

**This rejection is explicitly revisitable.** If the bridge's surface stabilises
and stays small, porting it to Rust and moving to Tauri is a clean win on size
and memory. The `SecureStore` interface exists partly to keep that door open —
Tauri's Stronghold/keyring plugins slot in behind the same seam.

### Local service + browser UI — rejected

A background Node service on loopback plus the UI in the user's existing
browser. Smallest possible artifact, and it reuses the Next app as-is.

Rejected on three counts, in order of severity:

1. **No OS vault.** A headless Node service has no `safeStorage` equivalent.
   Secrets would land in an encrypted file whose key must itself live
   somewhere on disk — a key-management problem we would be inventing
   ourselves. This fails requirement 2 outright, and it is the requirement
   with the worst failure mode.
2. **Browser as an attack surface.** A loopback origin is reachable by any page
   in the same browser. Defending the Connection Center against CSRF, DNS
   rebinding and hostile extensions is ongoing work with no natural end, and
   the asset under attack is the user's credentials.
3. **No install story.** "Run this service, then open localhost:xxxx" is the
   terminal-and-`.env` experience MAR-383's acceptance criteria specifically
   rule out. Solving it means shipping a tray app or a service installer —
   at which point we have rebuilt a worse Electron.

### Others noted, not evaluated in depth

- **Native per-platform (Swift/WinUI):** three UIs, no code reuse. Not
  proportionate to a one-person project.
- **PWA:** cannot host a background service or reach an OS vault. Fails 2, 3
  and 4.

## Consequences

**Accepted:**

- ~150 MB installers and Chromium-class idle memory.
- Chromium's CVE cadence becomes our update cadence; we must ship Electron
  security releases promptly rather than pinning.
- Electron's security checklist is now a standing obligation:
  `contextIsolation` on, `nodeIntegration` off, a narrow preload, and no
  remote content in the renderer.

**Gained:**

- One UI codebase across the dev path and the installed product.
- The contract layer stays single-sourced Node — schemas, validators and
  analysis shared verbatim between app, bridge and tests.
- The IPC boundary gives the "audited commands" requirement a natural,
  enforceable chokepoint.

**Deliberately left open:**

- The `SecureStore` interface is specified here as a seam and implemented
  later. Nothing in this ADR commits to a storage format.
- Code signing and notarisation (Apple Developer ID, Windows certificate) are
  a prerequisite for shipping installers and are not yet arranged.
- The Tauri migration path stays live; revisit if the bridge stays small.

## Not decided here

Per MAR-383's phasing, this ADR does not cover secret storage implementation,
OAuth flows, credential input UI, local folder inspection, existing-agent
discovery, or any packaging work. Those need Henrik present.

---

## Amendment 1 — the Agent Runner is a separate process (MAR-415, DASH-11)

- **Status:** Accepted, 2026-07-25
- **Amends:** the Decision, requirement 3 of the Context, and the "Bridge (3)"
  paragraph of the Reasoning.

### What changed

This ADR said the local bridge would be "a module in [the main process], not a
separate installed daemon with its own lifecycle". For ingest and for the
command *client*, that is still true and unchanged.

It is **not** true for hosting agents. DASH now ships an **Agent Runner**: a
separate OS process, inside the same install, started by Electron main and
detached from it. The runner launches agents as its own child processes. DASH
remains a control surface and still never executes an agent itself.

### Why the earlier reasoning does not survive contact with hosting

The "bridge is a module in main" argument was made about a bridge that talks to
agent runtimes. Holding them is a different job, and three consequences follow
that a module in main cannot deliver:

1. **Quitting the UI would kill the fleet.** Agents parented to the Electron
   process die when the window closes. A monitor whose own shutdown takes down
   what it monitors is not a monitor.
2. **An agent holds live provider credentials and executes model-chosen paths.**
   This ADR already isolates the renderer from the command path for exactly that
   reason; in-process agents would discard the isolation one layer further up,
   inside the process that owns the vault.
3. **Remote agents exist regardless.** In-process execution would mean two
   implementations — an in-process path and the HTTP path — and the local one
   would inevitably grow abilities the remote one cannot have.

### What is preserved

- **Node parity, which was the deciding technical factor.** The runner is Node,
  launched via `ELECTRON_RUN_AS_NODE=1`, so it validates against the same
  `contracts/*.schema.json` files with the same `lib/contracts.ts`. No port, no
  second validator, no drift. The one thing that had to change is that
  `lib/contracts.ts` no longer resolves schemas against `process.cwd()`.
- **The audited chokepoint.** Commands still originate in main and still cross
  one IPC boundary. The runner adds a *second* enforcement point rather than
  replacing the first: per the Agent DOM v2 contract it independently validates,
  authorizes, records nonces and rechecks approvals, because the threat model
  assumes a compromised DASH can request any displayed action.
- **The renderer posture.** Untouched. `contextIsolation` on, `nodeIntegration`
  off, `sandbox: true`, narrow preload, no remote content.

### Newly accepted costs

- **DASH leaves a process running after it quits.** Deliberate, and the point:
  it is what "closing the window leaves running agents running" means. It is
  stoppable from the UI via `runner.stop`, and its pid and port are recorded in
  `runner.json` in the data directory.
- **The runner is a new trust boundary to keep honest.** It has its own SQLite
  database, its own audit trail and its own credential, and it must not be
  allowed to become "the part of DASH that happens to run elsewhere".
- **The channel credential must persist.** It lives in the OS vault so a
  restarted DASH can re-adopt a running runner instead of choosing between
  killing the fleet and being unable to talk to it. Where no OS-backed vault
  exists, **no runner is started** — `lib/secure-store.ts` already decided a
  credential never falls back to plaintext, and this is not the place for the
  first exception.

### Still not decided

Agent Kit distribution (`create-dash-agent`), agent auto-registration, adapter
enrollment for *remote* runners, and per-agent resource accounting. See
`runner/README.md` for what the runner does not yet do.
