/**
 * Connect, check and disconnect a connection that belongs to no agent
 * (MAR-593, ADR 0013).
 *
 * `lib/connection-actions.ts` is the same three verbs for a credential an agent
 * declared. This is them for one the person gave DASH before any agent existed,
 * and the split is by what resolves the target rather than by what happens
 * afterwards: there the target comes from a manifest, here from
 * `lib/fleet/catalogue.ts`. Everything downstream — the vault, the prompt, the
 * sign-in, the provider probe, the recovery copy — is the same machinery,
 * reached through the same injected seams.
 *
 * ## The key path is not reimplemented
 *
 * `performAiKeyAction` already owns connect/check/disconnect for a model
 * provider's key: the prompt, the vault write, the probe, the liveness
 * classification and the four sentences that go with it. A second copy for the
 * fleet would be a second place the "key refused" wording could drift, so the
 * key path here is a call to it with a target this module resolved.
 *
 * The sign-in path is not a call to `performOAuthAction`, and the reason is
 * concrete rather than stylistic: that function writes a **receipt** resolved
 * from the agent's manifest, and a fleet connection has no manifest and no
 * receipt of its own. Receipts stay per agent, written by materialization below,
 * because a receipt is the record of what one agent may do.
 *
 * ## Why a fleet target carries an agent id at all
 *
 * `CredentialTarget` is the shape the prompt, the sign-in window and the vault
 * seam all speak, and its `agent_id` is not optional. `FLEET_PRINCIPAL` fills it.
 *
 * **What that does and does not reach.** It reaches the bookkeeping row in
 * `connection_secrets`, which is how `alreadyHeld` in `electron/main.ts` knows to
 * say "Replace" rather than "Connect" on a re-key, and the liveness row in
 * `ai_key_checks`. It does **not** reach the credential: `fleetSecretName` writes
 * into the `dash.fleet.` namespace, and `connectionSecretName` — the only name
 * the broker ever computes — always emits `dash.connection.`. So no agent, named
 * anything at all, resolves to the fleet credential's vault key; the namespaces
 * cannot meet. The row is a label, and the name is the lock.
 */

import { performAiKeyAction, type AiKeyOperations } from "../ai/actions";
import { recordReceipt, forgetReceipt } from "../broker/store";
import { describeFleetGrant } from "../copy/decisions";
import { fileDecision } from "./decisions-store";
import { resolveGrant, resolveKeyGrantWithoutCredential } from "../broker/grant";
import type { CredentialTarget } from "../connection-credentials";
import type { ConnectionSourceManifest } from "../connections";
import {
  describeAuthorizationFailure,
  describeSecureStoreFailure,
  type Recovery,
} from "../copy/recovery";
import {
  missingScopes,
  parseOAuthCredential,
  serializeOAuthCredential,
  type OAuthCredential,
} from "../oauth/credential";
import { describePermissions, oauthProviderById } from "../oauth/providers";
import {
  forgetSecretReference,
  maskAccount,
  maskSecret,
  recordSecretReference,
} from "../secret-refs";
import {
  assertCanHoldSecret,
  isSecureStoreError,
  SecureStoreError,
  type SecureStore,
} from "../secure-store";
import { fleetConnectorFor, fleetSecretName, type FleetConnector } from "./catalogue";
import { fleetReach, type FleetCandidate, type FleetReach } from "./grants";
import { FLEET_PRINCIPAL } from "./principal";
import {
  forgetFleetConnection,
  forgetOneFleetGrant,
  readFleetConnection,
  readFleetGrants,
  recordFleetConnection,
  recordFleetGrant,
  withheldAgents,
} from "./store";

/* ---------------------------------------------------------------------- *
 * The target
 * ---------------------------------------------------------------------- */

/**
 * The catalogue entry, as the shape every seam downstream already speaks.
 *
 * `environment_name` is null and cannot be anything else. A fleet credential is
 * never handed to a child process: there is no manifest to declare a delivery
 * variable, and `deliverableSecretFields` iterates manifests rather than this.
 * Stating it here rather than leaving it undefined means the one field that
 * would turn a brokered credential back into a raw one is answered by
 * construction.
 */
