/**
 * What every agent in the fleet has produced, as the chief may read it
 * (MAR-744, item 1 and item 2).
 *
 * `lib/ai/ask.ts` already answers *"what did **this** agent find about X"* from
 * one agent's saved items, and does it with the two properties that make an
 * answer checkable: the material is **selected** so a question costs the same
 * tomorrow as today, and the citations beside the answer are **DASH's own
 * record of what it sent** rather than anything read out of the reply. This
 * module is that machinery, aimed at the fleet instead of at one agent.
 *
 * It is deliberately a thin layer over `lib/ai/ask.ts` rather than a second
 * implementation. `questionTerms`, the common-word list, the scoring, the item
 * ceiling and the character budget are all imported. Two selectors would be two
 * chances for *what did the scout find* and *what did my fleet find* to disagree
 * about the same words.
 *
 * ## The three differences from the per-agent version
 *
 * **An item knows which agent produced it.** `SavedItem` carries a run and an
 * artifact but no agent, because the per-agent surface already knew. A fleet
 * answer must be able to say *your news scout found this* and must be able to
 * link back to the right agent's page, so `ChiefItem` adds the one field.
 *
 * **Newest means newest across the fleet.** `selectMaterial`'s fallback arm
 * takes the caller's order, and the caller there is one agent whose artifacts
 * arrive newest-first. Concatenating three agents' lists that way would put all
 * of the first agent's oldest items ahead of the second agent's newest, so
 * *"pull out the most current news"* would answer from whichever agent sorted
 * first. `chiefLibrary` sorts by the moment the report was saved, which is what
 * that question means.
 *
 * **Briefs count.** `savedThingsForAgent` filters to digests, with a good reason
 * for that surface — *a draft is a thing an agent wrote, not a thing it found*.
 * A brief is neither: ADR 0025 makes it a document **bound to its evidence**,
 * written from a digest of the same run, and it is the closest thing DASH has to
 * the answer to *"pull out the most current news"*. So a brief's own paragraphs
 * enter the library as items, attributed to their agent and carrying the run
 * they belong to. Drafts are still out, and for the same reason as before.
 *
 * ## Untrusted, and labelled as such all the way through
 *
 * Every string in a `ChiefItem` came from a feed an agent read or from a model
 * an agent asked. ADR 0002 invariant 7 treats both as hostile by default, and
 * `lib/ai/ask.ts`' structural answer holds here unchanged: nothing in DASH reads
 * the chief's answer, no link is followed out of it, no command is derived from
 * it. What this module adds is that the *material* says which agent each item
 * came from, so the fence around it can name its provenance rather than implying
 * DASH wrote it.
 *
 * ## Pure
 *
 * No store, no clock. The artifacts arrive as an argument — main reads them from
 * `dash.sqlite`, the runner receives them in the pushed snapshot — which is what
 * lets one selector serve both rooms and lets `tests/chief-library.test.ts`
 * drive every case with no database.
 */

import {
  MAX_ITEMS_PER_QUESTION,
  MAX_MATERIAL_BUDGET,
  questionTerms,
} from "../ai/ask";
import type { RunArtifact } from "../contracts";
import { isBriefArtifact, isDigestArtifact } from "../contracts";

/* ---------------------------------------------------------------------- *
 * What is in the library
 * ---------------------------------------------------------------------- */

/**
 * One thing an agent produced, flattened out of the run it came from.
 *
 * A run is the wrong unit for a question — `SavedItem`'s own argument, and it
 * applies harder here, because *"what has my fleet found about tariffs"* spans
 * agents as well as runs and a person asking it is thinking about neither.
 */
export interface ChiefItem {
  /** The agent id. A value: it keys the citation and links out, never prose. */
  agent: string;
  /** `agentDisplayName`'s answer — the only name an answer may print. */
  agent_title: string;
  run_id: string;
  artifact_id: string;
  /** Which of the two kinds this came out of. Drives the word on the citation. */
  from: "digest" | "brief";
  /** The report's own title. The nearest thing to *which document this was*. */
  report_title: string;
  /** When the agent said it made the report. ISO-8601, and what ordering uses. */
  saved_at: string;
  headline: string;
  summary: string | null;
  /** The feed's name for where this came from, for a digest item. */
  source_name: string | null;
  /** ISO-8601 where the feed gave a date DASH could read, else null. */
  published_at: string | null;
  /**
   * The item's own link, from the feed the agent read, or null.
   *
   * Never sent to a model — see `renderChiefMaterial`. It lives on the citation,
   * where it is DASH's own record and is rendered by DASH.
   */
  item_url: string | null;
}

