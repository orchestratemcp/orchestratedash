# Handoff — the 2026-08-10 attended run, paused

Written when Henrik stopped the run to have the findings fixed before retesting
tonight. **Nothing was promoted. MAR-489 is not closer to proven than it was
this morning**, and the runbook's status header now says so.

The full run log is [`mar-489-attended-run-2026-08-10.md`](mar-489-attended-run-2026-08-10.md).
This file is the shorter thing: where everything stands, what has to be built,
and the prompts for the sessions that build it.

---

## Where things stand right now

| | |
| --- | --- |
| `master` | `007487d` — moved mid-session (PRs #122, #123 merged by another session) |
| Verified commit | `be90d84`; **`runner_build` is identical on both** (`da222f419086048178d2`), and `git diff be90d84 007487d -- runner lib contracts` is empty |
| Preconditions | **all pass** — 2814 tests, `verify:shell` 85 PASS / 0 FAIL, from PowerShell |
| Proven this run | **`V-A1` only** (import through the real consent dialog) |
| Not run | `V-A2`–`V-A5`, and **all of `V0`–`V10`** |
| DASH | running, real store, runner pid 6336 build `da222f419086048178d2` |
| `support-mail-digest` | registered and running (pid 3680); Henrik was mid-Remove when we stopped |

### Machine state a new session inherits

- **`runner.sqlite` was malformed again** and is set aside in
  `%APPDATA%\orchestratedash\runner-sqlite-malformed-20260810\` (renamed, not
  deleted). A fresh runner then started clean. This is the **second** occurrence;
  the first was 2026-08-06.
- An orphan runner from the `dash-mar592` worktree was retired through its
  **authenticated `POST /shutdown`** (fingerprint verified before the credential
  was presented). No `Stop-Process` was used anywhere in this session.
- A stray Electron (pid 37844) from a scratch-store launch may still be alive. It
  holds neither the real store nor its pipe.
- **The VPS `186.240.156.166` was reinstalled with Ubuntu 24.04 today.** Host keys
  regenerated — `SHA256:l9Jnm…` → `SHA256:SjJ57mMX3zVh7iIvu2BRUxp/1DQEAQ1VhsNv17mS6vo`.
  It is a genuine first-contact box and is **waiting, unused**.
- **The five stale host rows and three hand-written `known_hosts` lines for that
  address were NOT cleared.** They must be forgotten through the product before
  any `V2`, or `pinHostKey` will refuse with `already_pinned_differently`.

---

## The eighteen findings

Grouped by what has to change, not by discovery order.

### A. The contract specifies surfaces nothing feeds — the biggest theme

**F4 · `default_model_level` emitted by nothing.** Schema has
`["cheap","standard","frontier"]`; the MCP export has **zero occurrences**.
`lib/ai/model-levels.ts` reads only this field and refuses to fall back to
`model_tier`, so MAR-583's per-step model choice never appears.

**F5 · `agent_dom.connection_requirements` emitted by nothing.** Schema has
`["google_oauth_broker","api_key"]` (MAR-569). Export has **zero occurrences**.
MAR-570's requirement card has nothing to render, so `V-A2`/`V-A3` are
unperformable as the runbook words them.

**F14 · No manifest anywhere declares a model provider, so there is nowhere to
paste an OpenRouter key.** MAR-582's `AiKeyConnectionView` renders only for a
connection whose `provider` matches `AI_PROVIDER_IDS` **and** which has a
`secret` field. No example, fixture, Agent Kit template or MCP export declares
one. What a person sees instead is the *derived* "Model provider" row
(`source: derived_from_plan`, `requires_secret_input: false`) whose own copy says
*"DASH shows this so the list is complete"* — a disclosure with no button.
**Henrik's words: "nowhere to connect".**

**F6 · An MCP-planned AI step cannot be implemented through DASH.** The planner
emits `model_tier: frontier` steps; `BrokerOrigin` refuses an agent a completion
by origin. The agent cannot perform the step its own manifest declares.

**F7 / F10 · The MCP export carries no `agent_dom.panel` and no
`agent.display_name`**, so MCP-planned agents get no designed workspace and
appear under a machine slug.

### B. DASH bugs

**F12 · The main process crashes on a logging write.** `Uncaught Exception:
Error: EPIPE: broken pipe, write … at console.warn … main.mjs:27245`. Any user
starting DASH from a terminal they then close can hit this.

**F11 · Two launch paths silently use different data directories.** `electron .`
→ `%APPDATA%\orchestratedash`; `electron dist/electron/main.mjs` →
`%APPDATA%\Electron`. During this run that produced a DASH showing 3 agents / 0
hosts while the real store had 5 / 5, and agent removals that appeared not to
stick. **The most dangerous finding for MAR-489**, because "a clean DASH" can be
satisfied by accident. Related: as `electron .` DASH logs *"not claiming dash://
from ."*, so in the dev path claiming the protocol and using the real store are
mutually exclusive. Workaround: `electron . "dash://…"` (single-instance forwards
argv). Packaged installs are unaffected.

**F13 · The Agents list does not refresh when an agent is added.** Henrik: *"but
wasnt there. swaped view back n forth and it showed up"*.

**F15 · Updating a running agent fails to copy, with a misdiagnosing message.**
*"DASH could not finish copying … so it was not added."* The cause is that the
agent runs from `agents/<id>/code/`, the directory being replaced, and Windows
will not overwrite files a live process holds. It never says "stop the agent
first", and the scaffold README promises the opposite.

**F18 · There is no removal control on an agent at all.** Henrik wants **two**
distinct actions: *remove from DASH*, and *remove and delete all its files*. The
backend exists (`removeAgentWithReport`, `lib/agent-folders.ts`); no UI reaches it.

**F16 · Google sign-in does not persist.** After signing in, `connection_secrets`
holds **no row** for the agent and `broker_grants` is **empty**; the agent's own
run reported *"Gmail is not connected yet"*. The card is telling the truth. This
is the known real-Google gap (`loopback-fixtures-cannot-refuse`), not a stale
badge — **and it is the largest single item in this list.**

**F17 · `ai-news-scout` outputs fixture data, not news.** Its digest reads *"DASH
local rss item 3 6c87474c" · Local RSS · 2 August 2026*. The one agent described
as DASH's real test agent is reading local fixtures.

**F9 · `open-in-dash` refuses an agent missing a scaffold file it does not use.**
`AGENT_KIT_PROJECT_FILES` is a fixed list including `sources.json`; deleting it
after rewriting the agent — which the README invites — makes the agent
unimportable with *"This agent's build is incomplete… Build it again"*.

### C. The planner (different repository: `orchestratekit-mcp`)

**F1 · The matcher keys on bare English words.** `out` (from "out of my Notion
database") pulled in four components; `write`→`audit_log`; `read`→`reviewer_notification`.

**F2 · A goal explicitly asking for a summary produced `model_tier: "none"` on
every step** — the AI step vanished.

**F3 · `safety_review` reports a phantom blocker and contradicts the field beside
it.** On a read-only route it says *"External write/send/publish action detected
without a human approval gate"* and the card prints *"unattended blocked"*, while
`automation_clearance.autonomous_allowed` is `true` in the same response.

### D. Runbook corrections (already applied)

**F8** · `scripts/runner-build-id.mjs` is a module with no CLI and hashes source,
not `dist/`. **Plus:** the runbook's P1/P2 "hard blocker" section was stale —
MAR-579, MAR-577 and MAR-570 have all merged. Both corrected in this pass.

---

## Henrik's new test plan, and what blocks each step

> 1. Clear dash from all agents and settings.
> 2. Configure dash — sign in to Google, add OpenRouter, Discord webhook and VPS server.
> 3. Connect MCP; in a new session plan an agent from a simple goal.
> 4. Follow interview with DASH.
> 5. Build the agent. 6. Import. 7. Test. 8. Push it to VPS. 9. Test.

| Step | Blocked by | Size |
| --- | --- | --- |
| 1 | **F18** — no removal control, and no "clear settings" anywhere | small UI over existing backend |
| 2 | **THE ARCHITECTURAL ONE (below)**, plus F16 (Google), F14 (OpenRouter home) | large |
| 3 | F1, F2, F3 — other repo | medium, other repo |
| 4 | nothing — `question_flow` works; rendering is the client's job | — |
| 5 | F9 | small |
| 6 | works (`V-A1`); F13, F15 make it unpleasant | small |
| 7 | depends on step 2 | — |
| 8 | nothing known — the deploy plane is complete and MAR-577/579 shipped | unproven, not blocked |
| 9 | depends on 8 | — |

### The architectural decision step 2 forces

**Today, connections exist only because an agent declared them.** `lib/connections.ts`
derives every row from `agent_dom.connections` plus a derived model-provider row
from `planned_route[].model_tier`, and `connection_secrets` is keyed **by agent**.

Henrik's step 2 says *configure DASH first, with no agents present*. In the
current model there is then **nothing to configure** — the Connections page would
be empty, which is exactly what he hit today.

So step 2 requires **fleet-level connections that exist independently of any
agent**, with per-agent grants resolved against them. That is a real design
change, not a settings re-skin, and it is the single most important decision for
the next session. It also subsumes F14: a global OpenRouter key has an obvious
home the moment connections are fleet-level.

**Do not start building the settings page until this is decided**, because the
page's whole shape depends on the answer.

### MAR-592 already exists — read it before rebuilding it

Branch `000henrik/mar-592-settings-tabs`, worktree
`C:\Users\henri\Desktop\projekt\MCP\dash-mar592`, **PR #124 with CI green**
(verify + shell-smoke 85 PASS / 0 FAIL). 124 files, 3685 insertions, including
`tests/settings-tabs.test.tsx`. Henrik's requested sections are: **Connections ·
VPS/Servers · AI (OpenRouter + model choice) · Notifications/chat · app
preferences (dark mode etc.)**. Check what #124 already covers before writing
anything new.

---

## Session prompts

### Session 1 — the architecture decision, then the settings page (LEAD)

- **Client / model:** Claude Code, `--model opus` (`claude-opus-5`), extended
  thinking. *Per `claude-first-model-routing`: Claude Max capacity outweighs
  Codex, so AGENTS.md's Codex-default table is deliberately not followed here.*
- **Repo / branch:** `orchestratedash`, new branch off `007487d`; **owns**
  `lib/connections.ts`, `lib/connection-*.ts`, `lib/ai/**`, `app/connections/**`,
  and the settings surface. Read `dash-mar592` but **do not edit that worktree**.
- **Linear:** MAR-592, plus a new child for fleet-level connections.
- **Objective:** decide and implement whether connections become fleet-level
  entities with per-agent grants, then land the settings page over that model.
- **Start checks:** `git rev-parse HEAD`; read PR #124's diff; `pnpm state:check`.
- **Verify:** `pnpm verify` **from PowerShell** with DASH closed.
- **Non-goals:** the Google OAuth fix (session 2), anything in `runner/`.

### Session 2 — the DASH bug batch

- **Client / model:** Claude Code `--model sonnet` — bounded, mechanical, each
  fix has a named file and a test.
- **Scope:** F12 (EPIPE crash), F13 (list refresh), F15 (copy-while-running
  message + guidance), F18 (the two removal actions), F9 (`AGENT_KIT_PROJECT_FILES`),
  F10/F7 (display-name fallback so a slug never shows).
- **Owns:** `electron/main.ts`, `agent-kit/**`, `app/agents/**`. **Must not**
  touch `lib/connections.ts` — session 1 owns it.
- **Verify:** `pnpm verify` from PowerShell; add a regression test per fix.

### Session 3 — Google OAuth against real Google (hardest)

- **Client / model:** Codex `gpt-5.6-sol`, xhigh — this is a security boundary
  plus installed-runtime proof, which is exactly its lane.
- **Objective:** make F16 real. `loopback-fixtures-cannot-refuse` records that
  DASH's OAuth has **never** worked against real Google and no gate could see it.
  Needs a real Google Cloud OAuth client, the consent screen, and a test user.
- **Exit evidence:** a `connection_secrets` row and a `broker_grants` row for a
  real account, plus one real `gmail.search` in `broker_audit`.

### Session 4 — the MCP emitter and planner (different repository)

- **Client / model:** Codex `gpt-5.6-sol`, high.
- **Repo:** `orchestratekit-mcp`. **Owns nothing in `orchestratedash`.**
- **Scope:** emit `default_model_level` (F4), `connection_requirements` (F5),
  `agent.display_name` (F10), `agent_dom.panel` (F7), and a declared model-provider
  connection (F14); fix the word-overlap matcher (F1), the vanishing AI step (F2)
  and the phantom safety blocker (F3).
- **Coordination:** F14's manifest shape must match whatever session 1 decides
  about fleet-level connections. **Session 1 decides; session 4 follows.**

### Coordination rules

Sessions 1 and 2 are in the same repository and **must not run simultaneously on
the same files** — 1 owns `lib/connections.ts` and `lib/ai/**`, 2 owns
`electron/main.ts` and `agent-kit/**`. Sessions 3 and 4 are independent. Two live
sessions must never edit the same worktree.

---

## Before the next test run

1. **Forget the five host records** for `186.240.156.166` through the product, so
   `V2` is a genuine first pin. The box is already reinstalled and waiting.
2. **Do not launch DASH as `electron dist/electron/main.mjs`** (F11). Use
   `pnpm shell` with `DASH_SHELL_URL='dash-app://ui/'` if there is no dev server,
   and confirm the store line reads `…\orchestratedash` before trusting anything
   on screen.
3. **Watch for `runner.sqlite` going malformed a third time.** Twice in five days
   is a pattern, not an accident, and nobody has found the cause.
4. Expect `V-A2`/`V-A3` to stay unwitnessable until session 4 ships the emitter.
