/**
 * Who is asking the broker for something (MAR-659, ADR 0023 decision 1).
 *
 * Its own module with **no imports at all**, for `lib/fleet/principal.ts`'
 * reason applied one layer along: `electron/`, `lib/broker/` and the chief's own
 * modules all have to name this type, and none of them should have to import the
 * broker's executor to do it.
 *
 * ## Why this is a type and not a reserved string
 *
 * `broker.handle` used to take an agent id, and the obvious way to let the chief
 * through was to reserve a name for it. That is a hole, and it is a hole
 * somebody could aim at: `lib/handoff.ts` and `lib/open-link.ts` both accept an
 * agent id matching `/^[a-z0-9][a-z0-9._-]{0,63}$/`, and `dash.fleet` satisfies
 * it. A string comparison inside the broker would therefore be an authority an
 * agent author could claim by choosing a name.
 *
 * A variant with **no id field** cannot be inhabited by any string at all. "An
 * agent contrives to be called `dash.fleet`" stops being an argument about
 * validation and becomes a compile error: there is no value of type `string` a
 * caller could pass where `{ kind: "chief" }` is wanted.
 *
 * This makes `FLEET_PRINCIPAL` *more* exactly what its own docblock says it is —
 * **a label, not a lock**. It goes on filling `CredentialTarget.agent_id` so a
 * fleet connection appears in `connection_secrets` and `ai_key_checks` under a
 * recognisable name, and it never becomes a principal anywhere.
 */

export type BrokerPrincipal =
  /** A child process DASH launched, identified by the supervisor that read its line. */
  | { kind: "agent"; agent_id: string }
  /**
   * DASH itself, answering a question a person typed into the fleet's chat.
   *
   * Carries no id, and the absence is the whole design. See this module's
   * header, and ADR 0023 decision 4 for what a chief principal can reach: one
   * connection, one capability, and nothing else in DASH.
   */
  | { kind: "chief" };

/** The chief, as a value. One object, so no call site has to spell the variant. */
export const CHIEF: BrokerPrincipal = Object.freeze({ kind: "chief" });

/** One agent, as a principal. */
export function agentPrincipal(agentId: string): BrokerPrincipal {
  return { kind: "agent", agent_id: agentId };
}

/**
 * The key one principal's budgets stand under.
 *
 * **Both arms are prefixed**, which is the only reason this is a function rather
 * than a field read. An unprefixed agent id and a bare `"chief"` would share a
 * namespace, so an agent called `chief` would count against the chief's spend
 * window — a rate limit two unrelated things share is a rate limit a person's
 * own question can fail on because a scout was busy, which is the failure ADR
 * 0023 gives the chief its own window to prevent.
 *
 * `agent:` cannot be produced by the chief arm and `chief` cannot be produced by
 * the agent arm, because the colon is outside the agent-id character set only in
 * the sense that it is *prepended by DASH* rather than supplied — an agent named
 * `chief` keys to `agent:chief`, which is a different string.
 */
export function principalKey(principal: BrokerPrincipal): string {
  return principal.kind === "chief" ? "chief" : `agent:${principal.agent_id}`;
}
