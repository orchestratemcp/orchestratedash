/**
 * The model providers DASH will hold a key for, by value (MAR-582).
 *
 * MAR-569 named `api_key` as one of the two flows DASH has built, and
 * `lib/connection-spec.ts` states the membership rule that governs that list:
 * **a kind is in it because DASH has built the flow.** This file is the same
 * rule one level down. A provider is here because DASH knows three things about
 * it that it cannot know about an arbitrary service:
 *
 * 1. **Where its API lives**, so a request can be checked against an origin
 *    rather than sent wherever a bug pointed it.
 * 2. **How the key is presented**, so the header is DASH's decision and not a
 *    value anything else supplies.
 * 3. **One cheap, side-effect-free question with an unambiguous answer** — the
 *    list of models the key can reach — so `test` can stop being a vault read
 *    and become a real check.
 *
 * A service DASH knows none of those about is not in this list, and a key for it
 * stays exactly what it was before this file existed: an opaque string DASH
 * holds, hands to the agent that declared it, and cannot check. That path is
 * untouched. See `lib/connection-actions.ts`'s header, which argues it, and note
 * that its argument is now scoped rather than universal — the same narrowing ADR
 * 0002 amendment 4 applied to four of its own sentences.
 *
 * ## Why the registry is here and not in the manifest schema
 *
 * `contracts/agent.manifest.v2.schema.json` types `connections[].provider` as an
 * open string, and it should stay open: it is the *author's* word for what their
 * agent talks to, and DASH refusing to import an agent because it named a
 * service DASH has never heard of would be DASH deciding what agents may exist.
 *
 * What DASH decides is narrower and belongs here: which of those strings DASH
 * will **act on** — take custody of a key for, attach to a request, and check
 * against a provider. Closed by value in a reviewed commit, pinned by
 * `tests/ai-providers.test.ts`, for the reason `CONNECTOR_KINDS_V1` and
 * `WRITE_PATHS` are: widening it is widening what agent-authored data can make
 * DASH do, and that should be a diff somebody reads rather than a predicate that
 * quietly matches more next month.
 *
 * ## No imports, and no I/O
 *
 * Pure data and pure functions, in the shape `lib/connection-spec.ts` keeps for
 * itself: this has to be readable from a renderer chunk as well as from Electron
 * main, and a module that reached a vault could be neither.
 */

/* ---------------------------------------------------------------------- *
 * The vocabulary
 * ---------------------------------------------------------------------- */

/**
 * Every provider DASH will hold a model key for. The complete answer.
 *
 * Three, and the omissions are as deliberate as the members. There is no
 * "custom" entry and no base-URL field an author could point somewhere else: a
 * provider whose origin came out of a manifest would be a manifest choosing
 * where DASH sends a key, which is the raw-token model ADR 0002 exists to end,
 * wearing a different hat.
 */
export const AI_PROVIDER_IDS = ["openrouter", "anthropic", "openai"] as const;

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

/**
 * How a key is presented to a provider.
 *
 * A closed union rather than a header map on the profile, so that no future
 * profile can name `host`, `content-type`, or anything else structural. The two
 * members are the two schemes the three providers below actually use, and a
 * third arrives as a third variant with a `switch` that stops compiling.
 */
export type AiAuthScheme =
  /** `Authorization: Bearer <key>`, which OpenRouter and OpenAI both take. */
  | { kind: "bearer" }
  /**
   * A named header carrying the key on its own, plus one fixed companion.
   *
   * Anthropic's API takes the key in `x-api-key` and requires a version header
   * beside it. The companion's value is a constant here rather than a parameter,
   * because a version an agent or a manifest could choose is a way to ask an
   * older API for behaviour this file's projection was not written against.
   */
  | { kind: "header"; header: string; companion: { header: string; value: string } };

export interface AiProviderProfile {
  id: AiProviderId;
  /**
   * The manifest's `provider` string for this service.
   *
   * Equal to `id` for all three today and kept as its own field anyway: `id` is
   * DASH's name for the profile and this is the author's word that selects it,
   * and collapsing them would make a future rename of one a silent break of the
   * other. `lib/broker/providers.ts` keeps the same two fields apart for Gmail.
   */
  connection_provider: string;
  /** Friendly service name for a card. Never an identifier. */
  label: string;
  /** The API origin every request for this profile is built against. */
  api_origin: string;
  /**
   * The path of the one question DASH asks to find out whether a key works.
   *
   * A literal on the profile, in `WriteOperation.path`'s shape and for the same
   * reason: the set of paths DASH will ever reach with a model key is the set
   * written down here, readable in ten seconds, and pinned by value in a test.
   * Nothing computes it and nothing an agent supplies reaches it.
   */
  models_path: string;
  auth: AiAuthScheme;
  /**
   * Where a person gets a key, in words rather than a link.
   *
   * A sentence and not a URL: `lib/copy/identifiers.ts` refuses a raw link in
   * guided copy, and a person reading a prompt needs to know *which* page of
   * their account to look on more than they need something to click.
   */
  key_source: string;
}

/**
 * Anthropic's API version header value.
 *
 * Pinned as a constant beside the profile so that changing which version of a
 * provider's API DASH speaks is one reviewed line, rather than something that
 * drifts with whatever a caller happened to pass.
 */
const ANTHROPIC_API_VERSION = "2023-06-01";

const OPENROUTER: AiProviderProfile = {
  id: "openrouter",
  connection_provider: "openrouter",
  label: "OpenRouter",
  api_origin: "https://openrouter.ai",
  models_path: "/api/v1/models",
  auth: { kind: "bearer" },
  key_source: "Your OpenRouter account has a keys page; a key made there is what DASH needs.",
};

