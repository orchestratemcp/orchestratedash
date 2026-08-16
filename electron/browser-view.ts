/**
 * The controlled browser itself: one ephemeral `WebContentsView` per run,
 * attached to DASH's window, driven over CDP (MAR-628, ADR 0019).
 *
 * `lib/browser/` decides everything and touches nothing. This is the other half:
 * Chromium, the session partition, the request interception, the debugger
 * transport and the frames on disk. It is deliberately thin, for the reason
 * `electron/` modules generally are — what is here cannot be unit-tested without
 * launching Electron, so as little as possible should be here.
 *
 * ## Why a `WebContentsView` and not a second browser
 *
 * ADR 0019 spends a section on it and the short version is that DASH is building
 * a supervision surface rather than a test runner. The important output is not
 * that a selector matched; it is that a person can watch the actual page,
 * interrupt the run, and see what DASH asked the browser to do without changing
 * applications. A `WebContentsView` is the only candidate that is natively both
 * the controlled browser and a surface inside DASH.
 *
 * `WebContentsView` and not `BrowserView`: the latter has been deprecated since
 * Electron 30 and is a compatibility wrapper in Electron 43, which is what this
 * repository ships.
 *
 * ## The five things that make it a *controlled* browser
 *
 * 1. **An in-memory partition per session.** The partition name has no
 *    `persist:` prefix, which is Electron's own switch for a session that is
 *    never written to disk. That is not a tidy-up step that could be forgotten —
 *    it is the reason cookies, local storage and service-worker state cannot
 *    outlive the run. ADR 0019's third credential option, the one it recommends
 *    for this slice, is exactly this: *an ephemeral, public-web session with no
 *    login and no credential input.*
 * 2. **Every request checked, not only navigations.** `onBeforeRequest` covers
 *    scripts, styles, fonts, images and API calls. Checking only top-level
 *    navigation would leave the card claiming a destination list while the
 *    browser could still talk anywhere.
 * 3. **No renderer privileges.** No preload, no node integration, sandboxed,
 *    context isolated, web security on. The page gets a browser, not a bridge.
 * 4. **Everything that opens something else, denied.** Popups, new windows,
 *    downloads, permission prompts and every non-HTTPS protocol. Each of them is
 *    a way out of the surface a person is watching.
 * 5. **CDP is DASH's and only DASH's.** The debugger is attached here, the
 *    commands are literals in this file, and no value an agent supplied is ever
 *    interpolated into one. ADR 0019: *"CDP is an implementation detail of the
 *    trusted controller, never an agent operation."*
 *
 * ## What this file still cannot promise
 *
 * A destroyed view cannot recall a request already sent. A page can change state
 * without anybody clicking. An origin allowlist limits the browser DASH
 * provides and not the agent, which is an ordinary child process with an
 * ordinary network stack. `lib/copy/browser.ts` is where those are said to a
 * person; they are repeated here so that nobody reading this file alone comes
 * away with a stronger impression than it has earned.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { session as electronSession, WebContentsView, type WebContents } from "electron";

import { dataDir } from "../lib/db";
import type { BrowserGesture, PageReading } from "../lib/browser/operations";
import { MAX_PAGE_TEXT_CHARS } from "../lib/browser/operations";
import { mintSessionId, type BrowserSession, type PerformResult } from "../lib/browser/session";
import type { RequestKind } from "../lib/browser/origins";
import { appWindow } from "./app-window";

/**
 * How long DASH will wait for a page to finish loading.
 *
 * A ceiling rather than a target. A page that has not settled in this long is
 * one the agent should be told about rather than one DASH should keep a person
 * watching — and the agent's own request timeout is longer, so the refusal
 * arrives as `page_unavailable` rather than as a silence.
 */
const LOAD_TIMEOUT_MS = 20_000;

