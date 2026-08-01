/**
 * Serving the packaged renderer over its own scheme (MAR-432, DASH-20).
 *
 * Wiring only. Every rule — which URLs map to which files, what may be served,
 * what is refused — is in `lib/shell/renderer-scheme.ts`, pure and unit-tested,
 * for the reason `lib/shell/window.ts` gives about the renderer posture: a
 * security rule that lives only beside the Electron call that uses it is one
 * careless edit from being wrong with nothing to catch it.
 *
 * ## Import position matters here too
 *
 * `registerRendererScheme()` calls `protocol.registerSchemesAsPrivileged`, which
 * Electron requires **before** `app.ready`. Called after, it does nothing and
 * says nothing: the scheme still works, but without the privileges, so the
 * export loads and then fails at its first module script with a message about
 * the origin rather than about the registration. `main.ts` calls it at module
 * scope, alongside the two other order-sensitive statements it already carries.
 */

import { app, net, protocol, type Session } from "electron";

import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CREDENTIAL_PROMPT_ROUTE } from "../lib/shell/credential-prompt";
import {
  RENDERER_SCHEME,
  resolveRendererRequest,
} from "../lib/shell/renderer-scheme";

/**
 * Where the exported pages live: beside `main.mjs`, staged into the package by
 * `@electron/packager` along with everything else under `dist/electron/`.
 *
 * Resolved from `import.meta.url` rather than from `process.resourcesPath`,
 * which is the same anchor `electron/sample-agent.ts` uses and for the same
 * reason: it holds in a development tree and under an immutable, version-stamped
 * MSIX install root alike.
 */
export function rendererRoot(): string {
  return fileURLToPath(new URL("./renderer/", import.meta.url));
}

/**
 * Declare the scheme's privileges. Must run before `app.ready`.
 *
 * Each privilege, and why it is on:
 *
 * - `standard` — gives the scheme a real origin and ordinary relative-URL
 *   resolution. Without it every page is opaque-origin and the export's own
 *   absolute asset paths do not resolve, which is the whole reason `file:` was
 *   not usable.
 * - `secure` — marks the origin a secure context, which is what a modern
 *   Chromium requires before it will hand a page `crypto.subtle`, modules, or
 *   most of the platform. It does not weaken anything: it asserts that this
 *   origin's bytes come from the install rather than from a network.
 * - `supportFetchAPI` — the client router fetches its own route payloads.
 * - `stream` — responses are served as streams rather than buffered whole.
 *
 * What is deliberately **not** set: `bypassCSP`, which would let this origin
 * ignore the policy the document declares, and `corsEnabled`, which would invite
 * cross-origin requests to an origin that has no reason to answer any.
 */
export function registerRendererScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: RENDERER_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: false,
        corsEnabled: false,
      },
    },
  ]);
}

/**
 * Answer requests on the scheme. Must run after `app.ready`.
 *
 * Read-only in the strongest sense available: anything that is not a `GET` is
 * refused before a path is even resolved, so there is no method by which this
 * handler can be asked to write, and no code path in it that could.
 */
export function serveRenderer(root: string = rendererRoot()): void {
  protocol.handle(RENDERER_SCHEME, (request) => answer(root, request));
}

/**
 * Serve the same scheme inside one non-default session.
 *
 * `protocol.handle` registers on the default session and nowhere else. The
 * credential prompt opens on a fresh `partition:` — deliberately, so nothing it
 * displays can be cached beside the rest of the app — and in that partition
 * `dash-app://` was a scheme nobody answered. `loadURL` failed immediately, its
 * rejection was discarded by the `void` in front of it, and the window sat at
 * about:blank with the credential bridge attached. No error reached the user:
 * connecting an account opened an empty frame and waited.
 *
 * The isolation is the point and is kept. What was missing is that an isolated
 * session still has to be told how to answer for the app's own origin.
 */
export function serveRendererIn(target: Session, root: string = rendererRoot()): void {
  target.protocol.handle(RENDERER_SCHEME, (request) => answer(root, request));
}

/** The one handler, so an isolated session cannot drift from the default one. */
async function answer(root: string, request: GlobalRequest): Promise<GlobalResponse> {
  if (request.method !== "GET") {
    return new Response(null, { status: 405 });
  }

  const resolution = resolveRendererRequest(root, request.url);
  if (!resolution.ok) {
    console.warn(`[dash-shell] renderer refused ${request.url}: ${resolution.reason}`);
    // One status for every refusal. Distinguishing "outside the root" from
    // "no such page" would tell a probe which of its guesses landed inside.
    return new Response(null, { status: 404 });
  }

  const file = resolution.candidates.find((candidate) => existsSync(candidate));
  if (file === undefined) {
    return new Response(null, { status: 404 });
  }

  const response = await net.fetch(pathToFileURL(file).href);
  // `net.fetch` on a file URL guesses a type from the extension. Ours is an
  // allowlist rather than a guess, so it wins.
  const headers = new Headers(response.headers);
  headers.set("content-type", resolution.contentType);
  return new Response(response.body, { status: response.status, headers });
}

/**
 * Prove the exported renderer was actually shipped.
 *
 * The successor to MAR-429's `assertRendererPresent`, and it exists for the same
 * reason: a missing renderer fails into a blank window rather than an error,
 * which makes a packaging mistake look like a renderer bug.
 */
export function assertRendererPresent(): void {
  if (!app.isPackaged) {
    return;
  }
  const entry = path.join(rendererRoot(), "index.html");
  if (!existsSync(entry)) {
    throw new Error(
      `The packaged renderer is missing at "${entry}". ` +
        `Run \`pnpm build:renderer\` before \`pnpm build:shell\` — the export is ` +
        `what the packaged app displays, and without it the window is blank.`,
    );
  }

  // MAR-383. The credential prompt is a route in the same export, and it is the
  // one page whose absence would not look like a missing renderer: the app
  // would start, the Connection Center would render, and Connect would open an
  // empty window with a credential bridge attached to nothing. Checked
  // separately so that failure is a crash at startup instead.
  const prompt = path.join(rendererRoot(), `${CREDENTIAL_PROMPT_ROUTE.replace(/^\//, "")}.html`);
  if (!existsSync(prompt)) {
    throw new Error(
      `The packaged renderer is missing the credential prompt at "${prompt}". ` +
        `Connecting a service would open a blank window. Run \`pnpm build:renderer\`.`,
    );
  }
}
