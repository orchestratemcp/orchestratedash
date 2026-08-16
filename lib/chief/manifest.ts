/**
 * The chief's manifest, composed by DASH (MAR-659, ADR 0023 decision 2).
 *
 * Every other manifest in DASH is a document somebody else wrote and DASH
 * imported. This one is a **builder**: not a file on disk, not a fixture, and
 * not something a person or an agent can edit. It is assembled per call from
 * `lib/fleet/catalogue.ts` — the same catalogue entry the Connections page
 * already draws — so a provider DASH has not built the flow for cannot appear in
 * it, and it carries exactly one connection with exactly one capability.
 *
 * ## This is not a new authority
 *
 * ADR 0013 already granted it and named it as the one genuinely new thing in
 * that decision: *"for a fleet sign-in there is no manifest, so DASH decides what
 * to ask the provider for."* It made that safe by deriving the scope set from the
 * frozen operation table rather than writing one by hand, which turned *DASH
 * never asks for a scope no operation uses* from a check into a property. This is
 * that same derivation read back out for the one principal that **is** the fleet.
 *
 * ## What it costs, said rather than designed around
 *
 * `lib/broker/execute.ts`' step 4 stops being "the manifest DASH imported for the
 * process that wrote the line" for one principal. What it does not cost is
 * anything on the agent path, which is untouched and reads the store exactly as
 * it did.
 *
 * ## Pure, and it must stay that way
 *
 * No store, no vault, no clock. The provider is handed in — it is whichever one
 * DASH's fleet default names, and reading that row is `lib/ai/model-store.ts`'
 * job — so everything here can be driven by `tests/chief-manifest.test.ts` with
 * no database and no key.
 */

import { aiProviderById, aiProviders } from "../ai/providers";
import type { ConnectionSourceManifest, ManifestConnection } from "../connections";
import { fleetConnectorFor } from "../fleet/catalogue";

/**
 * The one connection id on the chief's manifest.
 *
 * Namespaced with a colon so it cannot collide with anything an author could
 * write: `agent.manifest.v2.schema.json` constrains a declared connection id to
 * the ordinary identifier character set, which has no colon in it. The same
 * trick `MODEL_PROVIDER_ROW_ID` uses, for the same reason.
 *
 * A constant rather than a value the caller passes, because it travels into a
 * `BrokerRequest` from `electron/chief-host.ts` and back out through
 * `brokeredField` — two places that must agree, with nothing between them to
 * reconcile a typo.
 */
export const CHIEF_CONNECTION_ID = "chief:model-provider";

/**
 * The one operation a chief principal may reach, for one provider.
 *
 * `{provider}.chat.completion` and nothing else. Exported because
 * `lib/broker/execute.ts` narrows the chief's grant against the manifest's
 * declared capability list and `electron/chief-host.ts` names the operation it
 * is asking for — and because a test asserting *the chief cannot curate, cannot
 * list models, cannot read a mailbox* needs the positive half written down
 * somewhere it can be compared against.
 */
export function chiefOperationId(providerId: string): string {
  return `${providerId}.chat.completion`;
}

/**
 * The chief's manifest for one model provider, or null.
 *
 * Null for a provider this build does not know, and null for one DASH has no
 * fleet connector for. Both mean the same thing at the broker: there is no
 * manifest, so `unknown_connection`, which is exactly where the chief stood
 * before this ADR. A null here is a chief that cannot spend rather than a chief
 * that spends unwatched.
 */
export function chiefManifest(providerId: string): ConnectionSourceManifest | null {
  const profile = aiProviderById(providerId);
  if (profile === null) {
    return null;
  }
  const connector = fleetConnectorFor(profile.connection_provider);
  if (connector === null || connector.ai_provider_id !== profile.id) {
    return null;
  }

  const operationId = chiefOperationId(profile.id);
  const capability = connector.capabilities.find((one) => one.id === operationId);
  if (capability === undefined || capability.access !== "spend") {
    // The catalogue derives its capabilities from `operationsForProvider`, so a
    // provider with no completion operation is one DASH cannot ask a question
    // of. Refused rather than composed with an empty list, because a manifest
    // declaring nothing would resolve to `no_operations_granted` — a refusal
    // that reads as the person's consent being narrow when the truth is that
    // DASH built nothing.
    return null;
  }

  const connection: ManifestConnection = {
    id: CHIEF_CONNECTION_ID,
    provider: connector.provider,
    label: connector.service,
    /*
     * DASH's own sentence about DASH's own connection, and it says the small
     * true thing. The chief asks one question and is charged for it; it reads
     * no mail, writes nowhere and reaches no host. A purpose line promising
     * more would be describing a manifest somebody could later write rather
     * than the one this function returns.
     */
    purpose:
      "Let DASH put your question about your fleet, and the facts from your own records that " +
      "go with it, to this provider — so the answer is written in plain sentences instead of " +
      "read off a table.",
    // Never anything else. `resolveGrant` refuses a connection that is not
    // DASH-managed, and this one genuinely is: the credential is DASH's fleet
    // key, held in DASH's vault, under DASH's own namespace.
    ownership: "dash_managed",
    // Exactly one. See `chiefOperationId`, and ADR 0023 decision 4 for the
    // invariant this list is the whole of.
    capabilities: [{ id: capability.id, label: capability.label, access: capability.access }],
    fields: [
      {
        id: connector.field_id,
        label: connector.field_label,
        purpose: connector.purpose,
        // `secret`, because `brokeredCredentialField` asks the *profile* which
        // kind it wants and a keyed provider wants this one. Declaring the
        // other would compose a manifest the broker then refuses with
        // `no_key_field`, which is a bug that only shows up on a machine with a
        // key in it.
        kind: "secret",
        required: true,
      },
    ],
  };

  return { agent_dom: { connections: [connection] } };
}

/**
 * Every sentence this module can produce, for the copy sweep.
 *
 * Derived from the builder rather than written out, the shape
 * `everyFleetCatalogueSentence` established: a purpose line changed here without
 * a matching entry would be copy no plain-language walk ever reads. Built for
 * every provider DASH knows, so adding a fourth cannot quietly skip the check.
 */
export function everyChiefManifestSentence(): string[] {
  const sentences: string[] = [];
  for (const profile of aiProviders()) {
    const manifest = chiefManifest(profile.id);
    for (const connection of manifest?.agent_dom?.connections ?? []) {
      sentences.push(connection.purpose);
    }
  }
  return sentences;
}
