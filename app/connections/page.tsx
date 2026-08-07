"use client";

import { useState, type ReactNode } from "react";

import { BrokerLapseNotice, ConnectionCards } from "../_components/connection-card";
import { OAvatar } from "../_components/o-avatar";
import { HostNotice, ViewFailed, ViewLoading } from "../_components/view-state";
import { submitConnectionCommand } from "../_data/source";
import { useHost, useView } from "../_data/use-view";
import { summarisePage } from "../../lib/connection-card";

/**
 * The Connections page (MAR-533).
 *
 * Henrik, 2026-08-07: *"the current connection page makes no sense to me right
 * now."* This is the rebuild, and what it changes is the question the page is
 * answering rather than how that answer is dressed.
 *
 * The page it replaces was MAR-383's **checklist**: what does each agent still
 * need connecting, grouped by who holds the credential. That was the right page
 * during a first install and it is the wrong page ever afterwards — it opens on
 * an inventory sorted by a distinction the reader has no reason to care about,
 * with the permission card, which is the actual content, three scrolls down and
 * underneath the buttons.
 *
 * Each connection is now one card answering, in order: **what can this reach, on
 * whose account, since when, and what has it actually been used for** — with the
 * receipt one click away. See `lib/connection-card.ts` for the model and
 * `app/_components/connection-card.tsx` for the card.
 *
 * ## The test this page is written against
 *
 * *Could someone who has never heard of OAuth look at this and say what DASH is
 * allowed to do?*
 *
 * Which is why the summary line at the top counts rather than reassures, why the
 * three-party intersection is drawn on every brokered card, and why a connection
 * DASH is **not** in the middle of gets the same headings with the answers
 * missing. A page where only the brokered cards had a "what has it been used
 * for" section would let a reader assume the others simply had not been used.
 *
 * ## Still no credential input here
 *
 * Unchanged and load-bearing. Connect opens a window main owns with its own
 * preload; the value goes from that window to the operating system's vault
 * without passing through this page. What this page sends is three ids, and what
 * it gets back is a state, a masked hint and a sentence.
 */
export default function ConnectionsPage(): ReactNode {
  // Bumped after any command that changed something, so the page re-reads the
  // view rather than trusting its own optimistic idea of what happened. The
  // cards carry masked hints from the store, and the store is the thing that
  // just changed.
  const [revision, setRevision] = useState(0);
  const state = useView((source) => source.connections(), revision);
  const host = useHost();

  return (
    <>
      <h1>Connections</h1>
      <p className="lede">
        What your agents can reach outside this computer, and what DASH can prove
        about it. Anything DASH holds is kept in this computer&rsquo;s credential
        vault.
      </p>
      <HostNotice host={host} />

      {state.status === "loading" ? (
        <ViewLoading what="what your agents can reach" />
      ) : state.status === "failed" ? (
        <ViewFailed recovery={state.recovery} />
      ) : (
        <>
          {state.data.agents.length === 0 ? (
            <div className="empty">
              <p>
                No agent here has asked to reach anything outside this computer.
              </p>
              <p>
                <a href="/agents/add">Add an agent</a> to see what it would need.
              </p>
            </div>
          ) : (
            <>
              {/*
                The page's thesis, counted rather than asserted. Both numbers come
                from `classifyProof`, so this line cannot drift from the cards
                under it — which is the failure mode of every hand-written summary
                that has ever sat at the top of a list.
              */}
              <p className="page-summary wrap">
                {summarisePage(state.data.agents.flatMap((agent) => agent.rows))}
              </p>

              {state.data.agents.map(({ name, avatar, rows, lapses }) => (
                <section key={name} className="agent-connections">
                  {/*
                    The agent's own character beside its name (MAR-501's grammar,
                    a fourth surface). This page is a list of *somebody's* agents
                    and it used to head each group with a bare code element — and
                    the whole question underneath is "what is this one allowed to
                    touch", which is the question a character is there to make
                    concrete.

                    `avatar` is the stored value and nothing here chooses it; a
                    null draws nothing rather than a guess.
                  */}
                  <div className="agent-identity">
                    {avatar === null ? null : <OAvatar name={avatar} size={50} />}
                    <div>
                      <h2>{name}</h2>
                    </div>
                  </div>
                  {/* MAR-467, above the cards rather than below them: somebody who
                      opened this page because an agent did less than they expected
                      is looking for exactly this, and burying it under the cards
                      would reproduce the empty-history problem one scroll lower.
                      It is a one-line disclosure now rather than an open wall of
                      machine timestamps. */}
                  <BrokerLapseNotice lapses={lapses} />
                  <ConnectionCards
                    rows={rows}
                    act={async (action, target) => {
                      const result = await submitConnectionCommand(action, {
                        agent_id: name,
                        ...target,
                      });
                      if (result.ok) {
                        setRevision((current) => current + 1);
                      }
                      return {
                        ok: result.ok,
                        detail: result.detail,
                        recovery: result.recovery,
                      };
                    }}
                  />
                </section>
              ))}
            </>
          )}

          {state.data.older_agent_names.length > 0 ? (
            <p className="muted wrap">
              {state.data.older_agent_names.length === 1
                ? "1 agent here was added in an older format that cannot say what it needs to reach"
                : `${state.data.older_agent_names.length} agents here were added in an older format that cannot say what they need to reach`}
              : {state.data.older_agent_names.join(", ")}. DASH does not guess.
            </p>
          ) : null}
        </>
      )}
    </>
  );
}
