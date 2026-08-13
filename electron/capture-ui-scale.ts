/** Packaged UI-scale evidence (MAR-614). Not a release gate. */
import "./main.js";
import { app } from "electron";
import { appWindow } from "./app-window.js";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.cwd(), process.env.DASH_CAPTURE_DIR ?? "qa-screenshots-mar614e");

async function windowReady() {
  for (;;) {
    const window = appWindow();
    if (window !== null && !window.webContents.isLoading()) return window;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function run(): Promise<void> {
  await app.whenReady();
  mkdirSync(out, { recursive: true });
  const window = await windowReady();
  await window.loadURL(new URL("/settings/preferences", window.webContents.getURL()).toString());
  await new Promise((resolve) => setTimeout(resolve, 1200));
  for (const factor of [0.8, 1.2]) {
    await window.webContents.executeJavaScript(`(() => { const select = document.querySelector('select'); select.value = ${JSON.stringify(String(factor))}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const measurement = await window.webContents.executeJavaScript(`(() => ({ factor: window.devicePixelRatio / window.screen.deviceXDPI * window.screen.logicalXDPI || ${String(factor)}, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, select: document.querySelector('select')?.value }))()`);
    console.log(`[ui-scale] ${String(factor)} ${JSON.stringify(measurement)}`);
    if (measurement.overflow || measurement.select !== String(factor)) throw new Error(`scale ${String(factor)} clipped or did not persist`);
    writeFileSync(path.join(out, `${String(factor * 100)}.json`), JSON.stringify(measurement));
    writeFileSync(path.join(out, `${String(factor * 100)}.png`), (await window.webContents.capturePage()).toPNG());
  }
  app.exit(0);
}
void run().catch((error) => { console.error(error); app.exit(1); });
