/**
 * The temporary loopback listener an OAuth redirect comes back to
 * (MAR-446, DASH-29).
 *
 * RFC 8252 gives an installed app two ways to receive an authorization code:
 * a private URI scheme, or a loopback redirect. DASH uses loopback, and ADR 0001
 * Amendment 8 records why — a scheme would need MSIX protocol registration to
 * work in the shipped app, which puts a Wave-0 feature behind human-gated
 * packaging work, and a flow that only worked under `pnpm dev` would be worse
 * than none.
 *
 * ## What this is not
 *
 * Amendment 7 listed "no new TCP listener" among the boundaries MAR-383
 * preserved. This is a listener, and Amendment 8 amends that line rather than
 * pretending it still holds. What keeps it a much smaller thing than the
 * runner's:
 *
 * - **`127.0.0.1` only.** Explicitly bound, never `0.0.0.0`. Nothing off this
 *   machine can reach it, even for the seconds it exists.
 * - **An ephemeral port.** Port 0, assigned by the OS, different every time.
 *   There is no port to find in a config file and no port to hold open.
 * - **One request, then gone.** It closes on the first callback that matches,
 *   on cancel, and on a five-minute timeout. It cannot outlive the sign-in.
 * - **One route.** `/callback` and nothing else; every other path is a 404 that
 *   settles nothing.
 * - **`state` is checked before anything is believed.** A request that does not
 *   carry the exact value DASH generated is answered and *ignored* — it is not
 *   treated as a failed sign-in, because it is not this sign-in.
 *
 * ## Why the response body is a fixed page
 *
 * The browser lands here after consent, so whatever this returns is rendered in
 * the user's browser. It is a static string with no interpolation: no code, no
 * state, no error text from the provider. A page that echoed any query parameter
 * would put an authorization code in the browser's history and DOM, and a page
 * that echoed provider-supplied text would render a stranger's HTML.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";

import { statesMatch } from "./pkce";

/** Why a loopback wait ended without a code. */
export type LoopbackFailureCode =
  /** The user pressed "Cancel" or closed the prompt window. */
  | "cancelled"
  /** The provider said the user declined consent. */
  | "denied"
  /** Nothing came back before the deadline. */
  | "timeout"
  /** The provider redirected with an error of its own. */
  | "provider_error";

export class LoopbackError extends Error {
  readonly code: LoopbackFailureCode;

  constructor(code: LoopbackFailureCode, message: string) {
    super(message);
    this.name = "LoopbackError";
    this.code = code;
  }
}

export function isLoopbackError(value: unknown): value is LoopbackError {
  return value instanceof LoopbackError;
}

/**
 * How long DASH waits for a person to finish signing in.
 *
 * Generous on purpose. A first-time Google sign-in can mean finding a password,
 * a second factor on a phone, and an "unverified app" interstitial to read — a
 * timeout tuned to a fast path would abandon exactly the users who most need the
 * flow to work.
 */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/** Rendered in the user's browser when the sign-in worked. */
