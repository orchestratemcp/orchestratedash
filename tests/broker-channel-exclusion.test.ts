/**
 * The one exclusion ADR 0007 names, made structural (MAR-484).
 *
 * > `/broker/drain` and `/broker/responses` are never called on a remote
 * > channel. Not conditionally, not behind a flag, not "only for agents that
 * > declare `local`". The remote channel type does not carry the capability.
 *
 * The failure this guards against is not an argument somebody wins. It is the
 * obvious, correct-looking refactor: generalise the drains to take a channel so
 * a remote runner's telemetry can be pulled the same way, and `/broker/drain`
 * comes along **because it was in the same loop**. ADR 0006 would be gone,
 * silently, in a commit whose message says "pull remote run evidence".
 *
 * So three different things have to fail, at three different times:
 *
 * 1. **At typecheck**, via `@ts-expect-error`. This is the load-bearing one and
 *    it is self-repairing in the direction that matters: if the remote channel
 *    ever *gains* the capability, the expected error stops occurring, and an
 *    unused `@ts-expect-error` is itself a compile error. The assertion cannot
 *    rot into a tautology.
 * 2. **At runtime**, so a cast, an `any`, or a JavaScript caller with no types
 *    at all still cannot get through.
 * 3. **At review**, via a scan of `lib/` and `electron/` for the route strings,
 *    which is what catches somebody hand-rolling a `fetch` rather than going
 *    through the channel at all.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { IPC_ORIGIN } from "../lib/agent-dom/ipc-fetch";
import {
  BROKER_ROUTES,
  EVIDENCE_ROUTES,
  localRunnerChannel,
  pathOf,
  RemoteRouteRefused,
  remoteRunnerChannel,
  type LocalRunnerChannel,
  type RemoteRunnerChannel,
} from "../lib/agent-dom/runner-channel";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Never dialled in this file: every test here is about the type or the guard. */
const local = localRunnerChannel({
  origin: IPC_ORIGIN,
  token: "channel-secret-never-sent-anywhere",
  endpoint: process.platform === "win32" ? String.raw`\\.\pipe\dash-test-none` : "/tmp/dash-test-none.sock",
});

const remote = remoteRunnerChannel({
  token: "the-host-runners-own-channel-secret",
  dial: () => Promise.reject(new Error("this test never dials")),
});

describe("the route sets", () => {
  /**
   * Pinned by value. Widening either list is then a change somebody wrote on
   * purpose and a reviewer can see, rather than a line appearing in a constant
   * nobody reads — which is precisely how the drains came to be neighbours in
   * the first place.
   */
  it("names the two brokered-credential routes and no others", () => {
    expect([...BROKER_ROUTES]).toEqual(["/broker/drain", "/broker/responses"]);
  });

  it("keeps every brokered route out of the set a remote runner answers", () => {
    for (const route of BROKER_ROUTES) {
      expect(EVIDENCE_ROUTES).not.toContain(route);
    }
  });

  it("still lets a remote runner answer for evidence, which is the point of having it", () => {
    expect(EVIDENCE_ROUTES).toContain("/telemetry/drain");
    expect(EVIDENCE_ROUTES).toContain("/artifacts/drain");
    expect(EVIDENCE_ROUTES).toContain("/workspace-artifacts");
  });
});

/**
 * The one route MAR-602 added, and the property that makes it safe to have
 * added (ADR 0014).
 *
 * The widening is real and is meant to be visible: a remote channel can now
 * cause something to happen on a host rather than only read what already did.
 * What has to stay true is that the variable half of it — an `agent_id` — is a
 * value in one path segment and not a path. If it could be a path, the whole
 * allowlist would be advisory, because the interesting route to reach is two
 * segments away from every route on it.
 */
