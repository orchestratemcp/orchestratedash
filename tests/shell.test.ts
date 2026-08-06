import { describe, expect, it } from "vitest";
import {
  COMMANDS,
  SHELL_COMMAND_CHANNEL,
  dispatchCommand,
  executeCommand,
  formatAuditLine,
  isCommandName,
  reviewCommand,
} from "../lib/shell/ipc";
import type { CommandAuditRecord, ConnectionAction } from "../lib/shell/ipc";
import type { AgentCommandInput } from "../lib/agent-dom/runner";
import {
  SHELL_WEB_PREFERENCES,
  assertHardenedWebPreferences,
  isAllowedRendererUrl,
} from "../lib/shell/window";
import { isInsideInstallRoot } from "../lib/shell/install-layout";
import path from "node:path";

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
  it("allows the packaged renderer's origin and loopback origins", () => {
    for (const url of [
      "dash-app://ui/",
      "dash-app://ui/runs",
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
      // MAR-432 withdrew `file:`. It was here for the packaging proof build's
      // single static page, which a static export cannot be served as; leaving
      // it would leave the renderer permitted to load any readable path on the
      // machine in service of a page that no longer exists.
      "file:///C:/Users/x/AppData/Local/DASH/out/index.html",
      "file:///opt/dash/out/index.html",
      // Our scheme, somebody else's authority.
      "dash-app://elsewhere/index.html",
      "not a url",
      "",
    ]) {
      expect(isAllowedRendererUrl(url), url).toBe(false);
    }
  });
});

