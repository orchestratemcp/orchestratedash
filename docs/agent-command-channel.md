# The Agent DOM command channel

How a click becomes a command, what stops it, and what is written down either
way.

- **Issue:** MAR-417 (DASH-13)
- **Contract:** [`agent-command.schema.json`](../contracts/agent-command.schema.json),
  specified in MAR-382 and first executed here
- **Decided by:** [ADR 0001](adr/0001-installable-shell.md)

## What is real, and what is not

Read this section before the rest.

| | Status |
| --- | --- |
| Envelope construction, actor binding, nonce, idempotency, enforcement, audit | **Built and tested** |
| `agent-command.schema.json` compiled and validated against | **Built** — first execution of that contract |
| A command reaching an actual runner | **Built** (MAR-415). `httpAdapter` over the contract's HTTP profile v0 |
| The runner independently enforcing what DASH enforced | **Built** (MAR-415). Its own nonces, idempotency, approvals and audit |
| A command having an effect on a real process | **Built** (MAR-415). Delivered over the agent's stdin and acknowledged, or reported unacknowledged |
| Starting or stopping a hosted process | **Built** (MAR-415) as `runner.*` lifecycle — still **not** an Agent DOM command |
| The Electron shell running at all | **Built** (MAR-424) |
| Capability-driven controls in the agent workspace | **Built** (MAR-384). The renderer receives only controls meaningful for the current validated snapshot |
| An agent DASH holds no credential for | **Still `noAdapter`.** Read-only, and honest about why |

Everything up to "DASH decided to send this envelope, and recorded why" is
proven by `tests/agent-command.test.ts` against the real store, the real
contract validators and the real workspace rules, and by `pnpm shell:smoke`
through a real window, preload and IPC channel into the real user-data store.

**As of MAR-415 the rest is proven too, and by a different suite.**
`tests/runner-server.test.ts` and `tests/runner-supervisor.test.ts` run a real
loopback server, a real SQLite store and a real child process: a command posted
to `POST {control-location-uri}/commands` is adjudicated a second time by the
runner, written to the agent's stdin, and reported back only once the agent
acknowledges it. Killing that process shows the agent as stopped rather than
healthy. Those tests run in CI, which the shell's own proofs cannot.

**What is still not built** is stated rather than stubbed:

- **DASH cannot reach a remote agent-managed runner it has no credential for.**
  Adapter enrollment is on the Agent DOM v2 contract's deferred list. If an
  operator places a token in the vault under `dash.adapter.{agent}.token` the
  same `httpAdapter` reaches it; DASH has no flow that mints one. Until then
  such an agent stays on `noAdapter` and renders read-only.
- **No CPU or memory reporting.** The runner reports a real PID and real
  liveness because it started the process. It does not report CPU or RSS,
  because doing that portably needs a native dependency or a per-poll
  subprocess. An absent field is honest; a zero would not be.

An adapter that returned success would make the channel report a delivered
effect that nothing performed. That is why acknowledgement is mandatory: a line
written to a pipe proves nothing about whether the agent read it, and the runner
reports `delivery_unacknowledged` rather than assuming.

## There is no `start`, `stop` or `trigger`

The contract's command vocabulary is exactly seven verbs:

```
approve · reject · choose · retry · pause · resume · cancel
```

Both `agent-command.schema.json` and `agent.manifest.v2.schema.json` fix that
list. `start`, `stop` and `trigger` are not in it, and none of the seven is an
honest synonym: `resume` presumes a paused run, `pause` and `cancel` act on a
run rather than a process, and `retry` re-runs an existing run where `trigger`
would begin a new one.

Starting and stopping a locally hosted agent is **runner lifecycle**, not an
Agent DOM command — DASH supervising a process it hosts, rather than DASH asking
an adapter about a run. Adding those names to the catalogue here would have
given DASH three buttons no manifest can declare and no adapter is obliged to
honour.

**MAR-415 built the runner and did not change this.** Starting and stopping are
now possible, and they are `runner.start` and `runner.stop` in `COMMANDS` — a
separate family with a separate prefix, routed to the runner's `/lifecycle`
endpoint. They never become an envelope, are never validated against
`agent-command.schema.json`, and carry no nonce, idempotency key or correlation,
because none of those concepts applies to "send SIGTERM to a process". Their
audit is the IPC boundary record.

