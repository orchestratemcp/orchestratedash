/**
 * Screenshots of the three MAR-599 fixes: Servers and Notifications' single
 * headings, and the new Preferences tab. **Not part of the shipped shell.**
 *
 * ## Why this is its own harness rather than a scene on `electron/capture.ts`
 *
 * `capture.ts` already carries a `settings-preferences` scene — future runs of
 * the full surface sweep will photograph it — but `capture.ts` imports
 * `smoke-identity.js` first, which calls `app.setName("orchestratedash")` so
 * its single-instance lock and its default `userData` path match the
 * installed app's. That is exactly right for a normal session and exactly
 * wrong for this one: this branch was cut to run **beside** an attended test
 * on the real store, in its own worktree, and a capture process claiming the
 * real app's identity would either fight that test for the single-instance
 * lock or, if `DASH_DATA_DIR` were forgotten even once, write into its store.
 *
 * So this harness is `capture-connectors.ts`'s shape — no `smoke-identity`
 * import, a scratch store this run seeds itself, `DASH_CAPTURE_DIR` chosen by
 * the caller — applied to the three pages this issue actually touched.
 * Connections is not reshot here: `capture-connectors.ts` already covers it,
 * including the fleet card whose button this issue moved back above the fold.
 * Add agent is untouched and under Henrik's hold, so it is not reshot either.
 *
 * ## Run it
 *
 *     pnpm build:renderer
 *     pnpm build:shell
 *     $env:DASH_SHELL_URL='dash-app://ui/'
 *     $env:DASH_DATA_DIR='…\scratch-settings-polish'
 *     $env:DASH_CAPTURE_DIR='qa-screenshots-mar599'
 *     pnpm exec electron dist/electron/capture-settings-polish.mjs
 *
 * From **PowerShell**, with a visible, unoccluded window. Never on the
 * `electron .` path and named by no `package.json` script, for ADR 0004's
 * reason: this produces evidence, never a verdict.
 */

import "./main.js";
import { appWindow } from "./app-window.js";

import { app, BrowserWindow, nativeTheme } from "electron";

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/*
 * The scene's own doors (MAR-642 / MAR-685, proving sweep group C).
 *
 * This harness photographed an empty scratch store, which was right for
 * MAR-599: a duplicated heading is a duplicated heading whether or not there
 * is anything under it. It is wrong for every claim MAR-642 makes. An AI tab
 * with no key held draws the picker and no cards; a Connections page with no
 * agents draws no service rows at all; the Servers summary table MAR-642 adds
 * has one row per deployed copy and therefore none. Photographing those empty
 * states and filing them as proof of the merge would be evidence that the
 * page renders, not evidence of what the issue asked for.
 *
 * Everything below goes in through the ordinary doors, on
 * `electron/capture-glance.ts`'s rule — a seed that reached past the
 * validators could stage a state the product cannot actually reach.
 */
import { fleetSecretName } from "../lib/fleet/catalogue.js";
import { recordFleetConnection } from "../lib/fleet/store.js";
import { maskSecret } from "../lib/secret-refs.js";
import { importManifest, recordAgentDeploy, saveHost } from "../lib/store.js";
import { secureStore } from "./secure-store.js";

const OUT = path.resolve(
  process.cwd(),
  process.env.DASH_CAPTURE_DIR ?? "qa-screenshots-mar599",
);

const VIEWPORTS = [
  { name: "1280", width: 1280, height: 900 },
  { name: "768", width: 768, height: 1024 },
  { name: "375", width: 375, height: 812 },
] as const;

const THEMES = ["light", "dark"] as const;
const DENSITIES = ["comfortable", "compact"] as const;

/**
 * The three pages MAR-599 touched, and the two MAR-642 added or rebuilt.
 *
 * Connections is at the Settings root rather than at a path of its own, which
 * is why it reads oddly in this list and is left that way: `SETTINGS_TABS`
 * names it `/settings`, and a harness that invented a tidier address would be
 * photographing a route the tab strip cannot reach.
 */
const PAGES = [
  { name: "connections", path: "/settings" },
  { name: "ai", path: "/settings/ai" },
  { name: "servers", path: "/settings/servers" },
  { name: "notifications", path: "/settings/notifications" },
  { name: "preferences", path: "/settings/preferences" },
] as const;

