# ADR 0021: The host is a small DASH runtime, and it answers its own broker

Status: Accepted

Date: 2026-08-14

Issue: MAR-629. Related: MAR-625 / ADR 0018 (a key crosses only on a person's
press), MAR-611 / ADR 0017 (`helper_too_old`), ADR 0002 amendments 4 and 5
(what a brokered sentence is a claim about; a pasted key has no third party),
ADR 0006 (the broker's reach ends at this machine), ADR 0007 (the two broker
routes excluded by name), ADR 0009 (the one-paste bootstrap and the forced
command), ADR 0011 (the owner names the model), ADR 0014 (three admission
questions), ADR 0016 (a Run press may spend), ADR 0019 (VPS browser half;
credentials deferred), ADR 0020 (remote MCP parity, which this ADR is the
substrate for and does not invent).

## Decision

**Henrik ruled option A on 2026-08-13: a runner-local broker, delivered as an
install pack.** Direct exposure and "neither yet" are closed. The host stops
being a bare runner and becomes a small DASH runtime, installed at enrolment
by the same one-paste bootstrap that installs the helper today.

Six rules make that one decision.

1. **v1 of the pack contains four things, and later work inherits them rather
   than inventing a second substrate:** (a) the host broker, (b) a host secret
   store, (c) the audit and telemetry spool the evidence channel already drains,
   extended to cover brokered calls made on the host, (d) a stated pack version,
   a way for DASH to read it, and a re-run path. Memory (MAR-631), the browser
   slice's headless half (MAR-632), and the MCP client (MAR-633) land on this
   pack. This ADR does not design those features.
2. **The host broker answers the same brokered protocol DASH's broker does**,
   so the agent asks the same way in both places and does not know which
   machine it is on. "The agent never holds the key" stays true remotely —
   that is why A was chosen. It is a new security boundary, with its own
   closed operation set, its own refusals, and its own audit row. v1 is
   **narrower** than local DASH, not a copy of `lib/broker/operations.ts` by
   inertia: it admits the model-provider operations a pasted key already
   reaches, and it refuses Gmail and MCP.
3. **The host secret store is encrypted at rest and readable by the account
   the runner uses.** On Windows the local vault is OS-keychain backed. A
   Linux VPS has no equivalent DASH can rely on. Root on that box can read
   the store. That is acceptable — the user's own machine, consented per key.
   It is not acceptable to imply the protection is the same. The receipt
   extends ADR 0018's custody sentence:

   > the key is protected by that machine's account, not by a keychain

4. **A host enrolled before the pack is too old until setup is re-run.**
   `186.240.156.166` is that host. DASH reads the pack version through a new
   deploy verb; an old helper answers `unknown_verb`; that maps to a named
   stop, `host_pack_too_old`, whose exit is the existing setup step. There is
   no partial install and no console paste as the default.
5. **The boundary sentence is load-bearing and stays literal:**

   > The runner still never reaches DASH's broker. It now has its own, with
   > its own stated limits. ADR 0006's surviving line stays literal.
   > `/broker/drain` and `/broker/responses` remain absent from the remote
   > channel type (ADR 0007). No provider request is relayed through DASH
   > after a key is placed (ADR 0018 rule 5). Closing DASH does not close
   > the host broker.

6. **The pack installs an empty store.** Keys arrive one at a time, each
   under ADR 0018's ceremony. A pack that shipped the vault's contents would
   grant every credential to a machine in one action and destroy that
   consent. "Vault clone" must not mean copying the vault.

This ADR is the decision. It is not implementation evidence. Until a later
session proves the pack on an enrolled host, ADR 0018's substrate remains
"the key is on that server", never "your agent can now think there".

## The question this was split out to answer

ADR 0018 admits **placement**. MAR-629 exists because placement changes
nothing about what the agent can do. The deployed runner emits broker
requests; DASH's broker lives in Electron on the user's machine; the remote
channel type cannot carry `/broker/drain` or `/broker/responses`. A file on
the VPS beside a runner that has nobody to drain it is a key that cannot be
spent, which is why News Scout would still degrade to headlines with the
key sitting next to it.

