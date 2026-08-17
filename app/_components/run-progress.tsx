"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { AGENT_RUN_PROGRESS_COPY as COPY } from "../../lib/copy/agent-page";
import type { RunProgressView, RunStepState, RunStepView } from "../../lib/views/run-progress";
import { WorkingLine } from "./working";

/**
 * Which step a run is on, whether it has finished, and whether you may walk
 * away (MAR-680).
 *
 * ## What this is, and what the panel beside it is
 *
 * `LiveFeed` is the **log**: every event the run posted, with the clock time it
 * happened at, oldest first. This is the **position**: every step the plan
 * declares, in order, with the one that is happening now marked and the ones
 * that have not happened yet drawn as not-yet-happened. A log cannot show a
 * step that has not run, and *"Step 2 of 6"* is the whole of what Henrik was
 * asking for.
 *
 * They are deliberately not the same fact twice. **This panel carries no clock
 * times at all** — one fact, one home, and the fact "when did that happen" is
 * the feed's. `tests/run-progress-render.test.tsx` is the gate on that, in the
 * shape `tests/agent-one-home.test.tsx` uses for the stage and the rail.
 *
 * ## The loader is on one row and the phase word is beside it
 *
 * `WorkingLine`'s pips are the motion half and they ride `--motion-*`, so
 * somebody who asked for stillness gets a still row that still says the words.
 * MAR-544's rule holds here exactly: the phase is read off a state the store
 * carries and nothing is narrated. A run that stopped mid-step has **no**
 * pips — see `markCurrent` — because the alternative is a spinner claiming
 * work is happening on a page that has just said the run stopped.
 *
 * ## The live region is the headline and nothing else
 *
 * A person who is not looking at the screen wants to be told *Finished*, once.
 * Putting `aria-live` on the step list instead would announce every row again
 * on every five-second poll, which is the "nothing moves without saying it did"
 * rule turned into a machine that will not stop talking.
 */
export function RunProgress({
  progress,
  outputHref,
}: {
  progress: RunProgressView;
  /**
   * Where the thing this run made is, or absent.
   *
   * Passed only when the agent actually has an output to open — MAR-680's *"it
   * should trigger a reload so a new output lands"* is the page's job, and this
   * is the pointer to where it landed. A link offered beside a finished run
   * that produced nothing would send somebody to an empty stage.
   */
  outputHref?: string;
}): ReactNode {
  /*
   * An agent that has never run draws nothing here. `AGENT_FEED_COPY`'s empty
   * state is directly below on the same stage and says the same thing; two
   * panels apologising for one absence is the page MAR-609 was filed on.
   */
  if (progress.kind === "none") {
    return null;
  }

  const working = progress.phase === "running";

  return (
    <section className="section run-progress" aria-labelledby="run-progress-heading">
      <div className="section-heading">
        <h2 id="run-progress-heading">{COPY.heading}</h2>
        <p className="run-progress-position">{progress.position}</p>
      </div>

      <p aria-live="polite" className={`run-progress-state is-${progress.phase}`}>
        {working ? (
          <WorkingLine phase={progress.headline} />
        ) : (
          <strong>{progress.headline}</strong>
        )}
      </p>
      <p className="muted wrap">{progress.detail}</p>

      {progress.steps.length === 0 ? null : (
        <ol className="run-progress-steps">
          {progress.steps.map((step) => (
            <RunStep key={`${String(step.position)}:${step.label}`} step={step} />
          ))}
        </ol>
      )}

      {/* The answer to "can I leave", where the person asking it is looking.
          Null the moment the run is over — see the field's own note. */}
      {progress.safe_to_leave === null ? null : (
        <p className="muted wrap run-progress-leave">{progress.safe_to_leave}</p>
      )}

      {/* Only on a run that is over and only where there is something to open.
          A run still going has nothing settled to send anybody to. */}
      {progress.safe_to_leave === null && outputHref !== undefined ? (
        <p>
          <Link className="output-run-link" href={outputHref}>
            {COPY.open_output}
          </Link>
        </p>
      ) : null}
    </section>
  );
}

/**
 * One row of the plan.
 *
 * The state is a word as well as a shape. `lib/copy/glance.ts` and MAR-547 both
 * land on the same rule — no state readable only from a colour — so every row
 * carries its own state in text beside the mark, and the mark itself is
 * `aria-hidden` because a tick read aloud says nothing.
 */
function RunStep({ step }: { step: RunStepView }): ReactNode {
  return (
    <li className={`run-progress-step is-${step.state}`}>
      <span className="run-progress-mark" aria-hidden="true">
        {MARK[step.state]}
      </span>
      <span className="run-progress-step-body">
        <span className="run-progress-step-label">
          {/* The step's number, labelled, because "3" alone beside a name reads
              as a count of something. `describeRunPosition` uses the same word
              for the same number in the heading. */}
          <span className="run-progress-step-number">
            {COPY.step_label} {step.position}
          </span>
          <span className="run-progress-step-name">{step.label}</span>
        </span>
        {step.state === "running" ? (
          <span className="run-progress-step-state">
            <WorkingLine phase={COPY.step_running} />
          </span>
        ) : (
          <span className="run-progress-step-state muted">{STATE_WORD[step.state]}</span>
        )}
        {/* Carried only for a step that did not work or was skipped — the two
            states where the agent's own sentence is the reason somebody is
            reading the row. `lib/views/run-progress.ts` decides that; this
            draws whatever survived it. */}
        {step.detail === null ? null : <span className="muted wrap">{step.detail}</span>}
      </span>
    </li>
  );
}

/**
 * The glyph per state, and every one of them is decorative.
 *
 * A closed record rather than a ternary chain, so a new `RunStepState` is a
 * type error here rather than a row that renders a blank box — the discipline
 * `panel.tsx`'s section switch keeps, applied to a much smaller union.
 */
const MARK: Record<RunStepState, string> = {
  done: "✓",
  running: "",
  waiting: "?",
  failed: "×",
  skipped: "–",
  todo: "·",
  /* Not the failure cross. A step that stopped in the middle is an absence of
     an outcome, not a bad one — see `markCurrent`. */
  unfinished: "⋯",
};

const STATE_WORD: Record<RunStepState, string> = {
  done: COPY.step_done,
  running: COPY.step_running,
  waiting: COPY.step_waiting,
  failed: COPY.step_failed,
  skipped: COPY.step_skipped,
  todo: COPY.step_todo,
  unfinished: COPY.step_unfinished,
};
