# MAR-883 — agent display names, not ids, in the Connections row's button and sentence

Client: Claude Code, `claude --model sonnet`. Worktree
`C:\Users\henri\AppData\Local\Temp\wt-ux883-s1`, branch
`000henrik/mar-883-agent-labels`, off `origin/master` at `fab9dce`.

Lane N of the 2026-09-06/07 UX wave. Two sibling lanes ran in parallel on
MAR-881 (agent detail page) and MAR-882 (fleet page / chief chat) — nothing
here touches their files.

---

## 1. The defect, and where it actually lived

MAR-877's own handoff (§7.1) named the symptom exactly: on Settings →
Connections, the Gmail row's button read **GIVE IT TO MEETING-ASSISTANT** and
the consequence sentence read *"Connecting Gmail connects it for
meeting-assistant"* — the agent's folder id, not `agentDisplayName`'s answer,
on a guided surface. MAR-589's ruling is that a display name is the name and
an id is a value; both sentences broke it.

Grepping `Give it to` found **two** button call sites with the identical
defect, and reading the sentence beside each button found **two** more in the
sentences that name agents there:

| Sentence | Composed in | Fed by | Fix |
|---|---|---|---|
| `Give it to <agent>` (fleet card, AI tab) | `app/_components/fleet-connector.tsx` | `FleetConnectorView.waiting: string[]` (ids) | resolved against `connector.agents` (titles) |
| `Give it to <agent>` (merged row, Connections) | `app/_components/service-row.tsx` | `FleetConnectorView.waiting` via `row.fleet` | resolved against `fleet.agents` (titles) |
| `One sign-in connects … for <names>` | `lib/connectors.ts`, `describeSharedGrant` | `ConnectorTile.dependents[].agent` (id) | switched to `.title` |
| `Connecting … connects it for <names>` | `lib/fleet/grants.ts`, `describeFleetReach` | `FleetReach.materializes[].agent_id` | **not fixed — see §4** |

Three of the four were fixable inside this lane's ownership because the title
was already sitting on the same object, one property over — MAR-877 already
put a `title` beside every `agent`/`agent_id` in `FleetConnectorView.agents`
and `ConnectorTile.dependents`, and the id-leaking code simply wasn't reading
it. The fourth needs a title threaded in from a file this lane cannot write;
see §4.

## 2. What changed

**New: `shareLabel` in `lib/fleet/grants.ts`.**
One pure function, used by both button call sites, so there is exactly one
place the "which title, which suffix" decision is made and exactly one place
a future change to it has to happen:

```ts
export function shareLabel(
  waiting: readonly string[],
  known: readonly AgentIdentity[],
): string | null
```

- `waiting.length === 0` → `null` (both callers already skip drawing the
  button on `null`, same as their old `.length > 0` check).
- exactly one waiting agent → `Give it to <title>`, with the same folder
  suffix `lib/views/agent-labels.ts`'s `disambiguateAgentTitles` gives the
  per-agent list beside the button when two agents on the same card share a
  title (`Give it to Meeting Assistant — Meeting assistant 2`).
- more than one → `Give it to N waiting agents`, unchanged in shape — this
  half never leaked an id, and naming every waiting agent on a button is a
  different packet's decision.

`everyShareLabelSentence()` enumerates the three shapes for the copy sweep;
`tests/fleet-grants.test.ts` is new and runs `expectPlainLanguage` over it
plus pins the behaviour above directly.

**`app/_components/fleet-connector.tsx` and `app/_components/service-row.tsx`**
each now compute `give = shareLabel(waiting, agents.map(...))` once and render
`give` instead of interpolating `waiting[0]` or `waiting.length` directly. No
other behaviour changed — the button still fires the same `share` action with
the same id, and still does not render when nothing is waiting.

**`lib/connectors.ts`, `describeSharedGrant`.** The `names` list is now built
from `disambiguateAgentTitles(sharing.map(dependent -> {name: agent, title}))`
instead of `sharing.map((one) => one.agent)`, with the same
`title` / `title — suffix` rule `shareLabel` uses. `ConnectorDependent`
already carried `title` (`buildConnectorTiles` sets it from `agent.title`) —
this was a one-line read of a field that was already there.

## 3. Tests

- `tests/fleet-grants.test.ts` (new) — `shareLabel`'s four shapes (nobody
  waiting, one agent, one agent with a name collision, many agents) plus the
  copy-sweep gate over `everyShareLabelSentence()`.
- `tests/connectors.test.ts` — two new cases under "the disclosure that one
  sign-in serves two agents": names by title when id and title differ, and
  tells two same-named sharers apart by folder. Existing cases in this file
  used a fixture where `name === title`, so they did not change behaviour and
  needed no edits.
