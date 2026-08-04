# ADR 0006: The broker's reach ends at this machine

Status: Accepted

Date: 2026-08-03

## Decision

**DASH will not extend the permission broker off the machine DASH is installed
on.** A process DASH's own runner did not spawn receives no brokered credential
and no brokered operation, ever, and DASH will not operate a hosted token
broker to change that.

An agent that must run while DASH is closed — on a VPS, on Railway, answering a
Discord or Slack or Telegram message at three in the morning — is therefore an
agent that **holds its own credentials**. DASH renders such a connection as one
it does not mediate: the `agent_managed` ownership that already exists in
`contracts/agent.manifest.v2.schema.json`, with a receipt saying DASH cannot
narrow what it does, cannot show what it did, and cannot take it away.

Two rules follow, and they are the whole of the decision:

1. **The broker's reach is bounded by the transport, not by policy.** Nothing
   is added to enforce this; it is already true and this ADR writes it down.
2. **A manifest that asks for both is a contradiction DASH must refuse at
   import, not discover at runtime.** Today it is legal, DASH ships an example
   that does it, and the user finds out afterwards as a row under "What DASH
   cannot account for".

`hosted_broker` stays in `TokenCustodian` and is neither a plan nor a mistake.
See "What `hosted_broker` actually is" below.

## The collision, stated precisely

ADR 0002 amendment 1 records the cost of where the broker runs, and does not
hedge it:

> **When DASH is closed, the broker is closed.** A hosted agent whose runtime
> declares `continues_when_dash_closed` keeps running and its brokered calls
> stop being answered — they settle as `broker_unavailable` at the agent's own
> timeout. That is the correct behaviour, because the alternative is a process
> that can reach a user's mailbox while the app they granted it through is not
> running.

That is structural. `safeStorage` is an Electron main API, so the refresh token
is readable in exactly one process, which is what amendment 1 means when it says
invariant 1 stopped being "a rule someone must follow" and became "a fact about
where the code can run."

The wanted product is the opposite shape: agents on somebody else's computer,
running when this one is off, using connections a person configured here.

Both cannot be true as built, and this ADR picks.

## What is already true, before designing anything on top of it

ADR 0005's habit, because two of the three candidates below turn out to be
arguments about a boundary that is enforced more strongly than either of them
assumed.

**The broker is not reachable from off this machine, and the reason is not a
check.** A brokered request reaches DASH by exactly one path: an agent writes a
line to its own stdout, the runner it was spawned by buffers it, and
`electron/broker-host.ts` drains that buffer over the runner's local transport.
Since MAR-430 that transport is a **Unix socket or a Windows named pipe and
never a port** — `runner/server.ts` says so, and keeps `isLocalPeer` only
against a future TCP listener that does not exist. There is no address a VPS
could dial. The operating system decided who may connect, by socket mode and
directory ownership on POSIX and by the pipe's descriptor on Windows, before
any DASH code ran.

So the rule "a remote agent gets no brokered credential" is not a policy this
ADR introduces. It is a property of the transport that nothing has written
down, which is why a manifest can currently promise a user something DASH will
never deliver and nothing objects.

**The contradiction ships in `examples/`.** `gmail-meeting-assistant.manifest.v2.example.json`
declares `continues_when_dash_closed: true` and two `dash_managed` connections
— Gmail and Calendar, five brokered capabilities between them. It is a
perfectly ordinary manifest, it validates, and every brokered call it makes
while DASH is shut settles as `broker_unavailable`. ADR 0005's case 1 exists to
tell the user about it afterwards. Nothing tells them before.

**The unbrokered path is not a new mechanism.** `ownership: agent_managed`
predates the broker, `ConnectionRequirementRow.broker` is already nullable, and
`lib/views/types.ts` already explains that a card promising narrow operations
for a credential DASH hands straight to an agent "would be describing a
boundary that is not there." Option 1 below is not something to build. It is
the path DASH already has, pointed at a case nobody has decided about.

## The three candidates

### Option 1 — remote agents hold their own credentials

An agent on Railway signs in to Google itself, keeps its own refresh token in
its own host's secret store, and calls Gmail directly. DASH shows the
connection, names the capabilities the manifest asks for, and brokers nothing.

