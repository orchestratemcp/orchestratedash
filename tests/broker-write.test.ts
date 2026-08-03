/**
 * The first brokered operation that changes somebody's account (MAR-469,
 * ADR 0002 amendment 2).
 *
 * `tests/broker-threat-model.test.ts` attacks the write from the side an agent
 * sits on. This covers the three things that are not attacks and are not
 * checkable without a store or a view:
 *
 * - the message DASH actually composes, header by header;
 * - the durable replay memory, which is a query against `broker_audit` and
 *   therefore needs a real one;
 * - what the Connection Center says about a write, which is the surface a person
 *   uses to decide whether to allow it at all.
 *
 * The third is the one worth having a file for. MAR-458 could describe its whole
 * boundary with "no operation writes"; the honest version of that sentence now
 * has to be rendered, and a sentence that is only in an ADR is not a safeguard.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { operationById, planCall, writePaths } from "../lib/broker/operations";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The store resolves its directory at import time; redirect before importing,
// as tests/broker-lapses.test.ts does for the same reason.
const dataDir = mkdtempSync(path.join(tmpdir(), "dash-broker-write-"));
process.env.DASH_DATA_DIR = dataDir;

const { hasBrokerRequest, recordBrokerCall } = await import("../lib/broker/store");
const { importManifest, resetStore } = await import("../lib/store");
const { closeDb, db } = await import("../lib/db");
const { connectionsView } = await import("../lib/views/build");

const AGENT = "synthetic-gmail-meeting-assistant";
const ORIGIN = "https://gmail.googleapis.com";

function example(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(repoRoot, "examples", name), "utf8")) as Record<
    string,
    unknown
  >;
}

beforeEach(() => {
  resetStore();
  db().exec("DELETE FROM broker_audit");
});

afterAll(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

/* ---------------------------------------------------------------------- *
 * The message
 * ---------------------------------------------------------------------- */

/** The RFC 5322 bytes `gmail.draft.create` would put on the wire. */
function compose(input: Record<string, unknown>): string {
  const operation = operationById("gmail.draft.create");
  expect(operation).not.toBeNull();
  const planned = planCall(operation!, ORIGIN, input);
  if (!planned.ok || planned.call.method !== "POST") {
    return "";
  }
  const message = planned.call.json["message"] as { raw?: string };
  return Buffer.from(message.raw ?? "", "base64url").toString("utf8");
}

const VALID = { to: "colleague@example.com", subject: "Re: Thursday", body_text: "Yes." };

describe("the message DASH composes", () => {
  it("writes exactly the five headers it means to and no more", () => {
    const [headers = ""] = compose(VALID).split("\r\n\r\n");
    // Note what is absent as much as what is present: no From, no Sender, no
    // Reply-To, no Cc, no Bcc. Gmail fills the sender from the account whose
    // token DASH presented, so a draft cannot appear to come from anyone else —
    // and DASH does not have to check that it does not.
    expect(headers.split("\r\n")).toEqual([
      "To: colleague@example.com",
      "Subject: Re: Thursday",
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
    ]);
  });

  /**
   * A subject Google would otherwise receive as raw 8-bit bytes in a header.
   *
   * RFC 2047 encoded words, folded so each stays inside the 75-character limit,
   * and split on code point boundaries so a multi-byte character is never cut in
   * half — the failure would be a mojibake subject in somebody's Drafts folder
   * rather than a security problem, which is why it is tested here and not in
   * the threat model.
   */
  it("encodes a subject that is not plain ASCII, without splitting a character", () => {
    const subject = `Møte på torsdag ${"æøå".repeat(20)}`;
    const [headers = ""] = compose({ ...VALID, subject }).split("\r\n\r\n");

    // Split on the raw lines first, because the assertion worth making is that
    // every continuation really is one — a fold that did not start with a space
    // would be a second header rather than more of this one, which is precisely
    // the injection this encoding exists to make impossible.
    const lines = headers.split("\r\n");
    const start = lines.findIndex((entry) => entry.startsWith("Subject: "));
    expect(start).toBeGreaterThanOrEqual(0);
    let end = start + 1;
    while (end < lines.length && lines[end]?.startsWith(" ") === true) {
      end += 1;
    }

    const words = [
      (lines[start] ?? "").slice("Subject: ".length),
      ...lines.slice(start + 1, end).map((entry) => entry.slice(1)),
    ];
    expect(words.length).toBeGreaterThan(1);
    for (const word of words) {
      expect(word.startsWith("=?UTF-8?B?")).toBe(true);
      expect(word.length).toBeLessThanOrEqual(75);
    }

    // And it round-trips to the subject the agent asked for.
    const decoded = words
      .map((word) => Buffer.from(word.slice("=?UTF-8?B?".length, -"?=".length), "base64"))
      .map((buffer) => buffer.toString("utf8"))
      .join("");
    expect(decoded).toBe(subject);
  });

  it("leaves a plain ASCII subject readable rather than encoding it anyway", () => {
    expect(compose(VALID)).toContain("Subject: Re: Thursday");
    expect(compose(VALID)).not.toContain("=?UTF-8?B?");
  });

  it("threads through the provider's own id when the agent supplies one", () => {
    const operation = operationById("gmail.draft.create");
    const planned = planCall(operation!, ORIGIN, { ...VALID, thread_id: "18e0a1b2c0" });
    expect(planned.ok).toBe(true);
    if (!planned.ok || planned.call.method !== "POST") return;
    expect(planned.call.json["message"]).toMatchObject({ threadId: "18e0a1b2c0" });
  });
});