/**
 * Where the view sits until the supervision panel says otherwise.
 *
 * Off to one side of a default window and small, so that a session opened while
 * no panel is mounted — a run started from the fleet strip, say — is still
 * visible rather than covering the application. The panel sends real bounds on
 * mount; see `setBrowserViewportBounds`.
 */
const FALLBACK_BOUNDS = { x: 24, y: 120, width: 720, height: 480 };

/**
 * The one script DASH runs inside a controlled page, as a literal.
 *
 * Every character of it is typed here. No agent value reaches it, there is no
 * interpolation, and `lib/browser/operations.ts` has no operation carrying a
 * string that could become one — which is what makes "no arbitrary JavaScript"
 * a property of the type rather than a promise about this line.
 *
 * It is evaluated in an **isolated world**, created by `Page.createIsolatedWorld`
 * below. That matters and is not decoration: an isolated world shares the DOM
 * with the page but not the JavaScript globals, so a page that has redefined
 * `Node.prototype.textContent`, shadowed `document.title`, or replaced
 * `Array.prototype.join` cannot change what DASH reads. The page still chooses
 * the *content* — that is unavoidable and is why the result is untrusted data
 * under ADR 0002 invariant 7 — but it cannot choose the reader.
 *
 * `innerText` rather than `textContent`, because `innerText` is what a person
 * looking at the same page would see: it respects `display: none`, which is
 * where a page hides text intended for a machine rather than for a reader. A
 * trail claiming DASH read what the person saw should be read the way the
 * person sees it.
 *
 * No backticks and no `${`. The whole string is carried into a template literal
 * nowhere, but this file has been bitten before by a backtick in a comment
 * closing a string hundreds of lines away, and a script literal is the one place
 * where the habit costs nothing to keep.
 */
const READ_PAGE_SCRIPT =
  "(function () {\n" +
  "  var body = document.body;\n" +
  "  var text = body === null ? '' : String(body.innerText || '');\n" +
  "  return JSON.stringify({\n" +
  "    title: String(document.title || '').slice(0, 1000),\n" +
  "    url: String(location.href || '').slice(0, 4000),\n" +
  "    text: text.slice(0, " +
  String(MAX_PAGE_TEXT_CHARS * 2) +
  ")\n" +
  "  });\n" +
  "})()";

interface LiveSession {
  session_id: string;
  view: WebContentsView;
  partition: string;
  /** How many frames this session has captured, for their file names. */
  frames: number;
  /** Where the frames go. Made when the session opens. */
  frameDir: string;
  destroyed: boolean;
}

const live = new Map<string, LiveSession>();

/**
 * The panel's own rectangle, in DASH window coordinates.
 *
 * Held here rather than passed in, because the two facts arrive from different
 * directions at different times: the renderer knows where its placeholder is and
 * main knows when a session opens, and either can happen first. A session that
 * opens before the panel has mounted uses `FALLBACK_BOUNDS` and is moved as soon
 * as the panel reports.
 */
let viewportBounds: { x: number; y: number; width: number; height: number } | null = null;

/**
 * The supervision panel reporting where it is.
 *
 * Called from `lib/shell/ipc.ts` on mount, on resize and on scroll. It moves a
 * view that already exists and is remembered for one that does not yet.
 */
export function setBrowserViewportBounds(bounds: {
  x: number;
  y: number;
  width: number;
  height: number;
}): void {
  // Rounded and floored at zero. Electron takes integers and a negative height
  // is a view that renders nowhere and reports no error.
  viewportBounds = {
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
    width: Math.max(0, Math.round(bounds.width)),
    height: Math.max(0, Math.round(bounds.height)),
  };
  for (const entry of live.values()) {
    if (!entry.destroyed) {
      entry.view.setBounds(viewportBounds);
    }
  }
}

/** Frames for one session live under the data directory, never beside the source. */
function frameDirFor(sessionId: string): string {
  return path.join(dataDir, "browser-frames", sessionId);
}

