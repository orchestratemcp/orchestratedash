/**
 * The narrow preload.
 *
 * ADR 0001's standing obligation is "a narrow preload" — narrow meaning the
 * renderer gets named, fixed operations and nothing generic. What is
 * deliberately *not* exposed matters more than what is:
 *
 * - not `ipcRenderer` itself, and not `invoke` — either would let page script
 *   address any channel, which is the whole attack;
 * - not the channel name;
 * - nothing that reads, writes or names a secret. `SecureStore` lives in main
 *   and never crosses this boundary.
 *
 * **Two bridges, and they are separate on purpose (MAR-432).** `dashShell`
 * carries effects: every method maps to exactly one entry in `COMMANDS` and
 * reaches it through the single audited channel. `dashData` carries documents,
 * on its own channel, and changes nothing — see `lib/shell/read.ts` for why
 * reads cannot ride the command channel and why they are not audited.
 *
 * They are two objects rather than one with a `read` sub-object so that "can
 * this page do anything, or only look?" is answerable by checking which globals
 * exist. The developer path's browser tab has neither, which is what makes it
 * read-only by construction rather than by discipline.
 */

import { contextBridge, ipcRenderer } from "electron";

import { SHELL_COMMAND_CHANNEL } from "../lib/shell/ipc";
import type { CommandResult } from "../lib/shell/ipc";
import { SHELL_READ_CHANNEL } from "../lib/shell/read";
import type { DashReadApi, ReadResponse, ReadResults } from "../lib/shell/read";

/**
 * Request ids are generated here rather than in main so the renderer can
 * correlate its own call with the reply. They are opaque and carry no meaning —
 * a UUID, not anything derived from the user or the machine.
 */
function requestId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * What the renderer may say about an agent command.
 *
 * Note what is not here and cannot be added by a caller: an actor, a nonce, an
 * expiry, a correlation id, an idempotency key. Those are minted in main. The
 * renderer's whole vocabulary is "which thing, and which snapshot was I looking
 * at when I decided" — `observed_at` being the snapshot the control was
 * rendered from, which is what lets main tell a double click apart from a
 * deliberate second attempt.
 */
interface AgentCommandArgs {
  agent_id: string;
  observed_at: string;
  run_id?: string;
  task_id?: string;
  approval_id?: string;
  action_id?: string;
  choice_id?: string;
  option_id?: string;
  reason?: string;
}

/**
 * What the renderer may say about a connection command (MAR-383).
 *
 * Three ids and nothing else. There is deliberately no field for a value, and
 * adding one would be refused at the boundary anyway — `connection.connect`
 * declares exactly these three payload keys.
 */
interface ConnectionArgs {
  agent_id: string;
  connection_id: string;
  field_id: string;
}

/**
 * The four facts a page may offer for a server. Main mints both opaque names
 * and the key; there is deliberately no key, key-name or path field here.
 */
interface HostCreateArgs {
  label: string;
  address: string;
  username: string;
  port: number;
}

/** A saved host is addressed by DASH's opaque id, never by a filesystem path. */
interface HostTarget {
  host_id: string;
}

/** The page chooses two stored identities and no file, command or path. */
interface HostDeployTarget extends HostTarget {
  agent_id: string;
}

/**
 * A saved host plus the identity code the person was shown (MAR-572).
 *
 * The fingerprint is a fact about the *server's* key. It names nothing on this
 * machine, and it travels this way — back through the same boundary it came
 * out of — so that main can check what is answering now against what was on
 * screen when somebody said yes.
 */
interface HostTrustTarget extends HostTarget {
  fingerprint: string;
}

function send(command: string, payload: Record<string, string>): Promise<CommandResult> {
  return ipcRenderer.invoke(SHELL_COMMAND_CHANNEL, {
    command,
    request_id: requestId(),
    payload,
  }) as Promise<CommandResult>;
}

/**
 * The same call for a payload of numbers (MAR-440).
 *
 * A separate function rather than widening `send`'s value type, so that every
 * existing caller stays constrained to strings and only the one command that
 * needs a coordinate can send one.
 */
function sendNumbers(command: string, payload: Record<string, number>): Promise<CommandResult> {
  return ipcRenderer.invoke(SHELL_COMMAND_CHANNEL, {
    command,
    request_id: requestId(),
    payload,
  }) as Promise<CommandResult>;
}

/**
 * A mixed string/number payload for the host-creation form.
 *
 * Kept separate from `send` so existing methods stay string-only and so this
 * is the one place a page can name a port. Every field is copied explicitly:
 * spreading the caller's object would let a page pass a private key or path to
 * the command boundary merely to have it refused later.
 */
function sendHostCreate(args: HostCreateArgs): Promise<CommandResult> {
  return ipcRenderer.invoke(SHELL_COMMAND_CHANNEL, {
    command: "host.create",
    request_id: requestId(),
    payload: {
      label: args.label,
      address: args.address,
      username: args.username,
      port: args.port,
    },
  }) as Promise<CommandResult>;
}

/**
 * One step's level, as a mixed string/number payload (MAR-583).
 *
 * `sendHostCreate`'s shape and its rule: every field copied explicitly, so a
 * page cannot put anything at the command boundary merely to have it refused
 * later. It is the second command in DASH that carries a number and the second
 * function here that can send one, rather than `send` being widened — which
 * would let every string-only method start carrying numbers on the day one of
 * them needed to.
 */
