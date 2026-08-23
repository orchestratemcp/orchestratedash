/**
 * What DASH stores about a Discord channel, and what it promises before it asks
 * for one (MAR-588, outbound).
 *
 * Two halves that belong in one file because each is the other's guarantee. The
 * store half asserts that the address is not in the database — checked by
 * scanning the bytes SQLite actually wrote, the way `tests/redaction.test.ts`
 * does, rather than by trusting a column list. The copy half asserts that the
 * three liveness sentences are on the page a person reads *before* they paste,
 * and that the third one still says nothing is sent when the computer is off.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  NOTIFY_CONTENTS,
  NOTIFY_CUSTODY,
  NOTIFY_LIVENESS,
  NOTIFY_SETUP_STEPS,
  NO_NOTIFICATIONS,
  describeNotificationStanding,
  describeNotificationState,
  everyNotificationStandingSentence,
  shouldSend,
} from "../lib/notify/settings";
import { parseDiscordWebhook } from "../lib/notify/discord";
import { expectPlainLanguage } from "./helpers/plain-language";

const dataDir = mkdtempSync(path.join(tmpdir(), "dash-notify-"));
process.env.DASH_DATA_DIR = dataDir;

const store = await import("../lib/store");
const { closeDb } = await import("../lib/db");
const { notificationsView } = await import("../lib/views/build");
const { asStoredText, readStoreBytes } = await import("./helpers/store-bytes");

/** A distinctive address: if it appears anywhere, it got there from this test. */
const WEBHOOK =
  "https://discord.com/api/webhooks/9998887776665554443/zZyYxXwWvVuUtTsSrRqQpPoOnNmM-9876543210_TESTONLY";

