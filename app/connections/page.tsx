import type { ReactNode } from "react";
import { ConnectionChecklist } from "../_components/connection-checklist";
import { deriveConnectionRequirements } from "../../lib/connections";
import { listAgents, listConnectionCapableAgents, readStore } from "../../lib/store";

export const dynamic = "force-dynamic";

/**
 * The Connection Center, read-only for now.
 *
 * This slice answers "what does this agent need to be connected to, and who
 * holds each one?" — the checklist MAR-383 puts at the end of the first-install
 * journey. Connecting, testing and reconnecting are later phases; nothing here
 * accepts a credential, and the page has no inputs at all.
 *
 * It is deliberately honest about its own gaps: v1 agents get an explanation
 * rather than an empty checklist, because "declares no connections" and "is too
 * old to declare any" are different facts.
 */
export default function ConnectionsPage(): ReactNode {
  const store = readStore();
  const agents = listConnectionCapableAgents(store);
  const olderAgents = listAgents(store).filter((agent) => agent.manifest_version === 1);

  return (
    <>
      <h1>Connections</h1>
      <p className="lede">
        What each imported agent needs to be connected to, taken from its
        manifest. DASH does not hold any of these credentials yet.
      </p>

      {agents.length === 0 ? (
        <div className="empty">
          <p>
            No agent with declared connections has been imported. Connection
            requirements come from a v2 manifest&rsquo;s Agent DOM block.
          </p>
          <p>
            <a href="/agents/add">Add an agent</a> to see what it needs to
            connect to.
          </p>
        </div>
      ) : (
        agents.map(({ name, manifest }) => (
          <section key={name} className="agent-connections">
            <h2>
              <code>{name}</code>
            </h2>
            <ConnectionChecklist rows={deriveConnectionRequirements(manifest)} />
          </section>
        ))
      )}

      {olderAgents.length > 0 ? (
        <p className="muted">
          {olderAgents.length === 1
            ? "1 imported agent uses"
            : `${olderAgents.length} imported agents use`}{" "}
          a v1 manifest, which cannot declare connections:{" "}
          {olderAgents.map((agent) => agent.name).join(", ")}. DASH does not
          guess what they need.
        </p>
      ) : null}
    </>
  );
}
