# VPS residency — the chief on a machine the customer owns

**Status: proposal.** Not a decision, not an implementation, and it assigns no
ADR number. The ADRs come with the packets, from the orchestrator, at dispatch —
`AGENTS.md`'s rule about serial-numbered resources, and the reason
[[parallel-packets-collide-on-adr-numbers]] exists.

**Date:** 2026-08-25. **Issue:** MAR-742 roadmap item 4 / child 3.
**Repository:** orchestratedash. **Author:** `claude --model opus`, read-only on
product code.

**Bounded by decisions already taken, which this proposal extends and does not
reopen:** ADR 0021 (the host is a small DASH runtime), ADR 0028 (the chief lives
in the runner), ADR 0029 + amendment 1 (a schedule is a standing instruction; a
schedule may carry a ceiling), ADR 0030 (autostart, and `schedule_standing`),
ADR 0018 (a key crosses only on a person's press), ADR 0016 (a run press may
spend), ADR 0014 (asking a host to run an agent, and its three admission
questions), ADR 0009 (first-pin enrolment and the forced command), ADR 0007 (the
deploy transport), ADR 0006 (the broker's reach ends at this machine).

The customer owns the server. We take custody of nothing. Enrolment, never a
listening port. Those three came from MAR-442/481 and they are inputs here, not
findings.

---

## 0. What this document is for

Henrik's spec for item 4 is five clauses long and every one of them lands on a
seam that already exists. The value of a proposal rather than a packet is that
**three of the five clauses are blocked on the same missing thing**, and that
thing is one packet nobody has written. Discovering that inside an
implementation session would produce four PRs stacked behind a fifth.

So this document does three jobs: it says what the machine actually runs, it
names the one blocking dependency plainly enough that it cannot be routed
around, and it cuts the work into five packets that can be dispatched in an
order where each one is provable when it lands.

It proposes. Henrik decides. Children get filed after his read.

---

## 1. Henrik's spec, clause by clause, and what each one turns out to mean

From the roadmap intake of 2026-08-24, verbatim:

> **VPS residency (this epic's child 3), Henrik's spec verbatim:** startup file
> delivered on connect; wipe stale state but store it locally first; push
> credentials (Discord, AI keys — everything agents need); a bridge to push
> agents to the cloud; the cloud chief talks even with the computer off,
> accesses its tools, and *knows about* local agents and their latest generated
> information without being able to run them.

| clause | what it means against this codebase | state today |
| --- | --- | --- |
| **startup file delivered on connect** | the enrolled host brings its own runner back up after a reboot, without a person signing in — the boot half ADR 0007 left open and ADR 0030 §8 explicitly did **not** close for a host | **undecided.** `runner/standalone.ts`: *"No restart policy, no service file, no boot integration."* |
| **wipe stale state, store it locally first** | re-enrolment and re-setup pull the host's account of itself home **before** replacing anything — `lib/deploy/bring-home.ts`'s rule (*"DASH does not remove what it could not copy"*) raised from one bundle to the whole host | **partly built.** The rule and the `collect` / `uninstall` ordering exist per agent. ADR 0021 §4's re-run path currently says the opposite for the pack: it *"does not preserve, merge or inspect"*. That is safe only while a host pack is empty, which stops being true the moment clause 3 lands. |
| **push credentials (Discord, AI keys)** | ADR 0018's `install-key` ceremony, plus a second custody class (a bot token) and a slot that belongs to no bundle | **not built.** `install-key` is admitted by ADR 0018 and is absent from `DEPLOY_VERBS`. MAR-625 has been In Progress since 2026-08-13 with no code. **This is the blocker.** |
| **a bridge to push agents to the cloud** | already shipped, once, with one refusal in front of it | **built.** `install` + `start` + the deploy wizard. The refusal is MAR-482: a `remote` runtime beside a `dash_managed` connection is refused at import, because a credentialed agent could not be fed on a host. Clause 3 is that refusal's exit. |
| **cloud chief talks with the computer off** | ADR 0028's chief, running in the *host's* runner, answering Discord over the host's own outbound socket, spending through a broker on the host | **most of the code exists and none of it is reachable.** See §3. |
| **knows local agents' latest info, cannot run them** | a snapshot pushed from DASH to the host, stamped with its own age, read-only by construction — `schedule_standing` generalised, and the `chief_standing` gap ADR 0030 §6 named and declined to fill | **not built,** and named as a known gap in a shipped ADR. |

**One clause is already done, one is a rule that needs raising, and three are
blocked on `install-key`.** That is the finding this document exists to deliver
before anybody dispatches.

---

## 2. What is already true, before designing anything on top of it

ADR 0005's habit. Everything below was read at `69a9158`, not remembered.

**The host is already a small DASH runtime, and it was never proven.** MAR-629
shipped ADR 0021's pack — `runner/host-broker.ts`, `runner/host-pack.ts`,
`lib/deploy/host-pack.ts`, the `pack` verb, the `host_pack_too_old` stop and its
sentence in `lib/copy/host-pack.ts`. `.orchestrate/state.json` carries MAR-629 as
**merged, not proven**, at `211b73e` / `ef23289`; `PROJECT_STATE.md` (dated
2026-08-19) still describes ADR 0021 as *"planned, documentation only"* and is
stale on that point. Nothing in the pack has ever run on `186.240.156.166`.

**The host broker admits nine operations and can never be fed.** `install-key`
does not exist, so `keys/{bundle_id}/{connection_id}` is a directory nothing
writes. `lib/copy/host-pack.ts` says so in its own header, deliberately: *"There
is no sentence in this file offering to put a key on a server, and that absence
is the honest state of this pack rather than an oversight."*

**The chief is already in every runner, including the one on a VPS.**
`runner/main.ts` constructs `RunnerChief` unconditionally (line 210), and
`runner/standalone.ts` hands over to the same `runner.mjs`. A host enrolled today
is already running the chief's code. It is idle because nothing has ever posted
to `POST /chief/discord` on that machine, and nothing can: that route is not on
the remote channel, and it carries two credentials.

**`runner/chief-broker.ts` already answers the chief with DASH closed.** One
principal, one connection (`chief:model-provider`), one operation
(`{provider}.chat.completion`), and no allowance anybody can open. It holds the
model key **in memory only**, handed over by main on the local authenticated
channel — ADR 0028 decision 5, whose bound is stated as *"a restart erases it"*.
That bound is survivable on a laptop somebody opens every day. It is not
survivable on a server whose whole purpose is that nobody opens anything.

**The remote channel is an allowlist with a rule attached.**
`RemoteRunnerChannel` = `EvidenceRoute | AgentCommandRoute | AgentStateRoute |
ArtifactBytesRoute`. `BROKER_ROUTES` and `BROWSER_ROUTES` are absent **by type**.
And `lib/agent-dom/runner-channel.ts` states the rule any new route obeys:

> **a route is added to both channels or to neither.** There is no such thing as
> a route the remote channel carries and the local one does not.

**Every remote route pays ADR 0014's three questions.** Does it carry a
credential in either direction? Does it choose *what* runs, or only *which*? Can
DASH describe the result honestly afterwards? Three routes have joined since the
set closed, each argued in the file. This proposal proposes two more and answers
the questions for both, in §6.

**A remote Run press already exists.** ADR 0014 amendment 1: the `channel` verb
hands back the runner's own session key, `GET /agents/{id}` says what the host is
offering, and `POST /agents/{id}/commands` delivers an adjudicated command.
`electron/host-run.ts` fetches the channel secret per press and drops it. The
memory [[deployed-agent-cannot-run-remotely]] is stale on this point and should
be updated when the first packet lands.

**A standing row is the shipped pattern for "what this runner was last told".**
ADR 0030 decision 5: `schedule_standing` in `runner.sqlite`, one row, the pushed
document **verbatim**, written on **every** push rather than on a change (a
comparison is a closed statement about which fields matter, and a field added
later would silently stop reaching disk), read back before the first tick,
**parsed and not trusted** (*"a set the runner would have refused from DASH is a
set it refuses from itself"*), and lost when `retireDamagedStore` sets a damaged
store aside — accepted, because one push repairs it.

**ADR 0030 already named the next one and declined to build it.** Decision 6:

> **The chief's fleet snapshot.** … A runner started at login answers Discord out
> of an empty fleet. That is a real gap, it is the identical shape to decision 5,
> and it is not in this packet: the fix is `chief_standing` beside
> `schedule_standing` and one call in `runner/chief.ts`.

That sentence is the design brief for §6 of this document. On a laptop it is a
gap; on a VPS it is the feature.

**Restart-on-boot on a host is open, and ADR 0030 refused to close it in
passing.** Decision 8: *"a host is a Linux box with its own service manager, and
a `systemd` unit chosen in passing is precisely what ADR 0007 refused. **Restart
-on-boot on a host remains undecided.**"* Henrik's first clause is a request to
decide it.

**Nothing brokered works while DASH is closed, except the two exceptions.**
`runner/host-broker.ts` (a host only) and `runner/chief-broker.ts` (the chief
only). A **local agent's** brokered request is buffered by
`runner/supervisor.ts` and answered by DASH's window or by nobody — which is why
ADR 0029 amendment 1 §3 has to say, on the panel, *"With DASH closed the run
still starts and still publishes, but nothing can reach your model until you open
DASH again."*

---

## 3. The architecture — what runs on the VPS

**One sentence:** the VPS runs the same runner this repository already ships,
started by the host's own service manager, holding the host pack ADR 0021
installed, with the chief awake inside it and a key in the host store instead of
in a push.

Nothing new is invented. Every box below is a file that exists.

```
  ── the customer's machine ──────────────────────────────────────────────
   DASH (Electron)                       when open: enrols, places keys,
     electron/broker-host.ts               pushes snapshots, drains evidence
     the vault  (DPAPI, this account)     when closed: nothing above happens
     dash.sqlite                          and the host does not notice
     runner/  (the local runner)
  ────────────────────────────┬───────────────────────────────────────────
                              │  ssh, forced command, two planes (ADR 0007)
                              │  deploy plane: 9 verbs + install-key
                              │  control plane: EVIDENCE_ROUTES + 3 routes
                              │  NEVER /broker/drain, NEVER /broker/responses
  ── the customer's server ───┴───────────────────────────────────────────
   scripts/host-helper/main.ts     the forced command; a closed verb set
   /opt/orchestratedash/
     dash-host                     the helper bytes this DASH shipped
     bundles/{bundle_id}/          agents, replaceable, 0644 / 0755 only
     secrets/                      0700, helper-chosen, install never writes
       pack.json  wrap.key         version 1, and the wrapping key
       keys/{bundle_id}/{conn}     0600, one file per placed key
   runner/standalone.ts            checks Node, hardens the dir, hands over
     runner/main.ts                the runner — unchanged, on both machines
       RunnerChief                 already constructed; idle until configured
       runner/chief-broker.ts      one op: {provider}.chat.completion
       runner/host-broker.ts       nine ops; refuses gmail.*, mcp.*
       runner/discord-gateway.ts   OUTBOUND websocket. Nothing accepts.
       runner.sqlite               spools + standing rows
```

**The five properties this shape keeps, each of which is somebody's decision:**

1. **No listening port, on either machine.** The runner binds an OS-local
   socket. Discord is an outbound gateway websocket — the reason ADR 0028 chose
   Discord as the first outside room rather than a webhook receiver.
2. **The agent never holds a key.** ADR 0021's whole argument for option A. A
   compromised agent on the host can ask the host broker and be refused; it
   cannot read `wrap.key`.
3. **The runner never reaches DASH's broker.** `/broker/drain` and
   `/broker/responses` stay absent from `RemoteRunnerChannel` by type. Closing
   DASH does not close the host broker, and that is the cost as well as the
   point.
4. **The two stores never consult each other.** `dash.sqlite` has one writer,
   `runner.sqlite` on the host has another, and every crossing is a push or a
   drain with its origin recorded (`chief_messages.origin`,
   `broker_audit.decided_on` — which already reserves `"host"` as a value, so
   that day is a value and not a migration).
5. **The customer owns the machine, and the receipt says what that costs.**
   ADR 0021 §3: *"the key is protected by that machine's account, not by a
   keychain; revoking means rotating at the provider."* Root on that box can read
   the store. We hold nothing, and we can revoke nothing.

**What is genuinely new, and it is three things:**

- **The host chief needs a configuration that survives a reboot.** ADR 0028
  decision 5 holds both credentials in memory. On a host that has to become the
  host secret store plus a standing row. §5.
- **The host chief needs to know about a fleet it cannot see.** §6.
- **The host runner needs to come back after a reboot.** §7 of the packet list;
  it is a decision, not a flag.

---

## 4. Enrolment, step by step, from DASH's screens

The existing wizard is `app/settings/servers/page.tsx` and `lib/host-wizard.ts`:
three steps, `address` → `key` → `check`. This proposal adds **no fourth wizard
step** and no second wizard. Residency is set up on the manage surface the wizard
already lands on, per press, per credential — because ADR 0018's consent is per
key and per host and a wizard step is a place where consent becomes a "next"
button.

What a person does, in order, with what they see:

**1. Settings → Servers → Connect a server.**
Unchanged. `address`: label, address, username, port. `key`: DASH mints a key
pair and shows the one-paste bootstrap (MAR-573) plus the by-hand
`authorized_keys` line (MAR-579). `check`: the host key fingerprint is confirmed
by the person against a source that did not travel DASH's own SSH connection
(ADR 0009 decision 1 — the trust-on-first-use gap, which no run has ever closed).

**2. The server row appears, and now says one more thing.**
Today `ServerCard` shows what is installed and alive. It gains a **residency
line** with three states and no fourth:

- *"This server was set up with an older copy of DASH's setup step…"* — the
  shipped `host_pack_too_old` sentence, unchanged, when `pack` answers
  `unknown_verb`. Its exit is the existing setup control.
- *"Ready to host agents. Nothing of yours is on it yet."* — pack version 1, no
  keys placed, no chief. This is what `186.240.156.166` should say the moment it
  is re-set-up.
- *"Hosting: 2 agents · the chief is answering in Discord · last heard from 4
  minutes ago."* — the residency state, once §5 and §6 land.

**3. "Put a key on this server" — one press, one key, one host.**
ADR 0018's ceremony, on the server row, once per credential. Before a byte moves
the frame names: the **key** by its human provider label and owning local
connection (never the value); the **server** by label, address and confirmed
fingerprint; the **agent** and its declared model need; the **custody** sentence;
and an affirmative action naming the movement — *"Put this key on Hostinger"*.
"Continue" and "Allow" are not admitted.

The press authorises **one attempt**. SSH unreachable, helper refuses, mode or
owner proof fails — the approval is spent and nothing retries.

**4. "Let the chief live here" — the second press, and the one that is new.**
Same frame shape, different contents: it names the **Discord bot token** and the
**model key** as two placements, says the chief will answer from this server
while the computer is off, and says the three things ADR 0028's setup copy
already has to say plus one:

> The message content intent is required. Whoever holds this bot token can read
> that channel and post as the bot. **And, new here:** this server will keep
> answering after your computer is off, using the key you just placed, until you
> turn it off from this page or rotate the key at your provider. Closing DASH
> does not stop it.

**5. "Bring it home" and "Reset this server".**
`bring-home` exists per agent. This proposal raises its rule (§ packet E) so that
a re-setup of the whole host copies the host's account of itself home *first* —
runner spool, chief transcript, workspace artifacts, the placed-key inventory
(names and placements, never values) — and refuses to wipe what it could not
copy.

**What a person never sees, and that is the point:** a console. ADR 0018 and
ADR 0021 §4 both make console paste the **fallback when DASH cannot reach the
host**, never the default, and specifically refuse a second ad-hoc snippet
("paste this to add the broker"). The re-run of the existing setup control lays
down the helper and the pack in one step.

---

## 5. Credential custody — what travels, what never does

### What travels

Exactly three things, each by its own act, each once, each on a press:

| what | how it travels | where it lands | who can read it |
| --- | --- | --- | --- |
| a **model provider key** | `install-key` (ADR 0018), deploy plane, stdin to `ssh`, never argv | `secrets/keys/{bundle_id}/{connection_id}`, `0600`, wrapped by `wrap.key` | the helper/runner account; root |
| a **Discord bot token** | the same verb, a reserved bundle id (below) | `secrets/keys/{RESERVED}/chief:discord` | the same |
| the **chief's model key** | the same verb, the same reserved id | `secrets/keys/{RESERVED}/chief:model-provider` | the same |

### What never travels

- **The vault.** ADR 0021 rule 6, restated because it is the shortcut somebody
  will build: *"there is no 'sync my keys', no remembered blanket approval, no
  'also copy Gmail', and no implementation shortcut that writes more than one
  slot because the bootstrap was already running."* Henrik's phrase "vault clone"
  means the runtime shape — a store, a broker, a spool — not the contents.
- **A Gmail refresh token.** ADR 0021 refuses `gmail.*` on the host broker and
  argues it: OAuth restricted scopes are a different custody class, a third party
  at consent, and revocation that is not "rotate at the provider". Widening the
  host broker to mail is its own decision with its own ceremony. **Not this
  epic.**
- **Anything through the control plane.** `/broker/drain` and
  `/broker/responses` stay off `RemoteRunnerChannel`. The one credential that
  already crosses is the `channel` verb's — the host runner's own session secret,
  travelling **host → DASH**, spent per press and never stored
  (`electron/host-run.ts`). That direction and that authority are the whole
  reason it was admissible.

### The split-roots lesson, applied remotely

[[store-and-vault-are-two-roots]] is the local version of this failure: DASH
resolves its store from `DASH_DATA_DIR` and its vault from
`app.getPath("userData")`, and a launch that moved one and not the other left a
`fleet_connections` **row** pointing at a **blob** in another directory. The
symptom was `not_found:ENOENT` on a credential that existed; the vault's own
canary read `ok`, because it writes and reads in whichever directory that process
resolved and can therefore never see a split; and the honest-looking recovery
(disconnect, re-add) destroyed a good credential to fix a path problem.

**On a host the same shape is available and worse, because nobody is watching.**
The host has two roots too: `bundles/{bundle_id}/` (replaceable, wiped by
`uninstall`, replaced by a re-`install`) and `secrets/` (helper-chosen, `0700`,
never written by `install`). A key is *named by* a bundle id and *stored outside*
the bundle tree. So:

1. **A re-deploy must not decide key custody.** ADR 0018 already says it:
   *"Bundle replacement may not copy, delete or refresh a key."* The proposal
   adds the inverse obligation — after a re-`install`, DASH must be able to
   answer *"which of the keys you placed here still have a bundle to serve"*, and
   an orphaned slot must be visible on the server row rather than discovered when
   an agent asks and is refused.
2. **The self-check travels.** MAR-742 added `store_directory` and
   `vault_directory` to `store_meta.vault_self_check` precisely so a split is
   readable instead of inferred. The host's equivalent — the secrets root the
   helper chose, the bundle root, the pack version, and a per-slot
   present/absent/unreadable verdict — belongs on the `pack` answer or beside it,
   for the same reason. **A canary that cannot see a split is not a check.**
3. **A "reconnect to fix it" loop must not be the remote recovery.** Locally that
   loop destroys a good credential. Remotely it costs a whole consent ceremony
   and leaves a shadow: ADR 0018 already requires that a failed *replacement*
   leaves the previous key in place **and says so**, rather than reporting "not
   installed".

### The reserved-slot trap, named before somebody hits it

The chief belongs to no bundle. The store's key is `{bundle_id}/{connection_id}`,
and the temptation is a null or empty bundle id for chief-owned slots.

**Do not.** [[connection-secrets-null-agent-is-a-trap]] is the local version:
`connection_secrets` allowed a NULL agent and the primary key made the row
unusable. Use a **reserved string** the identifier alphabet in
`lib/deploy/verbs.ts` can spell and a real bundle id can never collide with, so
containment re-checking after the join works unchanged, and so a receipt can name
which placement it is talking about.

---

## 6. The knowledge sync — how the cloud chief knows without being able to act

Henrik's clause: *"knows about local agents and their latest generated
information without being able to run them."*

### The mechanism already exists twice, under two names

`schedule_standing` (ADR 0030 decision 5, shipped) and the `chief_standing` row
ADR 0030 decision 6 named and declined to build. The pattern generalises to
exactly one thing, which this proposal calls a **standing document**:

> A **standing document** is the last thing DASH told this runner, stored
> verbatim in `runner.sqlite`, written on every push rather than on a change,
> read back before the runner first needs it, parsed and not trusted, and lost
> when the store is retired.

Every clause carries an argument that was already made:

- **Verbatim**, so nothing decides which fields matter.
- **On every push**, because a comparison is a closed statement about which
  fields matter, and a field added later would stop reaching disk silently,
  visible only after a reboot. One upsert against a one-row table.
- **Parsed and not trusted**, because *"a set the runner would have refused from
  DASH is a set it refuses from itself"* — a row off the host's own disk earns no
  more trust than a body off the channel.
- **Lost on retirement**, and that is accepted: the runner comes back with no
  memory, which is the pre-residency runner, and one push repairs it.

### What the host's standing document carries

One row, `chief_standing`, holding the document DASH last pushed:

- the **fleet snapshot** — the `ChiefBriefingRow`s `briefingFor` already builds,
  plus the fleet model choice; the same shape `POST /chief/discord` already
  carries locally, **minus the two credentials**;
- the **latest generated information** — for each agent, the newest run's
  verdict, the newest brief's headline and citation count, the newest outputs'
  names and sizes. Bounded by `MAX_CHIEF_CONTEXT_CHARS`, which the chief's
  answering procedure already enforces on both hosts;
- a **`snapshot_at`** stamp, and this is the load-bearing field.

### Freshness is stated, never implied

ADR 0028 decision 6 already requires it locally: *"an answer built from a
snapshot older than the reply carries the snapshot's own timestamp."* On a VPS a
snapshot can be a week old, because a week is exactly how long the computer might
be off — so the sentence is not a nicety, it is the difference between the
feature and a lie. `describeChiefRunnerHolds` already renders the local version
of this line (*"Runner holds: fleet of N, taken \<day> at \<time> · \<model> ·
listening/not listening in Discord"*, PR #281). The host's version is the same
function with the machine named.

### Why a push and not a pull, and why it is admissible

DASH pushes when DASH is open, on the evidence poll, whole, every tick — ADR 0029
decision 2's argument, verbatim: a re-assertion on a five-second cadence has no
closed list of events somebody has to widen correctly forever, which is exactly
the bug MAR-745 found in the fire-on-change shape.

That needs **one new remote route**, and the discipline says a route is added to
both channels or to neither, and pays ADR 0014's three questions:

| `POST /chief/standing` | answer |
| --- | --- |
| Carries a credential in either direction? | **No.** The fleet document only. The credentials that ADR 0028 puts on `POST /chief/discord` are precisely what makes that route un-crossable, and they go by `install-key` on the deploy plane instead (§5). This is the split that makes the whole design work. |
| Chooses what runs, or only which? | **Neither.** It runs nothing. It replaces one row. |
| Can DASH describe the result honestly? | **Yes**, and the honest description is the freshness stamp: DASH can say when the host was last told, because the host echoes what it holds. |

And **one more**, for the return leg: `POST /chief/drain`, which exists locally
and is the same family as `/telemetry/drain` and `/artifacts/drain` — turns of
the conversation the host chief had while DASH was closed, plus the broker
decisions it made, drained into `chief_messages` and `broker_audit` with
`origin` and `decided_on` recording where they happened.

**One warning for whoever builds the drain.** [[a-drain-guard-is-a-closed-list]]:
`ingestChiefDrain` refuses any spooled audit row whose connection is not the
chief's one connection, and when MAR-744 gave the chief a second thing it could
do, the drain silently dropped every real row with one unread console line. A
host chief drain widens that guard in the same commit, and the spool tables in
`runner/store.ts` need their own `ALTER TABLE` step — editing the original
`CREATE TABLE` only helps a fresh install.

### "Without being able to run them" is a property of the shape, not a check

The host chief cannot run a local agent because **there is no route from the host
to this machine at all**. Every crossing is initiated by DASH over `ssh`; the
host dials nothing but Discord. There is no inbound plane to add a run request
to, and adding one would be the listening-port product this whole line of ADRs
refuses.

So the honest sentence for the surface is not "the chief is not allowed to run
your local agents" — it is:

> The chief on this server can tell you what your agents at home last produced,
> as of when your computer last spoke to it. It cannot start them. Nothing on
> this server can reach your computer.

**Nor may a Discord message become an act.** ADR 0028 decision 3 exhausts what an
inbound message may become — *the `question` string of one chief turn, and
nothing else* — and decision 4 answers only one allowlisted user id, silently
ignoring everyone else. Both hold unchanged on a host and neither is re-decided
here. The tempting design (chief proposes, person types "yes", act happens) is
refused for the reason already recorded: a challenge and a response down the same
wire as the instruction is one factor with an extra round trip.

---

## 7. The dependency this epic cannot route around

**Stated plainly, because the epic dies quietly without it:
the VPS chief needs a runner-side model broker fed from a durable store, and
today `install-key` does not exist, so the store cannot be fed.**

Three facts, in order:

**1. The chief's broker exists and is already the right shape.**
`runner/chief-broker.ts` is the narrowest broker in DASH: the chief and no other
principal, `chief:model-provider` and no other connection,
`{provider}.chat.completion` and no other operation, and no allowance anything
can open. It already answers with DASH closed. It is not the problem.

**2. Its key arrives by a mechanism a VPS cannot use.** ADR 0028 decision 5 puts
the bot token and the model key in the runner's **memory**, handed over by main
on the local authenticated channel, with the bound stated as *"a restart erases
it"* and the third liveness sentence saying so: after a restart, the chief is
quiet in Discord **until DASH is opened once**. On a laptop that is a sentence.
On a server whose entire value proposition is "the computer is off", it is the
feature failing. So the host chief's two credentials must come from the **host
secret store** — ADR 0021's (b), which exists, is empty, and has no writer.

**3. `install-key` is that writer and it is not built.** ADR 0018 designed it in
full — the verb, the ceremony, the owner-only install path, the five helper
steps, the receipt. `DEPLOY_VERBS` has nine members and `install-key` is not one
of them; `lib/deploy/verbs.ts` says so by name. MAR-625 is Urgent and In Progress
since 2026-08-13 with no code. **Three of Henrik's five clauses sit behind it.**

### And the separate, larger half: agents, not the chief

The chief is the easy case, because ADR 0023 gave it no run allowance anywhere,
so *nothing can open one* and there is nothing to decide. **An agent is not.**

- On a host, `runner/host-broker.ts` has `allowRunSpend`, opened by a **Run press
  on that host** (ADR 0021's labelled assumption, bounded by the same
  `SPEND_ALLOWANCE_CALLS = 2` / `SPEND_ALLOWANCE_MS = 10 minutes`). That works,
  and it needs a person.
- A **scheduled** agent on a host has no press. ADR 0029 decision 6 refused a
  standing unattended allowance and named its own exit; amendment 1 (MAR-784)
  took exactly that exit — a per-schedule ceiling, defaulting to zero — and then
  had to add a fourth sentence to the panel: *"That works while DASH is open.
  With DASH closed the run still starts and still publishes, but nothing can
  reach your model until you open DASH again."*

Amendment 1 §3 names what would lift it, and this proposal quotes it rather than
re-deciding it:

> A broker in the runner, holding a model key, narrowed the way
> `runner/chief-broker.ts` is narrowed for the chief and `runner/host-broker.ts`
> is for a host. It is a real packet and not a line in this one: it needs a
> credential route, per-agent model resolution in main, an audit drain, and — the
> part that makes it a decision rather than a task — **a model key in a second
> process for every scheduled agent**, which is the widening ADR 0028 decision 5
> accepted once, for one key, with its blast radius argued in full. That argument
> has to be made again at the new size before anybody makes it.

**On a host that argument is different, and easier, and this is worth saying
because it is the one place the VPS is a better story than the laptop.** ADR 0021
already made it: the host broker is already a second process holding keys, its
blast radius was already argued, `install-key`'s ceremony is already per key and
per host, and the honest protection claim (*"protected by that machine's account,
not by a keychain"*) is already on the receipt. So the remote half of "an
unattended run may spend" is **ADR 0021 plus a press that opens an allowance
nobody is present for** — a strictly smaller decision than the local half, which
would put a model key in the local runner for every scheduled agent.

**What this proposal recommends, and it is a recommendation and not a decision:**
scope the unattended-host-spend question **into packet C** (the cloud chief),
solved for the chief only, where it is already answered by ADR 0023 + ADR 0028
decision 8 — the chief has no allowance and needs none. Leave **unattended agent
spend on a host** to its own packet after the chief is proven, so the first
attended proof of residency is not also the first attended proof of a new spend
rule. `no-recurring-costs-until-revenue` cuts the same way: the cheapest honest
first residency is one where the only thing spending is a chief a person is
talking to.

---

## 8. Phased children — draft issue texts

Five packets. **A → B → C → D, with E dispatchable beside C or D.** Each proof
bar has a blocking local half (CI, this repository, this machine — ADR 0004) and,
where a host is involved, an attended half that is attended **permanently**,
because ADR 0004 forbids a blocking gate that depends on a machine that is not
this repository and this one.

Every packet takes its ADR number from the orchestrator at dispatch.

---

### Packet A — `install-key`: a credential reaches a machine the user owns

> **Closes MAR-625**, which has been Urgent and In Progress since 2026-08-13 and
> is the blocker under three of Henrik's five clauses for item 4.
>
> ADR 0018 designed this verb in full and no line of it was written. ADR 0021
> then shipped the store it writes into — `secrets/keys/{bundle_id}/{connection_id}`
> under a helper-chosen `0700` root — and `lib/copy/host-pack.ts` records the
> resulting standing in its own header: *"There is no sentence in this file
> offering to put a key on a server, and that absence is the honest state of this
> pack rather than an oversight."* This packet writes that sentence and earns it.
>
> **Build:** the tenth deploy verb, held to ADR 0014's three questions and
> answered in `lib/deploy/verbs.ts` beside the other nine. The helper's five
> steps from ADR 0018 §"The owner-only install path", in order, with the read-back
> proofs. The consent frame from ADR 0018 §"The consent ceremony" on the server
> row — key by label, server by label + address + fingerprint, agent + declared
> need, the custody sentence, and an affirmative action naming the movement. The
> value reaches `ssh` **stdin** from the trusted side and never argv, never the
> renderer, and is scrubbed from errors, logs, command audit targets and helper
> answers.
>
> **Also in scope, because it is the same seam:** a **reserved bundle id** for
> slots that belong to no bundle, so packet C has a place to put the chief's two
> credentials without a null key. [[connection-secrets-null-agent-is-a-trap]] is
> why this is decided here and not improvised there.
>
> **Also in scope:** the orphan question. After a re-`install` or an `uninstall`,
> DASH must be able to say which placed keys still have a bundle to serve, and an
> orphaned slot must appear on the server row rather than surface as a refusal
> when an agent next asks.
>
> **Consequence worth naming in the packet, not resolving in it:** MAR-482
> refuses a `remote` runtime beside a `dash_managed` connection at import,
> because a credentialed agent could not be fed on a host. That refusal now has
> an exit. Whether to open it is a separate press-and-copy question and should
> not ride this PR.
>
> **Proof bar, blocking (local):**
> - a helper fixture receives one key, writes `0700` parents and a `0600` file,
>   reads back uid and mode, and refuses if it cannot prove both;
> - failure **before** the rename leaves no new key; failure **replacing** an
>   existing key leaves the previous shadow and reports that it did — never "not
>   installed";
> - the key bytes and any stable derivative appear in **no** argv, answer, log,
>   error, audit value, receipt or renderer payload — asserted over the captured
>   command line and the full error path, not by reading the source;
> - a request cannot name a path, filename, mode, environment variable, command
>   or executable; a `bundle_id` or `connection_id` that could spell a separator
>   is refused by the identifier alphabet, and containment is re-checked after
>   the join;
> - `install`'s bundle modes remain exactly `0644` and `0755` — unchanged, pinned;
> - a helper without the pack answers `host_pack_too_old`, and `install-key` does
>   **not** fall through to a partial install;
> - the reserved bundle id cannot collide with any id `install` accepts.
>
> **Proof bar, attended (one host, dated, recorded in the runbook):**
> - the currently enrolled host reports `host_pack_too_old` until the existing
>   setup control is re-run, then reports pack version 1 — the console is not the
>   default and is not used;
> - one ceremony places one model key; the deployed News Scout completes its
>   declared provider call **through the host broker**, with DASH's own broker
>   never asked;
> - the agent process does not hold the key (checked in its environment and its
>   argv on the host);
> - local Disconnect does **not** disable that call; rotating at the provider
>   does;
> - the receipt on screen contains the account-not-keychain sentence and the
>   spend sentence, verbatim;
> - nothing in the run is claimed for Gmail or MCP.

---

### Packet B — the host comes back by itself: "startup file delivered on connect"

> Henrik's first clause. ADR 0007 left restart-on-boot open on purpose in
> 2026-08-06; ADR 0014 blocked trigger configuration on it; ADR 0022 quoted the
> block; ADR 0029 wrote the boundary onto the screen; ADR 0030 closed it **for
> this machine only** and said so: *"a host is a Linux box with its own service
> manager, and a `systemd` unit chosen in passing is precisely what ADR 0007
> refused. Restart-on-boot on a host remains undecided."*
>
> This packet decides it for a host, and it is an ADR before it is code.
>
> **The decision to make, and the shape recommended.** The setup step already
> lays down the helper and the pack in one act. It should also lay down a
> **user-scoped service unit** the helper owns, enabled only by an explicit press
> on the server row and never by the bootstrap on its own — ADR 0030 decision 4's
> opt-in rule, one machine over. Three things ADR 0030 argued that transfer
> directly: the entry must be somewhere the **operator can find and remove it**
> without DASH; the switch must **read the system's own off state** rather than
> the entry's existence, or DASH will say *On* over a boot that does nothing; and
> **uninstall has no hook**, so removal has to be possible from a machine DASH is
> already gone from.
>
> **What must be decided rather than defaulted:** whether DASH writes a unit at
> all (versus refusing and telling the operator, honestly, that starting this
> under a service manager is their decision — `runner/standalone.ts`'s current
> position); which init system is assumed and what the refusal says on a host
> that has another; and whether a boot-started runner is allowed to fire
> schedules, which is `schedule_standing` on a host and is the second half of
> this packet.
>
> **Also in scope:** `schedule_standing` on the host. ADR 0030 decision 5 shipped
> the row for this machine's runner; a host runner that comes back at boot needs
> the identical row for the identical reason, and the schedule push needs a
> remote route (ADR 0014's three questions: no credential, chooses neither, and
> DASH can say when it last told the host).
>
> **Proof bar, blocking (local):**
> - the unit text is generated from the helper's own chosen roots and contains no
>   credential, no `DASH_DATA_DIR` from a caller, and no path the request named;
> - the switch is off by default; nothing in the bootstrap enables it;
> - the reported state distinguishes *not written* / *written and enabled* /
>   *written and disabled by the operator*, and the copy has a sentence for each;
> - a host whose init system is not the supported one produces a **named** stop
>   with its own sentence, in `lib/copy/`'s pattern, not a generic failure;
> - `schedule_standing` on the host: written on every push, read before the first
>   tick, parsed and refused when malformed, discarded with a log line and never
>   thrown, and repaired by one push.
>
> **Proof bar, attended:**
> - the host is **actually rebooted**; the runner comes back with the schedules it
>   was last told, with DASH never opened;
> - a window due after that reboot fires, and its evidence is in DASH's store the
>   next time DASH opens;
> - a window that came round while the host was down is recorded **missed** and
>   never backfilled (ADR 0029 decision 7, unchanged);
> - the operator can see the entry and remove it without DASH.

---

### Packet C — the cloud chief: it answers with the computer off

> Henrik's fifth clause, first half. **Depends on A** (the credentials) and reads
> better after **B** (it survives a reboot).
>
> The chief's code is already on every host: `runner/main.ts` constructs
> `RunnerChief` unconditionally and `runner/standalone.ts` hands over to the same
> `runner.mjs`. What is missing is that its two credentials arrive by a push into
> memory, and a host cannot be pushed to when the pushing machine is off.
>
> **Build:** the host chief reads its bot token and model key **from the host
> secret store** — placed by packet A's ceremony under the reserved bundle id —
> rather than from `POST /chief/discord`. The gateway is the same outbound
> websocket (`runner/discord-gateway.ts`), the two intents and no third, the one
> allowlisted user id, the silent ignore for everyone else, and the answer path
> is `lib/chief/answer.ts` — one procedure, two hosts, ADR 0028 decision 1's
> whole argument. Spending is `runner/chief-broker.ts`, unchanged: one operation,
> no allowance anything can open.
>
> **The decision this packet owns, and it is the only new custody argument:** a
> chief credential on a host is durable rather than memory-only. ADR 0028's bound
> — *"a restart erases it"* — is what made one key in a second process
> acceptable. On a host that bound is deliberately given up, and what replaces it
> is ADR 0021's honest protection claim plus a person's press per credential per
> host. That trade is the packet's ADR, argued at its real size.
>
> **What must not be built here:** any inbound plane, any port, any confirm flow
> over Discord, any act a Discord message can become. ADR 0028 decisions 3 and 4
> hold unchanged and are not re-decided by a change of machine.
>
> **The two-chiefs question needs Henrik's answer before this is dispatched.**
> See §11.
>
> **Proof bar, blocking (local):**
> - a host fixture with a chief slot in its secret store brings the bridge up
>   with no push, and a fixture without one comes up idle and says which
>   credential is missing;
> - the model key is read as an **envelope** and opened before the `api_key` slot
>   is filled — [[model-key-in-vault-is-an-envelope]] and MAR-745's 401-reported-
>   as-`revoked` bug, which the runner already refuses at intake;
> - the chief's broker admits `{provider}.chat.completion` and nothing else;
>   `gmail.*`, `mcp.*`, a caller-supplied URL and any attempt to open a run
>   allowance are refused with the shared vocabulary and no invented refusal;
> - a Discord message cannot name a model, name an agent, approve anything, or
>   change a setting — pinned by test, not by review;
> - a truncated answer says it was cut and where the whole thing is;
> - `chief_messages.origin` and `broker_audit.decided_on` carry the host's
>   provenance through the drain, and `decided_on` accepts `"host"` — the value
>   ADR 0028 decision 7 reserved for exactly this day.
>
> **Proof bar, attended — this is Henrik's five-step bar with step 4 made
> literal:**
> 1. connect AI; 2. connect Discord **for the server**; 3. ask the chief a
>    question from Discord and get an answer that came off the host;
> 4. **close DASH and turn the computer off**; 5. ask again, from a phone, and be
>    answered;
> 6. turn the computer back on, open DASH, and find the turn from step 5 in the
>    transcript, marked as having happened on the server;
> 7. the answer in step 5 states the age of the fleet snapshot it was built from.

---

### Packet D — the knowledge sync: it knows what your agents made

> Henrik's fifth clause, second half. **Depends on C.**
>
> `chief_standing` on the host, holding the fleet document DASH last pushed —
> ADR 0030 decision 6's named gap, built where it matters most. The push carries
> the fleet snapshot plus each agent's latest generated information (newest
> verdict, newest brief headline and citation count, newest output names and
> sizes), bounded by `MAX_CHIEF_CONTEXT_CHARS`, stamped with `snapshot_at`, and
> **carrying no credential** — which is what makes it a route the remote channel
> can admit at all.
>
> **Build:** one new route added to **both** channels (`lib/agent-dom/runner-channel.ts`'s
> rule), pushed whole on the evidence poll rather than fired on a change
> (ADR 0029 decision 2's argument, and MAR-745's bug as the evidence for it); the
> standing row with the five properties from §6; the freshness sentence in every
> answer built from a snapshot older than the reply; and the drain of what the
> host chief did, widening `ingestChiefDrain`'s closed list in the same commit.
>
> **Proof bar, blocking (local):**
> - the pushed document contains no credential and no vault-typed value —
>   asserted over the serialised body, not by reading the type;
> - written on every push, not on a change: a push whose fields are identical
>   still reaches disk;
> - an unreadable row is discarded with a log line and the runner is left exactly
>   as it was;
> - an answer built from a stale snapshot carries the stamp; an answer built from
>   a fresh one does not have to;
> - the drain guard admits the host chief's rows and still refuses a row naming
>   an operation the chief cannot perform — both halves, both pinned;
> - there is **no route by which the host can ask this machine for anything**;
>   the absence is asserted against the channel type, the way `BROKER_ROUTES`
>   already is.
>
> **Proof bar, attended:**
> - with the computer off for a measured interval, the chief in Discord names a
>   local agent's latest output and states how old that knowledge is;
> - asked to run that agent, it says it cannot and says why, without a refusal
>   that reads like a permission error;
> - the turns and the broker rows land in DASH's store on the next open, marked
>   `discord` / `host`.

---

### Packet E — copy home, then wipe: re-enrolment that loses nothing

> Henrik's second clause: *"wipe stale state but store it locally first."*
> **Dispatchable beside C or D**; it must land before anybody re-runs setup on a
> host with keys on it.
>
> `lib/deploy/bring-home.ts` already holds the rule at agent scale — *"DASH does
> not remove what it could not copy"* — and enforces the order: copy, prove the
> copy, then `uninstall`, and change nothing on the server if any step before the
> removal failed. ADR 0021 §4 currently says the **opposite** for the pack: the
> re-run *"does not preserve, merge or inspect whatever secrets a future pack
> might have left; v1's store starts empty, and a host that predates v1 has no
> store to preserve."* That was true when written and stops being true the day
> packet A ships.
>
> **Build:** host-scale bring-home. Before a re-setup or a reset, DASH copies the
> host's account of itself — the runner spool, the chief transcript, workspace
> artifact **bytes** (`ArtifactBytesRoute`, MAR-611's route, already admitted),
> the run history, and the **inventory** of placed keys (names, connections,
> bundles, placement times — never values) — and refuses to wipe what it could
> not copy. The wipe then names what it destroyed, and the placed keys are
> reported as *still live at the provider until you rotate them*, because
> deleting a file is not revocation and ADR 0018 says so.
>
> **Proof bar, blocking (local):**
> - every failure before the removal changes nothing on the server, and the
>   outcome names **which stage** stopped it rather than a generic refusal;
> - a copy that succeeded for four of five artifacts refuses the wipe and says
>   which one it could not take;
> - the copied inventory contains no key value and no stable digest of one;
> - `uninstall`'s idempotence is preserved: a second press on an already-clean
>   host answers `ok` with `removed: false`;
> - the wipe receipt states that placed keys remain live at the provider.
>
> **Proof bar, attended:**
> - a host carrying a placed key, a run history and one output file is re-set-up;
>   everything is on this machine afterwards; the server is clean; and the
>   receipt named the key as needing rotation.

---

## 9. What the trading / special-ops tier inherits from this epic for free

Roadmap item 7 is banked on MAR-742 (2026-08-24 evening) and Henrik sequenced it
himself: *"after item 4 (VPS) — an always-on trading agent wants the cloud
runner."* That sequencing is right, and the reason is that **most of the special
-ops machinery is this epic's machinery under a different name.**

**Inherited whole, with no new decision:**

| item 7 needs | this epic already delivers it as |
| --- | --- |
| **always-on execution** | packets B + C. A trading agent's whole premise is a machine that is awake when the person is not. |
| **trade-only exchange keys that never become env vars** | packet A's `install-key` + `runner/host-broker.ts`. The agent never holds the key; it asks and is answered or refused. This is the single most important property for a credential that can move money, and it arrives already argued. |
| **"never withdrawal scope"** | the host broker's **closed operation set** with **frozen paths** and **typed inputs, never a caller-supplied destination** (ADR 0002 invariant 3, applied on the host). A withdrawal endpoint is not refused by policy — it is `unknown_operation`, because the catalogue never wrote it. |
| **capped standing grants — "up to $X/day without asking"** | ADR 0029 amendment 1's per-schedule ceiling, exactly. Including the hard-won detail: **a count, not a currency**, because two of three providers never state a price and the third states it after the call — a dollar ceiling can only be checked once the money is gone. Item 7 will want to relitigate that; the argument is already on file. |
| **the kill switch** | provider-side rotation as the only true revocation, plus `uninstall` and the host's own service switch (packet B). The receipt already says which of these is real. |
| **spend receipts at model-receipt fidelity** | `broker_audit` with `decided_on` = `"host"`, drained as evidence DASH **observed**, and ADR 0029 amendment 1 §4's rule: **counted, not reported** — *"a run's end reaches DASH as an event the agent emits and a spend count written from it would be the party being reported on doing the reporting."* For an agent placing orders, that distinction stops being hygiene and becomes the audit. |
| **approval provenance end-to-end (the MAR-749 binding)** | already digest-over-the-exact-payload with deny-on-drift; nothing here weakens it, and packets C/D keep every guarded act on this machine's window (ADR 0028 decision 3). |
| **paper-first lifecycle as a product gate** | the **standing document** pattern (§6). "N green days on paper before the real-keys grant unlocks" is a durable per-agent stage that has to survive reboots on a machine nobody watches — which is the exact problem `schedule_standing` and `chief_standing` solve, and the exact reason they are written verbatim, on every push, parsed and not trusted. |

**Inherited as an argument rather than as code:** ADR 0021's Gmail refusal is the
template for the withdrawal-scope refusal. It does not say "unsafe"; it says a
different custody class needs a different ceremony, a different consent, and a
different revocation story, and refuses to reuse the first one by inertia. An
exchange key with withdrawal scope is that shape and should be refused in those
words.

**What item 7 does *not* inherit, and should budget for:**

- **The new output kinds.** Henrik named them: trading history, backtest and
  forward-test results, chart snapshots. [[dash-cannot-write-a-document]] is the
  standing finding — no operation writes prose, no field carries it, no renderer
  draws it. Trading history is tabular-over-time, a backtest is a parameterised
  result set, a chart snapshot is an image bound to a time window. **Three
  genuinely new output kinds**, not variations on the brief, and none of them is
  cheaper because the agent is on a VPS.
- **Unattended agent spend.** §7's larger half. The chief needs no allowance; a
  trading agent firing on a cadence needs one, on a machine with no person. That
  is its own decision and this proposal deliberately does not make it.
- **The monthly bill.** [[no-recurring-costs-until-revenue]] applies to item 7
  more than to item 4, because a trading agent's VPS cannot be turned off between
  demos.

---

## 10. Non-goals

Explicit, so no packet drifts into them:

- **No multi-tenant anything.** One customer, one server they own, one DASH. No
  shared host, no per-tenant isolation model, no accounts.
- **No credential custody by us.** No hosted broker, no relay, no key of the
  user's ever residing on infrastructure we operate. ADR 0006's line is untouched
  and ADR 0021 §5's forbidden list stands verbatim: no tunnel to
  `electron/broker-host.ts`, no new listening port on the VPS, no forwarded
  loopback port "just for the broker", no widening of `RemoteRunnerChannel` with
  either broker route — conditionally, behind a flag, or "only for agents that
  declare local".
- **No Gmail on the host, and no MCP on the host.** ADR 0021 refuses both in v1
  with arguments; each is a later widening of that same broker with its own
  ceremony, not three names copied from `OPERATIONS`.
- **No inbound plane.** Nothing on the server may initiate a connection to the
  customer's machine. Every crossing is DASH-initiated over `ssh`.
- **No guarded act over Discord**, on either machine. ADR 0028 decision 3.
- **No ADR numbers assigned here**, and no code. This document proposes; ADRs
  arrive with the implementation packets, from the orchestrator.
- **No contact with the enrolled host during scoping.** No ssh, no deploy, no
  status, no "just check". The named stop `host_pack_too_old` exists so packet A
  can tell the truth the first time it asks.
- **No claim, on any surface, that any of this works** until the attended proof
  in the relevant packet has been run and dated. ADR 0021's standing sentence
  holds until then: *"the key is on that server", never "your agent can now think
  there."*

---

## 11. Three questions for Henrik before any of this is dispatched

**1. Two chiefs, or one?** Once packet C lands, a Discord message could be
answered by the runner on your laptop **and** by the runner on the server, both
holding the same bot token, both allowlisting the same user id. Two replies to
one question is the first thing that goes wrong, and it goes wrong in front of
you. Three answers are available and they are genuinely different products:

- **The server wins whenever it is up**, and the laptop's bridge stands down when
  a server bridge is configured. Simplest to explain; means the chief is always
  answering from a possibly-stale snapshot even when your computer is on and
  fresh.
- **Separate rooms** — the local chief in one Discord channel, the cloud chief in
  another, each saying which it is. Honest, zero collision, costs you two channels
  and the question "which one do I ask".
- **The laptop wins when it is up**, and the server answers only after a
  measured silence. Best answers; needs a handoff rule between two processes that
  cannot see each other, which is the kind of thing that fails at 3am.

**Recommendation: separate rooms for the first proof**, then revisit. It is the
only one of the three that cannot produce a wrong answer, and it makes the
attended proof legible — you can see which machine spoke.

**2. Does "wipe stale state" mean the whole host, or per agent?** Packet E is
written for the whole host (re-setup, reset). If you also want a per-agent
"refresh this one" that wipes and re-installs a single bundle while leaving its
placed key alone, that is a smaller and separable control, and it needs ADR
0018's *"bundle replacement may not copy, delete or refresh a key"* rule stated
on screen rather than only in a file.

**3. Is a monthly server bill acceptable for this epic now?**
[[no-recurring-costs-until-revenue]] is a standing constraint and a VPS is the
first thing in DASH that breaks it. The enrolled Hostinger box already exists, so
packets A–E can be proven without a new bill; the question is whether *shipping*
residency to a customer means telling them to rent a server, and whether that is
the story you want in front of the OpenClaw/Hermes comparison
([[dash-competitive-position]]) — where the differentiator is supervision, and
"you own the box, we hold nothing" is the strongest sentence in it.

---

## Appendix: what this proposal read, and what it did not touch

**Read:** ADRs 0006, 0007, 0009, 0014 (+ amendment 1), 0016, 0017, 0018, 0021,
0028, 0029 (+ amendment 1), 0030; `lib/deploy/verbs.ts`, `lib/deploy/bring-home.ts`,
`lib/copy/host-pack.ts`, `lib/agent-dom/runner-channel.ts`, `lib/host-wizard.ts`,
`app/settings/servers/page.tsx`, `runner/host-broker.ts`, `runner/chief-broker.ts`,
`runner/standalone.ts`, `runner/host-runtime.ts`, `runner/main.ts`,
`runner/server.ts`, `runner/schedule.ts`, `docs/attended-vps-proof-runbook.md`,
`PROJECT_STATE.md`, `.orchestrate/state.json`, MAR-742's roadmap comments and
MAR-625, at `69a9158`.

**Did not touch:** any product code, any test, any copy string, any ADR, any
state file, and `186.240.156.166`.

**One correction owed to the record:** `PROJECT_STATE.md` describes ADR 0021 as
*"planned, documentation only"*. It is merged and unproven — `ddb1df4` shipped
the pack and `8f3494c` fixed a rate-limit request-id bug in the host broker.
Worth fixing at the next state rotation; not fixed here, because this branch
touches one file.
