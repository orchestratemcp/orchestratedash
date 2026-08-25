/**
 * The Startup settings page, in the words a person reads (MAR-785, ADR 0030).
 *
 * ## What this page is for, and why it is its own tab
 *
 * `app/settings/preferences/page.tsx` opens with *"how DASH looks, not what it
 * does"*, and MAR-599 made that separation deliberate. This is squarely the
 * other thing: it changes what happens on a machine nobody is sitting at. So it
 * is a tab rather than a fifth row on Preferences, and the label is the question
 * a person would ask — "startup" — rather than the mechanism, which is a
 * registry value they should never need to know about to use the control.
 *
 * ## The rule this copy is held to
 *
 * `AGENT_TRIGGER_COPY.liveness` has told people three true sentences since
 * MAR-641, and the third one — *"If this computer is asleep, off, or restarting,
 * nothing runs"* — is the sentence this feature exists to change the second half
 * of. ADR 0029 wrote it, and wrote down why it would be a downgrade in honesty
 * to replace a true sentence about what DASH cannot do with silence.
 *
 * The same bar applies here, and it cuts both ways: turning this on does **not**
 * make a schedule survive the machine being *off over the window*. Nothing
 * backfills, ADR 0029 decision 7 decided that on purpose, and this page says so
 * beside the switch rather than letting a person infer that "starts at login"
 * means "never misses". Every sentence below is written so that a person who
 * reads only this page and then reboots is not surprised by what they find.
 *
 * ## Why the command line is on the page
 *
 * `enrolled_command` is shown, not hidden behind a disclosure. This control
 * writes a value into the person's own Windows startup list; the literal text of
 * what it wrote is the difference between a setting and a thing that happened to
 * their computer. It is also what makes the entry removable by hand if DASH is
 * ever deleted without being switched off first, which — see ADR 0030's section
 * on uninstall — is a real case with no hook to catch it.
 */

import type { AutostartRefusal } from "../shell/autostart";

export const STARTUP_COPY = {
  /** The tab, the heading, and the sidebar entry all say the same word. */
  tab: "Startup",
  heading: "When this computer starts",

  /**
   * The one control.
   *
   * "Keep DASH's helper running" rather than "enable autostart", and
   * deliberately the same word `AGENT_TRIGGER_COPY.liveness` already uses for
   * the runner: *"DASH leaves a small helper running that starts it."* A person
   * who read that sentence on an agent's settings page and came looking for the
   * switch should recognise the thing they are switching.
   */
  toggle: {
    label: "Start DASH's helper when I sign in",
    detail:
      "The small background helper that runs your agents starts on its own after you sign in to Windows. DASH itself does not open, and no window appears.",
  },

  /**
   * The two button faces.
   *
   * Two words each, because `app/globals.css` uppercases every `button` and a
   * long label in capitals is the thing MAR-646's frames kept catching.
   * "Turn off" is `AGENT_TRIGGER_COPY.turn_off` verbatim — the same act, said
   * the same way, on the two pages where a person turns an unattended thing off.
   */
  toggle_on: "Turn on",
  toggle_off: "Turn off",

  /** Off until pressed, said before the press rather than after. */
  opt_in: "This is off until you turn it on. DASH never adds itself to your startup list on its own.",

  /**
   * What is true with the switch on, and what is still not.
   *
   * Three sentences again, and the third is the one that has to stay. It is
   * ADR 0029 decision 7 restated for this page: a window that came round while
   * the machine was off is recorded as missed and is not run late, and turning
   * this on does not change that.
   */
  liveness_on: [
    "Sign in to Windows and the helper starts. Anything you scheduled runs at its time, with DASH closed.",
    "Runs that happen while DASH is closed show up in DASH the next time you open it.",
    "A time that came round while this computer was off or asleep is still missed. DASH tells you it was missed and does not run it late.",
  ] as readonly string[],

  /** What is true with the switch off, so both states are described. */
  liveness_off: [
    "Nothing starts on its own. Open DASH once after signing in and the helper starts with it.",
    "Until you do, a scheduled time that comes round is missed.",
  ] as readonly string[],

  /**
   * The three things this switch does not do, stated because each one is a
   * thing a person could reasonably assume it did.
   */
  not_this: [
    "It does not open DASH's window.",
    "It does not open a port or let anything reach this computer from outside.",
    "It does not start your agents. It starts the helper that runs them when their time comes.",
  ] as readonly string[],

  /** Above the literal command, on the page. */
  command_label: "What gets added to your startup list",
  command_note:
    "You can see this in Windows under Startup apps, and remove it there if you ever need to.",

  /** Windows' own switch, when it disagrees with DASH's (`approved: false`). */
  windows_disabled:
    "Windows has this switched off in Startup apps, so it will not run. Turn it back on there, or switch this off and on again.",

  /** A startup entry under DASH's name that belongs to a different copy. */
  foreign:
    "Something is already starting under this name and it is not this copy of DASH. Turning this on replaces it.",

  /** Said after a press succeeds, in the person's terms. */
  enrolled: "Added. The helper will start the next time you sign in.",
  removed: "Removed. Nothing starts on its own now.",

  /** When Windows refused the write. The mechanism goes to the log, not here. */
  failed: "DASH could not change your startup list. Nothing was changed.",
} as const;

/**
 * Why this copy of DASH cannot offer the switch.
 *
 * One sentence each, and each names what a person would do about it rather than
 * what went wrong inside. `foreign_checkout` is the one somebody will actually
 * meet: it is a session running DASH out of a git worktree, and the answer is
 * the main checkout, which is the same answer ADR 0027's store refusal gives.
 */
export function describeAutostartRefusal(refusal: AutostartRefusal): string {
  switch (refusal) {
    case "unsupported_platform":
      return "Starting the helper at sign-in works on Windows. DASH does not do it on this system yet.";
    case "foreign_checkout":
      return "This copy of DASH is running from a working copy of the source, not from your installed DASH. Only your installed DASH can add itself to startup.";
    case "scratch_store":
      return "This copy of DASH is running against a temporary set of data, so there is nothing here worth starting at sign-in.";
    default: {
      const unreachable: never = refusal;
      return unreachable;
    }
  }
}
