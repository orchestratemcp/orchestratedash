import { NextResponse } from "next/server";

import { reviewRead } from "../../../../lib/shell/read";
import { browserView } from "../../../../lib/views/browser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The developer browser path for one agent's controlled browser (MAR-628).
 *
 * Parameters pass through the same allowlist as Electron IPC, so an empty or
 * extra value is refused consistently in both hosts.
 *
 * **The open session id is always null here, and that is correct rather than a
 * gap.** A `WebContentsView` exists only in the Electron main process; a Next
 * dev server has no window, no view and no controller, so there is no browser
 * for anybody looking at this route to stop. Passing null renders every session
 * as finished, which is exactly what they are from where this code is standing.
 * Inventing a live one would put a Stop control on a page that cannot stop
 * anything.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const review = reviewRead({
    read: "view.browser",
    params: { agent: params.get("agent") ?? "" },
  });

  if (review.decision === "denied") {
    return NextResponse.json({ error: review.reason }, { status: 400 });
  }

  return NextResponse.json(browserView(review.params["agent"] ?? "", null));
}
