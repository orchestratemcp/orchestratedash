/**
 * The brand rules, as pure functions (MAR-500).
 *
 * `scripts/brand-check.mjs` is the wiring: it reads files off disk and reports.
 * Everything that decides *whether something is a violation* lives here, takes
 * strings and returns failures, and is driven directly by `tests/brand-check.test.ts`.
 *
 * The split is not tidiness. MAR-500's acceptance asks for the check to be
 * demonstrated failing on each violation class — mutate, watch it fail, restore.
 * A transcript of that is a thing somebody did once; a test per violation class
 * is the same demonstration, repeatable, in CI, and impossible to leave stale.
 * So each rule below has a fixture that trips it and a fixture that does not.
 *
 * Plain JavaScript rather than TypeScript because `scripts/` runs under bare
 * Node with no build step, and `pnpm verify` must be able to run this before
 * anything is compiled. Vitest imports `.mjs` without ceremony.
 *
 * ## Where each rule comes from
 *
 * orchestrateweb `docs/DESIGN_BRIEF.md`, "The O's", and `app/tokens.css`:
 *
 * - a costume is recognition, never status — no `<OAvatar>` may choose its
 *   character from a conditional or a status-shaped expression, and `label` is
 *   forbidden outside an allowlist, because decoration must be silent;
 * - emerald is reserved for healthy and live — an avatar that carries `--ok`,
 *   or sits in a container that does, joins the green meaning system, and then
 *   a fleet of green cards stops meaning the agents are healthy and starts
 *   meaning the page rendered;
 * - whole multiples of the 50px source only, with `image-rendering: pixelated`;
 * - motion, if it ever arrives, moves on `var(--motion-*)`, which `app/tokens.css`
 *   already zeroes under `prefers-reduced-motion: reduce`.
 *
 * ## One rule SITE has that DASH deliberately does not
 *
 * SITE enforces a *surface allowlist*: the cast may appear on four files and
 * nowhere else. DASH has no equivalent, because DASH's surfaces are the point —
 * BRAND-03/04/05 exist to add them, and a list that every one of those issues
 * has to widen would be a gate that is edited into meaninglessness in three
 * commits. The rules above bind wherever an avatar appears instead.
 */

import crypto from "node:crypto";
import zlib from "node:zlib";

/* ── PNG ──────────────────────────────────────────────────────────────────
 *
 * Enough PNG to audit a sprite: 8-bit RGBA, non-interlaced, which is what every
 * file in the cast is. A dependency would decode more formats; the point of the
 * audit is that these files stay in exactly this one. Ported from
 * orchestrateweb `scripts/brand-check.mjs` so both repositories measure the same
 * bytes the same way.
 */

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function decodePng(buffer, name) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`${name}: not a PNG`);
  }

  let offset = 8;
  let ihdr = null;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    }
    if (type === "IDAT") idat.push(data);
    if (type === "IEND") break;
    offset += 12 + length;
  }

  if (!ihdr) throw new Error(`${name}: no IHDR chunk`);
  if (ihdr.bitDepth !== 8 || ihdr.colorType !== 6 || ihdr.interlace !== 0) {
    throw new Error(
      `${name}: expected 8-bit RGBA non-interlaced, got bit depth ${ihdr.bitDepth}, colour type ${ihdr.colorType}, interlace ${ihdr.interlace}`,
    );
  }

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const { width, height } = ihdr;
  const stride = width * 4;
  const pixels = Buffer.alloc(height * stride);

  /* Undo per-row filtering (bytes-per-pixel is 4 throughout). */
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y === 0 ? null : pixels.subarray((y - 1) * stride, y * stride);

    for (let x = 0; x < stride; x += 1) {
      const left = x >= 4 ? out[x - 4] : 0;
      const up = prev ? prev[x] : 0;
      const upLeft = prev && x >= 4 ? prev[x - 4] : 0;
      let value = row[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      } else if (filter !== 0) {
        throw new Error(`${name}: unknown PNG filter ${filter}`);
      }
      out[x] = value & 0xff;
    }
  }

  return { width, height, pixels };
}

