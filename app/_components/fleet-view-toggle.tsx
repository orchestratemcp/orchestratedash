"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";

import {
  DEFAULT_FLEET_VIEW,
  FLEET_VIEWS,
  FLEET_VIEW_ATTRIBUTE,
  FLEET_VIEW_LEGEND,
  FLEET_VIEW_STORAGE_KEY,
  describeFleetView,
  parseFleetView,
  type FleetView,
} from "../../lib/views/fleet-view";

/**
 * The fleet's layout, as a control (MAR-612).
 *
 * ## Three options shown at once, not a button that cycles
 *
 * `DensityToggle` is one button because density has two states and a button that
 * swaps between two is unambiguous once its label says what pressing it gives
 * you. Three states break that: a cycling button can only name one of the two it
 * is not showing, so the third is reachable only by pressing twice and finding
 * out. A radio group states all three, marks the one in force, and costs one
 * row.
 *
 * Real `<input type="radio">` elements rather than buttons with `aria-checked`,
 * because a radio group is the one widget where the browser already implements
 * everything this needs: arrow keys move between options, only the chosen one is
 * a tab stop, and the legend names the group. Re-implementing that on buttons is
 * how a control ends up keyboard-reachable in the developer's browser and
 * nowhere else.
 *
 * ## Why the attribute is written to the document
 *
 * `DensityToggle`'s reasoning exactly. `[data-fleet-view]` in `app/globals.css`
 * re-declares the grid's track and the card's own axis, so one attribute on
 * `<html>` relays the whole list with no component being handed a prop it would
 * only pass downwards. The React state here exists to mark this control and — on
 * the fleet page — to tell the spotlight which card is in the middle, which is
 * the one thing CSS cannot answer.
 *
 * ## The flash, and the script that prevents it
 *
 * The renderer is a static export: the first render is a build artefact made on
 * a machine that has never met this user. Without `FleetViewScript` below,
 * somebody who chose Spotlight watches a grid assemble and re-lay itself on
 * every navigation. Same problem, same fix and same accepted duplication as
 * `DensityScript` and `FleetStripScript`.
 */

/**
 * How the two halves of this feature hear about each other.
 *
 * The control and the list are separate components with no common parent that
 * holds the setting — the control is also on Settings, where there is no list at
 * all — and the setting's real home is an attribute on `<html>` rather than
 * React state. So a change is announced on the window and every `useFleetView`
 * re-reads the document, which keeps the document the single source of truth
 * instead of introducing a context that would be a second one.
 *
 * A plain `Event` rather than a `CustomEvent` carrying the value: the listeners
 * read the attribute, which is the thing that actually changed. An event with a
 * payload would be a second channel free to disagree with the first.
 */
const FLEET_VIEW_EVENT = "dash:fleet-view";

/**
 * The current layout, and the one way to change it.
 *
 * Adopts whatever the pre-paint script already put on the document rather than
 * re-reading storage, which is `DensityToggle`'s and `FleetStripBand`'s shared
 * reasoning: the document is the source of truth for the current setting
 * precisely because the script got there first, and a second read is a second
 * chance to disagree with the frame the user is looking at.
 */
export function useFleetView(): [FleetView, (next: FleetView) => void] {
  const [view, setView] = useState<FleetView>(DEFAULT_FLEET_VIEW);

  useEffect(() => {
    const read = (): void => {
      setView(parseFleetView(document.documentElement.getAttribute(FLEET_VIEW_ATTRIBUTE)));
    };
    read();
    window.addEventListener(FLEET_VIEW_EVENT, read);
    return () => {
      window.removeEventListener(FLEET_VIEW_EVENT, read);
    };
  }, []);

  const choose = useCallback((next: FleetView): void => {
    document.documentElement.setAttribute(FLEET_VIEW_ATTRIBUTE, next);
    try {
      window.localStorage.setItem(FLEET_VIEW_STORAGE_KEY, next);
    } catch {
      /*
       * Storage can be unavailable — a locked-down profile, a quota, a user who
       * cleared it mid-session. The layout still changes for this window, which
       * is what was just asked for; it simply will not be there next time.
       * Failing the press over it would take away the half that worked.
       */
    }
    window.dispatchEvent(new Event(FLEET_VIEW_EVENT));
  }, []);

  return [view, choose];
}

