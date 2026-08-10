/**
 * A connection that exists before an agent does (MAR-593, ADR 0013).
 *
 * Henrik's test plan, step 1: *clear DASH of all agents and settings*. Step 2:
 * *configure DASH — sign in to Google, add OpenRouter*. On 2026-08-10 step 2 was
 * impossible, because every connection row DASH could draw came from an agent's
 * manifest and there were no agents. The first two describes below are the
 * assertions that this is no longer true.
 *
 * Written against a real vault over a fake `safeStorage` and a real store, like
 * `tests/grant-sharing.test.ts` and for its reason: the questions here are
 * "which vault keys exist afterwards", "what does the broker resolve for this
 * agent" and "what is in the two fleet tables", and a mocked store answers none
 * of them.
 *
 * ## The load-bearing test is `resolves a grant indistinguishable from a direct
 * connect`
 *
 * ADR 0013's whole safety argument is that the broker's read path was not
 * touched, so what it resolves for a materialized agent is the same thing it
 * would resolve for one that signed in itself. That is a claim about
 * `connectionSecretName` and `resolveGrant`, and it is asserted by driving both
 * against a credential nobody signed that agent in for.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { ConnectionSourceManifest } from "../lib/connections";
import { Vault } from "../lib/vault";
import { FakeSafeStorage } from "./fakes/fake-safe-storage";
import { scriptedOAuth } from "./fakes/oauth-operations";
import { refusingAi } from "./fakes/ai-operations";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const dataDir = mkdtempSync(path.join(tmpdir(), "dash-fleet-"));
process.env.DASH_DATA_DIR = dataDir;

const { performConnectionAction } = await import("../lib/connection-actions");
const { connectionSecretName } = await import("../lib/connection-credentials");
const { closeDb, db } = await import("../lib/db");
const { fleetCatalogue, fleetConnectorFor, fleetSecretName } = await import(
  "../lib/fleet/catalogue"
);
const { fleetReach } = await import("../lib/fleet/grants");
const { FLEET_PRINCIPAL } = await import("../lib/fleet/principal");
const {
  listFleetConnections,
  readFleetConnection,
  recordFleetConnection,
  recordFleetGrant,
  withheldAgents,
} = await import("../lib/fleet/store");
const { resolveGrant } = await import("../lib/broker/grant");
const { parseOAuthCredential } = await import("../lib/oauth/credential");
const { checkRequestedScopes, oauthProviderFor } = await import("../lib/oauth/providers");
const { operationsForProvider } = await import("../lib/broker/operations");
const { listReceipts } = await import("../lib/broker/store");
const { listSecretReferences } = await import("../lib/secret-refs");
const { fleetConnectorViews } = await import("../lib/views/build");

const GMAIL = "google-gmail";
const SCOUT = "news-scout";

function example(name: string): ConnectionSourceManifest {
  return JSON.parse(
    readFileSync(path.join(repoRoot, "examples", name), "utf8"),
  ) as ConnectionSourceManifest;
}

const gmailManifest = example("gmail-meeting-assistant.manifest.v2.example.json");

/**
 * An agent that needs Gmail, with its own id for the connection.
 *
 * Deliberately **not** the same `connection_id` the example uses: the fleet key
 * is the provider, and an author who called it `mail` must be reached by a
 * connection made against `google-gmail`. A fixture that reused the id would
 * pass whether or not that rule held.
 */
function scout(over: { ownership?: string; scopes?: string[] | null } = {}): ConnectionSourceManifest {
  // Walked as plain JSON rather than through the manifest types, for
  // `sharerManifest`'s reason: this fixture has to be able to build documents
  // the types would refuse, which is the whole point of the skip cases.
  const clone = JSON.parse(JSON.stringify(gmailManifest)) as {
    agent: { name: string };
    agent_dom: { connections: Array<Record<string, unknown>> };
  };
  clone.agent.name = SCOUT;
  clone.agent_dom.connections = clone.agent_dom.connections.filter(
    (one) => one["provider"] === GMAIL,
  );
  const gmail = clone.agent_dom.connections[0];
  if (gmail !== undefined) {
    gmail["id"] = "mail";
    if (over.ownership !== undefined) {
      gmail["ownership"] = over.ownership;
    }
    if (over.scopes !== undefined) {
      const fields = gmail["fields"] as Array<Record<string, unknown>>;
      const field = fields[0];
      if (field !== undefined) {
        field["technical"] = over.scopes === null ? {} : { provider_scopes: over.scopes };
      }
    }
  }
  return clone as unknown as ConnectionSourceManifest;
}

