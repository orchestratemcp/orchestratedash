# The attended run of 2026-08-10 — what happened, and what it proves

Written **during** the run, not after, so the record cannot quietly become a
summary of what was hoped for. Status at the time of writing: **Part A partially
complete, Part B (`V0`–`V10`) NOT RUN.** Nothing here promotes MAR-489.

Read `docs/attended-vps-proof-runbook.md` for the procedure this run follows and
for the promotion rule it does **not** satisfy.

---

## Preconditions — all pass

| | |
| --- | --- |
| DASH commit | `be90d84` (master; CI run 31392610058 green, incl. Windows `shell-smoke`) |
| runner-standalone build id | `da222f419086048178d2` (version 0.1.1) |
| `pnpm state:check` / `typecheck` / `brand:check` | valid / clean / green |
| `pnpm test` | 140 files, **2814 passed**, 10 skipped, 0 failed |
| `pnpm verify:shell` | **85 PASS, 0 FAIL** — the full set, from PowerShell |
| Orphan runners at start | none (zero node processes) |

All from PowerShell, per the runbook and `run-verify-from-powershell`.

**The checkout moved mid-run and it did not matter, which is itself worth
recording.** Another session merged PRs #122 and #123 while this run was in
progress, advancing master from `be90d84` to `007487d` (MAR-590's fleet grid and
the MAR-545/590 promotion). Every precondition above was measured on `be90d84`,
and `dist/` was built from it. `git diff --stat be90d84 007487d -- runner lib
contracts` is **empty**, and `computeRunnerBuildId` returns
`da222f419086048178d2` on both trees — so the runner this run used is still the
build recorded, which is the exact question `runner_build` exists to answer
(MAR-497). Any *renderer* observation below was made against the `be90d84` build.

**Runbook correction:** precondition 2 says to run
`node scripts/runner-build-id.mjs` over `dist/runner-standalone`. That file is a
module with no CLI entry point, and it hashes `runner/`, `lib/` and `contracts/`
— not `dist/`. `pnpm build:runner-standalone` prints the id itself.

**Two UI gates in the runbook are now closed and its P1/P2 section is stale:**
MAR-579 (enrollment surface) and MAR-577 (deploy result rendering) have both
merged, and MAR-570's requirement card shipped too. The runbook's "hard blocker"
paragraph should be corrected when this run is recorded.

---

## The host

The fresh box the runbook demands was **not** rented. Henrik still had the
2026-08-08 Hostinger machine, which the runbook explicitly refuses as the
contaminated control. Agreed remedy: **reinstall Ubuntu 24.04 on the same box**,
which regenerates the SSH host keys and wipes `/opt/orchestratedash`,
`authorized_keys` and the hand-placed Node — restoring both first-contact walls.

Recorded honestly: **same IP and hardware, OS reinstalled 2026-08-10, host keys
regenerated.** The reinstall is confirmed by the identity change:

| | SHA256 |
| --- | --- |
| before reinstall | `l9JnmBHu1cH4bd0HUCvLNBq/Ndq2Ms8or7uQFxA7ilQ` |
| after reinstall | `SjJ57mMX3zVh7iIvu2BRUxp/1DQEAQ1VhsNv17mS6vo` |

Banner after reinstall: `SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.18`.

**The second fingerprint was obtained with `ssh-keyscan` from this machine and is
NOT a valid out-of-band source for `V2`.** It proves the reinstall happened,
nothing more. `V2` still requires the provider console comparison and was not
performed.

### Precondition 1 was NOT clean, and the trap was live

The real store held **five** host records (not four), all `186.240.156.166`, all
with `host_fingerprint = null` — DASH never pinned that box through the product.
But `hosts/known_hosts` held **three** lines for it (ed25519, rsa, ecdsa),
written by hand on 2026-08-08. The store and the pin file disagree about whether
the box was ever enrolled.

After the reinstall those three lines describe keys that no longer exist, and
`pinHostKey` refuses with `already_pinned_differently` when it finds lines it did
not write. Left alone, `V2` would have failed for a reason having nothing to do
with the product. These records were **not** cleared before the run ended.

---

## What was proven

### `V-A1` — PASS

The MCP-planned agent imported through the real `dash://handoff` consent dialog.
The dialog names the folder, states that DASH takes a **copy**, gives the exact
command (`node agent.mjs`), and says *"Later, it will ask you to connect: Gmail.
Nothing is connected by adding it."*

The load-bearing claim was checked at the only moment it can be — with the dialog
open and unanswered, `support-mail-digest` was absent from **both** the `agents`
table and the `agents/` directory. It appeared only after **Add and start**.

### Everything else in Part A — NOT RUN

