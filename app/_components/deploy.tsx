"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

import {
  describeAskedAt,
  describeDeploy,
  describeNoServerForAgent,
  describeUndeployable,
  type DeployStanding,
} from "../../lib/deploy/deploying";
import { describeDeployReceipt } from "../../lib/deploy/receipt";
import { readProbeStanding, type HostConnectState } from "../../lib/host-connect";
import { describeDeployed, describeSignIn } from "../../lib/server-card";
import type { AgentDeployView, SavedServerView } from "../../lib/views/types";
import { submitHostCommand } from "../_data/source";
import { useView } from "../_data/use-view";

/**
 * Running this agent on a server, from the agent's own page (MAR-577).
 *
 * ## The half of the deploy plane that had no door
 *
 * `host.deploy` has been a real command since MAR-536 and a real bundle producer
 * since MAR-556. PR #96 gave it its first affordance — the server card's panel,
 * which asks *"which agent goes on this machine"*. This is the other direction,
 * which the issue named and nothing implemented: *"which machine does this agent
 * go on"*, asked from the page a person is already on when they decide it.
 *
 * They are the same command and deliberately not the same question. Somebody on
 * the Servers page is furnishing a machine; somebody on an agent's page has one
 * agent in mind and does not want to go and find it in a dropdown somewhere
 * else. Both end at `submitHostCommand("deploy", …)`, and neither reimplements
 * a sentence: the receipt is `lib/deploy/receipt.ts`, the progress and result
 * are `lib/deploy/deploying.ts`, and what is running on the server afterwards is
 * `describeDeployed`, which is the Servers page's own function.
 *
 * ## What this surface refuses to claim
 *
 * DASH keeps no record of what it has put where — see `lib/server-card.ts`. So
 * after a deploy this section does not say "running on My server". It asks the
 * server, renders the server's own answer, and stamps it with when the answer
 * was given. A number with no moment on it is a number that keeps looking true
 * after it stops being true.
 */

/* ---------------------------------------------------------------------- *
 * The outcome, shared by both entry points
 * ---------------------------------------------------------------------- */

/**
 * What happened, and what the server says now.
 *
 * Used by this section and by the server card's panel, so the two entry points
 * cannot come to word a failed deploy differently. `report` is the standing from
 * whatever check followed — absent while a deploy is in flight and on the
 * failure path where DASH may not have been able to ask.
 */
