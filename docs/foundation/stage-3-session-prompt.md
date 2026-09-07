# Lane F3 — MAR-889: real hierarchical traces in the existing run inspector

Tier: Opus (a new versioned side channel through runner → DASH → view, with
compatibility for every older consumer). Read `ux-lanes-common.md` first;
base branch is `codex/agent-foundation` AFTER stage 1 (MAR-887) merged, so
`agent-kit/template/dash-agent-sdk.mjs` exists — read it and
`docs/adr/0034-*.md` before anything else.

Worktree: `C:\Users\henri\AppData\Local\Temp\wt-f3-s1`
Branch: `000henrik/mar-889-run-traces`. PR targets `master`.
Issue: MAR-889 (epic MAR-886). Plan: `C:\Users\henri\Documents\DASH-agent-foundation-claude-plan.md`
"Etapp 3" (Swedish; acceptance repeated below).

## Ground truth (orchestrator-mapped 2026-09-07; verify)

- No span/trace/parent concept exists anywhere. Correlation today = `run_id`
  + monotonic `seq` on telemetry v1 events (`contracts/run-event.schema.json`:
  seven types, `event_version` const 1, `detail` ≤ 300, unknown fields
  tolerated — `tests/contracts.test.ts:200`) and `component_id` as step
  identity. `events` table (`lib/db.ts:167`) stores the event JSON whole;
  `runs` is identity only; status is derived at read time. No retention sweep
  exists although `docs/telemetry-contract-v1.md:59-62` documents one.
- Runner channel: NDJSON stdin/stdout (`runner/protocol.ts`, `AGENT_PROTOCOL_VERSION = 1`;
  `parseAgentMessage` drops unknown types); bounded buffers in
  `runner/supervisor.ts:396-490`; drains `POST /telemetry/drain`, `/artifacts/drain`,
  `/broker/drain` (`runner/server.ts:701-820`); DASH side `drainTelemetry` in
  `lib/agent-dom/evidence.ts:181-217` → `ingestEvents` (`lib/store.ts:1101`).
- Run views: `runView` (`lib/views/build.ts:438-533`) → `app/runs/detail/page.tsx`
  (model line, plan-vs-actual, outputs, planned route, then a flat `<ol>` of
  events at `:196-246`); agent page run stage = `RunProgress`
  (`lib/views/run-progress.ts`, no clock times by design), `LiveFeed`,
  `AgentTelemetry` (`lib/views/agent-feed.ts` meters; a meter with no data is
  omitted, never zero). Health (`lib/views/agent-health.ts`, MAR-645) and the
  overview checklist keep their responsibilities.
- Secrets: `tests/redaction.test.ts`, `tests/contracts.test.ts:38-85`
  (`forbiddenCredentialKeys`, `obviousSecretValues`, `securityViolations` over
  every example), smoke 7i/7j; `docs/telemetry-contract-v1.md:20-22`.
- Model usage: DASH never computes a price. Agent-reported `tokens_in/out`,
  `cost_usd` on events (worded "the agent's own figure"); provider-stated
  charges on ask/chief (`lib/ai/ask.ts:383-403`).
- Migration indexes are a serial resource: find the pin in
  `tests/store-sqlite.test.ts` (grep the literal `user_version` / MIGRATIONS
  length pin) and use the next index; report it in the handoff.

## Design (orchestrator decision)

1. **Spans travel on a versioned side channel, not inside telemetry v1.**
   New agent→runner message `{ type: "trace", span: {...} }` with
   `trace_version: 1`; new bounded supervisor buffer; new
   `POST /traces/drain`; DASH `drainTraces` → `ingestSpans` → new table
   `run_spans`. Telemetry v1 events are byte-for-byte unchanged; the only
   additive touch allowed on an event is an optional `span_id` on
   `step_started`/`step_completed` for correlation (keep
   `tests/contracts.test.ts` and `lib/analyze.ts` untouched in meaning). Old
   runners lack the route → DASH reads "no spans" and the view says so; old
   agents emit no `trace` lines → same. A new `contracts/run-span.schema.json`
   (v1) with `validateSpan` in `lib/contracts.ts`; check how
   `contract.lock.json` treats a NEW schema file and follow it.
2. **Span shape (minimal):** `trace_version`, `agent`, `run_id`, `span_id`,
   `parent_span_id | null`, `name` (display), `kind` ∈ `run | step | source_fetch | broker | browser | artifact | custom`,
   `started_at`, `ended_at | null`, `status` ∈ `ok | error | cancelled | unknown`,
   `error: { code, message ≤ 300 } | null`, `attributes` (object, allowlisted
   keys only, values ≤ 200 chars, no free payloads), `usage: { tokens_in, tokens_out, cost_usd, source: "reported" } | null`.
   Full input/output payloads are NOT captured; an explicit opt-in is a
   later packet; never model reasoning.
