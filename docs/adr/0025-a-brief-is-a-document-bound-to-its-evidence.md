# ADR 0025: A brief is a document bound to its evidence by index, and the list folds without disappearing

**Status:** accepted in part — Henrik ruled on decisions 2, 4 and 5 on
2026-08-18 and deferred 1 and 3 ("I trust you here"). Decision 4 was **changed
by his ruling**: the export is a PDF, not a Markdown file, and it opens after it
is saved. Nothing here is built and nothing here is a schema edit.
**Date:** 2026-08-18
**Issue:** MAR-674 (DASH — the brief is the product). Depends on nothing;
unblocks MAR-691 (`deep_dive.text` is dropped), and MAR-670 / MAR-671 / MAR-667
land the content this contract has room for. MAR-668's ownership question is
resolved here rather than left open.
**Touches:** ADR 0008 (the author's declarative panel — extended by one
sentence, no control added), ADR 0011 amendment 1 (a step's level, and which
step a compose call names), ADR 0016 (the run allowance, and the collision
nobody has named), ADR 0012 (the chat's material stays items-only).
`lib/broker/operations.ts`' four-part rule for adding an operation governs
decision 1 throughout.
**Repository:** orchestratedash

---

## Context

Henrik, 2026-08-16: *"The output from our agents. This is the product. Show the
output easy to find, read. It should be a better experience than reading from
CoWork… Not just lots of headlines."*

`docs/research/mar-689-agent-output-quality.md` establishes why the output is a
list, and the finding is structural rather than a matter of prompt quality:
**DASH has no broker operation that writes a document, no field in the
run-artifact contract that could carry one, and no renderer that would draw
one.** The run Henrik read was an expert-authored agent with the MCP removed —
the pipeline's ceiling — and the ceiling is a roundup.

Three things are already true and are the foundation this builds on rather than
replaces:

- **Citation integrity is structural, not procedural.** `readCuration`
  (`lib/broker/operations.ts:1498`) returns item *numbers* and never text, so a
  model that invents a headline cannot make it appear in a digest. `items[]` is
  the only place a link lives.
- **Nothing collected may become invisible.** `app/_components/digest.tsx:24-31`:
  *"the tempting rendering drops an item with no source, so the digest looks
  clean. That is precisely how a grounded verdict becomes theatre."*
- **The honesty layer is the best thing about the current briefing.** It opens
  with the sources that did not answer.

Two things are already arriving at DASH and being silently dropped, and both are
symptoms of the same missing contract:

| what arrives | where it goes |
| --- | --- |
| `deep_dive.text` — the only prose the scout writes | nowhere. Not in the schema, not in `lib/contracts.ts`, not in any renderer. MAR-691. |
| `set_aside[]` — what the agent collected and did not include | nowhere. It survives in the store under the schema's open `additionalProperties`, and the only thing in this repository that has ever looked at it is a capture harness's text probe (`electron/capture-models.ts:501`). |

The schema's `additionalProperties` being open is what lets both travel intact
and be lost. That is the contract working exactly as designed and producing the
wrong outcome, which is the shape of thing an ADR is for.

**One fact makes this cheaper than it looks.** `contracts/contract.lock.json`
locks two schemas — `agent.manifest.schema.json` and `run-event.schema.json`.
The run artifact is **not** in it. Telemetry v1 is frozen; the artifact contract
never was, and `run-artifact.schema.json`'s own header says why they were kept
apart: *"an artifact is a different population from an event, and `listRuns`
derives run status from events alone — an artifact must never be able to perturb
that."* Moving the artifact contract moves no lock entry and touches no frozen
population.

---

## Decision 1 — a compose operation whose projection binds prose to items by index

> **A third spend operation, `{provider}.brief.compose`, with a DASH-owned
> prompt that asks for a written briefing and a projection that returns ordered
> sections of prose in which every paragraph carries the item numbers it was
> written from — and in which a paragraph that carries an address is dropped
> whole.**

`lib/broker/operations.ts:1844`'s rule applies and is met on all four counts: the
card sentence is *write up what this agent found* rather than *turn it into a
summary*; the scope list is unchanged (`required_scopes: []`, the profile's own
completion path, so `SPEND_PATHS` does not grow); the request shape carries
`material`, `max_output_tokens` and nothing else an author could fill; and the
projection returns a different structure from either existing one.

### The prompt is DASH's, and it is a third constant

`COMPOSE_SYSTEM_PROMPT`, beside `ASK_SYSTEM_PROMPT` (`:1020`) and
`CURATE_SYSTEM_PROMPT` (`:1394`), for that constant's own stated reason: *"a
system prompt an agent, a page or a bug could fill is a field that decides what
DASH says."* The injection paragraph is repeated a third time rather than
shared, on the same terms — this material came off the open web seconds ago and
nobody is reading the output as it arrives.

The reply format is line-based for `CURATE_SYSTEM_PROMPT`'s salvage argument,
which survives the level change. This step runs at `standard` rather than
`cheap`, so the small-model argument is weaker — but a torn stream truncates a
frontier model's JSON exactly as it truncates a small one's, and a format where
every line is independently readable degrades into a shorter brief rather than
into nothing:

```
SECTION: a short plain heading
PARA: one paragraph of plain sentences
ITEMS: the numbers this paragraph was written from
PARA: …
ITEMS: …
SECTION: …
```

`ITEMS` binds to the **paragraph above it**, not to the section. This is the
load-bearing difference from `readCuration` and the reason the operation is
worth building rather than widening the curation's limits.

### Why per paragraph and not per section

Henrik's own report of the failure names the mechanism: *"a model theme label
landed on a row carrying a real link."* A section-level binding reproduces that
defect at a larger size — five paragraphs under one heading, one of them wrong,
all five apparently vouched for by the section's citations. Binding at the
paragraph is the narrowest unit the format can express, and it makes a
misattribution a bounded blast radius rather than a page-wide one.

### What the projection guarantees, stated exactly

`readBrief(answer)` is a pure function from one untrusted string to a bounded
structure, exported for `readCuration`'s reason — it is the interesting half and
the half worth attacking, and `tests/broker-compose.test.ts` can drive a reply
that lies, a reply carrying a link, a reply naming item 10,000 and a reply that
is one long line, with no Electron, no key and no provider. `LOOKS_LIKE_A_LINK`
(`:1463`) applies unchanged to every paragraph: **a paragraph containing
anything that looks like the start of an address is dropped whole, not
cleaned.** Nothing is repaired and nothing is inferred.

So the guarantee is precisely this, and the wording matters because the
overclaim is available and tempting:

> **A hallucinated claim cannot carry a link, because no link ever crosses from
> the model. A hallucinated claim can still name a real item's number.**

Index binding makes the *citation* unfabricatable. It does not make the *claim*
true, and DASH cannot check that it is. The renderer's copy must therefore
attribute rather than endorse — *written from items 4, 9* and never *supported
by items 4, 9* — the same standing `sources_fetched` has, which
`run-artifact.schema.json` already words as *"an internal-consistency check on
the agent's own report, NOT independent proof."*

A paragraph with no usable `ITEMS` line is **kept and marked as uncited prose**,
because dropping it is `digest.tsx:24-31`'s theatre one level up: a brief that
silently deletes its unsupported paragraphs reads as fully grounded and is not.

### Bounds

`MAX_MATERIAL_CHARS` (24,000, `:997`) is unchanged — the input is the same
collected material. `MAX_OUTPUT_TOKENS` (2,000, `:1001`) is the one number that
must move, because 2,000 tokens is roughly the length of the thing being asked
for and leaves no room to be a briefing rather than a long summary. A separate
`MAX_COMPOSE_OUTPUT_TOKENS` of **6,000**, not a raise to the shared constant:
the chat's ceiling and the curation's ceiling are answers to different
questions, and raising all three because one needed it is how a bound stops
meaning anything. New bounds on the projection: `MAX_SECTIONS = 8`,
`MAX_PARAS_PER_SECTION = 6`, `MAX_PARA_CHARS = 1,200`, `MAX_HEADING = 80`.
`MAX_ITEM_INDEX` (200, `:1429`) is reused as-is.

### Which step it is, and what it costs

ADR 0011 amendment 1 decision A1.4 applies unchanged: the agent names the
**step**, DASH resolves the level from the manifest it imported joined to the
person's own overrides, and `lib/broker/execute.ts` goes on overwriting `model`
before `planCall` sees it. A compose step declaring `standard` reaches whatever
the person mapped for `standard` and nothing else. The widening A1.4 states is
not widened further: an agent can still only reach levels its own plan declares.

---

## Decision 2 — artifact v2: one artifact per run, with a document, per-item content, and what was cut

> **`artifact_version` becomes `enum [1, 2]` on the one existing schema. A v2
> digest may carry `document`, `items[].content` and `set_aside[]`. A v1
> artifact stays valid byte-for-byte and renders exactly as it does today.**

### Not a third kind, and this is the load-bearing rejection

A `kind: "brief"` beside `digest` and `draft` is the obvious move — it is how
`draft` was added (MAR-458), the schema documents the `allOf` mechanism for
exactly this, and it would need no version change at all. **It is wrong, for one
reason that decides it:** the brief's paragraphs cite items by index, and if the
brief is a separate artifact those indices point into *another artifact's*
array. Nothing structurally guarantees the two arrays are the same list, in the
same order, from the same run. The entire safety property of decision 1 is that
an index names a row DASH already holds; a cross-artifact index is a join, and a
join can be wrong.

The second reason is the one Henrik would see: two artifacts per run means two
cards in the Outputs area, which is MAR-668's duplication reintroduced one level
up, days after it was removed.

So **the document lives on the artifact that holds the items it cites.**

### The three additions

```
document {                       ← ordered, model-authored, index-bound
  sections[] {
    heading                      ← plain text, no link, MAX_HEADING
    paragraphs[] {
      body                       ← plain text, no link, MAX_PARA_CHARS
      items[]                    ← positions into this artifact's own items[]
    }
  }
  model?                         ← what the provider says wrote it. Attributed.
}
items[].content                  ← the SOURCE's own text (MAR-670), not a model's
set_aside[] { headline, reason } ← what was collected and left out
```

**`items[].content` is source-authored and `document` is model-authored, and
they never mix.** `summary` keeps its meaning and its 1,000-character bound;
`content` is the longer body MAR-670's parser fix actually recovers, with its
own bound. No model-authored text is ever written onto an item — a per-item
model field would be the misattribution of decision 1 re-created inside the
evidence list, where nothing could tell the two apart.

**`set_aside[]` is first-class beside `sources_fetched`**, not prose, because
MAR-674 asks for the honesty layer to be structured and because it is already
arriving and already lost. `reason` is a closed enum of the kinds that lead
somewhere different for a reader — `duplicate`, `off_topic`, `too_old`,
`unparseable` — on `CurationRefusal`'s precedent and for the reason
`lib/copy/recovery.ts` refuses to collapse failure modes.

### The ingest change, which is the part that is easy to miss

`artifact_version` is `{ "const": 1 }` today and `lib/contracts.ts:136` compiles
**one** validator for this schema. A v2 artifact arriving at that boundary is not
partly read — it is **rejected whole and never stored.** So the enum widening is
not cosmetic version-stamping; it is the thing that makes v2 exist at all.

One schema with `enum [1, 2]` rather than `validateManifest`'s two-file shape
(`lib/contracts.ts:215-222`). The manifest has two files because v1 and v2 are
genuinely different documents; artifact v2 is v1 plus three optional members, and
a second file would be a second copy of every constraint the first one already
states.

The per-version discipline goes in the existing `allOf`, which is where this
schema already puts its conditional requirements:

- **`document` requires `artifact_version: 2`.** A v1 artifact carrying one is
  refused, so "the producer knows about this contract" stays checkable rather
  than being inferred from a member's presence.
- **`document` and `curation` may not both be present.** An artifact carrying
  both is two model-authored groupings of one list, which can disagree, and the
  contract exists to keep exactly that from reaching a renderer that would have
  to guess. The cost is stated rather than softened: an agent that emits both
  loses the whole artifact at ingest. That is loud, and loud is what this
  schema's own precedents choose — `draft_id: false` refuses a field rather than
  ignoring it.
- **`curation` stays valid, unchanged, at either version.** Every digest already
  written renders as it does today, and an agent that only groups is not
  obliged to compose.

`RunArtifact` stays a discriminated union and `DigestArtifact` gains three
optional members. `analyzeGrounding` (`lib/analyze.ts:259`) reads `items` and
`sources_fetched` and is **not** given the document: a model cannot improve a
run's grounding verdict by writing well, which is `DigestCuration`'s own
invariant applied to the larger thing.

**The chat's material stays items-only.** `savedThingsForAgent`
(`lib/views/ask.ts:285`) flattens `items` from digests. It must not gain the
document, or DASH would be quoting one model's prose to another model as though
it were collected evidence — and the citation the second model returned would
name a paragraph rather than a source.

---

## Decision 3 — the renderer leads with the document, folds the list, and the author's section still yields

> **`DigestBody` draws the document first and the item list inside a `<details>`
> whose summary states the exact count. The fold is closed by default when a
> document exists and open when one does not, so a v1 digest is pixel-for-pixel
> what it is today. Every honesty fact is drawn outside the fold.**

One component, and that is the answer to the trap: `app/_components/outputs.tsx`
and `app/_components/panel.tsx` both switch on `kind` and both call `DigestBody`.
Because the document lives on the digest artifact rather than on a new kind,
**both renderers gain it from one edit** — the two-renderers defect cannot recur
here by construction.

### What may fold and what may not

| outside the fold, always | inside the fold |
| --- | --- |
| the source-gap notice | each item's headline, content and link |
| `set_aside[]` — what was cut, and why | |
| the grounding chip and verdict | |
| the count of items, in the summary line | |
| the uncited / unsupported markers and their counts | |

The rule `digest.tsx:24-31` states is that an item must not become *invisible* —
its own example is an item **removed** so the digest looks clean. `SourceList`
(`digest.tsx:397`) has folded the source list since MAR-434 and that rule
survived it. A `<details>` whose summary says *"All 60 items this run collected,
with sources"* is one press from the whole list and states the number before it
is pressed.

### MAR-668, resolved rather than reopened

The existing resolution stands and is extended, not overturned: **DASH's card
keeps the body and the author's `report` / `outputs` section yields it**, for
`lib/copy/panel.ts:270-284`'s reason — the author's region has no grounding
verdict, no *Save a copy*, no developer reference and no link to the producing
run, so making DASH's card yield would take away the half a person needs in
order to check what they are reading.

**One thing must change, and it is a copy string that becomes false.**
`PANEL_ALREADY_SHOWN` (`lib/copy/panel.ts:293`) reads:

> *"Shown in full at the top of this page, under Generated assets."*

Once the list folds, *in full* is not true of what is on screen. The pointer must
say where the thing is **and what state it is in** — and the sentence is DASH's
own, in DASH's own words, naming DASH's own heading, so it stays admissible
inside the author's region on ADR 0008 amendment 1's terms. This is part of this
decision rather than a later copy fix, because a small lie on the one surface
DASH's whole argument is about not telling is exactly the thing a build session
would leave for someone else.

Nothing is added to the author's declarative panel. ADR 0008 is otherwise
untouched: no control, no button, no affordance in that region.

---

## Decision 4 — export is a PDF, printed from a route in DASH's own renderer, and it opens after it is saved

> **`workspace.exportBrief`, in the `WORKSPACE_ACTIONS` family. Main opens an
> offscreen window on a print-only route in DASH's own static export, calls
> `webContents.printToPDF`, saves through the same `dialog.showSaveDialog`, and
> then hands the file to the operating system. One format. No path crosses the
> IPC boundary in either direction.**

**Ruled by Henrik on 2026-08-18**, against this ADR's first draft, which
proposed a Markdown file. His reasoning — *"text files should download as
html->PDF"* — is right, and it makes the design **smaller** rather than larger.
The draft is corrected here rather than defended.

### What is actually walled, checked rather than assumed

- **`window.open` and off-origin navigation are dead.** `electron/main.ts:728`
  denies every window-open and `:729` blocks navigation past
  `isAllowedRendererUrl`. "Open it in a browser" is not a control that can be
  built.
- **The `will-download` deny is the *supervised browser's*, not the
  renderer's.** It is on the browser-view partition session
  (`electron/browser-view.ts:228`) and applies to pages an agent drives. MAR-674
  reads it as the wall in front of the artifact surface; it is not, and the real
  reason a page-initiated download is refused is better than that one:
  `lib/shell/ipc.ts:3111-3125` states that a path never crosses this boundary in
  either direction, and a blob `<a download>` would hand Electron's own download
  machinery a destination nobody audited.
- **The proven save mechanism already exists and its plumbing does not fit.**
  `workspaceDownload` (`electron/main.ts:1884`) asks first and fetches second,
  raises the OS dialog in main, writes the bytes there and returns a sentence
  and a folder — never a path, never the bytes. But it fetches from the
  **runner** (`GET /artifacts/{id}/download`), so what it exports is a file the
  agent wrote. **A brief composed into a stored artifact has no bytes at the
  runner.** The shape is `workspace.download`'s; the plumbing is new.

### Why a PDF is cheaper than the Markdown file this ADR first proposed

The first draft rejected HTML export in one line: *it would mean escaping
untrusted text into markup at a second site.* **A print route removes that
objection entirely, and with it the whole reason Markdown looked safer.**

DASH already opens hidden windows on **routes in its own renderer** —
`electron/approval-popup.ts:93` loads `${rendererOrigin}${APPROVAL_POPUP_ROUTE}`
under `SHELL_WEB_PREFERENCES` (`lib/shell/window.ts:37`), and
`electron/credential-prompt.ts:240` does the same. A print route is a third
window of a shape that is already built, already hardened and already reviewed.

The consequence that decides it: **the PDF is drawn by the same React components
as the screen.** React escapes text by construction — the property `DigestBody`
already depends on — so model-authored prose is escaped once, by the framework,
in the one renderer. The Markdown plan would have needed a hand-written escaper
that no other DASH surface has, protecting against an attack (`[click
here](http://evil.example)` becoming a live link in a file) that the PDF path
simply does not have.

So the count of places DASH escapes untrusted text into markup goes from "one,
plus a new hand-written one" to **one**. That is the argument, and it is
Henrik's, not this document's first draft's.

### The print route, and the three things it must do differently from the screen

`PRINT_BRIEF_ROUTE`, a constant beside `APPROVAL_POPUP_ROUTE`
(`lib/shell/approval-popup.ts:23`), rendering the same `DigestBody`. Three
deliberate differences, each of which is a defect if it is forgotten:

1. **The fold is forced open.** A closed `<details>` prints collapsed, so a PDF
   of decision 3's page would be a document with its evidence deleted — the
   exhaustive-list rule broken by a rendering accident rather than by a
   decision. The print route renders with the list open, always.
2. **The theme is forced light.** `app/tokens.css:100` sets
   `color-scheme: light dark` and every token is a `light-dark()` pair, so a PDF
   printed while DASH is in dark mode is a black page. The route pins
   `data-theme="light"`, which that file's own `[data-theme]` override already
   supports.
3. **No control renders.** *Save a copy*, the developer disclosure and the run
   link are DASH's affordances and mean nothing on paper.

### The hazard, named, with its harness already built

**An offscreen window that is not destroyed blocks the quit.**
`window-all-closed` counts open windows whether or not anybody can see them, and
`electron/prove-quit.ts:219-221` already exists to reproduce exactly this shape
— a `show: false` window nobody can see, keeping a process alive nobody may
kill. So the print window is destroyed in a `finally`, on success, on a
`printToPDF` rejection and on a cancelled dialog alike, and **`prove-quit.ts`
gains a third scene** rather than this being left to a code comment.

### The order of operations, and what comes back

Ask, print, save, open — and the dialog comes **first**, on `workspaceDownload`'s
own stated reason: a cancelled dialog should cost nothing, and a print that had
to choose a location on its own is a file the person has to go and find.

`shell.openPath` on the file DASH just wrote, per Henrik's ruling. Two things
make that admissible and both are worth stating rather than assuming:

- **DASH composed these bytes.** This is not opening a file of unknown
  provenance; it is opening the PDF this command produced a moment ago, at the
  path the person chose in the OS's own dialog.
- **`shell` is a new import in `electron/main.ts`** (`:37` imports `app`,
  `BrowserWindow`, `dialog`, `ipcMain`, `Menu`, `nativeTheme` and no more), so
  the ability to hand a path to another application arrives with this command
  and should be reviewed as such. It is reachable from exactly one call site and
  only with a path `dialog.showSaveDialog` returned.

What crosses back to the renderer is unchanged from `workspace.download`: a
`WorkspaceActionResult` carrying `ok`, a sentence and the folder. Not the path,
not the bytes.

### Markdown is not kept as a second format

Rejected on the same principle that chose the PDF: a second format is a second
writer, and the Markdown writer is the one with the hand-rolled escaper. A
person who wants the text can select it on screen. If a `.md` is ever asked for,
it is a separate decision with its own reason.

## Decision 5 — the run allowance is two calls, and this is the collision nobody has named

`SPEND_ALLOWANCE_CALLS = 2` (`lib/broker/spend-allowance.ts:86`), pinned by value
in `tests/broker-spend.test.ts` so that widening it is a diff somebody reads. Its
own docblock: *"One is what the scout needs… The second exists so that a step
which failed on a torn connection can be tried again inside the same run… and it
stops there, because three would start to look like a retry loop's allowance."*

Do the arithmetic on the scout with a compose step added:

| plan | calls | outcome |
| --- | --- | --- |
| curate + compose | 2 | fits, with **zero** retry budget |
| curate + compose + deep dive | 3 | the third call is **refused**, on every second-and-later run |

**Ruled by Henrik on 2026-08-18: compose replaces curate in the scout's
plan.** One call, one document, and the grouping falls out of the document's
sections. This is not a budget dodge — it is the better architecture:

- `curation.groups` and `document.sections` would otherwise be two model-authored
  groupings of one list that can disagree, which is exactly what decision 2's
  refusal rejects at the contract. A plan that emits both pays twice to create
  that disagreement.
- The curation's entire ceiling is ~6.4 KB of labels over a list — a table of
  contents by construction. A document with headings *is* that table of
  contents, with the writing the table of contents was standing in for.
- Spend does not widen. One press still buys two calls, and the scout still has
  its retry.

The alternative — raising `SPEND_ALLOWANCE_CALLS` to 3 — was put to Henrik with
its cost stated (one press of Run now costing 50% more, on every run, forever)
and **declined**. The constant stays at 2 and `tests/broker-spend.test.ts` goes
on pinning it by value.

**What this does not decide:** `curation` stays in the contract, stays valid and
stays rendered. What changes is the sample agent's plan. An agent that wants a
grouped digest and no document is unaffected, and every digest already written
renders as it does today.

---

## The tension Henrik asked to have named

**"Lead with the document" and "nothing collected may be hidden" are in genuine
conflict, and this ADR does not pretend otherwise.**

The safety argument (`digest.tsx:24-31`) was written against a specific failure:
a renderer that *drops* an uncited item scores the run well by concealing the
evidence against it, and the reader has no idea anything was removed. Every word
of that survives. What is genuinely at stake is narrower and is worth stating in
one sentence:

> Folding does not conceal an item, but it does make the *default* reading of the
> page a model's account of the evidence rather than the evidence.

That is a real cost. A reader who never opens the fold reads only what a model
wrote, and the whole reason DASH exists is that a model's account of its own work
is not the same thing as the work.

**The recommendation is to fold anyway, closed by default, on these terms:**

1. **The count is on screen unfolded.** *"All 60 items this run collected"* is
   the honest disclosure — the reader knows the size of what they are choosing
   not to read, which is the thing a dropped item denies them.
2. **Every fact that could embarrass the document is outside the fold** — the
   source gaps, `set_aside`, the grounding verdict, the uncited and unsupported
   counts. What folds is the evidence's *bulk*, never its *accounting*.
3. **Prose is attributed everywhere it appears.** *Written from items 4, 9*, with
   the model named, on `describeCuratedBy`'s existing footing.
4. **The fold is one press and it is on the same screen.** Not a second page, not
   a modal, not a route.

What tips it: the current design is not actually protecting anybody. Sixty items
rendered in full is a page nobody reads to the end, so the uncited marker on item
47 is already invisible in every sense except the technical one. A folded list
with the count and the verdict above it discloses *more* to the reader who will
not read sixty items — which is every reader — while costing the reader who will
exactly one press.

**Where the argument would fail, and the line that must not be crossed:** if the
fold ever hides the grounding verdict, the source gaps or `set_aside`, this
recommendation is wrong and the exhaustive list is right. Those three are the
honesty layer. The items are the evidence. A build session may fold the second
and may never fold the first.

---

## What this costs

- **A third spend operation**, and with it a third DASH-owned prompt to keep
  correct. Mitigated the way the second one was — a separate constant, a
  separate projection, its own attack test — and not pretended away.
- **A version on a contract that has only ever had one.** Every reader of
  `artifact_version` gains a branch, and the ingest validator gains an enum.
  Bounded by the fact that v1 stays valid unchanged and that no lock entry moves.
- **A refusal at ingest that rejects a whole artifact.** An agent emitting both
  `curation` and `document` loses its items too. Deliberate and loud; the
  alternative is a renderer guessing between two groupings.
- **One copy string becomes false and must be rewritten in the same change.**
  `PANEL_ALREADY_SHOWN`.
- **A third hidden window, and the quit hazard that comes with one.** Bounded
  by a `finally` that destroys it on every path and by a new `prove-quit.ts`
  scene, rather than by a comment asking the next person to remember.
- **`shell.openPath` enters `electron/main.ts`.** The ability to hand a path to
  another application did not exist in that file before this command.
- **A print-only route in the renderer**, which must keep three deliberate
  differences from the screen (fold open, theme light, no controls) and will
  silently produce a wrong PDF if any of them regresses.
- **A plan change to the sample agent**, if decision 5's recommendation is taken:
  the scout drops `digest_curate` for `brief_compose`, and that is a manifest
  edit with its own import evidence.

## What is unchanged

`SPEND_PATHS` does not grow — the compose operation shares the profile's
completion path, so the set of places DASH can spend money is what it was.
`analyzeGrounding` reads exactly what it read before. The chat's material stays
items-only. Telemetry v1 is untouched and `contract.lock.json` gains no entry.
No control is added to the author's declarative panel. DASH still makes no
completion call of its own and still never claims to have watched a model work.
The renderer still touches no path, and no path crosses the IPC boundary in
either direction.

## Alternatives rejected

- **A third `kind: "brief"`.** The obvious move and the one this ADR spent the
  longest on. Rejected because its indices would point into another artifact's
  array, turning decision 1's structural guarantee into a join that can be
  wrong — and because two artifacts per run is MAR-668's duplication rebuilt.
- **Widening `readCuration`'s bounds instead of a new operation.** Rejected: the
  curation returns labels bound to a *group*, and the whole argument of decision
  1 is that binding must be finer, not longer. A 4,000-character `summary` on a
  group is one wrong sentence borrowing twelve items' citations.
- **Section-level index binding.** Rejected as the reproduction, at a larger
  size, of the exact defect Henrik reported.
- **Dropping paragraphs that cite nothing.** Rejected as `digest.tsx:24-31`'s
  theatre applied to prose: a brief that deletes its unsupported claims reads as
  fully grounded and is not.
- **Per-item model-authored text.** Rejected: an item carrying both the source's
  words and a model's words with nothing distinguishing them is the
  misattribution risk moved inside the evidence list.
- **A Markdown file, which is what this ADR first proposed.** Overturned by
  Henrik's ruling, and he was right: a print route renders the PDF through the
  same React components as the screen, so the "second escaping site" that was
  the whole argument for Markdown never exists. Not kept as a second format
  either — a second format is a second writer, and it is the one with the
  hand-rolled escaper.
- **A page-initiated download from the renderer.** Rejected on `ipc.ts`' own
  rule rather than on the sandbox claim in the issue, which is about a different
  session.
- **Reusing `workspace.download`.** Rejected on the facts: it fetches from the
  runner, and the composed document has no bytes there.
- **Leaving the item list unfolded.** Rejected with the trade-off stated above,
  and the line at which the rejection would be wrong is written down.
- **Raising `SPEND_ALLOWANCE_CALLS` to 3.** Put to Henrik with its cost stated
  and declined on 2026-08-18. Compose replaces curate instead.
- **Saving the PDF without opening it**, as `workspace.download` does today.
  Declined by Henrik on 2026-08-18: what a person expects from an export is the
  document, not a sentence naming a folder. The cost — DASH launches another
  application — is stated in decision 4 rather than absorbed silently.
- **Zipping a run's several files as part of this decision.** Henrik asked for
  `.zip` for multi-file, picture and video outputs, and scoped it to its own
  issue on 2026-08-18. It is about workspace files rather than about the brief,
  and it needs its own answer to zip-versus-folder — DASH already answered that
  question once the other way, in `host.bringHome`, which raises a **folder**
  dialog and writes the files into it (`electron/preload.ts:398-412`).

## What is proven

**Nothing.** This is a proposal and no code changed. `pnpm typecheck` is run to
show that, not to show anything about the design.

What a build session must prove, and in this order:

- ⬜ `readBrief` against a reply that lies, one carrying a link in a paragraph,
  one naming item 10,000, one that is a single line, and one with an `ITEMS` line
  and no `PARA` — pure, no Electron, no key.
- ⬜ that a v1 artifact validates and renders identically after the enum widens,
  and that `document` on a v1 artifact is refused at ingest.
- ⬜ that an artifact carrying both `curation` and `document` is refused.
- ⬜ that the print window is destroyed on every path — success, a `printToPDF`
  rejection, and a cancelled dialog — and that the quit still completes, as a
  **new `prove-quit.ts` scene** rather than as a unit test that cannot see a
  wedged window.
- ⬜ that the PDF renders with the item list **open** and in the light theme
  regardless of what DASH is set to, since both are silent failures that produce
  a plausible-looking wrong document.
- ⬜ the folded list, the count in the summary, and the honesty layer outside the
  fold — **by capture, asking `.open`**, because a closed `<details>` still has
  layout boxes and a geometry check will report the folded content as on screen.
- ⬜ one real charged run of the scout producing a document, attended. That is
  the only thing that closes MAR-674, and it is Henrik's bar: a briefing he would
  rather read than CoWork's, findable in two presses.
