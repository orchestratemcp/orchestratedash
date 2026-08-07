/**
 * The runner-store retire notice, rendered (MAR-518).
 *
 * Two things worth pinning that a copy-only test cannot: that the home page's
 * status parser refuses to invent a kind the runner did not actually report,
 * and that the card `app/page.tsx` shows for `can_retire: true` actually
 * carries a button — the half of `describeRunnerStoreDamage` the per-agent
 * path (`lib/agent-dom/transport.ts`) can only ever render as text.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { RunnerStoreDamageNotice, runnerStoreDamageFromStatus } from "../app/page";
import { expectPlainLanguage } from "./helpers/plain-language";

describe("runnerStoreDamageFromStatus", () => {
  it("reads a recognised kind off a damaged reply", () => {
    expect(
      runnerStoreDamageFromStatus({
        ok: false,
        request_id: "r1",
        data: { store_damaged: true, damage_kind: "malformed" },
      }),
    ).toBe("malformed");
  });

  it("is null for a healthy reply", () => {
    expect(
      runnerStoreDamageFromStatus({
        ok: true,
        request_id: "r2",
        data: { available: true, supervising: 2 },
      }),
    ).toBeNull();
  });

  it("is null with no data at all", () => {
    expect(runnerStoreDamageFromStatus({ ok: false, request_id: "r3" })).toBeNull();
  });

  /**
   * `store_damaged: true` with a kind this build does not recognise must not
   * become a guess — the button beneath it calls a real repair, and a wrong
   * classification would still be honest about *that*, but showing one at
   * all for a fact the parser could not fully read would be a claim this
   * function cannot back up.
   */
  it("does not invent a kind it cannot recognise", () => {
    expect(
      runnerStoreDamageFromStatus({
        ok: false,
        request_id: "r4",
        data: { store_damaged: true, damage_kind: "shredded_by_gremlins" },
      }),
    ).toBeNull();
  });

  it("ignores a damage_kind with no store_damaged flag beside it", () => {
    expect(
      runnerStoreDamageFromStatus({
        ok: true,
        request_id: "r5",
        data: { damage_kind: "malformed" },
      }),
    ).toBeNull();
  });
});

describe("RunnerStoreDamageNotice", () => {
  it("renders the three-part recovery and a real button", () => {
    const html = renderToStaticMarkup(<RunnerStoreDamageNotice kind="malformed" />);

    expect(html).toContain("The part of DASH that runs your agents cannot read its own records.");
    expect(html).toContain("Your agents, runs and sign-ins are not affected");
    expect(html).toContain("Set the damaged records aside.");
    // The button `lib/agent-dom/transport.ts`'s rendering of the same
    // recovery can never have, because that path has no surface to put one
    // on.
    expect(html).toContain("<button");
    expect(html).toContain("Set records aside");
  });

  it("never mentions deleting the old file", () => {
    // Rename-not-delete is final (MAR-518's own issue text), and there is no
    // second, more drastic option beside this one for any of the three kinds.
    for (const kind of ["malformed", "not_a_database", "unreadable"] as const) {
      const html = renderToStaticMarkup(<RunnerStoreDamageNotice kind={kind} />);
      expect(html.toLowerCase()).not.toContain("delete");
    }
  });

  it("stays in plain language", () => {
    const html = renderToStaticMarkup(<RunnerStoreDamageNotice kind="malformed" />);
    // Strip tags crudely — this test wants the text nodes, not the markup.
    const text = html.replace(/<[^>]+>/g, " ");
    expectPlainLanguage([text]);
  });
});
