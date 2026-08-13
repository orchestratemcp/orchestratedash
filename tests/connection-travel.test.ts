/**
 * What DASH says about a connection that cannot go to a server (MAR-591,
 * corrected by MAR-626).
 *
 * The assertions that matter here are the three the issue could most easily
 * have got wrong in different directions:
 *
 * 1. an agent whose file never says whether a run needs a connection it *does*
 *    hold is **warned about, not refused** — refusing would refuse every agent
 *    with a `dash_managed` connection that exists today, on a guess;
 * 2. an agent whose file *does* say it needs a connection it holds is
 *    **refused**, at the panel and again in the producer, so the renderer is
 *    never the only gate; and
 * 3. an agent that has **never connected** something is neither warned about
 *    nor refused, however loudly its file asks for it — MAR-626's fix. There is
 *    nothing in the vault to strand, so there is nothing to say.
 *
 * MAR-583's model-key refusal is asserted by its exact sentence rather than by
 * behaviour, because that sentence reached an audited command result before this
 * issue existed and generalising the code around it must not reword it.
 */

import { describe, expect, it } from "vitest";

import { MODEL_KEY_STAYS_HOME_REFUSAL } from "../lib/ai/model-choice";
import {
  assessConnectionTravel,
  describeConnectionTravel,
  describeStrandedCopy,
  describeTravelRefusal,
  everyTravelSentence,
  type HeldCredential,
} from "../lib/deploy/connection-travel";
import type { ConnectionSourceManifest, ManifestConnection } from "../lib/connections";
import { expectPlainLanguage } from "./helpers/plain-language";

const AGENT = "meeting-assistant";

/** A brokered sign-in, which is the commonest `dash_managed` connection there is. */
function gmail(over: Partial<ManifestConnection> = {}): ManifestConnection {
  return {
    id: "gmail",
    provider: "google-gmail",
    label: "Your Gmail",
    purpose: "Read meeting requests",
    ownership: "dash_managed",
    capabilities: [{ id: "gmail.meeting_requests.read", label: "Read requests", access: "read" }],
    fields: [
      {
        id: "gmail-account",
        label: "Gmail account",
        purpose: "Authorize reading",
        kind: "oauth_reauthorization",
        required: true,
        technical: { provider_scopes: ["https://www.googleapis.com/auth/gmail.readonly"] },
      },
    ],
    ...over,
  };
}

/** A typed secret for a service DASH has no client for. Delivered at spawn, here. */
function ledger(over: Partial<ManifestConnection> = {}): ManifestConnection {
  return {
    id: "ledger",
    provider: "synthetic-ledger",
    label: "Your ledger",
    purpose: "Record what it did",
    ownership: "dash_managed",
    capabilities: [{ id: "ledger.write", label: "Write a line", access: "write" }],
    fields: [
      {
        id: "ledger-key",
        label: "API key",
        purpose: "Sign requests",
        kind: "secret",
        required: true,
        technical: { environment_name: "LEDGER_KEY" },
      },
    ],
    ...over,
  };
}

/** A model provider's key: typed like a secret, presented by DASH like a grant. */
function modelKey(): ManifestConnection {
  return {
    id: "model",
    provider: "openrouter",
    label: "Your model key",
    purpose: "Reach a language model",
    ownership: "dash_managed",
    capabilities: [],
    fields: [
      {
        id: "api-key",
        label: "API key",
        purpose: "Reach the provider",
        kind: "secret",
        required: true,
      },
    ],
  };
}

function manifest(over: {
  connections?: ManifestConnection[];
  needsAModel?: boolean;
  requirements?: unknown;
}): ConnectionSourceManifest {
  const agent_dom: Record<string, unknown> = { connections: over.connections ?? [] };
  if (over.requirements !== undefined) {
    agent_dom["connection_requirements"] = over.requirements;
  }
  return {
    planned_route: [
      {
        step: 1,
        component_id: "read",
        model_tier: over.needsAModel === true ? "standard" : "none",
      },
    ],
    agent_dom,
  } as ConnectionSourceManifest;
}

