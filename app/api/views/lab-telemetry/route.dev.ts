import { NextResponse } from "next/server";
import { labTelemetryView } from "../../../../lib/views/build";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * See `app/api/views/agents/route.ts` for what this family is and is not.
 *
 * Worth two extra sentences here (MAR-479, ADR 0026). What this returns holds a
 * masked hint, an address and two payload bodies, and never the token —
 * `labTelemetryView` does not open the vault, so this developer-path route is
 * not a way to read a credential out of a browser tab, the standing the
 * `view.labTelemetry` entry in `lib/shell/read.ts` claims for the packaged path.
 *
 * And the bodies it does return are safe to hand a browser tab for the reason
 * ADR 0026 decision 2 makes them safe to send at all: every field in one is a
 * registry id, an enum, a digest or a date. A route that could return an agent's
 * goal would be the thing this whole feature is built not to do, reached through
 * the developer door.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(labTelemetryView());
}
