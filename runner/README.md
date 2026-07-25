# `runner/` — the Agent Runner

The process that actually holds a running agent.

- **Issue:** MAR-415 (DASH-11), first slice
- **Decided by:** [ADR 0001, Amendment 1](../docs/adr/0001-installable-shell.md#amendment-1--the-agent-runner-is-a-separate-process-mar-415-dash-11)
- **Contract:** [Agent DOM v2](../docs/agent-dom-contract-v2.md), HTTP transport profile v0

| File | What it is |
| --- | --- |
| `main.ts` | Entry point. Config from the environment, socket, signals. Wiring only. |
| `server.ts` | The HTTP surface: the v0 profile plus `/lifecycle` and `/health`. |
| `execute.ts` | The runner's own adjudication of a command. The order is the argument. |
| `supervisor.ts` | Child processes: spawn, stop, watch, deliver. |
| `protocol.ts` | The runner ↔ agent wire format. Pure. |
| `state.ts` | Builds the Agent DOM state document. Pure. |
| `store.ts` | The runner's own SQLite: nonces, idempotency, approvals, audit. |

## What this is, in one paragraph

DASH is a control surface and does not execute agents. The runner does. It is a
separate OS process inside the same install, started by Electron main and
**detached** from it, so closing the DASH window leaves running agents running.
It launches agents as its own child processes, reports their real PIDs because
it started them, and delivers commands to them over their own stdin.

## It is a distinct trust boundary, and here is what that means

The Agent DOM v2 contract says the runner "validates commands, checks
authorization, persists approvals and replay records, enforces gates immediately
before side effects". DASH doing those things first **does not discharge them**,
because the contract's threat model assumes a compromised DASH "can request any
displayed action" and answers that the runner still checks for itself.

So the boundary is made of things, not of words:

- **Its own database.** `runner.sqlite`, not DASH's `dash.sqlite`. A separate
  trust domain that writes into the other one's store is not a separate trust
  domain; it is a second process with a shared mutable dependency.
- **Its own nonce table.** A replay that never went through DASH would not be in
  DASH's.
- **Its own idempotency store**, claimed before the effect and settled after.
- **Its own approval record**, rechecked against durable state immediately
  before delivery — DASH checked a snapshot that was already old when it was
  sent.
- **Its own audit trail**, carrying DASH's correlation id so one investigation
  spans both.
- **Its own credential.** A bearer token, minted by main, held in the OS vault,
  never written to the port file, never logged, and stripped from every agent's
  environment.

## Where the free-text approval reason lives

Here. `docs/agent-command-channel.md` settled that DASH stores keys and never
values — "no payload value is in the store" is checkable precisely because it
has no exceptions — and named the runner as where the answer to "why was this
approved" actually lives. `approval_decisions.reason` is that column. It is not
in the runner's audit table either; it belongs to the decision record.

## The agent protocol

Newline-delimited JSON over the child's own stdin and stdout. A pipe is
authenticated by construction — only the process holding the other end can write
to it — which is three problems fewer than giving every agent a listening port.

Runner to agent:

```json
{"protocol_version":1,"type":"command","command_id":"…","command":"approve","target":{…},"payload":{"reason":"…"}}
```

Agent to runner:

```json
{"type":"ack","command_id":"…","ok":true,"detail":"…"}
{"type":"state","state":{"status":"running","runs":[…],"approval_requests":[…]}}
```

**Acknowledgement is mandatory.** A line written to a pipe proves nothing about
whether the agent read it, so an unacknowledged command settles as
`delivery_unacknowledged` rather than as success. Non-protocol output is not an
error: agents log, and the first `console.log` in anybody's agent must not look
like a fault.

**The agent does not get to say whether it is alive.** It contributes runs,
tasks and approvals; the runner owns `agent_id`, `observed_at`, and `status`
whenever the process is not running. A dead agent's last self-report says
`running`, and any design that trusts it reports a healthy agent forever — which
is the exact failure the acceptance criterion forbids.

## Registering an agent

A JSON file in `{data-dir}/agents/`:

```json
{
  "agent_id": "my-agent",
  "manifest_path": "./my-agent.manifest.json",
  "command": "node",
  "args": ["./my-agent.mjs"],
  "cwd": ".",
  "env": { "MY_AGENT_MODE": "poll" }
}
```

Registrations are files rather than something `POST`ed, on purpose: "start this
agent" naming an arbitrary command line would make the control endpoint a remote
shell with extra steps. The API chooses *which* registration to start, never
*what* to run.

The runner refuses to start an agent whose manifest is not valid v2, and it
checks that **before** spawning anything — a refusal that happened after the
agent ran would not be a refusal.

## Running it

The runner is started by DASH. To run it by hand for debugging:

```sh
pnpm build:shell
DASH_RUNNER_DATA_DIR=/tmp/dash-runner DASH_RUNNER_TOKEN=$(openssl rand -base64 32) \
  node dist/electron/runner.mjs
```

| Variable | Meaning |
| --- | --- |
| `DASH_RUNNER_DATA_DIR` | Required. Database, registrations, port file and log. |
| `DASH_RUNNER_TOKEN` | Required. The channel credential. |
| `DASH_RUNNER_PORT` | Optional. `0` (the default) asks the OS for a free port. |

It writes `runner.json` — pid and port, never the token — once it is listening.
That file is how a restarted DASH finds and re-adopts a runner instead of
choosing between killing the fleet and being unable to talk to it.

## What CI covers, and why that is new

`electron/README.md` records that no CI job can launch the shell:
`ELECTRON_SKIP_BINARY_DOWNLOAD=1` keeps the platform binary out of CI, so the
shell's proofs are a local `pnpm shell:smoke`.

The runner has no such constraint. It is Node spawning Node over a loopback
socket, so `tests/runner-*.test.ts` run on every push against real processes and
a real server — including "SIGTERM actually stops it" and "an invalid manifest
is refused before anything spawns". Only *Electron spawning the runner* stays in
the local smoke.

One test is skipped on Windows: the SIGKILL escalation, because Node emulates
`kill` with `TerminateProcess` there, so an agent cannot decline SIGTERM and
there is nothing to escalate from. It runs on CI's Linux.

## What this slice does not do

Named here rather than discovered later:

1. **No Agent Kit.** `npx create-dash-agent` does not exist. An agent becomes
   hostable by having a v2 manifest and a registration file, both written by
   hand. That template is MAR-415's second slice, along with the auto-
   registration that would make an agent appear in DASH without a manual
   manifest import.
2. **No CPU or memory reporting.** The issue asks for it and says the runner can
   report it honestly because it started the process. That is true of the PID
   and of liveness, and not yet true of the rest: reading a child's CPU and RSS
   portably needs a native dependency or a subprocess per poll. The field is
   absent rather than zero.
3. **No restart policy.** An agent that exits stays exited. Supervision here
   means "knows it died and says so", not "brings it back" — a restart loop
   around a crashing agent that holds provider credentials is a decision that
   deserves its own issue.
4. **No retention.** Nothing prunes `command_nonces` or `command_results`, in
   the runner or in DASH. Deferred by the contract; still deferred.
5. **The human is not independently authenticated.** The runner authenticates
   the *channel* — the bearer token proves the caller is the DASH installation
   it was enrolled with. It cannot check the human, because DASH's own principal
   is `dash_session`, meaning "the OS user running this copy of DASH", with no
   token or directory behind it. What the runner enforces is that a channel may
   only assert the kinds of actor it is enrolled to assert. Real session
   authentication is on the contract's deferred list.
6. **One runner, one machine, no enrollment.** There is no flow for pointing
   DASH at a *remote* runner. `httpAdapter` would reach one, and the vault would
   hold its token under `dash.adapter.{agent}.token`, but nothing mints or
   exchanges that credential.
7. **No OS-backed vault means no runner.** DASH still runs and still monitors;
   it just does not host agents on that machine, and says so once at startup.