/** MAR-569's block, declaring one requirement against one connection. */
function requires(connectionId: string, optional?: boolean): unknown {
  const requirement: Record<string, unknown> = {
    id: `${connectionId}_req`,
    name: "Your Gmail",
    connector_kind: "google_oauth_broker",
    connection_id: connectionId,
  };
  if (optional !== undefined) {
    requirement["optional"] = optional;
  }
  return { requirements_version: 1, requirements: [requirement] };
}

/**
 * Every field of the given connections, as `connection_secrets` rows would
 * read them — the `held` a caller who *had* connected these would pass.
 * `field_id` only, matching `HeldCredential`; `masked_hint` and the rest of
 * `SecretReference` are never read here, the same trim `heldCredentials`
 * already performs at its own call sites.
 */
function held(...connections: ManifestConnection[]): HeldCredential[] {
  return connections.flatMap((connection) =>
    connection.fields.map((field) => ({ connection_id: connection.id, field_id: field.id })),
  );
}

describe("what DASH holds and cannot send", () => {
  it("finds nothing to say about an agent with no connections", () => {
    const travel = assessConnectionTravel(AGENT, manifest({}), []);
    expect(travel).toEqual({ verdict: "clear", stranded: [] });
    expect(describeConnectionTravel(travel, "News Scout", "My server")).toBeNull();
  });

  it("leaves an agent that holds its own credentials alone", () => {
    /*
     * It reaches its services by arrangements DASH has no part in, wherever it
     * runs, and DASH has no standing to stop it — `deliverableSecretFields`'
     * own boundary, and the reason this reads ownership rather than counting
     * connections.
     */
    const connection = gmail({ ownership: "agent_managed" });
    const travel = assessConnectionTravel(
      AGENT,
      manifest({ connections: [connection] }),
      held(connection),
    );
    expect(travel.verdict).toBe("clear");
  });

  it("names each of the three custodies with the vocabulary the spawn path uses", () => {
    const connections = [gmail(), ledger(), modelKey()];
    const travel = assessConnectionTravel(
      AGENT,
      manifest({ connections }),
      held(...connections),
    );
    expect(travel.stranded.map((one) => one.custody)).toEqual([
      "oauth",
      "secret",
      "provider_key",
    ]);
  });

  it("gives a connection one line however many fields it has", () => {
    // A person reads "your Gmail". A connection with two fields is still one
    // thing they connected once.
    const connection = gmail({
      fields: [
        ...gmail().fields,
        {
          id: "gmail-signature",
          label: "Signature",
          purpose: "Sign the draft",
          kind: "secret",
          required: false,
          technical: { environment_name: "GMAIL_SIGNATURE" },
        },
      ],
    });
    const travel = assessConnectionTravel(
      AGENT,
      manifest({ connections: [connection] }),
      held(connection),
    );
    expect(travel.stranded).toHaveLength(1);
  });

  it("survives a stored manifest whose connection has no field list", () => {
    /*
     * `agentDeployStanding` runs this over a **store row**, and its own contract
     * is that it never throws: "a view that threw there would take the whole
     * agents list down over a row that simply cannot be deployed". `fields` is
     * required by the schema and a damaged row is not a validated document.
     */
    const broken = { ...gmail() } as unknown as Record<string, unknown>;
    delete broken["fields"];
    const connections = [broken as unknown as ManifestConnection, ledger()];
    expect(() =>
      assessConnectionTravel(AGENT, manifest({ connections }), held(ledger())),
    ).not.toThrow();
    const travel = assessConnectionTravel(AGENT, manifest({ connections }), held(ledger()));
    // The readable one is still reported. Skipping the damaged connection is
    // not the same as giving up on the agent.
    expect(travel.stranded.map((one) => one.connection_id)).toEqual(["ledger"]);
  });

  it("says nothing about a connection DASH could never hold a credential for", () => {
    /*
     * A field naming a reserved delivery variable is refused at connect time, so
     * DASH holds nothing for it. Nothing of DASH's fails to travel, and a line
     * claiming otherwise would be DASH reporting a credential it does not have.
     */
    const connection = ledger({
      fields: [
        {
          id: "ledger-key",
          label: "API key",
          purpose: "Sign requests",
          kind: "secret",
          required: true,
          technical: { environment_name: "DASH_LEDGER_KEY" },
        },
      ],
    });
    const travel = assessConnectionTravel(
      AGENT,
      manifest({ connections: [connection] }),
      held(connection),
    );
    expect(travel.verdict).toBe("clear");
  });
});

