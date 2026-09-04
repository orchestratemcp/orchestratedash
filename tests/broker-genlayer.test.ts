/**
 * Having a brief judged on GenLayer, at the boundary (MAR-863, ADR 0033).
 *
 * Four claims this packet makes, and each one is a test here rather than a
 * sentence in a docblock:
 *
 * 1. **No agent can reach it.** `operationById` — the lookup every brokered
 *    request resolves through — returns null for the adjudication's id, and
 *    neither frozen path array grew. The scope list is empty and stays empty.
 * 2. **No address crosses.** The payload that goes on a public chain carries a
 *    receipt id where a URL would be, and `compose` refuses a deliverable with
 *    an address anywhere in it — checked over the whole serialised document,
 *    not field by field.
 * 3. **The join is re-checked.** A brief written from a different list is
 *    refused rather than published with citations pointing at the wrong rows.
 * 4. **A decided transaction is not a verdict.** The `MAJORITY_DISAGREE` case —
 *    FINALIZED, SUCCESS, and no state applied, at roughly one judgement in ten —
 *    is read as `no_consensus`, settles the row with a null verdict, and gets a
 *    sentence with a way out rather than a spinner.
 *
 * The fourth is the one the packet is shaped around, and it is driven here
 * against a receipt recorded exactly as the spike's `transcripts/stability.json`
 * recorded iteration 8 — FINALIZED, leader execution SUCCESS, consensus
 * MAJORITY_DISAGREE, verdict null. No network, no chain, no key.
 */

import { describe, expect, it } from "vitest";

import { adjudicateBrief, commissionIdFor, type GenLayerChain } from "../lib/genlayer/adjudicate";
import {
  defaultGenLayerConnection,
  resolveGenLayerConnection,
} from "../lib/genlayer/connection";
import { buildAdjudicationPayload } from "../lib/genlayer/payload";
import { applied, readReceipt, succeeded } from "../lib/genlayer/receipt";
import { commissionTerms } from "../lib/genlayer/terms";
import {
  ADJUDICATE_FUNCTIONS,
  ADJUDICATION_VERDICTS,
  GENLAYER_ADJUDICATE,
  adjudicateOperationById,
  operationById,
  spendPaths,
  writePaths,
} from "../lib/broker/operations";
import { fingerprintItems } from "../lib/brief/fingerprint";
import {
  describeAdjudication,
  describeAdjudicationFailure,
  describeAdjudicationStage,
} from "../lib/copy/genlayer";
import { ADJUDICATION_STAGES } from "../lib/genlayer/record";
import type { ArtifactItem, BriefArtifact, DigestArtifact } from "../lib/contracts";

/* ---------------------------------------------------------------------- *
 * A brief and the list it was written from
 * ---------------------------------------------------------------------- */

/**
 * Two rows carrying every address an item can carry.
 *
 * `source_url` and `item_url` are both here on purpose: they are the two members
 * of a collected row that are addresses, and the whole point of the projection
 * is that neither reaches the chain. A fixture without them would pass the
 * address test by having nothing to leak.
 */
const ITEMS: ArtifactItem[] = [
  {
    headline: "OpenClaw drops its subscription tier",
    summary: "The pricing page changed on Tuesday and the old tier is gone.",
    source_name: "OpenClaw on Hacker News",
    source_url: "https://hn.algolia.com/api/v1/search?query=openclaw",
    item_url: "https://news.ycombinator.com/item?id=47963204",
    published_at: "2026-04-30T14:36:58Z",
  },
  {
    headline: "Hermes Agent ships a local runtime",
    summary: "A build that runs with no account at all.",
    source_name: "Hermes Agent on Hacker News",
    source_url: "https://hn.algolia.com/api/v1/search?query=hermes",
    item_url: "https://news.ycombinator.com/item?id=47963999",
    published_at: "2026-05-02T09:00:00Z",
  },
];

const RUN_ID = "e57149d0-773b-49d3-bf1d-ee87b30b9d2e";

