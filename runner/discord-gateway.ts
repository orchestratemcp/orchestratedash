/**
 * The socket the chief hears you on (MAR-743, ADR 0028 decision 2).
 *
 * ## Why this is in the runner, and why it is a websocket
 *
 * `runner/notify.ts`' first argument, one step further. The sender lives here
 * because this process outlives the DASH window; the *listener* has to live here
 * for the same reason and a stronger one — MAR-742's whole bar is "close DASH,
 * still talk to the chief", and a listener in main would make that sentence
 * false at the exact moment it is worth anything.
 *
 * A Discord bot is an **outbound** connection. This file dials
 * `wss://gateway.discord.gg`, identifies, and receives events down the socket it
 * opened. It binds nothing, accepts nothing, and is reachable from nowhere. That
 * is what lets DASH grow an inbound conversation without breaking the no-port
 * posture ADR 0006 and ADR 0021 both rest on — and it is why Discord is the
 * first outside room rather than a webhook receiver, which would have needed
 * exactly the thing DASH refuses.
 *
 * ## What this file is not allowed to decide
 *
 * Anything. It holds the socket and the token and makes no judgements: which
 * messages count is `lib/chief/discord.ts`, what the answer is is
 * `lib/chief/answer.ts`, and what gets written down is `runner/chief.ts`. The
 * split is `lib/notify/discord.ts` / `lib/notify/deliver.ts` again — composition
 * and adjudication in a pure module that tests can drive, bytes on the wire in a
 * module that cannot add a field.
 *
 * So `onMessage` receives a raw shape and this file has read exactly four fields
 * off it. It does not know who is allowed to speak.
 *
 * ## The credential
 *
 * Held on one private field, in memory, handed over by main on the authenticated
 * control channel. Never written to `runner.sqlite`, never to a file, never to a
 * log line — `describe()` reports whether a bridge is connected, never with
 * what. `runner/notify.ts`' arrangement and its consequence: after a restart
 * this is gone, and stays gone until DASH is opened once.
 *
 * ## Reconnection
 *
 * Discord drops sockets routinely — a deploy on their side, a network blip, a
 * laptop lid. A bridge that needed a person to notice would be a bridge that is
 * quietly dead most weeks. So: resume when Discord offers one, re-identify when
 * it does not, and back off geometrically so a genuinely refused token does not
 * become a reconnect loop hammering their gateway.
 */

import {
  DISCORD_MESSAGE_LIMIT,
  type InboundMessage,
} from "../lib/chief/discord";

/* ---------------------------------------------------------------------- *
 * The protocol, as much of it as this uses
 * ---------------------------------------------------------------------- */

const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
const API_ORIGIN = "https://discord.com";

/**
 * The two intents this bridge reads, and no third.
 *
 * `GUILD_MESSAGES` (1 << 9) says "tell me about messages in channels I am in".
 * `MESSAGE_CONTENT` (1 << 15) is the privileged one that makes `content`
 * non-empty; without it Discord delivers the event with the text stripped, and
 * the bridge would connect and hear nothing — which is why the setup copy names
 * it by name rather than leaving it to be discovered.
 *
 * Deliberately absent: `GUILD_MEMBERS`, so DASH learns nothing about who else is
 * in the server, and `DIRECT_MESSAGES`, so a stranger cannot open a DM with the
 * bot and be in a room `admit`'s channel check was never asked about.
 */
const INTENTS = (1 << 9) | (1 << 15);

const OP_DISPATCH = 0;
const OP_HEARTBEAT = 1;
const OP_IDENTIFY = 2;
const OP_RESUME = 6;
const OP_RECONNECT = 7;
const OP_INVALID_SESSION = 9;
const OP_HELLO = 10;
const OP_HEARTBEAT_ACK = 11;

/** First retry, doubling to `MAX_BACKOFF_MS`. */
const BASE_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 300_000;

/* ---------------------------------------------------------------------- *
 * Configuration and shape
 * ---------------------------------------------------------------------- */

/**
 * What main hands over. Never persisted, never returned.
 *
 * The channel travels with the token for `NotifyConfiguration`'s reason: the
 * runner is what decides whether bytes leave the machine, and a runner holding a
 * token that had to ask something else which room it was for would be a runner
 * with a window in which it has not asked yet.
 */
export interface GatewayConfiguration {
  bot_token: string;
  channel_id: string;
}

export interface GatewayOptions {
  onMessage(message: InboundMessage): void;
  log(line: string): void;
  /** Injected so tests do not open a socket to Discord. */
  connect?: (url: string) => GatewaySocket;
  fetchImpl?: typeof fetch;
  /** Injected so tests do not spend real seconds backing off. */
  setTimer?: (fn: () => void, ms: number) => { cancel(): void };
}

