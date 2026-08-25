# DASH project state — HEAD

Updated: 2026-08-19 (workflow v2: state rotation, refreshed after master moved past it)

This file is the **current truth only**, kept under ~200 lines. The full
narrative history through 2026-08-19 lives in
`docs/state-archive/PROJECT_STATE-2026-08-18.md` (master's appended entries
followed the rename in the refresh merge); per-packet evidence narratives
live in `.orchestrate/archive/state-2026-08-19-full.json` (and the earlier
`state-2026-08-18-full.json`) and in git history. `.orchestrate/state.json` is the packet index (id, lifecycle,
commit, proof command) and is validated by `pnpm state:check`. Rotate this
file at every checkpoint: move superseded entries to the archive, never
append forever.

## What DASH is

The local-first shell that lets a person add, run, inspect, and trust
agents without a terminal. Canonical first journey: **Try a sample agent**
(AI News Scout). Manifest input is v2, runner telemetry is v1. Development
and installed stores are distinct; installed journeys are proven only on
the packaged path.

## Where the product stands

- **Wave 0 — installed first-run reliability: proven** (2026-08-01,
  `05201e7`). Packaged renderer, no-terminal sample handoff, runner
  identity, graceful shutdown, Runs inspection, verdict.
- **Wave 1 — shortest real agent loop: proven** (2026-08-01, `c658667`).
  AI News Scout live cited digest; grounding as a second verdict axis;
  manual trigger honesty.
