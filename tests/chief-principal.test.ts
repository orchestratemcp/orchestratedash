/**
 * The chief at the broker boundary (MAR-659, ADR 0023).
 *
 * ADR 0023 lists what is provable before the competitor scout lands, and this
 * file is three of those four:
 *
 * 1. the principal change and the chief's manifest, driven over `handle` —
 *    **including the negative**: a chief principal cannot reach a Gmail
 *    operation, in the shape `tests/broker-threat-model.test.ts` already uses;
 * 2. that a chief vault read lands on `dash.fleet.` and an agent's never can,
 *    driven from the broker side rather than from the catalogue's;
 * 3. that the sentence `lib/fleet/principal.ts` protects survives verbatim.
 *
 * The fourth — one real charged question against a real key — is attended and
 * cannot be a test.
 *
 * ## Why the vault name is asserted from here rather than from `fleetSecretName`
 *
 * Because `fleetSecretName` was already right. What ADR 0023 changed is *which
 * principal reaches it*, and a test calling that function directly would pass
 * whether or not the broker ever calls it. So these drive `handle` and read the
 * name off the seam the broker actually asked for — the same reason
 * `tests/fleet-connections.test.ts` drives the action layer instead of the
 * naming helper.
 */

import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createBroker, type CredentialRead } from "../lib/broker/execute";
import { CHIEF, agentPrincipal, principalKey } from "../lib/broker/principal";
import { allOperations, operationById } from "../lib/broker/operations";
import { CHIEF_CONNECTION_ID, chiefManifest, chiefOperationId } from "../lib/chief/manifest";
import { connectionSecretName } from "../lib/connection-credentials";
import { fleetSecretName } from "../lib/fleet/catalogue";
import { FLEET_PRINCIPAL } from "../lib/fleet/principal";
import { aiAuthHeaders, aiProviderById, aiProviders } from "../lib/ai/providers";
import { keyCredential, PLANTED_PROVIDER_KEY, everyString } from "./fakes/broker-harness";

const PROVIDER = "openrouter";
const MODEL = "openai/gpt-5-mini";

const ANSWER_BODY = {
  choices: [{ message: { content: "Two of your agents run on this computer." } }],
  model: MODEL,
  usage: { prompt_tokens: 90, completion_tokens: 30, cost: 0.0001 },
};

interface Driven {
  handle: ReturnType<typeof createBroker>["handle"];
  /** Every vault name the broker asked for, in order. */
  reads: string[];
  /** Every request body DASH built, parsed. */
  sent: Array<Record<string, unknown>>;
  /** Every audit row, so the label a chief stands under is observable. */
  audit: Array<{ agent: string; decision: string; refusal: string | null }>;
}

/**
 * A broker whose vault is a recorder.
 *
 * Not `tests/fakes/broker-harness.ts`, and the difference is the point: that
 * harness answers `readManifest` with one manifest whatever it is asked, which
 * is exactly the behaviour under test here. This one answers the way
 * `electron/broker-host.ts` does — the composed manifest for a chief, the
 * agent's own document for an agent — so a test that got the branch wrong would
 * fail rather than pass for the wrong reason.
 */
