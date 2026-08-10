/**
 * What DASH says about an agent's folder being edited from outside (MAR-584).
 *
 * ## The one thing every sentence here has to get right
 *
 * A person opened Claude Code, pointed it at this agent's folder and asked for
 * a change. DASH's job is not to congratulate them and it is not to alarm them.
 * It is to say *what is now different from what you approved*, and then to make
 * accepting it a decision rather than something that already happened.
 *
 * That is why there is no sentence in this file claiming an agent is broken, and
 * no sentence claiming it is fine. The folder changed or it did not; DASH read
 * it or it could not; the change is describable or only countable. Five states,
 * five cards, none of them reassuring and none of them dramatic.
 *
 * ## Why nothing here names a file
 *
 * `lib/copy/identifiers.ts` refuses `sources.json` and `agent.mjs` on a guided
 * surface, and its advice for that class is exactly the right instruction here:
 * *name what the file is for, not what it is called.* A person who asked an AI
 * to "watch two more news sites" is owed "it reads two more sources", not a
 * filename they never typed. The rule is not a constraint this copy works
 * around — it is the copy's whole design, and `tests/copy-folder.test.ts` holds
 * every string in this file to it.
 *
 * Pure and import-free apart from its sibling copy module, for
 * `lib/deploy/receipt.ts`'s reason: these strings are rendered by a `"use
 * client"` tree, and a Node builtin dragged into the browser bundle is how the
 * packaged renderer stopped hydrating once already.
 */

import { describeExpectedInterval } from "./glance";

/** The same three-part shape the panel's state cards use. */
export interface FolderCard {
  headline: string;
  meaning: string;
  next_action: string | null;
}

/**
 * DASH looked and the folder is the folder it accepted.
 *
 * Says *compared*, and says against what. "No changes" on its own is a claim a
 * person cannot check and would have to take on trust from an app that had just
 * told them their editor might have changed things behind its back.
 */
export const FOLDER_UNCHANGED: FolderCard = {
  headline: "This agent's folder is the one DASH accepted.",
  meaning:
    "DASH compared everything it was handed for this agent with what is on disk now, and found the same thing.",
  next_action: null,
};

/**
 * DASH has no record of what it was handed, so it cannot answer the question.
 *
 * The honest state for every agent added before DASH started keeping the
 * record. It deliberately does not say "nothing has changed", which is the
 * comfortable sentence and the false one: DASH has not found the folder
 * unchanged, it has found that it never wrote down what unchanged would mean.
 */
export const FOLDER_NO_BASELINE: FolderCard = {
  headline: "DASH cannot tell whether this agent's folder has changed.",
  meaning:
    "It did not keep a record of what it was handed when this agent was added, so it has nothing to compare against.",
  next_action: "Add this agent again from its own folder, and DASH will keep the record from then on.",
};

/**
 * The folder is gone, or DASH cannot read what is in it.
 *
 * Worded as DASH's own failure for `UNREADABLE_FOLDER_DEPLOY_REFUSAL`'s reason:
 * it is one. The person did not do anything wrong by editing a folder, and a
 * sentence implying they had would send them looking for a mistake they did not
 * make.
 */
export const FOLDER_UNREADABLE: FolderCard = {
  headline: "DASH cannot read what it saved for this agent.",
  meaning:
    "The folder it keeps for this agent is missing or unreadable, so there is nothing for it to compare.",
  next_action: "Add this agent again from its own folder to put a fresh copy in DASH's keeping.",
};

/**
 * The heading over a rejected edit. The validator's own errors go underneath.
 *
 * Two sentences and both are load-bearing. The first says the edit was refused;
 * the second says the agent kept running on the version it had, which is the
 * question a person actually has at that moment and the one a bare error dump
 * leaves them guessing at.
 */
export const FOLDER_INVALID: FolderCard = {
  headline: "The change to this agent's folder cannot be read as an agent.",
  meaning:
    "DASH has not accepted it. What DASH shows and checks for this agent is still the version you approved.",
  /*
   * "what the checker reported" rather than "what is listed below", which is
   * what this said until the packaged frames were reviewed: the validator's
   * block renders *above* this line, so the sentence pointed at the empty space
   * under itself. Position-neutral wording survives the next layout change too.
   */
  next_action:
    "Ask the editor that made the change to fix what the checker reported, then check again.",
};