export function FleetViewToggle(): ReactNode {
  const [view, choose] = useFleetView();

  return (
    <fieldset className="fleet-view-toggle">
      {/*
        MAR-639's text axe: off the screen rather than gone, on the
        `.visually-hidden` recipe `app/_components/app-chrome.tsx`'s own
        collapsed rail already uses. A `<fieldset>` needs an accessible name
        and a radio group needs one more than most, so the sentence stays for
        a screen reader — but a sighted reader now gets that identity from the
        glyph and the per-option `title` beside it, the "one label per
        control" instruction read the other way: three named, pictured
        options are not decoration needing a caption above them.
      */}
      <legend className="visually-hidden">{FLEET_VIEW_LEGEND}</legend>
      <div className="fleet-view-options">
        {FLEET_VIEWS.map((option) => {
          const copy = describeFleetView(option);
          return (
            <label
              className="fleet-view-option"
              key={option}
              title={copy.description}
              data-view={option}
            >
              <input
                type="radio"
                name="fleet-view"
                value={option}
                checked={view === option}
                onChange={() => {
                  choose(option);
                }}
              />
              {/*
                The glyph is decorative and the label beside it is the accessible
                name, which is `DensityToggle`'s rule. Drawn as inline rects on
                the sidebar's 12×12 grid rather than as a character from the cast:
                `app/_components/sidebar-icons.tsx` states the difference and it
                is the one that matters here — the cast is an *agent's*
                recognition, and a costume standing in for a layout would be a
                character that means a setting.
              */}
              <FleetViewGlyph view={option} />
              <span>{copy.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** x, y, width, height on the 12×12 grid, matching `sidebar-icons.tsx`. */
type Px = readonly [number, number, number, number];

/**
 * A picture of the track each option lays, rather than an abstract icon.
 *
 * Three uprights for three cards across; three rules for one card to a row; a
 * tall middle flanked by two short ones for the spotlight. `DensityToggle` makes
 * the same argument for its two bars and four: a picture of the thing is the
 * only kind of icon that works without a legend.
 */
const VIEW_GLYPHS: Readonly<Record<FleetView, readonly Px[]>> = {
  grid: [
    [1, 1, 3, 4],
    [5, 1, 3, 4],
    [9, 1, 3, 4],
    [1, 7, 3, 4],
    [5, 7, 3, 4],
    [9, 7, 3, 4],
  ],
  rows: [
    [1, 2, 10, 2],
    [1, 5, 10, 2],
    [1, 8, 10, 2],
  ],
  spotlight: [
    [1, 4, 2, 4],
    [4, 1, 4, 10],
    [9, 4, 2, 4],
  ],
};

function FleetViewGlyph({ view }: { view: FleetView }): ReactNode {
  return (
    <svg
      className="fleet-view-glyph"
      viewBox="0 0 12 12"
      width="16"
      height="16"
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      {VIEW_GLYPHS[view].map(([x, y, w, h]) => (
        <rect key={`${String(x)}-${String(y)}`} x={x} y={y} width={w} height={h} fill="currentColor" />
      ))}
    </svg>
  );
}

/**
 * Set the fleet's layout before the first paint.
 *
 * Rendered into the document by `app/layout.tsx`, beside `DensityScript` and
 * `FleetStripScript` and for their reason exactly. The string is ours end to end
 * — the stored value is compared against literals and never interpolated — and
 * it writes an attribute rather than markup.
 *
 * The default writes nothing, which is why `grid` is absent from the comparison:
 * `app/globals.css` treats "no attribute" as the grid, so a person who has never
 * touched this setting carries no attribute at all and the CSS has one fewer
 * selector to keep in agreement.
 */
export function FleetViewScript(): ReactNode {
  const script = [
    "(function(){try{",
    `var v=window.localStorage.getItem(${JSON.stringify(FLEET_VIEW_STORAGE_KEY)});`,
    `if(v==="rows"||v==="spotlight"){document.documentElement.setAttribute(${JSON.stringify(FLEET_VIEW_ATTRIBUTE)},v);}`,
    "}catch(e){}})()",
  ].join("");
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
