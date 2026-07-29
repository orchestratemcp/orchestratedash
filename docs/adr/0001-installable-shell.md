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

---

## Amendment 3 — DASH accepts an instruction from outside itself (MAR-428, DASH-11b)

- **Status:** Accepted, 2026-07-28
- **Amends:** the Decision's renderer/main/`SecureStore` structure by adding a
  third way in, and Amendment 1's "Still not decided" list, which named Agent
  Kit distribution and agent auto-registration.

### What changed

Until now every instruction DASH acted on originated inside DASH: a click in
the renderer, crossing one IPC boundary into main. The URL allowlist and the
narrow preload were sufficient because there was no other door.

MAR-428 adds one. DASH registers the `dash://` scheme and accepts a handoff
link from the operating system — from a terminal the user is looking at, and
therefore also, in principle, from any web page they visit. That is a new
entry surface into the process that owns the vault and the command channel, and
it is worth stating plainly rather than filing under "a feature".

### Why the existing posture does not cover it

`contextIsolation`, `sandbox` and the preload allowlist defend the *renderer*.
A deep link does not go through the renderer. It arrives in main, as a string,
from an untrusted source, and what it is asking for is that DASH hand its
runner a command line to spawn — the single most consequential thing DASH can
be asked to do.

So the answer is not a wider allowlist. It is three properties, in
`lib/handoff.ts` and `lib/handoff-flow.ts`:

1. **The URL cannot carry a command line.** It names a file and nothing else.
   A URL is attacker-authored by construction; a file at an absolute path
   requires the ability to write to that user's disk.
2. **The link must prove the opener read that file.** A single-use nonce, held
   inside the handoff, compared in constant time. This is what a page that
   guessed a project path cannot produce.
3. **The user decides, every time, in a native modal.** The handoff originates
   outside the renderer and may be what starts DASH, before a page exists. The
   gate therefore cannot depend on the renderer loading correctly. A native
   modal is also unspoofable by page content and cannot be replaced, suppressed
   or approved by a compromised renderer. Amendment 5 records why this remains
   true now that the packaged renderer is the real UI rather than a placeholder.

The first two narrow *who may ask*. The third decides *whether it happens*.
Neither substitutes for the other.

### What is preserved

- **The audited chokepoint.** Removing an agent is a `runner.*` command and
  goes through `lib/shell/ipc.ts` like everything else. Adding one does not:
  it originates outside the renderer, so it has its own record — the
  `agent_handoffs` ledger — which records refusals as well as successes,
  because "nothing happened when I clicked that" is the question a user
  actually asks.
- **The renderer posture.** Untouched. Nothing about this reaches the renderer.
- **The runner as a separate trust domain.** The reload route re-reads the
  registration directory itself and ignores its request body, so DASH still
  chooses *which* registration the runner acts on and never *what* it runs.

### Newly accepted costs

- **DASH is now reachable from a link.** Every consequence of that is bounded
  by the three properties above, and by the fact that the most a valid,
  unexpired, correctly-nonced link can achieve without the user is a dialog.
- **A second registration writer.** The registration directory used to have
  exactly one author — a human with an editor. It now has two, so ownership is
  recorded in the file itself and DASH refuses to delete a registration it did
  not create.
- **One more thing that must be true in the packaged manifest.** A package
  whose `windows.protocol` extension is missing installs, runs and hosts agents
  perfectly, and "Open in DASH" silently does nothing.
  `assertDeclaresHandoffProtocol` turns that into a failed build.

### Still not decided

- **Publishing `create-dash-agent`.** The package is `private: true`. Choosing
  a registry name is Henrik's, not this issue's.
- **Whether the DASH UI should offer removal.** The command exists and is
  audited; the button belongs with MAR-423's UX pass.
- **The packaged deep link has not been exercised on a real install.**
  Sideloading touches the certificate store and is Henrik's step.

---

## Amendment 4 — DASH's own binary is an interpreter it can offer (MAR-423, DASH-19)

- **Status:** Accepted, 2026-07-29
- **Amends:** Amendment 1's account of what the runner spawns, by adding one
  name that is not a program.

### What changed

The runner spawns whatever a registration's `command` names. It now recognises
exactly one name that is not a program on the machine — `dash:node` — and
resolves it, at the moment of spawning, to its own `process.execPath` with
`ELECTRON_RUN_AS_NODE=1`.

