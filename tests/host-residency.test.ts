/**
 * `service`, the boot entry, and the standing set a host comes back to
 * (MAR-795, ADR 0031).
 *
 * ## What is proven here and what is permanently attended
 *
 * ADR 0004's split, applied to a decision whose whole subject is a machine that
 * is not this repository. What runs below is everything that can run without a
 * server: the unit's **text**, which is a pure function of roots the helper
 * picked; the request's closed field set; the three reported states and the
 * sentence for each; the named stop for a host whose init system is not the
 * supported one; the two routes admitted to the remote channel and the two still
 * refused; the standing row a rebooted runner reads back; and the partition that
 * stops one instruction firing on two machines.
 *
 * What is **not** here, and cannot be: a real `systemctl`, a real
 * `loginctl enable-linger`, and a real reboot of the enrolled host. Those are
 * ADR 0031's attended half and they are attended permanently.
 *
 * ## Why the helper is driven end to end rather than unit-tested
 *
 * `tests/install-key.test.ts`'s substitution, unchanged and for its reason:
 * `runDeployVerb` is the production function, the helper is the production
 * bundle built from the same entry point `scripts/build-runner-standalone.mjs`
 * uses, and the only difference from a real press is `spawn("node", [...])`
 * where production writes `spawn("ssh", sshArgv(...))`.
 *
 * Two of the helper's own environment variables are pointed at scratch
 * directories: `XDG_CONFIG_HOME`, which is systemd's own convention for where a
 * user unit lives, and `DASH_HOST_SYSTEMD_MARKER`, which decides which branch
 * the init check takes. Without the second, this file would assert one thing on
 * a developer's Windows machine and a different thing on a CI runner that is
 * booted with systemd — and the named stop, which is a proof-bar item, could
 * only be checked by reading the source. `systemdBooted`'s docblock argues why
 * that variable grants nothing.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { StdioChannel } from "../lib/agent-dom/ssh-fetch";
import {
  BROKER_ROUTES,
  BROWSER_ROUTES,
  EVIDENCE_ROUTES,
  RemoteRouteRefused,
  remoteRunnerChannel,
} from "../lib/agent-dom/runner-channel";
import {
  RESIDENCY_COPY,
  describeResidency,
  describeResidencyRefusal,
  describeResidencyRemoval,
  describeSchedulesTold,
} from "../lib/copy/host-residency";
import {
  HOST_SERVICE_ACTIONS,
  hostServiceReduction,
  hostServiceState,
  readHostServiceReport,
  readIsEnabled,
  readLinger,
  serviceUnitName,
  serviceUnitText,
  type HostServiceState,
} from "../lib/deploy/service-unit";
import {
  checkDeployRequest,
  DEPLOY_VERBS,
  type DeployAnswer,
  type DeployRequest,
} from "../lib/deploy/verbs";
import {
  delegationConflicts,
  splitSchedules,
  windowsFor,
  type ResidentHost,
} from "../lib/schedule/delegation";
import type { AgentSchedule } from "../lib/schedule/plan";
import { runDeployVerb, type DeploySpawn } from "../electron/ssh-host";
import { RunnerSchedule } from "../runner/schedule";
import type { Supervisor } from "../runner/supervisor";
import type { RunnerStore } from "../runner/store";
import { openHealthyRunnerStore } from "./helpers/runner-store";
import { expectPlainLanguage } from "./helpers/plain-language";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directories: string[] = [];
const stores: RunnerStore[] = [];
let helperBundle = "";

function freshDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `dash-residency-${prefix}-`));
  directories.push(dir);
  return dir;
}

beforeAll(async () => {
  const out = freshDir("helper");
  const { build } = await import("esbuild");
  await build({
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    logLevel: "silent",
    external: ["electron"],
    define: { __DASH_RUNNER_BUILD_ID__: JSON.stringify("residency-test") },
    entryPoints: [path.join(repoRoot, "scripts", "host-helper", "entry.ts")],
    outfile: path.join(out, "host-helper.mjs"),
  });
  helperBundle = path.join(out, "host-helper.mjs");
}, 60_000);

afterAll(() => {
  while (stores.length > 0) {
    stores.pop()?.close();
  }
  for (const dir of directories.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Everything the child was told, so a caller-named anything would be visible. */
interface Capture {
  argv: string[][];
  stdout: string;
  stderr: string;
}

