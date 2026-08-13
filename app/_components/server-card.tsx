"use client";

import { useState, type ReactNode } from "react";

import {
  describeConnectState,
  describeDisconnect,
  type HostConnectState,
} from "../../lib/host-connect";
import {
  describeAskedAt,
  describeDeployOffer,
  describeUndeployable,
  type DeployStanding,
} from "../../lib/deploy/deploying";
import { describeDeployArrangement } from "../../lib/deploy/receipt";
import {
  describeAdded,
  describeDeployed,
  describePin,
  describeSameServer,
  describeSignIn,
  standingChip,
} from "../../lib/server-card";
import { describeSetupStep } from "../../lib/host-wizard";
import {
  describeWhatIsOnHost,
  summariseWhatIsOnHost,
  type AgentHostStanding,
} from "../../lib/host-sighting";
import { describeBringHome } from "../../lib/copy/bring-home";
import type { AgentDeployChoice, SavedServerView } from "../../lib/views/types";
import { ConnectionTravelNotice, DeployOutcome } from "./deploy";

/**
 * A saved server, as a card you manage (MAR-574).
 *
 * The surface the Servers route did not have. `lib/server-card.ts` owns every
 * sentence here and `lib/host-connect.ts` owns the standing; this owns the
 * order, which is the answer to the question the page is open for read top to
 * bottom:
 *
 * 1. **What is it and does it work** — the label, and the standing in its own
 *    words. The chip beside the label is the same fact at a glance, and since
 *    MAR-605 that is literal rather than aspirational: `standingChip` moved into
 *    `lib/server-card.ts` and builds its label out of the standing's own
 *    `reach`, so this component no longer has the option of deciding how far
 *    DASH got. It had that option once, and used it to draw CANNOT REACH above
 *    a sentence reading "the server is answering".
 * 2. **How DASH reaches it, and since when** — the connection facts, which are
 *    what a person checks against their provider's own page.
 * 3. **What is on it** — reported by the server, never claimed by DASH.
 * 4. **Which machine it is** — the pinned identity, null on every real record
 *    today (MAR-572), and said rather than hidden.
 * 5. **What you can do** — check again, put an agent here, stop using it.
 *
 * The novice test this is written against: *someone who has never used SSH can
 * tell whether their server is working and what to do next.* Which is why the
 * standing is a sentence before it is a chip, why every failure carries its own
 * next action rather than one shared shrug, and why "nothing is running there"
 * is drawn as an ordinary state and not as a fault.
 */

/* ---------------------------------------------------------------------- *
 * The card
 * ---------------------------------------------------------------------- */

export interface ServerCardActions {
  check(): void;
  deploy(agentId: string): void;
  forget(): void;
  /** Confirm the identity the card displayed (MAR-572). Carries it back verbatim. */
  trust(fingerprint: string): void;
  /** Fetch the one-paste bootstrap for this server (MAR-573). Null on failure. */
  setup(): Promise<string | null>;
  /**
   * Take this agent's copy back off this server (MAR-611, ADR 0017).
   *
   * Confirmed on the card first — see `confirmBringHome` — so this is only ever
   * called once a person has read `describeBringHome` and pressed the button
   * naming the act.
   */
  bringHome(agentId: string): void;
}