Three doors were on the issue. Henrik closed two of them:

> Yes A. I want when we first install the VPS DASH sends a package with
> some system files to the VPS.

Option A keeps the product's central promise true on both machines. Option
2 — handing the agent an environment variable or a path — is cheaper and
breaks that promise, which is why it is not a fallback and not a v1
shortcut. Option 3 — place the key and consume nothing — is honest only
while no surface claims remote capability, and it is the standing this ADR
replaces rather than a product.

What Henrik also said, and what the ruling comment already corrected, is
the phrase "vault clone". The correction is rule 6. The rest of this ADR
is the difference between a small runtime and a copy of DASH.

## What is already true, before designing anything on top of it

ADR 0005's habit.

**The helper on an enrolled host is a closed verb set, installed once.**
`scripts/host-helper/main.ts` answers `install`, `start`, `stop`, `status`,
`collect`, `channel`, `uninstall`, `connect`. `install-key` is not among
them. A verb the bytes do not know is `unknown_verb` forever, until the
setup step is re-run. That is MAR-611's finding, and ADR 0017 gave it its
own stop rather than folding it into a generic refusal, because a generic
refusal would send somebody looking at their server for DASH's version
skew.

**`status` already asks about a host rather than a bundle.** It is the one
verb whose identifier is optional. That is a convenient place to *display*
a pack version later. It is not the too-old probe: an old helper answers
`status` successfully and would look current if missing fields were treated
as zero.

**The one-paste bootstrap is how the helper arrives**, embedded as base64,
forced-command bound, bytes of the DASH that shipped it (ADR 0009). There
is nowhere to fetch a pack from. A download URL is a hosting bill this
product does not have.

**DASH's local broker is already named `hostBroker`**, in
`electron/broker-host.ts`. That name means "the broker in this Electron
host process". It is not the host broker this ADR admits, and wiring the
remote runner to it — by tunnel, by new listener, or by putting
`/broker/drain` on the remote channel — is the option ADR 0006 rejected.
The collision is recorded so the implementation session does not treat a
function name as a placement.

**A remote Run now already exists** (ADR 0014). Locally, `electron/main.ts`
opens a spend allowance on the `retry` verb before the command runs, and
`electron/main.ts` is the only caller that may. Remotely, that same line
opens the *local* allowance, which the host cannot spend. The host broker
needs its own allowance, opened by the same press, on the machine that
will spend.

**`186.240.156.166` is enrolled, live, and older than this pack.** Naming
it is the point of the upgrade path. Reaching it is not.

## 1. The install pack — contents and version (v1)

The pack is the bootstrap's payload, not a bundle. `install` still carries
a compiled runner and agent files. The pack carries the runtime those
files run inside. Mixing the two would make a re-deploy silently decide
whether a host still has a broker, which is the same accident ADR 0018
refused when it kept keys out of the bundle tree.

v1 contains exactly four things.

### (a) The host broker

A broker that answers the existing brokered protocol on the host, reading
keys from the host secret store, never from the agent, never from DASH
after placement. It lives with the standalone runner that already supervises
the installed bundle — the process the agent already writes broker requests
to — so the agent code is identical in both places. It is not a second
listener, not a port, and not a client of `electron/broker-host.ts`.

### (b) A host secret store

Empty at install. Layout, modes, and the honest protection claim are
section 3. Keys enter only through ADR 0018's `install-key`.

### (c) The audit and telemetry spool

The runner already keeps a bounded evidence spool that DASH drains over
the control plane (`/telemetry/drain`, `/artifacts/drain`, and the other
admitted evidence routes). v1 extends that spool to the host broker's
audit rows. DASH learns what the host broker decided the same way it learns
what a remote run did: it pulls, later, whatever survived. It does not
learn it by becoming the broker.

A pulled audit row is evidence DASH observed a host decision. It is not
DASH making that decision. Surfaces that render those rows must say they
came from the host, the way ADR 0014 made a run name the machine it
happened on.

### (d) Pack version, a read, and a re-run path

