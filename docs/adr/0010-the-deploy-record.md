# ADR 0010: DASH records what it sent, never what is running there

Status: Accepted

Date: 2026-08-10

Amends: ADR 0007 (the deploy transport)

## Decision

**DASH keeps a durable record of every deploy it performed — which agent, to
which saved server, when, and the digest of what was in the bundle — and keeps
no record of what is on that server now.**

The two halves are not a compromise between them. They are the same rule stated
twice:

> A record of DASH's own outbound act is a fact DASH observed.
> A claim about the state of a remote machine is not.

So `agent_deploys` may say *"DASH sent this agent to marketing-vps on Tuesday,
and the copy it sent is not the copy you have now."* It may never say *"this
agent is running on marketing-vps"*, and no sentence derived from it does.

## What this changes, and what it does not

MAR-574 wrote the previous rule into `lib/shell/ipc.ts`:

> DASH keeps **no record of what it has deployed where** — `host.deploy` pushes
> a bundle, starts it and stores nothing — so the only account of what is on a
> server is what that server says when it is asked.

The first clause is now false and the reasoning behind the second is untouched.
`host.probe` still returns a **count** from the server's own answer and never a
list of names; `describeDeployed` in `lib/server-card.ts` still words the
server's report and still stamps it with the moment it was given. Nothing in
this ADR lets a surface answer "what is on that machine" from DASH's store.

What the previous rule got wrong was the scope of its own argument. It reasoned
about *inventory of somebody else's machine* — correctly — and then forbade
something else: **DASH's memory of its own actions.** DASH already keeps that
memory everywhere else it acts. `command_audit` records every command it
dispatched. `handoff_ledger` records every agent it was asked to add and what it
decided. `broker_audit` records every brokered call it adjudicated. A deploy was
the one outbound act DASH performed and then forgot, and forgetting it was not
humility — it was a gap the user paid for.

## Why the gap had to close (MAR-584)

An external editor changes an agent's folder. DASH detects it, says what
changed, and the person accepts the update. The next question is the only one
that matters and DASH could not answer it:

> *You just changed this agent. Does the copy you put on a server still match?*

Without a record, the honest answer was "DASH does not know whether you ever
sent this anywhere" — and the person's real alternative was to remember it
themselves, or re-push to every server they own on the chance one of them had an
old copy. That is worse than a stale row in both directions: it is less honest
*and* less useful, because the fact DASH was declining to state is a fact about
DASH.

## The honesty bound, stated as the sentences it permits

The record holds four things: agent, host, `sent_at`, and the manifest and file
digests of the bundle as it left. From those, three claims are available and
each is a claim about DASH:

- *"DASH last sent this agent to marketing-vps on 7 August."*
- *"What DASH sent then is not what this agent is now."* — a digest comparison
  between two things DASH holds.
- *"DASH has not asked marketing-vps what is there."*

And these remain unavailable, permanently:

- *"This agent is running on marketing-vps."*
- *"marketing-vps has the old version."* — the server may have been rebuilt,
  the agent stopped, the folder replaced by hand, or the whole host handed to
  somebody else. DASH sent bytes once; it did not acquire a subscription to
  their fate.
- *"You have 3 agents deployed."* — a count of DASH's own past acts is not a
  count of running agents, and a surface that labelled it as one would be the
  inventory this ADR still refuses.

A row is therefore **evidence of a past act with a date on it**, in the same
sense every other audit table in this schema holds one. The date is not
decoration: it is what stops the row reading as present tense.

## Deletion

`host.forget` removes the deploy rows for that host. This is not tidiness —
after the key is gone the label is gone too, and a row naming a server DASH can
no longer reach or name would produce exactly the orphaned present-tense claim
above. Removing an agent leaves its rows alone, for the reason `agent_looks`
gives: a record of a past act does not need the actor to still exist, and a
foreign key here would make deleting an agent fail on a table about history.

## Alternatives declined

**Ask the server instead.** `host.probe` already reaches the host and could be
extended to return which agent ids it holds. Declined for now, and not because
it is wrong — it is the *better* answer to "what is there", and it stays
available. It answers a different question than this ADR's: it cannot say
anything about a server that is currently unreachable, it costs a round trip per
server on a page that has to render, and it still would not tell the person
whether what is there is *older than the change they just accepted* without the
digest this record keeps. The two compose; neither replaces the other.

**Store nothing and re-push blindly.** The user's own memory as the record. This
is the state MAR-584 arrived in, and the reason it fails is above.

**Store the bundle.** A copy of what was sent, so a diff against the server
could be exact. Declined: it multiplies every agent's disk cost by the number of
servers it has been sent to, to sharpen a claim DASH still could not make,
because the question is what is on the *server* and no local copy answers that.
