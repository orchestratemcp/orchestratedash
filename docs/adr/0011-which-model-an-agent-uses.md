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

## Amendment 1 (MAR-654): a person may map a level to a model, and DASH still maps none

Status: Proposed

Date: 2026-08-16

Issue: MAR-654, re-scoped from a defect report to a request to reopen decision 1
after Henrik asked for it directly. Testing the competitor scout's plan panel on
2026-08-16: *"Also can't choose model for different steps. It's greyed out."*

### What the greyed control actually is

Not a bug and not an unfinished surface. `app/_components/model-choice.tsx` draws
a **level** select per step, and it is disabled exactly when a named model is in
force, because a pinned model sets the levels aside; MAR-664's About panel draws
each step's declared strength with no control at all, and says so in a sentence.
Both are decision 1 rendered honestly: *a level is what an agent's author
declares; a model is what its owner chooses*, and nothing in this repository
turns the first into the second.

So the thing Henrik is asking for is the mapping this ADR declined to keep. This
amendment reopens that and does not overturn it.

### The distinction the original decision actually rests on

Read the rejected alternative again, because it names its own exit:

> **A dropdown of levels only, with no model names.** Rejected because Henrik
> asked to choose a model and because a level cannot be resolved to a model
> without a ranking DASH would have to invent over somebody else's catalogue.

The refusal is of **a ranking DASH invents**, not of the existence of a mapping.
The second paragraph of "Why a level and not a model name" refuses a *second copy
of the emitter's table*, which is a fact about `model_tier` living in the MCP. A
table whose every row was written by the person, out of a catalogue their own key
returned, is neither of those things: DASH ranks nothing, ships nothing, and
seeds nothing.

That is the whole amendment, and it keeps both halves of decision 1 intact. The
author still declares how hard the step is. The person still decides what answers
it. What is new is only that they can now answer it three times instead of once.

### Decision A1.1 — the map is the person's, fleet-wide, three rows per provider

One new table, and its shape carries the argument:

```sql
CREATE TABLE IF NOT EXISTS fleet_level_models (
  provider_id TEXT NOT NULL,          -- 'openrouter' | 'anthropic' | 'openai'
  level       TEXT NOT NULL,          -- 'cheap' | 'standard' | 'frontier'
  model_id    TEXT NOT NULL,
  chosen_at   TEXT NOT NULL,
  PRIMARY KEY (provider_id, level)
);
```

**Keyed by provider**, for `applyFleetDefault` rule 2's established reason: a
model id means nothing without one, and `moonshotai/kimi-k2` presented to
Anthropic would be DASH asking a provider for something it never offered.

**Fleet-wide and not per agent**, which is the load-bearing choice. The level
vocabulary is fleet-wide by construction — `cheap` means the same thing in every
manifest DASH holds, because the emitter writes it against one closed set — so a
per-agent copy would be N copies of one answer. The per-agent escape already
exists and already wins: an agent that must run its standard steps on something
else gets **pinned**, with the control that has been on its Settings stage since
MAR-583. A per-agent level map would be a fourth place a model is decided and a
fourth thing to keep in step with `applyFleetDefault` — ADR 0023's own argument
for the chief not getting a selector of its own, applied one surface along.

**Zero rows ship and none is ever seeded.** Absence is the recommended state,
decision 2's rule, and clearing a level deletes its row rather than writing a
sentinel, `clearFleetModelDefault`'s rule. The consequence is worth stating
plainly because it is what makes this amendment safe to land: **no existing DASH
changes behaviour until a person writes a row.**

### Decision A1.2 — one ladder, checked per step, and every rung names itself

`applyFleetDefault` becomes a per-step resolver in the same module, so the six
places that read a model cannot each have their own idea of precedence. Four
rules, in order, per step:

1. **The agent's own pin wins.** `one_model`, every step, unchanged and still
   first so it cannot be reached around. This is MAR-642's half that Henrik
   stated twice.