/** Measured facts about one sprite: the audit record's raw material. */
export function auditSprite(buffer, name) {
  const { width, height, pixels } = decodePng(buffer, name);

  const colors = new Set();
  let opaque = 0;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (pixels[i + 3] === 0) continue;
      opaque += 1;
      colors.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }

  const corners = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ].map(([x, y]) => pixels[(y * width + x) * 4 + 3]);

  return {
    width,
    height,
    bytes: buffer.length,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    cornersTransparent: corners.every((a) => a === 0),
    bounds: { left, top, right, bottom },
    opaquePixels: opaque,
    colors: colors.size,
  };
}

/* ── The typed view, parsed out of lib/brand/o-cast.ts ───────────────────── */

/**
 * `O_NAMES` and `OSize` as the source declares them.
 *
 * Parsed rather than imported: the module is TypeScript and this script runs
 * under bare Node, and parsing has the better property anyway — the check reads
 * the file a reviewer reads, not a compiled artifact that could have been built
 * from something else.
 */
export function readCastModule(source) {
  const failures = [];

  const namesMatch = source.match(/O_NAMES\s*=\s*\[([^\]]+)\]/);
  const names = namesMatch ? [...namesMatch[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]) : [];
  if (names.length === 0) {
    failures.push("lib/brand/o-cast.ts: could not parse O_NAMES");
  }

  const sizeMatch = source.match(/type OSize\s*=\s*([0-9|\s]+);/);
  const sizes = sizeMatch
    ? sizeMatch[1]
        .split("|")
        .map((part) => part.trim())
        .filter((part) => part !== "")
        .map(Number)
    : [];
  if (sizes.length === 0) {
    failures.push("lib/brand/o-cast.ts: could not parse OSize");
  }

  return { names, sizes, failures };
}

/**
 * Whole multiples of the 50px source, and nothing else.
 *
 * `image-rendering: pixelated` upscales by nearest neighbour, so 100px is exact
 * and 120px puts some source pixels on two screen pixels and some on three. On
 * a shape this small that is visible, and it reads as a bug rather than a style.
 *
 * SITE allows 25 as well — an exact half-step its wordmark needs. DASH has no
 * surface that small, so the literal rule is enforced here. Widening it is a
 * deliberate two-line diff (this function and the `OSize` union), which is the
 * point.
 */
export function checkSizeApi(sizes) {
  const failures = [];
  for (const size of sizes) {
    if (!Number.isInteger(size) || size <= 0 || size % 50 !== 0) {
      failures.push(
        `size: OSize offers ${size}px, which is not a whole multiple of the 50px source — pixelated upscaling is only exact at 50, 100, 150…`,
      );
    }
  }
  return failures;
}

/* ── The cast: files ↔ manifest ↔ O_NAMES ────────────────────────────────── */

/**
 * The three descriptions of the cast agree, and the pixels are the audited ones.
 *
 * `measured` is `{ [name]: auditSprite(...) | { error } }` for every PNG found.
 * A hash mismatch is the load-bearing failure: the assets are *vendored* from
 * orchestrateweb, and a copy nobody checks is exactly the drift an audit record
 * exists to prevent.
 */
export function checkCast({ names, files, manifest, measured }) {
  const failures = [];

  for (const name of names) {
    if (!files.includes(name)) {
      failures.push(`cast: O_NAMES has "${name}" but public/o/1x/${name}.png does not exist`);
    }
  }
  for (const file of files) {
    if (!names.includes(file)) {
      failures.push(`cast: public/o/1x/${file}.png is not in O_NAMES — an unaudited character`);
    }
  }

  for (const [name, audit] of Object.entries(measured)) {
    if (audit.error !== undefined) {
      failures.push(`cast: ${audit.error}`);
      continue;
    }
    if (audit.width !== 50 || audit.height !== 50) {
      failures.push(`cast: ${name}.png is ${audit.width}x${audit.height}, not 50x50 — the grid is the system`);
    }
    if (!audit.cornersTransparent) {
      failures.push(`cast: ${name}.png has a non-transparent corner — backgrounds must be transparent`);
    }
  }

  const recorded = Object.keys(manifest?.characters ?? {});
  for (const name of names) {
    if (!recorded.includes(name)) {
      failures.push(`manifest: "${name}" is not recorded in lib/brand/o-cast.json`);
    }
  }
  for (const name of recorded) {
    if (!names.includes(name)) {
      failures.push(`manifest: lib/brand/o-cast.json records "${name}", which is not in the cast`);
    }
    const record = manifest.characters[name];
    const audit = measured[name];
    if (audit === undefined || audit.error !== undefined) continue;
    if (record.sha256 !== audit.sha256) {
      failures.push(
        `manifest: ${name}.png does not match the audited hash — these files are vendored from orchestrateweb, so re-vendor from the audited branch rather than regenerating the manifest here`,
      );
    }
  }

  return failures;
}

