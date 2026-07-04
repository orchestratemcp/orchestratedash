# Telemetry contract v0 (draft)

The seam between three parties that never share code:

1. **OrchestrateKit MCP** (stateless, advisory) — *emits* an agent manifest inside
   `export_build_brief`, and writes event-wiring instructions into the build brief.
2. **The built agent** (lives anywhere) — *sends* run events over plain HTTP.
3. **DASH** — *receives* events, joins them to the manifest, renders plan-vs-actual.

Design rules:

- **Additive versioning.** `manifest_version` / `event_version` integers; consumers
  ignore unknown fields. Breaking changes bump the version.
- **The MCP stays stateless.** It never talks to DASH; the manifest is data inside
  the brief, exactly like the matcher-corpus fixture discipline.
- **Events are fire-and-forget.** An unreachable DASH must never break an agent
  run: the brief instructs builders to wrap emission in a non-fatal try/catch.
- **No secrets in events.** Payloads carry ids, statuses, counts, costs — never
  message bodies, tokens, or credentials. `detail` is a short human hint, and the
  brief instructs builders to keep PII out of it.

## agent.manifest.json

Produced by `export_build_brief` (one file per planned agent). Imported into DASH
by upload or paste.

```jsonc
{
  "manifest_version": 0,
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
    "automation_clearance": "L3",           // L1–L4 from the plan
    "enforced_approval_gates": ["human_approval_gate"],
    "irreversible_components": ["crm_note_write", "optional_email_send"]
  },
  "monitoring": {
    "events": ["run_started", "step_started", "step_completed",
               "gate_requested", "gate_resolved", "run_completed", "run_failed"],
    "endpoint_env": "DASH_INGEST_URL",      // agent reads these from env
    "token_env": "DASH_INGEST_TOKEN",
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
One JSON object per event (batching: array accepted).

```jsonc
{
  "event_version": 0,
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

## Open questions (settle in DASH-01)

- Auth for self-hosted ingest: static bearer token per agent (v0) vs per-run.
- Retention/rotation for the events table (SQLite first, like the Lab).
- Whether `gate_resolved` carries approver identity (useful, but PII-adjacent).
- Lab forwarding shape: DASH → Lab session candidate is a *summary*, not raw
  events; must arrive as `needs_rating` (human still rates — MAR-129 boundary).
