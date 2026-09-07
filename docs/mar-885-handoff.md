# MAR-885 handoff — model row in every Settings state, residency and plain-moment copy

Lane K of the 2026-09-06/07 UX wave. Branch
`000henrik/mar-885-settings-model-row`, based on `origin/master` (carries
MAR-874 #332, MAR-878 #329, MAR-879 #336, MAR-884 #339).

## The three defects, and what changed

### 1. No model row for an agent that declares no model

`ModelChoice` (`app/_components/model-choice.tsx`) returned `null` outright
for `settings.reason === "no_model_needed"`. That made a plan with no model
step the one agent in a fleet with no model row at all — indistinguishable
from the section being broken, and the exact "Nothing renders" bug MAR-885
was filed on for `proof-scout-mar861`.

The early return is removed. The row now renders `describeNoChoice`'s
existing sentence — *"This agent does not use a language model"* plus its
detail — in the same one-line arm every other no-choice reason already used.
**The sentence itself is untouched**, per `docs/mar-874-handoff.md`'s own
paragraph on this: `lib/ai/model-choice.ts` refuses to distinguish "arranges
its own model" from "names a service DASH cannot ask", and asserting "built
without a model" would be this stage guessing at exactly what that module
declines to guess. `lib/ai/model-choice.ts` is outside this lane's ownership
and was not touched.

What is new is the one action that exists anywhere near this sentence: a
link to Add agent's assistant path (`/settings/add-agent?path=assistant`,
confirmed live since MAR-879 — `useOpenedPath` in
`app/settings/add-agent/page.tsx` opens that door's disclosure on exactly
this query string), labelled **"Build one that can"**
(`AGENT_SETTINGS_COPY.model.build_with_assistant`, `lib/copy/agent-page.ts`).
It is deliberately not offered as a fix for *this* agent — there is nothing
wrong with it — only as the nearest door to a different one that could
answer questions. It renders only on `no_model_needed`, not on the other two
no-choice reasons, each of which already has its own next step.

### 2. The every-day radio's description named the wrong machine

`AGENT_TRIGGER_COPY.at_a_time.detail` — *"DASH starts it for you, on this
computer, at the time you pick."* — was a static string, unconditionally
naming this computer, while `standing_line` two lines above it already
followed residency (`AGENT_TRIGGER_COPY.standing_on_host`, from MAR-874). An
agent DASH has enrolled on a server read a state line naming the server and
a radio description directly under it promising a machine `splitSchedules`
had already stopped telling about the row.

Added `AGENT_TRIGGER_COPY.at_a_time.detail_on_host(server)` beside the
existing `detail`, and `TriggerSwitch` in `app/_components/agent-settings.tsx`
now picks between them from `schedule.resident_on` — the same field
`standing_line` and `time_hint` already read. No new predicate: this is the
existing residency fact reaching one more sentence.

### 3. The scheduled-runs history showed the raw ISO instant

`app/_components/agent-settings.tsx` rendered
`<time dateTime={due_at}>{due_at}</time>` — the visible text was
`2026-09-05T18:20:00.000Z`, beside the DID NOT START chip.

`ScheduleRunView` (`lib/views/agent-schedule.ts`) gained `due_label`, built
with `lib/copy/when.ts`'s `plainMoment` at the same place `standing_line` and
`liveness` are built, against the same `host` variable. The `<time>`
element's `dateTime` attribute still carries the raw ISO — that is what the
attribute is for, and it is not visible text — while its child text is now
`due_label`.

**What is fixed and what is not, stated as plainly as MAR-874's own note on
the sibling defect:** the number is not converted. `at_local` carries no
timezone and `nextDueAfter` (`lib/schedule/plan.ts`) computes the instant on
whichever machine runs `runner/schedule.ts`, so turning it into the enrolled
server's actual wall time needs that server's offset, which DASH does not
keep anywhere — that conversion is MAR-872's, exactly as the lane brief
said not to attempt. What changed is: (a) the raw machine spelling is gone,
replaced by `plainMoment`'s words, and (b) for a settled window on an
enrolled server, the sentence names whose clock it is
(`AGENT_TRIGGER_COPY.due_at_on_host`, *"…, by <server>'s clock."*) rather
than silently implying it is the reader's own. Read against the *current*
`resident_on`, not a per-window historical value — DASH keeps no record of
which machine held a schedule at the moment a given window settled, only
which machine holds it now, which is the same simplification `standing_line`
and `liveness` already make for the schedule itself.

## Files changed

| File | What |
| --- | --- |
| `app/_components/model-choice.tsx` | Removed the `no_model_needed` early return; the no-choice arm now always renders `headline`/`next_action`, plus a "Build one that can" link on `no_model_needed` only. |
| `app/_components/agent-settings.tsx` | `TriggerSwitch`'s every-day radio picks `at_a_time.detail` vs `detail_on_host` from `schedule.resident_on`; the scheduled-runs `<time>` renders `schedule.last.due_label` instead of the raw `due_at`. |
| `lib/copy/agent-page.ts` | `AGENT_TRIGGER_COPY.at_a_time.detail_on_host`, `AGENT_TRIGGER_COPY.due_at_on_host`, `AGENT_SETTINGS_COPY.model.build_with_assistant`. |
| `lib/views/agent-schedule.ts` | `ScheduleRunView.due_label`, built with `plainMoment` against the schedule's current `host`. |
| `tests/model-render.test.tsx` | Replaced the "draws nothing" test with one asserting the sentence and the link; added a test that the other two no-choice reasons do not pick it up; added the fifth state to the plain-language sweep. |
| `tests/copy-agent-page.test.ts` | Pinned `at_a_time.detail_on_host`, `due_at_on_host` and `build_with_assistant` by value. |
| `tests/schedule-view.test.ts` | Pinned `due_label` for both the this-computer and on-a-server cases. |