/* ---------------------------------------------------------------------- *
 * The store this run photographs (MAR-642)
 * ---------------------------------------------------------------------- */

/** An agent that needs a mailbox: gives Connections a service row to draw. */
const MAILBOX = "meeting-assistant";
/** An agent that declares a key DASH does not hold: the un-met half. */
const NEEDS_KEY = "ledger-reporter";

function example(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.resolve(process.cwd(), "examples", name), "utf8")) as Record<
    string,
    unknown
  >;
}

function renamed(file: string, name: string, displayName: string): Record<string, unknown> {
  const manifest = example(file);
  const agent = manifest["agent"] as Record<string, unknown>;
  agent["name"] = name;
  agent["display_name"] = displayName;
  return manifest;
}

/**
 * Seed the store this run was pointed at.
 *
 * One held model key, two agents that need something, and one server with a
 * copy on it. That is the smallest store in which every MAR-642 bullet has
 * something to say: the AI tab draws a key card *and* the two it does not
 * hold behind the +, Connections draws a service-keyed row with a needed-by
 * list, and the Servers page draws its summary table with a real row in it.
 *
 * ## The vault write is real, and it has to be
 *
 * MAR-676's lesson, paid for on Henrik's own store: a `fleet_connections` row
 * naming a secret nothing stored is not a connected provider — it is the exact
 * state whose honest chip is "DASH cannot read this". A scene that wrote the
 * row alone would photograph a *failure* under a filename claiming a held key.
 * So this puts a value in the scratch directory's own vault through
 * `secureStore`, the same door `connect` uses.
 *
 * There is no real credential behind it. The bytes are a fixture string, so
 * pressing "Check it still works" in these images would fail, and the
 * mutation scene below deliberately presses a control that does not talk to a
 * provider.
 */
async function seed(): Promise<void> {
  importManifest(
    renamed("gmail-meeting-assistant.manifest.v2.example.json", MAILBOX, "Meeting Assistant"),
  );
  importManifest(
    renamed("dash-managed-secret.manifest.v2.example.json", NEEDS_KEY, "Ledger Reporter"),
  );

  await holdOpenRouterKey();
  await holdGmailAccount();

  /*
   * One server with one copy on it, so MAR-642's summary table has a row.
   * TEST-NET-1, because this run never talks to a server, and the standing
   * comes from the deploy record rather than from a liveness claim (ADR 0015).
   */
  saveHost({
    host_id: "scene-vps",
    label: "My server",
    address: "192.0.2.1",
    port: 22,
    username: "dash",
    key_name: "scene-vps",
    host_fingerprint: null,
    added_at: "2026-08-10T12:00:00.000Z",
  });
  recordAgentDeploy(
    {
      agent: MAILBOX,
      host_id: "scene-vps",
      manifest_sha256: "scene-manifest-digest",
      files_sha256: "scene-files-digest",
    },
    "2026-08-10T21:00:00.000Z",
  );

  console.log(
    "[settings-polish] seeded: one held OpenRouter key (readable), two agents, one deployed copy",
  );
}

/**
 * Put the key back, on its own, so the mutation scene can take it away again.
 *
 * Separated from `seed` because the scene below *disconnects* it: running the
 * scene twice — once per theme, since MAR-614 records that light mode is the
 * half Henrik said he likes — needs the second pass to start from the same
 * state the first did. Re-running the whole seed would also re-record the
 * deploy and quietly give the Servers summary table a second row.
 */
async function holdOpenRouterKey(): Promise<void> {
  const at = "2026-08-16T08:00:00.000Z";
  const secretName = fleetSecretName("openrouter", "api_key", "account-1");
  recordFleetConnection(
    {
      provider: "openrouter",
      account_id: "account-1",
      connector_kind: "api_key",
      field_id: "api_key",
      secret_name: secretName,
      /*
       * Masked at the door. `recordFleetConnection` throws on a hint that is
       * not already masked, so this path cannot put a value in the row even
       * by mistake — which is why the mask is applied here rather than a
       * pre-masked literal being pasted in.
       */
      masked_hint: maskSecret("sk-or-v1-capture-scene-only-2f8c"),
      /* Null for a key, which identifies nobody — the row's own contract. */
      account_hint: null,
      scopes: [],
      backend: "file",
      is_default: true,
    },
    at,
  );
  await secureStore().set(secretName, "sk-or-v1-capture-scene-only-2f8c");
}

