import type { ReactNode } from "react";

import { SettingsTabs } from "../_components/settings-tabs";

/**
 * Settings (MAR-592).
 *
 * Four surfaces that used to be four sidebar rows share this layout, so the
 * strip is rendered once and every tab is one press from every other. A nested
 * layout rather than a component each page remembers to include: the failure of
 * forgetting would be a Settings page with no way back to the other three, and
 * it would be invisible to everything except somebody standing on that page.
 *
 * There is no `<h1>Settings</h1>` here, and that is deliberate. The title bar
 * already says which surface the window is on — it says "Settings" on all four
 * of these routes, because `surfaceFor` resolves them to one surface — and each
 * tab keeps the `<h1>` it had as a page of its own. Adding a second heading
 * above them would push every page's real heading to `<h2>`, which is a content
 * change to four surfaces in an issue whose whole claim is that it moved them
 * without touching them. The add-agent flow in particular is under a hold: it
 * is being tried by a person today and moves verbatim.
 */
export default function SettingsLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <>
      <SettingsTabs />
      {children}
    </>
  );
}
