# Telemetry contract v1

The seam between three parties that never share code:

1. **OrchestrateKit MCP** (stateless, advisory) — *emits* an agent manifest inside
   `export_build_brief`, and writes event-wiring instructions into the build brief.
2. **The built agent** (lives anywhere) — *sends* run events over plain HTTP.
3. **DASH** — *receives* events, joins them to the manifest, renders plan-vs-actual.

Design rules:

- **Additive versioning.** `manifest_version` / `event_version` integers; consumers
  ignore unknown fields. Breaking changes bump the version. The JSON Schemas in
  `contracts/` deliberately leave `additionalProperties` open at every level so a
  future additive field never fails validation for an older consumer.
- **The MCP stays stateless.** It never talks to DASH; the manifest is data inside
  the brief, exactly like the matcher-corpus fixture discipline.
- **Events are fire-and-forget.** An unreachable DASH must never break an agent
  run: the brief instructs builders to wrap emission in a non-fatal try/catch.
- **No secrets in events.** Payloads carry ids, statuses, counts, costs — never
  message bodies, tokens, or credentials. `detail` is a short human hint, and the
  brief instructs builders to keep PII out of it.

## Canonical conformance assets

DASH is the canonical owner of telemetry contract v1. Consumers copy three
code-free assets rather than importing DASH application code:

- `contracts/agent.manifest.schema.json`;
- `contracts/run-event.schema.json`;
- `contracts/contract.lock.json` and `conformance/v1/*`.

The lock stores whitespace-independent SHA-256 fingerprints for both schemas.
Every producer/consumer CI validates the same synthetic MAR-363 manifest and
run sequence, including monotonic sequence numbers and a resolved gate before
each irreversible component starts. The fixture contains no prompts, message
bodies, credentials, or personal data.

Additive fields remain compatible with v1 because schemas accept unknown
fields. A removed or renamed required field, enum change, or semantic ordering
change requires a new integer contract version and a new conformance folder;
do not silently rewrite the v1 lock or fixtures.

## Additive Agent DOM successor

Telemetry v1 remains frozen and valid. The additive Agent DOM contract uses a
separate `manifest_version: 2` schema while retaining these required telemetry
fields and the `event_version: 1` run-event stream. A v1 manifest is interpreted
as telemetry-only and read-only; controls are never inferred. See
[`agent-dom-contract-v2.md`](agent-dom-contract-v2.md) for version dispatch,
compatibility, command security, and trust boundaries.

## Decisions (settled in DASH-01 / MAR-295)

1. **Ingest auth: static bearer token per agent.** One long-lived token per agent,
   read from `token_env` in the manifest. Simplest option and matches DASH's
   local-first, never-hosts posture; per-run tokens would need a token-issuing
   endpoint that a self-hosted, single-operator tool doesn't need yet.
2. **Events retention: time-based, 90 days.** The SQLite events table prunes rows
   older than 90 days on a scheduled sweep (mirrors the Lab's local-first storage
   model). Bounded DB size, enough history for trend/drift review, no retention
   config surface to expose in v1.
3. **`gate_resolved` does NOT carry approver identity in v1.** It records the
   decision (approved/rejected) and timestamp only — omitting *who* keeps the
   event schema free of PII-adjacent data by default. Revisit as an opt-in config
   flag later if gate-compliance auditing needs an identity trail.
4. **Lab forwarding is a run *summary* → `needs_rating` candidate, never raw
   events.** Preserves the [[architecture-boundary-mcp-vs-lab|MAR-129 boundary]]:
   the Lab stays human-gated, and DASH never streams unrated volume into the
   steward queue.

## agent.manifest.json

Produced by `export_build_brief` (one file per planned agent). Imported into DASH
by upload or paste. Schema: [`contracts/agent.manifest.schema.json`](../contracts/agent.manifest.schema.json).
Example: [`examples/agent.manifest.example.json`](../examples/agent.manifest.example.json).

