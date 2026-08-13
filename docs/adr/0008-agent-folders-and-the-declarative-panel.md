# ADR 0008: The agent folder is the unit of storage and deploy, and the panel is a declaration DASH renders

Status: Accepted

Date: 2026-08-07

Issue: MAR-543. Related: MAR-487 (deploy bridge), MAR-497 (standalone runner),
MAR-507 (Inputs), MAR-434 (artifacts), MAR-545 (talk to an agent), MAR-548
(sample agents).

## Decision

**An agent is a folder. The folder is the source of truth and the deploy
bundle in one; the SQLite row becomes an index of it. The per-agent custom
panel is a declarative spec inside the manifest, rendered by DASH's own
trusted components — agent-authored code never executes in DASH's renderer,
and the escalation path (a sandboxed frame over a typed channel) is a separate
decision this ADR does not take.**

The coordinator recommendation on MAR-543 already made the load-bearing
correction — panels are declarations, not code — and this ADR does not
relitigate it. What follows specifies it: the folder layout and what is
authoritative for what, the panel schema v0 and its component vocabulary, the
MCP tool contract that emits it, the security argument against the actual
threat, how the folder becomes MAR-487's bundle, and what this unlocks for
MAR-545.

## Where the pieces already are, and why this is smaller than it looks

ADR 0005's habit, and it decides most of the shape.

**The manifest is already "the author's document," stored verbatim.** The
`agents` table holds `name` (PK), `manifest_version`, `manifest_json`,
`imported_at`, `avatar` — and `manifest_json` is the whole manifest,
stringified as imported, with a column comment saying why: "the Connection
Center's honesty rules depend on being able to say 'the manifest declared
this' with no normalisation step in between" (`lib/db.ts:86-96`). The only
projection out of it is `manifest_version`, so the list needn't parse every
document. The DB is already halfway to being an index; this ADR takes the
principle to its conclusion rather than inventing one.

**The declarative-surface pattern is already shipped, twice.** MAR-507's
`agent_dom.task_inputs` is a typed block in the manifest that makes a DASH
surface appear: roles with `id`/`label`/`description`/limits, rendered by
`InputsPanel` under rules this ADR inherits wholesale — ids travel but are
never rendered; entries missing required members are dropped, not rendered
with a stand-in; absence means "declares none," never "anything goes"; limits
are read in main from the manifest and never accepted from the renderer; the
renderer names a *kind* of thing and never the thing (`lib/shell/ipc.ts:334`,
`lib/views/inputs.ts:104`). MAR-434's Outputs half is the other half of the
vocabulary: `ArtifactCardView` with a receipt that splits the agent's claim
(`stated_at`) from DASH's record (`received_at`), cards never a table, empty
states said rather than hidden (`lib/views/artifacts.ts:44-84`,
`app/_components/outputs.tsx`). The panel is these two patterns given a
composition layer, not a new kind of thing.

**The deploy plane is built and waiting for exactly this.** MAR-487's bundle
is a JSON `install` envelope of `{path, content_base64, sha256, mode}` files;
`assembleBundle` (`lib/deploy/bundle.ts:88`) validates it — manifest
constraints, entry point, per-segment path guard, 64 MiB cap — and **has no
production caller**. Nothing turns anything into `SourceFile[]`. And the
standalone runner (MAR-497) consumes registrations from
`{dataDir}/agents/*.json` (`runner/main.ts:155`, shape in
`lib/registration.ts:64-72`), which nothing writes into a bundle: a bundle
assembled today installs and starts a runner that supervises nothing. The
missing producer and the missing registration are one gap, and the agent
folder is what fills it.

