/**
 * What the host broker admits, as its own closed set (MAR-629, ADR 0021).
 *
 * Pure: no filesystem, no network, no vault. `runner/host-broker.ts` enforces
 * this on the machine that holds the key; this file is the list, and it is
 * shared so that a surface in DASH describing what a deployed agent can do reads
 * the same array the host refuses from.
 *
 * ## Why this is a second list and not a filter written at the host
 *
 * ADR 0021 rule 2 is exact about the shape of the widening it refuses:
 *
 * > v1 is **narrower** than local DASH, not a copy of `lib/broker/operations.ts`
 * > by inertia: it admits the model-provider operations a pasted key already
 * > reaches, and it refuses Gmail and MCP.
 *
 * So the host's set is not `allOperations()`, and it is not `allOperations()`
 * minus a deny-list either. A deny-list is the shape that fails silently: the
 * day somebody adds `gmail.message.delete` or an `mcp.*` family to the
 * catalogue, a deny-list that named yesterday's Gmail operations would admit it
 * on every enrolled host without a diff anybody read. An allow-list of three
 * suffixes cannot do that.
 *
 * ## What is derived and what is written down
 *
 * The **suffixes** are written down here, by value, and are the review event.
 * The **providers** come from `AI_PROVIDER_IDS`, which is already the closed
 * by-value list of model providers DASH holds keys for, and re-typing them here
 * would make two lists that disagree the first time one changed.
 *
 * That leaves exactly one way for this set to grow without somebody editing this
 * file: adding a fourth model provider. That is a reviewed change to a closed
 * list either way, it widens the host and local DASH by the same operations at
 * the same moment, and `tests/host-broker.test.ts` pins the resulting set by
 * value so the widening is a diff somebody reads. ADR 0021's requirement is that
 * the set be countable and argued, not that it be spelled out nine times.
 *
 * ## The second gate, which is the one that matters
 *
 * `isHostBrokerOperation` answering true is necessary and not sufficient.
 * `runner/host-broker.ts` also resolves the id through `operationById` — the
 * same frozen catalogue local DASH uses — so the host can never execute an
 * operation DASH did not write, even if this list named one. Same frozen paths,
 * same origins, same `MAX_MATERIAL_CHARS`, same `MAX_OUTPUT_TOKENS`. ADR 0021:
 * *"Widening a path is a reviewed change to the same catalogue, not a host
 * exception."*
 */

import { AI_PROVIDER_IDS } from "../ai/providers";

/**
 * The three things a placed key is for, as operation-id suffixes.
 *
 * One read and two spends, and the split is the reason the list is three rather
 * than one:
 *
 * - `.models.list` reads the provider's catalogue. It consumes no spend
 *   allowance, because listing models costs nothing and an agent that had to ask
 *   a person before it could find out which models exist would be an agent that
 *   burns a press on a question.
 * - `.chat.completion` and `.digest.curate` both spend. They are two operations
 *   rather than one because `lib/broker/operations.ts` made them two — different
 *   card sentence, different request shape, different projection — and the host
 *   admitting one and not the other would be the host disagreeing with the
 *   catalogue about what an operation is.
 *
 * Nothing else. In particular no streaming dialect, no embedding, no image
 * generation: ADR 0021 refuses them by name, and they are refused here by
 * absence, which is stronger.
 */
export const HOST_BROKER_OPERATION_SUFFIXES = [
  ".models.list",
  ".chat.completion",
  ".digest.curate",
] as const;

/**
 * Every operation id the host broker will answer, for every model provider.
 *
 * Frozen, and built once. A caller that mutated the array would be widening a
 * security boundary by assignment, which is the sort of thing a `readonly` type
 * says and a frozen object enforces.
 */
export const HOST_BROKER_OPERATIONS: readonly string[] = Object.freeze(
  AI_PROVIDER_IDS.flatMap((provider) =>
    HOST_BROKER_OPERATION_SUFFIXES.map((suffix) => `${provider}${suffix}`),
  ),
);

/**
 * Whether the host broker admits this operation id.
 *
 * An exact membership test over the frozen array, deliberately not a prefix or
 * suffix match. `operation.endsWith(".chat.completion")` would admit
 * `gmail.chat.completion` and `anything.chat.completion`, and an operation id
 * arrives from a child process this repository did not write.
 *
 * Everything else is false: `gmail.search`, `gmail.message.read`,
 * `gmail.draft.create` and every Gmail name that was never built; every `mcp.*`
 * name, because ADR 0020's host-side work is later and this is the substrate it
 * will ask for its own admission on; and every operation a future slice adds to
 * the catalogue, which joins the host only by joining this list.
 */
export function isHostBrokerOperation(operation: unknown): operation is string {
  return typeof operation === "string" && HOST_BROKER_OPERATIONS.includes(operation);
}
