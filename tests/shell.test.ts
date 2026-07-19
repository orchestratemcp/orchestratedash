import { describe, expect, it } from "vitest";
import {
  COMMANDS,
  SHELL_COMMAND_CHANNEL,
  executeCommand,
  formatAuditLine,
  isCommandName,
  reviewCommand,
} from "../lib/shell/ipc";
import {
  SHELL_WEB_PREFERENCES,
  assertHardenedWebPreferences,
  isAllowedRendererUrl,
} from "../lib/shell/window";

describe("renderer security posture", () => {
  /**
   * ADR 0001 calls these a standing obligation. Asserted as literal values
   * rather than by comparing the constant to itself, so that editing
   * SHELL_WEB_PREFERENCES cannot edit its own test.
   */
  it("ships contextIsolation on and nodeIntegration off", () => {
    expect(SHELL_WEB_PREFERENCES.contextIsolation).toBe(true);
    expect(SHELL_WEB_PREFERENCES.nodeIntegration).toBe(false);
    expect(SHELL_WEB_PREFERENCES.nodeIntegrationInWorker).toBe(false);
    expect(SHELL_WEB_PREFERENCES.nodeIntegrationInSubFrames).toBe(false);
    expect(SHELL_WEB_PREFERENCES.sandbox).toBe(true);
    expect(SHELL_WEB_PREFERENCES.webSecurity).toBe(true);
    expect(SHELL_WEB_PREFERENCES.allowRunningInsecureContent).toBe(false);
    expect(SHELL_WEB_PREFERENCES.experimentalFeatures).toBe(false);
  });

  it("is frozen, so a call site cannot weaken it in passing", () => {
    expect(Object.isFrozen(SHELL_WEB_PREFERENCES)).toBe(true);
  });

  it("accepts the shipped preferences", () => {
    expect(() => assertHardenedWebPreferences(SHELL_WEB_PREFERENCES)).not.toThrow();
  });

  it("rejects each weakened flag individually", () => {
    const weakenings: Array<Record<string, boolean>> = [
      { contextIsolation: false },
      { nodeIntegration: true },
      { sandbox: false },
      { webSecurity: false },
      { allowRunningInsecureContent: true },
      { experimentalFeatures: true },
    ];
    for (const weakening of weakenings) {
      expect(
        () => assertHardenedWebPreferences({ ...SHELL_WEB_PREFERENCES, ...weakening }),
        JSON.stringify(weakening),
      ).toThrowError(/Unsafe renderer configuration/);
    }
  });

  it("rejects a missing flag rather than assuming a safe default", () => {
    const { sandbox: _omitted, ...withoutSandbox } = SHELL_WEB_PREFERENCES;
    expect(() => assertHardenedWebPreferences(withoutSandbox)).toThrowError(/sandbox/);
  });
});

describe("no remote content in the renderer", () => {
  it("allows local files and loopback origins", () => {
    for (const url of [
      "file:///C:/Users/x/AppData/Local/DASH/out/index.html",
      "file:///opt/dash/out/index.html",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:3000/agents/abc",
      "http://[::1]:3000/",
    ]) {
      expect(isAllowedRendererUrl(url), url).toBe(true);
    }
  });

  it("blocks off-machine content, and the near-misses that look local", () => {
    for (const url of [
      "https://orchestrate.example.com",
      "http://example.com",
      // Resolves through DNS, so it is not treated as a loopback literal.
      "http://localhost:3000",
      // Hostile hosts that merely contain a loopback-looking substring.
      "http://127.0.0.1.evil.com",
      "http://evil.com/?next=127.0.0.1",
      // Non-http schemes that could reach other local surfaces.
      "javascript:alert(1)",
      "data:text/html,<script>1</script>",
      "not a url",
      "",
    ]) {
      expect(isAllowedRendererUrl(url), url).toBe(false);
    }
  });
});

