/**
 * One brief, turned into the bytes a judge on GenLayer is shown (MAR-863,
 * ADR 0033).
 *
 * The port of `scripts/dash-brief-to-payload.mjs` from the Agent Tank spike
 * (`orchestratemcp/brief-acceptance`), which is where every decision below was
 * paid for in real Studionet runs. What that script proved is kept verbatim;
 * what it re-derived by hand — the fingerprint — is imported from the module
 * that already owns it.
 *
 * ## What crosses, and the one thing that deliberately does not
 *
 * What crosses is the prose, the index bindings, and DASH's own receipts. What
 * does **not** cross is any address. DASH's standing rule is that model-authored
 * prose can never carry a link — `readBrief` drops a paragraph whole rather than
 * cleaning one out of it — and this module keeps that property on a public chain
 * by giving every evidence row a **receipt id** (`<digest artifact>#<n>`) where
 * a URL would have gone. The receipt id resolves back to a row in the run DASH
 * is holding, so a judge can check a claim against the row it was written from,
 * and a model can never mint one.
 *
 * `tests/broker-genlayer.test.ts` asserts that no `http://` or `https://`
 * reaches the case file, over the whole serialised payload rather than field by
 * field.
 *
 * ## The join is re-checked here, and a failure is a refusal
 *
 * `derived_from.items_digest` is a sha256 over the digest's own item identities,
 * computed by DASH before the brief was written. This recomputes it against the
 * digest DASH is holding *now*. If the brief was written from a different list,
 * **the payload is refused** rather than shipped with citations that point at
 * the wrong rows — which is exactly the ruling `lib/brief/fingerprint.ts` makes
 * for the renderer, and the reason `fingerprintItems` is imported rather than
 * transcribed. A second copy of that hash is a second thing to drift, and the
 * cost of drift here is a public, permanent document whose citations are wrong.
 *
 * ## Node only
 *
 * `fingerprintItems` reaches `node:crypto`, so this module does too. It is
 * called from Electron main and from tests, never from a component — the
 * boundary `lib/brief/citations.ts` exists to keep.
 */

import { createHash } from "node:crypto";

import { fingerprintItems } from "../brief/fingerprint";
import type { ArtifactItem, BriefArtifact, DigestArtifact } from "../contracts";

/* ---------------------------------------------------------------------- *
 * Bounds
 * ---------------------------------------------------------------------- */

/**
 * The longest an evidence row's summary may be on chain.
 *
 * Six hundred characters, the spike's own figure. Every byte of the deliverable
 * is stored in contract state and read back into a case file a model is charged
 * to read, so a row is trimmed to the part a claim could have been written from
 * rather than shipped whole.
 */
const MAX_EVIDENCE_SUMMARY = 600;

/**
 * Extra members of a collected row that travel, by name.
 *
 * A closed list rather than a spread of whatever the item carries, and the
 * reason is Studionet run 1: a brief cited reaction and comment counts that the
 * digest row held and the projection was dropping, and the judge rejected an
 * honest brief because — as shipped — the claim had no support in the evidence
 * it was bound to. So a field an agent's own collector writes and a paragraph
 * could be written *from* has to travel.
 *
 * `ArtifactItem` types six members and the contract permits more; these are the
 * ones DASH's own agents actually write. Every one is read defensively, and only
 * a string, a finite number or a boolean is carried — an object here would be a
 * structure nobody bounded reaching a public chain.
 *
 * **`source_url` and `item_url` are absent and that is the point.** They are the
 * two members of a row that are addresses, and the receipt id carries the
 * provenance in their place.
 */
const EVIDENCE_EXTRA_FIELDS = [
  "competitor",
  "kind",
  "signal",
  "reactions",
  "comments",
  "author",
  "state",
] as const;

/* ---------------------------------------------------------------------- *
 * The shape that leaves the machine
 * ---------------------------------------------------------------------- */

/** One paragraph of the brief, bound to the evidence it cites by position. */
export interface DeliverableParagraph {
  /** The heading it sat under. Context for the judge; the citation binds here. */
  section: string;
  body: string;
  /** Positions into `evidence`, renumbered. Empty means uncited, and says so. */
  items: number[];
}

/** One row of the run's own record, as the judge sees it. Never an address. */
export interface DeliverableEvidence {
  /** `<digest artifact id>#<original position>`. Resolves back into DASH. */
  id: string;
  headline: string;
  source_name: string | null;
  summary: string | null;
  published_at: string | null;
  /** Whatever of `EVIDENCE_EXTRA_FIELDS` the row actually carried. */
  [field: string]: string | number | boolean | null | number[] | undefined;
}