/**
 * The slice of `WebSocket` this uses.
 *
 * A structural type rather than the DOM lib's, so a test can pass a plain object
 * and so this module compiles in a build that does not pull in DOM types. Four
 * members: the three handlers and the two verbs.
 */
export interface GatewaySocket {
  send(data: string): void;
  close(code?: number): void;
  onopen: ((event?: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code?: number }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

/** Whether this build can hold a socket at all. */
export function gatewaySupported(): boolean {
  return typeof globalThis.WebSocket === "function";
}

/* ---------------------------------------------------------------------- *
 * The client
 * ---------------------------------------------------------------------- */

export class DiscordGateway {
  #configuration: GatewayConfiguration | null = null;
  #socket: GatewaySocket | null = null;
  #heartbeat: { cancel(): void } | null = null;
  #retry: { cancel(): void } | null = null;
  #sequence: number | null = null;
  #sessionId: string | null = null;
  #resumeUrl: string | null = null;
  #attempts = 0;
  /** True from `stop()` onwards. A stopped gateway never reconnects. */
  #stopped = false;
  #acked = true;

  readonly #options: Required<Pick<GatewayOptions, "onMessage" | "log">> & {
    connect: (url: string) => GatewaySocket;
    fetchImpl: typeof fetch;
    setTimer: (fn: () => void, ms: number) => { cancel(): void };
  };

  constructor(options: GatewayOptions) {
    this.#options = {
      onMessage: options.onMessage,
      log: options.log,
      connect:
        options.connect ??
        ((url) => new globalThis.WebSocket(url) as unknown as GatewaySocket),
      fetchImpl: options.fetchImpl ?? fetch,
      setTimer:
        options.setTimer ??
        ((fn, ms) => {
          const handle = setTimeout(fn, ms);
          // Unref'd: a pending reconnect must not be the reason the runner
          // cannot exit when it is asked to.
          handle.unref?.();
          return { cancel: () => { clearTimeout(handle); } };
        }),
    };
  }

  /**
   * Take a configuration, or take one away.
   *
   * The same route serves both, `POST /notify/discord`'s reason: they are one
   * setting with two values, and a person pressing Disconnect in DASH is
   * entitled to have that reach the runner as reliably as pressing Connect did.
   *
   * Re-configuring with the same values is deliberately **not** a no-op that
   * keeps the socket: a re-connect in DASH means the person replaced a token,
   * and a gateway that kept talking with the old one would be a gateway whose
   * state disagrees with the store nobody can see.
   */
  configure(configuration: GatewayConfiguration | null): void {
    this.#teardown();
    this.#configuration = configuration;
    this.#stopped = false;
    this.#attempts = 0;
    this.#sessionId = null;
    this.#resumeUrl = null;
    this.#sequence = null;
    if (configuration === null) {
      this.#options.log("[runner] the chief's Discord bridge is off");
      return;
    }
    if (!gatewaySupported()) {
      // Named rather than thrown. A runtime with no `WebSocket` is a build
      // problem somebody has to see in the log, and a throw here would take
      // down a runner that is otherwise supervising agents perfectly well.
      this.#options.log("[runner] this runtime has no WebSocket; the chief's Discord bridge cannot open");
      return;
    }
    this.#open(GATEWAY_URL);
  }

  /** Whether a bridge is configured, and never which one. */
  describe(): { configured: boolean; connected: boolean } {
    return { configured: this.#configuration !== null, connected: this.#socket !== null };
  }

  /** Stop for good. Called from the runner's shutdown, before the store closes. */
  stop(): void {
    this.#stopped = true;
    this.#teardown();
    this.#configuration = null;
  }

  /**
   * Post one message to the configured channel.
   *
   * `allowed_mentions: { parse: [] }` is not decoration. The chief's answer is
   * built from agent names and author-written goal sentences, and one of those
   * containing `@everyone` would otherwise ping a server — a stranger's text
   * reaching into somebody's Discord through DASH. With this, a mention is
   * rendered as the literal characters and notifies nobody.
   */
/**
   * Show Discord's own "ChiefAPP is typing…" while the answer is being written.
   *
   * Henrik asked for this on the attended run: *"it would be cool if the bot had
   * like a writing feedback while it thinks so you know its working."* A chief
   * turn is a records read, a fetch of three feeds and a model completion, which
   * on the attended run took between four and nine seconds -- long enough that a
   * chat room with nothing happening in it reads as a bot that did not hear you.
   *
   * ## Why this is allowed to be here at all
   *
   * ADR 0028 decision 2 says the bridge makes **no REST call other than posting
   * a reply**: no channel listing, no history fetch, no member lookup. That
   * sentence is about what the bridge may *learn*, and this call learns nothing
   * -- it sends the channel id it was already given and reads no response body.
   * It is the same channel, the same credential, and the same direction as the
   * reply it precedes. Widening the sentence to "post a reply, and say it is
   * coming" costs no reach.
   *
   * ## Best effort, and never in the way
   *
   * Nothing branches on the outcome. A failure here must not stop an answer
   * being sent -- a person would rather have the reply without the indicator
   * than neither -- so the result is discarded and a failure is not even logged:
   * it would be a line per turn on a path where nothing is wrong with the
   * feature the person is using.
   *
   * Discord clears the indicator after ten seconds or when a message arrives,
   * whichever is first, so there is nothing to turn off.
   */
  async showTyping(): Promise<void> {
    const configuration = this.#configuration;
    if (configuration === null) {
      return;
    }
    try {
      await this.#options.fetchImpl(
        `${API_ORIGIN}/api/v10/channels/${configuration.channel_id}/typing`,
        {
          method: "POST",
          headers: {
            authorization: `Bot ${configuration.bot_token}`,
            "content-length": "0",
          },
          signal: AbortSignal.timeout(5_000),
        },
      );
    } catch {
      /* Dropped, and not logged. See the docblock: a rejection can carry the
         request, and this one has a credential on it. */
    }
  }

