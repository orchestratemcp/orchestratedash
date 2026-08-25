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

/**
 * Settings, and the address of its first tab — the same string (MAR-592).
 *
 * `/settings` **is** the Connections tab rather than a page that forwards to
 * one. A static export cannot answer a redirect: forwarding would mean shipping
 * a page whose whole job is to run a script and navigate away, which on a slow
 * paint is a blank Settings page, and on the packaged renderer is a blank
 * Settings page more often than in development. Landing somewhere real is worth
 * more than four symmetrical URLs.
 *
 * Connections is the tab that gets the short address because it is the one a
 * person arrives for. The acceptance test for this issue is that somebody who
 * has never used DASH finds where to connect Gmail without being told, and one
 * press of Settings putting them on the page with Gmail on it is the shortest
 * true answer to that.
 */
export const SETTINGS_ROOT = "/settings";

/**
 * The sidebar's destinations, and why there are four of them (MAR-592).
 *
 * There were seven. Four of those seven were not places you *go* — they were
 * places you go **once**, to set something up: connect a service, add a channel
 * address, register a server, add an agent. They sat in the same list, at the
 * same rank, as the three surfaces a person opens DASH to look at, and the list
 * grew by one every time a setup step was built. MAR-498 and MAR-588 each said
 * so in their own comment here — *"a sixth destination"*, *"a seventh"* — which
 * is the shape of a nav that has no rule about what belongs in it.
 *
 * The rule is now: **the sidebar is what you watch, Settings is what you
 * arrange.** Agents, Work inbox and Runs answer "what are my agents doing, what
 * needs me, what happened". Everything that answers "set this up once" is a tab
 * on one page, and that page is a single sidebar row.
 *
 * This is a move, not a redesign. Every one of the four surfaces renders the
 * same component tree it rendered before, at a new address. See
 * `SETTINGS_TABS`.
 */
export const SURFACES: readonly Surface[] = [
  { href: "/", label: "Agents" },
  { href: "/work", label: "Work inbox" },
  { href: "/runs", label: "Runs" },
  { href: SETTINGS_ROOT, label: "Settings" },
];

/**
 * Settings' tabs — five real routes, not five states of one page (MAR-592,
 * MAR-599).
 *
 * Each of these is a page in the static export with its own address, and that
 * is a requirement rather than an implementation detail. Three things depend on
 * it:
 *
 * 1. **Deep links.** `lib/open-link.ts` names a surface and asks for it to be
 *    shown; MAR-588 sends those links to a Discord channel. A tab held in React
 *    state is not a surface anything outside the renderer can name.
 * 2. **The capture harnesses.** `electron/capture.ts` and its three siblings
 *    photograph a *route*. Tabs behind a click would be tabs photographed by a
 *    harness that had to learn to click, and — see MAR-577's density note — a
 *    harness that clicks is a harness that can mislabel half its images.
 * 3. **Every link already pointing at these surfaces.** A chip on the fleet
 *    page saying an agent is not connected has to be able to arrive *at
 *    Connections*, not at Settings-with-luck.
 *
 * The first four labels are unchanged from the sidebar rows they replaced,
 * including "Servers" over `/settings/servers` — MAR-498's reason still
 * holds, that a host is what the record is called and a server is what a
 * person rents.
 *
 * **Preferences is new (MAR-599).** The paused attended run's handoff named
 * "app preferences (dark mode etc.)" as one of the five sections Henrik asked
 * for when MAR-592 was scoped; MAR-592 itself shipped the other four. It is
 * last, after the held add-agent flow, because it is the one tab that answers
 * "how does DASH look" rather than "what can DASH reach" — a different
 * question, asked less often.
 *
 * **AI is the sixth (MAR-642), and it is second.** Three of the cards on
 * Connections were model-provider keys, sitting in a list whose other entry is
 * a mailbox sign-in — one page answering two questions a person asks at
 * different times and for different reasons. "What can my agents reach" is the
 * mailbox; "what do my agents think with" is the key, and the second now has
 * the fleet-wide model default beside it, which had nowhere to live at all.
 *
 * Second rather than last because it is the tab a DASH with no keys most needs
 * somebody to find: an agent whose plan needs a model does nothing useful until
 * one of these is connected, and burying that behind Servers and Add agent
 * would be the same "unfindable is missing" defect the sidebar rule was written
 * against.
 */
