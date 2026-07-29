import { NextResponse } from "next/server";

import { reviewRead } from "../../../../lib/shell/read";
import { workspaceView } from "../../../../lib/views/build";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The developer browser path for one agent workspace.
 *
 * Parameters pass through the same allowlist as Electron IPC, so an empty or
 * extra value is refused consistently in both hosts.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const review = reviewRead({
    read: "view.workspace",
    params: { agent: params.get("agent") ?? "" },
  });

  if (review.decision === "denied") {
    return NextResponse.json({ error: review.reason }, { status: 400 });
  }

  return NextResponse.json(workspaceView(review.params["agent"] ?? ""));
}