function sendStepLevel(args: {
  agent_id: string;
  step: number;
  level?: string;
}): Promise<CommandResult> {
  return ipcRenderer.invoke(SHELL_COMMAND_CHANNEL, {
    command: "model.step",
    request_id: requestId(),
    payload:
      args.level === undefined
        ? { agent_id: args.agent_id, step: args.step }
        : { agent_id: args.agent_id, step: args.step, level: args.level },
  }) as Promise<CommandResult>;
}

/**
 * A schedule and its ceiling, as a mixed string/number payload (MAR-784).
 *
 * `sendStepLevel`'s shape and its rule, which is now stated for the third time
 * and holds for the third reason: every field copied explicitly, so a page
 * cannot put anything at the command boundary merely to have it refused later,
 * and `send` stays string-only so that no existing method starts carrying
 * numbers because one of them needed to.
 *
 * That matters more here than for either of the two before it. This payload's
 * number is a **ceiling on somebody's model spending**, and the failure this
 * function exists to make impossible is a renderer passing `allowance_calls`
 * through a string-typed sender, having it arrive as `"2"`, and being refused at
 * the seam at three in the morning rather than in an editor.
 */
function sendSchedule(args: {
  agent_id: string;
  at_local: string;
  allowance_calls: number;
}): Promise<CommandResult> {
  return ipcRenderer.invoke(SHELL_COMMAND_CHANNEL, {
    command: "schedule.set",
    request_id: requestId(),
    payload: {
      agent_id: args.agent_id,
      at_local: args.at_local,
      allowance_calls: args.allowance_calls,
    },
  }) as Promise<CommandResult>;
}

/**
 * Drop the optional fields a caller left unset (MAR-583).
 *
 * `fields` above does the same for the Agent DOM commands, from an allowlist of
 * keys. This one works over a caller's own object because the three model
 * methods each declare their own shape in the API type above, and the boundary
 * denies a payload key it did not declare either way. What it buys is that an
 * absent value stays absent: sending `model_id: undefined` would serialise to a
 * key with no value, and an empty string is exactly what `dispatchCommand` reads
 * as "not set" — so the two agree instead of relying on one of them being right.
 */
function dropUnset(args: Record<string, string | undefined>): Record<string, string> {
  const payload: Record<string, string> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value !== undefined) {
      payload[key] = value;
    }
  }
  return payload;
}

/**
 * The first of two commands whose payload carries a boolean (MAR-588,
 * MAR-640).
 *
 * Its own function for `sendHostCreate`'s reason: `send` stays string-only,
 * so every caller but this one and `sendFavourite` below is constrained by
 * its type rather than by convention, and each place a page can put a `true`
 * on the command channel is one a reviewer finds by name. Both fields are
 * copied explicitly rather than spread.
 */
function sendNotificationKind(kind: string, enabled: boolean): Promise<CommandResult> {
  return ipcRenderer.invoke(SHELL_COMMAND_CHANNEL, {
    command: "notify.setKind",
    request_id: requestId(),
    payload: { kind, enabled },
  }) as Promise<CommandResult>;
}

/**
 * The second (MAR-640). `sendNotificationKind`'s reason exactly, for a
 * payload of one id and one boolean rather than two strings and a boolean.
 */
/**
 * The third (MAR-479). `sendNotificationKind`'s reason again, for a payload of
 * one boolean and nothing else — the whole of what a renderer may say about the
 * one setting that lets anything leave this machine.
 */
function sendLabEnabled(enabled: boolean): Promise<CommandResult> {
  return ipcRenderer.invoke(SHELL_COMMAND_CHANNEL, {
    command: "lab.setEnabled",
    request_id: requestId(),
    payload: { enabled },
  }) as Promise<CommandResult>;
}

/**
 * The fourth (MAR-743). `sendNotificationKind`'s reason once more, for the two
 * Discord ids that say which room the chief answers in and whose messages it
 * hears. Both fields are copied explicitly rather than spread, so a caller that
 * put a third key on its argument cannot get it onto the command channel.
 */
function sendChiefDiscordConnect(
  channelId: string,
  allowedUserId: string,
): Promise<CommandResult> {
  return ipcRenderer.invoke(SHELL_COMMAND_CHANNEL, {
    command: "chiefDiscord.connect",
    request_id: requestId(),
    payload: { channel_id: channelId, allowed_user_id: allowedUserId },
  }) as Promise<CommandResult>;
}

function sendChiefDiscordEnabled(enabled: boolean): Promise<CommandResult> {
  return ipcRenderer.invoke(SHELL_COMMAND_CHANNEL, {
    command: "chiefDiscord.setEnabled",
    request_id: requestId(),
    payload: { enabled },
  }) as Promise<CommandResult>;
}

function sendFavourite(agentId: string, favourite: boolean): Promise<CommandResult> {
  return ipcRenderer.invoke(SHELL_COMMAND_CHANNEL, {
    command: "identity.favourite",
    request_id: requestId(),
    payload: { agent_id: agentId, favourite },
  }) as Promise<CommandResult>;
}

/** Drop unset optional fields: the boundary denies a payload key it did not declare. */
function fields(args: AgentCommandArgs, keys: readonly (keyof AgentCommandArgs)[]): Record<string, string> {
  const payload: Record<string, string> = {};
  for (const key of keys) {
    const value = args[key];
    if (value !== undefined) {
      payload[key] = value;
    }
  }
  return payload;
}

