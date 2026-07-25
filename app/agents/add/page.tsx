import type { ReactNode } from "react";
import { AddAgentForm } from "../../_components/add-agent-form";

export const dynamic = "force-dynamic";

export default function AddAgentPage(): ReactNode {
  return (
    <>
      <h1>Add agent</h1>
      <p className="lede">
        Import the <code>agent.manifest.json</code> that OrchestrateKit exported.
        DASH reads what the agent plans to do and what it needs to connect to —
        it does not run the agent, and it does not take custody of any
        credentials.
      </p>
      <AddAgentForm />
    </>
  );
}
