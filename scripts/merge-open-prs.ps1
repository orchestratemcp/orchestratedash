# Merge the five open PRs in the order docs/merge-order-2026-08-06.md argues for.
#
# Stops at the first PR that will not merge cleanly rather than pushing past it,
# because the one merge in this sequence that needs judgement (#45 then #43, both
# editing app/runs/detail/page.tsx) is exactly the one a script should not guess at.
#
#   pwsh -File scripts/merge-open-prs.ps1
#
# GitHub recomputes mergeability asynchronously after each merge, so each PR is
# polled rather than read once - a PR asked too early answers UNKNOWN, and
# treating that as "not mergeable" would stop the run for no reason.

$ErrorActionPreference = "Stop"
Set-Location "C:\Users\henri\Desktop\projekt\MCP\orchestratedash"

$order = @(40, 44, 45, 43, 46)

function Get-Mergeable([int]$pr) {
    for ($i = 0; $i -lt 15; $i++) {
        $state = (gh pr view $pr --json mergeable -q .mergeable)
        if ($state -ne "UNKNOWN") { return $state }
        Start-Sleep -Seconds 2
    }
    return "UNKNOWN"
}

foreach ($pr in $order) {
    $title = (gh pr view $pr --json title -q .title)
    Write-Host ""
    Write-Host "=== #$pr  $title" -ForegroundColor Cyan

    $state = Get-Mergeable $pr
    if ($state -ne "MERGEABLE") {
        Write-Host "#$pr is $state." -ForegroundColor Yellow
        Write-Host "Resolve it, then re-run this script - it will skip what is already merged:" -ForegroundColor Yellow
        $branch = (gh pr view $pr --json headRefName -q .headRefName)
        Write-Host ""
        Write-Host "  git fetch origin"
        Write-Host "  git checkout $branch"
        Write-Host "  git merge origin/master"
        Write-Host "  # resolve, then:"
        Write-Host "  git add -A; git commit; git push"
        break
    }

    # No --delete-branch: another session may have one of these checked out, and
    # deleting a branch out from under a live worktree is a worse outcome than a
    # stale remote ref.
    gh pr merge $pr --merge
    if ($LASTEXITCODE -ne 0) {
        Write-Host "#$pr did not merge. Stopping." -ForegroundColor Red
        break
    }
    Write-Host "#$pr merged." -ForegroundColor Green
}

Write-Host ""
Write-Host "=== bringing local master up to date ===" -ForegroundColor Cyan
git fetch origin
git checkout master
git pull --ff-only
git log --oneline -8