export function fleetCredentialTarget(connector: FleetConnector): CredentialTarget {
  return {
    kind: connector.oauth !== null ? "oauth" : "provider_key",
    oauth: connector.oauth,
    ai_provider_id: connector.ai_provider_id,
    agent_id: FLEET_PRINCIPAL,
    connection_id: connector.provider,
    field_id: connector.field_id,
    service: connector.service,
    field_label: connector.field_label,
    purpose: connector.purpose,
    help: connector.help,
    secret_name: fleetSecretName(connector.provider, connector.field_id),
    environment_name: null,
  };
}

/* ---------------------------------------------------------------------- *
 * What this needs from the outside world
 * ---------------------------------------------------------------------- */

/**
 * The seams, and they are exactly `ConnectionActionDeps`' seams.
 *
 * Restated as its own interface rather than imported, so that
 * `lib/connection-actions.ts` can delegate to this module without this one
 * importing back into it — the cycle `AiKeyActionResult` is restated to avoid.
 * `tests/fleet-connection.test.ts` assigns a `ConnectionActionDeps` into this
 * type, which is the one-line compile-time check that fails the moment they
 * drift.
 */
export interface FleetActionDeps {
  store: SecureStore;
  promptForSecret(target: CredentialTarget, vaultLabel: string): Promise<string | null>;
  oauth: {
    authorize(
      target: CredentialTarget,
      options: { login_hint: string | null },
    ): Promise<{ ok: true; credential: OAuthCredential } | { ok: false; code: string }>;
    check(
      credential: OAuthCredential,
    ): Promise<{ ok: true } | { ok: false; code: string }>;
    revoke(credential: OAuthCredential): Promise<boolean>;
  };
  ai: AiKeyOperations;
  /** Every agent DASH has imported, for materialization. */
  listAgentIds?(): string[];
  /** One agent's validated manifest, or null. */
  readManifest(agentId: string): ConnectionSourceManifest | null;
  now?(): Date;
}

/**
 * The four verbs, and the fourth is the one worth explaining.
 *
 * `share` materializes an existing consent into agents that qualify for it and
 * do not have it — and it opens no window, asks for nothing and contacts no
 * provider. It exists because of what happens when a person configures DASH
 * *before* importing an agent, which is the order Henrik's test plan asks for:
 * the consent is already given when the agent arrives.
 *
 * DASH could extend it silently at that moment. It deliberately does not. A
 * grant given before a piece of software existed is not a grant to that software,
 * and quietly handing a newly imported agent access to somebody's mailbox is the
 * shape of consequence ADR 0002 amendment 2 exists to stop — the person would
 * learn about it from a receipt afterwards. So the card names the agents that are
 * waiting and this is the one button that includes them.
 *
 * It is not a second sign-in either, which is the other wrong answer: making
 * somebody re-consent to something they already consented to teaches them to
 * click through consent screens.
 */
export type FleetActionName = "connect" | "test" | "disconnect" | "share";

export interface FleetActionResult {
  ok: boolean;
  /** `CredentialState`, restated for the reason `FleetActionDeps` is. */
  state:
    | "not_connected"
    | "connected"
    | "locked"
    | "unavailable"
    | "revoked"
    | "not_held_by_dash";
  masked_hint: string | null;
  /** One sentence, safe to render. */
  detail: string;
  recovery?: Recovery;
}

/* ---------------------------------------------------------------------- *
 * The action
 * ---------------------------------------------------------------------- */

export async function performFleetAction(
  action: FleetActionName,
  provider: string,
  deps: FleetActionDeps,
): Promise<FleetActionResult> {
  const connector = fleetConnectorFor(provider);
  if (connector === null) {
    // A provider DASH does not offer. Reachable only from a renderer naming one
    // the catalogue never drew, or from a build that dropped a connector between
    // releases — which is DASH's problem and is said as such rather than being
    // reported as something the person can fix.
    return {
      ok: false,
      state: "not_held_by_dash",
      masked_hint: null,
      detail: "This version of DASH does not know how to connect that.",
    };
  }

  if (action === "share") {
    return shareFleetConnection(connector, deps);
  }

  return connector.connector_kind === "api_key"
    ? performFleetKeyAction(action, connector, deps)
    : performFleetSignIn(action, connector, deps);
}

