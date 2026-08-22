/**
 * The DASH→LAB sender end to end, minus the network (MAR-479, ADR 0026).
 *
 * Three halves that belong in one file because each is the other's guarantee:
 *
 * - **Off by default** is asserted as an absence — a store nobody has touched
 *   sends nothing, and the assertion is that `fetch` was never called at all,
 *   not that a flag was false. MAR-479's first constraint is "off by default,
 *   not off until you accept a banner", and the only way to check that is to
 *   watch the socket that was never opened.
 * - **The receipt** is asserted against the bytes that were posted, so the
 *   *before* preview and the *after* record cannot drift from the act.
 * - **The token is not in the database**, scanned the way
 *   `tests/notify-settings.test.ts` scans for a webhook address, for its reason:
 *   a column list would pass on the day somebody wrote the value into a second
 *   table.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { AgentManifest } from "../lib/contracts";
import { payloadBody, pendingObservations } from "../lib/lab/observation";
import {
  DEFAULT_LAB_ENDPOINT,
  LAB_TELEMETRY_OFF,
  LAB_TELEMETRY_RECEIPT,
  LAB_TELEMETRY_SECRET_NAME,
  describeEndpointReach,
  describeLabTelemetryStanding,
  everyLabTelemetrySentence,
  isLoopbackEndpoint,
  shouldSendTelemetry,
} from "../lib/lab/settings";
import { ingestUrl } from "../lib/lab/send";
import type { SecureStore } from "../lib/secure-store";
import { expectPlainLanguage } from "./helpers/plain-language";

const dataDir = mkdtempSync(path.join(tmpdir(), "dash-lab-"));
process.env.DASH_DATA_DIR = dataDir;

const store = await import("../lib/store");
const { closeDb, db } = await import("../lib/db");
const { performLabAction, sendPending } = await import("../electron/lab-telemetry");
const { labTelemetryView } = await import("../lib/views/build");
const { readDecisions } = await import("../lib/fleet/decisions-store");
// Dynamic, and it has to be: `lib/secret-refs.ts` imports `lib/db.ts`, whose
// data directory is resolved once at import time. A static import here would
// pin the store to `.data/` beside the source tree before the assignment above
// ever runs, and every assertion below would be about the wrong database.
const { maskSecret } = await import("../lib/secret-refs");
const { asStoredText, readStoreBytes } = await import("./helpers/store-bytes");

/** A distinctive token: if it appears anywhere, it got there from this test. */
const TOKEN = "zZqQ-LABTOKEN-9876543210-TESTONLY";
const AGENT = "lab-telemetry-fixture";

/**
 * A v1 manifest, deliberately: this feature reads `agent.plan_source` and
 * `planned_route[]`, which both versions carry, and a v2 fixture would drag in
 * a full `agent_dom` block that has nothing to do with what is being asserted.
 * That it works on a v1 manifest is itself part of the claim — DASH reports the
 * plan, not the Agent DOM.
 */
const MANIFEST: AgentManifest = {
  manifest_version: 1,
  agent: {
    name: AGENT,
    goal: "zzTHISGOALMUSTNOTTRAVELzz",
    plan_source: "composed",
    playbook_id: "",
    route_id: "",
    build_target: "code",
  },
  planned_route: [
    { step: 1, component_id: "public_source_fetch", risk_level: "low", model_tier: "none" },
    { step: 2, component_id: "brief_compose", risk_level: "medium", model_tier: "small" },
  ],
  safety_contract: {
    automation_clearance: "L1",
    enforced_approval_gates: [],
    irreversible_components: [],
  },
  monitoring: {
    events: ["run_started", "run_completed"],
    endpoint_env: "DASH_EVENTS_URL",
    token_env: "DASH_EVENTS_TOKEN",
    output_location: "reports/",
  },
  provenance: {
    generated_by: "MAR-479 fixture",
    registry_fingerprint: "fixture",
    generated_at: "2026-08-20T08:00:00Z",
  },
};

/**
 * A vault that holds one value in memory.
 *
 * `os_backed: true`, because the refusal path for an unavailable vault is about
 * the *window opening order* and is asserted separately below.
 */
function fakeVault(initial: Record<string, string> = {}): SecureStore & { held: Map<string, string> } {
  const held = new Map(Object.entries(initial));
  return {
    held,
    describeBacking: () => ({
      backend: "test" as never,
      os_backed: true,
      persists_across_restart: true,
      label: "a test vault",
    }),
    get: (name) => {
      const value = held.get(name);
      return value === undefined ? Promise.reject(new Error("not_found")) : Promise.resolve(value);
    },
    set: (name, secret) => {
      held.set(name, secret);
      return Promise.resolve();
    },
    delete: (name) => {
      held.delete(name);
      return Promise.resolve();
    },
    listNames: () => Promise.resolve([...held.keys()]),
  };
}

