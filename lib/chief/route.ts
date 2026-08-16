/**
 * Who the Chief hands a request to, and why (MAR-419, DASH-15; adopted by
 * MAR-648).
 *
 * ## This slice has no model, and that is the design rather than a stub
 *
 * Written for MAR-419 and parked unmerged; MAR-648 is where it ships, unchanged
 * except for this paragraph, because the question it answers is the one the
 * chief's composer asks on every press. **The reason it still has no model is
 * no longer that nothing in DASH talks to one** — MAR-545 built that path and
 * ADR 0012 ratified it. It is that the chief cannot reach it: `broker.handle`
 * resolves a manifest per agent (`lib/broker/execute.ts`) and the fleet
 * principal has none, and `connectionSecretName` only ever emits
 * `dash.connection.`, so the fleet's own key is unreachable from the spend path
 * by construction (`lib/fleet/principal.ts` states that lock deliberately).
 * Both are broker-side changes with an ADR behind them, and neither is chat IA.
 *
 * So the chief answers what it can source and routes what it cannot, which is
 * this module. What the issue also states, separately and in its own sentence,
 * is the routing rule:
 *
 *   *"Routing decided from declared manifest goals and capabilities — not
 *   guessed from agent names, and not inferred from telemetry."*
 *
 * That is a **pure function of the manifests**, and it is the issue's own first
 * acceptance criterion. So it is what this slice builds: a conversation that
 * really routes, really refuses, and really names what is missing — with the
 * model-shaped half left as the next slice rather than imitated in this one.
 *
 * It also inverts the risk the issue is most careful about. The hard part of
 * MAR-419 is that *"agent output is untrusted data, not instructions"*, and the
 * blast radius comes from a model reading that output while holding tools. A
 * Chief with no model has no such path, and the rule below is what keeps that
 * true rather than merely currently-true: the matcher reads only what a manifest
 * **declared**, never what a run **produced**.
 *
 * ## The name is not evidence
 *
 * An agent called `email-sender` that declares no mail capability must not be
 * chosen for "send an email", and `agent.name` is therefore not in the corpus
 * this matches against — a rule that is only worth writing down because the
 * name is the most tempting thing in the record and the easiest to match well
 * on. `tests/chief-route.test.ts` drives exactly that case.
 *
 * What *is* in the corpus is what the author declared: the goal sentence, and
 * the component ids of the planned route, split into their own words. Both come
 * out of the manifest. Nothing here reads telemetry, run history or a verdict,
 * because those describe what an agent *did* and routing is a question about
 * what it is *for*.
 */

import type { OName } from "../brand/o-cast";

/** One agent, reduced to the three things routing is allowed to look at. */
export interface ChiefAgent {
  name: string;
  /** The author's own sentence. Untrusted text — see `lib/views/chief.ts`. */
  goal: string;
  avatar: OName;
  /** `planned_route[].component_id`, in declared order. */
  capabilities: readonly string[];
}

/**
 * The whole document the Chief surface reads.
 *
 * Declared **here**, in the pure module, rather than beside the builder in
 * `lib/views/chief.ts`. That builder imports `lib/store.ts` and is therefore
 * Node-only, and `tests/client-bundle.test.ts` computes that set by walking the
 * import graph to a fixed point — so a `"use client"` module importing this type
 * from there would be a module the walk marks, which is the defect MAR-498
 * shipped once when `lib/deploy/bundle` put `node:crypto` in the browser bundle
 * and the packaged renderer stopped hydrating altogether.
 *
 * A type is erased at build time and would probably have been harmless. "Probably
 * harmless" is not the standard that failure earned.
 */
export interface ChiefFleet {
  agents: ChiefAgent[];
  counts: {
    agents: number;
    waiting: number;
    last_evidence_at: string | null;
  };
}

export type ChiefAnswer =
  /** Exactly one agent declares something the request asks about. */
  | { kind: "routed"; agent: ChiefAgent; matched: readonly string[] }
  /**
   * More than one does, equally well. The Chief asks rather than picking, which
   * is the difference between routing and guessing — and the tie is reported
   * with the words that caused it, so the person can disambiguate with one.
   */
  | { kind: "ambiguous"; agents: readonly ChiefAgent[]; matched: readonly string[] }
  /** Nobody does. The refusal names what the fleet can actually do. */
  | { kind: "nobody"; declared: readonly string[] }
  /** Nothing was asked. Not a refusal: there is no request to refuse. */
  | { kind: "empty" };

/**
 * Words that match everything and therefore mean nothing.
 *
 * Deliberately small and deliberately not a language model's stopword list.
 * Every word here is one that would otherwise let a request match an agent
 * through pure grammar — "can you read the file for me" should match on *read*
 * and *file*, and never on *can*, *you*, *the* or *for*.
 */
