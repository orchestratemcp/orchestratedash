# Adoption and business

**Hypotheses, not findings.** Nobody has been interviewed, no pilot has run,
no price has been quoted or tested, and no message in this file has been sent.
Written 2026-09-07.

Grants are not product revenue. Nothing in this file counts a grant as income.

## 1. User hypotheses

Three, each written so that it can be proven wrong. A hypothesis that cannot
fail is a slogan.

### H1 — The independent professional who has to hand work over

**Who.** A consultant, analyst, bookkeeper, or freelance researcher who
already uses an AI assistant for recurring work and delivers the result to a
client who does not use the same tools.

**The claim.** They will run an agent for a recurring task if — and only if —
they can hand the client a result the client can check without taking their
word for it.

**Why it might be false.** Clients may not care. The relationship may already
carry the trust, making verifiability an answer to a question nobody asked.
This is the most likely way H1 dies, and the interview guide asks about it
first.

**Falsified if:** in interviews, fewer than half report ever being asked to
substantiate a delivered result, and none can recall a concrete instance.

### H2 — The small team that lost its history

**Who.** A two-to-ten person team that has moved between AI tools at least
once, or is on a platform they do not want to depend on.

**The claim.** The fear of losing accumulated agent work — history, results,
the configuration that finally worked — is a live constraint on their tool
choices, and an export they can verify reduces it.