/**
 * Something changed. The list of what goes beside this, not inside it.
 *
 * ## The second sentence is the one that had to be got right
 *
 * The comfortable version — *"DASH is still running the version you approved"* —
 * was written here first and is **false**. An agent's working directory is this
 * folder (`lib/handoff-flow.ts` sets the runner's `cwd` to `code/` inside it),
 * and nothing verifies its contents before spawning. So changed instructions
 * take effect on the next run whether anyone accepted them or not, and a card
 * promising otherwise would be DASH claiming a protection it does not have.
 *
 * This is the same distinction ADR 0003 draws about `network: read` — *a
 * declaration DASH renders, not a boundary DASH enforces* — and the honest
 * version of it here is: what DASH controls is its own description of this
 * agent, and that is what it is declining to change until asked.
 *
 * `next_action` is null because the button is the next action, and a card that
 * spelled it out in prose beside a control that already says it would be the
 * same instruction twice — `ManifestGapNotice` makes the same call for the same
 * reason.
 */
export const FOLDER_CHANGED: FolderCard = {
  headline: "This agent's folder has been changed since DASH accepted it.",
  meaning:
    "DASH has not accepted the change, so everything on this page still describes the version you approved. " +
    "That is the part DASH controls: an agent runs out of this folder, so changed instructions take effect the next time it runs whether or not you accept them here.",
  next_action: null,
};

/** The controls, and what each one promises. */
export const FOLDER_CHECK_COPY = {
  action: "Check for changes",
  pending: "Checking…",
  /**
   * Under the button, before it is pressed.
   *
   * States the one thing a person cannot see and would otherwise assume the
   * other way round: DASH is not watching. An app that quietly looked every few
   * seconds and an app that looks when asked are indistinguishable on screen
   * until the moment it matters.
   */
  detail: "DASH looks when you ask it to. It does not watch this folder in the background.",
  adopt: "Accept this update",
  adopting: "Updating…",
  /**
   * Under the accept button, and it has two jobs.
   *
   * The first is `SAMPLE_REFRESH_COPY.detail`'s: name what survives, because the
   * two things a person fears losing are what the agent made and the agent they
   * recognise, and the import path really does preserve both.
   *
   * The second is to say what accepting is *for*, which stopped being obvious
   * the moment `FOLDER_CHANGED` admitted the program runs either way. It is for
   * bringing DASH's own description into line with the folder — the permission
   * receipt, the schedule DASH checks against, everything on this page — so
   * that what DASH tells you about this agent is true of the agent that runs.
   */
  adopt_detail:
    "Brings what DASH shows and checks into line with the folder, so this page describes the agent that actually runs. " +
    "Keeps its character, everything it has produced and any connected accounts.",
  adopted: "Accepted. This agent now runs the version in its folder.",
  adopt_failed: "DASH could not accept this update, and nothing was changed.",
  reveal: "Show this agent's folder",
  /**
   * Beside the reveal control.
   *
   * This is the sentence that makes the whole feature reachable: DASH keeps its
   * copy inside the user's own profile, nobody guesses that path, and an AI
   * editor cannot be pointed at a folder its owner cannot find.
   */
  reveal_detail:
    "This is the copy DASH runs. Point your editor at it, ask for the change, then come back and check.",
} as const;

