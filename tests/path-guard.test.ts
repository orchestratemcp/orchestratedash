/**
 * The path guard: every way of naming a file that is not allowed to be one.
 *
 * These are the checks MAR-434's acceptance criterion names — "traversal,
 * symlink/junction escape, oversized input/output, MIME mismatch,
 * replaced-after-selection input, spoofed agent/run identity, replayed handoff,
 * and undeclared artifact actions are rejected and audited" — and the reason
 * they are in a file of their own is that most of them are *Windows* rules
 * being executed on whatever CI happens to run.
 *
 * `runner/path-guard.ts` applies the Windows syntax rules unconditionally so
 * this suite can be the evidence for them. A check for `NUL` guarded by
 * `process.platform === "win32"` would be enforced only on the machine the
 * shell smoke runs on and proven nowhere, which is the shape of gap ADR 0004
 * exists to close.
 */

import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  containedIn,
  inspectComponent,
  inspectPathSyntax,
  isReservedDeviceName,
  resolveInsideWorkspace,
  resolveSelectedFile,
  sameIdentity,
} from "../runner/path-guard";

const scratch: string[] = [];

function tempDir(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "dash-guard-"));
  scratch.push(directory);
  return directory;
}

afterEach(() => {
  while (scratch.length > 0) {
    rmSync(scratch.pop() as string, { recursive: true, force: true });
  }
});

/** Both spellings, because the guard has to read a Windows path on Linux. */
const ABSOLUTE = process.platform === "win32" ? "C:\\work" : "/work";

describe("path syntax", () => {
  it("refuses a relative path outright", () => {
    expect(inspectPathSyntax("brief.docx")?.refusal).toBe("not_absolute");
    expect(inspectPathSyntax("")?.refusal).toBe("empty");
  });

  it("refuses traversal in either separator", () => {
    expect(inspectPathSyntax("/work/../etc/passwd")?.refusal).toBe("traversal");
    expect(inspectPathSyntax("C:\\work\\..\\Windows\\System32\\config\\SAM")?.refusal).toBe(
      "traversal",
    );
    // Mixed separators are a real thing on Windows and a real way to slip past a
    // check written for one of them.
    expect(inspectPathSyntax("C:\\work/../secrets")?.refusal).toBe("traversal");
  });

  it("refuses the Win32 device namespace and UNC shares", () => {
    expect(inspectPathSyntax("\\\\?\\C:\\work\\brief.docx")?.refusal).toBe("device_namespace");
    expect(inspectPathSyntax("\\\\.\\PhysicalDrive0")?.refusal).toBe("device_namespace");
    expect(inspectPathSyntax("\\\\fileserver\\share\\brief.docx")?.refusal).toBe("unc_path");
    expect(inspectPathSyntax("//fileserver/share/brief.docx")?.refusal).toBe("unc_path");
  });

  it("refuses a reserved device name at any depth, with any extension", () => {
    // The whole point: these are devices in every directory, not filenames that
    // happen to be taken in the root.
    expect(inspectPathSyntax("C:\\work\\customers\\NUL")?.refusal).toBe("reserved_device_name");
    expect(inspectPathSyntax("/work/nul.txt")?.refusal).toBe("reserved_device_name");
    expect(inspectPathSyntax("/work/COM1")?.refusal).toBe("reserved_device_name");
    expect(inspectPathSyntax("/work/LPT9.pdf")?.refusal).toBe("reserved_device_name");
    expect(inspectPathSyntax("/work/CONIN$")?.refusal).toBe("reserved_device_name");
    // A trailing dot is stripped by Win32 before the filesystem sees it, so
    // `NUL.` is the null device too.
    expect(isReservedDeviceName("NUL.")).toBe(true);
    expect(isReservedDeviceName("nul ")).toBe(true);
    // And a name that merely starts with one is an ordinary file.
    expect(isReservedDeviceName("NULLABLE.txt")).toBe(false);
    expect(isReservedDeviceName("COM.txt")).toBe(false);
  });

  it("refuses an alternate data stream", () => {
    expect(inspectPathSyntax("C:\\work\\offert.pdf:payload.exe")?.refusal).toBe(
      "alternate_data_stream",
    );
    // `::$DATA` names the file's own default stream, which is the same bytes
    // under a name a check written against the visible one would miss.
    expect(inspectPathSyntax("C:\\work\\offert.pdf::$DATA")?.refusal).toBe(
      "alternate_data_stream",
    );
    // The drive letter's colon is not one.
    expect(inspectPathSyntax("C:\\work\\offert.pdf")).toBeNull();
  });

  it("refuses a component ending in a dot or a space", () => {
    // Win32 strips both, so the string checked and the file opened differ.
    expect(inspectPathSyntax("C:\\work\\offert.pdf.")?.refusal).toBe("trailing_dot_or_space");
    expect(inspectPathSyntax("C:\\work\\offert.pdf ")?.refusal).toBe("trailing_dot_or_space");
    expect(inspectPathSyntax("C:\\work \\offert.pdf")?.refusal).toBe("trailing_dot_or_space");
  });

  it("refuses a NUL byte, which truncates a name inside the syscall", () => {
    expect(inspectPathSyntax("/work/brief.docx\u0000.exe")?.refusal).toBe("control_character");
  });

  it("accepts an ordinary absolute path", () => {
    expect(inspectPathSyntax(`${ABSOLUTE}${path.sep}kund${path.sep}offert.pdf`)).toBeNull();
  });
});