  async post(content: string): Promise<boolean> {
    const configuration = this.#configuration;
    if (configuration === null) {
      return false;
    }
    const body = content.slice(0, DISCORD_MESSAGE_LIMIT);
    try {
      const response = await this.#options.fetchImpl(
        `${API_ORIGIN}/api/v10/channels/${configuration.channel_id}/messages`,
        {
          method: "POST",
          headers: {
            authorization: `Bot ${configuration.bot_token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ content: body, allowed_mentions: { parse: [] } }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!response.ok) {
        // The status and nothing else. The request that failed had a token on it.
        this.#options.log(`[runner] the chief's reply was not accepted (status ${String(response.status)})`);
        return false;
      }
      return true;
    } catch {
      /* The caught value is dropped rather than inspected: a fetch rejection can
         carry the request, and this request has a credential in its headers.
         `runner/host-broker.ts` drops its own for the same reason. */
      this.#options.log("[runner] the chief's reply could not be sent");
      return false;
    }
  }

  /* -------------------------------------------------------------------- *
   * The socket's life
   * -------------------------------------------------------------------- */

  #open(url: string): void {
    if (this.#stopped || this.#configuration === null) {
      return;
    }
    let socket: GatewaySocket;
    try {
      socket = this.#options.connect(url);
    } catch {
      this.#reconnectLater();
      return;
    }
    this.#socket = socket;
    this.#acked = true;

    socket.onmessage = (event) => {
      this.#receive(event.data);
    };
    socket.onclose = (event) => {
      /*
       * 4004 is "authentication failed" — the token is wrong or was reset. A
       * bridge that retried it would be a loop against Discord's gateway with a
       * credential that will never work, so this stops and says so. Every other
       * code is a reason to come back.
       */
      if (event.code === 4004) {
        this.#options.log("[runner] Discord refused the chief's bot token; the bridge is stopped");
        this.#stopped = true;
        this.#teardown();
        return;
      }
      this.#socket = null;
      this.#stopHeartbeat();
      this.#reconnectLater();
    };
    socket.onerror = () => {
      // Nothing: a socket error is followed by a close, and handling both would
      // schedule two reconnects for one drop.
    };
  }

