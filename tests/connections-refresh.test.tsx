/**
 * *Refresh connections* and the catalogue sentence (MAR-742, roadmap item 3).
 *
 * Two defects from the 2026-08-24 attended runs, and they are in one file
 * because they are the same failure seen twice: **a surface that had an answer
 * and did not say it.**
 *
 * - The vault reported `not_found:ENOENT` for a credential that was on disk,
 *   and no surface could say where it had looked — so the recovery available to
 *   a person was to destroy the credential and paste it again.
 * - *See what OpenRouter offers* fetched a catalogue and rendered nothing,
 *   because the chief's picker drew its outcome only on failure.
 *
 * `tests/vault-integrity.test.ts` covers the mechanism underneath the first.
 * This covers what a person is told about it.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ConnectionsRefresh } from "../app/_components/connections-refresh";
import { describeCatalogueResult } from "../lib/ai/model-choice";
import {
  describeRefreshEntry,
  describeRefreshSummary,
  describeRunnerDelivery,
  everyRefreshSentence,
  toRefreshRows,
  type ConnectionRefreshEntry,
  type ConnectionRefreshReport,
} from "../lib/ai/refresh";
import { expectPlainLanguage } from "./helpers/plain-language";

function entry(over: Partial<ConnectionRefreshEntry> = {}): ConnectionRefreshEntry {
  return {
    provider_id: "openrouter",
    account_id: "account-1",
    service: "OpenRouter",
    vault: { held: true },
    liveness: { state: "live", checked_at: "2026-08-24T18:57:34.414Z", model_count: 312 },
    ...over,
  };
}

/** The 2026-08-24 record, as a report. */
function theNightItHappened(): ConnectionRefreshEntry {
  return entry({
    vault: {
      held: false,
      code: "not_found",
      cause: "ENOENT",
      path: "C:\\Users\\someone\\AppData\\Roaming\\orchestratedash\\vault\\dash-secret-dash.fleet.openrouter.account-1.api_key.enc",
    },
    liveness: null,
  });
}

describe("what the report says about one connection", () => {
  it("says where DASH looked when it found nothing, rather than only that it found nothing", () => {
    /*
     * The whole point of the ticket, at the surface. "No secret stored as that"
     * is what sent a person to re-paste a key that was sitting on disk; the
     * missing word was never *what*, it was *where*.
     */
    const sentence = describeRefreshEntry(theNightItHappened());

    expect(sentence.ok).toBe(false);
    expect(sentence.headline).toContain("OpenRouter");
    // The sentence names that a folder is involved and sends the reader to it
    // before pasting anything — it does not carry the path itself.
    expect(sentence.detail).toContain("folder");
    expect(sentence.next_action).toContain("folder");
    expect(sentence.detail).not.toContain("C:\\");
  });

  it("keeps a locked vault apart from a missing entry, because the recoveries differ", () => {
    // MAR-684's distinction, carried all the way to the page: one says the key
    // is still there and something else has it, the other says there is nothing.
    const locked = describeRefreshEntry(
      entry({ vault: { held: false, code: "vault_locked", cause: "EBUSY", path: null }, liveness: null }),
    );
    expect(locked.detail).toContain("still on disk");
    expect(locked.detail).toContain("nothing has been lost");
    expect(locked.headline).not.toBe(describeRefreshEntry(theNightItHappened()).headline);
  });

  it("does not claim anything about a key it never presented", () => {
    /*
     * `liveness` is null exactly when the vault did not hand a credential over.
     * A record invented for that case would read as "DASH asked and could not
     * tell", when DASH did not ask — so no branch reached without a credential
     * may report a provider's verdict, in either direction.
     */
    const missing = theNightItHappened();
    expect(missing.liveness).toBeNull();

    const sentence = describeRefreshEntry(missing);
    for (const claim of ["accepted", "turned it down", "answered", "refused"]) {
      expect(`${sentence.headline} ${sentence.detail}`).not.toContain(claim);
    }
  });

  it("says a refused key read back fine, so the vault is not blamed for the provider", () => {
    const refused = describeRefreshEntry(
      entry({ liveness: { state: "key_refused", checked_at: "2026-08-24T18:57:34.414Z", model_count: null } }),
    );
    expect(refused.ok).toBe(false);
    expect(refused.detail).toContain("read back from the vault");
    expect(refused.next_action).toContain("OpenRouter");
  });

  it("treats an unreachable provider as DASH being unable to ask, never as a verdict", () => {
    // `lib/ai/liveness.ts`'s rule, kept here rather than restated differently:
    // being offline on a train must not read as "your access was taken away".
    const unreachable = describeRefreshEntry(
      entry({ liveness: { state: "unreachable", checked_at: "2026-08-24T18:57:34.414Z", model_count: null } }),
    );
    expect(unreachable.detail).toContain("says nothing about the key");
  });
});

describe("what the report says about all of them", () => {
  it("counts rather than judges", () => {
    const report = (entries: ConnectionRefreshEntry[]): ConnectionRefreshReport => ({
      checked_at: "2026-08-24T18:57:34.414Z",
      entries,
      delivery: "delivered",
    });

    expect(describeRefreshSummary(report([]))).toContain("nothing connected");
    expect(describeRefreshSummary(report([entry()]))).toContain("one connection");
    expect(describeRefreshSummary(report([entry(), entry()]))).toContain("all 2");
    // The mixed case is the one the night produced, and it says how many need a
    // person rather than pronouncing on the fleet's health.
    expect(describeRefreshSummary(report([entry(), theNightItHappened()]))).toContain(
      "1 of them need your attention",
    );
  });

  it("keeps no runner apart from a runner that refused", () => {
    // Two facts about a machine, only one of which is a problem — and neither
    // is a fact about a credential.
    expect(describeRunnerDelivery("no_runner")).toContain("Nothing is running");
    expect(describeRunnerDelivery("refused")).toContain("would not take");
    expect(describeRunnerDelivery("delivered")).toContain("same keys you are");
    // The one that exists so a broken fleet is not pushed over a working runner.
    expect(describeRunnerDelivery("not_attempted")).toContain("left with what it already had");
  });
});

