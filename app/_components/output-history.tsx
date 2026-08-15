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
  openId,
  renderCard,
}: {
  cards: readonly ArtifactCardView[];
  collapsed: boolean;
  /**
   * Which output is the one in full, or null for the newest (MAR-641).
   *
   * The cockpit's rail is a titles-only list whose whole promise is that
   * pressing an entry opens *that* output in the stage. This is how: the named
   * card takes the open position and every other one — including the newest —
   * becomes a dated disclosure. An id this list does not hold falls back to the
   * newest rather than opening nothing, because a link that has outlived its
   * artifact should land on the page it named rather than on an empty one.
   */
  openId?: string | null;
  renderCard: (card: ArtifactCardView, index: number) => ReactNode;
}): ReactNode {
  const named =
    openId === undefined || openId === null
      ? -1
      : cards.findIndex((card) => card.reference.artifact_id === openId);
  const open = named === -1 ? 0 : named;
  return (
    <ol className="output-list">
      {cards.map((card, index) => (
        <li key={`${card.reference.run_id}:${card.reference.artifact_id}`}>
          {!collapsed || index === open ? (
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
