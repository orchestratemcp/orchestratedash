/**
 * The name a fleet connection stands under where an agent id is required
 * (MAR-593, ADR 0013).
 *
 * Its own module, with **no imports at all**, for `lib/panel-spec.ts`' reason
 * applied to a different boundary: `lib/shell/ipc.ts` must stay importable from
 * a sandboxed preload, and `lib/fleet/actions.ts` touches the vault, the
 * database and three provider registries. Both need this string — the dispatcher
 * to put it on a target, the action layer to recognise one — and neither may
 * import the other.
 *
 * ## What the string is, and what it is not
 *
 * It is a **label**, not a lock. `CredentialTarget.agent_id` is not optional and
 * this fills it, so a fleet connection appears in `connection_secrets` and
 * `ai_key_checks` under this name — which is how `alreadyHeld` in
 * `electron/main.ts` knows to say "Replace" rather than "Connect" on a re-key.
 *
 * The lock is elsewhere and is structural. `fleetSecretName` writes into the
 * `dash.fleet.` vault namespace; `connectionSecretName` — the only name
 * `lib/broker/execute.ts` ever computes — always emits `dash.connection.`. So no
 * agent, named anything at all including this, resolves to the fleet
 * credential's vault key. An agent that contrived to be called `dash.fleet`
 * would get a prompt with the wrong word on it and reach nothing.
 *
 * A renderer never sends this. The fleet commands carry a `provider` and no
 * agent, and the dispatcher supplies this itself — a renderer able to name the
 * principal would be a renderer able to aim a fleet act at an agent, or an agent
 * act at the fleet.
 */
export const FLEET_PRINCIPAL = "dash.fleet";

/** Whether a command's target names the fleet rather than an agent. */
export function isFleetPrincipal(agentId: string): boolean {
  return agentId === FLEET_PRINCIPAL;
}