/**
 * TWO connected Gmail accounts, for the Connections half of MAR-685.
 *
 * The issue names two surfaces — "the AI tab … and the Connections tab" —
 * and they are two page components with two copies of the same `revision`
 * state. Proving one and reasoning about the other would be exactly the
 * two-renderers mistake this repository keeps paying for, so the scene
 * presses a control on each.
 *
 * Gmail rather than a second key: it is what the Connections tab is *for*
 * once the model providers moved to AI (MAR-642's own split), so a
 * Connections page whose only row was a key would be photographing the
 * arrangement this packet replaced.
 *
 * ## Why two, and what the first draft's one account proved instead
 *
 * With a single account the scene pressed Disconnect and **nothing changed**
 * — correctly. `lib/fleet/actions.ts:536` refuses to disconnect an account an
 * agent still depends on, and the page said so in a red notice: *"Choose
 * another Gmail account for meeting-assistant before disconnecting this
 * one."* The store was untouched, so a re-read would have had nothing to
 * show, and the scene could not have told a working `bump()` from a broken
 * one. A refusal is not a mutation.
 *
 * So the second account exists to give the scene something DASH will
 * actually do. `account-2` is not the default and no agent is assigned to
 * it, which is exactly the condition `assignedAgents` checks — disconnecting
 * it leaves `meeting-assistant` with the account it had and lets the
 * mutation through.
 *
 * The refresh tokens are fixture strings. Nothing in this run talks to
 * Google, and the pressed control is a local disconnect.
 */
async function holdGmailAccount(): Promise<void> {
  const at = "2026-08-16T08:00:00.000Z";
  for (const account of [
    { id: "account-1", hint: "he••••@gmail.com", isDefault: true },
    { id: "account-2", hint: "wo••••@gmail.com", isDefault: false },
  ]) {
    const secretName = fleetSecretName("google-gmail", "sign_in", account.id);
    recordFleetConnection(
      {
        provider: "google-gmail",
        account_id: account.id,
        connector_kind: "google_oauth_broker",
        field_id: "sign_in",
        secret_name: secretName,
        masked_hint: account.hint,
        account_hint: account.hint,
        scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        backend: "os_keychain",
        is_default: account.isDefault,
      },
      at,
    );
    await secureStore().set(
      secretName,
      JSON.stringify({
        format_version: 1,
        refresh_token: `capture-fixture-${account.id}`,
        scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        obtained_at: at,
      }),
    );
  }
}