export const SETTINGS_TABS: readonly Surface[] = [
  { href: SETTINGS_ROOT, label: "Connections" },
  { href: "/settings/ai", label: "AI" },
  { href: "/settings/notifications", label: "Notifications" },
  /*
   * MAR-479, ADR 0026. The seventh, and it sits beside Notifications on
   * purpose: those two tabs are the complete answer to "what does DASH send,
   * and to whom", and somebody auditing that should find both without having to
   * know the second exists.
   *
   * "Reporting" rather than "Telemetry". The word a person recognises for the
   * thing they are being asked to consent to is not the word the industry uses
   * for it, and this tab exists to be found by somebody suspicious.
   */
  { href: "/settings/reporting", label: "Reporting" },
  { href: "/settings/servers", label: "Servers" },
  { href: "/settings/add-agent", label: "Add agent" },
  /*
   * MAR-785, ADR 0030. The eighth, and it sits beside Preferences rather than
   * inside it.
   *
   * `app/settings/preferences/page.tsx` opens with "how DASH looks, not what it
   * does", and MAR-599 wrote that line as a boundary. Startup is the other kind
   * of setting and the clearest case of it in the product: it decides what this
   * computer does at a moment when DASH is not running and nobody is at the
   * keyboard. A ninth row on Preferences would have put "add DASH to my
   * computer's startup list" into the inventory of how the window looks.
   *
   * Adjacent to it anyway, because a person who has gone looking for a switch
   * about the app itself rather than about an agent will try Preferences first,
   * and the tab they want should be the next word along.
   */
  { href: "/settings/startup", label: "Startup" },
  { href: "/settings/preferences", label: "Preferences" },
];

/** Whether a path is inside Settings at all — the tab strip's own gate. */
export function isSettingsRoute(pathname: string): boolean {
  return pathname === SETTINGS_ROOT || pathname.startsWith(`${SETTINGS_ROOT}/`);
}

/**
 * The tab a path belongs to.
 *
 * Longest matching prefix, with `SETTINGS_ROOT` exact-only for the reason `/`
 * is exact-only in `surfaceFor` below: it prefixes every other tab, so a
 * prefix rule would make Connections the answer on all four.
 */
export function settingsTabFor(pathname: string): Surface {
  const index = SETTINGS_TABS[0] as Surface;
  let best = index;
  for (const tab of SETTINGS_TABS) {
    if (tab.href === SETTINGS_ROOT) {
      continue;
    }
    if (
      (pathname === tab.href || pathname.startsWith(`${tab.href}/`)) &&
      tab.href.length > best.href.length
    ) {
      best = tab;
    }
  }
  return best;
}

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
export const SEPARATE_WINDOW_ROUTES: readonly string[] = [
  "/credential-prompt",
  "/approval-popup",
];

export function isSeparateWindowRoute(pathname: string): boolean {
  return SEPARATE_WINDOW_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

/**
 * Static-export-safe agent workspace route, for the same reason as run detail.
 *
 * `stage` and `output` joined it with MAR-641's cockpit. Both are optional and
 * both have a defined absence: no `stage` means "whichever view of this agent
 * suits what it is doing" (`resolveAgentStage`), and no `output` means the
 * newest one. That is what keeps every link written before the cockpit — the
 * fleet cards, the glance chips, `lib/open-link.ts` — pointing somewhere real.
 */
export const AGENT_WORKSPACE_PARAMS = {
  agent: "agent",
  stage: "stage",
  /** Which output the Output stage opens, when the rail names one. */
  output: "output",
} as const;

export function agentWorkspaceHref(agent: string): string {
  const params = new URLSearchParams({ [AGENT_WORKSPACE_PARAMS.agent]: agent });
  return `/agents/detail?${params.toString()}`;
}

/**
 * One part of one agent, addressable (MAR-641).
 *
 * Takes the stage as a plain string rather than as an `AgentStage`, so this
 * module keeps importing nothing: `app/_data/routes.ts` is read by the title
 * bar, the sidebar, the fleet cards and four capture harnesses, and a type
 * import here would put the stage vocabulary in all of them. The callers that
 * build these links hold the union already, and `resolveAgentStage` is the one
 * place a string becomes a stage.
 */
export function agentStageHref(
  agent: string,
  stage: string,
  options: { output?: string } = {},
): string {
  const params = new URLSearchParams({
    [AGENT_WORKSPACE_PARAMS.agent]: agent,
    [AGENT_WORKSPACE_PARAMS.stage]: stage,
  });
  if (options.output !== undefined) {
    params.set(AGENT_WORKSPACE_PARAMS.output, options.output);
  }
  return `/agents/detail?${params.toString()}`;
}