The pack version is a positive integer. **v1 is `1`.** It is written under
the helper-chosen secrets root as a secret-free identity file and reported
by the helper. DASH reads it with a new deploy verb, `pack`, admitted
under ADR 0014's three questions in section 4. The helper that ships with
this pack answers `pack_version: 1`. A helper that predates the pack
answers `unknown_verb`.

Re-running setup replaces the helper and lays down the empty pack as one
step. A half-written pack is not a version; it is a failed install, and
the only repair is that same re-run. Implementation must not offer "install
just the broker" or fall through to putting broker files in a bundle.

### What later work inherits

| later issue | what it inherits | what this ADR does not decide |
| --- | --- | --- |
| MAR-631 memory | the store, the spool, the pack version, the too-old stop | the memory model, retention, or what a memory file is |
| MAR-632 browser, VPS half | the pack as the place a headless controller and Xvfb payload would live | ADR 0019's operation catalogue, credentials (still deferred), or a DevTools port (still rejected) |
| MAR-633 MCP, remote parity | a host broker that can later admit MCP operations the way this ADR admits model operations | host-side MCP. No `mcp.*` operation, no stdio server on the VPS as a brokered connection, no claimed remote MCP |

ADR 0020 said remote parity waits on MAR-629. This ADR answers that wait
at the **substrate**: there is a host broker, it has a closed set, and MCP
is not in v1 of that set. The session that implements host-side MCP writes
its own admission, on this pack, against ADR 0020's existing rules. It
does not invent a second broker.

## 2. The host broker — admitted operations, refusals, audit records

The host broker is a new security boundary. A compromised agent still
cannot read the key. The helper/runner account can. Root can. No receipt
may collapse those three.

It speaks the same request/response protocol the agent already speaks, so
the agent does not learn which machine it is on from the shape of a
refusal. The **limits** may differ; the **vocabulary** must not.

### v1's closed operation set

Local DASH today admits `gmail.search`, `gmail.message.read`,
`gmail.draft.create`, plus per-provider models-list, completion and curate
(`lib/broker/operations.ts`; providers `openrouter`, `anthropic`,
`openai`). The host broker's set is its own.

**v1 admits, for each provider in that same closed list:**

- `{provider}.models.list` — read; does not consume a spend allowance
- `{provider}.chat.completion` — spend
- `{provider}.digest.curate` — spend

Same frozen paths, origins, material ceiling and output-token ceiling the
local operations already have. Widening a path is a reviewed change to the
same catalogue, not a host exception.

**v1 refuses everything else.** In particular:

- **Gmail.** `gmail.search`, `gmail.message.read`, `gmail.draft.create`,
  and any send, delete, or unbuilt Gmail name.
- **MCP.** Any `mcp.*` operation. ADR 0020's host-side work is later.
- **Streaming, embedding, image generation**, and any completion dialect
  the local broker does not already speak.
- **A URL, method, header or body the catalogue did not write.** Typed
  inputs, never a caller-supplied destination — ADR 0002 invariant 3,
  applied on the host.
- **A key the agent holds, an environment variable, or a path.** Direct
  exposure is closed.
- **A key placed for a different bundle.** The broker that answers a
  runner reads only the slots `install-key` proved for that installed
  bundle. Same-account `0600` is not isolation; this rule is.
- **Spend without an open host allowance**, with the same `needs_a_person`
  the local broker uses when no Run is open.
- **A model the agent named.** ADR 0011 still holds: the owner chooses,
  DASH (here: the host broker) substitutes, and an owner who has named
  none is `no_model_chosen`. How the named model is present on the host
  is implementation; taking it from the request is not.

The set is equal to local DASH on the model-provider family and narrower
overall. The two omissions are argued, not copied.

### Spend — assumption, labelled, because the ruling did not write it

ADR 0016 says a person's Run press opens a spend allowance and nothing
else may spend. On a host, DASH may be closed. Transferring the rule
without transferring the press would either freeze the host broker's
spend the moment DASH closes — which undoes the reason A exists — or
let the host spend without a person, which undoes ADR 0016.

