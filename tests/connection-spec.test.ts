/**
 * Connection requirements v1: the contract, and the pure reader beside it
 * (MAR-569).
 *
 * The claims this file exists to hold:
 *
 * 1. **The vocabulary is closed, and it is two.** A typo'd kind is refused at
 *    import rather than drawn at render — and the third kind MAR-569 originally
 *    named is absent on purpose, because DASH has no flow behind it.
 * 2. **The versioning rule is structural.** Version 1 is validated strictly; a
 *    version DASH does not know is accepted for structure only and resolves
 *    without requirements, so a surface has nothing to put a button beside.
 * 3. **Absence means absence** — and specifically not "this agent needs nothing
 *    connected", which is a claim `agent_dom.connections` may well contradict.
 * 4. **A resolution never invents a button.** Every path that cannot produce a
 *    launchable flow says which one it is, and the four standings are MAR-533's
 *    own, computed by MAR-533's own function.
 *
 * ## The corpus is the drift tripwire
 *
 * `lib/connection-spec.ts` re-states the schema's rules in TypeScript so the
 * surface and the feedback layer can reach them without Ajv. A re-statement is a
 * second source of truth unless something fails when the two disagree, so every
 * case below is run through **both** the compiled schema and the pure reader,
 * and they must return the same verdict.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  agentConnectionRequirements,
  validateManifest,
  type AgentManifestV2,
} from "../lib/contracts";
import { explainImportFailure } from "../lib/import-feedback";
import {
  CONNECTION_REQUIREMENTS_MANIFEST_PATH,
  CONNECTOR_KINDS_V1,
  resolveConnectionRequirements,
  validateConnectionRequirements,
  type ConnectionRequirementV1,
} from "../lib/connection-spec";
import {
  CONNECT_FLOW_REFUSALS,
  describeFlowRefusal,
  resolveRequirement,
  resolveRequirements,
  rollUpStanding,
} from "../lib/connection-requirements";
import type { ConnectionRowWithCredential } from "../lib/views/types";
import { expectPlainLanguage } from "./helpers/plain-language";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const dataDir = mkdtempSync(path.join(tmpdir(), "dash-connreq-"));
process.env.DASH_DATA_DIR = dataDir;

const { importManifest, readAgentManifest, resetStore } = await import("../lib/store");
const { closeDb } = await import("../lib/db");

function example(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(repoRoot, "examples", name), "utf8")) as Record<
    string,
    unknown
  >;
}

/** The id the shipped example actually declares. A requirement has to name a real one. */
const DECLARED_CONNECTION = "project-service";

/** The shipped v2 example with a requirements block grafted on. Nothing else changes. */
function withRequirements(block: unknown): Record<string, unknown> {
  const manifest = example("dash-managed.manifest.v2.example.json");
  (manifest["agent_dom"] as Record<string, unknown>)["connection_requirements"] = block;
  return manifest;
}

/** What the compiled contract says, through the same function both import doors call. */
function schemaAccepts(block: unknown): boolean {
  return validateManifest(withRequirements(block)).ok;
}

beforeEach(() => {
  resetStore();
});

