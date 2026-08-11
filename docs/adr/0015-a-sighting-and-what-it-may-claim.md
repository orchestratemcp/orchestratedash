# ADR 0015: A sighting is an observation with a time on it

Status: Accepted

Date: 2026-08-11

Amends: ADR 0010 (the deploy record)

## Decision

**When DASH asks a server what is on it, the server's answer may be shown in
full — which agents, and whether each was running — provided every sentence
carries the moment the answer arrived and none is written in the present
tense.**

ADR 0010 fixed the honesty bound at the right place and then drew the line one
field too far to the left. It said:

> `host.probe` still returns a **count** from the server's own answer and never
> a list of names.

That restriction is lifted. The bound it was protecting is not.

## Why the count and the names are the same evidence

`electron/main.ts` receives `answer.bundles` from one `status` round trip. Each
entry carries an agent id, whether the host still finds a live process for it,
and a pid. Until now the function computed `running.length` and discarded the
rest.

There is no epistemic difference between the two halves. They arrived in one
sentence, from one machine, at one instant, with one degree of staleness. A
product that shows "2 agents running" and refuses to say which two is not being
more careful — it is being less useful on identical evidence, and it is asking
the person to hold the missing half in their head.

ADR 0010 anticipated this and left the door open, under *Alternatives declined*:

> **Ask the server instead.** `host.probe` already reaches the host and could be
> extended to return which agent ids it holds. Declined for now, and not because
> it is wrong — it is the *better* answer to "what is there", and it stays
> available.

The two costs it named are both already paid. The round trip happens either way,
because the count needs it. And the digest comparison it was protecting is
untouched: `agent_deploys` still answers "is what is there older than the change
you accepted", which no probe can.

## What this cost a person (MAR-606)

MAR-489's attended run, 2026-08-10. Henrik put one agent on one server by both
available routes — the agent page and the server card — and wrote:

> *"I could put the same agent two times on the server. And there is no way to
> see what agents are actually on the server. As far as i can tell."*

The outcome was benign. The host held one bundle, because the second install
replaced the first, and DASH held one `agent_deploys` row for the same reason.
**Nothing on screen said so.** DASH had been told the bundle's name by the server
and had thrown it away before anything could render it, so the one surface that
could have answered him counted to one and stayed quiet about what it counted.

## The honesty bound, unchanged, restated for a sighting

A sighting is DASH's record of its own looking, in the same sense
`evidence_pulls` is. It is admissible for exactly as long as it carries the time
it was taken.

Permitted:

- *"Hostinger reported News Scout running when DASH asked at 21:14."*
- *"Hostinger reported News Scout installed and not running, at 21:14."*
- *"DASH has not asked Hostinger what is on it."*
- *"Hostinger named one agent DASH has no record of sending."*

Permanently unavailable, and these are ADR 0010's sentences with nothing added:

- *"News Scout is running on Hostinger."* — present tense about a machine
  somebody else owns. The sighting is a photograph, not a subscription.
- *"News Scout is running on Hostinger."* said from `agent_deploys` — unchanged
  and doubly so: a deploy row was never evidence anything ran.
- Any sentence attributing running-ness to a named agent **without** the moment
  attached. The timestamp is not decoration; it is the entire licence.

## A sighting is not stored

It lives in renderer memory for the life of the window and is gone on reload —
`app/_data/sightings.ts`. This is deliberate and is the narrower half of the
decision.

`agent_deploys` is durable because a deploy is DASH's own act and stays true
forever: DASH did send those bytes on that date, and no later event makes it
untrue. A sighting is a claim about a machine DASH does not control, and it
begins going stale the instant it is taken. Persisting one would produce, on the
next cold start, a sentence about a server DASH has not spoken to since — with a
timestamp that makes it *look* accountable while nothing on the page distinguishes
"asked a minute ago" from "asked last Tuesday, before the server was rebuilt".

So the rule is: **DASH stores what it did, and remembers only for this session
what it saw.** A person who wants a fresh answer presses Check, which is the same
control it always was, and the surfaces that show a sighting say plainly when
none has been taken.

## Alternatives declined

**Store sightings in a table beside `evidence_pulls`.** It would let the fleet
card say something on a cold start, which is the one real loss above. Declined
for now because the sentence it enables — a running-claim aged in days rather
than minutes — is the one this ADR is least sure is honest, and because
`agent_deploys` already gives the cold-start surface something true to say
("DASH sent this here on 10 August, and has not asked since"). Worth revisiting
once a person has lived with the session-scoped version.

**Send the pid too.** Declined. It is a number that helps nobody this product is
for, and a field that exists is a field that ends up in a sentence.

**Keep the count and add the names as a disclosure.** Declined: it makes the
honest, useful answer the one you have to go looking for, and leaves the bare
count — the thing that confused Henrik — as the default reading.