function digestOf(items: ArtifactItem[] = ITEMS): DigestArtifact {
  return {
    artifact_version: 2,
    kind: "digest",
    agent: "competitor-scout",
    run_id: RUN_ID,
    artifact_id: "digest-e57149d0",
    title: "What changed this week",
    generated_at: "2026-08-20T07:40:00.000Z",
    items,
    sources_fetched: [
      {
        source_name: "OpenClaw on Hacker News",
        source_url: "https://hn.algolia.com/api/v1/search?query=openclaw",
        status: "ok",
        item_count: 1,
      },
      {
        // The source that did not answer. The terms ask for it by name, so a
        // projection that shipped only the successes would fail the criterion.
        source_name: "Hermes Agent on Reddit",
        source_url: "https://www.reddit.com/r/hermes/.json",
        status: "failed",
      },
    ],
  };
}

function briefOf(over: Partial<BriefArtifact["derived_from"]> = {}): BriefArtifact {
  return {
    artifact_version: 2,
    kind: "brief",
    agent: "competitor-scout",
    run_id: RUN_ID,
    artifact_id: "brief-e57149d0",
    title: "Competitor brief",
    generated_at: "2026-08-20T07:42:55.617Z",
    document: {
      model: "openai/gpt-4o",
      sections: [
        {
          heading: "Pricing",
          paragraphs: [
            { body: "OpenClaw removed a tier and Hermes shipped a local build.", items: [0, 1] },
            { body: "Nobody has said why.", items: [] },
          ],
        },
      ],
    },
    derived_from: {
      artifact_id: "digest-e57149d0",
      run_id: RUN_ID,
      item_count: ITEMS.length,
      items_digest: fingerprintItems(ITEMS),
      ...over,
    },
  };
}

/* ---------------------------------------------------------------------- *
 * 1. Nothing an agent can reach
 * ---------------------------------------------------------------------- */

describe("the adjudication is outside everything an agent can name", () => {
  it("does not resolve through the lookup a brokered request uses", () => {
    /*
     * The whole safety argument in one assertion. `lib/broker/execute.ts` step 3
     * resolves an agent's request through `operationById` and refuses what it
     * cannot find — so an id this returns null for is an id no line written by
     * any agent, named anything at all, can reach.
     */
    expect(operationById("genlayer.brief.adjudicate")).toBeNull();
    expect(adjudicateOperationById("genlayer.brief.adjudicate")).toBe(GENLAYER_ADJUDICATE);
    expect(adjudicateOperationById("gmail.send")).toBeNull();
  });

  it("grew neither frozen path list and asks for no scope", () => {
    // The second of the four-part rule's counts, asserted rather than argued.
    expect(writePaths()).toEqual(["/gmail/v1/users/me/drafts"]);
    expect(spendPaths().some((path) => path.includes("genlayer"))).toBe(false);
    expect(GENLAYER_ADJUDICATE.required_scopes).toEqual([]);
  });

  it("declares every contract function it will ever call, and reclaim is not one", () => {
    /*
     * `WRITE_PATHS`' argument on a chain. `reclaim` is the only function on the
     * contract that moves anything, and it is refused by absence — which is
     * stronger than refusing it by a check, because a check can be edited
     * without anybody reading this list.
     */
    expect(ADJUDICATE_FUNCTIONS).toEqual([
      "open_commission",
      "submit_deliverable",
      "evaluate",
      "get_verdict",
    ]);
    expect(ADJUDICATE_FUNCTIONS).not.toContain("reclaim");
  });

  it("is a card sentence a person would say, with no identifier in it", () => {
    expect(GENLAYER_ADJUDICATE.label).toBe("Have this brief judged on GenLayer");
    expect(GENLAYER_ADJUDICATE.label).not.toMatch(/contract|commission_id|rpc/i);
    // The consequence names the irreversible thing, which is the one fact a
    // person needs before pressing this and cannot get back afterwards.
    expect(GENLAYER_ADJUDICATE.consequence).toMatch(/nobody can take them down/);
  });
});

/* ---------------------------------------------------------------------- *
 * 2. No address crosses
 * ---------------------------------------------------------------------- */