describe("MAR-626: the vault is the gate, not the manifest", () => {
  it("deploys clean when a declared-optional model connection was never connected, even though the plan needs a model", () => {
    /*
     * The exact shape of the bug report: MAR-619's News Scout declares its
     * model-provider requirement `optional: true` and the plan still needs a
     * model, because it runs better with one. A fresh scaffold holds no key at
     * all. The old rule read `needsAModel` off the plan alone and refused every
     * one of these regardless of the vault — this is the assertion that failed
     * before the fix and must hold now.
     */
    const travel = assessConnectionTravel(
      AGENT,
      manifest({
        connections: [modelKey()],
        needsAModel: true,
        requirements: requires("model", true),
      }),
      [],
    );
    expect(travel).toEqual({ verdict: "clear", stranded: [] });
  });

  it("still refuses the same manifest once the key is actually granted", () => {
    // The regression's other half: connecting the key must still refuse the
    // deploy, until MAR-625's bridge turns that refusal into an offer.
    const connection = modelKey();
    const travel = assessConnectionTravel(
      AGENT,
      manifest({
        connections: [connection],
        needsAModel: true,
        requirements: requires("model", true),
      }),
      held(connection),
    );
    expect(travel.verdict).toBe("refuse");
    expect(describeTravelRefusal(travel)).toBe(MODEL_KEY_STAYS_HOME_REFUSAL);
  });

  it("is silent on a required, undeclared-vault connection too — not just the model-key special case", () => {
    // The rule generalises past `provider_key`: a required Gmail sign-in nobody
    // has ever granted strands nothing either, and the gate is not a second
    // guess about a manifest's plans.
    const travel = assessConnectionTravel(
      AGENT,
      manifest({ connections: [gmail()], requirements: requires("gmail") }),
      [],
    );
    expect(travel).toEqual({ verdict: "clear", stranded: [] });
  });

  it("a fleet-materialized credential reads as held through the same lookup, not a separate fleet-key check", () => {
    /*
     * `fleetReach` writes into `connection_secrets` under this agent's own name
     * when it materializes a fleet connector's credential, so the same `held`
     * list this module already reads is the one fact both paths share — there
     * is no second "does a fleet key exist" question to ask or to get wrong.
     */
    const connection = modelKey();
    const travel = assessConnectionTravel(
      AGENT,
      manifest({ connections: [connection], needsAModel: true }),
      held(connection),
    );
    expect(travel.verdict).toBe("refuse");
  });
});