/**
 * Give the agents that are waiting the consent already held.
 *
 * No prompt, no window, no provider. Every agent it reaches went through
 * `resolveCredentialTarget` and would have been allowed to run the original
 * connect itself; every agent somebody revoked is skipped, because a withheld
 * row outlives the connection it was made against.
 *
 * ## MAR-624. Zero materialized records is not always "already has it"
 *
 * Before this, a `materialize` call that produced no writes was read as one
 * sentence — "nothing changed, everyone already has it" — whichever of three
 * different facts caused it: nobody qualifies at all (the honest reading), a
 * vault write actually failed for an agent that was waiting, or DASH could not
 * even read the credential it was about to fan out. The first is unexciting and
 * true; the other two are a press that reported success while writing nothing,
 * which is the defect the store diagnosis on this issue found — `fleet_grants`
 * said `granted` while `connection_secrets` and `broker_grants` held nothing for
 * either scout. This tells the three apart and only ever claims the first.
 */
async function shareFleetConnection(
  connector: FleetConnector,
  deps: FleetActionDeps,
): Promise<FleetActionResult> {
  const stored = readFleetConnection(connector.provider);
  if (stored === null) {
    return {
      ok: false,
      state: "not_connected",
      masked_hint: null,
      detail: `${connector.service} is not connected, so there is nothing to give.`,
    };
  }

  const spread = await materialize(connector, deps);
  if (spread.unreadable) {
    // DASH holds the credential in name only, right now — the store could not
    // be read, so nothing was attempted and nothing else may be said about it.
    return {
      ok: false,
      state: "connected",
      masked_hint: stored.masked_hint,
      detail: `DASH holds ${connector.service} but could not read it from ${deps.store
        .describeBacking()
        .label.toLowerCase()} just now, so nothing was given out.`,
    };
  }

  const attempted = spread.connected.length + spread.write_failed.length;
  if (attempted === 0) {
    return {
      ok: true,
      state: "connected",
      masked_hint: stored.masked_hint,
      // True and unexciting. A person who pressed this because a card said an
      // agent was waiting deserves to be told when the answer turned out to be
      // that it was already covered, rather than seeing a success with no
      // change behind it.
      detail: `Nothing changed — every agent that can use ${connector.service} already has it.`,
    };
  }

  if (spread.connected.length === 0) {
    // Every agent that qualified was attempted and every attempt failed. The
    // opposite of "already has it": something was owed and DASH could not
    // deliver it, and the honest answer is a refusal naming who was affected —
    // not a success this press did not earn.
    return {
      ok: false,
      state: "connected",
      masked_hint: stored.masked_hint,
      detail: `${connector.service} could not be given to ${listAgentNames(spread.write_failed)}. DASH's own connection is unaffected.`,
    };
  }

  const detail = withReach(`${connector.service} was already connected.`, spread.connected);
  return {
    // A partial fan-out is still a real one for the agents it reached — the
    // person's consent did materialize for them — but it is not the whole of
    // what this press claimed, so it is not reported as an unqualified success.
    ok: spread.write_failed.length === 0,
    state: "connected",
    masked_hint: stored.masked_hint,
    detail:
      spread.write_failed.length === 0
        ? detail
        : `${detail} DASH could not give it to ${listAgentNames(spread.write_failed)}.`,
  };
}

/* ---------------------------------------------------------------------- *
 * A model provider's key
 * ---------------------------------------------------------------------- */

async function performFleetKeyAction(
  action: Exclude<FleetActionName, "share">,
  connector: FleetConnector,
  deps: FleetActionDeps,
): Promise<FleetActionResult> {
  const target = fleetCredentialTarget(connector);
  const backing = deps.store.describeBacking();
  const clock = deps.now ?? ((): Date => new Date());

  if (action === "connect") {
    try {
      // Before the prompt, for the reason the per-agent path checks before its
      // own: asking somebody to go and make an API key and then telling them
      // there was nowhere to put it wastes the part that took effort.
      assertCanHoldSecret(backing);
    } catch (error: unknown) {
      if (isSecureStoreError(error)) {
        return fromStoreError(error, connector.service, backing.label, null);
      }
      throw error;
    }
  }

  const result = await performAiKeyAction(action, target, backing.label, {
    store: deps.store,
    promptForSecret: deps.promptForSecret,
    ai: deps.ai,
    now: clock,
  });

  if (action === "disconnect") {
    await withdrawEverywhere(connector, deps);
    forgetFleetConnection(connector.provider);
    return result;
  }

  if (action === "connect" && result.masked_hint !== null) {
    // A hint means a key was stored — a cancel returns the previous hint and a
    // vault failure returned before this line.
    recordFleetConnection(
      {
        provider: connector.provider,
        connector_kind: connector.connector_kind,
        field_id: connector.field_id,
        secret_name: target.secret_name,
        masked_hint: result.masked_hint,
        // A key identifies nobody — ADR 0002 amendment 5, and the reason
        // `credentialAccount` returns null for one rather than deriving a name
        // from the key itself.
        account_hint: null,
        scopes: [],
        backend: backing.backend,
      },
      clock().toISOString(),
    );

    const spread = await materialize(connector, deps);
    return { ...result, detail: withReach(result.detail, spread.connected) };
  }

  return result;
}