function vault(): Vault {
  return new Vault({
    directory: path.join(dataDir, "vault"),
    safeStorage: new FakeSafeStorage(),
    platform: "win32",
  });
}

function deps(
  store: Vault,
  manifests: Record<string, ConnectionSourceManifest> = {},
  oauth = scriptedOAuth(),
) {
  return {
    store,
    readManifest: (agentId: string) => manifests[agentId] ?? null,
    promptForSecret: () => Promise.resolve(null),
    oauth,
    ai: refusingAi(),
    listAgentIds: () => Object.keys(manifests),
  };
}

/** A fleet connect, as the dispatcher builds the target. */
const fleetTarget = (provider: string) => ({
  agent_id: FLEET_PRINCIPAL,
  connection_id: provider,
  field_id: "",
});

afterAll(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(async () => {
  const store = vault();
  await store.delete(fleetSecretName(GMAIL, "sign_in")).catch(() => undefined);
  await store.delete(connectionSecretName(SCOUT, "mail", "gmail-account")).catch(() => undefined);
  db().exec("DELETE FROM fleet_connections");
  db().exec("DELETE FROM fleet_grants");
  db().exec("DELETE FROM connection_secrets");
  db().exec("DELETE FROM broker_grants");
});

/* ---------------------------------------------------------------------- *
 * The catalogue
 * ---------------------------------------------------------------------- */

describe("what DASH can connect before any agent exists", () => {
  it("offers connectors with no agents imported at all", () => {
    // The whole issue in one assertion. This runs against a store with nothing
    // in it, which is precisely the DASH Henrik's step 1 produces.
    const catalogue = fleetCatalogue();
    expect(catalogue.length).toBeGreaterThan(0);
    expect(catalogue.map((one) => one.provider)).toContain(GMAIL);
    expect(catalogue.map((one) => one.provider)).toContain("openrouter");
  });

  it("draws a card for every connector, connected or not", () => {
    // The page's own claim, at the view layer, with an empty world: a connector
    // nobody has connected is not an empty state to filter out — it is the thing
    // a person came to the page to do.
    const views = fleetConnectorViews([]);
    expect(views.length).toBe(fleetCatalogue().length);
    expect(views.every((one) => one.held === null)).toBe(true);
    expect(views.every((one) => one.agents.length === 0)).toBe(true);
    // Null on an empty DASH: a disclosure about agents when there are none is a
    // warning about nobody, and those are the ones people learn to skip.
    expect(views.every((one) => one.reach_sentence === null)).toBe(true);
  });

  it("asks for no scope that no operation uses", () => {
    /*
     * The property ADR 0013 claims is true by construction rather than checked.
     * A fleet sign-in has no manifest, so DASH decides what to request — and the
     * answer is derived from `required_scopes` over its own operation table,
     * which makes it impossible to ask for something DASH then does nothing
     * with.
     */
    const connector = fleetConnectorFor(GMAIL);
    expect(connector?.oauth).not.toBeNull();

    const fromOperations = new Set(
      operationsForProvider(GMAIL).flatMap((operation) => [...operation.required_scopes]),
    );
    expect(new Set(connector?.oauth?.scopes ?? [])).toEqual(fromOperations);
  });

  it("asks for nothing the provider's own allowlist refuses", () => {
    // The drift assertion between two tables that are edited by different
    // issues: `lib/broker/operations.ts` says what an operation needs and
    // `lib/oauth/providers.ts` says what DASH is willing to request. This fails
    // the moment an operation is added on a scope nobody allowed.
    const connector = fleetConnectorFor(GMAIL);
    const flow = oauthProviderFor(GMAIL);
    expect(flow).not.toBeNull();
    expect(checkRequestedScopes(flow!, connector?.oauth?.scopes ?? [])).toEqual([]);
  });

  it("names a purpose on every connector", () => {
    // A blank card is a card a person cannot decide from. Derived from the
    // catalogue rather than written out, so a connector added without a sentence
    // fails here rather than shipping empty.
    for (const connector of fleetCatalogue()) {
      expect(connector.purpose.length).toBeGreaterThan(0);
    }
  });

  it("does not offer the loopback proof provider", () => {
    // `brokerProfileFor` resolves it when a DASH_-namespaced variable is set,
    // and a catalogue that included it would put a test fixture on a settings
    // page.
    process.env["DASH_BROKER_PROOF_ORIGIN"] = "http://127.0.0.1:59999";
    try {
      expect(fleetCatalogue().map((one) => one.provider)).not.toContain("dash-loopback-mail");
    } finally {
      delete process.env["DASH_BROKER_PROOF_ORIGIN"];
    }
  });

  it("keeps the fleet vault namespace unreachable from any agent's name", () => {
    /*
     * The lock, and it is structural rather than a check. `connectionSecretName`
     * always emits `dash.connection.`; `fleetSecretName` always emits
     * `dash.fleet.`. So no agent — including one contrived to be called
     * `dash.fleet` — resolves to the fleet credential's key.
     */
    const fleet = fleetSecretName(GMAIL, "sign_in");
    expect(fleet.startsWith("dash.fleet.")).toBe(true);
    for (const name of [FLEET_PRINCIPAL, "dash-fleet", "dash.fleet.google-gmail", "../fleet"]) {
      expect(connectionSecretName(name, GMAIL, "sign_in")).not.toBe(fleet);
      expect(connectionSecretName(name, GMAIL, "sign_in").startsWith("dash.connection.")).toBe(true);
    }
  });
});

/* ---------------------------------------------------------------------- *
 * Connecting with nothing imported, then importing
 * ---------------------------------------------------------------------- */

describe("configuring DASH before importing anything", () => {
  it("stores a sign-in with no agents present", async () => {
    const store = vault();
    const result = await performConnectionAction("connect", fleetTarget(GMAIL), deps(store));

    expect(result.ok).toBe(true);
    await expect(store.get(fleetSecretName(GMAIL, "sign_in"))).resolves.toContain(
      "1//refresh-token",
    );

    const row = readFleetConnection(GMAIL);
    expect(row?.provider).toBe(GMAIL);
    expect(row?.account_hint).toMatch(/••••@/u);
    // What the consent issued, not what DASH asked for.
    expect(row?.scopes.length).toBeGreaterThan(0);
  });

  it("puts no part of the token in the fleet row", async () => {
    const store = vault();
    await performConnectionAction("connect", fleetTarget(GMAIL), deps(store));
    const row = readFleetConnection(GMAIL);
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain("refresh-token-value");
    expect(serialized).not.toContain("henrik@example.com");
  });

  it("does not silently connect an agent imported afterwards", async () => {
    /*
     * ADR 0013's deliberate refinement of MAR-570. A consent given before a
     * piece of software existed is not a consent to that software, so the agent
     * is named as waiting and one button includes it — rather than DASH handing
     * a newly imported agent access to somebody's mailbox on its own.
     */
    const store = vault();
    await performConnectionAction("connect", fleetTarget(GMAIL), deps(store));

    const world = { [SCOUT]: scout() };
    const views = fleetConnectorViews([{ name: SCOUT, manifest: world[SCOUT] as ConnectionSourceManifest }]);
    const card = views.find((one) => one.provider === GMAIL);

    expect(card?.waiting).toEqual([SCOUT]);
    await expect(store.get(connectionSecretName(SCOUT, "mail", "gmail-account"))).rejects.toThrow();
  });

  it("gives it to the waiting agent on one press, without a second sign-in", async () => {
    const store = vault();
    const oauth = scriptedOAuth();
    await performConnectionAction("connect", fleetTarget(GMAIL), deps(store, {}, oauth));

    const world = { [SCOUT]: scout() };
    const shared = await performConnectionAction(
      "share",
      fleetTarget(GMAIL),
      deps(store, world, oauth),
    );

    expect(shared.ok).toBe(true);
    expect(shared.detail).toContain(SCOUT);
    // One authorize for the whole story. A share that opened a consent screen
    // would be teaching people to click through consent screens.
    expect(oauth.calls.filter((call) => call === "authorize")).toHaveLength(1);
    await expect(
      store.get(connectionSecretName(SCOUT, "mail", "gmail-account")),
    ).resolves.toContain("1//refresh-token");
  });

  it("resolves a grant indistinguishable from a direct connect", async () => {
    /*
     * **The load-bearing assertion of ADR 0013.** After materialization, the
     * broker's own path — the per-agent vault name it computes on every call,
     * and the three-party intersection it resolves from the agent's own manifest
     * — produces a real grant for an agent nobody signed in.
     *
     * Nothing here reaches into `lib/fleet/`: it is `connectionSecretName` and
     * `resolveGrant`, which is exactly what `lib/broker/execute.ts` runs.
     */
    const store = vault();
    const world = { [SCOUT]: scout() };
    await performConnectionAction("connect", fleetTarget(GMAIL), deps(store, world));

    const secretName = connectionSecretName(SCOUT, "mail", "gmail-account");
    const raw = await store.get(secretName);
    const credential = parseOAuthCredential(raw);
    expect(credential).not.toBeNull();

    const grant = resolveGrant(
      SCOUT,
      world[SCOUT] as ConnectionSourceManifest,
      "mail",
      credential,
      secretName,
    );
    expect(grant.ok).toBe(true);
    if (grant.ok) {
      expect(grant.grant.operations.length).toBeGreaterThan(0);
      expect(grant.grant.secret_name).toBe(secretName);
    }
    // And the receipt the person reads, resolved from that agent's own manifest.
    expect(listReceipts(SCOUT).length).toBeGreaterThan(0);
  });
});

/* ---------------------------------------------------------------------- *
 * Who a connection reaches, and who it does not
 * ---------------------------------------------------------------------- */

describe("which agents a fleet connection reaches", () => {
  const connector = () => fleetConnectorFor(GMAIL)!;

  it("reaches an agent that could have run the connect itself", () => {
    const reach = fleetReach(
      connector(),
      [{ agent_id: SCOUT, manifest: scout() }],
      new Set(),
    );
    expect(reach.materializes.map((one) => one.agent_id)).toEqual([SCOUT]);
    expect(reach.skipped).toEqual([]);
  });

  it("ignores an agent that never mentions the service", () => {
    // Not skipped and not reported: an agent that never named this provider is
    // not part of this connection's story, and listing it as "not connected"
    // would be the page inventing a gap.
    const other = JSON.parse(JSON.stringify(gmailManifest)) as {
      agent: { name: string };
      agent_dom: { connections: unknown[] };
    };
    other.agent.name = "ledger-reporter";
    other.agent_dom.connections = [];

    const reach = fleetReach(
      connector(),
      [{ agent_id: "ledger-reporter", manifest: other as unknown as ConnectionSourceManifest }],
      new Set(),
    );
    expect(reach.materializes).toEqual([]);
    expect(reach.skipped).toEqual([]);
  });

  it("skips an agent that holds its own credential, and says which", () => {
    const reach = fleetReach(
      connector(),
      [{ agent_id: SCOUT, manifest: scout({ ownership: "agent_managed" }) }],
      new Set(),
    );
    expect(reach.materializes).toEqual([]);
    expect(reach.skipped).toEqual([{ agent_id: SCOUT, reason: "not_dash_held" }]);
  });

  it("skips an agent whose manifest declares no permissions", () => {
    // The same refusal `resolveCredentialTarget` gives the direct path —
    // `oauth_scopes_not_declared` — reaching the fleet as a stated skip rather
    // than as a silent absence.
    const reach = fleetReach(
      connector(),
      [{ agent_id: SCOUT, manifest: scout({ scopes: null }) }],
      new Set(),
    );
    expect(reach.materializes).toEqual([]);
    expect(reach.skipped).toEqual([{ agent_id: SCOUT, reason: "does_not_qualify" }]);
  });

  it("skips an agent somebody revoked, and connecting again does not undo it", async () => {
    /*
     * The reason `fleet_grants` exists. Without it, a `share` or a re-key would
     * put back access somebody deliberately took away — the failure
     * `CredentialState.revoked` guards one level down.
     */
    const store = vault();
    const world = { [SCOUT]: scout() };
    await performConnectionAction("connect", fleetTarget(GMAIL), deps(store, world));

    // The person disconnects that one agent, through the button its own row has
    // always had.
    const off = await performConnectionAction(
      "disconnect",
      { agent_id: SCOUT, connection_id: "mail", field_id: "gmail-account" },
      deps(store, world),
    );
    expect(off.ok).toBe(true);
    expect(withheldAgents(GMAIL).has(SCOUT)).toBe(true);

    // And a later share leaves it alone.
    const shared = await performConnectionAction("share", fleetTarget(GMAIL), deps(store, world));
    expect(shared.ok).toBe(true);
    expect(shared.detail).not.toContain(SCOUT);
    await expect(store.get(connectionSecretName(SCOUT, "mail", "gmail-account"))).rejects.toThrow();
  });

  it("gives it back when the person presses Connect on that agent again", async () => {
    // Restoring is the button the agent's own row already had. It reuses the
    // consent DASH holds rather than opening a second consent screen.
    const store = vault();
    const oauth = scriptedOAuth();
    const world = { [SCOUT]: scout() };
    await performConnectionAction("connect", fleetTarget(GMAIL), deps(store, world, oauth));
    await performConnectionAction(
      "disconnect",
      { agent_id: SCOUT, connection_id: "mail", field_id: "gmail-account" },
      deps(store, world, oauth),
    );

    const back = await performConnectionAction(
      "connect",
      { agent_id: SCOUT, connection_id: "mail", field_id: "gmail-account" },
      deps(store, world, oauth),
    );

    expect(back.ok).toBe(true);
    expect(withheldAgents(GMAIL).has(SCOUT)).toBe(false);
    expect(oauth.calls.filter((call) => call === "authorize")).toHaveLength(1);
    await expect(
      store.get(connectionSecretName(SCOUT, "mail", "gmail-account")),
    ).resolves.toContain("1//refresh-token");
  });
});

/* ---------------------------------------------------------------------- *
 * Revoking everywhere
 * ---------------------------------------------------------------------- */

describe("disconnecting a fleet connection", () => {
  it("takes it away from every agent it reached", async () => {
    const store = vault();
    const world = { [SCOUT]: scout() };
    await performConnectionAction("connect", fleetTarget(GMAIL), deps(store, world));

    const result = await performConnectionAction(
      "disconnect",
      fleetTarget(GMAIL),
      deps(store, world),
    );

    expect(result.ok).toBe(true);
    await expect(store.get(fleetSecretName(GMAIL, "sign_in"))).rejects.toThrow();
    await expect(store.get(connectionSecretName(SCOUT, "mail", "gmail-account"))).rejects.toThrow();
    expect(readFleetConnection(GMAIL)).toBeNull();
    expect(listReceipts(SCOUT)).toEqual([]);
    expect(listSecretReferences(SCOUT)).toEqual([]);
  });

  it("says that it reached further than this card", async () => {
    const store = vault();
    const world = { [SCOUT]: scout() };
    await performConnectionAction("connect", fleetTarget(GMAIL), deps(store, world));
    const result = await performConnectionAction(
      "disconnect",
      fleetTarget(GMAIL),
      deps(store, world),
    );
    expect(result.detail).toContain("everywhere");
  });
});

/* ---------------------------------------------------------------------- *
 * The store
 * ---------------------------------------------------------------------- */

describe("the fleet tables", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    provider: GMAIL,
    connector_kind: "google_oauth_broker" as const,
    field_id: "sign_in",
    secret_name: fleetSecretName(GMAIL, "sign_in"),
    masked_hint: "••••abcd",
    account_hint: "he••••@example.com",
    scopes: ["openid"],
    backend: "fake",
    ...over,
  });

  it("keeps the date the person first connected, across a re-key", () => {
    // `recordReceipt`'s rule: the date a person first approved this is the one
    // number they would use to notice access they no longer remember giving.
    recordFleetConnection(row(), "2026-08-01T00:00:00.000Z");
    recordFleetConnection(row({ masked_hint: "••••9999" }), "2026-08-10T00:00:00.000Z");

    const stored = readFleetConnection(GMAIL);
    expect(stored?.connected_at).toBe("2026-08-01T00:00:00.000Z");
    expect(stored?.updated_at).toBe("2026-08-10T00:00:00.000Z");
    expect(stored?.masked_hint).toBe("••••9999");
    expect(listFleetConnections()).toHaveLength(1);
  });

  it("refuses a hint that is not masked", () => {
    // The gate a raw credential cannot pass. Not echoed into the message, for
    // `recordSecretReference`'s reason.
    expect(() => {
      recordFleetConnection(row({ masked_hint: "sk-live-abcdef123456" }), "2026-08-10T00:00:00.000Z");
    }).toThrow(/masked/u);
  });

  it("treats a standing it cannot read as withheld", () => {
    // The safe direction: the alternative is materializing a credential against
    // a decision DASH could not interpret.
    recordFleetConnection(row(), "2026-08-10T00:00:00.000Z");
    db()
      .prepare("INSERT INTO fleet_grants (provider, agent, standing, decided_at) VALUES (?, ?, ?, ?)")
      .run(GMAIL, SCOUT, "something-a-later-build-wrote", "2026-08-10T00:00:00.000Z");
    expect(withheldAgents(GMAIL).has(SCOUT)).toBe(true);
  });

  it("clears the decisions when the connection they were about is gone", async () => {
    const store = vault();
    recordFleetConnection(row(), "2026-08-10T00:00:00.000Z");
    recordFleetGrant(GMAIL, SCOUT, "withheld", "2026-08-10T00:00:00.000Z");

    await performConnectionAction("disconnect", fleetTarget(GMAIL), deps(store));
    expect(withheldAgents(GMAIL).size).toBe(0);
  });
});