describe("component syntax", () => {
  it("refuses anything that is a path rather than a name", () => {
    expect(inspectComponent("sub/offert.pdf")?.refusal).toBe("not_a_single_component");
    expect(inspectComponent("sub\\offert.pdf")?.refusal).toBe("not_a_single_component");
    expect(inspectComponent("..")?.refusal).toBe("traversal");
    expect(inspectComponent("")?.refusal).toBe("empty");
  });

  it("applies the same device, stream and trailing rules", () => {
    expect(inspectComponent("NUL")?.refusal).toBe("reserved_device_name");
    expect(inspectComponent("offert.pdf:evil")?.refusal).toBe("alternate_data_stream");
    expect(inspectComponent("offert.pdf.")?.refusal).toBe("trailing_dot_or_space");
  });

  it("accepts an ordinary file name", () => {
    expect(inspectComponent("offert-2026-08.pdf")).toBeNull();
  });
});

describe("containment", () => {
  it("does not mistake a sibling prefix for a child", () => {
    // The bug a `startsWith` would have. `task-1-evil` is not inside `task-1`.
    expect(containedIn(path.join(ABSOLUTE, "task-1"), path.join(ABSOLUTE, "task-1-evil", "x"))).toBe(
      false,
    );
    expect(containedIn(path.join(ABSOLUTE, "task-1"), path.join(ABSOLUTE, "task-1", "x"))).toBe(true);
  });

  it("treats a root as containing itself", () => {
    expect(containedIn(ABSOLUTE, ABSOLUTE)).toBe(true);
  });
});

describe("selection", () => {
  it("resolves an ordinary file and reports an identity", () => {
    const directory = tempDir();
    const file = path.join(directory, "brief.docx");
    writeFileSync(file, "hello");

    const result = resolveSelectedFile(file);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.identity.size).toBe(5);
    // Identity is what the replacement check compares, so it must survive a
    // round trip through itself.
    expect(sameIdentity(result.identity, result.identity)).toBe(true);
  });

  it("refuses a directory", () => {
    const directory = tempDir();
    expect(resolveSelectedFile(directory)).toMatchObject({
      ok: false,
      problem: { refusal: "not_a_regular_file" },
    });
  });

  it("refuses a file that is a link to another file", () => {
    const directory = tempDir();
    const real = path.join(directory, "secret.txt");
    const link = path.join(directory, "brief.docx");
    writeFileSync(real, "not the file you picked");
    try {
      symlinkSync(real, link, "file");
    } catch {
      // Windows without Developer Mode refuses to create a symlink from an
      // unelevated process. Skipping is honest; the syntax rules above are the
      // half of this module CI can always execute.
      return;
    }

    // The deception this refusal exists for: DASH would show `brief.docx` and
    // its size while hashing and copying `secret.txt`.
    expect(resolveSelectedFile(link)).toMatchObject({
      ok: false,
      problem: { refusal: "symlink_or_junction" },
    });
  });

  it("refuses a path that does not exist", () => {
    expect(resolveSelectedFile(path.join(tempDir(), "nothing-here"))).toMatchObject({
      ok: false,
      problem: { refusal: "unreadable" },
    });
  });
});

