"use client";

import type { ReactNode } from "react";
import { AddAgentForm } from "../../_components/add-agent-form";
import { ChooseFolder } from "../../_components/choose-folder";
import { useCanAct, useHost } from "../../_data/use-view";
import { CHOOSE_FOLDER_COPY } from "../../../lib/copy/add-agent";
import { describeImportUnavailable } from "../../../lib/copy/host";

/**
 * Add agent (MAR-428, rewritten by MAR-598).
 *
 * ## What changed, and why the order is the whole page
 *
 * MAR-428 put two terminal commands at the top of this page, and it had a
 * reason: an agent that arrives through `open-in-dash` needs no file picker, no
 * located manifest and no transcribed JSON, which was a real improvement on the
 * `curl` it replaced. What it missed is who is standing here. Henrik, looking at
 * it: *"I dont understand the ADD agent page… I dont get the commands or
 * anything?"* A flow that needs a terminal is broken by DASH's own standing
 * rule, and this page was the last one still leading with one.
 *
 * So the order inverts. **Choosing a folder is the page**; the two commands stay
 * — they are the only way to make an agent that does not exist yet — behind a
 * disclosure that says who they are for, exactly as the manifest form has been
 * behind one since MAR-428. Nothing is removed, and every one of the three doors
 * ends at the same import and the same consent question.
 *
 * ## Why there is no listing of existing agents here
 *
 * Because there never was one on this page. The "2 agents · Open …" text
 * MAR-598 asks to remove is `FleetStrip`, DASH's own band along the bottom of
 * *every* window (MAR-503) — a deliberate, app-wide, dismissible piece of chrome
 * rather than something this page renders. Removing it here would mean removing
 * it everywhere, which is a different issue about a different component. This
 * page adds no listing of its own, which is the part that was in its gift.
 */
export default function AddAgentPage(): ReactNode {
  const host = useHost();
  const canAct = useCanAct();
  const unavailable = host === null ? null : describeImportUnavailable(host);

  return (
    <>
      <h1>{CHOOSE_FOLDER_COPY.heading}</h1>
      <p className="lede">{CHOOSE_FOLDER_COPY.lede}</p>

      {/*
        Rendered only once the host is known, so neither the button nor the
        sentence that replaces it appears for one frame before the other does —
        `AddAgentForm` is withheld below for the same reason.
      */}
      {host === null ? null : <ChooseFolder canAct={canAct} />}

      <div className="section">
        <details>
          <summary>{CHOOSE_FOLDER_COPY.scaffold_summary}</summary>
          <p className="muted wrap">{CHOOSE_FOLDER_COPY.scaffold_detail}</p>
          {/*
            Verbatim from MAR-428, including `open-in-dash`, because this is the
            one audience for whom a command is the right affordance and the
            shortest path. What moved is where it sits, not what it says.
          */}
          <pre>
            <code>
              {"npx create-dash-agent my-first-agent\n"}
              {"cd my-first-agent\n"}
              {"npm run open-in-dash\n"}
            </code>
          </pre>
          <p className="muted wrap">
            DASH comes to the front and asks whether to add it. Say yes and it
            starts running, and it keeps running when you close this window.
          </p>
        </details>
      </div>

      <div className="section">
        <details>
          <summary>{CHOOSE_FOLDER_COPY.manifest_summary}</summary>
          {unavailable === null ? (
            <>
              <p className="muted wrap">
                For agents that were not built with the Agent Kit and have no
                folder to point at. DASH reads what the agent plans to do and
                what it needs to connect to. It does not run the agent this way,
                and it does not take custody of any credentials.
              </p>
              {/* Rendered only once the host is known, so the installed app
                  never shows a form for one frame before withdrawing it. */}
              {host === null ? null : <AddAgentForm />}
            </>
          ) : (
            <>
              <p className="muted wrap">{unavailable.headline}</p>
              <p className="muted wrap">{unavailable.meaning}</p>
            </>
          )}
        </details>
      </div>
    </>
  );
}