**The host broker's spend rule:** a person's Run on that host — ADR
0014's remote Run now, the `retry` command the host runner already
adjudicates — opens a spend allowance **on that host**, scoped to that
agent copy, bounded by the same numbers ADR 0016 already chose
(`SPEND_ALLOWANCE_CALLS = 2`, `SPEND_ALLOWANCE_MS = 10 minutes`),
denominated in tokens, replaced rather than stacked on a second press.
The host broker is the only thing that may open one there. Starting the
runner is not a Run. A schedule is not a Run; scheduled spending remains
refused, and remains ADR 0014's deferred decision, blocked on
restart-on-boot. Closing DASH does not close an allowance already open
on the host, and does not open one.

The receipt, said before a key is placed and again on the remote Run
control:

> A Run you start on this server may spend against this key while that
> run's allowance is open. Closing DASH does not end that allowance.
> Nothing else on that server may spend.

DASH still makes no currency claim. The local disclosure's discipline
travels with the numbers.

This is an assumption the ruling did not state. It is the only transfer
that keeps both ADRs' sentences true: a person is behind every penny
the host broker spends, and closing DASH does not close the host broker.

### Gmail vs model-provider — assumption, labelled, because the ruling did not write it

ADR 0006 rejected DASH operating a hosted broker because restricted-scope
data transiting a server attaches CASA. A host-local Gmail broker is not
that: DASH is not the server, Gmail data is not relayed through DASH, and
`/broker/drain` stays off the remote channel.

It is also not free.

- ADR 0018's `install-key` places a **provider key**, once, after a
  per-key/per-host press. A Gmail refresh token is a different custody
  class: OAuth, restricted scopes, a third party at consent, revocation
  that is not "rotate at the provider" in the same way. Putting one on
  a VPS is a new ceremony, not a reuse of `install-key`.
- A Gmail broker on a VPS fetches mail while DASH is closed, with a
  token that machine's root can read. That is the unattended mailbox
  case ADR 0006 called the highest-risk shape, now with a broker in
  front of the token rather than an agent holding it. The broker helps.
  It does not make the token a keychain item, and it does not make
  closing DASH a revocation.
- Google's restricted-scope regime is a claim about the application's
  servers. v1 should not discover, in an implementation session, whether
  DASH's OAuth client used from a customer's VPS is "the application's
  server". That question is its own decision.

**v1 therefore admits model-provider operations and refuses Gmail.**
The first remote journey this pack exists to unlock is an agent that
thinks on the host with a key the user already gave DASH — News Scout's
curation, MAR-619, on a machine that is not this one. Mail on a VPS is
a later widening of this same broker, with its own ceremony and its own
receipt, not an extra three names copied from `OPERATIONS`.

This is an assumption the ruling did not state. Direct exposure remains
closed for Gmail too: refusing to broker Gmail on the host is not
permission to hand the agent the refresh token.

### What one audit row records, and never records

ADR 0002 invariant 5, moved one machine over: every invocation is audited
by operation name and safe metadata, never token or message content.

One host-broker audit row records:

- the agent copy and the declared connection id, not a path
- the operation id
- the request id
- `allowed` or `refused`, and the refusal name when refused
- the **names** of the fields the agent supplied (`input_keys`), never
  their values
- `result_count` as a number, or null
- `account_hint` null for a keyed grant — a pasted key identifies
  nobody, the same null MAR-582 writes locally
- duration and time
- that the decision was made **on the host**, so a pull cannot be
  mistaken for a decision DASH made

It never records: the key, a stable digest of the key, authorization
headers, request bodies, provider payloads, model prose, or anything
that would make the spool a second copy of the secret store.

Dropped host-broker requests belong in the host's lapse record, not in
the audit table, for ADR 0005's reason: an audit row is a decision the
broker made. A buffer that destroyed a line before the broker read it
is not one.

The spool is what DASH already drains. Extending it is not a new
listener and not `/broker/drain` on the remote channel.

## 3. The host secret store — shape and honest protection claim

ADR 0018 already chose the write path. This ADR chooses the store that
path writes into, and forbids implying it is the local vault.

### Layout

