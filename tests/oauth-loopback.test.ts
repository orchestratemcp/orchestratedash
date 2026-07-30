/**
 * The loopback redirect listener (MAR-446, DASH-29).
 *
 * Driven against a real listener on a real ephemeral port, with real requests —
 * not a mocked `http`. Every property worth asserting here is a property of the
 * socket: which interface it bound, whether the port was released, and what a
 * request that is not the one DASH is waiting for actually does.
 *
 * ADR 0001 Amendment 8 amends Amendment 7's "no new TCP listener" line, and the
 * argument it makes is that this listener is a much smaller thing than the
 * runner's. These tests are what make that argument checkable rather than
 * asserted.
 */

import { describe, expect, it } from "vitest";

import { isLoopbackError, startLoopback } from "../lib/oauth/loopback";
import { createState } from "../lib/oauth/pkce";

/** Fetch a path on the listener without following anything. */
async function call(redirectUri: string, query: string): Promise<Response> {
  const url = new URL(redirectUri);
  return fetch(`${url.origin}${url.pathname}${query}`);
}

describe("the loopback listener", () => {
  it("binds loopback only, on an ephemeral port", async () => {
    const state = createState();
    const listener = await startLoopback(state);

    try {
      const url = new URL(listener.redirect_uri);
      expect(url.hostname).toBe("127.0.0.1");
      expect(url.pathname).toBe("/callback");
      // Port 0 means the OS chose it. Anything in the registered range would
      // suggest a fixed port somebody could rely on.
      expect(Number(url.port)).toBeGreaterThan(1024);
    } finally {
      listener.close();
    }
  });

  it("delivers the code when the state matches", async () => {
    const state = createState();
    const listener = await startLoopback(state);
    const waiting = listener.wait();

    const response = await call(
      listener.redirect_uri,
      `?code=the-authorization-code&state=${encodeURIComponent(state)}`,
    );

    expect(await waiting).toBe("the-authorization-code");
    expect(response.status).toBe(200);
  });

  /**
   * The page is rendered in the user's browser, so anything it echoed would land
   * in browser history and the DOM. An authorization code there is a code
   * anything with access to the profile can read.
   */
  it("never echoes the code or the state into the page", async () => {
    const state = createState();
    const listener = await startLoopback(state);
    const waiting = listener.wait();

    const response = await call(
      listener.redirect_uri,
      `?code=super-secret-code&state=${encodeURIComponent(state)}`,
    );
    const body = await response.text();
    await waiting;

    expect(body).not.toContain("super-secret-code");
    expect(body).not.toContain(state);
  });

  /**
   * The guard that matters. Another local process can guess an ephemeral port;
   * what it cannot do is guess the state. A mismatched request must not be able
   * to end DASH's wait — not with a code of its own, and not by being treated as
   * a failed sign-in.
   */
  it("ignores a callback whose state does not match, and keeps waiting", async () => {
    const state = createState();
    const listener = await startLoopback(state);
    const waiting = listener.wait();

    const intruder = await call(listener.redirect_uri, "?code=injected&state=wrong-state");
    expect(intruder.status).toBe(400);

    // Still waiting: the real callback arrives afterwards and is the one that
    // settles it.
    const real = await call(
      listener.redirect_uri,
      `?code=the-real-code&state=${encodeURIComponent(state)}`,
    );
    expect(real.status).toBe(200);
    expect(await waiting).toBe("the-real-code");
  });

  it("answers anything that is not the callback route with a 404", async () => {
    const state = createState();
    const listener = await startLoopback(state);

    try {
      const url = new URL(listener.redirect_uri);
      expect((await fetch(`${url.origin}/`)).status).toBe(404);
      expect((await fetch(`${url.origin}/callback/../secrets`)).status).toBe(404);
    } finally {
      listener.close();
    }
  });

  /**
   * `access_denied` is what Google sends when somebody presses Cancel on the
   * consent screen. It is the outcome they asked for, and it gets its own code
   * so the copy does not describe it as a fault.
   */
  it("reports a declined consent as denied rather than as an error", async () => {
    const state = createState();
    const listener = await startLoopback(state);
    // The assertion is attached before the callback is sent, not after. The
    // rejection lands during the request below, and a handler added afterwards
    // would arrive a microtask too late — reported as an unhandled rejection
    // even though the test passes.
    const waiting = expect(listener.wait()).rejects.toMatchObject({ code: "denied" });

    await call(listener.redirect_uri, `?error=access_denied&state=${encodeURIComponent(state)}`);

    await waiting;
  });

  it("reports any other provider error separately", async () => {
    const state = createState();
    const listener = await startLoopback(state);
    const waiting = expect(listener.wait()).rejects.toMatchObject({ code: "provider_error" });

    await call(listener.redirect_uri, `?error=server_error&state=${encodeURIComponent(state)}`);

    await waiting;
  });

  it("gives up on its own deadline", async () => {
    const listener = await startLoopback(createState(), { timeout_ms: 30 });

    await expect(listener.wait()).rejects.toMatchObject({ code: "timeout" });
  });

  /**
   * The port must not survive the sign-in. A listener still bound after the flow
   * is exactly the long-lived surface Amendment 8 argues this is not.
   */
  it("releases the port once it has finished", async () => {
    const state = createState();
    const listener = await startLoopback(state);
    const waiting = listener.wait();
    const url = new URL(listener.redirect_uri);

    await call(listener.redirect_uri, `?code=done&state=${encodeURIComponent(state)}`);
    await waiting;

    await expect(fetch(`${url.origin}/callback`)).rejects.toThrow();
  });

  it("closes cleanly when cancelled, and cancelling twice is harmless", async () => {
    const listener = await startLoopback(createState());
    const waiting = listener.wait();

    listener.close();
    listener.close();

    await expect(waiting).rejects.toSatisfy(isLoopbackError);
  });
});
