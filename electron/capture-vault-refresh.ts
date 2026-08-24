/**
 * *Refresh connections*, pressed for real (MAR-742 item 3b). **Not part of the
 * shipped shell.**
 *
 * ## What this photographs, and why it is evidence rather than decoration
 *
 * The state MAR-742 is about cannot be staged with a fixture, because the whole
 * point of it is that a row and a blob disagree. So this seeds **two** fleet
 * connections into a scratch store and gives only one of them a credential:
 *
 * - `openrouter` — row **and** a real vault write through `secureStore()`, the
 *   same door `connect` uses. The bytes are a fixture string, so the provider
 *   will refuse them: that is a `key_refused` row, and it proves the report
 *   distinguishes *the vault has it and the provider said no* from the case
 *   below.
 * - `anthropic` — row and **no vault write at all**. That is exactly the state
 *   Henrik's 20:57 self-check recorded: a `fleet_connections` row naming a
 *   secret this vault has never held. Before this packet the report for it was
 *   "no secret stored as that", and a person's only recovery was to destroy the
 *   credential and paste it again. Now it says **where DASH looked**, and that
 *   sentence plus the folder under it is the image worth having.
 *
 * There is no real credential in this run and none is needed: both interesting
 * legs of the report are failures, and a `live` row would need somebody's money.
 *
 * ## Run it
 *
 *     pnpm build:renderer
 *     pnpm build:shell
 *     $env:DASH_SHELL_URL='dash-app://ui/'
 *     $env:DASH_DATA_DIR='…\scratch-vault-refresh'
 *     $env:DASH_CAPTURE_DIR='qa-screenshots-vault-refresh'
 *     pnpm exec electron dist/electron/capture-vault-refresh.mjs --user-data-dir=…\ud-vault-refresh
 *
 * From **PowerShell**, with a visible, unoccluded window, and with
 * `--user-data-dir` as well as `DASH_DATA_DIR` — the flag is what actually
 * moves Electron's single-instance lock and `app.getPath("userData")`, and
 * without it this fights whatever DASH is already open.
 *
 * `--user-data-dir` matters twice as much here as it does anywhere else in this
 * tree, because **the split between those two roots is the bug under test**.
 * Passing one and not the other is how the evidence was produced in the first
 * place.
 *
 * No `smoke-identity.js` import, `capture-connectors.ts`' shape: a capture
 * process claiming the installed app's name would fight an attended test for
 * the lock, or write into the real store if `DASH_DATA_DIR` were ever
 * forgotten. This produces evidence, never a verdict (ADR 0004), and is named
 * by no `package.json` script.
 */

import "./main.js";
import { appWindow } from "./app-window.js";

import { app, BrowserWindow } from "electron";

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  AI_KEY_CREDENTIAL_KIND,
  AI_KEY_CREDENTIAL_VERSION,
  serializeAiKeyCredential,
} from "../lib/ai/credential.js";
import { fleetSecretName } from "../lib/fleet/catalogue.js";
import { recordFleetConnection } from "../lib/fleet/store.js";
import { maskSecret } from "../lib/secret-refs.js";
import { secureStore } from "./secure-store.js";

const OUT = path.resolve(process.cwd(), process.env.DASH_CAPTURE_DIR ?? "qa-screenshots-vault-refresh");

/** The fixture bytes. Not a credential: no account anywhere accepts this. */
const FIXTURE_KEY = "sk-or-v1-capture-scene-only-2f8c";

function settle(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function within<T>(what: string, ms: number, work: Promise<T>): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`${what} did not finish in ${String(ms)}ms`)), ms),
    ),
  ]);
}

async function painted(target: BrowserWindow): Promise<void> {
  if (!target.webContents.isLoading()) {
    return;
  }
  await new Promise<void>((resolve) => {
    target.webContents.once("did-finish-load", () => resolve());
    target.webContents.once("did-fail-load", () => resolve());
  });
}

