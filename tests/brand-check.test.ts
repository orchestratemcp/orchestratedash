/**
 * The brand check, demonstrated failing (MAR-500).
 *
 * MAR-500's acceptance asks for each violation class to be shown tripping the
 * check — mutate, watch it fail, restore. A transcript of that is something
 * somebody did once on a machine nobody else has. This is the same
 * demonstration, in CI, on every run, and it cannot go stale: each class below
 * has a fixture that must fail and a neighbouring fixture that must not, so a
 * rule quietly loosened into always-passing fails here rather than passing
 * silently forever.
 *
 * The rules are `scripts/brand-rules.mjs` — pure functions over strings, which
 * is what makes this possible without writing to the repository.
 * `scripts/brand-check.mjs` only chooses which bytes to hand them, and the last
 * case in this file runs it for real against the working tree.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  auditSheet,
  auditSprite,
  BUNDLED_FONTS,
  checkActionModule,
  checkActions,
  checkAvatarCss,
  checkBundledFonts,
  checkCast,
  checkCostume,
  checkEmerald,
  checkNoRemoteFonts,
  checkSizeApi,
  emeraldClasses,
  readCastModule,
} from "../scripts/brand-rules.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ninja = readFileSync(path.join(repoRoot, "public", "o", "1x", "ninja.png"));
const manifest = JSON.parse(
  readFileSync(path.join(repoRoot, "lib", "brand", "o-cast.json"), "utf8"),
) as { characters: Record<string, { sha256: string }> };

/** The stylesheet the markup rules are judged against, in miniature. */
const CSS = `
.o-avatar {
  image-rendering: pixelated;
  width: var(--o-size);
  height: var(--o-size);
}

.agent-card.is-healthy {
  border-color: var(--ok);
}

.agent-card {
  border: 1px solid var(--line);
}
`;