- `tests/fleet-connector-render.test.tsx` — the existing waiting-agent test
  now supplies a fixture where the id and title differ and asserts the button
  names the title (`Give it to News scout`), not the id; two new tests cover
  the same-name-collision case and the many-waiting count case.
- `tests/service-row-render.test.tsx` — same fixture fix and assertion on the
  merged row's own button.
- `tests/connections-list.test.ts` — not touched. That module builds
  `ServiceRow` data, not JSX; the button text is a render-level concern this
  lane's other three files already cover, and there was nothing there to pin.

### What was verified, and how

Run from **PowerShell** in the worktree.

| Command | Result |
|---|---|
| `pnpm typecheck` | clean |
| `pnpm brand:check` | passed — 12 characters, 96 frames, 4 bundled fonts |
| `pnpm vitest run tests/fleet-grants.test.ts tests/connectors.test.ts tests/fleet-connector-render.test.tsx tests/service-row-render.test.tsx tests/connections-list.test.ts tests/agent-labels.test.ts tests/fleet-connections.test.ts` | **7 files, 134 tests, all passed** |
| `pnpm test` | **279 test files passed, 5311 tests passed, 13 skipped, exit 0** |

No failing file, first run, no re-run needed. This was run before merging in
`origin/master`'s two new commits (MAR-881 merged, four session-prompt docs) —
see below.

**After merging `origin/master`** (fab9dce → d3ce841, MAR-881's own PR plus
session-prompt docs; no overlap with this lane's files — `git diff --stat`
confirmed), `pnpm typecheck` stayed clean and `pnpm test` was run again:
`tools/dash-mcp/tests/template-run.test.ts` failed 6/11 with
`EPERM, Permission denied` on `rmSync` in its `afterEach` — the exact
pre-existing "cleanup racing a live child" flake MAR-877's own handoff hit on
this same branch lineage (its §7.3) and MEMORY's MAR-702 note names. This
branch touches nothing under `tools/dash-mcp/**`. Re-run alone immediately
after: **11/11 passed**, confirming the flake rather than a regression. Full
counts both times: 279 test files, 5311 tests passed, 13 skipped — only that
one file's transient failure differed between the two full runs.

## 4. What is NOT done

**`describeFleetReach`'s `reach_sentence` still names agents by id.** This is
the fourth row in §1's table and it is the other half of MAR-877's own
complaint — the same "Connecting Gmail connects it for X" sentence pattern
Henrik saw, rendered from `fleet.reach_sentence` right beside `shared` in both
`app/_components/service-row.tsx` (line ~367) and
`app/_components/fleet-connector.tsx` (the wider-permissions box).

It could not be fixed inside this lane's ownership. `describeFleetReach`
(`lib/fleet/grants.ts:247`, owned) only receives `FleetReach.materializes:
Array<{agent_id, target}>` — no title — and that shape comes from
`fleetReach()`'s `FleetCandidate` input, which is `{agent_id, manifest}` with
no title either. The only place a title is available for these agents is
`lib/views/build.ts`'s `fleetConnectorViews()`, which already computes a
`titleByAgent` map (line 1353) for exactly this purpose and uses it to title
`agents`/`skipped` — just not the `candidates` array it also builds two lines
above, which is what `fleetReach`/`describeFleetReach` actually see.
`lib/views/build.ts` is outside this lane's ownership.

**The one-line fix, for whoever picks this up:** in
`lib/views/build.ts:1349-1352`, add a `title` field to each candidate:

```ts
const candidates = capable.map(({ name, manifest }) => ({
  agent_id: name,
  manifest,
  title: fleetAgentTitle(name, manifest, storedDisplayNames.get(name)),
}));
```

Then in `lib/fleet/grants.ts`: add an optional `title?: string` to
`FleetCandidate`, carry it into `FleetMaterialization`, and have
`describeFleetReach` read `one.title ?? one.agent_id` instead of
`one.agent_id` alone (kept optional/fallback so `lib/fleet/actions.ts`'s
`fleetReachNow` — which has no title source in `FleetActionDeps` and was not
touched here — keeps compiling and behaving exactly as it does today).

Doing this will also require updating
`tests/fleet-connections.test.ts`'s `"MAR-792: the reach sentence stops
naming an agent once it already has this"` test (around line 656), which
currently asserts `reach_sentence` contains the raw agent id
(`SCOUT = "news-scout"`) — once titled, that assertion needs to check for the
title (`fleetAgentTitle` humanizes an untitled agent's id, so the literal
substring `"news-scout"` will very likely stop appearing at all).

## 5. Needs orchestrator

1. **§4 above** — `describeFleetReach`'s `reach_sentence` still leaks an
   agent id into a guided-path sentence on the Connections page and the AI
   tab's fleet card. Same defect class as the two this lane fixed, same
   ticket's complaint, blocked only by `lib/views/build.ts` and
   `lib/fleet/actions.ts` being outside this lane's ownership. Worth a small
   packet of its own, or folding into whichever lane next touches
   `lib/views/build.ts`.
