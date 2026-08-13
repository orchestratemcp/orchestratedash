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
import {
  describeConnectionTravel,
  describeStrandedCopy,
  type ConnectionTravel,
} from "../../lib/deploy/connection-travel";
import { describeDeployReceipt } from "../../lib/deploy/receipt";
import { describeBringHome } from "../../lib/copy/bring-home";
import { describeSentServer, SENT_SERVERS_HEADING } from "../../lib/copy/folder";
import { readProbeStanding, type HostConnectState } from "../../lib/host-connect";
import { describeDeployed, describeSignIn } from "../../lib/server-card";
import type {
  AgentDeployTarget,
  AgentDeployView,
  SavedServerView,
} from "../../lib/views/types";
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

/**
 * What DASH holds that will not go with the agent (MAR-591).
 *
 * ## Why it is one component rather than a paragraph in each panel
 *
 * `describeDeployReceipt`'s discipline, one issue on: a deploy can begin in two
 * places, and a consequence written in both is a consequence that gets softened
 * in one. This is the whole of that sentence for both — the server card renders
 * it against the agent somebody picked from its list, the agent page against the
 * server somebody picked from its own, and neither composes a word of it.
 *
 * ## Where it sits, and why not lower
 *
 * Above the button and below the receipt, in the place MAR-577 put the
 * undeployable refusal, and for the reason stated there: nobody should press a
 * button that was never going to work — and in the warn case, nobody should
 * press one whose consequence they were told about afterwards. ADR 0002
 * amendment 2's rule about a disclosure that arrives after the grant is the same
 * rule; this one arrives before the press or it is not a disclosure.
 *
 * ## Announced, not merely present
 *
 * `role="alert"` on the refusal and `role="status"` on the warning, which is
 * `DeployOutcome`'s split. The picker changes what this says — choose a
 * different agent on the server card and a sentence about Gmail appears out of
 * nowhere — so a reader who is not looking at this part of the page has to be
 * told the page changed under them.
 */
