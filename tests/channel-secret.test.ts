/**
 * The local channel credential and the ACL that protects it (MAR-430).
 *
 * Two halves, deliberately:
 *
 * 1. **The rule, as a pure function.** `assertSddlIsOwnerOnly` is exercised
 *    against SDDL strings written out by hand — including the exact descriptor
 *    Windows puts on a named pipe when nobody asks it not to. That case is the
 *    reason MAR-430 exists, and it runs on Linux CI where no named pipe does.
 * 2. **The real file**, on whichever platform the suite is running, so the
 *    `chmod` path and the `icacls` path each get exercised on their own turf.
 *
 * The credential itself is never asserted on beyond its shape. A test that
 * printed one on failure would put a secret in CI output, and this suite runs
 * on every push.
 */

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  channelSecretPath,
  ChannelSecretError,
  ensureChannelSecret,
  inspectAcl,
  windowsSystemTool,
} from "../runner/channel-secret";

const workDir = mkdtempSync(path.join(tmpdir(), "dash-secret-"));
const onWindows = process.platform === "win32";

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function freshDir(): string {
  return mkdtempSync(path.join(workDir, "data-"));
}

const OWNER = "S-1-5-21-1111111111-2222222222-3333333333-1001";

/* ---------------------------------------------------------------------- *
 * The rule
 * ---------------------------------------------------------------------- */

describe("inspectAcl", () => {
  it("accepts a protected DACL naming only the owner and SYSTEM", () => {
    expect(inspectAcl(`D:PAI(A;;FA;;;SY)(A;;FA;;;${OWNER})`, OWNER)).toEqual({ ok: true });
  });

  it("accepts Administrators without granting them", () => {
    // An administrator can take ownership of any file on the machine, so
    // refusing to run because they appear would be theatre. `/grant:r` still
    // does not put them there.
    expect(inspectAcl(`D:PAI(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;${OWNER})`, OWNER)).toEqual({
      ok: true,
    });
  });

  it("refuses the descriptor Windows puts on a named pipe by default", () => {
    // Measured on a real Node named pipe, not invented: `WD` is Everyone and
    // `AN` is Anonymous, both with FILE_GENERIC_READ. This single assertion is
    // the reason the channel secret exists at all.
    const pipeDefault = `D:(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;${OWNER})(A;;FR;;;WD)(A;;FR;;;AN)`;
    expect(inspectAcl(pipeDefault, OWNER)).toMatchObject({
      ok: false,
      problem: "acl_too_wide",
      foreign: ["WD", "AN"],
    });
  });

  it("refuses another local user, however narrow the grant", () => {
    const neighbour = "S-1-5-21-1111111111-2222222222-3333333333-1004";
    expect(
      inspectAcl(`D:PAI(A;;FA;;;SY)(A;;FA;;;${OWNER})(A;;0x1200a9;;;${neighbour})`, OWNER),
    ).toMatchObject({ ok: false, problem: "acl_too_wide", foreign: [neighbour] });
  });

  it("refuses an inherited DACL even when today's entries look right", () => {
    // Without `P` these ACEs are whatever the parent directory currently says,
    // and a parent's ACL is changed by things outside this app.
    expect(inspectAcl(`D:AI(A;;FA;;;SY)(A;;FA;;;${OWNER})`, OWNER)).toMatchObject({
      ok: false,
      problem: "acl_too_wide",
      detail: expect.stringContaining("still inherits") as unknown as string,
    });
  });

  it("names the removable trustees even when the DACL is also inherited", () => {
    // The repair pass in `hardenWindows` acts on `foreign`. Reporting the
    // inheritance flag first and stopping would leave it nothing to remove, and
    // the ACL would stay unprovable forever.
    const inspection = inspectAcl(`D:AI(A;;FA;;;${OWNER})(A;;FR;;;WD)`, OWNER);
    expect(inspection).toMatchObject({ ok: false, foreign: ["WD"] });
  });

  it("refuses a protected DACL that locks the owner out", () => {
    // Owner-only means "the owner and nothing else", not "nothing at all".
    // This is the descriptor MAR-434's proof 9 actually observed on CI: only
    // SYSTEM, the proof passing, and the runner locked out of its own task
    // directory 60ms later with an EPERM nothing had named.
    expect(inspectAcl("D:PAI(A;OICI;FA;;;SY)", OWNER)).toMatchObject({
      ok: false,
      problem: "acl_unprovable",
      detail: expect.stringContaining(OWNER) as unknown as string,
    });
  });

  it("refuses an owner grant that is less than full control", () => {
    // A workspace the owner can read but not write into is as locked as one
    // they cannot see; the runner creates files under these directories.
    expect(inspectAcl(`D:PAI(A;;FA;;;SY)(A;;FR;;;${OWNER})`, OWNER)).toMatchObject({
      ok: false,
      problem: "acl_unprovable",
    });
  });

  it("accepts the owner's full control spelled as a raw access mask", () => {
    // `icacls /save` writes what this module grants back as `FA`, but a rights
    // check should accept every spelling of the fact it checks.
    expect(inspectAcl(`D:PAI(A;;FA;;;SY)(A;;0x1f01ff;;;${OWNER})`, OWNER)).toEqual({ ok: true });
  });

  it("recognises a RID-500 owner when the readback abbreviates it to LA", () => {
    // `whoami` answers raw, but `icacls /save` writes the machine's own
    // built-in Administrator back as `LA`. GitHub-hosted Windows runners run
    // jobs as a renamed RID-500 account, and before this case existed the
    // repair pass read that readback as a stranger's grant, removed it, and
    // proved owner-only on the lockout it had just created (MAR-434, proof 9).
    const rid500 = "S-1-5-21-1178926710-2200278958-3596451971-500";
    expect(inspectAcl("D:PAI(A;;FA;;;SY)(A;;FA;;;LA)", rid500)).toEqual({ ok: true });
  });

  it("still treats LA as foreign when the caller is not the RID-500 account", () => {
    // The alias is a spelling of one specific principal, not a courtesy to
    // local administrators in general.
    expect(inspectAcl(`D:PAI(A;;FA;;;SY)(A;;FA;;;LA)(A;;FA;;;${OWNER})`, OWNER)).toMatchObject({
      ok: false,
      problem: "acl_too_wide",
      foreign: ["LA"],
    });
  });

  it("recognises a RID-501 owner when the readback abbreviates it to LG", () => {
    const rid501 = "S-1-5-21-1178926710-2200278958-3596451971-501";
    expect(inspectAcl("D:PAI(A;;FA;;;SY)(A;;FA;;;LG)", rid501)).toEqual({ ok: true });
  });

  it("refuses a descriptor it cannot find a DACL in", () => {
    expect(inspectAcl("O:BAG:BA", OWNER)).toMatchObject({
      ok: false,
      problem: "acl_unprovable",
    });
  });

  it("treats a deny ACE as something to remove rather than something to trust", () => {
    expect(inspectAcl(`D:P(D;;FA;;;WD)(A;;FA;;;${OWNER})`, OWNER)).toMatchObject({
      ok: false,
      foreign: ["WD"],
    });
  });

  it("refuses an ACE type it does not understand", () => {
    // An audit ACE belongs in a SACL. One here is a descriptor this module did
    // not write and cannot vouch for, and there is nothing safe to remove.
    expect(inspectAcl(`D:P(AU;;FA;;;WD)(A;;FA;;;${OWNER})`, OWNER)).toMatchObject({
      ok: false,
      problem: "acl_unprovable",
      foreign: [],
    });
  });
});

