# MAR-429 lifecycle evidence — measured, 2026-07-27 to 2026-07-28

**Status: complete.** This file records what has actually been observed, with
pids and paths, so the evidence is not lost between sessions. It feeds
[ADR 0001 Amendment 2](adr/0001-installable-shell.md#amendment-2--the-full-package-lifecycle-measured-mar-429-dash-18a),
now written.

Everything here was captured against the self-signed sideload described in
[msix-test-signing.md](msix-test-signing.md). Per MAR-429's acceptance
correction, a certificate-trust warning before the test certificate is trusted
is expected and is not a failure; Acceptance B (warning-free, Store-signed)
waits on the developer account and is not in scope here.

## The package under test

| | |
| --- | --- |
| Identity | `OrchestrateDASH`, `CN=Alohana Group AB` |
| Versions exercised | `0.1.0.0` (initial install), `0.1.1.0` (update target) |
| Full package names | `OrchestrateDASH_0.1.0.0_x64__sj8xbzq7v8pjy`, `OrchestrateDASH_0.1.1.0_x64__sj8xbzq7v8pjy` |
| Install root | `C:\Program Files\WindowsApps\OrchestrateDASH_<version>_x64__sj8xbzq7v8pjy` |
| Signature | `Get-AuthenticodeSignature` → `Valid`, verified from **both** accounts |
| Trust store | `Cert:\LocalMachine\TrustedPeople` (not Root) |

The signature verifying from `dashtest` as well as `henri` is itself a result:
it confirms the `LocalMachine\TrustedPeople` import is genuinely machine-wide,
which the sideload from a second account depends on.

## Acceptance A — status per criterion

| Criterion | Status | Evidence |
| --- | --- | --- |
| Test MSIX installs and launches | **Met** | Installed and launched on `henri` and on `dashtest`; window renders the placeholder page |
| Trust level declared explicitly and verified **on the built package** | **Met** | `assertOnlyRunFullTrustCapability` parses the staged `AppxManifest.xml` read back from disk during `pnpm run package:msix`; build fails otherwise |
| Contracts resolve inside the immutable install layout | **Met** | See "Contracts resolve inside the install layout" below |
| Runner starts from the packaged layout | **Met** | Fresh spawn on `dashtest`, named pipe, reproduced across three separate launches |
| Closing DASH leaves the runner alive | **Met** | See "Runner survives the window closing" below |
| Reopening adopts the existing runner | **Met** | See "Runner survives the window closing" below |
| Update preserves data, does not orphan a runner | **Met, with a named cost** | See "Update" below |
| Repair leaves a launchable install, no duplicate runner | **Met** | See "Repair" below |
| Uninstall leaves no runner process; documented data behaviour | **Met** | See "Uninstall" below |
| Windows App Certification Kit | **NOT RUN** | Requires elevation; see [msix-test-signing.md](msix-test-signing.md) §7 |
| Evidence from a second local account | **Met** | All rows above captured on `martini\dashtest` |
| MAR-430 cross-principal negative test executed | **Met — first ever execution** | See below |

## AppData virtualization — the redirected path, and why it matters everywhere else

Discovered while investigating why a live, demonstrably-running runner
appeared to have no data directory at all. **A full-trust MSIX app launched
through package activation — i.e. the Start Menu tile, the only path a real
user has — gets its AppData transparently virtualised by Windows.**

Inside the process, `app.getPath("userData")` still returns the ordinary-
looking `C:\Users\dashtest\AppData\Roaming\OrchestrateDASH`. Nothing in DASH's
own code sees anything different, and its log lines say exactly that path.
But every actual read and write against it is silently redirected by the OS
to:

```
C:\Users\dashtest\AppData\Local\Packages\OrchestrateDASH_sj8xbzq7v8pjy\LocalCache\Roaming\OrchestrateDASH
```

`dash.sqlite`, `runner.sqlite`, `runner.key`, `runner.json` and `runner.log`
all live there, verified directly with `Get-ChildItem`. The naive path is
never populated for a package-activated launch — `Test-Path` on it returns
`False` for the entire life of the install, not intermittently.

**This retroactively explains an anomaly this document previously reported as
unexplained "sharing-mode" flakiness**: `runner.log` / `runner.json`
"intermittently invisible to another process", checked with `Test-Path`
across a 23-second poll. That check was almost certainly run against the
naive, unredirected path — which is not intermittently empty, it is always
empty, for the entire run. There was no race and no sharing-mode interaction
to root-cause; the path being checked was simply never the path the data was
at. Recorded here rather than silently dropped, since the earlier entry
asserted things about Node's file-handle semantics that this evidence no
longer supports.

**The install root reported in "Contracts resolve inside the install layout"
below is accurate** — `DASH_CONTRACTS_DIR` points inside
`C:\Program Files\WindowsApps\...`, which is not virtualised (it's the package's
static payload, not its per-user state), so that finding is unaffected. Only
the *data directory* — user state, not install payload — is subject to this
redirection.

This single fact is also why the original Uninstall finding was wrong; see
below.

## Contracts resolve inside the install layout

The single most likely MSIX path failure, and the reason
`electron/resources.ts` exists. On `dashtest`, first launch:

```
[dash-shell] store: C:\Users\dashtest\AppData\Roaming\OrchestrateDASH
[dash-shell] secure store: Windows Credential Manager (DPAPI) os_backed=true
[dash-shell] contracts: C:\Program Files\WindowsApps\OrchestrateDASH_0.1.0.0_x64__sj8xbzq7v8pjy\resources\contracts
[dash-shell] runner: pipe \\.\pipe\orchestratedash-runner-68ad4fcd80963ba431793749 pid=14264
```

The contracts path is inside the install root, not the development tree —
which is what `assertContractsLocation()` would have thrown on. The store
line is what the app itself believes its path is (see the virtualization
section above for why the real bytes land somewhere else), and the vault is
OS-backed.

**The runner's own resolution is proven by construction rather than by reading
its log.** `DASH_CONTRACTS_DIR` is set once in `electron/resources.ts` and
passed to the runner verbatim through `cleanEnvironment()` in
`electron/runner-process.ts`; the runner has no independent resolution path
that could diverge. Since a wrong value crashes DASH at startup and DASH
launched, the value the runner inherited was the correct one. Reconfirmed
directly after the MAR-429 update test: the post-update runner's own log shows
`contracts: C:\Program Files\WindowsApps\OrchestrateDASH_0.1.1.0_x64__...`,
i.e. it re-resolved against the *new* install root rather than the one it
was first spawned against.

## Runner survives the window closing, and is adopted on reopen

Same session, in order:

1. First launch — `pid=14264`, **no** `(adopted)` suffix: a genuine fresh spawn.
2. Second launch — `pid=14264 (adopted)`: the same runner, not a second one.
3. DASH window closed, then `Get-Process OrchestrateDASH` → **exactly one**
   process, `Id 14264`, session 2 (`dashtest`'s session).

That is the ADR 0001 Amendment 1 claim — DASH may come and go, the thing
holding the agents does not — observed end to end in a packaged install.
Reproduced again independently during the update test below (pid 34176
survived a window close, then blocked the update while still detached).

## MAR-430 cross-principal negative test — executed

`runner/README.md` records this as manual and never run, "because CI has one
user". Executed 2026-07-27 from `martini\henri` against the live runner owned
by `martini\dashtest` (pid 14264):

| Attempt | Result |
| --- | --- |
| Enumerate the pipe name | Succeeds — expected and documented; the name's value is that it could not be guessed *beforehand* |
| Connect `InOut` | **Denied** (`Åtkomst till sökvägen nekas`) |
| Connect `Out` (write) | **Denied** |
| Connect `In` (read) | Succeeds — `CanRead=True`, `CanWrite=False` |

This matches `runner/README.md`'s measured DACL exactly: `WD` (Everyone) holds
`FILE_GENERIC_READ` and not `FILE_WRITE_DATA`. A foreign principal may occupy a
pipe instance and may never write to it, and since every byte the runner emits
is a response to a request the peer had to send first, a peer that cannot write
learns nothing and commands nothing. **A different local user can neither read
state nor submit a command.**

`dashtest`'s data directory was also unreachable from `henri`. Stated
precisely: the failures were `ItemNotFoundException`, i.e. the *profile
directory* denies traversal, so this proves `henri` cannot reach `runner.key`
but is **not** a direct measurement of `runner.key`'s own ACL. That ACL is
separately asserted by `runner/channel-secret.ts` via `icacls /save` at mint
time.

(`Get-Acl` on a `\\.\pipe\` path fails with error 87 — a PowerShell limitation,
not a finding. The behavioural test above is the stronger evidence regardless.)

## Update

Baseline before the update: runner pid 34176, fresh spawn, `runner.key` hashed
(`SHA256 F1E720B7...DBD49DA`), `dash.sqlite`/`runner.sqlite` present at their
redirected path.

`package.json`'s version was bumped `0.1.0` → `0.1.1`, repackaged, signed
against the existing test certificate, copied to `dashtest`.

**First attempt failed, with everything running:**

```
Add-AppxPackage : Deployment failed with HRESULT: 0x80073D02
error 0x80073D02: Unable to install because the following apps need to be
closed OrchestrateDASH_0.1.0.0_x64__sj8xbzq7v8pjy.
```

**Second attempt, with only the DASH window closed** (shell + GPU + utility +
renderer processes all gone, runner pid 34176 still alive and detached, per
design) **failed identically.** This isolates the cause precisely: **the
detached runner alone — with no window at all — is sufficient to block an
MSIX update.** Windows requires every process belonging to the package to
exit before it will apply an update; it does not distinguish "the UI" from
"a headless background process the UI intentionally left running." This is a
real, structural tension with ADR 0001 Amendment 1, whose entire premise is
that the runner survives DASH closing — recorded plainly rather than
smoothed over, since it changes what "safe update" can mean in practice.

**Third attempt, with `-ForceApplicationShutdown`, succeeded.** The runner
(pid 34176) was gone immediately afterward with **no shutdown message in
`runner.log`** — the last log line before and after the kill is unchanged,
meaning it was hard-terminated with no grace period, not asked to stop in an
orderly way. The runner has no window, so Windows has no polite
`WM_CLOSE`-equivalent to send it; termination is the only tool available.
Practically: an agent mid-task at update time is cut off exactly as it would
be by a power failure, relying entirely on SQLite's WAL journalling for
safety, not on any shutdown DASH controls.

**What survived, verified after the update:**

| | |
| --- | --- |
| Install root | `OrchestrateDASH_0.1.1.0_x64__sj8xbzq7v8pjy` — a genuine new install, not a no-op |
| `dash.sqlite` | Present, 98304 bytes |
| `runner.sqlite` + WAL/SHM | Present, all three files |
| `runner.key` | **Byte-identical** — `SHA256 F1E720B7...DBD49DA`, same hash as the pre-update baseline |

**After the update, relaunching produced exactly one new runner** (pid 47000,
fresh endpoint, `runner.json` correctly overwritten — no attempt to "adopt"
the dead pid 34176 entry it found on disk), with its own log correctly
re-resolving contracts against the `0.1.1.0` install root. No duplicate, no
orphan.

**Net: the acceptance criterion is met, but only because forcing the runner's
death is the price of applying any update at all.** This is the single most
important thing for ADR 0001 Amendment 2 to state as an accepted cost, not a
resolved concern.

## Repair

Attempted via Settings → Apps → Installed apps → OrchestrateDASH → Advanced
options → Repair, with DASH running (window + runner both up).

Settings itself surfaced the same constraint Update did, but through its own
UI rather than a PowerShell flag: it required the app to be closed first.
Closing the window normally was **not** sufficient — Settings still reported
it as running (the detached, windowless runner, exactly as with Update).
Task Manager's default view showed no visible process for it. The
**Terminate** button in the app's own Settings page (the friendlier,
discoverable equivalent of `-ForceApplicationShutdown`) closed it, and Repair
then completed in a few seconds with no further prompts.

**Verified after repair:**

- Package remained `OrchestrateDASH_0.1.1.0_x64__sj8xbzq7v8pjy` — repair does
  not change version, as expected.
- `runner.key` hash unchanged (`F1E720B7...DBD49DA`).
- `dash.sqlite`, `runner.sqlite` + WAL/SHM all present, same sizes as before
  repair.
- Relaunching produced **exactly one** new runner (pid 45224, fresh spawn), no
  duplicate.

Same underlying cost as Update — the runner had to be killed to proceed — but
Settings' own UI guides a real user through it without needing a hidden CLI
flag, which is the more relevant fact for how an actual user experiences this.

## Uninstall

**Corrects an earlier version of this section**, which concluded uninstall
retains `runner.key`, `dash.sqlite` and `runner.sqlite`. That conclusion was
measured against the naive, unredirected path and is very likely explained by
that earlier session having launched the staged `.exe` directly rather than
through package activation — which gets no AppData virtualization at all, and
so genuinely would leave real files at the naive path afterward. A real user
has no such launch path; the Start Menu tile is the only one that ships. What
follows is measured against that path, on `dashtest`, with the redirection
in the "AppData virtualization" section above already understood.

Unlike Update and Repair, **`Remove-AppxPackage` succeeded immediately with
the runner and the full DASH window both still running — no "close the app
first" error, no need for a force flag.** Immediately afterward:

- `Get-CimInstance Win32_Process -Filter "Name='OrchestrateDASH.exe'"` —
  **empty**. Every process from the package, shell and runner alike, was
  gone. No orphaned runner.
- `Get-AppxPackage OrchestrateDASH` — **empty**. Package genuinely
  deregistered.
- `Test-Path` on
  `C:\Users\dashtest\AppData\Local\Packages\OrchestrateDASH_sj8xbzq7v8pjy` —
  **`False`**. The entire redirected data directory — `dash.sqlite`,
  `runner.sqlite`, `runner.key`, everything — is gone, not merely
  unreachable.

**There is no retention policy left to decide.** A full-trust MSIX app
launched the way a real user launches it gets its entire data directory
wiped automatically on uninstall, as a side effect of `Packages\<PFN>` being
part of the package's own machine registration rather than the app's. Nothing
needed to be built for this; nothing can be built to change it either,
short of disabling package identity's AppData redirection entirely, which is
out of scope here.

**The risk this leaves behind is the opposite of the one first assumed.** It
is not "a stale credential lingers after uninstall" — `runner.key` never
survives to be a concern. It is **silent, total data loss with no warning**:
a user who uninstalls to troubleshoot a bad update, meaning to reinstall a
minute later, loses every agent, connection and approval record, and neither
Windows' uninstall confirmation nor DASH says anything about it — DASH gets
no code-on-uninstall hook to warn from, for the same reason it gets none to
clean up from. Worth stating plainly in Amendment 2 as an accepted
consequence, not a solved one.

## Open anomalies, none blocking

1. **No single-instance lock.** Nothing calls
   `app.requestSingleInstanceLock()`, so DASH can be launched twice against one
   `userData` directory. Two shells then contend for Chromium's disk/GPU cache
   and log `Unable to move the cache: Åtkomst nekad. (0x5)` repeatedly. Not a
   crash — Chromium degrades to no cache. Exclusivity is currently enforced
   only for the *runner*, by the OS pipe lock, and not for the shell. Worth its
   own issue.
2. **The `henri` account's data directory holds accumulated dev-mode history**,
   including pre-MAR-430 `runner.log` entries listening on `http://127.0.0.1:…`
   from before named pipes replaced ports. Repeated
   `Remove-Item -Recurse -Force` did not clear it. This is why `dashtest` is
   the account of record for every row above. (Given the virtualization
   finding above, it is worth someone eventually checking whether that stale
   `henri` data is at the naive path — a non-package-activated leftover — or
   the redirected one; not chased down here since it does not block anything.)

The previous entry #2 in this list — `runner.log`/`runner.json`
"intermittently invisible to another process" — is retracted, not merely
resolved. It is fully explained by the AppData virtualization section above:
the check was against a path that is never populated for a package-activated
launch, not a race or a sharing-mode interaction. There was nothing to
root-cause.

## DPI awareness (MAR-431)

MAR-429's WACK run flagged one required-section warning: `OrchestrateDASH.exe`
not declared DPI-aware. Electron's own embedded manifest only carries the
older `<dpiAware>true/pm</dpiAware>` (2005 schema) declaration; `@electron/packager`
does not add a `dpiAwareness` (2016 schema, `PerMonitorV2`) declaration on its
own.

**Fix**: `build/appx/OrchestrateDASH.exe.manifest` — Electron 43's own embedded
manifest (extracted via `resedit`, the library `@electron/packager` already
depends on, from `node_modules/electron/dist/electron.exe`) with
`<dpiAwareness>PerMonitorV2</dpiAwareness>` added. Wired in through
`win32metadata["application-manifest"]` in `scripts/package-msix.mjs`, which
replaces the exe's `RT_MANIFEST` resource wholesale — not a merge, so the file
has to stand alone as a complete, valid manifest.

**First attempt failed, silently, in a way that turned out informative.**
Adding `<dpiAwareness>` into Electron's existing layout — which splits
`windowsSettings` across two sibling `<asmv3:windowsSettings>` elements,
`disableWindowFiltering` in one, `dpiAware` (and, in this attempt, the new
`dpiAwareness`) in the other — and re-running WACK produced the identical
warning, word for word. That is almost certainly why the *original*,
unmodified manifest failed the check too: a checker that reads "the"
`windowsSettings` element rather than aggregating every sibling with that name
would see only the first block and never find `dpiAware` in the second,
before or after this fix.

**Second attempt**: consolidated into a single `windowsSettings` element,
matching Microsoft's documented example layout, with `dpiAware` and
`dpiAwareness` as direct sibling children. Verified independently at three
levels before re-running WACK:

| Level | Check | Result |
| --- | --- | --- |
| Build | Manifest resource extracted from `build/appx/packager-out/.../OrchestrateDASH.exe` immediately after `pnpm run package:msix` | Single `windowsSettings` block, `dpiAwareness` present |
| Installed | `mt.exe -inputresource` against the sideloaded copy on `dashtest`, at `C:\Program Files\WindowsApps\OrchestrateDASH_0.1.1.0_x64__sj8xbzq7v8pjy\OrchestrateDASH.exe` | Identical structure — the installed binary genuinely carries the fix, not just the build output |
| Runtime | `Shcore.dll!GetProcessDpiAwareness` called against the live, running process on `dashtest` (pid 20840), independent of WACK | Returned `2` — `PROCESS_PER_MONITOR_DPI_AWARE` |

The runtime check is the one that matters most: Windows itself, queried live
through the same OS API surface WACK's own check would use, considers the
process genuinely per-monitor DPI aware. The declaration is real and
effective at runtime, not merely present in a file.

**WACK still reports the identical warning against this same, independently
verified build.** Accepted as a limitation of this specific WACK build, not an
app defect:

- `Kit Version: 10.0.19041.685` — bundled with the 2004/20H1-era Windows 10
  SDK. This machine has no newer SDK installed (`C:\Program Files (x86)\Windows
  Kits\10\bin` tops out at `10.0.19041.0`).
- The exact same wording — "Failed to process the binary ... The app is not
  DPI Aware" — appeared identically across three structurally different
  manifest states: the original (no `dpiAwareness` at all), the split-block
  attempt, and the consolidated attempt independently confirmed DPI-aware at
  the OS API level. The check's output did not track any of the real changes
  made to what is actually in the binary across those three states.
- "Failed to process the binary" reads like a parser fault internal to this
  Kit build against the newer `dpiAwareness` (2016 schema) manifest form,
  rather than a considered "insufficient" judgment — WACK's other, unrelated
  tests (package compliance, signing, capabilities, manifest resources) all
  passed cleanly against the same package throughout.

Decision recorded here rather than chased further: the fix is implemented and
independently verified working; the residual WACK warning is a known,
accepted false positive of this Kit build, not a reason to keep iterating on
the manifest.

## What is left

1. Acceptance B (Store-signed, warning-free install) — waits on Henrik's
   developer account.

ADR 0001 Amendment 2 is written; see the link above.