describe("refuse or warn", () => {
  it("warns rather than refusing when the agent's file never says", () => {
    /*
     * **The finding this module was written around.** Not one manifest in
     * `examples/` declares a requirements block, so a rule that refused on
     * silence would refuse every agent with a `dash_managed` connection that
     * exists today — on a guess about whether a run needs it.
     */
    const connection = gmail();
    const travel = assessConnectionTravel(
      AGENT,
      manifest({ connections: [connection] }),
      held(connection),
    );
    expect(travel.verdict).toBe("warn");
    expect(travel.stranded[0]?.need).toBe("undeclared");
  });

  it("says out loud that it cannot tell, rather than reassuring or alarming", () => {
    // MAR-584's `comparable: false` discipline, on a different fact.
    const connection = gmail();
    const travel = assessConnectionTravel(
      AGENT,
      manifest({ connections: [connection] }),
      held(connection),
    );
    const notice = describeConnectionTravel(travel, "News Scout", "My server");
    expect(notice?.lines.join(" ")).toContain("does not say whether it can work without");
  });

  it("refuses when a requirement names the connection and does not mark it optional", () => {
    // `ConnectionRequirementV1.optional`'s own rule: absent means required, and
    // an agent that can run degraded is the one that says so.
    const connection = gmail();
    const travel = assessConnectionTravel(
      AGENT,
      manifest({ connections: [connection], requirements: requires("gmail") }),
      held(connection),
    );
    expect(travel.verdict).toBe("refuse");
    expect(travel.stranded[0]?.need).toBe("run_needs_it");
  });

  it("warns when the author declared the requirement optional", () => {
    const connection = gmail();
    const travel = assessConnectionTravel(
      AGENT,
      manifest({ connections: [connection], requirements: requires("gmail", true) }),
      held(connection),
    );
    expect(travel.verdict).toBe("warn");
    expect(describeConnectionTravel(travel, "News Scout", "My server")?.lines.join(" ")).toContain(
      "can work without",
    );
  });

  it("says why once per custody, however many connections share it", () => {
    /*
     * **A screenshot found this one too.** With the reason on every line, an
     * agent with Gmail and a calendar drew the same paragraph twice, word for
     * word — two identical blocks at 375px, which is where a person stops
     * reading. The reason is a fact about the arrangement, so it is said about
     * the arrangement.
     */
    const connections = [gmail(), gmail({ id: "calendar", label: "Your calendar" })];
    const travel = assessConnectionTravel(
      AGENT,
      manifest({ connections }),
      held(...connections),
    );
    const notice = describeConnectionTravel(travel, "News Scout", "My server");
    expect(notice?.lines).toHaveLength(2);
    expect(notice?.reasons).toHaveLength(1);
  });

  it("gives a mixed arrangement one reason per custody, in a fixed order", () => {
    const connections = [ledger(), gmail()];
    const travel = assessConnectionTravel(
      AGENT,
      manifest({ connections }),
      held(...connections),
    );
    const notice = describeConnectionTravel(travel, "News Scout", "My server");
    expect(notice?.reasons).toHaveLength(2);
    // The sign-in explanation first whichever order the connections arrived in:
    // two agents with the same arrangement must read the same way round.
    expect(notice?.reasons[0]).toContain("signing in");
  });

  it("claims nothing about a connection a declared block simply does not mention", () => {
    /*
     * **A screenshot found this one.** The first draft read a declared block as
     * authoritative over the whole connection list, so an agent declaring Gmail
     * required and saying nothing about its calendar drew "This agent's own file
     * says it can work without Google Calendar" — a claim its file never made,
     * inferred from an omission. Only an explicit `optional: true` says that.
     */
    const connections = [gmail(), ledger()];
    const travel = assessConnectionTravel(
      AGENT,
      manifest({ connections, requirements: requires("gmail") }),
      held(...connections),
    );
    expect(travel.stranded.find((one) => one.connection_id === "ledger")?.need).toBe("undeclared");
  });

  it("keeps the worse reading when one connection is declared twice", () => {
    // A manifest disagreeing with itself. The blocking reading is the one that
    // must not be lost, whichever order the requirements arrive in.
    const connection = gmail();
    const travel = assessConnectionTravel(
      AGENT,
      manifest({
        connections: [connection],
        requirements: {
          requirements_version: 1,
          requirements: [
            {
              id: "loose",
              name: "Your Gmail",
              connector_kind: "google_oauth_broker",
              connection_id: "gmail",
              optional: true,
            },
            {
              id: "strict",
              name: "Your Gmail",
              connector_kind: "google_oauth_broker",
              connection_id: "gmail",
            },
          ],
        },
      }),
      held(connection),
    );
    expect(travel.verdict).toBe("refuse");
  });

  it("claims nothing from a requirements version DASH cannot read", () => {
    // That resolution carries no requirements at all, so it says nothing about
    // any connection rather than saying they are all fine.
    const connection = gmail();
    const travel = assessConnectionTravel(
      AGENT,
      manifest({
        connections: [connection],
        requirements: { requirements_version: 2, requirements: [{ anything: true }] },
      }),
      held(connection),
    );
    expect(travel.stranded[0]?.need).toBe("undeclared");
  });

  it("refuses the model key on the plan alone, in MAR-583's own words, once DASH holds it", () => {
    /*
     * The plan is part of the agent's own document, and a step above `none` is
     * that document saying a run needs a model. The sentence is asserted by
     * value: it reached an audited command result before MAR-591 existed.
     * MAR-626 adds the precondition: this fires only for a key DASH is actually
     * holding, which is why the manifest here is granted the credential.
     */
    const connection = modelKey();
    const travel = assessConnectionTravel(
      AGENT,
      manifest({ connections: [connection], needsAModel: true }),
      held(connection),
    );
    expect(travel.verdict).toBe("refuse");
    expect(describeTravelRefusal(travel)).toBe(MODEL_KEY_STAYS_HOME_REFUSAL);
  });

  it("does not escalate a model key when the plan needs no model", () => {
    const connection = modelKey();
    const travel = assessConnectionTravel(
      AGENT,
      manifest({ connections: [connection] }),
      held(connection),
    );
    expect(travel.verdict).toBe("warn");
  });

  it("words a refusal over several connections without MAR-583's single-key sentence", () => {
    const connections = [gmail(), ledger()];
    const travel = assessConnectionTravel(
      AGENT,
      manifest({
        connections,
        requirements: {
          requirements_version: 1,
          requirements: [
            {
              id: "a",
              name: "Your Gmail",
              connector_kind: "google_oauth_broker",
              connection_id: "gmail",
            },
            {
              id: "b",
              name: "Your ledger",
              connector_kind: "api_key",
              connection_id: "ledger",
            },
          ],
        },
      }),
      held(...connections),
    );
    const said = describeTravelRefusal(travel);
    expect(said).not.toBe(MODEL_KEY_STAYS_HOME_REFUSAL);
    expect(said).toContain("Your Gmail and Your ledger");
    expect(said).toContain("Nothing was sent.");
  });
});

