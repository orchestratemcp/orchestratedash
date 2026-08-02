/**
 * What the permission broker is *for*, and where its boundary sits
 * (MAR-458, ADR 0002).
 *
 * `tests/broker-threat-model.test.ts` attacks it. This file establishes that it
 * does the job — the intersection that decides a grant, the card a person
 * approves, the recovery copy behind each refusal, and the one change that
 * closes the defect ADR 0002 was written about: the spawn path no longer has an
 * OAuth credential to deliver.
 */

import { describe, expect, it } from "vitest";

import { createBroker } from "../lib/broker/execute";
import {
  brokeredField,
  describeGrant,
  grants,
  requestedOperations,
  resolveGrant,
} from "../lib/broker/grant";
import { allOperations, operationsForProvider } from "../lib/broker/operations";
import {
  brokerProfileFor,
  describeClientOwner,
  describeCustody,
} from "../lib/broker/providers";
import { encodeBrokerResponse, fulfil, refuse } from "../lib/broker/protocol";
import { deliverableFields, deliverableSecretFields } from "../lib/connection-credentials";
import { describeBrokerRefusal } from "../lib/copy/recovery";
import { expectPlainLanguage } from "./helpers/plain-language";
import {
  credential,
  example,
  GMAIL_COMPOSE,
  GMAIL_READONLY,
} from "./fakes/broker-harness";

const AGENT = "synthetic-gmail-meeting-assistant";
const gmailExample = example("gmail-meeting-assistant.manifest.v2.example.json");
const secretExample = example("dash-managed-secret.manifest.v2.example.json");

/** The Gmail example with a different scope list on its OAuth field. */
function withGmailScopes(scopes: string[]): typeof gmailExample {
  const copy = JSON.parse(JSON.stringify(gmailExample)) as typeof gmailExample;
  const gmail = copy.agent_dom?.connections?.find((connection) => connection.id === "gmail");
  const field = gmail?.fields[0];
  if (field !== undefined) {
    field.technical = { ...field.technical, provider_scopes: scopes };
  }
  return copy;
}

function grant(scopes: string[] = ["openid", "email", GMAIL_READONLY, GMAIL_COMPOSE]) {
  return resolveGrant(
    AGENT,
    gmailExample,
    "gmail",
    credential({ scopes }),
    "dash.connection.a.gmail.gmail-account",
  );
}

/* ---------------------------------------------------------------------- *
 * The intersection
 * ---------------------------------------------------------------------- */

