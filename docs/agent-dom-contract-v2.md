# Agent DOM contract v2

Status: accepted contract decision for MAR-382. This document defines data
contracts and a replaceable transport profile. It does not claim a DASH UI,
credential vault, OAuth flow, connection broker, agent runner, or hosted service
exists.

## Decision

An **Agent DOM** is a safe, structured view of an agent that a control surface can
render without becoming the agent's runtime. It has three versioned seams:

1. `agent.manifest.v2.schema.json` declares identity, goal, plan, runtime,
   trigger, locations, connection requirements, supported commands, and memory
   categories.
2. `agent-dom-state.schema.json` describes current connection health, runs,
   tasks, choices, guarded actions, approvals, user-visible memory descriptors,
   audit events, and plan-vs-actual state.
3. `agent-command.schema.json` carries an authenticated actor's requested command
   to a runner adapter with target, expiry, replay protection, idempotency, and
   audit correlation.

These documents are transport-independent. DASH may render them, but another
website, provider UI, local client, or chat surface can use the same seam.

## Trust boundaries and responsibilities

The agent or runner remains authoritative for execution. It owns task state,
validates commands, checks authorization, persists approvals and replay records,
enforces gates immediately before side effects, makes provider calls, and emits
safe state and audit data. UI visibility is not enforcement.

DASH is an optional control and interaction surface. A future implementation may
authenticate a user, render Agent DOM resources, collect choices, construct
commands, display receipts, and broker explicitly granted connections. DASH does
not become the runtime merely because it displays or controls an agent.

An adapter translates a runner's native state and operations into these schemas.
It must not invent controls the runner cannot enforce. When no compatible adapter
or command endpoint exists, DASH renders the agent read-only.

The connection provider or external secret manager remains a separate trust
domain. Manifests and state expose only requirements, capabilities, ownership,
masked account hints, and health. Reusable credential values do not cross the
contract.

## Connection ownership

- `agent_managed`: the runner keeps its existing credentials. DASH receives safe
  health and sends only commands the adapter supports.
- `dash_managed`: a future DASH connection service may grant a scoped capability
  or broker a call. The contract does not define or implement that service, and
  reusable raw credentials are not handed to agents by default.
- `external`: credentials remain in a provider or secret manager outside both
  DASH and the runner's manifest.

Connection fields are requirements, not values. Plain-language `label`,
`purpose`, and `help` belong in guided interfaces. Raw environment names and
provider scopes may appear only inside `technical` metadata. A future local
adapter may inspect names only after explicit folder selection; arbitrary `.env`
scanning and secret ingestion are outside this issue.

Adopting an existing OAuth connection uses `reconnect_test_switch`: the user
reauthorizes, the adapter tests the new connection, and only then switches. Token
copying is never an adoption mechanism.

## Versioning and v1 compatibility

Telemetry v1 is frozen. Its schemas, examples, event endpoint, bearer-token
decision, and 90-day retention decision remain unchanged.

Manifest v2 repeats the required v1 telemetry fields and adds the required
`agent_dom` declaration. The versions are deliberately explicit:

| Document | Version relationship |
| --- | --- |
| Telemetry manifest | `manifest_version: 1`; monitor-only and read-only |
| Agent DOM manifest | `manifest_version: 2` plus `agent_dom.dom_version: 1` |
| Agent DOM state | `state_version: 1` and `manifest_version: 2` |
| Agent command | `command_version: 1` and `manifest_version: 2` |
| Run event | `event_version: 1`; valid for either manifest generation |

Consumers dispatch on the top-level version and reject unsupported combinations;
they do not reinterpret a v2 document as v1. Within a supported version, unknown
additive fields are ignored. This keeps future display metadata compatible while
preventing a command or state document from being applied to the wrong manifest
generation.

A v1-to-v2 interpretation is intentionally conservative: import the v1 identity,
route, safety contract, monitoring, and provenance as before; show no connection,
memory, task, approval, or command capabilities unless a separate compatible
adapter supplies them. Missing controls mean read-only, not inferred controls.

