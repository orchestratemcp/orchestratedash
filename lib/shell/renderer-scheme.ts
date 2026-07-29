/**
 * The origin the packaged renderer loads from (MAR-432, DASH-20).
 *
 * ## Why the packaged app cannot just load `file:`
 *
 * A Next static export references its own assets absolutely — `/_next/static/…`
 * — and its client router navigates to absolute paths like `/runs`. Under
 * `file:` both resolve against the *drive root*, so the first page loads without
 * styles or script and the first navigation goes nowhere. `assetPrefix: "./"`
 * fixes exactly one directory depth, and DASH has pages at two.
 *
 * The alternative that would work — a loopback HTTP server — is the one ADR 0001
 * rejected for the Connection Center ("a loopback origin is reachable by any
 * page in the same browser") and the one MAR-430 removed the last of. Bringing
 * it back to serve HTML would undo that for a reason unrelated to why it was
 * removed.
 *
 * So the packaged renderer gets its own scheme, handled inside main. The pages
 * are served from one directory inside the install, over an origin no other
 * process can address and no browser can reach.
 *
 * ## What this module is, and is not
 *
 * It is the *decision*: which URL maps to which file, and which files may be
 * served at all. It is pure, so the traversal refusals below are unit-tested
 * rather than reasoned about — `electron/renderer-host.ts` is the wiring, and
 * holds no rules.
 */

import path from "node:path";

import { isInsideInstallRoot } from "./install-layout";

/**
 * Deliberately not `dash`, which is already registered with the operating
 * system as DASH's deep-link scheme (ADR 0001 Amendment 3). Those two must stay
 * distinct: one is an entry point the OS hands untrusted strings to, and this
 * one is an origin that renders privileged UI. A scheme that was both would let
 * a `dash-app://` link arriving from a web page be confused for a document
 * request, and vice versa.
 */
export const RENDERER_SCHEME = "dash-app";

/**
 * The only authority this scheme answers for.
 *
 * Pinned so that `dash-app://somewhere-else/…` is refused rather than resolved
 * against the same directory. Without it the scheme would have as many origins
 * as there are hostnames, and same-origin policy — which is doing real work here
 * — would be deciding between them.
 */
export const RENDERER_HOST = "ui";

export const RENDERER_ORIGIN = `${RENDERER_SCHEME}://${RENDERER_HOST}`;

/** Where the packaged app is told to start. */
export const RENDERER_ENTRY_URL = `${RENDERER_ORIGIN}/`;

/**
 * Content types, by extension, for everything a Next static export emits.
 *
 * An allowlist, and an unknown extension is a refusal rather than
 * `application/octet-stream`. The export's contents are ours: a file type that
 * is not on this list means the build started emitting something nobody
 * reviewed, and that should be a visible failure at the moment it appears
 * rather than a resource the browser quietly declines to interpret.
 *
 * Charset is stated on the text types. Omitting it leaves the renderer to sniff,
 * and a sniffed charset is a decoding decision made by whatever bytes happen to
 * be at the top of the file.
 */
export const RENDERER_CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".rsc": "text/x-component; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/vnd.microsoft.icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
});

export type RendererRefusal =
  | "wrong_scheme"
  | "wrong_host"
  | "unparseable"
  | "outside_root"
  | "unsupported_type";

export type RendererResolution =
  | {
      ok: true;
      /**
       * Candidate files, in the order they should be tried. More than one
       * because a static export answers `/runs` with `runs.html` or with
       * `runs/index.html` depending on `trailingSlash`, and a resolver that
       * knows only one of those breaks on a config change nobody connected to
       * it.
       */
      candidates: string[];
      contentType: string;
    }
  | { ok: false; reason: RendererRefusal };

/**
 * Which file, if any, a renderer URL names.
 *
 * The rules, in the order they are applied:
 *
 * 1. The scheme and host must be exactly ours.
 * 2. The query string is ignored. `/runs/detail?agent=…` is the same document
 *    as `/runs/detail`; the parameters are the page's business, read in the
 *    renderer, and must not reach the filesystem.
 * 3. `/` means the entry page.
 * 4. Every candidate must resolve inside the renderer root. This is the
 *    traversal refusal, and it is done on the *resolved* path — `%2e%2e`,
 *    backslashes on Windows and doubled separators all normalise before it is
 *    checked, which is what makes the check about where the path points rather
 *    than about what it looks like.
 */
export function resolveRendererRequest(root: string, url: string): RendererResolution {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "unparseable" };
  }

  if (parsed.protocol !== `${RENDERER_SCHEME}:`) {
    return { ok: false, reason: "wrong_scheme" };
  }
  if (parsed.hostname !== RENDERER_HOST) {
    return { ok: false, reason: "wrong_host" };
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    // A malformed escape sequence. Refusing beats guessing at what it meant.
    return { ok: false, reason: "unparseable" };
  }

  // A NUL byte truncates a path inside some filesystem APIs, which is how a
  // refused extension becomes an accepted one further down the stack.
  if (pathname.includes("\0")) {
    return { ok: false, reason: "unparseable" };
  }

  const relative = pathname.replace(/^\/+/, "");
  const candidates =
    relative === "" || relative.endsWith("/")
      ? [path.join(root, relative, "index.html")]
      : path.extname(relative) === ""
        ? [path.join(root, `${relative}.html`), path.join(root, relative, "index.html")]
        : [path.join(root, relative)];

  for (const candidate of candidates) {
    if (!isInsideInstallRoot(root, candidate)) {
      return { ok: false, reason: "outside_root" };
    }
  }

  const first = candidates[0];
  if (first === undefined) {
    return { ok: false, reason: "unparseable" };
  }

  const contentType = RENDERER_CONTENT_TYPES[path.extname(first).toLowerCase()];
  if (contentType === undefined) {
    return { ok: false, reason: "unsupported_type" };
  }

  return { ok: true, candidates, contentType };
}
