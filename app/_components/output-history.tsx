import type { ReactNode } from "react";

import { groupCardsByRun, type ArtifactCardView } from "../../lib/views/artifacts";

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
  /*
   * MAR-875. One run's outputs stay together.
   *
   * A run that produces a digest and a briefing written from it put two
   * entries in this list a line apart with nothing saying they were one piece
   * of work — the same defect the rail had, in the surface the rail is the
   * index of. `groupCardsByRun` keeps the order and adds only the boundary.
   *
   * The group's day is drawn **only when there is more than one group**, for
   * the reason the rail's is: the run detail page shows one run's outputs, so
   * a caption there would be a date above a list that has exactly one date.
   * That also keeps that page's markup unchanged, which is what
   * `tests/outputs-render.test.tsx` has always pinned.
   */
  const groups = groupCardsByRun(cards);

  return (
    <ol className="output-list">
      {groups.map((group, at) => (
        <li className="output-run-group" key={group.run_id}>
          {/* Once per day rather than once per run — an agent run four times on
              one day would otherwise carry the same date four times. See the
              rail, which makes the same call for the same reason. */}
          {groups.length === 1 || groups[at - 1]?.day === group.day ? null : (
            <p className="eyebrow output-run-day">{group.day}</p>
          )}
          <ol className="output-list output-run-outputs">
            {group.cards.map((card, within) => {
              /* The index in the flat list, so "the newest card is open" stays
                 one card on the whole history rather than one per run. */
              const index = group.from + within;
              return (
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
              );
            })}
          </ol>
        </li>
      ))}
    </ol>
  );
}
