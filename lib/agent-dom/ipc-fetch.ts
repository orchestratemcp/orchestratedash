/**
 * `fetch`, spoken down a Unix socket or a Windows named pipe.
 *
 * `lib/agent-dom/transport.ts` is written against one seam — an injectable
 * `fetch` — and everything valuable in it hangs off that seam: the byte
 * ceiling, the timeout, the scrubbed `detail`, the never-quote-the-token rule,
 * the `unavailable`/`failed` taxonomy. MAR-430 moves the local runner off TCP,
 * and the cheapest honest way to do that is to keep every one of those
 * properties and change only *how the bytes travel*.
 *
 * So this module is a `fetch`-shaped function over `node:http`, which accepts a
 * `socketPath` in place of a host and a port and speaks the same HTTP either
 * way. Nothing above it branches on transport: `httpAdapter` and
 * `fetchAgentDomState` are unchanged, and the runner's server is unchanged.
 *
 * Global `fetch` cannot do this. Undici resolves a URL to a TCP connection, and
 * there is no standard way to hand it a pipe — which is the entire reason this
 * file exists rather than an option object somewhere.
 *
 * ## The URL is a placeholder, and a deliberately unresolvable one
 *
 * An IPC request still needs a URL, because HTTP has a request line and the
 * caller builds `${uri}/commands` by concatenation. The host in it is never
 * looked up: `socketPath` decides where the bytes go. `IPC_ORIGIN` therefore
 * uses the reserved `.invalid` TLD (RFC 6761), which is guaranteed never to
 * resolve — so if one of these URLs ever leaks into a real `fetch` through a
 * future refactor, it fails closed instead of quietly reaching the network.
 */

import http from "node:http";
import { Readable } from "node:stream";

/**
 * The origin every IPC control location carries.
 *
 * Not a real host and not meant to become one. See the note above on `.invalid`.
 */
export const IPC_ORIGIN = "http://runner.orchestratedash.invalid";

/** Statuses the `Response` constructor forbids a body on. */
const BODILESS = new Set([101, 103, 204, 205, 304]);

/**
 * Sockets may be reused by Node's HTTP agent.
 *
 * Each needs one lifetime guard for a late write error, but only one: adding a
 * request-scoped listener on every poll leaks listeners, while removing it when
 * the request closes is too early on Linux, where an EPIPE can arrive just
 * afterwards.
 */
const GUARDED_SOCKETS = new WeakSet<object>();

/**
 * Build a `fetch` bound to one endpoint path.
 *
 * The returned function ignores the URL's authority and honours its path,
 * method, headers, body and `AbortSignal` — the whole of what
 * `lib/agent-dom/transport.ts` actually uses.
 */
export function ipcFetch(socketPath: string): typeof globalThis.fetch {
  return async function ipcFetchImpl(
    input: RequestInfo | URL,
    init: RequestInit = {},
  ): Promise<Response> {
    const url = new URL(typeof input === "string" ? input : input.toString());

    return new Promise<Response>((resolve, reject) => {
      /**
       * Whether a `Response` has already been handed to the caller.
       *
       * This matters more over a socket than it did over TCP. A server may
       * answer — 413 on an oversized body, say — while the client is still
       * writing that body, and the write then fails with `EPIPE`. Over
       * loopback TCP the kernel buffer usually swallowed the whole request
       * first and the race never showed; a Unix socket's buffer is smaller,
       * and CI found it.
       *
       * A write error after the answer arrived is not actionable: the caller
       * already has the server's decision, which is the thing it asked for.
       * Rejecting would be wrong and letting it escape as an unhandled error
       * would take the process down over a refusal that worked correctly.
       */
      let settled = false;

      const request = http.request(
        {
          socketPath,
          path: `${url.pathname}${url.search}`,
          method: init.method ?? "GET",
          headers: {
            // A `Host` is required by HTTP/1.1 and means nothing here. It is
            // the placeholder authority rather than a real name so that
            // nothing downstream can mistake it for one.
            host: url.host,
            ...normaliseHeaders(init.headers),
          },
        },
        (message) => {
          const status = message.statusCode ?? 502;
          settled = true;
          resolve(
            new Response(
              BODILESS.has(status) ? null : (Readable.toWeb(message) as ReadableStream<Uint8Array>),
              {
                status,
                statusText: message.statusMessage,
                headers: collectHeaders(message.headers),
              },
            ),
          );
        },
      );

      request.on("error", (error: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        reject(asFetchError(error));
      });

      // A failed write can surface on the socket rather than on the request,
      // and an `error` event with no listener at all is an uncaught exception.
      // Merely having this listener is most of the point; when the response is
      // already in hand the socket is also finished with, so it is released.
      //
      request.on("socket", (socket) => {
        if (GUARDED_SOCKETS.has(socket)) {
          return;
        }
        GUARDED_SOCKETS.add(socket);
        socket.on("error", () => {
          // The request's own error listener rejects an unsettled call. This
          // socket-level listener exists for the later error, after a response
          // has already settled the call and there is nothing left to reject.
          socket.destroy();
        });
      });

      const signal = init.signal;
      if (signal !== null && signal !== undefined) {
        if (signal.aborted) {
          settled = true;
          request.destroy();
          reject(abortError());
          return;
        }
        // `transport.ts` distinguishes a timeout from an unreachable endpoint
        // purely by `error.name === "AbortError"`, so the abort path must
        // produce exactly that and not a generic socket error — which is also
        // why `settled` is set before `destroy`, so the teardown's own error
        // does not overwrite the reason.
        signal.addEventListener(
          "abort",
          () => {
            const first = !settled;
            settled = true;
            request.destroy();
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
      // `lib/agent-dom/envelope.ts`. Anything else is a caller bug, and
      // silently sending an empty body would turn it into a confusing refusal
      // from the runner instead of an error here.
      request.destroy();
      reject(new TypeError("The IPC transport sends string bodies only."));
    });
  } as typeof globalThis.fetch;
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
 * Present a socket failure the way `fetch` would.
 *
 * `describeTransportError` never quotes an error's message — a thrown transport
 * error can carry the request, and these requests carry a bearer header — so
 * this only has to preserve the *class* of failure, not its text.
 */
function asFetchError(error: unknown): Error {
  const wrapped = new TypeError("fetch failed");
  wrapped.cause = error;
  return wrapped;
}
