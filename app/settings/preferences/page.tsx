"use client";

import type { ReactNode } from "react";

import { DensityToggle } from "../../_components/density-toggle";
import { HostNotice } from "../../_components/view-state";
import { useHost } from "../../_data/use-view";

/**
 * Preferences: how DASH looks, not what it does (MAR-599).
 *
 * ## Where this came from
 *
 * MAR-592 shipped four of the five sections Henrik asked for when he scoped
 * Settings — Connections, Servers, Notifications, Add agent — and named the
 * fifth without building it: *"app preferences (dark mode etc.)"*
 * (`docs/handoff-2026-08-10-attended-run-paused.md`). This is that section,
 * added rather than folded into an existing tab, because it answers a
 * different question than the other four. Connections, Servers and
 * Notifications are all "what can DASH reach"; this is "how does DASH look",
 * and a person adjusting one has no reason to be looking at the other.
 *
 * ## Nothing new was built
 *
 * Both controls this page is about already exist. Density has had a working
 * toggle in the sidebar since MAR-420 — `DensityToggle` is imported here
 * unchanged, not reimplemented, so there is exactly one place that reads and
 * writes `dash.density`. Theme has no toggle anywhere in DASH: it follows
 * `nativeTheme.shouldUseDarkColors` end to end (`electron/main.ts`,
 * `lib/shell/chrome.ts`, `app/tokens.css`'s `color-scheme` rule), and this page
 * says that plainly rather than drawing a control nothing behind it would
 * answer to. Inventing one was out of scope for this pass.
 */
export default function PreferencesPage(): ReactNode {
  const host = useHost();

  return (
    <>
      <h1>How DASH looks</h1>
      <p className="lede">
        Two settings, and both are about spacing and colour. Neither changes
        what an agent can do.
      </p>
      <HostNotice host={host} />

      <section aria-labelledby="preferences-density">
        <h2 id="preferences-density">Density</h2>
        <p className="muted wrap">
          Comfortable is the default. Compact fits more rows and cards on
          screen — the same facts, closer together. Nothing is hidden either
          way.
        </p>
        <DensityToggle />
      </section>

      <section aria-labelledby="preferences-theme">
        <h2 id="preferences-theme">Theme</h2>
        <p className="muted wrap">
          DASH follows your operating system&rsquo;s light or dark setting.
          There is no separate switch in DASH yet — change it in your
          system&rsquo;s display settings and DASH follows.
        </p>
      </section>
    </>
  );
}