describe("what reaches the chain", () => {
  it("carries a receipt id instead of a URL, and no address at all", () => {
    const built = buildAdjudicationPayload(briefOf(), digestOf(), "dash-test-1");
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }

    /*
     * Over the whole serialised document rather than field by field, so a member
     * nobody thought about cannot carry one past this. Both rows in the fixture
     * have a `source_url` and an `item_url`, so there is something real to leak.
     */
    expect(built.payload.deliverable_json).not.toMatch(/https?:\/\//);
    expect(built.payload.deliverable_json).not.toContain("news.ycombinator.com");
    expect(built.payload.deliverable_json).not.toContain("hn.algolia.com");

    // What went instead: the digest's own artifact id and the row's original
    // position, both DASH's records rather than anything a model wrote.
    expect(built.payload.deliverable.evidence.map((row) => row.id)).toEqual([
      "digest-e57149d0#0",
      "digest-e57149d0#1",
    ]);

    // The sources that did not answer travel too — the terms ask for them by
    // name, and a payload with only the successes fails that criterion.
    expect(built.payload.deliverable.sources_fetched).toHaveLength(2);
    expect(built.payload.deliverable.sources_fetched[1]?.status).toBe("failed");
    // And the fetch receipts carry no address either.
    expect(JSON.stringify(built.payload.deliverable.sources_fetched)).not.toMatch(/https?:\/\//);
  });

  it("refuses a deliverable with an address in it at the last door", () => {
    /*
     * The third reading of the no-addresses rule, in the one place where getting
     * it wrong is permanent. Driven through `compose` rather than through the
     * builder, because `compose` is the door every value goes through.
     */
    const terms = commissionTerms();
    const refused = GENLAYER_ADJUDICATE.compose({
      commission_id: "dash-test-1",
      brief_digest: "a".repeat(64),
      deliverable_json: '{"paragraphs":[{"body":"see https://example.com for more"}]}',
      ...terms,
    });
    expect(refused).toEqual({
      ok: false,
      refusal: "input_malformed",
      field: "deliverable_json",
    });
  });

  it("hashes the exact bytes it sends, so a mangled byte is a refusal", () => {
    const built = buildAdjudicationPayload(briefOf(), digestOf(), "dash-test-1");
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }
    const composed = GENLAYER_ADJUDICATE.compose({
      commission_id: built.payload.commission_id,
      brief_digest: built.payload.brief_digest,
      deliverable_json: built.payload.deliverable_json,
      ...commissionTerms(),
    });
    expect(composed.ok).toBe(true);
    if (!composed.ok) {
      return;
    }
    // The contract re-derives the digest from the bytes and refuses a mismatch,
    // so the two must leave here as a matched pair.
    expect(composed.json["brief_digest"]).toBe(built.payload.brief_digest);
    expect(composed.json["deliverable_json"]).toBe(built.payload.deliverable_json);
    expect(String(composed.json["brief_digest"])).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses a commission id that is not one DASH minted", () => {
    for (const bad of ["", "dash test", "../etc/passwd", "a".repeat(129)]) {
      const composed = GENLAYER_ADJUDICATE.compose({
        commission_id: bad,
        brief_digest: "a".repeat(64),
        deliverable_json: '{"ok":true}',
        ...commissionTerms(),
      });
      expect(composed.ok).toBe(false);
    }
    // And the one this codebase actually mints passes.
    const at = new Date("2026-09-04T12:00:00.000Z");
    const minted = commissionIdFor(RUN_ID, at);
    expect(minted).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
    expect(minted).toContain("dash-e57149d0-");
    /*
     * Two presses in the same millisecond are two commissions, not a collision.
     * The contract refuses an id it already holds, and it is shared by every
     * DASH pointing at it — so uniqueness has to hold across machines, not just
     * within one clock.
     */
    expect(commissionIdFor(RUN_ID, at)).not.toBe(minted);
  });
});

/* ---------------------------------------------------------------------- *
 * 3. The join is re-checked
 * ---------------------------------------------------------------------- */