/** A `fetch` that records what it was given and answers however the test says. */
function fakeFetch(answer: { status: number; body: string }) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  const impl = (url: string, init: { headers: Record<string, string>; body: string }) => {
    calls.push({ url, headers: init.headers, body: init.body });
    return Promise.resolve({ status: answer.status, text: () => Promise.resolve(answer.body) });
  };
  return { calls, impl };
}

function seedOneRun(at = "2026-08-20T09:00:00.000Z"): void {
  store.importManifest(MANIFEST);
  store.ingestEvents([
    {
      event_version: 1,
      agent: AGENT,
      run_id: "run-1",
      seq: 0,
      ts: at,
      type: "run_started",
    },
  ]);
}

/** Wipe every table this feature touches, so each block starts from the shipped state. */
function resetTelemetry(): void {
  db().exec(
    "DELETE FROM lab_telemetry; DELETE FROM lab_telemetry_sends; DELETE FROM lab_telemetry_sent; " +
      // The decisions log too: these blocks assert how many rows one transition
      // files, which is only meaningful from an empty log.
      "DELETE FROM fleet_decisions;",
  );
}

afterAll(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetTelemetry();
});

describe("off is the absence of a row", () => {
  it("reads as off on a store nobody has touched", () => {
    expect(store.readLabTelemetrySettings()).toEqual(LAB_TELEMETRY_OFF);
    expect(shouldSendTelemetry(LAB_TELEMETRY_OFF)).toBe(false);
  });

  it("opens no socket at all, rather than composing and declining to post", () => {
    seedOneRun();
    const sent = fakeFetch({ status: 200, body: '{"accepted":1,"rejected":0,"errors":[]}' });

    return sendPending({ store: fakeVault(), fetchImpl: sent.impl }).then((result) => {
      expect(result.kind).toBe("not_configured");
      expect(sent.calls).toHaveLength(0);
    });
  });

  it("still shows what would be sent, because that is what consent needs", () => {
    // ADR 0026 decision 5's *before* half. The preview is the one thing that has
    // to work on a DASH that has opted into nothing.
    seedOneRun();
    const view = labTelemetryView();
    expect(view.enabled).toBe(false);
    expect(view.masked_hint).toBeNull();
    expect(view.preview_count).toBe(1);
    expect(view.preview_body).toContain("dash_route_");
  });

  it("switches on and off without the token, and back", async () => {
    const vault = fakeVault();
    await performLabAction("set_enabled", { enabled: true }, {
      store: vault,
      promptForSecret: () => Promise.resolve(null),
    });
    expect(store.readLabTelemetrySettings().enabled).toBe(true);
    // Switched on and still not sending: there is no token to send under, and
    // the standing row has to say so rather than read "Sending".
    expect(shouldSendTelemetry(store.readLabTelemetrySettings())).toBe(false);
    expect(describeLabTelemetryStanding(store.readLabTelemetrySettings(), null).chip).toBe(
      "No token",
    );
  });
});

describe("the token", () => {
  it("goes to the vault and never to the database", async () => {
    const vault = fakeVault();
    const result = await performLabAction(
      "connect",
      { endpoint: DEFAULT_LAB_ENDPOINT },
      { store: vault, promptForSecret: () => Promise.resolve(TOKEN) },
    );

    expect(result.ok).toBe(true);
    expect(vault.held.get(LAB_TELEMETRY_SECRET_NAME)).toBe(TOKEN);
    expect(store.readLabTelemetrySettings().masked_hint).toBe(maskSecret(TOKEN));

    // Pasting a token is not consent to send. Two presses, deliberately.
    expect(store.readLabTelemetrySettings().enabled).toBe(false);

    closeDb();
    const bytes = readStoreBytes(dataDir);
    expect(bytes).not.toContain("LABTOKEN");
    expect(bytes).not.toContain(TOKEN);
    expect(bytes).toContain(asStoredText(maskSecret(TOKEN)));
  });

  it("refuses an address it cannot read, before opening the window", async () => {
    let prompted = false;
    const result = await performLabAction(
      "connect",
      { endpoint: "not a url" },
      {
        store: fakeVault(),
        promptForSecret: () => {
          prompted = true;
          return Promise.resolve(TOKEN);
        },
      },
    );
    expect(result.ok).toBe(false);
    expect(result.refusal).toBe("bad_endpoint");
    // The order is the point: asking somebody for a credential and *then*
    // saying the address was wrong is the one sequence this must never take.
    expect(prompted).toBe(false);
  });

  it("is forgotten on disconnect, and the receipts are not", async () => {
    const vault = fakeVault({ [LAB_TELEMETRY_SECRET_NAME]: TOKEN });
    store.recordLabTelemetryToken(maskSecret(TOKEN), DEFAULT_LAB_ENDPOINT);
    store.setLabTelemetryEnabled(true);
    store.recordLabSend({
      sent_at: "2026-08-20T09:00:00.000Z",
      endpoint: DEFAULT_LAB_ENDPOINT,
      body: "[]",
      outcome: "accepted",
      status: 200,
      detail: "LAB took 0 entries.",
      accepted: 0,
    });

    await performLabAction("disconnect", {}, {
      store: vault,
      promptForSecret: () => Promise.resolve(null),
    });

    expect(vault.held.has(LAB_TELEMETRY_SECRET_NAME)).toBe(false);
    expect(store.readLabTelemetrySettings()).toEqual(LAB_TELEMETRY_OFF);
    // ADR 0026 decision 7: somebody turning this off is very likely turning it
    // off *because* they went to look at what was sent.
    expect(store.listLabSends()).toHaveLength(1);
  });
});

