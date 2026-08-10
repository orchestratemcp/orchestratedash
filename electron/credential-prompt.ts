/**
 * The window a credential is typed into, or a sign-in is approved from
 * (MAR-383, extended by MAR-446).
 *
 * One modal window, opened by main, closed by main, alive only for the length of
 * one `connect`. It has its own preload (`electron/credential-preload.ts`) and
 * therefore its own, disjoint capability: it can submit a secret or start a
 * sign-in, and it cannot do anything else.
 *
 * ## Why OAuth reuses this window rather than getting its own
 *
 * MAR-446 warns against letting the OAuth window become a second place
 * agent-supplied content is rendered. The strongest answer to that is not a
 * second carefully-written window — it is no second window. This one already
 * renders nothing but manifest strings that passed v2 validation, already has a
 * preload with no `dashData` and no `dashShell`, and is already sender-checked
 * on every channel. The OAuth mode adds a page that renders *less*: no input at
 * all, and a permission list written by DASH rather than by anyone else.
 *
 * The consent screen itself is not here and cannot be. It is the provider's own
 * page in the user's own browser — see `electron/oauth-session.ts`.
 *
 * ## Why the request lives here and not in the URL
 *
 * The window is told *nothing* by its URL — no agent id, no connection id, no
 * service name, and for OAuth no provider or scope. It asks main what it is for,
 * over `describe`, and main answers from the request it is currently holding. So
 * a page loaded at the prompt's route with no request pending renders nothing,
 * can submit nothing and can authorize nothing.
 *
 * ## The sender check
 *
 * Every handler verifies the event came from the prompt window's own
 * `webContents`. Without it, the app window — which has no `dashCredential`
 * bridge, but does run script — would still be able to reach these channels
 * through any future bridge that exposed `invoke`. The check means the
 * credential channels answer exactly one renderer, and it is one main created.
 */

import { BrowserWindow, ipcMain, session } from "electron";
import { fileURLToPath } from "node:url";

import {
  CREDENTIAL_AUTHORIZE_CHANNEL,
  CREDENTIAL_CANCEL_CHANNEL,
  CREDENTIAL_DESCRIBE_CHANNEL,
  CREDENTIAL_PROMPT_ROUTE,
  CREDENTIAL_SUBMIT_CHANNEL,
  type CredentialPromptDescription,
} from "../lib/shell/credential-prompt";
import { aiProviderById } from "../lib/ai/providers";
import type { AuthorizationOutcome } from "../lib/connection-actions";
import type { CredentialTarget } from "../lib/connection-credentials";
import { describePermissions, oauthProviderById } from "../lib/oauth/providers";
import { startAuthorization, type AuthorizationSession } from "./oauth-session";
import { serveRendererIn } from "./renderer-host";

/**
 * What a prompt produced. One of two shapes, because the two modes settle with
 * different things — a typed value, or the result of a browser flow.
 */
type PromptResolution =
  | { kind: "secret"; value: string | null }
  | { kind: "oauth"; outcome: AuthorizationOutcome };

/**
 * What main holds about an OAuth prompt, beyond what the page renders.
 *
 * The provider id, the scopes and the login hint are resolved from the validated
 * manifest before the window opens and are deliberately *not* part of what
 * `describe` was designed to carry — the renderer gets `provider_label` and
 * plain-language `permissions`, and could not name a scope if it wanted to.
 */
interface PendingOAuthDescription {
  mode: "oauth";
  provider_id: string;
  scopes: readonly string[];
  login_hint: string | null;
}

/**
 * The prompt in flight, or null.
 *
 * At most one, and main is the only writer. A second `connect` while one is open
 * is refused by the modal itself — the parent window cannot be clicked — so this
 * never needs to be a queue.
 */
interface PendingPrompt {
  window: BrowserWindow;
  /** What the page renders. Exactly what `describe` returns. */
  description: CredentialPromptDescription;
  /** Main's own half of an OAuth request. Never sent to the renderer. */
  oauth: PendingOAuthDescription | null;
  /** Called exactly once. */
  settle(resolution: PromptResolution): void;
  /** The sign-in in progress, once the user has started one. */
  session: AuthorizationSession | null;
}

let pending: PendingPrompt | null = null;

/**
 * Largest credential the prompt will accept.
 *
 * API keys and tokens are hundreds of characters at the outside. The cap is here
 * so a scripted `submit` cannot hand main an arbitrarily large string to push
 * through `safeStorage` and onto disk.
 */
const MAX_SECRET_LENGTH = 8 * 1024;

function fromPrompt(sender: Electron.WebContents): boolean {
  return pending !== null && !pending.window.isDestroyed() && pending.window.webContents === sender;
}

/**
 * Register the four credential channels.
 *
 * Called once at startup beside the command and read channels. Registering them
 * unconditionally — rather than per prompt — keeps `ipcMain.handle` calls in one
 * place and means a stray message when no prompt is open is answered with a
 * refusal instead of reaching a handler that was never removed.
 */