export function ConnectionTravelNotice({
  travel,
  agent,
  server,
}: {
  travel: ConnectionTravel;
  /** The agent's display name, as its own page's heading shows it. */
  agent: string;
  /** What the person calls the server. Never an address. */
  server: string;
}): ReactNode {
  const notice = describeConnectionTravel(travel, agent, server);
  if (notice === null) {
    return null;
  }
  const refused = travel.verdict === "refuse";
  return (
    <section
      className={refused ? "notice notice-err travel-notice" : "notice notice-warn travel-notice"}
      role={refused ? "alert" : "status"}
    >
      <p className="wrap">
        <strong>{notice.headline}</strong>
      </p>
      {/*
        Why, once, before what. The reasons are about the arrangement and the
        list is about this agent's connections — see `TravelNotice.reasons` for
        the two identical paragraphs that split them apart.
      */}
      {notice.reasons.map((reason) => (
        <p key={reason} className="wrap">
          {reason}
        </p>
      ))}
      <ul className="permission-list">
        {notice.lines.map((line) => (
          <li key={line} className="wrap">
            {line}
          </li>
        ))}
      </ul>
      {notice.next_action === null ? null : (
        <p className="next-action wrap">{notice.next_action}</p>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------------- *
 * The agent-side section
 * ---------------------------------------------------------------------- */

/**
 * What DASH has already sent, and where (MAR-584, ADR 0010).
 *
 * ## Why this lives in the deploy section and not beside the folder check
 *
 * The sentence it produces is *"you changed this agent; the copy on that server
 * is not this agent any more"*, which arrives from the folder check — but the
 * only useful thing to do about it is a deploy, and the deploy is here. Putting
 * the row somewhere else would mean a second call site for `host.deploy`, which
 * is exactly the duplication this component's own header argues against.
 *
 * ## Every sentence is `describeSentServer`'s
 *
 * Nothing is worded here. A row that composed its own copy would be a second
 * place for ADR 0010's bound to be softened, and softening it is easy: "up to
 * date" is shorter than what DASH is entitled to say, and reads better.
 */
function SentServers({
  targets,
  travel,
  busy,
  canAct,
  onSendAgain,
  onBringHome,
}: {
  targets: readonly AgentDeployTarget[];
  /** MAR-591. What DASH held back from every one of these pushes. */
  travel: ConnectionTravel;
  busy: boolean;
  canAct: boolean;
  onSendAgain: (hostId: string) => void;
  /** MAR-611, ADR 0017. Take this copy off that server, having copied what it has. */
  onBringHome: (hostId: string) => void;
}): ReactNode {
  if (targets.length === 0) {
    return null;
  }
  return (
    <section className="sent-servers">
      <h3 className="label-caps">{SENT_SERVERS_HEADING}</h3>
      {targets.map((target) => {
        const copy = describeSentServer({
          server: target.label,
          sentOn: target.sent_on,
          comparable: target.comparable,
          behind: target.behind,
        });
        /*
         * MAR-591. What is not over there, on the row that says something is.
         *
         * Recomputed from today's manifest rather than recorded at push time,
         * which is the honest direction: the record MAR-584 keeps is of bytes
         * DASH sent, and DASH has never sent a credential to any server on any
         * day. So this is not "what was held back that time" — it is the
         * standing fact that this agent's connections live here, said beside the
         * copy it is true of.
         */
        const stranded = describeStrandedCopy(travel, target.label);
        return (
          <div className="sent-server" key={target.host_id}>
            <p className="wrap">
              <strong>{copy.headline}</strong>
            </p>
            <p className="card-meta wrap">{copy.meaning}</p>
            {stranded === null ? null : <p className="card-meta wrap">{stranded}</p>}
            {/*
              Offered on every row, not only the behind ones. A person who wants
              to push again over an unchanged copy is entitled to — the reasons
              are theirs and DASH does not know them — and a button that appeared
              only when DASH judged it necessary would make its absence read as
              "you may not".
            */}
            {canAct ? (
              <div className="button-row">
                <button
                  type="button"
                  className={target.behind ? "button-primary" : "button-secondary"}
                  disabled={busy}
                  onClick={() => {
                    onSendAgain(target.host_id);
                  }}
                >
                  {busy ? "Sending…" : `Send this agent to ${target.label} again`}
                </button>
                {/*
                  MAR-611, ADR 0017. The symmetric other half, on the row that
                  already names the server: copy what the copy there still has,
                  then take it off. `describeBringHome` is the disclosure a
                  person reads before pressing it — this button is deliberately
                  not primary, since the button beside it is the one that keeps
                  the copy where it already is.
                */}
                <button
                  type="button"
                  className="button-secondary"
                  disabled={busy}
                  onClick={() => {
                    onBringHome(target.host_id);
                  }}
                >
                  Bring this agent home
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

/**
 * Where a bring-home stands, on the one agent page that can start one
 * (MAR-611, ADR 0017).
 *
 * Its own small state machine rather than a boolean, for `DeployStanding`'s own
 * reason next door: `confirm` is the disclosure `describeBringHome` owes a
 * person before anything irreversible happens, `working` is the sequence
 * actually running on a server, and `done` is `describeBringHomeOutcome`'s own
 * sentence, already worded by the trusted side and rendered rather than
 * reworded here.
 */
type BringHomeState =
  | { step: "confirm"; host_id: string; label: string }
  | { step: "working"; host_id: string; label: string }
  | { step: "done"; host_id: string; label: string; ok: boolean; detail: string }
  | null;

/**
 * The disclosure before the press, and the two answers to it.
 *
 * `describeBringHome`'s three sentences, drawn the same shape
 * `ForgetConfirmation` (`app/_components/server-card.tsx`) already uses for the
 * other irreversible server action on this page — a person reads what will
 * happen before either button is live.
 */
function BringHomeConfirmation({
  label,
  busy,
  onKeep,
  onConfirm,
}: {
  label: string;
  busy: boolean;
  onKeep: () => void;
  onConfirm: () => void;
}): ReactNode {
  const copy = describeBringHome(label);
  return (
    <section className="notice wrap" role="alert">
      <p>
        <strong>{copy.headline}</strong>
      </p>
      <p>{copy.meaning}</p>
      <p className="disclosure wrap" role="note">
        {copy.afterwards}
      </p>
      <div className="button-row">
        <button type="button" className="button-secondary" disabled={busy} onClick={onKeep}>
          Not now
        </button>
        <button type="button" className="button-primary" disabled={busy} onClick={onConfirm}>
          {busy ? "Bringing it home…" : "Bring it home"}
        </button>
      </div>
    </section>
  );
}

export function DeployToServerPanel({
  title,
  deploy,
  servers,
  targets,
  chosenHost,
  standing,
  report,
  checkedAt,
  busy,
  canAct,
  onChoose,
  onDeploy,
  onSendAgain,
  bringHome,
  onBringHomeRequest,
  onBringHomeCancel,
  onBringHomeConfirm,
  onBringHomeDismiss,
}: {
  /** The agent's own display name, as the page's heading shows it. */
  title: string;
  deploy: AgentDeployView;
  servers: readonly SavedServerView[];
  /** Where DASH has already sent this agent (MAR-584). Empty for almost all. */
  targets: readonly AgentDeployTarget[];
  chosenHost: string;
  /** Null before anything has been attempted this visit. */
  standing: DeployStanding | null;
  report: HostConnectState | null;
  checkedAt: string | null;
  busy: boolean;
  canAct: boolean;
  onChoose: (hostId: string) => void;
  onDeploy: () => void;
  onSendAgain: (hostId: string) => void;
  /** MAR-611, ADR 0017. Where the bring-home for this agent stands, if any. */
  bringHome: BringHomeState;
  onBringHomeRequest: (hostId: string) => void;
  onBringHomeCancel: () => void;
  onBringHomeConfirm: () => void;
  onBringHomeDismiss: () => void;
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
          <Link href="/settings/servers">{copy.next_action}</Link>
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

      {/*
        Above the receipt, because it is about pushes that already happened and
        the receipt is about the one that has not. A person arriving after
        accepting a folder update is here for this block, and reading a
        disclosure first would bury it.
      */}
      <SentServers
        targets={targets}
        travel={deploy.travel}
        busy={busy}
        canAct={canAct}
        onSendAgain={onSendAgain}
        onBringHome={onBringHomeRequest}
      />

      {/*
        MAR-611, ADR 0017. The disclosure before the press, and the outcome
        after it — both about whichever server's row was pressed, not
        necessarily the one chosen in the picker above.
      */}
      {bringHome !== null && bringHome.step !== "done" ? (
        <BringHomeConfirmation
          label={bringHome.label}
          busy={bringHome.step === "working"}
          onKeep={onBringHomeCancel}
          onConfirm={onBringHomeConfirm}
        />
      ) : null}
      {bringHome !== null && bringHome.step === "done" ? (
        <section
          className={bringHome.ok ? "notice notice-ok wrap" : "notice notice-err wrap"}
          role="status"
        >
          <p>{bringHome.detail}</p>
          <div className="button-row">
            <button type="button" className="button-secondary" onClick={onBringHomeDismiss}>
              Close
            </button>
          </div>
        </section>
      ) : null}

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

      {/*
        MAR-591. After the receipt and before the button, because it is the same
        kind of sentence the receipt is — what this arrangement is actually like
        — and because the receipt is the general case while this is about *this*
        agent's own connections.
      */}
      <ConnectionTravelNotice travel={deploy.travel} agent={title} server={chosen.label} />

      {standing === null ? null : (
        <DeployOutcome standing={standing} report={report} checkedAt={checkedAt} />
      )}

      {canAct ? (
        <div className="button-row">
          {/*
            Disabled on a refusal rather than hidden, unlike the undeployable
            case at the top of this function. The difference is what the person
            would do about it: a migrated agent has no program and there is
            nothing to choose, so the picker itself is wrong; here the agent is
            sendable and it is *this server* it cannot usefully go to, so the
            control stays where it was with the reason directly above it.
          */}
          <button
            type="button"
            className={
              deploy.travel.verdict === "refuse"
                ? "button-primary button-unavailable"
                : "button-primary"
            }
            disabled={busy || deploy.travel.verdict === "refuse"}
            onClick={onDeploy}
          >
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
  targets,
  canAct,
  onBroughtHome,
}: {
  /** The agent's id, which is what the command names. */
  agent: string;
  title: string;
  deploy: AgentDeployView;
  targets: readonly AgentDeployTarget[];
  canAct: boolean;
  /**
   * MAR-611, ADR 0017. A bring-home changes which servers this agent is still
   * sent to — `view.deploy_targets` excludes a row the moment its
   * `brought_home_at` is set — so a successful one has to ask the page for a
   * fresh view rather than let `targets` here go stale.
   */
  onBroughtHome: () => void;
}): ReactNode {
  const hosts = useView((source) => source.hosts());
  const [chosenHost, setChosenHost] = useState("");
  const [standing, setStanding] = useState<DeployStanding | null>(null);
  const [report, setReport] = useState<HostConnectState | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bringHome, setBringHome] = useState<BringHomeState>(null);

  const servers = hosts.status === "ready" ? hosts.data.servers : [];
  const chosen = servers.find((server) => server.host_id === chosenHost) ?? servers[0];

  /**
   * `hostId` names the server explicitly rather than being read from state
   * (MAR-584).
   *
   * The re-send buttons in `SentServers` each name their own server, and a
   * handler that set `chosenHost` and then read it back would push to whichever
   * server was selected *before* the click — React has not re-rendered by then.
   * The picker's own button passes nothing and gets the chosen one, which is the
   * behaviour it has always had.
   */
  async function put(hostId?: string): Promise<void> {
    const target =
      hostId === undefined ? chosen : (servers.find((server) => server.host_id === hostId) ?? chosen);
    if (target === undefined) {
      return;
    }
    setBusy(true);
    setReport(null);
    setCheckedAt(null);
    setStanding({ step: "sending", agent: title, server: target.label });

    const result = await submitHostCommand("deploy", {
      host_id: target.host_id,
      agent_id: agent,
    });

    if (!result.ok) {
      setBusy(false);
      setStanding({
        step: "failed",
        agent: title,
        server: target.label,
        // Main's own sentence. The manifest-only refusal arrives here for an
        // agent this page believed deployable — a store that changed under a
        // rendered view — and passing it through unchanged is what keeps the
        // trusted side the authority rather than this component.
        detail: result.detail ?? "DASH could not put this agent on that server.",
      });
      return;
    }

    setStanding({ step: "sent", agent: title, server: target.label });

    /*
     * Ask the server what it has now rather than reporting the deploy's own
     * answer as an inventory. `host.deploy` returning success means DASH's
     * request was accepted; what is running there is a separate question with a
     * separate answer, and the moment it was given is rendered beside it.
     */
    const checked = await submitHostCommand("probe", { host_id: target.host_id });
    setBusy(false);
    setReport(readProbeStanding(target.label, checked));
    setCheckedAt(new Date().toISOString());
  }

  /**
   * The bring-home sequence, gated on the confirmation `BringHomeConfirmation`
   * draws (MAR-611, ADR 0017).
   *
   * Two calls into state rather than one — `confirm` on the press that opens
   * the disclosure, `working`/`done` on the press that actually starts the
   * sequence — because a bring-home removes the agent from a server and the
   * disclosure exists so nobody presses that by mistake.
   */
  function requestBringHome(hostId: string): void {
    const target = targets.find((one) => one.host_id === hostId);
    if (target === undefined) {
      return;
    }
    setBringHome({ step: "confirm", host_id: hostId, label: target.label });
  }

  async function confirmBringHome(): Promise<void> {
    if (bringHome === null) {
      return;
    }
    const { host_id, label } = bringHome;
    setBringHome({ step: "working", host_id, label });
    const result = await submitHostCommand("bringHome", { host_id, agent_id: agent });
    setBringHome({
      step: "done",
      host_id,
      label,
      ok: result.ok,
      detail: result.detail ?? "DASH could not bring this agent home.",
    });
    if (result.ok) {
      onBroughtHome();
    }
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
      targets={targets}
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
      onSendAgain={(hostId) => {
        // The standing is about to describe this server, so the picker moves
        // with it. Without that, a failure would render under the heading of
        // whichever server the select still showed.
        setChosenHost(hostId);
        void put(hostId);
      }}
      bringHome={bringHome}
      onBringHomeRequest={requestBringHome}
      onBringHomeCancel={() => {
        setBringHome(null);
      }}
      onBringHomeConfirm={() => void confirmBringHome()}
      onBringHomeDismiss={() => {
        setBringHome(null);
      }}
    />
  );
}
