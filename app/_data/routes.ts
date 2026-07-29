/**
 * Where a run's detail page lives, in one place (MAR-432).
 *
 * It used to be a path: `/runs/{agent}/{run_id}`. A static export cannot emit
 * that page. Next generates a dynamic segment's pages from
 * `generateStaticParams`, and there is no such function that could exist here —
 * run ids arrive from agents at runtime, long after the export was built, and
 * an empty parameter list emits no page at all rather than a page that handles
 * any id.
 *
 * So the identifiers moved into the query string, which a single exported page
 * reads at runtime. The page is `/runs/detail`; the run it shows is whatever the
 * link said.
 *
 * The link is built here rather than inline so that the page reading the
 * parameters and the pages writing them cannot disagree about their names — the
 * failure being a link that opens the detail page with nothing to show and no
 * hint as to why.
 */

/** The parameter names, shared by the writer below and the page that reads them. */
export const RUN_DETAIL_PARAMS = { agent: "agent", runId: "run_id" } as const;

export function runDetailHref(agent: string, runId: string): string {
  const params = new URLSearchParams({
    [RUN_DETAIL_PARAMS.agent]: agent,
    [RUN_DETAIL_PARAMS.runId]: runId,
  });
  return `/runs/detail?${params.toString()}`;
}

/** Static-export-safe agent workspace route, for the same reason as run detail. */
export const AGENT_WORKSPACE_PARAMS = { agent: "agent" } as const;

export function agentWorkspaceHref(agent: string): string {
  const params = new URLSearchParams({ [AGENT_WORKSPACE_PARAMS.agent]: agent });
  return `/agents/detail?${params.toString()}`;
}