**This abandons ADR 0002's thesis for exactly the unattended case, and the
sentence is worth reading twice.** The boundary applies where the risk is
lowest — a person is at the keyboard, DASH is open, the process is one DASH
spawned and can kill — and evaporates where it is highest: nobody watching, a
machine the user does not administer, a process that outlives every session.
The 24/7 mailbox assistant, the one agent whose access most deserves a narrow
allowlist, is the one that gets a raw token. That is not a caveat on this
option. It is what this option is.

What survives, by number:

| # | verdict |
| --- | --- |
| 1. Refresh tokens in the OS vault, never in an agent process | **Survives, requalified.** True of every token DASH holds. The remote agent's token was never DASH's, is not in DASH's vault, and DASH cannot put it there. The invariant needs the words "DASH holds" to stay honest. |
| 2. Access tokens stay on the trusted side of the broker | **Survives vacuously.** There is no broker in this path. |
| 3. Typed inputs, never a URL, method or raw scope | **Dies.** The agent chooses everything. |
| 4. Every grant has a user-visible receipt | **Survives, and is the load-bearing one.** DASH can still show account, provider, capabilities, requesting agent — and must now also show what it cannot do. |
| 5. Every invocation audited | **Dies.** `broker_audit` records decisions DASH made, and DASH makes none. |
| 6. No Gmail send operation exists | **Survives literally and stops being reassuring.** It is a statement about `lib/broker/operations.ts`, which remains a three-entry list. A remote agent holding a `gmail.compose` credential can send, and invariant 6 was never a claim about the user's mailbox — it will now read like one. |
| 7. Provider content is untrusted and cannot authorize a side effect | **Survives as DASH's rule and stops being DASH's to enforce.** |
| 8. MCP connectors pass the same capability review | **Survives.** Unaffected. |

### Option 2 — a hosted broker

DASH runs a server holding refresh tokens, and remote agents call it the way
local ones call Electron main.

Every invariant survives on paper. That is the problem: they survive as
sentences, and what made them believable was that they were not sentences.

**Invariant 1 stops being a fact and goes back to being a rule.** The precise
loss is amendment 1's: "`safeStorage` is only readable there… the runner relays
and could not mint a token if it wanted to." On a server, nothing stops the
process that holds the token from doing anything with it except the code being
correct — which is exactly the standard ADR 0002 was written to stop relying
on, and exactly the standard ADR 0002 amendment 2 declined to accept for
`WriteOperation` when it removed `plan` rather than checking its output.

**What a user is trusting changes category.** Today they trust software they
installed on a computer they own, with a vault the operating system holds and a
disconnect that takes effect on the agent's next request because the grant is
re-resolved on every call. Tomorrow they trust an operator: its staff, its
backups, its incident response, its jurisdiction, its subpoenas, and its
continued existence. Those are not more of the same trust. DASH has no operator
today and would be inventing one.

**Who can revoke stops being answerable locally.** Disconnect is currently true
by construction — `lib/broker/execute.ts` resolves the grant per call, so the
next request after a disconnect is refused, and PROJECT_STATE says so. With a
hosted broker, pressing Disconnect in the desktop app becomes a *request to a
server*, and the card's promise becomes an assertion about a system DASH cannot
observe. Proof `7n` is the standing lesson: a negative proof whose subject is
free to refuse is a proof of the wrong party. A revocation receipt whose
subject is free to ignore it is a receipt about the wrong party.

**Google's restricted-scope regime attaches, and it is not free.** ADR 0002's
Google release path is explicit: `gmail.readonly` and `gmail.compose` are both
restricted, and **"if restricted-scope data is stored on or transmitted through
servers, an annual independent CASA security assessment is required. Google
does not charge the assessment fee; the independent assessor sets it."** A
hosted broker transmits restricted-scope data through a server by definition —
that is what it is for. So option 2 converts a one-off verification problem
into a recurring annual assessment at a price a third party sets, before DASH
has a single paying user.

**And nothing about it can be proven by a blocking gate.** ADR 0004's rule: a
blocking release gate may depend only on this repository and this machine. A
hosted broker is neither, so every claim about it is advisory, dated, and
somebody else's to withdraw. Today `pnpm verify` proves 67 installed checks
including the whole broker boundary. That number does not grow to cover a
server; it stops covering the interesting half.

### Option 3 — remote agents get no brokered credential

