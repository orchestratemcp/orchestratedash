/**
 * The request or two DASH makes with a model key on its own behalf (MAR-582).
 *
 * Not on an agent's behalf — that path is the broker, and it is audited,
 * rate-limited and adjudicated per call. This is DASH asking a question a person
 * pressed a button to ask: *does this key still work?* It writes no audit row,
 * because there is no agent to attribute it to and a table of DASH's own health
 * checks would dilute the one table whose every row is a decision DASH made
 * about an agent's request.
 *
 * One request for two of the three providers (MAR-787): Anthropic and OpenAI
 * both refuse a bad key at the same path DASH reads for the models list, so
 * asking it once answers both "is this accepted" and "how many models".
 * OpenRouter's models list answers the same for any key, so its liveness
 * question goes to a key-scoped path first, and the models list is asked only
 * once that has said yes. See `AiProviderProfile.key_check_path`.
 *
 * ## Why it is here and not in `electron/`
 *
 * It needs `fetch` and nothing else. Keeping it in `lib/` means the URL it
 * builds, the headers it attaches and — most of all — the fact that it returns
 * **a status code and a count and nothing else** are all assertable against a
 * loopback server with no Electron, no vault and no window. `electron/main.ts`
 * supplies it as the `probe` seam and adds nothing.
 *
 * ## What it deliberately does not return
 *
 * The response body. Not the model names beyond a count, not an error message,
 * not a status line. A provider's error text reaching a surface is the same
 * channel `lib/broker/protocol.ts` closes for an agent, and the person reading
 * the card is better served by DASH's own five states than by a provider's
 * phrasing of one of them.
 */

import { isModelId } from "../broker/operations";
import { aiAuthHeaders, aiKeyCheckUrl, aiModelsUrl, type AiProviderProfile } from "./providers";
import type { AiProbeOutcome } from "./liveness";

/** How long DASH will wait for a provider to answer a health question. */
const PROBE_TIMEOUT_MS = 15_000;

/**
 * How much of the answer DASH will read.
 *
 * Generous, because a models list is genuinely large — one provider's runs to
 * hundreds of entries — and bounded, because an unbounded read of a third
 * party's response is an allocation this process does not control. Hitting the
 * ceiling is a `provider_error` rather than a truncated parse: half a JSON
 * document read leniently is a worse answer than an honest "DASH could not read
 * that", which is the trade `readBounded` already makes for the broker.
 */
const MAX_PROBE_BYTES = 2_097_152;

/**
 * Ask a provider whether it accepts this key.
 *
 * **Never throws**, which is a contract `lib/ai/actions.ts` relies on and states.
 * A rejection from `fetch` can carry the request object, and this request has a
 * live key in its headers — so the caught value is dropped rather than
 * inspected, exactly as `lib/oauth/flow.ts` drops its own, and the outcome is a
 * null status meaning "DASH could not ask".
 *
 * The distinction between "could not ask" and "was told no" is the whole point
 * of the return shape. `classifyProbe` turns it into a state; nothing here
 * decides what a status code means.
 *
 * **Asks `key_check_path` first, and its status is the outcome's status**
 * (MAR-787). A models list that answers the same for any key — OpenRouter's
 * does — is not evidence about the credential; `key_check_path` is the path
 * `lib/ai/providers.ts` names as the one that actually refuses a bad key. Only
 * once that has said the key is good does this go on to ask how many models it
 * reaches, which for Anthropic and OpenAI is the same request (their
 * `key_check_path` and `models_path` are equal) and for OpenRouter is a second
 * one, asked only because the first said yes.
 */
export async function probeModelProvider(
  profile: AiProviderProfile,
  key: string,
  fetchImpl: typeof fetch = fetch,
  wantIds = false,
): Promise<AiProbeOutcome> {
  const check = await getWithKey(aiKeyCheckUrl(profile), profile, key, fetchImpl);
  if (check === null) {
    return { status: null, model_count: null };
  }
  if (!check.ok) {
    // The status crosses and the body does not. 401 and 403 are the key's
    // verdict; everything else is the provider having a bad day, and
    // `classifyProbe` is what says so.
    return { status: check.status, model_count: null };
  }

  const modelsResponse =
    profile.key_check_path === profile.models_path
      ? check
      : await getWithKey(aiModelsUrl(profile), profile, key, fetchImpl);

  if (modelsResponse === null || !modelsResponse.ok) {
    // The key is accepted and DASH could not go on to count what it reaches.
    // Reported as accepted with no count, which `classifyProbe` resolves to
    // `provider_error` — honest for "the key is good and DASH cannot say how
    // many models it reaches", not a reason to call the key bad.
    return { status: check.status, model_count: null };
  }

  const text = await readBounded(modelsResponse);
  if (text === null) {
    // Answered, unreadably. Reported as a success status with no count, which
    // `classifyProbe` resolves to `provider_error` — the honest state for "it
    // said yes and DASH cannot tell what it said yes to".
    return { status: check.status, model_count: null };
  }

  const listed = readModels(text);
  return {
    status: check.status,
    model_count: listed === null ? null : listed.length,
    // Only when somebody asked (MAR-583). A probe run to answer "does this key
    // still work" hands back no catalogue at all, so the ids cannot reach a
    // caller that did not want them and would have nowhere to put them. The
    // durable record never carries them either way — see `AiProbeOutcome`.
    model_ids: wantIds ? listed : null,
  };
}

/** One GET, with this profile's auth headers, dropped to null on any failure to ask. */
async function getWithKey(
  url: string,
  profile: AiProviderProfile,
  key: string,
  fetchImpl: typeof fetch,
): Promise<Response | null> {
  try {
    return await fetchImpl(url, {
      method: "GET",
      headers: {
        // Spread first, so a provider's auth headers can never displace the
        // accept header DASH chose — the same merge order the broker uses.
        ...aiAuthHeaders(profile, key),
        accept: "application/json",
      },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
}

/**
 * The model ids the answer listed, or null.
 *
 * All three providers answer with an object carrying a `data` array of objects
 * with an `id`. Anything else is null rather than an empty array: an empty array
 * is a claim that the key reaches no models, and a shape DASH did not recognise
 * supports no claim at all.
 *
 * Ids only. Not descriptions, not context lengths, not prices — the same
 * projection rule `modelsListOperation` states for the agent-facing list, for
 * the same reason: a provider's marketing copy reaching a surface is the
 * injection channel ADR 0002 invariant 7 is about.
 *
 * **An id DASH would not be willing to write down is not counted.** `isModelId`
 * is the filter, and it is applied before the count rather than after, so the
 * number a card reports is the number of models a person could actually pick.
 * A count over entries nothing can be chosen from would be a figure with nothing
 * behind it, which is exactly what MAR-547 ruled out. Sorted and de-duplicated,
 * so the picker's order is DASH's and not the provider's.
 */
function readModels(text: string): string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const data = (parsed as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) {
    return null;
  }

  const ids = new Set<string>();
  for (const entry of data) {
    const id = (entry as { id?: unknown } | null)?.id;
    if (typeof id === "string" && isModelId(id)) {
      ids.add(id);
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b));
}

/** Read a response body, giving up past a ceiling. `readBounded`'s shape. */
async function readBounded(response: Response): Promise<string | null> {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    return null;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value !== undefined) {
      total += value.byteLength;
      if (total > MAX_PROBE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}
