"use client";

import type { ReactNode } from "react";

/**
 * The four questions an agent page should answer before you read anything
 * (MAR-609), as tiles.
 *
 * ## MAR-570's move, applied to the second surface it fits
 *
 * Connections had the identical complaint in Henrik's identical words —
 * *"cluttered and a lot of text"* — and the fix was to put the *answer* on a
 * tile and the paperwork behind one click. This page had the same disease in a
 * worse form: the answers to "what is it doing", "when does it start", "what
 * model", "where does it run" were spread across a definition list two thirds
 * of the way down (`workspace-overview`), a section that only rendered with a
 * snapshot, a `ModelChoice` panel, and a deploy panel. Four questions, four
 * places, none of them above the fold.
 *
 * So: four tiles, in a row, under the header. Each is a label and a value and
 * nothing else — no sentence explaining the tile, which is the specific thing
 * the old page did everywhere and the reason it read as a wall.
 *
 * ## Why the tiles are not links
 *
 * MAR-570's tiles carry an action because a connector tile is *about* an action
 * — you connect a service. These are about state. The receipt for all four is
 * the one disclosure below them (`AGENT_TILE_COPY.details_summary`), and the
 * two that are settings — the model, the trigger — are changed in the settings
 * drawer, which the header has a button for. A tile that navigated somewhere
 * would be a fifth route to a setting that already has two.
 */
export interface AgentTile {
  label: string;
  /**
   * The answer, already worded. A tile never composes its own copy — every
   * value here is produced by the view that owns the fact.
   */
  value: string;
  /**
   * Whether the value is a DASH-internal value rather than prose, and so wants
   * the monospace face (MAR-420's rule). True for a model id; false for
   * "On command".
   */
  mono?: boolean;
}

export function AgentTiles({ tiles }: { tiles: AgentTile[] }): ReactNode {
  return (
    <dl className="agent-tiles">
      {tiles.map((tile) => (
        <div className="agent-tile" key={tile.label}>
          <dt>{tile.label}</dt>
          <dd className={tile.mono === true ? "value" : undefined}>{tile.value}</dd>
        </div>
      ))}
    </dl>
  );
}
