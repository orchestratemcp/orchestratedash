/**
 * What the operating system is actually handed when a scaffold says "open in
 * DASH" (MAR-655).
 *
 * The bug this file exists for could not have been caught by any test of the old
 * shape. `openUrl` spawned and unreffed, so the only observable was that it
 * returned; meanwhile `cmd.exe` was splitting the handoff URL at every `&` and
 * DASH was being handed `dash://handoff?v=1` with no `file` and no `nonce`. It
 * refused, correctly, and the refusal read as a DASH bug. Every agent scaffolded
 * with `create-dash-agent` hit it, on the exact three commands the Agent Kit's
 * README tells a new developer to run.
 *
 * So there are two assertions here and they are deliberately different in kind:
 *
 * 1. the argument vector is decided by a pure function, checked on all three
 *    platforms from whichever one is running — the bug was Windows-only, and a
 *    test that only runs on Windows is a test that does not run in CI;
 * 2. a **real child process** is spawned with that vector and reports back what
 *    it received, which is the property the old code had no way to state.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { openCommand } from "../agent-kit/open-in-dash";

/**
 * A handoff URL with every character that broke something.
 *
 * `&` is what cmd split on. `%` is what cmd would have expanded next — a
 * percent-encoded Windows path is full of `%3A` and `%5C`. `?` and `=` are along
 * for the ride. Shaped like the real thing rather than minimal, because the real
 * thing is what nobody tested.
 */
const URL_UNDER_TEST =
  "dash://handoff?v=1&file=C%3A%5CUsers%5Chenri%5Cscout%5Cdash-handoff.json&nonce=" +
  "a3f9".repeat(16);

/** Anything with a command-line parser between us and `CreateProcess`. */
const SHELLS = ["cmd", "cmd.exe", "powershell", "powershell.exe", "pwsh", "sh", "bash", "zsh"];

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("openCommand", () => {
  it("does not put a shell between the URL and the OS on any platform", () => {
    for (const platform of ["win32", "darwin", "linux"] as const) {
      const { command } = openCommand(URL_UNDER_TEST, platform);
      expect(SHELLS).not.toContain(command.toLowerCase());
    }
  });

  it("passes the URL as one intact argument, on every platform", () => {
    for (const platform of ["win32", "darwin", "linux"] as const) {
      const { args } = openCommand(URL_UNDER_TEST, platform);
      // Exactly one argument *is* the URL — not a prefix of one, not two halves.
      // `cmd /c start "" <url>` satisfied this too, which is why the child-process
      // assertion below exists as well.
      expect(args.filter((argument) => argument === URL_UNDER_TEST)).toHaveLength(1);
      expect(args[args.length - 1]).toBe(URL_UNDER_TEST);
    }
  });

  it("asks Windows to ShellExecute the link rather than to run a command", () => {
    // The regression, named. `start` was only ever wanted for its ShellExecute
    // behaviour; cmd was incidental to that and was the whole defect.
    expect(openCommand(URL_UNDER_TEST, "win32")).toEqual({
      command: "rundll32",
      args: ["url.dll,FileProtocolHandler", URL_UNDER_TEST],
    });
  });
});

describe("the argument a real child process receives", () => {
  it("is the whole URL, byte for byte", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "dash-open-url-"));
    roots.push(root);
    const received = path.join(root, "received.txt");

    // The child stands in for `rundll32`: what is being proved is that this
    // platform's `spawn` — no shell, no quoting rules of our own — delivers the
    // URL to a real process unaltered. Under the old code on Windows the child
    // was `cmd`, and it did not.
    const child = spawn(
      process.execPath,
      ["-e", "require('node:fs').writeFileSync(process.argv[1], process.argv[2])", received, URL_UNDER_TEST],
      { stdio: "ignore" },
    );

    // Awaited rather than unreffed: the real `openUrl` detaches, but a test that
    // detached would race its own cleanup — and an `rmSync` racing a live child
    // is an EPERM that looks like something else entirely.
    const code = await new Promise<number | null>((resolve) => {
      child.on("exit", resolve);
    });

    expect(code).toBe(0);
    expect(readFileSync(received, "utf8")).toBe(URL_UNDER_TEST);
  });
});
