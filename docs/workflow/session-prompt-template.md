# Session prompt — <ISSUE-ID>: <title>

**Client/model:** <e.g. Claude Code, claude-opus-5, extended thinking>
**Repo/branch:** <repo> / <branch or worktree path>
**Issue:** <link>
**Ownership:** you own <paths>; do not touch <paths>. <Other session X owns Y / no parallel session.>

## Objective

<One paragraph. The single user-visible outcome this session exists to produce.>

## Current evidence

<What already works, with the commit/test/screenshot that shows it. What the
last session found. Known blockers.>

## Allowed changes / non-goals

- Allowed: <...>
- Non-goals: <the adjacent things you will be tempted to do — named so you don't>

## Start checks

1. Confirm branch and clean `git status` (preserve unrelated dirty files).
2. <state check command>
3. Read the issue and its latest comments.

## Definition of done

- <The specific proof: test command + expected output, or smoke/screenshot
  of the packaged build, or deployed check.>
- PR opened targeting <default branch>; CI PASS (not just finished).
- Issue updated with commit SHA + proof artifact.
- Packet entry appended to state (lifecycle `planned`, commit null).

## Hard stop

When the definition of done is met (or you are blocked on <X>), write the
handoff and end the session. Do not start adjacent work.

## Handoff format

What changed (commits/PR) · what was verified and how (paste proof) · what
is NOT done · surprises or contradictions found · the one thing the next
session should do first.