function appWindowLoaded(): Promise<BrowserWindow> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no app window after 60s")), 60_000);
    const attach = (): void => {
      const window = appWindow();
      if (window === null) {
        setTimeout(attach, 100);
        return;
      }
      void painted(window).then(() => {
        clearTimeout(timer);
        resolve(window);
      });
    };
    attach();
  });
}

async function shoot(target: BrowserWindow, name: string): Promise<void> {
  let image;
  try {
    image = await within(`capturePage for ${name}`, 20_000, target.webContents.capturePage());
  } catch (error: unknown) {
    // Deterministic rather than flaky after a resize — retry the first attempt.
    console.log(
      `[vault-refresh]   retrying ${name} after ${error instanceof Error ? error.message : String(error)}`,
    );
    target.show();
    target.focus();
    await settle(1500);
    image = await within(`capturePage retry for ${name}`, 20_000, target.webContents.capturePage());
  }
  writeFileSync(path.join(OUT, `${name}.png`), image.toPNG());
  const size = image.getSize();
  console.log(`[vault-refresh] ${name}.png ${String(size.width)}x${String(size.height)}`);
}

async function go(target: BrowserWindow, route: string): Promise<void> {
  const next = new URL(route, target.webContents.getURL()).toString();
  await within(`load ${route}`, 20_000, target.webContents.loadURL(next));
  await settle(1500);
}

/**
 * Seed the two connections, through the ordinary doors.
 *
 * `recordFleetConnection` refuses a hint that is not already masked, so this
 * path cannot put a value in a row even by mistake — which is why `maskSecret`
 * is applied here rather than a pre-masked literal being pasted in.
 */
async function seed(): Promise<void> {
  const at = "2026-08-24T15:30:03.000Z";

  const held = fleetSecretName("openrouter", "api_key", "account-1");
  recordFleetConnection(
    {
      provider: "openrouter",
      account_id: "account-1",
      connector_kind: "api_key",
      field_id: "api_key",
      secret_name: held,
      masked_hint: maskSecret(FIXTURE_KEY),
      account_hint: null,
      scopes: [],
      backend: "file",
      is_default: true,
    },
    at,
  );
  /*
   * A real envelope, not a bare key. The first attended run wrote the raw
   * bytes and got "DASH holds a key and has not asked about it" back, because
   * `test` refuses anything that is not a credential envelope before it
   * probes — which is how the report gained its `unusable` leg. Writing the
   * envelope is what makes this row exercise the *provider*, which is the leg
   * the scene is here to photograph.
   */
  await secureStore().set(
    held,
    serializeAiKeyCredential({
      version: AI_KEY_CREDENTIAL_VERSION,
      kind: AI_KEY_CREDENTIAL_KIND,
      provider: "openrouter",
      key: FIXTURE_KEY,
      obtained_at: at,
    }),
  );

  /*
   * The split, staged exactly: a row and no blob.
   *
   * Written second and deliberately never handed to `secureStore()`. This is
   * the state a launch reaches by moving `DASH_DATA_DIR` without
   * `--user-data-dir` — the store keeps the row, the vault underneath it is a
   * different directory that has never held the secret — and it is what the
   * 2026-08-24 self-check recorded.
   */
  const orphaned = fleetSecretName("anthropic", "api_key", "account-1");
  recordFleetConnection(
    {
      provider: "anthropic",
      account_id: "account-1",
      connector_kind: "api_key",
      field_id: "api_key",
      secret_name: orphaned,
      masked_hint: maskSecret("sk-ant-capture-scene-only-9d41"),
      account_hint: null,
      scopes: [],
      backend: "file",
      is_default: false,
    },
    at,
  );

  console.log(
    `[vault-refresh] seeded: ${held} written to the vault, ${orphaned} recorded with NO vault entry`,
  );
}

