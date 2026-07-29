/**
 * The packaged renderer's origin (MAR-432, DASH-20).
 *
 * This is the module that decides which bytes on disk a renderer URL may reach,
 * which makes its refusals the interesting half. They are asserted here rather
 * than reasoned about in a comment beside a `protocol.handle` call, for the same
 * reason `lib/shell/window.ts` exists: a rule that can only be checked by
 * launching Electron is a rule that gets checked once.
 */

import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  RENDERER_ENTRY_URL,
  RENDERER_HOST,
  RENDERER_ORIGIN,
  RENDERER_SCHEME,
  resolveRendererRequest,
} from "../lib/shell/renderer-scheme";
import { isInsideInstallRoot } from "../lib/shell/install-layout";
import { isAllowedRendererUrl } from "../lib/shell/window";

const root = path.join(path.sep, "install", "renderer");

function resolve(url: string) {
  return resolveRendererRequest(root, url);
}

describe("the scheme itself", () => {
  it("is not the deep-link scheme", () => {
    // `dash:` is registered with the operating system and receives untrusted
    // strings from anywhere (ADR 0001 Amendment 3). An origin that rendered
    // privileged UI on the same scheme would blur those two jobs together.
    expect(RENDERER_SCHEME).not.toBe("dash");
    expect(RENDERER_ENTRY_URL.startsWith(`${RENDERER_ORIGIN}/`)).toBe(true);
  });
});

describe("resolveRendererRequest", () => {
  it("serves the entry page for the origin's root", () => {
    const resolution = resolve(RENDERER_ENTRY_URL);
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) {
      return;
    }
    expect(resolution.candidates).toEqual([path.join(root, "index.html")]);
    expect(resolution.contentType).toBe("text/html; charset=utf-8");
  });

  it("offers both shapes a static export may have written a page as", () => {
    const resolution = resolve(`${RENDERER_ORIGIN}/runs`);
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) {
      return;
    }
    expect(resolution.candidates).toEqual([
      path.join(root, "runs.html"),
      path.join(root, "runs", "index.html"),
    ]);
  });

  it("ignores the query string, which is the page's business and not the disk's", () => {
    const withParams = resolve(`${RENDERER_ORIGIN}/runs/detail?agent=a&run=r`);
    const without = resolve(`${RENDERER_ORIGIN}/runs/detail`);
    expect(withParams).toEqual(without);
  });

  it("serves an asset at its own extension", () => {
    const resolution = resolve(`${RENDERER_ORIGIN}/_next/static/chunk.js`);
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) {
      return;
    }
    expect(resolution.contentType).toBe("text/javascript; charset=utf-8");
  });

  it("refuses another scheme, including the deep-link one", () => {
    expect(resolve("https://example.com/index.html")).toEqual({
      ok: false,
      reason: "wrong_scheme",
    });
    expect(resolve("file:///etc/passwd")).toEqual({ ok: false, reason: "wrong_scheme" });
    expect(resolve("dash://handoff/whatever")).toEqual({ ok: false, reason: "wrong_scheme" });
  });

  it("refuses another host on our own scheme", () => {
    // Without this the scheme would have as many origins as there are
    // hostnames, all resolving against the same directory.
    expect(resolve(`${RENDERER_SCHEME}://elsewhere/index.html`)).toEqual({
      ok: false,
      reason: "wrong_host",
    });
  });

  /**
   * The property is "nothing outside the root is ever named", not "these inputs
   * are refused" — and the difference is worth keeping.
   *
   * URL parsing collapses most `..` segments before this module sees them, so a
   * test asserting refusal would mostly be asserting what the parser already
   * did, and would pass just as happily if the check here were deleted. Asserting
   * the resolved candidates instead holds the check itself: a hostile path may
   * legitimately come back as a harmless file inside the root, and may never come
   * back as a file outside it.
   *
   * `..\..` is in the list because it is the case the parser does *not* handle:
   * a backslash is an ordinary path character to a non-special scheme's URL
   * parser and a separator to Windows.
   */
  it("never names a file outside the renderer root", () => {
    for (const attempt of [
      "/../secrets.json",
      "/../../../../etc/passwd",
      "/_next/../../runner.key",
      "/%2e%2e/%2e%2e/dash.sqlite",
      "/a/../../b.html",
      "/..%5C..%5Crunner.key",
      "/....//....//runner.key",
    ]) {
      const resolution = resolve(`${RENDERER_ORIGIN}${attempt}`);
      if (!resolution.ok) {
        continue;
      }
      for (const candidate of resolution.candidates) {
        expect(
          isInsideInstallRoot(root, candidate),
          `${attempt} resolved to ${candidate}, which is outside the renderer root`,
        ).toBe(true);
      }
    }
  });

  it("refuses a NUL byte, which truncates a path further down the stack", () => {
    expect(resolve(`${RENDERER_ORIGIN}/index.html%00.png`)).toEqual({
      ok: false,
      reason: "unparseable",
    });
  });

  it("refuses a malformed escape rather than guessing at it", () => {
    expect(resolve(`${RENDERER_ORIGIN}/%E0%A4%A`)).toEqual({ ok: false, reason: "unparseable" });
  });

  it("refuses a file type nobody declared", () => {
    // Not octet-stream: an unreviewed extension appearing in the export means
    // the build started emitting something new, and that should be visible when
    // it happens rather than at the moment a browser declines to interpret it.
    expect(resolve(`${RENDERER_ORIGIN}/setup.exe`)).toEqual({
      ok: false,
      reason: "unsupported_type",
    });
    expect(resolve(`${RENDERER_ORIGIN}/dash.sqlite`)).toEqual({
      ok: false,
      reason: "unsupported_type",
    });
  });
});

describe("isAllowedRendererUrl, after MAR-432", () => {
  it("admits the renderer origin", () => {
    expect(isAllowedRendererUrl(RENDERER_ENTRY_URL)).toBe(true);
    expect(isAllowedRendererUrl(`${RENDERER_ORIGIN}/runs`)).toBe(true);
  });

  it("admits exactly one host on that scheme", () => {
    expect(isAllowedRendererUrl(`${RENDERER_SCHEME}://elsewhere/`)).toBe(false);
    expect(RENDERER_HOST).toBe("ui");
  });

  it("keeps the loopback developer path", () => {
    expect(isAllowedRendererUrl("http://127.0.0.1:3000")).toBe(true);
    expect(isAllowedRendererUrl("http://localhost:3000")).toBe(false);
  });

  it("no longer admits file:, which named any readable path on the machine", () => {
    expect(isAllowedRendererUrl("file:///C:/install/renderer/index.html")).toBe(false);
    expect(isAllowedRendererUrl("file:///etc/shadow")).toBe(false);
  });

  it("still refuses everything off-machine", () => {
    expect(isAllowedRendererUrl("https://example.com")).toBe(false);
    expect(isAllowedRendererUrl("http://10.0.0.5:3000")).toBe(false);
    expect(isAllowedRendererUrl("not a url")).toBe(false);
  });
});