2. **`lib/fleet/grants.ts`'s `FLEET_SKIPS` export has no caller anywhere in
   the repo** (found while reading the module to place `shareLabel` beside
   `describeSkip`). It looks like the start of a copy-sweep enumerator for
   `describeSkip`'s three sentences that was never wired to a test — the
   `everyConnectSentence`-shaped pattern its own comment cites doesn't
   actually exist here. Not touched: out of this ticket's scope, and adding a
   real enumerator would be "also fixing" an adjacent gap. Worth a small
   packet if the plain-language sweep is meant to cover it.
3. No new ADR, no manifest v2 change, no migration — none were needed.
4. Nothing pending in `lib/views/types.ts`.

## 6. Evidence class

**Fixture tests only.** The render tests are `renderToStaticMarkup` over view
documents and prove markup and button text, not that a press against a real
store does anything — `runFleet`/`run` still call the same `share` action
with the same agent id they always did; nothing about *what* the button does
changed, only what it *says*. The installed Connections page, at any scale,
is the orchestrator's proof, per the lane brief.

## 7. Addendum (2026-09-07) — §4 closed, ownership extended to `lib/views/build.ts`

The orchestrator ruled §5.1 (§4's `describeFleetReach` id leak) back into this
lane's ownership before merge, naming `lib/views/build.ts` specifically. That
file is otherwise still not this lane's to write in general — this was a
one-ticket extension, not a standing grant.

**`lib/views/build.ts:1345-1367` (`fleetConnectorViews`).** `titleByAgent` is
now built directly from `capable` instead of from `candidates` (it never
needed `candidates` — `fleetAgentTitle` only reads `agent_id`, `manifest` and
`storedDisplayNames`), and `candidates` now carries `title:
titleByAgent.get(name)` alongside `agent_id`/`manifest`. Everything
downstream of `titleByAgent` (`agents`, `skipped`) is unchanged; `reach`
(from `fleetReach(connector, candidates, ...)`) is the only new reader of the
added field, by way of `FleetMaterialization.title`.

**`lib/fleet/grants.ts`.** `FleetCandidate` and `FleetMaterialization` both
gained an optional `title?: string` (optional because `lib/fleet/actions.ts`'s
own `candidates()` — untouched, no title source in `FleetActionDeps` — still
builds one without it, and must keep compiling and behaving exactly as
before). `describeFleetReach` now runs `reach.materializes` through
`disambiguateAgentTitles` exactly the way `describeSharedGrant` and
`shareLabel` do, falling back to `agent_id` per-agent when a given
materialization has no title. New `everyFleetReachSentence()` enumerator
(three shapes: one agent, a same-titled pair, three-plus) feeding
`expectPlainLanguage` in `tests/fleet-grants.test.ts`.

**`tests/fleet-grants.test.ts`** gained a `describe` block exercising
`describeFleetReach` directly (title-not-id, the same-name collision, and the
explicit fallback-to-id case for a title-less caller) plus the sweep over
`everyFleetReachSentence()`.

**`tests/fleet-connections.test.ts`**, the MAR-792 test: `before?.reach_sentence`
now asserts on `"News scout"` / `"News scout two"` (`fleetAgentTitle`'s
humanised fallback for `SCOUT`/`OTHER_SCOUT`, neither manifest declaring a
display name) and explicitly asserts the raw ids `SCOUT`/`OTHER_SCOUT` are
*absent* — inverting what the test checked for MAR-792's own invariant, which
is otherwise untouched: the sentence still disappears once every named agent
already has the credential.

### Verification

Run from **PowerShell**, `%TEMP%\dash-mcp-run-*` cleared first (MAR-702's
known cleanup-vs-live-child flake in `tools/dash-mcp/tests/template-run.test.ts`,
not touched by this branch).

| Command | Result |
|---|---|
| `pnpm typecheck` | clean |
| focused (`fleet-grants`, `connectors`, `fleet-connector-render`, `service-row-render`, `connections-list`, `agent-labels`, `fleet-connections`) | 7 files, **138 tests**, all passed (was 134 before this addendum — 4 new) |
| `pnpm test`, after merging `origin/master` (`00758df` — one file, `.orchestrate/state.json`, no overlap) | see the line below |

`pnpm test` result: **280 test files passed, 5321 tests passed, 13 skipped,
exit 0.** No failing file this run — `tools/dash-mcp/tests/template-run.test.ts`
(the MAR-702 flake from the earlier run in §4) was not red this time, so no
re-run-alone was needed.

### Needs orchestrator — updated

§5.1 is closed by this addendum. §5.2 (`FLEET_SKIPS` has no caller) and §5.3/§5.4
stand as written above.