Commit: see PR. No file outside this lane's ownership list was touched, and
`app/globals.css` was not appended to — none of the three fixes needed new
CSS.

## Verified, and how

Run from PowerShell in `C:\Users\henri\AppData\Local\Temp\wt-ux885-s1`.

```
pnpm typecheck
  → clean

pnpm vitest run tests/model-render.test.tsx tests/model-choice.test.ts \
  tests/copy-agent-page.test.ts tests/schedule-view.test.ts \
  tests/agent-settings-shape.test.tsx
  → Test Files  5 passed (5)
    Tests  121 passed (121)

pnpm brand:check
  → ✓ brand:check passed — 12 characters audited against the vendored
    manifest, 12 action sheet(s) / 96 frame(s) audited against their stills,
    3 rendered sizes, 9 file(s) using the cast, 93 file(s) checked for
    remote fonts, 4 bundled font file(s) verified

pnpm test   (stale %TEMP%\dash-mcp-run-* cleared first)
  → Test Files  278 passed (278)
    Tests  5301 passed | 13 skipped (5314)
```

No failures, so nothing needed a lone re-run.

### Evidence class

**Fixture tests and a typecheck. Nothing runtime, and no frames.**

- `tests/model-render.test.tsx` proves the `no_model_needed` row renders the
  sentence and the link over `renderToStaticMarkup`, against a hand-built
  `AgentModelSettingsView` — not against `buildAgentModelSettings` reading a
  real manifest, and not against `proof-scout-mar861`'s actual state on the
  installed build.
- `tests/schedule-view.test.ts` proves `due_label` is built correctly from a
  `ScheduleSettlement` fixture. No settled window in this repository's test
  fixtures comes from an actual runner tick, and nobody has read this text
  off the installed Settings stage for an agent with a real missed or
  refused window.
- `tests/copy-agent-page.test.ts` pins the new sentences by value and the
  MODULES walk sweeps them for plain language automatically (both new
  `AGENT_TRIGGER_COPY` entries were added to an object that walk already
  covers).
- No scratch-store capture was taken. The lane brief offered extending
  `electron/capture-cockpit.ts`'s settings scene for the no-model state as
  optional; it was not done — see below.

## What is NOT done

1. **No capture.** `electron/capture-cockpit.ts`'s settings scene was not
   extended for the no-model state, so the one-screen claim for all three
   fixes is a fixture assertion, not a photographed frame. The lane brief
   marked this optional; it is the thing a next pass should do first if a
   frame is wanted before the installed-build check below.
2. **Not read off the installed build.** `docs/mar-861-orchestrator-handoff-2026-09-06.md`'s
   own account of `proof-scout-mar861` is the source for this issue; nobody
   has re-opened that agent's Settings stage since this branch to confirm
   the row now appears there. Same for the residency and raw-instant fixes —
   they are proven against fixtures built to match the shapes MAR-874 and
   MAR-742 already established, not against a live enrolled agent or a real
   settled window.
3. **`due_label` is read against current residency, not historical.** Stated
   above and worth repeating here: a settled window from before an agent was
   un-enrolled, or from before it was enrolled, reads against whatever
   `resident_on` is *now*. DASH keeps no per-window record of which machine
   actually held the schedule at settlement time, so this is the best
   available answer rather than a gap this packet introduced.

## Deviations from the lane's design, recorded

- The brief asked for a link "such as" *Build one that can*; that literal
  string is what shipped, matching `AGENT_SETTINGS_COPY`'s established
  register of short button/link labels (`Change`, `Use my key`).
- `due_at_on_host` composes `${moment}, by ${server}'s clock.` rather than a
  longer sentence, to match the register of the `<time>` element it renders
  inside — a receipt-style caption beside a status chip, not a paragraph.
  The non-enrolled case renders the bare `plainMoment` output with no added
  words at all, matching how `connection-card.tsx` and `digest.tsx` already
  use `plainMoment` directly without wrapping it in a sentence.

## The one thing the next session should do first

Take the capture. `electron/capture-cockpit.ts`'s settings scene needs a
no-model agent (an easy fixture, since it needs no key and no fleet
connection) alongside the existing scheduled + enrolled cases already asked
for in `docs/mar-874-handoff.md`'s own "Needs orchestrator" list, and someone
should open `proof-scout-mar861` on the installed build once the packet
lands to confirm the row Henrik reported missing on 2026-09-07 is now there.

## Needs orchestrator

None of this lane's changes reached outside its file-ownership list, and
none required a new ADR, migration, or cross-repo contract change. The one
open item is the capture named above, which the lane brief already marked
optional and evidence-class "fixture tests (+ a frame)" — the frame is the
part still owed.
