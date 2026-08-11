/**
 * The recorded HTTP exchange (MAR-588, outbound half — the merged proof bar).
 *
 * Every other test in this feature runs against a fake `fetch`, which is right
 * for policy — dedup, bounds, switches, retries — and proves nothing about what
 * DASH actually puts on a socket. This one runs the **real** `deliverDiscordMessage`
 * against a **real** `node:http` listener on loopback and asserts the bytes that
 * arrive: the method, the headers, and the exact JSON body, for both kinds of
 * message and for the test message.
 *
 * ## Why a local listener rather than Discord
 *
 * A real webhook fired at a real Discord channel is attended proof — somebody
 * has to hold a channel, paste a credential and look at the result — so it
 * cannot gate a merge and cannot run in CI. What *can* is this: the same
 * composer, the same transport, the same request, answered by a server this file
 * starts. What it does not prove is that Discord accepts the shape, which is
 * named in the handoff as unproven rather than implied here.
 *
 * ## Why the strict host check does not get in the way
 *
 * `parseDiscordWebhook` is what a person's paste passes through, and it refuses
 * anything that is not `https://discord.com/api/webhooks/…` — see that function
 * for why the host list is closed. It guards *what gets stored*. The transport
 * posts to whatever it is handed, which is what lets this drive it at loopback
 * without weakening the check anywhere: there is no test-only escape hatch in
 * `lib/`, and adding one would have made the strictest rule in the feature
 * conditional on an environment variable.
 *
 * Set `DASH_NOTIFY_TRANSCRIPT` to a file path to have the run write the exchange
 * out. `docs/mar-588-discord-outbound.md` holds a copy produced that way.
 */

import { createServer, type IncomingMessage, type Server } from "node:http";
import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildDiscordMessage, buildTestMessage } from "../lib/notify/discord";
import { deliverDiscordMessage } from "../lib/notify/deliver";
import { buildOpenLink } from "../lib/open-link";

interface Received {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

const received: Received[] = [];

/** What the listener answers next, so the failure branches are exercisable. */
let answer: { status: number; headers?: Record<string, string> } = { status: 204 };

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((request: IncomingMessage, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      received.push({
        method: request.method ?? "",
        path: request.url ?? "",
        headers: Object.fromEntries(
          Object.entries(request.headers).map(([key, value]) => [key, String(value)]),
        ),
        body: Buffer.concat(chunks).toString("utf8"),
      });
      response.writeHead(answer.status, answer.headers);
      response.end();
    });
  });

  await new Promise<void>((resolve) => {
    // Loopback and an ephemeral port. Nothing about this test binds a
    // predictable address or reaches anything off this machine.
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  base = `http://127.0.0.1:${String(port)}/api/webhooks/1234567890123456789/proof-token`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });

  const target = process.env["DASH_NOTIFY_TRANSCRIPT"];
  if (target !== undefined && target !== "") {
    writeFileSync(target, transcript(), "utf8");
  }
});

/**
 * The exchange, as text.
 *
 * The path is rewritten to a placeholder because it carries the port this run
 * happened to bind, and a transcript that changes on every run is one nobody can
 * diff. Nothing else is edited — the headers and the body are what arrived.
 */
function transcript(): string {
  return received
    .map((entry, index) => {
      const headers = ["content-type", "user-agent", "content-length"]
        .filter((name) => entry.headers[name] !== undefined)
        .map((name) => `${name}: ${String(entry.headers[name])}`)
        .join("\n");
      return [
        `--- request ${String(index + 1)} ---`,
        `${entry.method} /api/webhooks/{id}/{token} HTTP/1.1`,
        `host: 127.0.0.1:{port}`,
        headers,
        "",
        entry.body,
      ].join("\n");
    })
    .join("\n\n");
}