/** One fetch receipt, so the judge can see which sources did not answer. */
export interface DeliverableSource {
  source_name: string;
  status: string;
  item_count: number | null;
}

/**
 * The document the contract stores and the judge reads.
 *
 * Flat on purpose. A section heading is context for its paragraphs, but the
 * citation binds to the **paragraph**, so the paragraph is the unit that ships
 * and the heading rides along on it.
 */
export interface Deliverable {
  title: string;
  agent: string;
  generated_at: string;
  /** What the provider said wrote the brief, or null. The agent's report. */
  model: string | null;
  provenance: {
    run_id: string;
    brief_artifact_id: string;
    digest_artifact_id: string;
    digest_item_count: number;
    items_digest: string;
  };
  paragraphs: DeliverableParagraph[];
  evidence: DeliverableEvidence[];
  sources_fetched: DeliverableSource[];
}

/**
 * Everything one adjudication needs, and nothing an author could fill.
 *
 * `deliverable_json` and `brief_digest` are two renderings of one fact and are
 * both carried because the contract re-derives the second from the first and
 * refuses a mismatch. DASH computing it here rather than letting the contract
 * compute it alone is what makes a transport that mangled a byte a refusal
 * rather than a differently-judged document.
 */
export interface AdjudicationPayload {
  commission_id: string;
  /** sha256 of `deliverable_json`, lowercase hex. The contract re-derives it. */
  brief_digest: string;
  /** The exact bytes submitted. Compared by the contract against the digest. */
  deliverable_json: string;
  /** The same document, parsed, for DASH's own surfaces. Never sent twice. */
  deliverable: Deliverable;
}

/**
 * Why a brief could not be turned into a payload.
 *
 * Four, and each leads somewhere different for the person reading it —
 * `lib/copy/genlayer.ts` says which. Collapsing them into one "could not
 * prepare" would put a reader with a stale digest and a reader with an empty
 * brief on the same dead end.
 */
export type PayloadRefusal =
  /** DASH is not holding the digest this brief names, or not for this run. */
  | "digest_missing"
  /** The digest is here and is a different list. The spike's own refusal. */
  | "items_mismatch"
  /** The brief has no paragraphs, so there is nothing for a judge to read. */
  | "nothing_to_judge"
  /** A citation, once renumbered, pointed at no row. DASH's own bug if it fires. */
  | "citation_unresolvable";

export type PayloadResult =
  | { ok: true; payload: AdjudicationPayload }
  | { ok: false; refusal: PayloadRefusal };

/* ---------------------------------------------------------------------- *
 * The build
 * ---------------------------------------------------------------------- */

/**
 * Build the payload for one brief, or refuse.
 *
 * Pure, and every refusal is returned rather than thrown, for
 * `lib/broker/operations.ts`' reason: a refusal that has to be caught is a
 * refusal a caller can forget to catch, and this one decides whether something
 * permanent happens.
 *
 * `commissionId` is supplied rather than derived, because a resubmission after a
 * no-verdict needs a *different* id against the same brief — the contract
 * refuses an id it already holds — and deriving one here from the run id would
 * make the retry path impossible without a second entry point. See
 * `commissionIdFor`.
 */
