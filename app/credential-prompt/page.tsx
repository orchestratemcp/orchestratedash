"use client";

/**
 * The credential prompt (MAR-383).
 *
 * A route in the same static export as the rest of DASH, loaded into a window
 * main opens with a different preload. It is the only page that talks to
 * `window.dashCredential`, and it does not use `useView`, `dataSource` or any
 * of the app's other data plumbing — it cannot, because the window it runs in
 * has no `dashData` bridge.
 *
 * ## The value never leaves this component
 *
 * The typed value lives in one `useState` and goes to `submit`. It is not
 * lifted, not put in a context, not logged, not echoed into a heading, and not
 * kept after submit resolves — the window is destroyed by main at that point,
 * which is a stronger guarantee than clearing the field would be.
 *
 * Everything rendered around the input comes from `describe`: a service name, a
 * field label, a purpose and the agent author's help text, all of which are
 * manifest strings that passed v2 validation and are rendered as text.
 *
 * ## Opened in a browser
 *
 * The developer path can reach this route — it is a page in the export — and
 * there is no bridge there. It says so and offers no input, which is the same
 * read-only honesty the rest of the developer path has.
 */

import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import type {
  CredentialPromptDescription,
  OAuthPromptDescription,
} from "../../lib/shell/credential-prompt";

interface CredentialBridge {
  describe(): Promise<CredentialPromptDescription | null>;
  submit(value: string): Promise<void>;
  cancel(): Promise<void>;
  authorize(): Promise<void>;
}

function bridge(): CredentialBridge | null {
  if (typeof window === "undefined") {
    return null;
  }
  return (window as unknown as { dashCredential?: CredentialBridge }).dashCredential ?? null;
}

/**
 * The sign-in mode (MAR-446).
 *
 * There is no input on this page and no `submit`. Everything it can do is press
 * one button that asks main to open a browser, or cancel — which is the whole
 * capability difference between this mode and the typed-secret one, and the
 * reason reusing the window costs nothing in surface.
 *
 * What it renders that the provider's own consent screen will not: which agent
 * wants this, why, and the permissions in DASH's plain-language words. Google's
 * screen says what Google is granting; only this can say what it is for.
 */
function AuthorizationPrompt({
  description,
  busy,
  onBusy,
}: {
  description: OAuthPromptDescription;
  busy: boolean;
  onBusy: (busy: boolean) => void;
}): ReactNode {
  // `waiting` comes back from main once the browser has been opened; `busy`
  // covers the moment between the click and that being true.
  const waiting = busy || description.waiting;

  return (
    <div className="credential-prompt">
      <h1>Connect {description.service}</h1>
      <p className="lede">{description.purpose}</p>

      {description.permissions.length > 0 ? (
        <>
          <p>
            DASH will ask {description.provider_label} to let this agent:
          </p>
          <ul className="permission-list">
            {description.permissions.map((permission) => (
              <li key={permission}>{permission}</li>
            ))}
          </ul>
        </>
      ) : null}

      {description.account_hint !== null ? (
        <p className="muted">
          DASH currently has {description.account_hint} connected. Signing in
          again replaces it.
        </p>
      ) : null}

      {description.help !== null ? <p className="muted">{description.help}</p> : null}

      <p className="muted">
        {/* Said before the browser opens, not after. A user who has already left
            for a consent screen has passed the point where this was useful. */}
        Your browser will open so you can sign in to{" "}
        {description.provider_label} directly. DASH never sees your password.
        What comes back is kept in <strong>{description.vault_label}</strong>.
      </p>

      {waiting ? (
        <p className="notice notice-ok" role="status">
          Waiting for you to finish signing in in your browser. You can come back
          here when you are done.
        </p>
      ) : null}

      <div className="button-row">
        <button
          type="button"
          className="button-secondary"
          onClick={() => {
            void bridge()?.cancel();
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          className="button-primary"
          disabled={waiting}
          onClick={() => {
            onBusy(true);
            void bridge()?.authorize();
          }}
        >
          {waiting ? "Waiting…" : `Continue to ${description.provider_label}`}
        </button>
      </div>
    </div>
  );
}

export default function CredentialPromptPage(): ReactNode {
  const [description, setDescription] = useState<CredentialPromptDescription | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const api = bridge();
    if (api === null) {
      setAvailable(false);
      return;
    }
    setAvailable(true);
    void api.describe().then(setDescription);
  }, []);

  if (available === null) {
    return <p className="lede">Opening…</p>;
  }

  if (!available) {
    return (
      <>
        <h1>Connect a service</h1>
        <p className="lede">
          This page only works inside the installed DASH app, which is the only
          place a credential can be stored safely.
        </p>
        <p className="muted">
          Nothing can be entered here. Open DASH and use{" "}
          <strong>Connections</strong>.
        </p>
      </>
    );
  }

  if (description === null) {
    return (
      <>
        <h1>Connect a service</h1>
        <p className="lede">There is nothing to connect right now.</p>
        <p className="muted">You can close this window.</p>
      </>
    );
  }

  if (description.mode === "oauth") {
    return <AuthorizationPrompt description={description} busy={busy} onBusy={setBusy} />;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const api = bridge();
    if (api === null || value === "") {
      return;
    }
    // Disabled before the await, so a double submit cannot send the value twice
    // and a slow vault write cannot look like nothing happening.
    setBusy(true);
    await api.submit(value);
  }

  return (
    <form className="credential-prompt" onSubmit={(event) => void onSubmit(event)}>
      <h1>Connect {description.service}</h1>
      <p className="lede">{description.purpose}</p>

      <label htmlFor="credential-value">{description.field_label}</label>
      <input
        id="credential-value"
        // `password`, so it is masked as it is typed and kept out of
        // screenshots and screen shares by default.
        type="password"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
        }}
        // Every one of these is a place the platform would otherwise keep a
        // copy of what was typed, offer it back on another form, or send it
        // somewhere for a spelling opinion.
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        // eslint-disable-next-line jsx-a11y/no-autofocus -- a modal that exists
        // only to take this one value; anything else would be a wasted click.
        autoFocus
        disabled={busy}
        required
      />

      {description.help !== null ? <p className="muted">{description.help}</p> : null}

      <p className="muted">
        DASH will keep this in <strong>{description.vault_label}</strong>. It is
        never written to DASH&rsquo;s own files, and never shown again after you
        save it.
      </p>

      {description.replacing ? (
        <p className="muted">
          This replaces the {description.field_label.toLowerCase()} DASH already
          holds for {description.service}.
        </p>
      ) : null}

      <div className="button-row">
        <button
          type="button"
          className="button-secondary"
          disabled={busy}
          onClick={() => {
            void bridge()?.cancel();
          }}
        >
          Cancel
        </button>
        <button type="submit" className="button-primary" disabled={busy || value === ""}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
