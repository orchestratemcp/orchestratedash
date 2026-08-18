# MAR-689: why the sample agent's output is a roundup and not a newsletter

Research session, 2026-08-17. Worktree `../dash-mar689` on
`000henrik/mar-689-mcp-research`, cut from master `430369d`. **No product code
was changed.** This document is the anchor for the MCP work Henrik sequenced as
step 2 ("make sure the MCP knows DASH in and out").

Read for this: `AGENTS.md`, `PROJECT_STATE.md`, Linear MAR-689 / MAR-671 /
MAR-670 / MAR-668 / MAR-667 / MAR-647, the competitor scout's manifest and
`agent.mjs`, DASH's broker operations, artifact contract and digest renderer,
`agent-kit/template/agent.mjs`, and — on the other side of the seam —
`orchestratekit-mcp`'s component registry, `dashBrokerCatalog.ts`,
`observabilityContract.ts`, `exportBuildBrief.ts` and its pinned DASH fixtures.
One live `plan_workflow` call was made against the running MCP with the scout's
own goal string, verbatim, and its output is quoted below.

---

## The verdict in four sentences

**The gap is DASH's, and it is structural rather than a matter of prompt
quality.** DASH has no broker operation that writes a document, no field in the
run-artifact contract that could carry one, and no renderer that would draw one —
so no plan, however well authored, can produce a newsletter today. The scout's
plan is *not* the cause, and it was *not* built by the MCP: its provenance is
DASH's own `create-dash-agent` scaffold plus hand-writing, which means the run
Henrik read is the **best case** — an expert-authored agent — and it still
produced a roundup. The MCP is a separate and larger problem that MAR-689's
premise understates: an agent the MCP authored today could not make a model call
at all, because the capability ids it emits do not exist in DASH's broker.

So: **both**, but not equally, and not in the order the issue assumes. DASH is
the blocker. The MCP is broken *behind* the blocker, and fixing the MCP first
would produce agents that fail earlier and more confusingly.

---

## 1. Where synthesis should happen, traced

### 1.1 What the plan actually asks for

`competitor-scout/agent.manifest.json:12-51` declares six steps:

| Step | `component_id` | `model_tier` | `default_model_level` |
| --- | --- | --- | --- |
| 1 | `public_source_fetch` | none | — |
| 2 | `signal_sort` | none | — |
| 3 | `digest_curate` | small | cheap |
| 4 | `deep_dive_synthesis` | standard | standard |
| 5 | `competitor_choice` | none | — |
| 6 | `report_file_write` | none | — |

Exactly one step in this plan is capable of producing prose: step 4,
`deep_dive_synthesis`. It is scoped to **one competitor chosen in a previous
run** (`agent.mjs:1090-1101`), so on a first run it does nothing — that is
MAR-667, and it is by design, not a defect in the step.

Step 3, `digest_curate`, is the step that runs on every run. **It cannot produce
prose, because the operation it calls does not return any.** More on that in §1.3.

So the honest answer to "does the plan even ask for synthesis?" is: **it asks
for grouping every run and for synthesis only about one competitor, only on the
second run onward, and never for a document.** No step in this plan has "write
the briefing" as its job. Step 6 is a *file write*, not a compose — it renders
whatever the earlier steps already produced (`agent.mjs:1515-1627`).

### 1.2 What the agent does with what comes back

`runOnce` (`agent.mjs:183-327`) builds one `briefing` object
(`agent.mjs:224-243`) holding `items`, `sources_fetched`, `set_aside` and three
counters, then attaches `briefing.curation` (step 3) and `briefing.deep_dive`
(step 4) and hands the whole thing to DASH via `emitArtifact`
(`agent.mjs:1857-1869`), which spreads it into `{kind: "digest", ...briefing}`.

`briefing.deep_dive.text` — **the only prose the agent ever holds** — is
rendered in exactly one place: `renderReportFile`
(`agent.mjs:1527-1538`), the saved markdown file, which sits behind the
high-risk approval gate at step 6.

It is rendered **nowhere in DASH**. `deep_dive` does not appear in
`contracts/run-artifact.schema.json`, is not a member of `DigestArtifact`
(`lib/contracts.ts:675-687`), and is not referenced anywhere in `lib/`, `app/`
or `contracts/`. The artifact schema leaves `additionalProperties` open, so the
field travels intact and is stored — and then no component draws it.