describe("what actually goes over the socket", () => {
  async function configured(): Promise<ReturnType<typeof fakeVault>> {
    const vault = fakeVault({ [LAB_TELEMETRY_SECRET_NAME]: TOKEN });
    store.recordLabTelemetryToken(maskSecret(TOKEN), DEFAULT_LAB_ENDPOINT);
    store.setLabTelemetryEnabled(true);
    return vault;
  }

  it("posts the previewed bytes, under a bearer token, to LAB's route", async () => {
    seedOneRun();
    const vault = await configured();
    const preview = labTelemetryView().preview_body;
    const sent = fakeFetch({ status: 200, body: '{"accepted":1,"rejected":0,"errors":[]}' });

    const result = await sendPending({ store: vault, fetchImpl: sent.impl });

    expect(result.kind).toBe("sent");
    expect(sent.calls).toHaveLength(1);
    expect(sent.calls[0]?.url).toBe(ingestUrl(DEFAULT_LAB_ENDPOINT));
    expect(sent.calls[0]?.headers["authorization"]).toBe(`Bearer ${TOKEN}`);
    // The preview and the act are the same string, which is the whole of
    // ADR 0026 decision 5.
    expect(sent.calls[0]?.body).toBe(preview);
    expect(sent.calls[0]?.body).not.toContain("THISGOALMUSTNOTTRAVEL");
  });

  it("files a receipt holding the literal body, and does not repeat itself", async () => {
    seedOneRun();
    const vault = await configured();
    const sent = fakeFetch({ status: 200, body: '{"accepted":1,"rejected":0,"errors":[]}' });

    await sendPending({ store: vault, fetchImpl: sent.impl });

    const receipts = store.listLabSends();
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.body).toBe(sent.calls[0]?.body);
    expect(receipts[0]?.status).toBe(200);
    expect(receipts[0]?.accepted).toBe(1);

    // Sending again posts nothing: the day is already reported.
    const again = await sendPending({ store: vault, fetchImpl: sent.impl });
    expect(again.kind).toBe("nothing_to_send");
    expect(sent.calls).toHaveLength(1);
  });

  it("records a refusal and marks nothing sent, so the next batch retries", async () => {
    seedOneRun();
    const vault = await configured();
    const refused = fakeFetch({ status: 404, body: '{"error":"Not found"}' });

    const result = await sendPending({ store: vault, fetchImpl: refused.impl });

    expect(result.kind).toBe("sent");
    const receipt = store.listLabSends()[0];
    expect(receipt?.outcome).toBe("refused");
    expect(receipt?.status).toBe(404);
    // The failure is legible: this is the LAB_DASH_INGEST_ENABLED case, which is
    // the one a person can actually fix.
    expect(receipt?.detail).toContain("LAB_DASH_INGEST_ENABLED");
    expect(store.readLabSentKeys().size).toBe(0);

    const retry = fakeFetch({ status: 200, body: '{"accepted":1,"rejected":0,"errors":[]}' });
    await sendPending({ store: vault, fetchImpl: retry.impl });
    expect(retry.calls).toHaveLength(1);
  });

  it("marks nothing after a partial answer, because LAB does not say which half landed", async () => {
    seedOneRun();
    const vault = await configured();
    const partial = fakeFetch({
      status: 207,
      body: '{"accepted":0,"rejected":1,"errors":["goal_slug must be a non-empty string"]}',
    });

    await sendPending({ store: vault, fetchImpl: partial.impl });

    expect(store.listLabSends()[0]?.outcome).toBe("partial");
    expect(store.readLabSentKeys().size).toBe(0);
    // The view must not colour a partial answer as success.
    expect(labTelemetryView().sends[0]?.ok).toBe(false);
  });

  it("records an unreachable LAB without the endpoint appearing in the detail", async () => {
    seedOneRun();
    const vault = await configured();
    const dead = {
      impl: () => Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:3000")),
    };

    await sendPending({ store: vault, fetchImpl: dead.impl as never });

    const receipt = store.listLabSends()[0];
    expect(receipt?.outcome).toBe("unreachable");
    // -1 rather than null, so "DASH tried and heard nothing" is a row that
    // renders rather than one a page has to special-case.
    expect(receipt?.status).toBe(-1);
    expect(labTelemetryView().sends[0]?.status).toBeNull();
    // Node's fetch failures carry a `cause` naming what they were connecting
    // to; a receipt that quoted one would have somebody's LAB host in it.
    expect(receipt?.detail).not.toContain("ECONNREFUSED");
  });

  it("files a receipt when the store says configured and the vault disagrees", async () => {
    seedOneRun();
    store.recordLabTelemetryToken(maskSecret(TOKEN), DEFAULT_LAB_ENDPOINT);
    store.setLabTelemetryEnabled(true);
    const empty = fakeVault();
    const sent = fakeFetch({ status: 200, body: "{}" });

    const result = await sendPending({ store: empty, fetchImpl: sent.impl });

    expect(result.kind).toBe("not_configured");
    expect(sent.calls).toHaveLength(0);
    expect(store.listLabSends()[0]?.outcome).toBe("no_token");
  });
});

