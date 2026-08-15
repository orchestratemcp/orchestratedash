import type { ReactNode } from "react";

import type { ArtifactCardView } from "../../lib/views/artifacts";

/**
 * One newest output in full, followed by a compact dated history (MAR-622).
 *
 * Both artifact-card renderers use this wrapper. The card itself stays theirs:
 * DASH's Outputs area keeps its actions and developer reference, while the
 * author's panel keeps both out under ADR 0008.
 *
 * ## `collapsed` is the author's panel's now, and nothing else's (MAR-646)
 *
 * The agent page passed it too, and on the cockpit's Output stage the dated
 * rows it produced were the rail's own list a second time — the same day and
 * the same title per entry, side by side on one screen. That stage draws one
 * output now and the rail is the index of them, so `OutputsPanel` reaches this
 * wrapper only for the run detail page's flat list.
 *
 * The author's panel keeps both halves, and that is ADR 0008 rather than an
 * inconsistency: a panel is a region somebody else declared, inside a stage,
 * with no rail indexing *it*. The rail indexes DASH's own record of the
 * artifacts, which is the section above it.
 *
 * The `openId` this took with MAR-641 went with the same change. Which card is
 * open is a property of a *list*, and the surface that had to choose no longer
 * draws one — `OutputsPanel` resolves the id where the single card is chosen.
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