/**
 * Open one controlled browser session.
 *
 * The impure half of `BrowserControllerDeps.openSession`. By the time this runs,
 * the request has already survived revocation, replay, the rate limit, the
 * operation catalogue, the manifest and the origin check — which is the whole
 * reason it is called at step 8 of `handle` and not at step 1.
 */
export async function openBrowserSession(
  pending: Omit<BrowserSession, "session_id">,
  onRequest: (sessionId: string, url: string, kind: RequestKind) => boolean,
): Promise<string> {
  const sessionId = mintSessionId();
  // No `persist:` prefix. See the note at the top of this file: this one word is
  // what makes the session ephemeral, and Electron's default is the other way.
  const partition = `dash-browser-${sessionId}`;
  const partitionSession = electronSession.fromPartition(partition);

  /*
   * Every request the browser makes, checked before it is made.
   *
   * `onBeforeRequest` fires for the top-level document, for every subresource,
   * and again for each hop of a redirect chain — which is what makes a
   * redirect to an undeclared origin a refusal rather than a surprise.
   * `resourceType` decides only how the row reads in the trail; both kinds are
   * held to the same list.
   */
  partitionSession.webRequest.onBeforeRequest((details, callback) => {
    const kind: RequestKind =
      details.resourceType === "mainFrame" || details.resourceType === "subFrame"
        ? "top_level"
        : "subresource";
    callback({ cancel: !onRequest(sessionId, details.url, kind) });
  });

  // Nothing may ask the person for anything. A geolocation prompt or a
  // notification prompt inside a supervised browser is a dialog somebody has to
  // answer about a page an agent chose, which is not a decision this slice has
  // built a surface for.
  partitionSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  partitionSession.setPermissionCheckHandler(() => false);
  // Nothing may put a file on the machine.
  partitionSession.on("will-download", (event) => {
    event.preventDefault();
  });

  const view = new WebContentsView({
    webPreferences: {
      partition,
      // The page gets a browser, not a bridge. There is no preload, so there is
      // nothing for a compromised page to reach through — the absence is the
      // guarantee, in `lib/broker/operations.ts`'s sense.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
      // Off, so a page cannot spend the machine's GPU on a canvas nobody is
      // reading. It is also one fewer surface between a hostile page and the
      // process holding DASH's vault.
      experimentalFeatures: false,
      spellcheck: false,
    },
  });

  const contents = view.webContents;

  // No second window, ever. `deny` covers `window.open`, `target="_blank"` and
  // anything a page does to create a second `WebContents` — each of which would
  // be a browser outside the one a person is watching.
  contents.setWindowOpenHandler(() => ({ action: "deny" }));

  /*
   * The navigation guards, which are the same rule as `onBeforeRequest` applied
   * one layer up.
   *
   * Both are kept. `onBeforeRequest` can cancel a load and these can stop one
   * being started, and the two see slightly different things — a `javascript:`
   * URL and an external protocol handler reach `will-navigate` without ever
   * becoming a network request. Belt and braces, on `lib/broker/execute.ts`'s
   * step 8 terms: the two checks are cheap and the thing on the other side of
   * them is where a person's browser goes.
   */
  const guard = (event: { preventDefault: () => void }, url: string): void => {
    if (!onRequest(sessionId, url, "top_level")) {
      event.preventDefault();
    }
  };
  contents.on("will-navigate", (event, url) => {
    guard(event, url);
  });
  contents.on("will-redirect", (event, url) => {
    guard(event, url);
  });
  contents.on("will-frame-navigate", (event) => {
    guard(event, event.url);
  });

  const frameDir = frameDirFor(sessionId);
  mkdirSync(frameDir, { recursive: true });

  const entry: LiveSession = {
    session_id: sessionId,
    view,
    partition,
    frames: 0,
    frameDir,
    destroyed: false,
  };
  live.set(sessionId, entry);

  const window = appWindow();
  if (window !== null) {
    window.contentView.addChildView(view);
    view.setBounds(viewportBounds ?? FALLBACK_BOUNDS);
  }

  /*
   * The debugger is attached here, at open time, so that it is DASH's from the
   * moment the session exists. A page cannot attach one of its own —
   * `debugger.attach` throws if something is already attached, and this process
   * is the only thing that could try.
   *
   * **No CDP command is sent yet, and that is not tidiness.** A `WebContents`
   * that has never loaded anything has no renderer process, and
   * `sendCommand("Page.enable")` against one does not reject — it never settles.
   * The first version of this file awaited it here and every session hung
   * before its first navigation, with no error anywhere: the attach succeeded,
   * the promise simply never resolved. Domains are enabled in `readPage`
   * instead, by which time there is a page to enable them on.
   */
  try {
    contents.debugger.attach("1.3");
  } catch {
    // A session without the debugger can still navigate and can still be
    // watched; only `browser.read` needs it, and that operation reports
    // `page_unavailable` rather than the whole session failing to open.
  }

  return sessionId;
}