What this rules out is **the entire brokered surface**, and it is short enough
to list. `lib/broker/operations.ts` contains exactly three operations:

- `gmail.search` — "Find messages in your mailbox"
- `gmail.message.read` — "Read one message you asked it to look at"
- `gmail.draft.create` — "Save a reply in your Gmail drafts"

A remote agent gets none of them. Concretely: a Discord bot that fetches public
feeds and posts a cited digest — the AI News Scout, whose permission receipt is
`network: read` and nothing else — works. A Telegram bot that answers "what did
Anna say about the invoice" does not, and no amount of narrowing the request
makes it work, because every path to a mailbox runs through one of those three
names.

Every invariant survives, without qualification, because nothing changes.

The cost is not in the invariants. It is that **option 3 alone is a refusal
without a product**: the thing Henrik wants becomes impossible rather than
bounded, and a decision that answers "you cannot have that" without saying what
you can have is not a decision, it is a delay.

## What is chosen, and why it is one decision rather than two

**Option 3 governs the broker. Option 1 governs everything past it. Option 2 is
rejected.**

That is a single rule with a single subject — *how far the broker reaches* —
and the two halves are the inside and the outside of one line:

> A brokered credential is available to a process DASH's own runner spawned, on
> this machine, while DASH is open. Anything else is unbrokered, holds its own
> credentials, and must say so before a user grants anything.

Option 2 is rejected on the four costs above, and the shortest of them is the
one that decides it: a hosted broker would make invariant 1 a rule again. ADR
0002 amendment 1 spent a paragraph explaining why that invariant being a *fact*
is what made the boundary worth having. Undoing that to reach an unattended case
would be trading the property for the feature it exists to protect.

Option 1 is chosen for the outside not because it is good but because it is
**already what happens**, and the alternative to admitting it is not safety —
it is a user who deployed an agent to Railway, connected Gmail in DASH, and
believes DASH is narrowing what that agent can do. The honesty rule DASH
already applies to `network: read` is the same one: *"a declaration DASH
renders, not a boundary DASH enforces"*, attributed to the agent on every
surface. This extends that rule to a credential rather than inventing a new
one.

## What the Connection Center must say

The test each option had to pass: **a receipt that cannot describe remote
custody honestly rules the option out.** Plain language means passing
`lib/copy/identifiers.ts` — no field names, no environment variable names, no
scopes, no filenames.

**Option 3, a brokered connection on an agent that outlives DASH.** Said
*before* the user connects, for amendment 2's reason — a disclosure that
appears only after the grant has told them nothing:

> This agent can use your Gmail connection only while DASH is open on this
> computer. When DASH is closed, the agent keeps running and its requests to
> read your mail go unanswered.

Honest, checkable, and derivable today from facts DASH already holds.

**Option 1, a remote agent holding its own sign-in.**

> This agent signs in to Gmail itself, on the computer where it runs. DASH
> cannot limit what it does there, cannot show you what it did, and turning
> this off here does not stop it. To take its access away, remove it in your
> Google account.

Four clauses, three of which are DASH admitting it is not in the loop. It is an
unpleasant sentence and it is a *true* one, which is the whole test. Note it
ends by naming the only revocation that works, because a receipt that says what
DASH cannot do and stops there has left the user with no move.

**Option 2, a hosted broker.** The sentence already exists, and it is the
reason this option fails the test. `describeCustody` returns, for
`hosted_broker`:

> "A hosted service holds the sign-in for this connection, not this computer.
> Disconnecting here stops DASH using it."

Now read its sibling, written in the same function on the same day for
`remote_mcp_server`:

> "A remote server holds the sign-in for this connection, not DASH.
> Disconnecting here stops DASH using it **and does not withdraw the server's
> own access.**"

The second clause is the one that matters and the `hosted_broker` sentence does
not have it. That is not a copy oversight to be patched — it is the option's
problem surfacing in the one place it cannot hide. To write the missing clause
DASH must answer whether disconnecting locally withdraws the hosted service's
access, and either answer is bad: "no" tells a user their Disconnect button is
decorative for the connection they care most about, and "yes" is an assertion
about a remote system whose compliance DASH cannot observe and no gate on this
machine can check.

Option 3's sentence is checkable from local state. Option 1's is checkable
because every clause is a negation of something DASH does. Option 2's is
neither.

## Is `continues_when_dash_closed` enough