/* ---------------------------------------------------------------------- *
 * The file
 * ---------------------------------------------------------------------- */

describe("ensureChannelSecret", () => {
  it("mints a credential on first use and returns the same one after", () => {
    const dataDir = freshDir();
    const first = ensureChannelSecret(dataDir);
    const second = ensureChannelSecret(dataDir);

    expect(first).toBe(second);
    // base64url, 32 bytes. Asserted on shape, never printed.
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("writes it beside runner.json and not into it", () => {
    // `runner.json` is readable by every process on the machine and says so in
    // its own doc comment. The credential must not be in it.
    const dataDir = freshDir();
    const secret = ensureChannelSecret(dataDir);
    expect(channelSecretPath(dataDir)).toBe(path.join(dataDir, "runner.key"));
    expect(readFileSync(channelSecretPath(dataDir), "utf8")).toContain(secret);
  });

  it("refuses a file that is not a credential this runner wrote", () => {
    const dataDir = freshDir();
    writeFileSync(channelSecretPath(dataDir), "hunter2\n", "utf8");
    expect(() => ensureChannelSecret(dataDir)).toThrow(/does not contain a channel secret/);
  });

  it("does not quote the stored value into the refusal", () => {
    // The message reaches a log. A malformed secret is still a secret.
    const dataDir = freshDir();
    writeFileSync(channelSecretPath(dataDir), "sk-live-not-a-real-secret\n", "utf8");
    expect(() => ensureChannelSecret(dataDir)).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining("sk-live-not-a-real-secret") as unknown as string,
      }),
    );
  });

  it.skipIf(onWindows)("stores it mode 0600 on POSIX", () => {
    const dataDir = freshDir();
    ensureChannelSecret(dataDir);
    const mode = statSync(channelSecretPath(dataDir)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it.skipIf(!onWindows)("stores it under a protected, owner-only DACL on Windows", () => {
    const dataDir = freshDir();
    ensureChannelSecret(dataDir);

    const scratch = mkdtempSync(path.join(workDir, "acl-"));
    const dump = path.join(scratch, "acl.sddl");
    execFileSync("icacls", [channelSecretPath(dataDir), "/save", dump], {
      stdio: "pipe",
      windowsHide: true,
    });
    const sddl = readFileSync(dump, "utf16le");

    // Protected, and carrying neither of the two principals a named pipe's
    // default descriptor hands out.
    expect(sddl).toMatch(/D:P/);
    expect(sddl).not.toMatch(/;WD\)/);
    expect(sddl).not.toMatch(/;AN\)/);
  });

  it.skipIf(!onWindows)("re-narrows an ACL that was widened after it was written", () => {
    // The ACL is applied and verified on *every* call, not only on the one that
    // created the file. An ACL that was right once is a property of a file at a
    // moment, and the moment that matters is this one.
    const dataDir = freshDir();
    const secret = ensureChannelSecret(dataDir);
    const file = channelSecretPath(dataDir);

    execFileSync("icacls", [file, "/grant", "*S-1-1-0:R"], { stdio: "pipe", windowsHide: true });
    expect(ensureChannelSecret(dataDir)).toBe(secret);

    const scratch = mkdtempSync(path.join(workDir, "acl-rehardened-"));
    const dump = path.join(scratch, "acl.sddl");
    execFileSync("icacls", [file, "/save", dump], { stdio: "pipe", windowsHide: true });
    expect(readFileSync(dump, "utf16le")).not.toMatch(/;WD\)/);
  });
});