describe("workspace resolution", () => {
  it("resolves a plain name inside the root", () => {
    const root = tempDir();
    writeFileSync(path.join(root, "offert.pdf"), "%PDF-1.7");
    const result = resolveInsideWorkspace(root, "offert.pdf");
    expect(result.ok).toBe(true);
  });

  it("refuses a name that walks out of the root", () => {
    const root = path.join(tempDir(), "outbox");
    mkdirSync(root);
    expect(resolveInsideWorkspace(root, "../escaped.pdf")).toMatchObject({
      ok: false,
      problem: { refusal: "not_a_single_component" },
    });
  });

  it("refuses a link inside the workspace even when it points at a real file", () => {
    const base = tempDir();
    const root = path.join(base, "outbox");
    mkdirSync(root);
    const outside = path.join(base, "elsewhere.txt");
    writeFileSync(outside, "bytes the agent does not own");
    try {
      symlinkSync(outside, path.join(root, "offert.pdf"), "file");
    } catch {
      return;
    }

    // This is the escape the strict guard exists for: a child cannot publish a
    // file it did not write by pointing at one.
    expect(resolveInsideWorkspace(root, "offert.pdf")).toMatchObject({
      ok: false,
      problem: { refusal: "symlink_or_junction" },
    });
  });

  /**
   * A junction, not a symlink, and the distinction is the whole test.
   *
   * Windows refuses `symlinkSync(…, "dir")` to an unelevated process without
   * Developer Mode, so a test written that way `catch`es and returns — passing
   * without executing anything, on the one platform these rules exist for. That
   * is what the first draft of this file did. A **junction** needs no privilege
   * at all, which makes it both the realistic attack and the case CI can run.
   *
   * On POSIX `symlinkSync(…, "junction")` is an ordinary directory symlink, so
   * one spelling covers both platforms and neither skips.
   */
  it("refuses a root that has been replaced by a junction", () => {
    const base = tempDir();
    const real = path.join(base, "elsewhere");
    const outbox = path.join(base, "workspaces", "task-1", "outbox");
    mkdirSync(real, { recursive: true });
    mkdirSync(path.join(base, "workspaces", "task-1"), { recursive: true });
    writeFileSync(path.join(real, "offert.pdf"), "%PDF-1.7");
    symlinkSync(real, outbox, "junction");

    // Without `base` this passes, and that is not a bug in the test: both sides
    // resolve through the junction, so the file genuinely is inside the
    // directory the root now points at. Containment is the wrong question once
    // the root itself has moved.
    expect(resolveInsideWorkspace(outbox, "offert.pdf").ok).toBe(true);

    // With `base`, the walk from the data directory down finds the junction
    // where a directory the runner created should be, and refuses. This is the
    // check that stops a child publishing the user's own documents as its
    // output by redirecting its outbox.
    expect(resolveInsideWorkspace(outbox, "offert.pdf", base)).toMatchObject({
      ok: false,
      problem: { refusal: "symlink_or_junction" },
    });
  });

  it("does not care about links above the data directory", () => {
    // A redirected %LOCALAPPDATA% or a macOS /tmp is the user's own layout, and
    // refusing to run there would be refusing to run on ordinary machines.
    const outer = tempDir();
    const realBase = path.join(outer, "real-data");
    const linkedBase = path.join(outer, "data");
    mkdirSync(path.join(realBase, "workspaces", "task-1", "outbox"), { recursive: true });
    writeFileSync(
      path.join(realBase, "workspaces", "task-1", "outbox", "offert.pdf"),
      "%PDF-1.7",
    );
    symlinkSync(realBase, linkedBase, "junction");

    const outbox = path.join(linkedBase, "workspaces", "task-1", "outbox");
    expect(resolveInsideWorkspace(outbox, "offert.pdf", linkedBase).ok).toBe(true);
  });

  it("refuses when a directory below the base was replaced by a file", () => {
    const base = tempDir();
    mkdirSync(path.join(base, "workspaces"), { recursive: true });
    writeFileSync(path.join(base, "workspaces", "task-1"), "not a directory");

    expect(resolveInsideWorkspace(path.join(base, "workspaces", "task-1"), "offert.pdf", base)).toMatchObject({
      ok: false,
      problem: { refusal: "not_a_regular_file" },
    });
  });
});
