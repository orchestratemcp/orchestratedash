# MAR-878b handoff — truthful readiness, chat capability and recovery

Lane H of the 2026-09-06/07 UX wave (UX-5, page + chief half). PR #329,
branch `000henrik/mar-878b-readiness`. The template-prerequisite half of
MAR-878 is lane B's PR #320 and is not touched here.

## The defect, restated

Proof Scout's page showed a header chip reading **READY** beside a footer
reading *"Proof Scout has no way to answer questions."* — next to a button
labelled OPEN CHAT. Both sentences were true. They answer different questions,
and the page had a word for only one of them. Three facts were collapsed into
one:

1. **Runtime state** — READY / RUNNING / STOPPED / NEEDS ATTENTION. Whether
   DASH can make the agent run its own plan. `lib/views/agent-control.ts` owns
   it and this packet does not change it.
2. **Capability** — whether the agent can be *asked a question*, a different
   feature reached by a different door and gated on a model provider, a key, a
   model name and something saved.
3. **The unmet requirement** — when it cannot, the one thing that would change
   that, with the one action that meets it.

## What changed

| File | What |
| --- | --- |
| `lib/copy/ask.ts` | `AskCapability`, `AskCapabilityReason`, `AskCapabilityAction`, `describeAskCapability`, `ASK_CHIEF_ENTRY`, `ASK_CHIEF_ENTRY_DETAIL`, `describeAskKeyLapse`, `everyAskCapabilitySentence` |
| `lib/views/ask.ts` | `resolveAskGate` lifts the four refusals out of `buildAgentAsk` in the same order; `askCapabilityFor` exposes the answer to callers that do not want a chat view; `capability` lands on both arms of the view |
| `lib/views/types.ts` | `capability` on both arms of `AgentAskView`; `ask` on `ChiefReceiptRow` |
| `app/_components/agent-header.tsx` | `CapabilityChip`, drawn beside `StatusPill` in every state |
| `app/_components/ask.tsx` | the footer says capability + requirement + action + chief entry; the Chat-stage fix-it card leads with the same chip and carries the same chief entry |
| `app/agents/detail/page.tsx` | one prop: `capability={view.ask.capability}` on the header |
| `lib/copy/agent-page.ts` | `capability_label: "Questions"` |
| `lib/chief/briefing.ts` | `ChiefBriefingRow.ask`; `briefingFor` takes an optional capability lookup; `renderBriefing` writes a `Questions:` line; `sameRow` compares it |
| `lib/chief/store.ts` | `parseAsk` — a stored receipt with no ask block reads as null |
| `lib/views/chief.ts` | `askCapabilities` resolves the lookup and hands it to `briefingFor` |
| `app/globals.css` | one appended fenced `MAR-878` block, last after MAR-875, MAR-871, MAR-877 and MAR-874 |
| tests | new `tests/ask-capability.test.ts`; fixture updates in `agent-about`, `agent-cockpit-render`, `ask-render`, `composer-shared`, `chief-briefing`, `chief-harness`, `chief-runner` |

Commits: `2f0fe3d`, `943dd69`, `9c0deb9`, `eb69eae`, `2bb4dc7`, plus three
`origin/master` merges. Head `2bb4dc7`.

## The six states, as tuples

`(header, footer_sentence, action, chief_line)`, asserted by value in
`tests/ask-capability.test.ts`. `chief_line` is pulled back out of
`renderBriefing`, so what is pinned is the string that goes to the model.

| State | header | footer sentence | action | chief line |
| --- | --- | --- | --- | --- |
| Non-chat agent (declares no provider) | `Ready` | `Proof Scout has no way to answer questions.` | `Ask the chief about this agent` | `Questions: Proof Scout has no way to answer questions. Nothing to do here. Whoever built Proof Scout would have to give it one.` |
| Declares a provider, no key, **a fleet key exists** | `Ready` | `Scout can answer questions once Your model provider is connected.` | `Connect Your model provider` | `Questions: Scout can answer questions once Your model provider is connected. Connect Your model provider.` |
| Declares a provider, no key, **no fleet key** | `Ready` | *(identical to the row above)* | *(identical)* | *(identical)* |
| Key connected, no model named | `Ready` | `Scout has not been told which model to answer with.` | `Choose a model` | `Questions: Scout has not been told which model to answer with. Pick a model further up this page.` |
| Configured, nothing saved | `Ready` | `Scout has not saved anything yet.` | `Run it once` | `Questions: Scout has not saved anything yet. Run Scout once, then come back and ask.` |
| Provider key lapsed (held, last check refused) | `Ready` | `Scout can answer questions about what it has saved.` | `Ask` | `Questions: Scout can answer questions about what it has saved. Type a question in the box at the bottom of this page.` |
| Stopped agent with saved output | `Offline` | `Scout can answer questions about what it has saved.` | `Ask` | *(same as the row above)* |
| Fully configured | `Ready` | `Scout can answer questions about what it has saved.` | `Ask` | *(same)* |

