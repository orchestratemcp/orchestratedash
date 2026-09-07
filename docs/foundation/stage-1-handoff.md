# MAR-887 handoff — stage 1: extract the runtime, preserve behaviour

**Epic:** MAR-886. **Issue:** MAR-887. **Branch:** `000henrik/mar-887-agent-sdk`
(from `codex/agent-foundation`, PR against `master`). **ADR:** 0034.

## What changed

There were two copies of the agent runtime and no shared module. There is now
one file, `agent-kit/template/dash-agent-sdk.mjs`, which both templates import
by relative path and both scaffolders and the packaged shell write verbatim.

| File | What happened |
| -- | -- |
| `agent-kit/template/dash-agent-sdk.mjs` | **New.** 770 lines: the runner protocol, telemetry v1, the digest and brief artifacts, the broker channel, the browser channel, the command acknowledgements, the idle state machine, SIGTERM, and the brief fingerprint. Node builtins only. |
| `agent-kit/template/agent.mjs` | 1060 lines to 554. Header, definition, `runOnce`, sources, feed parsing, curation. No mechanics. |
| `tools/dash-mcp/template/agent.mjs` | 743 lines to 416. Same shape, keeping its model-free brief composition. |
| `tools/dash-mcp/template/brief-fingerprint.mjs` | **Deleted.** Absorbed into the runtime, which already carries the same *do not edit* warning. |
| `agent-kit/scaffold.ts`, `cli.ts`, `open-in-dash.ts` | `TemplateSources` gained `sdk`; the plan writes it; `AGENT_KIT_PROJECT_FILES` marks it `required`. |
| `tools/dash-mcp/src/{scaffold,agent-tools,handoff}.ts` | Writes the runtime instead of the fingerprint file, read from `agent-kit/template/` so there is one source of truth. |
| `electron/sample-agent.ts`, `scripts/build-shell.mjs` | Both files are candidates, both are read, both are copied into `dist/electron/agent-kit/`, and `assertSampleTemplatesPresent` fails startup without either. |
| `tests/fixtures/legacy-agent-kit-template.mjs` | **New.** `agent-kit/template/agent.mjs` at `cb2cb1c`, verbatim, plus a header saying not to refresh it. |
| `tests/legacy-agent.test.ts`, `tests/agent-sdk.test.ts` | **New.** See below. |
| `docs/adr/0034-*.md`, `docs/foundation/sdk-upgrades.md` | The decision, the rejected alternatives, the versioning rule. |

Commits: `9d2d9cc` (the extraction), `432c02f` (existing pins), `4109dfa` (the
two new test files), `b3a3153` (docs).

## Why one file inside the folder rather than a package

`agent-kit/scaffold.ts` writes `dependencies: {}` on purpose and the packaged
sample is copied as raw bytes by `scripts/build-shell.mjs` into a folder in the
user's Documents. There is no install step anywhere in the installed journey and
no place to put one a person would forgive, so the runtime cannot be an npm
dependency. Bundling it into `agent.mjs` at scaffold time was the other
candidate, and it destroys the property the split is for: a runtime fix that can
reach an agent somebody has been editing for months without touching their file.
ADR 0034 has the full argument.

The MCP package reads the runtime from `agent-kit/template/` rather than keeping
its own copy. It already reads its templates from the checkout at scaffold time,
so this costs nothing, and a second copy in `tools/dash-mcp/template/` would be a
fork that looks maintained — the shape ADR 0032 decision 4 already refuses for
the validator.

## What was verified, and how

**`pnpm typecheck`** — clean.

**Focused suites** (PowerShell):

```
pnpm vitest run tests/agent-kit.test.ts tests/agent-sdk.test.ts \
  tests/legacy-agent.test.ts tests/sample-agent.test.ts tests/sample-refresh.test.ts \
  tests/scout-curates.test.ts tests/conformance-v2.test.ts tests/runner-protocol.test.ts \
  tests/runner-telemetry.test.ts tests/protocol-client.test.ts tests/open-in-dash-url.test.ts
  -> Test Files 11 passed (11) | Tests 125 passed (125)

pnpm vitest run tools/dash-mcp/tests
  -> Test Files 10 passed (10) | Tests 144 passed (144)
```

**`pnpm build:agent-kit`**, then the real CLI against a scratch directory:

```
node agent-kit/dist/cli.mjs <scratch>\smoke-scaffold
```

wrote `agent.mjs`, `dash-agent-sdk.mjs`, `agent.manifest.json`, `package.json`,
`sources.json`, `README.md`, `.gitignore`, `scripts/open-in-dash.mjs`.

**`pnpm build:renderer; pnpm build:shell`** — `dist/electron/agent-kit/` holds
`agent.mjs` (20730), `dash-agent-sdk.mjs` (31063), `open-in-dash.mjs`.

**The installed-style shell smoke, on a scratch store:**

```
$env:DASH_DATA_DIR='<scratch>\orchestratedash'; $env:DASH_SHELL_URL='dash-app://ui/'
pnpm exec electron dist/electron/smoke.mjs --user-data-dir=<scratch>\orchestratedash
```

