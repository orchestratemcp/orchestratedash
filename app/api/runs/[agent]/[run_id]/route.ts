import { NextResponse } from "next/server";
import { analysisForRun, eventsForRun } from "../../../../../lib/insights";
import { readStore } from "../../../../../lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only plan-vs-actual verdict for one run.
 *
 * The UI renders this same analysis; exposing it as JSON lets a script (or a
 * later LAB bridge) read the verdict without scraping HTML. Read-only by
 * design: DASH observes runs, it never controls them.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ agent: string; run_id: string }> },
): Promise<NextResponse> {
  const { agent: agentParam, run_id: runParam } = await params;
  const agent = decodeURIComponent(agentParam);
  const runId = decodeURIComponent(runParam);

  const store = readStore();
  const events = eventsForRun(agent, runId, store);
  if (events.length === 0) {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }

  const analysis = analysisForRun(agent, runId, store);
  if (analysis === null) {
    return NextResponse.json(
      {
        agent,
        run_id: runId,
        event_count: events.length,
        analysis: null,
        reason: "manifest not imported; no plan to judge this run against",
      },
      { status: 200 },
    );
  }

  return NextResponse.json({
    agent,
    run_id: runId,
    event_count: events.length,
    analysis,
  });
}
