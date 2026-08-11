/**
 * What DASH will and will not send to a Discord channel (MAR-588, outbound).
 *
 * These are the acceptance criteria written as checks rather than as intentions.
 * The issue's rules are that a message carries the agent's name, what kind of
 * thing happened and a deep link back into DASH — and carries no secret, no raw
 * provider content and no approval token in any URL. Three of those four are
 * *absences*, and an absence is exactly the kind of property that survives
 * review and then quietly stops being true, so each one is asserted against the
 * real composed message rather than against the code that composes it.
 */

import { describe, expect, it } from "vitest";

import {
  agentLabel,
  buildDiscordMessage,
  buildTestMessage,
  describeWebhookRefusal,
  parseDiscordWebhook,
  type NotifiableEvent,
} from "../lib/notify/discord";
import { buildOpenLink, parseOpenLink } from "../lib/open-link";
import { isMaskedHint } from "../lib/secret-refs";

/** A real-shaped webhook. The token is invented and belongs to nothing. */
const WEBHOOK =
  "https://discord.com/api/webhooks/1234567890123456789/aB3dEfGhIjKlMnOpQrStUvWxYz-0123456789_ABCDEF";

function messageFor(event: Partial<NotifiableEvent> = {}): string {
  const full: NotifiableEvent = {
    kind: "needs_approval",
    agent_id: "ai-agent-news",
    agent_title: "AI agent news",
    run_id: null,
    ...event,
  };
  return buildDiscordMessage(full, buildOpenLink({ agent: full.agent_id, run: full.run_id }))
    .content;
}

describe("what a message carries", () => {
  it("names the agent and what kind of thing happened", () => {
    expect(messageFor()).toContain("AI agent news");
    expect(messageFor()).toContain("waiting for your approval");

    const report = messageFor({ kind: "new_report", run_id: "run-7" });
    expect(report).toContain("AI agent news");
    expect(report).toContain("published a new report");
  });

  it("carries a deep link the parser on the other end accepts", () => {
    // The round trip, not the string shape. A test asserting the link *looks*
    // right would pass on the day the two sides stopped agreeing about the
    // parameter names, which is the one failure that makes every message in the
    // channel useless.
    const link = messageFor({ kind: "new_report", run_id: "run-7" })
      .split(/\s+/u)
      .find((word) => word.startsWith("dash://"));
    expect(link).toBeDefined();

    const parsed = parseOpenLink(link as string);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.target.agent).toBe("ai-agent-news");
    expect(parsed.ok && parsed.target.run).toBe("run-7");
  });

  it("sends the approval link to the agent rather than to a run", () => {
    // An approval is answered on the agent's page. A link to a run's history
    // would land somebody one click away from the thing they came back to do.
    const link = messageFor().split(/\s+/u).find((word) => word.startsWith("dash://")) as string;
    expect(link).not.toContain("run=");
  });
});

describe("the message stands alone without the link (MAR-617)", () => {
  /**
   * Discord never linkifies `dash://`, and an unpackaged DASH never claims
   * the scheme at all — see `lib/notify/discord.ts`'s header. So a message
   * whose only instruction was the link would be dead on both counts. This
   * checks the instruction survives with the link line removed entirely.
   */
  it("tells a person where to look in DASH, in words, with the link line stripped out", () => {
    const withoutLink = messageFor()
      .split("\n")
      .filter((line) => !line.includes("dash://"))
      .join("\n");
    expect(withoutLink).toContain("Agents");
    expect(withoutLink).toContain("AI agent news");
  });

  it("names where a report landed, not just the agent", () => {
    const report = messageFor({ kind: "new_report", run_id: "run-7" });
    expect(report).toContain("latest output");
  });

  it("frames the link as what an installed DASH can do, never as a bare click instruction", () => {
    const content = messageFor();
    expect(content).toContain("installed");
    // The old wording this replaces: an imperative pointed straight at a link
    // that, most of the time, does nothing when followed.
    expect(content).not.toContain("Open it in DASH:");
  });
});

describe("what a message must never carry", () => {
  /**
   * The rule stated the way it will actually be broken: not by somebody adding
   * the address to the content, but by a future field — an embed, a footer, a
   * username override — that happens to be interpolated from configuration.
   */
  it("has no field the webhook address could occupy", () => {
    const message = buildDiscordMessage(
      { kind: "new_report", agent_id: "a", agent_title: "A", run_id: "r" },
      buildOpenLink({ agent: "a", run: "r" }),
    );
    expect(Object.keys(message).sort()).toEqual(["allowed_mentions", "content"]);
    expect(JSON.stringify(message)).not.toContain("discord.com");
  });

  it("carries no approval id, token or nonce in the link", () => {
    const link = messageFor().split(/\s+/u).find((word) => word.startsWith("dash://")) as string;
    for (const forbidden of ["approval", "token", "nonce", "secret", "key"]) {
      expect(link.toLowerCase()).not.toContain(forbidden);
    }
    // And the parser refuses one that grew any of them in transit, rather than
    // ignoring the extra and opening the page anyway.
    expect(parseOpenLink(`${link}&approval_id=ap-1`).ok).toBe(false);
  });

  /**
   * The interesting half of "no raw provider content". MAR-421's OS toast puts
   * the approval's own `action_label` in the body, which is right for a message
   * that stays on the user's screen. This one leaves the machine, so the type
   * has nowhere to put it — which is what this asserts, from the caller's side.
   */
  it("gives a caller nowhere to put what the agent was doing", () => {
    const event: NotifiableEvent = {
      kind: "needs_approval",
      agent_id: "ledger",
      agent_title: "Ledger",
      run_id: null,
    };
    expect(Object.keys(event).sort()).toEqual(["agent_id", "agent_title", "kind", "run_id"]);
  });
});

