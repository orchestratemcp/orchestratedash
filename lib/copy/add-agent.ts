/**
 * What DASH says when somebody adds an agent by choosing its folder (MAR-598).
 *
 * ## The sentence this whole module is written against
 *
 * Henrik, on the page this replaces: *"I dont understand the ADD agent page. I
 * want it to be chose folder to add or something? … I dont get the commands or
 * anything?"* The page led with two terminal commands, in an app whose standing
 * rule is that a flow needing a terminal is broken. So the bar for every string
 * below is his own: **choose a folder, DASH does the rest, and says what it
 * did.**
 *
 * "Says what it did" is the half that is easy to drop. DASH takes a *copy* of
 * somebody's folder into a directory inside their own profile that nobody finds
 * by guessing — so a receipt that said "added" and stopped would leave a person
 * with two folders, no idea which one DASH runs, and no way to find the second.
 * `describeFolderAdded` therefore names the destination, and
 * `tests/copy-add-agent.test.ts` holds it to that.
 *
 * ## Why the destination is a path, when nothing else here is
 *
 * `lib/copy/identifiers.ts` excludes "a folder the user chose" from the raw
 * identifier rule, at the call site, through `allow`. This is the other half of
 * that: a folder DASH chose, on the user's behalf, which they are being told
 * about precisely so it stops being DASH's secret. `removeAgent` in
 * `lib/handoff-flow.ts` already names the same directory in its own receipt for
 * the same reason, and the two say it the same way on purpose.
 *
 * Pure and import-free for `lib/copy/folder.ts`'s reason: these strings are
 * rendered by a `"use client"` tree, and a Node builtin dragged into the browser
 * bundle is how the packaged renderer stopped hydrating once already.
 */

/** The same three-part shape the folder and panel cards use. */
export interface AddAgentCard {
  headline: string;
  meaning: string;
  next_action: string | null;
}

/**
 * The controls on the page, and what each one promises.
 *
 * `detail` carries the two facts a person cannot see and would otherwise have
 * to assume: that the chooser is their own operating system's and not a thing
 * DASH drew, and that nothing is added before they say yes. Both are the same
 * class of statement as `FOLDER_CHECK_COPY.detail`'s "DASH does not watch this
 * folder" — invisible on screen, and the whole difference between an app that
 * asked and an app that helped itself.
 */
export const CHOOSE_FOLDER_COPY = {
  heading: "Add an agent",
  /**
   * The lede, and the order of its clauses is the page.
   *
   * Choosing comes first because it is the only thing the person does. Reading,
   * checking and copying are what DASH does, named so the copy is not a surprise
   * later. Asking comes last because it is the promise the other three rest on.
   */
  lede: "Point DASH at the folder an agent lives in. DASH reads it, checks it, takes its own copy, and asks you before anything is added.",
  action: "Choose a folder",
  pending: "Reading that folder…",
  detail:
    "DASH opens your computer's own folder chooser. Nothing is added until you say yes, and DASH says what it found before it copies anything.",
  /**
   * Under the button in a window that cannot act.
   *
   * Said rather than drawn disabled, for `FolderUpdate`'s reason: a greyed-out
   * control here would read as a claim about the folder, and the true statement
   * is about which window this is.
   */
  read_only:
    "Open the installed DASH app to add an agent from a folder. This window can show everything and change nothing.",
  /**
   * The developer path, demoted to a disclosure and labelled with who it is for.
   *
   * It is a question rather than a heading because a disclosure that says
   * "Advanced" makes a novice wonder what they are missing, and one that asks
   * whether they are building an agent from scratch answers itself for the
   * person who is not.
   */
  scaffold_summary: "Building an agent from scratch?",
  /**
   * The one sentence in this module that had to be corrected rather than
   * written.
   *
   * It first said the commands "end at the same question the button above ends
   * at", and the paragraph under them says an agent added that way starts
   * running. Read together, those two claims tell a novice the button starts
   * the agent — which it does not. The paths really do differ at exactly that
   * point, so the difference is named here rather than left to be discovered by
   * somebody waiting for an agent to do something.
   */
  scaffold_detail:
    "If you have not made the agent yet, these two commands make one and hand it to DASH. They need no accounts, no passwords and no configuration, and DASH still asks you before it adds anything — the one difference is that an agent handed over this way starts running straight away.",
  /** Over the older paste-a-plan path, which stays for agents built elsewhere. */
  manifest_summary: "I have a plan file instead of a folder",
} as const;