const DONE_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Signed in</title>
<style>
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;
display:grid;place-items:center;min-height:100vh;background:#0f1115;color:#e8eaf0}
main{max-width:26rem;padding:2rem;text-align:center}
h1{font-size:1.25rem;margin:0 0 .5rem}p{margin:0;color:#a6adbb;line-height:1.5}
</style></head>
<body><main><h1>You're signed in</h1>
<p>You can close this tab and go back to DASH.</p></main></body></html>`;

/** Rendered when the provider came back with a refusal. */
const FAILED_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Not signed in</title>
<style>
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;
display:grid;place-items:center;min-height:100vh;background:#0f1115;color:#e8eaf0}
main{max-width:26rem;padding:2rem;text-align:center}
h1{font-size:1.25rem;margin:0 0 .5rem}p{margin:0;color:#a6adbb;line-height:1.5}
</style></head>
<body><main><h1>Nothing was connected</h1>
<p>You can close this tab. DASH will tell you what happened.</p></main></body></html>`;

export interface LoopbackListener {
  /**
   * The redirect URI to send to the authorization endpoint.
   *
   * Read after listening has started, so the OS-assigned port is known. Google
   * accepts any port on `127.0.0.1` for a Desktop client, which is what makes an
   * ephemeral one possible without registering it anywhere.
   */
  redirect_uri: string;
  /** Resolves with the authorization code, or rejects with `LoopbackError`. */
  wait(): Promise<string>;
  /**
   * Give up waiting and release the port.
   *
   * Safe to call more than once and safe to call after `wait` has settled, so
   * the caller can put it in a `finally` without tracking which of the several
   * ways a sign-in ends actually happened.
   */
  close(reason?: LoopbackFailureCode): void;
}

export interface LoopbackOptions {
  timeout_ms?: number;
  /** Injected for tests. Defaults to the real listen. */
  host?: string;
}

/**
 * Start listening, and hand back the URI to redirect to.
 *
 * Listening starts *before* the browser is opened, deliberately. Opening first
 * and binding after leaves a window in which the user could complete a sign-in
 * faster than DASH could get ready — rare, and a rare failure that only happens
 * to fast users is one nobody reproduces.
 */
export async function startLoopback(
  state: string,
  options: LoopbackOptions = {},
): Promise<LoopbackListener> {
  const host = options.host ?? "127.0.0.1";

  let settle: ((code: string) => void) | null = null;
  let fail: ((error: LoopbackError) => void) | null = null;
  let finished = false;

  const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
    // No `Host` trust and no routing beyond this. The URL is parsed against a
    // fixed base so a malformed request line cannot throw inside the handler.
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/callback") {
      response.writeHead(404, { "content-type": "text/plain", connection: "close" });
      response.end("Not found");
      return;
    }

    const received = url.searchParams.get("state") ?? "";
    if (!statesMatch(state, received)) {
      // Not this sign-in. Answered so the caller is not left hanging, and
      // deliberately not settled: some other process guessing the port must not
      // be able to end DASH's wait, and a real callback may still be coming.
      response.writeHead(400, { "content-type": "text/plain", connection: "close" });
      response.end("Unrecognised request");
      return;
    }

    const error = url.searchParams.get("error");
    const code = url.searchParams.get("code");

    if (error !== null || code === null) {
      response.writeHead(400, { "content-type": "text/html; charset=utf-8", connection: "close" });
      response.end(FAILED_PAGE);
      // `access_denied` is what Google sends when the user presses Cancel on the
      // consent screen, and it is not a fault — it gets its own code so the
      // Connection Center can say "nothing was connected" rather than describing
      // a failure the user caused on purpose.
      finish(
        null,
        new LoopbackError(
          error === "access_denied" ? "denied" : "provider_error",
          error === "access_denied"
            ? "The sign-in was cancelled."
            : "The sign-in service did not return an authorization.",
        ),
      );
      return;
    }

    response.writeHead(200, { "content-type": "text/html; charset=utf-8", connection: "close" });
    response.end(DONE_PAGE);
    finish(code, null);
  });

  function finish(code: string | null, error: LoopbackError | null): void {
    if (finished) {
      return;
    }
    finished = true;
    clearTimeout(timer);
    // `closeAllConnections` matters here: the browser holds the socket open
    // after the response, and `close` alone waits for it — which would keep the
    // port bound well past the moment DASH is done with it.
    server.closeAllConnections();
    server.close();
    if (error !== null) {
      fail?.(error);
    } else if (code !== null) {
      settle?.(code);
    }
  }

  const timer = setTimeout(() => {
    finish(null, new LoopbackError("timeout", "The sign-in was not finished in time."));
  }, options.timeout_ms ?? DEFAULT_TIMEOUT_MS);
  // Nothing about a pending sign-in should hold the process open at shutdown.
  timer.unref?.();

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, resolve);
  });

  const address = server.address() as AddressInfo;

  return {
    redirect_uri: `http://${host}:${String(address.port)}/callback`,
    wait: () =>
      new Promise<string>((resolve, reject) => {
        if (finished) {
          reject(new LoopbackError("cancelled", "The sign-in was cancelled."));
          return;
        }
        settle = resolve;
        fail = reject;
      }),
    close: (reason: LoopbackFailureCode = "cancelled") => {
      finish(null, new LoopbackError(reason, "The sign-in was cancelled."));
    },
  };
}