describe("what a grant covers", () => {
  it("grants the read operations the manifest declared and the user approved", () => {
    const resolved = grant();
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    expect(resolved.grant.operations.map((operation) => operation.id).sort()).toEqual([
      "gmail.message.read",
      "gmail.search",
    ]);
    expect(grants(resolved.grant, "gmail.search")).toBe(true);
    expect(grants(resolved.grant, "gmail.send")).toBe(false);
  });

  /**
   * The load-bearing one. `gmail.compose` was granted, Google will honour it,
   * and it reaches no operation — so it is reported as unused rather than
   * silently forgotten, which is what lets the card admit it.
   */
  it("reports a granted scope that no operation uses", () => {
    const resolved = grant();
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.grant.unused_scopes).toEqual([GMAIL_COMPOSE]);
  });

  it("grants nothing when the provider withheld the scope every operation needs", () => {
    const resolved = grant(["openid", "email", GMAIL_COMPOSE]);
    expect(resolved).toMatchObject({
      ok: false,
      refusal: "no_operations_granted",
      missing_scopes: [GMAIL_READONLY],
    });
  });

  /**
   * A Gmail connection whose manifest declares only the compose scope. The
   * broker has a profile for it and an operation set, and no operation is a
   * *candidate* — because step 2 of the intersection (what the agent declared)
   * fails before step 3 (what the user granted) is consulted.
   *
   * The distinction is the reason `missing_scopes` must be empty here. A user
   * looking at this connection has not withheld anything, and telling them to
   * "reconnect and approve everything" would send them round a consent screen
   * that would change nothing.
   */
  it("does not count a scope as missing for an operation the agent never asked for", () => {
    const composeOnly = withGmailScopes([GMAIL_COMPOSE]);
    const resolved = resolveGrant(
      AGENT,
      composeOnly,
      "gmail",
      credential({ scopes: ["openid", "email", GMAIL_COMPOSE] }),
      "dash.connection.a.gmail.gmail-account",
    );
    expect(resolved).toMatchObject({ ok: false, refusal: "no_operations_granted" });
    if (resolved.ok) return;
    expect(resolved.missing_scopes).toEqual([]);
  });

  /**
   * The same connection with the read scope declared and *withheld* by the user.
   * Now the scope is genuinely missing, and the recovery really is a reconnect.
   */
  it("counts a scope as missing when the agent asked and the user declined", () => {
    const resolved = resolveGrant(
      AGENT,
      gmailExample,
      "gmail",
      credential({ scopes: ["openid", "email", GMAIL_COMPOSE] }),
      "dash.connection.a.gmail.gmail-account",
    );
    expect(resolved).toMatchObject({
      ok: false,
      refusal: "no_operations_granted",
      missing_scopes: [GMAIL_READONLY],
    });
  });

  it("brokers nothing for a provider it has no profile for, before any scope check", () => {
    // Calendar is declared, dash-managed and OAuth, and MAR-458's slice ships no
    // calendar operations — so it is refused at the profile rather than reported
    // as a connection with permissions missing.
    expect(brokeredField(gmailExample, "calendar")).toEqual({
      ok: false,
      refusal: "no_broker_profile",
    });
  });

  it("refuses before a credential is even consulted when nobody but DASH could hold it", () => {
    expect(brokeredField(example("agent-managed.manifest.v2.example.json"), "notion")).toMatchObject(
      { ok: false },
    );
    expect(brokeredField(gmailExample, "not-a-connection")).toEqual({
      ok: false,
      refusal: "unknown_connection",
    });
  });

  it("refuses a connection whose provider DASH brokers nothing for", () => {
    // A typed-secret connection: real, dash-managed, and not something the
    // broker has a profile or an operation for.
    expect(brokeredField(secretExample, "ledger")).toMatchObject({
      ok: false,
      refusal: "no_broker_profile",
    });
  });

  it("refuses a connection that is connected but whose grant is absent", () => {
    expect(
      resolveGrant(AGENT, gmailExample, "gmail", null, "dash.connection.a.gmail.gmail-account"),
    ).toEqual({ ok: false, refusal: "not_connected" });
  });

  /**
   * Before a sign-in there is no credential, and a user deciding whether to
   * connect still needs to see what is being asked for.
   */
  it("describes what an agent is asking for before anything is connected", () => {
    expect(requestedOperations(gmailExample, "gmail").map((operation) => operation.id).sort()).toEqual(
      ["gmail.message.read", "gmail.search"],
    );
    expect(requestedOperations(gmailExample, "calendar")).toEqual([]);
    expect(requestedOperations(secretExample, "ledger")).toEqual([]);
  });
});

/* ---------------------------------------------------------------------- *
 * The card
 * ---------------------------------------------------------------------- */