/**
 * Press the control and wait for its report.
 *
 * `textContent` rather than `innerText`: DASH forces button labels to uppercase
 * in CSS, so `innerText` would hand back "REFRESH CONNECTIONS" and a match on
 * the real label would silently fail while the button is plainly on screen.
 *
 * No backtick and no backslash inside the injected source — a backtick would
 * close this template literal, and a regex escape would be eaten by it before
 * the page ever saw it. Both have broken this harness family before.
 */
async function pressRefresh(target: BrowserWindow): Promise<boolean> {
  const pressed = (await target.webContents.executeJavaScript(
    '(() => {' +
      '  const buttons = Array.from(document.querySelectorAll("button"));' +
      '  const button = buttons.find((one) => (one.textContent || "").trim() === "Refresh connections");' +
      '  if (!button) return false;' +
      '  button.click();' +
      '  return true;' +
      '})()',
  )) as boolean;
  return pressed;
}

/** What the report actually says, read back off the page as text evidence. */
async function readReport(target: BrowserWindow): Promise<string> {
  return (await target.webContents.executeJavaScript(
    '(() => {' +
      '  const section = document.querySelector("section[aria-labelledby=\'connections-refresh\']");' +
      '  if (!section) return "(no refresh section on the page)";' +
      // `h2, p` and NOT `code`: the path element lives INSIDE its paragraph, so
      // selecting both wrote the folder twice into report.txt while the page
      // itself showed it once. Evidence must not invent a duplicate.
      '  return Array.from(section.querySelectorAll("h2, p"))' +
      '    .map((node) => (node.textContent || "").trim())' +
      '    .filter((line) => line.length > 0)' +
      '    .join("\\n");' +
      '})()',
  )) as string;
}

async function run(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const window = await appWindowLoaded();
  window.show();
  window.focus();
  window.setContentSize(1280, 1000);
  await settle(600);

  await seed();
  await go(window, "/settings/ai");

  await shoot(window, "01-ai-tab-before-press");
  const before = await readReport(window);
  console.log(`[vault-refresh] BEFORE:\n${before}\n`);

  const pressed = await pressRefresh(window);
  if (!pressed) {
    throw new Error("the Refresh connections button was not on the page");
  }
  console.log("[vault-refresh] pressed Refresh connections");

  /*
   * Long enough for two vault reads, one real provider round trip and one push
   * to the runner. Polled rather than slept flat, so a fast machine does not
   * wait for nothing and a slow one is not photographed mid-flight.
   */
  const deadline = Date.now() + 45_000;
  let report = "";
  while (Date.now() < deadline) {
    await settle(500);
    report = await readReport(window);
    if (report.includes("DASH looked in") || report.includes("re-read")) {
      break;
    }
  }

  /*
   * Force a fresh frame before the second shot.
   *
   * The first run of this harness wrote two byte-identical PNGs: the report was
   * provably on the page — `report.txt` from that same run carries it in full —
   * and `capturePage` handed back the frame composited *before* the press. So
   * the window is shown, focused and given time to composite, and the first
   * capture after that is discarded, because that is the one that comes back
   * stale. Same family as the retry inside `shoot`, hoisted to where it is
   * needed unconditionally rather than only after a throw.
   */
  window.show();
  window.focus();
  await settle(2000);
  await within("warm-up capture", 20_000, window.webContents.capturePage());
  await settle(500);

  await shoot(window, "02-ai-tab-report");
  console.log(`[vault-refresh] AFTER:\n${report}\n`);
  writeFileSync(path.join(OUT, "report.txt"), `${report}\n`, "utf8");

  console.log("[vault-refresh] done");
}

void app.whenReady().then(async () => {
  try {
    await run();
  } catch (error: unknown) {
    console.error(`[vault-refresh] FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
  // `app.exit`, never `app.quit`: `window-all-closed` counts hidden windows,
  // so a quit here leaves the process alive with its work already done —
  // which is exactly what the first run of this harness did.
  app.exit(process.exitCode === 1 ? 1 : 0);
});