/* ── Reading JSX well enough to hold it to the rules ──────────────────────── */

/**
 * The class names a stylesheet paints with `--ok`.
 *
 * Deliberately over-inclusive: the crude rule scan treats an `@media` prefix as
 * part of the following selector, so a class inside one is still found. Erring
 * towards naming an extra class is the safe direction — the failure it produces
 * is "do not put this class on an avatar", which is advice worth taking either
 * way.
 */
export function emeraldClasses(css) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const found = new Set();
  for (const rule of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/var\(\s*--ok(-bg)?\s*\)/.test(rule[2])) continue;
    for (const cls of rule[1].matchAll(/\.([A-Za-z][\w-]*)/g)) {
      found.add(cls[1]);
    }
  }
  return found;
}

/**
 * Every `<OAvatar …>` in a file, with the `className` of each element enclosing
 * it, outermost last.
 *
 * A small scanner rather than a parser. It understands `<Tag …>`, `<Tag … />`
 * and `</Tag>`, which is the whole of the JSX in this repository, and it treats
 * lowercase HTML void elements as self-closing. Where it is wrong it is wrong
 * about *which* ancestor a class belongs to, never about whether the class is on
 * the page — and the CSS-side rule below is the one that cannot be evaded by
 * confusing it.
 */
export function avatarUsages(source) {
  const VOID = new Set(["img", "br", "hr", "input", "meta", "link", "source", "area", "col"]);
  const tags = /<(\/?)([A-Za-z][\w.]*)((?:"[^"]*"|'[^']*'|\{(?:[^{}]|\{[^{}]*\})*\}|[^>"'])*?)(\/?)>/g;
  const stack = [];
  const usages = [];

  let match;
  while ((match = tags.exec(source)) !== null) {
    const [, closing, tag, props, selfClosed] = match;
    if (closing === "/") {
      const at = stack.map((entry) => entry.tag).lastIndexOf(tag);
      if (at !== -1) stack.length = at;
      continue;
    }
    if (tag === "OAvatar") {
      usages.push({ props, ancestors: stack.map((entry) => classNamesOf(entry.props)) });
    }
    if (selfClosed !== "/" && !VOID.has(tag)) {
      stack.push({ tag, props });
    }
  }

  return usages;
}

/** The literal class names in a `className` attribute; expressions yield none. */
function classNamesOf(props) {
  const literal = props.match(/\bclassName="([^"]*)"/);
  if (literal) return literal[1].split(/\s+/).filter((part) => part !== "");
  // `className={...}` — a template or a conditional. The names inside string
  // literals are still worth reading; anything else is beyond a scanner.
  const expression = props.match(/\bclassName=\{([\s\S]*?)\}/);
  if (!expression) return [];
  return [...expression[1].matchAll(/["'`]([^"'`]*)["'`]/g)]
    .flatMap((m) => m[1].split(/\s+/))
    .filter((part) => part !== "");
}

/** Words that smell like state. A costume may never be chosen by one. */
const STATUS_WORDS =
  /\b(status|state|live|running|error|failed?|ok|healthy?|health|active|online|offline|proven|pending|approved?|compliant|stalled|verdict|severity)\b/i;

/**
 * A costume is recognition, never status.
 *
 * Two ways it could stop being: the character is *chosen* by a condition, or the
 * character is *announced*, which turns decoration into something a screen
 * reader reports as a fact about the agent.
 */
export function checkCostume(file, source, labelAllowlist = new Set()) {
  const failures = [];

  for (const usage of avatarUsages(source)) {
    const nameExpression =
      usage.props.match(/\bname=\{([\s\S]*?)\}/)?.[1] ?? usage.props.match(/\bname="([a-z]+)"/)?.[1];
    if (nameExpression !== undefined) {
      if (/[?:]|\|\||&&/.test(nameExpression) || STATUS_WORDS.test(nameExpression)) {
        failures.push(
          `costume: ${file} chooses a character from a condition or a status ("name={${nameExpression.trim()}}") — a costume is recognition, never status; pass the character stored on the agent's record`,
        );
      }
    }

    if (/\blabel=/.test(usage.props) && !labelAllowlist.has(file)) {
      failures.push(
        `costume: ${file} passes label= to an avatar — decoration must be silent, and an announced costume is a costume a screen reader reports as a fact about the agent; if the character genuinely IS the information here, add the file to LABEL_ALLOWLIST with a reason`,
      );
    }
  }

  return failures;
}

