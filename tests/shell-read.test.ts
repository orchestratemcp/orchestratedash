/**
 * The read-only channel's gate (MAR-432, DASH-20).
 *
 * `tests/shell.test.ts` does this job for the audited command channel. This is
 * the same job for the second channel, plus the assertions that only matter
 * because there are now two: they must not be the same channel, and the read
 * surface must not have grown a way to cause an effect.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { SHELL_COMMAND_CHANNEL } from "../lib/shell/ipc";
import { READS, SHELL_READ_CHANNEL, isReadName, reviewRead } from "../lib/shell/read";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("the read channel's identity", () => {
  it("is not the command channel", () => {
    expect(SHELL_READ_CHANNEL).not.toBe(SHELL_COMMAND_CHANNEL);
  });

  it("names only documents", () => {
    // Every read is a view. A read named after a verb would be a command that
    // took the door with no audit record on it, which is the one way this
    // channel could become something its design never argued for.
    for (const name of Object.keys(READS)) {
      expect(name.startsWith("view."), `${name} must be a view, not an action`).toBe(true);
    }
  });

  it("describes what each read returns, for whoever audits the surface", () => {
    for (const [name, spec] of Object.entries(READS)) {
      expect(spec.returns.length, `${name} must say what it returns`).toBeGreaterThan(20);
    }
  });
});

describe("reviewRead", () => {
  it("allows a declared read with no parameters", () => {
    expect(reviewRead({ read: "view.agents" })).toEqual({
      decision: "allowed",
      read: "view.agents",
      params: {},
    });
  });

  it("allows a declared read with its declared parameters", () => {
    expect(reviewRead({ read: "view.run", params: { agent: "a", run_id: "r" } })).toEqual({
      decision: "allowed",
      read: "view.run",
      params: { agent: "a", run_id: "r" },
    });
    expect(reviewRead({ read: "view.workspace", params: { agent: "a" } })).toEqual({
      decision: "allowed",
      read: "view.workspace",
      params: { agent: "a" },
    });
  });

  it("denies a read nobody declared", () => {
    expect(reviewRead({ read: "view.secrets" })).toEqual({
      decision: "denied",
      reason: "unknown_read",
    });
    expect(reviewRead({ read: "store.query" })).toEqual({
      decision: "denied",
      reason: "unknown_read",
    });
  });

  it("denies a command name arriving on the read channel", () => {
    // The two catalogues are disjoint, and this is what says so out loud: a
    // renderer that reached the read channel cannot use it to ask for an effect.
    expect(reviewRead({ read: "agent.approve", params: { agent_id: "a" } })).toEqual({
      decision: "denied",
      reason: "unknown_read",
    });
    expect(reviewRead({ read: "runner.remove", params: { agent_id: "a" } })).toEqual({
      decision: "denied",
      reason: "unknown_read",
    });
  });

  it("denies garbage without throwing", () => {
    for (const request of [null, undefined, 42, "view.agents", [], { read: "" }, { read: 7 }]) {
      const review = reviewRead(request);
      expect(review.decision).toBe("denied");
    }
  });

  it("denies a parameter the read did not declare", () => {
    expect(
      reviewRead({ read: "view.agents", params: { agent: "a" } }),
    ).toEqual({ decision: "denied", reason: "unexpected_param" });

    // Denies the whole request rather than dropping the extra: a caller sending
    // a field we do not understand has a different model of this read than we
    // do, and ignoring it hides that.
    expect(
      reviewRead({ read: "view.run", params: { agent: "a", run_id: "r", limit: "9" } }),
    ).toEqual({ decision: "denied", reason: "unexpected_param" });
  });

  it("denies a missing parameter rather than defaulting it", () => {
    expect(reviewRead({ read: "view.run", params: { agent: "a" } })).toEqual({
      decision: "denied",
      reason: "missing_param",
    });
    expect(reviewRead({ read: "view.run" })).toEqual({
      decision: "denied",
      reason: "missing_param",
    });
  });

  it("denies an empty parameter, which names nothing", () => {
    expect(reviewRead({ read: "view.run", params: { agent: "", run_id: "r" } })).toEqual({
      decision: "denied",
      reason: "missing_param",
    });
  });

  it("denies a parameter that is not a string", () => {
    // Objects and arrays are where a prototype, a buffer or somebody else's blob
    // would arrive. Same rule as the command channel's payload values.
    for (const value of [{}, [], 5, true, null] as unknown[]) {
      expect(
        reviewRead({ read: "view.run", params: { agent: value, run_id: "r" } }).decision,
      ).toBe("denied");
    }
  });

  it("does not inherit a parameter from the prototype chain", () => {
    const params = Object.create({ agent: "inherited", run_id: "inherited" }) as Record<
      string,
      unknown
    >;
    expect(reviewRead({ read: "view.run", params })).toEqual({
      decision: "denied",
      reason: "missing_param",
    });
  });
});

/**
 * The preload's surface, read as source.
 *
 * A source assertion rather than a behavioural one because the property is about
 * what the file *does not* contain, and the thing that would break it — a third
 * bridge, or a generic method on one of the two — cannot be observed by calling
 * the two bridges that exist. Importing this module in a test is not possible
 * either: it calls `contextBridge` at module scope and there is no Electron here.
 */
describe("the preload's exposed surface", () => {
  const source = readFileSync(path.join(repoRoot, "electron", "preload.ts"), "utf8");

  it("exposes exactly two bridges, both named", () => {
    const exposed = [...source.matchAll(/exposeInMainWorld\(\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(exposed).toEqual(["dashShell", "dashData"]);
  });

  it("never hands the renderer ipcRenderer or a channel name", () => {
    // `ipcRenderer.invoke` and the channel constants are how both bridges work,
    // so their presence in the module is expected. What must not happen is
    // either escaping onto an *exposed object*, so the assertion is scoped to
    // the two object literals rather than to the file.
    for (const bridge of ["dashShell", "dashData"]) {
      const start = source.indexOf(`const ${bridge} = {`);
      expect(start, `${bridge} must be a single object literal`).toBeGreaterThan(-1);
      const end = source.indexOf("\n};", start);
      const body = source.slice(start, end);

      expect(body, `${bridge} must not expose ipcRenderer`).not.toContain("ipcRenderer");
      expect(body, `${bridge} must not expose a channel name`).not.toContain("CHANNEL");
    }
  });

  it("exposes the three host actions by name, with no private-key or path argument", () => {
    const start = source.indexOf("const dashShell = {");
    const end = source.indexOf("\n};", start);
    const body = source.slice(start, end);

    expect(body).toContain("createHost:");
    expect(body).toContain("probeHost:");
    expect(body).toContain("forgetHost:");
    expect(body).not.toContain("private_key");
    expect(body).not.toContain("key_path");
  });
});

describe("isReadName", () => {
  it("recognises exactly the catalogue", () => {
    expect(isReadName("view.agents")).toBe(true);
    expect(isReadName("view.inbox")).toBe(true);
    expect(isReadName("view.workspace")).toBe(true);
    expect(isReadName("view.nothing")).toBe(false);
    expect(isReadName("toString")).toBe(false);
    expect(isReadName(undefined)).toBe(false);
  });
});
