/**
 * `fetch`, spoken down the stdio of a child process (MAR-484, ADR 0007).
 *
 * The third dialer, and the same move `lib/agent-dom/ipc-fetch.ts` made twice
 * already. `lib/agent-dom/transport.ts` is written against one seam — an
 * injectable `fetch` — and everything valuable in it hangs off that seam: the
 * byte ceiling, the timeout, the scrubbed `detail`, the never-quote-the-token
 * rule, the `unavailable`/`failed` taxonomy. MAR-430 moved the local runner off
 * TCP by writing one file and changing none of that. ADR 0007 carries the
 * control plane to a host the same way.
 *
 * ## Nothing listens, on either machine
 *
 * ADR 0007 rejected a forwarded loopback port (`ssh -L`) for MAR-430's own
 * reason: the near end of a forwarded port is a TCP listener on *this* machine,
 * reachable by every process on it, with a bearer token in front of it — which
 * is exactly what MAR-430 deleted, now pointed at a host the user is paying for
 * and not watching. So there is no port here. DASH spawns `ssh host connect`,
 * the host's helper joins its own runner socket to that command's stdio, and
 * HTTP is spoken over the pipe between them. The connection is outbound TCP to
 * port 22 and the host never initiates anything.
 *
 * ## Why this is not an HTTP parser
 *
 * It would be very easy to write one and wrong to. `node:http`'s client takes a
 * `createConnection` that may return **any duplex stream**, not only a socket —
 * so the request line, the header encoding, chunked transfer, the response
 * parser and every edge case around them are Node's, byte for byte the same
 * code that serves the local runner. What this module contributes is a duplex
 * over a child's stdin and stdout, and a few no-op socket methods the HTTP
 * client expects to be able to call.
 *
 * That is what makes ADR 0007's claim about CI true and precise: a test spawns
 * a local child that speaks HTTP over its own stdio and exercises the whole
 * path with no `ssh`, no host and no network. **The only variable between the
 * CI proof and the attended one is which process is on the other end of the
 * pipe.**
 *
 * ## One connection per request, deliberately
 *
 * `ssh` is spawned per request rather than kept open and multiplexed. A pooled
 * connection would be faster and would make the failure model much worse: a
 * half-dead `ssh` would fail requests in ways that look like a runner problem,
 * and a pool needs a health model DASH does not have for a machine it polls
 * every few seconds anyway. The cost is one process per poll against a host,
 * which is the same order as the poll interval itself.
 */

import http from "node:http";
import { Duplex, Readable, type Writable } from "node:stream";

/**
 * A started child, reduced to what this module uses.
 *
 * Not `ChildProcess`, so a test can hand over a pair of streams without
 * spawning anything, and so this module never grows an opinion about how the
 * process was started. `electron/ssh-host.ts` owns that.
 */
export interface StdioChannel {
  stdin: Writable;
  stdout: Readable;
  /** Stop the child. Called on abort and on transport failure. */
  close: () => void;
}

/** How one request gets a process to talk to. Called once per request. */
export type OpenStdioChannel = () => StdioChannel;

/**
 * Build a `fetch` that speaks HTTP over a freshly opened stdio channel.
 *
 * The returned function honours the URL's path, method, headers, body and
 * `AbortSignal` and ignores its authority — the same contract `ipcFetch` has,
 * for the same reason: the authority is a placeholder and the transport decides
 * where the bytes go.
 */
