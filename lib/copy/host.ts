/**
 * Which DASH you are looking at, said out loud (MAR-432, DASH-20).
 *
 * DASH's pages now render in two places: the installed app's window, and a web
 * browser on the developer path. They show the same information, from the same
 * database, through the same projections — that part is deliberate and is what
 * "one renderer, two data sources" means.
 *
 * What is **not** the same is what they can do. The installed app's window has
 * the audited command channel; a browser tab does not and cannot, because that
 * channel is a preload bridge and a page loaded over HTTP has no preload. So
 * every control that causes an effect — starting an agent, answering an
 * approval, removing a registration — exists in one host and not the other.
 *
 * ## Why this is copy rather than a hidden branch
 *
 * The tempting implementation is to hide the buttons in the browser and say
 * nothing. That produces a page which is quietly less than it looks: a developer
 * reads the agents list, sees no way to stop an agent, and concludes DASH cannot
 * stop agents. `docs/design-brief.md` requires developer surfaces to be *marked
 * as developer surfaces* — behind a disclosure, a toggle, or a heading that says
 * who they are for — and a second-class path that does not say so is exactly the
 * thing that rule is about.
 *
 * So the asymmetry is stated where it applies, in the words below, and the
 * plain-language rule applies to them like everything else on the guided path.
 */

export type RenderHost =
  /** The installed app's own window. Reads and acts. */
  | "shell"
  /** A web browser on the developer path. Reads only. */
  | "browser";

export interface HostNotice {
  /** What this window is. One sentence. */
  headline: string;
  /** What it means for what they can do here. */
  meaning: string;
}

/**
 * What to say on a page that can show everything and change nothing.
 *
 * Returns null for the installed app, so a caller renders the notice only where
 * it is true rather than deciding for itself when to show it.
 *
 * The wording avoids "read-only mode", which sounds like a setting somebody
 * turned on and could turn off. It is not a mode; it is which window you are
 * standing in.
 */
export function describeReadOnlyHost(host: RenderHost): HostNotice | null {
  if (host === "shell") {
    return null;
  }
  return {
    headline: "This is DASH in a web browser, for people building agents.",
    meaning:
      "It shows everything the DASH app shows. Starting an agent, answering a question and removing an agent all happen in the DASH app itself, so those are not offered here.",
  };
}

/**
 * The other half of the asymmetry, pointing the other way (MAR-432).
 *
 * Reading an agent's plan from a file the user picks is a *developer* path, and
 * it works by posting to a route that only exists while DASH is running from its
 * source folder. The installed app has no such route — it has no server at all —
 * so the form there would fail on submit with nothing useful to say.
 *
 * This is a gap being stated rather than a decision being made. Nothing is lost
 * against what shipped before, because the installed app previously had no UI at
 * all. What it needs eventually is for importing to become an audited command
 * like every other effect, and that is a change to the command catalogue rather
 * than to a page.
 *
 * MAR-598 changed the second sentence and the change was not cosmetic. It used
 * to say *"the two steps above are the way to add an agent"*, which was true
 * when two terminal commands led this page. They are now below this notice and
 * behind a disclosure, and the way to add an agent is a button — so the old
 * sentence pointed a person at the wrong part of the screen for the wrong thing.
 * A stale direction is worse than no direction: it is checkable, and it fails.
 *
 * Returns null in the browser, where the form works and should simply be shown.
 */
export function describeImportUnavailable(host: RenderHost): HostNotice | null {
  if (host === "browser") {
    return null;
  }
  return {
    headline: "Reading a plan from a file you already have is not available in the app yet.",
    meaning:
      "It works when DASH is run from its own source folder, which is how people building agents run it. In this window, choosing the agent's folder is the way to add it — and that does more, because DASH takes its own copy and can run it.",
  };
}
