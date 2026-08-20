/**
 * Setting an agent up again, in words (MAR-705).
 *
 * Henrik, after being told that repairing a faulty agent meant a terminal
 * command: *"Okey, this redeploy of an faulty agent is to hard. Can you figure
 * out how we can do it from dash and not some terminal command?"* Every sentence
 * here is written for the person that request came from — somebody who installed
 * DASH from the Store, whose agent has stopped working, and who has no reason to
 * know what a registration is.
 *
 * ## The word this file will not use
 *
 * "Re-register", which is what MAR-705 calls the control and what the code
 * underneath honestly does. It names an internal record: a person cannot see a
 * registration, has never been shown one, and would not know whether theirs was
 * missing. `lib/copy/`'s standing rule is that DASH's internal vocabulary does
 * not leak onto the screen, and the plain sentence is available — *set this
 * agent up again from the copy DASH already keeps* — so the jargon buys nothing.
 *
 * ## What every sentence here has to keep saying
 *
 * That the folder is safe. This control exists because something went wrong, and
 * the fear a person brings to a repair button is that pressing it will lose the
 * work. It will not: the folder is read and never written, which is exactly why
 * this door is a repair of DASH's record rather than a re-import. That promise
 * is in the consent dialog, in the button's own detail line, and in the receipt,
 * because it is the one thing somebody needs to believe before they press it.
 *
 * ## Why the consent dialog's own words are not in this file
 *
 * `describeRepair` composes them and lives in `lib/folder-repair.ts`, beside the
 * decision it describes — which is where `describeChosenFolder` sits relative to
 * `inspectChosenFolder`, and here it is load-bearing rather than merely
 * consistent. That function calls `startSentence` to name the program, and
 * `startSentence` lives in `lib/handoff-flow.ts`, which reaches `node:fs`. This
 * file is imported by a `"use client"` component, so importing a value from
 * there would pull a Node builtin into the browser bundle.
 * `tests/client-bundle` is the gate on that, and it caught exactly this.
 *
 * So the split is not stylistic: **what a renderer can read lives here, and what
 * only main composes lives beside main's decision.**
 */

export const REPAIR_AGENT_COPY = {
  /**
   * The heading of the Settings-stage block.
   *
   * It names the situation rather than the mechanism, because a person arrives
   * at it already knowing the situation — their agent will not run — and does
   * not arrive knowing the mechanism.
   */
  heading: "This agent will not run",
  /**
   * The button.
   *
   * Short, because buttons are uppercased globally and a long honest label reads
   * as an alarm and can break the row at 375px. The detail below carries the
   * length.
   */
  action: "Repair this agent",
  pending: "Repairing…",
  /**
   * Under the button, before it is pressed.
   *
   * Two jobs, in this order. It says what the repair *uses* — the copy DASH
   * already keeps — which is the fact that makes this reachable without the
   * original project folder, and the answer to Henrik's question. Then it says
   * what survives, for `FOLDER_CHECK_COPY.adopt_detail`'s reason: the two things
   * a person fears losing are what the agent made and the agent they recognise,
   * and both really are untouched here.
   */
  detail:
    "Sets this agent up again from the copy DASH already keeps, so DASH can run it. " +
    "Its folder, everything it has produced and any connected accounts are left exactly as they are.",

  /* -------------------------------------------------------------------- *
   * The receipts
   * -------------------------------------------------------------------- */

  /**
   * Repaired, and the supervisor took it.
   *
   * The claim this makes is the strong one — you can start it now — and it is
   * only used when the re-read actually succeeded, which is what makes the pair
   * below worth having.
   */
  repaired: "Done. This agent is set up again, and you can start it now.",
  /**
   * Repaired, and the supervisor could not be reached.
   *
   * `chooseAgentFolder`'s distinction, kept: an unreachable runner changes
   * nothing about what was written, so this is the weaker claim rather than an
   * error about a step the person did not ask for. The record is on disk and the
   * next DASH open reads it.
   */
  repaired_next_open:
    "Done. This agent is set up again. Close DASH and open it once, and you will be able to start it.",
  /**
   * Repaired an agent DASH still cannot run.
   *
   * ADR 0008's manifest-only standing, reported rather than dressed up. The
   * record really was repaired, so this is not a failure — but a person who
   * pressed a button called Repair this agent and got a cheerful "done" over an
   * agent that still will not start would have been told the opposite of what
   * happened.
   */
  repaired_cannot_start:
    "This agent's details are up to date, but there is no program in its folder that DASH can run, so it still cannot be started.",

  /* -------------------------------------------------------------------- *
   * The refusals
   * -------------------------------------------------------------------- */

  /** There is no folder, or DASH cannot read the plan inside it. */
  no_folder: "DASH cannot read its copy of this agent, so there is nothing to set up again.",
  /** The plan is there and is not readable as a document. */
  plan_unreadable: "This agent's saved details are damaged, so DASH cannot set it up again.",
  /**
   * The plan reads, and does not pass the checks a fresh import would apply.
   *
   * The validator's own account travels beside this sentence and is shown as
   * evidence rather than paraphrased — MAR-423's rule, and the same treatment
   * `FolderReport` gives a refused folder check.
   */
  plan_refused: "This agent's saved details did not pass DASH's checks, so nothing was changed.",
  /**
   * The folder's plan now names a different agent.
   *
   * Its own sentence rather than a variant of the one above, because it is the
   * one refusal here that is about identity: repairing from it would file
   * another agent's program under this one's history and connected accounts.
   */
  different_agent:
    "The details in this agent's folder now describe a different agent, so DASH did not change anything.",
  /** The write itself failed, and nothing more specific is known. */
  failed: "DASH could not set this agent up again, so nothing was changed.",
} as const;
