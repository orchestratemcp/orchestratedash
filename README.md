# OrchestrateDASH

**An optional, open-source agent browser and workspace for agents planned with
[OrchestrateKit](https://github.com/orchestratemcp/OrchestrateKIT-MCP).**

> **Status: contracts, a local app, an Electron shell, and a bundled Agent
> Runner.** This repository defines frozen telemetry v1 and the additive Agent
> DOM v2 contract, and ships a local app that imports manifests, receives run
> events, stores credentials in the OS vault (MAR-416), and sends audited Agent
> DOM commands (MAR-417) from a shell that runs (MAR-424). It still contains no
> OAuth flows and no connection broker.
>
> **DASH never hosts or executes agents.** That sentence is still exactly true
> of DASH, and as of MAR-415 it is no longer the whole story for the product:
> DASH now ships an **Agent Runner** — a separate OS process, in the same
> install, started by the shell and detached from it. The runner launches agents
> as its own child processes and is authoritative for their execution. DASH
> remains a control surface that observes and requests; it does not become the
> runtime by displaying or commanding one.
>
> The boundary is real rather than rhetorical: the runner has its own process,
> its own database, its own audit trail and its own credential, and it
> independently validates and authorizes every command DASH sends it. See
> [`runner/`](runner/README.md).

## Quick start

```sh
pnpm install
pnpm dev          # http://localhost:3000
```

To run the same UI inside the installable shell instead of a browser tab, leave
`pnpm dev` running and, in a second terminal:

```sh
pnpm shell        # builds electron/ and launches the window
```

The shell is where secrets and audited commands live — see
[`electron/`](electron/README.md). It is not packaged yet: no installer, no
signing, no auto-update.

### Make an agent and add it (MAR-428)

The path a person actually takes. No manifest to find, no JSON to transcribe,
no file picker:

```sh
pnpm build:agent-kit
node agent-kit/dist/cli.mjs my-first-agent
cd my-first-agent
npm run open-in-dash
```

DASH comes to the front and asks whether to add it. Say yes and it is
registered, started, and still running after you close the window. The agent it
creates needs no accounts and no passwords.

`node agent-kit/dist/cli.mjs` rather than `npx create-dash-agent` because the
package is not published yet — see [`agent-kit/`](agent-kit/README.md) and
[`docs/agent-handoff.md`](docs/agent-handoff.md), which covers the handoff
contract, what stops a web page from using it, and what removing an agent does
and does not delete.

### The developer path

Import an example agent and send it an example run event:

```sh
curl -X POST http://localhost:3000/api/agents \
  -H 'Content-Type: application/json' \
  --data-binary @examples/agent.manifest.example.json

curl -X POST http://localhost:3000/api/events \
  -H 'Content-Type: application/json' \
  --data-binary @examples/run-event.example.json
```

The agent then appears under **Agents** and the run under **Runs**.

### What the v0 app does

| Route | Purpose |
| --- | --- |
| `/` | Agents list — every imported `agent.manifest.json`, with a compliance rollup of its last 5 runs |
| `/runs` | Runs list — runs reconstructed from received telemetry v1 events, each with its plan-vs-actual verdict |
| `/runs/{agent}/{run_id}` | Run detail — the plan-vs-actual view: drift, gate compliance, clearance behavior |
| `POST /api/agents` | Import one manifest, validated against the frozen v1 schema |
| `GET /api/agents` | The same agents list as JSON |
| `POST /api/events` | The v1 ingest endpoint; accepts one event or a batch |
| `GET /api/runs/{agent}/{run_id}` | The run's plan-vs-actual verdict as JSON |

Events are validated individually, so one malformed event in a batch is reported
without discarding the rest. Ingest answers `202` and never asks a runner to
retry or block: monitoring stays fire-and-forget, and an unreachable DASH must
not break an agent run.

The Runs list also reports what the transport alone tells it — run status, event
counts, sequence gaps, and whether the agent's manifest is known — independently
of the plan-vs-actual verdict described below.

### Local storage and secrets

State is a local SQLite database at `.data/dash.sqlite`, gitignored and easy to
delete. It is a file on your machine — there is no server and no hosted service.
An existing `.data/dash.json` from an earlier version is imported on first run
and left on disk untouched. See [local store and vault](docs/local-store-and-vault.md).

Credentials do **not** live in that database. They go to the operating system's
own vault — Credential Manager, Keychain or your Linux keyring — and the store
keeps only the name a credential is filed under and a masked hint like `••••4f2a`.
If no OS vault is reachable, DASH says so and refuses to store the credential
rather than falling back to a file it would have to invent a key for.

`DASH_INGEST_TOKEN` is optional. When set, `POST /api/events` requires a matching
`Authorization: Bearer` header; when unset, this local monitor accepts loopback
traffic so a fresh clone runs with no configuration. The token is only ever
compared — it is never written to the store. Run events themselves carry no
prompts, message bodies, credentials, or PII, per the contract's no-secrets rule.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DASH_INGEST_TOKEN` | unset | Optional bearer token for `POST /api/events` |
| `DASH_DATA_DIR` | `.data/` | Where `dash.sqlite` and the vault directory are written |

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

## Who the interface is for

[`docs/design-brief.md`](docs/design-brief.md) decides it: **the calm view is the
default and density is opt-in**, the guided path carries no raw identifiers, and
every error names a next action. Developer surfaces keep everything they have —
including manifest import, JSON and raw ids — reached deliberately rather than
landed on.

The no-raw-identifier rule is enforced by tests over rendered copy, not by
review. [`lib/copy/`](lib/copy) holds the one definition.

## Plan vs actual

OrchestrateKit plans are deterministic, registry-grounded routes with a safety
contract. DASH joins a manifest to a run's events and judges the run against the
plan it declared. This is the thing a generic agent dashboard cannot copy: it
needs the planning layer to have produced a plan in the first place.

`analyzeRun(manifest, events)` in `lib/analyze.ts` is a pure function — no I/O,
fully unit-tested — and reports three kinds of finding:

- **Route drift** — planned steps that never ran, steps that ran without being
  planned, and steps that ran out of plan order. Rendered as amber chips.
- **Gate compliance** — a `step_started` for a component the manifest lists in
  `irreversible_components`, with no `gate_resolved` earlier in the same run.
  This is the headline check: the agent took an unrecoverable action nobody
  approved. Red badge on the run *and* the agent card.
- **Clearance behavior** — a plan at clearance L3 or L4 (a human is expected in
  the loop) whose run carries no gate traffic at all: it ran unattended against
  an attended plan.

Drift alone does not fail a run; a gate violation or a clearance finding does.

Replay a violating run against the bundled example manifest to see it end to end
(with the app running):

```bash
pnpm demo:violation
# or against a non-default port:
DASH_BASE_URL=http://localhost:3020 pnpm demo:violation
```

DASH observes and reports; it cannot stop a remote agent, and nothing here tries
to. The v1 monitoring flow remains fire-and-forget: an unreachable DASH must not
break an agent run.

Cost and token enrichment is out of scope here — that is DASH-05.

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
  idempotency, and audit correlation. Executed since MAR-417 — see
  [the Agent DOM command channel](docs/agent-command-channel.md), which is also
  where the honest account of what does *not* work yet lives.

Examples cover the frozen telemetry-only agent, agent-managed credentials,
DASH-manageable connection requirements, and a synthetic draft-only Gmail Meeting
Assistant. The latter reads meeting requests, creates Gmail drafts, reads Calendar
availability, and creates a Calendar event only after runner-enforced approval.

## Verify

```sh
pnpm install --frozen-lockfile
pnpm verify
```

`pnpm verify` runs `tsc --noEmit` and the full test suite. Tests validate every
example, preserve additive-field behavior, exercise negative cases for secret
leakage, unsafe commands, approval semantics, version mixing, and the draft-only
Gmail boundary, and cover the v0 app's manifest import, event ingest, and run
reconstruction.

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
