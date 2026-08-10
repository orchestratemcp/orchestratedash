#!/usr/bin/env node
/**
 * Brand check — the audited character system, DASH side (MAR-500).
 *
 * Run: `pnpm brand:check`, and it runs inside `pnpm verify`.
 *
 * There is no `--write`. orchestrateweb's version of this script has one,
 * because that is where the assets are authored and audited; DASH *vendors*
 * them. A DASH-side regenerate would make a hash mismatch self-healing, which is
 * precisely the failure this exists to catch: the copy drifting from the
 * original and agreeing with itself about it. A deliberate asset change is made
 * in orchestrateweb, audited there, and re-vendored here.
 *
 * ## What it holds together
 *
 * 1. `public/o/1x/*.png` — the pixels, decoded and measured.
 * 2. `lib/brand/o-cast.json` — the audit record copied from orchestrateweb.
 * 3. `O_NAMES` and `OSize` in `lib/brand/o-cast.ts` — the typed view the code
 *    compiles against.
 * 4. `app/globals.css` and every component under `app/` — the rules of use.
 *
 * The rules themselves are in `scripts/brand-rules.mjs`, where
 * `tests/brand-check.test.ts` drives each one with a fixture that trips it. This
 * file only decides which bytes to hand them.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  auditSheet,
  auditSprite,
  checkActionModule,
  checkActions,
  checkAvatarCss,
  checkBundledFonts,
  checkCast,
  checkCostume,
  checkEmerald,
  checkNoRemoteFonts,
  checkSizeApi,
  readCastModule,
} from "./brand-rules.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SPRITE_DIR = path.join(ROOT, "public", "o", "1x");
const ACTION_DIR = path.join(ROOT, "public", "o", "actions");
const MANIFEST = path.join(ROOT, "lib", "brand", "o-cast.json");
const ACTION_MANIFEST = path.join(ROOT, "lib", "brand", "o-actions.json");
const CAST_MODULE = path.join(ROOT, "lib", "brand", "o-cast.ts");
const ACTION_MODULE = path.join(ROOT, "lib", "brand", "o-actions.ts");
const APP_DIR = path.join(ROOT, "app");
const STYLESHEETS = [path.join(APP_DIR, "globals.css"), path.join(APP_DIR, "tokens.css")];

/**
 * Files allowed to pass `label` — where the character IS the information.
 *
 * Empty, and expected to stay that way for a while. DASH's avatars sit beside
 * an agent's own name on every surface BRAND-03/04/05 plan, so the character
 * repeats nothing and announcing it would add a costume nobody asked about. A
 * surface where the cast is browsed *as a cast* would earn an entry.
 */
const LABEL_ALLOWLIST = new Set([]);

const failures = [];

function rel(file) {
  return path.relative(ROOT, file).replaceAll("\\", "/");
}

/* ── 1. The cast ─────────────────────────────────────────────────────────── */

const castSource = fs.readFileSync(CAST_MODULE, "utf8");
const { names, sizes, failures: parseFailures } = readCastModule(castSource);
failures.push(...parseFailures);
failures.push(...checkSizeApi(sizes));

const files = fs.existsSync(SPRITE_DIR)
  ? fs
      .readdirSync(SPRITE_DIR)
      .filter((file) => file.endsWith(".png"))
      .map((file) => file.replace(/\.png$/, ""))
  : [];

if (files.length === 0) {
  failures.push(`cast: ${rel(SPRITE_DIR)} holds no PNGs — the assets are vendored, not fetched`);
}

const measured = {};
for (const name of files) {
  try {
    measured[name] = auditSprite(fs.readFileSync(path.join(SPRITE_DIR, `${name}.png`)), name);
  } catch (error) {
    measured[name] = { error: error.message };
  }
}

let manifest = null;
if (!fs.existsSync(MANIFEST)) {
  failures.push(`manifest: ${rel(MANIFEST)} is missing — re-vendor it from orchestrateweb`);
} else {
  try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  } catch (error) {
    failures.push(`manifest: ${rel(MANIFEST)} is not readable JSON (${error.message})`);
  }
}

if (manifest !== null) {
  failures.push(...checkCast({ names, files, manifest, measured }));
}

/* ── 1b. The idle actions (MAR-587 Phase A) ──────────────────────────────── *
 *
 * Vendored the same way the stills are, and audited against them: each sheet
 * carries the hash of the still it was built from, so a character re-vendored
 * without its animation cannot pass quietly.
 *
 * Absent by design when nothing has been produced yet. The cast is the thing
 * DASH cannot render without; an action sheet is an enhancement Phase B
 * consumes, and failing every `pnpm verify` in a repository that has not opted
 * into animation yet would be a gate nobody thanked us for. Once a sheet
 * exists, everything above applies to it in full.
 */

const actionFiles = fs.existsSync(ACTION_DIR)
  ? fs
      .readdirSync(ACTION_DIR)
      .filter((file) => file.endsWith(".png"))
      .map((file) => file.replace(/\.png$/, ""))
  : [];

let actionManifest = null;
if (actionFiles.length > 0 || fs.existsSync(ACTION_MANIFEST)) {
  if (!fs.existsSync(ACTION_MANIFEST)) {
    failures.push(`actions: ${rel(ACTION_DIR)} holds sheets but ${rel(ACTION_MANIFEST)} is missing — re-vendor it from orchestrateweb`);
  } else {
    try {
      actionManifest = JSON.parse(fs.readFileSync(ACTION_MANIFEST, "utf8"));
    } catch (error) {
      failures.push(`actions: ${rel(ACTION_MANIFEST)} is not readable JSON (${error.message})`);
    }
  }
}

