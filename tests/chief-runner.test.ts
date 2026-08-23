/**
 * The chief answering from the runner, end to end without Discord (MAR-743,
 * ADR 0028).
 *
 * `tests/chief-discord.test.ts` proves who may speak and `tests/chief-broker.test.ts`
 * proves what a spend may be. This proves the seam between them: a message
 * arriving off a socket becomes an answer, a spooled turn and a spooled decision,
 * and DASH can take all of it afterwards.
 *
 * **Two substitutions and no more**, `tests/host-broker.test.ts`' bar: the
 * websocket and `fetch`. The store is the production `openRunnerStore` on a real
 * temporary directory, the answering procedure is the production
 * `answerChiefQuestion` that Electron main runs, and the broker is the
 * production one.
 *
 * What no green run here may be read as proving: that the runner survives DASH
 * closing. That is Henrik's attended flow, it is the whole point of the packet,
 * and a test process cannot assert it.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { NO_MODEL_NOTE } from "../lib/chief/discord";
import { RunnerChief, type ChiefBridgeConfiguration } from "../runner/chief";
import type { GatewaySocket } from "../runner/discord-gateway";
import { openRunnerStore, type RunnerStore } from "../runner/store";

const CHANNEL = "111111111111111111";
const HENRIK = "222222222222222222";
const STRANGER = "333333333333333333";
const PLANTED_KEY = "sk-or-v1-PLANTEDdeadbeefPLANTEDdeadbeefPLANTED";

const directories: string[] = [];
const stores: RunnerStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) {
    store.close();
  }
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

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

  /** Discord's HELLO, which is what makes the client identify. */
  hello(): void {
    this.onmessage?.({ data: JSON.stringify({ op: 10, d: { heartbeat_interval: 41_250 } }) });
  }

  /** One message in a channel, as `MESSAGE_CREATE` delivers it. */
  say(over: Record<string, unknown> = {}): void {
    this.onmessage?.({
      data: JSON.stringify({
        op: 0,
        s: 1,
        t: "MESSAGE_CREATE",
        d: {
          channel_id: CHANNEL,
          author: { id: HENRIK },
          content: "write me a short summary of yesterday",
          ...over,
        },
      }),
    });
  }
}

const ANSWER_BODY = {
  choices: [{ message: { content: "Four agents, and one is waiting for you." } }],
  model: "openai/gpt-5-mini",
  usage: { prompt_tokens: 120, completion_tokens: 30, cost: 0.0003 },
};

interface Harness {
  chief: RunnerChief;
  socket: FakeSocket;
  store: RunnerStore;
  posts: string[];
  logs: string[];
  /** Every request body sent to the model provider, in order. */
  providerRequests: string[];
}