describe("the decisions log answers for this setting on its own row", () => {
  it("files one row per transition, against the fleet, under its own kind", async () => {
    const vault = fakeVault();
    await performLabAction(
      "connect",
      { endpoint: DEFAULT_LAB_ENDPOINT },
      { store: vault, promptForSecret: () => Promise.resolve(TOKEN) },
    );
    await performLabAction("set_enabled", { enabled: true }, {
      store: vault,
      promptForSecret: () => Promise.resolve(null),
    });

    const rows = readDecisions().filter((row) => row.kind === "lab_telemetry");
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.subject_kind).toBe("fleet");
      expect(row.subject_id).toBeNull();
      expect(row.topic).toBe("");
      // The address is in the summary and the token is nowhere.
      expect(row.summary).toContain(DEFAULT_LAB_ENDPOINT);
      expect(JSON.stringify(row)).not.toContain(TOKEN);
    }
  });

  it("files nothing for a switch that did not change", async () => {
    const vault = fakeVault();
    const before = readDecisions().filter((row) => row.kind === "lab_telemetry").length;
    await performLabAction("set_enabled", { enabled: false }, {
      store: vault,
      promptForSecret: () => Promise.resolve(null),
    });
    expect(readDecisions().filter((row) => row.kind === "lab_telemetry")).toHaveLength(before);
  });
});

describe("what the page promises", () => {
  it("keeps the sentence that says what the receipt is not", () => {
    // The third line is the one a page would drop for space, and dropping it is
    // the only way this feature could be dishonest.
    expect(LAB_TELEMETRY_RECEIPT[2]).toContain("not a promise about everything that leaves");
  });

  it("says whether the address is on this computer, and refuses neither", () => {
    expect(isLoopbackEndpoint(DEFAULT_LAB_ENDPOINT)).toBe(true);
    expect(isLoopbackEndpoint("http://lab.example:3000")).toBe(false);
    expect(isLoopbackEndpoint("nonsense")).toBe(false);
    expect(describeEndpointReach("http://lab.example:3000")).toContain("over your network");
  });

  it("is written in plain language", () => {
    expectPlainLanguage(everyLabTelemetrySentence());
  });
});

describe("the shape LAB accepts", () => {
  it("posts an array whose entries carry every field the ingest requires", () => {
    seedOneRun();
    const body = payloadBody(pendingObservations(store.readStore(), new Set()));
    const parsed = JSON.parse(body) as Array<Record<string, unknown>>;

    expect(Array.isArray(parsed)).toBe(true);
    // `validateDashObservation` in orchestratelab requires these four and
    // type-checks the rest. Restated here because that repository's validator is
    // the thing this payload has to survive, and DASH cannot import it.
    for (const entry of parsed) {
      expect(typeof entry["observed_on"]).toBe("string");
      expect(entry["observed_on"]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof entry["goal_slug"]).toBe("string");
      expect((entry["goal_slug"] as string).length).toBeGreaterThan(0);
      expect(typeof entry["route_selected"]).toBe("string");
      expect(Number.isFinite(entry["route_score"])).toBe(true);
      expect(Array.isArray(entry["components"])).toBe(true);
      expect(typeof entry["route_changed"]).toBe("boolean");
    }
  });
});