## HTTP transport profile v0

The schemas are the stable seam. The first replaceable profile is JSON over HTTP:

- `GET {control-location-uri}` returns one Agent DOM state snapshot.
- `POST {control-location-uri}/commands` submits one command envelope.
- Existing telemetry continues to use the v1 `POST /api/events` ingest contract.

Loopback HTTP is permitted for a local adapter. Remote control requires HTTPS.
Authentication and channel authorization are established out of band by the
installed adapter; credentials never appear in manifests, state, commands, URLs,
or logs. The runner binds the envelope's `actor` to the transport-authenticated
principal rather than trusting an unverified actor string.

A runner rejects expired commands, unknown targets, unauthorized capabilities,
used nonces, and stale approvals. It stores the idempotency result before or with
an irreversible effect and returns the same result for duplicates. Accepted and
rejected attempts share the supplied audit correlation. Polling is sufficient for
this contract slice; push, streaming, and delta synchronization are deferred.

## Approval and action semantics

An action with `approval_required: true` must reference an approval request and
declare `runner_enforced`. Approval requests expire. An `approve` or `reject`
command targets the approval resource. The runner rechecks the approval status,
expiry, selected option, actor authorization, and target immediately before the
side effect. DASH disabling a button is only a usability measure.

The Gmail Meeting Assistant profile is draft-only. It may read meeting requests,
create Gmail drafts, check Calendar availability, and create a Calendar event
after runner-enforced approval. It has no Gmail delivery capability or default
delivery-oriented action copy. Raw Gmail content is transient provider input, not
permanent memory; memory resources contain short, user-visible descriptors with
provenance and user-approved retention.

## Threat model

| Threat | Contract mitigation |
| --- | --- |
| Spoofed agent | Bind adapter enrollment and manifest identity to an authenticated installation; show provenance; do not infer controls from telemetry. |
| Forged command | Authenticate the channel, bind `actor` to that identity, authorize the exact command and target, and audit accepted and rejected attempts. |
| Replay | Require a high-entropy nonce and expiry; atomically record used nonces at the runner. |
| Over-broad grant | Declare narrow capabilities, grant per agent and connection, and recheck capability at execution. Provider-specific scope mapping must choose the narrowest usable grant. |
| Secret leakage | Never serialize credential values; reject obvious secret fields, scan boundary payloads and logs, mask account status, and forbid credentials/query data in contract URLs. |
| Stale or expired approval | Give requests and commands expiries; revalidate approval status and target state at execution. |
| Duplicate irreversible action | Require an idempotency key and persist the result atomically with the effect. |
| Untrusted provider content | Treat mail and calendar text as data, not instructions; minimize output, validate structured fields, and never promote raw Gmail content to durable memory. |
| Compromised DASH | Assume it can request any displayed action; the runner still authenticates, authorizes, checks expiry/replay/approval, and limits connection grants. Revoke its session and grants independently. |
| Compromised runner | DASH cannot make a hostile runner safe or truthful. Surface provenance and audit gaps, isolate/revoke provider grants, and stop trusting that adapter. |

## Deferred decisions

The following require implementation evidence or a later issue and are not
pretended here:

- adapter enrollment, concrete session authentication, and optional message
  signatures;
- nonce/idempotency retention duration and storage technology;
- maximum approval lifetime and approval delegation policy;
- connection broker, secure-store/vault implementation, OAuth provider setup,
  revocation, and scoped grant exchange;
- explicitly authorized local folder inspection and environment-name adapters;
- push transports, subscriptions, deltas, command receipts, and recovery queues;
- hosted multi-tenant identity, isolation, KMS, retention, abuse controls, and
  operations;
- provider-specific capability-to-scope mappings and Gmail/Calendar runner
  behavior.

These deferrals do not block a local DASH scaffold from parsing and rendering the
schemas or an installable shell from building explicit adapter discovery and
connection setup around them.
