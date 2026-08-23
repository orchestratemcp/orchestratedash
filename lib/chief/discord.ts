/**
 * Who may speak to the chief from Discord, and what comes back (MAR-743, ADR
 * 0028 decisions 3, 4, 9 and 10).
 *
 * Pure. No socket, no store, no vault, no clock. That is the point rather than a
 * convention: **the admission rule is the security boundary of this whole
 * feature**, and a boundary that can only be exercised by opening a websocket to
 * Discord is a boundary nobody tests. `runner/discord-gateway.ts` holds the
 * socket and cannot decide anything; this file decides and cannot reach
 * anything.
 *
 * ## A Discord message is data
 *
 * MAR-419's injection analysis, arriving where it was aimed. What an inbound
 * message may become is exhausted by one thing: the `question` string of one
 * chief turn. It may not name a model, may not name an agent to run, may not
 * approve anything, and may not change the allowlist that admitted it. There is
 * no parser here for a command, no prefix that means something, and no field on
 * `AdmittedQuestion` that anything downstream could act on — which is why the
 * type has exactly one string on it.
 *
 * The temptation this refuses is a `!run scout` sort of command surface. It is
 * refused because the message and any confirmation of it would travel down the
 * same wire, authenticated by the same allowlist entry — one factor with an
 * extra round trip, not a second one. The human gate for a guarded action stays
 * in DASH's window, where the person can see what they are approving.
 *
 * ## Silence is the answer for everybody else
 *
 * `admit` returns `"ignore"` for every author who is not the one allowed id, and
 * the caller sends nothing at all — no reply, no reaction, no log line naming
 * them. Two reasons, and both are about somebody who is not the owner: a "you
 * are not allowed" reply tells anyone who can post in that channel that this
 * bridge exists and whose it is, and a bridge that answers strangers is a bridge
 * a stranger can make post.
 *
 * The one person who *is* allowed always gets something back — ADR 0028
 * decision 9. Silence in a chat room reads as "it is broken" and is
 * indistinguishable from "the computer is off", and only one of those is the
 * person's problem to fix.
 */

/*
 * Two value imports, both pure, and the absence of a third is load-bearing.
 *
 * `isMaskedHint` lives in `lib/secret-refs.ts`, which imports `lib/db.ts` and is
 * therefore Node-only — and this module is imported by a `"use client"` settings
 * page, so a value import of it would put `node:sqlite` in the renderer bundle.
 * That is the defect MAR-498 shipped once, when `lib/deploy/bundle` did the same
 * thing with `node:crypto` and the packaged renderer stopped hydrating.
 * `tests/client-bundle.test.ts` is what caught it here.
 *
 * `isConfigured` therefore asks whether a hint is *present* rather than whether
 * it is *shaped right*. Nothing is lost: `readChiefDiscordSettings` re-checks the
 * shape on the way out of the store and passes null when it fails, so a
 * malformed hint reaches this function as an absent one.
 */
import { describeAskFailure } from "../copy/ask";
import type { ChiefOutcome } from "./answer";

/* ---------------------------------------------------------------------- *
 * What DASH holds
 * ---------------------------------------------------------------------- */

/**
 * What the store holds about the chief's second room. Never the bot token.
 *
 * `masked_hint` is four trailing characters and is the only part of the
 * credential that exists outside the vault — `NotificationSettings`' own
 * arrangement, and there is no field a value could be assigned to, which makes
 * "the token is never rendered back" a property of the type rather than a rule
 * a settings page has to remember.
 *
 * The two snowflakes are *not* secrets and are here in full on purpose. A
 * channel id names a room nobody can reach without the token; a user id is what
 * Discord shows anybody who right-clicks a name. Both are configuration a person
 * has to be able to check, and a value nobody can read back is a value nobody
 * can correct — which is how somebody spends an evening wondering why the chief
 * ignores them when they pasted the wrong id.
 */
export interface ChiefDiscordSettings {
  /** True once a token, a channel and an allowed id have all been stored. */
  configured: boolean;
  /** The person's own switch. False means the runner opens no socket at all. */
  enabled: boolean;
  channel_id: string;
  allowed_user_id: string;
  /** `••••` plus four characters, or null when no token is stored. */
  masked_hint: string | null;
  configured_at: string | null;
}