/* ---------------------------------------------------------------------- *
 * A provider sign-in
 * ---------------------------------------------------------------------- */

async function performFleetSignIn(
  action: Exclude<FleetActionName, "share">,
  connector: FleetConnector,
  deps: FleetActionDeps,
): Promise<FleetActionResult> {
  const target = fleetCredentialTarget(connector);
  const backing = deps.store.describeBacking();
  const service = connector.service;
  const required = connector.oauth?.scopes ?? [];
  const provider = oauthProviderById(connector.oauth?.provider_id ?? "");
  const clock = deps.now ?? ((): Date => new Date());

  if (provider === null) {
    return {
      ok: false,
      state: "not_held_by_dash",
      masked_hint: null,
      detail: `This version of DASH no longer knows how to sign in to ${service}.`,
    };
  }

  const stored = readFleetConnection(connector.provider);
  const held = stored?.masked_hint ?? null;

  if (action === "disconnect") {
    const grant = await readStoredGrant(deps.store, target.secret_name);
    if (grant.kind === "error") {
      return fromStoreError(grant.error, service, backing.label, held);
    }

    // Revoked at the provider *before* the local delete, because after the
    // delete DASH no longer holds the token that would authorise the
    // revocation. Best effort: disconnect's promise is that DASH stops holding
    // the credential, and DASH can keep that promise with no network at all.
    const withdrawn = grant.kind === "found" ? await deps.oauth.revoke(grant.credential) : false;

    try {
      await deps.store.delete(target.secret_name);
    } catch (error: unknown) {
      if (isSecureStoreError(error) && error.code !== "not_found") {
        return fromStoreError(error, service, backing.label, held);
      }
    }
    forgetSecretReference(FLEET_PRINCIPAL, target.connection_id, target.field_id);
    await withdrawEverywhere(connector, deps);
    forgetFleetConnection(connector.provider);

    return {
      ok: true,
      state: "not_connected",
      masked_hint: null,
      detail: withdrawn
        ? `${service} is disconnected everywhere. DASH deleted its sign-in from ${backing.label} and told ${provider.label} to withdraw the access.`
        : // Says the smaller true thing rather than the larger convenient one.
          // Somebody who believes access was withdrawn and finds DASH still
          // listed in their account later has been misled by this sentence.
          `${service} is disconnected everywhere and DASH deleted its sign-in from ${backing.label}. DASH could not reach ${provider.label} to withdraw the access, so you may want to remove it in your ${provider.label} account settings.`,
    };
  }

  if (action === "test") {
    const grant = await readStoredGrant(deps.store, target.secret_name);
    if (grant.kind === "error") {
      return fromStoreError(grant.error, service, backing.label, held);
    }
    if (grant.kind !== "found") {
      return {
        ok: false,
        state: "not_connected",
        masked_hint: null,
        detail: `DASH holds no ${service} sign-in.`,
      };
    }
    const checked = await deps.oauth.check(grant.credential);
    if (!checked.ok) {
      const recovery = describeAuthorizationFailure(
        checked.code as Parameters<typeof describeAuthorizationFailure>[0],
        { service },
      );
      return {
        ok: false,
        state: checked.code === "revoked" ? "revoked" : "connected",
        masked_hint: held,
        detail: recovery.headline,
        recovery,
      };
    }
    return {
      ok: true,
      state: "connected",
      masked_hint: held,
      detail: `${provider.label} still accepts the sign-in DASH holds for ${service}.`,
    };
  }

  /* connect */

  try {
    assertCanHoldSecret(backing);
  } catch (error: unknown) {
    if (isSecureStoreError(error)) {
      return fromStoreError(error, service, backing.label, null);
    }
    throw error;
  }

  // The account already connected, offered back to the provider as a
  // suggestion. Read from the credential rather than from the row, because the
  // row holds a masked hint and a masked address is not one a provider accepts.
  const existing = await readStoredGrant(deps.store, target.secret_name);
  const loginHint = existing.kind === "found" ? existing.credential.account : null;

  const outcome = await deps.oauth.authorize(target, { login_hint: loginHint });
  if (!outcome.ok) {
    const recovery = describeAuthorizationFailure(
      outcome.code as Parameters<typeof describeAuthorizationFailure>[0],
      { service },
    );
    return {
      // A failed sign-in says nothing about what DASH already held. Reporting
      // `not_connected` after a cancelled reconnect would tell somebody their
      // working connection had gone.
      ok: false,
      state: held === null ? "not_connected" : "connected",
      masked_hint: held,
      detail: recovery.headline,
      recovery,
    };
  }

  const credential = outcome.credential;

  try {
    await deps.store.set(target.secret_name, serializeOAuthCredential(credential));
  } catch (error: unknown) {
    if (isSecureStoreError(error)) {
      return fromStoreError(error, service, backing.label, held);
    }
    throw error;
  }

  // The account, masked, rather than four characters of a refresh token — the
  // question this hint answers is "which of my accounts is this", and the
  // token's tail answers nothing.
  const hint =
    credential.account === null ? maskSecret(credential.refresh_token) : maskAccount(credential.account);

  recordSecretReference({
    agent: FLEET_PRINCIPAL,
    connection_id: target.connection_id,
    field_id: target.field_id,
    secret_name: target.secret_name,
    masked_hint: hint,
    backend: backing.backend,
  });

  recordFleetConnection(
    {
      provider: connector.provider,
      connector_kind: connector.connector_kind,
      field_id: connector.field_id,
      secret_name: target.secret_name,
      masked_hint: hint,
      account_hint: credential.account === null ? null : maskAccount(credential.account),
      // What the consent actually issued, intersected with what DASH asked for.
      // Not what DASH asked for: a person who unticked a box has a connection
      // that covers less, and a row recording the request rather than the answer
      // would show them access they did not give.
      scopes: required.filter((scope) => !missingScopes(credential, [scope]).includes(scope)),
      backend: backing.backend,
    },
    clock().toISOString(),
  );

  const spread = await materialize(connector, deps);

  const missing = describePermissions(provider, missingScopes(credential, required));
  if (missing.length > 0) {
    // Stored anyway. The person did grant something, it is real, and the agents
    // can do the part of their job it covers — throwing it away would waste a
    // consent they gave. `ok: false` because there is something left to do, and
    // the recovery says exactly what.
    return {
      ok: false,
      state: "connected",
      masked_hint: hint,
      detail: `${service} is connected, but not with everything DASH asked for.`,
      recovery: describeAuthorizationFailure("missing_permissions", { service, missing }),
    };
  }

  return {
    ok: true,
    state: "connected",
    masked_hint: hint,
    detail: withReach(
      `${service} is connected. DASH keeps the sign-in in ${backing.label} and never writes it to its own files.`,
      spread.connected,
    ),
  };
}

