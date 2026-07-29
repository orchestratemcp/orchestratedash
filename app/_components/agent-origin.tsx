import type { ReactNode } from "react";
import type { AgentOriginView } from "../../lib/views/types";

/**
 * Where an agent came from, said in one short phrase (MAR-428).
 *
 * "Show explicit ownership" is an acceptance criterion, and the reason it is one
 * is that removal depends on it: DASH deletes what it created and refuses to
 * touch what somebody wrote by hand. A user who cannot see which is which cannot
 * predict what "remove" will do, and a destructive action nobody can predict is
 * a destructive action nobody should be offered.
 *
 * The three states are genuinely different and are not collapsed:
 *
 * - **Added through DASH.** DASH owns the registration and can remove it.
 * - **Set up by hand.** A registration file somebody wrote. DASH reports it,
 *   supervises it, and will not delete it.
 * - **Watched only.** A manifest was imported but nothing on this computer runs
 *   it. Saying "watched only" rather than showing an empty cell is the
 *   difference between a fact and a gap.
 *
 * MAR-432 changed what this is given, not what it renders. It used to take a
 * whole `ManagedRegistration`, which was free when the page and the registration
 * shared a process and is not free now that the page is a renderer on the other
 * side of a boundary — see `AgentOriginView` for what stopped crossing it.
 */
export function AgentOrigin({ origin }: { origin: AgentOriginView }): ReactNode {
  if (origin.kind === "watched_only") {
    return <span className="muted">Watched only</span>;
  }

  if (origin.kind === "set_up_by_hand") {
    return <span title="DASH will not remove a registration it did not create.">Set up by hand</span>;
  }

  return (
    <span title={origin.source_project}>
      Added through DASH
      {origin.source_project === undefined ? null : (
        <>
          {" "}
          <span className="muted">from {folderName(origin.source_project)}</span>
        </>
      )}
    </span>
  );
}

/**
 * The last segment of a path, without importing `node:path` into a component.
 *
 * A folder name rather than a full path: the full path is on the row's `title`
 * for anyone who needs it, and a table cell holding
 * `C:\Users\someone\projects\...` is a table cell nobody can read.
 */
function folderName(directory: string): string {
  const parts = directory.split(/[\\/]/).filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? directory;
}
