# MAR-429 lifecycle evidence — measured, 2026-07-27

**Status: incomplete.** This file records what has actually been observed, with
pids and paths, so the evidence is not lost between sessions. Untested rows say
so. It feeds ADR 0001 Amendment 2, which should not be written until the gaps
below are closed.

Everything here was captured against the self-signed sideload described in
[msix-test-signing.md](msix-test-signing.md). Per MAR-429's acceptance
correction, a certificate-trust warning before the test certificate is trusted
is expected and is not a failure; Acceptance B (warning-free, Store-signed)
waits on the developer account and is not in scope here.

## The package under test

| | |
| --- | --- |
| Identity | `OrchestrateDASH`, `CN=Alohana Group AB`, `0.1.0.0` |
| Full package name | `OrchestrateDASH_0.1.0.0_x64__sj8xbzq7v8pjy` |
| Install root | `C:\Program Files\WindowsApps\OrchestrateDASH_0.1.0.0_x64__sj8xbzq7v8pjy` |
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
| Contracts resolve inside the immutable install layout | **Met** | See below |
| Runner starts from the packaged layout | **Met** | Fresh spawn on `dashtest`, pid 14264, named pipe |
| Closing DASH leaves the runner alive | **Met** | See below |
| Reopening adopts the existing runner | **Met** | See below |
| Update preserves data, does not orphan a runner | **NOT TESTED** | — |
| Repair leaves a launchable install, no duplicate runner | **NOT TESTED** | — |
| Uninstall leaves no runner process; documented data-retention policy | **Partially observed, policy not written** | See "Uninstall" below |
| Windows App Certification Kit | **NOT RUN** | Requires elevation; see [msix-test-signing.md](msix-test-signing.md) §7 |
| Evidence from a second local account | **Met** | All rows above captured on `martini\dashtest` |
| MAR-430 cross-principal negative test executed | **Met — first ever execution** | See below |

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
which is what `assertContractsLocation()` would have thrown on. The store is
`dashtest`'s own `userData`, and the vault is OS-backed.

**The runner's own resolution is proven by construction rather than by reading
its log.** `DASH_CONTRACTS_DIR` is set once in `electron/resources.ts` and
passed to the runner verbatim through `cleanEnvironment()` in
`electron/runner-process.ts`; the runner has no independent resolution path
that could diverge. Since a wrong value crashes DASH at startup and DASH
launched, the value the runner inherited was the correct one. This is recorded
as an inference, not as a direct observation, because direct observation was
blocked by the `runner.log` visibility anomaly below.

## Runner survives the window closing, and is adopted on reopen

Same session, in order:

1. First launch — `pid=14264`, **no** `(adopted)` suffix: a genuine fresh spawn.
2. Second launch — `pid=14264 (adopted)`: the same runner, not a second one.
3. DASH window closed, then `Get-Process OrchestrateDASH` → **exactly one**
   process, `Id 14264`, session 2 (`dashtest`'s session).

That is the ADR 0001 Amendment 1 claim — DASH may come and go, the thing
holding the agents does not — observed end to end in a packaged install.

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

## Uninstall — observed, policy still unwritten

`Get-AppxPackage OrchestrateDASH | Remove-AppxPackage` removed the package but
**did not remove `%APPDATA%\OrchestrateDASH`**, including `runner.key`,
`dash.sqlite` and `runner.sqlite`.

This is expected rather than a defect: a full-trust desktop-bridge app writes
through ordinary Win32 file APIs, not MSIX's virtualised per-package storage,
so nothing wipes its data on uninstall the way it would for a sandboxed UWP
app. It nonetheless means MAR-429's requirement — a documented data-retention
policy that says explicitly what happens to `runner.key` — is **not yet
satisfied**, because the policy has not been written. The behaviour is now
known; the decision is not made.

A clean uninstall observation on `dashtest` (runner process gone afterwards) is
still outstanding.

## Open anomalies, none blocking

Recorded because they were observed, not because they are understood.

1. **No single-instance lock.** Nothing calls
   `app.requestSingleInstanceLock()`, so DASH can be launched twice against one
   `userData` directory. Two shells then contend for Chromium's disk/GPU cache
   and log `Unable to move the cache: Åtkomst nekad. (0x5)` repeatedly. Not a
   crash — Chromium degrades to no cache. Exclusivity is currently enforced
   only for the *runner*, by the OS pipe lock, and not for the shell. Worth its
   own issue.
2. **`runner.log` / `runner.json` intermittently invisible to another
   process.** While a runner was demonstrably alive and had written both files,
   `Test-Path` from a separate process returned `False` across a 23-second poll
   at 150 ms intervals. `runner.log` is held open for the runner's whole
   lifetime as its child stdio handle (`openSync(..., "a")`), unlike
   `runner.json`, which is a one-shot `writeFileSync`. A sharing-mode
   interaction is suspected — PowerShell reports some access failures as
   "not found" — but this was **not** root-caused. It did not affect the app's
   own behaviour, only external inspection of it.
3. **The `henri` account's data directory holds accumulated dev-mode history**,
   including pre-MAR-430 `runner.log` entries listening on `http://127.0.0.1:…`
   from before named pipes replaced ports. Repeated
   `Remove-Item -Recurse -Force` did not clear it. This is why `dashtest` is
   the account of record for every row above.

## What is left

1. Update: bump `package.json` version, repackage, re-sign, re-sideload; verify
   data and `runner.key` survive, no orphaned runner, exactly one runner after.
2. Repair, from Settings → Apps → Advanced options.
3. Clean uninstall on `dashtest`, and **write** the `runner.key` retention
   policy.
4. Windows App Certification Kit (elevated).
5. Then, and only then, ADR 0001 Amendment 2.
