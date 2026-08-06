# ADR 0007: The deploy transport reaches out and carries two planes

Status: Accepted

Date: 2026-08-06

## Decision

**DASH reaches a remote host over SSH, outbound from this machine only, and
runs two separate planes over it with two separate credentials.**

1. **The deploy plane** — put a bundle on the host, install it, start it, stop
   it, ask what is running. SSH exec against a **fixed verb set** installed on
   the host, never a shell command DASH composes. The credential is an SSH key
   DASH holds on this machine.
2. **The control and evidence plane** — the contract's HTTP transport profile
   v0, byte for byte the one `lib/agent-dom/transport.ts` already speaks,
   carried over the SSH connection to a Unix socket the remote runner listens
   on. The credential is that runner's own channel secret.

Neither plane opens a listening port: not on the VPS beyond the `sshd` that is
already there, and **not on this machine at all**. There is no forwarded
loopback port, no TLS certificate, no domain name, and no ingest endpoint.

And one route is excluded by name, because it is the only one that could undo
ADR 0006:

> **`/broker/drain` and `/broker/responses` are never called on a remote
> channel.** Not conditionally, not behind a flag, not "only for agents that
> declare `local`". The remote channel type does not carry the capability.

## What is already true, before designing anything on top of it

ADR 0005's habit again, and it changes the question: **most of this is built.**

**DASH already has a remote control plane, and it is the same code as the local
one.** `electron/agent-adapters.ts:333` resolves a channel for an agent; when
the bundled runner does not host it, it falls through to the manifest's declared
control location and a token read from the OS vault under
`dash.adapter.{agent}.token` (`adapterTokenName`, line 59). That channel goes to
the same `httpAdapter`, and `poll()` at line 387 already calls
`fetchAgentDomState` against it every five seconds. `lib/agent-dom/transport.ts`
says so in its own header: one adapter class for two kinds of agent, "they
differ in what their manifests declare, not in the code that reaches them."

`runner/README.md` item 6 names the gap precisely, and has for three months:

> **One runner, one machine, no enrollment.** There is no flow for pointing DASH
> at a *remote* runner. `httpAdapter` would reach one, and the vault would hold
> its token under `dash.adapter.{agent}.token`, but nothing mints or exchanges
> that credential.

So this ADR is not choosing a transport for a control plane that does not exist.
It is choosing **how the bytes travel** for one that does, and deciding
enrollment. That is a much smaller decision than the epic's shape suggests, and
pretending otherwise would licence rebuilding things that work.

**"DASH pulls, nothing dials in" is not a design to invent; it is a property to
avoid losing.** `startPolling` (line 416) is a self-scheduling timeout in
Electron main that dials outward. Every existing channel is outbound. MAR-488
states the premise as though it were a decision to be taken, and the honest
reading is that it is already true and the work is to keep it true while adding
a host.

**The `ipc_path` seam is the precedent for a third transport, and it proves the
cost is low.** `ControlChannel.ipc_path` means "dial this instead of resolving
the URI" (`lib/agent-dom/transport.ts:62`), and `lib/agent-dom/ipc-fetch.ts` is
a `fetch`-shaped function over `node:http` with a `socketPath`. MAR-430 moved
the local runner off TCP by writing that one file: the byte ceiling, the
timeout, the scrubbed `detail`, the never-quote-the-token rule and the
`unavailable`/`failed` taxonomy all survived untouched, because they hang off an
injectable `fetch` rather than off a socket. A third dialer is the same move a
second time.

**The runner already refuses to be a remote shell, in writing.** `runner/README.md`:

> Registrations are files rather than something `POST`ed, on purpose: "start
> this agent" naming an arbitrary command line would make the control endpoint a
> remote shell with extra steps. The API chooses *which* registration to start,
> never *what* to run.

That sentence decides more of this ADR than anything in ADR 0006. The deploy
plane wants exactly the power the runner declined to expose — put files on a
box, install a service, start a process — so the deploy plane **cannot be a new
route on the runner**. It has to be a different channel with a different
credential, and the same discipline has to be re-imposed on it, because SSH will
give you a general shell whether or not you wanted one.

**And there is no SSH in this repository.** Five runtime dependencies: `ajv`,
`ajv-formats`, `next`, `react`, `react-dom`. Whatever this ADR chooses, it is
choosing to add something.

## The plane that must not be generalised

This is the load-bearing paragraph and it is a finding rather than a
restatement.