function settle(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function within<T>(what: string, ms: number, work: Promise<T>): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${what} did not finish within ${String(ms)}ms`)), ms),
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

const written: string[] = [];
const measurements: object[] = [];

async function shoot(target: BrowserWindow, name: string): Promise<void> {
  let image;
  try {
    image = await within(`capturePage for ${name}`, 20_000, target.webContents.capturePage());
  } catch (error: unknown) {
    console.log(
      `[settings-polish]   retrying ${name} after ${error instanceof Error ? error.message : String(error)}`,
    );
    target.show();
    target.focus();
    await settle(1500);
    image = await within(
      `capturePage retry for ${name}`,
      20_000,
      target.webContents.capturePage(),
    );
  }
  writeFileSync(path.join(OUT, `${name}.png`), image.toPNG());
  const size = image.getSize();
  written.push(name);
  console.log(`[settings-polish] ${name}.png ${String(size.width)}x${String(size.height)}`);
}

async function resizeTo(target: BrowserWindow, width: number, height: number): Promise<number> {
  const deadline = Date.now() + 8000;
  let seen = 0;
  while (Date.now() < deadline) {
    target.restore();
    target.unmaximize();
    target.setResizable(true);
    target.setContentSize(width, height);
    await settle(150);
    seen = (await within(
      "read viewport",
      5000,
      target.webContents.executeJavaScript("window.innerWidth"),
    )) as number;
    if (Math.abs(seen - width) <= 2) {
      await settle(400);
      return seen;
    }
  }
  const [contentWidth, contentHeight] = target.getContentSize();
  throw new Error(
    `window would not resize to ${String(width)}px — the page reports ${String(seen)}px, ` +
      `the window reports ${String(contentWidth)}x${String(contentHeight)}`,
  );
}

async function go(target: BrowserWindow, route: string): Promise<void> {
  const next = new URL(route, target.webContents.getURL()).toString();
  await within(`load ${route}`, 20_000, target.webContents.loadURL(next));
  await settle(1200);
}

async function pressDensityToggle(target: BrowserWindow): Promise<string | null> {
  const pressed = (await target.webContents.executeJavaScript(
    `(() => {
       const button = document.querySelector("button.density-toggle");
       if (button === null) return null;
       button.click();
       return document.documentElement.getAttribute("data-density");
     })()`,
  )) as string | null;
  await settle(350);
  return pressed;
}

/**
 * The check this issue is actually about: does the heading repeat the tab,
 * and — on Servers and Notifications — is the page's own `<h1>` on screen at
 * all, rather than the document root's horizontal overflow, which is the axis
 * every existing capture harness already measured and the axis this defect
 * was never on.
 */
async function layout(target: BrowserWindow): Promise<unknown> {
  return within(
    "measure layout",
    10_000,
    target.webContents.executeJavaScript(
      `(() => {
         const root = document.documentElement;
         const h1 = document.querySelector("main h1, h1");
         const tab = document.querySelector(".settings-tab.is-active");
         return {
           viewport: window.innerWidth,
           page_scroll_width: root.scrollWidth,
           page_overflows: root.scrollWidth > root.clientWidth,
           heading_text: h1 === null ? null : h1.textContent,
           active_tab_text: tab === null ? null : tab.textContent,
           heading_repeats_tab: h1 !== null && tab !== null && h1.textContent === tab.textContent,
           density_toggle_found: document.querySelector("button.density-toggle") !== null,

           /* ---------------------------------------------------------- *
            * MAR-642's five bullets, read where each of them landed.
            *
            * Recorded, never asserted: this harness gates MAR-599's own
            * claim (a heading must not repeat its tab) and nothing else,
            * and a proving session inventing a new release gate would be a
            * bar nobody agreed to. Every field below is null or zero on the
            * four pages it is not about, which is the honest reading rather
            * than a gap.
            *
            * No backticks anywhere in this block. It is inside an injected
            * page script, and a bare one closes the template literal with
            * the compiler reporting the damage somewhere else entirely.
            * ---------------------------------------------------------- */

           /* Bullet 1 — the AI tab: key cards, the + behind the rest, and
              the global default that had no home before this issue. */
           ai_key_cards: [...document.querySelectorAll(".fleet-connectors .fleet-connector")].map(
             (card) => ({
               service: (card.querySelector(".card-head h3, .card-head h2")?.textContent ?? "").trim(),
               chip: (card.querySelector(".chip")?.textContent ?? "").trim(),
               buttons: [...card.querySelectorAll(".button-row button")].map((one) =>
                 (one.textContent ?? "").trim(),
               ),
             }),
           ),
           ai_add_key_button: (() => {
             const button = [...document.querySelectorAll("button")].find((one) =>
               (one.textContent ?? "").trim().startsWith("+"),
             );
             return button === undefined ? null : (button.textContent ?? "").trim();
           })(),
           model_default: (() => {
             const section = document.querySelector(".model-default");
             if (section === null) return null;
             return {
               in_force: (section.querySelector(".model-in-force")?.textContent ?? "").trim(),
               provider_select: section.querySelector("#model-default-provider") !== null,
               model_select: section.querySelector("#model-default-select") !== null,
             };
           })(),

           /* Bullet 2 — Connections as ONE service-keyed list. The number
              that matters is how many *card systems* the page stacks: the
              defect was two lists with near-identical vocabulary, so a page
              drawing service rows AND fleet-connector cards has not merged. */
           service_rows: [...document.querySelectorAll(".service-row")].map((row) => ({
             service: (row.querySelector(".service-name")?.textContent ?? "").trim(),
             account: (row.querySelector(".service-account")?.textContent ?? "").trim() || null,
             chip: (row.querySelector(".chip")?.textContent ?? "").trim(),
             needed_by: row.querySelectorAll(".service-needed").length,
           })),
           connector_card_systems: [
             document.querySelectorAll(".service-list").length > 0 ? "service-list" : null,
             document.querySelectorAll(".connector-tile").length > 0 ? "connector-tiles" : null,
             document.querySelectorAll(".fleet-connectors").length > 0 ? "fleet-connectors" : null,
           ].filter((one) => one !== null),

           /* Bullet 3 — Servers: the summary table at the top, the deploy
              flow demoted to a per-agent link, and no initiation left here. */
           deployed_table: (() => {
             const table = document.querySelector(".deployed-table");
             if (table === null) return null;
             return {
               rows: table.querySelectorAll("tbody tr").length,
               headers: [...table.querySelectorAll("thead th")].map((one) =>
                 (one.textContent ?? "").trim(),
               ),
               first_row: [...(table.querySelector("tbody tr")?.children ?? [])].map((one) =>
                 (one.textContent ?? "").trim(),
               ),
             };
           })(),
           /*
            * "Put an agent here" is now a list of destinations rather than a
            * deploy flow, and a bare count of links reads as an absence when
            * it is zero. It legitimately can be: an agent already sent here
            * is drawn with an "already here" chip instead of a link, and one
            * that cannot be sent at all is drawn with its refusal rather than
            * filtered out — the component says so in its own header. So the
            * rows are recorded with which of the three they are, and a
            * reviewer can tell "the control is missing" from "every agent in
            * this store is already there or cannot go".
            */
           send_here: [...document.querySelectorAll(".send-here-agent")].map((row) => ({
             name: (row.querySelector(".send-here-name")?.textContent ?? "").trim(),
             link: row.querySelector("a") === null
               ? null
               : (row.querySelector("a")?.textContent ?? "").trim(),
             already_here: row.querySelector(".chip") !== null,
             text: (row.textContent ?? "").trim(),
           })),
           send_here_links: document.querySelectorAll(".send-here-list a").length,
           /* Zero is the claim. A deploy that still started here would be a
              second door to one act, which is what the bullet closed. */
           deploy_panels: document.querySelectorAll(".deploy-panel").length,

           /* Bullet 4 — Light/Dark/System on Preferences, and the
              apologising theme paragraph the bullet says it kills. */
           theme_options: [...document.querySelectorAll(".theme-option")].map((option) => ({
             value: option.getAttribute("data-theme-option"),
             label: (option.textContent ?? "").trim(),
             checked: option.querySelector("input")?.checked === true,
           })),

           /* Bullet 5 — Notifications is a status row, not an article. The
              number the bullet states is a prose count, so that is what this
              counts: paragraphs in the page's main region, and the standing
              lines that replaced them. */
           notify_standings: [...document.querySelectorAll(".notify-standing")].map((one) =>
             (one.textContent ?? "").trim(),
           ),
           main_paragraphs: document.querySelectorAll("main p").length,
           /*
            * The backslash is doubled on purpose. This whole script is a
            * template literal in the .ts file, so a single-escaped class
            * arrives at the page as /s+/ and the count would be a split on
            * the letter s — a defect this repository has already shipped
            * once, in an injected script exactly like this one.
            *
            * innerText, not textContent: it is what a person can read, and
            * it reports DASH's buttons in the upper case the stylesheet
            * forces. That changes no count here, and it is the reason a
            * later reader should not grep these strings for card copy.
            */
           main_words: (document.querySelector("main")?.innerText ?? "")
             .split(/\\s+/)
             .filter((word) => word.length > 0).length,
         };
       })()`,
    ),
  );
}

/**
 * Force the ambient density to comfortable before the loop starts.
 *
 * `localStorage` lives in Electron's session partition, not in
 * `DASH_DATA_DIR` — so it is shared by every unpackaged capture process that
 * ever ran against this machine's default `Electron` userData directory,
 * regardless of which scratch SQLite store each one pointed at. A prior run
 * left "compact" behind once and the very first "comfortable" frame here was
 * captured compact — a wrong label nobody would have caught from the image
 * alone, because the layout is legitimately the same shape at both settings.
 * This reads the actual attribute and presses the control only if it
 * disagrees with what the loop is about to assume.
 */
async function ensureComfortable(target: BrowserWindow): Promise<void> {
  const current = (await target.webContents.executeJavaScript(
    `document.documentElement.getAttribute("data-density")`,
  )) as string | null;
  if (current === "compact") {
    console.log("[settings-polish] ambient density was compact from a prior run — resetting");
    await pressDensityToggle(target);
  }
}

/* ====================================================================== *
 * The mutation scene: MAR-685, "the screen only updates after navigating
 * away and back"
 *
 * Henrik, 2026-08-17, right after adding an OpenRouter key on this tab:
 * *"Added key, but the page barely updated. Clicked Agents and then back to
 * Settings and then it rendered new."*
 *
 * That is a claim no still frame can carry, in either direction. A photograph
 * of a correct card proves nothing about whether a *navigation* was needed to
 * get it, which is the entire complaint. So this scene is three readings
 * around one press, with no navigation anywhere between them:
 *
 *   1. read the card;
 *   2. press a control that changes the store;
 *   3. read the card again, on the same document object.
 *
 * The URL is recorded on both sides and compared. If it changed, the scene
 * failed and says so, because a re-read that followed a reload would be the
 * old behaviour wearing the new behaviour's result.
 *
 * ## Why Disconnect, and not the key-add Henrik actually pressed
 *
 * Adding a key opens `electron/credential-prompt.ts` — a separate window with
 * a field a person types a real credential into. A harness that drove it
 * would be a harness that types a credential, and the value would be a
 * fixture, so what came back from the provider on the next press would be a
 * failure photographed as a success.
 *
 * Disconnect is the same mechanism from the other end and needs no
 * credential: it is a store mutation, on this surface, whose result this
 * surface draws — which is exactly the scope sentence the issue wrote
 * ("any button that changes stored state and whose result is shown on the
 * same surface"). `AiPage`'s `bump()` is the one thing under test, and both
 * presses go through the same `onChanged` callback in `AiKeys`.
 * ====================================================================== */

const scenesLog: object[] = [];

/** What the AI tab is showing, as the fields the issue argues about. */
async function readAiTab(target: BrowserWindow): Promise<unknown> {
  return within(
    "read the AI tab back",
    10_000,
    target.webContents.executeJavaScript(
      `(() => {
         const cards = [...document.querySelectorAll(".fleet-connector")];
         return {
           url: window.location.href,
           /* The sentence AiKeys counts over the cards it actually drew, so
              it cannot drift from what is under it. */
           summary: (document.querySelector(".fleet-connectors .page-summary")?.textContent ?? "").trim(),
           cards: cards.map((card) => ({
             service: (card.querySelector(".card-head h3, .card-head h2")?.textContent ?? "").trim(),
             chip: (card.querySelector(".chip")?.textContent ?? "").trim(),
             buttons: [...card.querySelectorAll(".button-row button")].map((one) =>
               (one.textContent ?? "").trim(),
             ),
           })),
           card_count: cards.length,
         };
       })()`,
    ),
  );
}

async function mutationScene(target: BrowserWindow, theme: string): Promise<void> {
  await go(target, "/settings/ai");
  await resizeTo(target, 1280, 900);
  await go(target, "/settings/ai");

  const before = (await readAiTab(target)) as { url: string; card_count: number };
  await shoot(target, `ai-mutation-before-1280-${theme}`);

  const pressed = (await within(
    "press Disconnect",
    10_000,
    target.webContents.executeJavaScript(
      `(() => {
         const button = [...document.querySelectorAll(".fleet-connector .button-row button")].find(
           (one) => (one.textContent ?? "").trim().toLowerCase().startsWith("disconnect"),
         );
         if (button === undefined) return null;
         const label = (button.textContent ?? "").trim();
         button.click();
         return label;
       })()`,
    ),
  )) as string | null;

  /*
   * Long enough for the command to round-trip to main and for the re-read
   * bump() asks for to land, and no longer. A wait that outlasts a human's
   * patience would prove the view catches up eventually, which is not the
   * complaint — the complaint is that it did not catch up at all.
   */
  await settle(2500);

  const after = (await readAiTab(target)) as { url: string; card_count: number };
  await shoot(target, `ai-mutation-after-1280-${theme}`);

  scenesLog.push({
    scene: `ai-mutation-${theme}`,
    claim: "MAR-685 — a settings mutation is reflected without navigating away and back",
    pressed,
    /* The whole point: same document, same address, different content. */
    url_before: before.url,
    url_after: after.url,
    navigated: before.url !== after.url,
    before,
    after,
    changed_in_place:
      pressed !== null && before.url === after.url
      && JSON.stringify(before) !== JSON.stringify(after),
  });
  console.log(
    `[settings-polish] SCENE ai-mutation-${theme} ${JSON.stringify(scenesLog[scenesLog.length - 1])}`,
  );
}

/** What the Connections tab is showing, in the terms MAR-685 argues about. */
async function readConnectionsTab(target: BrowserWindow): Promise<unknown> {
  return within(
    "read the Connections tab back",
    10_000,
    target.webContents.executeJavaScript(
      `(() => {
         const rows = [...document.querySelectorAll(".service-row")];
         return {
           url: window.location.href,
           summary: (document.querySelector(".service-list .page-summary")?.textContent ?? "").trim(),
           rows: rows.map((row) => ({
             service: (row.querySelector(".service-name")?.textContent ?? "").trim(),
             /*
              * The row's OWN standing chip, which is the first chip inside
              * .service-head — not the first chip anywhere in the row. A
              * plain ".chip" also matches the per-agent chip in the
              * needed-by list below it, and the two legitimately disagree:
              * a service DASH holds an account for can still be un-granted
              * for a particular agent.
              */
             chip: (row.querySelector(".service-head .chip")?.textContent ?? "").trim(),
             account: (row.querySelector(".service-account")?.textContent ?? "").trim() || null,
             accounts: row.querySelectorAll(".service-account-row").length,
             account_hints: [...row.querySelectorAll(".service-account-row")].map((one) =>
               (one.querySelector("p")?.textContent ?? "").trim(),
             ),
           })),
           /*
            * What DASH said about the last press. A refusal renders here and
            * leaves the store alone, so a scene that did not read it could
            * mistake "DASH declined" for "the view did not refresh" — which
            * is precisely what the first draft of this scene did.
            */
           notices: [...document.querySelectorAll(".service-row .notice")].map((one) =>
             (one.textContent ?? "").trim(),
           ),
         };
       })()`,
    ),
  );
}

/**
 * The Connections half of MAR-685 — same shape, second surface.
 *
 * `app/settings/page.tsx` holds its own `revision`/`bump()` pair, separate
 * from `app/settings/ai/page.tsx`'s. Reading that the code is there is not
 * the same as watching it work, which is the whole reason this session
 * presses things.
 */
async function connectionsMutationScene(target: BrowserWindow, theme: string): Promise<void> {
  await go(target, "/settings");
  await resizeTo(target, 1280, 900);
  await go(target, "/settings");
  await within(
    "scroll to the Gmail row",
    5_000,
    target.webContents.executeJavaScript(
      `document.querySelector(".service-row")?.scrollIntoView({ block: "center" })`,
    ),
  );
  await settle(400);

  const before = (await readConnectionsTab(target)) as { url: string };
  await shoot(target, `connections-mutation-before-1280-${theme}`);

  /*
   * The NON-default account's Disconnect.
   *
   * Any Disconnect would be a press; only this one is a mutation. The
   * default account is the one `meeting-assistant` resolves to, and
   * disconnecting it is refused before the store is touched (see
   * `holdGmailAccount`'s header) — so pressing it would produce a
   * before/after pair that is identical because nothing was meant to change,
   * and the scene could not tell that from a view that failed to re-read.
   */
  const pressed = (await within(
    "press Disconnect on the account no agent depends on",
    10_000,
    target.webContents.executeJavaScript(
      `(() => {
         const row = [...document.querySelectorAll(".service-account-row")].find(
           (one) => one.querySelector(".chip") === null,
         );
         if (row === undefined) return null;
         const button = [...row.querySelectorAll("button")].find(
           (one) => (one.textContent ?? "").trim().toLowerCase().startsWith("disconnect"),
         );
         if (button === undefined) return null;
         const label = (button.textContent ?? "").trim();
         const account = (row.querySelector("p")?.textContent ?? "").trim();
         button.click();
         return { label: label, account: account };
       })()`,
    ),
  )) as { label: string; account: string } | null;
  await settle(2500);

  const after = (await readConnectionsTab(target)) as { url: string };
  await shoot(target, `connections-mutation-after-1280-${theme}`);

  scenesLog.push({
    scene: `connections-mutation-${theme}`,
    claim: "MAR-685 — the Connections tab reflects its own mutation without a navigation",
    pressed,
    url_before: before.url,
    url_after: after.url,
    navigated: before.url !== after.url,
    before,
    after,
    changed_in_place:
      pressed !== null && before.url === after.url
      && JSON.stringify(before) !== JSON.stringify(after),
  });
  console.log(
    `[settings-polish] SCENE connections-mutation-${theme} ${JSON.stringify(scenesLog[scenesLog.length - 1])}`,
  );
}

async function run(): Promise<void> {
  await app.whenReady();
  mkdirSync(OUT, { recursive: true });
  await seed();

  const window = await appWindowLoaded();
  window.setResizable(true);
  await settle(1200);
  await go(window, PAGES[0].path);
  await ensureComfortable(window);

  for (const theme of THEMES) {
    nativeTheme.themeSource = theme;
    await settle(300);

    for (const page of PAGES) {
      for (const viewport of VIEWPORTS) {
        for (const density of DENSITIES) {
          await go(window, page.path);
          await resizeTo(window, viewport.width, viewport.height);
          await go(window, page.path);

          if (density === "compact" && (await pressDensityToggle(window)) === null) {
            console.log(
              `[settings-polish] no density control at ${page.name}/${viewport.name} — compact skipped`,
            );
            continue;
          }

          const measured = await layout(window);
          measurements.push({ page: page.name, viewport: viewport.name, theme, density, ...(measured as object) });
          console.log(
            `[settings-polish] ${page.name}/${viewport.name}/${theme}/${density} ${JSON.stringify(measured)}`,
          );
          await shoot(window, `${page.name}-${viewport.name}-${theme}-${density}`);

          if (density === "compact") {
            await pressDensityToggle(window);
          }
        }
      }
    }
  }

  /*
   * The pressed half, after every cold frame — never inside the loop, because
   * the press takes the key away and each later frame of the AI tab would
   * then photograph a state its filename does not claim. The key is put back
   * between passes so the second theme starts where the first did.
   */
  for (const theme of THEMES) {
    nativeTheme.themeSource = theme;
    await settle(300);
    await holdOpenRouterKey();
    await mutationScene(window, theme);
    await holdGmailAccount();
    await connectionsMutationScene(window, theme);
  }

  /*
   * `layout-settings.json`, not `layout.json`.
   *
   * `DASH_CAPTURE_DIR` is chosen by the caller and a proving sweep points
   * several harnesses at ONE directory on purpose, so a reviewer finds a
   * packet's evidence in one place. Two of them writing `layout.json` means
   * the second run silently deletes the first one's measurements — which is
   * exactly what happened here: this harness's numbers were overwritten by
   * `capture-cockpit.ts`'s, with 40 images still sitting beside them looking
   * like evidence that had a JSON to back it.
   *
   * The images never collided, because every filename here is prefixed by
   * its page. This one file was not, and a stale or missing measurement file
   * is the same class of failure as a stale log faking a successful run.
   */
  writeFileSync(
    path.join(OUT, "layout-settings.json"),
    `${JSON.stringify(
      { captured_at: new Date().toISOString(), measurements, scenes: scenesLog },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const overflowed = measurements.filter((entry) => (entry as { page_overflows: boolean }).page_overflows);
  const repeated = measurements.filter(
    (entry) => (entry as { heading_repeats_tab: boolean }).heading_repeats_tab,
  );
  console.log(
    `\n[settings-polish] wrote ${String(written.length)} images and layout-settings.json to ${OUT}\n` +
      `[settings-polish] ${overflowed.length === 0 ? "no frame overflowed sideways" : `${String(overflowed.length)} FRAMES OVERFLOWED`}\n` +
      `[settings-polish] ${repeated.length === 0 ? "no heading repeats its active tab" : `${String(repeated.length)} HEADINGS REPEAT THEIR TAB`}`,
  );

  app.exit(0);
}

void run().catch((error: unknown) => {
  console.error(`[settings-polish] failed: ${error instanceof Error ? error.message : String(error)}`);
  app.exit(1);
});
