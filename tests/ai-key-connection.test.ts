/**
 * Connecting, checking and disconnecting a model provider's key (MAR-582).
 *
 * Written against a real SQLite store and a real `Vault` over a fake
 * `safeStorage`, for `tests/connection-actions.test.ts`'s reason: the questions
 * are "where did the plaintext end up", "what does the row say", and "what got
 * deleted", and a mocked store answers none of them.
 *
 * The prompt and the provider are the two injected parts, because the real ones
 * open a window and make an HTTPS request. Everything between them is real.
 *
 * The manifest fixtures are built here rather than added to `examples/`, and
 * that is deliberate: `examples/` is what DASH ships to agent authors as a model
 * to copy, and shipping one that connects a model provider would advertise a
 * capability whose only operation is a list of models. The one that asks for
 * delivery would be worse — a sample asking for exactly what this issue refuses.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { ConnectionSourceManifest } from "../lib/connections";
import { Vault } from "../lib/vault";
import { FakeSafeStorage } from "./fakes/fake-safe-storage";
import { refusingOAuth } from "./fakes/oauth-operations";
import { scriptedAi } from "./fakes/ai-operations";
import { expectPlainLanguage } from "./helpers/plain-language";

/*
 * The compile-time pin `lib/ai/actions.ts` names in `AiKeyActionResult`'s
 * docblock. That type restates the result shape structurally rather than
 * importing it, because `lib/connection-actions.ts` imports that module and the
 * other direction would be a cycle. This assignment is what would stop
 * compiling if the two ever drifted.
 */
import type { AiKeyActionResult } from "../lib/ai/actions";
import type { ConnectionActionResult } from "../lib/connection-actions";
const _shapesAgree: (result: AiKeyActionResult) => ConnectionActionResult = (result) => result;
void _shapesAgree;

const dataDir = mkdtempSync(path.join(tmpdir(), "dash-ai-key-"));
process.env.DASH_DATA_DIR = dataDir;

const { performConnectionAction } = await import("../lib/connection-actions");
const { connectionSecretName, resolveCredentialTarget, deliverableSecretFields, connectableFields } =
  await import("../lib/connection-credentials");
const { closeDb } = await import("../lib/db");
const { listSecretReferences } = await import("../lib/secret-refs");
const { readLivenessCheck } = await import("../lib/ai/store");
const { aiKeyConnections } = await import("../lib/ai/connection-view");
const { listReceipts } = await import("../lib/broker/store");
const { everyLivenessSentence } = await import("../lib/ai/liveness");
const { readStoreBytes } = await import("./helpers/store-bytes");

/** Distinctive: if this appears anywhere, it got there from this test. */
const KEY = "sk-or-v1-7f3Qd2LmZpX9RtVbNwEy";

const AGENT = "digest-writer";
const TARGET = { agent_id: AGENT, connection_id: "models", field_id: "key" };

/**
 * A manifest declaring one model-provider key, the way an author would.
 *
 * Note what it does *not* declare: `technical.environment_name`. That absence is
 * the whole shape of the connection — DASH holds the key and reaches the
 * provider itself — and the fixture below is the one that gets it wrong.
 */
function keyManifest(
  overrides: { provider?: string; environment_name?: string; required?: boolean } = {},
): ConnectionSourceManifest {
  return {
    agent_dom: {
      connections: [
        {
          id: "models",
          provider: overrides.provider ?? "openrouter",
          label: "Your model provider",
          purpose: "Write the digest",
          ownership: "dash_managed",
          capabilities: [{ id: "model.completion", label: "Write text", access: "write" }],
          fields: [
            {
              id: "key",
              label: "API key",
              purpose: "So DASH can reach the provider for this agent",
              kind: "secret",
              required: overrides.required ?? true,
              ...(overrides.environment_name === undefined
                ? {}
                : { technical: { environment_name: overrides.environment_name } }),
            },
          ],
          validation_action: { id: "check", label: "Check", behavior: "test" },
        },
      ],
    },
  };
}

const manifest = keyManifest();

function vault(): Vault {
  return new Vault({
    directory: path.join(dataDir, "vault"),
    safeStorage: new FakeSafeStorage(),
    platform: "win32",
  });
}

