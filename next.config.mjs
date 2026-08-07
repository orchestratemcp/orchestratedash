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
   * The shell loads `http://127.0.0.1:3000`, so the dev server has to answer it.
   *
   * Next blocks cross-origin access to its own dev resources — `/_next/webpack-hmr`
   * and the dev overlay's assets — for any host not on this list, and the default
   * list does not include the literal loopback address. `lib/shell/window.ts`
   * accepts *only* the literal addresses and deliberately refuses `localhost`,
   * because a name can resolve through DNS and the point of the allowlist is to
   * be independent of resolver behaviour. Those two decisions are individually
   * right and together they silently killed hot reload on the developer path:
   * every `pnpm shell` window logged
   *
   *     ⚠ Blocked cross-origin request to Next.js dev resource /_next/webpack-hmr
   *       from "127.0.0.1".
   *
   * into `.next/dev/logs/next-development.log`, where nobody was reading, and the
   * shell stopped picking up edits. A developer whose hot reload has quietly
   * stopped is exactly the person who ends up looking at a dev server that has
   * been running for two days.
   *
   * This is a development-only setting. It has no effect on the export, which is
   * what the packaged app ships and which has no dev server behind it at all.
   */
  allowedDevOrigins: ["127.0.0.1"],

  /**
   * Next's own dev badge, off (MAR-503).
   *
   * It is a fixed circle in the bottom-left corner of the viewport, and the
   * bottom-left corner of the viewport is now where the first of the O's
   * stands. On the developer path it sits on top of the fleet strip: it covers
   * a character in every screenshot the capture harness takes, and it covers
   * one for anybody running `pnpm shell` against `next dev`.
   *
   * Development-only, like `allowedDevOrigins` above. The export has no dev
   * server behind it and never had the badge, so what this changes is that the
   * two paths now look the same in the one corner where they had stopped
   * looking the same.
   */
  devIndicators: false,

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
