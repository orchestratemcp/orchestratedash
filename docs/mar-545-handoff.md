# MAR-545 — talk to your agent: what landed, and what is still unproven

Written at the end of the session that built it. Read `docs/adr/0012-talking-to-an-agent.md`
for the judgments; this is the shorter thing — what to run, what to look at, and
what nobody has checked yet.

## The journey, in one paragraph

Open an agent's page. Under the agent's own output there is a section called
**Ask about what it found**. Type "what have you found about tariffs?" and press
Ask. DASH searches every report that agent has saved for the words that
distinguish the question, sends the matching ones and the question to the model
the agent is set to use, and puts the answer on the page with the reports it was
built from listed underneath. Above the box, before anything is sent, it says how
much goes and what questions here have cost. Under the answer it says what this
one cost, and who said so.

## What to run

Everything except the two things nobody has run:

```powershell
pnpm state:check; pnpm typecheck; pnpm brand:check; pnpm test
```

The pictures, from PowerShell with a visible window (DASH may stay open):

```powershell
pnpm build:renderer
pnpm build:shell
$env:DASH_SHELL_URL='dash-app://ui/'
$env:DASH_DATA_DIR="$env:TEMP\dash-scratch-ask"
$env:DASH_CAPTURE_DIR='qa-screenshots-mar545'
pnpm exec electron dist/electron/capture-ask.mjs
```

Sixty frames and a `layout.json`. The harness fails loudly rather than writing a
short set: a density it could not reach throws, a manifest the store refuses
throws, and a frame that will not compose retries three times and then throws.

## The two things nobody has done

**1. No model provider has been contacted, and nobody has been charged.** This is
the big one and it is the same shape MAR-582 and MAR-583 left behind. Every
answer in the repository — in tests and in the sixty photographs — was written by
DASH's own code. The request bodies are asserted against what the three providers
document; that a real OpenRouter key answers one, and that `usage: {include:
true}` really comes back with `usage.cost`, is unobserved.

The attended run is short:

1. Connections → connect an OpenRouter key on an agent that declares one.
2. That agent's page → pick a model in **Choose which model this agent uses**.
3. Run the agent once so it has something saved.
4. Ask it a question, and read the cost line under the answer.

What to check while doing it: the amount under the answer is OpenRouter's own
figure and matches what the OpenRouter dashboard shows for that request; the
citation list is the reports the answer actually used; and the estimate above the
box changes after the first question, because it now has a past to quote.

**2. `pnpm verify:shell` did not run here.** Electron instances from the main
checkout and from a parallel MAR-590 worktree were live and AGENTS.md forbids
force-killing them. CI's Windows `shell-smoke` is the installed witness for this
branch — and note what it witnesses: nothing in the installed smoke asks a
question, so it says the change breaks nothing installed rather than that the
feature works.

## Where the interesting decisions live

| Question | File |
| --- | --- |
| Why is spending its own access kind? | `lib/broker/operations.ts`, `BrokerAccess` |
| Why can an agent not ask a question? | `lib/broker/execute.ts`, `BrokerOrigin` |
| Why is there no price table? | `lib/ai/ask.ts`, `AnswerCharge` |
| Why does the estimate show no money on a first question? | `lib/copy/ask.ts`, `describeEstimate` |
| Why does an agent on *match each step* get no chat? | `lib/views/ask.ts`, header |
| Why is an answer a `<p>` and nothing else? | `app/_components/ask.tsx`, header |
| Why are the question and the answer stored in full? | `lib/db.ts`, migration 18 |

## What the next session should know

**Do not relax the origin gate without a per-run budget.** MAR-582 named both,
this built one, and `needs_a_person` is the placeholder for the other. MAR-585
(the built-in coder) and MAR-588's inbound half both want an agent-ish thing to
cause a completion, and both should carry the budget rather than removing the
gate.

**MAR-588 inbound reuses this surface, and the origin is the hard part.** A
question arriving from a Discord channel *is* a person asking — but the origin
has to be established where the message is authenticated, not asserted by the
message. That is the whole trust boundary of that half.

**MAR-419's Chief rebuilds on this layer**, per the ratified plan. It needs a
fleet-wide selection where this has a per-agent one, and the same three
refusals: no provider, no key, no model named.

**The selection is deliberately simple and deliberately visible.** Distinct-term
matching over headline, summary, source and report title; newest first within a
score; capped at twelve items and 18,000 characters. It is predictable — the same
question selects the same reports tomorrow — and the sentence above each answer
says what it searched for, so somebody can see DASH heard them wrong. If it needs
to be better, the thing to preserve is that a person can tell what it did.

**Files in and reports out are unchanged.** They ride MAR-507's Inputs half and
MAR-434's Outputs half, which is what the issue asked for: the conversation is
the third leg, and the other two already existed. Nothing in this slice touches
`runner/`, the task workspace or the download route.