**Why it might be false.** Lock-in may be tolerated as normal, or the history
may genuinely be worthless after a month. Letta's `.af` format already exists
(<https://github.com/letta-ai/agent-file>, read 2026-09-07) and may be
sufficient for anyone who cares.

**Falsified if:** teams report they have already switched tools without pain,
or cannot name anything from a previous tool they wish they still had.

### H3 — The person who wants an agent to spend a little, safely

**Who.** Someone who wants an agent to perform a small, recurring, paid or
on-chain action, and is unwilling to hand over a key to do it.

**The claim.** A bounded mandate, plus the ability to trace any action back to
the run and approval that caused it, is what moves them from "interesting" to
"switched on".

**Why it might be false.** The real blocker may be that they do not want an
agent to act at all, at any bound. Or the bounded-delegation wallets — Argent
sessions, Cartridge policies, `starkclaw` — may be enough on their own,
without the run correlation we think matters.

**Falsified if:** interviewees say they would not enable it at any limit, or
say a wallet-level limit alone would satisfy them.

## 2. Interview guide

Twelve to fifteen questions, thirty minutes, no demo in the first half.
Showing the product first turns an interview into a sales call and destroys
the data.

**Rules for whoever runs these:**

- Ask about the last time it actually happened, not about what they would
  generally do. "Tell me about the last time…" beats "would you…".
- Never describe the solution before the problem section is finished.
- Never ask "would you pay for this". Ask what they pay for today, and what
  the current workaround costs them in time.
- Write down the exact words they use for the problem. Those words belong in
  the product later.
- If they say something that contradicts a hypothesis, that is the valuable
  part of the transcript. Do not argue.

**Opening (5 min).** What is your work, and where does an AI assistant already
sit in it? What did you use it for last week?

**Problem — handover (10 min).**
1. When you deliver work that an AI helped produce, what do you hand over?
2. Has anyone ever asked you to show your working? What happened?
3. How do you keep track of what a past result was based on?
4. Have you ever had to defend or re-do a result because you could not show
   where it came from?

**Problem — history and tools (5 min).**
5. Have you switched AI tools? What came with you, and what did not?
6. Is there anything from an old tool you still wish you had?
7. What would stop you moving tools tomorrow?

**Problem — action and money (5 min).**
8. Is there anything you would like an agent to do that involves spending or
   an external action?
9. What stops you?
10. If it did act, what would you need to be able to check afterwards?

**Only now, the concept (5 min).** Describe the idea in two sentences without
naming a technology. Then:
11. What is unclear or wrong about that?
12. Who else in your world would want or hate it?
13. What is the smallest version that would be worth trying?

**Close.** What did I not ask about that matters? May I come back with a
working version? (Consent for follow-up is asked, never assumed.)

**Sample size.** Five to eight per hypothesis before drawing any conclusion.
Below five, we are reading noise.

## 3. Pilot setup

Run only after interviews, and only with people who described the problem in
their own words first.

**Shape.** Three to five participants. Four weeks. Each runs one real
recurring task of their own choosing — not a task we picked for them.

**Entry criteria.** Participant has a real recurring task; they can install a
desktop application; they have someone real to hand results to (for H1) or a
real action they want bounded (for H3).

**What we provide.** The installed product, one setup session, and a direct
channel for problems. No custom development per participant — that would make
the pilot a consulting engagement and teach us nothing about the product.

**What we ask for.** Permission to record which of the measures in section 5
occurred, and a thirty-minute conversation at the end. Nothing automatic,
nothing hidden.

**Success criteria, decided before the pilot starts:**

- At least half of the participants complete a first working agent without a
  support intervention.
- At least one participant hands a verified result to a third party who
  successfully verifies it independently.
- At least one participant continues using it after the pilot ends with no
  prompting from us.

**Explicit failure criteria** (so the pilot can fail rather than be narrated
into a success): nobody completes setup unaided; nobody produces a second run;
every verification is performed by us rather than by a recipient.

**What the pilot is not.** Not a reference customer programme, not a
testimonial harvest, not evidence for a grant application. A pilot in progress
is not traction, and this dossier will not describe it as one.

## 4. Revenue hypotheses

Untested. Each names how it would be tested, because an untested pricing idea
in a funding document is a liability.

| Hypothesis | The idea | How it would be tested | Risk |
|---|---|---|---|
| **Team sharing** | Value appears when more than one person needs the same agents, results and history | Do interviewees describe a second person who needs access? Does anyone ask for it unprompted? | The single-user product may be all anyone wants |
| **History and retention** | Keeping a searchable, verifiable record over time — the thing you need when someone asks six months later | Do participants go back to old runs? How far back? | Nobody may ever look back, making retention a cost, not a feature |
| **Administration** | Managing several agents, several hosts, schedules and permissions from one place | Do participants run more than two agents? Do they ask for oversight tooling? | May only bite at a scale our users never reach |
| **Support** | Paid help getting a first agent working, and keeping it working | Do participants ask for help, and would they have paid for it? | Support revenue does not scale and can hide a product defect |

**Pricing and willingness to pay are to be tested, not assumed.** No number
appears in this dossier. The order of operations is: interviews, then a pilot,
then a price conversation with people who have already used the thing — not a
pricing page written in advance.

**What is explicitly not revenue:** grants. A grant funds a piece of work
once. If the only money in the plan is grant money, there is no business, and
the application should say so rather than dress the grant as validation.

## 5. Measurement plan

Five measures, chosen because each can distinguish real use from our own
testing. All are targets and instrumentation ideas — **none of these is being
collected today.**

| Measure | Definition | Why it is honest |
|---|---|---|
| **Time to first working agent** | From first launch to a first run that produces an artifact the person keeps | Measures the thing that actually kills adoption. Hard to fake |
| **Export/import successes** | Completed exports, and completed imports **into a different installation** | The import side is the real test; an export nobody imports proves nothing |
| **Independent verifications** | Verifier runs performed by someone who is not the exporter, ideally on a machine without DASH | The core claim of stage 5. If this stays at zero, the pitch is wrong |
| **External adapter users** | Distinct users of the standalone verifier or adapter outside DASH | The ecosystem-contribution claim, measured rather than asserted |
| **Meaningful test transactions** | Bounded-mandate operations that a person actually approved, on a test network, excluding our own runs | "Meaningful" excludes our smoke tests, and excluding them is the whole point |

**Separating test traffic from use.** Our own machines, CI, capture harnesses
and demo recordings are tagged as test traffic at the source and are excluded
from every number above. A metric that includes our own testing is a metric
that flatters us into a bad decision. If separation is not possible for a
measure, that measure is reported as unknown rather than reported wrong.

**Collection rules, non-negotiable:**

- Local by default. Nothing leaves the user's machine unless the user says so.
- **No hidden analytics.** No telemetry beacon, no silent phone-home, no
  "anonymous usage statistics" enabled by default.
- Any collection is explicit, per-measure, revocable, and shows the person
  exactly what would be sent.
- Pilot participants are counted by hand, from conversations they consented
  to, not by instrumenting them.
- Nothing measured here is ever published as a customer story without that
  customer's explicit permission.

**Targets are targets.** If any number appears next to these measures in a
future application, it is a goal we set, not traction we have. Today every one
of them is zero, because none of the underlying features exists.

## 6. Draft outreach messages — **NOT SENT**

The four drafts below have **not been sent to anyone**, and this lane sent
nothing. They exist so Henrik has something to edit later, if and when he
decides to reach out. Each contains `[TO FILL — Henrik]` placeholders that
must be filled with true specifics before any of them is used.

**Before sending any of these, check:** every claim in the message maps to a
non-`planned` row in `evidence-index.md`, or the message says the word
"planned" out loud.

---

### Draft A — interview request to a professional contact

> Subject: 30 minutes on how you hand over AI-assisted work?
>
> Hi `[TO FILL — name]`,
>
> I'm building a desktop tool for running and supervising AI agents, and I'm
> trying to understand one specific thing before I build more of it: what
> happens when you hand work an AI helped you produce to someone who wasn't
> there.
>
> I'm not selling anything — there's nothing to buy. I'd like 30 minutes to
> ask about how you work today. If it turns out I'm solving a problem you
> don't have, that's the most useful answer I can get.
>
> `[TO FILL — Henrik: one true sentence about who you are]`
>
> Would `[TO FILL — two concrete time options]` work?
>
> Henrik

### Draft B — pilot invitation, after an interview

> Subject: Following up — would you try it on a real task?
>
> Hi `[TO FILL — name]`,
>
> Thanks for the conversation. What you said about `[TO FILL — their exact
> words about the problem]` is the part I keep coming back to.
>
> I'm putting together a small pilot: four weeks, three to five people, each
> running one real recurring task of your own choosing. I'd provide the
> software and one setup session; I'd ask for a 30-minute conversation at the
> end and your permission to note whether a handful of specific things
> happened. Nothing is collected without you seeing it.
>
> To be straight about the state of it: `[TO FILL — Henrik: what is genuinely
> working at the time of sending, and what is not]`.
>
> Interested?
>
> Henrik

### Draft C — ecosystem introduction (Walrus or Starknet community)

**Do not send this before deciding to apply, and not before the applicable
brief's blocking gaps are closed.**

> Hi,
>
> I'm working on a local-first desktop tool for running and supervising AI
> agents. I'm exploring `[TO FILL — Walrus: verifiable handover of agent work
> results / Starknet: bounded mandates for agent transactions]` and would
> rather learn what's already been tried than duplicate it.
>
> Two specific questions:
> 1. `[TO FILL — a real, specific technical question]`
> 2. Is there existing work here I should be building on instead?
>
> Happy to share what I've found so far — including where I concluded
> existing tools already cover it.
>
> Henrik

### Draft D — reply to someone who found the standalone verifier

> Hi,
>
> Thanks for trying it. To be clear about what it does and doesn't tell you:
> it checks that the files in the pack are byte-for-byte the ones that were
> exported, and whether the manifest digest matches. It does **not** tell you
> that the agent's conclusion is correct, and a signature only tells you a
> particular key signed it — not that the signer is who they claim, and not
> that the work is right.
>
> If the digest you're checking against came from the same place as the pack,
> it proves consistency and nothing more. `[TO FILL — Henrik: link to the
> section explaining how a trusted digest should reach a recipient]`
>
> What were you trying to verify? That's the useful part for me.
>
> Henrik

---

**Sent: none. This lane contacted nobody.**