const RUN_FIELDS = ["agent_id", "observed_at", "run_id", "task_id", "reason"] as const;
const APPROVAL_FIELDS = [
  "agent_id",
  "observed_at",
  "task_id",
  "approval_id",
  "action_id",
  "reason",
] as const;
const CHOICE_FIELDS = ["agent_id", "observed_at", "task_id", "choice_id", "option_id"] as const;

const dashShell = {
  /**
   * Proves the boundary end to end — preload to review to audit to reply —
   * while doing nothing at all.
   */
  ping(): Promise<CommandResult> {
    return send("shell.ping", { issued_at: new Date().toISOString() });
  },

  /**
   * Show the application menu, under the button the user pressed (MAR-440).
   *
   * The bar is ours since the native one was hidden; the menu behind it is
   * still main's. This carries two numbers and cannot name an item, so pressing
   * the button is a request to *display*, never to invoke — which is what keeps
   * "the renderer cannot reach a menu action directly" true after the bar it
   * used to reach them through stopped being drawn.
   */
  openAppMenu(at?: { x: number; y: number }): Promise<CommandResult> {
    return sendNumbers("shell.menu", at === undefined ? {} : { x: at.x, y: at.y });
  },
  setUiScale: (factor?: number) =>
    sendNumbers("shell.scale", factor === undefined ? {} : { factor }),
  /**
   * Colour the chrome Electron draws, to match the palette the page is in
   * (MAR-642).
   *
   * One string from a closed set, and main narrows it again to one of three
   * literals before it reaches `nativeTheme` — so what page script can ask for
   * is "light", "dark" or "the computer's", and nothing else.
   */
  setTheme: (theme: string) => send("shell.theme", { theme }),

  /**
   * Where the supervision panel is, so main can paint the watched browser
   * there (MAR-628, ADR 0019).
   *
   * `sendNumbers`, like `openAppMenu` and `setUiScale`, and here that is not a
   * convenience — four numbers is the entire vocabulary. The renderer cannot
   * name a session, an address, an agent's origins or an operation, so what
   * page script can ask for is "put it in this rectangle" and nothing else.
   */
  setBrowserViewport: (bounds: { x: number; y: number; width: number; height: number }) =>
    sendNumbers("browser.viewport", bounds),

  /**
   * Stop the browser DASH opened for one agent (MAR-628, ADR 0019).
   *
   * The person's half of revocation, and the only half there is: no operation
   * in `lib/browser/protocol.ts` lets an agent stop, start or notice a
   * revocation except by being refused. What crosses is an agent name; main
   * resolves the session from the agent it is already tracking.
   */
  stopBrowser: (agent: string) => send("browser.stop", { agent }),

  /**
   * The seven Agent DOM commands, one named method each.
   *
   * One method per command rather than a single `command(name, payload)`: a
   * generic method would let page script address any entry in the catalogue,
   * including ones added later for something else, which is the same argument
   * that keeps `invoke` and the channel name off this object.
   */
  /**
   * The three connection commands (MAR-383).
   *
   * `connect` asks main to *ask* the user for a credential — it does not carry
   * one, cannot be given one, and does not receive one back. The value is typed
   * into a window main opens with a different preload
   * (`electron/credential-preload.ts`), so the bridge this file exposes still
   * satisfies the rule at the top: nothing here reads, writes or names a secret.
   *
   * Named methods for the same reason as everything above. Three entries a
   * reviewer can count beats a `connection(action, target)` that would let page
   * script address whatever the fourth one turns out to be.
   */
  connectConnection: (args: ConnectionArgs) => send("connection.connect", { ...args }),
  testConnection: (args: ConnectionArgs) => send("connection.test", { ...args }),
  disconnectConnection: (args: ConnectionArgs) => send("connection.disconnect", { ...args }),

  /**
   * The four fleet commands (MAR-593, ADR 0013).
   *
   * The same discipline one line up, on a target that names no agent: each
   * carries a provider and nothing else. Page script cannot name the principal a
   * fleet act stands under — `lib/shell/ipc.ts` supplies it — so it can neither
   * aim a fleet act at an agent nor an agent act at the fleet.
   *
   * `shareFleet` is the only one of the four that opens no window and contacts
   * nobody: it hands agents a consent DASH already holds. It is a separate named
   * method rather than a flag on `connectFleet` for this object's standing
   * reason — a reviewer counting the ways page script can cause a sign-in should
   * find them by name.
   */
  connectFleet: (args: { provider: string; account_id?: string }) =>
    send("fleet.connect", { ...args }),
  testFleet: (args: { provider: string; account_id?: string }) =>
    send("fleet.test", { ...args }),
  disconnectFleet: (args: { provider: string; account_id?: string }) =>
    send("fleet.disconnect", { ...args }),
  shareFleet: (args: { provider: string; account_id?: string }) =>
    send("fleet.share", { ...args }),
  defaultFleet: (args: { provider: string; account_id: string }) =>
    send("fleet.default", { ...args }),
  assignFleet: (args: { provider: string; account_id: string; agent_id: string }) =>
    send("fleet.assign", { ...args }),
  /**
   * Re-read, re-check and re-deliver everything DASH holds (MAR-742).
   *
   * **It takes no arguments, and that is the point rather than an economy.**
   * Every method above names a provider; page script that could name one here
   * would be page script choosing which credentials get read out of the vault
   * and posted to the runner. There is no argument, so there is no choice to
   * make on this side — main acts on what DASH holds.
   *
   * A separate named method rather than a flag on `testFleet`, this object's
   * standing reason: a reviewer counting the ways page script can cause the
   * vault to be opened should find them by name, and this is the widest of
   * them.
   */
  refreshConnections: () => send("fleet.refresh", {}),

  /**
   * The host actions (MAR-536/MAR-556), one named method each.
   *
   * `createHost` receives only ordinary connection facts and returns only the
   * public half of a newly minted key. The private half never enters this
   * preload, and probe/forget take only DASH's opaque host id. Named methods
   * keep a page from addressing a future host action by string.
   */
  createHost: ({ label, address, username, port }: HostCreateArgs) =>
    sendHostCreate({ label, address, username, port }),
  probeHost: ({ host_id }: HostTarget) => send("host.probe", { host_id }),
  /**
   * The first pin, and the setup text (MAR-572, MAR-573).
   *
   * `trustHost` carries the fingerprint the person was shown back to main,
   * which asks the server again and refuses if the two disagree.
   *
   * `hostSetupScript` takes only an id and returns text. It cannot be given a
   * path, a key or a command; what comes back is composed in main from DASH's
   * own public half and the helper this build ships.
   */
  trustHost: ({ host_id, fingerprint }: HostTrustTarget) =>
    send("host.trust", { host_id, fingerprint }),
  hostSetupScript: ({ host_id }: HostTarget) => send("host.setup", { host_id }),
  deployAgentToHost: ({ host_id, agent_id }: HostDeployTarget) =>
    send("host.deploy", { host_id, agent_id }),
  /**
   * Start the copy that is on a server (MAR-602, ADR 0014).
   *
   * Its own named method beside `deployAgentToHost`, taking the same two ids and
   * no third — in particular no task id. A page has never seen the server's
   * snapshot, so it cannot name a target on it; main reads that at the moment of
   * the press and the host adjudicates it again. The renderer says *which agent,
   * on which machine*, and everything about **what** is decided one process over.
   */
  runAgentOnHost: ({ host_id, agent_id }: HostDeployTarget) =>
    send("host.run", { host_id, agent_id }),
  /**
   * Take the copy that is on a server back (MAR-611, ADR 0017).
   *
   * The same two ids again, and — like `downloadOutput` one family over — **no
   * folder in either direction.** Main raises the operating system's own folder
   * dialog, so where an agent's files land is chosen in a window this renderer
   * did not draw and does not learn the answer of. That matters more here than
   * it does for a single download: this writes several files at once, and a
   * renderer that could name the directory would be a page script choosing a
   * destination for bytes it never sees.
   *
   * Its own named method rather than a flag on `deployAgentToHost`, because they
   * are opposite acts and one of them is irreversible.
   */
  bringAgentHome: ({ host_id, agent_id }: HostDeployTarget) =>
    send("host.bringHome", { host_id, agent_id }),
  forgetHost: ({ host_id }: HostTarget) => send("host.forget", { host_id }),

  /**
   * The three task-workspace commands (MAR-507).
   *
   * `selectInput` asks main to *ask* the user for a file. It does not carry a
   * path, cannot be given one, and does not receive one back — the same shape
   * `connectConnection` has and for a sharper reason: a credential this bridge
   * could name is one page script already held, while a path it could name is
   * one nobody chose.
   *
   * What comes back about an admitted file is its own display name and its
   * size, both facts about the copy the runner now owns.
   *
   * Named methods, like everything above. Three a reviewer can count beats a
   * `workspace(action, target)` that would let page script address whatever the
   * fourth one turns out to be.
   */
  openAgentTask: (args: { agent_id: string }) => send("workspace.openTask", { ...args }),
  selectAgentInput: (args: { agent_id: string; task_id: string; role_id: string }) =>
    send("workspace.selectInput", { ...args }),
  dispatchAgentTask: (args: { agent_id: string; task_id: string; run_id: string }) =>
    send("workspace.dispatchTask", { ...args }),
  /**
   * Save one of an agent's outputs where the user asks (MAR-434).
   *
   * Two opaque ids and nothing else. There is no path in the payload and none in
   * the reply: main raises the operating system's own save dialog, so the
   * destination is chosen in a window this renderer did not draw and cannot
   * read. A named method rather than a generic `workspace(action, target)`, for
   * the reason the connection trio above are three methods.
   */
  downloadOutput: (args: { agent_id: string; artifact_id: string }) =>
    send("workspace.download", { ...args }),

  /**
   * Save one briefing as a PDF, and open it (MAR-674, ADR 0025 decision 4).
   *
   * The same two opaque ids as `downloadOutput` and the same absence: no path
   * in the payload and none in the reply. What differs is one process over —
   * main composes the document out of an artifact it already holds and prints
   * it in a window this bridge cannot reach, rather than fetching bytes from
   * the runner.
   *
   * A named method rather than a flag on `downloadOutput`, for the reason the
   * connection trio above are three methods: two names a reviewer can count
   * beat one that branches on an argument.
   */
  exportBriefAsPdf: (args: { agent_id: string; artifact_id: string }) =>
    send("workspace.exportBrief", { ...args }),

  /**
   * Open one address the agent collected, in this computer's browser (MAR-698).
   *
   * The bridge member that makes a link on a card clickable without any part of
   * `createWindow`'s navigation denial being relaxed. This window still cannot
   * navigate off its origin and still cannot open a second one; what it can do
   * is ask main to hand one address to the operating system, and main refuses
   * anything that is not `https`.
   *
   * A named method rather than a flag on something else, for the reason the
   * workspace pair above are two methods: somebody counting the ways out of
   * this window should be able to count them by name.
   */
  openLink: (args: { url: string }) => send("open.link", { ...args }),

  /**
   * Open one file DASH saved for this agent (MAR-697).
   *
   * A **file name**, never a path — the one thing this bridge may say about a
   * document on disk, and it says it about a folder main computed rather than
   * one a page named. That is `downloadOutput`'s rule above pointing the other
   * way: there, no path crosses because main raises the dialog; here, no path
   * crosses because main owns the only folder this name can resolve in.
   */
  openExport: (args: { agent_id: string; file: string }) => send("open.export", { ...args }),

  /**
   * Re-import an agent DASH created, from DASH's current template (MAR-576).
   *
   * One agent id and nothing else. There is no manifest in the payload, no
   * template, no version and no path — page script can ask DASH to refresh an
   * agent *from DASH's own generator*, and cannot hand DASH a document to store.
   * Whether that agent is one DASH may regenerate at all is decided in main,
   * against the stored manifest's own provenance.
   *
   * A named method rather than a generic `sample(action, target)`, for the
   * reason the workspace trio above are three methods: a generic entry point is
   * one whose reachable surface grows without a review.
   */
  refreshSampleAgent: (args: { agent_id: string }) => send("sample.refresh", { ...args }),

  /**
   * The three folder commands (MAR-584).
   *
   * One agent id each and nothing else, for `refreshSampleAgent`'s reason in its
   * strongest form: `adoptFolder` accepts a document *somebody else's editor
   * wrote*, and the one thing page script must never be able to do is supply
   * that document. It cannot. It names an agent; main reads DASH's own folder
   * for that agent and DASH's own record of what it accepted, and the acceptance
   * still goes through the same schema and the same constraints a first import
   * does.
   *
   * `revealFolder` carries no path in either direction. The renderer does not
   * learn where the folder is and could not have named a different one.
   *
   * Three named methods rather than one `folder(action, target)`, like every
   * group above: a generic entry point is one whose reachable surface grows
   * without a review.
   */
  checkFolder: (args: { agent_id: string }) => send("folder.check", { ...args }),
  adoptFolder: (args: { agent_id: string }) => send("folder.adopt", { ...args }),
  revealFolder: (args: { agent_id: string }) => send("folder.reveal", { ...args }),
  /**
   * The fifth (MAR-705): set an agent up again from the copy DASH already keeps.
   *
   * One agent id, exactly like the three above, and the same argument holds in
   * the same strong form: page script cannot supply a plan, a program, a path or
   * a command. It names an agent DASH already has; main reads DASH's own folder
   * for that agent, runs the same schema and the same constraints a first import
   * runs, and asks the person before writing anything.
   *
   * It sits with the three rather than with `chooseFolder` because it names an
   * agent, and its own method rather than a flag on `adoptFolder` because the
   * two write different things — that one refreshes a plan, this one also puts
   * back what starts a program — and a boolean deciding which would be one
   * transposition away from re-pointing the thing that spawns.
   */
  repairAgent: (args: { agent_id: string }) => send("folder.repair", { ...args }),

  /**
   * The fourth folder command, and the only one on this whole bridge that takes
   * nothing at all (MAR-598).
   *
   * **The empty signature is the security story written as a type**, the same
   * way three of the notification methods below are. Page script cannot name a
   * folder, cannot cause any particular folder to be read, and cannot learn
   * which one was offered — it asks main to put the operating system's own
   * chooser on screen, a window this process cannot see, type into or dismiss,
   * and then waits to be told whether a person picked something and agreed to a
   * second dialog.
   *
   * What comes back is a card and, on a refusal, the contract checker's own
   * errors. The card names where DASH put its copy, and that is the one path
   * that crosses this bridge in either direction — outward, deliberately,
   * because a copy nobody can find is a copy nobody can edit.
   */
  chooseAgentFolder: () => send("folder.choose", {}),

  /**
   * The four notification commands (MAR-588).
   *
   * **Three of them take no arguments at all**, which is the whole security
   * story of this group written as a type. Page script cannot supply a channel
   * address, cannot ask which one DASH holds, and cannot compose a message: it
   * asks main to open the credential window, asks main to forget what it has, or
   * asks for one fixed test message. Every real notification is composed in the
   * runner from something an agent actually did, on a path no renderer touches.
   *
   * `setNotificationKind` takes the one word and the one boolean the payload
   * rules allow. The word is checked against the two known settings in main,
   * beside the write.
   *
   * Four named methods rather than one `notify(action)`, like every group above.
   */
  connectNotifications: () => send("notify.connect", {}),
  disconnectNotifications: () => send("notify.disconnect", {}),
  testNotifications: () => send("notify.test", {}),
  setNotificationKind: (args: { kind: string; enabled: boolean }) =>
    sendNotificationKind(args.kind, args.enabled),

  /**
   * The three chief-Discord commands (MAR-743, ADR 0028).
   *
   * **The bot token is absent from all three**, the story `connectNotifications`
   * tells about a channel address and for its reason: `connectChiefDiscord` asks
   * main to *open the credential window*, and what a person types there reaches
   * the vault without passing through this bridge or the renderer.
   *
   * The two ids page script does supply are not credentials. A channel id names
   * a room nobody can reach without the token; a user id is what Discord shows
   * anybody who right-clicks a name. What they can do at worst is aim an
   * already-held token at a different channel and name a different speaker —
   * bounded by the fact that doing it at all requires the credential window,
   * which is a thing a person sees and can cancel.
   */
  connectChiefDiscord: (args: { channel_id: string; allowed_user_id: string }) =>
    sendChiefDiscordConnect(args.channel_id, args.allowed_user_id),
  disconnectChiefDiscord: () => send("chiefDiscord.disconnect", {}),
  setChiefDiscordEnabled: (args: { enabled: boolean }) => sendChiefDiscordEnabled(args.enabled),

  /**
   * The four LAB-telemetry commands (MAR-479, ADR 0026).
   *
   * **The token is absent from all four**, the story `connectNotifications`
   * tells about a channel address and for its reason: `connectLabTelemetry` asks
   * main to *open the credential window*, and what a person types there reaches
   * the vault without passing through this bridge or the renderer.
   *
   * `endpoint` is the one string page script does supply, and it is not a
   * credential — it is an address a person typed and reads back off their own
   * settings page. What it can do at worst is point DASH at somebody else's LAB,
   * which is bounded by `connectLabTelemetry` still requiring a token to be
   * typed before anything can be posted anywhere.
   *
   * `sendLabTelemetry` is the only command in DASH whose effect leaves this
   * machine and cannot be undone, which is why its catalogue entry is the one
   * marked `irreversible`.
   */
  connectLabTelemetry: (args: { endpoint: string }) =>
    send("lab.connect", { endpoint: args.endpoint }),
  disconnectLabTelemetry: () => send("lab.disconnect", {}),
  setLabTelemetryEnabled: (args: { enabled: boolean }) => sendLabEnabled(args.enabled),
  sendLabTelemetry: () => send("lab.sendNow", {}),

  /**
   * Remember that this agent's page has just been opened (MAR-586).
   *
   * One agent id and nothing else — in particular, no time. The moment recorded
   * is DASH's own clock in main, so a page cannot mark an agent as read at a
   * moment it chose, which is the one way this fact could be used to hide an
   * output rather than to acknowledge one.
   *
   * A named method, like everything above, rather than a generic entry point
   * whose reachable surface grows without a review.
   */
  markAgentLooked: (args: { agent_id: string }) => send("glance.looked", { ...args }),

  /**
   * The three model commands (MAR-583).
   *
   * Three named methods rather than one `model(action, target)`, like every group
   * above: a generic entry point is one whose reachable surface grows without a
   * review.
   *
   * `chooseModel` is the only method on this bridge that carries a value taken
   * from a **provider's** answer — a model id, which arrived in a `listModels`
   * result and went back through the page. That is why main checks it with
   * `isModelId` rather than trusting its provenance: a value that has been
   * through page script is a value page script could have replaced, and the fact
   * that DASH itself produced the list a moment ago says nothing about what came
   * back.
   *
   * Omitting `model_id` is how an agent goes back to matching each step, and
   * omitting `level` is how one step goes back to what its plan asked for. The
   * absent field is the instruction, so neither needs a second method and neither
   * can be spelled as a magic value main would have to recognise.
   */
  chooseModel: (args: {
    agent_id: string;
    connection_id?: string;
    field_id?: string;
    model_id?: string;
  }) => send("model.choose", dropUnset(args)),
  setStepLevel: (args: { agent_id: string; step: number; level?: string }) =>
    // Explicit fields rather than a spread, `sendHostCreate`'s rule, and the one
    // command outside the host form that carries a number. An absent `level` is
    // the instruction to put that step back on its plan's own answer, so it is
    // dropped rather than sent as an empty string the boundary would have to
    // interpret.
    sendStepLevel(args),
  listModels: (args: { agent_id: string; connection_id: string; field_id: string }) =>
    send("model.list", { ...args }),

  /**
   * DASH's own default model, and the list to pick it from (MAR-642).
   *
   * Two methods that carry no agent id, which is the whole of what is new here:
   * every other model method names one and main resolves the provider from that
   * agent's manifest. These name the provider, and main resolves it against
   * `fleetConnectorFor` — the same catalogue the AI tab was drawn from — so page
   * script can name one of three services and nothing else.
   *
   * Omitting both fields on `setDefaultModel` is how the default is cleared, in
   * `chooseModel`'s shape: the absent field is the instruction.
   */
  setDefaultModel: (args: { provider_id?: string; model_id?: string }) =>
    send("model.default", dropUnset(args)),
  listProviderModels: (args: { provider_id: string }) =>
    send("model.catalogue", { ...args }),
  /**
   * What one level means, fleet-wide (MAR-654, ADR 0011 amendment 1).
   *
   * A third method carrying no agent id, on the two above's terms. Omitting
   * `model_id` is how one row is cleared — `setDefaultModel`'s shape, and the
   * absent field is the instruction, never a magic value main would have to
   * recognise. The provider stays required either way, because the row's key is
   * (provider, level) and "clear Balanced" alone would mean two things on a DASH
   * holding two keys.
   */
  setLevelModel: (args: { provider_id: string; level: string; model_id?: string }) =>
    send("model.level", dropUnset(args)),
  /**
   * The chief's own model, read before the fleet default rather than instead
   * of it (MAR-696). A fourth method carrying no agent id, on the three
   * above's terms — omitting both fields clears the chief's own pin, in
   * `setDefaultModel`'s shape: the absent field is the instruction.
   */
  setChiefModel: (args: { provider_id?: string; model_id?: string }) =>
    send("model.chief", dropUnset(args)),

  /**
   * Ask this agent's model a question about what it has saved (MAR-545).
   *
   * The only method on this bridge that costs the person money, and the only one
   * carrying free text the person typed. Four explicit fields rather than a
   * spread, `sendHostCreate`'s rule — and note which field is *not* here: no
   * model. Which model answers is read in main from the row a person set
   * through `chooseModel`, so page script cannot direct a charge at the most
   * expensive model a key reaches.
   *
   * **No answer comes back through this call.** It resolves to whether the
   * question was asked; the answer arrives with the rest of the agent's view on
   * the next poll. See `DispatchContext.askAction`.
   */
  askQuestion: (args: {
    agent_id: string;
    connection_id: string;
    field_id: string;
    question: string;
  }) =>
    send("ask.question", {
      agent_id: args.agent_id,
      connection_id: args.connection_id,
      field_id: args.field_id,
      question: args.question,
    }),

  /**
   * Ask the chief about the fleet (MAR-659, ADR 0023).
   *
   * The second method here that can cost the person money, and the shortest
   * payload on this bridge: one field, and the emptiness is the point. There is
   * no agent id because the chief principal has no field one could go in, no
   * connection id because the chief's one connection is a constant of DASH's own
   * composed manifest, and no model id for `askQuestion`'s reason.
   *
   * **No answer comes back through this call.** It resolves to whether the
   * question was asked; the answer arrives with the fleet view on the next poll,
   * and it is still there tomorrow. See `DispatchContext.chiefAction`.
   */
  askChief: (args: { question: string }) => send("chief.ask", { question: args.question }),

  /**
   * Forget the whole conversation with the chief (MAR-659).
   *
   * No payload at all, which is the only correct shape: there is one thread, and
   * a page able to name which one to delete would be a page able to delete a
   * different one. The rows are removed rather than hidden.
   */
  clearChiefThread: () => send("chief.clear", {}),

  /**
   * The runner's own health, and its one repair (MAR-518).
   *
   * `status` carries no payload — it is a fact about the runner as a whole,
   * not about any one agent, which is also why `retireStore` carries no
   * `agent_id`: `runner.retireStore` reaches `POST /store/retire` directly,
   * never an agent's own `/lifecycle` route.
   */
  runnerStatus: () => send("runner.status", {}),
  retireRunnerStore: () => send("runner.retireStore", {}),

  /**
   * Start one registered agent's process on this computer (MAR-657).
   *
   * `runner.start` is not new — it has been in `COMMANDS` since MAR-415 and
   * reaches `POST /agents/{id}/lifecycle` — and until now the only thing in the
   * product that called it was the add-agent flow. So an agent was started on
   * the day it was installed and by nothing afterwards, which is why every agent
   * in a real store reads `offline` with nothing waiting. This is the method
   * that gives a person the verb DASH already had.
   *
   * It grants no reach the catalogue had not already granted: main forwards it
   * to the runner's lifecycle route, the runner starts a *registration* and
   * never a command line, and `runner/supervisor.ts` refuses a second start
   * rather than spawning a second process. The renderer names an agent id and
   * nothing else — it cannot say what runs, only which registration to run.
   */
  startAgent: (args: { agent_id: string }) => send("runner.start", { ...args }),

  /**
   * DASH's two removal actions (MAR-595 finding 18).
   *
   * `removeAgent` also deletes DASH's own copy of the agent's files;
   * `removeAgentKeepFiles` stops the agent and forgets it but leaves that copy
   * where it is. Two named methods rather than one taking a boolean, for the
   * reason every other group on this object is named methods rather than a
   * generic `command(name, payload)`: page script should not be one flag away
   * from a much larger blast radius than the button it clicked promised.
   */
  removeAgent: (args: { agent_id: string }) => send("runner.remove", { ...args }),
  removeAgentKeepFiles: (args: { agent_id: string }) =>
    send("runner.removeKeepFiles", { ...args }),

  /**
   * Set — or clear — the name DASH shows for one agent (MAR-589).
   *
   * `dropUnset` is load-bearing here, `chooseModel`'s own reason: an absent
   * `display_name` is the field's whole vocabulary for "put this back", and
   * sending it as `undefined` would serialise to a key with no value rather
   * than to no key at all.
   */
  renameAgent: (args: { agent_id: string; display_name?: string }) =>
    send("identity.rename", dropUnset(args)),

  /**
   * Star — or unstar — one agent, for the fleet rail's own filter (MAR-640).
   *
   * `renameAgent`'s sibling, and `favourite` is always sent — there is no
   * absent state to preserve the way `display_name`'s omission preserves the
   * manifest's own name. `sendFavourite` rather than `send`: the payload
   * carries a boolean, which `send` cannot.
   */
  setAgentFavourite: (args: { agent_id: string; favourite: boolean }) =>
    sendFavourite(args.agent_id, args.favourite),

  /**
   * Swap the character DASH draws for one agent, from `O_FLEET`'s eleven
   * (MAR-615).
   *
   * `send`, not `sendFavourite`: the payload is a string, the same shape
   * `renameAgent` already sends, so no boolean-only helper is needed. The
   * chief is refused, but on the other side of this call — `lib/store.ts`'s
   * `setAgentAvatar` is the gate, the same division `renameAgent` draws
   * between "a string arrived" and "a name DASH will accept."
   */
  setAgentAvatar: (args: { agent_id: string; avatar: string }) => send("identity.avatar", { ...args }),

  /**
   * Remember an agent's answer to one runtime question: "always this"
   * (MAR-681).
   *
   * `question_label` and `option_label` are the choice's and the chosen
   * option's own `label`, verbatim — the same words the Work Inbox already
   * showed. Main derives the storage key from `question_label` rather than
   * this bridge computing one, `renameAgent`'s division between "a string
   * arrived" and "a value DASH will accept."
   */
  setStandingAnswer: (args: {
    agent_id: string;
    question_label: string;
    option_id: string;
    option_label: string;
  }) => send("standing_answer.set", { ...args }),

  /** `setStandingAnswer`'s undo. `question_key` names the row to forget. */
  clearStandingAnswer: (args: { agent_id: string; question_key: string }) =>
    send("standing_answer.clear", { ...args }),

  /**
   * Start this agent every day at a time, without asking again (MAR-742 item 8,
   * ADR 0029).
   *
   * `at_local` is `HH:MM` on this computer's own clock and carries no timezone.
   * Nothing here checks it — this bridge names commands and validates none of
   * them, `renameAgent`'s division between "a string arrived" and "a value DASH
   * will accept" — and it is checked twice further down: in
   * `lib/schedule/store.ts` before a row is written, and again in
   * `runner/server.ts` before the runner will fire on it.
   *
   * MAR-784: `allowance_calls` is how many model calls one of these runs may pay
   * for, and it is **not optional here** even though zero is the default
   * everywhere else. A bridge that let it be omitted would be a bridge on which
   * "leave the ceiling alone" and "set the ceiling to nothing" look identical,
   * and this command replaces the whole row — so the renderer states the number
   * on every save, including when it is zero. It is checked as a number at the
   * seam (`payload_types`), bounded in `lib/schedule/store.ts`, and bounded
   * again by `openRunSpend` before anything can be spent under it.
   */
  setAgentSchedule: (args: { agent_id: string; at_local: string; allowance_calls: number }) =>
    sendSchedule(args),

  /** `setAgentSchedule`'s undo. The record of what it already did is kept. */
  clearAgentSchedule: (args: { agent_id: string }) => send("schedule.clear", { ...args }),

  approve: (args: AgentCommandArgs) => send("agent.approve", fields(args, APPROVAL_FIELDS)),
  reject: (args: AgentCommandArgs) => send("agent.reject", fields(args, APPROVAL_FIELDS)),
  choose: (args: AgentCommandArgs) => send("agent.choose", fields(args, CHOICE_FIELDS)),
  retry: (args: AgentCommandArgs) => send("agent.retry", fields(args, RUN_FIELDS)),
  pause: (args: AgentCommandArgs) => send("agent.pause", fields(args, RUN_FIELDS)),
  resume: (args: AgentCommandArgs) => send("agent.resume", fields(args, RUN_FIELDS)),
  cancel: (args: AgentCommandArgs) => send("agent.cancel", fields(args, RUN_FIELDS)),
};

