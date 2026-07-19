import { NextResponse } from "next/server";
import { ingestEvents } from "../../../lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The v1 telemetry ingest endpoint: POST /api/events with a single event or an
 * array of them.
 *
 * Auth is opt-in. When DASH_INGEST_TOKEN is set the bearer token must match;
 * when it is unset this local monitor accepts loopback traffic without one, so
 * a fresh clone works with no configuration. The token is compared, never
 * stored — no event, agent, or run record ever carries it.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const expected = process.env.DASH_INGEST_TOKEN;
  if (expected !== undefined && expected !== "") {
    const header = request.headers.get("authorization") ?? "";
    const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (presented !== expected) {
      return NextResponse.json(
        { error: "unauthorized" },
        { status: 401 },
      );
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "body must be valid JSON" },
      { status: 400 },
    );
  }

  const result = ingestEvents(body);

  // Fire-and-forget monitoring: a rejected event reports the reason but never
  // asks the agent to retry or block. An unreachable DASH must not break a run.
  const status = result.accepted > 0 ? 202 : 400;
  return NextResponse.json(result, { status });
}