Everything remains under the helper-chosen host root
(`~/.orchestratedash-host` or `DASH_HOST_ROOT`). `install` never writes
the secrets tree. The pack creates it empty:

```
{hostRoot}/
  bundles/                         # existing;  replaceable
  secrets/                         # 0700; helper-chosen; install never writes
    pack.json                      # 0600; { "pack_version": 1 }; no keys
    wrap.key                       # 0600; wrapping key the helper minted
    keys/                          # 0700
      {bundle_id}/                 # 0700; validated bundle id
        {connection_id}            # 0600; one encrypted key file
```

`bundle_id` and `connection_id` are identifiers, not paths — the alphabet
in `lib/deploy/verbs.ts` that cannot spell a separator. The helper joins
them to the secrets root it chose and re-checks containment after joining.
The request cannot name a path, filename, mode, environment variable,
command or executable. That is ADR 0018 rules 2 and 3, unchanged.

`install-key` writes one file under `keys/{bundle_id}/{connection_id}`
with `0700` parents and a `0600` file, then reads owner and mode back and
refuses if it cannot prove both. A wrapping key, minted at pack install
and stored `0600` beside `pack.json`, encrypts the bytes at rest. Failure
before the rename leaves no new key. Failure replacing an existing key
leaves the previous shadow and says so.

Two agents on one host that need the same provider key are still one
ceremony and one shadow, with both consumers named — ADR 0018's
same-account finding. The store is keyed by bundle and declared
connection so a second bundle cannot silently share a file, and so a
receipt can name which placement it is talking about.

### Honest protection

Encryption-at-rest whose wrapping key lives in the same account is a
speed bump against the rest of the disk and against other host
principals. It is not a vault. The helper/runner account can read
`wrap.key` and therefore every value. Root can take ownership. Another
process running as that account can, in principle, read what that
account owns. `0600` does not sandbox two agents that share a uid.

The local Windows vault is OS-keychain backed. This is not that, and
the receipt must not borrow its words.

The custody sentence ADR 0018 already requires, extended:

> from this moment the key lives on Hostinger too — DASH cannot see or
> take back what uses it there; the key is protected by that machine's
> account, not by a keychain; revoking means rotating at the provider

`Hostinger` remains the enrolled server's displayed name in this case.
Another host substitutes its displayed name. The protection claim does
not change.

## 4. Upgrade path for an already-enrolled host

A host enrolled before this pack answers `unknown_verb` to `pack`
forever, until setup is re-run. The helper is installed once, with its
verb set embedded in its own bytes. That is MAR-611's shape, and it is
used here for the same reason ADR 0017 used it: the stop has a precise
exit, and a generic refusal would send somebody looking at their server
for DASH's version skew.

### How DASH reads the pack version

A new deploy verb, `pack` — beside the still-unimplemented `install-key`
ADR 0018 already admitted — held to ADR 0014's three questions:

| question | answer |
| --- | --- |
| Does it carry a credential in either direction? | No. A verb out; an integer version back. No key, no channel secret, no path. |
| Does it choose what runs, or only which? | Neither. It reads the identity file the helper wrote under a root it chose. |
| Can DASH describe the result honestly afterwards? | Yes: this helper's pack version at the time DASH asked, or that the helper is too old to know the question. |

`install-key` remains ADR 0018's verb and is not a substitute for this
read. Discovering that a host is too old only at the moment a key would
leave is too late for the surface that should have said so on the server
row.

`status` may later carry `pack_version` as a convenience. It must not be
the too-old probe. Today's helper already answers `status`.

### The named stop

`unknown_verb` from `pack`, a helper that answers with a version older
than the version this DASH requires, or a pack identity that cannot be
proved (missing `pack.json`, unreadable wrapping key, secrets root not
`0700`) is **`host_pack_too_old`**.

It is its own stop rather than a reuse of `helper_too_old`, because
`helper_too_old`'s shipped sentence is about not being able to *remove*
an agent. Collapsing "cannot run a host broker" into that sentence would
be the generic refusal ADR 0017 refused to write. The exit is the same
act; the reason shown is not.