/* ---------------------------------------------------------------------- *
 * Whose `whoami` (MAR-601)
 * ---------------------------------------------------------------------- */

/**
 * The crash the remedy for MAR-600 caused, and why it is this file's problem.
 *
 * `whoami /user /fo csv /nh` and `icacls /inheritance:r` are Microsoft's
 * argument spellings, so resolving those two names through the system search
 * path is not "finding the tool" — it is accepting whichever program of that
 * name a user's path reaches first. On 2026-08-10 that was GNU coreutils'
 * `whoami` from Git for Windows, put in front by a person following the only
 * remedy MAR-600 leaves them, and DASH died on the Confirm-fingerprint press:
 *
 * ```
 * Error invoking remote method 'dash:shell-command': ChannelSecretError:
 * The runner could not determine its own user SID: Command failed: whoami /user /fo csv /nh
 * whoami: extra operand '/user'
 * ```
 *
 * Two defects in one overlay, and each gets a test: DASH ran the wrong binary,
 * and when that failed it showed a person a command line they never typed.
 */
describe("the Windows tools this file depends on by name", () => {
  const SYSTEM_ROOT = process.env["SystemRoot"] ?? "C:\\WINDOWS";

  it.skipIf(!onWindows)("addresses Windows' own copy rather than one from the path", () => {
    const resolved = windowsSystemTool("whoami.exe");
    expect(resolved).toBe(path.join(SYSTEM_ROOT, "System32", "whoami.exe"));
    expect(existsSync(resolved)).toBe(true);
  });

  it.skipIf(onWindows)("asks for nothing special anywhere else", () => {
    expect(windowsSystemTool("whoami.exe")).toBe("whoami.exe");
  });

  it.skipIf(!onWindows)("still works with a hostile whoami first on the path", () => {
    /*
     * The reproduction, without needing Git for Windows installed: any program
     * that rejects those arguments will do, and `where.exe` rejects them
     * immediately and cannot be made to wait for input. Before MAR-601 this made
     * `ensureChannelSecret` throw; now the shadowing copy is never consulted.
     */
    const shadow = mkdtempSync(path.join(workDir, "shadow-path-"));
    copyFileSync(
      path.join(SYSTEM_ROOT, "System32", "where.exe"),
      path.join(shadow, "whoami.exe"),
    );

    const realPath = process.env["PATH"];
    process.env["PATH"] = `${shadow};${realPath ?? ""}`;
    try {
      expect(ensureChannelSecret(freshDir())).toMatch(/^[A-Za-z0-9_-]{43}$/);
    } finally {
      process.env["PATH"] = realPath;
    }
  }, 60_000);

  it.skipIf(!onWindows)("says something a person can act on when it does fail", () => {
    /*
     * The second defect. `SystemRoot` is pointed at a tree whose `whoami.exe`
     * rejects the arguments, which is the only way left to reach this branch —
     * and what a person is shown must be a sentence about their computer rather
     * than the failed command line. The technical text is not lost; it moves off
     * the message and onto the error, and into this machine's log.
     */
    const fakeRoot = mkdtempSync(path.join(workDir, "fake-root-"));
    mkdirSync(path.join(fakeRoot, "System32"), { recursive: true });
    copyFileSync(
      path.join(SYSTEM_ROOT, "System32", "where.exe"),
      path.join(fakeRoot, "System32", "whoami.exe"),
    );

    const realRoot = process.env["SystemRoot"];
    process.env["SystemRoot"] = fakeRoot;
    let thrown: unknown;
    try {
      ensureChannelSecret(freshDir());
    } catch (error: unknown) {
      thrown = error;
    } finally {
      process.env["SystemRoot"] = realRoot;
    }

    expect(thrown).toBeInstanceOf(ChannelSecretError);
    const error = thrown as ChannelSecretError;
    expect(error.message).toContain("DASH could not confirm which Windows account");
    // None of what the overlay used to read out. A person who has never typed
    // `/fo csv /nh` can do nothing at all with it.
    for (const machinery of ["Command failed", "/fo", "/nh", "whoami", "SID"]) {
      expect(error.message).not.toContain(machinery);
    }
    expect(error.diagnostic).not.toBeNull();
  }, 60_000);
});
