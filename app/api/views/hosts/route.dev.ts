import { NextResponse } from "next/server";
import { hostsView } from "../../../../lib/views/build";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** See `app/api/views/agents/route.ts` for what this family is and is not. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(hostsView());
}