describe("the fingerprint join", () => {
  it("refuses a brief written from a different list", () => {
    const drifted = digestOf([
      { ...(ITEMS[0] as ArtifactItem), headline: "A different headline entirely" },
      ITEMS[1] as ArtifactItem,
    ]);
    const built = buildAdjudicationPayload(briefOf(), drifted, "dash-test-1");
    expect(built).toEqual({ ok: false, refusal: "items_mismatch" });
  });

  it("refuses a brief whose digest belongs to another run", () => {
    const built = buildAdjudicationPayload(
      briefOf({ run_id: "some-other-run" }),
      digestOf(),
      "dash-test-1",
    );
    expect(built).toEqual({ ok: false, refusal: "digest_missing" });
  });

  it("refuses a brief with nothing in it to judge", () => {
    const empty = briefOf();
    empty.document.sections = [];
    expect(buildAdjudicationPayload(empty, digestOf(), "dash-test-1")).toEqual({
      ok: false,
      refusal: "nothing_to_judge",
    });
  });

  it("keeps an uncited paragraph rather than dropping it", () => {
    /*
     * `readBrief`'s standing rule, carried onto the chain: deleting the
     * unsupported part is how a document comes to look better grounded than it
     * is. The contract's own citation audit is what turns an uncited paragraph
     * into a finding, and it cannot make one about a paragraph nobody sent.
     */
    const built = buildAdjudicationPayload(briefOf(), digestOf(), "dash-test-1");
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }
    expect(built.payload.deliverable.paragraphs).toHaveLength(2);
    expect(built.payload.deliverable.paragraphs[1]?.items).toEqual([]);
  });
});

/* ---------------------------------------------------------------------- *
 * 4. A decided transaction is not a verdict
 * ---------------------------------------------------------------------- */

/**
 * The receipt shape that cost the spike two runs.
 *
 * FINALIZED, the leader's own execution SUCCESS, and the committee refusing the
 * leader's verdict — recorded as iteration 8 of the spike's
 * `transcripts/stability.json`, one judgement in ten. Nothing was written, so
 * `get_verdict` would answer with an empty verdict, and a client reading only
 * the first two fields reports that as a success with a mysteriously empty
 * result.
 */
const NO_CONSENSUS_RECEIPT = {
  status_name: "FINALIZED",
  result_name: "MAJORITY_DISAGREE",
  consensus_data: {
    leader_receipt: [
      {
        execution_result: "SUCCESS",
        node_config: { provider: "openai", model: "gpt-4o" },
      },
    ],
    votes: { validator_a: "disagree", validator_b: "disagree", validator_c: "agree" },
  },
};

const APPLIED_RECEIPT = {
  status_name: "FINALIZED",
  result_name: "MAJORITY_AGREE",
  consensus_data: {
    leader_receipt: [
      {
        execution_result: "SUCCESS",
        node_config: { provider: "openai", model: "gpt-4o" },
      },
    ],
    votes: { validator_a: "agree", validator_b: "agree", validator_c: "agree" },
  },
};

describe("reading a receipt", () => {
  it("does not call a FINALIZED, SUCCESS, MAJORITY_DISAGREE transaction applied", () => {
    // Two of the three fields say yes. The third is the one that decides.
    expect(succeeded(NO_CONSENSUS_RECEIPT)).toBe(true);
    expect(applied(NO_CONSENSUS_RECEIPT)).toBe(false);

    const reading = readReceipt(NO_CONSENSUS_RECEIPT);
    expect(reading).toMatchObject({
      status: "FINALIZED",
      execution_result: "SUCCESS",
      consensus_result: "MAJORITY_DISAGREE",
      outcome: "no_consensus",
      leader_model: "openai/gpt-4o",
    });
    expect(reading.votes).toEqual({ disagree: 2, agree: 1 });
  });

  it("calls an agreed transaction applied", () => {
    expect(applied(APPLIED_RECEIPT)).toBe(true);
    expect(readReceipt(APPLIED_RECEIPT).outcome).toBe("applied");
  });

  it("calls a failed execution failed, whatever the consensus said", () => {
    expect(
      readReceipt({
        status_name: "FINALIZED",
        result_name: "MAJORITY_AGREE",
        consensus_data: { leader_receipt: [{ execution_result: "ERROR" }] },
      }).outcome,
    ).toBe("execution_failed");
  });

  it("reads nothing out of a shape it has never seen", () => {
    for (const nonsense of [null, undefined, 42, "FINALIZED", [], {}]) {
      expect(() => readReceipt(nonsense)).not.toThrow();
      expect(applied(nonsense)).toBe(false);
    }
  });
});

