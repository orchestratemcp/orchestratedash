import type { ReactNode } from "react";

import { EXPORTS_PANEL_COPY as COPY } from "../../lib/copy/artifacts";
import type { AgentExportView } from "../../lib/views/types";

/**
 * The documents DASH has saved for this agent (MAR-697).
 *
 * Henrik, after the first real brief export: *"create a little component where
 * the latest pdfs etc is listed with a clickable link."* This is that, and it
 * is the second half of a pair — the first half took the save dialog away, and
 * a file saved somewhere the person did not choose needs somewhere on screen
 * that says where it went.
 *
 * ## Why it is here rather than inside the author's panel (ADR 0008)
 *
 * The panel is the author's region and DASH does not write in it. This list is
 * DASH's own record in the strongest available sense: nothing but DASH can put
 * a file in the folder it reads — no agent, no runner, no adapter — so the
 * author could not have contributed an entry even in principle. It renders on
 * the Output stage above `AgentPanel`, which is the same ordering the stage
 * already keeps: DASH's account of the outputs first, somebody else's box
 * below it.
 *
 * ## A list and not a card each
 *
 * `OutputsPanel` above it draws one output in full because that is the thing
 * the person came to read. These are files they have already read and are
 * coming back for, so the useful shape is a short index — a name, when it was
 * saved, how big it is — which is also what keeps this a *little* component
 * beneath a briefing rather than a second panel competing with it.
 *
 * ## Absent, not empty, when there is nothing to say
 *
 * The heading appears only once something has been saved, which is the
 * opposite of the rule `OutputsPanel` follows next door and deliberately so.
 * There, a missing panel would leave a person unable to tell "this run made
 * nothing" from "DASH is not showing me what it made". Here there is no such
 * ambiguity to resolve: nobody wonders where their saved files went before they
 * have saved one, and a permanent empty box under every briefing would be a
 * standing advertisement for a button three inches above it. `empty` exists in
 * the copy for the surface that asks for it explicitly.
 */
export function ExportsList({
  exports,
  onOpen,
  emptyState = false,
}: {
  exports: readonly AgentExportView[];
  /**
   * Open one of them, or absent (MAR-697).
   *
   * Absent means the window cannot act — a browser tab, or a shell older than
   * the command — and the name is then rendered as **text rather than as a dead
   * link**. `OutputsPanel`'s rule about its Download button, and `LinkOut`'s
   * about an address DASH will not open: a link that does nothing when pressed
   * is the defect MAR-698 was filed on, and shipping one here under a fix for
   * it would be careless.
   */
  onOpen?: (entry: AgentExportView) => void;
  /** Draw the heading and a sentence when there is nothing, for a caller that wants one. */
  emptyState?: boolean;
}): ReactNode {
  if (exports.length === 0 && !emptyState) {
    return null;
  }

  return (
    <section className="section agent-exports" aria-labelledby="agent-exports-heading">
      <div className="section-heading">
        <h2 id="agent-exports-heading">{COPY.heading}</h2>
      </div>

      {exports.length === 0 ? (
        <p className="muted">{COPY.empty}</p>
      ) : (
        <ul className="export-list">
          {exports.map((entry) => (
            <li className="export-row" key={entry.file}>
              {onOpen === undefined ? (
                <span className="export-name">{entry.label}</span>
              ) : (
                /* A `button` and not an `a`, because there is no address here.
                   `LinkOut` next door wraps a real `href` a browser could
                   follow on its own; this one names a file on this computer,
                   which only main can open — so an anchor would be a promise
                   the markup cannot keep. It is styled as a link because that
                   is what it does. */
                <button
                  className="export-name export-open"
                  onClick={() => onOpen(entry)}
                  type="button"
                >
                  {entry.label}
                </button>
              )}
              {/* When and how big, in DASH's words — both already sentences by
                  the time they reach here. Two facts rather than four: this is
                  an index of files a person is coming back for, and the full
                  provenance of what they were made from is on the card above. */}
              <span className="export-facts muted">
                {entry.when}
                {" · "}
                {entry.size}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