That pair is not new. Amendment 1 already launches the runner itself that way,
because the Electron binary *is* Node when asked. What is new is offering it to
an agent.

### Why a novice-first onboarding forced the question

MAR-423's outcome is that first run ends in a success rather than a setup. The
Agent Kit registers agents with `command: "node"`, resolved against `PATH`, which
is right for somebody who typed `npx create-dash-agent` — they demonstrably have
Node. It is fatal for someone who installed DASH from the Store and has never
installed anything else: the spawn fails, and first run ends in "the agent is
saved, but it did not start."

### Why a sentinel rather than a path

Because a registration outlives the process that wrote it, and the path does not.
Amendment 2 measured the MSIX install root as version-stamped —
`WindowsApps\OrchestrateDASH_0.1.0.0_x64__…` became `…_0.1.1.0_…` across the
update. A registration holding a real `execPath` is a registration that stops
working at the first update, which is the same failure
`agent-kit/open-in-dash.ts` avoids by refusing to pin to a Node install,
arriving by a different door.

A sentinel is resolved by the process doing the spawning, against its own
`execPath`. Nothing version-stamped is ever written down.

### What it does not grant

Nothing. A registration may already name any command on the machine; this names
strictly one, and it is DASH's own binary rather than anything on disk. The
decision about whether an agent is registered at all is still consent, taken
before any of this is written, in a native modal, per Amendment 3.

The resolution is applied **after** the registration's own environment block, so
a registration cannot ask for DASH's interpreter and then unset the variable that
makes it one — which would spawn the shell itself, windows and all, with an
agent's script as its argument. That ordering is a test, not a comment.

### Newly accepted costs

- **DASH's binary now appears in a process tree as an agent's interpreter.** A
  user looking at Task Manager sees a second `OrchestrateDASH.exe` that is not a
  window. This was already true of the runner; it is now true once more per
  sample agent.
- **Two ways to spawn an agent's interpreter**, and the Agent Kit deliberately
  keeps using the other one. A project that only ran inside DASH is not what the
  Kit is for, and an agent author who has Node should be registered against it.

### Still not decided

- Whether an agent registered against `dash:node` should be pinned to the
  Node version a given DASH ships, or told which one it got. Nothing consumes
  that today.
- Whether the Agent Kit should ever emit the sentinel. It should not until
  there is a reason, and there is not one yet.

---

## Amendment 5 — the packaged renderer is the DASH UI (MAR-432, DASH-20)

- **Status:** Accepted, 2026-07-29
- **Amends:** the Decision's promise of one UI over a static export or a
  loopback development server; the renderer/main structure by adding a
  read-only data channel; and Amendment 3's placeholder-based explanation for
  keeping handoff consent native.

### What changed

The installed app no longer loads a packaging-proof page. It loads the same
agents, runs, run detail and Connection Center renderer as `pnpm dev`, built as
a Next static export and served from inside the install.

The pages no longer read SQLite directly. They render documents from one small
data source chosen at runtime:

- inside the shell, four named methods on `window.dashData` cross the
  `dash:shell-read` channel into main;
- in a browser tab, four development-only GET routes return the same documents;
- both sides call the same projections in `lib/views/build.ts`, so transport
  cannot acquire a second definition of what a page sees.

The existing `window.dashShell` command bridge is unchanged. Reads do not widen
`CommandResult.data`, do not share its channel and cannot name one of its
commands.

### Why reads are a second preload surface

`CommandResult.data` is deliberately restricted to
`Record<string, string | number | boolean>`. That restriction makes "no secret
crosses this command boundary" reviewable as a type. An agents list, a run with
its events or a connection checklist is a document; allowing documents through
the command result would turn the restriction into a convention and create
exactly the place a token, environment block or masked secret could hide.

The read surface therefore has its own complete vocabulary:
`agents()`, `runs()`, `run(agent, runId)` and `connections()`. The preload
exposes no generic `invoke`, no channel name and no method that accepts an
arbitrary object. `lib/shell/read.ts` owns the allowlist, parameter review and
result type for every read. No entry reaches the vault, `connection_secrets`,
the runner command channel or anything that is not content the corresponding
page is permitted to display.