export type DashShellApi = typeof dashShell;

contextBridge.exposeInMainWorld("dashShell", dashShell);

/* ---------------------------------------------------------------------- *
 * The read surface (MAR-432)
 * ---------------------------------------------------------------------- */

function read<K extends keyof ReadResults>(
  name: K,
  params?: Record<string, string>,
): Promise<ReadResponse<ReadResults[K]>> {
  return ipcRenderer.invoke(SHELL_READ_CHANNEL, { read: name, params }) as Promise<
    ReadResponse<ReadResults[K]>
  >;
}

/**
 * One named method per readable document, and nothing generic.
 *
 * The same argument that keeps `invoke` off `dashShell` applies here with no
 * discount: a `read(name)` method would let page script address any entry in the
 * catalogue, including entries added later for something else. That the
 * catalogue currently holds only four harmless documents is not the property
 * being protected — the property is that widening it stays a review event.
 *
 * No method takes a callback, returns a subscription, or accepts anything but
 * strings. A page that wants fresher data asks again.
 */
const dashData = {
  agents: () => read("view.agents"),
  runs: () => read("view.runs"),
  run: (agent: string, runId: string) => read("view.run", { agent, run_id: runId }),
  connections: () => read("view.connections"),
  inbox: () => read("view.inbox"),
  workspace: (agent: string) => read("view.workspace", { agent }),
  // MAR-574. Without this the Servers page cannot know a server was ever saved,
  // which is exactly the state that page shipped in.
  hosts: () => read("view.hosts"),
  // MAR-588. Whether DASH is set up to post to Discord — never where. See the
  // `view.notifications` entry in `lib/shell/read.ts` for why this read cannot
  // become a route to the vault.
  notifications: () => read("view.notifications"),
  // MAR-479, ADR 0026. Whether DASH reports its agents' plans to a LAB, and the
  // exact bytes it would send and has sent — never the token. See the
  // `view.labTelemetry` entry in `lib/shell/read.ts` for why this read cannot
  // become a route to the vault.
  labTelemetry: () => read("view.labTelemetry"),
  // MAR-628, ADR 0019. The controlled browser's own record. What crosses is
  // where DASH let its browser go, where it went, and what it decided about
  // each request — never the page's content, which goes to the agent through
  // `lib/browser/protocol.ts` and is not stored at all. See the `view.browser`
  // entry in `lib/shell/read.ts`.
  browser: (agent: string) => read("view.browser", { agent }),
  // `satisfies`, so the pages and this bridge cannot drift: the shape is
  // declared in `lib/shell/read.ts`, which a client component may import and
  // this file may not be imported by.
} satisfies DashReadApi;

export type DashDataApi = typeof dashData;

contextBridge.exposeInMainWorld("dashData", dashData);
