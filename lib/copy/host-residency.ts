/**
 * Whether a server keeps working when nothing on this computer is (MAR-795,
 * ADR 0031).
 *
 * ## What this page section is for
 *
 * `lib/copy/startup.ts` is this file's twin and it says the same thing about the
 * machine a person is sitting at: a control that changes what happens when
 * nobody is watching owes its reader every sentence about what it does *and*
 * what it still does not. ADR 0030's copy is the model, and three of its rules
 * transfer whole:
 *
 * 1. **Off until pressed, said before the press**, not discovered afterwards.
 * 2. **Both states are described.** A person who turns it off is owed the same
 *    account as one who turns it on.
 * 3. **The removal instructions are on the page.** ADR 0030 shows the literal
 *    Windows command because DASH may be deleted without the entry being turned
 *    off first; here the equivalent case is worse, because the machine is
 *    somebody else's server and DASH may never reach it again. So the two
 *    commands an operator would type are on the card, in the place they can read
 *    them before they press.
 *
 * ## The one sentence this section exists to keep honest
 *
 * A scheduled run on a server **cannot pay for a model call**. ADR 0029
 * amendment 1 wrote that sentence for this machine — *"the run still starts and
 * still publishes, but nothing can reach your model until you open DASH again"*
 * — and on a host it is sharper: `runner/host-broker.ts`'s spend allowance is
 * opened by a **Run press on that host**, and a schedule is exactly the case
 * where nobody pressed anything. The VPS residency proposal §7 scoped unattended
 * host spend into its own packet on purpose, so until that packet lands this
 * feature makes agents run on a server and does not make them think there.
 *
 * Saying that plainly is not a hedge. It is the difference between a person
 * turning this on for an agent that works without a model and a person turning
 * it on for one that does not and finding out at 3am on a machine they cannot
 * see.
 */

import type { HostServiceState } from "../deploy/service-unit";

/** The section, and the words a person came to the card looking for. */
export const RESIDENCY_COPY = {
  heading: "When this server restarts",

  /**
   * The one control.
   *
   * Named for the outcome rather than the mechanism — a person reading this has
   * never heard of a unit file and does not need to. "Keep running" is the same
   * verb `STARTUP_COPY.toggle` uses for the helper on this machine, so somebody
   * who has met one switch recognises the other.
   */
  toggle: {
    label: "Keep the agents on this server running after it restarts",
    detail:
      "Your server starts the agents you put here on its own when it reboots, without you opening DASH or signing in to the server.",
  },

  /** Two words each, because the stylesheet uppercases every button. */
  toggle_on: "Turn on",
  toggle_off: "Turn off",

  /** ADR 0030 decision 4, one machine over. */
  opt_in:
    "This is off until you turn it on. Setting up a server never arranges this on its own.",

  /**
   * What is true with it on, and what is still not.
   *
   * Four sentences, and the last two are the ones that must stay. The third is
   * ADR 0029 decision 7 — a window that came round while the machine was down is
   * missed and is not run late — and the fourth is the spend sentence this
   * file's header argues for.
   */
  liveness_on: [
    "The server reboots and starts your agents again by itself. Nothing on this computer has to be open.",
    "Anything that ran while you were away shows up in DASH the next time you open it.",
    "A time that came round while the server was off is still missed. DASH says it was missed and does not run it late.",
    "A run that starts this way cannot reach your model. Putting a key on this server lets an agent you press Run on use it; it does not pay for a run nobody asked for.",
  ] as readonly string[],

  /** With it off, so both states are described. */
  liveness_off: [
    "Nothing starts on its own after a reboot. The agents on this server stay stopped until you press Run.",
    "Until then, a scheduled time that comes round on this server is missed.",
  ] as readonly string[],

  /**
   * The things this switch does not do, each one a thing a person could
   * reasonably assume it did.
   */
  not_this: [
    "It does not open a port or let anything reach this computer from your server.",
    "It does not restart an agent that stops or crashes. It starts them once, when the server boots.",
    "It does not put any of your keys on the server. That is a separate press, one key at a time.",
  ] as readonly string[],

  /** Above the two commands, on the card. */
  removal_label: "Removing this without DASH",
  removal_note:
    "You can undo this from the server itself, whether or not DASH is still installed here. Sign in to the server and run these two lines.",

  /*
   * There is deliberately no "Done." sentence here.
   *
   * A press answers with what the **server** then said, and the card draws
   * `describeResidency` from it — so a confirmation of its own would be a second
   * account of one fact, and the one time they disagreed the cheerful one would
   * be the wrong one. `every*Sentence`-style constants with no caller are how a
   * copy module comes to describe a product that no longer behaves that way.
   */

  /** When the server would not accept it. The mechanism goes to the log, not here. */
  failed: "This server would not accept the change. Nothing on it was changed.",
} as const;