const IGNORED = new Set([
  "a", "an", "and", "any", "are", "as", "ask", "at", "be", "can", "could", "do",
  "does", "for", "from", "get", "give", "has", "have", "how", "i", "if", "in", "is",
  "it", "its", "just", "let", "make", "me", "my", "of", "on", "or", "our", "out",
  "please", "should", "so", "that", "the", "their", "them", "then", "there", "these",
  "they", "this", "to", "up", "us", "use", "want", "was", "we", "what", "when",
  "which", "who", "will", "with", "would", "you", "your",
]);

/**
 * Text to comparable words.
 *
 * `_` and `-` are separators rather than characters, which is what turns
 * `public_feed_fetch` into `public`, `feed`, `fetch` — the component id is a
 * declaration written in words, and splitting it is reading the declaration
 * rather than inventing a synonym table nobody maintains.
 */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !IGNORED.has(word));
}

/**
 * A crude singular, applied to both sides or to neither.
 *
 * "read my emails" must reach `gmail_search`'s `email`. This is not
 * morphology and does not pretend to be — it exists so that a plural in a
 * request is not silently a different word from the singular in a manifest, and
 * it is applied symmetrically so it can never make the two sides disagree.
 */
export function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) {
    return `${word.slice(0, -3)}y`;
  }
  /*
   * One trailing `s`, and deliberately not `es`.
   *
   * The first draft stripped `es` as well, which broke the property this
   * function exists for: `invoices` became `invoic` while the manifest's own
   * `invoice` stayed whole, so a plural in the request stopped matching the
   * singular in the declaration — the exact failure the stemmer was added to
   * prevent, introduced by the stemmer. Stripping one `s` maps both to
   * `invoice`. `boxes` becomes `boxe`, which is wrong and harmless: it is
   * wrong the same way on both sides, and symmetry is the only property here
   * that has to hold.
   */
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) {
    return word.slice(0, -1);
  }
  return word;
}

/**
 * Everything an agent's author declared it is for, as words.
 *
 * The name is absent by construction rather than by filtering, so there is no
 * line anybody could delete to let it back in.
 */
export function declaredVocabulary(agent: ChiefAgent): Set<string> {
  const vocabulary = new Set<string>();
  for (const word of words(agent.goal)) {
    vocabulary.add(stem(word));
  }
  for (const capability of agent.capabilities) {
    for (const word of words(capability)) {
      vocabulary.add(stem(word));
    }
  }
  return vocabulary;
}

/**
 * Route a request, or decline to.
 *
 * Scoring is a count of distinct request words the agent declared, and the
 * highest score wins only when it is the *unique* highest. A tie is
 * `ambiguous` rather than a coin toss: two agents that both credibly claim the
 * work is a question only the person can settle, and picking one would make the
 * Chief's confidence exceed its information — which is the whole failure mode a
 * routing surface has.
 */
export function routeRequest(
  request: string,
  fleet: readonly ChiefAgent[],
): ChiefAnswer {
  const asked = [...new Set(words(request).map(stem))];
  if (asked.length === 0) {
    return { kind: "empty" };
  }

  const scored = fleet
    .map((agent) => {
      const vocabulary = declaredVocabulary(agent);
      const matched = asked.filter((word) => vocabulary.has(word));
      return { agent, matched };
    })
    .filter((entry) => entry.matched.length > 0)
    .sort((a, b) => b.matched.length - a.matched.length);

  const best = scored[0];
  if (best === undefined) {
    /*
     * The refusal carries the fleet's whole declared vocabulary rather than an
     * apology. MAR-419: "when no connected agent can do the thing, the Chief
     * says so and names what is missing. It must not improvise a plan that no
     * agent declared it can execute." Naming what *is* declared is the only
     * form of "what is missing" that a person can act on — the complement of a
     * request against an unknown set is not a sentence anybody can use.
     */
    return { kind: "nobody", declared: declaredCapabilities(fleet) };
  }

  const tied = scored.filter((entry) => entry.matched.length === best.matched.length);
  if (tied.length > 1) {
    return {
      kind: "ambiguous",
      agents: tied.map((entry) => entry.agent),
      matched: best.matched,
    };
  }
  return { kind: "routed", agent: best.agent, matched: best.matched };
}

/**
 * Every capability the fleet declares, deduplicated and in a stable order.
 *
 * The component ids themselves, not a prose rendering of them: this list is
 * what DASH can be held to, and a friendlier paraphrase would be a second
 * vocabulary free to drift from the manifests it claims to summarise.
 * `lib/copy/chief.ts` is where it becomes a sentence.
 */
export function declaredCapabilities(fleet: readonly ChiefAgent[]): string[] {
  return [...new Set(fleet.flatMap((agent) => agent.capabilities))].sort();
}