function harness(
  over: Partial<ChiefBridgeConfiguration> = {},
  options: { respond?: () => Response } = {},
): Harness {
  const directory = mkdtempSync(path.join(tmpdir(), "dash-runner-chief-"));
  directories.push(directory);
  const opened = openRunnerStore(directory);
  if (!opened.ok) {
    throw new Error(`the runner store would not open: ${opened.damage.detail}`);
  }
  stores.push(opened.store);

  const socket = new FakeSocket();
  const posts: string[] = [];
  const logs: string[] = [];
  const providerRequests: string[] = [];

  const chief = new RunnerChief({
    database: () => opened.store.database,
    log: (line) => logs.push(line),
    connect: () => socket,
    fetchImpl: (async (url: unknown, init: unknown) => {
      const request = init as { body?: string };
      if (String(url).includes("discord.com/api")) {
        posts.push(String(JSON.parse(request.body ?? "{}").content ?? ""));
        return new Response("{}", { status: 200 });
      }
      providerRequests.push(request.body ?? "");
      return (
        options.respond?.() ??
        new Response(JSON.stringify(ANSWER_BODY), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
    }) as unknown as typeof fetch,
  });

  chief.configure({
    bot_token: "bot.token.value",
    channel_id: CHANNEL,
    allowed_user_id: HENRIK,
    model: { provider_id: "openrouter", model_id: "openai/gpt-5-mini", api_key: PLANTED_KEY },
    snapshot: {
      fleet: [
        {
          name: "scout",
          title: "AI News Scout",
          goal: "Collect the day's AI news and write a cited digest",
          avatar: "explorer",
          capabilities: ["news.collect"],
          glance: [],
          status: null,
        },
      ] as ChiefBridgeConfiguration["snapshot"]["fleet"],
      briefing: [],
      taken_at: new Date().toISOString(),
    },
    ...over,
  });
  socket.hello();

  return { chief, socket, store: opened.store, posts, logs, providerRequests };
}

/** Let the message's async answer settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe("a question from Discord", () => {
  it("is answered, spooled, and handed to DASH", async () => {
    const { chief, socket, posts } = harness();
    socket.say();
    await settle();

    expect(posts).toHaveLength(1);
    expect(posts[0]).toContain("Four agents");

    const drained = chief.drain();
    expect(drained.turns).toHaveLength(1);
    const turn = drained.turns[0];
    expect(turn?.question).toBe("write me a short summary of yesterday");
    expect(turn?.answer).toContain("Four agents");
    // The provenance the whole of decision 7 exists for. A drained turn that
    // said "window" would be a transcript misrepresenting the conversation it
    // is a record of.
    expect(turn?.origin).toBe("discord");
    expect(turn?.provider_id).toBe("openrouter");
    expect(turn?.amount_usd).toBe(0.0003);

    expect(drained.audit).toHaveLength(1);
    expect(drained.audit[0]?.decision).toBe("allowed");

    // Read-then-delete: a queue, not a second home for somebody's conversation.
    expect(chief.drain()).toEqual({ turns: [], audit: [] });
  });

  it("carries no credential into the spool", async () => {
    const { chief, socket } = harness();
    socket.say();
    await settle();

    const drained = JSON.stringify(chief.drain());
    expect(drained).not.toContain(PLANTED_KEY);
    expect(drained).not.toContain("bot.token.value");
  });

  it("says nothing at all to anybody else", async () => {
    const { chief, socket, posts, logs } = harness();
    socket.say({ author: { id: STRANGER }, content: "what are you" });
    socket.say({ author: { id: HENRIK, bot: true } });
    socket.say({ channel_id: STRANGER });
    await settle();

    expect(posts).toEqual([]);
    expect(chief.drain().turns).toEqual([]);
    // Not even a log line naming them. A support log that recorded every
    // stranger's id would be a log of who is in somebody's Discord channel.
    expect(logs.join("\n")).not.toContain(STRANGER);
  });

  it("ignores its own posts, so an answer cannot become a question", async () => {
    // The loop that would otherwise price every reply. Asserted through the
    // webhook flag as well as the bot flag, because DASH's own notifier posts
    // through a webhook and a person may well point it at this same channel.
    const { chief, socket, posts } = harness();
    socket.say({ webhook_id: "444444444444444444", content: "Four agents" });
    await settle();
    expect(posts).toEqual([]);
    expect(chief.drain().turns).toEqual([]);
  });
});

describe("when there is nothing to ask", () => {
  it("answers from records and says what it could not add", async () => {
    /*
     * ADR 0028 decision 9, and the state every runner is in after a restart:
     * the bridge is configured, and the key it held in memory is gone until DASH
     * is opened once. The reply is a real answer with a note under it, never a
     * silence and never only an apology.
     */
    const { chief, socket, posts } = harness({ model: null });
    /*
     * A question nothing in the fleet declares, which is the arm the model
     * exists for. A question the *records* can route — one whose words match an
     * author's declared goal — is answered by routing it and needs no note,
     * which is the chief being useful rather than apologising and is why the
     * note is on this arm alone.
     */
    socket.say({ content: "compare the two invoices I uploaded" });
    await settle();

    expect(posts).toHaveLength(1);
    expect(posts[0]).toContain(NO_MODEL_NOTE);

    const drained = chief.drain();
    expect(drained.turns).toHaveLength(1);
    // The free arm: no provider, no money columns, and it still gets a row.
    expect(drained.turns[0]?.provider_id).toBeNull();
    expect(drained.turns[0]?.amount_usd).toBeNull();
    expect(drained.turns[0]?.origin).toBe("discord");
    // Nothing was adjudicated, because nothing reached the broker.
    expect(drained.audit).toEqual([]);
  });

  it("says a provider is down rather than going quiet", async () => {
    const { chief, socket, posts } = harness(
      {},
      {
        respond: () => {
          throw new Error("ECONNRESET");
        },
      },
    );
    socket.say();
    await settle();

    expect(posts).toHaveLength(1);
    expect(posts[0]?.trim().length).toBeGreaterThan(0);
    // The turn is still written: a question that failed is still a thing the
    // person asked.
    const drained = chief.drain();
    expect(drained.turns[0]?.answer).toBeNull();
    expect(drained.turns[0]?.failure).not.toBeNull();
    expect(drained.audit[0]?.refusal).toBe("provider_unavailable");
  });
});

describe("one at a time", () => {
  it("tells the person it is still working rather than pricing a second question", async () => {
    /*
     * The serial gate. The broker's window would have caught the sixth message
     * in a minute; this catches the second in a second, and the difference is a
     * bound versus a bill.
     */
    const { chief, socket, posts } = harness();
    socket.say();
    socket.say({ content: "and the other one" });
    await settle();

    expect(posts).toHaveLength(2);
    expect(posts.some((post) => post.includes("Still working"))).toBe(true);
    // Only the first became a turn.
    expect(chief.drain().turns).toHaveLength(1);
  });
});

