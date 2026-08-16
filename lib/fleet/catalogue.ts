/**
 * What DASH can connect, said by DASH (MAR-593, ADR 0013).
 *
 * Every other list of connectable things in this codebase is derived from an
 * agent's manifest — `deriveConnectionRequirements` reads `agent_dom.connections`,
 * `connectableFields` reads its fields, `buildConnectorTiles` groups the results.
 * All three answer the question "what does this agent still need?", and all three
 * return nothing on a DASH with no agents.
 *
 * Henrik's test plan asks the other question first: *configure DASH, then import
 * an agent.* So this module is the list that exists with nothing imported.
 *
 * ## The membership rule is `CONNECTOR_KINDS_V1`', verbatim
 *
 * **An entry is here because DASH has built the flow.** Not because a provider is
 * popular, not because the emitter can name it, not because it is planned. A
 * catalogue entry is drawn as a card with a Connect button, and a card DASH
 * cannot fulfil is a lie on a button — told to the novice this product is for,
 * who will read a dead button as their own mistake.
 *
 * ## Assembled, never restated
 *
 * The facts that decide a connection already live in four registries:
 * `brokerProfileFor` (custody, origin, credential kind), `oauthProviderFor` (the
 * flow and the scopes DASH is willing to request), `aiProviders` (the closed list
 * of providers DASH holds a key for), and `operationsForProvider` (what DASH can
 * actually do). This module joins them. A second table naming an origin or a
 * scope would be free to disagree with the one the broker uses, and the one the
 * broker uses is the one that decides what leaves the machine.
 *
 * ## The scopes are derived, and that is the load-bearing part
 *
 * A fleet sign-in has no manifest, so DASH decides what to ask the provider for.
 * The answer is not a hand-written list: it is the union of `required_scopes`
 * over the operations DASH has built for that provider. That makes a property
 * true by construction which was previously only checked —
 *
 * > **DASH never asks for a scope no operation uses.**
 *
 * — and it is strictly narrower than the manifest-declared case ADR 0002
 * amendment 1 names as the one that "lets an agent author widen its own access".
 *
 * Pure, and it renders nothing — the shape `lib/connection-card.ts` and
 * `lib/connectors.ts` established.
 */

import { aiProviders } from "../ai/providers";
import { operationsForProvider } from "../broker/operations";
import { brokerProfileFor, type BrokerProviderProfile } from "../broker/providers";
import type { ConnectorKindV1 } from "../connection-spec";
import { checkRequestedScopes, oauthProviderFor } from "../oauth/providers";

/* ---------------------------------------------------------------------- *
 * The connector
 * ---------------------------------------------------------------------- */

/**
 * One action DASH can perform once this connector is connected.
 *
 * `BrokerCapabilityView`'s four members, restated rather than imported for
 * `RequiredCapability`'s reason: that type lives under `lib/views/`, which is
 * above this module, and a type import for a value erased at compile time would
 * point a base module upward. `tests/fleet-connections.test.ts` pins the two
 * together the way `tests/broker-spend.test.ts` pins `BrokerAccess`.
 */
export interface FleetCapability {
  id: string;
  label: string;
  access: "read" | "write" | "spend";
  /** What a write leaves behind or a spend costs. Null for a read. */
  consequence: string | null;
}

/**
 * A service DASH can connect before any agent exists.
 *
 * `provider` is the key everywhere in this feature and it is the same key
 * `buildConnectorTiles` groups on and `findGrantSharers` fans out over — the
 * manifest's `provider` string. Keying on anything else would give DASH two
 * answers to "is this the same Gmail", which is the duplicate MAR-570 killed.
 */
export interface FleetConnector {
  /** The manifest's `provider` string, e.g. `google-gmail`. Machine vocabulary; never rendered. */
  provider: string;
  /** What a person reads: "Gmail". */
  service: string;
  connector_kind: ConnectorKindV1;
  /**
   * DASH's own field id for the one credential this connector holds.
   *
   * Chosen here rather than taken from a manifest, because there is no manifest.
   * It travels into the vault name and into the IPC target, so it is a constant
   * of this catalogue and not a string a caller may vary.
   */
  field_id: string;
  /** What the prompt calls the thing: "sign-in", "API key". */
  field_label: string;
  /** Why a person would connect this, in their words rather than DASH's. */
  purpose: string;
  /** Where to get the credential, when there is somewhere to get one. Null for a sign-in. */
  help: string | null;
  /**
   * The sign-in DASH would run, with the scopes derived from its operations.
   * Null exactly when `connector_kind` is `api_key`.
   */
  oauth: { provider_id: string; scopes: string[] } | null;
  /** The model provider whose key this is. Null exactly when this is a sign-in. */
  ai_provider_id: string | null;
  /** What DASH can do with it, from `lib/broker/operations.ts` and nowhere else. */
  capabilities: FleetCapability[];
  /**
   * The sentences ADR 0002 amendment 2 requires before a grant: a permission
   * DASH must ask for that is wider than what it will do with it.
   *
   * Carried on the connector rather than left to the card, because it has to
   * render **before** the sign-in as well as after — the person who has not yet
   * granted the permission is the one it is for — and before the sign-in there
   * is no receipt for a card to read it off.
   */
  wider_permissions: string[];
}