/**
 * Emerald never reaches an avatar.
 *
 * Checked from both ends, because they fail differently. In the stylesheet, a
 * rule whose selector mentions the avatar may not reference `--ok` at all — that
 * is the one an author cannot route around. In the markup, neither the avatar
 * nor anything it sits inside may carry a class the stylesheet paints emerald,
 * which catches the likelier mistake: reusing a healthy-status card as an
 * avatar's container.
 */
export function checkEmerald({ file, source, css }) {
  const failures = [];
  const emerald = emeraldClasses(css);

  for (const usage of avatarUsages(source)) {
    const own = classNamesOf(usage.props);
    for (const cls of own) {
      if (emerald.has(cls)) {
        failures.push(
          `emerald: ${file} puts .${cls} on an avatar, and that class is painted with --ok — app/tokens.css reserves emerald for healthy and live things, and an avatar is never a health signal`,
        );
      }
    }
    for (const ancestor of usage.ancestors) {
      for (const cls of ancestor) {
        if (emerald.has(cls)) {
          failures.push(
            `emerald: ${file} draws an avatar inside .${cls}, and that class is painted with --ok — a container that means "healthy" makes the costume inside it mean it too`,
          );
        }
      }
    }
  }

  return failures;
}

/**
 * The stylesheet's own half of the rules.
 *
 * `image-rendering: pixelated` must survive; `--o-size` literals must be whole
 * multiples of 50; no avatar rule may reference `--ok`; and any duration on an
 * avatar rule must be a `--motion-*` token, because `app/tokens.css` zeroes
 * those under `prefers-reduced-motion: reduce` and a literal `200ms` would be a
 * sprite that keeps moving for somebody who asked it not to.
 */
