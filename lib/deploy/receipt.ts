/**
 * What a person is told before an agent goes onto a server (MAR-487, MAR-498).
 *
 * Split out of `lib/deploy/bundle.ts`, and the split is not tidiness: that module
 * imports `node:crypto` at the top level to hash bundle files, so a `"use
 * client"` page importing a *value* from it drags a Node builtin into the
 * browser bundle. MAR-498's wizard did exactly that and the packaged renderer
 * stopped hydrating — every page drew its background colour and nothing else,
 * with no chrome, no agents and no error on screen.
 *
 * That is the failure `tests/client-bundle.test.ts` exists to prevent, and its
 * hand-maintained list of Node-only modules did not have `lib/deploy/bundle` in
 * it. The list is now computed from the source tree rather than remembered; this
 * module is the other half of the fix, and it deliberately imports nothing at
 * all.
 *
 * ## Why the receipt is here rather than in a component
 *
 * ADR 0006's option-1 receipt is required **before the user confirms**, and it
 * lives in a module so it is testable and so a renderer that found it
 * discouraging cannot drop it. An agent on a host holds its own credentials:
 * DASH cannot narrow what it does, cannot show what it did, and cannot take it
 * away. Every one of those three is a thing DASH says about *itself*, which is
 * what makes them checkable claims rather than reassurance.
 */

export interface DeployReceipt {
  /** The heading. What is about to happen, in one line. */
  what: string;
  /**
   * ADR 0006's option-1 sentences, each a statement about what **DASH** cannot
   * do rather than about what the agent will do. That is what keeps them
   * checkable: DASH knows its own reach, and it does not know the agent's.
   */
  limits: string[];
  /** The revocation that actually works, which is the only one worth offering. */
  revocation: string;
}

/**
 * The receipt shown **before** the user confirms a push.
 *
 * Before, for ADR 0002 amendment 2's reason: a disclosure that arrives after the
 * grant describes a window the person was already inside. And plain language
 * throughout — no field names, no environment variable names, no filenames —
 * which is `lib/copy/identifiers.ts`'s rule and the test ADR 0007 sets for this
 * whole plane: *a receipt that cannot describe the arrangement honestly rules
 * the option out.*
 */
export function describeDeployReceipt(agentName: string, hostLabel: string): DeployReceipt {
  return {
    ...describeDeployArrangement(hostLabel),
    what: `${agentName} will be copied to ${hostLabel} and run there.`,
  };
}

/**
 * The same receipt, before there is an agent to name (MAR-498).
 *
 * ADR 0007 requires the while-closed sentence to be said **before the first
 * deploy**, and the connect flow is the last moment that is still true. At that
 * point nobody has chosen an agent, so `describeDeployReceipt` above cannot be
 * called — and until this function existed the whole receipt rendered nowhere at
 * all, which is the gap MAR-498 was asked to close.
 *
 * The three limits are the same three strings, produced here and spread into the
 * named version rather than written twice. That is the entire reason this is the
 * base and the named one is the wrapper: two copies of a disclosure are two
 * copies that can be softened independently, and the one that would get softened
 * is the one somebody reads while deciding rather than the one they read while
 * confirming.
 *
 * The third limit is the unpleasant one and it is not softened. Turning a
 * connection off in DASH does not stop an agent that holds its own credentials
 * on a machine the user administers, and a sentence that implied otherwise would
 * be the exact dishonesty ADR 0006 spent its length refusing.
 */
export function describeDeployArrangement(hostLabel: string): DeployReceipt {
  return {
    what: `Any agent you put on ${hostLabel} runs there, not on this computer.`,
    limits: [
      "This agent signs in itself, on the server where it runs. DASH does not hold its sign-ins and cannot limit what it does with them.",
      "DASH can only show you what the server still has when it looks. Anything the server discarded before then, DASH will never see.",
      "Turning this off in DASH does not stop it. The agent keeps running on the server whether DASH is open, closed, or uninstalled.",
    ],
    revocation: `To stop it for certain, stop it on ${hostLabel} — DASH can ask, and the server is what decides.`,
  };
}