describe("the capability card", () => {
  it("names the real token custodian rather than implying DASH is one either way", () => {
    const resolved = grant();
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const card = describeGrant(resolved.grant, "Meeting Assistant");
    expect(card.token_custodian).toBe("dash_vault");
    expect(card.custody_sentence).toContain("never receives it");
    // ADR 0002's open problem, said on the card rather than only in the ADR.
    expect(card.client_sentence).toContain("DASH's own");
  });

  it("says out loud that a granted permission is not used", () => {
    const resolved = grant();
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const card = describeGrant(resolved.grant, "Meeting Assistant");
    expect(card.unused_permission_sentence).toContain("1 further permission");
    expect(card.unused_permission_sentence).toContain("cannot use it through DASH");
  });

  it("says nothing about unused permissions when there are none", () => {
    const resolved = grant(["openid", "email", GMAIL_READONLY]);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(describeGrant(resolved.grant, "Meeting Assistant").unused_permission_sentence).toBeNull();
  });

  /**
   * The card is guided-path copy, so the MAR-423 rule applies: no scope URL, no
   * connection id, no operation id in anything a person reads. The operation
   * *ids* travel on the card as ids for the code, and only `label` is rendered —
   * so the scan covers the labels and the sentences, which is what a surface
   * shows.
   */
  it("renders no raw identifiers", () => {
    const resolved = grant();
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const card = describeGrant(resolved.grant, "Meeting Assistant");
    expectPlainLanguage([
      card.service,
      card.requesting_agent,
      card.custody_sentence,
      card.client_sentence ?? "",
      card.unused_permission_sentence ?? "",
      ...card.capabilities.map((capability) => capability.label),
    ]);
  });

  it("describes both custodies DASH may one day render, in words that differ", () => {
    // The MCP half of ADR 0002's shared grammar. Nothing constructs a
    // `remote_mcp_server` profile yet, and the sentence exists so that when
    // something does, the card cannot claim a disconnect withdraws access it
    // never held.
    const custodies = (["dash_vault", "remote_mcp_server", "hosted_broker"] as const).map(
      (token_custodian) =>
        describeCustody({
          connection_provider: "x",
          oauth_provider_id: "google",
          label: "Something",
          token_custodian,
          client_owner: "not_oauth",
          api_origin: "https://example.com",
        }),
    );
    expect(new Set(custodies).size).toBe(3);
    expect(custodies[1]).toContain("does not withdraw");
  });

  it("says nothing about a consent screen for a connection that has none", () => {
    expect(
      describeClientOwner({
        connection_provider: "x",
        oauth_provider_id: "",
        label: "Something",
        token_custodian: "remote_mcp_server",
        client_owner: "not_oauth",
        api_origin: "https://example.com",
      }),
    ).toBeNull();
  });
});

/* ---------------------------------------------------------------------- *
 * The defect ADR 0002 was written about
 * ---------------------------------------------------------------------- */

describe("what reaches an agent's environment", () => {
  /**
   * The regression guard for the whole issue. Before MAR-458 this manifest's
   * Gmail field produced an environment variable holding a live provider token.
   */
  it("delivers no OAuth credential to a child process", () => {
    const deliverable = deliverableSecretFields(AGENT, gmailExample);
    expect(deliverable).toEqual([]);
    expect(deliverable.every((field) => field.kind === "secret")).toBe(true);
  });

  it("still delivers a typed secret, which is unchanged", () => {
    const deliverable = deliverableSecretFields("ledger-reporter", secretExample);
    expect(deliverable.map((field) => field.environment_name)).toEqual(["LEDGER_API_KEY"]);
  });

  /**
   * A manifest that asks for its provider token by name.
   *
   * **No shipped example declares one**, which is worth stating rather than
   * discovering later: the raw-token delivery path ADR 0002 describes was
   * reachable in the code and was not exercised by anything in `examples/`,
   * because `deliverableFields` only lists a target whose manifest named an
   * `environment_name` and no example OAuth field does.
   *
   * That makes the defect narrower than "every OAuth agent got a token" and no
   * less real: a manifest is a third party's document, and this is the one line
   * it had to contain. So the fixture is built here rather than added to
   * `examples/`, where it would be a sample suggesting people ask for exactly
   * the thing the broker exists to stop handing out.
   */
  const tokenHungry = ((): typeof gmailExample => {
    const copy = JSON.parse(JSON.stringify(gmailExample)) as typeof gmailExample;
    const gmail = copy.agent_dom?.connections?.find((connection) => connection.id === "gmail");
    const field = gmail?.fields[0];
    if (field !== undefined) {
      field.technical = { ...field.technical, environment_name: "GMAIL_OAUTH_TOKEN" };
    }
    return copy;
  })();

  it("delivers nothing even when the manifest names a variable for its token", () => {
    expect(deliverableSecretFields(AGENT, tokenHungry)).toEqual([]);
  });

  /**
   * `deliverableFields` still lists that OAuth target, and that is on purpose:
   * `electron/main.ts` reads exactly those names so it can assert none of them
   * has a value. A test that expected it to be empty would delete the guard.
   */
  it("keeps the OAuth target visible to the guard that refuses it", () => {
    const oauth = deliverableFields(AGENT, tokenHungry).filter((field) => field.kind === "oauth");
    expect(oauth.map((field) => field.environment_name)).toEqual(["GMAIL_OAUTH_TOKEN"]);
  });
});