`trigger` still does not exist in any form. Nothing in the runner begins a new
run, so there would be nothing behind the name.

## The two layers

**The renderer says very little.** A command is an entry in `COMMANDS`
(`lib/shell/ipc.ts`) whose payload names which agent, which run or task, which
approval or choice, and which state snapshot the control was rendered from.
That is the entire vocabulary.

MAR-384 makes that vocabulary reachable from the live workspace without
widening it. `lib/views/build.ts` derives controls from the validated manifest
and latest durable Agent DOM snapshot before anything crosses into the
renderer. Approval and choice buttons stay attached to their concrete resource
ids and side-effect preview; run controls never receive those broader verbs.
The browser development host has no preload bridge and therefore renders the
same workspace read-only.

**Main says the rest.** The actor, the nonce, the command id, the expiry, the
correlation and the idempotency key are all minted in `lib/agent-dom/runner.ts`.
The renderer cannot supply them incorrectly because no command declares a
payload key that could carry one — the enforcement is that there is nothing to
forge, not that a forgery would be caught.

## The actor

The runner binds `actor` to the transport-authenticated principal. In the local
shell that principal is the OS user running DASH, `authenticated_by:
"dash_session"`, derived in `electron/main.ts` from the process's own session.

That claim is deliberately modest: **DASH did not authenticate anyone.** The
operating system did, by deciding who is logged in. There is no session token,
no multi-user identity, and no delegation. Adapter enrollment and real session
authentication are listed as deferred in the Agent DOM v2 contract, and
`localPrincipal()` is the function that changes when they arrive.

## `observed_at`, and why every command carries it

Every agent command names the state snapshot its control was rendered from. It
does three jobs at once:

1. **It scopes the idempotency key.** A double click happens against one
   snapshot, so both attempts derive the same key and the second returns the
   first one's result. A deliberate second attempt happens against a *new*
   snapshot, so it derives a new key and is allowed. Without a snapshot in the
   tuple, any rule strong enough to stop the double click also permanently bars
   the honest retry.
2. **It makes a stale display detectable.** The snapshot must be one DASH
   actually holds, which is also what stops a forged `observed_at` from minting
   a fresh key and buying a second execution of an irreversible command.
3. **It makes "the approval expired between display and execution" checkable**
   rather than guessed, because DASH knows what the user was looking at.

## The order of the checks

`runAgentCommand` is written as one readable function on purpose. The order is
the security argument:

| # | Check | Why here |
| --- | --- | --- |
| 0 | Envelope validates against the contract | DASH built it, so a failure is a DASH bug — which is why it is checked rather than assumed, and why the same seam can later accept an envelope built elsewhere |
| 1 | Known duplicate | A second click must return the first click's answer, not a fresh opinion |
| 2 | Envelope expiry | Before anything durable: an expired command must not burn a nonce that the honest re-issue would need |
| 3 | Nonce | Replay is the attack, so it is detected on its own terms rather than as a side effect of a later check |
| 4 | Enforcement (target, capability, approval, choice) | A refused command performed nothing, so it must leave no idempotency record |
| 5 | Claim the idempotency key | Before the effect, per the contract |
| 6 | Dispatch, then settle | — |

## The rejections

Every one is audited. Each is a distinguishable code because each needs a
different recovery, the same argument `SecureStoreErrorCode` makes for its
members.

| Code | What happened |
| --- | --- |
| `invalid_envelope` | The envelope does not satisfy the contract |
| `expired_command` | The envelope outlived its own `expires_at` |
| `replayed_nonce` | This nonce has been seen before |
| `unknown_target` | No such agent, run, task, approval or choice |
| `stale_snapshot` | The snapshot acted on is not one DASH holds |
| `undeclared_capability` | The manifest never declared it, or the run's status does not make it meaningful |
| `retry_unsafe` | Retrying could repeat an irreversible component that already ran |
| `approval_expired` | The approval's deadline passed between display and execution |
| `approval_not_open` | The approval was already decided or cancelled |
| `approval_unenforceable` | The runner will not independently enforce it |
| `choice_expired` / `choice_already_made` / `unknown_option` | The choice's equivalents |
| `adapter_unavailable` / `adapter_failed` | DASH authorised it and could not deliver it |