/**
 * Perform one gesture in an open session.
 *
 * The union it takes has two members and neither carries a selector, an
 * expression or a key — see `BrowserGesture`. This function is therefore not
 * *choosing* to be safe; it has nothing unsafe to do.
 */
export async function performBrowserGesture(
  sessionId: string,
  gesture: BrowserGesture,
): Promise<PerformResult> {
  // Every gesture, under one ceiling. `lib/browser/session.ts` catches a throw
  // out of this function and turns it into a refusal, but it cannot catch a
  // promise that never settles — and this module awaits several things that can
  // fail that way rather than by rejecting. A CDP command against a
  // `WebContents` with no renderer is the one that was found the hard way (see
  // the note beside `debugger.attach`), and it will not be the last: a wedged
  // Chromium must become `page_unavailable` on somebody's screen rather than an
  // agent blocked until its own timeout and a person watching a browser that
  // never answers.
  return await Promise.race([
    dispatch(sessionId, gesture),
    new Promise<PerformResult>((resolve) => {
      const timer = setTimeout(
        () => resolve({ ok: false, refusal: "page_unavailable" }),
        GESTURE_CEILING_MS,
      );
      timer.unref?.();
    }),
  ]);
}

/**
 * How long any one gesture may take before DASH gives up on it.
 *
 * Comfortably above `LOAD_TIMEOUT_MS`, because a navigation that is going to
 * fail should fail with the load's own timeout and its own reason rather than
 * with this one — this is the backstop for the failures that do not have a
 * timeout of their own.
 */
const GESTURE_CEILING_MS = 30_000;

async function dispatch(sessionId: string, gesture: BrowserGesture): Promise<PerformResult> {
  const entry = live.get(sessionId);
  if (entry === undefined || entry.destroyed) {
    return { ok: false, refusal: "page_unavailable" };
  }
  const contents = entry.view.webContents;

  switch (gesture.kind) {
    case "navigate": {
      try {
        await loadWithin(contents, gesture.url);
      } catch {
        // Chromium refused the load, the load never finished, or a guard above
        // cancelled it. The three are not distinguished for the agent, because
        // `lib/browser/protocol.ts` refuses to carry a Chromium error string
        // across the boundary — a page that can write into an agent's reasoning
        // through an error message is the same injection by the back door.
        return { ok: false, refusal: "page_unavailable" };
      }
      const reading: PageReading = {
        url: contents.getURL(),
        title: contents.getTitle(),
      };
      return { ok: true, reading, frame: await captureFrame(entry) };
    }

    case "read_page": {
      const read = await readPage(contents);
      if (read === null) {
        return { ok: false, refusal: "page_unavailable" };
      }
      return { ok: true, reading: read, frame: await captureFrame(entry) };
    }
  }
}

/**
 * Load one URL and wait for it to settle, or give up.
 *
 * `loadURL` alone resolves on the first commit, which for a page with a
 * client-side renderer is before there is anything to read. Waiting for
 * `did-finish-load` and racing it against a timeout is the honest version: what
 * comes back is either a settled page or a refusal, never a half-drawn one
 * reported as complete.
 */