**This is the single sharpest finding of the session.** The agent's one
document-shaped output reaches DASH and is silently discarded by the renderer.
A person who declines the file-save gate — which the manifest itself tells them
costs nothing, because "the same briefing is already on this page as an output
you can read" (`agent.manifest.json:190`) — never sees the deep dive at all.
That sentence is false whenever a deep dive was written.

### 1.3 What `digest_curate` can and cannot return

`digest_curate` maps to the broker operation `<provider>.digest.curate`
(`lib/broker/operations.ts:1619-1709`). DASH owns both halves of it:

- **The prompt is DASH's**, not the agent's. `CURATE_SYSTEM_PROMPT`
  (`lib/broker/operations.ts:1394-1410`) says *"You group and summarise news
  items… Answer in exactly this format and nothing else: OVERVIEW / GROUP /
  SUMMARY / ITEMS"*. The agent's request carries only `material` and
  `max_output_tokens` (`agent.mjs:1040-1043`). **There is no field on this
  operation an author could use to ask for anything else.**
- **The projection is DASH's.** `readCuration` returns
  `{overview, groups: [{label, summary, items: number[]}]}`
  (`operations.ts:1498-1554`), bounded at `MAX_OVERVIEW = 600`,
  `MAX_GROUP_LABEL = 80`, `MAX_GROUP_SUMMARY = 400`, `MAX_GROUPS = 12`
  (`operations.ts:1422-1427`).

So the **entire model contribution DASH can show for a curated digest is capped
at 600 + 12 × (80 + 400) ≈ 6.4 KB of text, and it is structurally a set of
labels over a list.** It is a table of contents, by construction. It cannot be a
newsletter, because the operation has no field in which a newsletter could
return.

The item bodies MAR-670 added are the other half. `MAX_ITEM_TEXT_CHARS = 700`
(`agent.mjs:118`), and the artifact schema allows `items[].summary` up to 1000
characters. A twenty-item digest therefore carries up to ~14 KB of *source*
text under ~6 KB of *model* text. **MAR-670's fix made the curation better and
the page longer at the same time.** Henrik's "the curation is a thin layer over
a data dump" is a precise reading of that ratio, not an impression.

### 1.4 What the renderer does

`DigestBody` (`app/_components/digest.tsx:115-186`) draws, in order:

1. any source-gap notice;
2. `Curation` — the `overview` paragraph under the heading `CURATED_HEADING`,
   which is literally **"What this adds up to"** (`lib/copy/curation.ts:62`) —
   Henrik's "opener";
3. for each group: the label, its one-sentence summary, and **every item in that
   group rendered in full** through `DigestItem` (`digest.tsx:323-344`);
4. `CURATED_REMAINDER_HEADING` — "Everything else it found" — and **every
   remaining item rendered in full** (`digest.tsx:167-179`);
5. the collapsed source list.

There is no cap, no fold, no "top five", no read-more, at any point.
`artifact.items.map` is unsliced in both loops. The `report` panel section that
the scout declares (`agent.manifest.json:209-213`) draws this card uncollapsed
(`app/_components/panel.tsx:215-226`).