afterAll(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

/* ---------------------------------------------------------------------- *
 * Fixtures
 * ---------------------------------------------------------------------- */

// `satisfies` rather than a bare literal: it keeps `connector_kind` narrowed to
// the union so these double as inputs to the resolution layer, while leaving
// them plain objects the corpus can spread and corrupt.
const OAUTH = {
  id: "gmail",
  name: "Your Gmail",
  connector_kind: "google_oauth_broker",
  connection_id: DECLARED_CONNECTION,
} satisfies ConnectionRequirementV1;

const KEY = {
  id: "weather",
  name: "A weather service key",
  connector_kind: "api_key",
  connection_id: DECLARED_CONNECTION,
} satisfies ConnectionRequirementV1;

function blockOf(...requirements: unknown[]): Record<string, unknown> {
  return { requirements_version: 1, requirements };
}

function repeat(character: string, count: number): string {
  return character.repeat(count);
}

/* ---------------------------------------------------------------------- *
 * The corpus: every case, checked twice
 * ---------------------------------------------------------------------- */

interface RequirementCase {
  name: string;
  block: unknown;
  valid: boolean;
}

const CASES: RequirementCase[] = [
  /* --- the two kinds, and what they may carry ------------------------ */
  { name: "a brokered sign-in", block: blockOf(OAUTH), valid: true },
  { name: "a custodied key", block: blockOf(KEY), valid: true },
  { name: "both kinds at once", block: blockOf(OAUTH, KEY), valid: true },
  {
    name: "operations named explicitly",
    block: blockOf({ ...OAUTH, operations: ["gmail.search", "gmail.draft.create"] }),
    valid: true,
  },
  {
    name: "an optional requirement with the author's reason",
    block: blockOf({ ...KEY, optional: true, why: "Adds a forecast to the morning digest." }),
    valid: true,
  },
  {
    name: "a single-segment operation id",
    block: blockOf({ ...OAUTH, operations: ["search"] }),
    valid: true,
  },

  /* --- the closed enum ------------------------------------------------ */
  {
    name: "a typo'd connector kind",
    block: blockOf({ ...OAUTH, connector_kind: "google_oauth" }),
    valid: false,
  },
  {
    name: "the kind MAR-569 named and DASH has no flow for",
    block: blockOf({ id: "notion", name: "A Notion workspace", connector_kind: "mcp_server" }),
    valid: false,
  },
  {
    name: "a connector kind from a version that has not been designed yet",
    block: blockOf({ ...OAUTH, connector_kind: "browser_session" }),
    valid: false,
  },
  {
    name: "no connector kind at all",
    block: blockOf({ id: "x", name: "X", connection_id: DECLARED_CONNECTION }),
    valid: false,
  },

  /* --- the link to a connection -------------------------------------- */
  {
    name: "a requirement naming no connection",
    block: blockOf({ id: "gmail", name: "Your Gmail", connector_kind: "google_oauth_broker" }),
    valid: false,
  },
  {
    name: "a connection id that is empty",
    block: blockOf({ ...OAUTH, connection_id: "" }),
    valid: false,
  },
  {
    name: "a connection id past the length the contract allows",
    block: blockOf({ ...OAUTH, connection_id: repeat("c", 65) }),
    valid: false,
  },
  {
    // The reader cannot check this — it has no manifest — so both sides accept
    // it and `resolveRequirement` is what says the two blocks disagree.
    name: "a connection id naming a connection this manifest never declared",
    block: blockOf({ ...OAUTH, connection_id: "nothing-like-this" }),
    valid: true,
  },

  /* --- structure ------------------------------------------------------ */
  { name: "a block that is an array", block: [OAUTH], valid: false },
  { name: "a block that is a string", block: "connect gmail please", valid: false },
  { name: "a null block — omit-never-empty, and never-null either", block: null, valid: false },
  { name: "an empty object — the shape the omit rule forbids", block: {}, valid: false },
  { name: "a block with no requirements key", block: { requirements_version: 1 }, valid: false },
  {
    name: "requirements that are an object",
    block: { requirements_version: 1, requirements: {} },
    valid: false,
  },
  { name: "an empty requirements array", block: blockOf(), valid: false },
  {
    name: "more requirements than the contract allows",
    block: {
      requirements_version: 1,
      requirements: Array.from({ length: 13 }, (_unused, index) => ({
        ...OAUTH,
        id: `need_${String(index)}`,
      })),
    },
    valid: false,
  },
  { name: "a requirement that is a string", block: blockOf("gmail please"), valid: false },
  { name: "a requirement that is an array", block: blockOf([]), valid: false },
  { name: "a version of zero", block: { ...blockOf(OAUTH), requirements_version: 0 }, valid: false },
  {
    name: "a version that is not an integer",
    block: { ...blockOf(OAUTH), requirements_version: 1.5 },
    valid: false,
  },

  /* --- members -------------------------------------------------------- */
  { name: "a requirement with no id", block: blockOf({ ...OAUTH, id: undefined }), valid: false },
  { name: "a requirement with no name", block: blockOf({ ...OAUTH, name: undefined }), valid: false },
  {
    name: "an id that is not lowercase vocabulary",
    block: blockOf({ ...OAUTH, id: "Your-Gmail" }),
    valid: false,
  },
  {
    name: "a name past the length the contract allows",
    block: blockOf({ ...OAUTH, name: repeat("n", 121) }),
    valid: false,
  },
  { name: "an empty name", block: blockOf({ ...OAUTH, name: "" }), valid: false },
  {
    name: "optional that is not a boolean",
    block: blockOf({ ...OAUTH, optional: "yes" }),
    valid: false,
  },
  { name: "an empty why", block: blockOf({ ...OAUTH, why: "" }), valid: false },
  {
    name: "a why past the length the contract allows",
    block: blockOf({ ...OAUTH, why: repeat("w", 401) }),
    valid: false,
  },
  {
    name: "operations that are not an array",
    block: blockOf({ ...OAUTH, operations: "gmail.search" }),
    valid: false,
  },
  {
    name: "an operation id that could spell a path",
    block: blockOf({ ...OAUTH, operations: ["../../etc/passwd"] }),
    valid: false,
  },
  {
    name: "an operation id in the wrong alphabet",
    block: blockOf({ ...OAUTH, operations: ["Gmail Search"] }),
    valid: false,
  },
  {
    name: "a repeated operation",
    block: blockOf({ ...OAUTH, operations: ["gmail.search", "gmail.search"] }),
    valid: false,
  },
  {
    name: "more operations than the contract allows",
    block: blockOf({
      ...OAUTH,
      operations: Array.from({ length: 13 }, (_unused, index) => `op.number${String(index)}`),
    }),
    valid: false,
  },

  /* --- the credential guard ------------------------------------------- */
  {
    name: "a requirement carrying a secret, which no connection block may",
    block: blockOf({ ...KEY, api_key: "sk-live-not-a-real-key" }),
    valid: false,
  },
  {
    name: "a requirement carrying a token",
    block: blockOf({ ...OAUTH, access_token: "ya29.not-a-real-token" }),
    valid: false,
  },

  /* --- the additive rule ---------------------------------------------- */
  {
    name: "unknown members on a requirement, which the additive rule keeps",
    block: blockOf({ ...OAUTH, invented_later: { deeply: ["nested"] } }),
    valid: true,
  },
  {
    name: "a version DASH has never heard of, accepted for structure",
    block: {
      requirements_version: 2,
      requirements: [{ id: "anything it likes", name: "A thing", connector_kind: "future_flow" }],
    },
    valid: true,
  },
  {
    name: "a newer version whose requirement is still shapeless",
    block: { requirements_version: 2, requirements: [{ name: "no id here" }] },
    valid: false,
  },
];

describe("the schema and the reader agree on every case", () => {
  for (const testCase of CASES) {
    it(`${testCase.valid ? "accepts" : "refuses"} ${testCase.name}`, () => {
      const bySchema = schemaAccepts(testCase.block);
      const byReader = validateConnectionRequirements(testCase.block).ok;

      expect(bySchema, "the compiled contract").toBe(testCase.valid);
      expect(byReader, "lib/connection-spec.ts").toBe(testCase.valid);
      expect(byReader, "the reader must agree with the contract").toBe(bySchema);
    });
  }
});

/* ---------------------------------------------------------------------- *
 * The vocabulary, pinned
 * ---------------------------------------------------------------------- */

describe("the closed vocabulary", () => {
  it("is the two flows DASH has actually built", () => {
    expect([...CONNECTOR_KINDS_V1]).toEqual(["google_oauth_broker", "api_key"]);
  });

  it("has the same members in the contract as in the reader", () => {
    const schema = JSON.parse(
      readFileSync(path.join(repoRoot, "contracts", "agent.manifest.v2.schema.json"), "utf8"),
    ) as {
      $defs: { connectionRequirementV1: { properties: { connector_kind: { enum: string[] } } } };
    };
    expect(schema.$defs.connectionRequirementV1.properties.connector_kind.enum).toEqual([
      ...CONNECTOR_KINDS_V1,
    ]);
  });

  it("pins the sentence in lib/import-feedback.ts that cannot be derived", () => {
    /*
     * That module tells an author "DASH connects things in two ways", written
     * out rather than built from the array — because the members are slugs and
     * `lib/copy/identifiers.ts` refuses those on a guided surface.
     *
     * So this is the tripwire for the copy. If a third kind is added and this
     * fails, the fix is not to change the number here: it is to rewrite the
     * suggestion in `explainImportFailure` to describe the new way of
     * connecting, and then to change the number here.
     */
    expect(
      CONNECTOR_KINDS_V1.length,
      "add a connector kind and the plain-language suggestion in lib/import-feedback.ts is stale",
    ).toBe(2);
  });
});

/* ---------------------------------------------------------------------- *
 * Resolution of the declaration
 * ---------------------------------------------------------------------- */

describe("resolving what the author declared", () => {
  it("reads an undeclared block as none, never as an empty list", () => {
    const manifest = example("dash-managed.manifest.v2.example.json");
    expect(resolveConnectionRequirements(manifest)).toEqual({ kind: "none" });
  });

  it("does not read absence as 'this agent needs nothing connected'", () => {
    // The load-bearing distinction: the shipped example declares no
    // requirements and still reaches a service. A caller that treated `none` as
    // "nothing to connect" would render a reassuring empty page over a live
    // connection.
    const manifest = example("dash-managed.manifest.v2.example.json");
    const connections = (manifest["agent_dom"] as { connections: unknown[] }).connections;
    expect(resolveConnectionRequirements(manifest).kind).toBe("none");
    expect(connections.length).toBeGreaterThan(0);
  });

  it("narrows a version 1 declaration", () => {
    const resolution = resolveConnectionRequirements(withRequirements(blockOf(OAUTH, KEY)));
    expect(resolution.kind).toBe("v1");
    if (resolution.kind !== "v1") return;
    expect(resolution.requirements.map((one) => one.id)).toEqual(["gmail", "weather"]);
    expect(resolution.requirements[0]?.connector_kind).toBe("google_oauth_broker");
  });

  it("carries no requirements for a version it does not know", () => {
    const resolution = resolveConnectionRequirements(
      withRequirements({
        requirements_version: 7,
        requirements: [
          { id: "a", name: "A", connector_kind: "future_flow" },
          { id: "b", name: "B", connector_kind: "future_flow" },
        ],
      }),
    );
    expect(resolution.kind).toBe("newer_version");
    if (resolution.kind !== "newer_version") return;
    expect(resolution.requirements_version).toBe(7);
    // The count travels so a surface can say how many there are. The
    // requirements themselves do not, so there is no array to put buttons
    // beside — the rule is structural rather than something a renderer has to
    // remember.
    expect(resolution.declared_count).toBe(2);
    expect(resolution).not.toHaveProperty("requirements");
  });

  it("carries the errors for a block that arrived some other way", () => {
    const resolution = resolveConnectionRequirements({
      agent_dom: { connection_requirements: { requirements_version: 1, requirements: [{}] } },
    });
    expect(resolution.kind).toBe("unreadable");
    if (resolution.kind !== "unreadable") return;
    expect(resolution.errors.length).toBeGreaterThan(0);
    expect(resolution.errors.every((error) => error.path.startsWith("/requirements"))).toBe(true);
  });

  it("names the same paths Ajv does", () => {
    const result = validateManifest(
      withRequirements(blockOf({ ...OAUTH, connector_kind: "google_oauth" })),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;

    const reader = validateConnectionRequirements(
      blockOf({ ...OAUTH, connector_kind: "google_oauth" }),
    );
    expect(reader.ok).toBe(false);
    if (reader.ok) return;

    const rooted = `${CONNECTION_REQUIREMENTS_MANIFEST_PATH}${reader.errors[0]?.path ?? ""}`;
    expect(result.errors.some((error) => error.includes(rooted))).toBe(true);
  });
});

/* ---------------------------------------------------------------------- *
 * The store door
 * ---------------------------------------------------------------------- */

describe("the import door", () => {
  it("refuses a typo'd connector kind rather than storing it", () => {
    const result = importManifest(
      withRequirements(blockOf({ ...OAUTH, connector_kind: "google_oauth" })),
    );
    expect(result.ok).toBe(false);
  });

  it("stores a valid declaration verbatim", () => {
    const declared = blockOf({ ...OAUTH, operations: ["gmail.search"], why: "To read your mail." });
    const result = importManifest(withRequirements(declared));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Read back through the store rather than trusting the import's own return:
    // the claim is that the author's document survives the round trip, and only
    // a re-read can make it.
    const stored = readAgentManifest(result.agent);
    expect(stored).not.toBeNull();
    expect(agentConnectionRequirements(stored as AgentManifestV2)).toEqual(declared);
  });

  it("returns null for an agent that declared nothing", () => {
    const result = importManifest(example("dash-managed.manifest.v2.example.json"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stored = readAgentManifest(result.agent);
    expect(stored).not.toBeNull();
    expect(agentConnectionRequirements(stored as AgentManifestV2)).toBeNull();
  });
});

/* ---------------------------------------------------------------------- *
 * What an author is told
 * ---------------------------------------------------------------------- */

describe("import feedback", () => {
  it("names the connection declaration rather than the top of the manifest", () => {
    const result = importManifest(
      withRequirements(blockOf({ ...OAUTH, connector_kind: "google_oauth" })),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(explainImportFailure(result.errors).kind).toBe("invalid_connection_requirements");
  });

  it("does not send an author to the top of the file for a missing connection id", () => {
    // The ordering this branch exists for: Ajv says "must have required
    // property 'connection_id'", and the missing-property branch would have
    // turned that into a sentence about a missing top-level section.
    const result = importManifest(
      withRequirements(blockOf({ id: "gmail", name: "Your Gmail", connector_kind: "api_key" })),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(explainImportFailure(result.errors).kind).toBe("invalid_connection_requirements");
  });

  it("leaves the cases that were already right alone", () => {
    expect(explainImportFailure(["(root) must have required property 'agent_dom'"]).kind).toBe(
      "missing_agent_dom",
    );
  });

  it("passes the plain-language rule", () => {
    const result = importManifest(
      withRequirements(blockOf({ ...OAUTH, connector_kind: "google_oauth" })),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const explanation = explainImportFailure(result.errors);
    // The raw errors are exempt, as Ajv's always are — they are shown as the
    // validator's own words and are never the headline.
    expectPlainLanguage([explanation.headline, explanation.suggestion]);
  });
});

/* ---------------------------------------------------------------------- *
 * Resolution against the store
 * ---------------------------------------------------------------------- */

/** A row with a broker card, built to order. Pure input to a pure function. */
function rowWith(options: {
  connection_id?: string;
  field_id?: string | null;
  requested?: Array<{ id: string; label: string }>;
  not_requested?: Array<{ id: string; label: string }>;
  issued?: string[] | null;
}): ConnectionRowWithCredential {
  const capability = (one: { id: string; label: string }) => ({
    ...one,
    access: "read" as const,
    consequence: null,
  });
  const requested = (options.requested ?? []).map(capability);
  const notRequested = (options.not_requested ?? []).map(capability);
  const issued = options.issued ?? null;

  return {
    connection_id: options.connection_id ?? DECLARED_CONNECTION,
    service: "Gmail",
    provider: "google-gmail",
    purpose: "Read the morning mail",
    capabilities: [],
    ownership: "dash",
    ownership_confirmed: true,
    source: "declared_connection",
    requires_secret_input: false,
    validation_behavior: "test",
    dash_can_hold: true,
    field_id: options.field_id === undefined ? "account-authorization" : options.field_id,
    masked_hint: null,
    delivered_to_agent: false,
    credential_kind: "oauth",
    broker: {
      custody_sentence: "DASH holds the sign-in for this connection in this computer's vault.",
      client_sentence: null,
      requested,
      not_requested: notRequested,
      wider_permission_sentence: null,
      dash_closed_sentence: null,
      receipt:
        issued === null
          ? null
          : {
              account_hint: "someone@example.com",
              granted_at: "2026-08-08T09:00:00.000Z",
              last_used_at: null,
              capabilities: requested.filter((one) => issued.includes(one.id)),
            },
      recent: [],
    },
  } satisfies ConnectionRowWithCredential;
}

const GMAIL_SEARCH = { id: "gmail.search", label: "Search your mail" };
const GMAIL_DRAFT = { id: "gmail.draft.create", label: "Save a draft" };

describe("resolving a requirement against what DASH holds", () => {
  it("says waiting for you when nobody has signed in", () => {
    const row = rowWith({ requested: [GMAIL_SEARCH], issued: null });
    const resolved = resolveRequirement(
      { ...OAUTH, operations: ["gmail.search"] },
      "news-scout",
      [row],
    );
    expect(resolved.standing).toBe("awaiting_you");
    expect(resolved.operations.map((one) => one.id)).toEqual(["gmail.search"]);
    expect(resolved.disagreements).toEqual([]);
  });

  it("says allowed when every operation it names was issued", () => {
    const row = rowWith({ requested: [GMAIL_SEARCH, GMAIL_DRAFT], issued: ["gmail.search"] });
    const resolved = resolveRequirement(
      { ...OAUTH, operations: ["gmail.search"] },
      "news-scout",
      [row],
    );
    expect(resolved.standing).toBe("allowed");
  });

  it("keeps a partial consent distinct from never having signed in", () => {
    // The state MAR-533 exists to keep separate, asserted here because a rollup
    // is exactly where two states get merged by accident. Telling this person to
    // sign in would be telling them to repeat something that already happened.
    const row = rowWith({ requested: [GMAIL_SEARCH, GMAIL_DRAFT], issued: ["gmail.search"] });
    const resolved = resolveRequirement(
      { ...OAUTH, operations: ["gmail.search", "gmail.draft.create"] },
      "news-scout",
      [row],
    );
    expect(resolved.standing).toBe("not_issued");
    expect(resolved.standing).not.toBe("awaiting_you");
  });

  it("leads with the operation no sign-in can clear", () => {
    const row = rowWith({
      requested: [GMAIL_SEARCH],
      not_requested: [GMAIL_DRAFT],
      issued: ["gmail.search"],
    });
    const resolved = resolveRequirement(
      { ...OAUTH, operations: ["gmail.search", "gmail.draft.create"] },
      "news-scout",
      [row],
    );
    expect(resolved.standing).toBe("not_asked_for");
  });

  it("reads no named operations as the connection's own requested set", () => {
    const row = rowWith({
      requested: [GMAIL_SEARCH],
      not_requested: [GMAIL_DRAFT],
      issued: ["gmail.search"],
    });
    const resolved = resolveRequirement(OAUTH, "news-scout", [row]);
    // The unrequested one is excluded on purpose: it is an action DASH offers
    // that this agent never asked for, so it is not part of what this
    // requirement needs and must not drag the line to a state no sign-in clears.
    expect(resolved.operations.map((one) => one.id)).toEqual(["gmail.search"]);
    expect(resolved.standing).toBe("allowed");
  });

  it("surfaces an operation the connection does not offer instead of rounding it into a standing", () => {
    const row = rowWith({ requested: [GMAIL_SEARCH], issued: ["gmail.search"] });
    const resolved = resolveRequirement(
      { ...OAUTH, operations: ["gmail.search", "gmail.send"] },
      "news-scout",
      [row],
    );
    expect(resolved.disagreements).toEqual([
      { operation_id: "gmail.send", reason: "not_on_connection" },
    ]);
    // And the standing still describes the operations that do resolve, rather
    // than being poisoned by the one that does not.
    expect(resolved.standing).toBe("allowed");
  });

  it("refuses a flow when the requirement names a connection the manifest never declared", () => {
    const resolved = resolveRequirement(
      { ...OAUTH, connection_id: "nothing-like-this" },
      "news-scout",
      [rowWith({})],
    );
    expect(resolved.flow).toBeNull();
    expect(resolved.flow_refusal).toBe("connection_not_declared");
    expect(resolved.standing).toBe("awaiting_you");
  });

  it("refuses a flow when there is no field to act on", () => {
    const resolved = resolveRequirement(OAUTH, "news-scout", [rowWith({ field_id: null })]);
    expect(resolved.flow).toBeNull();
    expect(resolved.flow_refusal).toBe("no_field_to_act_on");
  });

  it("hands the surface everything the connect channel needs", () => {
    const resolved = resolveRequirement(OAUTH, "news-scout", [rowWith({})]);
    expect(resolved.flow).toEqual({
      channel: "connection.connect",
      agent_id: "news-scout",
      connection_id: DECLARED_CONNECTION,
      field_id: "account-authorization",
    });
    expect(resolved.flow_refusal).toBeNull();
  });

  it("sets exactly one of flow and flow_refusal, always", () => {
    const rows = [rowWith({}), rowWith({ field_id: null })];
    const resolutions = [
      resolveRequirement(OAUTH, "news-scout", rows),
      resolveRequirement(OAUTH, "news-scout", [rows[1] as ConnectionRowWithCredential]),
      resolveRequirement({ ...OAUTH, connection_id: "absent" }, "news-scout", rows),
    ];
    for (const resolved of resolutions) {
      // Exactly one, never both and never neither: a line with no button and no
      // reason is a dead end the surface cannot describe.
      expect((resolved.flow === null) !== (resolved.flow_refusal === null)).toBe(true);
    }
  });

  it("carries the author's optional and reason through, defaulted honestly", () => {
    const plain = resolveRequirement(OAUTH, "news-scout", [rowWith({})]);
    expect(plain.optional).toBe(false);
    expect(plain.why).toBeNull();

    const stated = resolveRequirement(
      { ...KEY, optional: true, why: "Adds a forecast." },
      "news-scout",
      [rowWith({})],
    );
    expect(stated.optional).toBe(true);
    expect(stated.why).toBe("Adds a forecast.");
  });

  it("resolves a whole declaration in the author's order", () => {
    const resolved = resolveRequirements([OAUTH, KEY], "news-scout", [rowWith({})]);
    expect(resolved.map((one) => one.id)).toEqual(["gmail", "weather"]);
  });
});

describe("the rollup", () => {
  const at = (standing: string) =>
    ({ id: "x", label: "X", access: "read", consequence: null, standing }) as never;

  it("treats an empty list as waiting rather than allowed", () => {
    // The one wrong answer on a page about what is safe to run.
    expect(rollUpStanding([])).toBe("awaiting_you");
  });

  it("orders the four by what the reader should do next", () => {
    expect(rollUpStanding([at("allowed"), at("not_issued")])).toBe("not_issued");
    expect(rollUpStanding([at("allowed"), at("not_issued"), at("awaiting_you")])).toBe(
      "awaiting_you",
    );
    expect(rollUpStanding([at("allowed"), at("awaiting_you"), at("not_asked_for")])).toBe(
      "not_asked_for",
    );
    expect(rollUpStanding([at("allowed"), at("allowed")])).toBe("allowed");
  });
});

describe("what the surface says when there is no button", () => {
  it("has a distinct sentence for every refusal", () => {
    const meanings = CONNECT_FLOW_REFUSALS.map((refusal) => describeFlowRefusal(refusal).meaning);
    expect(new Set(meanings).size).toBe(CONNECT_FLOW_REFUSALS.length);
  });

  it("passes the plain-language rule", () => {
    for (const refusal of CONNECT_FLOW_REFUSALS) {
      const { label, meaning } = describeFlowRefusal(refusal);
      expectPlainLanguage([label, meaning]);
    }
  });

  it("blames the file rather than the person", () => {
    for (const refusal of CONNECT_FLOW_REFUSALS) {
      const { meaning } = describeFlowRefusal(refusal);
      expect(meaning.toLowerCase()).not.toContain("you did not");
      expect(meaning.toLowerCase()).not.toContain("invalid");
    }
  });
});

/* ---------------------------------------------------------------------- *
 * The import direction that keeps this readable in a browser
 * ---------------------------------------------------------------------- */

describe("lib/connection-spec.ts stays reachable from a client component", () => {
  it("imports nothing at all", () => {
    /*
     * `lib/import-feedback.ts` is bundled into the add-agent page's client
     * component and imports this module for the manifest path; MAR-570's
     * Connections surface will import it for the types. Neither can carry
     * `lib/contracts.ts`, which reads schema files with `node:fs`.
     *
     * Asserted over the source rather than trusted to review, because the
     * import that breaks this will look completely reasonable in a diff — one
     * `import type` that someone later makes a value import.
     */
    const source = readFileSync(path.join(repoRoot, "lib", "connection-spec.ts"), "utf8");
    const imports = source.match(/^\s*import\s.+$/gm) ?? [];
    expect(imports, "lib/connection-spec.ts must have no imports").toEqual([]);
  });

  it("keeps the resolution layer free of the filesystem too", () => {
    // This one may import — it needs MAR-533's standings — but every import has
    // to be a module that is itself client-safe, or the surface cannot use it.
    const source = readFileSync(path.join(repoRoot, "lib", "connection-requirements.ts"), "utf8");
    const imports = source.match(/^\s*import\s.+from\s+"([^"]+)"/gm) ?? [];
    for (const line of imports) {
      expect(line).not.toContain("node:");
      expect(line).not.toContain("./contracts");
    }
  });
});