async function loadWithin(contents: WebContents, url: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("timeout"));
    }, LOAD_TIMEOUT_MS);

    const done = (): void => {
      cleanup();
      resolve();
    };
    const failed = (): void => {
      cleanup();
      reject(new Error("failed"));
    };
    function cleanup(): void {
      clearTimeout(timer);
      contents.off("did-finish-load", done);
      contents.off("did-fail-load", failed);
    }

    contents.once("did-finish-load", done);
    contents.once("did-fail-load", failed);
    contents.loadURL(url).catch(() => {
      // Swallowed here and settled by `did-fail-load`, which arrives with the
      // same information and is the event the listeners above are already on.
      // A rejection handled twice would settle this promise twice.
    });
  });
}

/**
 * Read the page's title, URL and visible text through CDP, in an isolated world.
 *
 * Null rather than a throw for every failure, because the caller turns all of
 * them into one refusal and there is nothing in a CDP exception worth carrying
 * across the boundary.
 *
 * The two commands are `Page.createIsolatedWorld` and `Runtime.evaluate`, both
 * with parameters this file wrote. `expression` is `READ_PAGE_SCRIPT`, a
 * constant; `contextId` is what the first command returned. There is no third
 * command, and no value from an agent appears in either.
 */
async function readPage(contents: WebContents): Promise<PageReading | null> {
  try {
    // Enabled here rather than when the session opened — see the note beside
    // `debugger.attach`. Idempotent, so a second read costs a no-op rather than
    // a branch remembering whether the first one did it.
    await contents.debugger.sendCommand("Page.enable");

    const tree = (await contents.debugger.sendCommand("Page.getFrameTree")) as {
      frameTree?: { frame?: { id?: string } };
    };
    const frameId = tree.frameTree?.frame?.id;
    if (typeof frameId !== "string") {
      return null;
    }

    const world = (await contents.debugger.sendCommand("Page.createIsolatedWorld", {
      frameId,
      worldName: "dash-supervised-read",
      // False, and it is the whole reason the isolated world is worth creating.
      // A world with universal access can reach across origins, which would make
      // the reader a way around the very allowlist the session is enforcing.
      grantUniveralAccess: false,
    })) as { executionContextId?: number };
    const contextId = world.executionContextId;
    if (typeof contextId !== "number") {
      return null;
    }

    const evaluated = (await contents.debugger.sendCommand("Runtime.evaluate", {
      expression: READ_PAGE_SCRIPT,
      contextId,
      returnByValue: true,
      // No promises awaited and no user gesture claimed. This reads the DOM as
      // it stands; a page that fills itself in later is a page the agent should
      // read again, not one DASH should sit and wait on with a person watching.
      awaitPromise: false,
      userGesture: false,
    })) as { result?: { value?: unknown }; exceptionDetails?: unknown };

    if (evaluated.exceptionDetails !== undefined) {
      return null;
    }
    const value = evaluated.result?.value;
    if (typeof value !== "string") {
      return null;
    }

    // Parsed rather than trusted. This is a string the page's DOM contributed
    // to, arriving through a channel DASH controls — `JSON.parse` on it is the
    // same discipline `lib/broker/execute.ts` applies to a provider body, and
    // every field is checked rather than cast.
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const fields = parsed as Record<string, unknown>;
    return {
      url: typeof fields["url"] === "string" ? fields["url"] : contents.getURL(),
      title: typeof fields["title"] === "string" ? fields["title"] : contents.getTitle(),
      // Bounded again in `projectReading`, against the operation's own ceiling.
      // Twice, because the ceiling here is about what crosses the CDP channel
      // and the one there is about what crosses to the agent.
      text: typeof fields["text"] === "string" ? fields["text"] : "",
    };
  } catch {
    return null;
  }
}