**The renderer is behaving exactly as designed, and the design is "show
everything".** That is the correct design for a digest whose whole safety
argument is that nothing collected is hidden (`digest.tsx:24-31`: *"the tempting
rendering drops an item with no source, so the digest looks clean. That is
precisely how a grounded verdict becomes theatre"*). It is the wrong design for
something a person reads like a newsletter, and the two wants have never been
reconciled.

### 1.5 The one operation that returns prose, and why it still cannot help

`<provider>.chat.completion` (`operations.ts:1218-1366`) does return free text —
and its DASH-owned system prompt, `ASK_SYSTEM_PROMPT`
(`operations.ts:1020-1028`), ends:

> *"Write plain sentences for a reader who is not technical. **Do not use
> markdown, headings, bullet characters or links.**"*

and opens by framing the model as answering *"questions about material that one
automated agent has already collected and saved"*.

So DASH's only prose operation is a **Q&A frame that explicitly forbids the
structure a briefing is made of.** Even if the artifact contract had a field for
prose and the renderer drew it, what came back would be one undifferentiated
block of plain sentences.

### 1.6 Where synthesis *should* happen

Between step 3 and step 6 there is a missing step: **compose the document**. It
would need three things that do not exist:

1. a broker operation whose prompt asks for a written briefing and whose
   projection returns structured prose bound to collected items by index (the
   citation-integrity property `readCuration` and `readGroups` already
   establish, extended to a body rather than a label);
2. a field in `contracts/run-artifact.schema.json` to carry it — or a third
   `kind` beside `digest` and `draft` (`run-artifact.schema.json:41-44`);
3. a renderer that leads with it and demotes the item list to evidence a reader
   can open.

---

## 2. Plan, renderer, or MCP spec? — the verdict

### It is not the plan

The plan is the *only* one of the three that is doing its job. It declares a
curation step at `cheap` and a synthesis step at `standard`, gates its one
write, and declares the three broker operations it actually calls with the
correct access classes — including `access: "spend"` on both paid ones
(`agent.manifest.json:124-139`), which is the class DASH added for exactly this
(`agent.manifest.v2.schema.json:577-581`).

What the plan cannot do is ask for an output shape DASH does not have. Rewriting
`planned_route` changes nothing: `component_id` is
`{"type": "string", "minLength": 1}` (`agent.manifest.v2.schema.json:30`) with
no vocabulary anywhere. **DASH never resolves a `component_id` to behaviour.**
`lib/agent-plan.ts` renders the declaration truthfully and says so in its own
docblock; `lib/analyze.ts:80-122` compares planned ids against executed ids as
opaque strings. A plan step is a *promise a person can read*, not a contract the
runner honours. Declaring a step called `newsletter_compose` would produce a
correctly-rendered plan row and no behaviour whatsoever.

### It is not (mainly) the renderer

The renderer draws faithfully what the artifact carries, and the artifact
carries a list plus twelve labels. Changing `digest.tsx` alone can improve the
*reading* — fold the remainder, lead with the overview, cap what is expanded —
and MAR-668's landed fix (`a6a430e`, `panel.tsx:186-200`) has already stopped
the same body being drawn twice. But no renderer change can make a newsletter
out of an artifact that contains no newsletter. The one renderer defect that is
squarely a bug is §1.2: **`deep_dive.text` arrives and is dropped.**

### It is not the MCP spec, because there was no MCP spec

MAR-689 says the scout's plan was "built by an LLM from an MCP-produced spec".
**The provenance says otherwise, and this matters more than any other single
fact in this document:**

```json
"provenance": {
  "generated_by": "create-dash-agent 0.1.1, then written by hand for MAR-647",
  "registry_fingerprint": "agent-kit-template"
}
"plan_source": "composed", "playbook_id": "", "route_id": ""
```

`create-dash-agent` is **DASH's own** `agent-kit/package.json`, not the MCP.
`registry_fingerprint: "agent-kit-template"` is a placeholder string, not an MCP
registry fingerprint. `playbook_id` and `route_id` are empty. The MCP was not in
the loop.

The consequence is that the run Henrik read is **not** a test of "MCP plans it →
LLM builds it → DASH runs it". It is a test of the pipeline's ceiling with the
MCP removed and an expert in its place — and the ceiling is a roundup. That is a
better result for the investigation than the issue's own framing: it isolates
DASH as the binding constraint with the MCP held constant at "perfect".

### Verdict

**The gap is in DASH, in three places, in this order of importance:**

1. **The broker operation vocabulary.** `digest.curate` returns labels;
   `chat.completion` returns link-free, heading-free plain sentences. Neither
   can write a document. `lib/broker/operations.ts:1844-1850` freezes the whole
   set at twelve operations (3 Gmail + 3 per AI provider × 3 providers) and
   adding one is deliberately "a card sentence, a scope list, a request shape
   and a projection".
2. **The run-artifact contract.** `kind` admits `digest | draft`. A digest is
   `items[]` + optional `curation{}`. There is no member in which a written
   briefing could live, which is why the scout's own deep dive falls on the
   floor.
3. **The renderer's exhaustiveness.** Correct for evidence, wrong for reading,
   and never reconciled.

**The MCP is broken too, but behind that wall** — see §3. Fixing the MCP first
would make agents that fail sooner.

---

## 3. What the MCP would need to know about DASH

Everything in this section was read in `orchestratekit-mcp` at `0b37cdf`, plus
one live `plan_workflow` call against the running server (build fingerprint
`31e523463620471d`, built 2026-08-07, `safe_to_demo: true`).

### 3.1 What it knows today

`src/lib/dashBrokerCatalog.ts` is, by its own docblock, *"the one place in the
MCP that holds DASH-side vocabulary"*. It holds:

- two Gmail/Calendar provider spellings;
- `DASH_BROKERED_CONNECTIONS = new Set(["gmail"])`;
- `AI_PROVIDER_IDS = ["openrouter", "anthropic", "openai"]`.

It also mirrors DASH's manifest v2 schema, the run-event schema, `contract.lock`
and the ADR 0008 panel vocabulary (`observabilityContract.ts:140-263`) — and
those are genuinely good: the panel section enum, `artifact_role`,
`dash_fact` and the additive `panel_version` split all travel correctly.

### 3.2 What it does not know, with the damage each causes

**a) The broker's operation catalogue.**
`tests/fixtures/dash/broker-profiles.json` is described as *"a semantic copy of
the REAL broker profiles and operations"* and lists **three** operations, all
Gmail. DASH master has **twelve**. It is pinned at DASH commit `9d42447`
(2026-08-06) — **598 commits behind `origin/master`.** The three operations the
scout actually uses — `openrouter.models.list`, `openrouter.digest.curate`,
`openrouter.chat.completion` — are invisible to the MCP.

