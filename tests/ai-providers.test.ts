/**
 * The closed model-provider registry, pinned (MAR-582).
 *
 * `lib/ai/providers.ts` decides three things a request depends on — where it
 * goes, what path it uses, and which header carries the key — and it decides
 * them for a service DASH sends somebody's paid credential to. The whole point
 * of writing them by value is that widening them is a diff a reviewer reads, and
 * a by-value list with no by-value assertion is just a list.
 *
 * So this file is deliberately dull. It asserts the answers, not the mechanism.
 */

import { describe, expect, it } from "vitest";

import {
  AI_AUTH_HEADERS,
  AI_PROVIDER_IDS,
  aiAuthHeaders,
  aiModelsUrl,
  aiProviderById,
  aiProviderFor,
  aiProviders,
} from "../lib/ai/providers";
import { brokerProfileFor, describeCustody, describeKeyNarrowing } from "../lib/broker/providers";
import { expectPlainLanguage } from "./helpers/plain-language";

describe("the registry", () => {
  it("is three providers and no others", () => {
    expect([...AI_PROVIDER_IDS]).toEqual(["openrouter", "anthropic", "openai"]);
  });

  it("sends each one to its own origin and its own path", () => {
    expect(aiProviders().map((profile) => aiModelsUrl(profile))).toEqual([
      "https://openrouter.ai/api/v1/models",
      "https://api.anthropic.com/v1/models",
      "https://api.openai.com/v1/models",
    ]);
  });

  it("names no service DASH has not built a flow for", () => {
    // The membership rule, from the other side. A popular provider DASH knows
    // nothing about resolves to null, and a key for it stays an opaque string
    // DASH holds and hands over — the path this issue deliberately did not touch.
    expect(aiProviderFor("mistral")).toBeNull();
    expect(aiProviderFor("google-gmail")).toBeNull();
    expect(aiProviderFor("")).toBeNull();
    expect(aiProviderFor(null)).toBeNull();
    expect(aiProviderFor(undefined)).toBeNull();
  });

  it("cannot be reached through a prototype member", () => {
    // The `operationById` argument, applied here: a plain-object lookup would
    // answer for `constructor` and `toString`, and an agent naming one is the
    // kind of thing that is funny until it is a bug report.
    expect(aiProviderFor("constructor")).toBeNull();
    expect(aiProviderById("__proto__")).toBeNull();
    expect(aiProviderById("toString")).toBeNull();
  });
});

describe("the key on the wire", () => {
  it("puts each provider's key in the header that provider reads", () => {
    const key = "sk-example";
    expect(aiAuthHeaders(aiProviderById("openrouter")!, key)).toEqual({
      authorization: "Bearer sk-example",
    });
    expect(aiAuthHeaders(aiProviderById("openai")!, key)).toEqual({
      authorization: "Bearer sk-example",
    });
    expect(aiAuthHeaders(aiProviderById("anthropic")!, key)).toEqual({
      "x-api-key": "sk-example",
      "anthropic-version": "2023-06-01",
    });
  });

  it("uses no header outside the declared set", () => {
    // The list `lib/broker/execute.ts` checks against before it merges anything
    // into a request. A provider profile that grew a fourth header would fail
    // here and at module load, which is two chances to notice before a key ends
    // up somewhere structural.
    expect([...AI_AUTH_HEADERS]).toEqual(["authorization", "x-api-key", "anthropic-version"]);
    for (const profile of aiProviders()) {
      for (const header of Object.keys(aiAuthHeaders(profile, "k"))) {
        expect(AI_AUTH_HEADERS).toContain(header);
      }
    }
  });

  it("never lets a key reach the path or the query", () => {
    // A key is not interpolated anywhere. The URL is built from constants, so
    // the assertion is simply that a distinctive key cannot appear in one.
    for (const profile of aiProviders()) {
      expect(aiModelsUrl(profile)).not.toContain("sk-");
      expect(new URL(aiModelsUrl(profile)).search).toBe("");
    }
  });
});

describe("the broker's view of the same three", () => {
  it("gives every registry entry a keyed broker profile at the same origin", () => {
    // The correspondence `lib/ai/connection-view.ts` relies on when it says its
    // fallback is unreachable. Two tables built from one source, asserted to
    // agree rather than assumed to.
    for (const profile of aiProviders()) {
      const brokered = brokerProfileFor(profile.connection_provider);
      expect(brokered).not.toBeNull();
      expect(brokered?.credential_kind).toBe("provider_key");
      expect(brokered?.api_origin).toBe(profile.api_origin);
      // No sign-in exists for these, so there is no consent screen to describe
      // and nothing must pretend there is.
      expect(brokered?.oauth_provider_id).toBeNull();
      expect(brokered?.client_owner).toBe("not_oauth");
    }
  });

  it("says a disconnect does not delete the key at the provider", () => {
    const openrouter = brokerProfileFor("openrouter")!;
    expect(describeCustody(openrouter)).toContain("does not delete the key itself");
    // And the sign-in sentence still stops where it always did, because for a
    // grant DASH really can ask the provider to withdraw it.
    expect(describeCustody(brokerProfileFor("google-gmail")!)).not.toContain("key");
  });

  it("admits which party is missing from the three-party check", () => {
    const sentence = describeKeyNarrowing(brokerProfileFor("anthropic")!);
    expect(sentence).not.toBeNull();
    expect(sentence).toContain("there is no screen where you tick what an agent may do");
    // A sign-in got all three, so it says nothing here — the capability list on
    // the card is already the description of what was granted.
    expect(describeKeyNarrowing(brokerProfileFor("google-gmail")!)).toBeNull();
  });

  it("says all of it in plain language", () => {
    expectPlainLanguage(
      aiProviders().flatMap((profile) => {
        const brokered = brokerProfileFor(profile.connection_provider)!;
        return [profile.key_source, describeCustody(brokered), describeKeyNarrowing(brokered) ?? ""];
      }),
    );
  });
});
