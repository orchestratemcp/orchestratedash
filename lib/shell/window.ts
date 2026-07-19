/**
 * The renderer's security posture, as data.
 *
 * ADR 0001 lists Electron's security checklist as a *standing obligation*:
 * "`contextIsolation` on, `nodeIntegration` off, a narrow preload, and no
 * remote content in the renderer". A checklist that lives only in a comment
 * above a `new BrowserWindow(...)` call is one careless edit from being wrong
 * and nobody noticing.
 *
 * So the posture lives here, pure and I/O-free, and `electron/main.ts` is
 * reduced to passing it through. That buys two things: the settings are unit
 * tested without launching Electron, and a regression fails `pnpm verify`
 * rather than shipping.
 */

/**
 * The `webPreferences` DASH's window is created with. Frozen because these are
 * a security boundary, not defaults to tweak at a call site — a caller that
 * needs different values should change them here, in review.
 *
 * Each flag, and what it stops:
 *
 * - `contextIsolation: true` — the preload runs in its own context, so a script
 *   in the page cannot reach or monkey-patch the bridge we expose.
 * - `nodeIntegration: false` — no `require` in the renderer. Without this, an
 *   injected script gets the filesystem and the OS vault directly.
 * - `sandbox: true` — the renderer process runs under the OS sandbox. Defence
 *   in depth for the two above.
 * - `webSecurity: true` — keeps same-origin policy on. Disabling it is a
 *   common local-app shortcut and it removes the only thing separating our
 *   loopback bridge from any page the renderer touches.
 * - `allowRunningInsecureContent: false` / `experimentalFeatures: false` — no
 *   mixed content, no unreviewed Chromium surface.
 */
export const SHELL_WEB_PREFERENCES = Object.freeze({
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
});

export type ShellWebPreferences = typeof SHELL_WEB_PREFERENCES;

/**
 * Assert the posture has not drifted. Called by `electron/main.ts` at window
 * creation so a bad merge fails at startup, and by the tests so it fails even
 * earlier.
 *
 * Written as an explicit list of required values rather than a deep-equal
 * against the constant: this way the test states the requirement independently
 * of the object, and editing the object cannot quietly edit its own assertion.
 */
export function assertHardenedWebPreferences(preferences: Partial<ShellWebPreferences>): void {
  const required: Array<[keyof ShellWebPreferences, boolean]> = [
    ["contextIsolation", true],
    ["nodeIntegration", false],
    ["nodeIntegrationInWorker", false],
    ["nodeIntegrationInSubFrames", false],
    ["sandbox", true],
    ["webSecurity", true],
    ["allowRunningInsecureContent", false],
    ["experimentalFeatures", false],
  ];

  for (const [key, expected] of required) {
    if (preferences[key] !== expected) {
      throw new Error(
        `Unsafe renderer configuration: ${key} must be ${expected}, got ${String(preferences[key])}. ` +
          `See docs/adr/0001-installable-shell.md — this is a standing security obligation, not a default.`,
      );
    }
  }
}

/**
 * "No remote content in the renderer" (ADR 0001) made checkable.
 *
 * DASH is local-first: the UI is a local static export or a loopback dev
 * server, and nothing else. Anything off-machine — an OAuth page, a doc link,
 * an agent's own web UI — belongs in the user's real browser, where it gets
 * that browser's isolation and the user can see the address bar.
 *
 * `localhost` is deliberately *not* accepted as a bare hostname alias: it can
 * resolve through DNS, and honouring only the literal loopback addresses keeps
 * the check independent of resolver behaviour.
 */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "::1"]);

export function isAllowedRendererUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Unparseable is not "probably fine".
    return false;
  }

  // The packaged app loads the static export straight off disk.
  if (parsed.protocol === "file:") {
    return true;
  }

  // The developer `pnpm dev` path, which ADR 0001 keeps as a second entry point.
  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    return LOOPBACK_HOSTS.has(parsed.hostname);
  }

  return false;
}
