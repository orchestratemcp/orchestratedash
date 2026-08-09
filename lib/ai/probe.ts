/**
 * The one request DASH makes with a model key on its own behalf (MAR-582).
 *
 * Not on an agent's behalf — that path is the broker, and it is audited,
 * rate-limited and adjudicated per call. This is DASH asking a question a person
 * pressed a button to ask: *does this key still work?* It writes no audit row,
 * because there is no agent to attribute it to and a table of DASH's own health
 * checks would dilute the one table whose every row is a decision DASH made
 * about an agent's request.
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

import { aiAuthHeaders, aiModelsUrl, type AiProviderProfile } from "./providers";
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
 */
export async function probeModelProvider(
  profile: AiProviderProfile,
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AiProbeOutcome> {
  let response: Response;
  try {
    response = await fetchImpl(aiModelsUrl(profile), {
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
    return { status: null, model_count: null };
  }

  if (!response.ok) {
    // The status crosses and the body does not. 401 and 403 are the key's
    // verdict; everything else is the provider having a bad day, and
    // `classifyProbe` is what says so.
    return { status: response.status, model_count: null };
  }

  const text = await readBounded(response);
  if (text === null) {
    // Answered, unreadably. Reported as a success status with no count, which
    // `classifyProbe` resolves to `provider_error` — the honest state for "it
    // said yes and DASH cannot tell what it said yes to".
    return { status: response.status, model_count: null };
  }

  return { status: response.status, model_count: countModels(text) };
}

/**
 * How many models the answer listed, or null.
 *
 * All three providers answer with an object carrying a `data` array. Anything
 * else is null rather than zero: zero is a claim that the key reaches no models,
 * and a shape DASH did not recognise supports no claim at all.
 */
function countModels(text: string): number | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const data = (parsed as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? data.length : null;
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
