/**
 * The one thing a person pastes into a brand-new server (MAR-573).
 *
 * This file is the whole CI story for the bootstrap, and it is worth being
 * honest about what that is and is not. Nothing here runs a shell, so nothing
 * here proves the script *works* — ADR 0004's point exactly, and MAR-573's
 * fourth acceptance bar is an attended re-probe on a genuinely fresh host for
 * that reason.
 *
 * What these assertions do cover is the class of failure that produced this
 * issue's own findings: text composed on Windows arriving somewhere it cannot
 * run, a value reaching a shell that should never have been allowed near one,
 * and a promise on screen that the script does not keep.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  BOOTSTRAP_NODE_VERSION,
  HOST_INSTALL_ROOT,
  MINIMUM_NODE_VERSION,
  authorizedKeysLine,
  buildBootstrapScript,
  describeBootstrap,
} from "../lib/host-bootstrap";
import { expectPlainLanguage } from "./helpers/plain-language";

const PUBLIC_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEzfw+6qmw2XISBRAMGf2Gt1/sClsgY5tduInO/HiZtR orchestratedash";
/** Stands in for the helper artifact. Its content does not matter; its shape does. */
const HELPER_BASE64 = Buffer.from("console.log('helper')\n").toString("base64");
const HELPER_SHA256 = "b".repeat(64);

function build(overrides: Partial<Parameters<typeof buildBootstrapScript>[0]> = {}): string {
  const built = buildBootstrapScript({
    public_key: PUBLIC_KEY,
    username: "root",
    helper_base64: HELPER_BASE64,
    helper_sha256: HELPER_SHA256,
    ...overrides,
  });
  if (!built.ok) {
    throw new Error(`expected a script, got ${built.problem}`);
  }
  return built.script;
}

describe("buildBootstrapScript", () => {
  it("carries no carriage return anywhere in it", () => {
    /*
     * The 2026-08-08 run's fourth finding, as an assertion.
     *
     * A script shipped from a Windows DASH arrived with CRLF and the host's
     * shell answered `$'\r': command not found`. Every mitigation inside the
     * script is for text that already went wrong somewhere else; this is the
     * one that keeps it from going wrong here, which is the only place this
     * repository controls.
     */
    expect(build()).not.toContain("\r");
  });

  it("decodes the embedded helper through a filter that survives one anyway", () => {
    // Because this is the one place a stray carriage return would corrupt bytes
    // silently instead of failing loudly: base64 would decode to something
    // else, and the digest check below is what would notice.
    expect(build()).toContain("tr -d '\\r'");
  });

  it("says what it will install and what it leaves behind, before it does any of it", () => {
    const script = build();
    const described = describeBootstrap();
    const firstAction = script.indexOf("DASH_SUDO");

    for (const promise of [...described.installs, ...described.leaves_behind]) {
      const at = script.indexOf(promise.slice(0, 40));
      expect(at, `the script never says: ${promise}`).toBeGreaterThan(-1);
      // MAR-573's second acceptance bar is not "says", it is "says *before*".
      expect(at).toBeLessThan(firstAction);
    }
    expect(script).toContain(described.removal);
  });

  it("authorises DASH's key to run one program and nothing else", () => {
    const line = authorizedKeysLine(PUBLIC_KEY);

    // ADR 0009's decision, as a string. `command=` makes sshd run the helper
    // whatever the client asked for, and `restrict` turns off the forwarding,
    // agent and pty routes by which a forced-command key can still be used for
    // something else.
    expect(line.startsWith(`restrict,command="${HOST_INSTALL_ROOT}/dash-host" `)).toBe(true);
    expect(line.endsWith(PUBLIC_KEY)).toBe(true);
    expect(build()).toContain(line);
  });

  it("uses a Node the runner can actually run, and reuses one that is new enough", () => {
    const script = build();
    // `node:sqlite` is why the floor is 22.5.0 and why Ubuntu 24.04's own
    // package will not do. The same install serves the helper and the runner
    // it later starts, which is what makes one download enough.
    expect(script).toContain(`DASH_NODE_VERSION="${BOOTSTRAP_NODE_VERSION}"`);
    expect(script).toContain(`DASH_NODE_MINIMUM="${MINIMUM_NODE_VERSION}"`);
    expect(script).toContain("sort -V");
    expect(script).toContain("SHASUMS256.txt");
  });

  it("checks the helper on the host against the digest DASH computed", () => {
    const script = build();
    expect(script).toContain(`DASH_HELPER_SHA256="${HELPER_SHA256}"`);
    expect(script).toContain("sha256sum");
  });

  it("replaces its own previous line rather than stacking another one", () => {
    // The other half of MAR-572's resumability. Running the setup twice after a
    // failed attempt left the 2026-08-08 host with lines nobody could account
    // for; a second run must leave exactly one.
    expect(build()).toContain("grep -F -v");
  });

  it("refuses a value it does not recognise rather than quoting it", () => {
    /*
     * The important refusals, and they are an allowlist rather than an escaper.
     * A shell has more ways to be surprised than a quoting function has cases,
     * so the rule is the one `lib/hosts.ts` applies to ssh argv: admit only
     * what cannot mean anything, and refuse the rest outright.
     */
    for (const key of [
      'ssh-ed25519 AAAA" ; rm -rf / ; echo "',
      "ssh-ed25519 AAAA$(whoami)",
      "ssh-ed25519 AAAA\nssh-ed25519 BBBB",
      "ssh-rsa AAAAB3NzaC1yc2E",
    ]) {
      expect(buildBootstrapScript({
        public_key: key,
        username: "root",
        helper_base64: HELPER_BASE64,
        helper_sha256: HELPER_SHA256,
      })).toMatchObject({ ok: false, problem: "malformed_public_key" });
    }

    for (const username of ["root; rm -rf /", "-oProxyCommand=x", "Root", ""]) {
      expect(buildBootstrapScript({
        public_key: PUBLIC_KEY,
        username,
        helper_base64: HELPER_BASE64,
        helper_sha256: HELPER_SHA256,
      })).toMatchObject({ ok: false, problem: "malformed_username" });
    }

    expect(buildBootstrapScript({
      public_key: PUBLIC_KEY,
      username: "root",
      helper_base64: "not base64!",
      helper_sha256: HELPER_SHA256,
    })).toMatchObject({ ok: false, problem: "malformed_helper" });

    expect(buildBootstrapScript({
      public_key: PUBLIC_KEY,
      username: "root",
      helper_base64: HELPER_BASE64,
      helper_sha256: HELPER_SHA256,
      node_version: "24; rm -rf /",
    })).toMatchObject({ ok: false, problem: "malformed_version" });
  });

  it("never puts the private half of anything into the text", () => {
    const script = build();
    expect(script).not.toContain("PRIVATE KEY");
    // The account is named because the allowed-keys file belongs to it. No
    // path on *this* machine appears: everything absolute in the script is a
    // location on the server.
    expect(script).not.toMatch(/[A-Z]:\\/);
  });
});

