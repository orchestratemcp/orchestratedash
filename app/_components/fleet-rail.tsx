"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { FleetViewToggle } from "./fleet-view-toggle";
import {
  DEFAULT_FLEET_FILTER,
  FLEET_FILTERS,
  FLEET_FILTER_ATTRIBUTE,
  FLEET_FILTER_STORAGE_KEY,
  describeFleetFilter,
  fleetFilterCounts,
  parseFleetFilter,
  type FleetFilter,
} from "../../lib/views/fleet-filter";
import type { AgentRow } from "../../lib/views/types";

/**
 * The agents page's right rail: add one, change how they are laid out, or
 * narrow which ones are on screen (MAR-640).
 *
 * The left sidebar is *where you go* (MAR-546). This column is *what you do
 * to the fleet you are looking at*. Those are different questions, and putting
 * both in the left list was how "Add agent" became a destination you visit
 * rather than an action on this page (MAR-592 had to rescue it from Settings).
 *
 * The layout control sits here for the same reason it used to sit above the
 * cards (MAR-612): a setting whose whole effect is on this page, kept only on
 * a settings screen two clicks away, is a setting nobody finds. Preferences
 * still inventories it; this is the copy that matters.
 *
 * A link, not a button, and it goes to the same page the Settings tab does.
 * There is one add-agent surface and this is a second door onto it — the
 * argument `lib/shell/menu.ts` made about its own menu item.
 */
export function FleetRail({ agents }: { agents: readonly AgentRow[] }): ReactNode {
  return (
    <aside className="fleet-rail" aria-label="Agent actions">
      <Link className="button-link" href="/settings/add-agent">
        Add agent
      </Link>
      <FleetFilterGroup agents={agents} />
      <FleetViewToggle />
    </aside>
  );
}

/**
 * How the rail and the list hear about a filter change.
 *
 * `FLEET_VIEW_EVENT`'s own reasoning: the control and the list are separate
 * components with no shared parent that holds the setting, and the setting's
 * real home is an attribute on `<html>` rather than React state.
 */
const FLEET_FILTER_EVENT = "dash:fleet-filter";

/**
 * The current filter, and the one way to change it.
 *
 * `useFleetView`'s own shape — reads the attribute the pre-paint script
 * already wrote rather than storage a second time, because the document is
 * the one thing already telling the truth about the frame on screen.
 */
export function useFleetFilter(): [FleetFilter, (next: FleetFilter) => void] {
  const [filter, setFilter] = useState<FleetFilter>(DEFAULT_FLEET_FILTER);

  useEffect(() => {
    const read = (): void => {
      setFilter(parseFleetFilter(document.documentElement.getAttribute(FLEET_FILTER_ATTRIBUTE)));
    };
    read();
    window.addEventListener(FLEET_FILTER_EVENT, read);
    return () => {
      window.removeEventListener(FLEET_FILTER_EVENT, read);
    };
  }, []);

  const choose = useCallback((next: FleetFilter): void => {
    document.documentElement.setAttribute(FLEET_FILTER_ATTRIBUTE, next);
    try {
      window.localStorage.setItem(FLEET_FILTER_STORAGE_KEY, next);
    } catch {
      // Storage can be unavailable — `useFleetView`'s own note. The filter
      // still changes for this window, which is what was just asked for.
    }
    window.dispatchEvent(new Event(FLEET_FILTER_EVENT));
  }, []);

  return [filter, choose];
}

/**
 * The filter, read synchronously at mount rather than after an effect
 * (`FleetFilterScript`'s own header explains why filtering needs this and
 * the CSS-driven view/density settings do not).
 *
 * The lazy `useState` initializer runs during the very first render, by
 * which point the pre-paint script has already set the attribute — so
 * `FleetList`'s first paint filters correctly with no flash of an unfiltered
 * fleet, at the cost of `typeof document === "undefined"` guarding the one
 * render this component ever takes on a machine with no DOM: the static
 * export's own build.
 */
export function useFleetFilterSync(): FleetFilter {
  const [filter, setFilter] = useState<FleetFilter>(() =>
    typeof document === "undefined"
      ? DEFAULT_FLEET_FILTER
      : parseFleetFilter(document.documentElement.getAttribute(FLEET_FILTER_ATTRIBUTE)),
  );

  useEffect(() => {
    const read = (): void => {
      setFilter(parseFleetFilter(document.documentElement.getAttribute(FLEET_FILTER_ATTRIBUTE)));
    };
    window.addEventListener(FLEET_FILTER_EVENT, read);
    return () => {
      window.removeEventListener(FLEET_FILTER_EVENT, read);
    };
  }, []);

  return filter;
}

/**
 * Six options with live counts — "Show" as a status summary as much as a
 * control (the issue's own framing). Counts come from the whole fleet
 * regardless of which one is selected; see `fleetFilterCounts`'s own header.
 */
function FleetFilterGroup({ agents }: { agents: readonly AgentRow[] }): ReactNode {
  const [filter, choose] = useFleetFilter();
  const counts = fleetFilterCounts(agents);

  return (
    <fieldset className="fleet-filter-group">
      <legend>Show</legend>
      {FLEET_FILTERS.map((option) => (
        <label className="fleet-filter-option" key={option}>
          <input
            type="radio"
            name="fleet-filter"
            value={option}
            checked={filter === option}
            onChange={() => {
              choose(option);
            }}
          />
          <span>{describeFleetFilter(option)}</span>
          <span className="fleet-filter-count muted">{String(counts[option])}</span>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * Set the fleet's filter before the first paint.
 *
 * `FleetViewScript`'s own reason, rendered beside it in `app/layout.tsx`: the
 * renderer is a static export, and without this the fleet would flash
 * unfiltered on every navigation before the effect above corrects it. Unlike
 * the view scripts, this one does not drive a stylesheet rule — filtering
 * removes cards from the document rather than repositioning them — so the
 * attribute is read back synchronously by `FleetList`'s own lazy state rather
 * than by CSS, and the two facts must still be readable from the same place
 * before hydration for either to work.
 */
export function FleetFilterScript(): ReactNode {
  const script = [
    "(function(){try{",
    `var v=window.localStorage.getItem(${JSON.stringify(FLEET_FILTER_STORAGE_KEY)});`,
    `if(${JSON.stringify(FLEET_FILTERS)}.indexOf(v)!==-1&&v!=="all"){document.documentElement.setAttribute(${JSON.stringify(FLEET_FILTER_ATTRIBUTE)},v);}`,
    "}catch(e){}})()",
  ].join("");
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