/**
 * The three states, one sentence each, and a fourth fact beside them.
 *
 * ## Why `starts_at_boot` is a separate argument and not folded into the state
 *
 * Because they are facts about two different things, and collapsing them is
 * exactly the lie ADR 0030 decision 2 refused. The state is about the **entry**:
 * whether it exists and whether the server's own service manager will act on it.
 * `starts_at_boot` is about the **account** DASH signs in as: a server can be
 * arranged so that this account's programs only run while somebody is signed in,
 * and on a server nobody signs in to that is a boot entry that never fires.
 *
 * DASH asks the server to change that when the switch goes on, and it does not
 * always get to. Reporting `enabled` without checking would draw *On* over a
 * reboot that does nothing — the same class of failure as reading a Windows Run
 * value's existence without reading Windows' own switch beside it.
 *
 * ## The headline and the detail are separate for the card's reason
 *
 * `describeConnectState` on the same card has the same shape, and a reader scans
 * the bold line and reads the second one only if the first is not what they
 * expected.
 */
export function describeResidency(
  state: HostServiceState,
  startsAtBoot: boolean,
): { headline: string; detail: string } {
  switch (state) {
    case "not_written":
      return {
        headline: "This server does not start your agents by itself.",
        detail:
          "If it reboots, whatever was running here stops and stays stopped until you press Run. " +
          "Turning this on changes that.",
      };
    case "enabled":
      return startsAtBoot
        ? {
            headline: "This server starts your agents when it reboots.",
            detail:
              "It does this on its own, with DASH closed and with nobody signed in to the server.",
          }
        : {
            headline: "This server will only start your agents when somebody signs in to it.",
            detail:
              "DASH asked it to start them at boot instead and the server did not agree. Until that " +
              "changes, a reboot leaves your agents stopped until somebody signs in.",
          };
    case "disabled":
      return {
        headline: "This is set up on the server and switched off there.",
        detail:
          "Somebody turned it off on the server itself, so a reboot will not start your agents. " +
          "Turning it on here switches it back on.",
      };
    default: {
      const unreachable: never = state;
      return unreachable;
    }
  }
}

/**
 * The two lines an operator types on the server to undo this.
 *
 * ## Why this is on the page at all
 *
 * ADR 0030 decision 7's third answer, and the case is stronger here. On this
 * machine a Run value can outlive DASH being deleted; on a server the entry can
 * outlive DASH being deleted, the key being rotated, the laptop being replaced,
 * and the person forgetting which product put it there. The one thing that
 * survives all of those is a line of text they can read now and match against
 * what their own server shows them.
 *
 * ## Why the unit name comes from the server and the directory does not
 *
 * The name is the server's own answer, because it is the string an operator will
 * see in their own listing. The directory is the platform's, identical on every
 * server that could have accepted this in the first place — so DASH does not
 * carry a folder off somebody's machine to render a sentence it already knows.
 * `DeployAnswer`'s `service` member has no path in it for that reason.
 */
export function describeResidencyRemoval(unitName: string): readonly string[] {
  return [
    `systemctl --user disable ${unitName}`,
    `rm ~/.config/systemd/user/${unitName}`,
  ];
}

/**
 * Why DASH could not offer the switch on this server.
 *
 * One sentence each, naming what a person would do about it rather than what
 * failed inside — `describeAutostartRefusal`'s rule, and the same three-part
 * shape.
 *
 * `init_not_supported` is the one somebody will actually meet, and it is
 * deliberately not an apology. ADR 0031 decision 2 supports one init system and
 * says why; a server running something else is a server where arranging this is
 * the operator's own decision, which is `runner/standalone.ts`'s original
 * position preserved exactly where it is still true.
 */
export function describeResidencyRefusal(problem: string): string {
  switch (problem) {
    case "init_not_supported":
      return (
        "This server does not start its programs the way DASH knows how to arrange. Starting the " +
        "agent runner when this server boots is something you can set up on the server yourself."
      );
    case "service_not_managed":
      return (
        "This server refused the change and nothing on it was altered. Trying again is safe; if it " +
        "keeps refusing, the account DASH signs in as may not be allowed to arrange this."
      );
    case "not_installed":
      return (
        "There is no agent on this server to start. Put one here first, and this will be offered " +
        "for it."
      );
    default:
      return RESIDENCY_COPY.failed;
  }
}

/**
 * When DASH last told this server what to run, and nothing more (MAR-795).
 *
 * ## The sentence ADR 0014's third question is answered with
 *
 * `POST /schedules` on the remote channel is admissible because DASH can
 * describe the result honestly afterwards, and this is that description. A
 * server holds the set it was **last told** and keeps it across a reboot; DASH
 * is open on somebody's laptop some of the time. So the only honest thing to
 * put on the card is the moment, and the exit beside it — pressing Check tells
 * it again.
 *
 * `describeAskedAt` on the same card does the same job for the standing, and the
 * two are deliberately separate sentences: when DASH last *looked* and when DASH
 * last *told* are different facts, and a card that ran them together would let a
 * fresh look imply a fresh instruction.
 *
 * Null when nothing has been pushed, and null is a real state rather than a
 * blank: a server that has never been told anything runs nothing on a schedule,
 * and saying so is the difference between that and a server that is quietly
 * holding a set from March.
 */
export function describeSchedulesTold(
  count: number,
  day: string | null,
): string {
  if (day === null) {
    return "DASH has not told this server about any scheduled times yet.";
  }
  if (count === 0) {
    return `DASH last told this server it has nothing scheduled, on ${day}.`;
  }
  const times = count === 1 ? "1 scheduled time" : `${String(count)} scheduled times`;
  return `DASH last told this server about ${times}, on ${day}.`;
}