/* ---------------------------------------------------------------------- *
 * Recovery copy
 * ---------------------------------------------------------------------- */

describe("what a person is told when a request is refused", () => {
  const REFUSALS = [
    "unknown_operation",
    "not_granted",
    "unknown_connection",
    "not_connected",
    "revoked",
    "permission_missing",
    "invalid_input",
    "duplicate_request",
    "rate_limited",
    "provider_unavailable",
    "provider_refused",
    "vault_unavailable",
    "broker_error",
  ] as const;

  it.each(REFUSALS)("gives %s three sentences and an actor", (refusal) => {
    const recovery = describeBrokerRefusal(refusal, { service: "Gmail", agent: "Meeting Assistant" });
    expect(recovery.headline.length).toBeGreaterThan(0);
    expect(recovery.meaning.length).toBeGreaterThan(0);
    expect(recovery.next_action.length).toBeGreaterThan(0);
    expect(["user", "dash", "agent"]).toContain(recovery.actor);
    expectPlainLanguage([recovery.headline, recovery.meaning, recovery.next_action]);
  });

  /**
   * The three the user can actually fix are the three that must say so. A
   * refusal marked `dash` renders without asking anything of them.
   */
  it("puts the reconnectable failures on the user and the rest on DASH", () => {
    const actorFor = (refusal: (typeof REFUSALS)[number]): string =>
      describeBrokerRefusal(refusal, { service: "Gmail", agent: "A" }).actor;

    expect(actorFor("not_connected")).toBe("user");
    expect(actorFor("revoked")).toBe("user");
    expect(actorFor("permission_missing")).toBe("user");

    expect(actorFor("unknown_operation")).toBe("dash");
    expect(actorFor("not_granted")).toBe("dash");
    expect(actorFor("invalid_input")).toBe("dash");
  });

  /**
   * MAR-446's requirement, carried into the broker: a withdrawn grant must not
   * read as something a retry fixes.
   */
  it("never tells a user to retry a withdrawn sign-in", () => {
    const recovery = describeBrokerRefusal("revoked", { service: "Gmail", agent: "A" });
    expect(recovery.meaning).toContain("Retrying will not help");
    expect(recovery.next_action).toContain("Reconnect");
  });

  it("distinguishes a locked vault from a connection that was never made", () => {
    const locked = describeBrokerRefusal("vault_unavailable", { service: "Gmail", agent: "A" });
    const absent = describeBrokerRefusal("not_connected", { service: "Gmail", agent: "A" });
    expect(locked.meaning).toContain("not lost");
    expect(absent.next_action).toContain("Connect Gmail");
  });
});

/* ---------------------------------------------------------------------- *
 * Profiles
 * ---------------------------------------------------------------------- */

