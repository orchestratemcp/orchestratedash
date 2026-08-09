/**
 * A deploy while it is happening, and afterwards (MAR-577).
 *
 * `lib/deploy/receipt.ts` is what a person is told *before* they press the
 * button. This is every sentence after it, and it exists because the deploy
 * plane's two entry points would otherwise each invent their own — the failure
 * `lib/server-card.ts` was written to stop one layer down.
 *
 * ## The discipline this module inherits
 *
 * **DASH keeps no record of what it put where.** `host.deploy` produces a
 * bundle, pushes it, starts it and stores nothing; the only account of what is
 * on a server is that server's own answer to a check. So no sentence here says
 * an agent *is* running somewhere. The success sentence says DASH finished
 * asking, and points at the server's own report — which `describeDeployed` in
 * `lib/server-card.ts` words, and which arrives with the moment it was given.
 *
 * ## What the failure sentence may not claim
 *
 * A deploy is three steps behind one await: produce the bundle, install it,
 * start it. A refusal can therefore arrive with nothing sent, with files copied
 * and nothing started, or with something started that then stopped. DASH cannot
 * tell those apart from the answer it gets, so the copy does not: it declines to
 * say "nothing was changed on your server" and sends the person to the one thing
 * that can answer, which is the server.
 *
 * That is the same call `describeDisconnect` makes about a server that keeps
 * running after DASH forgets it, and the reason both are worth the paragraph:
 * the reassuring sentence is the one that would be wrong.
 *
 * Pure, and it imports nothing that reaches a disk. Both entry points are
 * `"use client"` trees — see `lib/deploy/receipt.ts`'s own header for the
 * packaged-renderer failure that rule exists because of.
 */

import { plainMoment } from "../copy/when";

export interface DeploySentence {
  headline: string;
  detail: string;
  /** Null exactly when there is nothing for the person to do about it. */
  next_action: string | null;
}

/**
 * Where one attempt to put one agent on one server has got to.
 *
 * Held in page state and never stored, for the reason the server card's standing
 * is: DASH records nothing about a deploy, so a value that survived the page
 * would be a claim that outlived the only thing that could check it.
 */
export type DeployStanding =
  | { step: "sending"; agent: string; server: string }
  | {
      step: "failed";
      agent: string;
      server: string;
      /** Main's own sentence, passed through rather than reworded. */
      detail: string;
    }
  | { step: "sent"; agent: string; server: string };

export function describeDeploy(standing: DeployStanding): DeploySentence {
  switch (standing.step) {
    case "sending":
      return {
        headline: `Putting ${standing.agent} on ${standing.server}`,
        detail:
          "DASH is copying this agent and its own runner across, and will start it there. " +
          "That takes a minute or two on a slow connection. Nothing on this computer changes.",
        next_action: null,
      };

    case "failed":
      return {
        headline: `${standing.server} did not take ${standing.agent}`,
        detail: standing.detail,
        /*
         * Not "nothing was changed". Three steps ran behind one answer and DASH
         * cannot tell which of them stopped, so the honest next step is to ask
         * the machine that knows — which is also a control the person already
         * has on the Servers page.
         */
        next_action: `Check ${standing.server} to see what is on it now`,
      };

    case "sent":
      return {
        headline: `DASH finished putting ${standing.agent} on ${standing.server}`,
        detail:
          "DASH keeps no list of what it has put on a server. What is running there is " +
          "whatever the server says when it is asked, and DASH asks every time you check.",
        next_action: null,
      };
  }
}

/**
 * An agent DASH cannot send anywhere, said before anything is attempted.
 *
 * The refusal itself travels on the view as a string rather than being imported
 * here, and that is not indirection for its own sake: it is authored beside the
 * folder rule that produces it, in a module that reads a disk, and importing the
 * constant into a client tree is the exact mistake `tests/client-bundle.test.ts`
 * exists to catch. What this function owns is the frame around it.
 *
 * Main is still the authority. This is the same arrangement the add-a-server
 * form's duplicate check has — a page can be wrong about what the store holds,
 * so the trusted side refuses again — and the value of saying it early is that
 * nobody presses a button that was never going to work.
 */
export function describeUndeployable(agent: string, refusal: string): DeploySentence {
  return {
    headline: `${agent} cannot be put on a server`,
    detail: refusal,
    // None: the refusal is MAR-553's own sentence and already ends in the way
    // forward. A second instruction underneath it would be the same advice
    // twice, in DASH's voice over the top of DASH's voice.
    next_action: null,
  };
}

/**
 * No server saved, on a page about one agent.
 *
 * The Servers page says this to somebody who came looking for hosting. Here it
 * has to land on somebody who did not — they opened an agent — so the first
 * sentence is that nothing is missing. An agent runs on this computer, it always
 * has, and a page that framed "no server" as a gap would be inventing a problem
 * to sell the fix for it.
 */
export function describeNoServerForAgent(agent: string): DeploySentence {
  return {
    headline: `${agent} runs on this computer`,
    detail:
      "That is the ordinary way to run an agent and nothing is missing. A server is for " +
      "an agent you want working while DASH is closed — it costs money and it is not " +
      "required.",
    next_action: "Connect a server",
  };
}

/**
 * When the server gave the answer being shown, or nothing.
 *
 * The half of "what is running there" that `describeDeployed` cannot carry: that
 * sentence attributes the count to the server, and this says *when* the server
 * said it. Without it a number that was true ten minutes ago reads as one that
 * is true now, which is the whole failure the Servers page was built against.
 *
 * **Absolute, not "two minutes ago"**, which is `lib/copy/when.ts`'s standing
 * rule rather than a choice made here: a relative phrase needs a clock at render
 * time, so the same component produces different markup on two runs and a render
 * test stops asserting anything. A person reading a clock time knows how old it
 * is; a person reading "recently" does not.
 *
 * Null when nothing has been asked, because "never" is the standing's job to say
 * and saying it twice in two vocabularies is worse than saying it once.
 */
export function describeAskedAt(checkedAt: string | null): string | null {
  if (checkedAt === null) {
    return null;
  }
  const moment = plainMoment(checkedAt);
  return moment === null ? null : `DASH last asked on ${moment}.`;
}

/**
 * Every sentence this module can produce, for the copy sweep.
 *
 * Derived from the union rather than written out, the shape
 * `everyConnectSentence` established: a state added without being added here is
 * a state the plain-language check never sees.
 *
 * `refusal` is a parameter because the real one lives beside the folder rule
 * that produces it — `tests/deploying.test.ts` passes exactly that constant, so
 * the sentence a user would read is the one that gets scanned.
 */
export function everyDeploySentence(refusal: string, agent = "News Scout", server = "My server"): string[] {
  const standings: DeployStanding[] = [
    { step: "sending", agent, server },
    { step: "failed", agent, server, detail: "DASH could not sign in to this server." },
    { step: "sent", agent, server },
  ];
  const sentences = [
    ...standings.map(describeDeploy),
    describeUndeployable(agent, refusal),
    describeNoServerForAgent(agent),
  ];
  return [
    ...sentences.flatMap((copy) => [
      copy.headline,
      copy.detail,
      ...(copy.next_action === null ? [] : [copy.next_action]),
    ]),
    describeAskedAt("2026-08-09T14:14:37Z") ?? "",
  ];
}