export function DeployOutcome({
  standing,
  report,
  checkedAt,
}: {
  standing: DeployStanding;
  report: HostConnectState | null;
  /** When the server gave `report`, or null when nothing has been asked. */
  checkedAt: string | null;
}): ReactNode {
  const copy = describeDeploy(standing);
  const asked = describeAskedAt(checkedAt);
  /*
   * The server's report belongs to a deploy that finished.
   *
   * A count from before the push, rendered under "putting it there", would be
   * DASH answering the question the person is currently waiting on with the
   * answer to the previous one. On the failure path there is no answer to give:
   * the next action sends them to ask for a fresh one.
   */
  const says = standing.step === "sent" ? report : null;
  return (
    <section
      className={standing.step === "failed" ? "notice notice-err deploy-outcome" : "deploy-outcome"}
      /*
       * A failure is announced; progress and success are polite. The brief's
       * rule is that nothing moves without saying it did, and a deploy that
       * finished while somebody was reading further down the page is exactly the
       * movement that rule is about.
       */
      role={standing.step === "failed" ? "alert" : "status"}
      aria-live={standing.step === "failed" ? undefined : "polite"}
    >
      <p className="wrap">
        <strong>{copy.headline}</strong>
      </p>
      <p className="wrap">{copy.detail}</p>
      {copy.next_action === null ? null : <p className="next-action wrap">{copy.next_action}</p>}
      {says === null ? null : (
        <p className="card-meta wrap">
          {describeDeployed(says)}
          {asked === null ? "" : ` ${asked}`}
        </p>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------------- *
 * The agent-side section
 * ---------------------------------------------------------------------- */

export function DeployToServerPanel({
  title,
  deploy,
  servers,
  chosenHost,
  standing,
  report,
  checkedAt,
  busy,
  canAct,
  onChoose,
  onDeploy,
}: {
  /** The agent's own display name, as the page's heading shows it. */
  title: string;
  deploy: AgentDeployView;
  servers: readonly SavedServerView[];
  chosenHost: string;
  /** Null before anything has been attempted this visit. */
  standing: DeployStanding | null;
  report: HostConnectState | null;
  checkedAt: string | null;
  busy: boolean;
  canAct: boolean;
  onChoose: (hostId: string) => void;
  onDeploy: () => void;
}): ReactNode {
  /*
   * The refusal, before a server is ever offered.
   *
   * A migrated agent has its author's document and no program — DASH could not
   * send it anywhere, and it knows that without a network. Rendering the picker
   * disabled would put the reason next to a control about *servers*, where it
   * reads as a claim that the server is the problem. So there is no control at
   * all here, which is `lib/workspace.ts`'s own rule about dead controls.
   */
  if (!deploy.deployable) {
    const copy = describeUndeployable(title, deploy.refusal ?? "");
    return (
      <section className="section deploy-section" aria-labelledby="deploy-to-server">
        <h2 id="deploy-to-server">Run this agent on your server</h2>
        <p className="wrap">
          <strong>{copy.headline}</strong>
        </p>
        <p className="wrap">{copy.detail}</p>
      </section>
    );
  }

  if (servers.length === 0) {
    /*
     * Nothing is missing, and that is the first sentence rather than a footnote.
     * An agent runs on this computer and always has; a page that framed "no
     * server" as a gap would be inventing a problem in front of a person who
     * came here to look at their agent.
     */
    const copy = describeNoServerForAgent(title);
    return (
      <section className="section deploy-section" aria-labelledby="deploy-to-server">
        <h2 id="deploy-to-server">Run this agent on your server</h2>
        <p className="wrap">
          <strong>{copy.headline}</strong>
        </p>
        <p className="wrap">{copy.detail}</p>
        <p className="next-action">
          <Link href="/hosts">{copy.next_action}</Link>
        </p>
      </section>
    );
  }

  const chosen = servers.find((server) => server.host_id === chosenHost) ?? servers[0];
  // `servers.length` is non-zero above, so this is a value. Narrowed for the
  // compiler rather than asserted, because an index access is `T | undefined`.
  if (chosen === undefined) {
    return null;
  }
  const receipt = describeDeployReceipt(title, chosen.label);

  return (
    <section className="section deploy-section" aria-labelledby="deploy-to-server">
      <h2 id="deploy-to-server">Run this agent on your server</h2>

      {/*
        More than one saved server means a choice; one means a fact. A select
        holding a single option is a control that cannot do anything, and the
        label under it already says which machine this is.
      */}
      {servers.length === 1 ? null : (
        <label className="field-label" htmlFor="deploy-host">
          Which server
          <select
            id="deploy-host"
            className="field"
            value={chosen.host_id}
            onChange={(event) => {
              onChoose(event.target.value);
            }}
          >
            {servers.map((server) => (
              <option key={server.host_id} value={server.host_id}>
                {server.label}
                {server.same_server_count > 1
                  ? ` (record ${String(server.same_server_index)} of ${String(server.same_server_count)})`
                  : ""}
              </option>
            ))}
          </select>
        </label>
      )}

      <p className="card-meta wrap">{describeSignIn(chosen)}.</p>

      {/*
        ADR 0007's receipt, before the deploy and not with it, from the same
        function the Servers page and the connect flow call. This is the named
        version — the agent is known here, so the first line can say which agent
        is about to be copied where, which is the one thing the other two
        surfaces cannot say at the moment they have to say the rest.
      */}
      <section className="deploy-receipt">
        <h3 className="label-caps">Before you put {title} on {chosen.label}</h3>
        <p className="wrap">{receipt.what}</p>
        <ul className="permission-list">
          {receipt.limits.map((limit) => (
            <li key={limit} className="wrap">
              {limit}
            </li>
          ))}
        </ul>
        <p className="disclosure wrap" role="note">
          {receipt.revocation}
        </p>
      </section>

      {standing === null ? null : (
        <DeployOutcome standing={standing} report={report} checkedAt={checkedAt} />
      )}

      {canAct ? (
        <div className="button-row">
          <button type="button" className="button-primary" disabled={busy} onClick={onDeploy}>
            {busy ? "Putting it there..." : `Put ${title} on ${chosen.label}`}
          </button>
        </div>
      ) : (
        /*
         * Said rather than drawn disabled. A greyed-out deploy button on an
         * agent's page reads as "this agent cannot be deployed", which is a
         * claim about the agent; the true statement is about which window this
         * is. Same call `ManifestGapNotice` makes one section up.
         */
        <p className="muted wrap">
          Open the installed DASH app to put this agent on a server.
        </p>
      )}
    </section>
  );
}

/**
 * The section as the page uses it: reads the saved servers, issues the command,
 * and asks the server what it has afterwards.
 *
 * Its own state rather than the page's, because none of it is a fact DASH
 * stores. The standing of a deploy lasts as long as the visit — the same
 * decision the Servers page made about a check's standing, and for the same
 * reason: a stored one would keep looking true after it stopped being true.
 */
export function DeployToServer({
  agent,
  title,
  deploy,
  canAct,
}: {
  /** The agent's id, which is what the command names. */
  agent: string;
  title: string;
  deploy: AgentDeployView;
  canAct: boolean;
}): ReactNode {
  const hosts = useView((source) => source.hosts());
  const [chosenHost, setChosenHost] = useState("");
  const [standing, setStanding] = useState<DeployStanding | null>(null);
  const [report, setReport] = useState<HostConnectState | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const servers = hosts.status === "ready" ? hosts.data.servers : [];
  const chosen = servers.find((server) => server.host_id === chosenHost) ?? servers[0];

  async function put(): Promise<void> {
    if (chosen === undefined) {
      return;
    }
    setBusy(true);
    setReport(null);
    setCheckedAt(null);
    setStanding({ step: "sending", agent: title, server: chosen.label });

    const result = await submitHostCommand("deploy", {
      host_id: chosen.host_id,
      agent_id: agent,
    });

    if (!result.ok) {
      setBusy(false);
      setStanding({
        step: "failed",
        agent: title,
        server: chosen.label,
        // Main's own sentence. The manifest-only refusal arrives here for an
        // agent this page believed deployable — a store that changed under a
        // rendered view — and passing it through unchanged is what keeps the
        // trusted side the authority rather than this component.
        detail: result.detail ?? "DASH could not put this agent on that server.",
      });
      return;
    }

    setStanding({ step: "sent", agent: title, server: chosen.label });

    /*
     * Ask the server what it has now rather than reporting the deploy's own
     * answer as an inventory. `host.deploy` returning success means DASH's
     * request was accepted; what is running there is a separate question with a
     * separate answer, and the moment it was given is rendered beside it.
     */
    const checked = await submitHostCommand("probe", { host_id: chosen.host_id });
    setBusy(false);
    setReport(readProbeStanding(chosen.label, checked));
    setCheckedAt(new Date().toISOString());
  }

  /*
   * A section's own waiting, drawn as a section rather than as a page.
   *
   * Deliberately not `ViewLoading` or `ViewFailed`: both stamp
   * `data-view-state`, which `electron/first-paint.ts` reads as *the page's*
   * state. This page has loaded — one section of it is still reading — and a
   * component that claimed otherwise would make a working page report itself as
   * loading or failed to the check that decides whether DASH starts.
   */
  if (hosts.status === "loading") {
    return (
      <section className="section deploy-section" aria-labelledby="deploy-to-server">
        <h2 id="deploy-to-server">Run this agent on your server</h2>
        <p className="muted" aria-live="polite">
          Reading the servers you have connected…
        </p>
      </section>
    );
  }
  if (hosts.status === "failed") {
    return (
      <section className="section deploy-section" aria-labelledby="deploy-to-server">
        <h2 id="deploy-to-server">Run this agent on your server</h2>
        <p className="wrap">
          <strong>{hosts.recovery.headline}</strong>
        </p>
        <p className="wrap">{hosts.recovery.meaning}</p>
        <p className="next-action wrap">{hosts.recovery.next_action}</p>
      </section>
    );
  }

  return (
    <DeployToServerPanel
      title={title}
      deploy={deploy}
      servers={servers}
      chosenHost={chosen?.host_id ?? ""}
      standing={standing}
      report={report}
      checkedAt={checkedAt}
      busy={busy}
      canAct={canAct}
      onChoose={(hostId) => {
        setChosenHost(hostId);
        // A standing describes one attempt at one server. Carrying it onto a
        // different machine would put a result under the wrong name.
        setStanding(null);
        setReport(null);
        setCheckedAt(null);
      }}
      onDeploy={() => void put()}
    />
  );
}