/** "2 sources", "1 source". Spelled out for `count`'s reason in the glance copy. */
function count(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

/**
 * A list of names as a person would say it: "a, b and c".
 *
 * Capped, and the cap is visible in the sentence rather than silent. A change
 * that added forty sources should say so and name a few, not print forty names
 * into a notice or — worse — print three and let the reader believe that was
 * all of them.
 */
export function namedList(names: readonly string[], limit = 3): string {
  if (names.length <= limit) {
    return names.length <= 1
      ? (names[0] ?? "")
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`;
  }
  const shown = names.slice(0, limit).join(", ");
  return `${shown} and ${count(names.length - limit, "other", "others")}`;
}

/* ---------------------------------------------------------------------- *
 * The change lines
 * ---------------------------------------------------------------------- */

/**
 * Every sentence the change list can contain, composed here rather than at the
 * call site.
 *
 * One module so the plain-language test can reach all of them, and so the two
 * things that produce a change list — the check, and the deploy notice that
 * quotes it — cannot word the same fact differently.
 */
export const FOLDER_CHANGE_LINES = {
  sourcesAdded: (names: readonly string[]): string =>
    `It now reads ${count(names.length, "more source", "more sources")}: ${namedList(names)}.`,
  sourcesRemoved: (names: readonly string[]): string =>
    `It no longer reads ${namedList(names)}.`,
  /**
   * The fallback when DASH can see the sources file changed but cannot read one
   * of the two versions as a list.
   *
   * It exists because the alternative is worse in a specific way: reporting
   * "every source was removed" over a file somebody reformatted. `readSourceNames`
   * returns null rather than an empty list precisely so this sentence can be
   * reached instead of that one.
   */
  sourcesUnreadable: "The list of sources it reads has changed, in a way DASH cannot summarise.",
  scheduleAdded: (seconds: number): string =>
    `It now runs on its own, ${describeExpectedInterval(seconds)}, instead of only when you ask.`,
  scheduleRemoved: "It now runs only when you ask, instead of on its own.",
  scheduleChanged: (seconds: number): string =>
    `Its schedule changed: it now expects to run ${describeExpectedInterval(seconds)}.`,
  /** A schedule whose declared interval DASH cannot read, in either version. */
  scheduleUnclear: "How often it expects to run has changed.",
  goalChanged: "What this agent says it does has changed.",
  nameChanged: (from: string, to: string): string =>
    `Its name changed from “${from}” to “${to}”.`,
  permissionsChanged: "What this agent declares it is allowed to do has changed.",
  connectionsChanged: "What this agent needs connected has changed.",
  /**
   * Program files, counted and never named — the identifier rule, and also the
   * more useful sentence. "2 of the files it runs" tells a person the size of
   * the change; a list of names tells them nothing they can act on.
   */
  programChanged: (files: number): string =>
    `${count(files, "file", "files")} of the program DASH runs ${files === 1 ? "has" : "have"} changed.`,
  programMissing: (files: number): string =>
    `${count(files, "file", "files")} of the program DASH runs ${files === 1 ? "is" : "are"} no longer there.`,
} as const;

/* ---------------------------------------------------------------------- *
 * The server sentence (ADR 0010)
 * ---------------------------------------------------------------------- */

/** The heading over the list of servers DASH has pushed this agent to. */
export const SENT_SERVERS_HEADING = "Servers you have sent this agent to";

/**
 * What DASH may say about a copy it put on a server.
 *
 * **Read ADR 0010 before editing a word of this.** Three states, and the shape
 * of all three is the same: a clause about what DASH did, a clause about what
 * DASH can compare, and — never omitted — the clause saying DASH has not asked
 * the server. That last one is what stops any of these being read as a report on
 * the machine. DASH sent bytes once; it did not acquire a subscription to their
 * fate, and the server may since have been rebuilt, stopped or handed to
 * somebody else.
 *
 * `sentOn` is already worded by `plainDay` and is null for a date DASH cannot
 * read. The sentence then drops the date rather than printing a raw one, which
 * is `plainMoment`'s rule everywhere else it is used.
 *
 * The third state is the one a tidier design would have dropped. An agent with
 * no recorded baseline cannot be compared, and saying so is less satisfying than
 * either "up to date" or "behind" — both of which would be DASH asserting the
 * result of a comparison it did not perform.
 */
export function describeSentServer(input: {
  server: string;
  sentOn: string | null;
  comparable: boolean;
  behind: boolean;
}): FolderCard {
  const went =
    input.sentOn === null
      ? `DASH sent this agent to ${input.server}.`
      : `DASH sent this agent to ${input.server} on ${input.sentOn}.`;
  const notAsked = `DASH has not asked ${input.server} what is on it now.`;

  if (!input.comparable) {
    return {
      headline: went,
      meaning: `DASH did not keep a record of what it sent, so it cannot tell you whether that copy matches this agent. ${notAsked}`,
      next_action: null,
    };
  }
  if (input.behind) {
    return {
      headline: `${went} That copy is not this agent any more.`,
      meaning: `What DASH sent is not what this agent is now. ${notAsked} Sending again is how you make what is there match what is here.`,
      next_action: null,
    };
  }
  return {
    headline: went,
    meaning: `What DASH sent is what this agent still is. ${notAsked}`,
    next_action: null,
  };
}
