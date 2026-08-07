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
  auditSprite,
  checkAvatarCss,
  checkCast,
  checkCostume,
  checkEmerald,
  checkSizeApi,
  readCastModule,
} from "./brand-rules.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SPRITE_DIR = path.join(ROOT, "public", "o", "1x");
const MANIFEST = path.join(ROOT, "lib", "brand", "o-cast.json");
const CAST_MODULE = path.join(ROOT, "lib", "brand", "o-cast.ts");
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

/* ── 2. The rules of use ─────────────────────────────────────────────────── */

const css = STYLESHEETS.filter((file) => fs.existsSync(file))
  .map((file) => fs.readFileSync(file, "utf8"))
  .join("\n");

failures.push(...checkAvatarCss(css));

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".next", "dist", "out", ".git"].includes(entry.name)) continue;
      yield* walk(full);
    } else if (/\.tsx?$/.test(entry.name)) {
      yield full;
    }
  }
}

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
  console.log(
    `✓ brand:check passed — ${names.length} characters audited against the vendored manifest, ` +
      `${sizes.length} rendered sizes, ${surfaces} file(s) using the cast`,
  );
  process.exit(0);
}

console.error(`\n✗ brand:check failed — ${failures.length} violation(s):\n`);
for (const failure of failures) console.error(`  - ${failure}`);
console.error("");
process.exit(1);