/** What DASH holds before anybody has set anything up. */
export const NO_CHIEF_DISCORD: ChiefDiscordSettings = {
  configured: false,
  enabled: false,
  channel_id: "",
  allowed_user_id: "",
  masked_hint: null,
  configured_at: null,
};

/**
 * A Discord snowflake, as a shape rather than as a claim about who it names.
 *
 * Digits only, and long enough to be one. DASH cannot check that a channel
 * exists or that a user is real — that would be a REST call this bridge
 * deliberately does not make (ADR 0028 decision 2) — so this is the whole of the
 * validation, and its job is to catch the paste that went wrong rather than to
 * authenticate anybody.
 *
 * A username is rejected by this on purpose: `@henrik` has no digits in it, and
 * the whole of decision 4 is that a renameable handle must not become an
 * authority.
 */
export function isSnowflake(value: string): boolean {
  return /^[0-9]{15,25}$/u.test(value);
}

/** Whether a stored row describes a bridge that could actually run. */
export function isConfigured(settings: {
  channel_id: string;
  allowed_user_id: string;
  masked_hint: string | null;
}): boolean {
  return (
    isSnowflake(settings.channel_id) &&
    isSnowflake(settings.allowed_user_id) &&
    settings.masked_hint !== null
  );
}

/* ---------------------------------------------------------------------- *
 * The admission rule
 * ---------------------------------------------------------------------- */

/**
 * One message off the gateway, reduced to the four things admission looks at.
 *
 * Declared here rather than imported from the gateway for the reason
 * `RawApproval` is declared inside `runner/notify.ts`: everything here is read
 * defensively out of `unknown`, because Discord wrote it and this repository
 * does not own that document.
 */
export interface InboundMessage {
  channel_id: string;
  author_id: string;
  /** True when Discord says the author is a bot or a webhook. */
  author_is_bot: boolean;
  content: string;
}

/** What the bridge does with one message. */
export type Admission =
  /** Answer it. `question` is the whole of what the message became. */
  | { kind: "answer"; question: string }
  /**
   * Do nothing, and say nothing.
   *
   * `why` never reaches Discord and never reaches a log that names an author.
   * It exists so `tests/chief-discord.test.ts` can assert *which* rule dropped a
   * message rather than only that something did — a test that could not tell
   * "wrong channel" from "wrong person" would pass with the identity check
   * deleted.
   */
  | { kind: "ignore"; why: IgnoreReason };

export type IgnoreReason =
  | "not_configured"
  | "other_channel"
  | "a_bot"
  | "not_the_allowed_user"
  | "nothing_asked"
  | "too_long";

/**
 * How long a message may be before the bridge declines to carry it.
 *
 * Discord's own limit is 2000 for an ordinary account and higher for a paid
 * one, so this is not a restatement of theirs — it is DASH's own bound on what
 * becomes a `question` field, and it is here because that field travels into a
 * priced request. A four-thousand-character paste is not a question somebody
 * typed; it is a document, and the chief's answer to a document is MAR-744's
 * problem rather than a thing to pay for by accident.
 *
 * Declined rather than truncated, and the person is told, because a silently
 * shortened question produces an answer to something they did not ask.
 */
export const MAX_QUESTION_CHARS = 1_500;

/**
 * Whether this message becomes a question, and nothing else.
 *
 * The order is the order it should be read in: is there a bridge at all, is this
 * even the right room, is the author a person, is the author **the** person,
 * and only then is there anything to ask.
 *
 * The identity check is `===` against the stored id. Not `includes`, not a
 * lowercase comparison, not a match against a display name — a snowflake is an
 * exact string and every looser comparison is a way for somebody else's id to
 * satisfy it.
 */
