import { describe, expect, it } from "vitest";
import {
  COMMANDS,
  HOST_ACTIONS,
  SHELL_COMMAND_CHANNEL,
  dispatchCommand,
  executeCommand,
  formatAuditLine,
  isCommandName,
  reviewCommand,
} from "../lib/shell/ipc";
import type {
  CommandAuditRecord,
  ConnectionAction,
  FolderAction,
  GlanceAction,
  HostAction,
  AskAction,
  ChiefAction,
  IdentityAction,
  ModelAction,
  NotifyAction,
  SampleAction,
  StandingAnswerAction,
  WorkspaceAction,
} from "../lib/shell/ipc";
import type { AgentCommandInput } from "../lib/agent-dom/runner";
import { MANIFEST_ONLY_DEPLOY_REFUSAL } from "../lib/agent-folders";
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
      "shell.scale",
      // MAR-642. The third in that family: the native half of the theme. The
      // palette is CSS and needs no command; the window's background and the
      // Windows title bar overlay are chosen in Node before a stylesheet
      // exists, and this is what tells that half which one a person chose.
      "shell.theme",
      // MAR-628, ADR 0019. The controlled browser's two, and they are not one
      // family. `browser.viewport` belongs beside the three above — it moves a
      // native view and reaches no agent, no store and no provider. Its
      // neighbour does not: `browser.stop` destroys a Chromium session and
      // refuses an agent's requests for the rest of its run, which is
      // `mutates: true` and belongs in a receipt somebody may go looking for.
      // They sit together here because they arrived together; they are
      // deliberately apart in `SHELL_UI_ACTIONS`, which is the map that decides
      // how they are handled.
      "browser.viewport",
      "browser.stop",
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
      // MAR-595 finding 18. Same family and the same handling, and a distinct
      // command rather than a payload flag on `runner.remove` above: two names
      // cannot be silenced by a caller forgetting a boolean the way one name
      // with a flag could be.
      "runner.removeKeepFiles",
      // MAR-518. Same family, and names no agent: a damaged store is a fact
      // about the runner, not about any one of the agents it supervises.
      "runner.retireStore",
      // MAR-576. A fifth family, and the only command in DASH that can rewrite
      // an author's manifest. Its own prefix rather than `agent.*`, which is
      // reserved for the contract's seven verbs, and not `runner.*`, because no
      // process is started, stopped or asked anything. The payload is one agent
      // id: page script can ask DASH to regenerate an agent *from DASH's own
      // template* and has no way to hand DASH a document to store.
      "sample.refresh",
      // MAR-586. A sixth family, and the only command in DASH about the person
      // at the keyboard rather than about anything DASH supervises: it writes
      // down that an agent's page was opened, so a fleet card can say what has
      // arrived since. The payload is one agent id and deliberately no time —
      // main stamps its own clock, so page script cannot mark an agent as read
      // at a moment it chose and silence its card for good.
      "glance.looked",
      // MAR-589. A name DASH itself owns for one agent, separate from the
      // author's `display_name`. About the reader's own record, `glance.looked`'s
      // own reason immediately above: it contacts no agent, no runner, no vault
      // and no provider. `display_name` is optional, and its absence is the whole
      // vocabulary for putting a rename back. `identity.*`, not `agent.*` — that
      // prefix is reserved for the contract's seven verbs, checked below.
      "identity.rename",
      // MAR-640. The same family's second member: whether the reader has
      // starred the agent. Contacts nobody, and `favourite` is required
      // rather than optional — there is no absent state to mean "put it
      // back", unlike `display_name`.
      "identity.favourite",
      // MAR-615. The same family's third member: which of `O_FLEET`'s eleven
      // costumes the agent wears. Contacts nobody, and `avatar` is required
      // for the same reason `favourite` is — there is no absent state that
      // means "put it back" the way `display_name`'s omission does.
      "identity.avatar",
      // MAR-681. A person's own record that an agent's runtime question should
      // stop being asked. Its own family rather than a fourth `identity.*`
      // member: `identity.*` is about identifying an agent to the reader, and
      // this is about a question the agent asked, keyed by the question's own
      // words. Contacts nobody, like every member of the family beside it.
      "standing_answer.set",
      "standing_answer.clear",
      // MAR-584. A seventh family, and the only route in DASH that accepts a
      // document somebody else's editor wrote. Three members and the split
      // between the first two is the point: comparing is a read and accepting
      // is a write, and anything that could do both in one call would make an
      // approval transfer to whatever an editor last saved. The payload is one
      // agent id — page script cannot supply the document, only name the agent
      // whose folder DASH should read.
      // MAR-583. An eighth family: which model an agent uses. Two write DASH's
      // own choice rows and reach nobody; the third presents the key DASH holds
      // to a model provider and records the same liveness observation
      // `connection.test` does. The renderer names an agent, a connection and a
      // field — never a provider, an origin, a path or a key — and the one value
      // it does supply from a provider's own answer, a model id, is checked
      // again by main rather than trusted for having come from a list DASH made.
      "model.choose",
      "model.step",
      "model.list",
      // MAR-642. Two more in that family, and the first commands in it that
      // name no agent: DASH's own default model belongs to no agent, so there
      // is no manifest to resolve a provider out of. They name one of the three
      // ids in `AI_PROVIDER_IDS` instead and main refuses anything else — what
      // the renderer still cannot name is an origin, a path, a header or a key.
      // They are in this family rather than the fleet one because neither
      // changes what DASH may reach, which is what the fleet verbs are for.
      "model.default",
      "model.catalogue",
      // MAR-654, ADR 0011 amendment 1. A third in that family naming no agent:
      // what one *strength* of step runs on, fleet-wide. It reaches no provider
      // at all — the catalogue it is picked from arrives through
      // `model.catalogue` — so it opens no vault, and what it widens is stated
      // in its own catalogue entry: a row written here is one an agent's own
      // step can be resolved to, bounded by the levels that agent's plan
      // declares.
      "model.level",

      // MAR-545. The tenth family, one member, and the first command in this
      // catalogue that costs the person money. The renderer names an agent, a
      // connection, a field and a question — never a model, because which model
      // answers is read in main from the row a person set through
      // `model.choose`.
      "ask.question",
      // MAR-659, ADR 0023. The eleventh family, and the second that can spend
      // the person's money. Its own family rather than more of `ask.*` because
      // the two are aimed at different principals: `ask.question` carries an
      // agent id and reaches `{ kind: "agent" }`; these carry no id at all and
      // reach `{ kind: "chief" }`. `chief.ask` names a question and nothing
      // else — no agent, no connection, no field, no model — and `chief.clear`
      // names nothing, which is the only correct payload for deleting the one
      // thread there is.
      "chief.ask",
      "chief.clear",
      "folder.check",
      "folder.adopt",
      "folder.reveal",
      // MAR-598. The fourth member of the folder family, and the only command in
      // this whole catalogue with an empty payload. That absence is the security
      // argument rather than a convenience: page script cannot name a folder,
      // cannot cause a particular folder to be read, and cannot learn which one
      // was offered. The widest thing it reaches is "put the operating system's
      // own folder chooser on screen" — a window DASH does not draw and the
      // renderer can neither see nor dismiss — after which a second dialog asks
      // the person before a byte is copied.
      "folder.choose",
      // MAR-536. Servers are independent of agents. Create accepts only the
      // four ordinary connection facts; main mints both names and returns only
      // the public key, while probe and forget take the opaque host id.
      "host.create",
      "host.probe",
      // MAR-572. The first pin, as a command rather than a side effect of
      // connecting: it carries back the fingerprint the person was *shown*, and
      // main refuses if the server no longer answers with it.
      "host.trust",
      // MAR-573. Text a person pastes into a server that has never heard of
      // DASH. `mutates: false` — it reads DASH's own public key and the helper
      // this build ships, and composes a string.
      "host.setup",
      "host.deploy",
      // MAR-602, ADR 0014. A **second named action** rather than a mode of
      // `agent.retry`, which is what makes ADR 0014's rule enforceable: deploying
      // an agent never changes what a control already on screen does. It carries
      // the same two ids `host.deploy` does and, in particular, no task id — a
      // page has never seen the server's snapshot, so main reads which task at
      // the moment of the press and the host adjudicates it again.
      "host.run",
      "host.bringHome",
      "host.forget",
      // MAR-434. A fifth family, addressing the runner's task workspace over
      // routes the runner already served and proof 9 already exercised. Note
      // the payload: two opaque ids, no path — main asks the *user* where to
      // save through the operating system's own dialog, so the renderer neither
      // supplies a location nor learns one. `mutates: false` for the same
      // reason `shell.menu` is: it changes nothing about the agent, the store,
      // or the world the agent acts on.
      "workspace.download",
      // MAR-674, ADR 0025 decision 4. The same two opaque ids and the same
      // absence of a path, one process over: main composes the PDF from an
      // artifact it already holds and prints it in a window this bridge
      // cannot reach, rather than fetching bytes from the runner. A second
      // command rather than a format flag on the first, because the two have
      // different sources and different failure sentences.
      "workspace.exportBrief",
      // MAR-588. An eighth family, and the only route in DASH that can send
      // something off this machine without an agent asking it to. Note the
      // payloads: three of the four have none at all, so page script can ask
      // main to open the credential window, ask it to forget the channel it
      // holds, or ask for one fixed test message -- and can neither name an
      // address nor learn the one DASH holds. The fourth carries a setting name
      // and a boolean, which is the only `boolean` payload value in this
      // catalogue.
      "notify.connect",
      "notify.disconnect",
      "notify.test",
      "notify.setKind",
      // MAR-383. A third family, and the only one that reaches the OS vault.
      // Note what is *not* in any of their payloads: no key here could carry a
      // credential, which is what keeps "no secrets cross this boundary" true
      // of the feature whose whole subject is secrets.
      "connection.connect",
      "connection.test",
      "connection.disconnect",
      // MAR-593, ADR 0013. An eleventh family, reaching the same vault on a
      // target that names no agent. Note the payloads: one provider each, and
      // no agent id at all — `dispatchCommand` supplies the principal a fleet
      // act stands under, so page script can neither aim a fleet act at an agent
      // nor an agent act at the fleet.
      "fleet.connect",
      "fleet.test",
      "fleet.disconnect",
      // The one command in this catalogue that touches the vault while opening
      // no window and contacting nobody: it hands agents a consent DASH already
      // holds, rather than asking for a second one.
      "fleet.share",
      // MAR-643. One chooses the fallback account without moving an existing
      // assignment; the other names one agent and one opaque account id, never
      // an account name or credential.
      "fleet.default",
      "fleet.assign",
      "agent.approve",
      "agent.reject",
      "agent.choose",
      "agent.retry",
      "agent.pause",
      "agent.resume",
      "agent.cancel",
      // MAR-507. A fourth family, and the only one that reaches a file the user
      // chose. Note what is *not* in any of their payloads: no key here could
      // carry a path, which is what keeps "the renderer names a kind of file and
      // never a file" true of the feature whose whole subject is files.
      "workspace.openTask",
      "workspace.selectInput",
      "workspace.dispatchTask",
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

  /*
   * MAR-659, ADR 0023 decision 8. *"Fleet page → the chief principal, the fleet
   * briefing, no agent's saved material. Agent page → that agent's principal and
   * that agent's saved reports."*
   *
   * Semantically **and** structurally, and this is the structural half at the
   * IPC boundary: `{ kind: "chief" }` carries no agent id, so there is no value
   * a chief question could be aimed at an agent with. That is only true while
   * the catalogue declares no key one could travel in — a `payload_keys`
   * entry added here would put the value back and no other test would notice.
   *
   * `chief.clear` is asserted separately and to a stronger standard: an empty
   * payload, because there is one thread and a page able to name which one to
   * delete would be a page able to delete a different one.
   */
  it("gives the chief no way to name an agent, a connection or a model", () => {
    expect(COMMANDS["chief.ask"].payload_keys).toEqual(["question"]);
    expect(COMMANDS["chief.ask"].required_keys).toEqual(["question"]);
    expect(COMMANDS["chief.clear"].payload_keys).toEqual([]);
    // Both spend or destroy, so both say so — `irreversible` describes the worst
    // thing a command can do rather than the commonest, and a standing question
    // being free does not make a charged one reversible.
    expect(COMMANDS["chief.ask"].irreversible).toBe(true);
    expect(COMMANDS["chief.clear"].irreversible).toBe(true);
  });

  it("denies a chief question that tries to name an agent", () => {
    const review = reviewCommand({
      command: "chief.ask",
      request_id: "req-chief-1",
      payload: { question: "what needs me", agent_id: "ai-agent-news" },
    });
    expect(review).toMatchObject({ decision: "denied", reason: "unexpected_payload_field" });
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
    const hosts: Array<{ action: HostAction; target: Record<string, string | number> }> = [];
    // MAR-507. Recorded rather than performed, for the sharpest version of the
    // reason the others are: performing one would open a file picker, and the
    // property these tests exist to hold is that whatever the renderer sent,
    // no path was in it.
    const workspaces: Array<{ action: string; target: Record<string, unknown> }> = [];
    // MAR-440. Where the menu was asked to appear, or `undefined` for "wherever
    // Electron would put it". Recorded rather than performed for the same
    // reason as everything else here: there is no `Menu` in this process.
    const menus: Array<{ x: number; y: number } | undefined> = [];
    // MAR-642. Which theme main was told to draw its own chrome in.
    const themes: string[] = [];
    // MAR-628. Where main was told to paint the controlled browser, and whose
    // browser a person pressed Stop on.
    const viewports: Array<{ x: number; y: number; width: number; height: number }> = [];
    const browserStops: string[] = [];
    // MAR-434. Recorded rather than performed, like everything else here: the
    // real one reaches the runner over a socket and raises a native save
    // dialog, and neither exists in this process.
    const downloads: Array<{ action: string; target: Record<string, string> }> = [];
    // MAR-576. Recorded rather than performed: the real one rewrites the agent
    // folder and the store through `importManifest`, and neither exists here.
    const samples: Array<{ action: SampleAction; target: { agent_id: string } }> = [];
    // MAR-586. Recorded rather than performed, like everything else here: the
    // real one writes a row through `node:sqlite`, which this process has no
    // store for.
    const looks: Array<{ action: GlanceAction; target: { agent_id: string } }> = [];
    // MAR-589, MAR-640. Recorded rather than performed, `glanceAction`'s own
    // reason: the real one writes a row through `node:sqlite`, which this
    // process has no store for.
    const renames: Array<{
      action: IdentityAction;
      target: { agent_id: string; display_name?: string; favourite?: boolean };
    }> = [];
    // MAR-681. Recorded rather than performed, `renames`' own reason: the real
    // one writes a row through `node:sqlite`, which this process has no store
    // for.
    const standingAnswers: Array<{
      action: StandingAnswerAction;
      target: {
        agent_id: string;
        question_key?: string;
        question_label?: string;
        option_id?: string;
        option_label?: string;
      };
    }> = [];
    // MAR-584. Recorded rather than performed, for the same reason as the rest:
    // the real one reads the agent folder off disk, writes through
    // `importManifest` and — for `reveal` — calls an Electron main API, none of
    // which exists in this process.
    const folders: Array<{ action: FolderAction; target: { agent_id: string } }> = [];
    // MAR-583. Recorded rather than performed, for the same reason as the rest:
    // two of the three write rows through `node:sqlite` and the third opens the
    // operating system's vault and reaches a provider, none of which exists in
    // this process. The fake holds no key and could not usefully: no credential
    // is an argument to or a result of this call, which is `connectionAction`'s
    // property one layer along.
    const models: Array<{ action: ModelAction; target: Record<string, unknown> }> = [];
    const asks: Array<{ action: AskAction; target: Record<string, string> }> = [];
    // MAR-659. The chief's own two, beside the agent's one and kept apart from
    // it for the same reason the maps in `lib/shell/ipc.ts` are: a test asserting
    // that a fleet question carried no agent id should not have to filter it out
    // of a list of agent questions first.
    const chiefs: Array<{ action: ChiefAction; target: { question?: string } }> = [];
    // MAR-588. Recorded, not performed, for `folderAction`'s reason and one
    // more: the real implementation opens the credential window and reaches
    // Discord, and a fake that did either would make these tests -- which are
    // about review, audit and routing -- depend on a network.
    const notifications: Array<{ action: NotifyAction; target: { kind?: string; enabled?: boolean } }> =
      [];
    return {
      audited,
      inputs,
      lifecycle,
      connections,
      samples,
      looks,
      renames,
      standingAnswers,
      folders,
      models,
      asks,
      chiefs,
      modelAction: (action: ModelAction, target: Record<string, unknown>) => {
        models.push({ action, target });
        return Promise.resolve({ ok: true, detail: `${action} ok` });
      },
      notifications,
      hosts,
      workspaces,
      menus,
      themes,
      downloads,
      workspaceAction: (action: WorkspaceAction, target: Record<string, unknown>) => {
        if (action === "download") {
          downloads.push({ action, target: target as Record<string, string> });
          return Promise.resolve({ ok: true, detail: "Saved to C:\Users\someone\Documents." });
        }
        workspaces.push({ action, target });
        return Promise.resolve({
          ok: true,
          detail: `${action} ok`,
          data: { task_id: "task-fake-1" },
        });
      },
      // MAR-576. Recorded, not performed. The fake regenerates nothing and
      // writes nothing: what these tests are about is that the command is
      // reviewed, audited and routed to this seam rather than to another one —
      // the ownership gate lives in `electron/main.ts`, beside the real write.
      sampleAction: (action: SampleAction, target: { agent_id: string }) => {
        samples.push({ action, target });
        return Promise.resolve({ ok: true });
      },
      // MAR-586. Recorded, not performed, for `sampleAction`'s reason directly
      // above: the real one writes a row, and what these tests are about is that
      // the command is reviewed, audited and routed to this seam rather than to
      // another one.
      glanceAction: (action: GlanceAction, target: { agent_id: string }) => {
        looks.push({ action, target });
        return Promise.resolve({ ok: true });
      },
      agentAction: (
        action: IdentityAction,
        target: { agent_id: string; display_name?: string; favourite?: boolean },
      ) => {
        renames.push({ action, target });
        return Promise.resolve({ ok: true });
      },
      standingAnswerAction: (
        action: StandingAnswerAction,
        target: {
          agent_id: string;
          question_key?: string;
          question_label?: string;
          option_id?: string;
          option_label?: string;
        },
      ) => {
        standingAnswers.push({ action, target });
        return Promise.resolve({ ok: true });
      },
      // MAR-584. Recorded, not performed, for `sampleAction`'s reason: these
      // tests are about the three commands being reviewed, audited and routed
      // to this seam. Whether an edited folder is described correctly is
      // `tests/folder-changes.test.ts`, over fixtures, and whether it is read
      // correctly is `tests/agent-folders.test.ts`, over a real directory.
      folderAction: (action: FolderAction, target: { agent_id: string }) => {
        folders.push({ action, target });
        return Promise.resolve({ ok: true });
      },
      notifyAction: (action: NotifyAction, target: { kind?: string; enabled?: boolean }) => {
        notifications.push({ action, target });
        return Promise.resolve({ ok: true });
      },
      // MAR-545. Recorded, not performed, for `sampleAction`'s reason — and here
      // the reason has teeth: the real one bills somebody's account, so a fake
      // that did anything at all would be a test suite that spends money.
      askAction: (action: AskAction, target: Record<string, string>) => {
        asks.push({ action, target });
        return Promise.resolve({ ok: true });
      },
      // MAR-659. Recorded, not performed, for the entry above's reason — and
      // with the same teeth: the real one bills somebody's account.
      chiefAction: (action: ChiefAction, target: { question?: string }) => {
        chiefs.push({ action, target });
        return Promise.resolve({ ok: true });
      },
      showApplicationMenu: (at: { x: number; y: number } | undefined) => {
        menus.push(at);
      },
      setUiScale: (factor: number | undefined) => factor ?? 1,
      // MAR-642. Recorded, not performed: the real one assigns
      // `nativeTheme.themeSource`, which no test process has. What is worth
      // asserting is that the dispatcher narrows whatever a renderer sent to
      // one of three literals before it gets here.
      setNativeTheme: (theme: "system" | "light" | "dark") => {
        themes.push(theme);
      },
      // MAR-628. Recorded, not performed, on `setNativeTheme`'s terms: the real
      // ones move a `WebContentsView` and destroy a Chromium session, neither of
      // which a test process has. What is worth asserting from here is that the
      // dispatcher narrows four payload values to numbers, and that a Stop
      // carries the agent and nothing else.
      setBrowserViewport: (bounds: { x: number; y: number; width: number; height: number }) => {
        viewports.push(bounds);
      },
      stopBrowser: (agentId: string) => {
        browserStops.push(agentId);
        return Promise.resolve();
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
      // MAR-536. The fake records unsecret input only. Its create answer spells
      // the public fields individually, matching the closed host-result type;
      // it has no private key or filesystem path to accidentally return.
      hostAction: (
        action: HostAction,
        target:
          | { label: string; address: string; username: string; port: number }
          | { host_id: string }
          | { host_id: string; fingerprint: string }
          | { host_id: string; agent_id: string },
      ) => {
        hosts.push({ action, target });
        switch (action) {
          case "create":
            return Promise.resolve({
              ok: true as const,
              action,
              host_id: "host-fake-1",
              label: "My server",
              public_key: "ssh-ed25519 AAAA-public orchestratedash",
              key_name: "host-fake-1",
              authorized_keys_line:
                'restrict,command="/opt/orchestratedash/dash-host" ssh-ed25519 AAAA-public orchestratedash',
              resumed: false,
            });
          // MAR-572 / MAR-573. Both new answers are unsecret by construction,
          // like the four around them: a fingerprint is a fact about the
          // *server's* key, and the setup text is composed in main from DASH's
          // own public half.
          case "trust":
            return Promise.resolve({
              ok: true as const,
              action,
              host_id: "host-fake-1",
              label: "My server",
              fingerprint: "SHA256:fixture",
            });
          case "setup":
            return Promise.resolve({
              ok: true as const,
              action,
              host_id: "host-fake-1",
              label: "My server",
              script: "#!/bin/sh\nexit 0\n",
            });
          case "probe":
            return Promise.resolve({
              ok: true as const,
              action,
              host_id: "host-fake-1",
              label: "My server",
              runner_build: "fixture",
              // MAR-574. The host's own count of what it has running, which the
              // Servers page words as a report rather than as DASH's record.
              agents_running: 2,
              agents_there: [{ agent_id: "News Scout", running: true }],
            });
          case "deploy":
            return Promise.resolve({
              ok: true as const,
              action,
              host_id: "host-fake-1",
              label: "My server",
              agent_id: "fixture-agent",
              bundle_id: "fixture-agent",
              runner_build: "fixture",
              detail: "The agent is running on My server.",
            });
          // MAR-602, ADR 0014. Unsecret by construction like the six around it,
          // and that is the property worth having a fixture for: the `channel`
          // verb is the one thing on either plane that handles a credential, and
          // the closed result type is what stops it reaching a renderer. There
          // is no `token` here because there is no member it could go in.
          case "run":
            return Promise.resolve({
              ok: true as const,
              action,
              host_id: "host-fake-1",
              label: "My server",
              agent_id: "fixture-agent",
              detail:
                "My server was asked to start this agent. DASH will show what it did the next " +
                "time it can reach that server, and only what the server still has then.",
              reached: true,
            });
          case "bringHome":
            return Promise.resolve({
              ok: true as const,
              action,
              host_id: "host-fake-1",
              label: "My server",
              agent_id: "fixture-agent",
              files_saved: 0,
              detail:
                "This agent is no longer on My server. Everything that server still had is on " +
                "this computer now. It had no files there to bring back.",
            });
          case "forget":
            return Promise.resolve({
              ok: true as const,
              action,
              host_id: "host-fake-1",
              label: "My server",
            });
        }
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

  /**
   * MAR-518. `runner.retireStore` is the one lifecycle command that must
   * *not* be denied for naming no agent — a damaged store is a fact about
   * the runner, not about any one agent it supervises, and `agentId` reaches
   * `runnerLifecycle` as `undefined` rather than being refused upstream.
   */
  it("dispatches the store-retire command with no agent named", async () => {
    const ctx = context();
    const result = await dispatchCommand(
      { command: "runner.retireStore", request_id: "req-h" },
      ctx,
    );

    expect(result).toMatchObject({ ok: true, detail: "retireStore ok" });
    expect(ctx.lifecycle).toEqual([{ action: "retireStore", agent_id: undefined }]);
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
   * MAR-536. The server family is the same dispatcher/preload/main shape as
   * MAR-518's store repair, including the missing-half MAR-518 found: a command
   * no named bridge and page can reach is not a product command. This test pins
   * the dispatcher half, where the private-key and path refusal is structural.
   */
  describe("the host command family", () => {
    const create = {
      command: "host.create",
      request_id: "req-host-create",
      payload: { label: "My server", address: "vps.example.com", username: "dash", port: 22 },
    };

    it("routes a host creation to its own trusted-side action", async () => {
      const ctx = context();
      const result = await dispatchCommand(create, ctx);

      expect(ctx.hosts).toEqual([
        {
          action: "create",
          target: { label: "My server", address: "vps.example.com", username: "dash", port: 22 },
        },
      ]);
      expect(result).toMatchObject({
        ok: true,
        data: {
          host_id: "host-fake-1",
          public_key: "ssh-ed25519 AAAA-public orchestratedash",
          key_name: "host-fake-1",
        },
      });
      expect(ctx.inputs).toHaveLength(0);
      expect(ctx.lifecycle).toHaveLength(0);
      expect(ctx.connections).toHaveLength(0);
    });

    it.each(["private_key", "key_path", "path"])(
      "refuses a create payload carrying %s before it can reach main",
      async (key) => {
        const ctx = context();
        const result = await dispatchCommand(
          { ...create, payload: { ...create.payload, [key]: "not-a-private-key" } },
          ctx,
        );

        expect(result).toMatchObject({ ok: false, reason: "unexpected_payload_field" });
        expect(ctx.hosts).toHaveLength(0);
      },
    );

    it("returns exactly public create fields, never a private key or path", async () => {
      const ctx = context();
      const result = await dispatchCommand(create, ctx);
      const fields = Object.keys(result.data ?? {}).sort();

      // Six now, and the two additions are both public by construction:
      // `authorized_keys_line` is the same public half with the restriction
      // that makes DASH's key unable to run anything but the helper (MAR-573),
      // and `resumed` says whether this call attached to a server DASH already
      // had rather than minting a second key for it (MAR-572).
      expect(fields).toEqual([
        "authorized_keys_line",
        "host_id",
        "key_name",
        "label",
        "public_key",
        "resumed",
      ]);
      expect(fields).not.toContain("private_key");
      expect(fields).not.toContain("key_path");
      expect(fields).not.toContain("path");
      expect(JSON.stringify(result.data)).not.toContain("PRIVATE KEY");
    });

    it("requires a host id to probe, deploy or forget", async () => {
      const ctx = context();
      for (const command of ["host.probe", "host.deploy", "host.forget"] as const) {
        const result = await dispatchCommand({ command, request_id: `${command}-missing` }, ctx);
        expect(result).toMatchObject({ ok: false, reason: "missing_payload_field" });
      }
      expect(ctx.hosts).toHaveLength(0);
    });

    it("routes a deploy with only the two stored identities and renders its result", async () => {
      const ctx = context();
      const result = await dispatchCommand(
        {
          command: "host.deploy",
          request_id: "req-host-deploy",
          payload: { host_id: "host-fake-1", agent_id: "fixture-agent" },
        },
        ctx,
      );

      expect(ctx.hosts).toEqual([
        {
          action: "deploy",
          target: { host_id: "host-fake-1", agent_id: "fixture-agent" },
        },
      ]);
      expect(result).toMatchObject({
        ok: true,
        detail: "The agent is running on My server.",
        data: {
          host_id: "host-fake-1",
          agent_id: "fixture-agent",
          bundle_id: "fixture-agent",
          runner_build: "fixture",
        },
      });
    });

    it("routes a run with both stored identities — the agent id must survive dispatch", async () => {
      /*
       * The regression Henrik found with one press (2026-08-11): the dispatch
       * chain special-cased create/deploy/trust and dropped every other
       * command to a host-id-only target, so `host.run` — added after the
       * chain was written — lost its agent id between a payload that required
       * it and a main that refused without it. The deploy test above never
       * covered it because deploy had its own arm.
       */
      const ctx = context();
      const result = await dispatchCommand(
        {
          command: "host.run",
          request_id: "req-host-run",
          payload: { host_id: "host-fake-1", agent_id: "fixture-agent" },
        },
        ctx,
      );

      expect(ctx.hosts).toEqual([
        {
          action: "run",
          target: { host_id: "host-fake-1", agent_id: "fixture-agent" },
        },
      ]);
      expect(result).toMatchObject({ ok: true });
    });

    it.each([
      {
        command: "host.create",
        payload: { label: "My server", address: "vps.example.com", username: "dash", port: 22 },
        action: "create",
        target: { label: "My server", address: "vps.example.com", username: "dash", port: 22 },
        result: {
          data: {
            host_id: "host-fake-1",
            label: "My server",
            public_key: "ssh-ed25519 AAAA-public orchestratedash",
            key_name: "host-fake-1",
            authorized_keys_line:
              'restrict,command="/opt/orchestratedash/dash-host" ssh-ed25519 AAAA-public orchestratedash',
            resumed: false,
          },
        },
      },
      {
        command: "host.probe",
        payload: { host_id: "host-fake-1" },
        action: "probe",
        target: { host_id: "host-fake-1" },
        result: {
          data: {
            host_id: "host-fake-1",
            label: "My server",
            runner_build: "fixture",
            agents_running: 2,
            agents_there: [{ agent_id: "News Scout", running: true }],
          },
        },
      },
      {
        command: "host.trust",
        payload: { host_id: "host-fake-1", fingerprint: "SHA256:fixture" },
        action: "trust",
        target: { host_id: "host-fake-1", fingerprint: "SHA256:fixture" },
        result: { data: { host_id: "host-fake-1", label: "My server", fingerprint: "SHA256:fixture" } },
      },
      {
        command: "host.setup",
        payload: { host_id: "host-fake-1" },
        action: "setup",
        target: { host_id: "host-fake-1" },
        result: { data: { host_id: "host-fake-1", label: "My server", script: "#!/bin/sh\nexit 0\n" } },
      },
      {
        command: "host.deploy",
        payload: { host_id: "host-fake-1", agent_id: "fixture-agent" },
        action: "deploy",
        target: { host_id: "host-fake-1", agent_id: "fixture-agent" },
        result: {
          detail: "The agent is running on My server.",
          data: {
            host_id: "host-fake-1",
            label: "My server",
            agent_id: "fixture-agent",
            bundle_id: "fixture-agent",
            runner_build: "fixture",
          },
        },
      },
      {
        command: "host.run",
        payload: { host_id: "host-fake-1", agent_id: "fixture-agent" },
        action: "run",
        target: { host_id: "host-fake-1", agent_id: "fixture-agent" },
        result: {
          detail:
            "My server was asked to start this agent. DASH will show what it did the next time it can reach that server, and only what the server still has then.",
          data: {
            host_id: "host-fake-1",
            label: "My server",
            agent_id: "fixture-agent",
            reached: true,
          },
        },
      },
      {
        command: "host.bringHome",
        payload: { host_id: "host-fake-1", agent_id: "fixture-agent" },
        action: "bringHome",
        target: { host_id: "host-fake-1", agent_id: "fixture-agent" },
        result: {
          detail:
            "This agent is no longer on My server. Everything that server still had is on this computer now. It had no files there to bring back.",
          data: {
            host_id: "host-fake-1",
            label: "My server",
            agent_id: "fixture-agent",
            files_saved: 0,
          },
        },
      },
      {
        command: "host.forget",
        payload: { host_id: "host-fake-1" },
        action: "forget",
        target: { host_id: "host-fake-1" },
        result: { data: { host_id: "host-fake-1", label: "My server" } },
      },
    ])("maps $command's target and successful result", async ({ command, payload, action, target, result }) => {
      expect(Object.keys(HOST_ACTIONS)).toEqual([
        "host.create",
        "host.probe",
        "host.trust",
        "host.setup",
        "host.deploy",
        "host.run",
        "host.bringHome",
        "host.forget",
      ]);
      const ctx = context();
      const response = await dispatchCommand(
        { command, request_id: `req-${action}`, payload },
        ctx,
      );

      expect(ctx.hosts).toEqual([{ action, target }]);
      expect(response).toEqual({ ok: true, request_id: `req-${action}`, ...result });
    });

    it("renders the manifest-only refusal verbatim", async () => {
      const ctx = context();

      const result = await dispatchCommand(
        {
          command: "host.deploy",
          request_id: "req-host-manifest-only",
          payload: { host_id: "host-fake-1", agent_id: "manifest-only-agent" },
        },
        {
          ...ctx,
          hostAction: () =>
            Promise.resolve({ ok: false as const, detail: MANIFEST_ONLY_DEPLOY_REFUSAL }),
        },
      );

      expect(result).toEqual({
        ok: false,
        request_id: "req-host-manifest-only",
        detail: MANIFEST_ONLY_DEPLOY_REFUSAL,
        data: undefined,
      });
    });
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

  describe("multi-account fleet commands", () => {
    it("binds a default to the fleet principal and an assignment to the named agent", async () => {
      const ctx = context();
      await dispatchCommand(
        {
          command: "fleet.default",
          request_id: "req-fleet-default",
          payload: { provider: "google-gmail", account_id: "account-2" },
        },
        ctx,
      );
      await dispatchCommand(
        {
          command: "fleet.assign",
          request_id: "req-fleet-assign",
          payload: {
            provider: "google-gmail",
            account_id: "account-2",
            agent_id: "news-scout",
          },
        },
        ctx,
      );

      expect(ctx.connections).toEqual([
        {
          action: "default",
          target: {
            agent_id: "dash.fleet",
            connection_id: "google-gmail",
            field_id: "account-2",
          },
        },
        {
          action: "assign",
          target: {
            agent_id: "news-scout",
            connection_id: "google-gmail",
            field_id: "account-2",
          },
        },
      ]);
      expect(ctx.audited.map((one) => one.payload_keys)).toEqual([
        ["provider", "account_id"],
        ["provider", "account_id", "agent_id"],
      ]);
    });

    it.each(["account", "email", "token", "secret"])(
      "refuses an assignment carrying a %s value",
      async (key) => {
        const ctx = context();
        const result = await dispatchCommand(
          {
            command: "fleet.assign",
            request_id: "req-fleet-secret",
            payload: {
              provider: "google-gmail",
              account_id: "account-2",
              agent_id: "news-scout",
              [key]: "person@example.com",
            },
          },
          ctx,
        );
        expect(result).toMatchObject({ ok: false, reason: "unexpected_payload_field" });
        expect(ctx.connections).toHaveLength(0);
      },
    );
  });

  /**
   * The task workspace (MAR-507).
   *
   * The property worth a suite of its own is that **no path crosses this
   * boundary in either direction**. `connection.connect` established the shape:
   * the renderer asks main to *ask*. Here it is sharper — a credential the
   * renderer could name is one page script already held, while a path the
   * renderer could name is one nobody chose.
   */
  describe("workspace commands", () => {
    const select = {
      command: "workspace.selectInput",
      request_id: "req-ws",
      payload: { agent_id: "ledger-reporter", task_id: "task-1", role_id: "customer_brief" },
    };

    it("routes to the workspace side and not to the agent, runner or vault", async () => {
      const ctx = context();
      const result = await dispatchCommand(select, ctx);

      expect(result).toMatchObject({ ok: true, detail: "select_input ok" });
      expect(ctx.workspaces).toEqual([
        {
          action: "select_input",
          target: {
            agent_id: "ledger-reporter",
            task_id: "task-1",
            role_id: "customer_brief",
            run_id: undefined,
          },
        },
      ]);
      expect(ctx.inputs).toHaveLength(0);
      expect(ctx.lifecycle).toHaveLength(0);
      expect(ctx.connections).toHaveLength(0);
    });

    it.each(["source_path", "path", "file", "directory"])(
      "refuses a selection that names a %s",
      async (key) => {
        /*
         * The rule this feature exists under. `payload_keys` declares three
         * fields and none of them can hold a location, so the boundary refuses
         * the whole request rather than dropping the extra one — exactly as it
         * does for a credential field on a connect.
         */
        const ctx = context();
        const result = await dispatchCommand(
          { ...select, payload: { ...select.payload, [key]: "C:\\Users\\henri\\secrets.txt" } },
          ctx,
        );

        expect(result).toMatchObject({ ok: false, reason: "unexpected_payload_field" });
        expect(ctx.workspaces).toHaveLength(0);
      },
    );

    it("refuses a selection that does not name all three parts of its target", async () => {
      const ctx = context();
      const result = await dispatchCommand(
        { ...select, payload: { agent_id: "ledger-reporter", task_id: "task-1" } },
        ctx,
      );

      expect(result).toMatchObject({ ok: false, reason: "missing_payload_field" });
      expect(ctx.workspaces).toHaveLength(0);
    });

    it("opens a task with an agent and nothing else", async () => {
      const ctx = context();
      const result = await dispatchCommand(
        {
          command: "workspace.openTask",
          request_id: "req-ws-2",
          payload: { agent_id: "ledger-reporter" },
        },
        ctx,
      );

      expect(result).toMatchObject({ ok: true, data: { task_id: "task-fake-1" } });
      expect(ctx.workspaces[0]?.action).toBe("open_task");
    });

    it("dispatches a task by naming a run", async () => {
      const ctx = context();
      await dispatchCommand(
        {
          command: "workspace.dispatchTask",
          request_id: "req-ws-3",
          payload: { agent_id: "ledger-reporter", task_id: "task-1", run_id: "run-9" },
        },
        ctx,
      );

      expect(ctx.workspaces[0]).toMatchObject({
        action: "dispatch_task",
        target: { run_id: "run-9" },
      });
    });

    it("audits the workspace command with keys only", async () => {
      const ctx = context();
      await dispatchCommand(select, ctx);

      expect(ctx.audited[0]).toMatchObject({
        command: "workspace.selectInput",
        decision: "allowed",
        payload_keys: ["agent_id", "task_id", "role_id"],
        mutates: true,
      });
    });

    it("refuses to execute one without the trusted side", () => {
      // Performing one opens a file picker, which the pure module cannot do and
      // must not appear to.
      expect(() => executeCommand(reviewCommand(select))).toThrowError(
        /must go through dispatchCommand/,
      );
    });
  });

  /**
   * MAR-434's `workspace.download`, and the property worth pinning is what its
   * payload *cannot* say.
   *
   * The runner is the only process that resolves an opaque artifact id to a
   * place on disk — `runner/workspace.ts` refuses to return `stored_path` for
   * that reason — and this is the surface that finally calls it. A path in
   * either direction would undo the argument at the point it starts to matter.
   */
  describe("saving an output (MAR-434)", () => {
    const download = {
      command: "workspace.download",
      request_id: "req-dl-1",
      payload: { agent_id: "ai-news-scout", artifact_id: "artifact-9f2c" },
    };

    it("routes to the workspace side and not to the agent, the runner or a connection", async () => {
      const ctx = context();
      const result = await dispatchCommand(download, ctx);

      expect(result).toMatchObject({ ok: true });
      expect(ctx.downloads).toEqual([
        {
          action: "download",
          target: { agent_id: "ai-news-scout", artifact_id: "artifact-9f2c" },
        },
      ]);
      expect(ctx.inputs).toHaveLength(0);
      expect(ctx.lifecycle).toHaveLength(0);
      expect(ctx.connections).toHaveLength(0);
    });

    it.each(["path", "destination", "source_path", "stored_path", "directory"])(
      "refuses a download carrying a %s field",
      async (key) => {
        const ctx = context();
        const result = await dispatchCommand(
          { ...download, payload: { ...download.payload, [key]: "C:\\Users\\someone\\Desktop" } },
          ctx,
        );

        expect(result).toMatchObject({ ok: false, reason: "unexpected_payload_field" });
        expect(ctx.downloads).toHaveLength(0);
      },
    );

    it("refuses a download that names no artifact", async () => {
      const ctx = context();
      const result = await dispatchCommand(
        { command: "workspace.download", request_id: "req-dl-2", payload: { agent_id: "a" } },
        ctx,
      );

      expect(result).toMatchObject({ ok: false, reason: "missing_payload_field" });
      expect(ctx.downloads).toHaveLength(0);
    });

    /**
     * Audited like everything else on this channel, and recorded as changing
     * nothing — which is true of the agent, the store and the world the agent
     * acts on. The file it writes goes where the user just pointed.
     */
    it("is audited, with keys only, and recorded as changing nothing", async () => {
      const ctx = context();
      await dispatchCommand(download, ctx);

      expect(ctx.audited[0]).toMatchObject({
        command: "workspace.download",
        decision: "allowed",
        payload_keys: ["agent_id", "artifact_id"],
        mutates: false,
      });
    });

    it("refuses to execute one without the trusted side", () => {
      expect(() => executeCommand(reviewCommand(download))).toThrowError(
        /must go through dispatchCommand/,
      );
    });
  });

  /**
   * MAR-576's `sample.refresh`, and the property worth pinning is the same
   * shape as the download above: what its payload *cannot* say.
   *
   * This is the only command in DASH that can overwrite an agent's manifest —
   * the document every other surface treats as the author's and never edits. So
   * the boundary that matters is that the renderer names an *agent* and never a
   * document: it can ask DASH to regenerate one from DASH's own template, and
   * has no way to supply the template, the version, or a manifest of its own.
   * Whether that agent is one DASH may regenerate at all is main's decision,
   * taken against the stored manifest's own provenance, which is why the fake
   * here records rather than judges.
   */
  describe("re-importing an agent DASH created (MAR-576)", () => {
    const refresh = {
      command: "sample.refresh",
      request_id: "req-refresh-1",
      payload: { agent_id: "ai-news-scout" },
    };

    it("routes to the sample side and not to the agent, the runner or the workspace", async () => {
      const ctx = context();
      const result = await dispatchCommand(refresh, ctx);

      expect(result).toMatchObject({ ok: true });
      expect(ctx.samples).toEqual([
        { action: "refresh", target: { agent_id: "ai-news-scout" } },
      ]);
      expect(ctx.inputs).toHaveLength(0);
      expect(ctx.lifecycle).toHaveLength(0);
      expect(ctx.connections).toHaveLength(0);
      expect(ctx.workspaces).toHaveLength(0);
    });

    it.each(["manifest", "manifest_json", "template", "kit_version", "path", "directory"])(
      "refuses a refresh carrying a %s field",
      async (key) => {
        const ctx = context();
        const result = await dispatchCommand(
          { ...refresh, payload: { ...refresh.payload, [key]: "anything at all" } },
          ctx,
        );

        expect(result).toMatchObject({ ok: false, reason: "unexpected_payload_field" });
        expect(ctx.samples).toHaveLength(0);
      },
    );

    it("refuses a refresh that names no agent", async () => {
      const ctx = context();
      const result = await dispatchCommand(
        { command: "sample.refresh", request_id: "req-refresh-2", payload: {} },
        ctx,
      );

      expect(result).toMatchObject({ ok: false, reason: "missing_payload_field" });
      expect(ctx.samples).toHaveLength(0);
    });

    /**
     * Recorded as mutating, unlike `workspace.download` above — this one really
     * does replace a stored document.
     *
     * `irreversible` is asserted on the catalogue rather than on this record,
     * because the IPC audit record does not carry it: `CommandAuditRecord` holds
     * `mutates` and stops there. Asserting it here would have been a test
     * agreeing with a field it had invented.
     */
    it("is audited, with keys only, and recorded as changing the store", async () => {
      const ctx = context();
      await dispatchCommand(refresh, ctx);

      expect(ctx.audited[0]).toMatchObject({
        command: "sample.refresh",
        decision: "allowed",
        payload_keys: ["agent_id"],
        mutates: true,
      });
      // Nothing happens in the world, and the agent's identity, runs, outputs
      // and credentials all survive — see the catalogue entry's own reasoning.
      expect(COMMANDS["sample.refresh"].irreversible).toBe(false);
    });

    it("refuses to execute one without the trusted side", () => {
      expect(() => executeCommand(reviewCommand(refresh))).toThrowError(
        /must go through dispatchCommand/,
      );
    });
  });

  /**
   * `identity.rename` (MAR-589): a name DASH itself owns for one agent.
   *
   * `display_name`'s absence is the whole vocabulary for "put this back" —
   * `reviewCommand`'s "present but absent" rule already refuses an *empty*
   * string, so the one way to clear a rename is to omit the field, and that is
   * the case worth pinning here rather than trusting the renderer's own
   * `dropUnset` to have done it.
   */
  describe("renaming an agent (MAR-589)", () => {
    const rename = {
      command: "identity.rename",
      request_id: "req-rename-1",
      payload: { agent_id: "ai-news-scout", display_name: "News Scout" },
    };

    it("routes to the identity side and not to the agent, the runner or the sample side", async () => {
      const ctx = context();
      const result = await dispatchCommand(rename, ctx);

      expect(result).toMatchObject({ ok: true });
      expect(ctx.renames).toEqual([
        {
          action: "rename",
          target: { agent_id: "ai-news-scout", display_name: "News Scout" },
        },
      ]);
      expect(ctx.samples).toHaveLength(0);
      expect(ctx.lifecycle).toHaveLength(0);
    });

    it("clears a rename when display_name is absent, not empty", async () => {
      const ctx = context();
      const result = await dispatchCommand(
        { command: "identity.rename", request_id: "req-rename-2", payload: { agent_id: "ai-news-scout" } },
        ctx,
      );

      expect(result).toMatchObject({ ok: true });
      expect(ctx.renames).toEqual([
        { action: "rename", target: { agent_id: "ai-news-scout", display_name: undefined } },
      ]);
    });

    it("refuses an empty display_name rather than reading it as a clear", () => {
      const review = reviewCommand({
        command: "identity.rename",
        request_id: "req-rename-3",
        payload: { agent_id: "ai-news-scout", display_name: "" },
      });
      expect(review.decision).toBe("denied");
      expect((review as { reason: string }).reason).toBe("missing_payload_field");
    });

    it("refuses a rename that names no agent", async () => {
      const ctx = context();
      const result = await dispatchCommand(
        { command: "identity.rename", request_id: "req-rename-4", payload: {} },
        ctx,
      );

      expect(result).toMatchObject({ ok: false, reason: "missing_payload_field" });
      expect(ctx.renames).toHaveLength(0);
    });

    it("surfaces a refusal from the trusted side, such as an unknown agent", async () => {
      const ctx = context();
      const failing = {
        ...ctx,
        agentAction: () => Promise.resolve({ ok: false, refusal: "DASH has no record of that agent." }),
      };
      const result = await dispatchCommand(rename, failing);
      expect(result).toMatchObject({ ok: false, reason: "DASH has no record of that agent." });
    });

    it("is audited, with keys only, and recorded as changing the store", async () => {
      const ctx = context();
      await dispatchCommand(rename, ctx);

      expect(ctx.audited[0]).toMatchObject({
        command: "identity.rename",
        decision: "allowed",
        payload_keys: ["agent_id", "display_name"],
        mutates: true,
      });
      expect(COMMANDS["identity.rename"].irreversible).toBe(false);
    });

    it("refuses to execute one without the trusted side", () => {
      expect(() => executeCommand(reviewCommand(rename))).toThrowError(
        /must go through dispatchCommand/,
      );
    });
  });

  /**
   * `identity.favourite` (MAR-640): whether the reader has starred one
   * agent. `identity.rename`'s sibling, and `favourite` has no absent state —
   * unlike `display_name` there is nothing for an omission to mean, so it is
   * a required boolean rather than an optional string.
   */
  describe("starring an agent (MAR-640)", () => {
    const star = {
      command: "identity.favourite",
      request_id: "req-favourite-1",
      payload: { agent_id: "ai-news-scout", favourite: true },
    };

    it("routes to the identity side and not to the agent, the runner or the sample side", async () => {
      const ctx = context();
      const result = await dispatchCommand(star, ctx);

      expect(result).toMatchObject({ ok: true });
      expect(ctx.renames).toEqual([
        {
          action: "favourite",
          target: { agent_id: "ai-news-scout", display_name: undefined, favourite: true },
        },
      ]);
      expect(ctx.samples).toHaveLength(0);
      expect(ctx.lifecycle).toHaveLength(0);
    });

    it("unstars with favourite: false, which is not the same as absent", async () => {
      const ctx = context();
      const result = await dispatchCommand(
        {
          command: "identity.favourite",
          request_id: "req-favourite-2",
          payload: { agent_id: "ai-news-scout", favourite: false },
        },
        ctx,
      );

      expect(result).toMatchObject({ ok: true });
      expect(ctx.renames).toEqual([
        { action: "favourite", target: { agent_id: "ai-news-scout", display_name: undefined, favourite: false } },
      ]);
    });

    it("refuses a request with no favourite value at all", () => {
      const review = reviewCommand({
        command: "identity.favourite",
        request_id: "req-favourite-3",
        payload: { agent_id: "ai-news-scout" },
      });
      expect(review.decision).toBe("denied");
      expect((review as { reason: string }).reason).toBe("missing_payload_field");
    });

    it("refuses a star that names no agent", async () => {
      const ctx = context();
      const result = await dispatchCommand(
        {
          command: "identity.favourite",
          request_id: "req-favourite-4",
          payload: { favourite: true },
        },
        ctx,
      );

      expect(result).toMatchObject({ ok: false, reason: "missing_payload_field" });
      expect(ctx.renames).toHaveLength(0);
    });

    it("is audited, with keys only, and recorded as changing the store", async () => {
      const ctx = context();
      await dispatchCommand(star, ctx);

      expect(ctx.audited[0]).toMatchObject({
        command: "identity.favourite",
        decision: "allowed",
        payload_keys: ["agent_id", "favourite"],
        mutates: true,
      });
      expect(COMMANDS["identity.favourite"].irreversible).toBe(false);
    });

    it("refuses to execute one without the trusted side", () => {
      expect(() => executeCommand(reviewCommand(star))).toThrowError(
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
