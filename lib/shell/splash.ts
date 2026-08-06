/**
 * What DASH says while it is starting, and what it says when starting fails.
 *
 * MAR-436's requirement is the interesting half of the issue: the splash "must
 * be honest, not decorative: if a startup assertion throws, the splash shows
 * that failure with a next action instead of spinning forever. A spinner that
 * never resolves is the failure mode this issue exists to prevent, not the one
 * it should introduce."
 *
 * So this module is written around the failure, and the progress steps are the
 * easy part that happens to share a window with it.
 *
 * ## Why this is a pure module and not just markup in `electron/splash.ts`
 *
 * The splash carries product copy, which makes it a guided-path surface, which
 * makes the plain-language rule apply to it — see `lib/copy/identifiers.ts`.
 * `assertContractsLocation` throwing must not put "assertContractsLocation" in
 * front of a novice, and the only way to hold a surface to that is for a test to
 * be able to read every string it can show. A template literal inside a
 * `BrowserWindow` call is not readable by a test; this is.
 *
 * ## Why the steps are named at all
 *
 * A progress bar with no words is a promise that something is happening. On a
 * first run this window is up for seconds while DASH migrates a database, proves
 * where its store landed, checks the credential vault and starts a detached
 * runner — and if it dies, "which of those was it" is the entire question. The
 * step names are what make the failure legible before the failure copy has to.
 */

import type { Recovery } from "../copy/recovery";

/**
 * The startup steps, in the order `electron/main.ts` performs them.
 *
 * The ids are DASH's vocabulary and never rendered; `label` is what a person
 * reads. Keeping both here rather than passing strings from main means the
 * copy can be asserted in one place, and means main names a step rather than
 * writing one.
 */
export type StartupStepId =
  | "store"
  | "vault"
  | "rules"
  | "screens"
  | "runner"
  | "window";

export interface StartupStep {
  id: StartupStepId;
  /** Present tense, because it is shown while it is happening. */
  label: string;
}

/**
 * Six steps, and every one of them names something the user's machine is doing
 * for them rather than something DASH is doing to itself.
 *
 * "Checking this computer's credential vault" rather than "opening secure
 * store": the first tells someone whose machine is slow *why* it is slow, and
 * the second is a sentence about our code.
 */
export const STARTUP_STEPS: readonly StartupStep[] = Object.freeze([
  { id: "store", label: "Finding where DASH keeps your agents" },
  { id: "vault", label: "Checking this computer's credential vault" },
  { id: "rules", label: "Loading the rules DASH checks agents against" },
  { id: "screens", label: "Getting DASH's screens ready" },
  { id: "runner", label: "Starting the agent runner" },
  { id: "window", label: "Opening DASH" },
]);

/**
 * What to say when a startup step throws.
 *
 * A `Recovery` rather than a bespoke shape, for the reason
 * `lib/copy/recovery.ts` gives: three fields so a surface cannot render two and
 * drop the third, and the dropped one is always the next action.
 *
 * The `actor` is `dash` for every case here and that is deliberate. A user who
 * double-clicked an icon has done nothing wrong, and every one of these
 * failures is about an install, a file DASH shipped, or a permission DASH
 * needed and did not get. Blaming them by implication — "check your
 * installation" — would be the accusation this module's neighbour warns about.
 *
 * The one step that is *not* a hard failure is the runner: DASH works without
 * one, it just does not host agents. `electron/main.ts` already treats it that
 * way, and a splash that killed the app over it would be lying about how
 * serious it is. There is deliberately no entry for it.
 */
export function describeStartupFailure(step: StartupStepId): Recovery {
  switch (step) {
    case "store":
      return {
        headline: "DASH could not open the place it keeps your agents.",
        meaning:
          "Your agents and their history are still on this computer. DASH could not reach them, so it stopped rather than start with an empty list that would look like they were gone.",
        next_action: "Close DASH and open it again. If it happens twice, restart the computer.",
        actor: "dash",
      };
    case "vault":
      return {
        headline: "DASH could not reach this computer's credential vault.",
        meaning:
          "DASH keeps the sign-ins your agents use in the vault your computer provides, and it will not keep them anywhere else. Without it, agents that need a sign-in cannot run.",
        next_action: "Sign out of this computer and back in, then open DASH again.",
        actor: "dash",
      };
    case "rules":
      return {
        headline: "Part of DASH is missing from this installation.",
        meaning:
          "DASH checks every agent against a set of rules that ship inside the app. They are not where DASH expects them, and it will not check agents against rules it cannot find.",
        next_action: "Install DASH again.",
        actor: "dash",
      };
    case "screens":
      return {
        headline: "Part of DASH is missing from this installation.",
        meaning: "The screens DASH shows are not where DASH expects them.",
        next_action: "Install DASH again.",
        actor: "dash",
      };
    case "runner":
      return {
        headline: "DASH could not start the part that runs agents.",
        meaning:
          "You can still open DASH and look at everything it has recorded. It cannot run agents on this computer until this is fixed.",
        next_action: "Open DASH and carry on. Agents you try to start will say the same thing.",
        actor: "dash",
      };
    case "window":
      return {
        headline: "DASH could not open its window.",
        meaning: "DASH started, but nothing can be shown.",
        next_action: "Close DASH and open it again.",
        actor: "dash",
      };
    default: {
      const unreachable: never = step;
      throw new Error(`Unhandled startup step: ${String(unreachable)}`);
    }
  }
}

/**
 * Every string this window can put in front of a person.
 *
 * Exported for the plain-language assertion, which is the only reason it
 * exists: a test that had to know which fields of which objects to scan would
 * go stale the first time somebody added a seventh step.
 */
export function splashCopy(): string[] {
  return [
    ...STARTUP_STEPS.map((step) => step.label),
    ...STARTUP_STEPS.map((step) => step.id).flatMap((id) => {
      const recovery = describeStartupFailure(id);
      return [recovery.headline, recovery.meaning, recovery.next_action];
    }),
  ];
}