export function admit(
  message: InboundMessage,
  settings: Pick<ChiefDiscordSettings, "enabled" | "channel_id" | "allowed_user_id">,
): Admission {
  if (!settings.enabled || !isSnowflake(settings.channel_id) || !isSnowflake(settings.allowed_user_id)) {
    return { kind: "ignore", why: "not_configured" };
  }
  if (message.channel_id !== settings.channel_id) {
    return { kind: "ignore", why: "other_channel" };
  }
  /*
   * Before the identity check, so the bridge's own replies can never be read
   * back as questions even if a bot somehow held the allowed id. This is the
   * loop that this class of integration gets wrong first, and it gets it wrong
   * expensively: every answer would become a question, priced.
   */
  if (message.author_is_bot) {
    return { kind: "ignore", why: "a_bot" };
  }
  if (message.author_id !== settings.allowed_user_id) {
    return { kind: "ignore", why: "not_the_allowed_user" };
  }

  const question = message.content.trim();
  if (question.length === 0) {
    // An attachment with no words, a lone emoji reaction, a sticker. Nothing was
    // asked, so there is nothing to refuse and nothing to answer.
    return { kind: "ignore", why: "nothing_asked" };
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return { kind: "ignore", why: "too_long" };
  }
  return { kind: "answer", question };
}

/* ---------------------------------------------------------------------- *
 * What goes back
 * ---------------------------------------------------------------------- */

/**
 * Discord's own hard limit on one message.
 *
 * Not configurable and not DASH's to choose: a longer body is rejected by the
 * API, so a reply that ignored this would be an answer nobody receives.
 */
export const DISCORD_MESSAGE_LIMIT = 2_000;

/**
 * The chief's answer, cut to fit, with the cut declared.
 *
 * **One message, never a burst.** Splitting a long answer across several posts
 * turns one reply into a sequence that competes with Discord's per-channel rate
 * limit and can arrive out of order under retry — so a reader gets paragraph
 * four before paragraph two and cannot tell that is what happened. A single
 * message that says it was cut is worse in one way and honest in every other.
 *
 * The tail is appended *inside* the budget rather than after it, so the result
 * is always under the limit — including the case where the answer is exactly at
 * it, which is the one an off-by-one would find in front of Henrik.
 */
export function fitReply(answer: string, tail = REPLY_CUT): string {
  const text = answer.trim();
  if (text.length <= DISCORD_MESSAGE_LIMIT) {
    return text;
  }
  const room = DISCORD_MESSAGE_LIMIT - tail.length;
  return `${text.slice(0, room).trimEnd()}${tail}`;
}

/**
 * What a cut answer says about itself.
 *
 * Names where the whole thing is, because it genuinely is somewhere: the turn is
 * in `chief_messages` complete, and DASH shows it in full. A tail that only said
 * "truncated" would leave somebody believing the rest was lost.
 */
export const REPLY_CUT = "\n\n— cut to fit Discord. The whole answer is in DASH, on this computer.";

/**
 * What goes back for one outcome — and something always does (ADR 0028
 * decision 9).
 *
 * **There is no arm of this function that returns nothing.** That is the whole
 * of decision 9 written as a total function: silence in a chat room reads as "it
 * is broken", is indistinguishable from "the computer is off", and only one of
 * those is the person's problem to fix. A `switch` with a returned string on
 * every branch is a stronger guarantee than a rule saying somebody should
 * remember to reply.
 *
 * The refusal words are `describeAskFailure`'s, not new ones. A provider being
 * down should read the same in Discord as it reads in the window, because it is
 * the same fact — and a second vocabulary for it would be a second thing to keep
 * true. What differs is `model_setting`: the window can say "the AI tab in
 * Settings" and mean a tab the reader is looking at; from a phone in a chat room
 * the honest phrasing names the app.
 */
export function replyFor(outcome: ChiefOutcome): string {
  switch (outcome.kind) {
    case "answered":
      return outcome.no_model ? `${outcome.text}\n\n${NO_MODEL_NOTE}` : outcome.text;

    case "empty":
      // `admit` drops an empty message before it becomes a question, so this is
      // a guard rather than a state anybody reaches. Answered anyway, because a
      // function that could return nothing is a function somebody can make
      // return nothing.
      return "I did not catch a question there.";

    case "refused": {
      const recovery = describeAskFailure(outcome.reason, {
        service: outcome.service,
        model_setting: MODEL_SETTING_ELSEWHERE,
      });
      return `${recovery.headline}\n\n${recovery.meaning}\n\n${recovery.next_action}`;
    }

    case "not_recorded":
      /*
       * Two opposite facts about somebody's money, and they get different
       * sentences because the reader's next move differs.
       *
       * `answer_lost` means a provider was paid and DASH dropped what it bought
       * — the answer is gone and it cost something, which the person is owed
       * plainly. `dash_error` means nothing was spent.
       */
      return outcome.reason === "answer_lost"
        ? "I got an answer and could not write it down, so it is gone. Your provider will still have charged for it. " +
            "Open DASH on your computer — its records could not be written, and that is worth looking at."
        : "I could not write that down, so I have not answered it. Nothing was charged. Open DASH on your computer and try again.";
  }
}

