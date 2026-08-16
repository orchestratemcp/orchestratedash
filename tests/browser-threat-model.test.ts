/**
 * The controlled browser's boundary, attacked (MAR-628, ADR 0019).
 *
 * `tests/broker-threat-model.test.ts` is the model for this file and the
 * argument transfers whole: the interesting questions are all about what an
 * untrusted input becomes, and both halves — the operation catalogue and the
 * origin allowlist — are pure functions. So there is no Electron here, no
 * Chromium, no window, no debugger and no network. What is being attacked is
 * the decision, which is the thing that has to be right.
 *
 * The catalogue is asserted **by value**, which is the point of the file. ADR
 * 0019 says raw CDP, arbitrary JavaScript, key presses and synthetic input must
 * be unreachable for an agent; the way that is kept true is that adding any of
 * them is a one-line diff in a file whose test reads the array out loud.
 */

import { describe, expect, it } from "vitest";

import {
  BROWSER_OPERATIONS,
  browserOperationById,
  projectReading,
  MAX_PAGE_TEXT_CHARS,
} from "../lib/browser/operations";
import {
  decideRequest,
  describeReach,
  parseDeclaredOrigins,
  trailUrl,
} from "../lib/browser/origins";
import { parseBrowserRequest } from "../lib/browser/protocol";

describe("the operation catalogue, by value", () => {
  it("is exactly the two operations slice 1 shipped", () => {
    // The conversation this array exists to force. A third entry here is a
    // widening of what an agent can make a browser do, and it should not be
    // possible to land one without changing this line.
    expect(BROWSER_OPERATIONS.map((operation) => operation.id)).toEqual([
      "browser.open",
      "browser.read",
    ]);
  });

  it("contains no operation that dispatches an input event", () => {
    // `BrowserAccess` has an `input` member and nothing in the shipped
    // catalogue carries it. That is the assertion: a person reading this can
    // conclude that the browser a person is watching cannot type, click or
    // submit, because no operation exists that would.
    expect(BROWSER_OPERATIONS.every((operation) => operation.access === "read")).toBe(true);
  });

  it("has no operation that needs a person, because none of them dispatches input", () => {
    // Recorded rather than assumed. When the first `click` arrives it arrives
    // with `approval_required: true` and this line goes red, which is the
    // review event ADR 0019 amendment 1 names as its precondition.
    expect(BROWSER_OPERATIONS.every((operation) => !operation.approval_required)).toBe(true);
  });

  it("does not resolve the operations nobody built", () => {
    for (const id of [
      "browser.click",
      "browser.type",
      "browser.evaluate",
      "browser.press",
      "browser.screenshot",
      "browser.cookies",
      "Runtime.evaluate",
      "Page.navigate",
    ]) {
      expect(browserOperationById(id)).toBeNull();
    }
  });

  it("gives read no field an agent could put a selector or a script in", () => {
    const read = browserOperationById("browser.read");
    const resolved = read?.resolve({
      selector: "#main",
      expression: "fetch('https://evil.test')",
      xpath: "//div",
      frame: "0",
    });
    // Everything supplied is ignored, and what comes back carries nothing.
    expect(resolved).toEqual({ ok: true, gesture: { kind: "read_page" } });
  });
});

describe("browser.open narrows the one value an agent supplies", () => {
  const open = browserOperationById("browser.open");

  it("refuses a URL that is not a string, and does not coerce one", () => {
    for (const url of [{}, [], 42, true, null]) {
      const resolved = open?.resolve({ url });
      expect(resolved?.ok).toBe(false);
    }
  });

  it("refuses every scheme but https", () => {
    for (const url of [
      "http://example.com/a",
      "file:///etc/passwd",
      "javascript:fetch('https://evil.test')",
      "data:text/html,<script>1</script>",
      "blob:https://example.com/x",
      "chrome://settings",
      "ftp://example.com",
    ]) {
      expect(open?.resolve({ url })).toMatchObject({ ok: false });
    }
  });

  it("refuses credentials in the authority", () => {
    expect(open?.resolve({ url: "https://user:secret@example.com/a" })).toMatchObject({
      ok: false,
    });
  });

  it("refuses a relative URL rather than resolving it against wherever the view is", () => {
    // The destination must be a function of the request and never of the page,
    // because the page is the untrusted party.
    expect(open?.resolve({ url: "/other-article" })).toMatchObject({ ok: false });
  });

  it("normalises what it accepts, so the check and the load see one string", () => {
    const resolved = open?.resolve({ url: "https://EXAMPLE.com:443/a/../b?x=1#f" });
    expect(resolved).toEqual({
      ok: true,
      gesture: { kind: "navigate", url: "https://example.com/b?x=1#f" },
    });
  });
});