/* ---------------------------------------------------------------------- *
 * Materialization
 * ---------------------------------------------------------------------- */

/**
 * Which agents DASH currently holds a manifest for, in the order it lists them.
 *
 * An empty list when the host supplied no `listAgentIds`, which means **no
 * materialization** rather than an error — `ConnectionActionDeps.listAgentIds`'
 * rule, kept: a caller built before this feature connects the fleet connection
 * and nothing else, which is narrower and never wrong.
 */
function candidates(deps: FleetActionDeps): FleetCandidate[] {
  const listed = deps.listAgentIds?.() ?? [];
  const found: FleetCandidate[] = [];
  for (const agentId of listed) {
    const manifest = deps.readManifest(agentId);
    if (manifest !== null) {
      found.push({ agent_id: agentId, manifest });
    }
  }
  return found;
}

/**
 * Which agents this connector reaches right now.
 *
 * Exported because the view builder needs the same answer to draw the card, and
 * the sentence a person reads before pressing must be computed from the list the
 * press will actually walk.
 */
export function fleetReachNow(
  connector: FleetConnector,
  deps: Pick<FleetActionDeps, "listAgentIds" | "readManifest">,
): FleetReach {
  return fleetReach(
    connector,
    candidates(deps as FleetActionDeps),
    withheldAgents(connector.provider),
  );
}