/**
 * The note under an answer the model would have written better.
 *
 * The answer above it is real — the fleet's own standing, read off the same
 * records DASH draws its cards from — and this says what could not be *added* to
 * it. Two situations reach it and the sentence is true of both: no default model
 * has ever been set, and the computer restarted so the key the runner holds in
 * memory is gone until DASH is opened once.
 */
export const NO_MODEL_NOTE =
  "That is read straight off your own records. To get an answer in my own words I have to put your " +
  "question to a model provider, and I have nothing to ask right now — open DASH on your computer, " +
  "and check that a default model is set on the AI tab.";

/** Where a refusal sends somebody, said from a room that is not DASH. */
const MODEL_SETTING_ELSEWHERE = "the default model on the AI tab in DASH, on your computer";

/* ---------------------------------------------------------------------- *
 * The words
 * ---------------------------------------------------------------------- */

/**
 * When the chief answers in Discord and when it does not — before setup, not
 * after.
 *
 * `NOTIFY_LIVENESS`' shape and its discipline, with **one more sentence**. The
 * runner holds the model key in memory only, so a restart leaves the bridge
 * connected-in-the-store and unable to answer in its own words until DASH is
 * opened once. That is the sentence somebody would otherwise discover on a
 * Monday morning, and softening it is the only way it could be wrong.
 */
export const CHIEF_DISCORD_LIVENESS: readonly string[] = [
  "While DASH is open, the chief answers in Discord as you ask.",
  "With DASH closed and the computer on, it still answers: DASH leaves the part that runs your agents running, and the chief now rides along with it.",
  "With the computer off, asleep or restarted, nothing answers — there is nothing running to answer. When it comes back, open DASH once: the key the chief asks a model with is held in memory only and is gone after a restart.",
  "Until you do, the chief still replies from your own records — what your agents are, what they are for and how they are standing — and says that it could not write you a sentence of its own.",
];

/**
 * What ends up in that channel, said plainly before anyone chooses one.
 *
 * This is the disclosure that decides whether a person picks a private channel
 * or a shared one, so it belongs above the field rather than under it — and it
 * is a longer list than the notifier's, because this room carries the answers
 * themselves rather than the fact that something happened.
 */
export const CHIEF_DISCORD_CONTENTS: readonly string[] = [
  "Your questions, as you type them, and the chief's answers in full.",
  "Those answers describe your fleet: what your agents are called, what their authors said they are for, and how they are standing.",
  "Anyone who can read that channel can read all of it. A private channel only you are in is the right choice unless you mean to share it.",
  "Nothing else. No key, no connection address, and nothing an agent read or wrote.",
];

/**
 * How to get the three values, in the order Discord's own screens present them.
 *
 * Written from the Discord side, because that is where the person has to go and
 * it is the half they have not done before. The message-content step is called
 * out by name: it is a privileged intent, Discord asks about it on its own
 * screen, and a person who skips it gets a bridge that connects and never hears
 * anything — which is the worst failure this setup can produce, because it looks
 * like DASH is broken.
 */
export const CHIEF_DISCORD_SETUP_STEPS: readonly string[] = [
  "At discord.com/developers, press New Application, give it a name, then open the Bot tab.",
  "On that tab, turn ON Message Content Intent. Without it the bot connects and never hears you.",
  "Press Reset Token, then Copy — this is the credential, and Discord shows it once.",
  "On the Installation or OAuth2 tab, invite the bot to your server with the bot scope and permission to read and send messages in one channel.",
  "In Discord, right-click that channel and Copy Channel ID, then right-click your own name and Copy User ID. (Turn on Developer Mode in Discord's Advanced settings if you do not see those.)",
  "Paste all three into DASH. The token goes straight into this computer's vault and is never shown again.",
];