function deps(
  store: Vault,
  answer: string | null,
  ai = scriptedAi(),
  source: ConnectionSourceManifest = manifest,
) {
  return {
    store,
    readManifest: () => source,
    promptForSecret: () => Promise.resolve(answer),
    // A model key is not a sign-in, so nothing here may run a browser flow.
    oauth: refusingOAuth(),
    ai,
  };
}

afterAll(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await performConnectionAction("disconnect", TARGET, deps(vault(), null));
});

/* ---------------------------------------------------------------------- *
 * The target
 * ---------------------------------------------------------------------- */

describe("resolving the target", () => {
  it("recognises a declared secret field for a provider DASH is a client for", () => {
    const resolved = resolveCredentialTarget(AGENT, manifest, "models", "key");
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      return;
    }
    expect(resolved.target.kind).toBe("provider_key");
    expect(resolved.target.ai_provider_id).toBe("openrouter");
    expect(resolved.target.environment_name).toBeNull();
  });

  it("stays an ordinary typed secret for a provider DASH is not a client for", () => {
    // The path this issue did not touch, asserted from inside. A key for a
    // service DASH has no client for is still delivered, still uncheckable, and
    // still exactly what it was before MAR-582.
    const other = keyManifest({ provider: "some-ledger", environment_name: "LEDGER_KEY" });
    const resolved = resolveCredentialTarget(AGENT, other, "models", "key");
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      return;
    }
    expect(resolved.target.kind).toBe("secret");
    expect(resolved.target.ai_provider_id).toBeNull();
    expect(deliverableSecretFields(AGENT, other)).toHaveLength(1);
  });

  it("refuses a manifest that asks DASH to hand a model key to the agent", () => {
    const greedy = keyManifest({ environment_name: "OPENROUTER_API_KEY" });
    const resolved = resolveCredentialTarget(AGENT, greedy, "models", "key");
    expect(resolved).toMatchObject({ ok: false, refusal: "brokered_provider_delivery" });
    // And it therefore reaches neither list a spawn iterates. The refusal is
    // structural rather than a filter somebody has to remember.
    expect(connectableFields(AGENT, greedy)).toEqual([]);
    expect(deliverableSecretFields(AGENT, greedy)).toEqual([]);
  });

  it("explains that refusal to the person looking at the row", async () => {
    const greedy = keyManifest({ environment_name: "OPENROUTER_API_KEY" });
    const result = await performConnectionAction(
      "connect",
      TARGET,
      deps(vault(), KEY, scriptedAi(), greedy),
    );
    expect(result.ok).toBe(false);
    expect(result.state).toBe("not_held_by_dash");
    expect(result.detail).toContain("will not hand this one to the agent");
    expect(result.recovery?.actor).toBe("dash");
    expectPlainLanguage([result.detail, result.recovery?.meaning ?? ""]);
  });

  it("brokers nothing for a connection declaring two keys", () => {
    // The same refusal `brokeredCredentialField` gives a connection with two
    // sign-in fields, and for the same reason: which of them a credential
    // belongs to would be DASH's choice, and one filed against the wrong field
    // is one a disconnect would not delete. The card draws with no capabilities
    // rather than guessing.
    const two = keyManifest();
    const connection = two.agent_dom!.connections![0]!;
    connection.fields = [
      ...connection.fields,
      {
        id: "spare",
        label: "Another key",
        purpose: "Unexplained",
        kind: "secret",
        required: true,
      },
    ];
    expect(aiKeyConnections(AGENT, two).map((card) => card.capabilities)).toEqual([[], []]);
  });
});

/* ---------------------------------------------------------------------- *
 * Connect
 * ---------------------------------------------------------------------- */