export function registerCredentialChannels(): void {
  ipcMain.handle(CREDENTIAL_DESCRIBE_CHANNEL, (event) => {
    if (!fromPrompt(event.sender)) {
      return null;
    }
    return pending?.description ?? null;
  });

  ipcMain.handle(CREDENTIAL_SUBMIT_CHANNEL, (event, value: unknown) => {
    if (!fromPrompt(event.sender)) {
      return;
    }
    const prompt = pending;
    // A typed value is meaningless to an OAuth prompt, and accepting one would
    // mean a page that could talk its way into the typed-secret path for a field
    // the manifest declared as a sign-in.
    if (prompt === null || prompt.description.mode !== "secret") {
      return;
    }
    if (typeof value !== "string" || value === "" || value.length > MAX_SECRET_LENGTH) {
      // Not echoed, not measured in the log, not described. A rejected value is
      // still a value someone typed.
      return;
    }
    prompt.settle({ kind: "secret", value });
  });

  ipcMain.handle(CREDENTIAL_AUTHORIZE_CHANNEL, async (event) => {
    if (!fromPrompt(event.sender)) {
      return;
    }
    const prompt = pending;
    if (prompt === null || prompt.oauth === null || prompt.description.mode !== "oauth") {
      return;
    }
    // One sign-in per prompt. A second press while a browser tab is already open
    // would bind a second port and leave the first waiting for a redirect that
    // is never coming.
    if (prompt.session !== null) {
      return;
    }

    const provider = oauthProviderById(prompt.oauth.provider_id);
    if (provider === null) {
      prompt.settle({ kind: "oauth", outcome: { ok: false, code: "provider_error" } });
      return;
    }

    prompt.session = startAuthorization(provider, prompt.oauth.scopes, prompt.oauth.login_hint);
    // Reflected back through `describe` so a re-render shows the waiting state
    // rather than the button the user already pressed.
    prompt.description.waiting = true;

    const outcome = await prompt.session.outcome;
    prompt.settle({ kind: "oauth", outcome });
  });

  ipcMain.handle(CREDENTIAL_CANCEL_CHANNEL, (event) => {
    if (!fromPrompt(event.sender)) {
      return;
    }
    const prompt = pending;
    if (prompt === null) {
      return;
    }
    if (prompt.description.mode === "oauth") {
      // Releases the loopback port and ends the wait. Without it, cancelling
      // during a sign-in would leave a bound port until the five-minute timeout.
      prompt.session?.cancel();
      prompt.settle({ kind: "oauth", outcome: { ok: false, code: "cancelled" } });
      return;
    }
    prompt.settle({ kind: "secret", value: null });
  });
}

/**
 * Open the window and run it to a resolution.
 *
 * Shared by both modes, because everything about the window except its size is
 * the same: the preload, the isolation, the fresh partition, the two navigation
 * escapes closed, and a close-is-a-cancel handler without which the promise
 * would never settle.
 */
function openPrompt(
  description: CredentialPromptDescription,
  oauth: PendingOAuthDescription | null,
  height: number,
  parent: BrowserWindow | null,
  rendererOrigin: string,
): Promise<PromptResolution> {
  return new Promise<PromptResolution>((resolve) => {
    // One partition per prompt, named once so the session can be taught the
    // app's scheme before the window is told to navigate to it.
    const partition = `credential-prompt-${String(Date.now())}`;
    serveRendererIn(session.fromPartition(partition));

    const window = new BrowserWindow({
      width: 520,
      height,
      parent: parent ?? undefined,
      modal: parent !== null,
      show: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      // No menu bar on a dialog. It would carry the app's menu, including items
      // that navigate — in a window whose whole point is that it does one thing.
      autoHideMenuBar: true,
      title: `Connect ${description.service}`,
      webPreferences: {
        // `import.meta.url`, not `__dirname`: this file is bundled into
        // `main.mjs`, which is ESM, where `__dirname` does not exist at all. It
        // threw a `ReferenceError` the moment the prompt was opened, so the
        // window was never constructed and the caller waited on a promise that
        // could not settle — every connection attempt hung with nothing on
        // screen. See `electron/README.md` and `main.ts`, which resolve the
        // shell's own preload the same way and for the same reason.
        preload: fileURLToPath(new URL("./credential-preload.js", import.meta.url)),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // Nothing on this page needs to remember anything between prompts, and a
        // session that persisted would be a place a typed value could be cached
        // by the form-history the platform provides for free.
        partition,
        spellcheck: false,
      },
    });

    let settled = false;
    const settle = (resolution: PromptResolution): void => {
      if (settled) {
        return;
      }
      settled = true;
      pending = null;
      if (!window.isDestroyed()) {
        window.destroy();
      }
      resolve(resolution);
    };

    const prompt: PendingPrompt = { window, description, oauth, settle, session: null };
    pending = prompt;

    // A window closed with the X is a cancel, not a hang. Without this the
    // promise never settles and the Connection Center waits forever.
    window.on("closed", () => {
      prompt.session?.cancel();
      settle(
        description.mode === "oauth"
          ? { kind: "oauth", outcome: { ok: false, code: "cancelled" } }
          : { kind: "secret", value: null },
      );
    });

    // The same two escapes the app window closes, closed again here rather than
    // assumed. This window has the credential bridge; it is the last one that
    // should be able to navigate somewhere else while holding it.
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, url) => {
      if (!url.startsWith(`${rendererOrigin}${CREDENTIAL_PROMPT_ROUTE}`)) {
        event.preventDefault();
        console.warn("[dash-shell] blocked navigation away from the credential prompt");
      }
    });

    window.once("ready-to-show", () => {
      window.show();
    });

    // Not `void`: a discarded rejection here is how this window came to sit
    // blank and silent. If the page cannot load there is nothing to type into,
    // so the prompt cancels rather than waiting for an answer it cannot collect.
    window.loadURL(`${rendererOrigin}${CREDENTIAL_PROMPT_ROUTE}`).catch((error: unknown) => {
      console.error(
        `[dash-shell] the credential prompt could not load its page: ${String(error)}`,
      );
      settle(
        description.mode === "oauth"
          ? { kind: "oauth", outcome: { ok: false, code: "prompt_unavailable" } }
          : { kind: "secret", value: null },
      );
    });
  });
}

