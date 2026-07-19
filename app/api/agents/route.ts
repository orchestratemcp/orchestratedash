import { NextResponse } from "next/server";
import { importManifest, listAgents } from "../../../lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ agents: listAgents() });
}

/**
 * Imports one agent.manifest.json, as emitted by orchestratekit-mcp's
 * export_build_brief. The manifest is validated against the schema for the
 * version it declares — v1 or v2 — before it is stored; an agent is keyed by
 * agent.name, so re-importing the same agent replaces its plan rather than
 * creating a duplicate.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "body must be valid JSON" },
      { status: 400 },
    );
  }

  const result = importManifest(body);
  if (!result.ok) {
    return NextResponse.json(
      { error: "manifest failed schema validation", details: result.errors },
      { status: 400 },
    );
  }

  return NextResponse.json(result, { status: result.replaced ? 200 : 201 });
}
