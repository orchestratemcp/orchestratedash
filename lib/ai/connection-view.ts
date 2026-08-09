/**
 * One model-provider key, as a card (MAR-582).
 *
 * **This is the seam the Connections page consumes.** Everything MAR-570's
 * surface needs to draw a provider card is on `AiKeyConnectionView`, already in
 * plain language, and nothing else about this layer has to be understood to
 * render one. If a field a card wants is missing, it belongs here rather than
 * being derived on the page — a sentence composed in a component is a sentence
 * the copy sweep does not see.
 *
 * ## What is deliberately not on the view
 *
 * The key, obviously. Also: no origin, no path, no header name, no status code
 * and no provider error text. A card says which of five states DASH observed and
 * when, in `lib/ai/liveness.ts`'s words. A renderer that could see a status code
 * would eventually show one to somebody.
 *
 * ## The import rule
 *
 * `aiKeyConnections` reads the store, so **it must never be imported by a
 * page** — the rule `lib/views/build.ts` states for itself and for the same
 * reason. A page imports the *type*, which is erased at compile time, and gets
 * its data across a boundary. `describeAiKeyConnection` is pure and safe
 * anywhere, and is what a test drives.
 */

import { describeCustody, describeKeyNarrowing, brokerProfileFor } from "../broker/providers";
import { resolveKeyGrantWithoutCredential, type GrantedOperation } from "../broker/grant";
import type { ConnectionSourceManifest } from "../connections";
import { connectableFields, type CredentialTarget } from "../connection-credentials";
import { listSecretReferences } from "../secret-refs";
import { describeLiveness, notChecked, type AiLivenessRecord } from "./liveness";
import { aiProviderById, type AiProviderProfile } from "./providers";
import { readLivenessCheck } from "./store";

/* ---------------------------------------------------------------------- *
 * The view
 * ---------------------------------------------------------------------- */

/** What the page fires, in the shape `lib/connection-requirements.ts` uses. */
export interface AiKeyFlow {
  /** `lib/shell/ipc.ts`'s channel family, by name. */
  channel: "connection.connect" | "connection.test" | "connection.disconnect";
  agent_id: string;
  connection_id: string;
  field_id: string;
}

export interface AiKeyLivenessView {
  state: AiLivenessRecord["state"];
  /** ISO-8601, or null when nothing has been observed. Never rendered raw. */
  checked_at: string | null;
  /** How many models the provider offered, when it last said. Null otherwise. */
  model_count: number | null;
  headline: string;
  detail: string;
  /** Null exactly when there is nothing for the person to do. */
  next_action: string | null;
}

export interface AiKeyConnectionView {
  connection_id: string;
  field_id: string;
  /** The author's friendly name for the connection. What the card is titled. */
  service: string;
  /** The registry id, e.g. `openrouter`. Travels; never rendered. */
  provider_id: string;
  /** DASH's friendly name for the provider, e.g. "OpenRouter". */
  provider_label: string;
  /** Why the agent says it needs this. The author's words. */
  purpose: string;
  /** Where to get a key, in words rather than a link. */
  key_source: string;
  /**
   * Whether DASH holds a key at all.
   *
   * Two values and not five: this answers "is there something in the vault",
   * which the row already knows without opening it. Whether the provider accepts
   * it is `liveness`, and the two are kept apart because they fail apart —
   * `lib/connection-actions.ts` makes the same split for its own two questions.
   */
  held: boolean;
  /** The masked tail of the key, as recorded when it was typed. Null if none. */
  masked_hint: string | null;
  liveness: AiKeyLivenessView;
  /** What the agent may do with it. Empty when DASH brokers nothing here. */
  capabilities: GrantedOperation[];
  /** Where the key lives and what deleting it does. Never an identifier. */
  custody_sentence: string;
  /** How much of ADR 0002's three-party check this connection got. */
  narrowing_sentence: string;
  connect: AiKeyFlow;
  check: AiKeyFlow;
  disconnect: AiKeyFlow;
}

/* ---------------------------------------------------------------------- *
 * Building one
 * ---------------------------------------------------------------------- */

