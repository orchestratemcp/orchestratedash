import { NextResponse } from "next/server";

import { workInboxView } from "../../../../lib/views/build";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The developer browser path for the same global inbox Electron main returns. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(workInboxView());
}