ADR 0006's guarantee — a process DASH's runner did not spawn gets no brokered
credential — is currently enforced by **an accident of control flow**.
`drainTelemetry`, `drainArtifacts` and `syncWorkspace` each open with `if
(runner === null) { return; }` (`electron/agent-adapters.ts:141`, `215`, `291`),
where `runner` is the *local* `RunnerHandle`. They are not written against a
channel. They are hardcoded to the one runner this machine spawned.

`POST /broker/drain` (`runner/server.ts:238`) sits in the same list of routes as
`/telemetry/drain` and `/artifacts/drain`, on the same authenticated channel,
answering the same shape. The three are neighbours in the source and neighbours
in the caller.

So the failure mode is not that somebody argues for extending the broker. It is
that somebody implementing MAR-488 does the obvious correct-looking refactor —
generalise the drain helpers to take a `ControlChannel` instead of closing over
`runner`, so a remote runner's telemetry can be pulled the same way — and
`/broker/drain` comes along **because it was in the same loop**. No line of code
would say "extend the broker off this machine." ADR 0006 would be gone, silently,
in a commit whose message says "pull remote run evidence."

ADR 0006 anticipated the argued version of this and rejected it: "Let a remote
agent reach the broker over an authenticated tunnel from the user's machine…
This is option 2 wearing a local costume." What it did not anticipate is the
*unargued* version, where the tunnel is built for telemetry and the broker rides
it by adjacency.

Therefore the exclusion above is structural rather than a rule to remember. A
remote channel is a **different type** that does not carry the broker
capability, so the generalising refactor fails to compile rather than
succeeding quietly. That is the same standard ADR 0002 amendment 2 applied to
`WriteOperation` when it removed `plan` rather than checking its output, and the
same one amendment 1 records as the difference between a rule someone must
follow and a fact about where the code can run.

## The candidates

### Option 1 — HTTPS direct to a public runner endpoint

The remote runner listens on a real port with a real certificate; DASH resolves
the manifest's control location and dials it. `checkControlUrl`
(`lib/agent-dom/control-location.ts:152`) already permits exactly this and
refuses plain HTTP off loopback, so on paper it is the zero-code option.

It fails on three counts, and the first is policy.

**It is not $0.** A certificate needs a name, a name is a domain, and a domain
is a recurring bill before there is a paying user. Let's Encrypt removes the
certificate's price and not the name's, and a bare-IP certificate is not a thing
a public CA issues. "No recurring costs until revenue" is not a preference this
ADR gets to trade away for convenience.

**It makes the runner's whole surface internet-reachable.** That surface is no
longer small. Since MAR-434 it includes `POST /agents/{id}/tasks/{taskId}/inputs`
— file admission — and `GET /workspace-artifacts`, and the artifact byte routes
(`runner/server.ts:277`–`561`). A bearer token in front of all of it, on the
public internet, is the posture MAR-430 removed on a *loopback* port on the
grounds that a token was the only thing standing between a hostile local program
and the command channel. Putting it on the internet instead is that decision
reversed and widened.

**And it puts the broker route on the internet too.** `/broker/drain` would be
one authenticated request from anywhere. The exclusion above stops DASH calling
it; nothing would stop anyone else reaching it.

### Option 2 — SSH with a forwarded loopback port

`ssh -L 127.0.0.1:0:/path/to/runner.sock user@host`, then point the existing
`httpAdapter` at `http://127.0.0.1:PORT`. Loopback, so `checkControlUrl` permits
plain HTTP. Every property of the transport preserved. This is what a competent
implementer reaches for first and it is worth arguing down rather than skipping,
because nothing about it looks wrong.

**It reintroduces the exact thing MAR-430 deleted.** `runner/endpoint.ts` opens
with why the port went away: "a TCP listener is reachable by *every* process on
the machine, so the only thing standing between a hostile local program and the
command channel was a bearer token." A forwarded loopback port is a TCP listener
on this machine, reachable by every process on it, with a bearer token in front
of it. It does not matter that the far end is a socket; the near end is the
thing local malware connects to, and the near end is a port again.

The channel it exposes is worse than the one MAR-430 closed, because it reaches
a host the user is *paying for and not watching*, not a child process they can
see in Task Manager.

So option 2 is rejected for the reason MAR-430 exists, and this ADR says so
explicitly because "SSH tunnel" sounds like it inherits SSH's safety when the
part that matters is which end you left open.

### Option 3 — SSH exec, no listener on either side

DASH spawns `ssh host <verb>`. For the deploy plane the verbs are deploy
operations. For the control plane one verb connects the host's runner socket to
its own stdio, and DASH speaks HTTP over that pipe with an `ipcFetch`-shaped
dialer.