export function ServerCard({
  server,
  standing,
  checkedAt,
  agents,
  busy,
  notice,
  deploy,
  actions,
  canAct,
}: {
  server: SavedServerView;
  standing: HostConnectState;
  /**
   * When the server gave the standing above, or null before anything asked
   * (MAR-577).
   *
   * The card says what the server reported; this says when it said it. Without
   * it a count that was true ten minutes ago reads as one that is true now,
   * which is the failure this whole page was built against — see
   * `describeAskedAt`.
   */
  checkedAt: string | null;
  /** Every agent in this DASH, with whether it can be sent. Empty is a real state. */
  agents: readonly AgentDeployChoice[];
  busy: boolean;
  /** Whatever the last command said when it failed. Null when nothing did. */
  notice: string | null;
  /** How the last deploy from this card is going, or null when none has begun. */
  deploy: DeployStanding | null;
  actions: ServerCardActions;
  canAct: boolean;
}): ReactNode {
  const [confirmForget, setConfirmForget] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [chosenAgent, setChosenAgent] = useState("");
  /**
   * The agent id a bring-home is being confirmed for, or null (MAR-611,
   * ADR 0017). One at a time, the same shape `confirmForget` already uses for
   * the card's other irreversible action.
   */
  const [confirmBringHome, setConfirmBringHome] = useState<string | null>(null);

  const copy = describeConnectState(standing);
  const chip = standingChip(standing);
  const asked = describeAskedAt(checkedAt);
  const pin = describePin(server.fingerprint);
  const sameServer = describeSameServer(server.same_server_index, server.same_server_count);
  /*
   * The two accounts of what is on this machine, reconciled (MAR-606).
   *
   * `seen` is null until a check has actually answered — not an empty list,
   * which would mean "the server named nothing" and is a different claim
   * entirely. That distinction is the whole reason `describeWhatIsOnHost` takes
   * a nullable: an unchecked server and an empty server look identical to a
   * renderer and mean opposite things to a reader.
   */
  const contents = describeWhatIsOnHost({
    server: server.label,
    seen: standing.step === "reachable" ? standing.agents_there : null,
    sent: server.sent,
    at: checkedAt,
  });

  return (
    <article className="row-card server-card">
      <div className="card-head">
        <h2>{server.label}</h2>
        <span className={`chip ${chip.tone}`}>{chip.label}</span>
      </div>

      {/*
        Which of the identical records this is, and nothing more. The
        explanation is on the page, once — four cards each carrying the same
        three sentences is a wall of repeated text where the reader needed one
        fact per card.
      */}
      {sameServer === null ? null : <p className="card-meta">{sameServer}</p>}

      {/*
        The standing, as a sentence, above everything else on the card. A person
        who opened this page opened it to find out whether their server works,
        and the answer to that must not be a colour they have to interpret.
      */}
      <p className="wrap">
        <strong>{copy.headline}</strong>
      </p>
      <p className="wrap">{copy.detail}</p>
      {/*
        The next action, except where a button on this card already *is* it.
        "Check this server" printed immediately above a control reading CHECK
        THIS SERVER is noise, and noise directly above the thing a person is
        meant to press is the worst place to put it. Every other state's next
        action is guidance — copy the key onto the server, check the account
        name — and stays.
      */}
      {copy.next_action === null || standing.step === "not_checked" ? null : (
        <p className="next-action wrap">{copy.next_action}</p>
      )}

      <p className="card-meta wrap">
        {describeSignIn(server)}. {describeAdded(server.added_at)}.
      </p>

      {/*
        What is on the server, when there is anything to say about it. An
        unchecked card's standing already says DASH has not looked, and a second
        sentence saying the same thing in different words — five times down a
        list — is the wall of text this page is trying not to be.
      */}
      {standing.step === "not_checked" ? null : (
        <p className="card-meta wrap">
          {describeDeployed(standing)}
          {/* MAR-577. The moment the answer was given, beside the answer. Null
              until something has been asked, and null is right then: the
              standing already says DASH has not looked. */}
          {asked === null ? "" : ` ${asked}`}
        </p>
      )}

      {/*
        MAR-606 finding 3, and Henrik's own sentence: *"there is no way to see
        what agents are acctually on the server. As far as i can tell."*

        He was right, and the count above is why he was right — it said "1
        agent" after he had deployed the same agent by two different routes, and
        could not tell him whether that meant one copy or two. This is the same
        answer, unreduced, beside DASH's own record of what it put here.

        Drawn whenever either side has anything to say, including before any
        check: a person who has deployed to this server should see what DASH
        sent even when nothing has asked the machine yet. That state is what the
        list says it is, in words, rather than an absence.
      */}
      {contents.length === 0 ? null : (
        <WhatIsOnThisServer
          rows={contents}
          /*
           * MAR-611, ADR 0017. Bring-home only makes sense for an agent DASH
           * still holds on this computer — `bringAgentHomeFromHost` refuses
           * before starting anything otherwise — so the button is offered
           * exactly where that is true rather than for every row the server
           * happened to answer about.
           */
          knownLocally={new Set(agents.map((agent) => agent.name))}
          busy={busy}
          canAct={canAct}
          onBringHome={(agentId) => {
            setConfirmBringHome(agentId);
          }}
        />
      )}

      {confirmBringHome === null ? null : (
        <BringHomeConfirmation
          agent={confirmBringHome}
          label={server.label}
          busy={busy}
          onKeep={() => {
            setConfirmBringHome(null);
          }}
          onConfirm={() => {
            actions.bringHome(confirmBringHome);
            setConfirmBringHome(null);
          }}
        />
      )}

      {/*
        MAR-572, rendered rather than hidden. Every real record has a null
        fingerprint, so this is the branch a person actually sees, and it is the
        one fact on the card about *which machine this is* — the question the
        whole strict-host-key arrangement exists to answer and cannot yet.
      */}
      <details className="card-more">
        <summary>This server&rsquo;s identity</summary>
        <p className="wrap">
          <strong>{pin.headline}</strong>
        </p>
        <p className="wrap">{pin.detail}</p>
        {server.fingerprint === null ? null : (
          <pre className="public-key">{server.fingerprint}</pre>
        )}
      </details>

      {notice === null ? null : (
        <p className="notice notice-err wrap" role="alert">
          {notice}
        </p>
      )}

      {/*
        The enrollment moment on a saved record (MAR-572). Every real record is
        unpinned today, so the first check of a working server lands here: the
        code is shown, and confirming it is the one part only the person can do.
        The fingerprint they compare is on its own line above, so the button
        carries a decision they have actually made rather than a blind yes.
      */}
      {standing.step === "confirm_host_key" ? (
        <section className="enrollment-panel">
          <pre className="public-key">{standing.fingerprint}</pre>
          <button
            type="button"
            className="button-primary"
            disabled={busy || !canAct}
            onClick={() => {
              actions.trust(standing.fingerprint);
            }}
          >
            {busy ? "Confirming..." : "Yes, this is my server"}
          </button>
        </section>
      ) : null}

      {/*
        The bootstrap, reachable where it is needed (MAR-573, MAR-579). On a
        fresh box the walls arrive in order: the host key is confirmed first
        (above), then the sign-in fails because DASH's key and the helper are not
        on the server yet. Both are what the one-paste snippet installs, so the
        setup affordance is offered for `key_not_on_server` as well as
        `helper_not_installed` — the snippet is the single answer to "this server
        is not set up for DASH yet", whichever of the two the probe named.
      */}
      {standing.step === "unreachable" &&
      (standing.problem === "helper_not_installed" || standing.problem === "key_not_on_server") ? (
        <SetupPanel label={server.label} busy={busy} canAct={canAct} fetchScript={actions.setup} />
      ) : null}

      <div className="button-row">
        <button
          type="button"
          className="button-primary"
          disabled={busy || !canAct}
          onClick={() => {
            actions.check();
          }}
        >
          {standing.step === "probing" ? "Checking..." : "Check this server"}
        </button>
        <button
          type="button"
          className="button-secondary"
          disabled={busy || !canAct}
          onClick={() => {
            setDeploying((open) => !open);
          }}
          aria-expanded={deploying}
        >
          Put an agent here
        </button>
        <button
          type="button"
          className="button-secondary"
          disabled={busy || !canAct}
          onClick={() => {
            setConfirmForget(true);
          }}
        >
          Stop using this server
        </button>
      </div>

      {deploying ? (
        <DeployPanel
          server={server}
          agents={agents}
          busy={busy}
          canAct={canAct}
          chosenAgent={chosenAgent}
          deploy={deploy}
          report={standing}
          checkedAt={checkedAt}
          onChoose={setChosenAgent}
          onCancel={() => {
            setDeploying(false);
          }}
          onDeploy={() => {
            actions.deploy(chosenAgent);
          }}
          onCheck={actions.check}
        />
      ) : null}

      {confirmForget ? (
        <ForgetConfirmation
          label={server.label}
          busy={busy}
          onKeep={() => {
            setConfirmForget(false);
          }}
          onForget={actions.forget}
        />
      ) : null}
    </article>
  );
}