/* ---------------------------------------------------------------------- *
 * The list
 * ---------------------------------------------------------------------- */

/**
 * The provider sign-ins offered on the fleet page, by value.
 *
 * One entry, and the array exists rather than a call to
 * `oauthProviderFor` over some derived set for the reason `CONNECTOR_KINDS_V1`
 * is an array: widening it is widening what DASH will offer to hold on a page a
 * person reaches with no agent present, and that should be a reviewed diff.
 *
 * `dash-loopback-mail` is deliberately absent. It is the proof harness's
 * provider — `brokerProfileFor` resolves it only when a `DASH_`-namespaced
 * variable is set — and a catalogue that included it would put a test fixture on
 * a settings page.
 */
const FLEET_OAUTH_PROVIDERS: readonly string[] = Object.freeze(["google-gmail"]);

/**
 * Why a person connects each of these, in one sentence.
 *
 * Here rather than on the broker profile because a profile is about custody and
 * origins, and this is about somebody's reason for pressing a button. Keyed by
 * provider so a provider added to `FLEET_OAUTH_PROVIDERS` without a sentence is
 * caught by `tests/fleet-connections.test.ts` rather than shipping a blank card.
 */
const PURPOSE: Readonly<Record<string, string>> = Object.freeze({
  "google-gmail":
    "Let your agents work with your mail — reading what you point them at, and saving replies as drafts for you to send.",
});

/**
 * Every connector DASH can offer, in the order the page draws them.
 *
 * Sign-ins first, then keys. Found by asking what a person arriving at an empty
 * Settings actually came to do: connecting an account is the step with a browser
 * and a consent screen in it, and a key is a paste. Putting the paste first would
 * open the page on the smaller of the two jobs.
 *
 * Rebuilt per call rather than held in a module constant, for
 * `brokerProfileFor`'s reason: the profiles it resolves depend on values read
 * fresh, and a list computed at import time would freeze an answer taken before
 * anything had a chance to set them.
 */
export function fleetCatalogue(): FleetConnector[] {
  const connectors: FleetConnector[] = [];

  for (const provider of FLEET_OAUTH_PROVIDERS) {
    const connector = oauthConnector(provider);
    if (connector !== null) {
      connectors.push(connector);
    }
  }

  for (const profile of aiProviders()) {
    const connector = keyConnector(profile.connection_provider);
    if (connector !== null) {
      connectors.push(connector);
    }
  }

  return connectors;
}

/** One connector by its provider string, or null when DASH offers none. */
export function fleetConnectorFor(provider: unknown): FleetConnector | null {
  if (typeof provider !== "string" || provider.length === 0) {
    return null;
  }
  return fleetCatalogue().find((connector) => connector.provider === provider) ?? null;
}

/* ---------------------------------------------------------------------- *
 * Building one
 * ---------------------------------------------------------------------- */

/**
 * The scopes DASH asks a provider for on a fleet sign-in.
 *
 * The union of what its operations need, and then filtered through
 * `checkRequestedScopes` — the same gate a manifest goes through. The filter is
 * belt and braces: an operation requiring a scope the provider's allowlist does
 * not carry is a bug in DASH's own tables, and the honest response is to ask for
 * less rather than to ask for something `lib/oauth/flow.ts` would then send.
 * `tests/fleet-connections.test.ts` asserts the filter removes nothing, which is
 * the assertion that would fail if those two tables ever drifted.
 *
 * Sorted, so two builds of the same catalogue produce the same authorization
 * URL — `authorizationScopes`' reason, one layer up.
 */
function derivedScopes(profile: BrokerProviderProfile): string[] {
  const union = new Set<string>();
  for (const operation of operationsForProvider(profile.connection_provider)) {
    for (const scope of operation.required_scopes) {
      union.add(scope);
    }
  }
  const wanted = [...union].sort();

  const flow = oauthProviderFor(profile.connection_provider);
  if (flow === null) {
    return [];
  }
  const refused = new Set(checkRequestedScopes(flow, wanted));
  return wanted.filter((scope) => !refused.has(scope));
}

function capabilitiesFor(provider: string): FleetCapability[] {
  return operationsForProvider(provider).map((operation) => ({
    id: operation.id,
    label: operation.label,
    access: operation.access,
    consequence: "consequence" in operation ? operation.consequence : null,
  }));
}

/**
 * The wider-permission sentences for a provider's write operations.
 *
 * Deduplicated: two writes on one scope produce one sentence, and a card that
 * said the same uncomfortable thing twice would read as two separate problems.
 */
