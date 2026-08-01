/** Identity of the runner bytes DASH is prepared to supervise. */

declare const __DASH_RUNNER_BUILD_ID__: string;

/** Bump only when the DASH↔runner control surface becomes incompatible. */
export const RUNNER_PROTOCOL_VERSION = 1;

/**
 * Exact source fingerprint injected by `scripts/build-shell.mjs`.
 *
 * Unit tests execute TypeScript directly rather than a shell bundle, so they
 * share the explicit development identity. A built shell never does.
 */
export const RUNNER_BUILD_ID =
  typeof __DASH_RUNNER_BUILD_ID__ === "string"
    ? __DASH_RUNNER_BUILD_ID__
    : "development";