function capture(): Capture {
  return { argv: [], stdout: "", stderr: "" };
}

interface HostEnvironment {
  /** The helper's own root, holding bundles and secrets. */
  root: string;
  /** Where a user unit lands. systemd's own convention, pointed at scratch. */
  config: string;
  /** What the init check looks for. A path that exists means systemd. */
  marker: string;
}

function localHelper(host: HostEnvironment, taken: Capture): DeploySpawn {
  return (verb, bundleId): StdioChannel => {
    const argv = [helperBundle, verb, ...(bundleId === undefined ? [] : [bundleId])];
    taken.argv.push([process.execPath, ...argv]);
    const child = spawn(process.execPath, argv, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        DASH_HOST_ROOT: host.root,
        XDG_CONFIG_HOME: host.config,
        DASH_HOST_SYSTEMD_MARKER: host.marker,
      },
    });
    child.stdout.on("data", (chunk: Buffer) => {
      taken.stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      taken.stderr += chunk.toString("utf8");
    });
    return {
      stdin: child.stdin,
      stdout: child.stdout,
      close: () => {
        child.stdin.end();
        child.kill();
      },
    };
  };
}

async function send(
  host: HostEnvironment,
  request: DeployRequest,
  taken: Capture = capture(),
): Promise<DeployAnswer> {
  return await runDeployVerb(localHelper(host, taken), request);
}

/**
 * A host with systemd, or without it, and nothing installed yet.
 *
 * `systemd: true` points the marker at a directory that exists, so the init
 * check passes on every platform this suite runs on. `false` points it at one
 * that does not, so the named stop is reachable on a CI runner that is itself
 * booted with systemd.
 */
function hostWith(options: { systemd: boolean }): HostEnvironment {
  const root = freshDir("root");
  const config = freshDir("config");
  const marker = options.systemd ? freshDir("marker") : path.join(freshDir("nomarker"), "absent");
  return { root, config, marker };
}

/**
 * A bundle on the host, written the way `install` writes one.
 *
 * Directly rather than through the `install` verb, for `tests/install-key.test.ts`'s
 * reason: this file is about a boot entry, and the bundle path is already proven
 * in `tests/deploy-bridge.test.ts`. What `service` reads is the record beside the
 * bundle and the directory it names.
 */
function installBundle(host: HostEnvironment, bundleId: string): void {
  const bundles = path.join(host.root, "bundles");
  mkdirSync(path.join(bundles, bundleId, "data"), { recursive: true });
  writeFileSync(
    path.join(bundles, `${bundleId}.json`),
    `${JSON.stringify({
      bundle_id: bundleId,
      agent_id: bundleId,
      runner_build: "residency-test",
      installed_at: "2026-08-25T20:00:00.000Z",
      pid: null,
    })}\n`,
    "utf8",
  );
  writeFileSync(path.join(bundles, bundleId, "start.mjs"), "// entry\n", "utf8");
}

function unitTextFor(host: HostEnvironment, bundleId: string): string {
  return readFileSync(
    path.join(host.config, "systemd", "user", serviceUnitName(bundleId)),
    "utf8",
  );
}

/* ---------------------------------------------------------------------- *
 * The unit's text
 * ---------------------------------------------------------------------- */

