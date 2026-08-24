/**
 * The key the runner spends is the key the vault holds (MAR-745).
 *
 * ## What was missing, and it is the reason this file exists
 *
 * MAR-743's tests proved that a planted key never **leaks** — not into a log,
 * not into a Discord message, not into a spooled turn. Nothing proved that a
 * delivered key **works**, and the difference cost an attended session: on
 * 2026-08-24 the chief answered from the window on a vault row and was refused
 * `revoked` from Discord on the same row, minutes apart, because
 * `resolveChiefModel` handed the runner the stored `AiKeyCredential` **envelope**
 * — a JSON document — in the `api_key` slot. Every existing test started
 * *after* the push, calling `configure()` with a key a test author had typed, so
 * the one step that was wrong was the one step no test performed.
 *
 * So this file starts at the vault and does not stop until a header is on the
 * wire. Four things are real and in series: `buildChiefBridgeConfiguration`
 * reading a `SecureStore`, the runner's own `POST /chief/discord` over the
 * transport the product binds, the production `RunnerChief`, and the production
 * `runner/chief-broker.ts`. The two substitutions are `tests/chief-runner.test.ts`'
 * two — the websocket and `fetch` — and `fetch` is here to be **read**: the
 * assertion is on the exact `authorization` header, which is the byte-level
 * claim the issue asked for.
 *
 * ## No real key, and no key in any failure message
 *
 * `PLANTED_KEY` is nonsense with `PLANTED` written through it, so a fixture that
 * escaped into a log would be recognisable as a test's and not somebody's. The
 * assertions compare against constants this file built, and the one negative
 * assertion — "the header is not the stored document" — is written as a shape
 * check rather than as an inequality that would print both values on failure.
 */

import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IPC_ORIGIN, ipcFetch } from "../lib/agent-dom/ipc-fetch";
import {
  AI_KEY_CREDENTIAL_KIND,
  AI_KEY_CREDENTIAL_VERSION,
  serializeAiKeyCredential,
} from "../lib/ai/credential";
import { RunnerChief } from "../runner/chief";
import type { GatewaySocket } from "../runner/discord-gateway";
import {
  listenOnEndpoint,
  prepareEndpoint,
  releaseEndpoint,
  runnerEndpoint,
} from "../runner/endpoint";
import { DASH_LOCAL_PRINCIPAL } from "../runner/execute";
import { createRunnerServer } from "../runner/server";
import { openRunnerStore, type RunnerStore } from "../runner/store";
import { Supervisor } from "../runner/supervisor";

const CHANNEL = "111111111111111111";
const HENRIK = "222222222222222222";
const MODEL_ID = "openai/gpt-5-mini";
const TOKEN = "test-channel-token-0123456789";

/** Not a key. Long enough to be masked, and marked so nobody mistakes it. */
const PLANTED_KEY = "sk-or-v1-PLANTEDdeadbeefPLANTEDdeadbeefPLANTED";

/** A Discord bot token's shape, and equally planted. */
const PLANTED_BOT_TOKEN = "PLANTED.bot.token";

/**
 * What `lib/ai/actions.ts` actually writes under a fleet connection's name.
 *
 * Built with the production `serializeAiKeyCredential` rather than hand-written,
 * so the day the envelope grows a field this fixture grows it too — a fixture
 * that had frozen the 2026 shape would keep passing while the product moved.
 */
const STORED_ENVELOPE = serializeAiKeyCredential({
  version: AI_KEY_CREDENTIAL_VERSION,
  kind: AI_KEY_CREDENTIAL_KIND,
  provider: "openrouter",
  key: PLANTED_KEY,
  obtained_at: "2026-08-24T09:40:00.000Z",
});

const ANSWER_BODY = {
  choices: [{ message: { content: "One agent is waiting for you." } }],
  model: MODEL_ID,
  usage: { prompt_tokens: 120, completion_tokens: 30, cost: 0.0003 },
};

/* ---------------------------------------------------------------------- *
 * Teardown
 * ---------------------------------------------------------------------- */

