import type { ReactNode } from "react";

import { AGENT_TELEMETRY_COPY } from "../../lib/copy/agent-page";
import type { AgentTelemetryView } from "../../lib/views/agent-feed";

/**
 * Numbers one run actually reported (MAR-635, MAR-547).
 *
 * Renders nothing when there is nothing to say. A panel of zeros on an agent
 * that has never posted `tokens_in` or `cost_usd` would be a meter the store
 * cannot back, which is the exact fiction the concept-art pass refused.
 *
 * The sparkline is a row of bars whose heights follow recorded step values.
 * It is a chart of facts, not motion: nothing here animates.
 */
export function AgentTelemetry({
  telemetry,
}: {
  telemetry: AgentTelemetryView;
}): ReactNode {
  if (telemetry.meters.length === 0 && telemetry.sparkline === null) {
    return null;
  }

  const peak = telemetry.sparkline?.bars.reduce(
    (highest, bar) => (bar.value > highest ? bar.value : highest),
    0,
  );

  return (
    <section className="section agent-telemetry" aria-labelledby="agent-telemetry-heading">
      <div className="section-heading">
        <h2 id="agent-telemetry-heading">{AGENT_TELEMETRY_COPY.heading}</h2>
      </div>
      {telemetry.meters.length === 0 ? null : (
        <dl className="telemetry-meters">
          {telemetry.meters.map((meter) => (
            <div className="telemetry-meter" key={meter.label}>
              <dt>{meter.label}</dt>
              <dd className={meter.mono === true ? "value" : undefined}>{meter.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {telemetry.sparkline === null || peak === undefined || peak <= 0 ? null : (
        <div className="telemetry-spark">
          <p className="telemetry-spark-label">{telemetry.sparkline.label}</p>
          <ol className="telemetry-spark-bars" aria-label={telemetry.sparkline.label}>
            {telemetry.sparkline.bars.map((bar, index) => (
              <li
                key={`${bar.label}:${String(index)}`}
                style={{ height: `${String(Math.max(8, Math.round((bar.value / peak) * 100)))}%` }}
                title={bar.label}
              >
                <span className="visually-hidden">{bar.label}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {telemetry.meters.some((meter) => meter.label === AGENT_TELEMETRY_COPY.cost) ? (
        <p className="muted">{AGENT_TELEMETRY_COPY.cost_note}</p>
      ) : null}
    </section>
  );
}