/* ---------------------------------------------------------------------- *
 * The durable replay memory
 * ---------------------------------------------------------------------- */

describe("remembering a write across a restart", () => {
  function auditOne(requestId: string, decision: "allowed" | "refused" = "allowed"): void {
    recordBrokerCall({
      agent: AGENT,
      connection_id: "gmail",
      operation: "gmail.draft.create",
      request_id: requestId,
      decision,
      refusal: decision === "refused" ? "invalid_input" : null,
      input_keys: ["body_text", "subject", "to"],
      result_count: decision === "allowed" ? 1 : null,
      account_hint: "he••@gmail.com",
      duration_ms: 20,
      decided_at: "2026-08-03T10:00:00.000Z",
    });
  }

  it("recognises an id it decided about, and nothing else", () => {
    auditOne("req-written");

    expect(hasBrokerRequest(AGENT, "req-written")).toBe(true);
    expect(hasBrokerRequest(AGENT, "req-never")).toBe(false);
  });

  /**
   * A refused request counts. The id was spent either way, and an agent that
   * reuses one after a refusal is doing the thing the check exists to notice —
   * this is not a second chance at a request that failed validation.
   */
  it("counts a refusal, because the id was spent", () => {
    auditOne("req-refused", "refused");
    expect(hasBrokerRequest(AGENT, "req-refused")).toBe(true);
  });

  /**
   * Scoped by agent, like every other budget in the broker. Two agents choosing
   * the same obvious request id must not refuse each other, and the id an agent
   * supplies is never a global name.
   */
  it("keeps one agent's ids out of another's", () => {
    auditOne("req-shared");
    expect(hasBrokerRequest("some-other-agent", "req-shared")).toBe(false);
  });
});

/* ---------------------------------------------------------------------- *
 * What a person reads before allowing it
 * ---------------------------------------------------------------------- */

describe("the Connection Center's account of a write", () => {
  beforeEach(() => {
    expect(importManifest(example("gmail-meeting-assistant.manifest.v2.example.json")).ok).toBe(
      true,
    );
  });

  function gmailCard() {
    return connectionsView()
      .agents.find((entry) => entry.name === AGENT)
      ?.rows.find((entry) => entry.connection_id === "gmail")?.broker;
  }

  /**
   * Before a sign-in, which is the whole point of asserting it here.
   *
   * Nothing has been connected in this test — there is no credential and no
   * receipt — and the card still names the write and still discloses that the
   * permission behind it is wider. A disclosure that only appears after the user
   * has granted the permission has told them nothing.
   */
  it("names the write and its consequence before anything is connected", () => {
    const card = gmailCard();
    expect(card).not.toBeUndefined();
    expect(card?.receipt).toBeNull();

    const write = card?.requested.find((entry) => entry.access === "write");
    expect(write?.label).toBe("Save a reply in your Gmail drafts");
    expect(write?.consequence).toContain("Drafts folder");
    expect(write?.consequence).toContain("until you send it or delete it yourself");
  });

  it("discloses that the permission behind the write also allows sending", () => {
    expect(gmailCard()?.wider_permission_sentence).toContain("also allows sending");
  });

  /**
   * The absence half of the pair above, which is the rule the grounded-prose
   * incidents produced: a fixture proving a sentence appears is worth little
   * without one proving it does not appear where it would be false.
   *
   * Calendar is declared, dash-managed and OAuth, and DASH brokers nothing for
   * it — so there is no card at all, let alone a warning about sending.
   */
  it("says nothing about writes on a connection that has none", () => {
    const calendar = connectionsView()
      .agents.find((entry) => entry.name === AGENT)
      ?.rows.find((entry) => entry.connection_id === "calendar");
    expect(calendar?.broker).toBeNull();
  });

  it("offers no capability whose consequence is missing", () => {
    for (const capability of gmailCard()?.requested ?? []) {
      if (capability.access === "write") {
        expect(capability.consequence).not.toBeNull();
      } else {
        expect(capability.consequence).toBeNull();
      }
    }
  });

  /**
   * The set of paths a user's account is exposed to, asserted from the same
   * place the renderer would have to read it.
   *
   * A duplicate of the threat model's pin, deliberately: that one guards the
   * operation set, and this one guards the claim that what the card describes
   * and what DASH can reach are the same thing.
   */
  it("can reach exactly one mutating endpoint, and it is not a send", () => {
    expect(writePaths()).toEqual(["/gmail/v1/users/me/drafts"]);
  });
});
