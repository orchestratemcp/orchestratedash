import Link from "next/link";
import type { ReactNode } from "react";

import { AGENT_FEED_COPY } from "../../lib/copy/agent-page";
import type { AgentFeedView } from "../../lib/views/agent-feed";

/**
 * Timestamped lines from one run's telemetry (MAR-635).
 *
 * This is the mockup's live output feed. The records already exist — telemetry
 * v1 posts a line per step — and the page already follows a run in flight.
 * What was missing was drawing them here rather than only on the run detail
 * page as raw event types.
 *
 * Empty is two short sentences, not a fake terminal. A blinking cursor on an
 * agent that has never run would be the fiction layer MAR-547 refused.
 */
export function LiveFeed({
  feed,
  runHref,
}: {
  feed: AgentFeedView;
  /** Where the producing run lives, or absent when there is no run. */
  runHref?: string;
}): ReactNode {
  return (
    <section className="section live-feed" aria-labelledby="live-feed-heading">
      <div className="section-heading">
        <h2 id="live-feed-heading">{AGENT_FEED_COPY.heading}</h2>
        {feed.kind === "empty" || runHref === undefined ? null : (
          <Link className="output-run-link" href={runHref}>
            {AGENT_FEED_COPY.open_run}
          </Link>
        )}
      </div>
      {feed.kind === "empty" ? (
        <div className="empty">
          <p>
            <strong>{AGENT_FEED_COPY.empty_headline}</strong>
          </p>
          <p>{AGENT_FEED_COPY.empty_detail}</p>
        </div>
      ) : (
        <ol
          aria-live={feed.kind === "live" ? "polite" : undefined}
          className="live-feed-list"
        >
          {feed.lines.map((line) => (
            <li className={`live-feed-line is-${line.tone}`} key={line.seq}>
              <span className="live-feed-clock">
                {line.clock === null ? "" : line.clock}
              </span>
              <span className="live-feed-body">
                <span className="live-feed-verb">{line.verb}</span>
                {line.detail === null ? null : (
                  <span className="live-feed-detail">{line.detail}</span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
