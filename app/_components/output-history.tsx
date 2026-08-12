import type { ReactNode } from "react";

import type { ArtifactCardView } from "../../lib/views/artifacts";

/**
 * One newest output in full, followed by a compact dated history (MAR-622).
 *
 * Both artifact-card renderers use this wrapper. The card itself stays theirs:
 * DASH's Outputs area keeps its actions and developer reference, while the
 * author's panel keeps both out under ADR 0008.
 */
export function OutputHistory({
  cards,
  collapsed,
  renderCard,
}: {
  cards: readonly ArtifactCardView[];
  collapsed: boolean;
  renderCard: (card: ArtifactCardView, index: number) => ReactNode;
}): ReactNode {
  return (
    <ol className="output-list">
      {cards.map((card, index) => (
        <li key={`${card.reference.run_id}:${card.reference.artifact_id}`}>
          {!collapsed || index === 0 ? (
            renderCard(card, index)
          ) : (
            <details className="output-history-entry">
              <summary>
                <span className="output-history-day">{card.history_day}</span>
                <span className="output-history-title">{card.artifact.title}</span>
              </summary>
              <div className="output-history-content">{renderCard(card, index)}</div>
            </details>
          )}
        </li>
      ))}
    </ol>
  );
}