export function stdioFetch(open: OpenStdioChannel): typeof globalThis.fetch {
  return async function stdioFetchImpl(
    input: RequestInfo | URL,
    init: RequestInit = {},
  ): Promise<Response> {
    const url = new URL(typeof input === "string" ? input : input.toString());

    return new Promise<Response>((resolve, reject) => {
      let channel: StdioChannel;
      try {
        channel = open();
      } catch (error: unknown) {
        reject(asFetchError(error));
        return;
      }

      /**
       * Whether the caller already has a `Response`.
       *
       * The same race `ipc-fetch.ts` documents, and worse here: the far end may
       * answer and the pipe may then break while this side is still writing. A
       * write error after the answer arrived is not actionable — the caller has
       * the server's decision, which is what it asked for.
       */
      let settled = false;
      const finish = (): void => {
        try {
          channel.close();
        } catch {
          // Closing a channel that is already gone is not a failure worth
          // surfacing over whatever the caller is actually being told.
        }
      };

      const request = http.request(
        {
          // The authority is never resolved: `createConnection` decides where
          // the bytes go, exactly as `socketPath` does for the local runner.
          createConnection: () => asSocket(channel),
          path: `${url.pathname}${url.search}`,
          method: init.method ?? "GET",
          headers: {
            host: url.host,
            // Nothing about this transport can keep a connection alive: the
            // channel is one process and it ends with the response.
            connection: "close",
            ...normaliseHeaders(init.headers),
          },
        },
        (message) => {
          const status = message.statusCode ?? 502;
          settled = true;
          message.on("end", finish);
          message.on("close", finish);
          resolve(
            new Response(
              BODILESS.has(status) ? null : (Readable.toWeb(message) as ReadableStream<Uint8Array>),
              { status, statusText: message.statusMessage, headers: collectHeaders(message.headers) },
            ),
          );
        },
      );

      request.on("error", (error: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        finish();
        reject(asFetchError(error));
      });

      const signal = init.signal;
      if (signal !== null && signal !== undefined) {
        if (signal.aborted) {
          settled = true;
          request.destroy();
          finish();
          reject(abortError());
          return;
        }
        // `transport.ts` tells a timeout from an unreachable endpoint purely by
        // `error.name === "AbortError"`, so the abort path must produce exactly
        // that — and `settled` is set before `destroy` so the teardown's own
        // error cannot overwrite the reason.
        signal.addEventListener(
          "abort",
          () => {
            const first = !settled;
            settled = true;
            request.destroy();
            finish();
            if (first) {
              reject(abortError());
            }
          },
          { once: true },
        );
      }

      const body = init.body;
      if (typeof body === "string") {
        request.end(body);
        return;
      }
      if (body === null || body === undefined) {
        request.end();
        return;
      }
      // The only bodies this transport sends are JSON strings built by
      // `lib/agent-dom/envelope.ts`. Anything else is a caller bug, and sending
      // an empty body instead would turn it into a confusing refusal from a
      // runner on a machine nobody is looking at.
      request.destroy();
      finish();
      reject(new TypeError("The stdio transport sends string bodies only."));
    });
  } as typeof globalThis.fetch;
}

/** Statuses the `Response` constructor forbids a body on. */
const BODILESS = new Set([101, 103, 204, 205, 304]);

/**
 * Present a child's two pipes to `node:http` as the socket it expects.
 *
 * The HTTP client calls a handful of socket-shaped methods on whatever
 * `createConnection` returns — `setKeepAlive`, `setNoDelay`, `setTimeout`,
 * `ref`, `unref`. A `Duplex` has none of them, and the failure if they are
 * missing is a `TypeError` deep inside `_http_client` that says nothing about
 * this file. They are no-ops rather than approximations: there is no Nagle
 * algorithm on a pipe to disable and no keep-alive to configure, and pretending
 * otherwise by implementing them would be inventing behaviour.
 *
 * `setTimeout` is the one that matters and it is *still* a no-op, because the
 * timeout that governs this transport is `transport.ts`'s `AbortSignal` — one
 * deadline, applied identically to every dialer. A second timer here would give
 * a remote channel a different timeout story from a local one, which is the
 * kind of divergence the injectable-`fetch` seam exists to prevent.
 */
function asSocket(channel: StdioChannel): Duplex {
  const duplex = Duplex.from({ readable: channel.stdout, writable: channel.stdin }) as Duplex &
    Record<string, unknown>;
  duplex["setKeepAlive"] = () => duplex;
  duplex["setNoDelay"] = () => duplex;
  duplex["setTimeout"] = () => duplex;
  duplex["ref"] = () => duplex;
  duplex["unref"] = () => duplex;
  // `node:http` reads this when it builds an error; absent it prints
  // "undefined" into a message somebody will one day paste into an issue.
  duplex["remoteAddress"] = undefined;
  return duplex;
}

/** `Response` needs a `Headers`; `node:http` gives an object with array values. */
function collectHeaders(source: http.IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item);
      }
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

/** Accept every shape `HeadersInit` allows, since callers use two of them. */
function normaliseHeaders(source: HeadersInit | undefined): Record<string, string> {
  if (source === undefined) {
    return {};
  }
  const out: Record<string, string> = {};
  new Headers(source).forEach((value, name) => {
    out[name] = value;
  });
  return out;
}

function abortError(): Error {
  const error = new Error("The request was aborted.");
  error.name = "AbortError";
  return error;
}

/**
 * Present a pipe failure the way `fetch` would.
 *
 * `describeTransportError` never quotes an error's message — a thrown transport
 * error can carry the request, and these requests carry a bearer header — so
 * this only has to preserve the *class* of failure. It matters more here than
 * it did for a socket: an `ssh` failure's text can name a host, a user, a port
 * and a key path.
 */
function asFetchError(error: unknown): Error {
  const wrapped = new TypeError("fetch failed");
  wrapped.cause = error;
  return wrapped;
}