/**
 * One card, from facts somebody else read.
 *
 * Pure, and it takes the liveness record rather than looking one up, so a test
 * can drive all five states without a database and a renderer test can be handed
 * a fixture. `capabilities` comes from the grant DASH would actually resolve,
 * not from a second list beside it — so a card cannot advertise something a
 * request would then be refused.
 */
export function describeAiKeyConnection(
  target: CredentialTarget,
  profile: AiProviderProfile,
  manifest: ConnectionSourceManifest,
  held: { masked_hint: string | null } | null,
  record: AiLivenessRecord,
): AiKeyConnectionView {
  const sentence = describeLiveness(record, profile.label);
  const grant = resolveKeyGrantWithoutCredential(
    target.agent_id,
    manifest,
    target.connection_id,
    target.secret_name,
  );
  const brokerProfile = brokerProfileFor(profile.connection_provider);
  const flow = (channel: AiKeyFlow["channel"]): AiKeyFlow => ({
    channel,
    agent_id: target.agent_id,
    connection_id: target.connection_id,
    field_id: target.field_id,
  });

  return {
    connection_id: target.connection_id,
    field_id: target.field_id,
    service: target.service,
    provider_id: profile.id,
    provider_label: profile.label,
    purpose: target.purpose,
    key_source: target.help ?? profile.key_source,
    held: held !== null,
    masked_hint: held?.masked_hint ?? null,
    liveness: {
      state: record.state,
      checked_at: record.checked_at,
      model_count: record.model_count,
      headline: sentence.headline,
      detail: sentence.detail,
      next_action: sentence.next_action,
    },
    capabilities: grant.ok ? grant.grant.operations : [],
    // Non-null by construction: a profile exists in the AI registry exactly when
    // `brokerProfileFor` has a keyed profile for the same provider string, and
    // `tests/ai-providers.test.ts` pins that correspondence. The fallbacks are
    // the honest degradation rather than a crash if that ever stops being true.
    custody_sentence:
      brokerProfile === null
        ? `DASH holds this ${profile.label} key in this computer's vault.`
        : describeCustody(brokerProfile),
    narrowing_sentence:
      brokerProfile === null ? "" : (describeKeyNarrowing(brokerProfile) ?? ""),
    connect: flow("connection.connect"),
    check: flow("connection.test"),
    disconnect: flow("connection.disconnect"),
  };
}

/**
 * Every model-provider key this agent declares, as cards.
 *
 * **Reads the store.** See the import rule at the top of this file.
 *
 * Driven by the *manifest* rather than by what is in the vault, exactly as
 * `connectableFields` is: a key left behind by a manifest that has since stopped
 * declaring the field is not drawn, because nothing would act on it. The vault
 * is not the list of what to show; the manifest is.
 */
export function aiKeyConnections(
  agentId: string,
  manifest: ConnectionSourceManifest,
): AiKeyConnectionView[] {
  const held = new Map<string, string | null>(
    listSecretReferences(agentId).map((row): [string, string | null] => [
      `${row.connection_id} ${row.field_id}`,
      row.masked_hint,
    ]),
  );

  const cards: AiKeyConnectionView[] = [];
  for (const target of connectableFields(agentId, manifest)) {
    if (target.kind !== "provider_key") {
      continue;
    }
    const profile = aiProviderById(target.ai_provider_id);
    if (profile === null) {
      // A target naming a provider this build has dropped. Skipped rather than
      // half-drawn: there is no origin to describe, no question to ask, and a
      // card with a Connect button that resolves to nothing is the dead button
      // `lib/connection-spec.ts` closes its vocabulary to prevent.
      continue;
    }
    const key = `${target.connection_id} ${target.field_id}`;
    cards.push(
      describeAiKeyConnection(
        target,
        profile,
        manifest,
        held.has(key) ? { masked_hint: held.get(key) ?? null } : null,
        // No row means never asked, which `readLivenessCheck` already answers
        // with the never-asked state rather than with an absence a caller has to
        // interpret.
        held.has(key) ? readLivenessCheck(agentId, target.connection_id) : notChecked(),
      ),
    );
  }
  return cards;
}
