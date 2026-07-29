import type { ReactNode } from "react";
import { AddAgentForm } from "../../_components/add-agent-form";

export const dynamic = "force-dynamic";

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
 */
export default function AddAgentPage(): ReactNode {
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
          <p className="muted">
            For agents that were not built with the Agent Kit. DASH reads what
            the agent plans to do and what it needs to connect to. It does not
            run the agent this way, and it does not take custody of any
            credentials.
          </p>
          <AddAgentForm />
        </details>
      </div>
    </>
  );
}
