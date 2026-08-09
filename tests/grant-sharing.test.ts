/**
 * One consent, every agent that needs it (MAR-570).
 *
 * Henrik's ruling: *"connecting Gmail once lights up both agents that need
 * it."* Before this, a grant was keyed `dash.connection.{agent}.{connection}.
 * {field}` and stopped at the agent it was made for, so two agents needing Gmail
 * meant two trips through Google's consent screen. The connector tile now says
 * one sign-in serves both, and this file is what makes that sentence true rather
 * than merely printed.
 *
 * Written against a real vault over a fake `safeStorage`, like
 * `tests/connection-actions.test.ts` and for its reason: the questions are
 * "which vault keys exist afterwards" and "what did each agent's receipt say",
 * and a mocked store answers neither.
 *
 * ## What the assertions are guarding
 *
 * The fan-out is the one place in DASH where pressing a button changes something
 * for an agent the person is not looking at. So the tests that matter most are
 * the refusals: an agent that could not have run this sign-in itself must not
 * receive it, a typed secret must never travel, and the granting agent's own
 * connect must survive a fan-out that fails.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { ConnectionSourceManifest } from "../lib/connections";
import { Vault } from "../lib/vault";
import { FakeSafeStorage } from "./fakes/fake-safe-storage";
import { oauthCredential, scriptedOAuth } from "./fakes/oauth-operations";
// Throws on contact. Nothing in this file drives a model-provider key, so the
// AI path being unreachable from the fan-out is a thing the suite fails on
// rather than a thing a reader checks (MAR-582's own argument for this fake).
import { refusingAi } from "./fakes/ai-operations";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const dataDir = mkdtempSync(path.join(tmpdir(), "dash-grant-sharing-"));
process.env.DASH_DATA_DIR = dataDir;

const { performConnectionAction, findGrantSharers } = await import("../lib/connection-actions");
const { connectionSecretName } = await import("../lib/connection-credentials");
const { closeDb } = await import("../lib/db");
const { listSecretReferences } = await import("../lib/secret-refs");
const { listReceipts } = await import("../lib/broker/store");

const GRANTING = "synthetic-gmail-meeting-assistant";
const SHARER = "news-scout";
const OUTSIDER = "ledger-reporter";

const TARGET = { agent_id: GRANTING, connection_id: "gmail", field_id: "gmail-account" };

function example(name: string): ConnectionSourceManifest {
  return JSON.parse(
    readFileSync(path.join(repoRoot, "examples", name), "utf8"),
  ) as ConnectionSourceManifest;
}

const gmailManifest = example("gmail-meeting-assistant.manifest.v2.example.json");
const secretManifest = example("dash-managed-secret.manifest.v2.example.json");

/**
 * A second agent that needs Gmail, with its own id for the connection.
 *
 * Deliberately **not** the same `connection_id`: the sharing key is the
 * provider, and an author who called it `mail` must share with one who called it
 * `gmail`. A fixture that reused the id would pass whether or not that rule
 * held.
 */
function sharerManifest(
  over: { scopes?: string[]; ownership?: string } = {},
): ConnectionSourceManifest {
  // Walked as plain JSON rather than through the manifest types: the point of
  // this fixture is to build documents the types would not let you write, and a
  // typed clone would refuse the invalid-ownership case this file needs.
  const clone = JSON.parse(JSON.stringify(gmailManifest)) as {
    agent: { name: string };
    agent_dom: { connections: Array<Record<string, unknown>> };
  };
  clone.agent.name = SHARER;
  clone.agent_dom.connections = clone.agent_dom.connections.filter(
    (one) => one["provider"] === "google-gmail",
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
        field["technical"] = { provider_scopes: over.scopes };
      }
    }
  }
  return clone as unknown as ConnectionSourceManifest;
}

/** Every agent DASH has imported, as main supplies them by name. */
type World = Record<string, ConnectionSourceManifest>;

function vault(): Vault {
  return new Vault({
    directory: path.join(dataDir, "vault"),
    safeStorage: new FakeSafeStorage(),
    platform: "win32",
  });
}

