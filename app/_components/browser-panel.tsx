"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import type { BrowserActionView, BrowserSessionView, BrowserView } from "../../lib/views/browser";
import { useCanAct, useLiveView } from "../_data/use-view";
import { InfoNote } from "./info-note";

/**
 * The panel, wired to the read and to the two commands (MAR-628).
 *
 * A wrapper rather than logic inside `BrowserPanel`, so the presentational half
 * stays a pure function of a `BrowserView` and `tests/browser-panel.test.tsx`
 * can drive every state — a refused declaration, a session that outlived DASH,
 * a trail full of refusals — without a bridge or a store.
 *
 * **Polled whenever this agent declares a browser at all**, and it took two
 * wrong answers to arrive at that.
 *
 * The first version polled only while it could *see* an open session — a
 * condition it could never come to see, because a session appears mid-run and a
 * panel that is not reading cannot notice one. It went on rendering its state at
 * mount, and a person watching a run watched nothing happen. The real proof run
 * photographed exactly that.
 *
 * The second polled while the page believed a run was going, which is derived
 * from the agent's own reported snapshot — so an agent that has never reported
 * one is an agent whose browser is invisible, and that is precisely the agent a
 * browser matters most for. The proof run photographed that too.
 *
 * So the condition is the one signal that is always available and always
 * correct: **does this agent ask for a browser.** An agent that does has a page
 * with something live on it; every other agent renders nothing here and polls
 * nothing, which is what keeps the rest of DASH as still as it was. The `open`
 * half remains so that a session outliving its declaration — an author removing
 * the block mid-run — still shows the browser that is on the screen.
 */
export function LiveBrowserPanel({ agent }: { agent: string }): ReactNode {
  const [live, setLive] = useState(false);
  const state = useLiveView((source) => source.browser(agent), agent, live);
  const canAct = useCanAct();

  const watchable =
    state.status === "ready" && (state.data.declared !== null || state.data.open !== null);
  useEffect(() => {
    setLive(watchable);
  }, [watchable]);

  // A failed read draws nothing. This panel is additional information about an
  // agent, not the page's subject — a window whose shell is too old to answer
  // `view.browser` should show the agent, not an error about a browser it was
  // never going to have.
  if (state.status !== "ready") {
    return null;
  }

  const bridge = typeof window === "undefined" ? undefined : window.dashShell;
  return (
    <BrowserPanel
      view={state.data}
      onStop={
        canAct && bridge?.stopBrowser !== undefined
          ? (target) => {
              void bridge.stopBrowser?.(target);
            }
          : undefined
      }
      onViewport={
        bridge?.setBrowserViewport === undefined
          ? undefined
          : (bounds) => {
              void bridge.setBrowserViewport?.(bounds);
            }
      }
    />
  );
}

/**
 * The supervision surface for the controlled browser (MAR-628, ADR 0019).
 *
 * ADR 0019 chose an Electron `WebContentsView` over Playwright for one reason,
 * and this component is that reason made visible: *"a person can watch the
 * actual page, interrupt the run, and inspect what DASH asked the browser to do
 * without changing applications."* The page itself is not in this markup and
 * cannot be — it is a native view Chromium paints over the window — so what this
 * renders is the frame around it and everything the frame has to say.
 *
 * ## The empty `<div>` is the load-bearing element
 *
 * `stage` is a placeholder, and its only job is to have a rectangle. The
 * component measures it and tells main, which moves the real view there. That
 * makes the layout the page's business and the pixels Chromium's, which is the
 * only arrangement in which the browser is genuinely inside DASH rather than
 * beside it.
 *
 * It is measured on mount, on every resize and on every scroll, because all
 * three move it and none of them tells React. A `ResizeObserver` on the element
 * catches layout changes the window does not, which is what makes the view
 * follow a sidebar opening rather than only a window being dragged.
 *
 * ## What this component may not become
 *
 * ADR 0008 bars controls from the agent panel and this is not that panel — but
 * the neighbouring rule holds here too: **there is exactly one control on this
 * surface, and it is Stop.** No address bar, no back button, no reload, no
 * "open in my browser". Each would be a person driving a session whose whole
 * evidentiary value is that DASH decided every navigation in it, and a trail
 * that could not tell an agent's request from a human's is a trail that answers
 * no question worth asking.
 */