/** The one-line answer to "what is DASH about to do with this". */
export const CHIEF_DISCORD_CUSTODY =
  "The bot token is a credential: anyone holding it can read and post in every channel that bot is in. " +
  "DASH puts it in this computer's vault, never shows it again, and never writes it to a log. It cannot " +
  "be used to ask the chief anything — only the Discord account whose id you paste below can do that.";

/**
 * The whole state, as a chip and a sentence.
 *
 * `describeNotificationStanding`'s shape and its rule: **the chip says the true
 * thing rather than the reassuring one.** Somebody who switched the bridge off
 * and comes back a month later needs this row to explain why their Discord is
 * quiet, and a chip reading "Listening" over a runner with no socket would be a
 * lie that only a control further down corrects.
 *
 * The allowed id is in the sentence rather than hidden. It is the field that
 * decides whether this works at all, the commonest way it fails is a right-click
 * that copied the wrong one, and it is not a secret — Discord shows it to
 * anybody who asks for it.
 */
export function describeChiefDiscordStanding(
  settings: Pick<ChiefDiscordSettings, "configured" | "enabled" | "allowed_user_id">,
  /** `plainDay(configured_at)`, resolved by the caller. Null when unreadable. */
  since: string | null,
): { chip: string; on: boolean; sentence: string } {
  if (!settings.configured) {
    return {
      chip: "Not set up",
      on: false,
      sentence: "The chief answers only in DASH, on this computer.",
    };
  }
  const added = since === null ? "" : `, set up ${since}`;
  if (!settings.enabled) {
    return {
      chip: "Switched off",
      on: false,
      sentence: `Your channel is still here${added}, and the chief is not listening in it.`,
    };
  }
  return {
    chip: "Listening",
    on: true,
    sentence: `The chief answers in your channel${added}, to the Discord account ending ${settings.allowed_user_id.slice(-4)} and to nobody else.`,
  };
}

/** Every sentence this function composes, for the plain-language check. */
export function everyChiefDiscordStandingSentence(): string[] {
  const base = { configured: true, enabled: true, allowed_user_id: "123456789012345678" };
  return [
    describeChiefDiscordStanding({ ...base, configured: false }, null).sentence,
    describeChiefDiscordStanding({ ...base, enabled: false }, "on 3 August").sentence,
    describeChiefDiscordStanding(base, "on 3 August").sentence,
  ];
}

/** The prompt's own words, for the window `promptForSecret` opens. */
export const CHIEF_DISCORD_PROMPT = {
  service: "Discord",
  field_label: "Discord bot token",
  purpose: "So the chief can hear you in Discord and answer there, including while DASH is closed.",
  help: "At discord.com/developers: your application, then the Bot tab, then Reset Token and Copy.",
};

/**
 * Every sentence this module can produce, for the copy sweep.
 *
 * Derived from the constants rather than written out again — `everyChiefManifestSentence`'s
 * shape, and for its reason: a line changed above without a matching entry here
 * would be copy no plain-language walk ever reads.
 */
export function everyChiefDiscordSentence(): string[] {
  return [
    ...CHIEF_DISCORD_LIVENESS,
    ...CHIEF_DISCORD_CONTENTS,
    ...CHIEF_DISCORD_SETUP_STEPS,
    ...everyChiefDiscordStandingSentence(),
    CHIEF_DISCORD_CUSTODY,
    CHIEF_DISCORD_PROMPT.purpose,
    CHIEF_DISCORD_PROMPT.help,
    REPLY_CUT.trim(),
    NO_MODEL_NOTE,
    // The two arms of `replyFor` that write their own words rather than
    // borrowing `describeAskFailure`'s. Produced by calling it, so a sentence
    // edited above cannot go missing from here.
    replyFor({ kind: "empty" }),
    replyFor({ kind: "not_recorded", reason: "answer_lost", service: "" }),
    replyFor({ kind: "not_recorded", reason: "dash_error", service: "" }),
  ];
}
