"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { OAvatar } from "./o-avatar";
import { agentWorkspaceHref, isSeparateWindowRoute } from "../_data/routes";
import { useView } from "../_data/use-view";
import {
  DEFAULT_FLEET_STRIP,
  FLEET_STRIP_ATTRIBUTE,
  FLEET_STRIP_SLOT,
  FLEET_STRIP_STORAGE_KEY,
  describeFleetCount,
  describeFleetStrip,
  fleetStripSlots,
  nextFleetStripSetting,
  parseFleetStripSetting,
  type FleetStripSetting,
} from "../../lib/views/fleet-strip";
import type { OName } from "../../lib/brand/o-cast";
import type { AgentRow } from "../../lib/views/types";

/**
 * The O's, standing along the bottom edge of the window (MAR-503, MAR-435
 * phase 3).
 *
 * The concept direction draws this as the shared wordmark grammar: *"the O's
 * stand on the rule, feet over the edge"*. That is what the strip is — a rule
 * across the bottom of the app with each agent's character standing on it — and
 * it is DASH's own pixels throughout. **No always-on-top desktop pet and
 * nothing drawn over the real Windows taskbar**, which is MAR-435's hard
 * non-goal and is not a thing this component could do by accident: it is a
 * layout row in the document, and the window it is in is the app's own.
 *
 * ## Static, and that is the design rather than a first version of it
 *
 * The cast has exactly one frame per character. Idle, working and waiting loops
 * would need sprite sheets that do not exist, and a walk cycle invented from a
 * single frame would be motion pretending to be state — the costume-as-status
 * mistake arriving through the other door. So every O stands still, and there
 * is nothing here for `prefers-reduced-motion` to switch off. `lib/views/fleet-strip.ts`
 * carries the rest of that argument.
 *
 * ## Presence, not a second status bar
 *
 * Nothing about an agent's condition reaches this row — not the pose, not a
 * colour, not the hover text. MAR-503 permits a textual state on hover and this
 * declines it, because the fleet cards already say how each agent is, and a
 * strip that changed with them would be a status display a person reads at a
 * glance and cannot act on. What the caption says is who is here.
 *
 * ## It is a row, never an overlay
 *
 * `app/layout.tsx` makes the body a three-row grid, so the strip has its own
 * band under `main` and cannot cover an approval, a form or a receipt. When
 * there is nothing to show — no agents yet, a view still loading, a read that
 * failed — the whole band collapses rather than reserving air for a picture
 * that is not coming.
 */
export function FleetStrip(): ReactNode {
  const pathname = usePathname() ?? "/";
  /*
   * The credential prompt and the approval popup are separate windows onto one
   * question. A row of characters along the bottom of a password field would be
   * decoration inside a dialog, which is the one place DASH has argued hardest
   * that nothing should be.
   */
  if (isSeparateWindowRoute(pathname)) {
    return null;
  }
  return <FleetStripBand />;
}

/** One character standing on the rule, and where activating it goes. */
export interface FleetStripLink {
  name: string;
  avatar: OName;
  href: string;
}

/**
 * Who stands on the rule, in what order, and how many do not (MAR-503).
 *
 * Pure, and exported, because it is everything about this strip that can be
 * wrong without a browser: the order, the bound, and the destination of each
 * character. The component below maps this array and adds nothing — so a test
 * over this function is a test of what the strip actually does, rather than of
 * a second implementation that agrees with it today.
 *
 * The order is `agents` order, untouched. `agentsView` sorts by name, so the
 * cast is in the same order as the fleet list above it and stays there while an
 * agent runs, stops or fails — which is the whole of "stable order". Sorting
 * again here would be a second authority on it, free to disagree the day the
 * list gains a sort control.
 */
export function fleetStripLinks(
  agents: readonly AgentRow[],
  available: number,
): { links: FleetStripLink[]; overflow: number } {
  const { shown, overflow } = fleetStripSlots(available, agents.length);
  return {
    links: agents.slice(0, shown).map((agent) => ({
      name: agent.name,
      avatar: agent.avatar,
      href: agentWorkspaceHref(agent.name),
    })),
    overflow,
  };
}