**No, and no new manifest field should be added either.** Three separate
findings, and the third is the one that decides it.

**It is the wrong subject.** `continues_when_dash_closed` answers *does this
process outlive DASH* — a question about time. What a grant needs answered is
*can this process reach the broker at all* — a question about place. The
shipped `gmail-meeting-assistant` example is the disproof, and it is DASH's
own: `runtime.class` is `local_process`, `locations.runtime.kind` is `local`,
and `continues_when_dash_closed` is `true`. A local worker on the user's own
machine, outliving DASH, with two brokered connections. Gate on this field and
that agent is refused Gmail — for a condition whose remedy is *open DASH*,
which is nothing like a VPS's. It over-refuses the local case and does not
identify the remote one, because the two are independent: a remote agent could
declare `false` and still be unreachable.

**ADR 0005 already spent this field on a different job.** The per-agent lapse
sentence is derived from it at render time, *deliberately* not stored, "because
the answer changes when a manifest changes and a stored answer would go on
asserting yesterday's." A value whose whole design rests on being free to change
under you is the wrong thing to hang a permission decision on. Recruiting it as
a gate would make one boolean simultaneously a description that may change and a
constraint that must not.

**An existing field does carry place — and it must not be the gate either.**
`agent_dom.locations.runtime.kind` is required and its enum includes `remote`,
and orchestratekit-mcp already emits it: `runtimeLocationKind` maps
`managed_worker`, `scheduled_job` and `workflow_platform` to `remote` and
`local_process` to `local`. So the contract can already say it, on both sides
of the seam, with no change to either.

But it is **the agent author's claim about itself**, with exactly the standing
`draft.placement` and `sources_fetched` have, and ADR 0002 amendment 2 is
explicit about what that standing is worth: the agent's claim, never DASH's
record. A manifest declaring `local` while the process runs on Railway would be
handed a brokered grant by a gate that believed it.

**So the fact DASH needs is not in the manifest at all, and DASH already owns
it.** A brokered request can only arrive through a child DASH's own runner
spawned, over a socket or pipe with no remote address. DASH does not need to be
told where the process is; it spawned it. Taking a security decision from a
third party's document, for a fact observed directly, is the mistake amendment 1
records DASH avoiding — the difference between a rule someone must follow and a
fact about where the code can run.

**What the manifest's claim is good for is copy, not gating.** `locations.runtime.kind`
being `remote` beside a `dash_managed` connection is an author declaring an
intention DASH will never satisfy, and that is worth refusing at import with a
sentence — before a user connects an account to an agent that cannot use it. It
widens no grant, because the transport already decided; it only stops DASH
staying silent until the lapse row.

**Conclusion: the contract needs no new field.** It needs a constraint over two
fields it already has, and the enforcing fact stays where it is — outside the
contract, in the transport.

## What `hosted_broker` actually is

Neither a plan nor a mistake, and the type's own comment nearly says so: "the
shared vocabulary rather than a plan."

It is the vocabulary for **somebody else's** hosted broker, which is what ADR
0002's rollout stage 3 describes and this ADR does not disturb: *"A hosted token
broker such as Vercel Connect can be an optional deployment choice; it is not
required for the local-first path."* A user who connects an MCP server that
happens to keep its tokens in a hosted service needs a card that can say so.
That is a custody fact to *describe*, and describing custody honestly is the
field's entire purpose.

What this ADR rules out is **DASH operating one**. The value stays; the
roadmap it seemed to imply does not exist and never becomes reachable by DASH's
own connections.

One consequence is a real defect, named here rather than fixed, because this
session may not touch `lib/`: `describeCustody`'s `hosted_broker` sentence is
missing the clause its `remote_mcp_server` sibling has. Under this decision the
value can only ever describe a third party's broker, for which "disconnecting
here does not withdraw the service's own access" is exactly as true as it is for
a remote server. The sentence should gain it. Until it does, that string is the
one place in the Connection Center where a custody description under-states,
and it under-states in the direction of reassurance.

## What stops being proven

Stated plainly, because this is the cost and it is larger than the decision
looks.

