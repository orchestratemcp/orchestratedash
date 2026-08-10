"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { SETTINGS_TABS, settingsTabFor } from "../_data/routes";

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
export function SettingsTabs(): ReactNode {
  const pathname = usePathname() ?? "/";
  const current = settingsTabFor(pathname);

  return (
    <nav className="settings-tabs" aria-label="Settings sections">
      {SETTINGS_TABS.map((tab) => {
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
