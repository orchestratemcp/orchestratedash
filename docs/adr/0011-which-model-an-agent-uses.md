# ADR 0011: Which model an agent uses, and who says so

Status: Accepted

Date: 2026-08-10

Companion to `ADR-MAR-583` in the OrchestrateKIT-MCP repository, which decides
what the emitter writes. This decides what DASH does with it.

## Decision

Four things, and the fourth is the one that changed while this was being built.

1. **A level is what an agent's author declares; a model is what its owner
   chooses.** `planned_route[].default_model_level` is mirrored into DASH's v2
   schema as an optional, closed enum of `cheap` / `standard` / `frontier`, with
   a pure reader beside it. A person's choice is stored separately and never
   written back into the manifest.
2. **The recommended setting has no row.** An agent nobody has configured matches
   each step to the level its plan declared, and choosing that setting *back*
   deletes the row rather than writing the default into it.
3. **Which models a key can reach is never stored.** The ids reach the page that
   asked and live as long as it does.
4. **A run carries two different kinds of fact about its model, kept apart**:
   what DASH's own setting was when the run started, and what the run itself
   reported. Neither is DASH watching a model work, and every sentence says which
   one it is quoting.

## The problem this was written to avoid

Henrik, on MAR-583: *"We need to be able to chose model on every agent. (maybe
even different models for different steps) … The better we build the agents the
lesser/cheaper AI model we can use is this correct?"*

The answer is yes with a boundary, and the boundary is why the level is per
**step**: extraction and summarising run fine on small models, while planning and
code-writing degrade sharply below a capability floor. An agent-wide setting
would force one answer onto both kinds of step.

## Why a level and not a model name, in the contract

Model names age and belong to one provider. A manifest that pinned
`claude-opus-4` would be wrong within a year and meaningless to somebody using
OpenRouter. A level is a fact about the *agent* — how much reasoning this step
needs — and stays true when the catalogue changes underneath it.

DASH does **not** translate `model_tier` into a level for a manifest that
predates the emitter. That mapping is ADR-MAR-583's table and lives in the MCP;
a second copy here would be the one nobody updates. The consequence is stated
rather than hidden: an agent exported before that emitter gets no per-step
choice, DASH says so, and re-exporting is the fix.

## The catalogue is not DASH's to keep

`ai_key_checks` records a count and never a list, because which models a key can
reach is the provider's own content under ADR 0002 invariant 7. That constraint
survives this issue intact.

So the picker's list is fetched when a person presses a button that says what it
will do, travels back through the command result, and lives in the page's state.
`classifyProbe` drops the ids on the floor, `tests/model-choice.test.ts` searches
the whole store file for them, and no column anywhere can hold one.

The cost is a button, and it is paid deliberately: a page that loaded the
catalogue on mount would contact a third party every five seconds while a run was
going, because that page polls.

## The run row, and the field nobody had read

This is the part that changed during implementation and is recorded as a
correction rather than as a plan.

The issue asked for *"the chosen model recorded on every run row"*. DASH makes no
completion call — MAR-582's boundary is one models-list operation per provider —
so the first design recorded only DASH's own setting at the moment it first saw
the run, worded as a setting rather than as an observation.

Then a test fixture failed against the event schema and showed that **telemetry
v1 has carried `model` on every run event since the contract was frozen, and
nothing in DASH had ever drawn it**. That is the better answer to "which model
ran" — it comes from inside the process that ran it — and it is still the agent's
claim rather than something DASH witnessed.

So a run carries both, in ADR 0005's shape:

| fact | source | kind |
| --- | --- | --- |
| `run_models` row | DASH's own clock, at first sight of the run | something DASH did |
| `events[].model` | the agent's own report | something DASH was told |

The row is written once and never revised, so changing an agent's model halfway
through a run cannot change what that run reports it started under. The report
wins on the label because it answers the question actually asked; the detail
names its source either way; and when the two disagree that is reported rather
than resolved, because a run that used a model DASH was not set to give it is
exactly the interesting case.

**`cost_usd` sits on the same frozen event and is deliberately still unread.**
MAR-299 owns spend and needs an answer to *whose number is this* before any
surface repeats one. There is no cost column in any of the three tables this
issue adds, and `tests/model-choice.test.ts` asserts over the source that nothing
reads the field. Drawing a figure because it happened to be adjacent to a field
this issue needed is exactly how an unexamined number reaches a screen.

## The deploy refusal

The choice travels to a server as a generated `data/models/{agent}.json`, beside
the generated registration and never inside `agent/` — that directory is the
author's folder byte-for-byte, and MAR-584 compares what DASH sent against what
DASH holds by hashing exactly those paths.

A bundle is **refused outright** when the agent's plan needs a model *and* the
agent asks DASH to hold the key for it. DASH does not send keys to servers, so
the copy it would put there would arrive with a model named and nothing to reach
it with, and a setting that arrives where it cannot be honoured is worse than no
setting.

What the refusal checks is the shape of the arrangement and not the vault's
current contents. A deploy that succeeded or failed depending on whether somebody
had connected yet would be a rule nobody could predict.

An agent that manages its own model key is not refused. It reaches a provider by
arrangements DASH has no part in, wherever it runs.

**The general case is not fixed here and is not quietly half-fixed.** A
`dash_managed` connection of any kind on an agent going to a server has the same
problem, and MAR-556 does not refuse it. Making the model choice travel is what
created the obligation to say something about the model key; inventing a rule for
Gmail on the way past would be a decision taken in the wrong issue.

## What this does not do

No completion call, no streaming, no embedding. MAR-582's recorded boundary
stands: an agent holding one of these connections can find out what it could use
and cannot spend a penny of the account behind it. Choosing a model is now
possible and nothing in DASH yet sends a prompt to one.

Nothing reads the deployed `data/models` file. There are **zero changes under
`runner/`**, on MAR-556's terms, so the standalone runner ignores it. The choice
being present where the agent runs is what this slice delivers; a runtime that
resolves it is a later one, and it needs the cost story too.

## Alternatives rejected

- **One model for the whole agent, with no per-step levels.** Rejected for the
  reason the issue exists: cheap extraction and frontier planning in one agent is
  the ordinary case, and one setting forces the expensive answer onto both.
- **A dropdown of levels only, with no model names.** Rejected because Henrik
  asked to choose a model and because a level cannot be resolved to a model
  without a ranking DASH would have to invent over somebody else's catalogue.
- **Caching the models list.** Rejected: see above. The button is cheaper than
  the record.
- **Storing today's setting for a run DASH has no row for.** Rejected — it would
  be a claim about the past made out of the present. Such a run says nothing.
- **Refusing every `dash_managed` connection at deploy.** Rejected as out of
  scope; recorded above as an open question rather than taken silently.
