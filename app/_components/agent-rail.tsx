import Link from "next/link";
import type { ReactNode } from "react";

import { AGENT_COCKPIT_COPY } from "../../lib/copy/agent-page";
import type { ArtifactCardView } from "../../lib/views/artifacts";
import type { InboxItem } from "../../lib/workspace";
import { agentStageHref } from "../_data/routes";

/**
 * The two things about an agent that are worth having on screen whatever else
 * you are looking at (MAR-641).
 *
 * ## Why these two and nothing else
 *
 * The wireframe's rail is *Latest output* and *Action needed*, and both earn
 * the permanent space for the same reason: they are the only parts of an agent
 * that are about **you**. Everything else on this page — the feed, the
 * telemetry, the settings, the record — is about the agent, and is therefore
 * something you go and look at rather than something that should follow you
 * from stage to stage.
 *
 * ## Titles only, on purpose
 *
 * A rail that rendered output bodies would be a second, narrower Output stage
 * competing with the real one. So each entry is the title and the day, and
 * pressing it opens that output *in the stage* while the list stays where it
 * is — the wireframe's own sentence, and the reason the entries are links
 * carrying `?stage=output&output=…` rather than buttons holding local state.
 *
 * ## The action-needed panel points; it does not decide
 *
 * This is the one place this rail deviates from the wireframe, and the reason
 * is the shape of the decision rather than the width of the column. An approval
 * in DASH is granted against an **exact action**: `InboxControl` renders what
 * approval permits, its context rows and the sentence saying the runner will
 * recheck the target before performing anything, and Approve is worded *Approve
 * exact action* because of it. A pair of buttons in a 300px rail either carries
 * all of that — at which point the rail is the stage — or grants a consequence
 * from a summary, which is the one thing a consent surface may not do.
 *
 * So the rail names what is waiting and takes you to it. The controls are on
 * the Overview stage, under `#waiting-work`, which is also where MAR-586's
 * fleet chip has always pointed.
 *
 * ## A count and a title, and nothing the destination also says (MAR-646)
 *
 * The pointer-and-destination split is the right one, and it is only right
 * while the two do not read as the same block twice. Each row carried the kind
 * — *Guarded action*, *Choice* — above the title, and the card it opens carries
 * the same word in its own eyebrow beside the expiry, so a person looking at
 * this page saw the vocabulary of a decision in two places and the decision in
 * one.
 *
 * The kind belongs to the card, where it sits with the expiry and the effect
 * preview that make it mean something. What the rail gains instead is the fact
 * only an index has: **how many**. A count is not something the stage can say —
 * the stage is the queue itself — so it is the one addition in a packet whose
 * job is subtraction.
 */
export function AgentRail({
  agent,
  inbox,
  openId,
  outputs,
}: {
  agent: string;
  /** Choices and approvals waiting on a person. Empty draws nothing at all. */
  inbox: readonly InboxItem[];
  /** The output the stage is showing, so the rail can mark it. */
  openId: string | null;
  /** Newest first, the same list the Output stage draws in full. */
  outputs: readonly ArtifactCardView[];
}): ReactNode {
  return (
    <aside className="cockpit-rail" aria-label={AGENT_COCKPIT_COPY.rail_label}>
      <section className="cockpit-rail-panel" aria-labelledby="rail-outputs">
        <h2 id="rail-outputs">{AGENT_COCKPIT_COPY.outputs_heading}</h2>
        {outputs.length === 0 ? (
          /* One short sentence rather than nothing. A rail panel that vanished
             would leave a reader unable to tell "nothing was made" from "the
             rail is broken" — `app/_components/outputs.tsx` makes the same
             argument about the same fact at full width. */
          <p className="muted">{AGENT_COCKPIT_COPY.outputs_empty}</p>
        ) : (
          <ol className="rail-output-list">
            {outputs.map((card, index) => {
              const id = card.reference.artifact_id;
              /*
               * The accent edge marks the **newest**, and the wireframe asks for
               * it to pair with `ready_for_review`.
               *
               * It cannot be an unread mark here, and that is a fact about this
               * page rather than a shortcut: MAR-586 stamps a look the moment
               * this page opens, so "new since you last opened this agent" —
               * which is what `new_output` means on a fleet card — is answered
               * by arriving. A mark that erased itself as it was drawn would be
               * a claim nobody could ever check. Newest is the honest half, and
               * it is the entry `ready_for_review` is about.
               */
              const newest = index === 0;
              const open = openId === null ? newest : openId === id;
              const classes = ["rail-output"];
              if (newest) classes.push("is-newest");
              if (open) classes.push("is-open");
              return (
                <li className={classes.join(" ")} key={`${card.reference.run_id}:${id}`}>
                  <Link
                    aria-current={open ? "true" : undefined}
                    href={agentStageHref(agent, "output", { output: id })}
                  >
                    <span className="rail-output-title">{card.artifact.title}</span>
                    <span className="rail-output-when muted">{card.history_day}</span>
                    {newest ? (
                      <span className="visually-hidden">
                        . {AGENT_COCKPIT_COPY.outputs_newest}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* Nothing at all when the queue is empty, which is the ordinary state.
          MAR-609's rule: the old page drew a heading and a sentence saying
          there was nothing under it, on every agent, forever. */}
      {inbox.length === 0 ? null : (
        <section className="cockpit-rail-panel cockpit-rail-work" aria-labelledby="rail-work">
          <h2 id="rail-work">
            {AGENT_COCKPIT_COPY.work_heading}
            {/* Inside the heading rather than beside it, so the number is part
                of what a screen reader announces for the panel rather than a
                digit floating next to it with no relationship stated. */}
            <span className="rail-count">{inbox.length}</span>
          </h2>
          <ol className="rail-work-list">
            {inbox.map((item) => (
              <li className={item.expired ? "rail-work-item is-expired" : "rail-work-item"} key={item.id}>
                {/* Straight to the decision itself rather than to the top of
                    the stage. The Overview stage gives every waiting item an
                    id, and the page's fragment effect scrolls to it once the
                    view has arrived — the same machinery MAR-586 built so a
                    fleet chip could land on the thing that needs you. */}
                <Link href={`${agentStageHref(agent, "overview")}#work-${item.id}`}>
                  <span className="rail-work-label">{item.task_label}</span>
                  <span className="visually-hidden">. {AGENT_COCKPIT_COPY.work_open}</span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}
    </aside>
  );
}
