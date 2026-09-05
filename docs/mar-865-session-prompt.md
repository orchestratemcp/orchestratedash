# Session prompt — MAR-865 part 1, and MAR-864's spike, in one session

Dispatched by the orchestrator 2026-09-05. The VPS exists:
**78.141.221.121**, Ubuntu 24.04, OpenSSH 9.6p1, port 22 answering.

**The two packets were restructured at dispatch.** As written they interleave:
MAR-864's revised hour one is "deploy an agent, give it a schedule, see whether
it runs there", and that needs a host, which is MAR-865's step 1. So this
session does MAR-865's enrolment and deploy *and* answers MAR-864's spike
question with the same work. Discord and the press-routing become a second
session once we know what the transport actually does.

---

**Client:** Claude Code, `claude --model opus` with extended thinking.

**Why this tier:** first contact with a real server, an owner-gated credential
flow, and a spike whose answer re-scopes the next packet. Nothing here is
bounded implementation.

**Repository:** `orchestratedash`, `master` at or after `d7b4b9b`.
**Worktree:** the **main checkout**. You are driving the installed app against
a real machine, not editing a branch in isolation. Create a branch only if you
end up changing code.
**Linear issues:** MAR-865 (owner), MAR-864 (the spike question).

## What is true before you start

- `hosts` = **0 rows**. `agent_deploys` = **0 rows**. The deploy plane has
  never been exercised against a real machine. Everything you hit is first
  contact.
- `notify_discord` and `chief_discord` are both configured already. **Do not
  touch Discord this session.**
- Studionet's contract `0xD08455a5Cfc53E43731834d6C92a6FE4aA0b3B75` was
  answering yesterday.

## The credential flow — read this before you open anything

`lib/host-wizard.ts` is explicit, and it is the opposite of what most tools do:

> **DASH makes the key and keeps the private half.** What the person is shown
> is the public half and where to put it.

`electron/ssh-host.ts` has **no function that returns a private key**, and a
test asserts that over the module's exports rather than trusting a comment.

So: **you never see a private key, Henrik never pastes one, and you must not
ask him for one.** If you find yourself wanting a paste field, stop — that is
the exact thing this design refuses.

What Henrik does, once: put the public half DASH shows him into
`~/.ssh/authorized_keys` on the VPS. Ask him for the **username** you should
enrol, and nothing else.

## Order of work

### 1. Enrol the host

Through the wizard, in the app. Three steps by design; do not go around it with
a terminal. `ssh-keyscan` cannot enrol a host from Windows and DASH has
resolved around that since PR #137 — follow that path, do not reinvent it.

Record what the wizard actually asked for versus what MAR-498/MAR-574 say it
asks for. This is the first real run of that flow.

### 2. Deploy an agent

Pick one that **needs no brokered credential**. `lib/deploy/connection-travel.ts`
is categorical: no credential travels to a server, ADR 0006/0007, and a
`dash_managed` connection's copy on the host starts with nothing to sign in
with. An agent that needs a key will fail remotely for reasons that look like
the deploy failing.

`proof-scout-mar861` reads public sources and is the natural candidate. Say
which you chose and why.

### 3. Answer MAR-864's question

Give the deployed agent a **schedule** and watch. Does it run on the host, and
does its evidence come home, with **no new code at all**?

MAR-602 flagged this as the cheaper answer to the same need and MAR-795 appears
to have built it: schedules cross in both directions under ADR 0031, and
`runner/schedule.ts` turns a due window into *"the same `retry` a press
produces, through the same `executeCommand`"*.

Report the answer plainly. It re-scopes MAR-864:

- **It runs** → MAR-864 is a UI packet. Route the press to the right machine
  and say on screen which machine ran. No new transport.
- **It does not run** → say exactly what refused, with the log line. Do not
  improvise a transport at a deadline.

## Scope limit that matters — read it twice

**A model key on the host is OUT OF SCOPE this session.**

A digest from public sources needs no model. Composing a *brief* does. The
runner spends "out of the host's own secret store or not at all", `install-key`
exists as a deploy verb, and MAR-629 is still open on exactly this. So:

- Prove **a run starts remotely and its evidence comes home.** That needs no
  key.
- If the brief step fails for want of a model, **that is a finding, not a
  blocker.** Record it and stop there.
- **Do not place a key on the host.** If you decide the packet cannot progress
  without one, write the handoff and hand back. The host pack's AAD separator
  is a NUL and retyping it as a space makes every placed key read as revoked —
  this is not something to get right in passing at 1am.

## Non-goals

- No Discord. Second session.
- No press-routing UI. That is MAR-864's build, after the spike answers.
- No credential travel, no key placement, no workaround for either.
- Do not delete anything from the live store — including the
  `dash-google-proof` row, which is MAR-870 and is Henrik's call.

## Owner-gated steps

Two, and both are Henrik's:

1. The **username** to enrol.
2. Pasting DASH's **public** key into `~/.ssh/authorized_keys` on the VPS.

Ask for both up front, in one message, so he is not interrupted twice.

For boot survival he will also need `loginctl enable-linger <user>` on the
host. DASH treats *enabled* and *starts at boot* as two different facts and
reports the account's own lingering, so without it the unit starts at login
rather than at boot. Tell him; do not run it for him unless he asks.

## Proof line

`proven` for MAR-865's first half = **an agent is deployed to 78.141.221.121
and DASH shows the host's own account of it.** Evidence: the `status` and
`collect` output, and the host row in the app.

The MAR-864 spike is a **finding**, not a proof. Report the answer.

## Gotchas

- Run from **PowerShell**, not Git Bash.
- **Never force-kill Electron.** It corrupted the real store once.
- DASH stores **no record of what it put where** — the only account of what is
  on that server is the server's own answer to a check. Do not write a sentence
  claiming an agent "is running there"; say what the host reported and when.
- A deploy is three steps behind one await. A refusal can arrive with nothing
  sent, with files copied and nothing started, or with something started that
  then stopped. Do not report "nothing was changed on your server".

## Evidence to write back

1. A comment on **MAR-865** with the enrolment and deploy result, and one on
   **MAR-864** with the spike's answer.
2. `docs/mar-865-handoff.md`.
3. Everything the wizard asked that the design docs did not predict.

## Hard stop

When the host is enrolled, an agent is deployed, and the schedule question has
an answer: **stop.** Do not wire Discord, do not build the press routing, do
not place a key. Write the handoff and end the session.