/**
 * A real shell reads it, on the platform that has one.
 *
 * `sh -n` parses without executing, so this is a syntax check and nothing more
 * — it cannot say the script does the right thing, only that a shell can read
 * it at all. That turns out to be exactly the class of mistake a generator
 * composing shell from TypeScript makes: an unbalanced quote in a here-string,
 * a `fi` that never arrived, a `$` that means something it should not.
 *
 * CI's `verify` job runs on Ubuntu, where `/bin/sh` is `dash` — the same shell
 * this script will meet on the host it was written for. On a Windows dev
 * machine it skips rather than pretending, which is `probeSshTools`'s honesty
 * about a missing binary applied to a test.
 */
describe("the script a shell will actually read", () => {
  const shell = posixShell();

  it.skipIf(shell === null)("parses under a POSIX shell", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "dash-bootstrap-"));
    const file = path.join(directory, "setup.sh");
    // Written as bytes with no newline translation, which is the same property
    // the no-carriage-return assertion above is about.
    writeFileSync(file, build(), { encoding: "utf8" });
    expect(() =>
      execFileSync(shell as string, ["-n", file], { stdio: "pipe", windowsHide: true }),
    ).not.toThrow();
  });

  it.skipIf(shell === null)("keeps the quotes sshd needs around the forced command", () => {
    /*
     * A syntax check would not have caught this, and did not.
     *
     * The allowed-keys line contains double quotes of its own, and the first
     * version of this generator wrote it inside double quotes. The shell parsed
     * that happily and silently produced `command=/opt/…` with the quotes
     * eaten — which `sshd` does not accept as an option, so it would have
     * rejected DASH's key on a server somebody had just finished setting up,
     * with the wizard reporting a refused sign-in and nothing to point at.
     *
     * So the assertion is not "the text appears in the script" — it did — but
     * "a shell that reads the script ends up holding the right string".
     */
    const assignment = build()
      .split("\n")
      .find((line) => line.startsWith("DASH_AUTH_LINE="));
    expect(assignment).toBeDefined();

    const evaluated = execFileSync(
      shell as string,
      ["-c", `${assignment as string}\nprintf '%s' "$DASH_AUTH_LINE"`],
      { encoding: "utf8", stdio: "pipe", windowsHide: true },
    );
    expect(evaluated).toBe(authorizedKeysLine(PUBLIC_KEY));
    expect(evaluated).toContain(`command="${HOST_INSTALL_ROOT}/dash-host"`);
  });
});

function posixShell(): string | null {
  for (const candidate of ["/bin/sh", "sh"]) {
    try {
      execFileSync(candidate, ["-c", "exit 0"], { stdio: "ignore", windowsHide: true });
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

describe("describeBootstrap", () => {
  it("is plain language, because a surface shows it beside the snippet", () => {
    const described = describeBootstrap();
    // The folder path is content — it is the exact thing somebody would delete —
    // so it is allowed by name rather than by a rule that guesses.
    expectPlainLanguage([...described.needs, ...described.installs, ...described.leaves_behind], {
      allow: [HOST_INSTALL_ROOT],
    });
  });
});
