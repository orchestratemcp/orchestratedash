/**
 * Fake model-provider probes for `performConnectionAction` (MAR-582).
 *
 * The same argument `tests/fakes/oauth-operations.ts` makes, one custody model
 * along: the real probe makes an HTTPS request to a third party, and the
 * behaviour worth testing is which of five states each answer produces and which
 * sentence goes with it.
 *
 * `refusingAi` is the more important of the two, for the reason `refusingOAuth`
 * is. Every test that drives a typed-secret or an OAuth field passes one, so
 * "no provider is contacted for a connection DASH is not a client for" is
 * something the suite fails on rather than something a reader checks by eye.
 */

import type { AiKeyOperations } from "../../lib/ai/actions";
import type { AiProbeOutcome } from "../../lib/ai/liveness";
import type { AiProviderProfile } from "../../lib/ai/providers";

/** A probe that fails the test if anything reaches it. */
export function refusingAi(): AiKeyOperations {
  return {
    probe: (): never => {
      throw new Error(
        "No model provider may be contacted for a connection whose key DASH does not hold.",
      );
    },
  };
}

export interface ScriptedAi extends AiKeyOperations {
  /** The provider ids probed, in order. */
  readonly probed: string[];
  /** Every key handed to the probe, so a test can assert the real one arrived. */
  readonly keys: string[];
  /**
   * Whether each probe asked for the model ids (MAR-583).
   *
   * Recorded so a test can assert the *narrow* direction as well as the wide
   * one: a liveness check must not come back carrying a provider's catalogue,
   * and the only way to see that from outside the module is to see what it asked
   * for.
   */
  readonly wantedIds: boolean[];
}

/**
 * A probe that answers with whatever a test scripted.
 *
 * Records the key it was given, which is deliberate and is the only place in the
 * suite that does: the point of several assertions is that this is the *only*
 * thing the key reaches, so the fake has to be able to show it arrived here in
 * order for the searches elsewhere to mean something.
 */
export function scriptedAi(
  answer:
    | AiProbeOutcome
    | ((profile: AiProviderProfile, key: string, wantIds: boolean) => AiProbeOutcome) = {
    status: 200,
    model_count: 3,
  },
): ScriptedAi {
  const probed: string[] = [];
  const keys: string[] = [];
  const wantedIds: boolean[] = [];
  return {
    probed,
    keys,
    wantedIds,
    probe: (profile, key, wantIds = false) => {
      probed.push(profile.id);
      keys.push(key);
      wantedIds.push(wantIds);
      return Promise.resolve(
        typeof answer === "function" ? answer(profile, key, wantIds) : answer,
      );
    },
  };
}