/* ---------------------------------------------------------------------- *
 * The run, end to end, with a chain that is not there
 * ---------------------------------------------------------------------- */

/** A chain that answers with recorded receipts. No network, no key, no chain. */
function fakeChain(evaluateReceipt: unknown, verdictBody: unknown): {
  chain: GenLayerChain;
  calls: string[];
} {
  const calls: string[] = [];
  const chain: GenLayerChain = {
    address: "0x0000000000000000000000000000000000000001",
    fund: () => Promise.resolve(),
    write: (functionName) => {
      calls.push(functionName);
      return Promise.resolve(`0x${functionName.length.toString(16).padStart(64, "0")}`);
    },
    waitFinalized: (hash) =>
      Promise.resolve(hash.endsWith("8") ? evaluateReceipt : APPLIED_RECEIPT),
    read: (functionName) => {
      calls.push(functionName);
      return Promise.resolve(verdictBody);
    },
  };
  return { chain, calls };
}

const CLOCK = {
  now: () => new Date("2026-09-04T12:00:00.000Z"),
  sleep: () => Promise.resolve(),
};

describe("one run", () => {
  it("reports no verdict when the committee refused the leader", async () => {
    /*
     * The path the packet is most likely to ship broken: a run that reaches a
     * decided, successful transaction and has no verdict to show for it. What
     * must not happen is a `get_verdict` read — nothing was written, so the
     * answer would be an empty verdict, and returning it would report a result
     * that does not exist.
     */
    const { chain, calls } = fakeChain(NO_CONSENSUS_RECEIPT, { verdict: "", reasons: [] });
    const result = await adjudicateBrief(
      briefOf(),
      digestOf(),
      defaultGenLayerConnection(),
      () => Promise.resolve(chain),
      CLOCK,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.verdict).toBeNull();
    expect(result.reading.outcome).toBe("no_consensus");
    expect(calls).toEqual(["open_commission", "submit_deliverable", "evaluate"]);
    expect(calls).not.toContain("get_verdict");
  });

  it("reports the verdict when the committee agreed", async () => {
    const { chain, calls } = fakeChain(APPLIED_RECEIPT, {
      verdict: "ACCEPTED",
      reasons: ["Every paragraph is supported by the rows it cites."],
      judge_output: '```json\n{"verdict": "ACCEPTED"}\n```',
    });
    const result = await adjudicateBrief(
      briefOf(),
      digestOf(),
      defaultGenLayerConnection(),
      () => Promise.resolve(chain),
      CLOCK,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.verdict).toBe("ACCEPTED");
    expect(result.reasons).toEqual(["Every paragraph is supported by the rows it cites."]);
    expect(calls).toContain("get_verdict");
  });

  it("never publishes a brief whose payload it refused", async () => {
    const { chain, calls } = fakeChain(APPLIED_RECEIPT, { verdict: "ACCEPTED", reasons: [] });
    const result = await adjudicateBrief(
      briefOf({ items_digest: "0".repeat(64) }),
      digestOf(),
      defaultGenLayerConnection(),
      () => Promise.resolve(chain),
      CLOCK,
    );
    expect(result).toEqual({ ok: false, commission_id: null, failure: "payload_refused" });
    // The refusal happens before anything reaches the chain, so the commission
    // that would have had to be explained afterwards never exists.
    expect(calls).toEqual([]);
  });
});

/* ---------------------------------------------------------------------- *
 * The projection, and the words around it
 * ---------------------------------------------------------------------- */