describe("origins are origins, not prefixes", () => {
  const declared = parseDeclaredOrigins(["https://example.com"]);
  const origins = declared.ok ? declared.origins : [];

  it("refuses the hostnames a prefix match would have accepted", () => {
    // The whole reason ADR 0019 names this failure first. Every one of these is
    // a hostname somebody can register today.
    for (const url of [
      "https://example.com.attacker.test/a",
      "https://example.com.co/a",
      "https://notexample.com/a",
      "https://example.company/a",
      "https://evil.test/?u=https://example.com",
      "https://evil.test/#https://example.com",
    ]) {
      expect(decideRequest(origins, url, "top_level")).toMatchObject({ allowed: false });
    }
  });

  it("allows the declared origin and its own paths", () => {
    expect(decideRequest(origins, "https://example.com/a/b/c", "top_level")).toEqual({
      allowed: true,
      origin: "https://example.com",
    });
  });

  it("treats a subdomain as a different origin, because it is one", () => {
    expect(decideRequest(origins, "https://cdn.example.com/x.css", "subresource")).toMatchObject({
      allowed: false,
      reason: "origin_not_declared",
    });
  });

  it("holds a subresource to the same list as a navigation", () => {
    // Checking only top-level navigation would leave the card claiming a
    // destination list while the browser could still talk anywhere.
    expect(decideRequest(origins, "https://tracker.test/pixel.gif", "subresource")).toMatchObject({
      allowed: false,
    });
  });

  it("refuses a port that was not declared", () => {
    expect(decideRequest(origins, "https://example.com:8443/a", "top_level")).toMatchObject({
      allowed: false,
    });
  });
});

describe("what a manifest may declare", () => {
  it("refuses a path, rather than accepting it and widening it to the host", () => {
    // The failure this refusal prevents: the manifest, the card and the person
    // all read a directory while the browser has the whole host.
    expect(parseDeclaredOrigins(["https://example.com/news"])).toMatchObject({
      ok: false,
      refusal: "has_path",
    });
  });

  it("refuses http, a query, a fragment and credentials", () => {
    expect(parseDeclaredOrigins(["http://example.com"])).toMatchObject({ refusal: "not_https" });
    expect(parseDeclaredOrigins(["https://example.com/?a=1"])).toMatchObject({
      refusal: "has_path",
    });
    expect(parseDeclaredOrigins(["https://example.com/#x"])).toMatchObject({
      refusal: "has_path",
    });
    expect(parseDeclaredOrigins(["https://a:b@example.com"])).toMatchObject({
      refusal: "has_credentials",
    });
  });

  it("normalises so one origin cannot appear twice under two spellings", () => {
    const parsed = parseDeclaredOrigins([
      "https://EXAMPLE.com",
      "https://example.com:443",
      "https://example.com",
    ]);
    expect(parsed).toEqual({ ok: true, origins: ["https://example.com"] });
  });

  it("refuses a list longer than DASH will open, rather than truncating it", () => {
    const many = Array.from({ length: 13 }, (_, index) => `https://host${String(index)}.test`);
    expect(parseDeclaredOrigins(many)).toMatchObject({ ok: false, refusal: "too_many" });
  });
});

describe("what reaches the trail and the agent", () => {
  it("drops the query string from a URL it writes down", () => {
    // An article URL routinely carries a session id, a tracking parameter and
    // occasionally somebody's email address.
    expect(trailUrl("https://example.com/a?session=abc&email=x%40y.test#frag")).toBe(
      "https://example.com/a",
    );
  });

  it("returns null for a URL it cannot read, rather than the attacker's string", () => {
    expect(trailUrl("not a url")).toBeNull();
    expect(trailUrl("")).toBeNull();
  });

  it("bounds page text and says so rather than truncating silently", () => {
    const read = browserOperationById("browser.read");
    const projected = projectReading(read!, {
      url: "https://example.com/a",
      title: "t",
      text: "x".repeat(MAX_PAGE_TEXT_CHARS + 10),
    });
    expect(String(projected["text"]).length).toBe(MAX_PAGE_TEXT_CHARS);
    // The field exists so an agent cannot summarise the first third of a
    // document and report it as the whole.
    expect(projected["truncated"]).toBe(true);
  });

  it("carries no HTML, cookie, header or status code", () => {
    const read = browserOperationById("browser.read");
    const projected = projectReading(read!, {
      url: "https://example.com/a",
      title: "t",
      text: "hello",
    });
    expect(Object.keys(projected).sort()).toEqual(["text", "title", "truncated", "url"]);
  });

  it("says DASH limited the browser, never that the agent could only go here", () => {
    const sentence = describeReach(2);
    expect(sentence).toContain("DASH kept the browser it opened");
    expect(sentence).toContain("not the agent");
    // The claim ADR 0019 forbids, in the words somebody would reach for.
    expect(sentence).not.toContain("could only visit");
  });
});

describe("the request envelope", () => {
  it("refuses a candidate with no operation, and one with a newline in an id", () => {
    expect(parseBrowserRequest({ request_id: "a" })).toBeNull();
    expect(parseBrowserRequest({ request_id: "a\nb", operation: "browser.open" })).toBeNull();
    expect(parseBrowserRequest({ request_id: "a", operation: "browser open" })).toBeNull();
  });

  it("has no field in which an agent could name a session", () => {
    const parsed = parseBrowserRequest({
      request_id: "a",
      operation: "browser.open",
      session_id: "bs-1",
      agent: "somebody-else",
      input: { url: "https://example.com/a" },
    });
    // The extra keys are not carried anywhere: the parsed shape has three
    // members, and which session and which agent a request belongs to are
    // decided by which child process wrote the line.
    expect(Object.keys(parsed ?? {}).sort()).toEqual(["input", "operation", "request_id"]);
  });

  it("gives the input a null prototype, so __proto__ resolves to nothing", () => {
    const parsed = parseBrowserRequest({
      request_id: "a",
      operation: "browser.open",
      input: { ["__proto__"]: { url: "https://evil.test" } },
    });
    expect(parsed?.input["url"]).toBeUndefined();
  });
});