```jsonc
{
  "manifest_version": 1,
  "agent": {
    "name": "email-lead-to-crm",           // slug the user confirms at plan time
    "goal": "Read inbound email, detect sales leads, ...",
    "plan_source": "playbook",              // "playbook" | "composed"
    "playbook_id": "email_lead_to_crm",    // "" when composed
    "route_id": "email_lead_crm_route_v1", // "" when composed
    "build_target": "cursor"                // cowork | cursor | chatgpt_gpt | code
  },
  "planned_route": [
    { "step": 1, "component_id": "email_read", "risk_level": "low",  "model_tier": "none" },
    { "step": 2, "component_id": "schema_validation", "risk_level": "low", "model_tier": "none" }
    // ... full route, same order as the plan's execution_order
  ],
  "safety_contract": {
    "automation_clearance": "L3",           // L0–L4 from the plan
    "enforced_approval_gates": ["human_approval_gate"],
    "irreversible_components": ["crm_note_write", "optional_email_send"]
  },
  "monitoring": {
    "events": ["run_started", "step_started", "step_completed",
               "gate_requested", "gate_resolved", "run_completed", "run_failed"],
    "endpoint_env": "DASH_INGEST_URL",      // agent reads these from env
    "token_env": "DASH_INGEST_TOKEN",       // static bearer token (decision 1)
    "output_location": "HubSpot notes + Gmail drafts"  // free text from the
    // plan-time question "where does this agent's output land?"
  },
  "provenance": {
    "generated_by": "orchestratekit-mcp export_build_brief",
    "registry_fingerprint": "b0393a8cefd43669",
    "generated_at": "2026-07-04T00:00:00Z"
  }
}
```

## Run events

`POST {DASH_INGEST_URL}/api/events` with `Authorization: Bearer {DASH_INGEST_TOKEN}`.
One JSON object per event (batching: array accepted, each item validated
independently). Schema: [`contracts/run-event.schema.json`](../contracts/run-event.schema.json).
Example: [`examples/run-event.example.json`](../examples/run-event.example.json).

```jsonc
{
  "event_version": 1,
  "agent": "email-lead-to-crm",   // manifest agent.name
  "run_id": "2026-07-04T09-15-abc123",  // any unique-per-run string
  "seq": 3,                        // monotonically increasing within the run
  "ts": "2026-07-04T09:15:12Z",
  "type": "step_completed",        // one of monitoring.events
  "component_id": "email_draft",  // planned_route id when the step maps to one;
                                   // free string when the build drifted (DASH
                                   // renders unmapped ids as drift)
  "status": "ok",                 // ok | error | skipped | pending
  "model": "anthropic/claude-sonnet-4-6",  // OpenRouter model slug when an LLM ran
  "tokens_in": 1420,
  "tokens_out": 310,
  "cost_usd": 0.0041,              // OpenRouter generation cost when available
  "detail": "draft created for lead acme.com"  // short, no PII, no bodies
}
```

Event-type semantics DASH relies on:

| type | meaning / what DASH checks |
| --- | --- |
| `run_started` / `run_completed` / `run_failed` | run lifecycle; wall-clock + outcome |
| `step_started` / `step_completed` | joined to `planned_route` → plan-vs-actual & ordering drift |
| `gate_requested` / `gate_resolved` | **gate compliance**: an irreversible component's `step_started` without a preceding resolved gate = red badge |

## The run-span side channel (MAR-889)

Telemetry v1 remains frozen, and this is what that costs and what it buys.

A run's *trace* — the tree of operations a run actually performed, with an error
and a duration on each — travels on a **separate contract, a separate message
and a separate route**. It is not an eighth event type, and the reasons are two
this document has already committed to elsewhere:

1. `contract.lock.json` fingerprints `run-event.schema.json`, and every producer
   and consumer outside this repository validates against it. Widening the type
   enum is a breaking change to a contract DASH does not own both ends of, and
   "a removed or renamed required field, enum change, or semantic ordering
   change requires a new integer contract version" is this document's own rule.