describe("a copy already on a server", () => {
  it("says what is not over there, as a fact about DASH's own act", () => {
    /*
     * Not a connection standing. MAR-569's four are the intersection of DASH,
     * the manifest and the provider — none of the three is the server — and
     * `awaiting_you` beside a Connect button that writes to this computer's
     * vault would be a button DASH cannot fire.
     */
    const connection = gmail();
    const travel = assessConnectionTravel(
      AGENT,
      manifest({ connections: [connection] }),
      held(connection),
    );
    const said = describeStrandedCopy(travel, "My server");
    expect(said).toContain("The copy on My server does not have Your Gmail");
    expect(said).toContain("does not watch runs on My server");
  });

  it("says nothing for an agent that had nothing to leave behind", () => {
    expect(
      describeStrandedCopy(assessConnectionTravel(AGENT, manifest({}), []), "My server"),
    ).toBeNull();
  });
});

describe("the words themselves", () => {
  it("names no field, variable or slug on a guided surface", () => {
    expectPlainLanguage(everyTravelSentence(), {
      // The refusal's own sentence, pinned by MAR-583 and swept there too.
      allow: [MODEL_KEY_STAYS_HOME_REFUSAL],
    });
  });

  it("blames DASH's own reach rather than the person", () => {
    for (const said of everyTravelSentence()) {
      expect(said.toLowerCase()).not.toContain("you forgot");
      expect(said.toLowerCase()).not.toContain("you failed");
    }
  });

  it("never promises the agent will work over there", () => {
    /*
     * `lib/server-card.ts`'s rule about somebody else's machine. DASH does not
     * know what is on that server, so no sentence may say the agent is fine —
     * the reassuring claim is the one that would be wrong.
     */
    for (const said of everyTravelSentence()) {
      expect(said).not.toMatch(/will (still )?work on/i);
      expect(said).not.toMatch(/runs fine (on|there)/i);
    }
  });
});
