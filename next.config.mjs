/**
 * Two builds out of one app (MAR-432, DASH-20).
 *
 * `pnpm build` produces the developer path: a Next server with route handlers,
 * including the frozen telemetry v1 ingest at `POST /api/events` and the
 * manifest import at `POST /api/agents`.
 *
 * `pnpm build:renderer` sets `DASH_STATIC_EXPORT` and produces the packaged
 * app's renderer: static HTML with no server behind it, served from inside the
 * install over DASH's own scheme.
 *
 * ## Why the export is conditional and must stay so
 *
 * Making `output: "export"` unconditional would delete `POST /api/events` from
 * the only build that has it. That endpoint is a frozen contract — agents in the
 * wild post to it — and it is also what `pnpm demo:violation` and the documented
 * developer path depend on. The packaged app does not need it (the runner
 * reaches DASH over its own channel), so the two builds want genuinely different
 * things and the flag is what lets them have them.
 *
 * ## Why `pageExtensions` rather than a guard inside the routes
 *
 * A route handler cannot opt out of an export at runtime. Its mere presence
 * fails the build:
 *
 *     Error: export const dynamic = "force-dynamic" on page "/api/agents"
 *     cannot be used with "output: export"
 *
 * So the handlers have to be absent, not inert. Naming them `route.dev.ts` and
 * removing `dev.ts` from the export build's recognised extensions is how Next
 * itself offers to do that — and it puts the fact in the filename, where anyone
 * opening `app/api/` can see which routes exist in which build without knowing
 * this file exists.
 *
 * The frozen contract is the URL and the payload. Neither moves: the developer
 * build still serves `/api/events` at the same address, from the same code.
 */

/** @type {import('next').NextConfig} */
const packaging = process.env.DASH_STATIC_EXPORT === "1";

const nextConfig = {
  ...(packaging ? { output: "export" } : {}),

  /**
   * `.dev.ts` must come first: extensions are matched in order, and a
   * `route.dev.ts` seen as `route.dev` + `.ts` would be a route named
   * "route.dev" rather than a route handler.
   */
  pageExtensions: packaging ? ["tsx", "ts"] : ["dev.ts", "tsx", "ts"],

  // The contract schemas are read from disk at runtime, so keep them out of
  // any bundling assumptions.
  outputFileTracingIncludes: {
    "/api/**": ["./contracts/**"],
  },
};

export default nextConfig;