- **Wave 2 — outside-app connections: in flight.** Permission broker built
  (no token pass-through, three-party grants, `broker_lapses`, read-then-
  reach). Gmail is read/search/draft-only against a loopback provider —
  the real-Google consent path remains unproven and no surface may claim
  it. Discord outbound notifications shipped. Model choice per step
  (MAR-583) shipped. Outputs usability (MAR-697/698, PR #245): collected
  links open through the main process and exported PDFs land somewhere
  findable — merged, not proven. Fleet chief chat: the PR #246 floating
  window was refused on sight ("the floating textbox was a disaster");
  MAR-696's corrected composer — incorporated into the page, the big
  agent spotlight box deleted, a model line and swap control added (ADR
  0023 amendment 1) — is a new PR awaiting Henrik's judgment on the
  screenshots, not yet merged. **The DASH→LAB loop is closed** (MAR-479,
  ADR 0026): a real LAB accepted a real observation composed from a real
  run, `dash_route_`-prefixed, and LAB `/insights` renders
  `dash-telemetry` beside `lab-local`. Off by default, one opt-in, and a
  receipt of the literal bytes. Merged, not proven — the PR is open.

## Active decision surface (ADRs 0019–0026)

- ADR 0019 + amendment 1: controlled browser. Slice 1 **built and
  machine-proven** (`electron/prove-browser.ts`, 11 checks) — open one
  page, read its words, exact per-run origins, ephemeral view. Scroll,
  click-with-approval, VPS/Xvfb path deferred; load/recovery (condition 8)
  is the largest stated gap.
- ADR 0020: an MCP server is a connection DASH brokers; tool set pinned at
  consent; curated catalogue ships empty. `planned`, no implementation.
- ADR 0021: the host is a small DASH runtime (runner-local broker as an
  install pack). `planned`, documentation only. Remote MCP parity waits on
  this (MAR-629).
- ADR 0022–0025: starting a stopped agent; the chief is a principal; a
  decision is filed where it is made; a brief is a document bound to its
  evidence (MAR-674, promoted to proven 2026-08-18, `8bf4671`).

## Lifecycle counts (from state.json, 2026-08-25)

124 merged, 69 proven, 20 planned — 213 entries, after the group-D proving
sweep (runtime + keys), which is the **last of the four groups** AGENTS.md
calls for. **90 distinct issues have a merged entry and no proven one.**

Group D promoted merged -> proven: **MAR-654** (a declared level now reaches a
model id — two steps of one plan resolving to two different models, one by the
`level_map` rung and one by the fleet default), **MAR-680** (a run staged
mid-flight and then finished *under the open page*, so its own 5s poll had to
notice: step indicator, finish signal, and a new output appearing with no
reload — all three in one page instance), **MAR-681** (three standing answers
listed, then one revoked by a real `Forget` press), **MAR-624** (the fleet
fan-out pressed for real, with `connection_secrets` read on both sides: empty
before, `models/key` for both agents after — the row the issue says was never
written), and **MAR-520**, proven differently and better: this sweep's own
capture runs left five orphan runners, and all five were retired over
`POST /shutdown` with the runner-written session key, fingerprint-checked
before connecting. No process was force-killed.

Left merged, with the reason on each entry's `lifecycle_check`: **MAR-625,
MAR-629, MAR-633** — ADR and library packets with no packaged path a person can
reach (`lib/mcp/` is complete and imported by nothing; the host pack runs on an
enrolled host); **MAR-611, MAR-487** — both need an attended run against a real
server, and MAR-487's own exit evidence demands one. Note that MAR-487 was
archived in Linear on 2026-08-24 while still In Progress, so it carries live
proven-debt where nobody counting it will look.

**Three of group D's ten can never reach `proven` under the current rule**,
because they are documentation. That is a lifecycle question for the
orchestrator, not a gap in the work — see the handoff on MAR-742.

Evidence: `qa-screenshots-groupD-2026-08-25/` — four run directories, 147
frames, `layout.json`, `layout-settings.json`, the four run logs and the two
runner-retirement records. Three existing
harnesses were extended with scenes that run **after** their matrix and press
things for real, rather than new harnesses being added. Four defects filed from
the frames: **MAR-791** (`.model-picker`'s 46ch cap, written for
a dropdown, contains MAR-654's prose, so its own `60ch` rules are unreachable
and the explanation wraps at ~44 characters in a third of the page — already
visible, unnoticed, in the group-C frames), **MAR-792** (the fleet card's
per-agent chip stretches the whole card because a three-column rule sits over a
two-child row; and its reach sentence outlives the connection it offers),
**MAR-793** (a standing answer is stamped `Set 2026-08-25T16:47:25.128Z`) — all
three fixed on PR #297 (`000henrik/mar-791-792-793`, open and not merged),
frames re-shot against the fix.

## Lifecycle counts (from state.json, 2026-08-24)

122 packet entries merged, 58 proven, 20 planned — 200 entries, after the
2026-08-24 morning reconciliation (overnight PRs #271/#272/#273 merged with
state.json tail unions; MAR-740, MAR-741 and MAR-748 promoted proven;
MAR-743/745/746 recorded merged, proven waiting on Henrik's 5-step Discord
re-test; the MAR-697 legacy-exports packet merged — proven when the five
real em-dash PDFs rename on his next launch) and the group-C proving sweep (fleet +
settings: MAR-639, MAR-640, MAR-614, MAR-685, MAR-646 and MAR-622 promoted
merged -> proven. MAR-642 checked and **left merged**: two of its Servers
bullets were deferred by the PR that merged the rest — #197's own "Not in
this packet" section names "Update DASH on this server" and the wizard
prose diet — and there is still no `host.update` in `lib/shell/ipc.ts`'s
command family, so four of its five bullets are proven and the packet is
not. One defect filed from the frames: **MAR-752**, a fleet card reading
"Ready for review" and "Not run yet" at once, the last-run line's guard
being on status rather than on `run_count`). Evidence:
`qa-screenshots-groupC-2026-08-24/` — 138 frames, `layout-fleet6.json`,
`layout-settings.json`, `layout.json` (cockpit) and the three run logs.
Three existing harnesses were extended rather than replaced, each with a
scene block that runs **after** its matrix and presses things for real,
because almost nothing group C promises is a layout:
`capture-fleet-views.ts` (filters, favourites, the work-inbox badge, Down
in Rows, and a UI-scale pair proving the spotlight card grows 218 → 269px
at 80% instead of staying fixed), `capture-settings-polish.ts` (a seeded
store, Connections and AI added to the page list, and a Disconnect pressed
on each of the two surfaces MAR-685 names), and `capture-cockpit.ts` (the
rail's dated index, and a real press on a day).

**The count above is a recount.** The previous entry read "128 merged, 49
proven, 20 planned"; `state.json` itself held 118/49/24 at that moment. The
proven figure was right and the other two were not, so they are restated
from the file rather than carried forward. The number that actually
measures the debt is neither: **94 distinct issues have a merged entry and
no proven one** (up three from 91 because MAR-743/745/746 moved
planned -> merged in the same reconciliation that promoted six).

The preceding sweep, kept for the record: on 2026-08-23,
group B (agent page: MAR-630, 634, 620, 664, 668, 691, 698,
635 promoted merged -> proven; MAR-697 promoted for its save-into-folder
half only — its click-to-open half was MAR-740's known bug. MAR-740
(the em-dash fold) and MAR-741 (the agent-page rail spanning under the
composer's room) are fixed and independently re-verified — PR #268, merged
2026-08-23, 8f6ae8e; both promoted proven 2026-08-24 alongside MAR-697's
click-to-open half). Evidence:
`qa-screenshots-mar630-634-fleet3/`, `-fleet6/`, `qa-screenshots-mar635/`
(`electron/capture-fleet-views.ts`, `capture-deploy.ts`, both pre-existing
harnesses re-run against the packaged build) and
`qa-screenshots-mar664-668-620-691-697-698-635/` (`capture-cockpit.ts`,
extended with five new scenes: the empty-state disclosure, the deep dive
on both renderers, a real collected-link click, a real Save-as-PDF into
`exports/<agent>/`, and the busy-state live feed/telemetry panel).
Group B is the agent page (MAR-630/634/620/664/668/691/697/698/635) of
the four-group proving-debt sweep AGENTS.md calls for. Group A (chat front
door) was proven 2026-08-22, group B on 2026-08-23, group C
(fleet+settings) on 2026-08-24 and **group D (runtime+keys) on 2026-08-25 —
the sweep is complete across all four groups.**
**Proven-debt is still far over budget** at 90 distinct issues — completing
the sweep named the debt rather than clearing it, and five of group D's ten
could not be promoted for reasons that are about the lifecycle rule and about
missing hardware, not about the work. The proving wave's four groups are done;
what the next dispatch does about the remainder is Henrik's call.
Merged-but-unproven work is inventory, not progress.

The group-A promotions rest on `electron/capture-mar615.ts` run against
the **packaged build** (`dash-app://ui/`, `pnpm build:renderer` +
`pnpm build:shell`, scratch store): the composer/room capture the harness
already had, plus one new scene (`askRecordsQuestion`/
`measurePostAskState`) that asks the chief a records-fast question and
proves the room survives the post-answer re-read without a live model or
key. Evidence and images: `qa-screenshots-groupA-2026-08-22/`.

The 2026-08-19 sweep's promotions rest on **`pnpm verify:shell` against
the real installed store: 85/85 PASS, 0 FAIL**, proof 0 green on
`%APPDATA%\orchestratedash`.

Getting there repaired the store. `dash.sqlite` was WAL-mode with no
`-wal` and unreadable (MAR-700); a b-tree recovery showed the damaged file
was strictly worse than MAR-676's 2026-08-17 snapshot, so the snapshot was
restored and the damaged file kept at `malformed-20260819/`. DASH then
repaired itself unattended — MAR-682's reconciliation recognised the
pre-renumber shape, created `chief_messages`, and the migration loop
carried the store to `user_version` 29, 38 tables, `integrity_check: ok`.

## Known standing constraints

- Never force-kill Electron or the runner; runners stop via authenticated
  `/shutdown`.
- Port 3000 is not assumed to be DASH's; verify the owner.
- `pnpm verify` on Windows includes the real shell smoke (machine-
  affecting); run it from PowerShell with DASH closed.
- Loopback fixtures cannot refuse like real providers; proofs against them
  establish boundaries, not provider behavior.

## Where the next session starts

Read this file, run `pnpm state:check`, read the active Linear issue, and
check `docs/workflow/WORKFLOW.md` for the operating loop. Session prompts
come from the orchestrator using the contract in
`docs/workflow/session-prompt-template.md`.
