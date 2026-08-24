"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { SETTINGS_TABS, settingsTabFor } from "../_data/routes";
import { useView } from "../_data/use-view";

/**
 * The strip along the top of Settings (MAR-592).
 *
 * ## Links, not an ARIA tablist
 *
 * These look like tabs and they are not tabs, in the sense the ARIA authoring
 * practices mean. `role="tab"` describes a control that swaps a panel *inside
 * the current document*: it comes with arrow-key roving focus, a `tabpanel` it
 * owns by id, and the promise that pressing it does not navigate. Every one of
 * those would be a lie here — each press is a real navigation to a real page in
 * the static export, which is the whole point of the issue (see
 * `SETTINGS_TABS`).
 *
 * So this is a `<nav>` of ordinary links with `aria-current="page"`, which is
 * what the sidebar already does one level up, and the tab appearance is
 * entirely in the stylesheet. A keyboard user gets Tab and Enter and the same
 * behaviour every other link in DASH has; nothing has to learn a second
 * interaction model to reach the Connections page.
 *
 * ## Why the labels are not re-worded here
 *
 * They are `SETTINGS_TABS`' labels, which are the labels these four surfaces
 * had as sidebar rows. A move that also renamed things would make it impossible
 * to tell, from a screenshot, whether somebody could no longer find Servers
 * because it moved or because it is now called something else.
 */
/** The one tab this strip hides. See `SettingsTabs`' docblock below. */
const REPORTING_TAB_HREF = "/settings/reporting";

/**
 * Reads whether a LAB is configured, for `SettingsTabsStrip` below.
 *
 * `masked_hint !== null` rather than `enabled`, because the gate this issue
 * asks for is "has anybody set this up", not "is it currently switched on" —
 * `lib/lab/settings.ts`' own distinction between "Switched off" and "Not set
 * up". A person who configured a LAB and then paused sending has not
 * unconfigured it, and should still find the tab.
 *
 * Loading and failed both read as unconfigured. That is the same direction
 * ADR 0026 decision 7 chose for the feature itself — absence is the state
 * nothing can misread — applied to the one new question this issue adds: a
 * page that cannot yet say "yes" has not earned a "yes".
 */
function useReportingConfigured(): boolean {
  const state = useView((source) => source.labTelemetry());
  return state.status === "ready" && state.data.masked_hint !== null;
}

/**
 * The strip along the top of Settings (MAR-592), now with one tab that is not
 * always there (MAR-742).
 *
 * Henrik's own read of Reporting, cold: correct by ADR 0026, meaningless to
 * open on a DASH nobody has pointed at a LAB. The fix is not to soften the
 * page — the receipt's third line stays exactly as strict — it is to keep the
 * tab out of the strip until there is a LAB address on record, so a person who
 * has never heard of LAB never has a reason to.
 *
 * Split from the hook for `ReportingSettings`' reason in
 * `app/settings/reporting/page.tsx`: `SettingsTabsStrip` takes the decided
 * boolean as a prop, so `tests/settings-tabs.test.tsx` can render both states
 * of the strip without a data source to feed a `useEffect`.
 */
export function SettingsTabs(): ReactNode {
  const reportingConfigured = useReportingConfigured();
  return <SettingsTabsStrip reportingConfigured={reportingConfigured} />;
}

export function SettingsTabsStrip({
  reportingConfigured,
}: {
  reportingConfigured: boolean;
}): ReactNode {
  const pathname = usePathname() ?? "/";
  const current = settingsTabFor(pathname);
  const tabs = SETTINGS_TABS.filter(
    (tab) => tab.href !== REPORTING_TAB_HREF || reportingConfigured,
  );

  return (
    <nav className="settings-tabs" aria-label="Settings sections">
      {tabs.map((tab) => {
        const active = tab.href === current.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={active ? "settings-tab is-active" : "settings-tab"}
            /*
              The same reason the sidebar carries this: the underline and the
              electric-blue label are the concept's answer to "which one am I
              on", and both are silent to anyone not looking at the screen.
            */
            aria-current={active ? "page" : undefined}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
