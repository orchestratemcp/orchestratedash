/**
 * Who may speak to the chief from Discord, and what it says back (MAR-743, ADR
 * 0028).
 *
 * This is the security test of the packet. Everything the bridge refuses is
 * refused by `admit`, which is a pure function precisely so that these cases can
 * be driven without a socket, a token or a Discord account — `runner/discord-gateway.ts`
 * holds the connection and decides nothing, and this proves the half that
 * decides.
 *
 * The cases are ordered as the rules are: not set up, wrong room, a bot, the
 * wrong person, nothing asked, too long. Each one asserts *which* rule dropped
 * the message rather than only that something did, because a test that could not
 * tell "wrong channel" from "wrong person" would pass with the identity check
 * deleted.
 */

import { describe, expect, it } from "vitest";

import {
  DISCORD_MESSAGE_LIMIT,
  MAX_QUESTION_CHARS,
  NO_MODEL_NOTE,
  REPLY_CUT,
  admit,
  describeChiefDiscordStanding,
  everyChiefDiscordSentence,
  fitReply,
  isConfigured,
  isSnowflake,
  replyFor,
  type InboundMessage,
} from "../lib/chief/discord";
import { expectPlainLanguage } from "./helpers/plain-language";

const CHANNEL = "111111111111111111";
const HENRIK = "222222222222222222";
const SOMEBODY_ELSE = "333333333333333333";

const BRIDGE = { enabled: true, channel_id: CHANNEL, allowed_user_id: HENRIK };

function message(over: Partial<InboundMessage> = {}): InboundMessage {
  return {
    channel_id: CHANNEL,
    author_id: HENRIK,
    author_is_bot: false,
    content: "how is the fleet doing",
    ...over,
  };
}

/** A turn where no tool ran. MAR-744's evidence union, at its empty arm. */
const NO_EVIDENCE = { kind: "none" } as const;

describe("who the chief hears", () => {
  it("answers the one allowed identity, in the one channel", () => {
    expect(admit(message(), BRIDGE)).toEqual({
      kind: "answer",
      question: "how is the fleet doing",
    });
  });

  it("ignores everybody else, and says so only to the test", () => {
    /*
     * The rule ADR 0028 decision 4 spends the most words on. Somebody else in
     * the channel gets **nothing** — no reply, no reaction — because a "you are
     * not allowed" answer tells anybody who can post there that this bridge
     * exists and whose it is, and because a bridge that answers strangers is a
     * bridge a stranger can make post.
     */
    expect(admit(message({ author_id: SOMEBODY_ELSE }), BRIDGE)).toEqual({
      kind: "ignore",
      why: "not_the_allowed_user",
    });
  });

  it("compares the id exactly, so a near miss is a stranger", () => {
    // Not `includes`, not case-insensitive, not a display name. A snowflake is
    // an exact string and every looser comparison is a way for somebody else's
    // id to satisfy it.
    for (const id of [`${HENRIK}4`, HENRIK.slice(0, -1), ` ${HENRIK}`, ""]) {
      expect(admit(message({ author_id: id }), BRIDGE)).toEqual({
        kind: "ignore",
        why: "not_the_allowed_user",
      });
    }
  });

  it("ignores another channel even when the right person is speaking", () => {
    expect(admit(message({ channel_id: SOMEBODY_ELSE }), BRIDGE)).toEqual({
      kind: "ignore",
      why: "other_channel",
    });
  });

  it("ignores bots and webhooks before it looks at who they claim to be", () => {
    /*
     * The loop this class of integration gets wrong first, and it gets it wrong
     * expensively: every answer would come back as a question, priced. Asserted
     * with the *allowed* id on the bot, so the test fails if the bot check is
     * moved below the identity check.
     */
    expect(admit(message({ author_is_bot: true }), BRIDGE)).toEqual({
      kind: "ignore",
      why: "a_bot",
    });
  });

  it("hears nothing at all when the bridge is switched off", () => {
    expect(admit(message(), { ...BRIDGE, enabled: false })).toEqual({
      kind: "ignore",
      why: "not_configured",
    });
  });

  it("hears nothing when the stored ids are not ids", () => {
    // A store somebody edited, a half-written row, a migration that went wrong.
    // The bridge refuses rather than falling back to a looser rule — an empty
    // `allowed_user_id` compared with `===` would otherwise admit an author
    // whose id failed to parse.
    expect(admit(message(), { ...BRIDGE, allowed_user_id: "@henrik" })).toEqual({
      kind: "ignore",
      why: "not_configured",
    });
    expect(admit(message(), { ...BRIDGE, channel_id: "" })).toEqual({
      kind: "ignore",
      why: "not_configured",
    });
  });

  it("drops a message with no words in it, and one too long to carry", () => {
    expect(admit(message({ content: "   " }), BRIDGE)).toEqual({
      kind: "ignore",
      why: "nothing_asked",
    });
    expect(admit(message({ content: "x".repeat(MAX_QUESTION_CHARS + 1) }), BRIDGE)).toEqual({
      kind: "ignore",
      why: "too_long",
    });
    // The bound is inclusive: a question exactly at it is carried.
    expect(admit(message({ content: "x".repeat(MAX_QUESTION_CHARS) }), BRIDGE).kind).toBe("answer");
  });

  it("carries the message and nothing else", () => {
    /*
     * ADR 0028 decision 3, as a shape rather than as a rule. The admitted value
     * has exactly one field, so there is nothing on it a downstream caller could
     * act on — no author, no channel, no id, no verb. A `!run scout` message
     * becomes the literal question "!run scout" and is answered as text.
     */
    const admitted = admit(message({ content: "!run scout" }), BRIDGE);
    expect(admitted).toEqual({ kind: "answer", question: "!run scout" });
    expect(Object.keys(admitted).sort()).toEqual(["kind", "question"]);
  });
});

