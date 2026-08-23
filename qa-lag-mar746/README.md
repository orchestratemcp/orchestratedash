# MAR-746 — press-to-reaction, measured

Written by `electron/capture-lag.ts` on the packaged renderer (`dash-app://ui/`),
Windows 11, one Electron instance and one runner, against a **copy** of the
installed store (`%APPDATA%\OrchestrateDASH\dash.sqlite`, 4 agents, 383 events)
in a scratch `DASH_DATA_DIR`. Read `electron/capture-lag.ts`'s own header for
what each number is and why it is decomposed this way.

    pnpm build:renderer
    pnpm build:shell
    $env:DASH_SHELL_URL='dash-app://ui/'
    $env:DASH_DATA_DIR='…\scratch-mar746'      # must already exist, holding a dash.sqlite
    $env:DASH_CAPTURE_DIR='qa-lag-mar746/after'
    pnpm exec electron dist/electron/capture-lag.mjs --user-data-dir=…\ud-mar746

`before/` is the same harness against `master`'s renderer (the fix stashed);
`after/` is this branch. Nothing else differs between the two runs.

Like every capture harness here it leaves one live runner per run against its own
scratch store — harmless to anybody's records, and not harmless to the next
`pnpm verify:shell` on the machine. This branch's runs left six
(`electron.exe … dist\electron\runner.mjs`, pids 10348, 36520, 41168, 42984,
43608, 43964 on 2026-08-23); none of them holds the app's single-instance lock.

|                                                  | before   | after |
| ------------------------------------------------ | -------- | ----- |
| press → reaction, idle (median of 12)             | 15 ms    | 6 ms  |
| press → reaction, idle (worst of 12)              | 19 ms    | 8 ms  |
| **press → reaction, main blocked 2000 ms**        | **2018 ms** | **7 ms** |
| key delivery main → renderer, under that block    | 1 ms     | 1 ms  |
| 5 Enters inside one in-flight ask → turns written | **5**    | **1** |
| 5 Enters 25 ms apart → turns written              | 1        | 1     |

## What the numbers say

**The key press was always arriving.** Delivery — `sendInputEvent` in main to the
page's own `keydown` listener — is 1 ms even while main's thread is spinning in a
2000 ms busy loop. So a blocked main process was never stopping input from
reaching the renderer, and no amount of main-side optimisation would have fixed
what Henrik saw.

**The *reaction* was the whole round trip.** Before the fix the chief composer
changed nothing on a press: the first DOM mutation after Enter was the answer
coming back through `invoke` → main → SQLite → back. Press-to-reaction was
therefore the main-process round trip *by construction*, and the stall row is
that stated exactly — a 2000 ms block produced a 2018 ms reaction, 1:1. On an
idle machine that round trip is 15 ms and nobody notices; on Henrik's (two DASH
instances, two runners, a working machine) it was seconds, and seconds of "I
pressed it and nothing happened" is what he reported.

**Which is why three Enters became three turns.** The duplicate is
latency-gated: presses only pile up while one ask is in flight. That is why the
25 ms-apart row reads 1 even *before* the fix — on an idle machine the first ask
has already returned. The gapless row is the same window made unconditional, and
before the fix it wrote five rows to `chief_messages` for one question.

## What was ruled out, with numbers

- **A synchronous main-process IPC handler doing SQLite work.** `agentsView()`
  median 9.9 ms, `workInboxView()` 1.4 ms, `connectionsView()` 5.2 ms,
  `readStore()` 1.0 ms, measured directly against the same store copy. Nothing
  here is a source of seconds.
- **The MAR-743 drain loop.** There is no loop: `drainChiefIntoStore` is called
  once, at startup, after the runner is up (`electron/main.ts`), and
  `runner/chief.ts` has no timer at all. `electron/chief-host.ts` has no polling
  cadence to change.
- **`electron/agent-adapters.ts`'s five-second poll.** Instrumented for one run
  (the instrumentation was reverted, not shipped): `refresh` 1–2 ms,
  `pullLocalEvidence` 2–25 ms, the per-agent loop 0–3 ms, every pass.
- **Contention as *the* defect.** A clean single instance with one runner still
  shows the duplicate send and still showed no local acknowledgment. Contention
  is the amplifier — it stretches the round trip the acknowledgment used to be
  hostage to — not the bug.

Main's own event loop was sampled throughout both runs (`main_loop` in
`lag.json`). It does stall: 100–680 ms, a handful of times per run, mostly during
startup, and in the before-run one press landed inside a 544 ms stall and took
560 ms to show anything. After the fix the acknowledgment no longer waits on main
at all, so those stalls delay the *answer* — which the busy line is there to
say — and nothing else.
