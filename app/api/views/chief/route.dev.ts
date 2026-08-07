import { NextResponse } from "next/server";

import { chiefFleet } from "../../../../lib/views/chief";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The developer browser path for the same fleet Electron main returns (MAR-419).
 *
 * `.dev.ts` rather than `.ts`, like every other route here: `next.config.mjs`
 * keeps these out of the packaged export by their filename, so the installed
 * renderer has no HTTP surface at all.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(chiefFleet());
}
