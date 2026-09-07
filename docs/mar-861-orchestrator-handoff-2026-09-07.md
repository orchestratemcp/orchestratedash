# Orchestrator handoff — MAR-861, the UX wave — 2026-09-07

For the next orchestrator session. Everything below was verified against git,
`.orchestrate/state.json` and Linear on 2026-09-07 before it was written.
Where a claim rests on a lane's handoff rather than on something checked
directly, it says so.

Hard external deadline: **2026-09-17 15:30 UTC**. Ten days.

## 1. Read these first

`AGENTS.md`, `PROJECT_STATE.md` HEAD, `.orchestrate/state.json`; Linear
MAR-861 and every child (the lane comments on MAR-875/876/877/878/871/874/879/880
carry the decisions, evidence classes and follow-ups); the plan
`docs/dash-ux-plan-2026-09-06.md`; the lane handoffs on master
(`docs/mar-875-handoff.md` … `docs/mar-880-handoff.md`, `docs/mar-878a-handoff.md`,
`docs/mar-878b-handoff.md`); and the previous handoff
`docs/mar-861-orchestrator-handoff-2026-09-06.md` for the Agent Tank context
(spike repo, GenLayer, VPS).

## 2. Where things stand

Master `5137e86`. Zero open PRs except MAR-884's lane (if still running).
`pnpm state:check` valid.

