"use client";

import type { ReactNode } from "react";
import { AddAgentForm } from "../../_components/add-agent-form";
import { useHost } from "../../_data/use-view";
import { describeImportUnavailable } from "../../../lib/copy/host";

/**
 * Add agent (MAR-428).
 *
 * The order on this page is the issue's whole point. Importing a manifest used
 * to be *the* way to add an agent; it is now the fallback, and it is behind a
 * disclosure that says who it is for. What leads is two commands that end with
 * DASH asking a question — no manifest located, no JSON transcribed, no file
 * picker.
 *
 * The import path is kept rather than removed. "Keep developer import as a
 * fallback, not the novice path" is an explicit scope line, and it is the only
 * way in for an agent that was not built with the Agent Kit — including every
 * agent that already exists.
 *
 * MAR-432 added the one honest caveat: that fallback posts to a route which only
 * exists while DASH runs from its source folder, so the installed app says so
 * instead of showing a form that would fail on submit.
 */
export default function AddAgentPage(): ReactNode {
  const host = useHost();
  const unavailable = host === null ? null : describeImportUnavailable(host);

  return (
    <>
      <h1>Add agent</h1>
      <p className="lede">
        The quickest way to see DASH working is to make an agent. It takes two
        commands and needs no accounts, no passwords and no configuration.
      </p>

      <div className="section">
        <h2>Make one</h2>
        <pre>
          <code>
            {"npx create-dash-agent my-first-agent\n"}
            {"cd my-first-agent\n"}
            {"npm run open-in-dash\n"}
          </code>
        </pre>
        <p>
          DASH comes to the front and asks whether to add it. Say yes and it
          starts running — and it keeps running when you close this window.
        </p>
        <p className="muted">
          Nothing is added until you say yes, and DASH tells you what it will
          run before it runs anything.
        </p>
      </div>

      <div className="section">
        <details>
          <summary>I already have an agent&rsquo;s manifest file</summary>
          {unavailable === null ? (
            <>
              <p className="muted">
                For agents that were not built with the Agent Kit. DASH reads
                what the agent plans to do and what it needs to connect to. It
                does not run the agent this way, and it does not take custody of
                any credentials.
              </p>
              {/* Rendered only once the host is known, so the installed app
                  never shows a form for one frame before withdrawing it. */}
              {host === null ? null : <AddAgentForm />}
            </>
          ) : (
            <>
              <p className="muted">{unavailable.headline}</p>
              <p className="muted">{unavailable.meaning}</p>
            </>
          )}
        </details>
      </div>
    </>
  );
}