**b) Consequence: an MCP-authored agent cannot make a model call.**
`observabilityContract.ts:688-692` emits the AI connection's capabilities as:

```ts
capabilities: aiSteps.map((step) => ({
  id: stableId(`${providerId}.${step.component_id}`, providerId),
  label: step.purpose || step.component_name || step.component_id,
  access: "read" as const,
})),
```

For the plan the MCP actually returns for Henrik's goal (§3.3), that is
`openrouter.research_synthesis`. DASH resolves an agent's broker request with
`operationById(request.operation)` and returns `no("unknown_operation")` when it
misses (`lib/broker/execute.ts:613-619`). **Every model step of an
MCP-authored agent is refused before it reaches a provider.** This is a
categorical failure, not a quality one, and it is invisible to both repos'
test suites because neither has the other's operation list.

**c) `access: "spend"` does not exist in the MCP.**
DASH's manifest v2 schema has admitted `["read", "write", "spend"]` since
MAR-619 (`agent.manifest.v2.schema.json:577-581`). The MCP's pinned copy of that
schema still says `["read", "write"]`
(`tests/fixtures/dash/agent.manifest.v2.schema.json:1097-1101`), pinned at DASH
`04dc346` (2026-08-10) — **323 commits behind.** And the emitter has no `spend`
branch at all: `exportBuildBrief.ts:2816` computes
`component.permissions.write.length > 0 ? "write" : "read"`. Since
`research_synthesis.component.yaml` declares no writes, a frontier LLM step that
charges the user's account is emitted as **`read`**. DASH's own schema comment
warns that filing a spend under `write` "would make a card claim something turns
up in an account"; filing it under `read` is worse — it claims nothing is
charged.

**d) The run-artifact contract, entirely.**
There is no `run-artifact.schema.json` in `tests/fixtures/dash/`, and no
reference anywhere in `src/` to `artifact_version`, the `{"type":"artifact"}`
channel frame, or the `digest`/`draft` kinds. The MCP knows the *panel* can bind
an `artifact_role` and does not know what an artifact is. **A build brief
therefore cannot tell an LLM how to emit output DASH will render** — which is
the exact skill MAR-689 is asking the MCP to acquire.

**e) The default panel shows no output.**
`observabilityContract.ts:923, 995-1000`: absent an explicit author panel, the
MCP emits a DASH-facts-only metrics panel — `run_count`, `last_run_at`,
`last_run_verdict` — that "binds no artifact role". An MCP-authored agent's
workspace shows three counters and nothing it produced.

**f) The component vocabulary is forked, and nothing reconciles it.**
The registry holds 68 components. None of the scout's six ids exists in it. The
nearest neighbours are `public_feed_fetch` (vs `public_source_fetch`),
`report_generation`, `research_synthesis`, `source_ranking`,
`human_approval_gate`. Because `component_id` is a free string on both sides and
DASH resolves nothing from it, **no gate in either repo can see the
disagreement** — the same class of failure MAR-477 found for
`connections[].provider`, which is what `dashBrokerCatalog.ts` was built to
prevent.

### 3.3 What the live MCP actually plans for this goal

Called with the scout's goal string verbatim, `output_depth: technical`,
`build_target: code`. The plan is `plan_source: "composed"`,
`route_status: "candidate"`, `coverage: "poor — 4 components without goal
support"`, no matching playbook:

