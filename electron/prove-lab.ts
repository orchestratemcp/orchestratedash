/**
 * The row in somebody else's database that MAR-479 is actually about.
 *
 * Not a release gate and not a test. This drives the real shell against the
 * real store, presses the real Send now button, and reports whether a running
 * LAB took what DASH posted — the one claim no unit test in this repository can
 * make, because the receiving end is a different program in a different
 * repository on a port this one does not own.
 *
 * ## Running it
 *
 * With a LAB running on loopback, `LAB_DASH_INGEST_ENABLED=1` and
 * `LAB_DASH_INGEST_TOKEN` set in *that* repository's `.env`:
 *
 * ```powershell
 * pnpm build:renderer; pnpm build:shell
 * $env:DASH_SHELL_URL='dash-app://ui/'
 * $env:DASH_DATA_DIR='C:\Users\<you>\AppData\Roaming\orchestratedash'
 * $env:DASH_PROVE_LAB_TOKEN='<the same value as LAB_DASH_INGEST_TOKEN>'
 * pnpm exec electron --user-data-dir=<isolated profile> dist/electron/prove-lab.mjs
 * ```
 *
 * `DASH_DATA_DIR` is required and deliberately not defaulted, for
 * `electron/prove-start.ts`' reason: a harness runs as `Electron` rather than as
 * `orchestratedash`, and a run that quietly defaulted would report a triumph
 * over an empty store.
 *
 * ## The two things this harness does that `prove-start.ts` refuses to
 *
 * **It plants the token.** `lab.connect` opens the credential window
 * `electron/credential-prompt.ts` owns, which is a modal a harness cannot type
 * into — that is the whole point of that window and it should stay true. So the
 * setup here writes the vault entry and the settings row directly, exactly as a
 * person's paste would have.
 *
 * **It can seed the store**, when `DASH_PROVE_LAB_MANIFEST` and
 * `DASH_PROVE_LAB_EVENTS` are given, through the same `importManifest` and
 * `ingestEvents` that `/api/events` calls. Point them at a real agent's own
 * manifest and its own `runs/events.jsonl` and what gets reported is a real
 * agent's real plan on the real days it ran — the store is fresh, the material
 * in it is not. Omit both to run against whatever store `DASH_DATA_DIR` names.
 *
 * **Everything after the setup is the real path**: the switch goes through the
 * ordinary command channel, and the send is a click on the page's own button.
 *
 * Stated rather than hidden, because it is the difference between what this
 * proves and what it does not. It proves that a configured DASH composes a
 * payload from real manifests and real run days, and that a real LAB accepts it.
 * It does not prove that the credential window stores what somebody typed —
 * `tests/lab-telemetry.test.ts` drives `performLabAction("connect", …)` against
 * a fake prompt for that half.
 */
import "./main.js";
import { app } from "electron";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { appWindow } from "./app-window.js";
import { LAB_TELEMETRY_SECRET_NAME } from "../lib/lab/settings.js";
import { maskSecret } from "../lib/secret-refs.js";
import { secureStore } from "./secure-store.js";
import {
  importManifest,
  ingestEvents,
  listLabSends,
  readLabTelemetrySettings,
  recordLabTelemetryToken,
} from "../lib/store.js";

const TOKEN = process.env["DASH_PROVE_LAB_TOKEN"] ?? "";
const ENDPOINT = process.env["DASH_PROVE_LAB_ENDPOINT"] ?? "http://127.0.0.1:3000";
const MANIFEST_PATH = process.env["DASH_PROVE_LAB_MANIFEST"] ?? "";
const EVENTS_PATH = process.env["DASH_PROVE_LAB_EVENTS"] ?? "";
const out = path.resolve(process.cwd(), process.env["DASH_CAPTURE_DIR"] ?? "qa-proof-mar479");

/**
 * Put a real agent's own manifest and its own run log into this store.
 *
 * Through `importManifest` and `ingestEvents` — the same two functions
 * `/api/events` and the folder import call — so a manifest that would be
 * refused in the app is refused here too, and a malformed event line is dropped
 * the same way rather than smuggled past the contract.
 */
