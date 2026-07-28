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

---

## Amendment 2 — the full package lifecycle, measured (MAR-429, DASH-18a)

- **Status:** Accepted, 2026-07-28
- **Amends:** Amendment 1's claim that "DASH may come and go, the thing
  holding the agents does not" — narrowing it to what was actually measured —
  and the uninstall data-retention question Amendment 1 left as "must
  persist".

### What this proves

A self-signed, sideloaded test MSIX was carried through the full package
lifecycle — install, first launch, window close, reopen/adopt, update,
repair, uninstall — on a second local Windows account with no prior DASH
data, plus the MAR-430 cross-principal negative test (first execution ever;
a different local user can neither read runner state nor submit a command)
and a full Windows App Certification Kit pass. Full evidence, with pids,
paths and exact command output, is in
[msix-lifecycle-evidence.md](../msix-lifecycle-evidence.md); this amendment
states the conclusions.

### The central finding: applying an update or a repair requires killing the runner

Amendment 1's premise is that the runner survives DASH closing. That held —
closing the window left the detached runner alive and reachable, reproduced
twice. **It does not extend to updates.** Measured directly: `Add-AppxPackage`
refused to apply `0.1.1.0` over a running `0.1.0.0` install with the DASH
window closed and *only the detached, windowless runner* still alive —
`HRESULT 0x80073D02`, "the following apps need to be closed." Settings'
Repair path hit the identical wall. MSIX requires every process belonging to
a package to exit before it will update or repair that package, and it does
not distinguish "the UI" from "a background process the UI deliberately left
running."

The only way through, in both cases, is a forced kill —
`Add-AppxPackage -ForceApplicationShutdown` from the command line, or the
**Terminate** button Settings itself offers as the discoverable equivalent.
Both are hard stops: `runner.log`'s last line is identical before and after,
meaning the runner was given no chance to log a shutdown, let alone finish an
in-flight run. A real update or repair, today, is indistinguishable from a
power failure from the perspective of an agent that happens to be running at
that moment — safety depends entirely on SQLite's WAL journalling, not on any
orderly stop DASH controls or is even consulted about.

**What does survive, verified byte-for-byte:** `runner.key`'s hash was
identical before and after both Update and Repair. `dash.sqlite` and
`runner.sqlite` (with their WAL/SHM files) survived both intact. Relaunching
after either produced **exactly one** new runner — no duplicate, no attempt
to adopt the dead pid found in a stale `runner.json`, correct contracts
resolution against the new install root. The acceptance criteria for Update
and Repair are met; the cost of meeting them is now named rather than
assumed away.

### AppData virtualization: a packaging fact that changes what "the data directory" means

A full-trust MSIX app launched the way a real user launches it — the Start
Menu tile, package-activated — gets its AppData transparently redirected by
Windows. `app.getPath("userData")` still returns the ordinary-looking
`%APPDATA%\OrchestrateDASH`; the actual bytes live at
`%LOCALAPPDATA%\Packages\<PackageFamilyName>\LocalCache\Roaming\OrchestrateDASH`.
Nothing in DASH's own code can see or change this — it is DASH's identity as
a package, not anything `lib/db.ts` or `electron/secure-store.ts` do, that
puts the data there. This single fact resolved what had looked like a
Node-level file-handle race in the original evidence pass; there was no race.

### Uninstall reverses what Amendment 1 assumed, not merely refines it

Amendment 1 anticipated `runner.key` needing a retention story because it
"must persist" across restarts. An earlier evidence pass concluded exactly
that — uninstall left `runner.key`, `dash.sqlite` and `runner.sqlite` in
place — and a retention policy was drafted on that basis. **That conclusion
was wrong**, measured against a launch that had bypassed package activation.
Measured again against a package-activated install: `Remove-AppxPackage`
deletes the entire `Packages\<PackageFamilyName>` tree, because that tree is
part of the package's own machine registration, not the app's. `runner.key`
does not survive to be a concern; there is no retention policy left to write,
because Windows already performs a full wipe, for free, with no code
required or able to change it.

Uninstall also behaved differently from Update and Repair in one respect
worth recording: `Remove-AppxPackage` succeeded immediately with the full
shell and the runner both still running — no force flag needed — and left no
process behind afterward, shell or runner. Uninstall is the one lifecycle
event that does not require killing anything by hand first.

**The risk this leaves is the opposite of the one anticipated.** Not "a stale
credential lingers" — it never does. It is silent, total loss of every
agent, connection and approval record on uninstall, with no warning from
Windows and none possible from DASH, since no application code runs on the
way out of a full-trust MSIX package. A user uninstalling to fix a bad
update, meaning to reinstall a minute later, loses everything with no
prompt. Accepted as a consequence of the packaging model chosen in the
original Decision above, not solved here.

### Windows App Certification Kit: PASSED WITH WARNINGS

Full required-section pass except one: the packaged `.exe` is not declared
DPI-aware, so Windows treats it as DPI-unaware at the OS level despite
Chromium itself handling scaling correctly. Real, small, fixable — filed as
[MAR-431 (DASH-18c)](https://linear.app/martini-home/issue/MAR-431), not yet
done.

The one failure is in WACK's own "informational only, not used to evaluate
Microsoft Store onboarding" optional section. One hit in it is real and
structural rather than a defect: `OrchestrateDASH.exe` references
`kernel32.dll!CreateProcessW`, which is exactly how the runner spawns agents
— meaning **DASH cannot run on Windows 10 S**, a locked-down SKU that forbids
launching arbitrary executables. This is the same tradeoff Amendment 1 made
knowingly when it gave agents a real child process instead of some sandboxed
alternative, arriving at the door of a different Windows edition rather than
a new one. The remaining hits in that section are byte-substring false
positives inside stock Chromium blobs (`d3dcompiler_47.dll`, `icudtl.dat`,
locale `.pak` files) that a WACK run against any Electron app would also
produce.

### Newly accepted costs

- **An update or repair always kills the runner, with no grace period.** Any
  agent running at that moment stops exactly as it would in a crash. DASH has
  no say in the timing and gets no warning to relay to the user before it
  happens, because the OS decides when Update/Repair may proceed, not DASH.
- **Uninstall is a silent, total data wipe**, not a retention story. No code
  can change this for a full-trust MSIX package, and no warning can precede
  it either.
- **DASH cannot run on Windows 10 S.** A direct consequence of the runner
  spawning real child processes, accepted at the same point Amendment 1
  accepted a real OS process boundary over an in-process alternative.

### Still not decided

- **Acceptance B** — a Store-signed, warning-free install — waits on
  Henrik's developer account (Alohana Group AB, in employment verification as
  of 2026-07-26).
- **MAR-431**, the DPI-awareness manifest fix, is filed and not yet applied.
- Whether DASH's own update-check UX (if one is ever built, separate from
  Store-managed updates) should warn a user about live agents before
  triggering an OS-level update remains open; there is no code to write
  against it yet because no such UX exists.
- MAR-428 (Agent Kit, auto-registration) is unrelated to this amendment and
  was not started here.