/**
 * What actually happened when DASH tried to fan a fleet credential out.
 *
 * MAR-624. Three outcomes used to collapse into one empty `connected` array,
 * and a caller could not tell "nobody qualified" from "DASH tried and failed" —
 * which is exactly how a press came to report success while the two tables that
 * should have grown stayed empty. Every caller of `materialize` must read this
 * before deciding what to say, rather than asking only whether `connected` is
 * non-empty.
 */
interface MaterializeOutcome {
  /** Agents DASH actually wrote a vault entry, a reference and (if resolved) a receipt for. */
  connected: string[];
  /**
   * Agents `fleetReach` named as qualifying whose vault write itself failed.
   *
   * Distinct from a skip: `fleetReach.skipped` is an agent this connection does
   * not reach at all (withheld, disqualified, or holds its own). An agent here
   * *was* reached — resolved, in `reach.materializes` — and the write on this
   * specific attempt did not land.
   */
  write_failed: string[];
  /**
   * True when DASH could not even read the credential it was about to fan out.
   *
   * Distinct from an empty `connected` with no failures: that is "nobody
   * qualifies", a fact about the fleet's agents. This is a fact about the
   * vault, and nothing below it was attempted — so nothing below it may be
   * described as "already has it".
   */
  unreadable: boolean;
}

/**
 * Write the fleet credential to every agent that qualifies.
 *
 * Each write is the three steps the direct path takes — the vault entry, the
 * masked reference, and the receipt resolved from *that agent's* manifest — so
 * what the broker later resolves for a materialized agent is indistinguishable
 * from a grant it received directly. That is `shareGrant`'s property, and it is
 * the same property for the same reason: there is nothing downstream to tell,
 * because nothing downstream was changed.
 *
 * **A failure here does not fail the connect.** The person's consent is stored
 * and the fleet row is written; a vault that refused one write is a smaller
 * problem than a page reporting the whole thing failed, and the agent it failed
 * for reads as not connected — which is true. Every name — succeeded or
 * failed — comes back, so a caller can say exactly what happened rather than
 * inferring it from a single list.
 */
async function materialize(
  connector: FleetConnector,
  deps: FleetActionDeps,
): Promise<MaterializeOutcome> {
  let raw: string;
  try {
    raw = await deps.store.get(fleetSecretName(connector.provider, connector.field_id));
  } catch {
    return { connected: [], write_failed: [], unreadable: true };
  }

  const reach = fleetReachNow(connector, deps);
  const parsed = connector.oauth === null ? null : parseOAuthCredential(raw);
  const at = (deps.now ?? ((): Date => new Date()))().toISOString();
  const connected: string[] = [];
  const write_failed: string[] = [];

  for (const one of reach.materializes) {
    try {
      await deps.store.set(one.target.secret_name, raw);
    } catch {
      if (!write_failed.includes(one.agent_id)) {
        write_failed.push(one.agent_id);
      }
      continue;
    }
    recordSecretReference({
      agent: one.agent_id,
      connection_id: one.target.connection_id,
      field_id: one.target.field_id,
      secret_name: one.target.secret_name,
      masked_hint: hintFor(connector, parsed, raw),
      backend: deps.store.describeBacking().backend,
    });

    const manifest = deps.readManifest(one.agent_id);
    if (manifest !== null) {
      const grant =
        parsed === null
          ? resolveKeyGrantWithoutCredential(
              one.agent_id,
              manifest,
              one.target.connection_id,
              one.target.secret_name,
            )
          : resolveGrant(
              one.agent_id,
              manifest,
              one.target.connection_id,
              parsed,
              one.target.secret_name,
            );
      if (grant.ok) {
        recordReceipt(grant.grant, at);
      }
    }
    if (!connected.includes(one.agent_id)) {
      connected.push(one.agent_id);
    }
  }

  return { connected, write_failed, unreadable: false };
}

/** Names in a sentence, with the comma rules a list of two does not need. */
function listAgentNames(names: readonly string[]): string {
  const last = names[names.length - 1] as string;
  if (names.length === 1) {
    return last;
  }
  return names.length === 2
    ? `${names[0] as string} and ${last}`
    : `${names.slice(0, -1).join(", ")} and ${last}`;
}

/** The masked hint for a materialized row: the account for a sign-in, the value's tail for a key. */
function hintFor(
  connector: FleetConnector,
  parsed: OAuthCredential | null,
  raw: string,
): string {
  if (connector.oauth === null || parsed === null) {
    return maskSecret(raw);
  }
  return parsed.account === null ? maskSecret(parsed.refresh_token) : maskAccount(parsed.account);
}