describe("the unit is generated from the helper's own roots", () => {
  const roots = {
    execPath: "/usr/bin/node",
    bundleDirectory: "/home/dash/.orchestratedash-host/bundles/news",
    dataDirectory: "/home/dash/.orchestratedash-host/bundles/news/data",
    hostRoot: "/home/dash/.orchestratedash-host",
    bundleId: "news",
  };

  it("names the entry point the helper already spawns, and nothing a request could", () => {
    const unit = serviceUnitText(roots);
    expect(unit.ok).toBe(true);
    const text = unit.ok ? unit.text : "";
    // The same three environment variables `start()` sets on the child it
    // spawns, and the same entry point. If these two ever disagree, a runner
    // started at boot and a runner started by a press are different programs.
    expect(text).toContain(`ExecStart="/usr/bin/node" "${roots.bundleDirectory}/start.mjs"`);
    expect(text).toContain(`Environment="DASH_RUNNER_DATA_DIR=${roots.dataDirectory}"`);
    expect(text).toContain(`Environment="DASH_HOST_ROOT=${roots.hostRoot}"`);
    expect(text).toContain(`Environment="DASH_HOST_BUNDLE_ID=news"`);
    expect(text).toContain("WantedBy=default.target");
  });

  it("makes no restart claim, which is the one line that would be a supervision promise", () => {
    /*
     * `runner/README.md` item 3 and ADR 0007's refusal: there is no restart
     * policy anywhere in DASH, on purpose, and a host that restarts an agent
     * DASH cannot see is a supervision claim DASH cannot make. `Restart=` is one
     * line and is exactly that claim, so its absence is asserted rather than
     * remembered.
     */
    const unit = serviceUnitText(roots);
    const text = unit.ok ? unit.text : "";
    expect(text).not.toMatch(/^Restart=/m);
    expect(text).not.toMatch(/^RestartSec=/m);
    // Nor an ordering claim about a boot sequence DASH has not tested on
    // anybody's distribution.
    expect(text).not.toMatch(/^After=/m);
  });

  it("carries no credential and no data directory a caller could have named", () => {
    const unit = serviceUnitText(roots);
    const text = unit.ok ? unit.text : "";
    // The variable DASH's own shell resolves its store from. A unit carrying one
    // would be a boot entry pointed at a directory this side chose, on a machine
    // this side does not administer — see [[store-and-vault-are-two-roots]] for
    // what a split root costs when nobody is watching.
    expect(text).not.toContain("DASH_DATA_DIR");
    // Nothing that could be a secret, a token or a key.
    expect(text).not.toMatch(/key|token|secret|password/i);
    // And nothing that reads a file at boot: the runner opens its own store from
    // the directory named above, and an `EnvironmentFile=` would be a second
    // place credentials could be expected to live.
    expect(text).not.toMatch(/^EnvironmentFile=/m);
  });

  it("refuses to write a unit it cannot spell, rather than escaping its way out", () => {
    for (const bad of ["/home/da\nsh", '/home/da"sh', "/home/da\\sh"]) {
      const unit = serviceUnitText({ ...roots, hostRoot: bad });
      expect(unit).toEqual({ ok: false, refusal: "unspellable_root" });
    }
  });

  it("names the unit after the product and the bundle, so an operator can find it", () => {
    expect(serviceUnitName("news")).toBe("orchestratedash-news.service");
    // The identifier alphabet cannot spell a separator, a quote or a space, so
    // the name is safe to concatenate and safe to pass as one argv token.
    expect(serviceUnitName("news")).not.toMatch(/[\s"'/\\]/);
  });
});

/* ---------------------------------------------------------------------- *
 * The request
 * ---------------------------------------------------------------------- */

describe("what a service request may say", () => {
  it("is the eleventh verb, and it is in the closed set", () => {
    expect([...DEPLOY_VERBS]).toContain("service");
  });

  it("takes one of three actions and refuses anything else", () => {
    for (const action of HOST_SERVICE_ACTIONS) {
      expect(checkDeployRequest({ verb: "service", action }).ok).toBe(true);
    }
    for (const action of ["restart", "now", "", "ENABLE", true, 1, null]) {
      const answer = checkDeployRequest({ verb: "service", action });
      expect(answer.ok).toBe(false);
      expect(answer.ok ? "" : answer.problem).toBe("malformed_service");
    }
  });

  it("refuses a bundle id, because the boot entry is a fact about the machine", () => {
    const answer = checkDeployRequest({ verb: "service", action: "status", bundle_id: "news" });
    expect(answer.ok).toBe(false);
    expect(answer.ok ? "" : answer.problem).toBe("malformed_service");
  });

  it("refuses every field a widening into remote execution would arrive in", () => {
    /*
     * ADR 0018 rule 2's list — path, filename, mode, environment variable,
     * command, executable — and the closed field set is what refuses them.
     * Asserted by value rather than by reading the source, because the whole
     * point of a closed set is that a field nobody reads is still refused.
     */
    for (const surplus of [
      { unit: "anything.service" },
      { exec: "/bin/sh" },
      { environment: "PATH=/tmp" },
      { restart: "always" },
      { path: "/etc/systemd/system" },
      { mode: 0o755 },
    ]) {
      const answer = checkDeployRequest({ verb: "service", action: "enable", ...surplus });
      expect(answer.ok).toBe(false);
      expect(answer.ok ? "" : answer.problem).toBe("malformed_service");
      // The refusal never quotes the field a caller chose: it is a string from a
      // machine DASH does not administer, headed for a log.
      expect(answer.ok ? "" : answer.detail).not.toContain(Object.keys(surplus)[0]);
    }
  });
});

/* ---------------------------------------------------------------------- *
 * The helper, driven for real
 * ---------------------------------------------------------------------- */

describe("what the helper does when asked", () => {
  it("writes nothing until it is asked, and the pack step never asks", async () => {
    /*
     * ADR 0031 decision 3 and ADR 0030 decision 4's opt-in rule: the setup step
     * lays the helper and the pack down on every invocation, and it must not lay
     * down a boot entry. Driven through the two verbs that run the bootstrap —
     * `pack` and `status` — and then asserted over the whole unit directory.
     */
    const host = hostWith({ systemd: true });
    installBundle(host, "news");

    await send(host, { verb: "pack" });
    await send(host, { verb: "status" });

    expect(existsSync(path.join(host.config, "systemd", "user"))).toBe(false);

    const asked = await send(host, { verb: "service", action: "status" });
    expect(asked.ok).toBe(true);
    expect(asked.ok && asked.verb === "service" ? asked.state : "").toBe("not_written");
  });

  it("names a stop of its own on a host whose init system is not the supported one", async () => {
    const host = hostWith({ systemd: false });
    installBundle(host, "news");

    const answer = await send(host, { verb: "service", action: "enable" });
    expect(answer.ok).toBe(false);
    expect(answer.ok ? "" : answer.problem).toBe("init_not_supported");
    // A named stop with its own sentence, in `lib/copy/`'s pattern rather than a
    // generic failure — and the sentence hands the decision back to the operator,
    // which is `runner/standalone.ts`'s original position kept where it is still
    // true.
    expect(describeResidencyRefusal("init_not_supported")).not.toBe(RESIDENCY_COPY.failed);
    expect(describeResidencyRefusal("init_not_supported")).toContain("yourself");
    // And nothing was written on the way to refusing.
    expect(existsSync(path.join(host.config, "systemd", "user"))).toBe(false);
  });

  it("refuses a server with nothing on it rather than writing an entry for nothing", async () => {
    const host = hostWith({ systemd: true });
    const answer = await send(host, { verb: "service", action: "enable" });
    expect(answer.ok).toBe(false);
    expect(answer.ok ? "" : answer.problem).toBe("not_installed");
  });

  /*
   * The two write proofs below are POSIX-only, and the reason is the file's own
   * subject rather than a platform excuse.
   *
   * A host is a Linux box — ADR 0021's premise and ADR 0031 decision 2's — and
   * `serviceUnitText` refuses a root it cannot spell in a `key=value` file,
   * which every Windows path is, because a backslash is systemd's own escape
   * character. So on a developer's machine the helper correctly refuses to write
   * a unit naming `C:\Users\...`, and there is no arrangement of this test that
   * would make it write one without weakening the check that stops it.
   *
   * What is not skipped is the generation: `serviceUnitText` is pure and is
   * asserted above, on every platform, against the roots a real host has. These
   * two add the placement — that the file lands where systemd looks, one per
   * bundle, and that turning it off removes it — and they run on the Linux job,
   * which is the machine the code is for.
   */
  it.skipIf(process.platform === "win32")("writes one entry per bundle, from its own roots, with the value on no command line", async () => {
    /*
     * The end-to-end half of the text proofs above. `systemctl` is not present
     * on a developer's machine and cannot see a unit under a scratch
     * `XDG_CONFIG_HOME` on a CI runner, so the *enable* step refuses on every
     * platform this suite runs on — which is itself the documented failure
     * behaviour: the unit is written before it is enabled, so a failure there
     * leaves a file that starts nothing and a state that says so.
     *
     * What is asserted is therefore the files, not the verdict, plus the fact
     * that the verdict is one of the two it may be.
     */
    const host = hostWith({ systemd: true });
    installBundle(host, "news");
    installBundle(host, "scout");
    const taken = capture();

    const answer = await send(host, { verb: "service", action: "enable" }, taken);
    if (!answer.ok) {
      expect(answer.problem).toBe("service_not_managed");
    }

    for (const bundleId of ["news", "scout"]) {
      const text = unitTextFor(host, bundleId);
      expect(text).toContain(`Environment="DASH_HOST_BUNDLE_ID=${bundleId}"`);
      expect(text).toContain(`Environment="DASH_HOST_ROOT=${host.root}"`);
      // The helper's own join, not anything a request said — there was nothing
      // in the request to say it with.
      expect(text).toContain(path.join(host.root, "bundles", bundleId));
      expect(text).not.toMatch(/^Restart=/m);
    }

    // The command line carried the verb and nothing else, which is this plane's
    // standing rule and the one `tests/host-record.test.ts` pins by value.
    for (const argv of taken.argv) {
      expect(argv.at(-1)).toBe("service");
    }
  });

  it.skipIf(process.platform === "win32")("removes what it wrote when it is turned off", async () => {
    const host = hostWith({ systemd: true });
    installBundle(host, "news");
    await send(host, { verb: "service", action: "enable" });
    expect(existsSync(path.join(host.config, "systemd", "user", "orchestratedash-news.service"))).toBe(
      true,
    );

    const off = await send(host, { verb: "service", action: "disable" });
    if (!off.ok) {
      expect(off.problem).toBe("service_not_managed");
    }
    // ADR 0030 decision 7's first answer, one machine over: turning the switch
    // off removes the entry, so the one broken boot this feature can produce has
    // something on screen that removes it.
    expect(existsSync(path.join(host.config, "systemd", "user", "orchestratedash-news.service"))).toBe(
      false,
    );
  });

  it("reads the state back after the act rather than reporting what was asked", async () => {
    const host = hostWith({ systemd: true });
    installBundle(host, "news");
    // `enable` cannot succeed here — see above — and the answer must therefore
    // never claim `enabled`. ADR 0030 decision 2's rule: read the system's own
    // off state, do not infer it from the request.
    await send(host, { verb: "service", action: "enable" });
    const asked = await send(host, { verb: "service", action: "status" });
    expect(asked.ok).toBe(true);
    const state = asked.ok && asked.verb === "service" ? asked.state : "enabled";
    expect(state).not.toBe("enabled");
    /*
     * `starts_at_boot` is deliberately **not** asserted here, and the reason is
     * itself worth recording: it is a property of the account the helper runs
     * as, and CI's own Linux runner turns out to have lingering enabled — so an
     * assertion either way would be a test about GitHub's machine rather than
     * about this code. What it is read from is asserted purely, in `readLinger`
     * above, and whether a real host lingers is the one line of the attended bar
     * most likely to need a person.
     */
  });
});

/* ---------------------------------------------------------------------- *
 * The three states, and the sentence for each
 * ---------------------------------------------------------------------- */

describe("the reported state", () => {
  it("distinguishes not written, enabled, and switched off on the server", () => {
    expect(hostServiceState(false, false)).toBe("not_written");
    expect(hostServiceState(true, true)).toBe("enabled");
    expect(hostServiceState(true, false)).toBe("disabled");
  });

  it("treats only the word `enabled` as enabled", () => {
    expect(readIsEnabled("enabled\n")).toBe(true);
    for (const said of ["disabled", "masked", "static", "linked", "indirect", "", "enabled-runtime"]) {
      expect(readIsEnabled(`${said}\n`)).toBe(false);
    }
  });

  it("reads lingering as no unless the account says yes", () => {
    expect(readLinger("Linger=yes")).toBe(true);
    for (const said of ["Linger=no", "", "Failed to connect to bus", "Linger=maybe"]) {
      expect(readLinger(said)).toBe(false);
    }
  });

  it("under-claims when one agent is arranged and another is not", () => {
    // The direction matters and is the whole argument: a server half arranged
    // must not print "this server starts your agents when it reboots" over the
    // agent that stays stopped.
    expect(hostServiceReduction(["enabled", "not_written"])).toBe("not_written");
    expect(hostServiceReduction(["enabled", "disabled"])).toBe("disabled");
    expect(hostServiceReduction(["enabled", "enabled"])).toBe("enabled");
    expect(hostServiceReduction([])).toBe("not_written");
  });

  it("has its own sentence for each of the three, and a fourth for a boot that will not happen", () => {
    const seen = new Set<string>();
    for (const state of ["not_written", "enabled", "disabled"] satisfies HostServiceState[]) {
      const copy = describeResidency(state, true);
      expect(copy.headline.length).toBeGreaterThan(0);
      expect(seen.has(copy.headline)).toBe(false);
      seen.add(copy.headline);
      expectPlainLanguage([copy.headline, copy.detail]);
    }
    /*
     * The fourth: an entry the service manager will act on, on an account whose
     * programs only run while somebody is signed in. It is not a fourth *state*
     * — the entry is enabled — and it must not be drawn as one, but a card that
     * printed the `enabled` sentence over it would be claiming a reboot that
     * does nothing, which is the exact class of lie ADR 0030 decision 2 added
     * the `approved` bit to prevent.
     */
    expect(describeResidency("enabled", false).headline).not.toBe(
      describeResidency("enabled", true).headline,
    );
    expectPlainLanguage([
      describeResidency("enabled", false).headline,
      describeResidency("enabled", false).detail,
    ]);
  });

  it("says what is true with it off as well as with it on", () => {
    expect(RESIDENCY_COPY.liveness_off.length).toBeGreaterThan(0);
    expectPlainLanguage([...RESIDENCY_COPY.liveness_on, ...RESIDENCY_COPY.liveness_off]);
  });

  it("keeps ADR 0029 decision 7's missed-window sentence beside the switch", () => {
    // Turning this on does not backfill. The page says so where somebody reads
    // it, because the switch is precisely the thing that makes a person assume
    // otherwise.
    expect(RESIDENCY_COPY.liveness_on.some((line) => /missed/i.test(line))).toBe(true);
  });

  it("says that a scheduled run on a server cannot pay for a model call", () => {
    /*
     * ADR 0029 amendment 1's fourth sentence, one machine over and sharper: the
     * host broker's spend allowance is opened by a Run press on that host, and a
     * schedule is the case where nobody pressed anything. The residency proposal
     * §7 scoped unattended host spend into its own packet, so until that lands
     * this feature makes agents run on a server and not think there.
     */
    expect(RESIDENCY_COPY.liveness_on.some((line) => /cannot reach your model/i.test(line))).toBe(
      true,
    );
  });

  it("is off until pressed, and says so before the press", () => {
    expect(RESIDENCY_COPY.opt_in).toMatch(/off until you turn it on/i);
    expectPlainLanguage([RESIDENCY_COPY.opt_in, RESIDENCY_COPY.toggle.label, RESIDENCY_COPY.toggle.detail]);
  });

  it("prints removal instructions somebody can run with DASH already gone", () => {
    const lines = describeResidencyRemoval("orchestratedash-news.service");
    expect(lines).toEqual([
      "systemctl --user disable orchestratedash-news.service",
      "rm ~/.config/systemd/user/orchestratedash-news.service",
    ]);
  });

  it("says when the server was last told, and says nothing when it never was", () => {
    expect(describeSchedulesTold(0, null)).toMatch(/not told this server/i);
    expect(describeSchedulesTold(0, "25 August 2026")).toMatch(/nothing scheduled/i);
    expect(describeSchedulesTold(1, "25 August 2026")).toContain("1 scheduled time");
    expect(describeSchedulesTold(2, "25 August 2026")).toContain("2 scheduled times");
  });

  it("reads a report off the command channel, or refuses to invent one", () => {
    expect(
      readHostServiceReport({
        state: "enabled",
        starts_at_boot: true,
        units: [{ name: "orchestratedash-news.service" }],
      }),
    ).toEqual({
      state: "enabled",
      starts_at_boot: true,
      units: ["orchestratedash-news.service"],
    });
    // A state this module did not write must not reach `describeResidency`'s
    // exhaustive switch as a fourth member.
    expect(readHostServiceReport({ state: "running" })).toBeNull();
    expect(readHostServiceReport(null)).toBeNull();
    expect(readHostServiceReport("enabled")).toBeNull();
  });
});

/* ---------------------------------------------------------------------- *
 * The routes
 * ---------------------------------------------------------------------- */

describe("the standing set crosses, and the broker still does not", () => {
  it("admits the push and the drain to both channels", () => {
    // `EVIDENCE_ROUTES` is the parameter of both `RemoteRunnerChannel` and
    // `LocalRunnerChannel`, so adding here is this module's own rule — a route
    // is added to both channels or to neither — enforced by construction.
    expect(EVIDENCE_ROUTES).toContain("/schedules");
    expect(EVIDENCE_ROUTES).toContain("/schedules/drain");
  });

  it("still refuses the two routes ADR 0006 keeps on this machine", async () => {
    for (const route of [...BROKER_ROUTES, ...BROWSER_ROUTES]) {
      expect(EVIDENCE_ROUTES).not.toContain(route);
    }
    const channel = remoteRunnerChannel({
      token: "not-a-real-token",
      dial: () => Promise.reject(new Error("a refused route must never reach the dialer")),
    });
    await expect(
      channel.call("/broker/drain" as unknown as "/schedules", { method: "POST" }),
    ).rejects.toBeInstanceOf(RemoteRouteRefused);
  });

  it("lets a host be pushed to over a dialer that never leaves this test", async () => {
    const seen: string[] = [];
    const channel = remoteRunnerChannel({
      token: "session-secret",
      dial: (url) => {
        seen.push(String(url));
        return Promise.resolve(new Response("{}", { status: 200 }));
      },
    });
    await channel.call("/schedules", { method: "POST", body: "{}" });
    await channel.call("/schedules/drain", { method: "POST" });
    expect(seen.map((url) => new URL(url).pathname)).toEqual(["/schedules", "/schedules/drain"]);
  });
});

/* ---------------------------------------------------------------------- *
 * One instruction, one runner
 * ---------------------------------------------------------------------- */

const DAILY: AgentSchedule = {
  agent: "ai-agent-news",
  enabled: true,
  kind: "daily",
  at_local: "08:00",
  created_at: "2026-08-25T06:00:00.000Z",
  allowance_calls: 0,
};
const LOCAL_ONLY: AgentSchedule = { ...DAILY, agent: "folder-watcher" };

describe("which runner honours a schedule", () => {
  const resident: ResidentHost[] = [{ host_id: "host-1", agents: ["ai-agent-news"] }];

  it("gives a resident server's agent to that server and nobody else", () => {
    const split = splitSchedules([DAILY, LOCAL_ONLY], resident);
    expect(split.local.map((one) => one.agent)).toEqual(["folder-watcher"]);
    expect(split.byHost.get("host-1")?.map((one) => one.agent)).toEqual(["ai-agent-news"]);
  });

  it("changes nothing at all for a server residency is off for", () => {
    // The whole set stays local, which is every server until somebody presses
    // the switch — so this rule cannot break a schedule that works today.
    const split = splitSchedules([DAILY, LOCAL_ONLY], []);
    expect(split.local).toHaveLength(2);
    expect(split.byHost.size).toBe(0);
  });

  it("puts every schedule in exactly one place", () => {
    const split = splitSchedules([DAILY, LOCAL_ONLY], resident);
    const everywhere = [...split.local, ...[...split.byHost.values()].flat()].map(
      (one) => one.agent,
    );
    expect(everywhere.sort()).toEqual(["ai-agent-news", "folder-watcher"]);
    expect(new Set(everywhere).size).toBe(everywhere.length);
  });

  it("carries a disabled schedule to the server rather than dropping it", () => {
    // `configure` replaces rather than merges, so an instruction being withdrawn
    // only reaches a machine as a set that no longer enables it. A disabled row
    // dropped from the push would leave a server honouring last week's version
    // across every reboot.
    const withdrawn: AgentSchedule = { ...DAILY, enabled: false };
    expect(splitSchedules([withdrawn], resident).byHost.get("host-1")).toEqual([withdrawn]);
  });

  it("narrows the cursor to the agents that runner was told about", () => {
    const since = { "ai-agent-news": "2026-08-24T06:00:00.000Z", "folder-watcher": "x" };
    expect(windowsFor(since, [DAILY])).toEqual({
      "ai-agent-news": "2026-08-24T06:00:00.000Z",
    });
    expect(windowsFor({}, [DAILY])).toEqual({});
  });

  it("names an agent that sits on two resident servers rather than silently picking one", () => {
    const two: ResidentHost[] = [
      { host_id: "host-1", agents: ["ai-agent-news"] },
      { host_id: "host-2", agents: ["ai-agent-news"] },
    ];
    expect(delegationConflicts(two)).toEqual(["ai-agent-news"]);
    expect(delegationConflicts(resident)).toEqual([]);
    // And it still goes somewhere: an agent that ran nowhere would be worse than
    // one that ran twice, and much harder to notice.
    expect(splitSchedules([DAILY], two).byHost.get("host-1")).toHaveLength(1);
  });
});

/* ---------------------------------------------------------------------- *
 * What a rebooted host comes back holding
 * ---------------------------------------------------------------------- */

function scratchStore(): RunnerStore {
  const store = openHealthyRunnerStore(freshDir("runner"));
  stores.push(store);
  return store;
}

function schedulerOver(store: RunnerStore, log: string[] = []): RunnerSchedule {
  return new RunnerSchedule({
    database: () => store.database,
    supervisor: new Proxy({} as Supervisor, {
      get() {
        throw new Error("these tests must not reach the supervisor");
      },
    }),
    log: (line) => log.push(line),
  });
}

describe("the standing set on a host that rebooted", () => {
  it("is written on every push, not only when something changed", () => {
    /*
     * ADR 0030 decision 5's argument, and the reason it matters more on a server
     * than on a laptop: a comparison is a closed statement about which fields
     * matter, and a field added later that it did not learn about would stop
     * reaching the disk silently — visible only after a reboot, on a machine
     * nobody is looking at.
     */
    const store = scratchStore();
    const scheduler = schedulerOver(store);
    scheduler.configure({ schedules: [DAILY], since: {} });
    const first = store.database
      .prepare("SELECT received_at FROM schedule_standing WHERE id = 1")
      .get() as { received_at: string };

    scheduler.configure({ schedules: [DAILY], since: {} });
    const again = store.database
      .prepare("SELECT received_at, configuration FROM schedule_standing WHERE id = 1")
      .get() as { received_at: string; configuration: string };

    expect(JSON.parse(again.configuration)).toMatchObject({ schedules: [DAILY] });
    expect(again.received_at >= first.received_at).toBe(true);
    const rows = store.database.prepare("SELECT COUNT(*) AS n FROM schedule_standing").get() as {
      n: number;
    };
    expect(rows.n).toBe(1);
  });

  it("is read back before the first tick, by a process that was never pushed to", () => {
    const store = scratchStore();
    schedulerOver(store).configure({ schedules: [DAILY], since: {} });

    // The reboot, in the only form a unit test can stage it: a second scheduler
    // over the same store, having been told nothing.
    const afterReboot = schedulerOver(store);
    expect(afterReboot.describe()).toMatchObject({ schedules: 0 });
    expect(afterReboot.restore()).toBe(true);
    expect(afterReboot.describe()).toMatchObject({ schedules: 1, enabled: 1 });
  });

  it("discards a malformed row with a line in the log, and never throws", () => {
    const store = scratchStore();
    store.database
      .prepare("INSERT INTO schedule_standing (id, configuration, received_at) VALUES (1, ?, ?)")
      .run("{not json", "2026-08-25T20:00:00.000Z");

    const log: string[] = [];
    const scheduler = schedulerOver(store, log);
    expect(() => scheduler.restore()).not.toThrow();
    expect(scheduler.restore()).toBe(false);
    expect(log.join(" ")).toMatch(/standing schedules/i);
    // Left exactly as it was, which is the pre-residency runner.
    expect(scheduler.describe()).toMatchObject({ schedules: 0 });
  });

  it("refuses a row it would have refused off the channel", () => {
    // *"A set the runner would have refused from DASH is a set it refuses from
    // itself."* A row off this machine's own disk earns no more trust than a
    // body off the wire.
    const store = scratchStore();
    store.database
      .prepare("INSERT INTO schedule_standing (id, configuration, received_at) VALUES (1, ?, ?)")
      .run(JSON.stringify({ schedules: "not a list" }), "2026-08-25T20:00:00.000Z");

    const log: string[] = [];
    const scheduler = schedulerOver(store, log);
    expect(scheduler.restore()).toBe(false);
    expect(log.join(" ")).toMatch(/not understood/i);
  });

  it("is repaired by one push", () => {
    const store = scratchStore();
    store.database
      .prepare("INSERT INTO schedule_standing (id, configuration, received_at) VALUES (1, ?, ?)")
      .run("{not json", "2026-08-25T20:00:00.000Z");

    const scheduler = schedulerOver(store);
    expect(scheduler.restore()).toBe(false);
    scheduler.configure({ schedules: [DAILY], since: {} });

    const afterReboot = schedulerOver(store);
    expect(afterReboot.restore()).toBe(true);
    expect(afterReboot.describe()).toMatchObject({ schedules: 1 });
  });
});