/** One agent's artifacts, as either host hands them over. */
export interface ChiefAgentOutputs {
  agent: string;
  title: string;
  artifacts: readonly RunArtifact[];
}

/**
 * How many items the whole fleet contributes to one library.
 *
 * A ceiling on the *input* to selection, not on what a question sends — that is
 * `MAX_ITEMS_PER_QUESTION`, imported and unchanged. This one exists because the
 * runner receives the library in a pushed snapshot over a local HTTP channel,
 * and a fleet with a year of daily runs would otherwise push a document that
 * grows without limit at every settings change.
 *
 * Two hundred is far more than selection will ever choose from and few enough
 * that the push stays a small object. Newest first, so what falls off the end is
 * the oldest thing in the fleet rather than an arbitrary agent's whole history.
 */
export const MAX_LIBRARY_ITEMS = 200;

/**
 * The fleet's output as one list, newest first.
 *
 * Ordering is by `saved_at` and ties break on the agent id, so the same fleet
 * produces the same list twice — a selection a person cannot predict is a
 * selection they cannot check, and *"pull out the most current news"* answered
 * from a different agent on each press would be exactly that.
 */
export function chiefLibrary(outputs: readonly ChiefAgentOutputs[]): ChiefItem[] {
  const items: ChiefItem[] = [];
  for (const output of outputs) {
    for (const artifact of output.artifacts) {
      if (isDigestArtifact(artifact)) {
        for (const item of artifact.items) {
          items.push({
            agent: output.agent,
            agent_title: output.title,
            run_id: artifact.run_id,
            artifact_id: artifact.artifact_id,
            from: "digest",
            report_title: artifact.title,
            saved_at: artifact.generated_at,
            headline: item.headline,
            summary: item.summary ?? null,
            source_name: item.source_name ?? null,
            published_at: item.published_at ?? null,
            item_url: item.item_url ?? null,
          });
        }
        continue;
      }
      if (isBriefArtifact(artifact)) {
        for (const section of artifact.document.sections) {
          const text = section.paragraphs.map((paragraph) => paragraph.body).join(" ").trim();
          if (text.length === 0) {
            continue;
          }
          items.push({
            agent: output.agent,
            agent_title: output.title,
            run_id: artifact.run_id,
            artifact_id: artifact.artifact_id,
            from: "brief",
            report_title: artifact.title,
            saved_at: artifact.generated_at,
            /*
             * The section's heading is the headline and its paragraphs are the
             * summary. Both are model-authored, which is why neither is treated
             * as a fact anywhere below — the same standing every digest headline
             * already has, and a brief's own contract (ADR 0025) says its
             * paragraphs carry no address, so there is nothing here to link.
             */
            headline: section.heading,
            summary: text,
            source_name: null,
            /* A brief's section has no date of its own; the report's does, and
               that is `saved_at` two fields up rather than a second copy here. */
            published_at: null,
            item_url: null,
          });
        }
      }
      /* A draft falls through. See this module's header. */
    }
  }

  items.sort((left, right) => {
    const when = Date.parse(right.saved_at) - Date.parse(left.saved_at);
    if (Number.isFinite(when) && when !== 0) {
      return when;
    }
    return left.agent.localeCompare(right.agent);
  });
  return items.slice(0, MAX_LIBRARY_ITEMS);
}

/* ---------------------------------------------------------------------- *
 * Choosing what one question reads
 * ---------------------------------------------------------------------- */

/** Why these items and not others. `SelectionBasis`, narrowed to what applies. */
export type ChiefSelectionBasis =
  /** At least one item mentions what was asked about. */
  | "matched"
  /**
   * Nothing matched, or nothing distinctive was asked, so the newest were taken.
   *
   * This is the arm *"pull out the most current news"* lands in, and it is a real
   * answer rather than a miss: `questionTerms` drops `news`, `latest` and
   * `recent` as words that appear in every report ever written, so that question
   * has nothing to match on and the newest items are exactly what it asked for.
   * The caller still says which arm fired, because an answer built from the
   * newest items when somebody asked about tariffs has to admit it found none.
   */
  | "newest"
  /** The fleet has produced nothing. There is nothing to answer from. */
  | "nothing_saved";