Nothing listens on this machine. Nothing new listens on the VPS. The connection
is outbound TCP to port 22 and the VPS never initiates anything.

## What is chosen, and why the two planes are one decision

**Option 3, for both planes. Options 1 and 2 are rejected.**

The two planes share a decision because they share the property that decides it:
*the only thing DASH is willing to have on the far end is something it dialed.*
Splitting them — SSH for deploy, HTTPS for control — would mean the control
plane paying option 1's costs for no gain, since the SSH connection needed for
deploy already exists and can carry it.

### The deploy plane, and the discipline it inherits

SSH exec is a general shell, which is the thing `runner/README.md` refused to
build. So DASH does not compose command lines. The bundle DASH pushes includes a
small **host helper** with a closed verb set — install a bundle, start, stop,
status, collect, connect — and every SSH invocation names one of those verbs.

The rule is the runner's, moved one machine over and stated in its own words:
**DASH chooses which operation, never what to run.** A verb takes arguments the
helper validates; it does not take a command.

This is not a security boundary against the host — DASH holds a key that could
run anything, and pretending otherwise would be the dishonesty ADR 0006 spends
its length avoiding. It is a boundary against **DASH itself**: a bug, a bad
manifest, or a hostile build brief cannot turn a deploy into arbitrary remote
execution, because the string DASH sends is drawn from a fixed set. Named
plainly so nobody reads more into it.

### The control plane, unchanged

The remote runner is **the runner already in this repository**, run on the host
with `DASH_RUNNER_DATA_DIR` set — the hand-run path `runner/README.md` already
documents. It listens on a Unix socket via `runner/endpoint.ts`, which needs no
change: the POSIX branch is the one that already hardens the directory to 0700,
the socket to 0600, and checks ownership.

`isLocalPeer` (`runner/server.ts:789`) still returns true, because an IPC
connection has no remote address — and it stays true for the right reason rather
than by luck, since the far end genuinely is a local socket on that host,
reached by a process `sshd` authenticated.

DASH's side is one new file: a `fetch`-shaped function over the stdio of an
`ssh` child, sitting exactly where `ipcFetch` sits. `lib/agent-dom/transport.ts`,
`runner/server.ts` and `runner/endpoint.ts` are untouched.

### Where the SSH key lives, and the precedent for it

The private key is a credential DASH holds on this machine. Using it from an
open DASH, on this machine, to dial outward is the **inside** of ADR 0006's
line — the same side as every token in the vault. It never ships to the host and
never reaches an agent's environment; `deliverableSecretFields` cannot return it
and `assertNoBrokeredCredentials` (`electron/main.ts:719`) is unaffected,
because it is not a connection field at all.

The awkward part, stated rather than glossed: **the system `ssh` binary needs
the key as a file.** It cannot read `safeStorage`. So the vault is not the whole
answer, and the honest answer is already in this repository —
`runner/channel-secret.ts` writes `runner.key` under an owner-only ACL, then
*proves what it wrote* by reading the descriptor back with `icacls /save`, and
refuses to start if the ACL cannot be verified. The deploy key gets the same
treatment and the same refusal. An unprovable ACL is not a protected secret.

Preferring `ssh-agent` would avoid the file and introduce a per-platform daemon
whose presence DASH cannot guarantee; the file with a proven ACL is the option
this project already knows how to check on the machine it ships to.

### System `ssh` rather than a library

`ssh` is present on Windows 10+, macOS and every Linux DASH would run on. A
pure-JS client (`ssh2`) would be a large new runtime dependency implementing
cryptography, in a repository with five runtime dependencies and none of that
character.

The cost is real and goes in the ADR rather than in a comment: DASH depends on a
binary it does not version, whose behaviour varies across builds, and whose
absence is a first-run failure. So the connect flow **probes for it and says so
plainly** rather than failing at the first deploy — the same shape as
`prepareEndpoint` refusing with a named `EndpointProblem` rather than a
mysterious bind error.

## What the Connection Center must say

The test ADR 0006 set: a receipt that cannot describe the arrangement honestly
rules the option out. Plain language, passing `lib/copy/identifiers.ts` — no
field names, no environment variable names, no filenames.

**A connected host, while DASH is open:**

> DASH reaches this server when it is open. Nothing on the server can reach back
> to this computer.

**A connected host, while DASH is closed** — said *before* the first deploy, for
amendment 2's reason:

> Agents you put on this server keep running when DASH is closed. DASH will not
> see what they did until you open it again, and it can only show you what the
> server still has when it looks.

