# ADR 0018: A key crosses to one enrolled host only on a person's press

Status: Accepted

Date: 2026-08-13

Issue: MAR-625. Related: MAR-611 (bring an agent home), MAR-624 (one model
need), ADR 0006 (the broker's reach), ADR 0007 (the deploy transport), ADR 0009
(first-pin enrollment and the forced command), ADR 0011 (model choice), ADR
0014 (admitting a host operation), and ADR 0016 (a Run press may spend).

## Decision

**DASH may place a provider key the user owns on a host the user enrolled, but
only as one attended, per-key, per-host act over the enrolled host's
forced-command channel.** It is never a sync setting, never a side effect of
connecting a key locally, and never a bundle file.

Five rules make that one decision.

1. **Consent happens before the key leaves this machine.** The ceremony names
   the key, the server and the agent copy that will use it. The confirm press is
   unavailable until all three are on screen, together with this sentence:

   > from this moment the key lives on Hostinger too — DASH cannot see or take
   > back what uses it there; revoking means rotating at the provider

   `Hostinger` is the enrolled server's displayed name in this case. Another
   host substitutes its displayed name in the same sentence; the custody claim
   does not change. A second key or a second host is a second ceremony. Replacing
   the value behind a named key is a new ceremony too. There is no "sync my
   keys", "all servers", remembered blanket approval or background retry.
2. **The key travels on a new forced-command deploy verb, `install-key`.** It
   can target only an installed bundle, only a provider-key need that bundle's
   agent declares, and only a location the helper derives below its own host
   root. The request cannot name a path, filename, mode, environment variable,
   command or executable. It carries the key bytes on stdin, where deploy
   envelopes already travel, and the helper never returns them.
3. **`install-key` has its own owner-only write path.** Its parent directories
   are `0700`; the key file is created as `0600`; the helper reads the owner and
   mode back and refuses the operation if it cannot prove both. This is not a
   third mode admitted to `install`. `checkDeployRequest`'s bundle entries stay
   exactly `0644` or `0755`.
4. **Every surface that can imply custody carries the receipt.** The agent page
   says which key shadow is on which host and that DASH cannot meter, audit or
   revoke its use there. Bring-home accounts for the shadow before it removes a
   remote copy. The one-model-need projection treats a local brokered grant and
   a remote host-held key as two placements of one need, not as two services.
5. **ADR 0006's surviving line is literal:** the runner still never reaches
   DASH's broker — this is the user placing their key on their machine over a
   channel they built. `/broker/drain` and `/broker/responses` remain absent from
   the remote channel type, and no provider request is relayed through DASH
   after the key is placed.

The primary path is the enrolled channel. A console or the user's own SSH is a
fallback only when DASH cannot reach the host. It receives the same disclosure
and a weaker receipt, because DASH can say it showed the instructions but cannot
say the host accepted them.

## The question is how, not whether

MAR-625 began with three doors: a paste snippet, a new admitted push, or the
status quo with clearer refusal copy. Henrik's ruling closes that choice:

> When connected to the VPS - dash installs an implementation/Connection/bridge
> between the local dash and the VPS. That connection makes it easy to push keys
> etc. I dont want the end user to have to use hostinger console etc if it can be
> avoided.

The transport argument is strong because enrollment already did the expensive
work. DASH minted a distinct SSH key, the user confirmed the server fingerprint,
and the server's `authorized_keys` line binds that key to
`restrict,command="/opt/orchestratedash/dash-host"`. `sshd` therefore reaches a
helper with a closed vocabulary whatever a client asks it to run. There is no
new listener, relay, account, domain or hosted service in this decision.

That does not make a provider key ordinary deploy data. It makes the narrow
channel good enough to carry a decision that is explicit about changing
custody. The rest of this ADR is the difference between those two statements.

## What crosses, and what does not

The thing crossing is the exact provider credential DASH already holds for the
user: for MAR-625, an OpenRouter API key satisfying the News Scout's declared
model-provider need. DASH reads no value back from the host. The helper's answer
contains only the installed bundle identity, the declared key slot, the time and
whether the owner-only write was proved.

The request is narrower than a general secret uploader in four ways.

- **An installed bundle must already exist.** A key cannot be placed at a free
  host path or left as a host-wide loose secret.
- **The bundle's agent must declare the provider-key need.** The caller cannot
  invent a slot and use `install-key` as arbitrary encrypted file transfer.
- **The helper chooses the location.** A validated bundle id and a validated
  declared connection id are names, not paths. The helper maps them beneath a
  dedicated secrets root that `install` never writes and re-checks containment
  after joining.
- **The runtime receives only that known placement.** The request cannot add an
  environment variable or startup argument. How the standalone runner exposes a
  declared provider key to its agent is implementation work, but the exposure
  must come from the declared slot rather than caller-supplied process shape.

This means the on-host copy is bound to an agent placement even though the
consent boundary is per key and per host. If two agents on the same server need
the same provider key, the surface must say that the key is already on that
server and name both consumers; it must not silently create a second shadow or
pretend the first agent is an isolation boundary. Today the helper and runners
share one host account. `0600` protects the key from other host principals, not
from another process running as that same account, and no receipt may claim
otherwise.

## The consent ceremony

The ceremony is not a generic confirmation with a secret-looking icon. Before a
byte leaves, one frame shows:

- **Key:** the human provider label and the local connection that owns it, for
  example "Your OpenRouter key". Never the value; a masked suffix may disambiguate
  two keys but cannot stand in for the name.
- **Server:** the saved server label, address and confirmed host-key fingerprint.
  The label makes it readable; the address and fingerprint make it the enrolled
  machine rather than another row with the same label.
- **Agent:** the deployed copy and the declared model need the key will satisfy.
- **Custody:** the required sentence above, followed by the provider-specific
  place where rotation happens.
- **Action:** one affirmative press naming the movement, such as "Put this key on
  Hostinger". "Continue" and "Allow" hide the consequence and are not admitted.

The press authorises one attempt. If SSH is unreachable, the helper refuses, or
the mode/owner proof fails, the approval is spent and no automatic retry waits
for the host to return. Retrying puts the facts back in front of the user because
the host pin, local key and installed bundle may all have changed meanwhile.

The key is present in DASH's memory before the press because DASH already holds
it locally. What consent changes is where another durable copy may exist. The
renderer process never receives the value; the trusted side sends it directly
to `ssh` stdin and scrubs it from errors, logs, command audit targets and helper
answers. A diagnostic that quotes stdin is a credential leak, not evidence.

## A new verb, not a bundle exception

The tempting implementation is to add `0600` to `BundleFile.mode`, put a key in
`data/`, and call the existing `install` verb. It is rejected.

ADR 0014 amendment 1 already records the concrete failure: bundle modes are the
closed choice `0644` and `0755`; widening them for one file "would put a hole in
the closed set to avoid opening a closed set." The same rejection is preserved
in `lib/deploy/verbs.ts` beside `checkDeployRequest`. ADR 0016 then keeps the
product consequence explicit: a bundle that needs DASH's model-provider key
does not gain server spending through the local broker.

The difference is semantic, not just numeric.

| `install` | `install-key` |
| --- | --- |
| Carries a compiled runner and agent files | Carries exactly one declared provider key |
| Files may be read by the hosted program as ordinary bundle material | The value is custody-bearing and never ordinary bundle material |
| Caller supplies relative names and chooses one of two public bundle modes | Caller supplies no path or mode; helper chooses and proves `0600` |
| Re-install replaces bundle contents | Re-install cannot silently erase, preserve or replace a key shadow |
| Receipt is bytes, file count and runner build | Receipt is key identity, host, agent placement, time and custody limits |

Keeping the stores separate also prevents a later re-deploy from deciding key
custody accidentally. Bundle replacement may not copy, delete or refresh a key.
Those are credential acts and return to this ceremony.

### The owner-only install path

`install-key` writes outside the replaceable bundle tree, under a helper-owned
secrets root keyed by validated bundle and declared connection identifiers. The
request cannot observe or alter that path. The helper:

1. proves the bundle record exists and its agent declares the named need;
2. creates every parent directory as `0700` and verifies containment;
3. creates a same-directory temporary file with `0600`, writes the bytes without
   a text conversion, and reads back its uid and mode;
4. atomically renames it into the helper-chosen final location and verifies the
   final file again; and
5. returns a secret-free receipt only after the final proof succeeds.

Failure before the rename leaves no new key. Failure replacing an existing key
leaves the previous shadow in place and says so; it must never report "not
installed" merely because the new value failed. A successful replacement earns
a new receipt and makes the old receipt historical. Neither outcome logs a
digest of the key: a stable fingerprint of a low-entropy or reused credential
would become another identifier to protect and is not needed to name the user's
local key record.

`0600` is an owner boundary, not a sandbox. An administrator on the host can
take ownership, and any agent running as the helper's account can in principle
read files that account owns. That is why the ceremony says the key lives on the
host and why provider rotation, not deleting this file, is revocation.

## ADR 0014's three admission questions

ADR 0014 admits a new host operation only after three answers. `install-key` is
the first operation for which the first answer is deliberately uncomfortable.

| question | answer |
| --- | --- |
| Does it carry a credential in either direction? | **Yes, DASH to host.** It carries one user-owned provider key, once, after a per-key/per-host press. It carries no broker token and returns no credential. |
| Does it choose what runs, or only which? | It chooses neither executable nor command. It chooses **which already-installed agent copy receives which need it already declared**. The host helper chooses the path and the runner keeps choosing what installed registration runs. |
| Can DASH describe the result honestly afterwards? | **Yes, but only as custody.** DASH can record that its enrolled helper accepted an owner-only placement at a time. It cannot describe, meter or revoke provider calls made with the copied key, so every receipt says that. |

The first answer does not weaken ADR 0006 because the credential is not a way
for the runner to ask DASH to act. After placement, the runner calls the provider
directly. No request from the host reaches `electron/broker-host.ts`; no refresh
token or access token is minted on demand; closing DASH changes nothing about
the hosted copy's ability to spend. The cost is precisely that DASH is no longer
in the loop, and the receipt is load-bearing because no audit code can recover
that visibility later.

The second answer also refuses a general secret verb. A request that could name
an arbitrary slot, path, variable or startup argument would choose part of what
runs and would fail the question. The declaration and installed bundle are the
authority; the press selects among facts they already contain.

The third answer is why the ceremony, write proof and custody projections are
one decision. A transport-only patch would move a key successfully and leave
DASH unable to tell the truth about its own success.

## The deploy sequence and its failures

The existing refusal detects the right fact: this agent needs a key DASH will
not broker to a server. It stops being a dead end and becomes two honest exits:

1. **Deploy without the key.** The agent runs in the degraded state its manifest
   permits. If the need is required rather than optional, it stays stopped; the
   button cannot relabel a guaranteed failure as deployment.
2. **Put this key on the server and deploy.** DASH installs the ordinary bundle
   without starting it, performs the ceremony, invokes `install-key`, records
   the receipt, and only then starts the remote runner.

That order matters. The helper needs the installed bundle to validate the
declared slot, while a process must not start in the interval between ordinary
files arriving and its credential arriving. If the key step fails, the inert
bundle may remain for retry or removal, but it does not start. If start fails
after the key succeeds, the receipt still says the key is on the server; a run
failure is not a custody rollback.

A host too old to know `install-key` is `helper_too_old`, not an invitation to
fall through to `install` or to paste without asking. A changed fingerprint is
still ADR 0009's hard refusal. Forgetting and re-enrolling the server does not
erase a key already there, so the forget flow must preserve an unresolved
custody warning until the user rotates the provider key or explicitly records
that they removed the remote copy themselves.

## The custody receipts

The receipt is a projection of one fact: **this key may now be used outside
DASH's broker on this host.** Every projection names the same local key record,
host and agent placement. None stores or displays the value.

### Agent page

The model need appears once. Its placement rows say, in substance:

- **On this computer:** DASH holds the OpenRouter key and brokers the calls a
  Run press allows.
- **On Hostinger:** the deployed copy holds the OpenRouter key itself. Calls made
  there do not appear in DASH's broker audit, do not consume a DASH spend
  allowance, and cannot be stopped by disconnecting the local grant.

The remote row includes the consent time and the required custody sentence. A
later unreachable host makes the row stale, not false: DASH last proved
placement at that time and has not proved removal since.

### Bring-home (MAR-611)

A pushed key is not an output to copy home. DASH already holds the local source;
copying the remote value back would add a read path this decision deliberately
does not create. Bring-home instead accounts for each shadow before removing the
remote agent:

- name the keys the remote copy holds;
- say that removing their files is not provider revocation;
- stop the runner, remove the helper-owned key files, verify their absence, then
  remove the bundle; and
- record a removal receipt for each key shadow.

If the host is unreachable, too old or refuses removal, bring-home must not say
the key came home. It may bring back available outputs and leave the custody row
as **unresolved on Hostinger**, with provider rotation as the only certain next
step. An explicit "leave it there" path keeps the same row. Local agent deletion
cannot delete that fact merely because the agent row disappears.

### One model need (MAR-624)

The provider requirement, model tier and fleet grant are not three services.
They are one model need with placement-dependent custody:

- a fleet or per-agent grant satisfies the need for local runs through DASH's
  broker;
- an `install-key` receipt satisfies the same need for that deployed copy;
- neither implies the other; and
- neither chooses a model. ADR 0011's owner choice remains a separate fact that
  must also be present where the agent runs.

So a remote receipt must never turn the local card to "connected", and a local
fleet grant must never make a server row claim the key is present there. The
agent page, Connections page and model tile read one need and project the two
placements, instead of manufacturing a second provider card for the remote
case.

## Console paste is the fallback, and earns less evidence

The bootstrap snippet remains proof that a console path can be made legible,
but Henrik's ruling removes it as the default for keys. It is offered only after
the enrolled channel returns a named reachability failure or when the user
explicitly chooses their own SSH.

The fallback repeats the same key, server, agent and custody disclosure before
revealing anything copyable. Its snippet may write only the same helper-chosen
placement with `0700` parents and `0600` content; it is not a general shell
recipe with a user-edited destination. DASH immediately forgets the rendered
secret material and warns that terminal history, clipboard managers and the
provider console are now additional custody surfaces.

Because DASH did not observe the far-side write, the resulting row says
**instructions shown, placement unconfirmed**. It may become confirmed only
when the enrolled helper is reachable and can attest to the named slot without
returning its value. Showing a snippet is never evidence that somebody ran it.

## What revocation means

Three acts that look similar are intentionally not collapsed.

- **Disconnect locally** stops DASH brokering new local uses. It does nothing to
  the host-held copy.
- **Remove from host** asks the helper to delete the file and proves only that
  the helper-chosen file is absent afterwards. A running process may already
  hold the value, and the host administrator could have copied it.
- **Rotate at the provider** makes every copy of the old value unusable. It is
  the only act this ADR calls revocation.

That distinction is why the consent sentence says "revoking means rotating at
the provider" even though DASH can later offer a remove-key operation. Removal
is hygiene and lifecycle cleanup. Rotation is revocation.

## Alternatives rejected

### Make console paste the primary path

Rejected by the ruling. It makes the user rebuild a bridge DASH already enrolled
and turns the main AI-on-a-server journey into instructions for another product.
It remains necessary for an unreachable host and no more.

### Admit `0600` to the bundle mode set

Rejected above. It changes every bundle's file vocabulary, lets an ordinary
install carry custody-bearing material, and makes re-deploy silently decide
whether a key survives. The narrow new verb is the smaller widening.

### Sync every model key to every enrolled host

Rejected. Enrollment proves which machine SSH reached; it is not consent for
any credential. A blanket sync maximises copies, cannot name the agent need that
justifies one, and turns adding a host into a credential grant hidden behind a
different action.

### Let the remote runner call DASH's broker

Rejected by ADR 0006 and structurally absent under ADR 0007. It would make the
remote runner a client of a credential-minting service, reintroduce the hosted
or tunnelled broker, and make closing DASH a runtime failure. This decision pays
the opposite cost openly: the key lives there and DASH cannot account for its
use.

### Let the agent accept arbitrary environment variables

Rejected by ADR 0014's second question. It is a remote-execution surface with a
friendlier payload shape. A declared provider need is the only admitted target.

## Proof obligations for the implementation session

This ADR is not implementation evidence. The later implementation has two
different proof classes.

**Blocking, local proof may establish:**

- only an explicit consent result can call `install-key`;
- a request cannot name a path, mode, command, undeclared slot or uninstalled
  bundle;
- bundle modes remain exactly `0644` and `0755`;
- the helper creates and reads back `0700`/`0600`, refuses an unprovable owner or
  mode, and replaces atomically;
- key bytes and stable derivatives appear in no argv, answer, log, error, audit
  target, receipt or renderer payload;
- a failed key placement never starts the bundle; and
- agent, bring-home and one-model-need projections agree on the same custody
  fact.

**Attended host proof must establish:**

- the consent frame names the real local key and pinned Hostinger server before
  the press;
- the existing forced-command key accepts `install-key` and still refuses a
  shell and an unknown verb;
- the landed file is owned by the helper/runner account and reads `0600` on the
  real filesystem;
- the remote agent can make its declared provider call while the remote channel
  still cannot reach either broker route;
- local Disconnect does not disable that call, provider rotation does; and
- bring-home either removes and proves the key shadow or leaves an unresolved
  custody receipt without claiming success.

ADR 0004 keeps the second list attended permanently. A green local helper
fixture proves the protocol and refusal shape, not Hostinger, `sshd`, its
filesystem or the provider.

## Non-goals of this decision session

- No code, route or schema changes.
- No implementation of `install-key`, remove-key, consent UI or receipt storage.
- No change to `checkDeployRequest`'s `0644`/`0755` bundle modes.
- No broker route on the runner and no generalisation of the remote channel.
- No claim that `0600` isolates agents sharing one host account.
- No automatic provider rotation; DASH points to the provider and does not own
  its credential lifecycle.
- No scheduled or unattended consent, no blanket host approval, and no key
  synchronization policy.
- No decision that every remote credential must originate in DASH. An agent may
  still sign in on its own host; this ADR decides the console-free path for a key
  the user already gave DASH.

The next session may implement this decision. This one ends with the decision,
because the first code line is a security-boundary widening and now has a test
to pass before it joins the closed set.

---

## Amendment 1 (MAR-794): the verb, built — the reserved slot, the orphan question, and where the forget warning goes

Status: Accepted. Date: 2026-08-25. Issue: MAR-794, packet A of
`docs/proposals/vps-residency-2026-08-25.md` §8. Closes MAR-625.

Migration index **35**, producing `user_version` **36** — confirmed against the
literal pin in `tests/store-sqlite.test.ts` at this branch point before it was
written, which is the check that pin's own note asks for.

This ADR's non-goals said *"No implementation of `install-key`, remove-key,
consent UI or receipt storage"* and ended with *"The next session may implement
this decision."* This is that session. Everything the decision fixed is built as
written; what follows is the four places the implementation had to **decide**
something the decision left open, and one place it deliberately did not.

### 1. The reserved bundle id, because the chief belongs to no bundle

The host store is keyed `keys/{bundle_id}/{connection_id}`. A slot that belongs
to no agent — ADR 0028's chief needs two — has no bundle id, and the obvious
answer is a null or an empty one.

**Refused, and it is the same trap `connection_secrets` fell into once**: a NULL
agent was admitted there and the primary key made the row unusable. Here the two
ids are *joined into a path*, so a null joins as the literal `"null"` or
collapses a directory level depending on which caller reaches it first.

**Decided:** `RESERVED_HOST_BUNDLE_ID = "dash-host-reserved"`, a real string over
the identifier alphabet in `lib/deploy/verbs.ts`, so containment re-checking
after the join works unchanged and a receipt can name which placement it is
about. `checkDeployRequest` refuses it as the `bundle_id` of **every verb except
`install-key`**, which makes "no bundle can collide with it" structural rather
than conventional — `install` cannot create one there, `uninstall` cannot remove
one, and the orphan accounting can treat a reserved placement as never orphaned
without a second check.

**Its slots are a closed list, shipped empty.** An agent's slot is narrowed by
the agent's own declaration; a reserved slot has no document, so the only thing
that can narrow it is a list, and a list shipped with speculative names on it
would be an open door with a comment above it. `RESERVED_HOST_SLOTS` is `[]`, and
`install-key` against the reserved bundle answers `reserved_slot_not_admitted`.
The packet that puts a chief on a server adds a name to that list and argues for
it, which is `DEPLOY_VERBS`' discipline applied to slots.

**One constraint that packet inherits, named here so it is not discovered against
a live host.** A wire `connection_id` is an identifier, and the chief's local
connection id is `chief:model-provider` — a colon, which the alphabet cannot
spell. Widening the alphabet is not the answer: the alphabet is what stops an id
becoming a path. The chief's slot needs a wire name chosen deliberately.

### 2. The orphan question is answered by a join, not by a new read

This ADR requires DASH to be able to say which placed keys still have a bundle
to serve, and the residency proposal requires an orphaned slot to *"appear on the
server row rather than surface as a refusal when an agent next asks."*

**No verb was added for it, and none may be.** `pack`'s answer type is stated in
ADR 0021 §4 as having no member a slot name, a key count or a path could travel
in, and that guarantee is worth more than the convenience. The orphan standing is
a **pure join** — `standingForPlacements` in `lib/deploy/key-placement.ts` —
between DASH's own placement records and the bundle ids the host named in its
last `status` answer. It needs nothing new from the host and it can be run on
every render.

Two properties of that join are decisions rather than details. **Null is not
empty**: a server nobody has checked reports nothing orphaned rather than
everything, because DASH's own silence is not evidence. And a placement under the
reserved bundle id is **never** orphaned, which is the second reason §1's refusal
had to be structural.

### 3. Where the unresolved custody warning goes when a server is forgotten

This ADR says the forget flow *"must preserve an unresolved custody warning until
the user rotates the provider key or explicitly records that they removed the
remote copy themselves."* ADR 0010 says the opposite about the row that would
carry it: `forgetHostDeploys` exists precisely because a record that outlives its
label can only render as a claim about a machine DASH can no longer name, and
every sentence on a server card names the label rather than the address.

**Both cannot be honoured by the same row.** The decision taken, and it is a
genuine fork rather than a reading of either ADR:

> **The warning is said before the act, not preserved after it.** Forgetting a
> server that still holds placed keys names them, says that forgetting does not
> remove them, and says that rotating at the provider is the only certain step —
> on the confirmation, while DASH can still name the machine and while the person
> can still change their mind. The rows are then deleted with the deploy rows.

What that costs, stated rather than hidden: a person who forgets a server and
does not rotate has no standing reminder anywhere in DASH afterwards. **The exit
is a custody register keyed by the local key record rather than by the host** —
"this key of yours has been placed on a machine, somewhere, and DASH cannot see
it any more" — which is a fact about a credential rather than about a server and
would therefore survive the label. It belongs with whoever owns rotation, and it
is not this packet.

### 4. The deploy sequence is unchanged, and `MODEL_KEY_STAYS_HOME_REFUSAL` still stands

The section "The deploy sequence and its failures" describes turning the existing
refusal into two honest exits, the second being *"install the ordinary bundle
without starting it, perform the ceremony, invoke `install-key`, record the
receipt, and only then start the remote runner."*

**Not built, deliberately, and the refusal's wording is untouched.** That refusal
fires when a deploy is stopped because the agent's plan needs a model and DASH
holds the key — at which point **no bundle exists on the host**, and
`install-key` can only target an installed bundle. Naming it as the exit would
point a person at a control that would refuse them, which is the "surface claims
a path that stops one step short" failure ADR 0002 exists to prevent, arrived at
from the other side. The exit is a re-ordering of the deploy sequence, it is a
packet, and `lib/copy/host-pack.ts` records why the sentence is still absent.

The path this packet does open is the one the attended proof takes: an agent
whose model connection is declared optional deploys and runs degraded, and one
press on the server row gives it a key.

### 5. What the implementation found that the decision had not anticipated

**A failed replacement could delete the key it was replacing.** `writeHostKey`
proved the owner and mode of the **final** file and removed it when the proof
failed — after the atomic rename had already replaced the previous shadow. So the
one outcome this ADR forbids twice was the shipped behaviour of the primitive it
was going to be built on. The proof now runs on the temporary **before** the
rename, which moves every reachable failure to before the slot changes; the
post-rename proof still runs and, if it fails, refuses without deleting, because
turning an unproved key into no key at all on a machine nobody is watching is
worse than either.

**The store's AAD separator is a NUL byte in the source.** It is invisible in an
editor and in a diff, and retyping it as a space produces a `writeHostKey` whose
output `readHostKey` refuses as `unusable` — which the host broker reports as
`revoked`, which reads on screen as a key somebody rotated at the provider. It is
now named in a comment where the two ends meet.

### What the blocking proof establishes, and what it does not

`tests/install-key.test.ts` drives the production helper, bundled by esbuild from
the same entry point the standalone build uses, over the production
`runDeployVerb`. It establishes the protocol, the refusal shape, the owner-only
write, the replacement semantics, the closed field set, the alphabet, the
containment re-check, the unchanged `0644`/`0755` bundle modes, the
`host_pack_too_old` stop with no fall-through, and the reserved id's
non-collision. The value's absence is asserted over the **captured command line**
and the whole error path, and over every file under the host root.

It does not establish `ssh`, the enrolled key, `sshd`, the host's filesystem or
the provider. Those stay attended, permanently, under ADR 0004 — and the attended
list in "Proof obligations for the implementation session" above is unchanged and
unmet at the time of this amendment.