const ANTHROPIC: AiProviderProfile = {
  id: "anthropic",
  connection_provider: "anthropic",
  label: "Anthropic",
  api_origin: "https://api.anthropic.com",
  models_path: "/v1/models",
  auth: {
    kind: "header",
    header: "x-api-key",
    companion: { header: "anthropic-version", value: ANTHROPIC_API_VERSION },
  },
  key_source: "Your Anthropic console has an API keys page; a key made there is what DASH needs.",
};

const OPENAI: AiProviderProfile = {
  id: "openai",
  connection_provider: "openai",
  label: "OpenAI",
  api_origin: "https://api.openai.com",
  models_path: "/v1/models",
  auth: { kind: "bearer" },
  key_source: "Your OpenAI account has an API keys page; a key made there is what DASH needs.",
};

const PROFILES: readonly AiProviderProfile[] = Object.freeze([OPENROUTER, ANTHROPIC, OPENAI]);

/**
 * Every header name DASH will ever attach a model key under.
 *
 * The complete answer to "where could this key end up in a request?", frozen and
 * pinned by value. `lib/broker/execute.ts` checks the map it is handed against
 * this list before merging it into a request's headers, so a bug in
 * `aiAuthHeaders` — or in anything that later grows a second implementation of
 * it — cannot put a key in `cookie`, in `host`, or in a header a proxy would
 * forward somewhere DASH did not intend.
 */
export const AI_AUTH_HEADERS: readonly string[] = Object.freeze([
  "authorization",
  "x-api-key",
  "anthropic-version",
]);

/* ---------------------------------------------------------------------- *
 * Lookups
 * ---------------------------------------------------------------------- */

/**
 * The profile for a manifest's provider string, or null.
 *
 * Null is the ordinary answer for every service in the world that is not one of
 * three, and callers must treat it as "DASH does not broker this" rather than as
 * an error. A `find` over a frozen array rather than an object lookup, for
 * `operationById`'s reason: a plain object is reachable at `__proto__` and
 * `constructor` by anything that names them.
 */
export function aiProviderFor(connectionProvider: unknown): AiProviderProfile | null {
  if (typeof connectionProvider !== "string" || connectionProvider.length === 0) {
    return null;
  }
  return PROFILES.find((profile) => profile.connection_provider === connectionProvider) ?? null;
}

/** The profile with this id, or null. For a stored record naming one. */
export function aiProviderById(id: unknown): AiProviderProfile | null {
  if (typeof id !== "string") {
    return null;
  }
  return PROFILES.find((profile) => profile.id === id) ?? null;
}

/** Every profile, for the tests and for a surface listing what DASH supports. */
export function aiProviders(): readonly AiProviderProfile[] {
  return PROFILES;
}

/* ---------------------------------------------------------------------- *
 * The request
 * ---------------------------------------------------------------------- */

/**
 * The headers that carry a key to this provider, and nothing else.
 *
 * The one function in DASH that puts a model key into anything. It returns only
 * authorization headers — no accept, no content type, no user agent — because
 * the caller merges these into a request it built itself, and a function that
 * could also set `content-type` would be a function that could set `host`.
 *
 * Returns a plain object rather than `Headers` so `lib/broker/execute.ts` can
 * check the key names against `AI_AUTH_HEADERS` before using them. A `Headers`
 * instance would have had to be enumerated to be checked, which is the same
 * check with one more step in which to be wrong.
 */
export function aiAuthHeaders(profile: AiProviderProfile, key: string): Record<string, string> {
  switch (profile.auth.kind) {
    case "bearer":
      return { authorization: `Bearer ${key}` };
    case "header":
      return {
        [profile.auth.header]: key,
        [profile.auth.companion.header]: profile.auth.companion.value,
      };
  }
}

/**
 * The one URL DASH will build for this profile's liveness question.
 *
 * Built with `URL` from the profile's own origin and its own frozen path, so
 * there is no interpolation and nothing an agent, a manifest or a stored record
 * contributes. Exported because both the brokered operation and DASH's own probe
 * ask the same question, and two constructions of one URL is two places for it
 * to be wrong.
 */
export function aiModelsUrl(profile: AiProviderProfile): string {
  return new URL(profile.models_path, profile.api_origin).toString();
}

/* ---------------------------------------------------------------------- *
 * Module-load checks
 * ---------------------------------------------------------------------- */

/*
 * Every profile really is rooted at its own origin, and every header it would
 * ever set is one this file declared.
 *
 * At module load rather than at request time, in the shape
 * `lib/broker/operations.ts` uses for `WRITE_PATHS`: a profile that named a
 * protocol-relative path would resolve to a different host entirely under
 * `new URL`, and a mistake of that kind must take the module down where the
 * stack names the profile rather than become a runtime refusal somebody reads as
 * a provider outage.
 */
for (const profile of PROFILES) {
  if (!profile.models_path.startsWith("/") || profile.models_path.startsWith("//")) {
    throw new Error(`AI provider ${profile.id} has a models path that is not rooted at its origin`);
  }
  if (new URL(profile.api_origin).origin !== profile.api_origin) {
    throw new Error(`AI provider ${profile.id} names an API origin that is not a bare origin`);
  }
  if (new URL(aiModelsUrl(profile)).origin !== profile.api_origin) {
    throw new Error(`AI provider ${profile.id} builds a models URL off its own origin`);
  }
  for (const header of Object.keys(aiAuthHeaders(profile, "probe"))) {
    if (!AI_AUTH_HEADERS.includes(header.toLowerCase())) {
      throw new Error(`AI provider ${profile.id} would set a header outside the declared set`);
    }
  }
}