afterAll(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("the address is never in the store", () => {
  it("keeps a masked hint and nothing else after a full connect", () => {
    const parsed = parseDiscordWebhook(WEBHOOK);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    // The real shape of connecting: the value goes to the vault (not exercised
    // here — `tests/vault.test.ts` owns that) and only the hint reaches SQLite.
    store.recordNotificationWebhook(parsed.masked_hint, "2026-08-10T09:00:00.000Z");
    closeDb();

    // The bytes, not the schema. A column list would pass on the day somebody
    // added a second table and wrote the address into that instead — and the
    // `-wal` file is included, because a just-committed row usually lives there
    // and a scan of `dash.sqlite` alone would pass while the value sat beside it.
    const bytes = readStoreBytes(dataDir);
    expect(bytes).not.toContain("zZyYxXwWvVuUtTsSrRqQpPoOnNmM");
    expect(bytes).not.toContain("discord.com/api/webhooks");
    // `asStoredText`, because the mask is U+2022 and the haystack is latin1 —
    // see that helper for why searching for the raw string finds nothing even
    // when the row is right there.
    expect(bytes).toContain(asStoredText(parsed.masked_hint));
  });

  it("refuses to record anything that is not a mask", () => {
    // The one mistake this feature is shaped around: a caller reaching the store
    // with the real value in hand. It fails at the call rather than landing in a
    // column somebody later finds by scanning the database.
    expect(() => {
      store.recordNotificationWebhook(WEBHOOK);
    }).toThrow();
    expect(() => {
      store.recordNotificationWebhook("not-a-mask");
    }).toThrow();
  });

  it("reads back what was written, and forgets it whole", () => {
    const settings = store.readNotificationSettings();
    expect(settings.configured).toBe(true);
    expect(settings.masked_hint).toBe("••••ONLY");
    expect(settings.send_approvals).toBe(true);
    expect(settings.send_reports).toBe(true);

    store.setNotificationKind("new_report", false);
    expect(store.readNotificationSettings().send_reports).toBe(false);
    // Preserved across a re-connect: somebody replacing an address they had
    // turned reports off for did not ask for reports back.
    store.recordNotificationWebhook("••••ABCD");
    expect(store.readNotificationSettings().send_reports).toBe(false);

    store.forgetNotificationWebhook();
    expect(store.readNotificationSettings()).toEqual(NO_NOTIFICATIONS);
  });
});

describe("the view a page renders", () => {
  it("has no field the address could travel in", () => {
    store.recordNotificationWebhook("••••ONLY", "2026-08-10T09:00:00.000Z");
    const view = notificationsView();

    expect(Object.keys(view).sort()).toEqual([
      // MAR-743, ADR 0028. The chief's bridge, nested on this view rather than
      // given one of its own — see `NotificationsView.chief` for why Discord is
      // one page. Its keys are enumerated separately below, because a nested
      // object is exactly where a field nobody listed could appear.
      "chief",
      "configured",
      "configured_at",
      "masked_hint",
      "send_approvals",
      "send_reports",
      "state_sentence",
    ]);
    expect(Object.keys(view.chief).sort()).toEqual([
      "allowed_user_id",
      "channel_id",
      "configured",
      "configured_at",
      "enabled",
      "masked_hint",
      "runner_holds",
      "state_sentence",
    ]);
    expect(JSON.stringify(view)).not.toContain("discord.com");
    expect(view.state_sentence).toBe(
      describeNotificationState(store.readNotificationSettings()),
    );
    store.forgetNotificationWebhook();
  });
});

describe("the liveness promise", () => {
  /**
   * The three claims, in the order a person reads them. Asserted by their
   * content rather than as one frozen string, so a rewrite that keeps the
   * meaning passes and a rewrite that softens the third one does not.
   */
  it("says all three of DASH open, DASH closed, and computer off", () => {
    expect(NOTIFY_LIVENESS).toHaveLength(3);
    const [open, closed, off] = NOTIFY_LIVENESS as [string, string, string];

    expect(open).toContain("DASH is open");
    expect(closed).toMatch(/DASH closed and the computer on/u);
    expect(closed).toMatch(/still sent/u);

    // The one that would be softened, and the softening that would do it: "may
    // be delayed" is about the same situation and tells the reader the opposite
    // thing.
    expect(off).toMatch(/computer off/u);
    expect(off).toMatch(/nothing is sent|nothing to send/u);
    expect(off).not.toMatch(/delay|queue|later|catch up/iu);
    // And the honest alternative, named rather than left as a gap.
    expect(off).toContain("server");
  });

  it("says what goes in the channel, including what does not", () => {
    const contents = NOTIFY_CONTENTS.join(" ");
    expect(contents).toContain("agent's name");
    expect(contents).toContain("Nothing else");
    // The Discord limitation, stated where it changes an expectation rather
    // than discovered when the link turns out not to be clickable.
    expect(contents).toMatch(/text to copy, not as a button/u);
  });

  it("tells somebody what the address is before asking for it", () => {
    expect(NOTIFY_CUSTODY).toContain("credential");
    expect(NOTIFY_CUSTODY).toContain("vault");
    expect(NOTIFY_SETUP_STEPS.join(" ")).toContain("Copy Webhook URL");
  });
});

describe("which events are sent at all", () => {
  it("sends nothing when nothing is configured, whatever the switches say", () => {
    expect(
      shouldSend(
        { configured: false, send_approvals: true, send_reports: true },
        "needs_approval",
      ),
    ).toBe(false);
  });

  it("reads each switch against its own kind", () => {
    const settings = { configured: true, send_approvals: true, send_reports: false };
    expect(shouldSend(settings, "needs_approval")).toBe(true);
    expect(shouldSend(settings, "new_report")).toBe(false);
  });

  it("never words the off state as a failure", () => {
    const sentence = describeNotificationState(NO_NOTIFICATIONS);
    expect(sentence).not.toMatch(/error|problem|failed|missing/iu);
    expect(sentence).toContain("Nothing about your agents leaves this computer");
  });
});

/* ---------------------------------------------------------------------- *
 * The status row (MAR-642)
 * ---------------------------------------------------------------------- */

describe("the whole state as one row", () => {
  const held = {
    configured: true,
    masked_hint: "••••CDEF",
    configured_at: "2026-08-10T09:00:00.000Z",
    send_approvals: true,
    send_reports: true,
  };

  it("says the off state without wording it as a failure", () => {
    const standing = describeNotificationStanding(NO_NOTIFICATIONS, null);
    expect(standing.chip).toBe("Not set up");
    expect(standing.on).toBe(false);
    expect(standing.sentence).not.toMatch(/error|problem|failed|missing/iu);
  });

  it("names the address by its hint and the day in words", () => {
    const standing = describeNotificationStanding(held, "10 August 2026");
    expect(standing.chip).toBe("Posting");
    expect(standing.on).toBe(true);
    expect(standing.sentence).toContain("••••CDEF");
    expect(standing.sentence).toContain("10 August 2026");
  });

  it("drops the date clause rather than inventing one", () => {
    // An unreadable stored date is DASH's own machine record failing to parse.
    // A row that filled in today would be a claim about when somebody set this
    // up, made out of the present.
    expect(describeNotificationStanding(held, null).sentence).not.toContain("added");
  });

  it("never invents a channel name", () => {
    /*
     * The one detail a person would most reasonably trust DASH about, and the
     * one it does not have: what it holds is a webhook address in the vault and
     * four characters of its token. "Posting to #alerts" would be a fabrication
     * on the most credible line of the page.
     */
    for (const since of [null, "10 August 2026"]) {
      expect(describeNotificationStanding(held, since).sentence).not.toContain("#");
    }
  });

  it("refuses to say Posting when both kinds are switched off", () => {
    // Somebody who turned both off and comes back a month later needs this row
    // to explain why their Discord is quiet. "Posting" would be a lie only the
    // checkboxes further down the page correct.
    const standing = describeNotificationStanding(
      { ...held, send_approvals: false, send_reports: false },
      "10 August 2026",
    );
    expect(standing.chip).toBe("Nothing to send");
    expect(standing.on).toBe(false);
    expect(standing.sentence).toContain("switched off");
  });

  it("is plain language on every branch", () => {
    expectPlainLanguage(everyNotificationStandingSentence());
  });
});