describe("connect", () => {
  it("puts the key in the vault and only a masked hint in the store", async () => {
    const store = vault();
    const result = await performConnectionAction("connect", TARGET, deps(store, KEY));

    expect(result.state).toBe("connected");
    expect(result.masked_hint).toBe("••••NwEy");

    const stored = JSON.parse(await store.get(connectionSecretName(AGENT, "models", "key"))) as {
      key: string;
      provider: string;
    };
    expect(stored.key).toBe(KEY);
    expect(stored.provider).toBe("openrouter");

    const rows = listSecretReferences(AGENT);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.masked_hint).toBe("••••NwEy");

    // The store file itself, byte for byte. A masked hint is a hint; a key in
    // a database is a key.
    expect(readStoreBytes(dataDir)).not.toContain(KEY);
  });

  it("asks the provider straight away, and gives the key to nothing else", async () => {
    const ai = scriptedAi({ status: 200, model_count: 312 });
    const result = await performConnectionAction("connect", TARGET, deps(vault(), KEY, ai));

    expect(ai.probed).toEqual(["openrouter"]);
    expect(ai.keys).toEqual([KEY]);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("never gives it to the agent");
    expect(result.detail).toContain("accepted this key when DASH last checked");
    // Nothing the caller can read carries the key.
    expect(JSON.stringify(result)).not.toContain(KEY);

    const record = readLivenessCheck(AGENT, "models");
    expect(record.state).toBe("live");
    expect(record.model_count).toBe(312);
    expect(record.checked_at).not.toBeNull();
  });

  it("keeps a key the provider refused, and says a person has to replace it", async () => {
    const store = vault();
    const result = await performConnectionAction(
      "connect",
      TARGET,
      deps(store, KEY, scriptedAi({ status: 401, model_count: null })),
    );

    // Stored anyway: the user pasted something real and throwing it away would
    // make them paste it again to read the same sentence.
    await expect(store.get(connectionSecretName(AGENT, "models", "key"))).resolves.toContain(KEY);
    expect(result.ok).toBe(false);
    expect(result.state).toBe("revoked");
    expect(result.recovery?.actor).toBe("user");
    expect(readLivenessCheck(AGENT, "models").state).toBe("key_refused");
  });

  it("does not blame the key when it could not ask", async () => {
    const result = await performConnectionAction(
      "connect",
      TARGET,
      deps(vault(), KEY, scriptedAi({ status: null, model_count: null })),
    );
    // The offline-on-a-train case. `connected` is the truth about what DASH
    // holds; `unreachable` is the truth about what it knows.
    expect(result.state).toBe("connected");
    expect(result.recovery?.actor).toBe("elsewhere");
    expect(readLivenessCheck(AGENT, "models").state).toBe("unreachable");
  });

  it("treats being asked to slow down as the provider's problem, not the key's", async () => {
    await performConnectionAction(
      "connect",
      TARGET,
      deps(vault(), KEY, scriptedAi({ status: 429, model_count: null })),
    );
    expect(readLivenessCheck(AGENT, "models").state).toBe("provider_error");
  });

  it("writes a receipt listing exactly what the agent may do", async () => {
    await performConnectionAction("connect", TARGET, deps(vault(), KEY));
    const receipts = listReceipts(AGENT);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.operations).toEqual(["openrouter.models.list"]);
    // A key names nobody, so there is no account hint to invent from it.
    expect(receipts[0]?.account_hint).toBeNull();
  });

  it("changes nothing when the person cancels", async () => {
    const ai = scriptedAi();
    const result = await performConnectionAction("connect", TARGET, deps(vault(), null, ai));
    expect(result.detail).toBe("No change was made.");
    expect(ai.probed).toEqual([]);
    expect(listSecretReferences(AGENT)).toEqual([]);
  });
});

/* ---------------------------------------------------------------------- *
 * Check
 * ---------------------------------------------------------------------- */

describe("check", () => {
  it("asks the provider with the stored key and records what it said", async () => {
    await performConnectionAction("connect", TARGET, deps(vault(), KEY));

    const ai = scriptedAi({ status: 200, model_count: 7 });
    const result = await performConnectionAction("test", TARGET, deps(vault(), null, ai));

    expect(ai.keys).toEqual([KEY]);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("accepted this key when DASH last checked");
    expect(readLivenessCheck(AGENT, "models")).toMatchObject({ state: "live", model_count: 7 });
  });

  it("refuses a sign-in envelope left under the same name", async () => {
    // The confusion `lib/ai/credential.ts` exists to prevent, driven from the
    // outside: a value that is not a key envelope is never presented as one, so
    // a refresh token cannot be sent to a model provider as a bearer credential.
    const store = vault();
    await store.set(
      connectionSecretName(AGENT, "models", "key"),
      JSON.stringify({
        version: 1,
        provider: "google",
        refresh_token: "1//not-a-model-key",
        scopes: [],
        account: null,
        obtained_at: "2026-08-09T09:00:00.000Z",
      }),
    );

    const ai = scriptedAi();
    const result = await performConnectionAction("test", TARGET, deps(store, null, ai));

    expect(ai.probed).toEqual([]);
    expect(result.state).toBe("not_connected");
    expect(result.detail).toContain("no usable");
  });

  it("says the vault is shut rather than that the key is bad", async () => {
    const result = await performConnectionAction("test", TARGET, deps(vault(), null));
    // Nothing stored yet: `not_found` is a state, not a verdict on a key.
    expect(result.state).toBe("not_connected");
  });
});

