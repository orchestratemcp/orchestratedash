"use client";

import { useState, type ReactNode } from "react";

import {
  describeConnectState,
  describeDisconnect,
  type HostConnectState,
} from "../../lib/host-connect";
import { describeDeployArrangement } from "../../lib/deploy/receipt";
import {
  describeAdded,
  describeDeployed,
  describePin,
  describeSameServer,
  describeSignIn,
} from "../../lib/server-card";
import { describeSetupStep } from "../../lib/host-wizard";
import type { SavedServerView } from "../../lib/views/types";

/**
 * A saved server, as a card you manage (MAR-574).
 *
 * The surface the Servers route did not have. `lib/server-card.ts` owns every
 * sentence here and `lib/host-connect.ts` owns the standing; this owns the
 * order, which is the answer to the question the page is open for read top to
 * bottom:
 *
 * 1. **What is it and does it work** — the label, and the standing in its own
 *    words. The chip beside the label is the same fact at a glance.
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
 * The chip
 * ---------------------------------------------------------------------- */

/**
 * The standing at a glance, in the four tones the system already has.
 *
 * `no_runner_there` is deliberately **not** an error tone. It is what a fresh
 * server looks like, the attended run's own copy calls it *"reachable, with
 * nothing running on it"*, and colouring it red would tell somebody their
 * working server is broken on the day they rented it.
 */
export function standingChip(state: HostConnectState): { label: string; tone: string } {
  switch (state.step) {
    case "reachable":
      return { label: "Connected", tone: "chip-ok" };
    case "probing":
      return { label: "Checking", tone: "chip-muted" };
    case "not_checked":
      return { label: "Not checked", tone: "chip-muted" };
    case "unreachable":
      return state.problem === "no_runner_there"
        ? { label: "Nothing running", tone: "chip-warn" }
        : { label: "Cannot reach", tone: "chip-err" };
    case "awaiting_key_install":
      return { label: "Waiting for its key", tone: "chip-warn" };
    // MAR-572's enrollment moment, added at the MAR-574/572 merge. Warn rather
    // than error for `awaiting_key_install`'s reason: nothing is wrong, the
    // server answered and is waiting on a person — and it is the one standing
    // whose next step only the person can take.
    case "confirm_host_key":
      return { label: "Waiting for you to confirm it", tone: "chip-warn" };
    case "no_host":
      return { label: "Not connected", tone: "chip-muted" };
  }
}

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
}

export function ServerCard({
  server,
  standing,
  agents,
  busy,
  notice,
  actions,
  canAct,
}: {
  server: SavedServerView;
  standing: HostConnectState;
  /** Every agent this DASH could put on a server. Empty is a real state. */
  agents: readonly string[];
  busy: boolean;
  /** Whatever the last command said when it failed. Null when nothing did. */
  notice: string | null;
  actions: ServerCardActions;
  canAct: boolean;
}): ReactNode {
  const [confirmForget, setConfirmForget] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [chosenAgent, setChosenAgent] = useState("");

  const copy = describeConnectState(standing);
  const chip = standingChip(standing);
  const pin = describePin(server.fingerprint);
  const sameServer = describeSameServer(server.same_server_index, server.same_server_count);

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
        <p className="card-meta wrap">{describeDeployed(standing)}</p>
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
          onChoose={setChosenAgent}
          onCancel={() => {
            setDeploying(false);
          }}
          onDeploy={() => {
            actions.deploy(chosenAgent);
          }}
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
  onChoose,
  onCancel,
  onDeploy,
}: {
  server: SavedServerView;
  agents: readonly string[];
  busy: boolean;
  canAct: boolean;
  chosenAgent: string;
  onChoose: (agentId: string) => void;
  onCancel: () => void;
  onDeploy: () => void;
}): ReactNode {
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
              {agents.map((agent) => (
                <option key={agent} value={agent}>
                  {agent}
                </option>
              ))}
            </select>
          </label>
          <div className="button-row">
            <button type="button" className="button-secondary" disabled={busy} onClick={onCancel}>
              Not now
            </button>
            <button
              type="button"
              className="button-primary"
              disabled={busy || chosenAgent === "" || !canAct}
              onClick={onDeploy}
            >
              {busy ? "Putting it there..." : "Put it on this server"}
            </button>
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