describe("the projection", () => {
  it("returns a verdict and reasons and drops the raw judge output", () => {
    const projected = GENLAYER_ADJUDICATE.project({
      verdict: "REJECTED",
      reasons: ["P1 overstates the reaction counts on E1 and E3."],
      judge_output: '```json\n{"verdict": "REJECTED"}\n```',
    });
    expect(projected).toEqual({
      verdict: "REJECTED",
      reasons: ["P1 overstates the reaction counts on E1 and E3."],
    });
    expect(Object.keys(projected).sort()).toEqual(["reasons", "verdict"]);
  });

  it("refuses a verdict outside the closed list", () => {
    expect(GENLAYER_ADJUDICATE.project({ verdict: "PROBABLY_FINE", reasons: [] }).verdict).toBeNull();
    for (const verdict of ADJUDICATION_VERDICTS) {
      expect(GENLAYER_ADJUDICATE.project({ verdict, reasons: [] }).verdict).toBe(verdict);
    }
  });

  it("bounds what a network can put in a reason", () => {
    const projected = GENLAYER_ADJUDICATE.project({
      verdict: "ACCEPTED",
      reasons: [...Array(40).keys()].map(() => "x".repeat(4_000)),
    });
    expect(projected.reasons).toHaveLength(12);
    expect(projected.reasons[0]).toHaveLength(400);
  });

  it("reads nothing out of a body it has never seen", () => {
    for (const nonsense of [null, undefined, 42, "ACCEPTED", []]) {
      expect(GENLAYER_ADJUDICATE.project(nonsense)).toEqual({ verdict: null, reasons: [] });
    }
  });
});

describe("the words", () => {
  it("gives the no-verdict outcome a way out rather than a spinner", () => {
    const said = describeAdjudication("no_consensus", null);
    expect(said.next_action).not.toBeNull();
    expect(said.tone).toBe("warn");
    // Not worded as a fault of the briefing, because it is not one.
    expect(said.meaning).toMatch(/one judgement in ten/);
  });

  it("says something different for every stage and every failure", () => {
    const stages = ADJUDICATION_STAGES.map(describeAdjudicationStage);
    expect(new Set(stages).size).toBe(stages.length);

    const failures = (
      [
        "network_unreachable",
        "faucet_refused",
        "transaction_refused",
        "payload_refused",
        "abandoned",
      ] as const
    ).map(describeAdjudicationFailure);
    expect(new Set(failures.map((one) => one.headline)).size).toBe(failures.length);
    // Every one leads somewhere, which is what makes them five and not one.
    expect(failures.every((one) => one.next_action !== null)).toBe(true);
  });

  it("never renders an address of its own", () => {
    const everything = [
      describeAdjudication("applied", "ACCEPTED"),
      describeAdjudication("applied", "REJECTED"),
      describeAdjudication("no_consensus", null),
      describeAdjudicationFailure("abandoned"),
    ]
      .flatMap((one) => [one.headline, one.meaning, one.next_action ?? ""])
      .join(" ");
    expect(everything).not.toMatch(/https?:\/\//);
  });
});

/* ---------------------------------------------------------------------- *
 * The connection that holds no key
 * ---------------------------------------------------------------------- */

describe("the genlayer connection", () => {
  it("is an endpoint and an address, and nothing secret", () => {
    const connection = defaultGenLayerConnection();
    expect(Object.keys(connection).sort()).toEqual([
      "chain_id",
      "contract_address",
      "is_default",
      "network_label",
      "rpc_url",
    ]);
    // The point of the whole design: there is no field a credential could go in.
    expect(JSON.stringify(connection)).not.toMatch(/key|secret|token|password/i);
  });

  it("refuses an endpoint that is not https, and an address that is not one", () => {
    expect(resolveGenLayerConnection({ rpc_url: "http://studio.genlayer.com/api" })).toEqual({
      ok: false,
      refusal: "endpoint_invalid",
    });
    expect(resolveGenLayerConnection({ rpc_url: "not a url" })).toEqual({
      ok: false,
      refusal: "endpoint_invalid",
    });
    expect(resolveGenLayerConnection({ contract_address: "0xnope" })).toEqual({
      ok: false,
      refusal: "address_invalid",
    });
  });

  it("treats a blank override as never configured rather than as a mistake", () => {
    const resolved = resolveGenLayerConnection({ rpc_url: "  ", contract_address: null });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      return;
    }
    expect(resolved.connection).toEqual(defaultGenLayerConnection());
  });

  it("stops claiming the network's name once somebody points it elsewhere", () => {
    const resolved = resolveGenLayerConnection({ rpc_url: "https://my-node.example/rpc" });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      return;
    }
    expect(resolved.connection.network_label).toBe("my-node.example");
    expect(resolved.connection.is_default).toBe(false);
  });
});
