# `runner/` — the Agent Runner

The process that actually holds a running agent.

- **Issue:** MAR-415 (DASH-11), first slice
- **Decided by:** [ADR 0001, Amendment 1](../docs/adr/0001-installable-shell.md#amendment-1--the-agent-runner-is-a-separate-process-mar-415-dash-11)
- **Contract:** [Agent DOM v2](../docs/agent-dom-contract-v2.md), HTTP transport profile v0

| File | What it is |
| --- | --- |
| `main.ts` | Entry point. Config from the environment, endpoint, signals. Wiring only. |
| `standalone.ts` | The *host's* entry point (MAR-497). Preflight, data directory, then `main.ts`. |
| `host-runtime.ts` | What a host must provide before any of this can start. Pure. |
| `endpoint.ts` | Where it listens: Unix socket or named pipe. Binding, stale recovery, modes. |
| `channel-secret.ts` | The channel credential and the owner-only ACL that protects it. |
| `server.ts` | The HTTP surface: the v0 profile plus `/lifecycle` and `/health`. |
| `execute.ts` | The runner's own adjudication of a command. The order is the argument. |
| `supervisor.ts` | Child processes: spawn, stop, watch, deliver. |
| `protocol.ts` | The runner ↔ agent wire format. Pure. |
| `state.ts` | Builds the Agent DOM state document. Pure. |
| `store.ts` | The runner's own SQLite: nonces, idempotency, approvals, audit. |
| `store-damage.ts` | What to do when that database cannot be read: classify, refuse, set aside. |
| `schedule.ts` | The scheduler (ADR 0029). Ticks, fires ADR 0022's two acts, spools what it did. |

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
- **Its own credential.** A bearer token, minted on first run, held in
  `runner.key` under an owner-only ACL, never written to `runner.json`, never
  logged, and stripped from every agent's environment.

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
{"type":"telemetry","event":{"event_version":1,"agent":"my-agent","run_id":"…","seq":0,"ts":"…","type":"run_started"}}
```

**Acknowledgement is mandatory.** A line written to a pipe proves nothing about
whether the agent read it, so an unacknowledged command settles as
`delivery_unacknowledged` rather than as success. Non-protocol output is not an
error: agents log, and the first `console.log` in anybody's agent must not look
like a fault.

**Telemetry uses this existing pipe.** The runner holds a bounded in-memory
batch, and DASH main drains it through the same authenticated local endpoint on
the state poll. Main passes every candidate to `ingestEvents`, so the frozen v1
schema and per-item rejection behavior are identical to `POST /api/events`.
Malformed neighbours do not discard valid events and do not stop the child.
`runs/events.jsonl` remains the agent's primary record; the buffer is
fire-and-forget delivery, not a second history.

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

**Since MAR-428, DASH writes these files too.** A registration DASH created from
a handoff the user approved carries an extra `dash` block naming its owner; this
runner reads the fields it knows and carries the rest through untouched, so
ownership costs it nothing. See [`docs/agent-handoff.md`](../docs/agent-handoff.md).

### One command name that is not a program (MAR-423)

`"command": "dash:node"` is a sentinel. The runner resolves it, at the moment of
spawning, to its own `process.execPath` with `ELECTRON_RUN_AS_NODE=1` — the pair
that makes the Electron binary a Node runtime, and the same one that launched
this runner.

It exists so DASH's sample agent runs on a machine with no Node installed, which
is the machine the person DASH is for actually has. It cannot be a *path*
because the MSIX install root is version-stamped: a registration holding a real
`execPath` would stop working at the first update. Resolving at spawn means
nothing version-stamped is ever written to a file.

It grants nothing new — a registration may already name any command, and this
names strictly one, which is DASH's own binary rather than anything on disk. The
`ELECTRON_RUN_AS_NODE=1` is applied *after* the registration's own `env` block,
so a registration cannot ask for this interpreter and then unset the flag that
makes it one; the child would otherwise be the DASH shell, windows and all, with
an agent's script as its argument.

The rule above is untouched: the API still chooses which registration to start
and never what to run. This changes only how the interpreter DASH ships is
reached.

### Taking up a fresh reading (MAR-428)

```
POST /registrations/reload
```

Authenticated, and the **request body is ignored entirely**. The runner re-reads
the directory itself, so the caller chooses *when* it looks and never *what* it
finds — the rule above survives intact, and this route does not even choose
which registration to act on.

Before this, the set of supervised agents was decided once at process start.
That was tolerable while every registration was hand-written; it is not once DASH
writes them, because "approving a handoff produces a registered agent with live
state" is not met by a criterion the user has to restart something to satisfy.

**A running agent is never disturbed by a reload.** Not restarted, not re-pointed
at a different command line, not forgotten because its file vanished. This
runner's claim to own lifecycle facts rests on having started the process, and
swapping the registration under a live child would make its own record a guess.
Changes to a running agent are *deferred*, reported as deferred, and applied the
next time that agent starts.

## Where it listens (MAR-430)

**Not on a port.** A loopback TCP listener is reachable by every process on the
machine, which left a bearer token as the only thing between a hostile local
program and the command channel. The endpoint is now the operating system's
problem:

| Platform | Endpoint | What limits access |
| --- | --- | --- |
| macOS / Linux | Unix-domain socket | 0700 runtime directory, 0600 socket, ownership checked before use |
| Windows | Named pipe | The pipe's descriptor, plus the channel secret — read on |

The HTTP above it is unchanged. `node:http` serves a `socketPath` exactly as it
serves a port, so this is a transport swap and not a protocol change, and
`tests/runner-server.test.ts` runs its whole suite over the real endpoint.

### The Windows part, stated honestly

**Node cannot author a named pipe's DACL.** libuv calls `CreateNamedPipeW` with
`lpSecurityAttributes = NULL` and exposes no override, and fixing it after
`listen()` does not work either: each pipe *instance* is given its descriptor at
creation and libuv creates a fresh instance per connection.

The descriptor Windows assigns — measured on this project's own runner, not
assumed — is:

```
D:(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;<owner>)(A;;FR;;;WD)(A;;FR;;;AN)
```

`WD` is Everyone and `AN` is Anonymous, both with `FILE_GENERIC_READ`. That is
wider than owner-only and it is why MAR-430 named the DACL as an acceptance
criterion.

What it does **not** grant is `FILE_WRITE_DATA`. A foreign principal can connect
and occupy a pipe instance; it cannot write a byte. Every byte this runner emits
is a response to a request the peer had to send first, so a peer that cannot
write learns nothing and commands nothing — which is the criterion "a different
local user cannot read state or submit a command", met.

Depth for the part that cannot be authored comes from the credential, whose ACL
*can* be set and *can* be verified. `channel-secret.ts` writes `runner.key`, then
proves what it wrote by reading the descriptor back with `icacls /save` — which
emits SDDL with raw SIDs, so the check does not depend on the machine's
language. Anything that is neither this user, SYSTEM nor Administrators is
removed; if the ACL still cannot be proven after that, the runner refuses to
start. An unprovable ACL is not a protected secret.

Two guarantees come free from the platform and are relied on deliberately:
libuv passes `FILE_FLAG_FIRST_PIPE_INSTANCE`, so a second bind to a live name is
`EADDRINUSE` rather than a silent join; and the endpoint name is minted fresh
per spawn, so it cannot be squatted in advance.

## Running it

The runner is started by DASH. To run it by hand for debugging:

```sh
pnpm build:shell
DASH_RUNNER_DATA_DIR=/tmp/dash-runner node dist/electron/runner.mjs
```

| Variable | Meaning |
| --- | --- |
| `DASH_RUNNER_DATA_DIR` | Required. Database, registrations, credential, endpoint file and log. |
| `DASH_RUNNER_ENDPOINT_ID` | Optional. DASH mints one per spawn; a hand-run generates its own. |

No token variable any more. It used to be one, on the argument that the
environment was the only channel to a detached child that did not touch disk;
`runner.key` touches disk on purpose and is better for it, since an environment
block is readable on Linux by any process of the same user via
`/proc/{pid}/environ`.

It writes `runner.json` — pid, endpoint path, transport, runner protocol and a
build-derived runner identity, never the credential — once it is listening.
That file and the live `/health` response must both match the shell before DASH
re-adopts a runner. A compatible process preserves the fleet across UI restarts;
an incompatible one receives an authenticated `/shutdown` request and is
replaced only after it checkpoints and exits. A Windows runner from before that
route existed is left alone and requires one OS restart; DASH never maps a
"graceful" stop to `TerminateProcess`.

The endpoint path is not a secret: a Windows pipe name is enumerable by any
local process anyway, and its value is that it could not be guessed
*beforehand*.

### Running it on a host DASH was never installed on (MAR-497)

```sh
pnpm build:runner-standalone      # writes dist/runner-standalone/
node dist/runner-standalone/start.mjs
```

That directory is the whole artifact: `start.mjs`, `runner.mjs`, `contracts/`, a
`package.json` and a README for whoever unpacks it on the host. ADR 0007
amendment 1 is the decision; three things are worth knowing here.

**The host supplies Node, and the artifact refuses rather than crashing.** The
runner is plain Node in the sense that it needs no Electron, and *not* in the
sense that any Node will do: `store.ts` uses `node:sqlite`, which is standard
library and therefore carries a version floor rather than a package to install.
The floor is Node 24. `host-runtime.ts` checks the version and then actually
resolves the module, and an unsuitable host gets a sentence plus exit code **78**
(`EX_CONFIG`) instead of a stack trace from inside SQLite. A runner that started
and then failed still exits 1; the two codes mean different things to whoever is
looking at them.

**`contracts/` is in the artifact because the search would otherwise find the
repository.** `lib/contracts.ts` walks up from its own module location, so an
artifact carrying no schemas at all works perfectly under this repository and
fails on a host at the first manifest. `tests/runner-standalone.test.ts` copies
the artifact somewhere with nothing above it before starting it, which is the
only arrangement in which that difference is visible.

**The data directory is created and hardened here, not inherited.** On Windows
it sits under a user profile whose ACL already excludes other principals; a VPS
home directory does not. `standalone.ts` applies the same `hardenOwnerOnly` that
protects `runner.key` to the directory holding the database, the credential and
any file a person handed to an agent — and refuses to start if it cannot prove
the permissions. Default `~/.orchestratedash/runner`; `DASH_RUNNER_DATA_DIR`
wins when it is set.

**`dash:node` already means the right thing here**, which the sentinel's name
does not suggest. `resolveSpawnCommand` returns the *spawning* process's own
`execPath`, and on a host that process is this runner under the host's Node — so
the sentinel resolves to the host's Node and `ELECTRON_RUN_AS_NODE=1` is a flag
plain Node has no opinion about. No host-specific branch, and the reason the
sentinel exists carries over: a registration must not name a real interpreter
path, on a version-stamped install root or on a host. The sample agent is
registered with exactly this sentinel and is the first thing anybody would
deploy, so `tests/runner-standalone.test.ts` starts a real child through it.

Nothing about this opens a port, ships a service unit, or restarts anything.
Item 3 below is unchanged and deliberately so, and nothing in this section is
proven against a real host — see ADR 0004.

A crash leaves nothing wedged. A named pipe dies with the process holding it; a
Unix socket can outlive one, so `prepareEndpoint` probes it first and unlinks it
only on `ECONNREFUSED` — never merely because the file is there, which would be
a race with a runner that is busy, and never on `EACCES`, which would be this
process deleting another user's socket.

## What CI covers, and why that is new

The Linux CI job skips the Electron binary and covers typechecking, tests and
bundling. A separate Windows `shell-smoke` job downloads Electron and runs
`pnpm verify:shell` against the packaged `dash-app://` renderer. That gate now
includes the real sample handoff, runner-hosted telemetry reaching Runs and the
sample's digest artifact.

The runner has no such constraint. It is Node spawning Node over an OS-local
socket, so `tests/runner-*.test.ts` run on every push against real processes and
a real server — including graceful shutdown and "an invalid manifest is refused
before anything spawns". *Electron spawning the runner* is covered by the
Windows shell job.

MAR-430's proofs are split by what each platform can actually demonstrate.
`tests/runner-endpoint.test.ts` binds real endpoints: that `address()` returns a
path and not a port, that a second runner is refused, and — on POSIX only — that
a crashed runner's socket is reclaimed while a live one's is left alone.
`tests/channel-secret.test.ts` exercises the ACL rule as a pure function over
SDDL strings, including the verbatim named-pipe default with `WD` and `AN` in
it, so the case that motivates the whole issue is asserted on Linux CI where no
named pipe exists. The `icacls` path itself only runs on Windows, and the
cross-principal negative test is a manual one — CI has one user.

One test is skipped on Windows: the SIGKILL escalation, because Node emulates
`kill` with `TerminateProcess` there, so an agent cannot decline SIGTERM and
there is nothing to escalate from. It runs on CI's Linux.

## What this slice does not do

Named here rather than discovered later:

1. ~~**No Agent Kit.**~~ **Delivered in MAR-428.** `agent-kit/` is
   `create-dash-agent`: one command produces a project with a v2 manifest,
   telemetry v1 and this protocol wired by default, and a second one hands it to
   DASH over a `dash://` link. Nobody writes a registration file by hand any
   more — though the hand-written path still works, is still documented above,
   and DASH will not delete a registration it did not create.

   Still not published to a registry: the package is `private: true`, so today
   it is `pnpm build:agent-kit && node agent-kit/dist/cli.mjs my-agent`.
2. **No CPU or memory reporting.** The issue asks for it and says the runner can
   report it honestly because it started the process. That is true of the PID
   and of liveness, and not yet true of the rest: reading a child's CPU and RSS
   portably needs a native dependency or a subprocess per poll. The field is
   absent rather than zero.
3. **No restart policy.** An agent that exits stays exited. Supervision here
   means "knows it died and says so", not "brings it back" — a restart loop
   around a crashing agent that holds provider credentials is a decision that
   deserves its own issue.

   **A schedule is not a restart policy** (MAR-742 item 8, ADR 0029), and the
   distinction is worth stating out loud now that `runner/schedule.ts` does
   start agents. It starts one at a time a person named, once per window,
   whatever that agent did last — it never watches for an exit and never reacts
   to one. An agent that crashes at 08:01 stays crashed until 08:00 tomorrow,
   which is the sentence above still holding rather than an exception to it.
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
7. ~~**No OS-backed vault means no runner.**~~ **Fixed in MAR-430.** It was the
   right instinct applied to the wrong secret. A vault protects a credential a
   *person* entrusted to DASH; the channel token is one this installation minted
   to talk to a process it started, under the same user, on the same machine.
   Requiring a keyring for it meant a Linux box without libsecret could not host
   even an agent that had no credentials of its own.

   The line is now drawn where it belongs. Provider credentials and remote
   enrollment tokens still require `SecureStore` and still fail closed without
   it. The channel credential lives in `runner.key` under an ACL this project
   sets and proves. The one remaining reason a machine cannot host agents is
   that the ACL could not be applied or could not be verified — a real refusal,
   and a much rarer one.