export interface ChiefSelection {
  basis: ChiefSelectionBasis;
  /** The words searched for. Empty when nothing distinctive was asked. */
  terms: string[];
  /** The items chosen, best first for a match and newest first otherwise. */
  chosen: ChiefItem[];
  /** How many items the fleet has produced in total, matched or not. */
  available: number;
}

/**
 * Everything one item could be matched on, as one lowercase haystack.
 *
 * The agent's title is in it, which the per-agent version has no need of: on
 * this surface *"what did the news scout find"* is a question about which agent,
 * and an answer that ignored the name would select from the wrong one's reports.
 */
function haystack(item: ChiefItem): string {
  return [
    item.headline,
    item.summary ?? "",
    item.source_name ?? "",
    item.report_title,
    item.agent_title,
  ]
    .join(" ")
    .toLowerCase();
}

/** How many of a question's distinct words this item mentions. */
function score(item: ChiefItem, terms: readonly string[]): number {
  if (terms.length === 0) {
    return 0;
  }
  const text = haystack(item);
  return terms.filter((term) => text.includes(term)).length;
}

/**
 * Choose what to answer from.
 *
 * `selectMaterial`'s shape and its bounds, over `ChiefItem`. Newest first within
 * a score, which `sort`'s stability gives for free because the library arrives
 * newest first — so a question about something the fleet has covered for months
 * gets this week's coverage rather than the first week's.
 */
export function selectChiefMaterial(
  library: readonly ChiefItem[],
  question: string,
): ChiefSelection {
  const terms = questionTerms(question);
  if (library.length === 0) {
    return { basis: "nothing_saved", terms, chosen: [], available: 0 };
  }

  const scored = library
    .map((item) => ({ item, score: score(item, terms) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  const basis: ChiefSelectionBasis = scored.length > 0 ? "matched" : "newest";
  const ordered = scored.length > 0 ? scored.map((entry) => entry.item) : [...library];

  const chosen: ChiefItem[] = [];
  let spent = 0;
  for (const item of ordered) {
    if (chosen.length >= MAX_ITEMS_PER_QUESTION) {
      break;
    }
    const size = renderChiefItem(item, chosen.length + 1).length;
    if (spent + size > MAX_MATERIAL_BUDGET) {
      // Stop rather than skip, `selectMaterial`'s reason: skipping would reorder
      // the material by length, so *"what did you find"* would be answered from
      // whichever items happened to be short.
      break;
    }
    chosen.push(item);
    spent += size;
  }

  return { basis, terms, chosen, available: library.length };
}

/* ---------------------------------------------------------------------- *
 * What the model is sent
 * ---------------------------------------------------------------------- */

/**
 * One item as the model sees it.
 *
 * Numbered, so an answer can refer to something and a reader can find it in the
 * list beside the answer. Labelled field by field, because an unlabelled blob
 * invites a model to guess which part is the source and which is the claim.
 *
 * **`item_url` is deliberately absent**, `renderItem`'s rule and the reason it
 * is worth repeating here: an address in the material is an address the model
 * can repeat into an answer, and an answer carrying a link that came out of a
 * feed is a link a person might click. The link lives on the citation, which is
 * DASH's own record and is drawn by DASH.
 *
 * The agent's title **is** sent, unlike the per-agent version where there is
 * only one agent to be talking about. It is `agentDisplayName`'s answer, the one
 * name DASH prints anywhere, so a model repeating it repeats a string a person
 * already sees on a card.
 */
export function renderChiefItem(item: ChiefItem, index: number): string {
  const lines = [`[${String(index)}] ${item.headline}`, `Found by: ${item.agent_title}`];
  if (item.from === "brief") {
    lines.push(`From its written brief: ${item.report_title}`);
  }
  if (item.source_name !== null) {
    lines.push(`Source: ${item.source_name}`);
  }
  if (item.published_at !== null) {
    lines.push(`Published: ${item.published_at}`);
  }
  if (item.summary !== null) {
    lines.push(item.summary);
  }
  return `${lines.join("\n")}\n\n`;
}

/**
 * The chosen items as one string, or an empty string when none were chosen.
 *
 * The caller decides what an empty one means; this function does not invent a
 * sentence for it, because the two rooms owe a person different words for
 * *there was nothing to read* and `lib/copy/` is where those live.
 */
export function renderChiefMaterial(selection: ChiefSelection): string {
  return selection.chosen
    .map((item, index) => renderChiefItem(item, index + 1))
    .join("")
    .trimEnd();
}
