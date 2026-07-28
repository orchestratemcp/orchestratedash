/**
 * Package the Electron shell into the smallest private/test MSIX for the
 * current architecture (MAR-429 / DASH-18a).
 *
 * Deliberately not electron-builder — see the Linear comment on MAR-429 for
 * the reasoning. This script is wiring: it calls `@electron/packager` to
 * produce the unpacked Win32 app, writes the two computed values (version,
 * capability check) via `lib/shell/appx-manifest.ts`, and shells out to
 * `makeappx.exe`. The decisions live in that module and in
 * `build/appx/AppxManifest.xml`, both testable or readable without this
 * script running.
 *
 * Node 24's built-in TypeScript stripping is what lets a plain `.mjs` script
 * import `.ts` modules directly, with no esbuild step of its own — those
 * modules have no syntax (enums, namespaces, decorators) it cannot strip.
 *
 * What this does NOT do: sign the package, trust a certificate, or sideload
 * it. Those touch the certificate store and are Henrik's steps — see
 * docs/msix-test-signing.md for the exact commands.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { packager } from "@electron/packager";

import { assertOnlyRunFullTrustCapability, toMsixVersion } from "../lib/shell/appx-manifest.ts";
import { generatePlaceholderPng } from "../lib/shell/placeholder-icon.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appxDir = path.join(repoRoot, "build", "appx");
const rootPackage = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const electronPackage = JSON.parse(
  readFileSync(path.join(repoRoot, "node_modules", "electron", "package.json"), "utf8"),
);

/**
 * Must equal AppxManifest.xml's Application/@Executable, which is committed
 * text, not derived from this value — a mismatch is a packaging bug, not a
 * configuration choice, so nothing here reads the manifest to "agree" with
 * itself.
 */
const APP_NAME = "OrchestrateDASH";

console.log("[package-msix] building the shell and runner bundles");
execFileSync(process.execPath, [path.join(repoRoot, "scripts", "build-shell.mjs")], {
  stdio: "inherit",
});

console.log("[package-msix] running @electron/packager");
const [outputDir] = await packager({
  dir: path.join(repoRoot, "dist", "electron"),
  name: APP_NAME,
  platform: "win32",
  arch: "x64",
  electronVersion: electronPackage.version,
  appVersion: rootPackage.version,
  appCopyright: "Alohana Group AB",
  out: path.join(appxDir, "packager-out"),
  overwrite: true,
  asar: false,
  // `contracts/` lands directly in the packaged app's resources directory —
  // exactly what electron/resources.ts reads via `process.resourcesPath`.
  extraResource: [path.join(repoRoot, "contracts")],
  win32metadata: {
    CompanyName: "Alohana Group AB",
    ProductName: APP_NAME,
    FileDescription: "OrchestrateDASH — packaging lifecycle proof build (MAR-429)",
    InternalName: APP_NAME,
    // MAR-431: declares PerMonitorV2 DPI awareness on the packaged .exe.
    // @electron/packager/resedit replaces the whole RT_MANIFEST resource
    // with this file's bytes rather than merging into Electron's own
    // manifest — see the comment atop the file itself for why.
    "application-manifest": path.join(appxDir, "OrchestrateDASH.exe.manifest"),
  },
});

if (outputDir === undefined) {
  throw new Error("@electron/packager reported no output directory.");
}
console.log(`[package-msix] packager wrote ${path.relative(repoRoot, outputDir)}`);

/**
 * The committed manifest is a template (Version="{{VERSION}}"); the rendered
 * copy is a build artifact written into the packager's output, never back
 * onto the source file.
 */
const manifestTemplate = readFileSync(path.join(appxDir, "AppxManifest.xml"), "utf8");
const msixVersion = toMsixVersion(rootPackage.version);
const occurrences = manifestTemplate.split("{{VERSION}}").length - 1;
if (occurrences !== 1) {
  throw new Error(
    `Expected exactly one {{VERSION}} placeholder in AppxManifest.xml, found ${String(occurrences)}.`,
  );
}
const renderedManifest = manifestTemplate.replace("{{VERSION}}", msixVersion);
const stagedManifestPath = path.join(outputDir, "AppxManifest.xml");
writeFileSync(stagedManifestPath, renderedManifest, "utf8");

// Read back from disk rather than checking the string still in memory — the
// point of this call is to verify the bytes MakeAppx will actually pack.
assertOnlyRunFullTrustCapability(readFileSync(stagedManifestPath, "utf8"));
console.log(`[package-msix] manifest verified: runFullTrust only, version ${msixVersion}`);

console.log("[package-msix] generating placeholder tile assets (no DASH icon exists yet)");
const assetsDir = path.join(outputDir, "Assets");
mkdirSync(assetsDir, { recursive: true });
const placeholderColor = { r: 37, g: 47, b: 74, a: 255 };
for (const [file, size] of [
  ["Square44x44Logo.png", 44],
  ["Square150x150Logo.png", 150],
  ["StoreLogo.png", 50],
]) {
  writeFileSync(path.join(assetsDir, file), generatePlaceholderPng(size, size, placeholderColor));
}

const makeappxPath =
  process.env.DASH_MAKEAPPX_PATH ??
  String.raw`C:\Program Files (x86)\Windows Kits\10\bin\10.0.19041.0\x64\makeappx.exe`;
if (!existsSync(makeappxPath)) {
  throw new Error(
    `makeappx.exe not found at "${makeappxPath}". Set DASH_MAKEAPPX_PATH to override the ` +
      `default Windows SDK location.`,
  );
}

const msixPath = path.join(appxDir, `${APP_NAME}-${msixVersion}.msix`);
console.log(`[package-msix] running makeappx pack -> ${path.relative(repoRoot, msixPath)}`);
execFileSync(makeappxPath, ["pack", "/d", outputDir, "/p", msixPath, "/overwrite"], {
  stdio: "inherit",
});

console.log(`[package-msix] wrote ${msixPath}`);
console.log(
  "[package-msix] unsigned. See docs/msix-test-signing.md for the certificate, signing " +
    "and sideload steps — those touch the certificate store and are not run by this script.",
);
