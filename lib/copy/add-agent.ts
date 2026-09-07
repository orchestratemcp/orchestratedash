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
 * One of the three ways an agent gets into DASH (MAR-879).
 *
 * ## Why three doors and one room
 *
 * Before this there was one door on the page and two elsewhere: the folder
 * chooser was the page, the sample lived only in the application menu, and
 * building one was a paragraph of terminal commands behind a disclosure
 * labelled for developers. Somebody with an empty DASH was told, in prose, to
 * go and find a menu — `TryTheScout` on the Agents page spelled out where the
 * button was and what glyph it wore, which is the shape of an interface
 * apologising for itself.
 *
 * So all three stand on this page, at the same rank, each saying what it is
 * for. What they emphatically do **not** do is fork the product: every one of
 * them ends at the same import, the same consent question and the same first
 * manual run. The sample presses the menu's own command, the assistant hands
 * DASH a handoff through `dash://`, the folder chooser is unchanged. Three
 * doors, one room — which is the only arrangement where adding a door costs
 * nothing to maintain.
 *
 * ## Why the order is sample, assistant, folder
 *
 * It is the order of how much a person has to have already. The sample needs
 * nothing; the assistant needs a coding assistant; the folder needs an agent
 * that already exists. A novice reading top to bottom stops at the first one
 * they can do, which is the whole job of an ordering.
 */
export interface AddAgentPath {
  /** The heading, and the promise. Short enough to be scanned in a column. */
  heading: string;
  /** What this door is and what it will cost, in one or two sentences. */
  means: string;
  /** The label on this path's control, or `null` where the path only explains. */
  action: string | null;
  /** What happens after the press, said before it. */
  detail: string;
}

/**
 * The three doors, and the sentence that says they are the same room.
 *
 * `lede` is the page's, and it carries the fact that makes three choices safe
 * to offer at once: whichever one somebody picks, DASH still shows them what it
 * found and still asks. Without that, three doors read as three commitments.
 */
export const ADD_AGENT_PATHS = {
  lede: "Three ways to get an agent into DASH. Whichever you choose, DASH shows you what it found and asks you before it adds anything.",
  /**
   * Under the sample's heading in a window that cannot make one.
   *
   * `CHOOSE_FOLDER_COPY.read_only`'s sentence, aimed at this door: a browser
   * tab has no shell behind it, so there is no menu to open and no operation to
   * reach. Said rather than drawn disabled, for that constant's reason.
   */
  sample_read_only:
    "Open the installed DASH app to try the sample agent. This window can show everything and change nothing.",
  /**
   * While DASH is writing the project, before the dialog appears.
   *
   * `CHOOSE_FOLDER_COPY.pending`'s job on the other door: the operation writes
   * files and mints a nonce before it can ask anything, and a button that sat
   * unchanged through that would invite a second press.
   */
  sample_pending: "Making it…",
  /**
   * The one for a person who has nothing.
   *
   * The character, the sources and the summary are named because they are what
   * the person will actually see a minute later — the same promise
   * `TryTheScout` makes on the Agents page, and it is kept by the same
   * operation.
   *
   * `detail` is the sentence the whole door turns on and it says two things in
   * order: DASH makes it, and DASH asks. Its first draft named the application
   * menu, because the press could only open one — the renderer had no way to
   * invoke a menu item and `shell.menu` deliberately carries two numbers. That
   * is gone: `sample.create` (MAR-879) reaches `offerSampleAgent` directly, so
   * the copy describes the operation rather than apologising for the route to
   * it.
   */
  sample: {
    heading: "Try a sample agent",
    means:
      "DASH makes one for you: a news scout that reads the sources you choose and writes you a short summary of what is new. No account, no password, and it runs only when you ask it to.",
    action: "Try a sample agent",
    detail:
      "DASH makes it, shows you what it will do, and asks you before adding anything.",
  },
  /**
   * The one for a person who has an idea and a coding assistant.
   *
   * Every sentence here is about what the *assistant* does, because that is
   * where the work happens — DASH's part is the last four words of it. The
   * unsupported-answers promise is not decoration: it is the difference between
   * finding out during the questions that DASH cannot post to Slack and finding
   * out after an agent is installed and silent.
   */
  assistant: {
    heading: "Build one with an assistant",
    means:
      "Tell a coding assistant what you want an agent to do. It asks you what it needs to know, one or two questions at a time, and names anything you ask for that a DASH agent cannot do yet. Then it builds the agent and hands it to DASH.",
    action: null,
    detail:
      "When it is ready, DASH comes to the front by itself and asks whether to add it. Nothing is added until you say yes.",
  },
  /**
   * The one that was the whole page before this. `means` is
   * `CHOOSE_FOLDER_COPY.lede` unchanged, because it was already the right
   * sentence for this door — what changed is that it now introduces one door
   * rather than the page.
   */
  folder: {
    heading: "Import an agent folder",
    means: CHOOSE_FOLDER_COPY.lede,
    action: null,
    detail:
      "For an agent somebody has already built — one you made yourself, or one an assistant built earlier.",
  },
} as const satisfies {
  lede: string;
  sample_read_only: string;
  sample_pending: string;
} & Record<"sample" | "assistant" | "folder", AddAgentPath>;