2. **The level row for (this agent's provider, this step's resolved level).**
   New. The level is `resolveModelSteps`' answer, so a person's `agent_step_levels`
   override participates exactly as it does today.
3. **The fleet default**, when it is the same provider. MAR-642, unchanged.
4. **Nothing** — `no_model_chosen`, unchanged.

Rule 2 sits above rule 3 because it is the more specific statement about this
step, and rule 3 describes itself as the whole-agent answer (*"the model new
agents use… unless an agent says otherwise"*).

**A gap is filled by the default and is never silent.** A person who maps only
`frontier` gets their frontier steps on that model and everything else on the
default they already chose — which is what they meant, and the alternative
(refusing a level with no row) would break the fresh-agent guarantee MAR-642 was
built for. What makes it not-silent is that provenance becomes a **value** rather
than a comment: every resolution carries `resolved_by: "agent_pin" | "level_map"
| "fleet_default" | "none"`, it is what the level rows, the in-force sentence and
the run receipt are worded from, and `EffectiveModelChoice.from_default` — a
boolean that can only express two of the four — is replaced by it.

`no_model_chosen` stays the honest end of the ladder and is now reachable per
step: a plan declaring `frontier`, no row for it and no default, is an agent
whose synthesis step cannot spend, said in those words, on that step's own row.

### Decision A1.3 — `match_each_step` becomes true

Today it is the default state, the state every fresh agent sits in, and the one
state under which an agent cannot spend at all: `readModelChoice` returns null
for it and every agent-origin spend is refused. The name promises per-step
matching and the behaviour delivers a refusal.

After this it means what it says: **resolve each step through the ladder above.**
No new member joins `AgentModelChoice`; the existing one stops being a dead end.
The behaviour a person sees on upgrade is unchanged in every state that exists
today —

| state | before | after |
| --- | --- | --- |
| pinned model | that model, every step | unchanged |
| `match_each_step`, default set, empty map | the default, every step | unchanged |
| `match_each_step`, no default, empty map | `no_model_chosen` | unchanged |
| `match_each_step`, default set, some levels mapped | — | mapped levels use their model; the rest use the default |

— because the fourth row is the only new one and it requires somebody to have
written a row.

### Decision A1.4 — the broker asks about a step, and the step is read from the manifest

`BrokerDeps.readModelChoice?(agentId)` becomes `readModelChoice?(agentId, step:
number | null)`. A null step resolves exactly as today, which is what keeps the
chat path (`electron/ask-host.ts`, answering from saved reports — *not one of its
steps*) unchanged.

The agent names the step in its request. **It does not name the level and it
cannot name a model**, and the difference is the whole safety argument:
`lib/broker/execute.ts` goes on overwriting `model` before `planCall` sees it,
and the level comes from the manifest DASH imported joined to the person's own
overrides — never from anything the request carried. A `step` that is absent,
unknown to the manifest, or declares no level resolves as null: pin, then default,
then refusal.

**This is a widening and it is stated rather than designed around.** Today an
agent-origin spend can reach exactly one model. After this it can reach up to
three. What bounds it:

- every one of the three was written by the person, out of their own catalogue;
- an agent can only reach levels **its own plan declares**, so its ceiling is the
  strongest level its author asked for — which is exactly what an author writing
  `frontier` is already asking the person to pay for;
- ADR 0016's run allowance (two calls, ten minutes, both pinned) is untouched, and
  so is the origin gate;
- and it is visible after the fact: A1.5 records which step DASH resolved under,
  so an agent that claimed its synthesis step while doing cheap work leaves a row
  a person can read.

The alternative — DASH inferring the step from the operation — does not work: two
steps of one plan can both be `{provider}.chat.completion`, and `digest_curate`
and `deep_dive_synthesis` are exactly that pair.

### Decision A1.5 — the run record freezes the resolution, and the two facts stay apart

Decision 4's table survives whole. What changes is that the left column stops
being one model.

`run_models` keeps its columns and its rule — written once at first sight of the
run, never revised. `choice` takes a third value, `matched`, with `provider_id`
set and `model_id` NULL, because "the setting was a table" is not a model id and
must not be squeezed into a column shaped for one. Beside it:

```sql
CREATE TABLE IF NOT EXISTS run_step_models (
  agent       TEXT NOT NULL,
  run_id      TEXT NOT NULL,
  step        INTEGER NOT NULL,
  level       TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id    TEXT NOT NULL,
  resolved_by TEXT NOT NULL,
  PRIMARY KEY (agent, run_id, step)
);
```

Written in the same transaction as the `run_models` row, so a run has both or
neither. **Keyed by step rather than by level**, for the reason the deploy bundle
freezes levels rather than re-reading them: a person's per-step overrides
participate in the resolution and the manifest does not know about them, and a
plan re-imported next week may have different steps.

**The two facts do not disagree, because they are still two facts.**
`RunModelStanding` keeps `setting` and `reported` apart exactly as decision 4
requires; what widens is that `setting` is now a set of models rather than one.
`describeRunModel`'s `"N models"` branch — written for the reported side and, as
MAR-654 observed, with nothing to draw — becomes reachable from both. The
disagreement branch generalises from an equality to a comparison:

- **Per step, where the run says which step.** Telemetry v1 events carry
  `component_id` (*"planned_route id when the step maps to one"*) and `model`.
  Joining that id back through the same `planned_route` DASH imported gives, for
  each step, what DASH handed out and what the run says it used.
- **As sets, otherwise.** A model reported that DASH resolved for no step is the
  interesting case, and it is reported rather than resolved — decision 4's rule,
  unchanged.

`cost_usd` stays where MAR-545 left it: read on the ask path, attributed to the
agent that reported it, and not folded into either of these types.

### Decision A1.6 — what the greyed control becomes

**Three pickers on the AI tab, not three per agent.** Beside the fleet default
(MAR-642's dropdown), one row per level — *Small and cheap*, *Balanced*, *The
best available* — each with `levelMeaning`'s sentence, each populated by the same
*See what {provider} offers* button that exists today. The catalogue is still
asked for and still never stored: this amendment adds no place a model list could
be kept, and `tests/model-choice.test.ts`' search of the whole store file for
provider ids goes on passing.

Each row has three honest states, worded in `lib/ai/model-choice.ts` on that
module's rule that every sentence comes from the trusted side:

| the row says | when |
| --- | --- |
| the model id | a row exists |
| *No model chosen. Steps that ask for this use `{default}`, DASH's default model.* | no row, default set |
| *No model chosen, and no default either. A step that asks for this cannot run.* | no row, no default |

**On the agent's own page the control stops being greyed** — because the thing
that greyed it was a pinned model setting the levels aside, and an agent on
`match_each_step` now has live levels that decide something. Each step's row
gains one line under its declared strength: the model that level resolves to
right now, with `resolved_by` said in words, and a link to the AI tab. That link
is the answer to *unfindable is the same as missing*: the picker is one place,
and every step that depends on it says where it is.

ADR 0008 is untouched. Every control named here is on the AI tab or the agent's
Settings stage; nothing is added to the author's declarative panel, and MAR-664's
About panel keeps drawing declared strengths with no control — it gains only the
resolved model as a sentence, which is the same kind of read-only disclosure
amendment 1 of ADR 0008 already admits.

### The scout, worked through

`digest_curate` (step 3) declares `cheap`; `deep_dive_synthesis` (step 4)
declares `standard`. The agent is unpinned, its provider is OpenRouter, the
fleet default is `meta-llama/llama-3.3-70b-instruct:free` — the model MAR-654's
evidence shows answering both steps — and the person has mapped `standard` on
the AI tab and left the other two rows empty.

| step | declared | rule that answers | model | `resolved_by` |
| --- | --- | --- | --- | --- |
| 3 `digest_curate` | cheap | 3 — fleet default | `meta-llama/llama-3.3-70b-instruct:free` | `fleet_default` |
| 4 `deep_dive_synthesis` | standard | 2 — level map | the model they mapped | `level_map` |

Two agent-origin spends in one run, each overwritten with the resolution for its
own step. `run_models` records `matched`; `run_step_models` records both rows.
The run page reports **2 models** on the setting side for the first time, and
compares them against what the run's own `step_completed` events said, per step,
by `component_id`.

The before and after in one sentence: the same run reported one model for both
steps, and after this the extraction step keeps the free model while the
synthesis step gets the one its author said that step needs.

### What this costs

- **A widening of what an agent-origin spend can reach**, from one model to
  three. Bounded and recorded as A1.4 states; not eliminated.
- **A fourth thing to keep in step with the precedence rule.** Mitigated the way
  the module already mitigates it — one pure function, six callers, no second
  opinion — and not pretended away.
- **Two new tables and one changed column value.** `run_models.choice` gains a
  third member, so every reader of that column needs the branch; a row written
  before this amendment reads exactly as it does today.
- **The migration index is not decidable yet.** Master is at `user_version` 25
  and PR #203 (MAR-643) carries a migration 24 that renumbers on merge. These
  tables take the next free index **after** that PR lands, which is the sequencing
  MAR-654 already carries and the reason this amendment is written before
  anything is built.

### What is unchanged

The catalogue is still never stored. The deploy refusal still fires on shape
rather than on the vault's contents — a bundle that needs a model and asks DASH
to hold the key is refused outright, now with three names it could not reach
instead of one, and `BundledModelChoice` gains `level_models` frozen at bundle
time for the same reason its `steps` are frozen. Nothing under `runner/` changes.
The chat is untouched. The chief has no plan and therefore no steps, so ADR 0023
decision 4's invariant holds verbatim: it asks under the fleet default and has no
picker of its own. DASH still makes no completion call and still never claims to
have watched a model work.

### Alternatives rejected

- **DASH ships a level→model table.** The thing decision 1 refuses. It would be
  DASH ranking somebody else's catalogue, it would be wrong within a year, and it
  would be wrong differently for each provider.
- **A per-agent level map.** Rejected as N copies of a fleet-wide vocabulary and
  a fourth precedence rung, when the per-agent escape — pinning — already exists,
  already wins, and is already understood.
- **The agent names its own level, or its own model.** Rejected: naming a level
  is naming a model one indirection away, and `lib/broker/execute.ts`' own note
  ("an agent that could name its own model would be an agent that could name an
  expensive one") reaches it. The step is named by the agent and *resolved*
  against DASH's copy of the manifest, which is the narrowest thing that works.
- **Refuse a level with no row, always.** Rejected: it would take a freshly
  imported agent back to the state MAR-642 was built to end, and it is not needed
  to keep the fallback honest — `resolved_by` does that.
- **All-or-nothing: per-step matching only once every declared level is mapped.**
  Rejected as a rule nobody could predict — a person's first mapped row would do
  nothing, for reasons visible only in this document, which is the failure the
  deploy refusal section already names.
- **Resolving every spend at the plan's strongest declared level.** Safe and
  pointless: it is the expensive answer forced onto both kinds of step, which is
  the problem this ADR exists to solve.

### What is proven

**Nothing.** No code has been written against this amendment. It proposes two
tables, one signature change on `BrokerDeps`, a rewrite of `applyFleetDefault`
into a per-step resolver, three pickers and a per-step sentence, and none of it
has been typechecked or run.

Provable once built:

- the ladder, as a pure test over the four rules and the four `resolved_by`
  values, including the negative — an agent whose plan declares no level for a
  step cannot reach a level row;
- that a lying `step` reaches only a model the person mapped for a level that
  agent's own plan declares, in `tests/broker-threat-model.test.ts`' shape;
- one real charged run of the competitor scout in which two steps report two
  different models, against a real key, attended — which is the only thing that
  would actually close MAR-654;
- the AI tab's three rows in all three states, and the agent page's per-step
  sentence, by capture.