function driven(agentManifest: unknown = null): Driven {
  const reads: string[] = [];
  const sent: Array<Record<string, unknown>> = [];
  const audit: Driven["audit"] = [];

  const broker = createBroker({
    readManifest: (principal) =>
      principal.kind === "chief"
        ? chiefManifest(PROVIDER)
        : (agentManifest as ReturnType<typeof chiefManifest>),
    readCredential: (secretName: string): Promise<CredentialRead> => {
      reads.push(secretName);
      return Promise.resolve({ kind: "found", credential: keyCredential({ provider: PROVIDER }) });
    },
    mintAuthorization: (credential) =>
      Promise.resolve(
        aiAuthHeaders(
          aiProviderById(PROVIDER) ?? (aiProviders()[0] as ReturnType<typeof aiProviders>[number]),
          (credential as { key: string }).key,
        ),
      ),
    fetchImpl: ((_url: string, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return Promise.resolve(
        new Response(JSON.stringify(ANSWER_BODY), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }) as unknown as typeof fetch,
    audit: (row) => {
      audit.push({ agent: row.agent, decision: row.decision, refusal: row.refusal });
    },
    now: () => new Date("2026-08-16T10:00:00.000Z"),
  });

  return { handle: broker.handle, reads, sent, audit };
}

function question(operation: string, connection = CHIEF_CONNECTION_ID): Record<string, unknown> {
  return {
    request_id: `chief-${operation}-${connection}`,
    connection_id: connection,
    operation,
    input: {
      model: MODEL,
      question: "what agents run local and what on the cloud",
      material: "[1] AI News Scout\nRuns on: Local\nStanding: All clear.",
      max_output_tokens: 700,
    },
  };
}

/* ---------------------------------------------------------------------- *
 * Decision 1 — a type, not a reserved string
 * ---------------------------------------------------------------------- */

describe("who is asking is a type", () => {
  /*
   * The whole argument for the union, expressed as the thing it makes
   * impossible. `lib/handoff.ts` and `lib/open-link.ts` both accept an agent id
   * matching /^[a-z0-9][a-z0-9._-]{0,63}$/, and `dash.fleet` satisfies it — so
   * an agent really can be called that, and this asserts that being called that
   * buys nothing.
   */
  it("gives an agent named dash.fleet a different budget from the chief", () => {
    expect(principalKey(agentPrincipal(FLEET_PRINCIPAL))).not.toBe(principalKey(CHIEF));
    expect(principalKey(agentPrincipal("chief"))).not.toBe(principalKey(CHIEF));
  });

  /*
   * The other half, and it is the one that matters at the vault. An agent named
   * `dash.fleet` computes a `dash.connection.` name like every other agent,
   * because `connectionSecretName` is the only name the agent branch ever
   * reaches and it emits nothing else.
   */
  it("keeps an agent named dash.fleet out of the fleet namespace", () => {
    const asAgent = connectionSecretName(FLEET_PRINCIPAL, "models", "api_key");
    expect(asAgent.startsWith("dash.connection.")).toBe(true);
    expect(asAgent.startsWith("dash.fleet.")).toBe(false);
    expect(asAgent).not.toBe(fleetSecretName(PROVIDER, "api_key"));
  });
});

/* ---------------------------------------------------------------------- *
 * Decision 2 — the manifest DASH composes
 * ---------------------------------------------------------------------- */

describe("the chief's manifest is DASH's own", () => {
  it("carries one connection and exactly one capability", () => {
    const manifest = chiefManifest(PROVIDER);
    const connections = manifest?.agent_dom?.connections ?? [];
    expect(connections).toHaveLength(1);
    const only = connections[0];
    expect(only?.id).toBe(CHIEF_CONNECTION_ID);
    expect(only?.ownership).toBe("dash_managed");
    expect(only?.capabilities.map((one) => one.id)).toEqual([chiefOperationId(PROVIDER)]);
  });

  /*
   * ADR 0013's derivation, read back for the one principal that *is* the fleet.
   * A provider DASH has not built the flow for cannot appear here, because the
   * builder reads `fleetCatalogue()` rather than a list of its own.
   */
  it("refuses a provider DASH has no catalogue entry for", () => {
    expect(chiefManifest("not-a-provider")).toBeNull();
    expect(chiefManifest("")).toBeNull();
  });

  it("composes one for every provider DASH does hold a key for", () => {
    for (const profile of aiProviders()) {
      expect(chiefManifest(profile.id)).not.toBeNull();
    }
  });
});

/* ---------------------------------------------------------------------- *
 * Decision 3 — two vault names, one reachable per principal
 * ---------------------------------------------------------------------- */

describe("which vault name the broker computes", () => {
  it("reads the fleet key for the chief and never a connection key", async () => {
    const broker = driven();
    const answer = (await broker.handle(
      CHIEF,
      question(chiefOperationId(PROVIDER)) as never,
      "person",
    )) as { ok: boolean };

    expect(answer.ok).toBe(true);
    expect(broker.reads).toEqual([fleetSecretName(PROVIDER, "api_key")]);
    expect(broker.reads[0]?.startsWith("dash.fleet.")).toBe(true);
    // The sentence `lib/fleet/principal.ts` protects, asserted from the broker
    // side: nothing this path computed is in the agents' namespace.
    expect(broker.reads.some((name) => name.startsWith("dash.connection."))).toBe(false);
  });

  /*
   * The label, doing exactly what `FLEET_PRINCIPAL`'s docblock claims for it. A
   * chief's brokered call appears in the audit under a name a person reading it
   * recognises, and nothing reads that column back as a principal.
   */
  it("audits a chief call under the fleet's own label", async () => {
    const broker = driven();
    await broker.handle(CHIEF, question(chiefOperationId(PROVIDER)) as never, "person");
    expect(broker.audit).toHaveLength(1);
    expect(broker.audit[0]?.agent).toBe(FLEET_PRINCIPAL);
    expect(broker.audit[0]?.decision).toBe("allowed");
  });
});

/* ---------------------------------------------------------------------- *
 * Decision 4 — the blast radius, as a negative
 * ---------------------------------------------------------------------- */

describe("the chief can ask a model a question and do nothing else", () => {
  /*
   * The negative ADR 0023 asks for by name, in the shape
   * `tests/broker-threat-model.test.ts` uses: drive the real `handle` with a
   * hostile request and assert the refusal rather than reasoning about the
   * manifest.
   *
   * Gmail is refused at the *connection*, because the chief's composed manifest
   * declares one connection and it is not Gmail. No vault is touched.
   */
  it("refuses every Gmail operation, before the vault", async () => {
    const gmail = allOperations().filter((one) => one.connection_provider === "google-gmail");
    expect(gmail.length).toBeGreaterThan(0);

    for (const operation of gmail) {
      const broker = driven();
      const answer = (await broker.handle(
        CHIEF,
        question(operation.id, "gmail") as never,
        "person",
      )) as { ok: boolean; refusal?: string };
      expect(answer.ok).toBe(false);
      expect(answer.refusal).toBe("unknown_connection");
      expect(broker.reads).toEqual([]);
    }
  });

  /*
   * The sharper negative, and the one a reader would not predict. A key grant
   * is resolved by `resolveKeyGrant`, which grants **every** operation the
   * provider has — right for an agent whose owner connected the key knowing
   * what DASH can do with it, and wrong for the chief, whose invariant is one
   * capability. Step 4b is what makes the invariant a property rather than a
   * sentence, and this is what would fail if somebody removed it.
   */
  it("refuses the provider's other operations on its own connection", async () => {
    const others = allOperations()
      .filter((one) => one.connection_provider === PROVIDER)
      .filter((one) => one.id !== chiefOperationId(PROVIDER));
    expect(others.length).toBeGreaterThan(0);

    for (const operation of others) {
      const broker = driven();
      const answer = (await broker.handle(CHIEF, question(operation.id) as never, "person")) as {
        ok: boolean;
        refusal?: string;
      };
      expect(answer.ok).toBe(false);
      expect(answer.refusal).toBe("not_granted");
      expect(broker.reads).toEqual([]);
    }
  });

  /*
   * ADR 0023 decision 4, the origin clause. An unattended chief spend is
   * "unreachable" rather than refused-by-policy, and this is the mechanical
   * reading of that: `allowRunSpend` takes an agent id, so no chief budget can
   * hold an allowance, so an agent-origin chief question is refused with the
   * same code an agent with no allowance gets.
   */
  it("refuses a chief question that did not come from a person", async () => {
    const broker = driven();
    const answer = (await broker.handle(
      CHIEF,
      question(chiefOperationId(PROVIDER)) as never,
      "agent",
    )) as { ok: boolean; refusal?: string };
    expect(answer.ok).toBe(false);
    expect(answer.refusal).toBe("needs_a_person");
    expect(broker.reads).toEqual([]);
  });

  /** The credential never leaves the one function it is held inside. */
  it("puts the fleet key in no answer and no audit row", async () => {
    const broker = driven();
    const answer = await broker.handle(
      CHIEF,
      question(chiefOperationId(PROVIDER)) as never,
      "person",
    );
    for (const value of [...everyString(answer), ...everyString(broker.audit)]) {
      expect(value).not.toContain(PLANTED_PROVIDER_KEY);
    }
  });
});

/* ---------------------------------------------------------------------- *
 * Decision 5 — the frame is DASH's, and the caller cannot name it
 * ---------------------------------------------------------------------- */

describe("which system prompt a question is set in", () => {
  const chiefPrompt = () => {
    const broker = driven();
    return broker
      .handle(CHIEF, question(chiefOperationId(PROVIDER)) as never, "person")
      .then(() => String(broker.sent[0]?.["messages"] === undefined ? "" : JSON.stringify(broker.sent[0])));
  };

  it("sets a chief question in the fleet frame", async () => {
    const body = await chiefPrompt();
    expect(body).toContain("You are the chief of a person's own small fleet");
    expect(body).toContain("BRIEFING");
    expect(body).not.toContain("SAVED MATERIAL");
  });

  /*
   * The load-bearing negative. `frame` is written by `lib/broker/execute.ts`
   * from the principal, *after* the caller's input, so a request that tried to
   * name it is overwritten rather than validated — the same shape ADR 0011's
   * model substitution already uses, and for the same reason: a value a caller
   * supplies is a value a caller could choose.
   */
  it("ignores a frame the caller tried to supply", async () => {
    const broker = driven();
    const asked = question(chiefOperationId(PROVIDER));
    (asked["input"] as Record<string, unknown>)["frame"] = "agent_material";
    await broker.handle(CHIEF, asked as never, "person");
    expect(JSON.stringify(broker.sent[0])).toContain("You are the chief");
  });

  /*
   * And the other direction, which is the one an agent could try: an agent
   * asking under the chief's frame gets the agent frame, because the same line
   * overwrites it from *its* principal.
   */
  it("keeps an agent in the agent frame however it asks", async () => {
    const manifest = chiefManifest(PROVIDER);
    const broker = driven(manifest);
    const asked = question(chiefOperationId(PROVIDER));
    asked["request_id"] = "agent-tries-the-chief-frame";
    (asked["input"] as Record<string, unknown>)["frame"] = "fleet_briefing";
    await broker.handle(agentPrincipal("news-agent"), asked as never, "person");
    const body = JSON.stringify(broker.sent[0]);
    expect(body).toContain("SAVED MATERIAL");
    expect(body).not.toContain("You are the chief");
  });
});

/* ---------------------------------------------------------------------- *
 * The sentence that must survive verbatim
 * ---------------------------------------------------------------------- */

describe("lib/fleet/principal.ts still says what it says", () => {
  /*
   * ADR 0023 decision 3 is an amendment scoped to a principal that is not an
   * agent, and its whole claim is that the sentence that module protects
   * survives **verbatim**. So this reads the file.
   *
   * A prose assertion is unusual and it is the right instrument here. The
   * behaviour is covered above; what this catches is somebody softening the
   * docblock to match a change they made — which is exactly how a load-bearing
   * comment stops being load-bearing.
   */
  it("still promises that no agent resolves to the fleet credential's key", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    /*
     * Normalised at the read, and unwrapped to one line before matching.
     *
     * Two things would otherwise make this a test about formatting rather than
     * about the promise: this repository's files are checked out with CRLF, and
     * the sentence is wrapped across three comment lines, so the string a
     * reviewer sees in the file and the string in memory differ by `\r`, by
     * newlines and by ` * ` prefixes. Collapsing all three means a reflow of the
     * comment does not fail this, and softening the sentence does.
     */
    const prose = readFileSync(path.join(here, "..", "lib", "fleet", "principal.ts"), "utf8")
      .replace(/\r\n/g, "\n")
      .replace(/\n \* ?/g, " ")
      .replace(/\s+/g, " ");

    expect(prose).toContain(
      "no agent, named anything at all including this, resolves to the fleet credential's vault key",
    );
    expect(prose).toContain("It is a **label**, not a lock.");
    // And the mechanism it names is still the mechanism: the only name the agent
    // branch computes.
    expect(prose).toContain("`connectionSecretName` — the only name");
  });

  /**
   * The operation the chief reaches is a real one, and it is the only one.
   *
   * Belt to the braces above: if somebody renamed `{provider}.chat.completion`,
   * `chiefOperationId` would compose a manifest naming an operation that does
   * not exist and every test above would still pass — the chief would simply be
   * refused everything, which reads like a very secure feature.
   */
  it("names an operation that exists", () => {
    for (const profile of aiProviders()) {
      expect(operationById(chiefOperationId(profile.id))).not.toBeNull();
    }
  });
});