| Packet | Lifecycle | What is true |
|---|---|---|
| MAR-862 plugin, MAR-863 adjudicate | proven | unchanged |
| MAR-868 live poll | **proven** | judgement 5 on the installed build, 18:54:59Z–18:57:15Z, page polled on its own; table on Linear |
| MAR-875 one result per run | merged (#328) | seen on Henrik's build 2026-09-07 08:54: numbered citations, one closed Sources (30), no triple render. Found MAR-884 there |
| MAR-876 interview | merged (#324) | two tools + skill; hand-driven server transcripts; no host session yet |
| MAR-877 global Settings | merged (#327) | Connections seen on Henrik's build: services first, lapses summarised, same-name agents disambiguated |
| MAR-878 readiness + provider | merged (#320, #329) | scaffolds declare `model_provider`; page/footer/chief agree; chief hosts wired. Not yet: adoption + real question |
| MAR-871 server page | merged (#325) | "Your server is up" headline, Check now, five-step recipe; 8 of MAR-865's 9 defects; attended proof is owner's |
| MAR-874 agent Settings | merged (#332) | one state + one action per section; *Use my key* adoption; READY/"will not run" resolved (header was right) |
| MAR-879 onboarding | merged (#336) | Add agent → three paths; sample is one press (`sample.create`); nouns Results/Servers; prose 15px/1.7/70ch |
| MAR-880 poll retries | merged (#322) | one throwing poll no longer settles a judgement; `network_lost` failure |
| MAR-865 VPS | merged | Discord half still blocked on MAR-864 |
| MAR-864, 869, 870, 872 | planned | owner rulings, unchanged from the 06 handoff |
| MAR-881, 882, 883, 884 | planned | follow-ups from this wave; MAR-884 lane may be open |
| MAR-866 video | planned | the judge beat works now; recording is Henrik's |

## 3. What the installed build showed (2026-09-07, master b38b28a, DASH relaunched 06:59)

- Proof Scout Output stage: "Written from: [1] [2] … [30]" numbered links; author panel = one closed *Sources (30)* + *How this agent has been doing*; receipt beside the citations; footer *BUILT WITHOUT A MODEL — has no way to answer questions — ASK THE CHIEF ABOUT THIS AGENT*; header chip **OFFLINE** for the cloud-deployed agent (runtime truth, not a defect).
- **Defect:** the citation row does not wrap; the whole stage scrolls sideways. Filed MAR-884, lane dispatched (Sonnet). Heading still read "Generated assets" at that moment; MAR-879 renamed it to Results afterwards.
- Settings → Connections: services first, both Meeting Assistants disambiguated, the five lapse notices gone from the top. AI / Notifications / Servers tabs were not photographed (Henrik paused remote control).

## 4. Decisions only Henrik can make — unchanged

MAR-864's shape (route vs spawn-at-adoption; gates Discord and the cloud
beat), MAR-872 (convert at the edge / carry a zone / host clock), MAR-869
(carry extra digest fields to the judge — recommended), MAR-870 (delete the
stale `dash-google-proof` row — recommended, never by a session), the two
spike-repo questions. Plus, new: **"go" for one real question on his
OpenRouter key** to prove MAR-878/874's adoption end to end (cents).

Orchestrator defaults recorded on the issues, owner may overrule: Sources
list withheld when the digest is the open card; the sample agent's author
panel is one section + a disclosure; scaffold capability is `chat.completion`
with label "Your model provider"; prose face stays JetBrains Mono; the
"cannot talk" sentence stays the existing one (a manifest field would be an ADR).

## 5. Next dispatch, in order

1. **Proving pass** (Opus, this box, DASH frontmost — arrange the click):
   rebuild after MAR-884; Output stage with no sideways scroll; Settings AI /
   Notifications / Servers at 100% and 80%; agent Settings one screen at
   1280; Add agent three paths with the sample actually pressed; scaffold a
   fresh agent with the plugin, import it (the `dash://` handler is still the
   stale 2026-08-07 one — MAR-870 — so import via Add agent → folder), press
   *Use my key*, ask one question (Henrik's go); one judge press to see
   MAR-880's retry path is quiet. Promote on evidence only.
2. MAR-881, MAR-882, MAR-883 — Sonnet lanes, bounded, prompts to write.
3. MAR-864 the moment Henrik rules; then MAR-865's Discord half; then MAR-872.
4. MAR-866: Henrik records; the beat is press → BEING JUDGED → verdict lands.

## 6. Rules this wave learned — put them in the next prompts

- **Check the running DASH's start time against the fix's merge time before
  proving.** Henrik's DASH predated #311; the first press reproduced the old
  defect perfectly.
- A "watch it happen" proof line can be one `computer_batch` of timed
  waits + screenshots with `date -u` in the same response; label it "timed
  frames, not a video".
- **`gh --jq '<boolean>'` exits 0 on false, and this box has no `jq`.** The
  merge gate is `[ "$(gh pr checks N … --jq '…')" = "true" ] && gh pr merge`.
  #326 merged on pending checks before this was fixed.
- Lanes run as background subagents in `%TEMP%\wt-<lane>` worktrees; they
  survive a usage-limit cutoff and resume with `SendMessage` — tell them to
  commit early and open draft PRs. Six lanes died mid-work at 01:10 and all
  resumed cleanly.
- `app/globals.css`: one fenced append per lane; conflicts are resolved by
  keeping every fence in order (rebuild by parsing, not splicing).
- Every lane left capture-harness runners alive; `scripts/retire-scratch-runners.mjs`
  retires them over `/shutdown` with their own session key (13 retired this
  wave, including the MAR-863 worktree's two-day orphan). Runners whose
  `runner.json` was overwritten by a later scene are unretirable that way.
- 69 orphaned `%TEMP%\dash-mcp-run-*` dirs made `template-run.test.ts` flake
  for every lane; clear them before believing that file.
- `open_application("Electron")` launches a bare Electron; foreground DASH
  with `AppActivate`/`SetForegroundWindow` on its pid instead. An invisible
  `TextInputHost` can hold the foreground for half an hour; only a click from
  Henrik clears it.
- The desktop launcher run from a tool call never returns; start it with
  `Start-Process` and verify by process list. Two launcher runs overlapping
  can start DASH on a half-written `dist` — check `main.mjs` mtime against
  the process start time.

## 7. Session hygiene

Worktrees `%TEMP%\wt-ux*-s1`, `wt-orch-s1`, `wt-ux884-s1` are this wave's;
prune with `git worktree prune` after MAR-884 lands, not before. Older
`wt-*` from earlier waves are stale. Five `wt-ux871-s1` Electron runners with
overwritten records are still alive and idle on scratch stores; they die at
reboot. Henrik's DASH runs from the main checkout on master; relaunch only
via the launcher and only when the machine is not in use.