`V-A2`, `V-A3`, `V-A4`, `V-A5` were not performed. See findings 4, 5 and 14 for
why `V-A2`/`V-A3` cannot be performed as the runbook words them at all.

### Part B — NOT RUN

`V0` through `V10`, the entire VPS proof and the epic's closing evidence, **were
not started.** The box is reinstalled and waiting. This is the check that
matters most and it has still never been performed.

---

## Findings

Filed rather than fixed, per the run's own rule. Numbered in discovery order.

### The toolchain emits none of the blocks the contract specifies

**4. `default_model_level` is emitted by nothing.** `contracts/agent.manifest.v2.schema.json`
defines `"enum": ["cheap","standard","frontier"]`; the MCP export contains **zero
occurrences** of the field. `lib/ai/model-levels.ts` reads only this field and
deliberately refuses to fall back to `model_tier`, so an MCP-exported agent gets
no per-step model choice. The session brief's premise that "MCP now emits
default_model_level" is **false for this build** (orchestratekit-mcp 0.1.0,
registry fingerprint `e96153143493d5a1`).

**5. `agent_dom.connection_requirements` is emitted by nothing.** The schema
defines it with `"enum": ["google_oauth_broker","api_key"]` (MAR-569). The export
contains **zero occurrences**, writing the older `agent_dom.connections` instead.
MAR-570's requirement card therefore has nothing to render, so `V-A2`/`V-A3` are
not merely "covered by the older surface" as the runbook allows — the
*declaration* is missing, not just the rendering.

**14. No manifest anywhere declares a model provider, so there is nowhere to put
a key.** MAR-582 shipped `AiKeyConnectionView` and a Connect flow; a card only
appears for a connection whose `provider` matches an `AI_PROVIDER_IDS` entry and
which has a `secret` field. **No example, fixture, Agent Kit template or MCP
export declares one.** What a person sees instead is the *derived* "Model
provider" row (`source: derived_from_plan`, `requires_secret_input: false`),
whose own copy says *"DASH shows this so the list is complete"* and *"DASH never
holds this sign-in"* — a disclosure with no Connect button. Henrik's verbatim
report: **"I find no spot for adding open router eighter."**

These three are one story: **MAR-569, MAR-583 and MAR-582 each shipped a
DASH-side reader or card with no producer on the other end.** This is the
`copy-gates-only-see-populated-fields` pattern at feature scale.

**6. An MCP-planned AI step cannot be implemented through DASH.** The planner
routinely emits `model_tier: frontier` steps, and `lib/broker/execute.ts`'s
`BrokerOrigin` gate refuses an agent a completion by origin. So the agent cannot
perform the step its own manifest declares. The agent built for this run says so
in its digest's `synthesis` field rather than faking it.

### The planner

**1. The route matcher keys on bare English words.** `out`, in the phrase "out of
my Notion database", pulled in four components (`fan_out_collector`,
`intent_classifier`, `job_queue`, `threshold_router`). `write` matched
`audit_log`; `read` matched `reviewer_notification`.

**2. A goal explicitly asking for a summary produced a route with
`model_tier: "none"` on every step** — the AI step vanished entirely.

**3. `safety_review` reports a phantom blocker and contradicts the field beside
it.** On the read-only route `email_read → research_synthesis → citation_checker
→ source_freshness_check`, `safety_review.status` is `"fail"` with *"External
write/send/publish action detected without a human approval gate."* There is no
write step. The rendered card says *"Automation clearance L0: unattended blocked"*
while `automation_clearance.autonomous_allowed` is **`true`** in the same
response. A novice is told to add an approval gate for a send that does not exist.

**7. The MCP export carries no `agent_dom.panel`**, which Agent-Kit agents get, so
MCP-planned agents arrive with no designed workspace.

**10. The MCP export emits no `agent.display_name`**, so an MCP-planned agent
appears in DASH under its machine slug (`support-mail-digest`).

### DASH

**12. The main process crashes on a logging write.** `A JavaScript error occurred
in the main process — Uncaught Exception: Error: EPIPE: broken pipe, write … at
console.warn … main.mjs:27245`. Triggered by launching DASH with redirected
output and closing the reader. Any user starting DASH from a terminal they then
close can hit this. A `console.warn` must not be able to kill the app.

**11. Two launch paths silently choose different data directories.** `electron .`
reads `package.json` and uses `%APPDATA%\orchestratedash`; `electron
dist/electron/main.mjs` gives Electron no app name and uses `%APPDATA%\Electron`.
Same binary, same build, two different DASHes, distinguishable only by one stderr
line. During this run that produced a DASH showing three agents and zero hosts
while the real store had five and five — and agent removals that appeared not to
stick. This is the single most dangerous finding for MAR-489, because "a clean
DASH" is a precondition you can satisfy by accident without knowing.