describe("what a Discord id is", () => {
  it("takes a snowflake and refuses a handle", () => {
    expect(isSnowflake(CHANNEL)).toBe(true);
    // The whole of decision 4's "not a username": a renameable handle must not
    // become an authority, and it cannot satisfy this.
    expect(isSnowflake("@henrik")).toBe(false);
    expect(isSnowflake("henrik#0001")).toBe(false);
    expect(isSnowflake("12345")).toBe(false);
    expect(isSnowflake(`${CHANNEL} `)).toBe(false);
    expect(isSnowflake("")).toBe(false);
  });

  it("is configured only when all three are there", () => {
    expect(
      isConfigured({ channel_id: CHANNEL, allowed_user_id: HENRIK, masked_hint: "••••abcd" }),
    ).toBe(true);
    expect(
      isConfigured({ channel_id: CHANNEL, allowed_user_id: HENRIK, masked_hint: null }),
    ).toBe(false);
    expect(
      isConfigured({ channel_id: CHANNEL, allowed_user_id: "", masked_hint: "••••abcd" }),
    ).toBe(false);
    expect(
      isConfigured({ channel_id: "", allowed_user_id: HENRIK, masked_hint: "••••abcd" }),
    ).toBe(false);
  });
});

describe("what comes back", () => {
  it("always says something (ADR 0028 decision 9)", () => {
    /*
     * The decision as a property rather than as a rule. Every arm of
     * `ChiefOutcome` is driven through `replyFor` and every one must produce
     * text, because silence in a chat room reads as "it is broken" and is
     * indistinguishable from "the computer is off".
     */
    const outcomes = [
      { kind: "answered", text: "Four agents, all quiet.", from: "records", no_model: false, evidence: NO_EVIDENCE },
      { kind: "answered", text: "Four agents, all quiet.", from: "records", no_model: true, evidence: NO_EVIDENCE },
      { kind: "answered", text: "Written for you.", from: "model", no_model: false, evidence: NO_EVIDENCE },
      { kind: "refused", reason: "not_connected", service: "OpenRouter", evidence: NO_EVIDENCE },
      { kind: "refused", reason: "provider_unavailable", service: "OpenRouter", evidence: NO_EVIDENCE },
      { kind: "refused", reason: "too_many", service: "OpenRouter", evidence: NO_EVIDENCE },
      { kind: "empty" },
      { kind: "not_recorded", reason: "answer_lost", service: "OpenRouter" },
      { kind: "not_recorded", reason: "dash_error", service: "DASH" },
    ] as const;

    for (const outcome of outcomes) {
      const reply = replyFor(outcome);
      expect(reply.trim().length).toBeGreaterThan(0);
    }
  });

  it("keeps the records answer and adds what could not be added to it", () => {
    // The degraded path is not an apology that replaces the answer. The fleet
    // facts are still there, and the note says what is missing.
    const reply = replyFor({
      kind: "answered",
      text: "Four agents, all quiet.",
      from: "records",
      no_model: true,
      evidence: NO_EVIDENCE,
    });
    expect(reply).toContain("Four agents, all quiet.");
    expect(reply).toContain(NO_MODEL_NOTE);
  });

  it("says a provider was paid when an answer is lost, and not when it was not", () => {
    // Two opposite facts about somebody's money, and the reader's next move
    // differs, so the sentences do.
    expect(replyFor({ kind: "not_recorded", reason: "answer_lost", service: "X" })).toContain(
      "charged",
    );
    expect(replyFor({ kind: "not_recorded", reason: "dash_error", service: "X" })).toContain(
      "Nothing was charged",
    );
  });
});

