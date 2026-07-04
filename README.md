# OrchestrateDASH

**Monitor-first, open-source dashboard for AI agents planned with [OrchestrateKit](https://github.com/orchestratemcp/OrchestrateKIT-MCP).**

> ⚠️ **Status: design phase.** This repo currently holds the product vision and the
> telemetry contract. Implementation starts after the OrchestrateKit MCP reaches its
> current quality bar (see the Linear DASH epic). The contract documents in `docs/`
> are the part being stabilized now, because the MCP's build briefs will emit it.

## What it is

DASH is where agents you planned with OrchestrateKit **report in**. It is not a
runtime and not a host: your agent runs wherever you built it (Cursor project,
CoWork, a cron job, n8n, a VPS — anywhere). DASH receives its run events and shows
you what's happening.

The one thing DASH can do that generic agent dashboards can't: **it knows the
plan**. Every OrchestrateKit plan is a deterministic, registry-grounded route with
a safety contract (approval gates, automation clearance level, per-step model
tiers). DASH imports that plan as an *agent manifest* and renders the run against
it:

- **Plan vs actual** — did the executed steps match the planned route, or did the
  build drift?
- **Gate compliance** — did anything irreversible run without its approval gate
  event?
- **Clearance** — the plan said L3 (human in the loop); is the agent behaving like
  it?
- **Model-tier & cost adherence** — the plan assigned frontier/standard/small per
  step; with OpenRouter metadata on the events, DASH shows what each step actually
  used and cost.

## How the loop works

```
 you + an LLM                    your build tool               anywhere
┌─────────────────┐   manifest  ┌────────────────┐   events   ┌──────────┐
│ plan_workflow    │ ──────────► │ build from the │ ─────────► │   DASH   │
│ (OrchestrateKit  │  + brief    │ build brief    │  (HTTP     │ monitor  │
│  MCP, advisory)  │             │ (Cursor/CoWork)│   POST)    │  & alert │
└─────────────────┘             └────────────────┘            └──────────┘
```

1. You plan an agent with the OrchestrateKit MCP. During planning it asks — along
   with read-only/unattended/egress constraints — **how you want to monitor the
   agent and where its output lands**.
2. `export_build_brief` emits an `agent.manifest.json` (the planned route + safety
   contract + monitoring wiring) alongside the build brief. The brief instructs the
   building LLM to emit DASH run events at each step.
3. You clone this repo, run DASH locally (or deploy it), and import the manifest.
   The agent card appears with its planned route.
4. The agent runs wherever it lives and POSTs events; DASH lights up.

Because the MCP writes the monitoring wiring into the brief, agents built from
OrchestrateKit plans fit DASH more seamlessly than anything else — that is the
point.

## What it is not

- **Not a host.** DASH never executes agent steps, never holds your Gmail/CRM
  OAuth tokens, never needs a credential vault. (Deliberate: see OrchestrateKit's
  advisory-boundary history.)
- **Not the evidence factory.** OrchestrateLab (private) remains the rated-evidence
  flywheel. DASH can *forward* run summaries as rating candidates; a human still
  rates them.
- **Not OpenRouter-locked.** OpenRouter-first for cost attribution (one key, any
  model, per-request pricing), but events carry plain `model` / `cost_usd` fields
  any provider can fill.

## Contract documents

- [`docs/telemetry-contract-v0.md`](docs/telemetry-contract-v0.md) — the agent
  manifest + run-event schema (the seam between the MCP, built agents, and DASH).
- [`examples/agent.manifest.example.json`](examples/agent.manifest.example.json) —
  what `export_build_brief` will emit, based on the published
  `email_lead_to_crm` playbook.

## Repo family

| Repo | Role |
| --- | --- |
| `orchestratekit-mcp` (public) | Deterministic planning/review advisor — emits the manifest |
| `orchestratedash` (public, this repo) | Monitor-first dashboard — receives the events |
| `orchestrateweb` (public) | Website |
| `orchestratelab` (private) | Rated-evidence flywheel — human-gated corpus & steward |
