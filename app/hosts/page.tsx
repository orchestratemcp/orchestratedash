"use client";

import { useState, type ReactNode } from "react";

import {
  DEFAULT_PORT,
  EMPTY_DRAFT,
  PROVIDER_OPTIONS,
  WIZARD_STEPS,
  canLeave,
  checkDraft,
  describeHostingRecommendation,
  describeKeyStep,
  describeProviderChoice,
  describeStep,
  providerOption,
  type HostDraft,
  type ProviderId,
  type WizardStep,
} from "../../lib/host-wizard";
import {
  HOST_REACH_PROBLEMS,
  describeConnectState,
  readProbeStanding,
  type HostConnectState,
  type HostReachProblem,
} from "../../lib/host-connect";
import type { DeployStanding } from "../../lib/deploy/deploying";
import { describeDuplicateHost, findDuplicateHost } from "../../lib/hosts";
import { describeDuplicateRecords, summariseServers } from "../../lib/server-card";
import { describeDeployArrangement } from "../../lib/deploy/receipt";
import { ServerCard } from "../_components/server-card";
import { HostNotice, ViewFailed, ViewLoading } from "../_components/view-state";
import { submitHostCommand } from "../_data/source";
import { useCanAct, useHost, useView } from "../_data/use-view";
import type { SavedServerView } from "../../lib/views/types";

/**
 * Servers: manage the one you have, or connect one (MAR-498, MAR-536, MAR-574).
 *
 * ## The defect this page shipped with
 *
 * It rendered the add-a-server wizard **unconditionally**. There was no read
 * that could tell it a server had ever been saved — `readStore()` has returned
 * hosts since MAR-536 and no view projected them — so after a successful
 * connect and a restart, Henrik's real, reachable, probe-passing Hostinger box
 * was nowhere on the only page about servers, and step 1 was waiting for him
 * again as if nothing had happened.
 *
 * Nothing was lost. His store holds **four rows**, one per attempt at the
 * wizard, all one machine, because "add another" was the only thing this page
 * could do and nothing anywhere refused the second. So the page had two faults
 * and the invisible record was only the first.
 *
 * ## The two states
 *
 * > When a server is connected the Server page state should be manage that
 * > server. And once disconnected the add a server state should render.
 * > — Henrik, 2026-08-08
 *
 * Which is what this is: one read of `view.hosts` decides. With a record, the
 * page is that server — its standing, its facts, and what you can do to it. With
 * none, it is the connect flow, which is also what "connect another" opens.
 *
 * The wizard is a *mode* rather than a consequence of the store being empty.
 * Saving a record is the wizard's second step, not its last, so a page that
 * switched to manage the moment a row existed would throw somebody out of the
 * flow between minting a key and installing it.
 *
 * ## The standing is live and is not stored
 *
 * DASH records how to reach a server. It records nothing about whether that
 * worked, and nothing about what is deployed there. So every card opens in
 * `not_checked` — an honest state, not a failure — and the standing on screen is
 * only ever as old as the check that produced it. See `lib/server-card.ts`.
 */

/* ---------------------------------------------------------------------- *
 * The rail
 * ---------------------------------------------------------------------- */

