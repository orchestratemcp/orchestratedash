import { describe, expect, it } from "vitest";

import { inspectOutboundLink } from "../lib/shell/outbound";

/**
 * The gate on the one route out of DASH's window (MAR-698).
 *
 * `electron/open-out.ts` is what performs the open and cannot be unit-tested —
 * it needs an Electron main process and a machine willing to launch a browser.
 * The decision is separated from the act precisely so that this file can exist,
 * and this file is the reason the separation is worth its extra module.
 *
 * What is *not* tested here is that model-authored prose never reaches this
 * function. That property is structural and lives in the renderer, and
 * `tests/brief-render.test.tsx` and `tests/deep-dive-render.test.tsx` hold it:
 * a URL inside a paragraph is drawn as characters with no anchor around it, so
 * there is nothing to click. This gate would happily open an `https` address a
 * model wrote. It is never offered one, and neither half stands in for the
 * other.
 */
describe("what DASH will hand to the operating system", () => {
  it("opens an ordinary secure address", () => {
    expect(inspectOutboundLink("https://news.test/prices")).toEqual({
      ok: true,
      url: "https://news.test/prices",
    });
  });

  it("keeps a query string and a fragment, which are part of the address", () => {
    // A feed item's address routinely carries both, and an item URL that lost
    // its query would land on a different page than the one the agent read.
    const review = inspectOutboundLink("https://news.test/a?id=7&ref=feed#section-2");
    expect(review).toMatchObject({ ok: true });
  });

  /*
   * The two that matter most.
   *
   * `shell.openExternal` hands the string to the operating system, which has a
   * handler for far more than the web. Neither of these is inert by nature —
   * each is inert because this function refuses it.
   */
  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///C:/Windows/System32/cmd.exe",
    "dash://agents/ai-news-scout",
    "mailto:someone@example.test",
    "vbscript:msgbox(1)",
    "ms-msdt:/id",
  ])("refuses %s", (candidate) => {
    expect(inspectOutboundLink(candidate)).toMatchObject({ ok: false, refusal: "not_https" });
  });

  /*
   * Refused, and the cost is real rather than free: a feed publishing plain
   * `http` item addresses loses its links and keeps its headlines. It is
   * refused anyway because nobody typed this address — it arrived in a
   * collected row — so DASH would be opening a downgraded connection on
   * somebody's behalf without saying so.
   */
  it("refuses plain http, which is the one refusal that costs something", () => {
    expect(inspectOutboundLink("http://news.test/prices")).toMatchObject({
      ok: false,
      refusal: "not_https",
    });
  });

  it("refuses a scheme spelled to look like the allowed one", () => {
    // `HTTPS:` parses to the same protocol and is fine; `https\n:` and
    // `httpss:` are not the scheme and must not be read as near enough.
    expect(inspectOutboundLink("HTTPS://news.test/prices")).toMatchObject({ ok: true });
    expect(inspectOutboundLink("httpss://news.test")).toMatchObject({ ok: false });
    expect(inspectOutboundLink(" javascript:alert(1)")).toMatchObject({ ok: false });
  });

  it("refuses a relative address, which has nothing to be relative to out here", () => {
    expect(inspectOutboundLink("/agents/detail?agent=ai-news-scout")).toMatchObject({
      ok: false,
      refusal: "malformed",
    });
    expect(inspectOutboundLink("news.test/prices")).toMatchObject({ ok: false });
  });

  it("refuses a secure address that names nowhere", () => {
    // WHATWG parsing throws for a special scheme with no host, so these land in
    // the malformed branch rather than in the hostname one. `https:///prices`
    // is deliberately absent from this list: it parses to the host `prices`,
    // which is an address naming somewhere and is opened.
    expect(inspectOutboundLink("https://")).toMatchObject({
      ok: false,
      refusal: "malformed",
    });
    expect(inspectOutboundLink("https://?a=1")).toMatchObject({ ok: false });
  });

  it("refuses anything that is not a string, because every caller is downstream of a page", () => {
    for (const candidate of [undefined, null, 42, {}, ["https://news.test"], ""]) {
      expect(inspectOutboundLink(candidate)).toMatchObject({ ok: false, refusal: "malformed" });
    }
  });

  it("refuses an address too long to be one", () => {
    expect(inspectOutboundLink(`https://news.test/${"a".repeat(4000)}`)).toMatchObject({
      ok: false,
      refusal: "too_long",
    });
  });

  /**
   * What leaves is what was parsed, not what came in.
   *
   * The property that matters for a gate: an address whose two readings
   * disagree must not have one of them checked and the other one opened.
   */
  it("hands back the parsed address rather than the original string", () => {
    const review = inspectOutboundLink("https://News.Test/a b");
    expect(review).toMatchObject({ ok: true });
    if (review.ok) {
      expect(review.url).toBe("https://news.test/a%20b");
    }
  });

  it("says something a person can act on, and never quotes the address back", () => {
    const review = inspectOutboundLink("http://news.test/prices");
    expect(review.ok).toBe(false);
    if (!review.ok) {
      expect(review.detail).toContain("secure");
      expect(review.detail).not.toContain("news.test");
    }
  });
});
