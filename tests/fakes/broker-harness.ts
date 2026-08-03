/**
 * A broker with every impure thing replaced, plus a token planted for the tests
 * to hunt for (MAR-458).
 *
 * The planted token is the point. `tests/broker-threat-model.test.ts` does not
 * assert that the broker "does not leak a token" by reading the code; it plants
 * a distinctive string, drives the boundary from the agent's side, and then
 * searches everything that came back — the response, every audit row, every
 * thrown error — for that string. A leak of any kind fails, including one
 * through a path nobody thought of, which is the only kind worth testing for.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createBroker, type BrokerAuditRow, type CredentialRead } from "../../lib/broker/execute";
import type { ConnectionSourceManifest } from "../../lib/connections";
import { OAUTH_CREDENTIAL_VERSION, type OAuthCredential } from "../../lib/oauth/credential";
import { OAuthError } from "../../lib/oauth/flow";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function example(name: string): ConnectionSourceManifest {
  return JSON.parse(
    readFileSync(path.join(repoRoot, "examples", name), "utf8"),
  ) as ConnectionSourceManifest;
}

/**
 * The value that must never appear anywhere an agent or a table can see.
 *
 * Deliberately unmistakable. A four-character token could collide with a
 * substring of a base64 id and produce a false failure; this cannot appear by
 * accident in any output.
 */
export const PLANTED_ACCESS_TOKEN = "ya29.PLANTED-ACCESS-TOKEN-MUST-NEVER-ESCAPE";
export const PLANTED_REFRESH_TOKEN = "1//PLANTED-REFRESH-TOKEN-MUST-NEVER-ESCAPE";

export const GMAIL_READONLY = "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_COMPOSE = "https://www.googleapis.com/auth/gmail.compose";

export function credential(overrides: Partial<OAuthCredential> = {}): OAuthCredential {
  return {
    version: OAUTH_CREDENTIAL_VERSION,
    provider: "google",
    refresh_token: PLANTED_REFRESH_TOKEN,
    scopes: ["openid", "email", GMAIL_READONLY, GMAIL_COMPOSE],
    account: "henrik@example.com",
    obtained_at: "2026-08-02T09:00:00.000Z",
    ...overrides,
  };
}

export interface RecordedCall {
  url: string;
  method: string;
  /** Every header the broker sent, lowercased. Includes the authorization one. */
  headers: Record<string, string>;
  /**
   * The request body as it went on the wire, or null for a GET (MAR-469).
   *
   * A string rather than a parsed object, deliberately. The write tests decode
   * it themselves and read the RFC 5322 message out of it, because what is worth
   * asserting about a draft is the bytes DASH composed — the headers it wrote
   * and, much more importantly, the ones it did not.
   */
  body: string | null;
}

/** The RFC 5322 message inside a `drafts.create` body, decoded. */
export function composedMessage(call: RecordedCall): string {
  const parsed = JSON.parse(call.body ?? "{}") as { message?: { raw?: unknown } };
  const raw = parsed.message?.raw;
  return typeof raw === "string" ? Buffer.from(raw, "base64url").toString("utf8") : "";
}

export interface HarnessOptions {
  manifest?: ConnectionSourceManifest | null;
  credential?: CredentialRead;
  /** What the provider answers. A function so a test can vary it per call. */
  respond?: (call: RecordedCall, index: number) => { status: number; body: unknown };
  /** Throw from the token mint instead of returning one. */
  mintError?: OAuthError | Error;
  /**
   * The durable replay memory a write consults (MAR-469).
   *
   * A function rather than a set, so a test can model a DASH restart: two
   * brokers with no shared memory and one shared record of what was decided,
   * which is the only arrangement in which the durable half is the thing being
   * tested rather than the in-memory half.
   */
  hasHandledRequest?: (agentId: string, requestId: string) => boolean;
  /** A fixed clock, advanced by `advance`. */
  startedAt?: number;
}

export interface Harness {
  handle(agentId: string, request: unknown): Promise<unknown>;
  readonly calls: RecordedCall[];
  readonly audit: BrokerAuditRow[];
  advance(ms: number): void;
}

/**
 * Build a broker whose provider is a function and whose vault is an object.
 *
 * `handle` takes an `unknown` request on purpose. The tests hand it hostile
 * shapes — arrays, prototypes, missing fields — and a typed parameter would make
 * half of them un-writable, which is exactly the half worth writing.
 */
export function harness(options: HarnessOptions = {}): Harness {
  const calls: RecordedCall[] = [];
  const audit: BrokerAuditRow[] = [];
  let clock = options.startedAt ?? Date.parse("2026-08-02T10:00:00.000Z");

  const manifest =
    options.manifest === undefined
      ? example("gmail-meeting-assistant.manifest.v2.example.json")
      : options.manifest;

  const read: CredentialRead = options.credential ?? { kind: "found", credential: credential() };

  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[key.toLowerCase()] = value;
    }
    const recorded: RecordedCall = {
      url: String(url),
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? init.body : null,
    };
    calls.push(recorded);

    const answered = options.respond?.(recorded, calls.length - 1) ?? {
      status: 200,
      body: { messages: [{ id: "18e0a1", threadId: "18e0a0" }] },
    };

    return new Response(
      typeof answered.body === "string" ? answered.body : JSON.stringify(answered.body),
      { status: answered.status, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;

  const broker = createBroker({
    readManifest: () => manifest,
    readCredential: () => Promise.resolve(read),
    mintAccessToken: () => {
      if (options.mintError !== undefined) {
        return Promise.reject(options.mintError);
      }
      return Promise.resolve({ access_token: PLANTED_ACCESS_TOKEN });
    },
    fetchImpl,
    hasHandledRequest: options.hasHandledRequest,
    audit: (row) => {
      audit.push(row);
    },
    now: () => new Date(clock),
  });

  return {
    calls,
    audit,
    advance: (ms: number) => {
      clock += ms;
    },
    handle: (agentId, request) =>
      broker.handle(agentId, request as Parameters<typeof broker.handle>[1]),
  };
}

/**
 * Every string reachable from a value, flattened.
 *
 * Used to search a response, an audit row or an error for a planted token
 * without assuming where it might be. A check that looked only at named fields
 * would miss the leak that matters, which is the one in a field nobody expected
 * to exist.
 */
export function everyString(value: unknown, depth = 0): string[] {
  if (depth > 12) {
    return [];
  }
  if (typeof value === "string") {
    return [value];
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return [String(value)];
  }
  if (value instanceof Error) {
    return [value.message, value.stack ?? "", ...everyString({ ...value }, depth + 1)];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => everyString(entry, depth + 1));
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => [
      key,
      ...everyString(entry, depth + 1),
    ]);
  }
  return [];
}