function FleetStripBand(): ReactNode {
  const state = useView((source) => source.agents());
  const [setting, setSetting] = useState<FleetStripSetting>(DEFAULT_FLEET_STRIP);
  const [hovered, setHovered] = useState<string | null>(null);
  const row = useRowCapacity();

  /*
   * Adopt whatever the pre-paint script already put on the document rather than
   * re-reading storage, which is `DensityToggle`'s reasoning exactly: the
   * document is the source of truth for the current setting precisely because
   * the script got there first, and a second read is a second chance to
   * disagree with the frame the user is looking at.
   */
  useEffect(() => {
    setSetting(parseFleetStripSetting(document.documentElement.getAttribute(FLEET_STRIP_ATTRIBUTE)));
  }, []);

  const apply = (): void => {
    const next = nextFleetStripSetting(setting);
    document.documentElement.setAttribute(FLEET_STRIP_ATTRIBUTE, next);
    setSetting(next);
    try {
      window.localStorage.setItem(FLEET_STRIP_STORAGE_KEY, next);
    } catch {
      /*
       * Storage can be unavailable. The setting still applies to this window,
       * which is what was just asked for; it simply will not be there next
       * time. Failing the click over it would take away the half that worked.
       */
    }
  };

  const agents: AgentRow[] = state.status === "ready" ? state.data.agents : [];
  if (agents.length === 0) {
    /*
     * Nothing to stand on the rule. Not an empty strip with a sentence in it:
     * the agents page already says "nothing here yet" and says it where a
     * person can act on it, and a second empty state along the bottom of every
     * page would be furniture that is only ever there when DASH is least
     * useful.
     */
    return null;
  }

  const copy = describeFleetStrip(setting);

  if (setting === "hidden") {
    /*
     * Off, and reversible from where it was turned off. A setting a novice
     * cannot find their way back to is a setting that removed something
     * permanently, and DASH has no preferences screen to send them to — so what
     * survives is the smallest thing that can bring it back.
     */
    return (
      <aside className="fleet-strip is-hidden">
        <button
          type="button"
          className="fleet-strip-toggle"
          onClick={apply}
          aria-label={copy.label}
          title={copy.description}
        >
          {copy.visible}
        </button>
      </aside>
    );
  }

  const { links, overflow } = fleetStripLinks(agents, row.width);

  return (
    <aside className="fleet-strip" aria-label="Your agents">
      {/*
        The measured element is the row itself, so the capacity above is read
        from the space the characters actually have rather than from the
        viewport minus a number somebody kept in their head.
      */}
      <ul className="fleet-strip-row" ref={row.ref}>
        {links.map((agent) => (
          <li key={agent.name}>
            <Link
              className="fleet-strip-o"
              href={agent.href}
              onMouseEnter={() => setHovered(agent.name)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(agent.name)}
              onBlur={() => setHovered(null)}
            >
              {/*
                Decorative, like every other avatar in DASH. The accessible name
                of this control is the sentence below it, which names the agent
                and says what activating it does — announcing "wizard" as well
                would add a costume nobody asked about to the one control where
                it could be mistaken for information.

                The box is reserved at 50px by `.o-avatar` whether or not the
                file arrives, so a missing sprite costs a picture and never a
                position: the control stays exactly where it was, keeps its
                name, and still opens the agent's workspace.
              */}
              <OAvatar name={agent.avatar} size={50} />
              <span className="visually-hidden">Open {agent.name}</span>
            </Link>
          </li>
        ))}
        {overflow > 0 ? (
          /*
           * A count, never a smaller sprite. The whole-number rule means the
           * only way to fit more is to draw them wrong, so the strip says how
           * many it is not showing and the agents page shows all of them.
           */
          <li className="fleet-strip-more" aria-hidden="true">
            +{overflow}
          </li>
        ) : null}
      </ul>
      {/*
        One line that never changes height, so nothing moves when a pointer
        crosses the row or a keyboard reaches it. `aria-hidden` because every
        name it can show is already the accessible name of the control it
        describes, and a live region repeating that would announce each agent
        twice on the way past.
      */}
      <p className="fleet-strip-caption" aria-hidden="true">
        {hovered ?? describeFleetCount(agents.length, overflow)}
      </p>
      <button
        type="button"
        className="fleet-strip-toggle"
        onClick={apply}
        aria-label={copy.label}
        title={copy.description}
      >
        {copy.visible}
      </button>
    </aside>
  );
}