describe("what DASH puts on the socket", () => {
  it("posts an approval as one JSON object, with mentions disabled", async () => {
    const message = buildDiscordMessage(
      {
        kind: "needs_approval",
        agent_id: "ai-agent-news",
        agent_title: "AI agent news",
        run_id: null,
      },
      buildOpenLink({ agent: "ai-agent-news", run: null }),
    );

    const outcome = await deliverDiscordMessage(base, message);
    expect(outcome).toEqual({ kind: "delivered", status: 204 });

    const request = received.at(-1) as Received;
    expect(request.method).toBe("POST");
    expect(request.headers["content-type"]).toBe("application/json");
    expect(request.headers["user-agent"]).toBe("OrchestrateDASH (local notifier)");

    // The exact body, as an object rather than as a string, so the assertion
    // fails on a *field* somebody added rather than on whitespace.
    expect(JSON.parse(request.body)).toEqual({
      content:
        "AI agent news is waiting for your approval.\n" +
        "In DASH: Agents → AI agent news\n" +
        "An installed copy of DASH on this computer opens that directly: dash://open?agent=ai-agent-news",
      allowed_mentions: { parse: [] },
    });
  });

  it("posts a report with the run in the link", async () => {
    const message = buildDiscordMessage(
      {
        kind: "new_report",
        agent_id: "ai-agent-news",
        agent_title: "AI agent news",
        run_id: "run-2026-08-10-01",
      },
      buildOpenLink({ agent: "ai-agent-news", run: "run-2026-08-10-01" }),
    );

    expect(await deliverDiscordMessage(base, message)).toEqual({ kind: "delivered", status: 204 });

    const request = received.at(-1) as Received;
    expect(JSON.parse(request.body)).toEqual({
      content:
        "AI agent news published a new report.\n" +
        "In DASH: Agents → AI agent news → latest output\n" +
        "An installed copy of DASH on this computer opens that directly: dash://open?agent=ai-agent-news&run=run-2026-08-10-01",
      allowed_mentions: { parse: [] },
    });
  });

  it("posts the test message", async () => {
    expect(await deliverDiscordMessage(base, buildTestMessage())).toEqual({
      kind: "delivered",
      status: 204,
    });
    const request = received.at(-1) as Received;
    expect(JSON.parse(request.body)).toEqual(buildTestMessage());
  });

  /**
   * No request DASH makes carries authentication of its own. The credential
   * *is* the URL — that is how a Discord webhook works — so an `authorization`
   * header would be a second secret nobody supplied, and the absence is worth
   * asserting because it is the shape a future "improvement" would break.
   */
  it("sends no credential header of its own", async () => {
    await deliverDiscordMessage(base, buildTestMessage());
    const request = received.at(-1) as Received;
    expect(request.headers["authorization"]).toBeUndefined();
    expect(request.headers["cookie"]).toBeUndefined();
  });
});

describe("what the transport makes of an answer", () => {
  it("reads a rate limit and the pause it asks for", async () => {
    answer = { status: 429, headers: { "retry-after": "2.5" } };
    const outcome = await deliverDiscordMessage(base, buildTestMessage());
    expect(outcome).toEqual({ kind: "rate_limited", status: 429, retry_after_ms: 2_500 });
  });

  it("clamps an absurd pause rather than parking the queue for an hour", async () => {
    answer = { status: 429, headers: { "retry-after": "86400" } };
    const outcome = await deliverDiscordMessage(base, buildTestMessage());
    expect(outcome.kind === "rate_limited" && outcome.retry_after_ms).toBe(60_000);
  });

  it("calls a deleted webhook a refusal, not a temporary problem", async () => {
    answer = { status: 404 };
    const outcome = await deliverDiscordMessage(base, buildTestMessage());
    expect(outcome.kind).toBe("rejected");
    // The one outcome that will not fix itself, so the sentence sends somebody
    // to the settings page rather than telling them DASH will try again.
    expect(outcome.kind === "rejected" && outcome.detail).toContain("Set it up again");
  });

  it("calls a server error worth retrying", async () => {
    answer = { status: 503 };
    expect((await deliverDiscordMessage(base, buildTestMessage())).kind).toBe("unavailable");
    answer = { status: 204 };
  });

  it("reports an unreachable host without naming it", async () => {
    // Port 1 on loopback, which nothing listens on. The detail a person and a
    // support log both read must not carry the address that failed — Node's own
    // error does, which is why this module discards it.
    const outcome = await deliverDiscordMessage(
      "http://127.0.0.1:1/api/webhooks/1/secret-token-here",
      buildTestMessage(),
      undefined,
      1_000,
    );
    expect(outcome.kind).toBe("unreachable");
    expect(JSON.stringify(outcome)).not.toContain("secret-token-here");
    expect(JSON.stringify(outcome)).not.toContain("127.0.0.1");
  });
});