export function checkAvatarCss(css) {
  const failures = [];
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

  const rules = [...withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((rule) => ({
    selector: rule[1].trim(),
    body: rule[2],
  }));
  const avatarRules = rules.filter((rule) => /\.o-avatar\b/.test(rule.selector));

  if (avatarRules.length === 0) {
    failures.push("css: no .o-avatar rule — the component sets --o-size and nothing consumes it");
  }
  if (!avatarRules.some((rule) => /image-rendering:\s*pixelated/.test(rule.body))) {
    failures.push(
      "css: .o-avatar no longer sets image-rendering: pixelated — resampled pixel art reads as a mistake rather than as a style",
    );
  }

  for (const rule of avatarRules) {
    if (/var\(\s*--ok(-bg)?\s*\)/.test(rule.body)) {
      failures.push(
        `css: "${rule.selector}" paints an avatar with --ok — emerald is reserved for healthy and live things (app/tokens.css)`,
      );
    }
    for (const declaration of rule.body.matchAll(/\b(animation|transition)\s*:([^;]*)/g)) {
      const value = declaration[2];
      const durations = [...value.matchAll(/(?<![\w-])(\d+(?:\.\d+)?)(ms|s)\b/g)];
      if (durations.length > 0) {
        failures.push(
          `css: "${rule.selector}" gives an avatar a literal ${declaration[1]} duration (${durations.map((d) => d[0]).join(", ")}) — use var(--motion-fast) or var(--motion-normal), which app/tokens.css zeroes under prefers-reduced-motion so stillness needs no per-surface code`,
        );
      }
    }
  }

  for (const size of withoutComments.matchAll(/--o-size:\s*(\d+)px/g)) {
    const px = Number(size[1]);
    if (px % 50 !== 0) {
      failures.push(`css: --o-size: ${px}px is not a whole multiple of the 50px source`);
    }
  }

  return failures;
}

/* ── Fonts ────────────────────────────────────────────────────────────────── */

/**
 * No page may request a font from anywhere but this machine (MAR-535).
 *
 * Henrik decided MAR-535 on 2026-08-07: **keep the rule**. Space Grotesk and
 * JetBrains Mono are not bundled, DASH renders in the platform's own faces where
 * they are absent, and `app/tokens.css`'s note about that is now the permanent
 * record rather than a pending one.
 *
 * A decision recorded only in prose is a decision the next reskin quietly
 * reverses, which is what this rule is for. The rule the issue actually settles
 * is about **where a font comes from**, so that is what is checked — not whether
 * a font file exists. If the decision is ever revisited and the two OFL families
 * are vendored into the export, they are same-origin reads over `dash-app://`
 * and every assertion here still passes. Nothing below has to be relaxed to
 * bundle a font; it only has to be relaxed to fetch one.
 *
 * That matters more here than in an ordinary web app. DASH is local-first and
 * offline by default: a stylesheet reaching `fonts.googleapis.com` does not
 * merely leak that the app was opened, it renders in a fallback anyway on the
 * machines this product is *for*, having waited for a timeout first.
 *
 * `next/font/google` is refused for a different reason from the rest, and it is
 * worth naming because it looks like a false positive: it self-hosts, so no page
 * requests a remote font at runtime. What it moves is the fetch to **build
 * time** — an offline or firewalled build fails, or worse, silently produces an
 * export whose fonts came from whatever the network answered that day.
 * `next/font/local` is deliberately NOT refused: it is the supported way to do
 * exactly what MAR-535 would have done.
 */
export function checkNoRemoteFonts(files) {
  const failures = [];

  /*
   * The floor, and it is the load-bearing line rather than defensive noise.
   *
   * MAR-498's client-bundle guard passed against a list nobody had widened, and
   * the repair kept the original names as a floor precisely because a walk that
   * broke and returned an empty set would pass that file forever. A font rule
   * that scanned nothing is that same failure: green, permanently, from the
   * moment somebody moves a stylesheet.
   */
  if (files.length === 0) {
    failures.push(
      "fonts: nothing was scanned for remote font requests — the walk found no stylesheets or components, which is the shape of a check that has stopped looking rather than of a codebase with no CSS in it",
    );
    return failures;
  }

  /** Absolute, protocol-relative, or any scheme that is not this app's own. */
  const REMOTE = /^\s*(?:https?:)?\/\/|^\s*[a-z][a-z0-9+.-]*:\/\//i;

  for (const { name, source } of files) {
    const withoutComments = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    /* 1. An @font-face whose bytes come from somewhere else. */
    for (const face of withoutComments.matchAll(/@font-face\s*\{([^{}]*)\}/g)) {
      for (const src of face[1].matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
        if (REMOTE.test(src[1])) {
          failures.push(
            `fonts: ${name} declares an @font-face whose src is ${src[1]} — DASH ships no web fonts (MAR-535, decided 2026-08-07: keep the rule), and a local-first app that blocks its first paint on a network font has chosen the wrong thing to be strict about`,
          );
        }
      }
    }

    /* 2. A stylesheet pulled in from off-machine, which is how a font usually arrives. */
    for (const imported of withoutComments.matchAll(
      /@import\s+(?:url\(\s*)?['"]?([^'");\s]+)/g,
    )) {
      if (REMOTE.test(imported[1])) {
        failures.push(
          `fonts: ${name} @imports ${imported[1]} — an off-machine stylesheet is the ordinary way a remote font arrives, and DASH's export must read every byte it paints with from this machine`,
        );
      }
    }

    /* 3. The markup half: a <link> to a font host, including the preconnect
       that usually precedes one and is the earliest visible sign of it. */
    for (const link of withoutComments.matchAll(/<link\b[^>]*>/g)) {
      const tag = link[0];
      const href = /href\s*=\s*['"]([^'"]+)['"]/.exec(tag);
      if (href === null || !REMOTE.test(href[1])) {
        continue;
      }
      if (/rel\s*=\s*['"](?:stylesheet|preconnect|dns-prefetch|preload)['"]/i.test(tag)) {
        failures.push(
          `fonts: ${name} links ${href[1]} — DASH's renderer makes no network request for anything it paints with`,
        );
      }
    }

    /*
     * 4. The build-time fetch. Not a runtime request, which is why it needs its
     * own sentence rather than being folded into the ones above.
     */
    if (/from\s+['"]next\/font\/google['"]/.test(withoutComments)) {
      failures.push(
        `fonts: ${name} imports next/font/google — it self-hosts, so no page requests a remote font at runtime, but the fetch moves to build time and an offline build then either fails or ships whatever the network answered. next/font/local is the supported way to bundle a face if MAR-535 is ever revisited`,
      );
    }
  }

  return failures;
}