/**
 * How much room the row has, measured rather than assumed.
 *
 * A `ResizeObserver` on the element rather than a listener on the window: the
 * strip shares its band with a caption and a button whose widths come from the
 * copy, so the space the characters get is not a function of the viewport that
 * anybody could write down correctly. Measuring the element is the only version
 * of this that stays true when the copy changes.
 *
 * The initial value is one slot rather than zero, so the first frame stands one
 * character on the rule instead of a bare line that fills in a moment later.
 * `ResizeObserver` is guarded because the render tests run under a DOM that has
 * no such constructor, and a strip that threw there would be a component no
 * test could reach.
 */
function useRowCapacity(): {
  width: number;
  ref: (node: HTMLElement | null) => void;
} {
  /*
   * The element in state rather than in a ref, which is the part that took two
   * attempts to get right.
   *
   * The strip renders nothing until its agents arrive, so the row does not
   * exist on mount. A `useRef` plus a mount effect measures a node that is not
   * there yet, never runs again, and leaves the strip standing one character in
   * a window wide enough for ten. Holding the node in state re-runs the effect
   * at the moment the row appears, which is the only moment there is anything
   * to measure.
   */
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(FLEET_STRIP_SLOT);

  useEffect(() => {
    if (node === null) {
      return;
    }
    const measure = (): void => {
      setWidth(node.clientWidth);
    };
    measure();

    /*
     * Two signals, and the second one is not belt-and-braces.
     *
     * `ResizeObserver` delivers inside the browser's rendering loop, and a page
     * that is not compositing — an occluded window, a headless review pane —
     * does not run that loop. The strip in one of those windows keeps whatever
     * capacity it measured first: it was found showing three characters and
     * "+2" in a row a thousand pixels wide, which is a real answer to a
     * question nobody had asked since the window was a phone's width.
     *
     * `resize` is dispatched by the window itself and covers exactly the case
     * this strip's bound depends on. The observer stays because it covers what
     * `resize` cannot — the caption and the toggle are copy, and copy changes
     * width without the window doing anything.
     */
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(node);

    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [node]);

  /*
   * `setNode` is the callback ref. A state setter's identity is stable across
   * renders, so React attaches it once and calls it only when the element
   * actually arrives or leaves — an inline arrow would be a new function every
   * render and would detach and reattach on each one.
   */
  return { width, ref: setNode };
}

/**
 * Set the strip's visibility before the first paint.
 *
 * Rendered into the document by `app/layout.tsx`, beside `DensityScript` and
 * for the same reason: the renderer is a static export whose first render is a
 * build artefact made on a machine that never met this user, so without this a
 * person who turned the strip off watches it appear and leave again on every
 * navigation. The string is ours end to end — no stored value is interpolated
 * into it, only compared against a literal — and it writes an attribute rather
 * than markup.
 */
export function FleetStripScript(): ReactNode {
  const script = [
    "(function(){try{",
    `var v=window.localStorage.getItem(${JSON.stringify(FLEET_STRIP_STORAGE_KEY)});`,
    `if(v==="hidden"){document.documentElement.setAttribute(${JSON.stringify(FLEET_STRIP_ATTRIBUTE)},"hidden");}`,
    "}catch(e){}})()",
  ].join("");
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
