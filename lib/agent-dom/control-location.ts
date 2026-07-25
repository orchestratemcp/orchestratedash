/**
 * Where an agent's control endpoint is, and whether DASH may talk to it.
 *
 * The contract's HTTP transport profile v0 names two operations against one
 * base URI — `GET {control-location-uri}` for a state snapshot and
 * `POST {control-location-uri}/commands` for a command envelope. This module
 * answers the prior question: which URI, and is it one we are allowed to use.
 *
 * Pure, and deliberately separate from `lib/agent-dom/transport.ts`. The rule
 * "loopback may be plain HTTP, everything else must be HTTPS" is a security
 * boundary, and a security boundary that can only be tested by standing up a
 * server is one that mostly does not get tested.
 *
 * **Missing controls mean read-only, not inferred controls.** Every path that
 * cannot produce a location returns a reason rather than a guess. A manifest
 * that declares `supported: true` and then names no reachable location is not
 * an agent DASH should improvise a base URL for; it is a manifest with a
 * mistake in it, and saying so is more useful than a connection refused.
 */

import type { AgentManifestV2 } from "../contracts";

/**
 * Why an agent has no usable control location.
 *
 * Distinguishable for the same reason `CommandRejection`'s members are: these
 * need different fixes. `not_supported` is the agent author's deliberate
 * choice and the correct end state for a monitor-only agent; `no_location` and
 * `ambiguous_location` are manifest bugs; `insecure_scheme` and
 * `credentials_in_url` are refusals.
 */
export type ControlLocationProblem =
  /** The manifest declares `control.supported: false`. Read-only, as intended. */
  | "not_supported"
  /** `supported: true`, but no control location carries a URI. */
  | "no_location"
  /** `location_id` names a location the manifest does not declare. */
  | "unknown_location_id"
  /** Several control locations carry URIs and none was named. */
  | "ambiguous_location"
  /** The URI is not a URL at all, or not one with a host. */
  | "malformed_uri"
  /** Plain HTTP to somewhere that is not loopback. */
  | "insecure_scheme"
  /** The URL carries a username, password or query string. */
  | "credentials_in_url";

export type ControlLocationResult =
  | { ok: true; uri: string; loopback: boolean }
  | { ok: false; problem: ControlLocationProblem; detail: string };

/** The shape this module reads out of a v2 manifest, checked before use. */
interface ManifestLocation {
  id?: unknown;
  label?: unknown;
  kind?: unknown;
  uri?: unknown;
}

/**
 * Resolve the control location for an agent, or say why there is none.
 *
 * `location_id` is optional in the schema, so the fallback matters: with
 * exactly one control location carrying a URI, that is unambiguously the one.
 * With several, DASH refuses rather than picking the first — "the first entry
 * in the array" is not a rule any manifest author agreed to, and quietly
 * sending commands to the wrong endpoint is worse than declining to send them.
 */
export function resolveControlLocation(manifest: AgentManifestV2): ControlLocationResult {
  const agentDom = manifest.agent_dom;
  const control = agentDom["control"] as
    | { supported?: unknown; location_id?: unknown }
    | undefined;

  if (control === undefined || control.supported !== true) {
    return {
      ok: false,
      problem: "not_supported",
      detail: "This manifest declares no command support, so DASH renders the agent read-only.",
    };
  }

  const locations = agentDom["locations"] as { control?: unknown } | undefined;
  const declared = Array.isArray(locations?.control)
    ? (locations.control as ManifestLocation[])
    : [];

  const locationId = control.location_id;
  if (typeof locationId === "string" && locationId.length > 0) {
    const named = declared.find((candidate) => candidate.id === locationId);
    if (named === undefined) {
      return {
        ok: false,
        problem: "unknown_location_id",
        detail: `The manifest's control block names location "${locationId}", which it does not declare.`,
      };
    }
    if (typeof named.uri !== "string" || named.uri.length === 0) {
      return {
        ok: false,
        problem: "no_location",
        detail: `Control location "${locationId}" declares no uri, so there is nothing to send a command to.`,
      };
    }
    return checkControlUrl(named.uri);
  }

  const addressable = declared.filter(
    (candidate) => typeof candidate.uri === "string" && candidate.uri.length > 0,
  );
  if (addressable.length === 0) {
    return {
      ok: false,
      problem: "no_location",
      detail: "The manifest declares command support but no control location with a uri.",
    };
  }
  if (addressable.length > 1) {
    return {
      ok: false,
      problem: "ambiguous_location",
      detail:
        `The manifest declares ${String(addressable.length)} control locations with a uri and ` +
        `no control.location_id to choose between them.`,
    };
  }

  return checkControlUrl(addressable[0]?.uri as string);
}