describe("provider profiles", () => {
  it("brokers Gmail against Google's Gmail API origin", () => {
    expect(brokerProfileFor("google-gmail")).toMatchObject({
      api_origin: "https://gmail.googleapis.com",
      token_custodian: "dash_vault",
    });
  });

  it("brokers nothing for a provider it has no profile for", () => {
    expect(brokerProfileFor("google-calendar")).toBeNull();
    expect(brokerProfileFor("notion")).toBeNull();
    expect(brokerProfileFor("")).toBeNull();
  });

  /**
   * The proof profile exists only for `electron/smoke.ts`, and every one of its
   * three conditions is checked here — including the absence case, which is the
   * one that matters on a user's machine.
   */
  describe("the loopback proof profile", () => {
    const KEY = "DASH_BROKER_PROOF_ORIGIN";

    function withEnv<T>(value: string | undefined, body: () => T): T {
      const before = process.env[KEY];
      if (value === undefined) {
        delete process.env[KEY];
      } else {
        process.env[KEY] = value;
      }
      try {
        return body();
      } finally {
        if (before === undefined) {
          delete process.env[KEY];
        } else {
          process.env[KEY] = before;
        }
      }
    }

    it("does not exist when the variable is unset", () => {
      withEnv(undefined, () => {
        expect(brokerProfileFor("dash-loopback-mail")).toBeNull();
      });
    });

    it.each([
      ["a public host", "http://gmail.googleapis.com"],
      ["a hostname that resolves to loopback", "http://localhost:8080"],
      ["https", "https://127.0.0.1:8080"],
      ["not a url", "127.0.0.1:8080"],
      ["empty", ""],
    ])("does not exist for %s", (_label, value) => {
      withEnv(value, () => {
        expect(brokerProfileFor("dash-loopback-mail")).toBeNull();
      });
    });

    it("exists only for a loopback http origin, and borrows Gmail's operations", () => {
      withEnv("http://127.0.0.1:54321", () => {
        const profile = brokerProfileFor("dash-loopback-mail");
        expect(profile).toMatchObject({ api_origin: "http://127.0.0.1:54321" });
        // Still not a Gmail profile: asking for `google-gmail` gets the real one.
        expect(brokerProfileFor("google-gmail")?.api_origin).toBe("https://gmail.googleapis.com");
      });
    });
  });
});

/* ---------------------------------------------------------------------- *
 * The wire
 * ---------------------------------------------------------------------- */

describe("responses on the wire", () => {
  it("encodes exactly one line, so a response cannot frame a second message", () => {
    const line = encodeBrokerResponse(fulfil("req-1", { messages: [] }));
    expect(line.endsWith("\n")).toBe(true);
    expect(line.indexOf("\n")).toBe(line.length - 1);
  });

  it("encodes a refusal with a code and nothing else about the failure", () => {
    const parsed = JSON.parse(encodeBrokerResponse(refuse("req-1", "revoked"))) as Record<
      string,
      unknown
    >;
    expect(Object.keys(parsed).sort()).toEqual([
      "ok",
      "protocol_version",
      "refusal",
      "request_id",
      "type",
    ]);
  });

  it("keeps a result whose content contains a newline on one line", () => {
    const line = encodeBrokerResponse(fulfil("req-1", { body_text: "one\ntwo\nthree" }));
    expect(line.indexOf("\n")).toBe(line.length - 1);
  });
});

/* ---------------------------------------------------------------------- *
 * The operation set, as a set
 * ---------------------------------------------------------------------- */

describe("the shipped operations", () => {
  it("is exactly the two read operations ADR 0002's first slice describes", () => {
    expect(allOperations().map((operation) => operation.id).sort()).toEqual([
      "gmail.message.read",
      "gmail.search",
    ]);
  });

  it("belongs entirely to the Gmail profile", () => {
    expect(operationsForProvider("google-gmail")).toHaveLength(2);
    expect(operationsForProvider("google-calendar")).toEqual([]);
  });

  it("gives every operation a sentence a person can read", () => {
    expectPlainLanguage(allOperations().map((operation) => operation.label));
  });

  it("builds a search request with only the two parameters DASH chose", async () => {
    const calls: string[] = [];
    const broker = createBroker({
      readManifest: () => gmailExample,
      readCredential: () => Promise.resolve({ kind: "found", credential: credential() }),
      mintAccessToken: () => Promise.resolve({ access_token: "t" }),
      fetchImpl: ((url: string) => {
        calls.push(String(url));
        return Promise.resolve(
          new Response(JSON.stringify({ messages: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }) as unknown as typeof fetch,
      audit: () => undefined,
      now: () => new Date("2026-08-02T10:00:00.000Z"),
    });

    await broker.handle(AGENT, {
      request_id: "req-1",
      connection_id: "gmail",
      operation: "gmail.search",
      input: { query: "is:unread", max_results: 3 },
    });

    const url = new URL(calls[0] ?? "");
    expect(url.origin).toBe("https://gmail.googleapis.com");
    expect(url.pathname).toBe("/gmail/v1/users/me/messages");
    expect([...url.searchParams.entries()].sort()).toEqual([
      ["maxResults", "3"],
      ["q", "is:unread"],
    ]);
  });
});