describe("violation 1 — an asset that no longer matches the audit record", () => {
  const measured = { ninja: auditSprite(ninja, "ninja") };

  it("passes when the vendored PNG is the audited one", () => {
    expect(
      checkCast({
        names: ["ninja"],
        files: ["ninja"],
        manifest: { characters: { ninja: manifest.characters["ninja"] } },
        measured,
      }),
    ).toEqual([]);
  });

  it("fails when the manifest records a different hash", () => {
    const failures = checkCast({
      names: ["ninja"],
      files: ["ninja"],
      manifest: { characters: { ninja: { sha256: "0".repeat(64) } } },
      measured,
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("does not match the audited hash");
    // The remedy has to be re-vendoring rather than regenerating: DASH holds a
    // copy, and a copy that can rewrite its own audit record is not audited.
    expect(failures[0]).toContain("re-vendor");
  });

  it("fails when a PNG changes under an unchanged manifest", () => {
    // The likelier direction, and the one a vendored copy is exposed to: the
    // bytes move and nothing else does.
    const tampered = Buffer.from(ninja);
    tampered[tampered.length - 1] ^= 0xff;
    const failures = checkCast({
      names: ["ninja"],
      files: ["ninja"],
      manifest: { characters: { ninja: manifest.characters["ninja"] } },
      measured: {
        ninja: {
          ...measured.ninja,
          sha256: createHash("sha256").update(tampered).digest("hex"),
        },
      },
    });
    expect(failures.some((failure: string) => failure.includes("audited hash"))).toBe(true);
  });

  it("fails on a character that is in the files and not in the cast", () => {
    const failures = checkCast({
      names: ["ninja"],
      files: ["ninja", "pirate"],
      manifest: { characters: { ninja: manifest.characters["ninja"] } },
      measured,
    });
    expect(failures.some((failure: string) => failure.includes("unaudited character"))).toBe(true);
  });
});

describe("violation 2 — a rendered size that is not a whole multiple of 50", () => {
  it("accepts the sizes DASH ships", () => {
    expect(checkSizeApi([50, 100, 200])).toEqual([]);
  });

  it.each([63, 25, 75, 0, 50.5])("fails on %s", (size) => {
    const failures = checkSizeApi([size]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("whole multiple of the 50px source");
  });

  it("reads the union out of the cast module rather than trusting a copy of it", () => {
    const source = readFileSync(path.join(repoRoot, "lib", "brand", "o-cast.ts"), "utf8");
    const { names, sizes, failures } = readCastModule(source);
    expect(failures).toEqual([]);
    expect(names).toHaveLength(11);
    // 200 arrived with MAR-587's character-select tile. 150 is a legal whole
    // multiple and is deliberately absent: a size is in the union because a
    // surface draws at it.
    expect(sizes).toEqual([50, 100, 200]);
  });

  it("fails loudly rather than silently when the union cannot be parsed", () => {
    // A parser that returned an empty list on an unrecognised shape would report
    // "no bad sizes" for a file it had not read, which is the failure mode a
    // static check is most likely to die of.
    const { failures } = readCastModule("export const NOTHING = 1;\n");
    expect(failures).toHaveLength(2);
  });
});

describe("violation 3 — a costume chosen by a condition or a status", () => {
  const fixture = (props: string) => `export function Row() { return <OAvatar ${props} />; }`;

  it("accepts a character passed straight through", () => {
    expect(checkCostume("app/x.tsx", fixture(`name={agent.avatar} size={50}`))).toEqual([]);
    expect(checkCostume("app/x.tsx", fixture(`name="wizard" size={100}`))).toEqual([]);
  });

  it.each([
    `name={agent.compliant ? "medic" : "robot"} size={50}`,
    `name={failed && "medic"} size={50}`,
    `name={avatarForStatus(run.status)} size={50}`,
    `name={healthy} size={50}`,
    `name={run.verdict} size={50}`,
  ])("fails on %s", (props) => {
    const failures = checkCostume("app/x.tsx", fixture(props));
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("recognition, never status");
  });

  it("fails on an announced costume outside the allowlist", () => {
    const failures = checkCostume("app/x.tsx", fixture(`name={agent.avatar} size={50} label="Wizard"`));
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("decoration must be silent");
  });

  it("allows an announced costume on a file that has earned it", () => {
    expect(
      checkCostume(
        "app/x.tsx",
        fixture(`name={agent.avatar} size={50} label="Wizard"`),
        new Set(["app/x.tsx"]),
      ),
    ).toEqual([]);
  });
});

describe("violation 4 — emerald reaching an avatar", () => {
  it("knows which classes the stylesheet paints with --ok", () => {
    const emerald = emeraldClasses(CSS);
    expect(emerald.has("is-healthy")).toBe(true);
    // The selector `.agent-card.is-healthy` names both, and both are therefore
    // classes that put an avatar in the green meaning system.
    expect(emerald.has("agent-card")).toBe(true);
    expect(emerald.has("o-avatar")).toBe(false);
  });

  it("accepts an avatar in a container that is not painted green", () => {
    const source = `<li className="fleet-row"><OAvatar name={a.avatar} size={50} /></li>`;
    expect(checkEmerald({ file: "app/x.tsx", source, css: CSS })).toEqual([]);
  });

  it("fails when the class is on the avatar itself", () => {
    const source = `<OAvatar name={a.avatar} size={50} className="is-healthy" />`;
    const failures = checkEmerald({ file: "app/x.tsx", source, css: CSS });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("an avatar is never a health signal");
  });

  it("fails when the class is on the container", () => {
    const source = `
      <li className="agent-card is-healthy">
        <span className="fleet-portrait">
          <OAvatar name={a.avatar} size={100} />
        </span>
      </li>`;
    const failures = checkEmerald({ file: "app/x.tsx", source, css: CSS });
    // Both `agent-card` and `is-healthy` are emerald-painted by that selector,
    // so the container trips twice. Two sentences about one container is the
    // right kind of noisy: each names a class the author can remove.
    expect(failures.length).toBeGreaterThanOrEqual(1);
    expect(failures.every((failure: string) => failure.includes('makes the costume inside it mean it too'))).toBe(
      true,
    );
  });

  it("does not blame a sibling that closed before the avatar opened", () => {
    // The scanner has to pop the stack on `</span>`, or every earlier element in
    // a file would count as an ancestor of every later avatar.
    const source = `
      <li className="fleet-row">
        <span className="is-healthy">Live</span>
        <OAvatar name={a.avatar} size={50} />
      </li>`;
    expect(checkEmerald({ file: "app/x.tsx", source, css: CSS })).toEqual([]);
  });

  it("fails when the stylesheet paints the avatar directly", () => {
    const failures = checkAvatarCss(`.o-avatar { image-rendering: pixelated; border: 1px solid var(--ok); }`);
    expect(failures.some((failure: string) => failure.includes("--ok"))).toBe(true);
  });
});

describe("the stylesheet's own half", () => {
  it("passes on the shipped rule", () => {
    expect(checkAvatarCss(CSS)).toEqual([]);
  });

  it("fails when pixelated rendering is dropped", () => {
    const failures = checkAvatarCss(`.o-avatar { width: var(--o-size); }`);
    expect(failures.some((failure: string) => failure.includes("image-rendering: pixelated"))).toBe(
      true,
    );
  });

  it("fails when there is no avatar rule at all", () => {
    expect(checkAvatarCss(`.something-else { color: red; }`).length).toBeGreaterThan(0);
  });

  it("fails on a literal motion duration, and accepts a token", () => {
    // The reduced-motion guarantee lives in `app/tokens.css`, which zeroes
    // `--motion-*`. A literal duration on an avatar rule is a sprite that keeps
    // moving for somebody who asked it not to, and no per-surface media query
    // would be needed if the token were used.
    const literal = checkAvatarCss(
      `.o-avatar { image-rendering: pixelated; animation: bob 400ms infinite; }`,
    );
    expect(literal.some((failure: string) => failure.includes("prefers-reduced-motion"))).toBe(true);

    expect(
      checkAvatarCss(
        `.o-avatar { image-rendering: pixelated; transition: opacity var(--motion-fast) ease; }`,
      ),
    ).toEqual([]);
  });

  it("fails on an --o-size that is not a whole multiple of 50", () => {
    const failures = checkAvatarCss(
      `.o-avatar { image-rendering: pixelated; } .o-avatar--tiny { --o-size: 30px; }`,
    );
    expect(failures.some((failure: string) => failure.includes("--o-size: 30px"))).toBe(true);
  });
});

/* ---------------------------------------------------------------------- *
 * MAR-535 — where a font is allowed to come from
 * ---------------------------------------------------------------------- */

/**
 * Henrik's final MAR-535 answer (2026-08-07, ~20:30Z): **bundle**. The two OFL
 * families ship in `public/fonts/`, declared by `app/fonts.css` — and this rule
 * survived that decision without a line changing, because what it forbids is a
 * **fetch**, not a font file. The bundled faces are same-origin reads over
 * `dash-app://`, which is the case the "allows a bundled face" fixture below
 * always covered; it went from describing a future to describing the product.
 *
 * A decision recorded only in prose is one the next reskin quietly reverses, so
 * these are the cases that would reverse it — a CDN @font-face, an off-machine
 * @import, a font-host <link>, next/font/google.
 */
describe("violation 5 — a page reaching off this machine for a font (MAR-535)", () => {
  it("refuses an @font-face served from somewhere else", () => {
    const failures = checkNoRemoteFonts([
      {
        name: "app/tokens.css",
        source: `@font-face { font-family: "Space Grotesk"; src: url("https://fonts.gstatic.com/s/spacegrotesk.woff2") format("woff2"); }`,
      },
    ]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("fonts.gstatic.com");
  });

  it("refuses a protocol-relative one, which reads as local and is not", () => {
    const failures = checkNoRemoteFonts([
      {
        name: "app/globals.css",
        source: `@font-face { font-family: X; src: url(//cdn.example.com/x.woff2); }`,
      },
    ]);
    expect(failures).toHaveLength(1);
  });

  it("refuses an off-machine @import, which is how a font usually arrives", () => {
    const failures = checkNoRemoteFonts([
      { name: "app/globals.css", source: `@import url("https://fonts.googleapis.com/css2?family=X");` },
    ]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("fonts.googleapis.com");
  });

  it("refuses the preconnect that precedes one, which is the earliest visible sign", () => {
    const failures = checkNoRemoteFonts([
      {
        name: "app/layout.tsx",
        source: `<link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />`,
      },
    ]);
    expect(failures).toHaveLength(1);
  });

  it("refuses next/font/google, and says why it is not the same failure", () => {
    // It self-hosts, so no page requests a remote font at runtime. What moves is
    // the fetch, to build time — where an offline build either fails or ships
    // whatever the network answered. The sentence has to say that, or the next
    // reader files it as a false positive and deletes the rule.
    const failures = checkNoRemoteFonts([
      { name: "app/layout.tsx", source: `import { Space_Grotesk } from "next/font/google";` },
    ]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("build time");
  });

  it("allows a bundled face, because the rule is about a fetch and not about a font file", () => {
    // The load-bearing pair. If MAR-535 is ever revisited and the two OFL
    // families are vendored, they are same-origin reads over dash-app:// and
    // nothing here has to be relaxed to let them in.
    expect(
      checkNoRemoteFonts([
        {
          name: "app/tokens.css",
          source: `@font-face { font-family: "JetBrains Mono"; src: url("/fonts/jetbrains-mono.woff2") format("woff2"); font-display: swap; }`,
        },
        { name: "app/layout.tsx", source: `import localFont from "next/font/local";` },
      ]),
    ).toEqual([]);
  });

  it("says nothing about the stacks the product actually ships", () => {
    // Naming a family that the machine may or may not have installed is the
    // decision itself, not a violation of it.
    expect(
      checkNoRemoteFonts([
        {
          name: "app/tokens.css",
          source: `:root { --font-display: "Space Grotesk", "Segoe UI", sans-serif; --font-ui: "JetBrains Mono", Consolas, monospace; }`,
        },
      ]),
    ).toEqual([]);
  });

  it("fails when it scanned nothing at all", () => {
    /*
     * The floor, and it is the point rather than defensive noise. MAR-498's
     * client-bundle guard passed against a list nobody had widened, and its
     * repair kept the original names as a floor because a walk that broke and
     * returned an empty set would pass that file forever. A font rule that
     * scanned nothing is that same failure wearing a different name.
     */
    const failures = checkNoRemoteFonts([]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("stopped looking");
  });

  it("is actually reached by the real check, over more than the token files", () => {
    // `checkAvatarCss` reads two stylesheets. This rule has to see every file
    // under app/, because a remote font arrives wherever somebody adds it — and
    // a rule wired to the narrow list would be green for the wrong reason.
    const result = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "brand-check.mjs")], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    const scanned = /(\d+) file\(s\) checked for remote fonts/.exec(
      `${result.stdout}${result.stderr}`,
    );
    expect(scanned).not.toBeNull();
    expect(Number(scanned?.[1])).toBeGreaterThan(10);
  });
});

/* ---------------------------------------------------------------------- *
 * MAR-535 — the bundling half: the chosen families actually ship
 * ---------------------------------------------------------------------- */

describe("violation 6 — a bundled family that does not truthfully ship (MAR-535)", () => {
  /** A minimal in-memory public/fonts/ that satisfies every rule. */
  const wholeShipment = () =>
    BUNDLED_FONTS.flatMap(({ file, licence }) => [
      { name: file, bytes: Buffer.from("wOF2....rest-of-a-font") },
      { name: licence, bytes: Buffer.from("SIL Open Font License, Version 1.1") },
    ]);

  it("passes when both families ship with their licences", () => {
    expect(checkBundledFonts({ fonts: wholeShipment(), sources: [] })).toEqual([]);
  });

  it("fails when a woff2 is missing — the silent regression MAR-535 was filed about", () => {
    // Deleting the file fails no build: @font-face degrades through local()
    // and the fallback stacks, and the reskin quietly loses its type pairing.
    const fonts = wholeShipment().filter((f) => f.name !== "space-grotesk-latin.woff2");
    const failures = checkBundledFonts({ fonts, sources: [] });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("space-grotesk-latin.woff2 is missing");
  });

  it("fails when the bytes are not a woff2", () => {
    const fonts = wholeShipment().map((f) =>
      f.name === "jetbrains-mono-latin.woff2" ? { ...f, bytes: Buffer.from("<html>...") } : f,
    );
    const failures = checkBundledFonts({ fonts, sources: [] });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("magic bytes");
  });

  it("fails when a licence is missing, and names it as a licence violation", () => {
    const fonts = wholeShipment().filter((f) => f.name !== "OFL-jetbrains-mono.txt");
    const failures = checkBundledFonts({ fonts, sources: [] });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("licence violation");
  });

  it("fails when the licence file is not the licence", () => {
    const fonts = wholeShipment().map((f) =>
      f.name === "OFL-space-grotesk.txt" ? { ...f, bytes: Buffer.from("TODO") } : f,
    );
    const failures = checkBundledFonts({ fonts, sources: [] });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("not a placeholder");
  });

  it("fails when a stylesheet names a /fonts/ file that does not exist", () => {
    const failures = checkBundledFonts({
      fonts: wholeShipment(),
      sources: [
        {
          name: "app/fonts.css",
          source: `@font-face { font-family: X; src: url("/fonts/typo-name.woff2") format("woff2"); }`,
        },
      ],
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("/fonts/typo-name.woff2");
  });

  it("holds against the real shipment: app/fonts.css references resolve and both licences ride along", () => {
    // The fixture cases above prove the rule can fail; this proves the actual
    // public/fonts/ directory and the actual stylesheet satisfy it, which is
    // the claim the @font-face declarations make to every installed machine.
    const fontDir = path.join(repoRoot, "public", "fonts");
    const fonts = readdirSync(fontDir).map((name) => ({
      name,
      bytes: readFileSync(path.join(fontDir, name)),
    }));
    const fontsCss = readFileSync(path.join(repoRoot, "app", "fonts.css"), "utf8");
    expect(
      checkBundledFonts({ fonts, sources: [{ name: "app/fonts.css", source: fontsCss }] }),
    ).toEqual([]);
  });
});

describe("violation 7 — an idle action that drifts, or says something (MAR-587)", () => {
  const key = "ninja-shuriken-toss";
  const sheetBytes = readFileSync(path.join(repoRoot, "public", "o", "actions", `${key}.png`));
  const actions = JSON.parse(
    readFileSync(path.join(repoRoot, "lib", "brand", "o-actions.json"), "utf8"),
  ) as { sheets: Record<string, Record<string, unknown>> };
  const record = actions.sheets[key] as {
    character: string;
    frameCount: number;
    frameWidth: number;
    frameHeight: number;
    sha256: string;
    still: { sha256: string };
    region: { x: number; y: number; w: number; h: number };
  };

  /** The real sheet, measured against the real still — not a hand-built fixture. */
  const audit = auditSheet(sheetBytes, ninja, key);
  const base = { names: ["ninja"], files: [key], manifest: { sheets: { [key]: record } } };

  it("measures the vendored sheet as eight 50x50 frames", () => {
    expect(audit.frameCount).toBe(8);
    expect(audit.width).toBe(400);
    expect(audit.height).toBe(50);
    expect(audit.frames.every((frame) => frame.cornersTransparent)).toBe(true);
  });

  it("passes on the sheet as vendored", () => {
    expect(checkActions({ ...base, measured: { [key]: audit } })).toEqual([]);
  });

  it("fails when the sheet no longer matches the audited hash", () => {
    const failures = checkActions({
      ...base,
      manifest: { sheets: { [key]: { ...record, sha256: "0".repeat(64) } } },
      measured: { [key]: audit },
    });
    expect(failures.some((failure: string) => failure.includes("audited hash"))).toBe(true);
    expect(failures.some((failure: string) => failure.includes("re-vendor"))).toBe(true);
  });

  it("fails when the character was re-vendored and its animation was left behind", () => {
    // The failure only an animation has. Both files stay individually valid —
    // the still is a real still, the sheet is a real sheet — and nothing but
    // this pairing notices that the sheet animates pixels that are gone.
    const failures = checkActions({
      ...base,
      manifest: { sheets: { [key]: { ...record, still: { sha256: "a".repeat(64) } } } },
      measured: { [key]: audit },
    });
    expect(failures.some((failure: string) => failure.includes("left behind"))).toBe(true);
  });

  it("fails when a frame changes a pixel outside its declared region", () => {
    // Shrinking the declared box is the same event as a frame growing past it:
    // the check re-derives what actually moved from the pixels, so it cannot be
    // satisfied by a manifest that simply claims more room.
    const pinched = { ...record, region: { ...record.region, w: 4, h: 4 } };
    const failures = checkActions({
      ...base,
      manifest: { sheets: { [key]: pinched } },
      measured: { [key]: audit },
    });
    expect(failures.length).toBeGreaterThan(0);
    expect(failures[0]).toContain("outside its declared region");
    // The reason matters more than the coordinates: a region that can grow is a
    // costume that can be made to carry status.
    expect(failures[0]).toContain("something a costume could be made to say");
  });

  it("fails when a frame paints emerald", () => {
    const stained = {
      ...audit,
      frames: audit.frames.map((frame, i) => (i === 3 ? { ...frame, emeraldPixels: 6 } : frame)),
    };
    const failures = checkActions({ ...base, measured: { [key]: stained } });
    expect(failures.some((failure: string) => failure.includes("emerald"))).toBe(true);
    expect(failures.some((failure: string) => failure.includes("never a health signal"))).toBe(true);
  });

  it("fails when a frame has a non-transparent corner", () => {
    const boxed = {
      ...audit,
      frames: audit.frames.map((frame, i) => (i === 0 ? { ...frame, cornersTransparent: false } : frame)),
    };
    const failures = checkActions({ ...base, measured: { [key]: boxed } });
    expect(failures.some((failure: string) => failure.includes("non-transparent corner"))).toBe(true);
  });

  it("fails when the sheets disagree about frame count", () => {
    // One loop duration covers the whole fleet, so a six-frame character would
    // either run at a different speed or be resampled in time.
    const other = "knight-sword-swing";
    const shortened = { ...audit, frameCount: 6, frames: audit.frames.slice(0, 6) };
    const failures = checkActions({
      names: ["ninja", "knight"],
      files: [key, other],
      manifest: {
        sheets: {
          [key]: record,
          [other]: { ...(actions.sheets[other] as Record<string, unknown>), frameCount: 6 },
        },
      },
      measured: { [key]: audit, [other]: shortened },
    });
    expect(failures.some((failure: string) => failure.includes("disagree about frame count"))).toBe(true);
  });

  it("fails on a sheet that is on disk but not in the manifest, and vice versa", () => {
    expect(
      checkActions({ ...base, files: [key, "pirate-plank-walk"], measured: { [key]: audit } }).some(
        (failure: string) => failure.includes("unaudited animation"),
      ),
    ).toBe(true);
    expect(
      checkActions({ ...base, files: [], measured: {} }).some((failure: string) =>
        failure.includes("does not exist"),
      ),
    ).toBe(true);
  });

  it("fails on an action whose character is not in the cast", () => {
    const failures = checkActions({
      ...base,
      names: ["knight"],
      measured: { [key]: audit },
    });
    expect(failures.some((failure: string) => failure.includes("not in O_NAMES"))).toBe(true);
  });
});

describe("violation 8 — an idle action that is decided by something (MAR-587 Phase B)", () => {
  const fixture = (props: string) => `export function Row() { return <OAvatar ${props} />; }`;

  it("accepts a surface that has simply decided to animate, or not to", () => {
    expect(checkCostume("app/x.tsx", fixture(`name={agent.avatar} size={200} action`))).toEqual([]);
    expect(checkCostume("app/x.tsx", fixture(`name={agent.avatar} size={200} action={true}`))).toEqual([]);
    expect(checkCostume("app/x.tsx", fixture(`name={agent.avatar} size={50} action={false}`))).toEqual([]);
    // The still, unchanged, is still the common case and must stay silent.
    expect(checkCostume("app/x.tsx", fixture(`name={agent.avatar} size={50}`))).toEqual([]);
  });

  it.each([
    `name={agent.avatar} size={200} action={agent.running}`,
    `name={agent.avatar} size={200} action={hasNewOutput}`,
    `name={agent.avatar} size={200} action={motion !== "sleeping"}`,
    `name={agent.avatar} size={200} action={agent.glance.length > 0}`,
    // Not a status word between them, which is the point: the rule is exact
    // rather than a guess at vocabulary, because there is no legitimate
    // expression here to leave room for.
    `name={agent.avatar} size={200} action={showIt}`,
    `name={agent.avatar} size={200} action="yes"`,
  ])("fails on %s", (props) => {
    const failures = checkCostume("app/x.tsx", fixture(props));
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("costume flavour, never status");
  });

  describe("and the typed view drifting from the audit record", () => {
    const source = readFileSync(path.join(repoRoot, "lib", "brand", "o-actions.ts"), "utf8");
    const actions = JSON.parse(
      readFileSync(path.join(repoRoot, "lib", "brand", "o-actions.json"), "utf8"),
    ) as { sheets: Record<string, { character: string; action: string; frameCount: number }> };
    const names = ["ninja", "knight", "wizard"];

    it("passes on the module as it stands", () => {
      expect(checkActionModule({ source, manifest: actions, names })).toEqual([]);
    });

    it("reads the three sheets out of the module rather than trusting a copy", () => {
      // A parser that quietly found nothing would report "no drift" for a file
      // it had not read — `readCastModule`'s lesson, one module over.
      expect(checkActionModule({ source, manifest: { sheets: {} }, names }).length).toBe(3);
    });

    it("fails on a sheet that is audited and unreachable", () => {
      // The quiet one. The pixels are perfect, the manifest is perfect, and the
      // character simply never animates with nothing anywhere saying why.
      const failures = checkActionModule({
        source,
        manifest: { sheets: { ...actions.sheets, "chef-pan-flip": { character: "chef", action: "pan-flip", frameCount: 8 } } },
        names: [...names, "chef"],
      });
      expect(failures.some((failure: string) => failure.includes("no surface can reach it"))).toBe(true);
    });

    it("fails on a module entry for a sheet that was never vendored", () => {
      const invented = source.replace(
        '{ key: "wizard-fireball", character: "wizard", action: "fireball" },',
        '{ key: "wizard-fireball", character: "wizard", action: "fireball" },\n  { key: "king-crown-polish", character: "king", action: "crown-polish" },',
      );
      const failures = checkActionModule({ source: invented, manifest: actions, names: [...names, "king"] });
      expect(failures.some((failure: string) => failure.includes("nothing has audited"))).toBe(true);
    });

    it("fails when the module and the manifest disagree about who wears it", () => {
      const swapped = source.replace(
        '{ key: "wizard-fireball", character: "wizard", action: "fireball" }',
        '{ key: "wizard-fireball", character: "knight", action: "fireball" }',
      );
      const failures = checkActionModule({ source: swapped, manifest: actions, names });
      expect(failures.some((failure: string) => failure.includes("the wrong character would wear it"))).toBe(true);
    });

    it("fails when the frame count the renderer steps by is not the sheet's", () => {
      // `steps(--o-frames)` walks the sheet by this number, so a six here plays
      // three quarters of every loop and a ten runs off the end into blank.
      const miscounted = source.replace("O_ACTION_FRAMES = 8", "O_ACTION_FRAMES = 6");
      const failures = checkActionModule({ source: miscounted, manifest: actions, names });
      expect(failures.length).toBe(3);
      expect(failures[0]).toContain("run off the end");
    });

    it("fails when a character is given two actions", () => {
      const doubled = source.replace(
        '{ key: "wizard-fireball", character: "wizard", action: "fireball" },',
        '{ key: "wizard-fireball", character: "wizard", action: "fireball" },\n  { key: "ninja-shuriken-toss", character: "ninja", action: "shuriken-toss" },',
      );
      const failures = checkActionModule({ source: doubled, manifest: actions, names });
      expect(failures.some((failure: string) => failure.includes("more than one action"))).toBe(true);
    });
  });
});

describe("the working tree", () => {
  it("passes the real check", () => {
    // The whole script, against the repository as it stands. Everything above is
    // a fixture; this is the claim `pnpm verify` makes.
    const result = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "brand-check.mjs")], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(`${result.stdout}${result.stderr}`).toContain("brand:check passed");
    expect(result.status).toBe(0);
  });
});