`duplicate` is an outcome, not a rejection: the stored result is returned and
nothing acts.

**The rules are not re-implemented here.** `availableControls()` decides
whether a command is declared and meaningful, `retryIsSafe()` decides retry
safety, and `buildWorkInbox()` decides whether an approval is one DASH may
honestly offer. `lib/agent-dom/enforce.ts` calls all three. A second copy in the
command layer is how the button and the enforcement drift apart, which would
turn a usability measure into a security boundary by accident.

## What gets written down

Migration 1 adds four tables. `command_audit` records every attempt — accepted,
refused and duplicated.

**`payload_keys` holds key names and never values**, including the free-text
`reason` a user types. That value travels to the runner inside the envelope and
stops there. `lib/shell/ipc.ts` has audited keys and never values since the
boundary was built, and moving the audit from a log line into a table is not a
reason to relax it.

**`command_audit` has no foreign key to `runs`**, despite that table existing to
be foreign-keyed to. Two reasons, and the first is fatal alone:

1. Auditing a command that targets an unknown agent is an acceptance criterion.
   A foreign key would make exactly those rows un-insertable — the audit log
   would fall silent about the attempts most worth recording.
2. `runs` is populated from telemetry ingest; Agent DOM runs arrive from adapter
   snapshots. Until something reconciles them they are not the same set, and
   constraining one to the other would reject honest commands for runs DASH has
   state for but no events.

## Crash safety

Inherited from [the local store](local-store-and-vault.md), with one addition.

The idempotency row is written `in_flight` **before** the adapter is called and
settled afterwards. If DASH dies mid-dispatch, the row survives as `in_flight`
and a duplicate is told the outcome is unknown rather than being allowed to act
again. That is the right way round: an unknown outcome is resolved by looking, a
duplicated calendar invite is not.

An allowed command is audited *before* dispatch rather than after, so a crash
still leaves the trail showing that DASH authorised it. When an adapter then
fails, a **second** row is written rather than the first being edited — two
things happened, and a trail that overwrote the first with the second would be
claiming DASH refused something it in fact allowed.

## Open decisions

- **Nonce and idempotency retention.** Nothing prunes `command_nonces` or
  `command_results`. The contract lists retention duration as deferred; it needs
  a decision before either table is old enough to matter.
- ~~**Snapshot ingest.**~~ **Settled by MAR-415.** `putAgentDomState` now has a
  real caller: `electron/agent-adapters.ts` polls `GET {control-location-uri}`
  every five seconds for every agent DASH holds a channel to, and stores what
  comes back. The fixtures still exist and still seed rows, but they are no
  longer the only source. The poll interval is what the acceptance criterion
  "shows as stopped within one poll interval" is measured against.

  What remains open is narrower: polling is all there is. Push, streaming and
  delta synchronisation are deferred by the contract, so a state change is
  visible in at most one interval and no sooner.

Whether the free-text `reason` should be audited was asked and answered — see
the next section. It is settled, not open.

## Where an approval's rationale lives

`command_audit` records that a `reason` was supplied and never what it said.
Decided deliberately, and worth writing down because the opposite is the
tempting choice: an audit trail that says who approved an irreversible write
but not why answers the less interesting half of the question.

Three things settled it the other way:

1. **The invariant is only checkable because it has no exceptions.**
   `tests/redaction.test.ts` scans the database's actual bytes for a known
   secret. That test means something because "no payload value is in the store"
   is absolute. One carve-out turns it into "no payload value except this one",
   which is a rule with a hole in it rather than a rule.
2. **Free-text boxes collect secrets.** Not hypothetically — "approving, the new
   token is sk-live-…" is a thing people type into an approval note. Storing the
   column would make DASH responsible for scanning free text for credential
   shapes, which is a slow way to lose.
3. **It is already durable elsewhere.** The reason travels to the runner inside
   the envelope, and the runner is authoritative for execution and keeps its own
   record. Per the Agent DOM contract DASH observes and requests; it is not the
   system of record, and a second copy here would be one more place for a
   credential to come to rest.

So: to answer "why was this approved", read the runner's record for the
`command_id` in the audit row. If DASH ever needs the rationale locally, that is
a deliberate change with its own redaction pass — not a default that arrived
because it was convenient.