/**
 * Ask the user for one credential.
 *
 * Resolves with the value, or null if they cancelled or closed the window. The
 * value is returned to `performConnectionAction`, which puts it in the vault —
 * it is not stored here, not held after this resolves, and not logged anywhere
 * on the way.
 */
export async function promptForSecret(
  /**
   * Narrowed to the five fields the prompt renders (MAR-588).
   *
   * It took a whole `CredentialTarget` until MAR-588 needed the same window for
   * a credential that belongs to no agent and no declared connection — the
   * Discord channel address, which is a property of the person. Widening the
   * type would have meant inventing an `agent_id` and a `connection_id` for
   * something that has neither, which is the kind of placeholder that later gets
   * looked up.
   *
   * A `Pick` rather than a new interface, so `CredentialTarget` still satisfies
   * it structurally and every existing caller is unchanged. Nothing was added to
   * what this window can render: these are exactly the fields it already read.
   */
  target: Pick<
    CredentialTarget,
    "service" | "field_label" | "purpose" | "help" | "ai_provider_id"
  >,
  vaultLabel: string,
  replacing: boolean,
  parent: BrowserWindow | null,
  rendererOrigin: string,
): Promise<string | null> {
  // MAR-582. For a model provider DASH is a client for, DASH knows where a key
  // comes from even when the agent's author did not say — and the moment a
  // person is being asked to paste one is the moment that sentence is worth
  // something. The author's own words still win: this is a fallback for a null,
  // not an override, so an author who wrote better guidance keeps it.
  const help =
    target.help ?? aiProviderById(target.ai_provider_id)?.key_source ?? null;

  const resolution = await openPrompt(
    {
      mode: "secret",
      service: target.service,
      field_label: target.field_label,
      purpose: target.purpose,
      help,
      vault_label: vaultLabel,
      replacing,
    },
    null,
    480,
    parent,
    rendererOrigin,
  );
  return resolution.kind === "secret" ? resolution.value : null;
}

/**
 * Show what is about to be granted, then run the provider sign-in (MAR-446).
 *
 * The window opens *before* the browser does, deliberately. A Connect button
 * that threw the user straight at a Google consent screen would mean the only
 * explanation of why an agent wants their mail is written by Google, in terms of
 * scopes, with no mention of the agent — and a user who arrived there without
 * being told what DASH was about to ask for has been surprised by their own
 * click.
 */
export async function promptForAuthorization(
  target: CredentialTarget,
  vaultLabel: string,
  replacing: boolean,
  accountHint: string | null,
  loginHint: string | null,
  parent: BrowserWindow | null,
  rendererOrigin: string,
): Promise<AuthorizationOutcome> {
  const provider = oauthProviderById(target.oauth?.provider_id ?? "");
  if (provider === null) {
    return { ok: false, code: "provider_error" };
  }
  const scopes = target.oauth?.scopes ?? [];

  const resolution = await openPrompt(
    {
      mode: "oauth",
      service: target.service,
      field_label: target.field_label,
      purpose: target.purpose,
      help: target.help,
      vault_label: vaultLabel,
      replacing,
      provider_label: provider.label,
      permissions: describePermissions(provider, scopes),
      account_hint: accountHint,
      waiting: false,
    },
    { mode: "oauth", provider_id: provider.id, scopes, login_hint: loginHint },
    560,
    parent,
    rendererOrigin,
  );

  return resolution.kind === "oauth" ? resolution.outcome : { ok: false, code: "cancelled" };
}