  #receive(raw: unknown): void {
    if (typeof raw !== "string") {
      return;
    }
    let payload: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) {
        return;
      }
      payload = parsed as Record<string, unknown>;
    } catch {
      return;
    }

    const sequence = payload["s"];
    if (typeof sequence === "number") {
      this.#sequence = sequence;
    }

    switch (payload["op"]) {
      case OP_HELLO: {
        const data = payload["d"];
        const interval =
          typeof data === "object" && data !== null
            ? Number((data as Record<string, unknown>)["heartbeat_interval"])
            : NaN;
        this.#startHeartbeat(Number.isFinite(interval) && interval > 0 ? interval : 41_250);
        this.#identifyOrResume();
        return;
      }
      case OP_HEARTBEAT:
        // Discord asking for one out of band. Answered immediately, which is
        // what its own documentation asks for and what keeps a busy socket from
        // being dropped as unresponsive.
        this.#send({ op: OP_HEARTBEAT, d: this.#sequence });
        return;
      case OP_HEARTBEAT_ACK:
        this.#acked = true;
        return;
      case OP_RECONNECT:
        // Discord's own "come back", usually a deploy on their side. The
        // session is still resumable, so the state is kept.
        this.#socket?.close(4000);
        return;
      case OP_INVALID_SESSION:
        /* The session cannot be resumed. Forgetting it here is what turns the
           next connect into an identify rather than a resume that would be
           invalidated again — a loop this protocol produces readily if the
           state is not cleared. */
        this.#sessionId = null;
        this.#resumeUrl = null;
        this.#sequence = null;
        this.#socket?.close(4000);
        return;
      case OP_DISPATCH:
        this.#dispatch(payload);
        return;
      default:
        return;
    }
  }

  #dispatch(payload: Record<string, unknown>): void {
    const name = payload["t"];
    const data = payload["d"];
    if (typeof data !== "object" || data === null) {
      return;
    }
    const event = data as Record<string, unknown>;

    if (name === "READY") {
      this.#attempts = 0;
      const session = event["session_id"];
      const resume = event["resume_gateway_url"];
      this.#sessionId = typeof session === "string" ? session : null;
      this.#resumeUrl = typeof resume === "string" ? resume : null;
      this.#options.log("[runner] the chief's Discord bridge is listening");
      return;
    }
    if (name === "RESUMED") {
      this.#attempts = 0;
      this.#options.log("[runner] the chief's Discord bridge resumed");
      return;
    }
    if (name !== "MESSAGE_CREATE") {
      return;
    }

    /*
     * Four fields, read defensively out of `unknown`. Everything else Discord
     * sends — the guild, the member, the attachments, the referenced message,
     * the embeds — is not read at all, which is the smallest surface that can
     * carry a question and is deliberately smaller than what arrives.
     */
    const author = event["author"];
    const authorRecord =
      typeof author === "object" && author !== null ? (author as Record<string, unknown>) : {};
    const message: InboundMessage = {
      channel_id: typeof event["channel_id"] === "string" ? event["channel_id"] : "",
      author_id: typeof authorRecord["id"] === "string" ? authorRecord["id"] : "",
      // `webhook_id` present means a webhook wrote it, which Discord does not
      // flag as a bot. DASH's own notifier posts through a webhook into a
      // channel a person may well have pointed at this same room.
      author_is_bot: authorRecord["bot"] === true || typeof event["webhook_id"] === "string",
      content: typeof event["content"] === "string" ? event["content"] : "",
    };
    this.#options.onMessage(message);
  }

  #identifyOrResume(): void {
    const configuration = this.#configuration;
    if (configuration === null) {
      return;
    }
    if (this.#sessionId !== null && this.#sequence !== null) {
      this.#send({
        op: OP_RESUME,
        d: {
          token: configuration.bot_token,
          session_id: this.#sessionId,
          seq: this.#sequence,
        },
      });
      return;
    }
    this.#send({
      op: OP_IDENTIFY,
      d: {
        token: configuration.bot_token,
        intents: INTENTS,
        properties: { os: process.platform, browser: "dash", device: "dash" },
      },
    });
  }

  #startHeartbeat(interval: number): void {
    this.#stopHeartbeat();
    const beat = (): void => {
      if (!this.#acked) {
        /*
         * The previous heartbeat was never acknowledged. Discord's own guidance
         * is to treat that as a zombied connection and reconnect rather than go
         * on beating into it — the failure this catches is a socket that is open
         * at the OS level and dead at theirs, which otherwise looks like a chief
         * that has simply stopped answering.
         */
        this.#socket?.close(4000);
        return;
      }
      this.#acked = false;
      this.#send({ op: OP_HEARTBEAT, d: this.#sequence });
      this.#heartbeat = this.#options.setTimer(beat, interval);
    };
    // The first beat is delayed by a jitter of the interval, as Discord asks,
    // so a fleet of clients reconnecting after their outage does not beat in
    // lockstep.
    this.#heartbeat = this.#options.setTimer(beat, Math.floor(interval * 0.7));
  }

  #stopHeartbeat(): void {
    this.#heartbeat?.cancel();
    this.#heartbeat = null;
  }

  #reconnectLater(): void {
    if (this.#stopped || this.#configuration === null) {
      return;
    }
    this.#retry?.cancel();
    const wait = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** this.#attempts);
    this.#attempts += 1;
    this.#retry = this.#options.setTimer(() => {
      this.#retry = null;
      this.#open(this.#resumeUrl === null ? GATEWAY_URL : `${this.#resumeUrl}/?v=10&encoding=json`);
    }, wait);
  }

  #send(payload: Record<string, unknown>): void {
    try {
      this.#socket?.send(JSON.stringify(payload));
    } catch {
      // A send on a closing socket. The close handler is what reconnects; a
      // second path here would schedule two.
    }
  }

  #teardown(): void {
    this.#stopHeartbeat();
    this.#retry?.cancel();
    this.#retry = null;
    const socket = this.#socket;
    this.#socket = null;
    if (socket !== null) {
      socket.onclose = null;
      socket.onmessage = null;
      socket.onerror = null;
      try {
        socket.close(1000);
      } catch {
        // Already gone.
      }
    }
  }
}