| Step | Component | Tier |
| --- | --- | --- |
| 1 | `page_monitor` | none |
| 2 | `job_queue` | none |
| 3 | `research_synthesis` | **frontier** |
| 4 | `citation_checker` | none |
| 5 | `source_freshness_check` | none |
| 6 | `state_store` | none |

Read that against what the scout actually is:

- **`research_synthesis` is the right idea and the whole point.** Its registry
  entry says outputs: *"synthesised answer with inline source references"*,
  `model_tier: frontier`. **The MCP asks for the newsletter DASH cannot
  produce.** This is the strongest single piece of evidence that the missing
  capability is DASH's: the planner already names it.
- **`page_monitor` recommends Firecrawl** — an API-keyed third-party scraper —
  for sources MAR-670 already established are Atom feeds and JSON endpoints that
  `fetch()` reads with no credential. The MCP's `connection_contract` proposes
  three acquisition paths for a connection the real agent does not need.
- **`citation_checker` is structurally impossible in DASH.** It *"verifies that
  LLM-generated citations exist"*; DASH's entire digest design exists to ensure
  a model can never emit a citation — what crosses is an index
  (`run-artifact.schema.json:194`, `operations.ts:1434-1441`). The MCP is
  planning a defence against a failure DASH made unrepresentable.
- **No approval gate, no file write, no `human_approval_gate`** — so
  `enforced_approval_gates` is empty and `automation_clearance` comes back
  `L1` where the real agent is `L2` with a gate.
- **The runtime recommendation is not DASH.** `runtime_recommendation` is
  "Managed background worker / durable workflow"; the DASH Agent Runner is an
  *alternative*, and monitoring recommends `local_logs` over DASH. The
  recommendation's own `reason` string mentions *"Gmail events or polling"* for
  a goal with no Gmail in it — a leaked template.

**Summary: asked to plan the one agent DASH was built around, the MCP proposes a
paid scraper DASH does not need, a citation checker DASH's design makes
meaningless, no approval gate, an output step DASH cannot execute, and a runtime
that is not DASH.** The one thing it gets right — `research_synthesis` — is the
one thing DASH cannot run.

### 3.4 What the MCP would have to be told

In dependency order. Items 1–3 are prerequisites for the flow working at all;
4–6 are what make the first run *publishable*.

1. **The broker operation catalogue, by id, with access class.** All twelve, and
   a rule that a capability id an agent declares must be one of them. This is
   the difference between an agent that runs and one that is refused. It also
   needs the `spend` class — schema *and* emitter.
2. **The run-artifact contract.** Kinds, required members per kind, the
   `{"type":"artifact"}` channel frame, and the field-length ceilings — the
   scout has already lost a whole briefing once to a manifest three characters
   over a cap (`agent.mjs:1614-1617`).
3. **That `component_id` binds nothing.** The MCP currently emits ids as if they
   selected behaviour. They do not. Either DASH gains a catalogue that resolves
   them, or the MCP must be told plainly that the plan is a promise a person
   reads and the *code* is what runs — and its build brief must say what code to
   write for each step, in DASH's operation vocabulary.
4. **The step contract for digest / curate / deep-dive**: which operation each
   uses, what it returns, what `max_output_tokens` to pass (the broker's floor
   is 64, which is what MAR-671 cost, and the template still passes none —
   `agent-kit/template/agent.mjs:418-421`), and how indexes map back to items.
5. **The panel vocabulary bound to a real artifact role** — the MCP has the
   schema and emits a panel that shows no output.
6. **A worked DASH reference agent in the registry** — one playbook/route whose
   components are DASH's real steps, so `plan_workflow` on a
   watch-and-brief goal returns `route_status: validated` instead of a
   `coverage: poor` candidate assembled from generic word overlap.

---

## 4. Recommendation

### 4.1 DASH first, and the smallest useful piece is one operation

Henrik's own sequencing is right, and the evidence sharpens it: **DASH must gain
the ability to produce a document before the MCP is taught anything about
output.** Concretely, and in this order:

**D1 — Draw the deep dive (bug, small, do it now).** `deep_dive.text` reaches
DASH on every second-and-later run and is dropped. Either add a field to the
digest artifact for author-written prose and render it, or state in the manifest
copy that the file is the only place it appears. The current copy —
*"Saying no loses nothing: the same briefing is already on this page"*
(`agent.manifest.json:190`) — is false today. **This is a DASH issue** and is
the one thing here that is cheap.