const opened: Array<{ dataDir: string; closeDb: () => void }> = [];
const runnerStores: RunnerStore[] = [];
const directories: string[] = [];
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of closers.splice(0)) {
    await close();
  }
  for (const store of runnerStores.splice(0)) {
    store.close();
  }
  const entries = opened.splice(0);
  for (const { closeDb } of entries) {
    closeDb();
  }
  for (const dataDir of new Set([...entries.map((entry) => entry.dataDir), ...directories.splice(0)])) {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

/* ---------------------------------------------------------------------- *
 * DASH's half
 * ---------------------------------------------------------------------- */

/**
 * A DASH store set up the way Henrik's was: AI connected, a default model
 * chosen, the Discord bridge configured.
 *
 * `vi.resetModules()` and dynamic imports for `tests/chief-drain.test.ts`'
 * reason — `lib/db.ts` resolves `DASH_DATA_DIR` once, at import time, so a
 * module graph loaded against a previous test's directory would silently write
 * into it.
 */
async function dashStore(): Promise<{
  chiefDiscord: typeof import("../electron/chief-discord");
}> {
  const dataDir = mkdtempSync(path.join(tmpdir(), "dash-chief-key-"));
  process.env.DASH_DATA_DIR = dataDir;
  vi.resetModules();

  const db = await import("../lib/db");
  opened.push({ dataDir, closeDb: db.closeDb });
  db.db();

  const fleet = await import("../lib/fleet/store");
  const models = await import("../lib/ai/model-store");
  const store = await import("../lib/store");

  fleet.recordFleetConnection(
    {
      provider: "openrouter",
      connector_kind: "api_key",
      field_id: "api_key",
      secret_name: "dash.fleet.openrouter.account-1.api_key",
      // The masked hint the settings row carries. `maskSecret` of the planted
      // key, written out so this file never asks the store to mask anything.
      masked_hint: "••••NTED",
      account_hint: null,
      scopes: [],
      backend: "os_keychain",
    },
    "2026-08-24T09:40:00.000Z",
  );
  expect(models.writeFleetModelDefault("openrouter", MODEL_ID, "2026-08-24T09:41:00.000Z")).toBe(true);
  store.recordChiefDiscordBridge("••••oken", CHANNEL, HENRIK, "2026-08-24T09:42:00.000Z");

  return { chiefDiscord: await import("../electron/chief-discord") };
}

/**
 * The vault, as `electron/chief-discord.ts` sees it.
 *
 * `get` returns exactly what `lib/ai/actions.ts` wrote — the envelope for the
 * model key, the bare token for the bot. That asymmetry is the product's and is
 * the whole trap: one name holds a document and the other holds a value, and the
 * push site has to know which.
 */
function vault(): { get(name: string): Promise<string> } {
  return {
    get(name: string): Promise<string> {
      if (name === "dash.fleet.openrouter.account-1.api_key") {
        return Promise.resolve(STORED_ENVELOPE);
      }
      if (name === "dash.chief.discord.bot_token") {
        return Promise.resolve(PLANTED_BOT_TOKEN);
      }
      return Promise.reject(new Error("no such secret"));
    },
  };
}

/* ---------------------------------------------------------------------- *
 * The runner's half
 * ---------------------------------------------------------------------- */

/** A socket a test drives, standing in for the one Discord answers on. */
class FakeSocket implements GatewaySocket {
  sent: string[] = [];
  closed: number | null = null;
  onopen: ((event?: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code?: number }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number): void {
    this.closed = code ?? 1000;
  }

  hello(): void {
    this.onmessage?.({ data: JSON.stringify({ op: 10, d: { heartbeat_interval: 41_250 } }) });
  }

  /**
   * One message from the allowed person, in the allowed channel.
   *
   * The default question is deliberately **not** about standing. ADR 0023
   * answers "how is the fleet doing" from records, for free and without a model
   * — which is right, and would make every assertion in this file about a
   * request that never happened. This asks the one kind of question that has to
   * be paid for.
   */
  say(content = "write me a short summary of yesterday"): void {
    this.onmessage?.({
      data: JSON.stringify({
        op: 0,
        s: 1,
        t: "MESSAGE_CREATE",
        d: { channel_id: CHANNEL, author: { id: HENRIK }, content },
      }),
    });
  }
}

interface Runner {
  /** POST or GET the runner's own `/chief/discord`, over the real transport. */
  call: typeof fetch;
  chief: RunnerChief;
  socket: FakeSocket;
  /** Every `authorization` header the model provider was sent, in order. */
  bearers: string[];
  store: RunnerStore;
}

async function runner(): Promise<Runner> {
  const dataDir = mkdtempSync(path.join(tmpdir(), "dash-runner-key-"));
  directories.push(dataDir);
  const store = openRunnerStore(dataDir);
  if (!store.ok) {
    throw new Error(`the runner store would not open: ${store.damage.detail}`);
  }
  runnerStores.push(store.store);

  const socket = new FakeSocket();
  const bearers: string[] = [];

  const chief = new RunnerChief({
    database: () => store.store.database,
    log: () => {},
    connect: () => socket,
    fetchImpl: (async (url: unknown, init: unknown) => {
      const request = init as { headers?: Record<string, string> };
      if (String(url).includes("discord.com/api")) {
        return new Response("{}", { status: 200 });
      }
      bearers.push(request.headers?.["authorization"] ?? "(none)");
      return new Response(JSON.stringify(ANSWER_BODY), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch,
  });

  const server = createRunnerServer({
    supervisor: new Supervisor([], () => {}),
    database: store.store.database,
    token: TOKEN,
    principal: DASH_LOCAL_PRINCIPAL,
    log: () => {},
    configureChief: (configuration) => {
      chief.configure(configuration);
    },
    describeChief: () => chief.describe(),
  });

  /*
   * A fresh endpoint id per runner, and it has to be random rather than
   * descriptive. On Windows `runnerEndpoint` builds `\\.\pipe\...-<id>` from the
   * id **alone** — the data directory does not appear in it — so two runners in
   * this file sharing a constant id share one pipe, and the second test's client
   * writes into the first test's closing server. That surfaces as `EPIPE`, which
   * reads like a transport fault and is a name collision.
   */
  const endpoint = runnerEndpoint(dataDir, randomBytes(8).toString("hex"));
  await prepareEndpoint(endpoint);
  await listenOnEndpoint(server, endpoint);
  closers.push(
    () =>
      new Promise<void>((resolve) => {
        chief.stop();
        server.close(() => {
          releaseEndpoint(endpoint);
          resolve();
        });
      }),
  );

  return { call: ipcFetch(endpoint.path), chief, socket, bearers, store: store.store };
}

/** Let the message's async answer settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/* ---------------------------------------------------------------------- *
 * The push
 * ---------------------------------------------------------------------- */

describe("what DASH puts in the api_key slot", () => {
  it("is the key inside the envelope, not the envelope", async () => {
    const { chiefDiscord } = await dashStore();
    const body = await chiefDiscord.buildChiefBridgeConfiguration(vault());

    expect(body).not.toBeNull();
    const model = body?.["model"] as { provider_id: string; model_id: string; api_key: string };
    expect(model).toEqual({
      provider_id: "openrouter",
      model_id: MODEL_ID,
      api_key: PLANTED_KEY,
    });
  });

  it("never puts a JSON document there, whatever the envelope grows", async () => {
    /*
     * The regression stated as a shape rather than as a value. `toEqual` above
     * would fail if the envelope gained a field *and* the parse were removed;
     * this fails on the parse alone, and it is the assertion that would have
     * caught MAR-745 on the day it shipped. Written as a boolean so a failure
     * prints `true !== false` rather than a credential.
     */
    const { chiefDiscord } = await dashStore();
    const body = await chiefDiscord.buildChiefBridgeConfiguration(vault());
    const model = body?.["model"] as { api_key: string };

    expect(model.api_key.trimStart().startsWith("{")).toBe(false);
    expect(model.api_key.includes(AI_KEY_CREDENTIAL_KIND)).toBe(false);
  });

  it("reports no model rather than a bare value it cannot attribute", async () => {
    /*
     * A pre-MAR-582 value, or an OAuth grant left under a name whose field kind
     * changed. `lib/ai/actions.ts` refuses both on the window path, and the two
     * rooms have to agree: a runner sent a value DASH itself calls unusable
     * would spend it and be refused, and the person would read "revoked" about a
     * credential DASH had already decided it could not use.
     */
    const { chiefDiscord } = await dashStore();
    const body = await chiefDiscord.buildChiefBridgeConfiguration({
      get: (name: string) =>
        name === "dash.chief.discord.bot_token"
          ? Promise.resolve(PLANTED_BOT_TOKEN)
          : Promise.resolve("PLANTED-bare-value-from-an-older-dash"),
    });

    expect(body).not.toBeNull();
    expect(body?.["model"]).toBeNull();
    // And the bridge still stands: the chief answers from records with no model,
    // which is ADR 0028 decision 9 rather than a bridge that failed to build.
    expect(body?.["channel_id"]).toBe(CHANNEL);
  });
});

/* ---------------------------------------------------------------------- *
 * The whole seam
 * ---------------------------------------------------------------------- */

describe("the credential that reaches the provider", () => {
  it("is the vault's key, byte for byte, after a real push and a real answer", async () => {
    /*
     * MAR-745's acceptance, as a test. Vault to Bearer with nothing hand-typed
     * in between: DASH builds the configuration, posts it to the runner's own
     * route over the transport the product binds, and a question from Discord
     * becomes one model request whose `authorization` header is asserted
     * exactly.
     */
    const { chiefDiscord } = await dashStore();
    const { call, chief, socket, bearers, store } = await runner();

    const body = await chiefDiscord.buildChiefBridgeConfiguration(vault());
    const pushed = await call(`${IPC_ORIGIN}/chief/discord`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(pushed.status).toBe(200);

    socket.hello();
    socket.say();
    await settle();

    expect(bearers).toEqual([`Bearer ${PLANTED_KEY}`]);

    // And the decision that follows from it. `allowed` is the word the issue
    // asks for — the same column that read `refused / revoked` in the scratch
    // store, on a request that carried the envelope.
    const drained = chief.drain();
    expect(drained.audit).toHaveLength(1);
    expect(drained.audit[0]?.decision).toBe("allowed");
    expect(drained.audit[0]?.refusal).toBeNull();
    expect(drained.turns).toHaveLength(1);
    expect((drained.turns[0] as { provider_id: string | null }).provider_id).toBe("openrouter");
    expect((drained.turns[0] as { failure: string | null }).failure).toBeNull();

    expect(store.database).toBeDefined();
  });

  it("tells DASH which model it holds, so the status line is not taken on faith", async () => {
    const { chiefDiscord } = await dashStore();
    const { call } = await runner();

    const body = await chiefDiscord.buildChiefBridgeConfiguration(vault());
    await call(`${IPC_ORIGIN}/chief/discord`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    const held = (await (
      await call(`${IPC_ORIGIN}/chief/discord`, {
        method: "GET",
        headers: { authorization: `Bearer ${TOKEN}` },
      })
    ).json()) as { model: { model_id: string } | null };

    expect(held.model?.model_id).toBe(MODEL_ID);
    // The read side carries no credential, which is why it may be read at all.
    expect(JSON.stringify(held).includes(PLANTED_KEY)).toBe(false);
  });
});

/* ---------------------------------------------------------------------- *
 * The runner's own boundary
 * ---------------------------------------------------------------------- */

describe("what the runner refuses to spend (MAR-745 second line)", () => {
  /**
   * The guard in `readChiefModel`, driven through the route rather than called
   * directly — a unit test of an unexported function would not prove that the
   * value stops before it reaches the broker.
   */
  for (const [what, planted] of [
    ["a stored envelope", STORED_ENVELOPE],
    ["a masked hint", "••••NTED"],
  ] as const) {
    it(`takes the bridge and drops the model when main sends ${what}`, async () => {
      const { call, socket, bearers, chief } = await runner();

      const pushed = await call(`${IPC_ORIGIN}/chief/discord`, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({
          bot_token: PLANTED_BOT_TOKEN,
          channel_id: CHANNEL,
          allowed_user_id: HENRIK,
          model: { provider_id: "openrouter", model_id: MODEL_ID, api_key: planted },
          snapshot: { fleet: [], briefing: [], taken_at: "2026-08-24T09:45:00.000Z" },
        }),
      });

      // Taken, not refused: a 400 would leave the chief silent in Discord
      // holding whatever it had before, which is worse than answering without a
      // model and saying so.
      expect(pushed.status).toBe(200);
      expect(chief.describe()).toMatchObject({ configured: true, model: null });

      socket.hello();
      socket.say();
      await settle();

      // The point of the guard: nothing was spent, so nothing can come back
      // `revoked` and blame a key that works.
      expect(bearers).toEqual([]);
      expect(chief.drain().audit).toEqual([]);
    });
  }

  it("still spends an ordinary key, so the guard is not a blanket refusal", async () => {
    const { call, socket, bearers } = await runner();

    await call(`${IPC_ORIGIN}/chief/discord`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({
        bot_token: PLANTED_BOT_TOKEN,
        channel_id: CHANNEL,
        allowed_user_id: HENRIK,
        model: { provider_id: "openrouter", model_id: MODEL_ID, api_key: PLANTED_KEY },
        snapshot: { fleet: [], briefing: [], taken_at: "2026-08-24T09:45:00.000Z" },
      }),
    });

    socket.hello();
    socket.say();
    await settle();

    expect(bearers).toEqual([`Bearer ${PLANTED_KEY}`]);
  });
});