/**
 * What is on this server, from both accounts (MAR-606, ADR 0015).
 *
 * Exported so a render test can drive it without a click, the same reason
 * `DeployPanel` is: the sentences here are the ones that carry a timestamp, and
 * a timestamp that disappears when somebody tidies a component is the whole
 * failure ADR 0015 bounds against.
 *
 * Every row's sentence is complete on its own and carries its own moment, so
 * the section needs no shared "as of" header — which is deliberate rather than
 * repetitive. A header would be one clock over rows that can have been observed
 * at different times, and the first time those diverged the header would be
 * quietly wrong about most of the list.
 *
 * The chip is `lowercase` in the document. `app/globals.css` uppercases `.chip`
 * as typography, so what a screen reader announces is what is written here —
 * and a harness grepping for this copy must read the document rather than
 * `innerText`, which returns the uppercased form.
 */
export function WhatIsOnThisServer({
  rows,
  knownLocally,
  busy,
  canAct,
  onBringHome,
}: {
  rows: readonly AgentHostStanding[];
  /**
   * MAR-611, ADR 0017. Which of these agents DASH still holds on this
   * computer — the one precondition `bringAgentHomeFromHost` checks before
   * starting anything, so it is also the one gate for offering the button.
   */
  knownLocally: ReadonlySet<string>;
  busy: boolean;
  canAct: boolean;
  onBringHome: (agentId: string) => void;
}): ReactNode {
  return (
    <section className="host-contents">
      <h3 className="label-caps">What is on this server</h3>
      <p className="card-meta wrap">{summariseWhatIsOnHost(rows)}</p>
      <ul className="host-contents-list">
        {rows.map((row) => (
          <li key={row.agent} className="host-content">
            <span className="host-content-head">
              <code>{row.agent}</code>
              <span className={`chip chip-${row.tone}`}>{row.chip}</span>
            </span>
            <span className="wrap muted">{row.sentence}</span>
            {canAct && knownLocally.has(row.agent) ? (
              <div className="button-row">
                <button
                  type="button"
                  className="button-secondary"
                  disabled={busy}
                  onClick={() => {
                    onBringHome(row.agent);
                  }}
                >
                  Bring it home
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The disclosure before a bring-home, and the two answers to it (MAR-611,
 * ADR 0017).
 *
 * `describeBringHome`'s three sentences, in the same two-step shape
 * `ForgetConfirmation` below already uses for this card's other irreversible
 * action: a person reads what will happen — including the half that is
 * deliberately *not* done — before either button is live.
 */
function BringHomeConfirmation({
  agent,
  label,
  busy,
  onKeep,
  onConfirm,
}: {
  agent: string;
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
      <p className="card-meta wrap">
        <code>{agent}</code>
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

/**
 * Putting an agent on this server, with everything that has to be said first.
 *
 * Exported so its two disclosures can be rendered under test without a click:
 * the ADR 0007 receipt, and MAR-573's gap. Both are the kind of sentence that
 * disappears quietly when somebody tidies a component, and neither has any
 * business being reachable only through page state.
 */
export function DeployPanel({
  server,
  agents,
  busy,
  canAct,
  chosenAgent,
  deploy,
  report,
  checkedAt,
  onChoose,
  onCancel,
  onDeploy,
  onCheck,
}: {
  server: SavedServerView;
  agents: readonly AgentDeployChoice[];
  busy: boolean;
  canAct: boolean;
  chosenAgent: string;
  /** How the last deploy from this card is going, or null when none has begun. */
  deploy: DeployStanding | null;
  /** The card's own standing, which is what the server said when last asked. */
  report: HostConnectState;
  checkedAt: string | null;
  onChoose: (agentId: string) => void;
  onCancel: () => void;
  onDeploy: () => void;
  /** Ask the server what it has now — the offer after a push (MAR-606). */
  onCheck: () => void;
}): ReactNode {
  /*
   * MAR-577. Whether the *chosen* agent could be sent at all.
   *
   * A migrated agent has its author's document and no program (ADR 0008 slice
   * 4), so DASH has nothing to put on a server — and it knows that from its own
   * folder, without a network. Before this, the only way to find out was to
   * press the button: the refusal came back from main, *after* the host-key
   * gate, so somebody with an unconfirmed server was told about the server and
   * never told the agent could not have gone anywhere either way.
   *
   * The agent stays in the list rather than being filtered out. A person's own
   * agent silently missing from a picker is a worse answer than the sentence
   * saying why it cannot go.
   */
  const chosen = agents.find((agent) => agent.name === chosenAgent) ?? null;
  const refusal =
    chosen === null || chosen.deploy.deployable
      ? null
      : describeUndeployable(chosen.title, chosen.deploy.refusal ?? "");

  /*
   * MAR-606 finding 31. What the control should offer, given what DASH already
   * did to this agent on this server.
   *
   * `sent_on` comes from DASH's own record on the view and not from the check,
   * so the offer is correct before anything has asked the machine — which is
   * the case that matters, because it is the state the card opens in.
   *
   * MAR-589. `chosen?.title`, never `chosenAgent` — the id is what the select's
   * value carries and is not what this sentence may say.
   */
  const offer = describeDeployOffer({
    agent: chosen?.title ?? "this agent",
    server: server.label,
    sent_on: server.sent.find((one) => one.agent === chosenAgent)?.sent_on ?? null,
    just_sent: deploy?.step === "sent" && deploy.agent === chosenAgent,
  });

  return (
    <section className="deploy-panel">
      {/*
        ADR 0007 requires the while-closed sentence *before* the first deploy,
        and this is now one of the two places a deploy can begin. It is the same
        receipt the connect flow shows, from the same function — two copies of a
        disclosure are two copies that can be softened independently.
      */}
      <DeployArrangement label={server.label} />

      {/*
        MAR-573's circular-bootstrap gap used to be a dead-end sentence here.
        MAR-579 replaced it with a way out: the setup snippet is offered on the
        card itself, gated on the states that actually mean "not set up yet"
        (`helper_not_installed`, `key_not_on_server`), rather than described in
        the deploy panel where the server is already reachable.
      */}
      {agents.length === 0 ? (
        <p className="wrap muted">
          There is no agent here to put on a server yet. Add one first and it will be offered
          here.
        </p>
      ) : (
        <>
          <label className="field-label" htmlFor={`deploy-agent-${server.host_id}`}>
            Which agent
            <select
              id={`deploy-agent-${server.host_id}`}
              className="field"
              value={chosenAgent}
              onChange={(event) => {
                onChoose(event.target.value);
              }}
            >
              <option value="">Choose an agent</option>
              {/* MAR-589. The value stays the id — it is what `onChoose` and
                  `chosenAgent` key on — and the label is the name a person
                  actually picked this agent by. */}
              {agents.map((agent) => (
                <option key={agent.name} value={agent.name}>
                  {agent.title}
                </option>
              ))}
            </select>
          </label>

          {/* Said the moment the agent is chosen, and above the control, so
              nobody presses a button that was never going to work. */}
          {refusal === null ? null : (
            <div className="notice notice-warn wrap" role="status">
              <p>
                <strong>{refusal.headline}</strong>
              </p>
              <p>{refusal.detail}</p>
            </div>
          )}

          {/* MAR-591. Which of the chosen agent's connections stay on this
              computer, from the same function and the same component the agent's
              own page uses — the two entry points cannot word one consequence
              two ways any more than they can word one deploy two ways.

              Drawn beside the refusal above rather than instead of it: a
              migrated agent with a stranded Gmail has two separate things wrong
              with it, and showing one would leave the other to be discovered
              after the first was fixed. */}
          {chosen === null ? null : (
            <ConnectionTravelNotice
              travel={chosen.deploy.travel}
              agent={chosen.title}
              server={server.label}
            />
          )}

          {/* What is happening, or what happened, and what the server says it
              has now. The same component the agent's own page uses, so the two
              entry points cannot word one deploy two ways. */}
          {deploy === null ? null : (
            <DeployOutcome standing={deploy} report={report} checkedAt={checkedAt} />
          )}

          {/* MAR-606 finding 31. What a second press would actually do, said
              above the control rather than discovered by pressing it. Null on a
              first deploy, where the plain offer needs no gloss. */}
          {offer.note === null ? null : (
            <p className="disclosure wrap" role="note">
              {offer.note}
            </p>
          )}

          <div className="button-row">
            <button type="button" className="button-secondary" disabled={busy} onClick={onCancel}>
              {/* Once the push has landed there is nothing to decline, and
                  "Not now" beside a finished deploy reads as an offer still
                  standing. */}
              {offer.asks_rather_than_sends ? "Close" : "Not now"}
            </button>
            {/*
              After a successful push the primary asks the server rather than
              offering to send again — the finding's own complaint, and the one
              action that can answer the question a person has at that moment.
              Sending again stays reachable as the secondary, because replacing
              a copy is a real thing to want and hiding it would be the opposite
              overcorrection.
            */}
            {offer.asks_rather_than_sends ? (
              <>
                <button
                  type="button"
                  className="button-secondary"
                  disabled={busy || !canAct}
                  onClick={onDeploy}
                >
                  Send it again
                </button>
                <button
                  type="button"
                  className="button-primary"
                  disabled={busy || !canAct}
                  onClick={onCheck}
                >
                  {offer.label}
                </button>
              </>
            ) : (
              <button
                type="button"
                className={
                  refusal !== null || chosen?.deploy.travel.verdict === "refuse"
                    ? "button-primary button-unavailable"
                    : "button-primary"
                }
                disabled={
                  busy ||
                  chosenAgent === "" ||
                  refusal !== null ||
                  chosen?.deploy.travel.verdict === "refuse" ||
                  !canAct
                }
                onClick={onDeploy}
              >
                {busy ? "Putting it there..." : offer.label}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * The receipt `lib/deploy/bundle.ts` has built since MAR-487.
 *
 * Duplicated in shape with the connect flow's copy of it and not in content —
 * both call `describeDeployArrangement`, so the three limits and the revocation
 * sentence are one string each.
 */
function DeployArrangement({ label }: { label: string }): ReactNode {
  const receipt = describeDeployArrangement(label);
  return (
    <section className="deploy-receipt">
      <h3 className="label-caps">Before you put an agent here</h3>
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
  );
}

/**
 * The one-paste bootstrap, reachable at last (MAR-573, MAR-579).
 *
 * This replaces `BootstrapGap`, which described the circular gap without a way
 * out of it — a sentence that said "your fresh server has nothing to answer
 * DASH" and then left the person there. The script is fetched on demand rather
 * than held in the card, because it is DASH's own public key and the helper's
 * bytes composed at request time: nothing about it is worth persisting, and a
 * card that carried it would be carrying it for every server whether or not this
 * one needs it.
 *
 * The disclosure copy comes from `describeSetupStep`, the same function the
 * wizard's key step uses, so the two surfaces cannot drift on what the snippet
 * promises.
 */
function SetupPanel({
  label,
  busy,
  canAct,
  fetchScript,
}: {
  label: string;
  busy: boolean;
  canAct: boolean;
  fetchScript: () => Promise<string | null>;
}): ReactNode {
  const [script, setScript] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const copy = describeSetupStep(label);
  return (
    <section className="setup-panel">
      <p className="wrap">
        <strong>{copy.headline}</strong>
      </p>
      <p className="wrap">{copy.detail}</p>
      {script === null ? (
        <button
          type="button"
          className="button-secondary"
          disabled={busy || loading || !canAct}
          onClick={() => {
            setLoading(true);
            void fetchScript().then((text) => {
              setLoading(false);
              if (text !== null) {
                setScript(text);
              }
            });
          }}
        >
          {loading ? "Writing the setup text..." : "Show the setup text"}
        </button>
      ) : (
        <>
          <p className="disclosure wrap" role="note">
            {copy.disclosure}
          </p>
          <pre className="setup-script">{script}</pre>
          <p className="next-action wrap">{copy.next_action}</p>
        </>
      )}
    </section>
  );
}

/**
 * Disconnecting, and the half of it that is easy to imply falsely.
 *
 * `describeDisconnect` is imported through the standing module rather than
 * reworded here: what it says — that anything already running on that server
 * keeps running and DASH can neither stop it nor show it — is a statement about
 * somebody's machine that a renderer must not be able to drop.
 */
function ForgetConfirmation({
  label,
  busy,
  onKeep,
  onForget,
}: {
  label: string;
  busy: boolean;
  onKeep: () => void;
  onForget: () => void;
}): ReactNode {
  const copy = describeDisconnect(label);
  return (
    <section className="notice wrap" role="alert">
      <p>
        <strong>{copy.headline}</strong>
      </p>
      <p>{copy.detail}</p>
      <div className="button-row">
        <button type="button" className="button-secondary" disabled={busy} onClick={onKeep}>
          Keep using it
        </button>
        <button type="button" className="button-primary" disabled={busy} onClick={onForget}>
          {busy ? "Disconnecting..." : "Disconnect"}
        </button>
      </div>
    </section>
  );
}