function widerPermissionsFor(provider: string): string[] {
  const said = new Set<string>();
  for (const operation of operationsForProvider(provider)) {
    const wider = "wider_permission" in operation ? operation.wider_permission : null;
    if (typeof wider === "string" && wider.length > 0) {
      said.add(wider);
    }
  }
  return [...said];
}

function oauthConnector(provider: string): FleetConnector | null {
  const profile = brokerProfileFor(provider);
  const flow = oauthProviderFor(provider);
  if (profile === null || flow === null || profile.credential_kind !== "oauth_grant") {
    return null;
  }

  const scopes = derivedScopes(profile);
  if (scopes.length === 0) {
    // A sign-in that would grant nothing. Refused rather than offered, because
    // `resolveCredentialTarget` refuses exactly this for a manifest —
    // `oauth_scopes_not_declared` — and a catalogue that offered a consent
    // screen for access no operation uses would be DASH asking for something it
    // then does nothing with.
    return null;
  }

  return {
    provider,
    service: profile.label,
    connector_kind: "google_oauth_broker",
    field_id: "sign_in",
    field_label: "sign-in",
    purpose: PURPOSE[provider] ?? "",
    help: null,
    oauth: { provider_id: flow.id, scopes },
    ai_provider_id: null,
    capabilities: capabilitiesFor(provider),
    wider_permissions: widerPermissionsFor(provider),
  };
}

function keyConnector(provider: string): FleetConnector | null {
  const profile = brokerProfileFor(provider);
  if (profile === null || profile.credential_kind !== "provider_key") {
    return null;
  }
  const ai = aiProviders().find((one) => one.connection_provider === provider);
  if (ai === undefined) {
    return null;
  }

  return {
    provider,
    service: profile.label,
    connector_kind: "api_key",
    field_id: "api_key",
    field_label: "API key",
    /*
     * What a model key buys, said honestly and therefore said small.
     *
     * ADR 0002 amendment 5: there is one read per provider and no completion, no
     * streaming, no embedding and no image call. A purpose line promising "run
     * your agents' thinking" would describe the next slice rather than this one,
     * and the person reading it would be the one who found out.
     */
    purpose:
      `Let DASH hold your ${profile.label} key and make ${profile.label} requests for your agents, ` +
      `so no agent ever holds the key itself.`,
    help: ai.key_source,
    oauth: null,
    ai_provider_id: ai.id,
    capabilities: capabilitiesFor(provider),
    wider_permissions: widerPermissionsFor(provider),
  };
}

/* ---------------------------------------------------------------------- *
 * The vault name
 * ---------------------------------------------------------------------- */

/**
 * The vault key a fleet connection's credential lives under.
 *
 * A namespace of its own, and that is structural rather than tidy.
 * `connectionSecretName` always emits `dash.connection.…`, so nothing it can
 * produce — for any agent name, including one crafted to collide — can land on a
 * `dash.fleet.…` key. The fleet credential therefore cannot be read or deleted
 * through an agent's own path, and an agent cannot be named in a way that
 * captures it.
 *
 * Every segment is narrowed to the character set `isValidSecretName` accepts, in
 * the same shape `connectionSecretName` uses, so a provider string with a dot in
 * it cannot merge two segments into one.
 */
export function fleetSecretName(provider: string, fieldId: string): string {
  const safe = (part: string): string => part.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  return `dash.fleet.${safe(provider)}.${safe(fieldId)}`;
}

/**
 * Every sentence this module can produce, for the copy sweep.
 *
 * Derived from the catalogue rather than written out, so a connector added
 * without a purpose is one the plain-language check never sees — the shape
 * `everyConnectorSentence` established.
 *
 * ## A null is dropped; a blank is reported
 *
 * `help` and a read's `consequence` are **skipped** when null rather than
 * flattened to `""`, and that asymmetry is the load-bearing part. Both are null
 * by design — a sign-in sends nobody anywhere to fetch a credential, and a read
 * leaves nothing behind to warn about — so a blank from either says nothing. Six
 * of these on the catalogue as it stands, which is enough to make "no entry is
 * empty" an assertion nobody could write.
 *
 * `purpose` is a plain `string` that `oauthConnector` fills from `PURPOSE` with
 * `?? ""` behind it, so the only blank this list can now carry is a connector
 * somebody added without a sentence. That is what lets
 * `tests/fleet-connections.test.ts` assert every entry is non-empty and have the
 * assertion catch the one thing it is for.
 */
export function everyFleetCatalogueSentence(): string[] {
  return fleetCatalogue().flatMap((connector) => [
    connector.service,
    connector.purpose,
    ...(connector.help === null ? [] : [connector.help]),
    ...connector.capabilities.flatMap((capability) => [
      capability.label,
      ...(capability.consequence === null ? [] : [capability.consequence]),
    ]),
    ...connector.wider_permissions,
  ]);
}