**The cross-repo contract machinery already exists.** orchestratekit-mcp pins
DASH's v2 schema as a fixture, diffs it structurally against
`contracts/agent.manifest.v2.schema.json` on every `pnpm verify`
(`scripts/check-dash-schema-drift.mjs`, "additive-only drift is still
drift"), locks it with per-schema hashes, and Ajv-validates every manifest it
emits. A new manifest block ships by authoring it in DASH first, then
mirroring the fixture — the order the drift check enforces by design.

## The folder

### Layout, and what is authoritative for what

```
{userData}/agents/{name}/
  agent.manifest.json     # the author's document: identity, declarations,
                          # connections, task_inputs, and the panel spec
  registration.json       # the author's spawn recipe: command, args, cwd, env
  code/                   # what runs; opaque bytes to DASH
  assets/                 # the agent's own files; opaque bytes to DASH
```

| File | Authoritative for | Who reads it |
| --- | --- | --- |
| `agent.manifest.json` | Everything DASH renders, refuses, or declares about the agent — including the panel | DASH at import (Ajv strict + `checkManifestConstraints`); the runner via its consented copy |
| `registration.json` | How the agent's process starts | DASH at adoption; deploy assembly |
| `code/**` | What runs | Only a runner-spawned child process. Never DASH. |
| `assets/**` | Whatever the agent keeps for itself | Only the agent's own process |
| `agents` DB row | **Nothing.** It is an index. | List views, via `readStore` |

The folder name is the agent name, and a name that cannot be a directory
component is refused at import rather than mangled — checked with
`runner/path-guard.ts`'s `inspectComponent`, the same per-segment guard the
deploy helper runs, because a mangled name would be DASH silently renaming
somebody else's agent. This is a new import constraint and it belongs in
`lib/manifest-constraints.ts` beside MAR-482's, at the same two doors, with
its own `lib/import-feedback.ts` case.

Every byte that enters the folder enters through import, and file paths
inside an imported file set get the deploy plane's exact two guards:
`inspectComponent` per segment, containment under the agents root re-checked
on the joined path. The redundancy table is amendment 3's, deliberately:

| Change | What goes red |
| --- | --- |
| Remove the containment re-check alone | **nothing** — the component guard still refuses |
| Remove the component guard alone | **nothing** — containment still refuses |
| Both | the escape case |

### The row becomes an index, and the disagreement rule is stated now

`manifest_json` stays. `readStore`'s damage tolerance, the four views, and
every honesty rule built on "the manifest declared this" keep working
unchanged, because the row keeps carrying the verbatim document. What changes
is its **standing**: the folder's `agent.manifest.json` is authoritative, the
row is a projection of it, and import writes the folder first, then the row.

Two stores can disagree, and the rule is decided here rather than discovered
in a bug report: **on disagreement, the folder wins, and the disagreement is
surfaced, never silently repaired.** Startup reconciliation re-projects the
row from the folder; a folder that has gone unreadable while the row survives
renders the same way `UnreadableRows` damage already renders
(`lib/store.ts:70-81`) — named, on the surface, with the row's projection
still serving the list so one damaged folder does not take down the agents
page. This is `readStore`'s blast-radius lesson applied to a second store.

Ordering, because a file write and a DB transaction cannot be one atomic
step: folder write completes (and is fsynced) before the row is touched; a
crash between the two leaves a folder the next startup reconciles into a row,
which is the recoverable direction. The reverse order would leave a row
pointing at nothing, which is the direction that renders as damage.

### Migration from today's row-only agents

A function-form migration — the shape `lib/db.ts:553-577` already established
for the avatar backfill — walks `agents` and materialises
`agents/{name}/agent.manifest.json` from `manifest_json` for every readable
row whose name passes the component guard. That is the whole migration, and
what it deliberately does *not* do matters more:

- **No code is pulled in retroactively.** Today's registrations point at the
  author's own project directory, wherever the agent was built; copying files
  out of a user's project without the user at the door is not an import, it
  is an acquisition. A migrated agent is a *manifest-only folder*: it
  renders, it runs exactly as it does today through its existing
  registration, and it **cannot deploy** — the deploy flow refuses with the
  honest sentence ("this agent's build lives outside DASH; re-import it to
  put a copy in DASH's keeping") rather than deploying a folder that is
  missing its own program.
- **A name that fails the component guard migrates to nothing.** The row
  keeps working — row-only agents remain a supported standing, that is what
  the index still being a full projection buys — and the agent is listed in
  the migration's own report the way `skipped_agents` already is in the
  legacy `dash.json` migration (`lib/db.ts:919-931`).
- **Nothing is deleted.** `manifest_json` is not dropped, no registration
  moves, the runner's data directory is untouched. The migration adds a
  store; it does not move one.

New imports carry the file set. The `dash://` handoff already carries the
manifest and the registration data (`lib/handoff-flow.ts:388-410`); it grows
the declared file list, and `agent-kit`'s scaffold already produces exactly
that shape — `{path, contents}[]` (`agent-kit/scaffold.ts:107-122`). The
handoff consent screen is where "DASH is about to take a copy of these files"
is said, in the same voice the Inputs panel's `copied` state already uses:
DASH took its own copy, so changing the original now changes nothing.

## The panel

### Where the spec lives: in the manifest, not beside it

The panel is `agent_dom.panel`, optional, **omitted when undeclared — never
an empty object** — the exact rule `task_inputs` shipped with, for the same
reason: absence must never be read as "render something anyway." A separate
`panel.json` was rejected (see Alternatives): the manifest already has the
verbatim-storage discipline, the Ajv-strict gate, the constraints check, the
cross-repo drift tripwire and the conformance fixtures, and a second author
document would need all five duplicated before its first render.

### Schema v0, concretely

Added to `contracts/agent.manifest.v2.schema.json` under `$defs`, referenced
from `agent_dom.properties.panel`. The normative text is the schema; this is
it, abridged only of `description` strings:

```json
"panel": {
  "type": "object",
  "required": ["panel_version", "sections"],
  "properties": {
    "panel_version": { "type": "integer", "minimum": 1 },
    "title": { "type": "string", "minLength": 1, "maxLength": 120 },
    "sections": { "type": "array", "minItems": 1, "maxItems": 8 }
  },
  "if": { "properties": { "panel_version": { "const": 1 } } },
  "then": {
    "properties": {
      "sections": { "items": { "$ref": "#/$defs/panelSectionV1" } }
    }
  },
  "else": {
    "properties": {
      "sections": { "items": { "$ref": "#/$defs/panelSectionOpaque" } }
    }
  }
},

"panelSectionV1": {
  "type": "object",
  "required": ["id", "type", "label"],
  "properties": {
    "id":    { "type": "string", "minLength": 1, "maxLength": 64,
               "pattern": "^[a-z0-9_]+$" },
    "label": { "type": "string", "minLength": 1, "maxLength": 120 },
    "type":  { "enum": ["report", "outputs", "table", "metrics", "note"] }
  },
  "oneOf": [
    { "properties": { "type": { "const": "report" },
        "artifact_role": { "$ref": "#/$defs/roleName" } },
      "required": ["artifact_role"] },
    { "properties": { "type": { "const": "outputs" },
        "artifact_role": { "$ref": "#/$defs/roleName" },
        "max_items": { "type": "integer", "minimum": 1, "maximum": 20 } } },
    { "properties": { "type": { "const": "table" },
        "source_role": { "$ref": "#/$defs/roleName" },
        "columns": { "type": "array", "minItems": 1, "maxItems": 8,
          "items": { "type": "object",
            "required": ["key", "label", "kind"],
            "properties": {
              "key":   { "type": "string", "minLength": 1, "maxLength": 64,
                         "pattern": "^[a-z0-9_]+$" },
              "label": { "type": "string", "minLength": 1, "maxLength": 120 },
              "kind":  { "enum": ["text", "number", "timestamp"] } } } } },
      "required": ["source_role", "columns"] },
    { "properties": { "type": { "const": "metrics" },
        "items": { "type": "array", "minItems": 1, "maxItems": 8,
          "items": { "type": "object",
            "required": ["id", "label", "source"],
            "properties": {
              "id":    { "type": "string", "pattern": "^[a-z0-9_]+$",
                         "maxLength": 64 },
              "label": { "type": "string", "minLength": 1, "maxLength": 120 },
              "source": { "oneOf": [
                { "type": "object",
                  "required": ["kind", "artifact_role", "field"],
                  "properties": {
                    "kind": { "const": "artifact_field" },
                    "artifact_role": { "$ref": "#/$defs/roleName" },
                    "field": { "type": "string", "pattern": "^[a-z0-9_]+$",
                               "maxLength": 64 } } },
                { "type": "object",
                  "required": ["kind", "fact"],
                  "properties": {
                    "kind": { "const": "dash_fact" },
                    "fact": { "enum": ["run_count", "last_run_at",
                                       "last_run_verdict"] } } } ] } } } } },
      "required": ["items"] },
    { "properties": { "type": { "const": "note" },
        "text": { "type": "string", "minLength": 1, "maxLength": 400 } },
      "required": ["text"] }
  ]
},

"panelSectionOpaque": {
  "type": "object",
  "required": ["id", "type", "label"],
  "properties": {
    "id":    { "type": "string", "minLength": 1, "maxLength": 64 },
    "label": { "type": "string", "minLength": 1, "maxLength": 120 },
    "type":  { "type": "string", "minLength": 1, "maxLength": 64 }
  }
},

"roleName": { "type": "string", "minLength": 1, "maxLength": 64,
              "pattern": "^[a-z0-9_]+$" }
```

The `if/then/else` split is the versioning rule made structural. **Version 1
is validated strictly, with a closed type enum** — a typo'd section type is
refused at import, loudly, the way a widened `HOST_VERBS` fails its by-value
pin. **A version DASH does not know is accepted structurally and rendered as
one stated card** — "The agent's author declared a panel in a newer format
than this DASH can draw. Everything else on this page is unaffected." —
never partially, because a half-drawn panel is a guess rendered as a fact.
That keeps the contract's additive-versioning rule (`lib/contracts.ts:177`:
DASH ignores what it does not understand rather than rejecting the document)
without letting version 1 rot into leniency.

### What the five components mean, bound to machinery that already exists

- **`report`** — the newest artifact of the named role, rendered through the
  same artifact-card and digest machinery the run detail page uses, receipt
  included. This is Henrik's "custom output/report area," and for the AI News
  Scout it is one section: `{ "type": "report", "artifact_role": "digest" }`.
- **`outputs`** — `buildArtifactCards` filtered by role, capped by
  `max_items`. The existing Outputs area, placeable and scopeable by the
  author.
- **`table`** — rows from the newest JSON artifact of `source_role` whose
  body is an array of objects; a cell is an own-property lookup by `key`,
  rendered per `kind`; a value that is not the declared kind renders as
  absent, never coerced; rows past 200 are truncated **with the count
  stated**, because a silent cap reads as a complete record.
- **`metrics`** — labelled values from either a top-level field of a JSON
  artifact (`artifact_field`) or from the closed set of facts DASH itself
  observes (`dash_fact`: `run_count`, `last_run_at`, `last_run_verdict` —
  each already computed for existing views). The two sources render
  differently attributed: an artifact field is *the agent's report*; a dash
  fact is *DASH's record*. That distinction is `stated_at`/`received_at`'s,
  and collapsing it would let an agent's own number wear DASH's voice.
- **`note`** — a bounded block of author copy. It has the same standing as
  the manifest's `goal`: the author's words, rendered as the author's words.

Renderer rules, inherited verbatim from MAR-507 and MAR-434: `id` and every
technical name travel but never render; every rendered string is a text node
(no markup interpretation anywhere in the panel); a binding with no artifact
behind it yet renders a stated empty state, not a blank; cards, never a
table-of-everything; the panel renders inside one attributed region whose
header is DASH's copy, so everything inside it is visibly the author's
declaration and the agent's output, and nothing inside it can be mistaken
for a DASH verdict, permission card, or control. The vocabulary contains no
component that asks the user for anything — no button, no toggle, no input —
and that absence is the strongest claim in this ADR (see Security).

An invalid panel under `panel_version: 1` refuses the **import**, at the same
two doors as MAR-482, with a plain-language `lib/import-feedback.ts` case —
not discovered at render. A panel that validated and later meets a world it
did not expect (role never produced, field absent, body not an array)
degrades per section to the stated empty state. Nothing throws on a page a
user is reading; `describeArtifactRole` taking `string` rather than the union
is the precedent (`lib/views/artifacts.ts`).

## The MCP tool contract (spec only — the MCP repo is owned by a parallel session)

The tool is `export_build_brief`, which already emits the manifest, and the
change follows the `task_inputs` precedent mechanically:

1. **Input**: a new optional `agent_panel` field in
   `src/tools/exportBuildBrief.ts`'s `InputShape`, as a **`.strict()`** zod
   shape mirroring DASH's `$defs.panel` exactly — the only other `.strict()`
   schema in that surface is `TaskInputRoleInputShape`, whose comment states
   the rule: "validated at this boundary so a caller cannot emit a role DASH
   would refuse to parse… the emitter's job is to be honest, not
   permissive."
2. **Emit**: `buildAgentManifest` spreads `agent_dom.panel` **conditionally**
   — omitted when the caller declared nothing, mirroring
   `src/lib/observabilityContract.ts:817-819`. The honest default is
   absence. The emitter MAY derive a default panel only from facts the plan
   already declares — an `output_location`-bearing route gets a single
   `report` section — and derivation past that is refused rather than
   guessed, per the MAR-494 pattern ADR-MAR-470 records: an explicit
   caller-supplied signal, defaulting to the honest negative.
3. **Contract discipline**: the `$defs` are authored in
   `orchestratedash/contracts/agent.manifest.v2.schema.json` **first**; the
   MCP's pinned fixture, `contract.lock.json` hashes and `canonical_commit`
   update in one commit, or `pnpm dash:schema:check` fails by design. The
   conformance fixture and output-schema snapshots regenerate in the same
   change. No new tool, no output-schema change (`agent_manifest` is already
   `passthrough`), no transport change.

The planner side needs no contract at all: `plan_workflow` already knows the
route's output shape, which is exactly the information a derived `report`
section needs. "The MCP makes agent builds easy" becomes literal in one
sentence: the planner's export is a folder DASH can already render and run.

## Security: the folder is untrusted input, and here is the whole interpreted surface

The actual threat, named rather than gestured at: **the folder arrives from
an agent build.** It is the output of an MCP tool result, an LLM writing
code against a build brief, and whatever a human edited afterwards —
delivered over a `dash://` handoff. A hostile or merely bad build brief is
inside the threat model; MAR-487's helper already treats "a bug, a bad
manifest, or a hostile build brief" as the thing its closed verb set exists
for. So every byte in the folder is untrusted input, and the design question
is not "is the folder trusted" but "how many doors does untrusted input have
into something privileged." The answer this ADR commits to is **one**.

- **`code/` and `assets/` never cross.** No module in `lib/`, `app/` or
  `electron/` imports, evaluates, or interprets folder contents; DASH
  touches them only as bytes — hashed at import, hashed again at bundle
  assembly, streamed at deploy. The process that runs `code/` is a runner
  child with a scrubbed environment, which is the trust model every agent
  already runs under today. The folder changes where the bytes live, not
  what may execute them.
- **The manifest is the one door, and it already has a guard.** Ajv 2020
  `strict: true` against a schema DASH owns, then `checkManifestConstraints`
  for what schemas cannot say, then verbatim storage and typed projections.
  The panel adds vocabulary behind that same door; it does not open a
  second one.
- **The panel spec is data over a closed vocabulary.** What a panel can make
  DASH draw is one closed union, checkable by reading `$defs.panelSectionV1`
  — the same "complete answer in one array" standard `WRITE_PATHS` set. The
  absences are the argument: **no component takes a URL. No component takes
  markup. No component takes a path. No component takes an image. No
  component names another agent. No component asks the user for anything,
  and no event vocabulary exists.** A future component that wants any of
  those must widen a pinned union in a reviewed commit, which is the
  by-value-pin discipline doing its job.
- **Bindings name roles, never locations.** `artifact_role`, `source_role`
  and `field` are identifiers over an alphabet that cannot spell a
  separator, a traversal, or a URL — MAR-507's rule ("the renderer names a
  kind of file and never a file") applied to data binding. A panel cannot
  reach another agent's artifacts because the binding carries no agent: the
  renderer resolves roles against *this* agent's runs, the way the Outputs
  area already does.
- **Rendered strings are bounded and inert.** Every author string has a
  length cap in the schema and renders as a text node. An author can still
  *lie* in a `note` — "everything is fine" above a failing run — and the
  mitigation is attribution, not censorship: the panel region is titled by
  DASH as the author's own panel, DASH's verdict surfaces (compliance,
  grounding, receipts) render outside it, and no panel component can imitate
  them because the vocabulary cannot draw them. This is the same standing
  the manifest's `goal` has had since the first import.
- **Resource bounds are schema bounds.** Eight sections, eight columns,
  eight metrics, capped strings, a render-side row cap with the truncation
  stated, and artifact bodies already bounded by the existing artifact
  machinery. A spec that cannot describe an unbounded render is better than
  a renderer that defends against one.

**The escalation path is named and deferred.** If a genuinely dynamic panel
is ever worth having, the shape is a sandboxed iframe with no Node, no IPC,
and a typed message channel — decided separately, with its own ADR, its own
threat model, and its own answer to why the declarative spec was not enough.
It is deliberately not built first: shipped first, it would become the
default path, and every agent build would put code where the overwhelming
majority needed a declaration.

## The folder is the bundle: closing MAR-487's gaps without touching MAR-497

MAR-487's `assembleBundle` is a validator waiting for a caller, and the
caller is one new module: a producer that reads

1. the built runner artifact, `dist/runner-standalone/**` (`start.mjs`,
   `runner.mjs`, `contracts/`, `package.json` — the layout
   `scripts/build-runner-standalone.mjs:13-21` documents),
2. the agent folder, mapped under a fixed `agent/` prefix, and
3. **one generated registration** at `data/agents/{agent_id}.json`,

into `SourceFile[]` and hands it to `assembleBundle` unchanged. The
registration is derived from the folder's `registration.json` with paths
rewritten relative: `manifest_path` relative to the registration file
(`lib/registration.ts:64-72` already allows that), `cwd` pointing into the
bundle's `agent/` directory, `command: "dash:node"` untouched — ADR 0007
amendment 1 already established the sentinel resolves to the host's own Node
under the standalone runner, and this is the case it was kept for.

That closes the deploy plane's two open gaps in one move. The helper's
`start` verb already sets `DASH_RUNNER_DATA_DIR={bundleDir}/data`
(`scripts/host-helper/main.ts:269-307`), the runner already reads
`{dataDir}/agents/*.json` (`runner/main.ts:155`) — so **MAR-497's runner
consumes a folder-built bundle with zero changes**, which is the test of
whether the folder layout is right. The bundle's existing guards — per-file
SHA-256 computed at assembly, re-verified before write and again after,
per-segment path guard, mode allowlist, 64 MiB cap, MAR-482's refusal before
a byte ships — all apply to the folder's files because they apply to every
`BundleFile`, and nothing panel-shaped travels separately: the spec is in the
manifest, and the manifest was already going.

One sentence for the panel on a remote agent, because it falls out rather
than being built: **the panel is a property of the manifest, and its bindings
name roles, so the same panel renders whether the runs happened on this
machine or on a host** — DASH drains a remote runner's artifacts over the
ADR 0007 channel exactly as it drains local ones, and the renderer never
knew the difference. Bounded by what the host retained until DASH looked,
which ADR 0007 already says plainly.

## What this unlocks for MAR-545

MAR-545 is the agent as a thing you *use*: talk to it, hand it context and
files, get files and reports back. Three of its legs land on this ADR:

- **"Get files and reports back" gets its render target.** The panel's
  `report` and `outputs` sections are where a conversation's results appear,
  in the shape the author declared — an agent whose output is a report
  renders a report area, which is MAR-545's own phrasing of the requirement.
- **"Give it context and files" stays on the admitted path.** Conversation
  attachments ride the existing `task_inputs` admission — declared roles,
  main-process picker, runner-owned workspace — rather than growing a
  second file door. The folder does not change that path; it gives the
  declaration a home that travels.
- **The conversation surface arrives as vocabulary, not architecture.** A
  future `conversation` section type is a `panel_version` increment and a
  reviewed union widening — the versioning rule above was designed so
  MAR-545's UI lands as one more declared section bound to runner task
  routes, not as a parallel rendering system.

And the folder itself is the custody answer MAR-545 will need: a per-agent
place under DASH's keeping, admitted through one door, that deploys with the
agent unchanged.

## Alternatives rejected

**Agent-authored code in the renderer** — rejected in MAR-543's coordinator
recommendation before this ADR, recorded here because it is the alternative
someone will propose again: DASH's entire brand is honest supervision behind
a strict broker, and the privileged renderer is the one surface the user is
meant to trust. Arbitrary agent JavaScript there hands every agent a way
past the boundary. Not revisited.

**A sandboxed iframe now.** Covers the dynamic remainder, costs a full
security review, a typed message-channel contract, and a CSP story — and
shipped first it becomes the default path for the majority who needed five
declared sections. Deferred with a named bar, not refused forever.

**A separate `panel.json` beside the manifest.** A second author document
means a second validation door, a second verbatim-storage rule, a second
drift axis in the MCP fixture, and a second thing the handoff must carry.
The manifest already owns "what DASH renders about this agent"; the panel is
that, so it lives there.

**Markup or template components (`html`, `markdown_template`,
handlebars-style interpolation).** String-interpolated markup is code by
another name, and the first template engine in the privileged renderer is
the iframe decision taken by accident.

**The folder replaces SQLite entirely.** The row-as-index keeps `readStore`'s
damage tolerance, the single-transaction views, and the cheap list
projection; a filesystem-only store would re-earn each of those. The DB was
already a projection in spirit; this keeps its virtues and demotes its
standing.

**Panel bindings with JSON-path or expression syntax.** `field` is one
top-level key on purpose. A path language is an interpreter, interpreters
grow, and the first `$.items[?(@.price>10)]` is where "declarative" quietly
stops being checkable by reading a schema.

## What stops being proven, and what this costs

**Two stores can disagree, permanently.** The reconciliation rule is stated
above, but the *proof* that folder and row agree is only as fresh as the
last startup reconciliation; a folder edited on disk while DASH runs is
drift DASH discovers late. The honest rendering is the damage pattern, not a
lock DASH cannot hold over a directory the user can open.

**Migrated agents cannot deploy, and the refusal must say why.** A
manifest-only folder is a supported standing forever, not a transitional
bug; the deploy flow's sentence for it is part of slice 2's bar.

**An author's panel can editorialise.** Attribution and the no-controls
vocabulary bound what a panel can *do*; they do not bound what its `note`
can *claim*. DASH's own surfaces stay the verdict; this ADR accepts that an
agent page now contains more author voice than before, visibly marked.

**The panel's usefulness is bounded by the artifact contract.** `table` and
`metrics` read JSON artifact bodies; an agent that emits only prose gets a
`report` slot and nothing else. That is the right pressure — it pushes
builds toward structured artifacts — but it means v0 serves the sample
agents fully and serves an arbitrary agent only as well as its outputs
deserve.

**Nothing here is proven installed until the slices land.** This ADR ships
no code. The folder store, the migration, the renderer, the producer and
the MCP emitter each carry their own `merged`/`proven` bars in their own
issues, and the deploy half remains bounded by ADR 0004: nothing about a
remote host ever gets a blocking gate.

## Implementation slices, in order

1. **MAR-543a — schema first**: `$defs.panel` in
   `contracts/agent.manifest.v2.schema.json`, TS types beside
   `TaskInputRole`, validation + constraint tests, import-feedback case.
   DASH first, because the MCP's drift check pins DASH's copy by design.
2. **MAR-543b — the folder store and migration**: agents root, import
   materialises the folder, row demoted to index, reconciliation +
   damage surfacing, the function-form migration, component-guard
   constraint at import.
3. **MAR-543c — the panel renderer**: spec → trusted components over the
   existing artifact/outputs machinery; version-skew card; per-section
   empty states; render tests in both themes and densities.
4. **MAR-543d — the MCP emitter** (parallel session's repo; blocked by
   543a): `.strict()` input shape, conditional emit, fixture + lock +
   snapshot updates.
5. **MAR-543e — the bundle producer**: folder + runner artifact +
   generated registration → `assembleBundle`; closes MAR-487's producer
   and registration gaps; the manifest-only-folder refusal.

543a blocks everything; 543b and 543d can run in parallel after it; 543c
needs 543a only (a panel renders for a row-indexed agent the moment the
schema exists); 543e needs 543b.

## Amendment 1: one visibly DASH-authored, read-only disclosure (MAR-620)

Date: 2026-08-13

Status: Accepted

### The correction

The original decision says both that nothing inside the attributed region can
be mistaken for a DASH control and that the vocabulary contains no component
which asks the user for anything. Those claims still bar agent-authored
interactivity. They do not bar one disclosure whose complete authority stays
with DASH and whose only effect is revealing DASH prose.

**A read-only, DASH-authored disclosure may live inside the author's declared
region, but only as part of DASH's own stated empty-state renderer.** It is not
panel vocabulary. A manifest cannot request it, label it, fill it, move it,
suppress it, open it, or remember its state. Its summary and body come only from
`lib/copy/panel.ts`; its placement comes only from `StatedEmpty` in
`app/_components/panel.tsx`. Opening it reveals text. It performs no command,
submission, navigation, IPC, network request, stored mutation, or preference
write.

The visible distinction is a product requirement, not a code comment: the
summary is the fixed sentence **“DASH explains this empty section”**. A reader
does not have to infer authorship from colour, indentation, or the panel's DOM.
The affordance names DASH before it opens, and the prose behind it contains no
author-supplied string or produced value. The author's section label remains
above it as the author's label; DASH's distinct empty-state headline remains
open as DASH's finding about what is absent.

This is a narrow amendment to “no controls,” not a general class of safe panel
controls. The admitted element can change only its own expanded presentation.
Anything that changes DASH, an agent, a remote system, navigation, or a saved
preference remains outside the region. Anything whose label, content,
appearance, placement, initial state, or event is controlled by the manifest is
agent-authored interactivity and still requires the separately decided sandboxed
escalation path.

### Why the existing disclosures do not decide this

Digest source disclosures already appear in the region through the shared
artifact renderer. They are artifact-provided exceptions: their presence and
contents belong to an output contract that also renders on run detail and the
Outputs area. They are not panel vocabulary, and their prior existence is not
precedent for DASH adding arbitrary controls to an author-framed panel. This
amendment neither widens nor generalises that exception; it admits the empty
state disclosure on its own, stricter terms.

### Why the explanation stays per section

The panel cannot replace these disclosures with one shared empty-state sentence.
There are three materially different table facts: the bound artifact has not
arrived, the artifact arrived but is not a list, or the list contains no
readable rows. Report and outputs sections also distinguish a named role from
all output roles. One shared sentence would make those states sound equivalent
and undo the original decision that absence must be stated without being
invented. Each section therefore keeps its own headline and its own explanation;
only the explanation is closed by default.

### Markup and proof boundary

The disclosure is a block-level native `<details>` sibling after the headline
paragraph, never a descendant of `<p>`. Its `<summary>` is the fixed attribution
above, and its body is the matching `PanelEmptyState.meaning`. The existing
no-submit/no-mutation control gate remains valid: `button`, `input`, `textarea`,
`select`, and `form` stay absent — and it is now asserted on the *empty* fixture
too, which is the only markup where this disclosure exists and is therefore the
one the original gate never saw.

**The gate is `tests/panel-empty-disclosure.test.tsx`, and it exists because
this amendment's second answer is a sentence.** Every pinned-copy test in
`tests/` asserts over rendered markup with `toContain`, and relocated copy is
still in that markup — the property that makes the relocation honest is the
property that makes those gates blind to it. Measured rather than assumed: with
the attribution replaced by "Show more", with the headline and the explanation
swapped, with all five explanations deleted outright, with the summary sourced
from an author-reachable value, and with two empty states collapsed onto one
sentence, `tests/panel-render.test.tsx` and `tests/panel-view.test.ts` stayed
green at 81 passing tests on every one of the five, and the new file failed on
every one. A class name is not evidence a reader can tell who is speaking, so
the gate pins the sentence itself — in this document and in `lib/copy/panel.ts`
together, because a copy edit that touched only one would leave this decision
describing a product that no longer exists.

One cost this amendment accepts, recorded because no gate can refuse it: a
`report` and an unscoped `outputs` section share a headline, so the sentence now
closed by default is the *only* thing telling a reader whether the author bound
the section to one kind of output or to everything the agent makes. Closing it
does not delete the distinction and it does make it something a reader has to
ask for. The gate holds the two sentences distinct; whether that distinction
deserves to be on the surface is a copy decision for the next pass at this
region, not a boundary question this amendment can settle.

This is a renderer and copy change. It does not widen the manifest schema,
panel section union, artifact contract, IPC surface, or installed/runtime
authority. Source render tests can prove the markup and fixed attribution;
installed proof is not claimed until the packaged panel journey is exercised.