/**
 * The receipt for a folder DASH has just taken into its keeping.
 *
 * Three facts, and every one of them is something a person would otherwise have
 * to guess at:
 *
 * - **what was added**, by the name its author gave it rather than by its id;
 * - **where DASH put its copy**, because a copy nobody can find is a copy
 *   nobody can edit — and `FOLDER_CHECK_COPY.reveal_detail` makes editing that
 *   folder the whole update story;
 * - **what happened to their own folder**, which is the fear this wording
 *   exists to answer. The issue is explicit that this is a copy and not a move,
 *   because taking somebody's folder away is a decision they did not make.
 *
 * There is deliberately **no "nothing was copied" branch** here. A folder that
 * was already inside DASH's keeping never reaches this function — it is refused
 * one step earlier with `FOLDER_ALREADY_IN_DASH` — so every receipt this builds
 * describes a copy that really happened. A branch for the other case would be a
 * sentence nothing can produce, sitting in the copy module that every other
 * surface reads as the list of things DASH can say.
 */
export function describeFolderAdded(input: {
  display_name: string;
  /** Where DASH's copy lives now. Named, never implied. */
  destination: string;
  /** True when this replaced an agent DASH already had. */
  replaced: boolean;
  /**
   * What is true about starting it, decided after the import actually ran.
   *
   * `"ready"` means the supervisor has re-read its list and a Start press would
   * reach this agent; `"next_open"` means the re-read could not be confirmed, so
   * the only claim that is certain is the old one; `"none"` means the folder
   * carried no program DASH knows how to start.
   */
  start: "ready" | "next_open" | "none";
}): AddAgentCard {
  const headline = input.replaced
    ? `“${input.display_name}” has been updated from that folder.`
    : `“${input.display_name}” has been added to DASH.`;
  const where =
    `DASH took its own copy of that folder and keeps it here: ${input.destination}. ` +
    "Your own folder was not moved, changed or deleted.";
  const startSentence =
    input.start === "ready"
      ? READY_TO_START
      : input.start === "next_open"
        ? WILL_START
        : CANNOT_START;
  return {
    headline,
    meaning: `${where} ${startSentence}`,
    /*
     * The next step is the one that makes the copy make sense. A person who has
     * just been told DASH runs a copy needs to know which folder to point an
     * editor at, and it is the one named above — not the one they chose.
     */
    next_action:
      "Changes you make in your own folder do not reach DASH. To change this agent, edit the copy above and press Check for changes on its page.",
  };
}

/**
 * The receipt when the supervisor has confirmed it now knows this agent.
 *
 * Still deliberately **not a promise that it is running** — the re-read makes a
 * Start press reachable, it does not press it. The person decides when it runs,
 * which is the same standing every other control in DASH gives them (MAR-616).
 */
export const READY_TO_START = "It is ready — you can start it from its page now.";

/**
 * When the agent actually runs, said rather than left to be discovered.
 *
 * **This is the honest half of "DASH does the rest" and it is deliberately not
 * a promise that it is running now.** Since MAR-616 the import asks the part of
 * DASH that supervises agents to re-read its list, and when that re-read is
 * confirmed the receipt says `READY_TO_START` instead. This sentence remains in
 * two places where it is the only certain claim: the consent dialog, which
 * speaks *before* the import runs, and the receipt of an import whose re-read
 * could not be confirmed — in both, "the next time you open DASH" is the one
 * start DASH can still promise.
 */
export const WILL_START = "DASH starts it the next time you open DASH.";