export function BrowserPanel({
  view,
  onStop,
  onViewport,
}: {
  view: BrowserView;
  /** Absent in a window that cannot act. The button is not drawn at all. */
  onStop: ((agent: string) => void) | undefined;
  /** Absent in a window with no bridge; the view stays where main put it. */
  onViewport: ((bounds: { x: number; y: number; width: number; height: number }) => void) | undefined;
}): ReactNode {
  const stage = useRef<HTMLDivElement | null>(null);

  const report = useCallback(() => {
    const element = stage.current;
    if (element === null || onViewport === undefined) {
      return;
    }
    const rect = element.getBoundingClientRect();
    // Client coordinates, which are already relative to the window's own
    // content area — the same origin Electron's `setBounds` uses. No scroll
    // offset is added: `getBoundingClientRect` has subtracted it, and adding it
    // back is the classic way a view ends up correct at the top of a page and
    // sliding away down it.
    onViewport({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
  }, [onViewport]);

  useEffect(() => {
    // Nothing to place when there is no session: main has no view, and telling
    // it where an absent view should go would move the *next* one to wherever
    // this panel happened to be when it was not needed.
    if (view.open === null) {
      return;
    }
    report();
    const observer = new ResizeObserver(report);
    if (stage.current !== null) {
      observer.observe(stage.current);
    }
    window.addEventListener("resize", report);
    // Capturing, so a scroll inside any ancestor moves the view and not only a
    // scroll of the document. A native view that stayed put while the page
    // scrolled under it would be the most obviously broken thing on the screen.
    window.addEventListener("scroll", report, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", report);
      window.removeEventListener("scroll", report, true);
    };
  }, [report, view.open]);

  // An agent that asks for no browser gets no browser panel. A panel explaining
  // that there is nothing to explain is noise on every other agent's page.
  if (
    view.declared === null &&
    view.refused_declaration === null &&
    view.past.length === 0 &&
    view.refused_before_opening.length === 0
  ) {
    return null;
  }

  return (
    <section className="browser-panel section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Watched browser</p>
          <h2>What DASH opened for this agent</h2>
        </div>
        {view.open !== null && onStop !== undefined ? (
          <button
            type="button"
            className="button-danger"
            onClick={() => {
              onStop(view.agent);
            }}
          >
            {view.stop.label}
          </button>
        ) : null}
      </div>

      {/* The standing caveat, unconditional. It is not a fault report and does
          not become truer when something goes wrong — see `browserNotice`. */}
      <p className="browser-notice wrap">
        <strong>{view.notice.headline}.</strong> {view.notice.meaning}
      </p>

      {view.refused_declaration === null ? null : (
        <p className="empty wrap" role="alert">
          {view.refused_declaration}
        </p>
      )}

      {view.declared === null ? null : (
        <div className="browser-declared">
          {view.declared.purpose === null ? null : <p className="wrap">{view.declared.purpose}</p>}
          <ul className="origin-list">
            {view.declared.origins.map((origin) => (
              <li key={origin}>
                <code>{origin}</code>
              </li>
            ))}
          </ul>
        </div>
      )}

      {view.open === null ? null : (
        <>
          {/* The rectangle Chromium paints into. Deliberately empty: anything
              rendered here would be underneath a native view and visible only
              in the moment before it arrives. */}
          <div className="browser-stage" ref={stage} aria-hidden="true" />
          <p className="browser-stop-meaning wrap">
            {view.stop.meaning}{" "}
            <InfoNote>{view.open.reach}</InfoNote>
          </p>
        </>
      )}

      {view.open === null ? null : <SessionTrail session={view.open} open />}

      {/* MAR-628. Refusals that happened before a browser existed — an agent
          asking for an address this run was not set up for is refused before
          anything opens, so it belongs to no session and would otherwise be
          written down where nobody could see it. */}
      {view.refused_before_opening.length === 0 ? null : (
        <div className="browser-before">
          <h3>Refused before anything opened</h3>
          <ol className="browser-trail row-list">
            {view.refused_before_opening.map((action) => (
              <li key={`${action.at} ${action.what}`}>
                <TrailRow action={action} />
              </li>
            ))}
          </ol>
        </div>
      )}

      {view.past.length === 0 ? null : (
        <div className="browser-past">
          <h3>Earlier</h3>
          {view.past.map((session) => (
            <SessionTrail key={session.session_id} session={session} open={false} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * One session's actions, oldest first — the order they happened.
 *
 * Oldest first and not newest first, which is the opposite of the runs list and
 * is deliberate: this is a *sequence*, and the question a person asks of it is
 * "what did it do, and then what did it do", not "what is the latest news".
 */
function SessionTrail({
  session,
  open,
}: {
  session: BrowserSessionView;
  open: boolean;
}): ReactNode {
  return (
    <article className="browser-session row-card">
      <dl className="facts">
        <div>
          <dt>Started</dt>
          <dd>{session.opened_at}</dd>
        </div>
        {open ? null : (
          <div>
            <dt>Finished</dt>
            <dd className="wrap">{session.ended_because}</dd>
          </div>
        )}
        <div>
          <dt>Went to</dt>
          <dd>
            {session.visited_origins.length === 0 ? (
              <span className="chip chip-muted">nowhere yet</span>
            ) : (
              session.visited_origins.map((origin) => (
                <code key={origin} className="origin">
                  {origin}
                </code>
              ))
            )}
          </dd>
        </div>
        {/* The moment the read-then-reach rule started applying to the rest of
            the run. Rendered because a person asked to approve something later
            should be able to find the reason on this screen. */}
        {session.first_read_at === null ? null : (
          <div>
            <dt>Read a page at</dt>
            <dd>{session.first_read_at}</dd>
          </div>
        )}
      </dl>

      <p className="muted wrap">{session.reach}</p>
      <p className="muted wrap">{session.blocked}</p>

      <ol className="browser-trail row-list">
        {session.actions.map((action) => (
          <li key={`${action.at} ${action.what}`}>
            <TrailRow action={action} />
          </li>
        ))}
      </ol>
    </article>
  );
}

function TrailRow({ action }: { action: BrowserActionView }): ReactNode {
  return (
    <div className={action.allowed ? "browser-action" : "browser-action is-refused"}>
      <span className="browser-action-what">{action.what}</span>
      {action.allowed ? (
        <span className="chip chip-ok">done</span>
      ) : (
        <span className="chip chip-warn">refused</span>
      )}
      {action.url === null ? null : <code className="browser-action-url">{action.url}</code>}
      {action.why === null ? null : <span className="wrap browser-action-why">{action.why}</span>}
      <span className="muted browser-action-at">{action.at}</span>
    </div>
  );
}
