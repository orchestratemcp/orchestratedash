import type { ReactNode } from "react";
import type { ManagedRegistration } from "../../lib/registration";

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
 */
export function AgentOrigin({
  registration,
}: {
  registration: ManagedRegistration | undefined;
}): ReactNode {
  if (registration === undefined) {
    return <span className="muted">Watched only</span>;
  }

  if (registration.dash.owner !== "dash_handoff") {
    return <span title="DASH will not remove a registration it did not create.">Set up by hand</span>;
  }

  return (
    <span title={registration.dash.source_project ?? undefined}>
      Added through DASH
      {registration.dash.source_project === undefined ? null : (
        <>
          {" "}
          <span className="muted">from {folderName(registration.dash.source_project)}</span>
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
