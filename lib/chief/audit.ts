/**
 * One decision taken on the chief's behalf, in whichever room it was taken
 * (MAR-743 for the shape, MAR-744 for the second thing that writes one).
 *
 * The type lived in `runner/chief-broker.ts` while the runner's model call was
 * the only thing that produced one. MAR-744 adds a second producer — a public
 * source fetch, in `lib/chief/fetch-sources.ts` — and that one runs in **both**
 * hosts, so the shape had to move somewhere both can import without either
 * importing the other. `lib/broker/principal.ts`' reasoning exactly: a type
 * several layers must name should not oblige any of them to import a layer's
 * implementation to name it.
 *
 * ## What a row can and cannot say
 *
 * There is no `agent` field. The chief has no id — ADR 0023 decision 1 — and a
 * name here would be inventing the very string the principal union exists to
 * make impossible. Main fills `broker_audit.agent` with `FLEET_PRINCIPAL`, which
 * `lib/broker/principal.ts` is careful to call *a label, not a lock*.
 *
 * There is no `account_hint`, because neither a fleet key nor a public feed
 * identifies anybody.
 *
 * There is no `decided_on`. That column is a constant of the **function that
 * writes it** — `recordBrokerCall` writes `'dash'` by the schema's default and
 * `recordRunnerChiefCall` writes `'runner'` because it is the one function DASH
 * calls with what it pulled off the spool. Provenance a caller can supply is
 * provenance that proves nothing, so it is deliberately absent from the value.
 *
 * What it never records: a key, a digest of one, an authorization header, a
 * request body, a provider payload, model prose, the person's question, or the
 * subject they asked about. Only the **names** of the input fields.
 */

import type { BrokerRefusal } from "../broker/protocol";

export interface ChiefDecisionRow {
  connection_id: string;
  operation: string;
  request_id: string;
  decision: "allowed" | "refused";
  refusal: BrokerRefusal | null;
  input_keys: string[];
  result_count: number | null;
  duration_ms: number;
  decided_at: string;
}

/**
 * The connection id a source fetch is audited under.
 *
 * Namespaced with a colon, `CHIEF_CONNECTION_ID`'s trick and its reason: the
 * manifest schema constrains a declared connection id to an identifier character
 * set with no colon in it, so no agent author can write a manifest that collides
 * with this.
 *
 * **It is not a connection anybody made.** Nothing resolves a grant for it,
 * nothing holds a credential under it, and `runner/chief-broker.ts` refuses any
 * request naming it — see that file's step 3, which admits one id and this is
 * not it. What it is, is the string a person reads in the audit when they want
 * to know what the chief fetched, and it is shaped like a connection id because
 * it sits in a column of them.
 */
export const CHIEF_SOURCES_CONNECTION_ID = "chief:public-sources";

/**
 * The operation id a source fetch is audited under.
 *
 * Outside `lib/broker/operations.ts`' catalogue on purpose, and the docblock in
 * `lib/chief/fetch-sources.ts` argues why at length. The short version: an entry
 * in that catalogue is a request built for a credential somebody granted, and
 * there is no credential here. Naming it in the catalogue's own grammar keeps
 * the audit table readable without pretending it is one.
 */
export const CHIEF_SOURCES_OPERATION = "chief.sources.fetch";