/* ---------------------------------------------------------------------- *
 * What an ordinary per-agent connect or disconnect means up here
 * ---------------------------------------------------------------------- */

/**
 * Record what somebody just decided about one agent, when a fleet connection is
 * what they decided it about.
 *
 * ADR 0013 asks for per-agent revocation **and** a fleet-level
 * revoke-everywhere. Per-agent revocation already exists and always has:
 * `connection.disconnect` on that agent's own row deletes its credential, its
 * reference and its receipt. What was missing is the *memory* that the person
 * meant it — without which the next `share`, or the next re-key, would put the
 * access straight back.
 *
 * So no new command is invented for this. Disconnecting an agent from a
 * connection DASH holds at fleet level **is** withholding it, and connecting it
 * again is restoring it; this function is the one line that records which. It is
 * called from `performConnectionAction` after the action succeeded, never
 * before, so a refused disconnect does not leave a decision behind it.
 *
 * Silent when there is no fleet connection for the provider, which is the whole
 * of the pre-MAR-593 world: an agent-only connection has nothing to be withheld
 * from.
 */
export function noteAgentDecision(
  provider: string,
  agentId: string,
  standing: "granted" | "withheld",
  at: string,
): void {
  if (readFleetConnection(provider) === null) {
    return;
  }
  // This function's own docblock is why the decision is filed *here* and not
  // in `recordFleetGrant`: this is where "the person meant it" is known.
  // `adoptFleetCredential` writes the same row provisionally and repairs it
  // when materialization produces nothing — filing at the store level would
  // record that provisional write as a decision nobody made (ADR 0024
  // decision 1). Filed only on an actual transition, so re-pressing an
  // already-decided standing is one decision, not two.
  const previous = readFleetGrants(provider).find((row) => row.agent === agentId) ?? null;
  recordFleetGrant(provider, agentId, standing, at);
  if (previous === null || previous.standing !== standing) {
    fileDecision({
      decided_at: at,
      subject_kind: "agent",
      subject_id: agentId,
      kind: "fleet_grant",
      topic: provider,
      summary: describeFleetGrant(provider, standing),
      outcome: { state: standing, provider },
      decided_by: "person",
      rule: null,
      reason: null,
      receipts: [`fleet_grants ${provider} ${agentId}`],
    });
  }
}

/**
 * Connect one agent from the consent DASH already holds, with no sign-in.
 *
 * The other half of `share`, aimed at one agent instead of all of them, and the
 * reason a person who revoked an agent can put it back with the button that was
 * already on its row. It reuses the fleet credential rather than opening a
 * consent screen, because making somebody re-approve something they have already
 * approved teaches them to click through consent screens.
 *
 * Returns null when there is nothing to adopt — no fleet connection, or this
 * agent does not qualify for it — and the caller then does what it always did.
 * Null rather than a refusal: "there is no fleet connection here" is not an
 * outcome a person should ever be shown, it is simply the ordinary path.
 *
 * ## MAR-624. The grant recorded before the write must not outlive it
 *
 * `fleet_grants` is written first, deliberately — see the comment on that line
 * — so a revoked agent is no longer withheld by the time `materialize` reads the
 * set. But that leaves exactly one moment where `granted` is on record and
 * nothing else is true yet, and if `materialize` then does not produce a record
 * for *this* agent, staying in that moment is the wiring defect the store
 * diagnosis on this issue found: `fleet_grants` said `granted` for an agent that
 * `connection_secrets` and `broker_grants` had never heard of. So the write is
 * undone the instant it is known to be premature — restored to whatever it was
 * before, never left half-true — and only the caller's ordinary path runs from
 * there, exactly as it does when there was nothing to adopt to begin with.
 */