/* ---------------------------------------------------------------------- *
 * Disconnect
 * ---------------------------------------------------------------------- */

describe("disconnect", () => {
  it("deletes the key, the row, the receipt and the observation", async () => {
    const store = vault();
    await performConnectionAction("connect", TARGET, deps(store, KEY));
    expect(listReceipts(AGENT)).toHaveLength(1);

    const result = await performConnectionAction("disconnect", TARGET, deps(store, null));

    expect(result.ok).toBe(true);
    await expect(store.get(connectionSecretName(AGENT, "models", "key"))).rejects.toThrow();
    expect(listSecretReferences(AGENT)).toEqual([]);
    expect(listReceipts(AGENT)).toEqual([]);
    // The verdict goes with the credential it was about, so the next key
    // connected here does not inherit the previous one's answer.
    expect(readLivenessCheck(AGENT, "models").state).toBe("not_checked");
  });

  it("does not claim the key is gone from the provider", async () => {
    const store = vault();
    await performConnectionAction("connect", TARGET, deps(store, KEY));
    const result = await performConnectionAction("disconnect", TARGET, deps(store, null));

    expect(result.detail).toContain("still exists in your OpenRouter account");
    expect(result.detail).toContain("DASH cannot remove it for you");
  });
});

/* ---------------------------------------------------------------------- *
 * The card
 * ---------------------------------------------------------------------- */

describe("the view the Connections page consumes", () => {
  it("starts not-checked, and says so rather than nothing", async () => {
    const [card] = aiKeyConnections(AGENT, manifest);
    expect(card?.held).toBe(false);
    expect(card?.liveness.state).toBe("not_checked");
    expect(card?.liveness.checked_at).toBeNull();
    expect(card?.liveness.headline).toContain("has not checked this key");
    expect(card?.provider_label).toBe("OpenRouter");
    expect(card?.capabilities.map((one) => one.id)).toEqual(["openrouter.models.list"]);
    expect(card?.connect.channel).toBe("connection.connect");
    expect(card?.check.channel).toBe("connection.test");
    expect(card?.disconnect.channel).toBe("connection.disconnect");
  });

  it("carries the observation and its date once a check has happened", async () => {
    await performConnectionAction(
      "connect",
      TARGET,
      deps(vault(), KEY, scriptedAi({ status: 200, model_count: 4 })),
    );
    const [card] = aiKeyConnections(AGENT, manifest);
    expect(card?.held).toBe(true);
    expect(card?.masked_hint).toBe("••••NwEy");
    expect(card?.liveness).toMatchObject({ state: "live", model_count: 4 });
    expect(card?.liveness.checked_at).not.toBeNull();
    // Every claim carries when it was observed, inside the sentence.
    expect(card?.liveness.detail).toContain("2026");
  });

  it("never carries the key, in any field", async () => {
    await performConnectionAction("connect", TARGET, deps(vault(), KEY));
    expect(JSON.stringify(aiKeyConnections(AGENT, manifest))).not.toContain(KEY);
    expect(JSON.stringify(aiKeyConnections(AGENT, manifest))).not.toContain("sk-or");
  });

  it("draws nothing for a provider DASH is not a client for", () => {
    expect(aiKeyConnections(AGENT, keyManifest({ provider: "some-ledger" }))).toEqual([]);
  });

  it("says everything on it in plain language", () => {
    const [card] = aiKeyConnections(AGENT, manifest);
    expectPlainLanguage(
      [
        card?.custody_sentence ?? "",
        card?.narrowing_sentence ?? "",
        card?.key_source ?? "",
        card?.liveness.headline ?? "",
        card?.liveness.detail ?? "",
        card?.liveness.next_action ?? "",
        ...(card?.capabilities.map((one) => one.label) ?? []),
        ...everyLivenessSentence(),
      ],
      // The author's own words for the connection, which `docs/design-brief.md`
      // treats as content rather than as DASH's vocabulary.
      { allow: [card?.service ?? "", card?.purpose ?? ""] },
    );
  });
});