**85 PASS / 0 FAIL**, `[smoke] all proofs passed`. The runner was retired with
`node scripts/retire-scratch-runners.mjs` (status 202, `RETIRED`). The 6* block
is the one that matters here, and three lines in it are the proof this packet
needed:

- `6b` — the handoff the installed build creates lists
  `{"path":"dash-agent-sdk.mjs","bytes":30981}` beside `agent.mjs`.
- `6c-f` — DASH's own stored copy accepted `code/dash-agent-sdk.mjs` with its
  hash, so the runtime travelled through the real import rather than being
  assumed.
- `6d`, `6e`, `6f`, `6g`, `6h`, `6i`, `6j`, `6k` — the sample waited to be asked,
  nothing ran on its own, Run now was accepted through the audited bridge,
  telemetry rendered with `compliant: true` and no sequence gap, the digest
  reached both the folder and DASH, and the run detail page drew it. That is the
  acceptance sentence, run against a real generated agent through the SDK.

**Evidence class: fixture tests plus an installed-style shell on a scratch
store.** No proof on Henrik's installed build; that is the orchestrator's. The
real store at `%APPDATA%\orchestratedash` was never opened.

## Deviations from the lane brief, and why

1. **No `sdk_version` on `run_started`.** The brief allowed it if the additive
   rule stayed green. Left out: the whole claim of this packet is that the
   runner sees nothing new, and spending it on a field nothing reads is a bad
   trade. Recorded in ADR 0034 as a rejected alternative.
2. **The upgrade mechanism is documented, not built.** The brief made it
   conditional on `lib/sample-refresh.ts` already having a hook. It does not —
   that module refreshes a *manifest* and never touches a file in a stored
   folder. `docs/foundation/sdk-upgrades.md` says so and says what the packet
   that builds it has to decide.
3. **Two small convergences between the templates**, both listed here because
   "byte-identical" was the instruction:
   - The runtime logs the manifest-missing warning that only the MCP template
     used to log. It fires only when no manifest can be read, which is a case
     neither template's tests reach, and its absence in the kit's copy was a gap
     rather than a decision: an artifact from an agent that cannot read its own
     name is silently discarded by DASH either way.
   - `brief()` reads `emitted.digest.items ?? []` where the MCP template read
     `.items` and would have thrown. Unreachable from either template; a shared
     runtime should not throw on a field a caller omitted.
4. **`tools/dash-mcp/src/agent-tools.ts` was edited**, and it is not named in the
   lane's ownership list. It is where `readTemplates()` and the folder notes
   live, so the design item "the MCP scaffolder writes the same SDK file" cannot
   land without it. No other file outside the list was touched.

## What is NOT done

- **No upgrade mechanism.** See deviation 2.
- **No change to the runner, the broker, the contracts, `lib/analyze.ts` or any
  app surface.** Deliberately: this packet's claim is that none of them needed
  one.
- **Nothing published.** `agent-kit/package.json` is still `private: true`.
- **`tools/dash-mcp/build.mjs` is unchanged.** The runtime is read from the
  checkout at scaffold time rather than bundled, so there was nothing to add.

## Surprises worth passing on

- **The two templates disagreed about `generated_at`.** The kit's `artifact()`
  spread the author's digest and stamped nothing; the MCP's `digest()` stamped
  the moment it sent. A shared `digest()` that always stamped would have moved a
  key in the kit's JSON. It now stamps only when the body has none, so both
  emit exactly the keys they emitted before, in the same order.
- **They also disagreed about progress.** 0.4 per step against 0.3, because one
  has two steps and the other three. `stepProgress` is in the definition and
  both templates pass theirs explicitly.
- **`tests/scout-curates.test.ts` copied `agent.mjs` alone into a temp folder.**
  With a relative import that is a process that dies on its first line, and the
  symptom is a test that times out waiting for an artifact rather than one that
  says what happened. Any future harness that copies the program must copy both
  files; `AGENT_KIT_PROJECT_FILES` and `assertSampleTemplatesPresent` are the two
  places that now say so in code.
- **A Python edit script written to disk mangled em dashes** on this machine,
  while the same string passed inline to `python -c` did not. Anything that
  rewrites this repository's prose from a script file should use `—` or work
  inline.

## The one thing the next session should do first

Read `docs/foundation/sdk-upgrades.md`'s "What is deliberately not built yet"
and decide whether stage 2 wants the folder-swap upgrade. Everything else in
stage 2 — the LLM-friendly generator and the build recipe — now writes into a
template that is task logic only, which is what makes "which files should the
model edit" answerable in one sentence.

## Needs orchestrator

1. **ADR number.** 0034 was free at `ls docs/adr` on 2026-09-07 and is taken by
   this packet. If a parallel packet also claimed it, this one renames.
2. **`origin/master` moved** to `f942576` (MAR-886 stage 8, docs only) while this
   lane ran; it is merged into this branch and nothing conflicted.
3. **`.orchestrate/state.json` and `PROJECT_STATE.md` are untouched**, per the
   lane rules. MAR-887's entry is yours to promote.
4. **The installed-build proof is yours.** This lane's shell evidence is a
   scratch store at `%TEMP%\f1-scratch\orchestratedash`, which can be deleted.
