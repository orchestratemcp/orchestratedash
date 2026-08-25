# Group D proving sweep (2026-08-25) - one capture run, isolated.
#
# Not part of the shipped shell and named by no package.json script. It exists
# so every group-D run is made the same way: a unique scratch root per run with
# the store and the Chromium profile BOTH under it, both passed, and stdout and
# stderr kept in separate files so the vault self-check line (a console.warn,
# therefore stderr) survives. Redirecting a native exe's stderr with 2>&1 inside
# PowerShell 5.1 wraps every line in an ErrorRecord, so Start-Process with two
# explicit files is used instead of a pipeline.
#
# ASCII only, deliberately: this file is read by Windows PowerShell 5.1, which
# decodes it as the system ANSI codepage and turns any UTF-8 punctuation into
# mojibake that breaks the parser several lines away from the character.
#
#   .\scripts\run-capture-groupD.ps1 -Harness capture-models -Slug mar654-models
#
param(
  [Parameter(Mandatory = $true)][string]$Harness,
  [Parameter(Mandatory = $true)][string]$Slug,
  [string]$ExtraEnv = "",
  [int]$TimeoutSec = 600
)

$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$root = Join-Path "C:\Users\henri\AppData\Local\Temp\gD-2026-08-25" $Slug
$store = Join-Path $root "store"
$ud = Join-Path $root "ud"
$outDir = Join-Path $repo "qa-screenshots-groupD-2026-08-25\$Slug"

# The frame directory is emptied; the store root must not already exist.
#
# Both halves were paid for in one run. A harness seed is written to run once
# against an empty store, so re-running a slug over its own leftovers made
# saveHost refuse a duplicate server and killed the run before its first scene -
# while the PREVIOUS run's 47 frames sat in the output directory, so the wrapper
# counted them and reported a success. A stale frame under a fresh run's name is
# the worst thing a capture harness can produce, because nothing downstream can
# tell.
#
# The fix for that is NOT to delete the store, which was the second mistake.
# Every capture harness here spawns a detached runner that outlives it and holds
# runner.sqlite open, so the delete removed runner.json and runner.session.key,
# failed on the locked database, and destroyed the one credential that can
# retire the process gracefully (MAR-520). Deleting a store out from under a
# live runner is how an unretirable runner is made. So: a fresh slug per run,
# enforced, and scripts/retire-groupD-runners.mjs to end the runners afterwards.
if (Test-Path $outDir) { Remove-Item -Recurse -Force $outDir -Confirm:$false }
if (Test-Path $root) {
  throw "$root already exists. Pick a new -Slug; never reuse a scratch root, and never delete one (a live runner holds runner.sqlite - retire it with scripts/retire-groupD-runners.mjs first)."
}
New-Item -ItemType Directory -Force -Path $store, $ud, $outDir | Out-Null

# The worktree's offline install skipped Electron's binary download; the main
# checkout holds the identical 43.2.0 runtime. Only the runtime is borrowed -
# every line of app code comes from this worktree's dist/.
$electron = "C:\Users\henri\Desktop\projekt\MCP\orchestratedash\node_modules\.pnpm\electron@43.2.0\node_modules\electron\dist\electron.exe"
if (-not (Test-Path $electron)) { throw "no electron runtime at $electron" }

$entry = Join-Path $repo "dist\electron\$Harness.mjs"
if (-not (Test-Path $entry)) { throw "no built harness at $entry (run pnpm build:shell)" }

$env:DASH_SHELL_URL = 'dash-app://ui/'
$env:DASH_DATA_DIR = $store
$env:DASH_CAPTURE_DIR = "qa-screenshots-groupD-2026-08-25/$Slug"
if ($ExtraEnv -ne "") {
  foreach ($pair in $ExtraEnv.Split(";")) {
    $eq = $pair.IndexOf("=")
    if ($eq -gt 0) {
      $k = $pair.Substring(0, $eq)
      $v = $pair.Substring($eq + 1)
      Set-Item -Path "env:$k" -Value $v
    }
  }
}

$outLog = Join-Path $root "stdout.log"
$errLog = Join-Path $root "stderr.log"

Write-Host "[groupD] $Harness -> $Slug"
Write-Host "[groupD]   store = $store"
Write-Host "[groupD]   ud    = $ud"

$proc = Start-Process -FilePath $electron `
  -ArgumentList @($entry, "--user-data-dir=$ud") `
  -WorkingDirectory $repo `
  -PassThru -NoNewWindow `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog

if (-not $proc.WaitForExit($TimeoutSec * 1000)) {
  Write-Host "[groupD] TIMEOUT after $TimeoutSec s - pid $($proc.Id) left alive deliberately (never force-kill)"
  exit 99
}

Write-Host "[groupD] exit $($proc.ExitCode)"
$shots = @(Get-ChildItem -Path $outDir -Filter *.png -ErrorAction SilentlyContinue)
Write-Host "[groupD] frames: $($shots.Count) in $outDir"
Write-Host "[groupD] logs: $outLog | $errLog"
exit $proc.ExitCode