### Why the command audit trail does not record reads

The command ledger records **effects**. Its `mutates` and `irreversible` fields
exist so a person can reconstruct what changed and which consequential action
was approved. A read changes nothing and leaves no effect to reconstruct.

Recording renderer reads would also make that ledger less useful. A renderer
refreshes state continuously; a log containing thousands of "the agents list
was rendered" records around a handful of irreversible commands buries the
events the ledger exists to surface.

Nor would a read record prevent the threat it might appear to answer. A
compromised renderer already owns the window and can ask for every document
that window is allowed to show. The defence must be limiting that vocabulary,
not recording after the fact that it was used. The residual is accepted and
named: a compromised renderer can enumerate agents, runs and connection
requirements without leaving an audit record. It cannot read a credential or
expand that enumeration into a generic store query.

### Why the static export uses `dash-app://ui/`

Loading a Next export from `file:` does not work beyond a proof page. Next emits
absolute asset paths such as `/_next/static/…` and absolute client navigation
such as `/runs`; under `file:` those resolve against the drive root. A relative
asset prefix fixes one directory depth while DASH has several.

A loopback server would work technically and is rejected architecturally. It
would re-open a listening TCP port after MAR-430 removed the last one, and it
would recreate the browser-reachable origin this ADR rejected under "Local
service + browser UI".

The package instead registers a distinct standard, secure scheme,
`dash-app://`, and pins its only accepted authority to `ui`. It is deliberately
not the `dash://` handoff scheme: one is a renderer origin whose bytes come from
the install; the other is an operating-system entry point carrying
attacker-authored input.

The handler is GET-only, resolves every candidate inside one renderer directory,
ignores the query string when choosing a file, refuses unknown file types and
sets content types from a fixed allowlist. It does not bypass CSP and is not
CORS-enabled. Scheme privileges are registered before `app.ready`; the handler
itself is installed after readiness. `lib/shell/renderer-scheme.ts` holds these
rules as pure, unit-tested decisions rather than leaving path traversal and
origin checks inside Electron wiring.

### Why the export is conditional

The development build still owns two contracts that require a Next server:
`POST /api/agents` for manifest import and the frozen telemetry v1
`POST /api/events` ingest used by agents and `pnpm demo:violation`. Making
`output: "export"` unconditional would remove both.

Next also rejects a static export merely because a dynamic route handler is
present; a runtime guard cannot opt it out. Route handlers are therefore named
`route.dev.ts`, and `next.config.mjs` recognises the `dev.ts` extension only in
the normal build. `pnpm build` retains every route. `pnpm build:renderer`
recognises only the pages and produces `out/`, which the shell build stages
under `dist/electron/renderer/`. Packaging builds that export first and refuses
to stage a window without an entry page.

An arbitrary run id cannot have a meaningful `generateStaticParams`. Run detail
therefore moved from `/runs/[agent]/[run_id]` to the static document
`/runs/detail`, with `agent` and `run` in its query string for the client data
source to read.

### The developer path is preserved, with its cost stated

This is one renderer over two transports, not two renderers. The browser path
keeps manifest import, telemetry ingest and every read page. It also keeps the
same projection and failure vocabulary as the shell.

It is not identical:

- every page now renders a loading state before its data arrives. IPC makes that
  interval small in the installed app; the browser path has lost the complete
  server-rendered first response it had before;
- a browser tab has no command bridge and is read-only by construction. It says
  which window the user is in and that starting, answering and removing happen
  in the DASH app rather than presenting dead controls;
- manifest import points the other way: it remains a development route, so the
  installed page explains that the import form is available only when DASH is
  run from its source folder.

These are host capabilities, not rendering branches. A page does not decide to
show different data because of its origin.

### Why the handoff consent remains native

Amendment 3 reached the right conclusion partly from a premise this amendment
removes: at that time a consent question implemented only in React would not
have existed in the package at all.

The conclusion survives for stronger reasons. A `dash://` handoff originates
outside the renderer, can be the event that starts the process and can arrive
before a page or window is ready. Its approval gate must therefore exist even
when the renderer is slow or broken. Keeping it native also means page content
cannot imitate it and a compromised renderer cannot suppress, replace or
approve it. The safe default remains "no".

