# Lane F — MAR-876: DASH MCP interviews the person before building an agent (UX-2)

Tier: Opus (a new interaction contract between a host assistant and an MCP
server, with judgment on what to ask and what to refuse). Read
`ux-lanes-common.md` beside this file first.

Worktree: `C:\Users\henri\AppData\Local\Temp\wt-ux876-s1`
Branch: `000henrik/mar-876-builder-interview` — **stacked on lane B's branch**
`000henrik/mar-878a-template-model-provider` (PR #320, head `d174d01`), which
already makes the scaffold declare a `model_provider` connection and a
`model_provider` scaffold option. Your PR still targets `master`. If #320
merges first, `git merge origin/master`; never rebase.
Issue: MAR-876 (https://linear.app/martini-home/issue/MAR-876). Its text:

> Current skill jumps directly to scaffold/edit/validate/install. Add an
> adaptive interview for outcome, sources, result format, trigger, autonomy
> and destination; ask cloud location only when relevant. Skip answered
> questions. One question or two related questions at a time; suggested
> defaults, free text, back/change, resumable draft and one editable recap.
> Surface unsupported features honestly. The host coding assistant presents
> native questions with text fallback; DASH MCP owns structure and
> validation. Reuse the real validator and staging/import tools. Credentials
> stay in DASH. Never write installed agent folders. Imports stay idle;
> requested schedules remain intent until explicitly activated after
> setup/first run. Acceptance: vague and fully specified requests, changed
> answers, resume and unsupported-feature cases produce consistent validated
> plans. Fresh agent imports, stays idle, connects declared requirements and
> completes manual run. Route matches telemetry. No surprise
> posting/deployment/scheduling. Model-provider declarations coordinate with
> the MAR-873 successor (that is lane B, already under you); adoption is
> explicit under ADR 0013.

## What exists (orchestrator-verified)

`tools/dash-mcp/` — `src/{server,agent-tools,scaffold,validate,handoff,open-in-dash,paths,main}.ts`,
`skills/building-a-dash-agent/SKILL.md`, `template/{agent.mjs,brief-fingerprint.mjs}`,
seven test files under `tests/`. MCP tools today: `dash_agent_scaffold`,
`dash_agent_validate`, `dash_agent_install`. The scaffold request type is in
`scaffold.ts` (`planScaffold`, `scaffoldManifest`); validation is DASH's own
(`lib/contracts`, `lib/manifest-constraints`, `lib/import-feedback`) and must
stay the only authority. ADR 0032 locates the builder here; OrchestrateKit-MCP
(`C:\Users\henri\Desktop\projekt\MCP\orchestratekit-mcp`) is read-only and
must not be extracted or duplicated. What the template can actually do is
bounded: fetch feeds (`sources.json`), compose a brief, write a digest;
runtime local; optional model provider for questions. Everything else
(Slack, arbitrary APIs, browsing, writing prose documents, posting anywhere)
is **unsupported** today and the interview must say so rather than promise.

## Design (orchestrator defaults; record deviations)

1. **Interview state lives in DASH MCP, presentation lives in the host.** Add
   two tools:
   - `dash_agent_interview` — input: `{ draft_id?, answers: {...}, action?: "next" | "back" | "recap" | "reset" }`;
     output: `{ draft_id, questions: [ { id, prompt, kind: "choice" | "text" | "confirm", options?: [{value,label,default?}], why } ] (1–2 at a time), answered: {...}, recap?: {...}, unsupported: [ {asked, why_not, nearest_supported} ], ready: boolean }`.
     The server decides which question is next from what is still unanswered
     (outcome → sources → result format → trigger → autonomy → destination →
     cloud only if trigger/destination needs a host). A fully specified
     opening answer (free text mentioning sources, cadence, destination)
     pre-fills answers by simple, explicit parsing (no LLM inside the MCP);
     ambiguous parses become questions, never guesses.
   - `dash_agent_plan` (or fold into `interview` with `action: "recap"`) —
     turns the answers into the exact `scaffold` request plus a human recap
     (name, what it collects, how often, where results go, what it will NOT
     do), which the host shows once for editing before `dash_agent_scaffold`.
   Drafts persist as JSON under the caller-chosen project directory
   (`<dir>/.dash/interview-<draft_id>.json`), never under DASH's data dir
   or any installed agent folder; `resume` = pass the `draft_id` again.
2. **Trigger/destination are intent, not activation.** A requested schedule
   is written into the manifest's declared trigger description / README as
   intent; the scaffold never sets an active schedule, never posts, never
   deploys. Destination "Discord" → the recap says "DASH can alert you in
   Discord after you connect it in Settings → Notifications"; "Slack" →
   unsupported, nearest supported = Discord alerts or a saved file.
3. **Host presentation.** Update `SKILL.md` so the assistant: calls the
   interview tool first; presents each returned question with the host's
   native question UI when it has one (Claude Code: `AskUserQuestion`,
   options from `options`, default marked) and falls back to plain text
   otherwise; passes answers back verbatim; shows the recap and asks for
   edits before scaffolding; then follows the existing
   scaffold → validate → install → open-in-DASH path unchanged. Include a
   worked transcript for the vague case ("keep an eye on AI news for me") and
   the fully specified case.
4. **Validation authority unchanged.** The plan's scaffold request must go
   through the same `verdictForManifest` double-check; the interview adds no
   second validator. Never request or store secrets in the interview; a
   provider choice is only the `model_provider` option lane B added.
5. **Route matches telemetry**: the recap's stated route must be the
   `planned_route` the manifest declares (the template's three steps);
   assert it in a test by comparing the recap to `scaffoldManifest(request)`.

## Ownership (write)

`tools/dash-mcp/**` (src, tests, skills, README, dist if committed). New
tests under `tools/dash-mcp/tests/`: interview state machine (vague, fully
specified, changed answer via `back`, resume from a draft file, unsupported
feature recorded), plan ↔ scaffold consistency, server exposes the new tools
with schemas, existing seven files still green. Nothing in `app/`, `lib/`,
`electron/`. Do not touch OrchestrateKit-MCP.

## Verification / evidence

`pnpm typecheck`; `pnpm vitest run tools/dash-mcp/tests`; `pnpm test` once
from PowerShell (the `template-run.test.ts` EPERM cleanup flake under full
load is known; re-run it alone). Optionally run the MCP server locally
(`node tools/dash-mcp/launch.mjs` or whatever `README.md` documents) and
drive `dash_agent_interview` by hand with a JSON-RPC client script in your
worktree to paste a real transcript into the handoff. Evidence class:
fixture tests + a hand-driven server transcript. The host-side transcript
(a real Claude Code session using the skill) and the DASH import/first-run
proof are the orchestrator's.

Stop condition: PR open (`feat(mar-876): dash-mcp interviews before it
builds`), tests green, `docs/mar-876-handoff.md` written with the worked
transcripts.