That second sentence is the honest one and it is unpleasant. It has to be there,
because the pull model means evidence is bounded by what survived on the host
until the next poll — which is a real gap and not a rendering delay.

**An agent on the server that wanted a DASH connection.** This is MAR-482's
refusal, said at import rather than here, and this ADR does not restate it
beyond noting that ADR 0007 gives it nothing new to say. The transport does not
widen a grant; it never could.

## What stops being proven

**Nothing about a remote host can have a blocking gate, permanently.** ADR 0004
allows a blocking gate to depend only on this repository and this machine. A VPS
is neither. This is inherited from ADR 0006 rather than introduced here, and it
means MAR-489's shape — attended, dated, promotion rule written first — is the
permanent shape and not a stage.

**But the transport itself is provable in CI, and that is worth claiming
precisely.** The stdio dialer is a `fetch` over a child process's pipes. A test
can spawn a local child that speaks HTTP over its own stdio and exercise every
property `ipcFetch` is tested for — the byte ceiling, the abort path, the
`unavailable`/`failed` split — with no SSH, no host and no network. What stays
unproven by that is `ssh` itself: authentication, the far-side helper, and the
host's socket. So the seam is one file wide, in the sense
`docs/real-google-proof-runbook.md` means it: **the only variable between the
CI proof and the attended one is which process is on the other end of the
pipe.**

**Evidence is bounded by the host's retention and by when DASH last looked.**
A local runner's telemetry buffer is drained every five seconds by a DASH that
is usually running. A remote one is drained when DASH next opens, from a buffer
that is bounded — `runner/supervisor.ts` drops past its bound and reports the
count, which is how proof 8 works. On a host running for a week against a DASH
opened on Sundays, "dropped" will be the ordinary case rather than the alarming
one, and the Runs page must not render a week of missing evidence as if it were
a complete record. This is a real cost of choosing pull, and pull was chosen
anyway, for ADR 0006's reason.

**`isLocalPeer` stops being a meaningful check without stopping being a correct
one.** It was already vacuous for the local runner. It is now vacuous for a
second reason on a second machine. Its value remains what its comment says: a
guard against a future TCP listener, which this ADR makes less likely rather
than more.

## Alternatives rejected

**A relay DASH and the VPS both dial.** Solves the NAT problem the pull model
works around, and is ADR 0006's rejected hosted broker with the word "telemetry"
substituted: an operator, a recurring bill, and a third party in the path of
evidence DASH presents as its own record.

**Push to an ingest endpoint DASH exposes.** Requires an inbound path to a
desktop behind NAT, which is either a relay or port forwarding a user must
configure. It also inverts the property this ADR exists to keep: an address on
the VPS side that dials in is exactly what ADR 0006 observed did not exist.

**Reuse `dash.adapter.{agent}.token` as the enrollment credential.** It is
per-agent; a host holds many agents and its runner has one channel secret. The
existing name stays for what it describes — a remote *agent* DASH did not
deploy — and a host record gets its own. Overloading it would make one vault
entry mean two different things depending on who wrote it.

**Deploy over the runner's own channel by adding routes.** A `POST /deploy`
taking a bundle and a command line is the remote shell `runner/README.md`
declined, arriving as a feature. The deploy plane stays outside the contract's
transport profile deliberately, because the profile's discipline — seven verbs,
declared in a manifest — is the thing that makes it safe to expose, and deploy
has no manifest to declare.

## Follow-ups this does not do

- **The host helper's verb set is not specified here.** It belongs with the
  deploy bridge, where there is something to validate against, for the reason
  ADR 0006 gave for not building the import validator alone.
- **What runs on the VPS is not fully decided.** This ADR assumes the remote
  process is *this repository's runner*, which makes the evidence plane free and
  is the reason the control plane costs one file. Whether the runner can be
  shipped standalone — it is bundled into the Electron app as
  `dist/electron/runner.mjs`, and a host needs a Node runtime the MSIX install
  does not provide there — is unowned by any current issue and is named in the
  breakdown rather than answered here.
- **Restart-on-boot is not decided.** `runner/README.md` item 3 records that
  there is no restart policy anywhere in DASH, deliberately. A host that
  restarts an agent DASH cannot see is a supervision claim DASH cannot make, and
  it deserves its own decision rather than a systemd flag chosen in passing.
- **Retention on the host is not decided**, and item 4 already says nothing
  prunes anything. On a machine the user pays for by the gigabyte that stops
  being a deferred nicety.
