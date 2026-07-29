import { NextResponse } from "next/server";
import { reviewRead } from "../../../../lib/shell/read";
import { runView } from "../../../../lib/views/build";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One run's detail, for the developer path.
 *
 * The parameters go through `reviewRead` — the read channel's own gate — rather
 * than being pulled straight off the query string. Not because this route faces
 * anything the IPC channel does not, but because "both hosts get the same
 * answer" should include "both hosts get the same refusal": an empty agent name
 * is a denial on one side and must not be a lookup for an agent called `""` on
 * the other.
 *
 * A missing run is answered with the same `{ found: false }` document the IPC
 * channel returns, not a 404. The page has one shape to render either way, which
 * is the point of `RunView` being a union rather than a nullable.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const review = reviewRead({
    read: "view.run",
    params: {
      agent: params.get("agent") ?? "",
      run_id: params.get("run_id") ?? "",
    },
  });

  if (review.decision === "denied") {
    return NextResponse.json({ error: review.reason }, { status: 400 });
  }

  return NextResponse.json(
    runView(review.params["agent"] ?? "", review.params["run_id"] ?? ""),
  );
}
