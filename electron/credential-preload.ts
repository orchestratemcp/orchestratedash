/**
 * The credential prompt's preload — the only bridge in DASH a secret crosses.
 *
 * `electron/preload.ts` states that nothing which "reads, writes or names a
 * secret" may be on the app's bridges, and that rule is unchanged: `dashShell`
 * and `dashData` still carry no credential and never will. This is a *second*
 * preload, attached to a *second* window, and the separation is the design
 * rather than a consequence of it.
 *
 * What that buys, concretely:
 *
 * - The window this loads into renders one page: the prompt. It never renders a
 *   manifest's strings, an agent's audit prose, a run's output or anything else
 *   an agent had a hand in. So the page a user types a credential into has no
 *   content on it that an agent could have influenced.
 * - `dashShell` and `dashData` are not exposed here. A page that can submit a
 *   credential cannot also send a command or read a document.
 * - `dashCredential` is not exposed in the app window. The two capabilities
 *   never coexist in one renderer, so neither window is a place where a script
 *   could read a document, decide something, and submit a secret about it.
 *
 * ## Write-only, in both directions
 *
 * `submit` sends a value and resolves with nothing. There is no `get`, no
 * `read`, no `current`, and no reply that carries the secret back. Once a value
 * leaves this bridge the renderer cannot ask for it again — not its own, and
 * not any other. Main writes it to the vault and forgets it.
 *
 * `describe` returns only what the prompt has to render: the service name, the
 * field's label and purpose, the agent author's help text, and which vault the
 * value is going into. All four are already safe to render and to log.
 */

import { contextBridge, ipcRenderer } from "electron";

import {
  CREDENTIAL_CANCEL_CHANNEL,
  CREDENTIAL_DESCRIBE_CHANNEL,
  CREDENTIAL_SUBMIT_CHANNEL,
  type CredentialPromptDescription,
} from "../lib/shell/credential-prompt";

const dashCredential = {
  /** What to render. Resolves null if the window outlived its request. */
  describe: (): Promise<CredentialPromptDescription | null> =>
    ipcRenderer.invoke(CREDENTIAL_DESCRIBE_CHANNEL) as Promise<CredentialPromptDescription | null>,

  /**
   * Hand the value to main.
   *
   * Resolves with nothing at all — not the stored name, not a masked hint, not
   * a success flag carrying anything derived from the value. The window closes
   * when main is done; the outcome is reported on the Connection Center, which
   * is where the user was.
   */
  submit: async (value: string): Promise<void> => {
    await ipcRenderer.invoke(CREDENTIAL_SUBMIT_CHANNEL, value);
  },

  cancel: async (): Promise<void> => {
    await ipcRenderer.invoke(CREDENTIAL_CANCEL_CHANNEL);
  },
};

export type DashCredentialApi = typeof dashCredential;

contextBridge.exposeInMainWorld("dashCredential", dashCredential);