/**
 * Setting the builder up, in the one line a person pastes.
 *
 * ## Why this is a line and not a button
 *
 * The builder is a plugin for a *coding assistant*, not a part of DASH: it runs
 * in Claude Code or Codex, holds DASH's own import validator, and reaches DASH
 * only at the end through `dash://` (ADR 0032, `tools/dash-mcp`). DASH cannot
 * install it, because DASH is not the program it installs into.
 *
 * ## Why the path is left as a placeholder
 *
 * The line is `tools/dash-mcp/README.md`'s own, verbatim in shape, and the
 * folder really does differ per machine — the plugin lives with DASH's source
 * code, which an installed DASH does not carry. A line that guessed a path
 * would be a line that fails silently for everybody whose checkout is
 * somewhere else, so the placeholder is visible and the sentence above it says
 * what to put there.
 */
export const ASSISTANT_SETUP = {
  intro:
    "The builder is a plugin for your coding assistant. Paste this into it once, with the folder DASH's own code lives in:",
  command: "/plugin install <path to the DASH code>/tools/dash-mcp",
  /** The button beside it. Short: buttons render uppercase. */
  copy_action: "Copy setup line",
  copied: "Copied",
  copy_failed: "Select it and copy",
  after: "Then tell it what you want your agent to do. It takes DASH's questions from there.",
} as const;

/** Everything on the Add agent page that is not a card, for the copy gate. */
export function everyAddAgentPathSentence(): string[] {
  return [
    ADD_AGENT_PATHS.lede,
    ADD_AGENT_PATHS.sample_read_only,
    ADD_AGENT_PATHS.sample_pending,
    ...(["sample", "assistant", "folder"] as const).flatMap((key) => {
      const path = ADD_AGENT_PATHS[key];
      return [path.heading, path.means, path.action ?? "", path.detail];
    }),
    ASSISTANT_SETUP.intro,
    ASSISTANT_SETUP.copy_action,
    ASSISTANT_SETUP.copied,
    ASSISTANT_SETUP.copy_failed,
    ASSISTANT_SETUP.after,
  ].filter((sentence) => sentence !== "");
}

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
     * One next step, then the fact that makes the copy make sense (MAR-879).
     *
     * The order used to be the other way round, and it read as a warning rather
     * than as a direction: somebody who had just added their first agent was
     * told, first, that editing their own folder would not work. True, and not
     * what they were about to do. So the *action* leads now — and it is one
     * action, phrased for the state the import actually reached — with the
     * copy's own sentence kept behind it verbatim, because a person who edits
     * the wrong folder for a week is the failure that sentence exists against.
     */
    next_action: `${openingStep(input.start)} Changes you make in your own folder do not reach DASH — to change this agent, edit the copy above and press Check for changes on its page.`,
  };
}

/**
 * The single thing to do next, decided by what the import could promise.
 *
 * Three states rather than one sentence, because "press Start" is wrong advice
 * for two of them: an agent whose supervisor has not confirmed the re-read may
 * not have a reachable Start until DASH is opened again, and a folder with a
 * plan and no program has no Start at all. Telling somebody to press a button
 * that is not there is the same defect as a control that silently does nothing.
 */
function openingStep(start: "ready" | "next_open" | "none"): string {
  switch (start) {
    case "ready":
      return "Open its page, connect anything it still needs, and press Start when you want it to run.";
    case "next_open":
      return "Open its page to see what this agent needs and what it will do.";
    case "none":
      return "Open its page to read what this agent plans to do.";
  }
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