describe("what crosses the bridge", () => {
  it("carries the path on a failed read and nothing on a good one", () => {
    const rows = toRefreshRows({
      checked_at: "2026-08-24T18:57:34.414Z",
      entries: [theNightItHappened(), entry()],
      delivery: "delivered",
    });

    expect(rows[0]?.ok).toBe(false);
    expect(rows[0]?.path).toContain("dash-secret-dash.fleet.openrouter.account-1.api_key.enc");
    expect(rows[1]?.ok).toBe(true);
    // Empty, not the string "null": the renderer draws no element for it, and
    // must never print an empty path as though DASH had looked nowhere.
    expect(rows[1]?.path).toBe("");
    expect(rows[1]?.next_action).toBe("");
  });

  it("carries no credential and nothing derived from one", () => {
    /*
     * The property that lets the whole report be handed to a renderer without a
     * further gate. Asserted over the serialised rows rather than field by
     * field, so a field added later is covered by this without being added
     * here.
     */
    const serialised = JSON.stringify(
      toRefreshRows({
        checked_at: "2026-08-24T18:57:34.414Z",
        entries: [theNightItHappened(), entry()],
        delivery: "delivered",
      }),
    );
    expect(Object.keys(toRefreshRows({
      checked_at: "",
      entries: [entry()],
      delivery: "delivered",
    })[0] ?? {}).sort()).toEqual([
      "account_id",
      "detail",
      "headline",
      "next_action",
      "ok",
      "path",
      "provider_id",
      "service",
    ]);
    expect(serialised).not.toContain("sk-");
    expect(serialised).not.toContain("ciphertext");
  });
});

describe("the control on the AI tab", () => {
  it("says what it will do and that it is safe, before anybody presses it", () => {
    const markup = renderToStaticMarkup(
      <ConnectionsRefresh canAct onRefreshed={() => undefined} />,
    );
    expect(markup).toContain("Refresh connections");
    // The promise that makes it pressable by somebody who has been burned:
    // this is the control that does *not* destroy a credential to test it.
    expect(markup).toContain("changes no key and deletes nothing");
    // Nothing is claimed before the press. No report, no verdict.
    expect(markup).not.toContain("notice-ok");
    expect(markup).not.toContain("notice-warn");
  });

  it("refuses rather than throwing in a window that cannot act", () => {
    const markup = renderToStaticMarkup(
      <ConnectionsRefresh canAct={false} onRefreshed={() => undefined} />,
    );
    expect(markup).toContain("disabled");
  });
});

describe("what a catalogue press produced (MAR-742, evidence addendum defect 2)", () => {
  it("has a sentence for every state, including the two that look like nothing happened", () => {
    /*
     * The defect: the chief's picker rendered its outcome only when the ask
     * *failed*, so a provider that answered — with models or with none — left
     * the panel byte-identical. Both are real answers and both now say so.
     */
    expect(describeCatalogueResult("OpenRouter", null)).toContain("will present the key");
    expect(describeCatalogueResult("OpenRouter", [])).toContain("named nothing this key can reach");
    expect(describeCatalogueResult("OpenRouter", ["a", "b"])).toContain("2 to choose from");
    // Never stored, said on the two branches where a list actually exists.
    expect(describeCatalogueResult("OpenRouter", ["a"])).toContain("keeps no copy");
  });

  it("is the one function all three pickers call", async () => {
    /*
     * The trap this file exists to close: three renderers drew this sentence,
     * one of them did not have it, and fixing that one would have left the next
     * picker free to be silent again.
     *
     * Read off the sources rather than asserted through a click, because these
     * render tests are static (`renderToStaticMarkup`, no effects, no events) —
     * so the thing that can actually be pinned is that no picker words this
     * itself. Sources are read with their newlines normalised: a regex over
     * source is CRLF-blind otherwise.
     */
    const { readFileSync } = await import("node:fs");
    const pickers = [
      "app/_components/model-default.tsx",
      "app/_components/model-choice.tsx",
      "app/_components/chief-chat.tsx",
    ];
    for (const file of pickers) {
      const source = readFileSync(file, "utf8").replace(/\r\n/gu, "\n");
      expect(source).toContain("describeCatalogueResult");
      // The old inline wording is gone from all three, so a copy edit to the
      // shared sentence cannot leave a stale duplicate on one surface.
      expect(source).not.toContain("to choose from, as ");
    }
  });
});

describe("plain language", () => {
  it("says everything the refresh can say in plain language", () => {
    expectPlainLanguage(everyRefreshSentence(), {
      // The service's own name, which `docs/design-brief.md` treats as content
      // rather than as DASH's vocabulary.
      allow: ["OpenRouter"],
    });
  });

  it("says everything a catalogue press can say in plain language", () => {
    expectPlainLanguage(
      [
        describeCatalogueResult("OpenRouter", null),
        describeCatalogueResult("OpenRouter", []),
        describeCatalogueResult("OpenRouter", ["a", "b"]),
      ],
      { allow: ["OpenRouter"] },
    );
  });
});