**`broker_audit` stops being a complete answer to "what has this done to my
account?"** Today it is complete for every brokered connection, on every path
including refusals, and the product says so. Once a remote agent holds its own
Gmail credential, the question has an answer DASH cannot see any part of — not a
gap DASH can measure, a gap DASH is not present for. ADR 0005 built "What DASH
cannot account for" for attempts nobody adjudicated, and this is **not** a
fourth case for it: a lapse row requires DASH to observe its own absence, and
DASH is not absent here, it is uninvolved. There is nothing to record.

**Revocation stops being immediate, for the connections most likely to matter.**
"Disconnecting takes effect on an agent's next request rather than at its next
restart" is a property of resolving the grant per call. For an agent holding its
own credential the local Disconnect does nothing whatsoever, and the only real
revocation is at the provider, on a page DASH does not control and cannot
confirm.

**Proof 7g has no analogue past the line, and nothing can substitute.** The
check that makes the boundary believable is the agent dumping its own
environment and the token not being in it. On the unbrokered side the token *is*
in it, by design. There is no negative check to write, so the honesty burden
moves entirely onto copy — which is the weakest place DASH has ever put a
guarantee, and the ADR says so rather than letting the receipt's confident tone
imply otherwise.

**Nothing about remote deployment can ever have a blocking gate.** ADR 0004's
rule forbids it: a VPS is neither this repository nor this machine. So the
deploy-to-a-host work inherits MAR-468's shape — attended, dated, with a human
watching and a promotion rule written *before* the run — and it inherits it
permanently rather than until somebody automates it. That is a standing cost on
every future claim about the hosted path, not a one-off.

**And one thing that was never proven becomes visibly unproven.** ADR 0002
amendment 3 already lists ADR 0005's cases 1 and 3 as unit tests only, case 1
being "DASH was closed". That case is the exact condition this ADR is about, it
"cannot be driven by a proof running inside DASH", and it stays unproven after
this decision as before it. The decision does not fix it. It explains why the
gap is permanent.

## What ADR 0002 stops claiming

Four sentences need qualification and one changes character. Recorded in **ADR
0002 amendment 4** rather than edited in place, so the original claim and its
narrowing both stay readable.

- **The Decision's first sentence** — "An agent receives narrow operations, not
  a provider refresh token or a general OAuth access token" — was written as a
  universal and is now true of brokered connections only.
- **Invariant 1** needs "every refresh token DASH holds".
- **Invariant 3** and **invariant 5** need "brokered".
- **Invariant 6** is unchanged in wording and changes in what it reassures
  about: it is a statement about DASH's operation set, and it was always only
  that.

## Alternatives rejected

**Add a manifest field saying "this connection is used while DASH is closed".**
It is a third party's claim about a fact DASH observes directly, and the two can
disagree. Worse, it invites the reading that declaring it *enables* something,
when the transport has already decided and no declaration can widen a grant.

**Let a remote agent reach the broker over an authenticated tunnel from the
user's machine.** This is option 2 wearing a local costume: the tokens are still
minted here, but a process on somebody else's computer can now cause a mailbox
read at any hour with nobody watching, and "the broker is closed when DASH is
closed" survives only until the first person leaves DASH running. It relocates
the trust decision without making it, and the CASA question attaches the moment
restricted-scope data crosses the tunnel.

**Say nothing and let the lapse row explain it afterwards.** What exists today.
It tells a user their agent could not read their mail *after* they connected
their mail to it, which is the wrong end of the decision, and ADR 0005 built
that surface for attempts nobody adjudicated rather than as a substitute for a
warning.

**Ship a second operation set for remote agents, narrower still.** Narrower than
three operations is one or zero, and any of them still needs a credential on the
far side of a boundary DASH cannot reach. The problem is custody, not breadth.

## Follow-ups this does not do

- The import-time refusal is not built. It is the substance of the deploy work
  and belongs with it rather than as a lone validator with nothing to validate.
- `describeCustody`'s `hosted_broker` sentence keeps its missing clause, named
  above. A one-string fix that this session may not make, and it should not ride
  in on an unrelated change.
- `examples/gmail-meeting-assistant.manifest.v2.example.json` is the shipped
  contradiction and is left alone deliberately. It is a *local* agent, so under
  this decision it is legal and merely under-explained — the sentence it needs
  is the option 3 copy above, not a change to the example.
- Whether a remote agent should be able to ask DASH to do something *while DASH
  happens to be open* — a queue rather than a broker — is not decided here. It
  is a different shape with a different failure mode, and nobody has asked for
  it.
