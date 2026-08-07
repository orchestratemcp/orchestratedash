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

/**
 * The app's surfaces, named once (MAR-440).
 *
 * The navigation and the title bar both say where the user is, and before this
 * they said it in two places that were free to disagree — the title bar being
 * new, the nav being older. One list, so "Work inbox" cannot become "Inbox" in
 * the bar without becoming it in the nav.
 *
 * The labels are what a person calls the surface, never what the route is
 * called. That is the plain-language rule applied to navigation: `/runs` is a
 * path, "Runs" is a word, and the two agreeing here is a coincidence rather
 * than a mechanism — `/work` and "Work inbox" is the case that proves it.
 */
export interface Surface {
  href: string;
  label: string;
}

export const SURFACES: readonly Surface[] = [
  { href: "/", label: "Agents" },
  { href: "/work", label: "Work inbox" },
  { href: "/runs", label: "Runs" },
  { href: "/connections", label: "Connections" },
  { href: "/agents/add", label: "Add agent" },
];

/**
 * The surface a path belongs to.
 *
 * Longest matching prefix, so `/runs/detail` is "Runs" and `/agents/detail` is
 * "Agents" rather than both falling through to the root. `/` is only ever an
 * exact match, for the obvious reason that it prefixes everything.
 */
export function surfaceFor(pathname: string): Surface {
  const root = SURFACES[0] as Surface;
  let best = root;
  for (const surface of SURFACES) {
    if (surface.href === "/") {
      continue;
    }
    if (
      (pathname === surface.href || pathname.startsWith(`${surface.href}/`)) &&
      surface.href.length > best.href.length
    ) {
      best = surface;
    }
  }
  return best;
}

/** The parameter names, shared by the writer below and the page that reads them. */
export const RUN_DETAIL_PARAMS = { agent: "agent", runId: "run_id" } as const;

export function runDetailHref(agent: string, runId: string): string {
  const params = new URLSearchParams({
    [RUN_DETAIL_PARAMS.agent]: agent,
    [RUN_DETAIL_PARAMS.runId]: runId,
  });
  return `/runs/detail?${params.toString()}`;
}

/**
 * Routes that are their own operating-system window, not a page of the app
 * (MAR-503).
 *
 * `electron/credential-prompt.ts` and `electron/approval-popup.ts` each open a
 * separate `BrowserWindow` onto a route in this same static export. They are
 * one question and one answer — a field to fill, a decision to take — and
 * anything that belongs to the *application* rather than to that question is
 * furniture in a dialog.
 *
 * Named here rather than guessed at each call site, and as a deny-list rather
 * than an allow-list on purpose: a new page of the app must not have to be
 * remembered into a list to be treated as one, and the failure of forgetting
 * should be a missing strip rather than a strip inside a credential prompt.
 */
const SEPARATE_WINDOW_ROUTES: readonly string[] = ["/credential-prompt", "/approval-popup"];

export function isSeparateWindowRoute(pathname: string): boolean {
  return SEPARATE_WINDOW_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

/** Static-export-safe agent workspace route, for the same reason as run detail. */
export const AGENT_WORKSPACE_PARAMS = { agent: "agent" } as const;

export function agentWorkspaceHref(agent: string): string {
  const params = new URLSearchParams({ [AGENT_WORKSPACE_PARAMS.agent]: agent });
  return `/agents/detail?${params.toString()}`;
}
