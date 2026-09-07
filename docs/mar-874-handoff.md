# MAR-874 handoff — the agent Settings stage

Worker lane G of the 2026-09-06 UX wave. Branch `000henrik/mar-874-agent-settings`,
PR [#332](https://github.com/orchestratemcp/orchestratedash/pull/332), based on
master and merged forward through MAR-875 (#328), MAR-871 (#325) and MAR-877 (#327).

## What changed

### The rule

Each section of the Settings stage shows its current state in **one sentence**
and offers **one action**; every explanation moves behind a `Why?` disclosure
that is closed by default. The order is:

1. **Name and character** — avatar, name, *Rename*, *Change*, on one row.
2. **Where it runs** — *This computer.* / *&lt;server&gt;.* with one
   switch-shaped press.
3. **When it runs** — the standing line, the radios, the time field, one *Save*.
4. **Which model it talks with** — four states, at most one press.
5. **Advanced** — collapsed: notifications, folder, repair, standing answers.
6. **Remove** — collapsed, at the bottom, both buttons.

**Nothing in `lib/copy` was deleted.** That is the load-bearing half and it is
test-enforced: `tests/agent-settings-shape.test.tsx` asserts that ADR 0029's
three liveness sentences, MAR-784's spending line and its bound, and MAR-589's
agent id are all still on the page and all still absent from the first screen.

### Files

| File | What |
| --- | --- |
| `app/_components/agent-settings.tsx` | Named slots (`where`, `model`, `advanced`, `danger`) replace one `children`; identity is one row; Advanced and Remove are `details`; new exported `WhyDisclosure`. |
| `app/_components/model-choice.tsx` | Four states; `ModelAdoption`; the picker opens on *Change*; `ModelPicker` exported so its invariants stay testable. |
| `app/_components/deploy.tsx` | State line; one switch-shaped action; receipt, warning-arm travel notice and sent-to card inside a `Why?` **above** the button. |
| `app/_components/repair-agent.tsx` | New `startable` prop decides the heading. |
| `app/agents/detail/page.tsx` | The `settings:` stage entry only. |
| `lib/copy/agent-page.ts` | `AGENT_SETTINGS_COPY.{why,advanced,model,where}`; `AGENT_TRIGGER_COPY.{liveness_on_host,time_hint_on_host,standing_on_host}`. |
| `lib/copy/repair.ts` | `heading_calm`. |
| `lib/views/models.ts` | The `adopt` field; two record reads to decide it. |
| `lib/views/agent-schedule.ts` | `resident_on`, `time_hint`, `residentHostLabel`, the `refused` tone. |
| `app/globals.css` | Append-only, fenced `MAR-874`, last. |

Tests changed or added: `agent-settings-shape.test.tsx` (new),
`model-render.test.tsx`, `repair-render.test.tsx`, `schedule-view.test.ts`,
`deploy-render.test.tsx`.

## The contradiction, answered

> Header says READY / LIVES ON Cloud while Settings says "This agent will not
> run" with *Repair*.

**The header is true. The Settings block was making a claim it had never
checked.**

`RepairAgent` drew the heading `This agent will not run` for **every** agent
with a folder in a window that could act. Its own docblock says why the
*control* is always offered — from the renderer a missing registration and a
stale one look identical, and a door that appeared only once DASH had diagnosed
a fault would be missing in every case nobody predicted, which is the class of
defect MAR-703 was. But the *heading* is a claim, and it had no predicate behind
it at all: `hasFolder && canAct` is not a diagnosis.

DASH does hold the predicate. `WorkspaceView.startable`
(`lib/views/build.ts:1865`, `readRegistration(dataDir, agent) !== null`) is
whether DASH holds a registration naming a program it could spawn, and it is the
same fact `AGENT_CONTROL_COPY.idle.not_reported` already speaks from on the Run
stage. A deployed agent keeps its local registration, so for
`proof-scout-mar861` `startable` is true and the alarm was false.

The heading is now that predicate. The control did not move and was not taken
away. Pinned by `tests/repair-render.test.tsx` → *"says an agent will not run
only when DASH cannot start it"*, which also asserts the button, its detail line
and its promise about the folder are identical in both states.

**Not proven on the live case.** The fixture reproduces both states and the
predicate is read from the field the live view populates, but nobody has opened
the installed DASH against `proof-scout-mar861` since the change. See *Evidence
class*.

## A second wrong-machine defect, found while moving the liveness sentences

The brief flagged `AGENT_TRIGGER_COPY.liveness` sentence three as
"conditionally wrong for an enrolled host". It is wider than that: **all three
sentences, the standing line and the time hint** named *this computer*, and for
an enrolled agent every one of them is about the wrong machine.
`splitSchedules` (`electron/host-residency.ts`) takes an enrolled agent's
schedule **out** of the local runner's push and sends it to that server's own
runner, deliberately, so that one instruction cannot produce two runs. Sentence
two was promising a helper on a laptop that is no longer told about the row;
sentence three was warning about that laptop being asleep.

`AgentScheduleView` now carries `resident_on` and `time_hint`, and
`buildAgentScheduleView` takes a `residentOn` argument (defaulted null) and
words all five sentences for the machine that will honour the schedule.

**The predicate is residency, not deployment.** Residency is a switch that is
off until somebody presses it, so an agent merely *sent* to a server still runs
its schedule here. `residentHostLabel` therefore takes the resident set
(`readResidentHosts()`), which is the same set `splitSchedules` partitions the
push with — so the panel and the push cannot name different machines.

**MAR-872 is not attempted.** `at_local` still carries no timezone and on a
server still means that server's local time. This only stops naming the wrong
clock, which is the half that can be said truthfully today. Saying *by that
server's clock* is precisely the warning a person setting 20:10 needs before
MAR-872 converts it for them.

`refused` ("Did not start") left the error colour for amber. Red on this page
has to mean *you have something to fix*, and the case this issue was filed from
is one the person cannot act on — the remote start is MAR-864's gap. The
sentence is unchanged; `detail` is still the runner's own words, verbatim.
A tone per refusal reason needs the settlement to carry one and it does not.

## The model row

`buildAgentModelSettings` gained one field, `adopt`, non-null in exactly one
situation: the agent declares a model provider, DASH holds no key of its own,
**and** a fleet connection for that provider exists. Two record reads decide it —
`fleetConnectorFor(provider)` and `readFleetConnection(provider)` — which is the
same pair `adoptFleetCredential` itself opens with, so the view cannot promise a
press that function would decline.

The press is `submitConnectionCommand("connect", …)` against the agent's own
`model_provider` row. `performConnectionAction`
(`lib/connection-actions.ts:462-467`) has routed that through
`adoptFleetCredential` since ADR 0013 moment 2. **No new command, no new power.**
No fleet credential is read, `resolveKeyGrant` is untouched, the `no_provider`
gate in `lib/views/ask.ts` is untouched, and the field carries an address only —
never a credential, never a masked hint, never a claim that the key works.

### One deliberate deviation from the brief

The **cannot talk** state keeps `describeNoChoice`'s existing `no_provider_key`
sentence rather than the proposed *"This agent was built without a model, so it
cannot answer questions."*

`lib/ai/model-choice.ts` states, in as many words, that the manifest does **not**
distinguish "the agent arranges its own model" from "it names a service DASH has
not been built to ask", and that DASH must not guess which it is looking at. The
proposed sentence asserts the first. Writing it would have made this stage assert
exactly what the trusted side refuses to. `lib/ai/model-choice.ts` is also
outside this lane's ownership. `tests/model-render.test.tsx` → *"does not claim
an agent was built without a model"* now stops a later pass from adding it
without reading this paragraph.

If Henrik wants that sentence, the honest way to it is a manifest field that
distinguishes the two cases — which is a schema change and an ADR, not a copy
edit.

## Verified, and how

Run from PowerShell in `C:\Users\henri\AppData\Local\Temp\wt-ux874-s1`.

```
pnpm typecheck                     → clean
pnpm brand:check                   → passed (12 characters, 96 frames, 93 files)
pnpm vitest run tests/agent-settings-shape.test.tsx tests/model-render.test.tsx
  tests/schedule-view.test.ts tests/repair-render.test.tsx
  tests/deploy-render.test.tsx tests/copy-agent-page.test.ts
  tests/model-choice.test.ts tests/schedule-allowance.test.ts
  tests/folder-repair.test.ts tests/standing-answers.test.ts
  tests/sample-refresh.test.ts    → see the PR for the summary line
pnpm test                          → see the PR for the summary line
```

### Evidence class

**Fixture tests and a typecheck. Nothing runtime, and no frames.**

- No scratch-store capture was taken. `electron/capture-cockpit.ts` shoots the
  settings stage and the brief asked for a scene covering a deployed +
  scheduled agent and the four model states; that is not done. The one-screen
  claim is therefore a **sentence count with disclosures closed**
  (`tests/agent-settings-shape.test.tsx`), not a measured 1280px frame.
  Screenshots find what measurements cannot, and this packet has neither.
- The READY/"will not run" answer is proven against a fixture and the field the
  live view populates. It has not been read off the installed shell.
- The adoption press has never been fired against a real fleet key. What is
  proven is that the view offers it in exactly the state
  `adoptFleetCredential` would accept, and that the renderer calls the existing
  command. Whether `materialize` produces a record for a given agent is main's
  business and is unchanged.
- The residency sentences are proven against `buildAgentScheduleView` fixtures
  and `residentHostLabel` unit tests. No agent has actually been enrolled on a
  host and had its panel read.

## Needs orchestrator

1. **Three files outside this lane's ownership list were touched.** All
   additive, all small:
   - `lib/views/types.ts` — the optional `adopt` field on
     `AgentModelSettingsView`'s no-choice arm. Extending the view, which the
     lane brief asked for, is impossible without it. Optional rather than
     required so that no fixture elsewhere in the repository has to restate
     "nothing to adopt".
   - `lib/views/build.ts` — two import lines and one argument, passing
     `residentHostLabel(agent, readResidentHosts(), readHost)` into
     `buildAgentScheduleView`. Without it the residency sentences exist and are
     tested but never reach a screen.
   - `app/globals.css` — append-only and fenced, as the wave rules allow;
     recorded here only because the merge with #325 and #327 conflicted and was
     rebuilt by parsing rather than splicing (master's file, then this block
     appended). Order in the merged file: MAR-875, MAR-871, MAR-877, MAR-874.
2. **The frames are owed.** `electron/capture-cockpit.ts` needs a scene for a
   deployed + scheduled agent and one per model state, run at 1280 with a
   scratch `DASH_DATA_DIR`, `DASH_CAPTURE_DIR` and `--user-data-dir`. Until then
   the one-screen target is asserted and not photographed.
3. **The attended proof is yours.** A person who has never seen DASH should be
   able to say where the agent runs, when, and on which model without opening a
   disclosure. The budget test is a proxy for that, not a substitute.
4. **`AGENT_SETTINGS_COPY.where` has no null-safety on multi-server labels**
   beyond `?? ""`. Two servers renders a count, which is deliberate — see the
   copy's own note — but nobody has looked at the two-server case on screen.
5. **Consider whether `refused` should be amber everywhere.** This packet
   changed it in `lib/views/agent-schedule.ts` only. If a settled window's
   refusal reason ever becomes readable, a tone per reason is the better answer
   and this becomes a stopgap.

## The one thing the next session should do first

Take the capture. Everything in this packet is a claim about what a person sees
on one screen, and the only evidence behind that claim is a count of sentences
in a string. Extend `electron/capture-cockpit.ts` with a deployed + scheduled
agent, shoot the settings stage at 1280 with every disclosure closed, and look
at it. Screenshots find what measurements cannot — four defects in an earlier
wave had no overflow to measure — and this stage is going on camera.