describe("the agent's name cannot become a message", () => {
  it("collapses a name that tries to add its own line", () => {
    const forged = agentLabel("Ledger\nDASH: everything is fine, no action needed");
    expect(forged).not.toContain("\n");
    expect(messageFor({ agent_title: "Ledger\nDASH: all clear" }).split("\n")).toHaveLength(3);
  });

  it("escapes Discord's formatting so a name is only ever a name", () => {
    expect(agentLabel("**Ledger**")).toBe("\\*\\*Ledger\\*\\*");
    expect(agentLabel("a_b")).toBe("a\\_b");
  });

  it("disables every mention class at the API rather than by escaping", () => {
    // An agent called `@everyone` is not stopped by escaping — `@` is not
    // markdown — so the guarantee has to come from the request itself.
    const message = buildDiscordMessage(
      { kind: "needs_approval", agent_id: "a", agent_title: "@everyone", run_id: null },
      buildOpenLink({ agent: "a", run: null }),
    );
    expect(message.allowed_mentions.parse).toEqual([]);
  });

  it("caps a name so DASH's own sentence is never pushed off the end", () => {
    const label = agentLabel("x".repeat(400));
    expect(label.length).toBeLessThanOrEqual(60);
    expect(label.endsWith("…")).toBe(true);
  });

  it("falls back to a word rather than rendering a gap", () => {
    expect(agentLabel("   ")).toBe("An agent");
  });
});

describe("which addresses DASH will take", () => {
  it("accepts what Discord's copy button produces, in both path shapes", () => {
    expect(parseDiscordWebhook(WEBHOOK).ok).toBe(true);
    expect(parseDiscordWebhook(WEBHOOK.replace("/api/", "/api/v10/")).ok).toBe(true);
    // A pasted value ordinarily arrives with whitespace around it.
    expect(parseDiscordWebhook(`  ${WEBHOOK}\n`).ok).toBe(true);
  });

  /**
   * The check the whole feature's safety rests on. What a person stores here is
   * a place DASH will post to unattended for as long as it is held, so a host
   * check that matched a substring would accept somebody else's collector.
   */
  it("refuses a host that merely contains Discord's name", () => {
    const impostor = WEBHOOK.replace("discord.com", "discord.com.example.net");
    const parsed = parseDiscordWebhook(impostor);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok === false && parsed.refusal).toBe("not_discord");
  });

  it("refuses plain HTTP, which would put the token on the wire in clear", () => {
    const parsed = parseDiscordWebhook(WEBHOOK.replace("https:", "http:"));
    expect(parsed.ok === false && parsed.refusal).toBe("not_https");
  });

  it("refuses a Discord address that is not a channel webhook", () => {
    const parsed = parseDiscordWebhook("https://discord.com/channels/123/456");
    expect(parsed.ok === false && parsed.refusal).toBe("not_a_webhook");
  });

  it("refuses anything appended to the address", () => {
    expect(parseDiscordWebhook(`${WEBHOOK}?wait=true`).ok).toBe(false);
    expect(parseDiscordWebhook(`${WEBHOOK}#x`).ok).toBe(false);
  });

  it("returns a hint the store will accept and the token cannot be rebuilt from", () => {
    const parsed = parseDiscordWebhook(WEBHOOK);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    // The same shape every other credential hint in DASH takes, so the settings
    // row is checkable by `lib/secret-refs.ts`'s own rule rather than by a
    // second one written here.
    expect(isMaskedHint(parsed.masked_hint)).toBe(true);
    expect(parsed.masked_hint).toBe("••••CDEF");
    expect(WEBHOOK).toContain(parsed.masked_hint.slice(-4));
  });

  it("never quotes the value back in a refusal", () => {
    // Somebody who pasted their password into this field by mistake has still
    // pasted a credential, and the sentence they read must not contain it.
    for (const refusal of [
      "not_a_url",
      "not_https",
      "not_discord",
      "not_a_webhook",
      "carries_extra",
    ] as const) {
      const sentence = describeWebhookRefusal(refusal);
      expect(sentence).not.toContain("http");
      expect(sentence.length).toBeGreaterThan(20);
    }
  });
});

describe("the test message", () => {
  it("says nothing has happened, so a wrong channel learns nothing", () => {
    const content = buildTestMessage().content;
    expect(content).toContain("Nothing has happened yet");
    expect(buildTestMessage().allowed_mentions.parse).toEqual([]);
  });
});