Plain language, in the shape `lib/copy/bring-home.ts` already uses for
its sibling:

> This server was set up with an older copy of DASH's setup step, which
> cannot run the host broker — so a key placed there cannot be used yet.
> Run the setup step for this server again.

### The re-run path

The default is the existing setup control on that server — the same
one-paste bootstrap that first installed the helper (ADR 0009). It
replaces `/opt/orchestratedash/dash-host` with the bytes this DASH
shipped and lays down the empty pack in the same step. It does not
preserve, merge or inspect whatever secrets a future pack might have
left; v1's store starts empty, and a host that predates v1 has no store
to preserve.

A console or the user's own SSH is fallback only when DASH cannot reach
the host, the same rule ADR 0018 set for keys. It is not the default,
and the default must not be a second, ad-hoc snippet ("paste this to add
the broker"). Partial install through `install` is refused: broker bytes
are not bundle files, and `checkDeployRequest`'s modes stay `0644` and
`0755`.

Do not fall through. An old helper that cannot answer `pack` cannot
receive `install-key` either; both stops name the setup step.

### `186.240.156.166`

The enrolled Hostinger VPS predates this pack. Nothing in this pack
works there until that setup step is re-run. This session did not reach
it: no ssh, no deploy, no status, no bootstrap, no "just check". The
named stop exists so a later implementation session can tell the truth
the first time it asks, without improvising a probe against a live box
in order to learn what this ADR already knows.

## 5. The boundary sentence

Restated as a decision line, not as colour:

**The runner still never reaches DASH's broker. It now has its own, with
its own stated limits. ADR 0006's surviving line stays literal.
`/broker/drain` and `/broker/responses` remain absent from the remote
channel type (ADR 0007). No provider request is relayed through DASH
after a key is placed (ADR 0018 rule 5). Closing DASH does not close
the host broker.**

What that forbids, in the shapes that will be offered:

- A tunnel from the VPS to `electron/broker-host.ts`.
- A new listening port on the VPS, or a forwarded loopback port on this
  machine, "just for the broker".
- Widening `RemoteRunnerChannel` with either broker route, conditionally,
  behind a flag, or "only for agents that declare local".
- Treating DASH being open as a runtime dependency of a host-held key
  after placement.
- Treating DASH being closed as revocation of that key.

What it still costs, and the receipt has to keep saying: DASH cannot
meter, cannot live-audit, and cannot revoke a call the host broker
makes. A pulled audit row is what DASH saw when it next looked, bounded
by the host's spool and by ADR 0007's pull. Local Disconnect does not
stop the host broker. Rotation at the provider does.

## 6. Empty store — never a vault clone

**The pack installs an empty store. Keys arrive one at a time, each
under ADR 0018's ceremony.**

ADR 0018 is per key, per host, on a person's press. A pack that shipped
the vault's contents would grant every credential to a machine in one
action and destroy that consent. There is no "sync my keys", no
remembered blanket approval, no "also copy Gmail", and no implementation
shortcut that writes more than one slot because the bootstrap was
already running.

Henrik's "vault clone" is the runtime shape — a store, a broker, a spool
— not the vault's contents. Say it that way so nobody builds the
shortcut later.

## Alternatives rejected

### Direct exposure (option 2)

Rejected by the ruling. An environment variable or a file path handed to
the agent is the cheapest consumption and the one the product's copy
cannot survive: the agent would hold the key. It is not a v1
compatibility mode and not what `install-key` is for. ADR 0018 already
refused caller-supplied environment and startup arguments on the same
ground (ADR 0014's second question).

### Neither yet (option 3)

Rejected by the ruling. Honest only while every surface says the key is
on the server and never that the agent can think there. That standing
is the gap this ADR closes, not a product.

### DASH operating a hosted broker, or tunnelling to `electron/broker-host.ts`

Rejected by ADR 0006, and structurally absent under ADR 0007. It would
make the remote runner a client of a credential-minting service, reattach
CASA the moment restricted-scope data transited DASH, and make closing
DASH a runtime failure. Option A pays the opposite cost openly.

### Copying `lib/broker/operations.ts` onto the host by inertia

Rejected above. Equal on the model-provider family, because that is why
the key was placed. Narrower on Gmail and MCP, because each is a
different custody class and a different later issue. A host broker whose
set is "whatever local DASH has this week" is not a closed set.

### A standing host spend allowance, or spend-on-start

Rejected. It would let a process that outlives every session empty an
account between two of DASH's Sunday opens — the sentence ADR 0016's
origin gate was written to protect, moved to the machine where it is
most expensive. The Run press travels; the standing exception does not.

### Treating a successful old `status` as "new enough"

Rejected. `status` already answers. The too-old probe has to be a verb
the current helper does not know, or the enrolled VPS looks current
forever.

### Console paste as the default upgrade

Rejected in the same terms as ADR 0018. The setup control is the
default. Console or the user's own SSH is fallback when DASH cannot
reach the host.

### Shipping keys in the pack, or a "sync my keys" after enrolment

Rejected by rule 6 and by ADR 0018. The pack is empty. Consent is per
key, per host, on a press.

## Proof obligations for the implementation session

This ADR is not implementation evidence. The later implementation has
two different proof classes.

**Blocking, local proof may establish:**

- the bootstrap that ships this DASH installs helper, empty secrets
  tree, `pack.json` at version 1, and a wrapping key, and does not
  write any `{connection_id}` file;
- `pack` returns `pack_version: 1` and carries no secret;
- a helper fixture without `pack` answers `unknown_verb`, and that maps
  to `host_pack_too_old` rather than to a generic refusal or to a
  partial `install`;
- the host broker admits exactly the v1 model-provider set and refuses
  `gmail.*`, `mcp.*`, caller-supplied URLs, undeclared slots, and spend
  with no host allowance;
- a host Run (`retry` accepted on the host) opens the host allowance,
  a runner start does not, and closing the local DASH fixture does not
  close that allowance;
- key bytes, wrap-key bytes and stable derivatives appear in no argv,
  answer, log, error, audit value, receipt or renderer payload;
- audit rows record names, counts, verdicts and host origin, never
  bodies or tokens;
- bundle modes remain exactly `0644` and `0755`;
- `install-key` writes under the helper-chosen secrets root with `0700`
  / `0600` proved, and refuses if the pack is missing;
- `/broker/drain` and `/broker/responses` remain absent from the remote
  channel type.

**Attended host proof must establish:**

- `186.240.156.166` (or whichever host is then enrolled) reports
  `host_pack_too_old` until setup is re-run, then reports pack version 1;
- the setup control is what was offered, not a console recipe as the
  default;
- after one ADR 0018 ceremony, the remote agent can complete its
  declared provider call through the host broker while the remote
  channel still cannot reach either broker route;
- the agent process does not hold the key;
- local Disconnect does not disable that call; provider rotation does;
- closing DASH does not disable an allowance a Run on that host already
  opened;
- the receipt on screen includes the account-not-keychain sentence and
  the spend sentence;
- nothing in that proof is claimed for Gmail or MCP.

ADR 0004 keeps the second list attended permanently. A green local
helper fixture proves the protocol and the refusal shape, not Hostinger,
`sshd`, its filesystem or the provider.

## Non-goals of this decision session

- No code, route, schema, test, helper verb, UI, or copy-string change.
- No implementation of the pack, the host broker, the store,
  `install-key`, `pack`, or the upgrade path.
- No merge.
- No claim that a deployed agent can do model work. Until the later
  implementation is proven, ADR 0018's substrate remains "the key is on
  that server", never "your agent can now think there".
- No bulk key copy, sync-my-keys, or remembered blanket approval.
- No hosted DASH broker, no tunnel to `electron/broker-host.ts`, no new
  listener on the VPS.
- No host-side Gmail, no host-side MCP, no memory design, no browser
  implementation. MAR-619, MAR-631, MAR-632 and MAR-633 are not this
  session.
- No contact with `186.240.156.166`.

The next session may implement this decision. This one ends with the
decision, because the first code line is a second security boundary and
now has a test to pass before it joins the closed set.