describe("stopping", () => {
  it("closes the socket and forgets the configuration", () => {
    const { chief, socket } = harness();
    chief.stop();
    expect(socket.closed).not.toBeNull();
    expect(chief.describe()).toEqual({
      configured: false,
      connected: false,
      snapshot_at: null,
      fleet_count: 0,
      model: null,
    });
  });
});

describe("re-delivery after bridge setup (MAR-745)", () => {
  /*
   * The exact sequence MAR-745's scratch store showed: the Discord bridge is
   * configured first, with nothing else set up yet. AI is connected second.
   * An agent is imported third. Each of those is one more `configure()` call
   * from DASH's side — `pushChiefBridge`'s whole job — and this proves what a
   * caller of that function is entitled to assume: the runner's next answer
   * reflects the latest configure, not the first one.
   */
  it("answers model-backed and names the new agent once both arrive after setup", async () => {
    // Step 1: the bridge is configured before AI is connected or any agent
    // beyond the starting fleet exists — MAR-745's "connect AI second" order.
    const { chief, socket, posts, providerRequests } = harness({ model: null });

    const scoutBriefing = {
      agent: "scout",
      title: "AI News Scout",
      place: "Local",
      standing: "All clear.",
      runs: "Has run before.",
      last_run: null,
      capabilities: ["news.collect"],
    };
    const competitorScoutBriefing = {
      agent: "competitor-scout",
      title: "Competitor Scout",
      place: "Local",
      standing: "All clear.",
      runs: "Has not run yet.",
      last_run: null,
      capabilities: ["news.collect"],
    };

    // Step 2: "connect AI second" — main pushes again with a model, the fleet
    // unchanged. `pushChiefBridge` always sends the whole configuration, so
    // this is what a real push looks like: everything from before, plus a
    // model.
    chief.configure({
      bot_token: "bot.token.value",
      channel_id: CHANNEL,
      allowed_user_id: HENRIK,
      model: { provider_id: "openrouter", model_id: "openai/gpt-5-mini", api_key: PLANTED_KEY },
      snapshot: {
        fleet: [
          {
            name: "scout",
            title: "AI News Scout",
            goal: "Collect the day's AI news and write a cited digest",
            avatar: "explorer",
            capabilities: ["news.collect"],
            glance: [],
            status: null,
          },
        ],
        briefing: [scoutBriefing],
        taken_at: new Date().toISOString(),
      },
    });

    // Step 3: "import an agent third" — another push, the new agent now in
    // the fleet main read off the store.
    chief.configure({
      bot_token: "bot.token.value",
      channel_id: CHANNEL,
      allowed_user_id: HENRIK,
      model: { provider_id: "openrouter", model_id: "openai/gpt-5-mini", api_key: PLANTED_KEY },
      snapshot: {
        fleet: [
          {
            name: "scout",
            title: "AI News Scout",
            goal: "Collect the day's AI news and write a cited digest",
            avatar: "explorer",
            capabilities: ["news.collect"],
            glance: [],
            status: null,
          },
          {
            name: "competitor-scout",
            title: "Competitor Scout",
            goal: "Watch competitors and report what changed",
            avatar: "robot",
            capabilities: ["news.collect"],
            glance: [],
            status: null,
          },
        ],
        briefing: [scoutBriefing, competitorScoutBriefing],
        taken_at: new Date().toISOString(),
      },
    });

    expect(chief.describe().fleet_count).toBe(2);
    expect(chief.describe().model).toEqual({
      provider_id: "openrouter",
      model_id: "openai/gpt-5-mini",
      label: "OpenRouter",
    });

    // A question neither agent's declared goal or capabilities answers for —
    // `tests/chief-runner.test.ts`'s own "nothing to ask" arm, reused here for
    // the same reason: it is the one kind of question guaranteed to reach the
    // model rather than being answered for free from records, which is what
    // this test needs to prove.
    socket.say({ content: "compare the two invoices I uploaded" });
    await settle();

    expect(posts).toHaveLength(1);
    const drained = chief.drain();
    expect(drained.turns).toHaveLength(1);
    // The model-backed arm, not the records fallback MAR-745 found instead.
    expect(drained.turns[0]?.provider_id).toBe("openrouter");
    expect(drained.audit).toHaveLength(1);
    expect(drained.audit[0]?.decision).toBe("allowed");
    // "Names the agent" — the briefing the model was actually asked with
    // carries the agent imported in step 3, not just the one present at
    // bridge setup.
    expect(providerRequests.join(" ")).toContain("Competitor Scout");
  });
});