describe("the run route's variable part", () => {
  it("puts an agent id in exactly one segment", () => {
    expect(pathOf({ agent_id: "ai-news-scout-2", leaf: "commands" })).toBe(
      "/agents/ai-news-scout-2/commands",
    );
  });

  it("cannot be talked into naming a brokered route", () => {
    for (const route of BROKER_ROUTES) {
      const built = pathOf({ agent_id: route, leaf: "commands" });
      expect(built).not.toContain(route);
      expect(built.startsWith("/agents/")).toBe(true);
      expect(built.endsWith("/commands")).toBe(true);
    }
  });

  it("cannot climb out of the agents path", () => {
    for (const hostile of ["../../broker/drain", "a/../../b", "x?y=1", "x#y"]) {
      const built = pathOf({ agent_id: hostile, leaf: "commands" });
      // Three separators exactly: the two this module wrote and no more.
      expect(built.split("/")).toHaveLength(4);
    }
  });

  /**
   * The one shape the encoder does not neutralise, refused by name.
   *
   * Dots are unreserved, so `encodeURIComponent("..")` is `..` and
   * `/agents/../commands` normalises to `/commands` before it reaches a socket.
   * Nothing is served there, so this closes a shape rather than a hole — and it
   * is asserted so that a later reading of "the encoder handles it" cannot
   * quietly remove the check.
   */
  it("refuses a run route whose agent names a directory instead of an agent", async () => {
    for (const dots of [".", "..", ""]) {
      await expect(
        (
          remote as unknown as {
            call: (route: { agent_id: string; leaf: string }) => Promise<Response>;
          }
        ).call({ agent_id: dots, leaf: "commands" }),
      ).rejects.toBeInstanceOf(RemoteRouteRefused);
    }
  });

  it("carries a run request for a real agent, which is what ADR 0014 admitted", async () => {
    // The dial rejects; this asserts the guard let it through, which is a
    // different failure from the one above and has a different type.
    await expect(
      (
        remote as unknown as {
          call: (route: { agent_id: string; leaf: string }) => Promise<Response>;
        }
      ).call({ agent_id: "ai-news-scout-2", leaf: "commands" }),
    ).rejects.not.toBeInstanceOf(RemoteRouteRefused);
  });

  it("refuses any other leaf, whatever the caller's types said", async () => {
    for (const leaf of ["lifecycle", "artifacts", "tasks"]) {
      await expect(
        (
          remote as unknown as {
            call: (route: { agent_id: string; leaf: string }) => Promise<Response>;
          }
        ).call({ agent_id: "ai-news-scout-2", leaf }),
      ).rejects.toBeInstanceOf(RemoteRouteRefused);
    }
  });
});

/**
 * The bytes of one output, which is the third route family (MAR-611, ADR 0017).
 *
 * Admitted because an index without bytes is a surface that lies: bringing an
 * agent home removes the bundle holding its files, and DASH had no way to fetch
 * one off a host at all — `workspaceDownload` reaches `RunnerHandle`, which is
 * the local runner and nothing else.
 *
 * Its variable part sits *before* a fixed segment, so `..` normalises to
 * `/artifacts/download` rather than to a route anybody serves. That makes the
 * guard defensive here rather than load-bearing, unlike the state route — and it
 * is asserted anyway, because "safe by accident of where the segment sits" is a
 * property the next leaf would silently not have.
 */
describe("the output-bytes route's variable part", () => {
  it("puts an artifact id in exactly one segment", () => {
    expect(pathOf({ artifact_id: "art-2026-08-11", leaf: "download" })).toBe(
      "/artifacts/art-2026-08-11/download",
    );
  });

  it("cannot be talked into naming a brokered route", () => {
    for (const route of BROKER_ROUTES) {
      const built = pathOf({ artifact_id: route, leaf: "download" });
      expect(built).not.toContain(route);
      expect(built.startsWith("/artifacts/")).toBe(true);
      expect(built.endsWith("/download")).toBe(true);
    }
  });

  it("refuses an artifact that names a directory instead of an output", async () => {
    for (const dots of [".", "..", ""]) {
      await expect(
        (
          remote as unknown as {
            call: (route: { artifact_id: string; leaf: string }) => Promise<Response>;
          }
        ).call({ artifact_id: dots, leaf: "download" }),
      ).rejects.toBeInstanceOf(RemoteRouteRefused);
    }
  });

  it("carries a request for a real output, which is what ADR 0017 admitted", async () => {
    await expect(
      (
        remote as unknown as {
          call: (route: { artifact_id: string; leaf: string }) => Promise<Response>;
        }
      ).call({ artifact_id: "art-2026-08-11", leaf: "download" }),
    ).rejects.not.toBeInstanceOf(RemoteRouteRefused);
  });

  it("checks the id the path actually uses, not whichever one a cast supplied", async () => {
    /*
     * A cast can carry both keys. The runtime guard pairs each leaf with *its
     * own* segment check for that reason — a guard that read `agent_id` on a
     * download route would be checking a field the path never uses, which is the
     * shape of a check that passes while the thing it protects is wrong.
     */
    await expect(
      (
        remote as unknown as {
          call: (route: Record<string, string>) => Promise<Response>;
        }
      ).call({ agent_id: "ai-news-scout-2", artifact_id: "..", leaf: "download" }),
    ).rejects.toBeInstanceOf(RemoteRouteRefused);
  });
});