2. DASH derives a run's status from its events at read time. A span arriving as
   an event would be a *description of the work* able to change what DASH says
   the work was.

### The shape

Schema: [`contracts/run-span.schema.json`](../contracts/run-span.schema.json)
(`trace_version: 1`, its own integer, independent of `event_version`). Example:
[`examples/run-span.example.json`](../examples/run-span.example.json). It is
**not** in `contract.lock.json`, for the reason `run-artifact.schema.json`,
`agent-dom-state.schema.json` and `agent-command.schema.json` are not: the lock
is telemetry v1's, and a lock over a schema no third party validates against is
a ceremony rather than a guard.

```jsonc
{
  "trace_version": 1,
  "agent": "email-lead-to-crm",
  "run_id": "2026-07-04T09-15-abc123",   // the same run the events name
  "span_id": "s-4",
  "parent_span_id": "s-2",   // required member; null means "this is the root"
  "name": "Read the lead's mailbox",     // for a person, not an identifier
  "kind": "broker",          // run | step | source_fetch | broker | browser | artifact | custom
  "started_at": "2026-07-04T09:15:12Z",
  "ended_at": "2026-07-04T09:15:14Z",    // null while the operation is open
  "status": "ok",            // ok | error | cancelled | unknown
  "error": null,             // { code, message ≤ 300 } — `detail`'s own bound
  "attributes": { "operation": "gmail.search", "attempt": 2 },
  "usage": { "cost_usd": 0.0041, "source": "reported" }
}
```

### What it deliberately cannot carry

No inputs, no outputs, no reasoning. There is no member a prompt, a page body or
a mailbox could arrive in, and `attributes` is not an escape hatch: DASH keeps
an **allowlist** of keys and drops every other one, bounds each value at 200
characters, and applies the same forbidden-key and obvious-secret-value rules
`tests/contracts.test.ts` applies to every example in this repository — so a
`Bearer …` in `error.message` becomes `[redacted]` before the insert, proven
against the bytes SQLite wrote. Capturing payloads is a later packet with its
own opt-in, and this schema is not shaped to make that a small change.

### The path, and what an older participant does

`{ type: "trace", span }` on the runner's stdin/stdout pipe → a bounded
supervisor buffer of its own → `POST /traces/drain` on the runner's own
authenticated channel → `ingestSpans` → the `run_spans` table.

Each span is sent **twice**: once when the operation opens, once when it closes.
DASH keys on `(agent, run_id, span_id)` and upserts, so a run in flight has a
tree, and a span whose closing message never arrived keeps `ended_at: null` and
`status: "unknown"` for good — which DASH says on the page rather than
completing the shape.

- An **older runner** has no `/traces/drain` and answers 404. DASH reads that as
  "this runner holds no spans", not as a failure, and keeps polling the routes it
  does answer.
- An **older agent** writes no `trace` lines. The route answers, the batch is
  empty.
- **Runs already in a store** have no spans and render exactly as they did.

All three arrive at the same sentence on the page: *this run has no step trace*.
A tree inferred from the events is the one outcome this feature must not
produce.

### Retention

`run_spans` is capped per run (`MAX_SPANS_PER_RUN`), and what the cap refused is
counted in `run_span_drops` and shown, so a truncated trace says it is
truncated. The 90-day sweep decision 2 below describes still has no
implementation, for spans or for events.

## Changelog

- **Side channel (2026-09-07, MAR-889):** Added `contracts/run-span.schema.json` at `trace_version: 1`, on its own agent
  message and its own runner route. **v1 is unchanged**: same seven types,
  same schema bytes, same lock, same conformance folder.
- **v1 (2026-07-05, MAR-295 / DASH-01):** Froze the contract. Bumped
  `manifest_version` / `event_version` to `1`. Settled all 4 open questions (see
  Decisions above). Added `contracts/agent.manifest.schema.json` and
  `contracts/run-event.schema.json`, validated in CI against the example files.
- **v0 (2026-07-04):** Initial draft alongside the DASH vision README.
