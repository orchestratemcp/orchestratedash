/**
 * A moment, in words (MAR-533).
 *
 * The defect: the Connections page rendered `2026-08-07T13:58:28.037Z` straight
 * onto the screen — four times per lapse row, twice per receipt, once per audit
 * entry — and at 375px a single one of them wrapped over two lines of a bullet.
 * It is the same failure `lib/copy/identifiers.ts` exists to stop, and it slipped
 * through because a timestamp is not an identifier and no rule was looking.
 *
 * ## Why these assertions are shaped the way they are
 *
 * These functions format in the machine's **local** timezone, deliberately: the
 * user is in one place and UTC is a fact about a server they do not have. That
 * makes an assertion on an exact string a test that passes in one timezone and
 * fails in another — so the cases below build their inputs from a local `Date`
 * and assert what is actually being claimed: that the output names this date,
 * that it contains no machine punctuation, and that a window says its day once.
 */

import { describe, expect, it } from "vitest";

import { plainDay, plainMoment, plainWindow } from "../lib/copy/when";

/** An instant, built from local parts so the expected day is known here. */
function localIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): string {
  return new Date(year, month - 1, day, hour, minute, 0, 0).toISOString();
}

describe("a day", () => {
  it("names the month rather than numbering it", () => {
    expect(plainDay(localIso(2026, 8, 6, 9, 0))).toBe("6 August 2026");
  });

  it("does not pad the day, because nobody writes 06 August", () => {
    expect(plainDay(localIso(2026, 1, 3, 12, 0))).toBe("3 January 2026");
  });

  it("is null for anything it cannot read, and never the input", () => {
    // The one thing this module must never do is echo back the exact string it
    // exists to remove — on the path where nobody is watching.
    for (const bad of ["", "not a date", "2026-13-45T99:99:99Z"]) {
      expect(plainDay(bad)).toBeNull();
    }
  });
});

describe("a moment", () => {
  it("is a day and a 24-hour clock, with no seconds", () => {
    expect(plainMoment(localIso(2026, 8, 7, 14, 58))).toBe("7 August 2026 at 14:58");
  });

  it("pads the clock so times line up in a column", () => {
    expect(plainMoment(localIso(2026, 8, 7, 9, 5))).toBe("7 August 2026 at 09:05");
  });

  it("carries no T and no Z", () => {
    const said = plainMoment(localIso(2026, 8, 7, 13, 58)) ?? "";
    expect(said).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(said).not.toContain("Z");
  });

  it("is null for anything it cannot read", () => {
    expect(plainMoment("nonsense")).toBeNull();
  });
});

describe("a window", () => {
  it("says its day once when it begins and ends on the same one", () => {
    /*
     * The case that made this function exist rather than two calls at the call
     * site. "7 August 2026 at 13:58 — 7 August 2026 at 13:59" makes a
     * ninety-second gap look like an event with a history, and every lapse
     * window DASH has ever recorded is on one day.
     */
    expect(plainWindow(localIso(2026, 8, 7, 13, 58), localIso(2026, 8, 7, 13, 59))).toBe(
      "7 August 2026 at 13:58 until 13:59",
    );
  });

  it("spells both days out when it crosses one", () => {
    expect(plainWindow(localIso(2026, 8, 7, 23, 50), localIso(2026, 8, 8, 0, 10))).toBe(
      "7 August 2026 at 23:50 until 8 August 2026 at 00:10",
    );
  });

  it("says the start alone for a window that has not closed", () => {
    // Never a trailing em dash into nothing, which is what the page did before.
    expect(plainWindow(localIso(2026, 8, 7, 13, 58), null)).toBe("7 August 2026 at 13:58");
  });

  it("says the start alone when both ends are the same instant", () => {
    const at = localIso(2026, 8, 7, 13, 58);
    expect(plainWindow(at, at)).toBe("7 August 2026 at 13:58");
  });

  it("falls back to the start when the end is unreadable, rather than to nothing", () => {
    expect(plainWindow(localIso(2026, 8, 7, 13, 58), "nonsense")).toBe(
      "7 August 2026 at 13:58",
    );
  });

  it("is null when the start itself is unreadable", () => {
    expect(plainWindow("nonsense", localIso(2026, 8, 7, 13, 58))).toBeNull();
  });
});