The lapsed row additionally carries
`caution: "Your model provider turned this key down the last time DASH checked, so a question may not get through."`
The header for a lapsed key is unchanged, deliberately: a stale liveness record
is not a runtime fact.

## Two findings worth keeping

**Rows 2 and 3 are identical on purpose.** UX-5's acceptance says "never read a
fleet credential directly to conceal missing agent authorization". DASH
therefore does not look for a fleet key to soften an agent's own missing one,
and the two situations produce one tuple. `tests/ask-capability.test.ts` asserts
the two are `toEqual` each other rather than asserting each separately, so a
future change that tries to distinguish them fails there.

**A lapsed key is a caution, never a fifth refusal.** `electron/ask-host.ts` is
untouched and would still send the question, so a page that refused a held-but-
lapsed key would refuse what main would answer — the inverse of the rule the
gate order exists for. It is said beside the capability instead.

## Verified, and how

Run from PowerShell in `C:\Users\henri\AppData\Local\Temp\wt-ux878b-s1`.

- `npx tsc --noEmit -p tsconfig.json` — clean, after each of the three merges.
- `pnpm brand:check` — `✓ brand:check passed — 12 characters audited …`
- `pnpm test` (first run, before the CSS fix below):
  `Test Files 3 failed | 273 passed (276)` / `Tests 8 failed | 5238 passed | 13 skipped (5259)`.
  One was real — `tests/panel-render.test.tsx` slices `app/globals.css` from the
  panel's comment to the end of the file, so its "only the 4px grid and the
  density tokens on space" gate applies to every block appended after it, and
  the MAR-878 block was spending raw `rem` lengths. Fixed in `eb69eae`. The
  other seven were `tools/dash-mcp/tests/template-run.test.ts` and
  `tests/store-damage.test.ts`, which both pass when re-run alone
  (`EPERM` in `afterEach`'s `rmSync` — the documented live-child race).
  `git diff origin/master -- tools/` is empty, so nothing of this packet is
  involved in them.
- `pnpm test` (after the fix): `Test Files 276 passed (276)` /
  `Tests 5246 passed | 13 skipped (5259)`.
- Focused after the final merge of MAR-874: `ask`, `ask-render`,
  `ask-capability`, `chief-briefing`, `agent-cockpit-render`, `agent-about`,
  `composer-shared`, `panel-render`, `agent-checklist`, `agent-control` —
  `10 passed`, `222 passed`.
- Frames: `pnpm build:renderer && pnpm build:shell`, then
  `electron dist/electron/capture-ask.mjs --user-data-dir=…\wt-ux878b-s1-capture\ud`
  with `DASH_DATA_DIR=…\wt-ux878b-s1-capture\store` and
  `DASH_CAPTURE_DIR=qa-screenshots-mar-878`. 34 PNGs + `layout.json`, all five
  capability states at 375/768/1280 in both themes. The harness's own proofs
  hold: `input_drawn: false` and `blocked_next_action: true` on every blocked
  scene, `page_overflows: false` everywhere. (`widest_overflow_node` is
  `span.visually-hidden` throughout, which clips itself and is not a defect.)
  The harness left no runner behind — no `wt-ux878b-s1` Electron process
  survived the run.

`qa-screenshots-mar-878/ask-no-provider-1280-light-comfortable.png` is the
issue in one picture: **NOT REPORTED** beside **QUESTIONS Built without a
model**, over a fix-it card that names the chief.

## Evidence class

**Fixture tests plus scratch-store capture frames.** Nothing here is proof on
the installed build. Specifically not proven:

- That a real question reaches a real provider after adoption. That is the
  orchestrator's, on the installed store, and is UX-5's remaining acceptance.
- That the chief's *answer* points somewhere useful. What is proven is that the
  briefing string contains the page's own requirement and recovery sentences;
  what a model does with them is not tested and cannot be by a fixture.

## What is NOT done

1. **The chief entry does not carry the agent into the composer.** The design
   asks for "opens the fleet composer with this agent in context". The fleet
   page reads no search params and `Composer` has no prefill prop, and both
   `app/page.tsx` and `app/_components/chief-chat.tsx` are outside this lane's
   ownership. The link goes to `/`, where the composer is, and the briefing for
   whatever is asked there already carries this agent's capability. **Needs
   orchestrator** — one small packet on those two files.
2. **The two Electron chief hosts do not fill the capability lookup.**
   `briefingFor`'s second argument is optional and defaults to an empty map, so
   `electron/chief-host.ts:139` and `electron/chief-discord.ts:320` still send
   briefings with `ask: null` — the chief in the desktop window and in Discord
   is not yet told. `electron/**` is on this lane's do-not-touch list. The fix
   is one argument at each call site:
   `briefingFor(agents, askCapabilitiesFor(agents))`, where the helper is the
   four lines of `askCapabilities` in `lib/views/chief.ts`. **Needs
   orchestrator.** `lib/views/chief.ts` is wired, so `fleetChangedSince` and
   the receipt comparison are already capability-aware.
3. No installed-build run, no `verify:shell`, no smoke.

## Deviations from the lane's design, recorded

- The design's five capability labels named *"Needs a model provider"* with a
  link to Settings → AI. There is no gate for that: `no_provider` is the
  author's omission (labelled *Built without a model*, no repair) and
  `no_model_chosen` is a missing model **name** with a key already held. That
  one is labelled **"Needs a model picked"** and its action goes to the agent's
  Settings stage, where the picker is.
- The footer's controls are links rather than presses. `AgentChatBar` has
  refused to carry the connect button since MAR-641 — "a bar that showed the
  button without the two sentences would be offering a consequence without its
  explanation" — and that rule is kept. What changed is that the link now names
  the act it leads to instead of saying "Open chat", which is
  `AgentChecklistStep.action`'s established shape.
- The Chat-stage fix-it button still says the whole `next_action` sentence, not
  the short label. It *performs* the act, so the sentence and the control are
  one thing; the short label is for the footer, where the control is a pointer.
- MAR-874's adoption press was checked rather than assumed: `model-choice.tsx`
  calls `submitConnectionCommand("connect", { agent_id, connection_id,
  field_id })`, which is character-for-character what `AskThread.connect()`
  already called. There is one command and no second path.

## The one thing to do first

Wire the two Electron chief hosts (item 2 above) — it is one argument each and
it is the difference between the chief *being able* to say why an agent cannot
be asked something and actually being told. Then take the real-question proof
on the installed build.


## Addendum — the two Electron chief hosts are wired (ownership extension)

The orchestrator extended this lane to cover item 2 of "What is NOT done",
because without it the acceptance line *"chief receives the same
capability/refusal facts"* is not true on the installed build. Done:

| File | Change |
| --- | --- |
| `lib/views/chief.ts` | `askCapabilities` renamed and exported as `askCapabilitiesFor(agents)` |
| `electron/chief-host.ts` | `briefing: briefingFor(agents, askCapabilitiesFor(agents))` (:146) plus the import |
| `electron/chief-discord.ts` | the same two lines (:327) |
| `tests/ask-capability.test.ts` | one case driving the composition the hosts use, end to end over a fixture store |

Nothing else in `electron/**` was touched.

The new test is the guard the previous ones could not be. `briefingFor`’s
lookup defaults to an empty map, so every assertion that *hands* it one passes
while the two call sites that actually reach a model send `ask: null` — which
is exactly the state this branch shipped in for one revision. The test imports
the shipped example manifest (which declares no model provider, so the agent is
in Proof Scout’s own `no_provider` state), then runs the two lines both hosts
run — `agentsView().agents`, then `briefingFor(agents,
askCapabilitiesFor(agents))` — and asserts the rendered briefing contains the
page’s own requirement and recovery sentences, that the row’s reason id is
`no_provider`, and that the id itself never reaches the wire. If either host
drops the argument, `row.ask` is null and this fails.

Verified: `npx tsc --noEmit` clean;
`npx vitest run` over the eight chief files plus `ask-capability`, `ask`,
`ask-render`, `agent-cockpit-render`, `agent-about`, `composer-shared`,
`panel-render` and `client-bundle` — `16 passed` / `310 passed`.
`client-bundle` is in that list on purpose: `lib/views/chief.ts` reads the
store, and the two new importers are main-process files, so the client set is
unchanged.

Item 1 of the original list — the chief entry opening the fleet composer with
this agent already in it — remains a follow-up on `app/page.tsx` and
`app/_components/chief-chat.tsx`. The scratch capture store is left in place.
