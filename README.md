# OrchestrateDASH

**An optional, open-source agent browser and workspace for agents planned with
[OrchestrateKit](https://github.com/orchestratemcp/OrchestrateKIT-MCP).**

> **Status: contract and design phase.** This repository defines frozen telemetry
> v1 and the additive Agent DOM v2 contract. It does not yet contain the DASH
> application, credential storage, OAuth flows, a connection broker, or an agent
> runtime.

## Direction

DASH is a place where compatible agents can report safe telemetry and, through a
runner-enforced adapter, expose structured state and supported controls. The agent
may continue running locally, on a worker, in a workflow platform, or in a client
session. DASH is optional and does not host the agent merely because it renders
its workspace.

The Agent DOM contract lets a future compatible surface render:

- identity, goal, runtime, trigger, and separate control/interaction locations;
- connection requirements, ownership, capabilities, and masked health;
- runs, tasks, choices, guarded actions, and approvals;
- user-visible memory descriptors, audit history, and plan-vs-actual state; and
- a small set of authenticated, expiring, replay-resistant commands.

Existing telemetry-only agents remain valid and read-only. Controls appear only
when an adapter declares and implements them, and the runner enforces every
authorization and approval again at execution time.

## Plan vs actual

OrchestrateKit plans are deterministic, registry-grounded routes with a safety
contract. DASH can join a manifest to run events to inspect:

- whether executed steps match the planned route;
- whether irreversible steps have runner-enforced approval evidence;
- whether automation clearance and model tiers match the plan; and
- cost and token metadata when a runtime safely emits it.

The v1 monitoring flow remains fire-and-forget: an unreachable DASH must not
break an agent run.

## Connection modes

The contract supports three ownership modes without serializing credential
values:

- **Agent-managed:** the existing runner owns credentials and reports safe health.
- **DASH-managed:** a future DASH connection service may provide a scoped grant or
  broker a call. No such service is implemented in this repository today.
- **External:** credentials remain in a provider or secret manager outside DASH.

Moving an existing OAuth connection to DASH is represented as reconnect, test,
and switch. Silent token copying and arbitrary `.env` scanning are not part of
the contract.

## Contract documents

- [`docs/telemetry-contract-v1.md`](docs/telemetry-contract-v1.md) - frozen v1
  manifest and run events.
- [`docs/agent-dom-contract-v2.md`](docs/agent-dom-contract-v2.md) - Agent DOM
  architecture decision, compatibility rules, HTTP v0 profile, trust boundaries,
  threat model, and deferred decisions.
- [`contracts/agent.manifest.schema.json`](contracts/agent.manifest.schema.json) and
  [`contracts/run-event.schema.json`](contracts/run-event.schema.json) - unchanged
  telemetry v1 schemas.
- [`contracts/agent.manifest.v2.schema.json`](contracts/agent.manifest.v2.schema.json)
  - v1 telemetry fields plus the Agent DOM declaration.
- [`contracts/agent-dom-state.schema.json`](contracts/agent-dom-state.schema.json) -
  current Agent DOM resources.
- [`contracts/agent-command.schema.json`](contracts/agent-command.schema.json) -
  actor-bound command envelope with target, expiry, replay protection,
  idempotency, and audit correlation.

Examples cover the frozen telemetry-only agent, agent-managed credentials,
DASH-manageable connection requirements, and a synthetic draft-only Gmail Meeting
Assistant. The latter reads meeting requests, creates Gmail drafts, reads Calendar
availability, and creates a Calendar event only after runner-enforced approval.

## Verify

```sh
pnpm install --frozen-lockfile
pnpm verify
```

Tests validate every example, preserve additive-field behavior, and exercise
negative cases for secret leakage, unsafe commands, approval semantics, version
mixing, and the draft-only Gmail boundary.

## Repo family

| Repo | Role |
| --- | --- |
| `orchestratekit-mcp` | Deterministic planning/review advisor that emits manifests |
| `orchestratedash` | Agent browser contracts and future optional workspace |
| `orchestrateweb` | Public website |
| `orchestratelab` | Private, human-gated evidence flywheel |