export function StepRail({ current }: { current: WizardStep }): ReactNode {
  const at = WIZARD_STEPS.indexOf(current);
  return (
    <ol className="step-rail" aria-label="Steps">
      {WIZARD_STEPS.map((step, index) => {
        const state = index < at ? "done" : index === at ? "current" : "ahead";
        return (
          <li key={step} className={`step-rail-item is-${state}`}>
            {/* The number is decoration — the rail's position is already in the
                markup order and in `aria-current`. Reading "zero one" before
                every step name is noise to somebody who cannot see the rail. */}
            <span className="step-number" aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="step-name" aria-current={state === "current" ? "step" : undefined}>
              {describeStep(step).label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------------------------------------------------------------------- *
 * The steps
 * ---------------------------------------------------------------------- */

/**
 * Step 1: the form, with the provider dropdown inside it.
 *
 * This replaces the four-card provider grid entirely. Henrik used that grid five
 * times and reported what it was for:
 *
 * > We don't need different servers as examples. Just one "connect a server".
 * > Then if we want pre-filled fields we can have a dropdown once we started
 * > connecting a server.
 *
 * The grid asked a question before the flow began whose whole effect was setting
 * **one default string**. It is a convenience on a field now, and it sits after
 * the account name rather than before it, because a person who already knows
 * their account name should never have to touch it.
 */
export function AddressStep({
  draft,
  onChange,
  servers,
}: {
  draft: HostDraft;
  onChange: (next: HostDraft) => void;
  /** What DASH already has, so a duplicate is named before it is attempted. */
  servers: readonly SavedServerView[];
}): ReactNode {
  const check = checkDraft(draft);
  const touched = draft.label !== "" || draft.address !== "" || draft.username !== "";
  /*
   * MAR-574. The refusal main will give, given here while the fields are still
   * on screen. Main is the authority — this cannot be the only check, because a
   * page can be wrong about what the store holds — but a person who learns their
   * server is already saved *after* pressing "make key" has been made to wait
   * for an answer the page could see.
   */
  const duplicate =
    draft.address.trim() === "" || draft.username.trim() === ""
      ? null
      : findDuplicateHost(
          servers.map((server) => ({
            host_id: server.host_id,
            label: server.label,
            address: server.address,
            username: server.username,
            port: server.port,
            key_name: "not-read-here",
            host_fingerprint: server.fingerprint,
            added_at: server.added_at,
          })),
          { address: draft.address, username: draft.username },
        );

  return (
    <>
      <div className="field-grid">
        <label className="field-label" htmlFor="host-label">
          What you call it
          <input
            id="host-label"
            className="field"
            value={draft.label}
            placeholder="My server"
            onChange={(event) => {
              onChange({ ...draft, label: event.target.value });
            }}
          />
        </label>
        <label className="field-label" htmlFor="host-address">
          Address
          <input
            id="host-address"
            className="field"
            value={draft.address}
            placeholder="example.com"
            onChange={(event) => {
              onChange({ ...draft, address: event.target.value });
            }}
          />
        </label>
        <label className="field-label" htmlFor="host-username">
          Account on the server
          <input
            id="host-username"
            className="field"
            value={draft.username}
            placeholder="root"
            onChange={(event) => {
              onChange({ ...draft, username: event.target.value });
            }}
          />
        </label>
        <label className="field-label" htmlFor="host-provider">
          Who you rent it from
          <select
            id="host-provider"
            className="field"
            value={draft.provider ?? ""}
            onChange={(event) => {
              const picked = event.target.value === "" ? null : (event.target.value as ProviderId);
              onChange({
                ...draft,
                provider: picked,
                /*
                 * Only fills an empty field. Somebody who typed their own
                 * account name and then went looking through this list for
                 * their provider must not have it overwritten — the dropdown's
                 * whole job is to save typing, and taking a typed value away is
                 * the opposite of that.
                 */
                username:
                  picked !== null && draft.username === ""
                    ? providerOption(picked).default_username
                    : draft.username,
              });
            }}
          >
            {/* Short enough to fit the field at every width. The first draft read
                "I will type the account myself" and the packaged renderer clipped
                it to "…the account mysel" at 1280, which is the one width nobody
                thinks to check for a truncation. */}
            <option value="">I will type it myself</option>
            {PROVIDER_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label" htmlFor="host-port">
          Port
          <input
            id="host-port"
            className="field"
            value={draft.port}
            placeholder={DEFAULT_PORT}
            inputMode="numeric"
            onChange={(event) => {
              onChange({ ...draft, port: event.target.value });
            }}
          />
        </label>
      </div>

      <p className="muted wrap">
        The key goes in: {describeProviderChoice(draft.provider).where_the_key_goes}
      </p>

      {/*
        The refusal comes from `lib/hosts.ts` rather than from a second set of
        rules here, and it is shown only once somebody has typed something —
        an empty form telling you the label is wrong is a form scolding you for
        arriving.
      */}
      {touched && !check.ok ? (
        <p className="notice notice-err wrap" role="alert">
          {check.detail}
        </p>
      ) : null}

      {duplicate === null ? null : (
        <p className="notice notice-err wrap" role="alert">
          {describeDuplicateHost(duplicate.label).headline}.{" "}
          {describeDuplicateHost(duplicate.label).detail}
        </p>
      )}
    </>
  );
}

export function KeyStep({ label, publicKey }: { label: string; publicKey: string | null }): ReactNode {
  const copy = describeKeyStep(label);
  return (
    <>
      {publicKey === null ? (
        <p className="wrap">
          DASH will make a key for {label} when this step runs, and keep the private
          half on this computer.
        </p>
      ) : (
        <>
          <p className="wrap">
            <strong>{copy.headline}</strong>
          </p>
          <p className="wrap">{copy.detail}</p>
          <pre className="public-key">{publicKey}</pre>
        </>
      )}
      {/*
        Said out loud, on the step where the asking would have happened. This is
        the one sentence on the page that is about something DASH does *not* do,
        and it is the reason the flow is shaped this way at all.
      */}
      <p className="disclosure wrap" role="note">
        {copy.refusal}
      </p>
    </>
  );
}

export function CheckStep({ state }: { state: HostConnectState }): ReactNode {
  const copy = describeConnectState(state);
  return (
    <>
      <p className="wrap">
        <strong>{copy.headline}</strong>
      </p>
      <p className="wrap">{copy.detail}</p>
      {copy.next_action === null ? null : (
        <p className="next-action wrap">{copy.next_action}</p>
      )}
      {state.step === "reachable" ? <DeployArrangement label={state.label} /> : null}
    </>
  );
}

/**
 * The receipt `lib/deploy/bundle.ts` has built since MAR-487.
 *
 * Here rather than at the deploy, and that is ADR 0007's own requirement: the
 * while-closed sentence is *"said before the first deploy"*, and the moment a
 * server becomes reachable is the last point at which that is still true. A
 * disclosure that arrives with the confirm dialog describes a window the person
 * has already decided to enter.
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
 * The person who does not own a server (MAR-574, Henrik's own words).
 *
 * Two rules from the ratified plan, both visible in the order of this block:
 *
 * 1. **The free local path is stated first and is not a footnote.** Hosting must
 *    never read as required, because it is not — agents run on this computer and
 *    always have.
 * 2. **The outbound link is not here yet.** It is an affiliate link and the plan
 *    puts it after the attended proof passes (MAR-489). What renders is the
 *    label as text.
 *
 * TODO-affiliate (MAR-485, gated on MAR-489): this is where the outbound link
 * goes. It cannot simply become an `<a href>` — `createWindow` in
 * `electron/main.ts` denies window-open and blocks navigation away from the
 * renderer's own origin, so an anchor here would do *nothing* in the installed
 * app while looking like a control. Wiring it needs a command that reaches
 * `shell.openExternal` in main, which is a review event and belongs with the
 * issue that adds the real URL. Text until then, deliberately, because a dead
 * button is worse than a sentence.
 */
function NoServerYet(): ReactNode {
  const copy = describeHostingRecommendation();
  return (
    <section className="hosting-note">
      <p className="wrap">{copy.free_path}</p>
      <p className="wrap">
        <strong>{copy.question}</strong> {copy.recommendation}
      </p>
      <p className="muted wrap">{copy.link_label} — coming soon.</p>
    </section>
  );
}

/* ---------------------------------------------------------------------- *
 * Connecting one
 * ---------------------------------------------------------------------- */

function ConnectServer({
  servers,
  canAct,
  onSaved,
  onLeave,
}: {
  servers: readonly SavedServerView[];
  canAct: boolean;
  /** A record now exists or was removed — the page should re-read. */
  onSaved: () => void;
  /** Null when there is nothing to go back to, which is the first-run case. */
  onLeave: (() => void) | null;
}): ReactNode {
  const [step, setStep] = useState<WizardStep>("address");
  const [draft, setDraft] = useState<HostDraft>(EMPTY_DRAFT);
  const [hostId, setHostId] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [checkState, setCheckState] = useState<HostConnectState>({ step: "no_host" });
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const at = WIZARD_STEPS.indexOf(step);
  const label = draft.label.trim() === "" ? "this server" : draft.label.trim();

  function reachProblem(value: unknown): HostReachProblem | null {
    return typeof value === "string" && HOST_REACH_PROBLEMS.includes(value as HostReachProblem)
      ? (value as HostReachProblem)
      : null;
  }

  async function makeKey(): Promise<void> {
    setBusy(true);
    setNotice(null);
    const result = await submitHostCommand("create", {
      label: draft.label,
      address: draft.address,
      username: draft.username,
      port: Number(draft.port),
    });
    setBusy(false);

    const madeHostId = result.data?.["host_id"];
    const madePublicKey = result.data?.["public_key"];
    if (!result.ok || typeof madeHostId !== "string" || typeof madePublicKey !== "string") {
      setNotice(result.detail ?? "DASH could not make a key for this server.");
      return;
    }

    setHostId(madeHostId);
    setPublicKey(madePublicKey);
    setCheckState({ step: "awaiting_key_install", label, public_key: madePublicKey });
    setStep("key");
    // The record exists from here on. The page re-reads so that leaving the flow
    // at any later point lands on a manage surface that already knows about it.
    onSaved();
  }

  async function probe(): Promise<void> {
    if (hostId === null) {
      setNotice("DASH has no saved server to check.");
      return;
    }
    setBusy(true);
    setNotice(null);
    setStep("check");
    setCheckState({ step: "probing", label });
    const result = await submitHostCommand("probe", { host_id: hostId });
    setBusy(false);

    if (result.ok) {
      const runnerBuild = result.data?.["runner_build"];
      const running = result.data?.["agents_running"];
      setCheckState({
        step: "reachable",
        label,
        runner_build: typeof runnerBuild === "string" && runnerBuild !== "" ? runnerBuild : null,
        agents_running: typeof running === "number" ? running : 0,
      });
      return;
    }

    const problem = reachProblem(result.data?.["problem"]);
    if (problem !== null) {
      setCheckState({ step: "unreachable", label, problem });
      return;
    }

    // SSH diagnostics can name an account, address, port and local key path.
    // Keep the key state visible and show the transport's safe sentence below.
    setCheckState(
      publicKey === null
        ? { step: "no_host" }
        : { step: "awaiting_key_install", label, public_key: publicKey },
    );
    setNotice(result.detail ?? "DASH could not check this server.");
  }

  /**
   * Going back from the key step throws the record away, and that is deliberate.
   *
   * A key was minted for an address the person is now changing. Keeping the row
   * would leave exactly the orphan MAR-574 is about — a record nobody meant to
   * keep, with its own key — and the next attempt would then be refused as a
   * duplicate of a server that was never really added.
   */
  async function forgetAndGoBack(): Promise<void> {
    if (hostId === null) {
      setStep("address");
      return;
    }
    setBusy(true);
    setNotice(null);
    const result = await submitHostCommand("forget", { host_id: hostId });
    setBusy(false);
    if (!result.ok) {
      setNotice(result.detail ?? "DASH could not forget this server safely.");
      return;
    }
    setHostId(null);
    setPublicKey(null);
    setCheckState({ step: "no_host" });
    setStep("address");
    onSaved();
  }

  return (
    <>
      <StepRail current={step} />

      <article className="row-card wizard-card">
        <div className="card-head">
          <h2>{describeStep(step).label}</h2>
          <span className="chips">
            <span className="chip chip-muted">
              step {at + 1} of {WIZARD_STEPS.length}
            </span>
          </span>
        </div>

        <p className="connection-purpose wrap">{describeStep(step).purpose}</p>

        {step === "address" ? (
          <AddressStep draft={draft} onChange={setDraft} servers={servers} />
        ) : step === "key" ? (
          <KeyStep label={label} publicKey={publicKey} />
        ) : (
          <CheckStep state={checkState} />
        )}

        {notice === null ? null : (
          <p className="notice notice-err wrap" role="alert">
            {notice}
          </p>
        )}

        <div className="button-row">
          {step === "key" ? (
            <button
              type="button"
              className="button-secondary"
              disabled={busy}
              onClick={() => void forgetAndGoBack()}
            >
              Back
            </button>
          ) : step === "address" && onLeave !== null ? (
            <button type="button" className="button-secondary" disabled={busy} onClick={onLeave}>
              Cancel
            </button>
          ) : null}

          {step === "address" ? (
            <button
              type="button"
              className="button-primary"
              disabled={busy || !canLeave(step, draft) || !canAct}
              onClick={() => void makeKey()}
            >
              {busy ? "Making key..." : "Make key"}
            </button>
          ) : step === "key" ? (
            <button
              type="button"
              className="button-primary"
              disabled={busy || hostId === null || publicKey === null}
              onClick={() => void probe()}
            >
              {busy ? "Checking..." : "Check the connection"}
            </button>
          ) : (
            /*
              The end of the flow, and it goes to the server rather than to
              nothing. Whatever the check said, a record exists and the manage
              card is where every next action about it lives — including the
              ones for a check that failed.
            */
            <button
              type="button"
              className="button-primary"
              disabled={busy}
              onClick={() => {
                onSaved();
                onLeave?.();
              }}
            >
              Done
            </button>
          )}
        </div>
      </article>

      {step === "address" ? <NoServerYet /> : null}
    </>
  );
}

/**
 * Why the same server is on this page more than once (MAR-574).
 *
 * Rendered once above the list rather than on each card in the group. The
 * decision it explains is the issue's own instruction: do not delete Henrik's
 * four rows silently. They are real data with real keys, and saying so is what
 * turns "DASH shows this twice" from a bug into a decision the reader can see.
 */
function DuplicateNotice(): ReactNode {
  const copy = describeDuplicateRecords();
  return (
    <section className="notice wrap" role="note">
      <p>
        <strong>{copy.headline}</strong>
      </p>
      <p>{copy.detail}</p>
      <p className="next-action">{copy.next_action}</p>
    </section>
  );
}

/* ---------------------------------------------------------------------- *
 * The page
 * ---------------------------------------------------------------------- */

export default function HostsPage(): ReactNode {
  const canAct = useCanAct();
  const host = useHost();
  const [revision, setRevision] = useState(0);
  const state = useView((source) => source.hosts(), revision);
  const agents = useView((source) => source.agents(), revision);

  /** Null means "show whatever the store implies"; a value is a deliberate mode. */
  const [connecting, setConnecting] = useState<boolean | null>(null);

  /*
   * The standing per server, held in page state and never stored.
   *
   * DASH records how to reach a server and records nothing about whether that
   * worked. So this map begins empty, every card opens in `not_checked`, and a
   * standing on screen is exactly as old as the check that produced it. A stored
   * one would be a number that keeps looking true after it stops being true,
   * which is the failure the whole page exists to fix.
   */
  const [standings, setStandings] = useState<Record<string, HostConnectState>>({});
  const [busyHost, setBusyHost] = useState<string | null>(null);
  const [notices, setNotices] = useState<Record<string, string>>({});
  /*
   * When each standing above was given, and how each card's last deploy went
   * (MAR-577).
   *
   * Both live beside the standing rather than in the store, and for its reason:
   * DASH records nothing about a check and nothing about a deploy, so a value
   * that outlived the visit would be a claim with nothing left to check it.
   */
  const [checkedAt, setCheckedAt] = useState<Record<string, string>>({});
  const [deploys, setDeploys] = useState<Record<string, DeployStanding>>({});

  function setStanding(hostId: string, standing: HostConnectState): void {
    setStandings((current) => ({ ...current, [hostId]: standing }));
  }

  /** Stamped when a *server's answer* arrives, never when a check begins. */
  function stampChecked(hostId: string): void {
    setCheckedAt((current) => ({ ...current, [hostId]: new Date().toISOString() }));
  }

  function setNotice(hostId: string, detail: string | null): void {
    setNotices((current) => {
      const next = { ...current };
      if (detail === null) {
        delete next[hostId];
      } else {
        next[hostId] = detail;
      }
      return next;
    });
  }

  async function check(server: SavedServerView): Promise<void> {
    setBusyHost(server.host_id);
    setNotice(server.host_id, null);
    setStanding(server.host_id, { step: "probing", label: server.label });
    const result = await submitHostCommand("probe", { host_id: server.host_id });
    setBusyHost(null);

    /*
     * MAR-577. One reading of a probe's answer, shared with the agent page's own
     * deploy section — see `readProbeStanding`. Null is the case that matters:
     * a refusal the transport could not classify goes back to not-checked rather
     * than to any of the nine problems, because naming one DASH did not
     * establish sends somebody to fix a thing that is not broken.
     */
    const standing = readProbeStanding(server.label, result);
    if (standing === null) {
      setStanding(server.host_id, { step: "not_checked", label: server.label });
      setNotice(server.host_id, result.detail ?? "DASH could not check this server.");
      return;
    }
    setStanding(server.host_id, standing);
    stampChecked(server.host_id);
  }

  async function deploy(server: SavedServerView, agentId: string): Promise<void> {
    setBusyHost(server.host_id);
    setNotice(server.host_id, null);
    /*
     * The in-flight state, said rather than implied by a disabled button
     * (MAR-577). Installing a bundle over SSH takes long enough that a control
     * which simply greyed out reads as a page that has stopped responding —
     * which is how somebody comes to press it again, or to close DASH mid-push.
     */
    setDeploys((current) => ({
      ...current,
      [server.host_id]: { step: "sending", agent: agentId, server: server.label },
    }));
    const result = await submitHostCommand("deploy", {
      host_id: server.host_id,
      agent_id: agentId,
    });
    setBusyHost(null);
    if (!result.ok) {
      /*
       * Main's own sentence, in the deploy's own place rather than in the card's
       * general notice. That is what puts `MANIFEST_ONLY_DEPLOY_REFUSAL` and a
       * refused sign-in where the person is looking, under the control they just
       * pressed, with the one next action DASH can honestly offer.
       */
      setDeploys((current) => ({
        ...current,
        [server.host_id]: {
          step: "failed",
          agent: agentId,
          server: server.label,
          detail: result.detail ?? "DASH could not put that agent on this server.",
        },
      }));
      return;
    }
    setDeploys((current) => ({
      ...current,
      [server.host_id]: { step: "sent", agent: agentId, server: server.label },
    }));
    // Ask the server what it has now rather than assuming the deploy's own
    // answer. The card's count is the host's report, and this is how it stays
    // one — see `describeDeployed`.
    void check(server);
  }

  async function forget(server: SavedServerView): Promise<void> {
    setBusyHost(server.host_id);
    setNotice(server.host_id, null);
    const result = await submitHostCommand("forget", { host_id: server.host_id });
    setBusyHost(null);
    if (!result.ok) {
      setNotice(server.host_id, result.detail ?? "DASH could not forget this server safely.");
      return;
    }
    setRevision((current) => current + 1);
  }

  const servers = state.status === "ready" ? state.data.servers : [];
  /*
   * MAR-577. The name *and* whether DASH could send it. A list of names could
   * not tell a deployable agent from a migrated one, so the panel had nowhere to
   * put the refusal until the press had already happened.
   */
  const agentChoices =
    agents.status === "ready"
      ? agents.data.agents.map((agent) => ({ name: agent.name, deploy: agent.deploy }))
      : [];
  const showConnect = connecting ?? servers.length === 0;

  return (
    <>
      <h1>Servers</h1>
      <p className="lede">
        Put an agent on a server and it keeps working when DASH is closed. DASH
        reaches out to the server; the server never reaches back.
      </p>
      <HostNotice host={host} />

      {state.status === "loading" ? (
        <ViewLoading what="the servers you have connected" />
      ) : state.status === "failed" ? (
        <ViewFailed recovery={state.recovery} />
      ) : showConnect ? (
        <ConnectServer
          servers={servers}
          canAct={canAct}
          onSaved={() => {
            setRevision((current) => current + 1);
          }}
          onLeave={
            servers.length === 0
              ? null
              : () => {
                  setConnecting(false);
                }
          }
        />
      ) : (
        <>
          {/* Counted rather than asserted, so this line cannot drift from the
              cards under it — the failure mode of every hand-written summary
              that has ever sat at the top of a list. */}
          <p className="page-summary wrap">{summariseServers(servers)}</p>

          {/* Said once, above the list, rather than repeated on every card that
              is part of a group. Each card carries only which of them it is. */}
          {servers.some((server) => server.same_server_count > 1) ? <DuplicateNotice /> : null}

          <ul className="row-list">
            {servers.map((server) => (
              <li key={server.host_id}>
                <ServerCard
                  server={server}
                  standing={standings[server.host_id] ?? { step: "not_checked", label: server.label }}
                  checkedAt={checkedAt[server.host_id] ?? null}
                  agents={agentChoices}
                  busy={busyHost === server.host_id}
                  notice={notices[server.host_id] ?? null}
                  deploy={deploys[server.host_id] ?? null}
                  canAct={canAct}
                  actions={{
                    check: () => void check(server),
                    deploy: (agentId) => void deploy(server, agentId),
                    forget: () => void forget(server),
                  }}
                />
              </li>
            ))}
          </ul>

          <div className="button-row">
            <button
              type="button"
              className="button-secondary"
              onClick={() => {
                setConnecting(true);
              }}
            >
              Connect another server
            </button>
          </div>
        </>
      )}

      {canAct ? null : (
        <p className="notice wrap" role="note">
          This window can show servers and cannot connect one. Open the installed DASH app to make a
          key, save a server and check it.
        </p>
      )}
    </>
  );
}