**D2 — A compose operation (the real fix).** A third spend operation beside
`digest.curate` and `chat.completion`, with a DASH-owned prompt that asks for a
briefing and a projection that returns structured prose whose every claim is
bound to an item by **index**, preserving the citation property the digest
design already has. This is the missing capability, and `research_synthesis` in
the MCP registry is a ready-made specification of what it should do.
`operations.ts`' own rule applies: a card sentence, a scope list, a request
shape and a projection. **DASH issue.** ADR-worthy — the prompt-ownership rule
(`operations.ts:1372-1392`) and the "content is data" rule both bear on it.

**D3 — An artifact shape that carries it.** Either a `body` block on `digest`,
or a third `kind`. The schema's own additive-versioning discipline and the
`allOf` per-kind required branches (`run-artifact.schema.json:8-22`) show how.
**DASH issue.**

**D4 — A renderer that leads with the document and demotes the list.** The
evidence rule must survive — nothing collected may become invisible — so the
item list folds rather than disappears, the way `SourceList` already does
(`digest.tsx:404`). Note the trap recorded in memory and in MAR-668: two
renderers draw an artifact card (`outputs.tsx` and `panel.tsx`); both need it.
Note also that a closed `<details>` still has layout boxes, so any capture
harness checking this must ask `.open`. **DASH issue.**

### 4.2 Then the MCP, and item 1 is not about output at all

**M1 — Re-sync `dashBrokerCatalog.ts` and the fixtures, and add the operation
catalogue with access classes.** Until this lands, every MCP-authored agent's
model steps are `unknown_operation`. The `pnpm dash:schema:check` drift check
already exists for the manifest schema; the broker fixture has no equivalent and
should get one — its 598-commit drift is exactly what that check was invented to
catch. **MCP issue**, and it is the highest-priority item on that side by a
wide margin.

**M2 — Add `spend` to the emitter and the pinned schema.** Two-line change in
`exportBuildBrief.ts:2816`, one enum in the fixture — but it needs the operation
catalogue from M1 to know *which* capability is a spend.

**M3 — Teach it the artifact contract** (§3.4 items 2 and 5), so a build brief
can tell an LLM how to emit renderable output. This is the step that makes
"publishable on the first run" possible, and **it depends on D2/D3 existing
first** — otherwise the MCP would be taught a contract that has no newsletter in
it.

**M4 — A validated DASH route/playbook in the registry**, built from the scout,
so the flow stops returning `coverage: poor` candidates for its own flagship
goal.

### 4.3 What this says about the strategic bar

Henrik's bar — *"MCP plans it → LLM builds it → DASH runs it", working out of the
box* — is not currently failing at the LLM. It is failing at both ends of the
arrow simultaneously, and the middle is fine. The run that prompted this issue
had the MCP removed and an expert in its place, and still hit DASH's ceiling.
An MCP-authored agent today would not reach that ceiling; it would be refused at
the broker.

**The honest reading is that the pipeline has never been tested end to end.**
MAR-647's own coverage claim — that the scout is "the one agent that touches
every advanced surface DASH has" — is true of DASH's surfaces and says nothing
about the MCP's, because the MCP never authored it. Whatever ships from this
document, one deliverable should be **a second agent, authored through
`plan_workflow` → `export_build_brief` → an LLM, imported and run** — not to
test its output quality, but to find out how many steps in before it fails. On
today's evidence that number is one: the first model call.

---

## What this session did not do

- No code changed, no tests run, no packaged proof. This is documentation only.
- The `plan_workflow` call was made against the **hosted/released** MCP build
  (built 2026-08-07), which predates the local repo's F14 AI-connection emitter
  (2026-08-10, `866090e`). So the live server would emit **no** model-provider
  connection at all for this plan; the `openrouter.research_synthesis` capability
  described in §3.2(b) is what the *local* repo's emitter would produce. Both
  fail; they fail differently, and a session acting on this should check which
  build is deployed.
- `export_build_brief` was not called. The capability-id and access-class claims
  in §3.2 are read from the emitter source, not from a produced manifest.
  Producing one and importing it into DASH is the cheapest way to confirm the
  `unknown_operation` prediction, and is worth doing before M1 is scoped.
- The three-renderings question (MAR-668) is out of scope here and its fix has
  already merged at `a6a430e`; the dedupe is visible at `panel.tsx:186-200`.