export async function adoptFleetCredential(
  provider: string,
  agentId: string,
  deps: FleetActionDeps,
): Promise<FleetActionResult | null> {
  const connector = fleetConnectorFor(provider);
  if (connector === null || readFleetConnection(provider) === null) {
    return null;
  }

  const at = (deps.now ?? ((): Date => new Date()))().toISOString();
  const previousGrant = readFleetGrants(provider).find((row) => row.agent === agentId) ?? null;
  // Recorded before the write, so that an agent somebody had revoked is no
  // longer withheld by the time `materialize` reads the set — the press is the
  // decision, and this is what makes it one.
  recordFleetGrant(provider, agentId, "granted", at);

  const spread = await materialize(connector, deps);
  if (!spread.connected.includes(agentId)) {
    // Nothing was actually written for this agent — restore exactly the row
    // that was there before this call, rather than leave the `granted` write
    // above on record for a decision that produced nothing.
    if (previousGrant === null) {
      forgetOneFleetGrant(provider, agentId);
    } else {
      recordFleetGrant(provider, agentId, previousGrant.standing, previousGrant.decided_at);
    }
    return null;
  }

  // Filed only past the repair above, so a press whose materialization
  // produced nothing leaves no decision row behind it — and only on a
  // transition, so re-adopting an already-granted agent files nothing
  // (ADR 0024 decision 1).
  if (previousGrant === null || previousGrant.standing !== "granted") {
    fileDecision({
      decided_at: at,
      subject_kind: "agent",
      subject_id: agentId,
      kind: "fleet_grant",
      topic: provider,
      summary: describeFleetGrant(provider, "granted"),
      outcome: { state: "granted", provider },
      decided_by: "person",
      rule: null,
      reason: null,
      receipts: [`fleet_grants ${provider} ${agentId}`],
    });
  }

  return {
    ok: true,
    state: "connected",
    masked_hint: readFleetConnection(provider)?.masked_hint ?? null,
    detail:
      `${connector.service} is connected for this agent, from the ${connector.field_label} you already gave DASH. ` +
      `You were not asked again because nothing new was needed.`,
  };
}

/**
 * Delete every materialization of this connector.
 *
 * Computed with an **empty** withheld set on purpose: this runs on a
 * disconnect-everywhere, and the question is not "who should have it" but "who
 * could DASH ever have written it to". An agent revoked earlier has nothing left
 * to delete and deleting nothing is free; missing one would leave a live
 * credential behind a card that says the connection is gone.
 *
 * The audit rows stay, for ADR 0002 amendment 1's reason: they are the record of
 * what was done while the access existed, and a disconnect that erased them
 * would delete exactly the history a suspicious person disconnected to check.
 */
async function withdrawEverywhere(
  connector: FleetConnector,
  deps: FleetActionDeps,
): Promise<void> {
  const reach = fleetReach(connector, candidates(deps), new Set());
  for (const one of reach.materializes) {
    try {
      await deps.store.delete(one.target.secret_name);
    } catch {
      // Best effort, and deliberately silent per agent: a vault that refused one
      // delete must not stop the other agents being cleared, and the person's
      // own credential is already gone from the fleet entry by the time this
      // runs on the sign-in path.
    }
    forgetSecretReference(one.agent_id, one.target.connection_id, one.target.field_id);
    forgetReceipt(one.agent_id, one.target.connection_id);
  }
}

/* ---------------------------------------------------------------------- *
 * Shared shapes
 * ---------------------------------------------------------------------- */

type StoredGrant =
  | { kind: "found"; credential: OAuthCredential }
  | { kind: "absent" }
  | { kind: "unusable" }
  | { kind: "error"; error: SecureStoreError };

async function readStoredGrant(store: SecureStore, secretName: string): Promise<StoredGrant> {
  let raw: string;
  try {
    raw = await store.get(secretName);
  } catch (error: unknown) {
    if (isSecureStoreError(error)) {
      return error.code === "not_found" ? { kind: "absent" } : { kind: "error", error };
    }
    throw error;
  }
  const credential = parseOAuthCredential(raw);
  return credential === null ? { kind: "unusable" } : { kind: "found", credential };
}

function fromStoreError(
  error: SecureStoreError,
  service: string,
  vault: string,
  hint: string | null,
): FleetActionResult {
  const recovery = describeSecureStoreFailure(error.code, { service, vault });
  return {
    ok: false,
    state:
      error.code === "not_found"
        ? "not_connected"
        : error.code === "vault_locked"
          ? "locked"
          : "unavailable",
    masked_hint: hint,
    detail: recovery.headline,
    recovery,
  };
}

/**
 * Add what else this connect reached, or leave the sentence alone.
 *
 * The fan-out is reported rather than left to be noticed. Somebody who pressed
 * one button and silently granted three agents access would have learned it from
 * a receipt later, which is the shape of consequence ADR 0002 amendment 2 exists
 * to stop.
 */
function withReach(detail: string, connected: readonly string[]): string {
  if (connected.length === 0) {
    return detail;
  }
  return `${detail} It is now connected for ${listAgentNames(connected)}.`;
}