/**
 * The other end state, and it is not a failure.
 *
 * A folder with a plan and no program DASH can start is a real thing to hold —
 * it is what importing a plan has always meant — so this says what DASH *can*
 * do with it rather than apologising for what it cannot.
 */
export const CANNOT_START =
  "DASH did not find a program here that it knows how to start, so it shows what this agent plans to do without running it.";

/** The person said no in the question DASH asked. Nothing happened, and it says so. */
export const FOLDER_DECLINED: AddAgentCard = {
  headline: "DASH did not add that agent.",
  meaning: "Nothing was copied and nothing on this computer was changed.",
  next_action: null,
};

/**
 * The heading over a folder DASH could not read as an agent.
 *
 * The validator's own account goes underneath this, from
 * `explainImportFailure` — the same words the paste path and the outside-edit
 * path already use, which is what "one path, three doors" means for a refusal
 * as much as for a success.
 *
 * The second sentence is the load-bearing one. A person who has just picked a
 * folder and been refused wants to know whether they broke something, and the
 * answer is no: DASH read, declined, and copied nothing.
 */
export const FOLDER_NOT_AN_AGENT: AddAgentCard = {
  headline: "DASH could not read that folder as an agent.",
  meaning: "Nothing was copied and nothing was added. Your folder is exactly as you left it.",
  next_action: null,
};

/**
 * The person picked a folder inside DASH's own keeping.
 *
 * Not an error and not drawn as one: they found the copy DASH runs, which is
 * the folder `FOLDER_CHECK_COPY.reveal_detail` sends people to. Re-importing it
 * over itself would take the agent's own reports and history with it, so this
 * names the door that already exists for that situation instead.
 */
export const FOLDER_ALREADY_IN_DASH: AddAgentCard = {
  headline: "That folder is DASH's own copy of an agent it already has.",
  meaning:
    "Nothing was copied. Adding it again from here would replace DASH's copy with itself and lose everything the agent has produced.",
  next_action:
    "Open that agent and press Check for changes. That is how DASH picks up edits made to the copy it runs.",
};

/**
 * DASH read the folder, and will not store what is in it.
 *
 * Distinct from `FOLDER_NOT_AN_AGENT` because the plan was fine: something about
 * the *files* — a name that cannot be a folder, a path that would leave the
 * agent's own directory, more than DASH will copy for one agent — stopped it.
 * The validator's own account goes underneath, as it does everywhere else.
 */
export const FOLDER_CANNOT_BE_STORED: AddAgentCard = {
  headline: "DASH cannot safely keep a copy of that folder.",
  meaning: "Nothing was copied and nothing was added. Your folder is exactly as you left it.",
  next_action: null,
};

/**
 * DASH stopped before it ever read a plan.
 *
 * Its own card rather than one of the two above, because the reason is neither
 * "this is not an agent" nor "the plan is wrong" — DASH never got as far as
 * looking at a plan. A folder it cannot read, and a folder holding more than
 * DASH will copy for one agent, both land here with the sentence that names
 * which.
 *
 * That distinction is not pedantry. Heading an oversized folder with "there is
 * no agent in that folder" would send somebody hunting for a missing file in a
 * folder whose agent is present and perfectly fine.
 */
export function describeFolderNotRead(detail: string): AddAgentCard {
  return {
    headline: "DASH did not take that folder.",
    meaning: `${detail} Nothing was copied and nothing was added.`,
    next_action: null,
  };
}

/**
 * DASH could not finish, after the person had already said yes.
 *
 * The one card here that describes a failure of DASH's rather than a property of
 * the folder, so it is worded as one. `detail` carries whatever the store said —
 * an agent that is running and holding its own files open is the case MAR-595
 * finding 15 made legible, and it has a different next step from every other
 * failure, which is why it is passed through rather than flattened.
 */
export function describeFolderNotStored(detail: string): AddAgentCard {
  return {
    headline: "DASH could not finish adding that agent.",
    meaning: `Nothing was added, and your own folder was not changed. ${detail}`,
    next_action: null,
  };
}