describe("fitting a reply into a Discord message", () => {
  it("leaves a short answer exactly as it is", () => {
    expect(fitReply("Four agents, all quiet.")).toBe("Four agents, all quiet.");
  });

  it("cuts a long one, declares the cut, and still fits", () => {
    const long = "word ".repeat(1_000);
    const fitted = fitReply(long);
    expect(fitted.length).toBeLessThanOrEqual(DISCORD_MESSAGE_LIMIT);
    expect(fitted.endsWith(REPLY_CUT)).toBe(true);
    // Names where the whole thing is, because it genuinely is somewhere.
    expect(fitted).toContain("DASH");
  });

  it("does not cut an answer that is exactly at the limit", () => {
    // The off-by-one that would otherwise be found in front of somebody.
    const exact = "x".repeat(DISCORD_MESSAGE_LIMIT);
    expect(fitReply(exact)).toBe(exact);
    expect(fitReply(`${exact}x`).length).toBeLessThanOrEqual(DISCORD_MESSAGE_LIMIT);
  });
});

describe("the standing row", () => {
  it("says the true thing rather than the reassuring one", () => {
    // The rule `describeNotificationStanding` established: a bridge that is set
    // up and switched off must not read as listening, because the row is what
    // explains a quiet Discord to somebody who comes back a month later.
    const off = describeChiefDiscordStanding(
      { configured: true, enabled: false, allowed_user_id: HENRIK },
      "on 3 August",
    );
    expect(off.on).toBe(false);
    expect(off.chip).not.toContain("Listening");

    const on = describeChiefDiscordStanding(
      { configured: true, enabled: true, allowed_user_id: HENRIK },
      "on 3 August",
    );
    expect(on.on).toBe(true);
    // The allowed id is shown, because it is the field most likely to be wrong
    // and it is not a secret.
    expect(on.sentence).toContain(HENRIK.slice(-4));
  });
});

describe("the words", () => {
  it("says the three things a person cannot discover later", () => {
    const setup = everyChiefDiscordSentence().join(" ");
    // The privileged intent, named before Discord's own screen asks about it —
    // a person who skips it gets a bridge that connects and never hears them,
    // which looks exactly like DASH being broken.
    expect(setup).toContain("Message Content Intent");
    // What holding the token means for somebody who is not the owner.
    expect(setup.toLowerCase()).toContain("read and post");
    // The restart clause, which is one sentence longer than MAR-588's third.
    expect(setup).toContain("open DASH once");
  });

  it("is plain language throughout", () => {
    expectPlainLanguage(everyChiefDiscordSentence());
  });
});
