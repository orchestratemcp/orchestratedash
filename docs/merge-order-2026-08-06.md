# Merging the five open PRs, 2026-08-06

Five pull requests are open against `master`, all reported `MERGEABLE` **against
master as it stands right now**. That is not the same as mergeable in sequence:
GitHub answers each question independently, and the moment the first one lands
the others are being asked a different question. This file records the order and
the conflicts it is chosen to minimise, so the sequence is a decision rather than
whatever order somebody clicked in.

## What each PR touches

| PR | Branch | Files |
| --- | --- | --- |
| [#40](https://github.com/orchestratemcp/orchestratedash/pull/40) | `000henrik/housekeeping-state-doc-and-claude-config` | `.claude/launch.json`, `.gitignore`, `docs/state-of-the-project-2026-08-01.md` |
| [#44](https://github.com/orchestratemcp/orchestratedash/pull/44) | `claude/recursing-bell-c60e91` | `.orchestrate/state.json`, `PROJECT_STATE.md`, `app/_components/density-toggle.tsx`, `app/layout.tsx`, `tests/density.test.ts` |
| [#45](https://github.com/orchestratemcp/orchestratedash/pull/45) | `000henrik/mar-491-tables-to-cards` | `.orchestrate/state.json`, `app/_components/connection-checklist.tsx`, `app/agents/detail/page.tsx`, `app/globals.css`, `app/page.tsx`, `app/runs/detail/page.tsx`, `app/runs/page.tsx`, `app/tokens.css` |
| [#43](https://github.com/orchestratemcp/orchestratedash/pull/43) | `000henrik/mar-434-outputs-panel` | `.orchestrate/state.json`, `PROJECT_STATE.md`, `app/_components/digest.tsx`, `app/_components/outputs.tsx`, `app/globals.css`, `app/runs/detail/page.tsx`, `lib/copy/artifacts.ts`, `lib/store.ts`, `lib/views/*`, three test files |
| #46 | `000henrik/mar-434-protected-workspace` | `PROJECT_STATE.md`, `contracts/agent.manifest.v2.schema.json`, `electron/agent-adapters.ts`, `lib/contracts.ts`, `lib/db.ts`, `lib/store.ts`, `runner/*`, five test files |

## The order, and why

**#40 → #44 → #45 → #43 → #46.**

1. **#40 first because it is free.** It shares no file with any other PR. It can
   go in at any time and is put first so it stops being a thing to think about.
2. **#44 second.** Its only overlap with anything is `PROJECT_STATE.md` and
   `.orchestrate/state.json` — append conflicts, resolved by keeping both
   sections. Its code files (`app/layout.tsx`, `density-toggle.tsx`) are touched
   by nobody else.
3. **#45 before #43**, and this is the one real decision. Both edit
   `app/runs/detail/page.tsx` and `app/globals.css`. #45 is a wide, mechanical
   restructure of six app files (every table becomes a card list at 375px); #43
   is a single surgical addition (an Outputs panel) to one of them. Landing the
   restructure first means #43's insertion is re-applied to the page's final
   shape, which is the smaller and better-understood merge. It also costs
   nothing in rework: #43's panel is **already** a card list — its own notes say
   it was built that way because of MAR-491 — so nothing in it needs converting.
4. **#46 last.** Its only overlaps are `lib/store.ts` with #43 (different
   regions of the file; likely clean) and `PROJECT_STATE.md` with #43 and #44.
   Everything else it touches — `runner/`, `contracts/`, `electron/`,
   `lib/db.ts` — is touched by no other open PR.

## Conflicts to expect, and how to resolve them

- **`PROJECT_STATE.md`** on #43, #44 and #46. All three append a section near the
  end. Keep every section; the file is a log, not a state machine.
- **`.orchestrate/state.json`** on #44, #45 and #43. Each adds an entry to the
  `issues` array. Keep all entries. Note that **#43 already carries the MAR-434
  entry**, and #46 deliberately adds none, so there is no duplicate to reconcile
  — see the follow-up below.
- **`app/runs/detail/page.tsx` and `app/globals.css`** between #45 and #43. The
  only conflict needing judgement rather than concatenation. #43's Outputs panel
  goes on the restructured page; its `globals.css` rules are additive.
- **`lib/store.ts`** between #43 and #46. #43 adds artifact-body reads, #46 adds
  the workspace projection and `resolveArtifactAvailability`. Different regions.

## Two follow-ups this sequence creates

Neither is a defect and both are invisible unless written down.

1. **Nothing wires #46's producer to #43's parameter.** #43 shipped
   `resolveAvailability` as a parameter with an honest default because nothing
   could yet produce a state; #46 built the producer but could not touch `app/`.
   After both land, `buildArtifactCards` should be passed
   `resolveArtifactAvailability(agent, runId)` from `lib/store.ts`. Until that
   one-line change, every output still renders as `available` — which remains
   true, and remains less than what is now known.
2. **MAR-434's entry in `.orchestrate/state.json` describes the design slice
   only.** #43 wrote it before #46 existed, and its own text says the runner half
   is unbuilt. Once #46 lands that sentence is false and the entry needs the
   correction every predecessor entry has needed — the same pre-merge-sentence
   correction MAR-473, MAR-467 and MAR-441 each made for the one before them.