The sample-agent menu item also remains, but no longer because a page button is
impossible. It is an app-wide entrance to a main-owned operation and is
reachable while a page loads. MAR-423's remaining page work may add another
entrance to the same operation; it does not need a second implementation.

### What is preserved

- **One UI codebase.** The installed and development paths render the same
  components over the same view documents.
- **The renderer posture.** `contextIsolation` remains on, `nodeIntegration`
  off, `sandbox: true`, no remote content, no generic preload method.
- **The audited command chokepoint.** No command, approval or effect moved to
  the read channel, and its primitive-only result type did not change.
- **No listening TCP port in the installed app.** The scheme handler serves
  files inside main and is not addressable by another process or browser.

### Newly accepted costs

- A second, separately reviewed renderer/main IPC surface: the read-only
  document channel.
- A custom renderer scheme whose registration order, path containment and
  content-type allowlist are now security obligations.
- Client-side loading on both hosts, including the loss of server-rendered page
  data on the development path.
- A deliberately read-only browser window and an unaudited, bounded ability for
  a compromised renderer to enumerate the data already visible in that window.

### Still not decided

- The empty-state teaching, Connection Center recovery UI, calm/density toggle
  and `runner.remove` button remain MAR-423 page work on top of this conversion.
- The runner-hosted telemetry gap is decided in Amendment 6.
- The renderer has been exercised through its real `dash-app://ui/` origin
  without packaging. Verifying it inside a sideloaded MSIX still belongs to
  Henrik because installation and certificate-store changes are human-gated.

## Amendment 6 — hosted telemetry rides the runner pipe (MAR-433, DASH-21)

**Status:** Accepted, 2026-07-29.

### What changed

A runner-hosted agent now emits a `{ "type": "telemetry", "event": … }`
message on the newline-delimited JSON stdout channel it already uses for Agent
DOM state and command acknowledgements. The supervisor holds a bounded
in-memory batch. Electron main drains that batch over the runner's existing
authenticated Unix socket or Windows named pipe during the existing five-second
poll, then calls `ingestEvents`.

`ingestEvents` remains the canonical telemetry v1 boundary. It validates each
candidate independently, accepts valid neighbours when one is malformed, and,
for hosted delivery, additionally binds `event.agent` to the supervisor identity
of the child that emitted it. Rejections are recorded in the shell log without
logging event values. The agent's `runs/events.jsonl` remains the primary record;
delivery to DASH remains fire-and-forget.

### Why the environment-variable route is rejected

Adding `DASH_INGEST_URL` to the supervisor's inherited environment would share a
DASH endpoint with every hosted child and would require a listening port for
that URL to name. Both costs are unnecessary because the runner already owns
the child's pipes and DASH already polls the runner.

Adding a `DASH_INGEST_URL` exception to `secretsInEnvironment` is also rejected.
The guard's value is that a handoff cannot smuggle any DASH-owned setting into a
registration; an exception would weaken the secret handoff boundary to recreate
a transport the existing runner channel already supplies.

### What is preserved

- No new TCP listener. Hosted telemetry uses the owner-restricted runner
  endpoint and its existing bearer authentication.
- No `DASH_*` variable or ingest credential enters a child environment.
  `assertNoRunnerSecrets` and `secretsInEnvironment` are unchanged.
- The frozen telemetry v1 schema is unchanged. Remote agents retain
  `POST /api/events` and its optional bearer token.
- Owner-only IPC, Windows named-pipe depth, Agent DOM schema validation and both
  command audit chokepoints are unchanged. Telemetry drain is not a command and
  cannot submit an effect.

### Newly accepted costs

- The detached runner holds up to a bounded four-megabyte telemetry batch in
  memory between polls. Candidates beyond the bound are dropped and counted;
  the agent's JSONL history remains authoritative.
- A successful drain removes the in-memory batch before SQLite ingest finishes.
  That delivery is intentionally best-effort rather than a durable queue; a
  future replay feature must read the agent-owned JSONL rather than silently
  turning the runner into a second telemetry store.

### Still not decided

- Installed-MSIX verification remains human-gated because it requires package
  signing, certificate installation and sideloading. The local named-pipe path
  is covered by the same runner and Electron polling integration used by the
  package.
