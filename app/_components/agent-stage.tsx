import type { ReactNode } from "react";

import { AGENT_COCKPIT_COPY } from "../../lib/copy/agent-page";
import type { AgentStage } from "../../lib/views/agent-stage";

/**
 * The one part of the cockpit that changes, and the only part that scrolls
 * (MAR-641).
 *
 * ## Why this is a component and not a switch inline in the page
 *
 * Two things are true of the stage that are not true of its contents, and both
 * belong to the container rather than to any view inside it:
 *
 * 1. **It is the scroller.** The frame does not move — that is the whole design
 *    — so exactly one element inside it has `overflow-y: auto`, and putting the
 *    class on a `<div>` per stage would be six chances to forget it.
 * 2. **It is announced.** A person moving from Output to Logs has moved to a
 *    new region of the same page without the page changing, and a screen reader
 *    has nothing to say about that unless the region is named. So the label is
 *    the *stage's* name from `AGENT_COCKPIT_COPY.stage` rather than whatever
 *    heading happens to be first inside it.
 *
 * ## One stage renders; the others do not exist
 *
 * `views` is a record rather than six props with five nulls, so a new stage is
 * a compile error here until it is given a view — and only the value under the
 * current key is read, which means the stages that are not showing are not in
 * the document at all. That matters beyond tidiness: a hidden `<details>` still
 * has layout boxes and a hidden heading is still in the markup, so five
 * stashed-but-rendered stages would put five `<h2>`s, five empty states and
 * five duplicate ids on every page a copy sweep or a geometry check looks at.
 */
export function AgentStageView({
  stage,
  views,
}: {
  stage: AgentStage;
  views: Record<AgentStage, ReactNode>;
}): ReactNode {
  return (
    <div
      className={`cockpit-stage is-${stage}`}
      /* `id` so the chrome's skip link and the fragment effect have somewhere
         to land, and `tabIndex={-1}` so moving focus here on a stage change is
         possible for the keyboard work this slice does not yet do. */
      id="agent-stage"
      role="region"
      aria-label={AGENT_COCKPIT_COPY.stage[stage]}
      tabIndex={-1}
    >
      {views[stage]}
    </div>
  );
}
