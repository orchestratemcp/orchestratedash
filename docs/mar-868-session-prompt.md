# Session prompt — MAR-868: the verdict must arrive by itself

Dispatched by the orchestrator 2026-09-04. Packet 6 of MAR-861. **Blocking for
MAR-866's video.** Small and bounded — resist making it bigger.

---

**Client:** Claude Code, `claude --model sonnet`.

**Why this tier:** the design is decided, the root cause is diagnosed below, and
the change is a predicate and a label. This is bounded implementation, not
architecture. If the diagnosis turns out to be wrong, stop and hand off rather
than redesigning.

**Repository:** `orchestratedash`, `master` at or after `7c8c72a`.
**Worktree:** `C:\Users\henri\AppData\Local\Temp\wt-mar868-poll-c1`.
**Branch:** `000henrik/mar-868-adjudication-poll`.
**Linear issue:** MAR-868.

## The defect

After a judgement settles, the agent page keeps showing the **previous**
receipt until somebody presses `...` → Refresh. Reproduced twice by the proving
session. The button also never showed *Being judged* across a 131-second and a
129-second run.

The record is written correctly and the component renders it correctly. **The
page does not notice.**

## The diagnosis — verify it before you fix it

`app/agents/detail/page.tsx` drives live polling from:

```
const following = running || asked > 0;
useEffect(() => { setLive(following); }, [following]);
```

`running` is true when a **run** is in flight. **An adjudication is not a run.**
`adjudicate()` sets feedback and touches neither `asked` nor `following`, so the
page is not live during a judgement at all. The grace window `asked` exists for
a press that might start a run, and this press never does.

So the page is idle for the whole two minutes, and only a manual refresh reads
the settled row.

**Confirm this before changing anything.** If the page turns out to be live and
the data is stale for a different reason, that is a different defect and you
should say so in the handoff rather than patching over it.

## What to change

1. **An in-flight adjudication must make the page live.** The record carries a
   stage — see `AdjudicationStage` in `lib/genlayer/record.ts` — and the view
   already carries the rows: `adjudications` on the artifact card view
   (`lib/views/artifacts.ts`), resolved by `adjudicationResolverFor()` in
   `lib/views/build.ts`. An adjudication that is not settled is the same kind of
   reason to poll that a run in flight is.
2. **The button must follow the record's stage.** `ADJUDICATE_COPY` already has
   the words. Today it reads *Have it judged* and *Judge it again* and nothing
   in between, over a two-minute wait, which is indistinguishable from a press
   that did nothing.
3. **Keep the existing exit discipline.** The comment in that file is explicit
   that a press which started nothing must not leave the page polling forever.
   Whatever you add needs the same bounded exit — a settled row, a failure, or a
   timeout. A hopeful boolean that never clears is the defect one level up.

## Do not

- Do not touch `lib/genlayer/**`, `lib/broker/operations.ts`, or ADR 0033.
- Do not redesign the receipt or its footer.
- **Do not add a spinner to the `no_consensus` outcome.** That outcome
  deliberately has a button, and turning it into a wait would be wrong.
- Do not write a new ADR. 0032 and 0033 are taken and you are not deciding
  anything.
- Do not fix the missing Connections card for the `genlayer` kind. It is real,
  it is filed separately, and it does not block the video.

## File ownership

**You own:** `app/agents/detail/page.tsx`, `app/_data/source.ts` if the live
predicate needs it, `lib/copy/genlayer.ts` for the in-flight label,
`app/_components/outputs.tsx` for the button state, the tests for those, and
`docs/mar-868-handoff.md`.

**Read-only:** everything else. `.orchestrate/state.json` is the orchestrator's.

No other session is live. If one appears, you own only the files above.

## Start checks

```bash
git rev-parse --abbrev-ref HEAD
git status --short
git log --oneline -1
```

Own branch, own worktree, clean tree, `master` at or after `7c8c72a`.

## Verification

Run from **PowerShell**, not Git Bash.

```bash
pnpm typecheck
```

```bash
pnpm test
```

`tests/store-damage.test.ts` times out under parallel load and passes 28/28
alone. That is known and not yours. If any other file fails, re-run it alone
before believing it.

## Lifecycle exit state

`merged` when the PR is green. **Not `proven`.**

## The proof, and it is a recording not a screenshot

`proven` = **on the installed build, press the button and watch the stage change
and the verdict arrive without touching anything.** The claim is about time, so
a screenshot cannot carry it. Record the screen.

Build both, in this order, before you look at anything:

```bash
pnpm build:renderer
```

```bash
pnpm build:shell
```

A judgement takes one to five minutes. Measured range: 16 to 249 seconds to
accepted, 45 to 281 seconds to finalized. **A quiet page before minute six is
not a hang.**

If you reach the proof this session, take it. If you do not, leave the packet at
`merged` and say so plainly.

## Gotchas

- **Never force-kill Electron.** It corrupted the real store once.
- `pnpm verify` needs DASH closed, and expects exactly 85 PASS and 0 FAIL from
  the smoke. Redirect its output to a file.
- `innerText` returns uppercased chips, so grepping chip copy reads false while
  it is on screen.
- Studionet's shipped contract is
  `0xD08455a5Cfc53E43731834d6C92a6FE4aA0b3B75`. It was answering at 19:20 today.
  If it stops, that is the network, not this packet.

## Evidence to write back

1. A comment on MAR-868: commit SHA, PR number, whether the diagnosis above held,
   what you verified and how, and what is not done.
2. `docs/mar-868-handoff.md` in the PR.
3. The recording, or an honest statement that you did not get one.

## Hard stop

When the verdict arrives on the page's own poll and the button says what is
happening: **stop.** Do not start MAR-864, do not enrol a host, do not begin the
video, do not fix the Connections card. Write the handoff and end the session.