/**
 * The transport rule, on its own so it can be tested on its own.
 *
 * Three refusals, all from the contract:
 *
 * 1. **"Loopback HTTP is permitted for a local adapter. Remote control requires
 *    HTTPS."** The bundled runner is the local adapter that permission was
 *    written for; anything else on plain HTTP is a command channel readable by
 *    the network it crosses.
 * 2. **"Credentials never appear in manifests, state, commands, URLs, or
 *    logs."** URL userinfo is the obvious way that rule gets broken, so a URL
 *    carrying any is refused outright rather than stripped — stripping would
 *    mean DASH had held a credential and decided to be tidy about it.
 * 3. A query string is refused for the same reason. The profile's two
 *    operations take no query parameters, so anything there is either a
 *    credential or a misunderstanding, and neither should be forwarded.
 *
 * A trailing slash is removed so `${uri}/commands` never produces a double
 * slash. Some servers route those differently and one of them will eventually
 * be someone's runner.
 */
export function checkControlUrl(uri: string): ControlLocationResult {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return {
      ok: false,
      problem: "malformed_uri",
      detail: `"${uri}" is not an absolute URL.`,
    };
  }

  if (url.username !== "" || url.password !== "") {
    return {
      ok: false,
      problem: "credentials_in_url",
      detail:
        "The control location carries credentials in the URL. The contract forbids that, " +
        "and channel authentication is established out of band by the installed adapter.",
    };
  }
  if (url.search !== "") {
    return {
      ok: false,
      problem: "credentials_in_url",
      detail: "The control location carries a query string. The v0 profile's operations take none.",
    };
  }

  const loopback = isLoopbackHost(url.hostname);
  if (url.protocol === "https:") {
    return { ok: true, uri: withoutTrailingSlash(url), loopback };
  }
  if (url.protocol === "http:" && loopback) {
    return { ok: true, uri: withoutTrailingSlash(url), loopback: true };
  }

  return {
    ok: false,
    problem: "insecure_scheme",
    detail:
      `"${url.protocol}//${url.host}" is not a channel DASH will send commands over. ` +
      `Loopback may use http; anything else must use https.`,
  };
}

/**
 * Loopback, by address rather than by name.
 *
 * `localhost` is included because it is what people write, but it is the weakest
 * member of the list: it resolves through the OS and can be pointed elsewhere.
 * The runner's own manifest uses `127.0.0.1`, and the literal addresses are the
 * ones this check is actually load-bearing for.
 *
 * IPv6 hostnames arrive from `URL` **with** their brackets — `[::1]`, not
 * `::1`. Both spellings are accepted rather than one being assumed, because
 * assuming the wrong one is a check that silently refuses every IPv6 loopback
 * runner and looks like a networking problem when it happens.
 */
function isLoopbackHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "::1" || hostname === "[::1]") {
    return true;
  }
  // The whole 127.0.0.0/8 block, not just 127.0.0.1.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
}

function withoutTrailingSlash(url: URL): string {
  const serialized = `${url.protocol}//${url.host}${url.pathname}`;
  return serialized.endsWith("/") ? serialized.slice(0, -1) : serialized;
}