export function buildAdjudicationPayload(
  brief: BriefArtifact,
  digest: DigestArtifact,
  commissionId: string,
): PayloadResult {
  const from = brief.derived_from;

  /*
   * The digest is the one this brief names, for this run.
   *
   * `run_id` is checked as well as `artifact_id`, `resolveBriefCitations`'
   * rule: an agent can write a brief from a previous run's digest, and joining
   * across runs in silence is how a document gets judged against a list it was
   * not written from.
   */
  if (digest.artifact_id !== from.artifact_id || digest.run_id !== from.run_id) {
    return { ok: false, refusal: "digest_missing" };
  }
  if (digest.items.length !== from.item_count) {
    return { ok: false, refusal: "items_mismatch" };
  }
  if (fingerprintItems(digest.items) !== from.items_digest) {
    return { ok: false, refusal: "items_mismatch" };
  }

  const paragraphs: DeliverableParagraph[] = [];
  for (const section of brief.document.sections) {
    for (const paragraph of section.paragraphs) {
      paragraphs.push({
        section: section.heading,
        body: paragraph.body,
        // Absent is uncited, which `readBrief` keeps and marks rather than
        // dropping. An empty list ships and the judge is told the paragraph
        // cites nothing — see the citation audit in the contract.
        items: [...(paragraph.items ?? [])],
      });
    }
  }
  if (paragraphs.length === 0) {
    return { ok: false, refusal: "nothing_to_judge" };
  }

  /*
   * Only the rows a paragraph actually points at, renumbered.
   *
   * A sixty-row digest is mostly rows no paragraph cites, and every byte of
   * this is stored on chain and read back into a prompt. The receipt id keeps
   * the **original** position, so a trimmed list still resolves back to the run
   * DASH is holding.
   *
   * A number outside the digest is dropped here rather than shipped as a
   * dangling citation. The agent already range-checks against its own list, and
   * `readBrief` bounds what a model may write; this is the third reading of the
   * same fact, in the one place where getting it wrong is permanent.
   */
  const cited = [...new Set(paragraphs.flatMap((paragraph) => paragraph.items))]
    .filter((index) => Number.isInteger(index) && index >= 0 && index < digest.items.length)
    .sort((left, right) => left - right);

  const position = new Map(cited.map((original, index) => [original, index]));
  const evidence = cited.map((original) =>
    evidenceRow(digest.items[original] as ArtifactItem, digest.artifact_id, original),
  );

  for (const paragraph of paragraphs) {
    const renumbered: number[] = [];
    for (const original of paragraph.items) {
      const at = position.get(original);
      if (at !== undefined) {
        renumbered.push(at);
      }
    }
    paragraph.items = renumbered;
  }

  /*
   * A citation that survived the filter must resolve. If one does not, the map
   * and the list disagree, which is DASH's own bug rather than anything about
   * the brief — refused rather than shipped, because the alternative is a judge
   * being asked about a row that is not in front of it.
   */
  if (paragraphs.some((paragraph) => paragraph.items.some((at) => evidence[at] === undefined))) {
    return { ok: false, refusal: "citation_unresolvable" };
  }

  const deliverable: Deliverable = {
    title: brief.title,
    agent: brief.agent,
    generated_at: brief.generated_at,
    model: brief.document.model ?? null,
    provenance: {
      run_id: brief.run_id,
      brief_artifact_id: brief.artifact_id,
      digest_artifact_id: digest.artifact_id,
      digest_item_count: from.item_count,
      items_digest: from.items_digest,
    },
    paragraphs,
    evidence,
    /*
     * The sources that did **not** answer travel too, and that is the terms'
     * doing rather than an economy of this projection: the evidence
     * requirements ask for the run's fetch receipts including the failures, so
     * a deliverable that shipped only the successes would be asking the judge
     * to grade a run it cannot see the shape of.
     */
    sources_fetched: (digest.sources_fetched ?? []).map((source) => ({
      source_name: source.source_name,
      status: source.status,
      item_count: source.item_count ?? null,
    })),
  };

  const deliverableJson = JSON.stringify(deliverable);
  return {
    ok: true,
    payload: {
      commission_id: commissionId,
      brief_digest: createHash("sha256").update(deliverableJson, "utf8").digest("hex"),
      deliverable_json: deliverableJson,
      deliverable,
    },
  };
}

/**
 * One collected row, as evidence, carrying no address.
 *
 * `id` is where a URL would have been. It is built from the digest's own
 * artifact id and the row's original position, which are both DASH's records
 * rather than anything a model wrote — so the provenance is checkable and the
 * prose still carries no link.
 */
function evidenceRow(
  item: ArtifactItem,
  digestArtifactId: string,
  original: number,
): DeliverableEvidence {
  const row: DeliverableEvidence = {
    id: `${digestArtifactId}#${String(original)}`,
    headline: item.headline,
    source_name: item.source_name ?? null,
    summary: typeof item.summary === "string" ? item.summary.slice(0, MAX_EVIDENCE_SUMMARY) : null,
    published_at: item.published_at ?? null,
  };

  const extras = item as unknown as Record<string, unknown>;
  for (const field of EVIDENCE_EXTRA_FIELDS) {
    const value = extras[field];
    if (typeof value === "string" && value.length > 0) {
      row[field] = value.slice(0, MAX_EVIDENCE_SUMMARY);
    } else if (typeof value === "number" && Number.isFinite(value)) {
      row[field] = value;
    } else if (typeof value === "boolean") {
      row[field] = value;
    }
  }
  return row;
}

/**
 * How many characters of one brief a judge would be shown.
 *
 * For the surface that has to say what is about to be published before somebody
 * presses the button. A count rather than the bytes, because the sentence it
 * feeds is about size and not about content.
 */
export function deliverableSize(payload: AdjudicationPayload): number {
  return payload.deliverable_json.length;
}