const measuredSheets = {};
if (actionManifest !== null) {
  for (const key of actionFiles) {
    const character = actionManifest.sheets?.[key]?.character;
    const stillFile = path.join(SPRITE_DIR, `${character}.png`);
    try {
      if (character === undefined) throw new Error(`${key}.png is not recorded, so there is no still to audit it against`);
      if (!fs.existsSync(stillFile)) throw new Error(`${key} animates ${character}, but public/o/1x/${character}.png does not exist`);
      measuredSheets[key] = auditSheet(fs.readFileSync(path.join(ACTION_DIR, `${key}.png`)), fs.readFileSync(stillFile), key);
    } catch (error) {
      measuredSheets[key] = { error: error.message };
    }
  }
  failures.push(...checkActions({ names, files: actionFiles, manifest: actionManifest, measured: measuredSheets }));

  /*
   * And the typed view the renderer actually compiles against (Phase B).
   *
   * Everything above audits pixels. This is the other half: the three
   * descriptions of a sheet — the bytes, the manifest, and `o-actions.ts` — say
   * the same thing, so a sheet cannot be perfectly audited and unreachable, and
   * `actionFor` cannot name a file that was never vendored.
   */
  if (!fs.existsSync(ACTION_MODULE)) {
    failures.push(
      `actions: ${rel(ACTION_MANIFEST)} records sheets but ${rel(ACTION_MODULE)} is missing — nothing can draw them`,
    );
  } else {
    failures.push(
      ...checkActionModule({
        source: fs.readFileSync(ACTION_MODULE, "utf8"),
        manifest: actionManifest,
        names,
      }),
    );
  }
}

/* ── 2. The rules of use ─────────────────────────────────────────────────── */

const css = STYLESHEETS.filter((file) => fs.existsSync(file))
  .map((file) => fs.readFileSync(file, "utf8"))
  .join("\n");

failures.push(...checkAvatarCss(css));

function* walk(dir, match = /\.tsx?$/) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".next", "dist", "out", ".git"].includes(entry.name)) continue;
      yield* walk(full, match);
    } else if (match.test(entry.name)) {
      yield full;
    }
  }
}

/* ── 3. Where a font may come from (MAR-535) ─────────────────────────────── *
 *
 * Every stylesheet and every component under `app/`, rather than the two token
 * files `checkAvatarCss` reads. The avatar rules are about declarations that
 * only ever appear in one place; a remote font arrives wherever somebody adds
 * it, and the whole value of the rule is that it is not looking at a list.
 *
 * `walk` is reused with a wider pattern rather than a second traversal, so a
 * directory excluded from one is excluded from both — the two checks disagreeing
 * about which tree they cover is exactly the drift this file exists to stop.
 */
const fontScanned = [
  ...walk(APP_DIR, /\.(?:css|tsx?)$/),
].map((file) => ({ name: rel(file), source: fs.readFileSync(file, "utf8") }));
failures.push(...checkNoRemoteFonts(fontScanned));

/* ── 3b. The bundled families (MAR-535, decided: bundle) ─────────────────── *
 *
 * The other half of the same decision: no font is fetched, and the two that
 * were chosen actually ship — bytes, licence, and every /fonts/ reference
 * resolving. The scanned file list is shared with `checkNoRemoteFonts` so the
 * two halves cannot disagree about which tree they cover.
 */
const FONT_DIR = path.join(ROOT, "public", "fonts");
const bundledFonts = fs.existsSync(FONT_DIR)
  ? fs.readdirSync(FONT_DIR).map((name) => ({
      name,
      bytes: fs.readFileSync(path.join(FONT_DIR, name)),
    }))
  : [];
failures.push(...checkBundledFonts({ fonts: bundledFonts, sources: fontScanned }));

let surfaces = 0;
for (const file of walk(APP_DIR)) {
  const source = fs.readFileSync(file, "utf8");
  if (!/\bOAvatar\b/.test(source) && !source.includes("/o/1x/")) continue;
  surfaces += 1;
  const name = rel(file);
  failures.push(...checkCostume(name, source, LABEL_ALLOWLIST));
  failures.push(...checkEmerald({ file: name, source, css }));
}

/* ── Report ──────────────────────────────────────────────────────────────── */

if (failures.length === 0) {
  const sheetFrames = Object.values(measuredSheets).reduce((total, sheet) => total + (sheet.frameCount ?? 0), 0);
  console.log(
    `✓ brand:check passed — ${names.length} characters audited against the vendored manifest, ` +
      `${actionFiles.length} action sheet(s) / ${sheetFrames} frame(s) audited against their stills, ` +
      `${sizes.length} rendered sizes, ${surfaces} file(s) using the cast, ` +
      `${fontScanned.length} file(s) checked for remote fonts, ` +
      `${bundledFonts.length} bundled font file(s) verified`,
  );
  process.exit(0);
}

console.error(`\n✗ brand:check failed — ${failures.length} violation(s):\n`);
for (const failure of failures) console.error(`  - ${failure}`);
console.error("");
process.exit(1);