3. **Instrumentation lives in the SDK** (`dash-agent-sdk.mjs`, stage 1's
   file): the run span, one span per `step()`, one per `ask()` (broker) and
   `browse()`, one per artifact emission, and a helper `span(name, fn)` for
   task code that wants sub-spans (async + concurrent safe: parent taken from
   the calling context, not a global). Retries: a retried operation is a new
   child span with `attributes.attempt`. Cancel → `cancelled`.
4. **Persistence and limits:** `run_spans` table (agent, run_id, span_id PK,
   parent_span_id, name, kind, started_at, ended_at, status, error_json,
   attributes_json, usage_json, received_at) with per-run cap
   (`MAX_SPANS_PER_RUN = 2000`, excess counted in a `dropped` counter the view
   shows) and a bytes cap on the runner buffer like telemetry's. Secret
   filter before insert: reuse the same rules `tests/contracts.test.ts`
   applies (forbidden keys dropped, obvious secret values replaced with
   `[redacted]`), with a test that a `Bearer …` in `error.message` never
   reaches the row.
5. **View:** `lib/views/run-trace.ts` builds a tree + timeline from spans
   with explicit incompleteness: `missing_parent` spans attach under a
   synthetic "unknown parent" node, unfinished spans show `unknown`,
   `dropped > 0` shows a line, and a run with zero spans shows "This run has
   no step trace" (older agent) — never a fabricated graph. The run detail
   page gets a "Steps and operations" section (tree with status, duration,
   error message, usage where reported) ABOVE the existing flat events list,
   which stays. The agent page's run stage and health stage are not changed
   except that `RunProgress` may take a failed span's error text as its
   `detail` for the failed step if that is a one-line change; otherwise leave
   it. A normal user sees task, status and result first.
6. Copy in `lib/copy/run-trace.ts`, enumerated for the plain-language gate;
   no raw ids in primary copy (span ids behind the developer disclosure).
7. Traces never claim the result is true — the copy says what was done and
   what failed, not that it was correct.

## Acceptance (from the plan)

A real error and a real retry show on the right step with the right result
(test with a fixture agent whose source fetch fails once then succeeds); no
secret markers in stored telemetry or UI; older agent runs (fixtures under
`.data/agents`, `conformance/`) render without regression; traces do not
claim the result is true.

## Ownership (write)

`runner/protocol.ts`, `runner/supervisor.ts`, `runner/server.ts`,
`lib/agent-dom/evidence.ts`, `lib/db.ts` (one migration), `lib/store.ts`,
`contracts/run-span.schema.json`, `lib/contracts.ts` (additive),
`agent-kit/template/dash-agent-sdk.mjs` (instrumentation only — keep every
existing message identical), `lib/views/run-trace.ts` (new),
`lib/views/build.ts` (runView gains `trace`), `lib/views/types.ts`
(additive), `app/runs/detail/page.tsx`, `app/_components/run-trace.tsx`
(new), `lib/copy/run-trace.ts`, `docs/telemetry-contract-v1.md` (a section
on the side channel), tests: new `tests/run-trace*.test.ts`,
`tests/runner-protocol.test.ts`, `tests/runner-telemetry.test.ts`,
`tests/store*.test.ts` (migration pin), `tests/contracts.test.ts` (new
schema), `tests/views.test.ts`, plus `electron/smoke.ts` ONE new proof that
the sample's run has spans on the installed shell (numbered after the last
6* proof). `app/globals.css`: append-only fence. NOT: `lib/analyze.ts`,
`lib/views/run-progress.ts` beyond the one-line detail, `lib/views/agent-health.ts`,
`lib/broker/**`, `contracts/run-event.schema.json`.

## Verification

Typecheck; focused tests; full `pnpm test` from PowerShell; `pnpm build:shell`;
the shell smoke on a scratch store (`--user-data-dir=<scratch>\orchestratedash`,
output to a file, 86/86 with your new proof); retire the runner. Evidence
class: fixture tests + installed-style shell on a scratch store. Henrik's
build is the orchestrator's.

Stop condition: PR open (`feat(mar-889): run traces — a versioned span side
channel and a tree in the run inspector`), green, `docs/foundation/stage-3-handoff.md`
naming the migration index, the new proof number and what older consumers
do. Wait for `%TEMP%\wt-f3-s1-install.done` before running node/pnpm.