describe("the audited command chokepoint", () => {
  it("exposes exactly one channel and one command in this slice", () => {
    expect(SHELL_COMMAND_CHANNEL).toBe("dash:shell-command");
    expect(Object.keys(COMMANDS)).toEqual(["shell.ping"]);
    expect(COMMANDS["shell.ping"].mutates).toBe(false);
  });

  it("allows the declared command and audits it", () => {
    const review = reviewCommand({
      command: "shell.ping",
      request_id: "req-1",
      payload: { issued_at: "2026-07-19T00:00:00.000Z" },
    });
    expect(review.decision).toBe("allowed");
    expect(review.audit).toEqual({
      request_id: "req-1",
      command: "shell.ping",
      decision: "allowed",
      payload_keys: ["issued_at"],
      mutates: false,
    });
  });

  it("executes the no-op and returns only the correlation id", () => {
    const review = reviewCommand({ command: "shell.ping", request_id: "req-1" });
    expect(executeCommand(review)).toEqual({
      ok: true,
      request_id: "req-1",
      data: { pong: true },
    });
  });

  /** Allowlist, not denylist: anything undeclared is denied, and still audited. */
  it("denies an unknown command", () => {
    const review = reviewCommand({ command: "shell.readSecret", request_id: "req-2" });
    expect(review.decision).toBe("denied");
    expect(review.audit.reason).toBe("unknown_command");
    expect(review.audit.command).toBe("shell.readSecret");
  });

  it("denies malformed requests, including ones with no usable id", () => {
    for (const request of [null, undefined, "shell.ping", 42, {}, { command: "shell.ping" }]) {
      const review = reviewCommand(request);
      expect(review.decision, JSON.stringify(request) ?? "undefined").toBe("denied");
      expect(review.audit.reason).toBe("malformed_request");
    }
  });

  it("denies payload fields the command did not declare", () => {
    const review = reviewCommand({
      command: "shell.ping",
      request_id: "req-3",
      payload: { issued_at: "now", api_key: "sk-live-000" },
    });
    expect(review.decision).toBe("denied");
    expect(review.audit.reason).toBe("unexpected_payload_field");
  });

  /**
   * Primitives only. Objects and arrays are where a credential blob, a buffer
   * or a prototype-pollution payload would arrive.
   */
  it("denies non-primitive payload values", () => {
    for (const value of [{ nested: true }, ["a"], null]) {
      const review = reviewCommand({
        command: "shell.ping",
        request_id: "req-4",
        payload: { issued_at: value },
      });
      expect(review.decision, JSON.stringify(value)).toBe("denied");
      expect(review.audit.reason).toBe("unsupported_payload_value");
    }
  });

  it("refuses to execute anything that was denied", () => {
    const review = reviewCommand({ command: "shell.readSecret", request_id: "req-5" });
    expect(executeCommand(review)).toEqual({
      ok: false,
      request_id: "req-5",
      reason: "unknown_command",
    });
  });

  it("produces an audit record on every path, allowed or not", () => {
    for (const request of [
      { command: "shell.ping", request_id: "ok" },
      { command: "nope", request_id: "denied" },
      null,
    ]) {
      expect(reviewCommand(request).audit).toBeTruthy();
    }
  });

  it("recognises only declared command names", () => {
    expect(isCommandName("shell.ping")).toBe(true);
    expect(isCommandName("shell.readSecret")).toBe(false);
    // Object.hasOwn, so inherited members are not commands.
    expect(isCommandName("toString")).toBe(false);
    expect(isCommandName("__proto__")).toBe(false);
  });
});

describe("audit lines carry keys, never values", () => {
  it("logs the payload keys and omits the values", () => {
    const review = reviewCommand({
      command: "shell.ping",
      request_id: "req-6",
      payload: { issued_at: "2026-07-19T00:00:00.000Z" },
    });
    const line = formatAuditLine(review.audit);
    expect(line).toContain("allowed command=shell.ping id=req-6");
    expect(line).toContain("keys=[issued_at]");
    expect(line).not.toContain("2026-07-19T00:00:00.000Z");
  });

  /**
   * The rule has to hold on the denial path too — a rejected request is the one
   * most likely to contain something that should never have been sent.
   */
  it("omits values from denied requests as well", () => {
    const review = reviewCommand({
      command: "shell.ping",
      request_id: "req-7",
      payload: { issued_at: "now", api_key: "sk-live-000" },
    });
    const line = formatAuditLine(review.audit);
    expect(line).toContain("reason=unexpected_payload_field");
    expect(line).toContain("keys=[issued_at,api_key]");
    expect(line).not.toContain("sk-live-000");
  });
});
