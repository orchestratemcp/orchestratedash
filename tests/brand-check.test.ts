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
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  auditSprite,
  checkAvatarCss,
  checkCast,
  checkCostume,
  checkEmerald,
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
    expect(checkSizeApi([50, 100])).toEqual([]);
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
    expect(sizes).toEqual([50, 100]);
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
