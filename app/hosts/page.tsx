"use client";

import { useState, type ReactNode } from "react";

import {
  DEFAULT_PORT,
  EMPTY_DRAFT,
  PROVIDER_CARDS,
  WIZARD_STEPS,
  canLeave,
  checkDraft,
  describeKeyStep,
  describeStep,
  providerCard,
  type HostDraft,
  type ProviderId,
  type WizardStep,
} from "../../lib/host-wizard";
import { describeConnectState, type HostConnectState } from "../../lib/host-connect";
import { describeDeployArrangement } from "../../lib/deploy/receipt";
import { useCanAct } from "../_data/use-view";

/**
 * Connect a server (MAR-498).
 *
 * The surface half of ADR 0007, and the first thing in DASH that is a *guided
 * flow* rather than a page with a form on it. Four steps, drawn in the
 * Bit-Command system MAR-528 adopted: a numbered rail, provider cards, an inset
 * field, and a receipt.
 *
 * `lib/host-wizard.ts` owns the steps and their copy; `lib/host-connect.ts` owns
 * what a connected host's states say; `lib/hosts.ts` owns the record's own
 * refusals, which this calls rather than re-implements.
 *
 * ## The inversion, on the step where the asking would have happened
 *
 * The concept screen has an `SSH_PRIVATE_KEY` textarea with a
 * `-----BEGIN OPENSSH PRIVATE KEY-----` placeholder. **DASH does not draw that
 * field and will not.** MAR-484 made key custody structural rather than a
 * policy: `electron/ssh-host.ts` has no function that returns a private key and
 * a test asserts that over the module's exports. A paste field would hand DASH
 * the one secret it has arranged not to be able to read.
 *
 * So step 3 shows the **public** half and where to put it, and it says the
 * refusal out loud rather than simply not asking. Somebody who has connected a
 * server before expects to be asked; a flow that quietly does not ask reads as
 * one that forgot.
 *
 * ## What this build cannot do yet, said on the surface
 *
 * There is no host command family. `lib/shell/ipc.ts` has five — Agent DOM,
 * agent commands, runner lifecycle, workspace and connections — and none of them
 * reaches `electron/ssh-host.ts`, so nothing here can mint a key, write a record
 * or run a probe. That is MAR-536.
 *
 * The page says so, in the place where the effect would have happened, rather
 * than presenting a Next button that does nothing. It is the same read-only
 * honesty `useCanAct` already gives the developer path, extended to a capability
 * that is missing from every build rather than from this window.
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

function ProviderStep({
  draft,
  onPick,
}: {
  draft: HostDraft;
  onPick: (id: ProviderId) => void;
}): ReactNode {
  return (
    <>
      <div className="provider-grid">
        {PROVIDER_CARDS.map((card) => {
          const chosen = draft.provider === card.id;
          return (
            <button
              key={card.id}
              type="button"
              className={chosen ? "provider-card is-chosen" : "provider-card"}
              aria-pressed={chosen}
              onClick={() => onPick(card.id)}
            >
              <span className="provider-name">{card.label}</span>
              <span className="provider-user">
                {card.default_username === null
                  ? "You tell DASH the account"
                  : `Signs in as ${card.default_username}`}
              </span>
            </button>
          );
        })}
      </div>
      {draft.provider === null ? null : (
        <p className="muted wrap">
          The key goes in: {providerCard(draft.provider).where_the_key_goes}
        </p>
      )}
    </>
  );
}

function AddressStep({
  draft,
  onChange,
}: {
  draft: HostDraft;
  onChange: (next: HostDraft) => void;
}): ReactNode {
  const check = checkDraft(draft);
  const touched = draft.label !== "" || draft.address !== "" || draft.username !== "";

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
            onChange={(event) => onChange({ ...draft, label: event.target.value })}
          />
        </label>
        <label className="field-label" htmlFor="host-address">
          Address
          <input
            id="host-address"
            className="field"
            value={draft.address}
            placeholder="example.com"
            onChange={(event) => onChange({ ...draft, address: event.target.value })}
          />
        </label>
        <label className="field-label" htmlFor="host-username">
          Account on the server
          <input
            id="host-username"
            className="field"
            value={draft.username}
            placeholder="root"
            onChange={(event) => onChange({ ...draft, username: event.target.value })}
          />
        </label>
        <label className="field-label" htmlFor="host-port">
          Port
          <input
            id="host-port"
            className="field"
            value={draft.port}
            placeholder={DEFAULT_PORT}
            inputMode="numeric"
            onChange={(event) => onChange({ ...draft, port: event.target.value })}
          />
        </label>
      </div>
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
 * The receipt `lib/deploy/bundle.ts` has built since MAR-487 and that rendered
 * nowhere.
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

/* ---------------------------------------------------------------------- *
 * The page
 * ---------------------------------------------------------------------- */

export default function HostsPage(): ReactNode {
  const canAct = useCanAct();
  const [step, setStep] = useState<WizardStep>("provider");
  const [draft, setDraft] = useState<HostDraft>(EMPTY_DRAFT);

  const at = WIZARD_STEPS.indexOf(step);
  const label = draft.label.trim() === "" ? "this server" : draft.label.trim();

  /*
   * No host bridge exists in any build (MAR-536), so the probe cannot run and
   * no key can be minted. The state is fixed at `probing`'s honest neighbour —
   * nothing has been checked — and the notice below says why rather than a
   * button pretending otherwise.
   */
  const checkState: HostConnectState = { step: "no_host" };

  return (
    <>
      <h1>Servers</h1>
      <p className="lede">
        Put an agent on a server and it keeps working when DASH is closed. DASH
        reaches out to the server; the server never reaches back.
      </p>

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

        {step === "provider" ? (
          <ProviderStep
            draft={draft}
            onPick={(id) =>
              setDraft((current) => ({
                ...current,
                provider: id,
                // Only fills an empty field. Somebody who typed their own
                // account name and then went back a step should not have it
                // overwritten by a default.
                username:
                  current.username === ""
                    ? (providerCard(id).default_username ?? "")
                    : current.username,
              }))
            }
          />
        ) : step === "address" ? (
          <AddressStep draft={draft} onChange={setDraft} />
        ) : step === "key" ? (
          <KeyStep label={label} publicKey={null} />
        ) : (
          <CheckStep state={checkState} />
        )}

        <div className="button-row">
          {at === 0 ? null : (
            <button
              type="button"
              className="button-secondary"
              onClick={() => setStep(WIZARD_STEPS[at - 1] as WizardStep)}
            >
              Back
            </button>
          )}
          {at === WIZARD_STEPS.length - 1 ? null : (
            <button
              type="button"
              className="button-primary"
              disabled={!canLeave(step, draft)}
              onClick={() => setStep(WIZARD_STEPS[at + 1] as WizardStep)}
            >
              Next
            </button>
          )}
        </div>
      </article>

      {/*
        The gap, named where the effect would have happened rather than in a
        commit message. `useCanAct` is checked too, because a browser tab cannot
        act either and the two absences have different fixes — one is a missing
        command family and the other is the window you are in.
      */}
      <p className="notice wrap" role="note">
        {canAct
          ? "DASH cannot finish this yet. Making the key, saving the server and checking the connection all need a part of DASH that is not built: everything above is the flow, and nothing here has reached a server."
          : "This window can show the flow and cannot cause anything. Open DASH itself to connect a server — and note that DASH cannot finish this yet either, because the part that reaches a server is not built."}
      </p>
    </>
  );
}