describe("the exclusion, at compile time", () => {
  /**
   * Each directive sits on the line immediately above its code, with no comment
   * in between. `@ts-expect-error` attaches to the *next line*, so a prose
   * comment in the gap silently absorbs it and leaves an assertion that can
   * neither pass nor fail — which is worse than no assertion, because it reads
   * like one. The first draft of this file had exactly that.
   *
   * Both have been watched failing, and what each one caught is worth recording
   * because they are not the same guard:
   *
   * - Widening `RemoteRunnerChannel` to carry `BrokerRoute` turns the **call
   *   site** below into TS2578, and leaves the assignment above still excluded
   *   — by the capability brand.
   * - Removing the capability brand on its own turns **nothing** red: parameter
   *   contravariance already stops a narrow-routed channel standing in for a
   *   wide-routed one.
   * - Removing both turns both lines into TS2578.
   *
   * So the exclusion has two independent mechanisms and the assignment is
   * behind both. That is the reason the brand is worth its cast: it survives
   * somebody deciding the route sets should be the same.
   */
  it("refuses a remote channel where a broker-capable one is required", () => {
    // @ts-expect-error A remote channel does not carry the broker capability.
    const forbidden: LocalRunnerChannel = remote;
    expect(forbidden).toBeDefined();
  });

  it("refuses a brokered route at a remote call site", () => {
    // @ts-expect-error "/broker/drain" is not a route a remote channel accepts.
    const call = () => remote.call("/broker/drain", { method: "POST" });
    expect(call).toBeTypeOf("function");
  });

  /**
   * The direction that must keep working, asserted so that a future tightening
   * cannot take it away by accident. Evidence code written once has to serve
   * both kinds of runner, or MAR-488 has to write it twice — and two
   * implementations of "pull what this agent did" is how the two come to
   * disagree.
   */
  it("still lets the local channel stand in for a remote one, so evidence code is written once", () => {
    const evidenceOnly: RemoteRunnerChannel = local;
    expect(evidenceOnly.origin).toBe(IPC_ORIGIN);
  });
});

describe("the exclusion, at runtime", () => {
  it("rejects each brokered route on a remote channel, whatever the caller's types said", async () => {
    for (const route of BROKER_ROUTES) {
      // The cast is the point: this is what a JavaScript caller, an `any`, or a
      // deliberate escape hatch looks like from here.
      await expect(
        (remote as unknown as { call: (route: string) => Promise<Response> }).call(route),
      ).rejects.toBeInstanceOf(RemoteRouteRefused);
    }
  });

  it("says why in a sentence about the rule rather than about the route", async () => {
    let refused: unknown;
    try {
      await (remote as unknown as { call: (route: string) => Promise<Response> }).call("/broker/drain");
    } catch (error: unknown) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(RemoteRouteRefused);
    expect((refused as Error).message).toContain("stay on the computer DASH is installed on");
  });

  it("does not refuse the evidence routes it does carry", async () => {
    // The dial itself rejects — this asserts the *guard* let it through, which
    // is a different failure from the one above and has a different type.
    await expect(
      (remote as unknown as { call: (route: string) => Promise<Response> }).call("/telemetry/drain"),
    ).rejects.not.toBeInstanceOf(RemoteRouteRefused);
  });
});

describe("the exclusion, at review", () => {
  /**
   * Two files may name these routes: the module that defines the capability,
   * and the one caller that holds it. `runner/server.ts` serves them and is
   * deliberately outside the scan — the runner answering a route on its own
   * authenticated local channel is not the thing being guarded.
   */
  const PERMITTED = new Set([
    path.join("lib", "agent-dom", "runner-channel.ts"),
    path.join("electron", "broker-host.ts"),
  ]);

  function sourceFiles(directory: string): string[] {
    return readdirSync(directory).flatMap((name) => {
      const file = path.join(directory, name);
      return statSync(file).isDirectory() ? sourceFiles(file) : file.endsWith(".ts") ? [file] : [];
    });
  }

  /**
   * Comments are stripped before the search, deliberately.
   *
   * `electron/ssh-host.ts` names both routes in its header to explain why its
   * channel cannot carry them, and that paragraph is the opposite of the thing
   * being caught — a scan that punished it would push the explanation out of
   * the file that needs it most. What is being looked for is a route reaching
   * a request, which is code.
   */
  function withoutComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  }

  it("finds the brokered routes named in code only where the capability is defined and held", () => {
    const offenders: string[] = [];
    for (const directory of ["lib", "electron"]) {
      for (const file of sourceFiles(path.join(repoRoot, directory))) {
        const relative = path.relative(repoRoot, file);
        if (PERMITTED.has(relative)) {
          continue;
        }
        const source = withoutComments(readFileSync(file, "utf8"));
        if (BROKER_ROUTES.some((route) => source.includes(route))) {
          offenders.push(relative);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