describe("the audited command chokepoint", () => {
  /**
   * The catalogue is spelled out rather than counted. Adding a command must
   * change this list, which is the review event `lib/shell/ipc.ts` is built
   * around — a test that asserted `length > 0` would let the next command in
   * without anyone reading it.
   */
  it("exposes exactly one channel and exactly the declared commands", () => {
    expect(SHELL_COMMAND_CHANNEL).toBe("dash:shell-command");
    expect(Object.keys(COMMANDS)).toEqual([
      "shell.ping",
      // MAR-440. Window chrome: asks main to draw a menu and reaches no agent,
      // no store and no provider. The only command besides `shell.ping` that
      // can honestly declare `mutates: false`.
      "shell.menu",
      // MAR-415. Lifecycle, not Agent DOM commands: they act on a process, no
      // manifest declares them, and they never become an envelope. The
      // `runner.` prefix is what keeps that legible at every call site.
      "runner.start",
      "runner.stop",
      "runner.status",
      // MAR-428. Same family and the same reasoning: DASH acting on something
      // it launched. Handled in the shell rather than forwarded to the runner,
      // because removing an agent is a sequence of file, store and process
      // operations only the shell can order correctly.
      "runner.remove",
      // MAR-383. A third family, and the only one that reaches the OS vault.
      // Note what is *not* in any of their payloads: no key here could carry a
      // credential, which is what keeps "no secrets cross this boundary" true
      // of the feature whose whole subject is secrets.
      "connection.connect",
      "connection.test",
      "connection.disconnect",
      "agent.approve",
      "agent.reject",
      "agent.choose",
      "agent.retry",
      "agent.pause",
      "agent.resume",
      "agent.cancel",
    ]);
    expect(COMMANDS["shell.ping"].mutates).toBe(false);
    expect(COMMANDS["runner.status"].mutates).toBe(false);
  });

  /**
   * The contract's command enum has seven members and none of them is `start`,
   * `stop` or `trigger`. A command named here that no manifest can declare
   * would be a button DASH offers and no adapter is obliged to honour.
   */
  it("declares no command outside the Agent DOM contract's vocabulary", () => {
    const contractVerbs = new Set([
      "approve",
      "reject",
      "choose",
      "retry",
      "pause",
      "resume",
      "cancel",
    ]);
    for (const name of Object.keys(COMMANDS)) {
      if (!name.startsWith("agent.")) {
        continue;
      }
      expect(contractVerbs.has(name.slice("agent.".length)), name).toBe(true);
    }
  });

  /** Every mutating command must say whether repeating it could do lasting harm. */
  it("marks every agent command as mutating and states its irreversibility", () => {
    for (const [name, spec] of Object.entries(COMMANDS)) {
      if (!name.startsWith("agent.")) {
        continue;
      }
      expect(spec.mutates, name).toBe(true);
      expect(typeof spec.irreversible, name).toBe("boolean");
      // A command that names no target is a command aimed at whatever is handy.
      expect(spec.required_keys, name).toContain("agent_id");
      expect(spec.required_keys, name).toContain("observed_at");
    }
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

describe("the renderer's half of an agent command", () => {
  const approve = {
    command: "agent.approve",
    request_id: "req-a",
    payload: {
      agent_id: "meeting-assistant",
      task_id: "task-1",
      approval_id: "approval-1",
      observed_at: "2026-07-16T09:05:00Z",
    },
  };

  /** Everything a command needs that the renderer must not be able to choose. */
  it("declares no payload key for an actor, a nonce, an expiry or an idempotency key", () => {
    const forbidden = ["actor", "actor_id", "nonce", "expires_at", "idempotency_key", "command_id"];
    for (const [name, spec] of Object.entries(COMMANDS)) {
      const declared: readonly string[] = spec.payload_keys;
      for (const key of forbidden) {
        expect(declared.includes(key), `${name}.${key}`).toBe(false);
      }
    }
  });

  it("denies an attempt to name the actor, because the key is not declared", () => {
    const review = reviewCommand({
      ...approve,
      payload: { ...approve.payload, actor_id: "someone-else" },
    });
    expect(review).toMatchObject({ decision: "denied", reason: "unexpected_payload_field" });
  });

  it("denies a command that names no target", () => {
    for (const missing of ["agent_id", "approval_id", "observed_at"]) {
      const payload: Record<string, string> = { ...approve.payload };
      delete payload[missing];
      const review = reviewCommand({ ...approve, payload });
      expect(review, missing).toMatchObject({
        decision: "denied",
        reason: "missing_payload_field",
      });
    }
  });

  /** An empty string is a present-but-absent field, and the contract has no id of length zero. */
  it("denies an empty target id rather than passing it on", () => {
    const review = reviewCommand({
      ...approve,
      payload: { ...approve.payload, approval_id: "" },
    });
    expect(review).toMatchObject({ decision: "denied", reason: "missing_payload_field" });
  });

  it("refuses to execute an agent command without the trusted side", () => {
    const review = reviewCommand(approve);
    expect(() => executeCommand(review)).toThrowError(/must go through dispatchCommand/);
  });
});

describe("dispatch", () => {
  function context() {
    const audited: CommandAuditRecord[] = [];
    const inputs: AgentCommandInput[] = [];
    const lifecycle: Array<{ action: string; agent_id: string | undefined }> = [];
    const connections: Array<{ action: string; target: Record<string, string> }> = [];
    // MAR-440. Where the menu was asked to appear, or `undefined` for "wherever
    // Electron would put it". Recorded rather than performed for the same
    // reason as everything else here: there is no `Menu` in this process.
    const menus: Array<{ x: number; y: number } | undefined> = [];
    return {
      audited,
      inputs,
      lifecycle,
      connections,
      menus,
      showApplicationMenu: (at: { x: number; y: number } | undefined) => {
        menus.push(at);
      },
      // MAR-383. Recorded, not performed — and note the fake holds no secret,
      // which it could not do usefully anyway: no credential is an argument to
      // or a result of this call.
      connectionAction: (
        action: ConnectionAction,
        target: { agent_id: string; connection_id: string; field_id: string },
      ) => {
        connections.push({ action, target });
        return Promise.resolve({
          ok: true,
          state: "connected" as const,
          masked_hint: "••••4f2a",
          detail: `${action} ok`,
        });
      },
      audit: (record: CommandAuditRecord) => audited.push(record),
      runAgentCommand: (input: AgentCommandInput) => {
        inputs.push(input);
        return Promise.resolve({
          ok: true,
          request_id: input.request_id,
          command_id: "cmd-1",
          correlation_id: "corr-1",
        });
      },
      // MAR-415. Recorded rather than performed: what these tests are about is
      // that lifecycle is routed somewhere other than the envelope machinery.
      runnerLifecycle: (action: string, agentId: string | undefined) => {
        lifecycle.push({ action, agent_id: agentId });
        return Promise.resolve({ ok: true, detail: `${action} ok` });
      },
    };
  }

  it("routes an agent command to the trusted side with the payload unpacked", async () => {
    const ctx = context();
    const result = await dispatchCommand(
      {
        command: "agent.cancel",
        request_id: "req-b",
        payload: {
          agent_id: "meeting-assistant",
          run_id: "run-1",
          observed_at: "2026-07-16T09:05:00Z",
        },
      },
      ctx,
    );

    expect(result).toMatchObject({ ok: true, correlation_id: "corr-1" });
    expect(ctx.inputs[0]).toMatchObject({
      command: "cancel",
      target: { agent_id: "meeting-assistant", run_id: "run-1" },
      observed_at: "2026-07-16T09:05:00Z",
      mutates: true,
    });
  });

  it("handles a local command without involving the trusted side at all", async () => {
    const ctx = context();
    const result = await dispatchCommand({ command: "shell.ping", request_id: "req-c" }, ctx);

    expect(result).toMatchObject({ ok: true, data: { pong: true } });
    expect(ctx.inputs).toHaveLength(0);
  });

  /**
   * MAR-440. The title bar's menu button.
   *
   * Three properties, and the third is the one that matters. It reaches main
   * (a pure module cannot pop a `Menu`); it is audited like everything else on
   * this channel; and it can carry **nothing but a coordinate** — so a renderer
   * that has been taken over can make a menu appear and still cannot name an
   * item in it, because no payload key exists that could.
   */
  describe("shell.menu", () => {
    it("reaches the trusted side with the point the renderer asked for", async () => {
      const ctx = context();
      const result = await dispatchCommand(
        { command: "shell.menu", request_id: "req-m", payload: { x: 12, y: 40 } },
        ctx,
      );

      expect(result).toMatchObject({ ok: true, request_id: "req-m" });
      expect(ctx.menus).toEqual([{ x: 12, y: 40 }]);
      // Not an agent command and not lifecycle: no envelope was built for it.
      expect(ctx.inputs).toHaveLength(0);
      expect(ctx.lifecycle).toHaveLength(0);
    });

    it("is audited, and recorded as changing nothing", async () => {
      const ctx = context();
      await dispatchCommand({ command: "shell.menu", request_id: "req-m2" }, ctx);

      expect(ctx.audited[0]).toMatchObject({
        command: "shell.menu",
        decision: "allowed",
        mutates: false,
      });
    });

    it("falls back to Electron's own placement when only one coordinate arrives", async () => {
      const ctx = context();
      await dispatchCommand(
        { command: "shell.menu", request_id: "req-m3", payload: { x: 12 } },
        ctx,
      );

      // A menu popped at a half-known point lands somewhere nobody chose.
      expect(ctx.menus).toEqual([undefined]);
    });

    it("cannot be told which menu item to invoke", async () => {
      const ctx = context();
      const result = await dispatchCommand(
        {
          command: "shell.menu",
          request_id: "req-m4",
          payload: { x: 1, y: 2, action: "sample_agent" },
        },
        ctx,
      );

      // The whole request is denied rather than the extra field dropped: a
      // caller sending a field we do not understand has a different model of
      // this command than we do.
      expect(result).toMatchObject({ ok: false, reason: "unexpected_payload_field" });
      expect(ctx.menus).toHaveLength(0);
    });
  });

  /**
   * MAR-415. Lifecycle is routed away from the envelope machinery, which is the
   * structural half of "start and stop are not Agent DOM commands": if these
   * ever reached `runAgentCommand`, DASH would be building an envelope for a
   * verb `agent-command.schema.json` does not contain.
   */
  it("routes a runner lifecycle command to the runner, never into an envelope", async () => {
    const ctx = context();
    const result = await dispatchCommand(
      { command: "runner.start", request_id: "req-d", payload: { agent_id: "fixture-agent" } },
      ctx,
    );

    expect(result).toMatchObject({ ok: true, detail: "start ok" });
    expect(ctx.lifecycle).toEqual([{ action: "start", agent_id: "fixture-agent" }]);
    expect(ctx.inputs).toHaveLength(0);
  });

  it("still audits a lifecycle command at the IPC boundary", async () => {
    const ctx = context();
    await dispatchCommand(
      { command: "runner.stop", request_id: "req-e", payload: { agent_id: "fixture-agent" } },
      ctx,
    );

    expect(ctx.audited.at(-1)).toMatchObject({
      command: "runner.stop",
      decision: "allowed",
      payload_keys: ["agent_id"],
      mutates: true,
    });
  });

  it("denies a lifecycle command that names no agent", async () => {
    const ctx = context();
    const result = await dispatchCommand({ command: "runner.start", request_id: "req-f" }, ctx);

    expect(result).toMatchObject({ ok: false, reason: "missing_payload_field" });
    expect(ctx.lifecycle).toHaveLength(0);
  });

  it("refuses to execute a lifecycle command outside the dispatcher", () => {
    // The same guard agent commands have: reaching `executeCommand` directly
    // would mean a call site bypassed the trusted side.
    const review = reviewCommand({
      command: "runner.start",
      request_id: "req-g",
      payload: { agent_id: "fixture-agent" },
    });
    expect(() => executeCommand(review)).toThrow(/must go through dispatchCommand/);
  });

  /**
   * The property the chokepoint exists for. Denied, local or agent — there is
   * no route out of `dispatchCommand` that skips the record.
   */
  it("emits an IPC audit record on every route", async () => {
    const ctx = context();
    await dispatchCommand({ command: "shell.ping", request_id: "req-d" }, ctx);
    await dispatchCommand({ command: "shell.nope", request_id: "req-e" }, ctx);
    await dispatchCommand(null, ctx);
    await dispatchCommand(
      {
        command: "agent.cancel",
        request_id: "req-f",
        payload: { agent_id: "a", run_id: "r", observed_at: "2026-07-16T09:05:00Z" },
      },
      ctx,
    );

    expect(ctx.audited.map((record) => record.decision)).toEqual([
      "allowed",
      "denied",
      "denied",
      "allowed",
    ]);
  });

  it("never lets an agent command reach the trusted side unreviewed", async () => {
    const ctx = context();
    await dispatchCommand(
      { command: "agent.approve", request_id: "req-g", payload: { agent_id: "a" } },
      ctx,
    );
    expect(ctx.inputs).toHaveLength(0);
  });

  /**
   * The connection commands (MAR-383).
   *
   * The property under test in every case is the same one: a command about a
   * credential is routed to the credential side, carries no credential, and
   * cannot be redirected into the envelope machinery by naming an agent.
   */
  describe("connection commands", () => {
    const connect = {
      command: "connection.connect",
      request_id: "req-conn",
      payload: { agent_id: "ledger-reporter", connection_id: "ledger", field_id: "api-key" },
    };

    it("routes to the connection side and not to the agent or the runner", async () => {
      const ctx = context();
      const result = await dispatchCommand(connect, ctx);

      expect(result).toMatchObject({ ok: true, detail: "connect ok" });
      expect(ctx.connections).toEqual([
        {
          action: "connect",
          target: { agent_id: "ledger-reporter", connection_id: "ledger", field_id: "api-key" },
        },
      ]);
      expect(ctx.inputs).toHaveLength(0);
      expect(ctx.lifecycle).toHaveLength(0);
    });

    /**
     * The rule `lib/shell/ipc.ts` opens with, applied to the one feature whose
     * subject is secrets: no command declares a key a credential could arrive
     * in, so the boundary refuses the whole request rather than dropping the
     * field.
     */
    it.each(["secret", "value", "api_key", "password", "token"])(
      "refuses a connect carrying a %s field",
      async (key) => {
        const ctx = context();
        const result = await dispatchCommand(
          { ...connect, payload: { ...connect.payload, [key]: "sk-live-abcd1234" } },
          ctx,
        );

        expect(result).toMatchObject({ ok: false, reason: "unexpected_payload_field" });
        expect(ctx.connections).toHaveLength(0);
      },
    );

    it("refuses a connect that does not name all three parts of its target", async () => {
      const ctx = context();
      const result = await dispatchCommand(
        {
          command: "connection.disconnect",
          request_id: "req-conn-2",
          payload: { agent_id: "ledger-reporter", connection_id: "ledger" },
        },
        ctx,
      );

      expect(result).toMatchObject({ ok: false, reason: "missing_payload_field" });
      expect(ctx.connections).toHaveLength(0);
    });

    it("audits the connection command with keys only", async () => {
      const ctx = context();
      await dispatchCommand(connect, ctx);

      expect(ctx.audited[0]).toMatchObject({
        command: "connection.connect",
        decision: "allowed",
        payload_keys: ["agent_id", "connection_id", "field_id"],
        mutates: true,
      });
    });

    it("refuses to execute one without the trusted side", () => {
      expect(() => executeCommand(reviewCommand(connect))).toThrowError(
        /must go through dispatchCommand/,
      );
    });
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

/**
 * MAR-429. The packaged app must read its schemas from its own install layout.
 *
 * The failure this guards against is silent on the only machine likely to run
 * it: a build box still has `<repo>/contracts`, so `lib/contracts.ts`'s
 * walk-up fallback finds it and the package looks fine right up until it
 * reaches a machine that has no development tree. See
 * `electron/resources.ts`.
 */
describe("install layout containment", () => {
  const root = path.join(path.sep, "app", "resources");

  it("accepts a directory inside the install root", () => {
    expect(isInsideInstallRoot(root, path.join(root, "contracts"))).toBe(true);
  });

  it("accepts the root itself", () => {
    expect(isInsideInstallRoot(root, root)).toBe(true);
  });

  /**
   * The case a `startsWith` check gets wrong, and the one an *update* — the
   * lifecycle step MAR-429 exists to prove — actually produces on disk.
   */
  it("rejects a sibling directory sharing the root's name as a prefix", () => {
    expect(isInsideInstallRoot(root, `${root}-old`)).toBe(false);
  });

  it("rejects a development tree elsewhere on the disk", () => {
    expect(isInsideInstallRoot(root, path.join(path.sep, "src", "dash", "contracts"))).toBe(
      false,
    );
  });

  it("rejects a path that traverses back out of the root", () => {
    expect(isInsideInstallRoot(root, path.join(root, "..", "..", "contracts"))).toBe(false);
  });

  /**
   * A leading `..` in the *relative* result means escape; a directory whose
   * name merely begins with dots does not.
   */
  it("accepts a directory whose name starts with dots", () => {
    expect(isInsideInstallRoot(root, path.join(root, "..config"))).toBe(true);
  });
});