/** Every agent in this world, by name, the way main supplies them. */
function deps(
  store: Vault,
  manifests: World,
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

const BOTH = (): World => ({
  [GRANTING]: gmailManifest,
  [SHARER]: sharerManifest(),
});

afterAll(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(async () => {
  const store = vault();
  for (const [agent, connection, field] of [
    [GRANTING, "gmail", "gmail-account"],
    [SHARER, "mail", "gmail-account"],
  ] as const) {
    await store.delete(connectionSecretName(agent, connection, field)).catch(() => undefined);
  }
});

/* ---------------------------------------------------------------------- *
 * The fan-out
 * ---------------------------------------------------------------------- */

describe("connecting once", () => {
  it("writes the grant to every agent that needs the same service", async () => {
    /*
     * The issue's headline claim, asserted on the vault rather than on a
     * sentence: both agents have a credential afterwards, each under its own
     * key, from one authorize call.
     */
    const store = vault();
    const oauth = scriptedOAuth();
    const result = await performConnectionAction("connect", TARGET, deps(store, BOTH(), oauth));

    expect(result.ok).toBe(true);
    expect(oauth.calls.filter((call) => call === "authorize")).toHaveLength(1);

    await expect(
      store.get(connectionSecretName(GRANTING, "gmail", "gmail-account")),
    ).resolves.toContain("1//refresh-token");
    await expect(
      store.get(connectionSecretName(SHARER, "mail", "gmail-account")),
    ).resolves.toContain("1//refresh-token");
  });

  it("keys the sharing on the provider, not on the connection id", async () => {
    // The sharer calls it `mail` and the granting agent calls it `gmail`. If
    // this passed on ids it would not be sharing, it would be a coincidence.
    const store = vault();
    await performConnectionAction("connect", TARGET, deps(store, BOTH()));
    expect(listSecretReferences(SHARER).map((one) => one.connection_id)).toEqual(["mail"]);
  });

  it("gives the shared agent its own receipt, resolved from its own manifest", async () => {
    /*
     * The property that keeps this out of broker semantics: what the broker
     * later resolves for a shared agent is indistinguishable from a grant it
     * received directly, because it *is* one.
     */
    const store = vault();
    await performConnectionAction("connect", TARGET, deps(store, BOTH()));
    expect(listReceipts(SHARER).length).toBeGreaterThan(0);
  });

  it("says who else was connected, rather than leaving it to be discovered", async () => {
    // A person who pressed one button and silently granted a second agent
    // access would have learned it from a receipt later.
    const store = vault();
    const result = await performConnectionAction("connect", TARGET, deps(store, BOTH()));
    expect(result.detail).toContain(SHARER);
  });

  it("says nothing about sharing when nothing was shared", async () => {
    const store = vault();
    const result = await performConnectionAction(
      "connect",
      TARGET,
      deps(store, { [GRANTING]: gmailManifest }),
    );
    expect(result.ok).toBe(true);
    expect(result.detail).not.toContain("and for");
  });
});

/* ---------------------------------------------------------------------- *
 * The refusals — the half that matters most
 * ---------------------------------------------------------------------- */

describe("who does not receive a shared grant", () => {
  const granted = oauthCredential();

  it("never the granting agent itself", () => {
    // It has already been written by the caller, and a second write would
    // re-record its receipt.
    const sharers = findGrantSharers("google-gmail", TARGET, granted, {
      readManifest: (id: string) => BOTH()[id] ?? null,
      listAgentIds: () => Object.keys(BOTH()),
    });
    expect(sharers.map((one) => one.agent_id)).toEqual([SHARER]);
  });

  it("never an agent naming a different service", () => {
    const world: World = { ...BOTH(), [OUTSIDER]: secretManifest };
    const sharers = findGrantSharers("google-gmail", TARGET, granted, {
      readManifest: (id: string) => world[id] ?? null,
      listAgentIds: () => Object.keys(world),
    });
    expect(sharers.map((one) => one.agent_id)).not.toContain(OUTSIDER);
  });

  it("never an agent whose own manifest DASH would have refused", () => {
    /*
     * The load-bearing refusal. `resolveCredentialTarget` is the same gate the
     * direct path uses, so a sharer is an agent that would have been allowed to
     * run this exact sign-in itself. Here the second agent asks for a scope DASH
     * does not offer — pressing Connect on its own row would be refused, and a
     * grant made for somebody else must not appear on its behalf either.
     */
    const world: World = {
      [GRANTING]: gmailManifest,
      [SHARER]: sharerManifest({ scopes: ["https://www.googleapis.com/auth/drive"] }),
    };
    const sharers = findGrantSharers("google-gmail", TARGET, granted, {
      readManifest: (id: string) => world[id] ?? null,
      listAgentIds: () => Object.keys(world),
    });
    expect(sharers).toEqual([]);
  });

  it("never an agent that keeps its own sign-in", () => {
    // `agent_managed` ownership means DASH does not hold this at all, so there
    // is nothing to write and nothing that would be read back.
    const world: World = {
      [GRANTING]: gmailManifest,
      [SHARER]: sharerManifest({ ownership: "agent_managed" }),
    };
    const sharers = findGrantSharers("google-gmail", TARGET, granted, {
      readManifest: (id: string) => world[id] ?? null,
      listAgentIds: () => Object.keys(world),
    });
    expect(sharers).toEqual([]);
  });

  it("nobody at all when the host supplies no agent list", () => {
    /*
     * The optional dependency's absence means no fan-out rather than an error:
     * a caller built before this feature connects exactly the agent it named,
     * which is narrower and never wrong.
     */
    const sharers = findGrantSharers("google-gmail", TARGET, granted, {
      readManifest: (id: string) => BOTH()[id] ?? null,
    });
    expect(sharers).toEqual([]);
  });

  it("records each agent's own shortfall rather than the granting agent's", () => {
    /*
     * Two agents naming one provider can ask for different things. A fan-out
     * that assumed otherwise would report a connection as complete for an agent
     * whose actions the consent never covered — and `not_issued` is exactly the
     * state MAR-533 built for that.
     */
    const world: World = {
      [GRANTING]: gmailManifest,
      [SHARER]: sharerManifest({
        scopes: [
          "https://www.googleapis.com/auth/gmail.readonly",
          "https://www.googleapis.com/auth/gmail.compose",
        ],
      }),
    };
    const narrow = oauthCredential({
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    });
    const sharers = findGrantSharers("google-gmail", TARGET, narrow, {
      readManifest: (id: string) => world[id] ?? null,
      listAgentIds: () => Object.keys(world),
    });
    expect(sharers[0]?.missing).toEqual([
      "https://www.googleapis.com/auth/gmail.compose",
    ]);
  });
});

/* ---------------------------------------------------------------------- *
 * What a typed secret does, which is nothing
 * ---------------------------------------------------------------------- */

describe("a typed secret", () => {
  it("is never fanned out to another agent", async () => {
    /*
     * A key is a value a person handed DASH for a named agent, with no consent
     * screen and no scopes. Copying it elsewhere would be DASH redistributing
     * something given for one purpose — and `describeSharedGrant` promises
     * exactly this much and no more.
     */
    const store = vault();
    const secretTarget = {
      agent_id: OUTSIDER,
      connection_id: "ledger",
      field_id: "api-key",
    };
    const world: World = { [OUTSIDER]: secretManifest, [GRANTING]: gmailManifest };
    const result = await performConnectionAction("connect", secretTarget, {
      store,
      readManifest: (id: string) => world[id] ?? null,
      promptForSecret: () => Promise.resolve("sk-ledger-value"),
      oauth: scriptedOAuth(),
      ai: refusingAi(),
      listAgentIds: () => Object.keys(world),
    });

    expect(result.ok).toBe(true);
    /*
     * Asserted as "this connection reached nobody else" rather than "those
     * agents hold nothing": earlier tests in this file connected them through
     * the OAuth path on purpose, and a fixture that demanded an empty world
     * would be testing the order of the file rather than the rule.
     */
    const strayed = [GRANTING, SHARER]
      .flatMap((other) => listSecretReferences(other))
      .filter((reference) => reference.connection_id === "ledger");
    expect(strayed).toEqual([]);
    expect(result.detail).not.toContain(GRANTING);
  });
});
