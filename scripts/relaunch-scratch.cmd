@echo off
rem relaunch-scratch.cmd -- a DEV/TEST TOOL, not a product feature.
rem
rem MAR-742 roadmap item 3 ("faster redeploy for test loops"): pulls this
rem repo's master branch, rebuilds the renderer and the shell, and starts
rem DASH against a named scratch DASH_DATA_DIR -- so a session re-testing a
rem fix does not have to interleave `git pull`, two builds and a manual
rem relaunch by hand between every pass. Point a Desktop shortcut at this
rem file the same way C:\Users\henri\dash-launcher.cmd is pointed at for the
rem real installed-style launch; this one is for throwaway stores, not the
rem product DASH the person actually uses day to day.
rem
rem Usage:
rem   relaunch-scratch.cmd [scratch-name]
rem   scratch-name defaults to "dash-scratch". The store lives at
rem   %TEMP%\<scratch-name> and is never deleted by this script -- pass a
rem   fresh name for a clean store, or reuse one to keep testing against the
rem   same data across relaunches.
rem
rem Refuses rather than forces: if the repo is not on master, or the working
rem tree is dirty, this stops and says why instead of stashing, resetting or
rem checking anything out on your behalf. Pull, build and launch are the only
rem three things it does.
rem
rem A fresh scratch directory used to make the runner's first launch refuse
rem (MAR-755: nothing created the directory before the runner's channel-secret
rem write). That is fixed on master (electron/runner-process.ts's ensureRunner
rem now mkdirs dataDir first) -- this script does not need to work around it,
rem and does not create the directory itself.

setlocal enabledelayedexpansion

set REPO=C:\Users\henri\Desktop\projekt\MCP\orchestratedash
cd /d "%REPO%" || goto :no_repo

for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set BRANCH=%%b
if not "%BRANCH%"=="master" (
  echo Refusing: %REPO% is on branch "%BRANCH%", not master.
  echo Switch that checkout to master yourself, then run this again.
  goto :failed
)

set DIRTY=
for /f "delims=" %%s in ('git status --porcelain 2^>nul') do set DIRTY=1
if defined DIRTY (
  echo Refusing: master has uncommitted changes in %REPO%.
  echo Commit, stash, or clean them yourself first -- this script does not touch them.
  goto :failed
)

echo.
echo === Pulling master ===
call git pull --ff-only
if errorlevel 1 (
  echo git pull did not fast-forward -- resolve that yourself.
  goto :failed
)

echo.
echo === Building renderer ===
call pnpm build:renderer
if errorlevel 1 goto :failed

echo.
echo === Building shell ===
call pnpm build:shell
if errorlevel 1 goto :failed

set SCRATCH_NAME=%~1
if "%SCRATCH_NAME%"=="" set SCRATCH_NAME=dash-scratch
set DASH_DATA_DIR=%TEMP%\%SCRATCH_NAME%

echo.
echo === Launching DASH ===
echo   store:  %DASH_DATA_DIR%
set DASH_SHELL_URL=dash-app://ui/

for /f "delims=" %%i in ('node -p "require('electron')"') do set "ELECTRON=%%i"
if not defined ELECTRON (
  echo Could not resolve the electron binary from this repo's node_modules.
  goto :failed
)

rem `--user-data-dir` is what actually moves Electron's single-instance lock
rem and `app.getPath("userData")` -- DASH_DATA_DIR alone does not, since
rem `useUserDataDirectory()` only seeds it FROM userData when unset
rem (electron/secure-store.ts). Without this flag, a scratch launch quits
rem instantly (exit 0, "single-instance lock already held") the moment a real
rem DASH is already open on this machine, which the "leave DASH open" ritual
rem means it usually is. `scripts/verify-shell.mjs` sets both for the same
rem reason.
start "" "%ELECTRON%" "%REPO%" --user-data-dir=%DASH_DATA_DIR%
echo DASH is starting against a scratch store: %DASH_DATA_DIR%
exit /b 0

:no_repo
echo Could not find the repo at %REPO%.
exit /b 1

:failed
echo.
echo relaunch-scratch did not finish -- DASH was not started. See the message above.
pause
exit /b 1