/**
 * Photograph the view, and return the file name.
 *
 * A name and never a path, per `lib/copy/identifiers.ts`'s rule that a renderer
 * names a kind of file and never a file — the directory is derived from the
 * session id on both sides.
 *
 * Retried once. `capturePage` fails deterministically on its first call after
 * the view's bounds have changed, which is a thing that happens every time the
 * supervision panel mounts; retrying is the documented shape of that failure
 * rather than a hopeful loop.
 *
 * Null is a real answer and the trail renders it as a missing frame rather than
 * as an error. A frame is evidence of what the page looked like; a run that
 * could not take one is still a run whose actions are recorded.
 */
async function captureFrame(entry: LiveSession): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const image = await entry.view.webContents.capturePage();
      if (image.isEmpty()) {
        continue;
      }
      entry.frames += 1;
      const name = `frame-${String(entry.frames).padStart(3, "0")}.png`;
      writeFileSync(path.join(entry.frameDir, name), image.toPNG());
      return name;
    } catch {
      // Try once more; see the note above.
    }
  }
  return null;
}

/**
 * Destroy one session, its view and its partition.
 *
 * The stop point ADR 0019 requires to be tested. It removes the view from the
 * window, detaches the debugger, closes the `WebContents` and clears the
 * partition's storage — the last being belt and braces, since an in-memory
 * partition has nothing on disk to clear.
 *
 * **What it does not do** is undo anything the browser already did. A request
 * that has been sent has arrived; a site may have recorded it or acted on it,
 * and nothing local reaches back. `lib/copy/browser.ts` says that on the screen
 * beside the button.
 */
export async function destroyBrowserSession(sessionId: string): Promise<void> {
  const entry = live.get(sessionId);
  if (entry === undefined) {
    return;
  }
  live.delete(sessionId);
  entry.destroyed = true;

  const contents = entry.view.webContents;
  try {
    if (contents.debugger.isAttached()) {
      contents.debugger.detach();
    }
  } catch {
    // Already gone. Nothing to recover and nothing worth reporting.
  }
  try {
    appWindow()?.contentView.removeChildView(entry.view);
  } catch {
    // The window may have closed first, which is one of the ways a run ends.
  }
  try {
    // `close({ waitForBeforeUnload: false })` is the whole teardown in Electron
    // 43 — `WebContents.destroy()` was removed, and the flag is the load-bearing
    // half here. The default runs the page's `beforeunload` handler, which means
    // a page could hold DASH's Stop control open by registering one. A Stop that
    // a hostile page can delay is not a stop.
    contents.close({ waitForBeforeUnload: false });
  } catch {
    // Already gone, or the window went first. Nothing to recover.
  }
  try {
    await electronSession.fromPartition(entry.partition).clearStorageData();
  } catch {
    // An in-memory partition being torn down with the view it belonged to.
  }
}

/** Whether any controlled browser is open. Drives the window's own teardown. */
export function hasLiveBrowserSessions(): boolean {
  return live.size > 0;
}

/**
 * Where Chromium says one session's view actually is, or null (MAR-628).
 *
 * Exported for `electron/prove-browser.ts`, and it exists because of a real
 * limitation that harness ran into: `BrowserWindow.webContents.capturePage()`
 * photographs that `webContents` alone and does **not** composite child
 * `WebContentsView`s over it. So a screenshot of DASH shows the supervision
 * panel with an empty rectangle where the browser is, however correctly the
 * browser is placed — the page is real, it is on the screen, and it is not in
 * the picture.
 *
 * The proof therefore evidences placement in two pieces rather than one: the
 * view's own `capturePage` for what the page looked like, and this for where it
 * was. Reading the bounds back out of Chromium is a stronger claim than
 * screenshotting them anyway — it is what the compositor believes, not what one
 * capture path chose to include.
 */
export function browserViewBounds(
  sessionId: string,
): { x: number; y: number; width: number; height: number } | null {
  const entry = live.get(sessionId);
  return entry === undefined || entry.destroyed ? null : entry.view.getBounds();
}
