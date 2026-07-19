import type { ReactNode } from "react";
import type { ConnectionRequirementRow } from "../../lib/connections";
import { groupByOwnership } from "../../lib/connections";

/**
 * The Connection Center checklist, read-only.
 *
 * MAR-383's acceptance criterion is that a fresh user reaches a connection
 * checklist "without terminal, `.env`, component IDs or raw scopes". So this
 * renders only the plain-language fields `lib/connections.ts` produces — a
 * capability's `label`, never its `id`; a connection's `service`, never its
 * `provider` as the headline.
 *
 * Two honesty rules from MAR-383 are load-bearing here, and both are about not
 * overclaiming:
 *
 * - A **derived** row must never look like a declared one. The model-provider
 *   row is inferred from the plan's model tiers; it is labelled as inferred.
 * - **Unconfirmed ownership must read as a question, not a statement.** DASH
 *   does not know who holds the model-provider credential, so the row says so
 *   rather than asserting "the agent has this".
 *
 * No secret, and no field that could contain one, is rendered — there is
 * nothing here to redact because nothing secret reaches this layer.
 */

const OWNERSHIP_SECTIONS: Array<{
  ownership: "dash" | "agent" | "external";
  heading: string;
  lede: string;
}> = [
  {
    ownership: "dash",
    heading: "Connect through DASH",
    lede: "DASH will hold these credentials for the agent.",
  },
  {
    ownership: "agent",
    heading: "Kept with the agent",
    lede: "The agent manages these itself. DASH shows them so the list is complete, and does not take them over.",
  },
  {
    ownership: "external",
    heading: "Managed elsewhere",
    lede: "Held in an external secrets manager. DASH neither stores nor tests these.",
  },
];

function SourceChip({ row }: { row: ConnectionRequirementRow }): ReactNode {
  if (row.source === "declared_connection") {
    return (
      <span className="chip chip-ok" title="The agent's manifest declares this connection">
        declared
      </span>
    );
  }
  return (
    <span
      className="chip chip-warn"
      title="Not declared in the manifest — worked out from the steps in the agent's plan"
    >
      inferred from the plan
    </span>
  );
}

function ConnectionRow({ row }: { row: ConnectionRequirementRow }): ReactNode {
  return (
    <tr>
      <td>
        <strong>{row.service}</strong>
        {/* The user asked for a checklist, not an inventory: why it is needed
            comes before what it is called. */}
        <div className="wrap muted">{row.purpose}</div>
      </td>
      <td className="wrap">
        <ul className="capability-list">
          {row.capabilities.map((capability) => (
            <li key={capability.id}>
              {capability.label} <span className="muted">({capability.access})</span>
            </li>
          ))}
        </ul>
      </td>
      <td>
        <div className="chips">
          <SourceChip row={row} />
          {row.ownership_confirmed ? null : (
            <span
              className="chip chip-muted"
              title="Nothing in the manifest says who holds this credential"
            >
              owner unknown — DASH will ask
            </span>
          )}
          {row.requires_secret_input ? (
            <span className="chip chip-muted">needs a secret you enter</span>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

export function ConnectionChecklist({
  rows,
}: {
  rows: ConnectionRequirementRow[];
}): ReactNode {
  if (rows.length === 0) {
    return (
      <p className="muted">
        This agent&rsquo;s manifest declares no connections, and its plan needs no
        model provider.
      </p>
    );
  }

  const grouped = groupByOwnership(rows);

  return (
    <>
      {OWNERSHIP_SECTIONS.map((section) => {
        const sectionRows = grouped[section.ownership];
        // Empty sections are omitted rather than shown empty: a heading with
        // nothing under it reads as "nothing to do here yet", which is a
        // different claim from "this does not apply".
        if (sectionRows.length === 0) {
          return null;
        }
        return (
          <section key={section.ownership} className="connection-group">
            <h3>{section.heading}</h3>
            <p className="lede">{section.lede}</p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Connection</th>
                    <th>What the agent will do with it</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sectionRows.map((row) => (
                    <ConnectionRow key={row.connection_id} row={row} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}
