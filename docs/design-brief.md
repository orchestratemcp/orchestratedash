# The DASH design brief

Who DASH is for, what it shows before it is asked, and the rules any surface in
this repository is held to.

- **Issue:** MAR-423 (DASH-19)
- **Constrains:** MAR-420 (DASH-16, the Modern Command Center), MAR-421
  (DASH-17, approval delivery), MAR-419 (DASH-15, the Chief chat)
- **Enforced by:** [`lib/copy/`](../lib/copy) and the tests over it

## Why this document exists

DASH-19 was written to resolve a contradiction with a design brief that
described the system as targeting *"developers and system architects who require
a high-density information environment"*. **No such file has ever existed in
this repository** — not on any branch, not in the history. The sentence was a
premise, not a citation.

So there is nothing to overturn, and the contradiction is real anyway: it lives
in the product, between an interface built for whoever was already reading the
code and the user MAR-423 names — someone who has never seen DASH, has not
opened a terminal, and is not going to ask anybody a question. This is the file
that decides between them, so that DASH-16 inherits a decision instead of
re-making it.

## The person this is for

**Someone who has never seen DASH, working alone, who wants to know whether
their thing is working.**

Not a persona exercise. It is a tiebreak rule: when a design choice serves the
novice and the expert differently, the novice wins the default and the expert
gets a way in. The reverse — an expert default with a simplified mode bolted on
— produces an interface that is wrong for everyone on first contact and only
ever fixed by people who already understood it.

Developers have not been demoted. They keep every surface they have, including
the manifest import path, the JSON views and the raw identifiers. What changes
is that those are *reached*, not *landed on*.

## Decision: the calm view is the default; density is opt-in

Stated plainly because it is the decision most likely to be quietly reversed by
whoever is next adding a column:

1. **Calm is the default state, for everyone, on first run and forever after
   until the user says otherwise.** Not a beginner mode, not a thing that
   switches off once DASH decides you look competent. There is no competence
   detection.
2. **Density is a deliberate, discoverable choice**, and it is **remembered per
   user**. Someone who turns it on once does not turn it on again.
3. **The Modern Command Center aesthetic survives unchanged.** This is a
   decision about *how much is on screen before the user asks for more*, not
   about the visual language. Same type, same palette, same restraint — see
   `app/globals.css`, which is already closer to calm than the interface built
   on top of it is.

### What calm means, concretely

A surface is calm when all of these hold. They are testable claims, not
adjectives.

- **It answers one question.** The agents list answers "what do I have and is it
  working". It does not also answer "what is each agent's clearance level".
- **Nothing on it requires prior knowledge of DASH to read.** No word appears
  that the user has not either chosen themselves or been taught on this screen.
- **Every column earns its place by changing what the user would do.** A fact
  that cannot change a decision is a fact for the detail view.
- **The empty state teaches.** It says what this screen will show, and offers
  the one action that makes it show something. It never apologises, and it never
  shows a command the user is expected to type.
- **Nothing moves or refreshes without saying it did.**

Density adds columns, ids, raw timings and JSON. It does not add a *different*
interface, and it must not become the only place a fact is reachable — if
something is only visible at density, calm is lying by omission.

## The guided path, and where it ends

**The guided path** is every surface a user can reach without choosing to see
more: first run, the agents list, a run's summary, the Connection Center's
checklist, every approval, every error, and every dialog the shell raises.

**No raw identifier appears anywhere in it.** Not component ids, not provider
scope strings, not environment variable names, not manifest paths, not internal
field names.

This is not a style preference; the machinery already exists to honour it.
`contracts/agent.manifest.v2.schema.json` buckets scopes under
`fields[].technical.provider_scopes` precisely so the plain label can be shown on
its own, and `lib/connections.ts` already produces `service`, `purpose` and
capability `label` alongside the ids it does not ask anyone to render.

**It is enforced by a test over rendered copy, not by inspection.**
[`lib/copy/identifiers.ts`](../lib/copy/identifiers.ts) holds the single
definition of "raw identifier"; every guided-path string is asserted against it.
MAR-428 established the pattern for the consent dialog in
`tests/handoff-flow.test.ts` and this generalises it rather than inventing a
second one.

**Two things are not identifiers, and hiding them would be worse than showing
them:**

- **A folder the user chose**, shown as a path. They made it; they can recognise
  it; and a dialog that asks permission to run something from somewhere it will
  not name is asking for blind trust.
- **The command that is about to run.** Same argument, more sharply. The rule is
  about DASH's internal vocabulary leaking out, not about concealing what is
  about to happen.

Developer surfaces may show everything, and must be **marked as developer
surfaces** — behind a disclosure, a density toggle, or a heading that says who
they are for. `app/agents/add/page.tsx` is the shape: the guided path leads, the
import form is real, present, and behind a `<details>` that says who it is for.

## Errors are recoveries

Every failure state names three things, in this order: **what happened, what it
means, and the single next action.**

A failure with no next action is not finished being designed.

The distinctions DASH already keeps at the seams must survive to the surface,
because each one is a *different* recovery and collapsing them sends the user to
the wrong one:

| Seam | Distinguishes | Because the recoveries differ |
| --- | --- | --- |
| `lib/secure-store.ts` | `not_found`, `vault_locked`, `backend_unavailable`, `invalid_name` | Connect it / unlock the vault / DASH will not store it here at all / a bug, not the user's fault |
| `lib/handoff-flow.ts` | expired, nonce mismatch, missing file, v1 manifest, mismatched agent, hand-written registration | Re-run the command / nothing / rebuild / update the Kit / rename / do it yourself |
| `lib/connections.ts` | declared vs derived, ownership confirmed vs assumed | "The agent says it needs this" is not "DASH worked out it must" |

**Never blame the user, and never blame them by implication.** "That link has
expired" is a recovery. "Invalid handoff" is an accusation with no next step.

## Approvals are the highest-stakes copy in the product

An approval is where a person decides whether to trust the thing. It gets its
own rules:

- **Ask about the change, never about the permission.** "Create this event
  Tuesday at 2pm?" — not "approve `calendar_write` for component X".
- **Render the actual content.** The real time, the real recipient, the real
  subject, from the agent's own state. Copy reviewed against a lorem fixture has
  not been reviewed.
- **Say what happens if they decline**, and make declining as easy to reach as
  approving, with no visual pressure toward yes.
- **Say who performs it.** The runner enforces the approval and performs the
  action; DASH asked.

Delivery — where an approval appears and how it reaches the user — is DASH-17.
This file owns the words and what is shown.

## The Chief is the accessibility layer

A non-technical user should never have to read the fleet grid to answer "is my
thing working". They should be able to ask, and get a sentence.

That makes DASH-15's chat the primary novice interface and the dashboard the
expert surface behind it. Recorded here because it is a prioritisation rule with
teeth: if DASH-15 and DASH-16 are ever forced against each other, the chat is
the one that serves this user.

## What this brief does not decide

- Layout, component inventory, or the fleet grid's design. That is DASH-16,
  which inherits the rules above rather than re-litigating them.
- Where an approval is delivered. DASH-17.
- Anything about the visual language, which is unchanged.