function seed(): { agent: string; events: number } {
  const manifest: unknown = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
  const imported = importManifest(manifest);
  if (!imported.ok) {
    throw new Error(`the manifest at ${MANIFEST_PATH} is not one DASH accepts: ${imported.errors.join("; ")}`);
  }

  const events = readFileSync(EVENTS_PATH, "utf-8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as unknown);
  const result = ingestEvents(events);

  return { agent: imported.agent, events: result.accepted };
}

/** How long to let one send settle, in 500 ms steps. */
const SETTLE_STEPS = 40;

interface Observation {
  chip: string;
  preview_count: number;
  preview_body: string;
  sends: number;
  newest: { outcome: string; status: number | null; accepted: number; body: string } | null;
}

async function windowReady() {
  for (;;) {
    const window = appWindow();
    if (window !== null && !window.webContents.isLoading()) {
      return window;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * What the page says, read from the same view the page renders from.
 *
 * The chip is read out of the rendered DOM rather than recomputed, because the
 * claim is that a person looking at this page can see what happened.
 */
const OBSERVE = `(() => {
  const chip = document.querySelector('.notify-standing .chip');
  return window.dashData.labTelemetry().then((view) => ({
    chip: chip === null ? 'none' : chip.textContent.trim(),
    preview_count: view.data?.preview_count ?? -1,
    preview_body: view.data?.preview_body ?? '',
    sends: view.data?.sends?.length ?? 0,
    newest: view.data?.sends?.[0] === undefined ? null : {
      outcome: view.data.sends[0].outcome,
      status: view.data.sends[0].status,
      accepted: view.data.sends[0].accepted,
      body: view.data.sends[0].body,
    },
  }));
})()`;

async function run(): Promise<void> {
  await app.whenReady();
  mkdirSync(out, { recursive: true });

  if (TOKEN.length === 0) {
    throw new Error("DASH_PROVE_LAB_TOKEN is required — it is LAB's own LAB_DASH_INGEST_TOKEN.");
  }

  if (MANIFEST_PATH.length > 0 && EVENTS_PATH.length > 0) {
    const seeded = seed();
    console.log(`[prove-lab] seeded ${seeded.agent} with ${String(seeded.events)} of its own events`);
  }

  // The paste, stood in for. See the docblock for why this one step is not the
  // real path and why the rest of the harness is.
  await secureStore().set(LAB_TELEMETRY_SECRET_NAME, TOKEN);
  recordLabTelemetryToken(maskSecret(TOKEN), ENDPOINT);

  const window = await windowReady();
  const url = new URL("/settings/reporting", window.webContents.getURL()).toString();
  await window.loadURL(url);
  await new Promise((resolve) => setTimeout(resolve, 3_000));

  const before = (await window.webContents.executeJavaScript(OBSERVE)) as Observation;
  console.log(`[prove-lab] before: chip=${before.chip} pending=${String(before.preview_count)}`);
  writeFileSync(path.join(out, "before.json"), `${JSON.stringify(before, null, 2)}\n`);
  writeFileSync(path.join(out, "before.png"), (await window.webContents.capturePage()).toPNG());

  if (before.preview_count <= 0) {
    throw new Error(
      "nothing to send — this store has no agent that has run, or every day is already reported.",
    );
  }

  // Switching on goes through the ordinary command channel, by clicking the
  // page's own control. A harness calling `setLabTelemetryEnabled` directly
  // would prove the store works and leave the consent press unproven.
  await window.webContents.executeJavaScript(
    `[...document.querySelectorAll('.button-row button')].find((b) => b.textContent.trim() === 'Start sending').click()`,
  );
  await new Promise((resolve) => setTimeout(resolve, 2_000));

  // And the send: a real click on the real button, so nothing about the page's
  // own wiring, the command review, or the irreversible-command confirmation is
  // bypassed.
  await window.webContents.executeJavaScript(
    `[...document.querySelectorAll('.button-row button')].find((b) => b.textContent.trim().startsWith('Send')).click()`,
  );

  let after = before;
  for (let step = 0; step < SETTLE_STEPS; step += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    after = (await window.webContents.executeJavaScript(OBSERVE)) as Observation;
    if (after.sends > before.sends) {
      break;
    }
  }

  console.log(
    `[prove-lab] after: chip=${after.chip} sends=${String(after.sends)} outcome=${
      after.newest?.outcome ?? "none"
    } accepted=${String(after.newest?.accepted ?? 0)}`,
  );
  writeFileSync(path.join(out, "after.json"), `${JSON.stringify(after, null, 2)}\n`);
  writeFileSync(path.join(out, "after.png"), (await window.webContents.capturePage()).toPNG());

  const settings = readLabTelemetrySettings();
  const receipts = listLabSends();
  writeFileSync(
    path.join(out, "receipts.json"),
    `${JSON.stringify({ settings: { ...settings }, receipts }, null, 2)}\n`,
  );

  const accepted = after.newest?.outcome === "accepted" && (after.newest.accepted ?? 0) > 0;
  const receiptKept = after.sends > before.sends && (after.newest?.body ?? "").length > 0;
  // The claim that matters, spelled out: the payload the page previewed is the
  // payload the receipt holds. A receipt that summarised would pass a length
  // check and fail this one.
  const sameBytes = after.newest?.body === before.preview_body;

  console.log(`[prove-lab] ${accepted ? "PASS" : "FAIL"} a real LAB accepted the batch`);
  console.log(`[prove-lab] ${receiptKept ? "PASS" : "FAIL"} DASH kept the message it posted`);
  console.log(`[prove-lab] ${sameBytes ? "PASS" : "FAIL"} the receipt is the previewed bytes`);
  console.log(`[prove-lab] images and JSON in ${out}`);
  app.exit(accepted && receiptKept && sameBytes ? 0 : 1);
}

void run().catch((error: unknown) => {
  console.error(error);
  app.exit(1);
});
