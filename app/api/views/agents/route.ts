import { NextResponse } from "next/server";
import { agentsView } from "../../../../lib/views/build";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The developer path's half of "one renderer, two data sources" (MAR-432).
 *
 * These routes exist so that `pnpm dev` in a browser tab renders the same pages
 * the installed app renders. They answer with exactly what the IPC read channel
 * answers with, because both call `lib/views/build.ts` and neither builds
 * anything of its own.
 *
 * They are **not** a public API and are not part of any frozen contract. The
 * documented read endpoints are `/api/agents` and `/api/runs/{agent}/{run_id}`,
 * which are unchanged and still shaped for a script rather than for a page.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(agentsView());
}