Related: launched as `electron .`, DASH logs *"not claiming dash:// from . — only
the app's own entry point may be the handler"*, so in the dev path claiming the
protocol and using the real store are mutually exclusive. Workaround used:
`electron . "dash://…"`, which the single-instance `second-instance` handler
forwards. A packaged install has one entry point and is unaffected.

**13. The Agents list does not refresh when an agent is added.** Henrik verbatim:
**"but wasnt there. swaped view back n forth and it showed up"**.

**15. Updating a running agent fails to copy, with a message that misdiagnoses
it.** Re-importing a changed manifest was refused: *"DASH could not finish copying
"Support mail digest", so it was not added."* The cause is that the agent runs
from `agents/<id>/code/`, the directory being replaced, and Windows will not
overwrite files a live process holds. The message never says "stop the agent
first", and the scaffold's README promises the opposite experience: *"run `npm run
open-in-dash` again. DASH will ask you to confirm the change."*

**9. `open-in-dash` refuses an agent missing a scaffold file it does not use.**
`AGENT_KIT_PROJECT_FILES` is a fixed list including `sources.json`. Deleting that
file — after rewriting the agent to read mail instead of feeds, which the README
invites with *"Make it yours"* — makes the agent unimportable with *"This agent's
build is incomplete, so DASH cannot take a reliable copy. Build it again"*.
Nothing was built and rebuilding fixes nothing.

**16. Google sign-in does not persist.** After signing in to Gmail through the
Connections page, the card still read `NOT CONNECTED` — and it was right.
`connection_secrets` held **no row** for the agent (only a `dash-google-proof`
row from 2026-08-07) and `broker_grants` was **empty**. The agent's own run at
14:40 agreed: `run_completed — "Gmail is not connected yet, so there was no
mailbox to read."` This is the `loopback-fixtures-cannot-refuse` gap — DASH's
OAuth has never worked against real Google — not a stale badge.

**17. `ai-news-scout` outputs fixture data rather than news.** Its digest reads
*"DASH local rss item 3 6c87474c" · Local RSS · 2 August 2026*, across all three
"sources". The agent this project calls its one real test agent is reading local
fixtures, so no run of it has ever found real data.

**18. There is no removal control on an agent.** `removeAgentWithReport`
(`electron/main.ts`) and `lib/agent-folders.ts` exist; nothing in the UI reaches
them. Henrik wants two distinct actions: **remove from DASH**, and **remove and
delete all its files**.

### Store health

**8.** `runner.sqlite` in the real store was **malformed again** (`database disk
image is malformed`), having last been set aside on 2026-08-06. The runner
reported *"supervising nothing until they are repaired or set aside"*. Set aside
during this run into `runner-sqlite-malformed-20260810/` (renamed, not deleted),
after which a fresh runner started clean on build `da222f419086048178d2`.

An orphan runner from the `dash-mar592` worktree (pid 33108, build
`35dc84bc6c0d359e69b4`) was holding the pipe against the real store. It was
retired through its **authenticated `POST /shutdown`** — fingerprint verified
before the credential was presented, `202 {"ok":true}`, process exited. No signal,
no `Stop-Process`.

---

## Henrik's friction notes, verbatim

These gate MAR-592's next phase and are recorded exactly as written:

- **"the add agent page is confusing"**
- **"I find no spot for adding open router eighter. To run dash we need atleast to add an openRouteer key."**
- **"but wasnt there. swaped view back n forth and it showed up"**
- **"nowhere to connect"**
- **"cant find a consent window."**

### The settings page he asked for

Requested contents, to be filed against MAR-592:

1. Connections
2. VPS / Servers
3. AI (OpenRouter and model choice)
4. Notifications / chat
5. App preferences such as dark mode

---

## What this run does NOT prove

- **Nothing about the VPS.** `V0`–`V10` were not run. First-pin enrollment, the
  one-paste bootstrap, the forced-command refusal, the remote deploy, the remote
  run and the pull over real `ssh` all remain **unperformed**, exactly as they
  were before this session.
- **No provider has been contacted and nobody has been charged.** MAR-545's
  attended proof remains unrun; its handoff's "two things nobody has done" is
  still accurate.
- **MAR-588's real-channel Discord proof was not attempted.**
- MAR-489 promotes nothing. The epic MAR-481 does not close.

## Deviations from the runbook, stated plainly

1. The host is the **reinstalled 2026-08-08 box**, not a newly rented one.
2. The journey agent declares an OpenRouter connection that **was hand-authored
   during this run**, because no producer emits one (finding 14). Its Gmail
   connection and its `model_tier: frontier` step came from the MCP export
   unmodified.
3. `agent.display_name` was hand-added for the same reason (finding 10).
