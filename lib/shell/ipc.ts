/**
 * The audited-command chokepoint.
 *
 * ADR 0001's "Gained" section claims the IPC boundary "gives the 'audited
 * commands' requirement a natural, enforceable chokepoint". This module is
 * where that claim is cashed in — and it is pure, so the enforcement can be
 * tested without launching Electron.
 *
 * The shape that makes it a chokepoint rather than a suggestion:
 *
 * - **One channel, not one per command.** `electron/main.ts` registers exactly
 *   one `ipcMain.handle`. A future command is a new entry in `COMMANDS` below,
 *   which means it passes through `reviewCommand` and produces an audit record
 *   by construction. Per-command handlers would let the next command be added
 *   without ever touching the audit path — the failure this design exists to
 *   prevent.
 * - **Allowlist, not denylist.** An unknown command is denied and audited.
 * - **No secrets cross this boundary.** The renderer never sends or receives a
 *   credential; `SecureStore` lives in main and stays there. That is enforced
 *   below, not merely intended: payloads are restricted to declared, non-secret
 *   fields, so a command *cannot* be given a secret-shaped argument.
 *
 * MAR-383 shipped one command, `shell.ping`, which does nothing. MAR-417 adds
 * the seven Agent DOM commands, and adds them *here* — the point of the design
 * above being that there was no other way to add them.
 *
 * What the renderer may say about an agent command is deliberately thin:
 * which agent, which run or task, which approval or choice, and which snapshot
 * it was looking at. It cannot name an actor, mint a nonce, set an expiry,
 * choose a correlation id or supply an idempotency key — not because those are
 * rejected, but because no command declares a payload key for them. They are
 * minted in `lib/agent-dom/runner.ts`, on the trusted side, which is what ADR
 * 0001 means by the IPC boundary being the auditable seam.
 */

import type {
  AgentCommandInput,
  AgentCommandResult,
} from "../agent-dom/runner";
import type { ConnectionActionResult } from "../connection-actions";
import type { AddAgentCard } from "../copy/add-agent";
import type { Recovery } from "../copy/recovery";
import type { ImportFailureExplanation } from "../import-feedback";
// The one value import in this file, and it is a string constant from a module
// with no imports of its own — see `lib/fleet/principal.ts` for why it lives
// there rather than beside the action layer that also needs it. Anything the
// fleet's action layer imports would break this module's promise to stay
// loadable from a sandboxed preload.
import { FLEET_PRINCIPAL } from "../fleet/principal";
import type { FolderChangeReport } from "../folder-changes";
import type { HostReachProblem } from "../host-connect";
import type { AgentCommand } from "../workspace";

/** The single IPC channel. Everything audited goes through it. */
export const SHELL_COMMAND_CHANNEL = "dash:shell-command";

/* ---------------------------------------------------------------------- *
 * Command catalogue
 * ---------------------------------------------------------------------- */

export interface CommandSpec {
  /**
   * Plain-language description of what invoking this does, written for the
   * audit log's human reader rather than for a developer.
   */
  effect: string;
  /**
   * Payload keys this command accepts. Every accepted value must be a string,
   * number or boolean — see `reviewCommand`. Commands needing anything richer
   * should be reviewed on their own merits rather than by loosening this.
   */
  payload_keys: readonly string[];
  /**
   * A stricter primitive type for a payload key. Omitted keys stay any primitive
   * for compatibility with the original command catalogue; the one numeric
   * host field declares itself here so a port cannot be smuggled through as a
   * string that later code has to parse differently.
   */
  payload_types?: Readonly<Record<string, "string" | "number" | "boolean">>;
  /**
   * Keys without which the command is meaningless. Absent ones are a denial,
   * not a default.
   *
   * Added in MAR-417: until then every command's fields were optional, which
   * was fine for a no-op and is not fine for a command that names the approval
   * it is about. Filling in a missing target with a guess is how a command aimed
   * at nothing becomes a command aimed at something.
   */
  required_keys: readonly string[];
  /**
   * True when the command changes state anywhere: disk, vault, an agent, the
   * network. `shell.ping` is the only command that can honestly say false, and
   * marking it explicitly keeps "does nothing" an asserted property rather than
   * an assumption.
   */
  mutates: boolean;
  /**
   * True when running it twice could do harm no one can undo — a second
   * calendar invite, a second payment.
   *
   * Duplicate suppression in `lib/agent-dom/runner.ts` applies to every command
   * regardless; this flag records which ones it *matters* for, and is written
   * into the audit trail so a reader can tell a repeated pause from a repeated
   * approval without knowing the catalogue by heart.
   */
  irreversible: boolean;
}

/**
 * Every command the renderer may invoke. Adding an entry here is the *only*
 * way to add a command, and is a deliberate review event.
 *
 * The Agent DOM entries are exactly the seven verbs of
 * `contracts/agent-command.schema.json` and `agent.manifest.v2.schema.json`.
 * There is still no `agent.start`, `agent.stop` or `agent.trigger`: the
 * contract's command vocabulary does not contain them, and inventing a name
 * here for something no manifest can declare would give DASH a button no
 * adapter is obliged to honour.
 *
 * MAR-415 added `runner.*` instead, and the separate prefix is the point.
 * Starting and stopping a hosted process is **runner lifecycle** — DASH
 * supervising something it launched — and it is routed to the runner's
 * `/lifecycle` endpoint, never built into an envelope, never validated against
 * `agent-command.schema.json`, and never mistaken for one of the seven verbs.
 */
export const COMMANDS = {
  "shell.ping": {
    effect: "Confirm the shell's command boundary is reachable. Changes nothing.",
    payload_keys: ["issued_at"],
    required_keys: [],
    mutates: false,
    irreversible: false,
  },

  // MAR-440. The window's own menu bar is gone, so something in the app has to
  // be able to show the menu that is still registered behind it.
  //
  // This rides the audited channel rather than arriving as a third
  // `contextBridge` surface, and the difference is the point. ADR 0001
  // amendment 7 makes a new bridge a review event; the command catalogue is the
  // extension point that already *is* one, and routing through it means the
  // request is allowlisted, its payload is constrained to two numbers, and it
  // produces an audit record — none of which a bridge method would have got.
  //
  // What crosses is a coordinate and nothing else. The renderer cannot name a
  // menu, an item, or an action: `applicationMenu()` builds the template in
  // main and main owns every click handler, exactly as it did when the bar was
  // visible. So this widens what can be *shown*, never what can be *done*.
  "shell.menu": {
    effect: "Show the application menu. Changes nothing by itself.",
    payload_keys: ["x", "y"],
    required_keys: [],
    // Displaying a menu is not a mutation. Whatever the user then picks is
    // main's own menu handler running, and is audited wherever that action is.
    mutates: false,
    irreversible: false,
  },
  "shell.scale": {
    effect: "Set this window's bounded UI scale.",
    payload_keys: ["factor"],
    required_keys: [],
    mutates: false,
    irreversible: false,
  },
  /*
   * MAR-642. The native half of the theme the person chose.
   *
   * The palette itself is CSS — an attribute on `<html>` and the `light-dark()`
   * tokens `app/tokens.css` has carried since MAR-528 — and needs no command.
   * What does is the chrome Electron draws in Node before a stylesheet exists:
   * the window's background, the Windows title bar overlay and the splash. This
   * sets `nativeTheme.themeSource`, which is the one switch all three already
   * follow through `resolveTheme`.
   *
   * `mutates: false`, in this family's shape and for its reason: it asks main to
   * draw something on this machine's screen and reaches no agent, no store and
   * no provider. Electron does not persist `themeSource`, so nothing here
   * outlives the process — the renderer re-sends it on every launch.
   */
  "shell.theme": {
    effect: "Colour this window's title bar and background light or dark, or follow the computer.",
    payload_keys: ["theme"],
    // Absent is `system`, in `model.choose`'s shape: the missing field is the
    // instruction to put it back rather than a value main has to recognise.
    required_keys: [],
    mutates: false,
    irreversible: false,
  },

  /*
   * MAR-628, ADR 0019. The two halves of the supervision surface that are not
   * reads: telling main where to paint the controlled browser, and stopping it.
   *
   * ## Why these ride the audited channel
   *
   * `shell.menu`'s argument, and it is stronger here. A `WebContentsView` is a
   * native surface painted over the window, so *something* in the renderer has
   * to be able to say where it goes — and the alternative to routing that
   * through this catalogue is a third `contextBridge` surface, which ADR 0001
   * amendment 7 makes a review event precisely so that it does not happen
   * casually. Routing through here means the request is allowlisted and its
   * payload is constrained to four numbers.
   *
   * What crosses is a rectangle. The renderer cannot name a session, a URL, an
   * origin or an operation: main resolves the session from the agent it is
   * already tracking, and every one of those belongs to `lib/browser/`.
   */
  "browser.viewport": {
    effect: "Put the watched browser where the page says its panel is. Changes nothing else.",
    payload_keys: ["x", "y", "width", "height"],
    required_keys: ["x", "y", "width", "height"],
    /*
     * Four numbers, declared as numbers.
     *
     * `host.create.port` is the precedent and the reason is the same one: a
     * rectangle is four numbers, and accepting string representations would put
     * a second parser between the renderer and `setBounds`. Without this every
     * one of these is refused as a missing field, which is what the first proof
     * run found — the panel reported its rectangle sixteen times, all sixteen
     * were denied, and the browser sat in `FALLBACK_BOUNDS` over the top-left of
     * the window while the panel below it drew an empty stage. Required *and*
     * typed, so a partial rectangle is still a refusal.
     */
    payload_types: { x: "number", y: "number", width: "number", height: "number" },
    // Moving a view is not a mutation in this catalogue's sense: it reaches no
    // agent, no store and no provider, and nothing about it outlives the
    // window. `shell.scale` and `shell.menu` are the same family.
    mutates: false,
    irreversible: false,
  },
  /*
   * Stop, and it is the one command in this family that is not cosmetic.
   *
   * `mutates: true`, because it ends something and the audit should say who
   * ended it.
   *
   * `irreversible: false`, and that value is worth defending rather than
   * assuming. What Stop destroys is DASH's own browser session, which a person
   * can have again by running the agent again. The thing that genuinely cannot
   * be undone is not this command's effect — it is that requests the browser
   * already sent have already arrived — and marking the command irreversible
   * would attach that fact to the wrong object, implying DASH's approval
   * machinery could have prevented it. `describeStop` says it in words, on the
   * button, which is where somebody will actually read it.
   */
  "browser.stop": {
    effect:
      "Close the browser DASH opened for this agent, and refuse anything else it asks for during this run.",
    payload_keys: ["agent"],
    required_keys: ["agent"],
    mutates: true,
    irreversible: false,
  },

  "runner.start": {
    effect: "Start a registered agent's process on this machine. Not an Agent DOM command.",
    payload_keys: ["agent_id"],
    required_keys: ["agent_id"],
    mutates: true,
    // Starting twice is refused by the supervisor rather than starting a second
    // process, and starting an agent does nothing to the world that stopping it
    // does not undo.
    irreversible: false,
  },
  "runner.stop": {
    effect: "Stop a running agent's process on this machine. Not an Agent DOM command.",
    payload_keys: ["agent_id"],
    required_keys: ["agent_id"],
    mutates: true,
    irreversible: false,
  },
  "runner.status": {
    effect: "Report which agents the bundled runner is supervising, and their process ids.",
    payload_keys: [],
    required_keys: [],
    mutates: false,
    irreversible: false,
  },
  "runner.remove": {
    effect:
      "Stop an agent DASH added, and delete DASH's registration, manifest copy and its own copy of the agent's files. The agent's original project on disk is never touched.",
    payload_keys: ["agent_id"],
    required_keys: ["agent_id"],
    mutates: true,
    // Not irreversible in the sense this flag means — nothing happens in the
    // world that cannot be undone by adding the agent again from its folder,
    // which is one command. What *is* deleted is DASH's own record, and
    // `removeRegistration` refuses to touch a registration DASH did not create,
    // so the blast radius is bounded by ownership rather than by this flag.
    irreversible: false,
  },
  /*
   * MAR-595 finding 18. The other of DASH's two removal actions, added
   * alongside `runner.remove` rather than as a boolean on it — a payload flag
   * would let a caller silence which of two behaviours with very different
   * blast radii it was asking for; two names cannot be silenced by accident.
   */
  "runner.removeKeepFiles": {
    effect:
      "Stop an agent DASH added and delete DASH's registration for it, but keep DASH's own copy of the agent's files.",
    payload_keys: ["agent_id"],
    required_keys: ["agent_id"],
    mutates: true,
    irreversible: false,
  },
  /*
   * MAR-518. Names no agent — a damaged store is a fact about the runner, not
   * about any one of the agents it supervises, and `runnerLifecycle`'s
   * `retireStore` branch reaches `POST /store/retire` directly rather than an
   * agent's own `/lifecycle` route.
   *
   * `irreversible` is false in this flag's sense, the same call
   * `connection.disconnect` and `workspace.dispatchTask` make: the runner
   * renames the damaged file rather than deleting it (`retireDamagedStore`
   * says why), so nothing that exists is destroyed. What is lost is DASH's
   * *use* of the old records until somebody restores that file by hand, which
   * is the sense the copy on the button is honest about rather than this flag.
   */
  "runner.retireStore": {
    effect:
      "Set the runner's damaged store aside and open a fresh one. The old file is kept, renamed, not deleted.",
    payload_keys: [],
    required_keys: [],
    mutates: true,
    irreversible: false,
  },

  /*
   * MAR-576. Re-import an agent DASH itself scaffolded, from DASH's own current
   * template.
   *
   * **Its own prefix, and that is the point** — the argument this file already
   * makes for `runner.*` existing rather than a `agent.start` being invented.
   * `agent.*` is exactly the seven verbs of `agent-command.schema.json`; this is
   * not one of them, becomes no envelope and is adjudicated against no manifest.
   * It is also not `runner.*`: no process is started, stopped or asked anything,
   * and the runner is not involved at any point. What it touches is DASH's own
   * record of an agent DASH wrote — a fifth kind of thing, named as one.
   *
   * `mutates` is plainly true: it replaces the stored manifest and the folder
   * document beneath it.
   *
   * `irreversible` is **false**, and the reasoning matters more than the flag.
   * Nothing happens in the world — no message, no file of the user's, no
   * credential. What is replaced is a document DASH generated, by the same
   * generator, and the agent's identity, character, runs, outputs and connected
   * credentials all survive: `importManifest`'s `ON CONFLICT DO UPDATE`
   * deliberately omits `avatar`, and it writes no other table. The bound worth
   * stating is not this flag but the gate in main — `refreshSampleAgent` refuses
   * any manifest DASH's own scaffold did not generate, so a document a person
   * wrote by hand can never be overwritten by this command however it is called.
   */
  "sample.refresh": {
    effect:
      "Replace the saved setup of an agent DASH created with DASH's current version of it. Keeps the agent's name, character, runs, outputs and credentials.",
    payload_keys: ["agent_id"],
    required_keys: ["agent_id"],
    mutates: true,
    irreversible: false,
  },

  /*
   * MAR-586. Remember that this agent's page has just been opened.
   *
   * **A sixth family, and it is about the reader rather than about anything
   * DASH supervises.** Every other command in this catalogue asks DASH to act on
   * an agent, a process, a credential, a server, a file or a manifest. This one
   * writes down that somebody looked, which is the fact a fleet card needs to
   * say "three things have arrived since you were last here" — and the one new
   * thing MAR-586 stores.
   *
   * It could not have been a read. `lib/shell/read.ts` states that a read
   * changes nothing and is therefore not audited, and recording a look inside
   * the answer to `view.workspace` would have broken that in the worst place:
   * that view is polled every five seconds while a run is going, so the fact
   * would have been rewritten by the page merely staying open rather than by
   * anybody arriving.
   *
   * `mutates` is true — a row exists afterwards that did not before.
   * `irreversible` is false in the strongest sense in this file: nothing happens
   * in the world, nothing of the user's moves, no message is sent, and the whole
   * consequence is that some chips on one card stop being drawn. Running it
   * twice is running it once.
   *
   * The widest thing a compromised renderer could do with it is claim to have
   * read an agent's page it did not read. That is worth naming rather than
   * waving away, and it is bounded by what the fact drives: DASH would draw one
   * fewer chip. It reaches no agent, no runner, no vault and no provider.
   */
  "glance.looked": {
    effect:
      "Remember that you have just opened this agent's page, so DASH can tell you what has arrived since.",
    payload_keys: ["agent_id"],
    required_keys: ["agent_id"],
    mutates: true,
    irreversible: false,
  },

  /*
   * MAR-589. A name DASH itself owns for one agent, separate from the
   * author's `display_name`.
   *
   * **A seventh family, and it is one for `glance.looked`'s own reason
   * immediately above: it is about the reader's own record of an agent, not
   * about anything the agent or the runner does.** Nothing here contacts an
   * agent, a runner, a vault or a provider.
   *
   * **`identity.*`, not `agent.*`.** `sample.refresh`'s own note states the
   * rule this follows: `agent.*` is reserved for the contract's seven verbs,
   * and `tests/shell.test.ts` enforces it by checking every `agent.*` command
   * against that exact set. A rename is not one of them.
   *
   * `display_name` is optional and its absence is the whole vocabulary for
   * "put this back" — `reviewCommand`'s own rule denies an *empty* string as
   * "present but absent" for every command in this file, so the one way to
   * clear a rename is to omit the field entirely, which is what the renderer's
   * `dropUnset` turns "the person cleared the box" into before this is ever
   * called.
   *
   * `mutates` is true — a row changes. `irreversible` is false: the previous
   * name, whether it was a rename or the manifest's own `display_name`, is one
   * more press away.
   */
  "identity.rename": {
    effect: "Set — or clear — the name DASH shows for this agent. Contacts nobody.",
    payload_keys: ["agent_id", "display_name"],
    required_keys: ["agent_id"],
    mutates: true,
    irreversible: false,
  },

  /*
   * MAR-640. Whether the reader has starred one agent, for the fleet rail's
   * own filter.
   *
   * `identity.*`, beside `identity.rename` and for its own reason: this is
   * the reader's own record of an agent, contacts nobody, and a row exists
   * whether the flag is on or off — `favourite` is required rather than
   * optional, so a caller cannot ask "change this" without saying to what.
   *
   * `mutates` is true — a row changes. `irreversible` is false: the previous
   * state is one more press away.
   */
  "identity.favourite": {
    effect: "Mark — or unmark — one agent as a favourite. Contacts nobody.",
    payload_keys: ["agent_id", "favourite"],
    payload_types: { favourite: "boolean" },
    required_keys: ["agent_id", "favourite"],
    mutates: true,
    irreversible: false,
  },

  /*
   * MAR-615. Which of `O_FLEET`'s eleven costumes an agent wears.
   *
   * `identity.favourite`'s shape exactly, and `avatar` is required for the
   * same reason `favourite` is: a picker is always choosing a specific
   * character, never asking main to guess which one "change" means. The
   * chief is refused, but at `lib/store.ts`'s own gate — `payload_types` here
   * only checks that a string arrived, the same division `identity.rename`
   * draws between "shaped like a name" and "a name DASH will accept."
   *
   * `mutates` is true — a row changes. `irreversible` is false: the previous
   * costume is one more press away.
   */
  "identity.avatar": {
    effect: "Set the character DASH draws for this agent. Contacts nobody.",
    payload_keys: ["agent_id", "avatar"],
    required_keys: ["agent_id", "avatar"],
    mutates: true,
    irreversible: false,
  },

  /*
   * MAR-681. A person's own record that an agent's runtime question should
   * stop being asked. `identity.*`'s reason exactly: this is the reader's own
   * record about an agent, not anything the agent or its runner does, and it
   * is not `agent.choose` — that command answers *one* occurrence of a choice
   * through the Agent DOM envelope and reaches the runner; this writes a
   * standing rule DASH consults *before* the next occurrence is ever offered,
   * and contacts nobody.
   *
   * `question_label` and `option_label` are the choice's and the chosen
   * option's own `label`, verbatim — main derives the storage key from the
   * question label rather than accepting one, so a caller cannot send a key
   * that disagrees with what `standingAnswerQuestionKey` would compute for
   * the words beside it.
   *
   * `mutates` is true — a row is written. `irreversible` is false: forgetting
   * it is `standing_answer.clear`, one press away, and neither command ever
   * touches the choice it describes.
   */
  "standing_answer.set": {
    effect:
      "Remember this agent's answer to one runtime question, so DASH does not ask again. Contacts nobody.",
    payload_keys: ["agent_id", "question_label", "option_id", "option_label"],
    required_keys: ["agent_id", "question_label", "option_id", "option_label"],
    mutates: true,
    irreversible: false,
  },
  /**
   * `standing_answer.set`'s undo. `question_key` rather than `question_label`:
   * the renderer already holds the key from the row it is showing a Forget
   * button beside, and re-deriving it from a label here would be a second
   * place that decides what "the same question" means.
   */
  "standing_answer.clear": {
    effect: "Forget a remembered answer, so DASH asks again next time. Contacts nobody.",
    payload_keys: ["agent_id", "question_key"],
    required_keys: ["agent_id", "question_key"],
    mutates: true,
    irreversible: false,
  },

  /*
   * MAR-742 item 8, ADR 0029. When DASH should start this agent without being
   * asked again.
   *
   * **Its own family beside `standing_answer.*` rather than a member of it**,
   * and the two are worth separating out loud because they are the same
   * sentence pointed at different things. A standing answer is what DASH should
   * say when the *agent* asks a question. A schedule is what DASH should do when
   * *nobody* asks anything. Folding them together would put "start a process at
   * 03:00" behind a family whose whole catalogue entry promises it contacts
   * nobody and changes nothing but a remembered reply.
   *
   * ## `effect` says the honest thing, which is not "contacts nobody"
   *
   * Setting a schedule contacts nobody *at the moment it is set*, exactly as
   * `notify.connect`'s entry notes about storing an address. What it does is
   * arrange for an agent to be started later, on this computer, with nobody
   * watching — and that is what a person is being asked to confirm, so it is
   * what the sentence says. The run itself is the ordinary `retry` the runner
   * adjudicates; this command does not perform one.
   *
   * ## What crosses, and what cannot
   *
   * An agent id and `HH:MM`. There is no field for a command, a script, an
   * argument, an environment variable or a URL, because a schedule names *when*
   * and never *what* — what runs is the registration the runner already holds,
   * unchanged. A family that could carry the second half would be a way to make
   * DASH execute something of the caller's choosing on a timer, which is a
   * different product.
   *
   * `at_local` is a wall-clock time on this machine and carries no timezone;
   * ADR 0029 decision 9 says why. It is re-checked against `isLocalTime` in
   * `lib/schedule/store.ts` before anything is written, so a value that got past
   * this seam still cannot become a cadence.
   */
  "schedule.set": {
    effect:
      "Start this agent every day at the time you pick, on this computer, without asking again. Nothing is contacted now; the run happens later.",
    payload_keys: ["agent_id", "at_local"],
    required_keys: ["agent_id", "at_local"],
    mutates: true,
    irreversible: false,
  },
  /**
   * `schedule.set`'s undo, and it is a real undo: the standing instruction is
   * deleted and nothing starts on its own again.
   *
   * What it deliberately does **not** clear is the record of what the schedule
   * already did. A person turning a cadence off because it kept failing is
   * exactly the person who still wants to read why — see `clearAgentSchedule`.
   */
  "schedule.clear": {
    effect: "Stop starting this agent on a schedule. Contacts nobody.",
    payload_keys: ["agent_id"],
    required_keys: ["agent_id"],
    mutates: true,
    irreversible: false,
  },

  /*
   * MAR-583. Which model an agent uses.
   *
   * **An eighth family, and it is one because the question it answers is one.**
   * A reviewer asking "what in DASH decides which model an agent's steps run on?"
   * gets a complete answer from three entries: a person names a model, a person
   * sets one step's level, or DASH asks the provider what there is to choose
   * between. Nothing else touches it.
   *
   * Not `connection.*`, though the third contacts a provider with a key DASH
   * holds and records the same liveness observation `connection.test` does.
   * That family is about *whether DASH may reach a service at all*, and its three
   * members grant, check and withdraw access. These three change nothing about
   * access: with the key connected they are all still available, and with it
   * disconnected none of them has anything to act on. Deriving a model command
   * from a connection verb would put DASH's routing decision inside its
   * permission model, where a later reader would reasonably expect a refusal to
   * mean something about access.
   *
   * **The renderer cannot name a provider, an origin, a path or a key.** It names
   * an agent, a connection and a field — the three ids `ConnectFlow` already
   * carries — and main resolves the rest from the manifest and the vault. A model
   * id does cross on `model.choose`, and it is checked with `isModelId` on the
   * way in rather than trusted for having come from a list DASH itself produced:
   * the page is where a provider's catalogue was rendered, and a page is not a
   * place a value stays trustworthy.
   */
  "model.choose": {
    effect:
      "Set which model this agent uses, or put it back to matching each step to what that step needs. Contacts nobody.",
    payload_keys: ["agent_id", "connection_id", "field_id", "model_id"],
    required_keys: ["agent_id"],
    mutates: true,
    // Nothing in the world changes and the previous setting is one click away.
    // What it affects is what the *next* run is recorded as having started under;
    // runs already recorded are never revised. See `recordRunModel`.
    irreversible: false,
  },
  "model.step": {
    effect:
      "Set the strength one step of this agent's plan asks for, or put that step back to what its plan asked. Contacts nobody.",
    payload_keys: ["agent_id", "step", "level"],
    payload_types: { step: "number" },
    required_keys: ["agent_id", "step"],
    mutates: true,
    irreversible: false,
  },
  /*
   * `mutates` is true, and it is worth saying why for a command whose name reads
   * like a read. It presents a key DASH holds to a third party over the network
   * and records what that party said, in the same row `connection.test` writes.
   * `shell.ping` is the only command in this file that can honestly say false;
   * this one reaches a provider, and a flag claiming otherwise would understate
   * an outbound act in the audit line a person reads.
   */
  "model.list": {
    effect:
      "Ask this agent's model provider which models its key can reach, and record what the provider said about the key.",
    payload_keys: ["agent_id", "connection_id", "field_id"],
    required_keys: ["agent_id", "connection_id", "field_id"],
    mutates: true,
    irreversible: false,
  },

  /*
   * MAR-642. The two members of this family that are about no agent.
   *
   * They belong here rather than in `FLEET_ACTIONS` for the reason that map's
   * own note gives about deriving a model command from a connection verb: the
   * fleet family's three verbs grant, check and withdraw *access*, and neither
   * of these changes what DASH may reach. What they change is which model it
   * asks for — a setting, in the family whose name is a setting.
   *
   * **They name a provider, and that is the widening worth stating.** Every
   * other member of this family names an agent, a connection and a field, and
   * main resolves the provider from that agent's manifest — the rule the family
   * header states. There is no agent here to resolve from, so the renderer
   * names one of the three ids in `AI_PROVIDER_IDS` and main refuses anything
   * else through `aiProviderById`. What it still cannot name is an origin, a
   * path, a header or a key: those come from `lib/ai/providers.ts` by value, as
   * they did before.
   */
  "model.default": {
    effect:
      "Set the model DASH gives an agent that has not been given one of its own, or clear it. Never changes an agent that has chosen. Contacts nobody.",
    payload_keys: ["provider_id", "model_id"],
    // Neither is required: no provider and no model is how the default is
    // cleared, in `model.choose`'s shape — an absent field means "put it back",
    // so removing a setting needs no second command.
    required_keys: [],
    mutates: true,
    // Nothing in the world changes and the previous setting is one press away.
    // What it affects is which model a *later* run of an unconfigured agent is
    // recorded under; runs already recorded are never revised.
    irreversible: false,
  },
  /*
   * `mutates` is true for `model.list`'s reason exactly: it presents a key DASH
   * holds to a third party over the network and records what that party said
   * about the key, in the same row a check writes.
   */
  "model.catalogue": {
    effect:
      "Ask a model provider which models the key DASH holds for you can reach, and record what the provider said about the key.",
    payload_keys: ["provider_id"],
    required_keys: ["provider_id"],
    mutates: true,
    irreversible: false,
  },

  /*
   * MAR-654, ADR 0011 amendment 1. A third member about no agent.
   *
   * Appended rather than slotted beside `model.default`, on this catalogue's
   * standing rule: `tests/shell.test.ts` pins the whole list in order, so a new
   * command goes at the end of its family and the diff a reviewer reads is one
   * added line rather than a reordering.
   *
   * It names a provider and a level, on `model.default`'s terms and for its
   * reason: there is no agent here to resolve a provider from, so the renderer
   * names one of the three ids in `AI_PROVIDER_IDS` and one of the three levels
   * in `DEFAULT_MODEL_LEVELS`, and main refuses anything else. What it still
   * cannot name is an origin, a path, a header or a key.
   *
   * **It widens what an agent-origin spend can reach**, from one model to three,
   * and that is said here rather than left in the ADR: a row written through
   * this command is one an agent's own step can be resolved to. What bounds it is
   * that an agent reaches only levels its own plan declares — see
   * `BrokerDeps.readModelChoice`.
   */
  "model.level": {
    effect:
      "Say which model steps of one strength run on, or clear it. Never changes an agent that " +
      "has been given a model of its own. Contacts nobody.",
    payload_keys: ["provider_id", "level", "model_id"],
    // The model is not required: a provider and a level with no model is how one
    // row is cleared, in `model.default`'s shape — an absent field means "put it
    // back", so removing a setting needs no second command.
    required_keys: ["provider_id", "level"],
    mutates: true,
    // Nothing in the world changes and the previous setting is one press away.
    // What it affects is which model a *later* run resolves a step to; runs
    // already recorded are never revised.
    irreversible: false,
  },
  /*
   * MAR-696. A fourth member about no agent, on `model.default`'s exact terms
   * — including the shape of its own name: this is the chief's *default*,
   * read before the fleet's rather than instead of it, so `model.chief`
   * rather than `model.chief_default` matches the family's own naming
   * (`model.default`, not `model.fleet_default`).
   *
   * Appended last, `model.level`'s own reason: `tests/shell.test.ts` pins the
   * whole list in order, so a new command goes at the end of its family.
   *
   * It widens nothing `model.default` did not already widen: both name a
   * provider from `AI_PROVIDER_IDS` and reach no manifest, no vault and no
   * network. What is new is which row main writes — this one touches
   * `chief_model_choice`, never `fleet_model_default`, so an agent's own
   * fallback is untouched either way.
   */
  "model.chief": {
    effect:
      "Set the model the chief itself asks under, or clear it back to DASH's fleet default. " +
      "Contacts nobody.",
    payload_keys: ["provider_id", "model_id"],
    // Neither is required: no provider and no model is how the chief's own
    // pin is cleared, in `model.default`'s shape.
    required_keys: [],
    mutates: true,
    // Nothing in the world changes and the previous setting is one press away.
    irreversible: false,
  },

  /*
   * MAR-545. Asking an agent a question about what it has found.
   *
   * **A tenth family with one member, and the first command in this file that
   * costs the person money.** Every other entry here changes something on this
   * computer, starts or stops something DASH launched, reaches a provider for
   * free, or sends a message. This one bills an account.
   *
   * That is why `irreversible` is **true**, and it is worth saying exactly what
   * the flag means here as against on `agent.approve`. An approval running twice
   * does a thing in the world twice. A question running twice does nothing in
   * the world at all -- nothing is created, nothing is sent, and the second
   * answer overwrites nobody's anything. What cannot be undone is the *charge*,
   * and a charge is precisely the "harm no one can undo" the flag was written
   * for: DASH cannot ask a provider for its money back. Somebody reading the
   * audit deserves to see that a repeated question is not a repeated pause.
   *
   * `question` is the one free-text payload value in this whole catalogue, and
   * the only one that is neither an id nor a number. It is bounded at the
   * operation -- `MAX_QUESTION_CHARS` in `lib/broker/operations.ts` -- rather
   * than here, because that is where it is interpolated into something, and a
   * second length rule at this boundary would be a second place for the two to
   * disagree about what is too long.
   *
   * The renderer names an agent, a connection and a field, exactly as the model
   * family does. It cannot name a provider, an origin, a path, a key or a model:
   * which model answers is read in main from the row a person set through
   * `model.choose`, so a compromised page cannot spend somebody's money on the
   * most expensive thing their key reaches.
   */
  "ask.question": {
    effect:
      "Ask this agent's model a question about what the agent has saved, and charge your own account with that provider for the answer.",
    payload_keys: ["agent_id", "connection_id", "field_id", "question"],
    required_keys: ["agent_id", "connection_id", "field_id", "question"],
    mutates: true,
    irreversible: true,
  },

  /*
   * MAR-659, ADR 0023. Asking the chief about the whole fleet, and clearing
   * what it said.
   *
   * **An eleventh family, and the shortest payload in this catalogue.** Compare
   * `ask.question` directly above: that one names an agent, a connection and a
   * field, because a person is talking to one agent about one of its
   * connections. This one names a question and nothing else, and the absence is
   * the security property rather than a convenience.
   *
   * There is no agent id because there is nothing to aim: the chief is
   * `{ kind: "chief" }`, a value with no id field, so a renderer cannot direct a
   * fleet question at an agent or an agent question at the fleet. There is no
   * connection id because the chief's one connection is a constant of DASH's own
   * composed manifest (`lib/chief/manifest.ts`), and there is no model id for
   * `ask.question`'s reason, sharpened: which model answers is read in main
   * from `chief_model_choice`/`fleet_model_default`, the same way an agent's
   * own model is — `model.chief` (MAR-696) is the picker's own command, kept
   * out of this family for the reason every other setting is: naming a model
   * to ask under and asking under it are different acts, and folding the
   * first into the second would let a compromised page choose what a
   * question spends against in the same call that spends it.
   *
   * `irreversible` is true for exactly the same reason `ask.question` is, and
   * with the same caveat: nothing in the world changes, and what cannot be undone
   * is the charge. It is true even though a standing question is answered from
   * records for free, because the flag has to describe the worst thing the
   * command can do rather than the commonest.
   *
   * `chief.clear` is the person's control over their own transcript. It mutates
   * and it is irreversible — the rows are deleted rather than hidden, which is
   * `forgetAgentQuestions`' rule: a "clear" that kept a copy of a conversation
   * somebody asked DASH to forget would not be one.
   */
  "chief.ask": {
    effect:
      "Ask the chief about your fleet. Questions about how your agents are doing are answered from DASH's own records for nothing; anything else goes to your default model provider with those records attached, and your own account is charged for the answer.",
    payload_keys: ["question"],
    required_keys: ["question"],
    mutates: true,
    irreversible: true,
  },
  "chief.clear": {
    effect: "Delete the whole conversation with the chief from this computer.",
    payload_keys: [],
    required_keys: [],
    mutates: true,
    irreversible: true,
  },

  /*
   * MAR-584. An outside editor changed an agent's folder; these three are how a
   * person finds it, hears what changed, and decides.
   *
   * **A seventh family, and the split inside it is the point.** `folder.check`
   * is a read and `folder.adopt` is the write, and they are two commands rather
   * than one for the reason this whole issue exists: an agent's program is a
   * thing somebody approved, and a detector that applied what it found would
   * make the approval transfer to whatever an editor last saved. Anything that
   * could compare and then accept in one call would be that, however carefully
   * it was written.
   *
   * It is not `sample.*` either, though `folder.adopt` also rewrites a stored
   * document. That family regenerates DASH's *own* template over an agent DASH
   * scaffolded, and refuses anything else. This one accepts a document a
   * **person's editor** wrote, which is the opposite provenance, and putting the
   * two behind one name would make "what in DASH can overwrite an author's
   * document, and on whose authority" a question with a compound answer.
   */
  "folder.check": {
    effect:
      "Compare this agent's folder with what DASH accepted, and say what is different. Changes nothing.",
    payload_keys: ["agent_id"],
    required_keys: ["agent_id"],
    mutates: false,
    irreversible: false,
  },
  /*
   * `mutates` is plainly true: it replaces the stored document and the row
   * beneath it, through the ordinary import door.
   *
   * `irreversible` is **false**, and — as with `sample.refresh` — the reasoning
   * matters more than the flag. Nothing happens in the world, and the agent's
   * identity, character, runs, outputs and connected credentials all survive.
   * What this cannot undo is the *previous* stored document, which is gone once
   * the folder's version is accepted. That is bounded by where the old version
   * lives: it is DASH's projection of a folder the person's own editor changed,
   * so the version DASH is replacing is one their editor can produce again.
   *
   * The bound worth stating is not this flag. It is that accepting is **not**
   * what makes the edited program run — see `FOLDER_CHANGED`. The runner's
   * working directory is that folder and nothing verifies it before spawning, so
   * a changed program runs at the next run either way. What this command decides
   * is whether DASH's description of the agent matches the agent.
   */
  "folder.adopt": {
    effect:
      "Accept the changed folder as this agent's setup, so what DASH shows and checks matches what is there.",
    payload_keys: ["agent_id"],
    required_keys: ["agent_id"],
    mutates: true,
    irreversible: false,
  },
  /*
   * The step before the other two, and the one without which none of this is
   * reachable: DASH keeps its copy inside the user's own profile, and nobody
   * finds that path by guessing.
   *
   * `mutates` is false. It opens the operating system's own file browser at a
   * folder and returns nothing. **No path crosses this boundary in either
   * direction** — the renderer names an agent, main resolves the location, and
   * the result is a success or a refusal. That is `workspace.download`'s
   * discipline applied to the one other command that turns a click into a place
   * on the user's disk.
   */
  "folder.reveal": {
    effect: "Open this agent's folder in your file browser. Changes nothing.",
    payload_keys: ["agent_id"],
    required_keys: ["agent_id"],
    mutates: false,
    irreversible: false,
  },
  /*
   * MAR-598. The fourth folder command, and the only one in this catalogue that
   * names nothing at all.
   *
   * **The empty payload is the security argument, not a convenience.** Every
   * other command here narrows what a compromised renderer may reach by naming
   * an agent, a connection or a server it already knows about. This one narrows
   * it to nothing: page script cannot name a folder, cannot learn which folder
   * was chosen, and cannot cause any particular folder to be read. The widest
   * thing it can do is make the operating system's own folder chooser appear —
   * a window DASH does not draw, which page script cannot see, type into or
   * dismiss — and then wait to be told whether a person picked something and
   * agreed to a second dialog. That is the same discipline `workspace.download`
   * and `notify.connect` keep, taken to its end.
   *
   * It belongs to the folder family rather than to `sample.*` for the reason
   * `folder.adopt` does: the document it accepts is one a **person's own
   * project** produced, not DASH's template. And it is not `workspace.*`,
   * though that family owns the other picker, because nothing here is about a
   * task or an agent that already exists — this is how the first one arrives.
   *
   * `mutates` is plainly true and `irreversible` is false: what it writes is an
   * agent folder and a row, both of which `removeAgent` removes. It never
   * touches the folder the person chose. DASH takes a copy; the original is not
   * moved, changed or deleted, which the consent dialog says out loud before
   * anything is written.
   */
  "folder.choose": {
    /*
     * The effect line says copy and stops there, deliberately. Adding an agent
     * does not make the part of DASH that supervises agents re-read its list, so
     * nothing here starts anything — and an effect sentence that claimed
     * otherwise would be the audit record disagreeing with the command.
     */
    effect:
      "Ask you to pick a folder, check whether it holds an agent, then — after asking again — copy that folder into DASH's own keeping.",
    payload_keys: [],
    required_keys: [],
    mutates: true,
    irreversible: false,
  },
  /*
   * MAR-705. The fifth folder command: set an agent up again from the copy DASH
   * already holds.
   *
   * Henrik, on being told that repairing an agent meant `npm run open-in-dash`:
   * *"Okey, this redeploy of an faulty agent is to hard. Can you figure out how
   * we can do it from dash and not some terminal command?"* The terminal command
   * only fires a deep link at the import door; every ingredient was already
   * inside DASH, and none of them was reachable from it.
   *
   * ## What it writes, and the one thing it deliberately does not
   *
   * It rewrites DASH's *record* of an agent: the row's manifest, the
   * registration file naming the program to spawn, and the baseline MAR-584
   * compares against. Then it asks the supervisor to re-read its list, which is
   * what makes a Start press in the same session reach the agent instead of
   * being refused as unknown (MAR-616).
   *
   * **It does not re-copy the folder**, and that is not a shortcut. The folder
   * is the *source* of everything read here, so copying it over itself changes
   * no byte of the agent's program — while `writeAgentFolder` stages a
   * replacement from the files it was handed and swaps it in, which would delete
   * whatever the read skipped: a non-text file the agent wrote, an installed
   * `node_modules`. `inspectChosenFolder` refuses a folder inside DASH's own
   * keeping for exactly this reason, and this command is that refusal's answer
   * rather than a way around it: the repair a person needs is of DASH's record,
   * which is the half that goes missing.
   *
   * `mutates` is plainly true. `irreversible` is **false**, and here the flag is
   * unusually easy: the agent's folder, identity, character, runs, outputs and
   * connected credentials are all untouched, and what is rewritten is rewritten
   * *from* the folder — so the state before and the state after describe the
   * same agent, which is the whole point of a repair.
   */
  "folder.repair": {
    effect:
      "Set this agent up again from the copy DASH already keeps, so DASH can run it. Its folder, its history and what it has made are not changed.",
    payload_keys: ["agent_id"],
    required_keys: ["agent_id"],
    mutates: true,
    irreversible: false,
  },

  /*
   * MAR-536. A host is not an agent's property: it is a server DASH reaches
   * with a key DASH keeps on this computer. The renderer can name the four
   * ordinary connection facts, but not the host id, the key name, a key path
   * or either half of the private key. Main mints the two names and is the only
   * process that calls `electron/ssh-host.ts`.
   */
  "host.create": {
    effect:
      "Make a key for one server and save how DASH reaches it. Returns only the public half to copy onto the server.",
    payload_keys: ["label", "address", "username", "port"],
    payload_types: { port: "number" },
    required_keys: ["label", "address", "username", "port"],
    mutates: true,
    irreversible: false,
  },
  "host.probe": {
    effect: "Check whether DASH can reach one saved server. Changes nothing.",
    payload_keys: ["host_id"],
    required_keys: ["host_id"],
    mutates: false,
    irreversible: false,
  },

  /*
   * MAR-572. The first pin, as a command of its own rather than a side effect
   * of connecting.
   *
   * `fingerprint` is required and is the one the person was *shown*. Main
   * fetches the host's key again and refuses if it no longer matches, so the
   * thing that gets trusted is the thing that was on screen when somebody said
   * yes — not whatever answers at the moment they click. That gap is small and
   * it is exactly the gap this step exists to close.
   *
   * `mutates` is true and `irreversible` is false: what it writes is removed by
   * `host.forget`, which is the only thing that removes it.
   */
  "host.trust": {
    effect:
      "Record that you confirmed this server's identity, so DASH will sign in to it. Only ever the first time.",
    payload_keys: ["host_id", "fingerprint"],
    required_keys: ["host_id", "fingerprint"],
    mutates: true,
    irreversible: false,
  },

  /*
   * MAR-573. The text a person pastes into a server that has never heard of
   * DASH.
   *
   * `mutates` is false, and that is not a technicality: this command reads
   * DASH's own public key and the helper it ships, and composes a string.
   * Nothing on this machine or on the server changes until the person decides
   * to run it, on a machine DASH is not connected to yet.
   */
  "host.setup": {
    effect: "Write out the one-off setup step for a server, as text to copy. Changes nothing.",
    payload_keys: ["host_id"],
    required_keys: ["host_id"],
    mutates: false,
    irreversible: false,
  },
  "host.deploy": {
    effect:
      "Put one stored agent folder and DASH's standalone runner on one saved server, then start that runner.",
    payload_keys: ["host_id", "agent_id"],
    required_keys: ["host_id", "agent_id"],
    mutates: true,
    irreversible: false,
  },
  /*
   * MAR-602, ADR 0014. Start the copy of an agent that is on a server.
   *
   * A **second named action** rather than a mode of `agent.retry`, which is the
   * choice ADR 0014 made after rejecting three others: running both copies from
   * one press, silently re-targeting the existing button once a deploy exists,
   * and asking every time. The rule underneath it is that *deploying an agent
   * never changes what a control already on screen does*, and the way that stays
   * true is that this is its own command with its own name.
   *
   * It takes the same two ids `host.deploy` does, and no others. In particular
   * it takes no task id: **which** task is read from the host's own snapshot at
   * the moment of the press, so a renderer cannot name a target on a machine it
   * has never seen. That is `runner/README.md`'s rule — the API chooses which
   * registration to start, never what to run — arriving at the surface.
   *
   * `irreversible` is false and `mutates` is true, matching `agent.retry`: a
   * manual-first run can be started again, and the agent refuses a concurrent
   * one itself.
   */
  "host.run": {
    effect:
      "Ask one saved server to start the copy of one agent that is on it. DASH will only see what it did the next time it can reach that server.",
    payload_keys: ["host_id", "agent_id"],
    required_keys: ["host_id", "agent_id"],
    mutates: true,
    irreversible: false,
  },
  "host.bringHome": {
    effect:
      "Copy what one agent still has on one saved server, then remove that agent from the server. Nothing on this computer is deleted.",
    payload_keys: ["host_id", "agent_id"],
    required_keys: ["host_id", "agent_id"],
    mutates: true,
    irreversible: true,
  },
  "host.forget": {
    effect:
      "Stop using one server and remove DASH's key for it. Anything already running there keeps running.",
    payload_keys: ["host_id"],
    required_keys: ["host_id"],
    mutates: true,
    irreversible: false,
  },

  /*
   * MAR-434. Hand one of this agent's outputs back to the person who owns it.
   *
   * The route is `GET /artifacts/{id}/download` on the runner, which MAR-434
   * built and proof `9f` exercises against a real registered artifact. Nothing
   * about the contract is new here; what is new is that a page can reach it.
   *
   * **No path crosses this boundary in either direction.** The renderer names an
   * artifact by its opaque id, and main asks the *user* where to put the bytes
   * through the operating system's own save dialog — so the destination is
   * chosen in a window DASH does not draw, and the renderer neither supplies a
   * path nor learns one. That is the same discipline `runner/workspace.ts` keeps
   * when it refuses to return `stored_path`, extended to the surface that
   * finally calls it: the runner is still the only process that resolves an
   * opaque id to a location.
   *
   * `mutates` is false. This writes a file, and it writes it where the user just
   * pointed, from bytes DASH already holds — it changes nothing about the agent,
   * the store or the world the agent acts on, which is what this flag is for.
   */
  "workspace.download": {
    effect:
      "Save a copy of one output this agent produced, to a folder the user picks. Changes nothing about the agent.",
    payload_keys: ["agent_id", "artifact_id"],
    required_keys: ["agent_id", "artifact_id"],
    mutates: false,
    irreversible: false,
  },

  /*
   * MAR-674, ADR 0025 decision 4. Save a briefing as a PDF and open it.
   *
   * The same two opaque ids as `workspace.download` and the same rule about
   * them — main raises the dialog, main writes the bytes, and no path crosses
   * this boundary in either direction.
   *
   * What is different is where the bytes come from, and it is why this is a
   * second command rather than a flag on the first. `download` fetches a file
   * the *agent* wrote, over the runner's authenticated channel; a briefing is
   * composed by DASH out of an artifact it is already holding, and has no bytes
   * at the runner at all. Two sources, two failure modes, two sentences.
   *
   * `mutates` is false on `workspace.download`'s reasoning. It also opens the
   * file afterwards, which is Henrik's ruling and is a thing DASH does *for*
   * the person with a file they just chose the location of — not a change to
   * the agent, the store, or anything the agent acts on.
   */
  "workspace.exportBrief": {
    effect:
      "Save this briefing as a PDF in this agent's own folder in DASH, then open it. Changes nothing about the agent.",
    payload_keys: ["agent_id", "artifact_id"],
    required_keys: ["agent_id", "artifact_id"],
    mutates: false,
    irreversible: false,
  },

  /*
   * MAR-697, MAR-698. The two ways out of DASH's window, and there are no
   * others.
   *
   * A ninth family, and it earns one on the terms the eighth did: what these
   * have in common is not an agent, a file a person chose or the vault, but
   * that performing one **hands something to a program DASH does not own** —
   * the person's web browser, or whatever this computer opens a PDF with. That
   * is a distinct kind of reach and deserves to be findable by name, because
   * the honest answer to "what can DASH be made to launch?" should be readable
   * from one map rather than assembled out of two entries filed under a family
   * whose stated reason is files a person chose.
   *
   * **Neither widens the navigation policy, and that is the whole design.**
   * `createWindow` denies `window.open` and refuses navigation off the
   * renderer's origin; both commands leave that untouched and route the press
   * through main instead. `electron/open-out.ts` is the one place either
   * reaches Electron, and `lib/shell/outbound.ts` owns the `https` gate.
   *
   * Note the payloads. `open.link` takes an address and no agent — it is about
   * a link on a card rather than about anything DASH supervises. `open.export`
   * takes an agent and a **file name**, never a path: main computes the one
   * folder that name may resolve in, which is what bounds a compromised
   * renderer's reach here to files DASH itself wrote.
   *
   * `mutates` is false on both, on `workspace.download`'s reasoning: opening
   * something changes nothing about the agent, the store, or the world the
   * agent acts on.
   */
  "open.link": {
    effect:
      "Open one web address the agent collected, in this computer's own web browser. Secure addresses only. Changes nothing about the agent.",
    payload_keys: ["url"],
    required_keys: ["url"],
    payload_types: { url: "string" },
    mutates: false,
    irreversible: false,
  },
  "open.export": {
    effect:
      "Open one file DASH saved in this agent's exports folder, in whatever program this computer uses for it. Changes nothing about the agent.",
    payload_keys: ["agent_id", "file"],
    required_keys: ["agent_id", "file"],
    payload_types: { agent_id: "string", file: "string" },
    mutates: false,
    irreversible: false,
  },

  /*
   * MAR-588. Where DASH posts when an agent needs somebody, as three commands
   * and a switch.
   *
   * **An eighth family, and the first that is not about an agent.** Every other
   * command in this catalogue names an agent, a run, a task, a server or a
   * credential belonging to one of those. This names a channel the *person*
   * chose, which is a property of them rather than of anything DASH supervises,
   * and folding it into `connection.*` would have made "which commands touch a
   * credential an agent asked for" a question with a qualification in the answer.
   *
   * The payload rule this file opens with survives intact, and is why
   * `notify.connect` looks the way it does: **the address is absent from every
   * payload below and there is no fifth command that would carry one.** It is
   * typed into the window `electron/credential-prompt.ts` owns — the same window
   * an API key goes into, reached by the same route, reviewed once — so this
   * command asks main to *ask*, exactly as `connection.connect` does.
   */
  "notify.connect": {
    effect:
      "Ask for a Discord channel address and store it in this computer's vault, so DASH can post there when an agent needs you.",
    payload_keys: [],
    required_keys: [],
    mutates: true,
    // Replacing an address loses the old one, which DASH cannot recover — and
    // nothing happens in the world at the moment it is stored. The same call
    // `connection.connect` makes about the same shape of act.
    irreversible: false,
  },
  "notify.disconnect": {
    effect:
      "Delete the Discord channel address from this computer's vault and stop posting. Messages already sent stay in Discord.",
    payload_keys: [],
    required_keys: [],
    mutates: true,
    irreversible: false,
  },
  /*
   * `mutates` is true and the honest reason is the second half of the effect:
   * this puts a message in somebody's Discord channel, which is a thing in the
   * world DASH cannot take back.
   *
   * `irreversible` is nonetheless **false**, and the distinction is the one this
   * file draws for `agent.cancel`. The flag is about the second invitation and
   * the second payment; running this twice puts a second identical test message
   * in a channel, which is untidy rather than harmful. What makes it safe to
   * press is what it says — `buildTestMessage` states in the message itself that
   * nothing has happened to any agent, so somebody who has pointed DASH at the
   * wrong channel has told that channel nothing about their work.
   */
  "notify.test": {
    effect: "Post one test message to the Discord channel DASH holds, to prove it arrives.",
    payload_keys: [],
    required_keys: [],
    mutates: true,
    irreversible: false,
  },
  /*
   * The two switches, as one command taking which and whether.
   *
   * One rather than four (`notify.approvalsOn`, `notify.approvalsOff`, …)
   * because the payload rules already constrain it to a declared key and a
   * boolean, and because the audit line a person reads is more useful naming the
   * setting than naming a verb. `kind` is checked against the two known values in
   * main rather than here: this module is pure, and the check belongs with the
   * write it guards.
   */
  "notify.setKind": {
    effect:
      "Turn one kind of Discord message on or off. Changes nothing about the agents themselves.",
    payload_keys: ["kind", "enabled"],
    payload_types: { kind: "string", enabled: "boolean" },
    required_keys: ["kind", "enabled"],
    mutates: true,
    irreversible: false,
  },

  /*
   * MAR-743, ADR 0028. The chief's second room, as three commands.
   *
   * **The payload rule again, and this family tests it hardest.** The bot token
   * is absent from every payload below and there is no fourth command that would
   * carry one: it is typed into the window `electron/credential-prompt.ts` owns,
   * the same window an API key and a webhook address go into. What *does* cross
   * is two Discord snowflakes, and they are not credentials — a channel id names
   * a room nobody can reach without the token, and a user id is what Discord
   * shows anybody who right-clicks a name.
   *
   * The widest thing a compromised renderer can do with this family is therefore:
   * open the credential window, point an already-held token at a different
   * channel, name a different allowed speaker, or switch the whole thing off.
   * The third is the one worth naming, because a renderer that could silently
   * re-aim the allowlist would be a renderer that could hand the chief to
   * somebody else. It cannot do it silently — the command goes through the
   * credential window, which is a thing the person sees and can cancel.
   */
  "chiefDiscord.connect": {
    effect:
      "Ask for a Discord bot token, store it in this computer's vault, and let the chief answer you in one channel — you and nobody else.",
    payload_keys: ["channel_id", "allowed_user_id"],
    payload_types: { channel_id: "string", allowed_user_id: "string" },
    required_keys: ["channel_id", "allowed_user_id"],
    mutates: true,
    // Replacing a bridge loses the old token, which DASH cannot recover, and
    // nothing happens in the world at the moment it is stored. `notify.connect`'s
    // own call about the same shape of act.
    irreversible: false,
  },
  "chiefDiscord.disconnect": {
    effect:
      "Stop the chief listening in Discord and delete the bot token from this computer's vault. What it already said stays in Discord.",
    payload_keys: [],
    required_keys: [],
    mutates: true,
    irreversible: false,
  },
  "chiefDiscord.setEnabled": {
    effect:
      "Turn the chief's Discord listening on or off, keeping the setup. Changes nothing about the agents themselves.",
    payload_keys: ["enabled"],
    payload_types: { enabled: "boolean" },
    required_keys: ["enabled"],
    mutates: true,
    irreversible: false,
  },

  /*
   * MAR-479, ADR 0026. The second family that can send something off this
   * machine, and the first whose subject is DASH itself rather than an agent.
   *
   * The payload rule holds here as it does for `notify.*`: **the token is
   * absent from every payload below and there is no fifth command that would
   * carry one.** It is typed into the window `electron/credential-prompt.ts`
   * owns — the same window a Discord address goes into, reached by the same
   * route — so `lab.connect` asks main to *ask*.
   *
   * `endpoint` is the one string that does cross, and it is not a credential:
   * it is an address a person typed and can read back off their own settings
   * page. It is parsed in main rather than here, `notify.setKind`'s split
   * between a pure catalogue and the write it guards.
   */
  "lab.connect": {
    effect:
      "Ask for a LAB's ingest token, store it in this computer's vault, and remember which LAB it is for. Sends nothing until you switch sending on.",
    payload_keys: ["endpoint"],
    payload_types: { endpoint: "string" },
    required_keys: ["endpoint"],
    mutates: true,
    // Replacing a token loses the old one, which DASH cannot recover, and
    // nothing happens in the world at the moment it is stored. `notify.connect`
    // and `connection.connect` make the same call about the same shape of act.
    irreversible: false,
  },
  "lab.disconnect": {
    effect:
      "Stop sending, and delete the LAB token from this computer's vault. What was already sent stays on that LAB.",
    payload_keys: [],
    required_keys: [],
    mutates: true,
    irreversible: false,
  },
  /*
   * The one switch, taking whether.
   *
   * `mutates` is true and `irreversible` is false, and the second half needs
   * the care `notify.test` needed. Switching this on does not itself put
   * anything anywhere — the send is `lab.sendNow` or the next startup — and
   * switching it off is a complete undo of the switch. What it cannot undo is a
   * send that already happened, which is a property of `lab.sendNow` and is
   * stated there.
   */
  "lab.setEnabled": {
    effect:
      "Turn sending plan telemetry to LAB on or off. Changes nothing about the agents themselves.",
    payload_keys: ["enabled"],
    payload_types: { enabled: "boolean" },
    required_keys: ["enabled"],
    mutates: true,
    irreversible: false,
  },
  /*
   * `irreversible` is **true**, and this is the only command in the family that
   * earns it.
   *
   * This file's own test for the flag is the second invitation and the second
   * payment — an act DASH cannot take back. That is exactly this: the bytes
   * reach a database DASH does not own, and there is no request that would
   * remove them. ADR 0026 decision 7 says the same thing in prose and refuses to
   * offer an "erase what I sent" button for it. A person pressing this is
   * pressing the one control in DASH whose effect leaves the machine, so it goes
   * through the same confirmation an irreversible agent command does.
   */
  "lab.sendNow": {
    effect:
      "Send everything not yet reported to that LAB now. It cannot be taken back afterwards.",
    payload_keys: [],
    required_keys: [],
    mutates: true,
    irreversible: true,
  },

  // MAR-383. Three commands that name a connection and carry no credential.
  //
  // The secret is deliberately absent from every payload below, and there is no
  // fourth command that would carry one. A user types a credential into a
  // separate window main owns (`electron/credential-prompt.ts`), which reaches
  // the vault without passing through this channel or the app's renderer. So
  // "no secrets cross this boundary" survives a feature whose whole subject is
  // secrets: `connection.connect` asks main to *ask* for one, and is the same
  // shape as a command that asks it to forget one.
  "connection.connect": {
    effect:
      "Ask for a credential for one declared connection and store it in this computer's vault.",
    payload_keys: ["agent_id", "connection_id", "field_id"],
    required_keys: ["agent_id", "connection_id", "field_id"],
    mutates: true,
    // Replacing a credential loses the old value, which cannot be recovered
    // from DASH — but nothing happens in the world, and the user still holds
    // whatever they pasted. `irreversible` is about the second invitation and
    // the second payment.
    irreversible: false,
  },
  "connection.test": {
    // "Contacts no provider" until MAR-582, and it had already stopped being
    // true: MAR-446 made this refresh an OAuth grant, which is a request to the
    // provider, and the sentence in this catalogue — the one an audit line
    // quotes — went on saying otherwise. MAR-582 adds the second kind that
    // contacts one, so the wording is corrected rather than compounded.
    //
    // Worded by what DASH holds rather than by which of three branches runs,
    // because the reader of an audit line has the connection in front of them
    // and not this file. What survives every branch is the promise that matters:
    // the check never sends the credential anywhere except to the service it
    // belongs to, and never sends it anywhere at all for a service DASH is not a
    // client for.
    effect:
      "Check that the credential DASH holds for one connection still works. For a provider sign-in " +
      "or a model provider key this asks that provider; for anything else it reads this computer's " +
      "vault and contacts nobody.",
    payload_keys: ["agent_id", "connection_id", "field_id"],
    required_keys: ["agent_id", "connection_id", "field_id"],
    // Reads the vault and writes the result of that read to the connection's
    // row, which is state. Marked honestly rather than conveniently.
    mutates: true,
    irreversible: false,
  },
  "connection.disconnect": {
    effect: "Delete the credential for one connection from this computer's vault.",
    payload_keys: ["agent_id", "connection_id", "field_id"],
    required_keys: ["agent_id", "connection_id", "field_id"],
    mutates: true,
    // The credential is gone from DASH and cannot be recovered by DASH. That is
    // the point of the command, and the user re-enters it to undo — no external
    // effect happens either way.
    irreversible: false,
  },

  // MAR-593, ADR 0013. The same acts against a connection that belongs to no
  // agent.
  //
  // A family of its own rather than four more `connection.*` entries, and the
  // reason is what an audit line is read for. Every sentence above says "one
  // declared connection", meaning one an agent's manifest asked for; these name a
  // provider and no agent at all, and they differ in the direction that matters —
  // `fleet.disconnect` ends access for every agent at once, which is not a thing
  // `connection.disconnect` can do. Somebody working out what happened from a log
  // should not have to know that `agent_id` was a reserved word on three of these
  // lines and an agent on the others.
  //
  // They carry no `agent_id` for the same reason, and the dispatcher supplies
  // `FLEET_PRINCIPAL` itself: a renderer able to name the principal would be a
  // renderer able to aim a fleet act at an agent, or an agent act at the fleet.
  "fleet.connect": {
    effect:
      "Ask for an account sign-in or a key for one service, store it in this computer's vault, and " +
      "give it to every agent that already asked for that service.",
    payload_keys: ["provider", "account_id"],
    required_keys: ["provider"],
    mutates: true,
    irreversible: false,
  },
  "fleet.test": {
    effect:
      "Check that the sign-in or key DASH holds for one service still works, by asking that service.",
    payload_keys: ["provider", "account_id"],
    required_keys: ["provider"],
    // Reads the vault and writes down what the provider said, which is state.
    // Marked honestly rather than conveniently, as `connection.test` is.
    mutates: true,
    irreversible: false,
  },
  "fleet.disconnect": {
    effect:
      "Delete the sign-in or key for one service from this computer's vault, and take it away from " +
      "every agent DASH gave it to.",
    payload_keys: ["provider", "account_id"],
    required_keys: ["provider"],
    mutates: true,
    // Not `irreversible` in this catalogue's sense — no message is sent, no
    // money moves, and connecting again restores it. What it is, and what
    // `connection.disconnect` is not, is wide: it ends access for agents the
    // person is not looking at. That is disclosed on the card before the press,
    // which is where ADR 0002 amendment 2 says a consequence belongs.
    irreversible: false,
  },
  "fleet.share": {
    effect:
      "Give agents that asked for one service the sign-in or key DASH already holds. Asks for " +
      "nothing and contacts no service.",
    payload_keys: ["provider", "account_id"],
    required_keys: ["provider"],
    mutates: true,
    irreversible: false,
  },
  "fleet.default": {
    effect:
      "Choose which connected account a new agent uses for one service when no account was assigned yet.",
    payload_keys: ["provider", "account_id"],
    required_keys: ["provider", "account_id"],
    mutates: true,
    irreversible: false,
  },
  "fleet.assign": {
    effect:
      "Choose which connected account one agent uses for one service, and replace that agent's materialized credential.",
    payload_keys: ["provider", "account_id", "agent_id"],
    required_keys: ["provider", "account_id", "agent_id"],
    mutates: true,
    irreversible: false,
  },

  "agent.approve": {
    effect: "Approve a guarded action the agent is waiting on. The runner performs it.",
    payload_keys: ["agent_id", "task_id", "approval_id", "action_id", "observed_at", "reason"],
    required_keys: ["agent_id", "task_id", "approval_id", "observed_at"],
    mutates: true,
    irreversible: true,
  },
  "agent.reject": {
    effect: "Refuse a guarded action the agent is waiting on. The runner will not perform it.",
    payload_keys: ["agent_id", "task_id", "approval_id", "action_id", "observed_at", "reason"],
    required_keys: ["agent_id", "task_id", "approval_id", "observed_at"],
    mutates: true,
    irreversible: true,
  },
  "agent.choose": {
    effect: "Answer a choice the agent is waiting on with one of the options it offered.",
    payload_keys: ["agent_id", "task_id", "choice_id", "option_id", "observed_at"],
    required_keys: ["agent_id", "task_id", "choice_id", "option_id", "observed_at"],
    mutates: true,
    irreversible: true,
  },
  "agent.retry": {
    effect: "Ask the agent to run a failed or cancelled run again.",
    payload_keys: ["agent_id", "run_id", "task_id", "observed_at", "reason"],
    required_keys: ["agent_id", "observed_at"],
    mutates: true,
    // Retry is the command `retryIsSafe` exists for: a run that already
    // executed an irreversible component could execute it a second time.
    irreversible: true,
  },
  "agent.pause": {
    effect: "Ask the agent to stop working on a run until it is resumed.",
    payload_keys: ["agent_id", "run_id", "task_id", "observed_at", "reason"],
    required_keys: ["agent_id", "observed_at"],
    mutates: true,
    irreversible: false,
  },
  "agent.resume": {
    effect: "Ask the agent to continue a paused run.",
    payload_keys: ["agent_id", "run_id", "task_id", "observed_at", "reason"],
    required_keys: ["agent_id", "observed_at"],
    mutates: true,
    irreversible: false,
  },
  "agent.cancel": {
    effect: "Ask the agent to stop a run and not continue it.",
    payload_keys: ["agent_id", "run_id", "task_id", "observed_at", "reason"],
    required_keys: ["agent_id", "observed_at"],
    mutates: true,
    // Cancelling twice leaves a run cancelled. Terminal is not the same as
    // irreversible: nothing new happens in the world on the second attempt.
    irreversible: false,
  },

  /*
   * MAR-507. The task workspace, as three commands.
   *
   * A fourth family, for the reason the third exists. These are not Agent DOM
   * verbs — no manifest declares them and no envelope carries them — and they
   * are not process lifecycle. They move a person's own files, which nothing
   * else in this catalogue does.
   *
   * **The path is the whole design.** `workspace.selectInput` carries an agent
   * and a role and no path in either direction: the renderer asks main to *ask*
   * the user for a file, exactly as `connection.connect` asks main to ask for a
   * credential without ever carrying one. Main opens `dialog.showOpenDialog`,
   * reads the declared limits out of the manifest itself, and hands the runner a
   * path the renderer never saw and could not have chosen. So a compromised
   * renderer can ask for a file picker and cannot name a file.
   *
   * Nothing here can widen what the agent declared either. `role_id` is checked
   * against the manifest in main and refused if it names a role the agent does
   * not accept, and the limits travel from the manifest rather than from the
   * payload — see `declaredLimitsFor`.
   */
  "workspace.openTask": {
    effect:
      "Open a place for this agent's next run to receive files. Copies nothing and starts nothing.",
    payload_keys: ["agent_id"],
    required_keys: ["agent_id"],
    // It creates a directory the runner owns. Nothing of the user's moves and
    // nothing runs, but a store row exists afterwards that did not before.
    mutates: true,
    irreversible: false,
  },
  "workspace.selectInput": {
    effect:
      "Ask for one of your files and copy it into this agent's task. The agent is not started.",
    payload_keys: ["agent_id", "task_id", "role_id"],
    required_keys: ["agent_id", "task_id", "role_id"],
    mutates: true,
    // A copy is made and the original is untouched. The runner refuses to
    // remove an admitted input, so the copy stays until the task is cleaned up
    // — which is a thing DASH can undo by not running the task, not a change in
    // the world.
    irreversible: false,
  },
  "workspace.dispatchTask": {
    effect:
      "Hand the files you chose to the agent and close the task to further changes.",
    payload_keys: ["agent_id", "task_id", "run_id"],
    required_keys: ["agent_id", "task_id"],
    mutates: true,
    // The task closes and cannot be reopened, and the agent receives the files.
    // Not `irreversible` in this flag's sense — nothing leaves the machine and
    // no second invitation or payment happens — but it is the point of no
    // return for the *selection*, and the copy on the button says so.
    irreversible: false,
  },
} as const satisfies Record<string, CommandSpec>;

/**
 * The renderer-facing command name for each contract verb.
 *
 * Kept as data rather than as a string transformation (`name.slice(6)`) so that
 * the mapping is something a reviewer reads rather than something they compute,
 * and so a typo produces a compile error instead of a command that addresses a
 * verb nobody meant.
 */
export const AGENT_COMMAND_VERBS = {
  "agent.approve": "approve",
  "agent.reject": "reject",
  "agent.choose": "choose",
  "agent.retry": "retry",
  "agent.pause": "pause",
  "agent.resume": "resume",
  "agent.cancel": "cancel",
} as const satisfies Record<string, AgentCommand>;

export type AgentCommandChannelName = keyof typeof AGENT_COMMAND_VERBS;

export function isAgentCommandName(value: CommandName): value is AgentCommandChannelName {
  return Object.hasOwn(AGENT_COMMAND_VERBS, value);
}

/**
 * The lifecycle commands, and what each one asks the runner to do.
 *
 * A separate map from `AGENT_COMMAND_VERBS` rather than more entries in it,
 * because they are not the same kind of thing and the type system should say
 * so: an agent command becomes an envelope and is adjudicated against a
 * manifest, a lifecycle command becomes a process operation and is not.
 */
export const RUNNER_LIFECYCLE = {
  "runner.start": "start",
  "runner.stop": "stop",
  "runner.status": "status",
  // MAR-428. Not forwarded to the runner's `/lifecycle` route: removing an
  // agent stops a process *and* deletes files DASH owns *and* forgets a store
  // row, which is a sequence only the shell can perform in the right order.
  // `electron/main.ts` handles this action itself. It lives in this map anyway
  // because it is the same *kind* of thing — DASH acting on something it
  // launched — and giving it a fourth command family would buy nothing but a
  // fourth place to forget the audit record.
  "runner.remove": "remove",
  // MAR-595 finding 18. Same reasoning as `runner.remove` immediately above —
  // shell-only sequence, handled in `electron/main.ts`'s `runnerLifecycle`.
  "runner.removeKeepFiles": "removeKeepFiles",
  // MAR-518. A store-level repair, not a per-agent one — see the `COMMANDS`
  // entry for why it carries no `agent_id`.
  "runner.retireStore": "retireStore",
} as const;

export type RunnerCommandName = keyof typeof RUNNER_LIFECYCLE;

export function isRunnerCommandName(value: CommandName): value is RunnerCommandName {
  return Object.hasOwn(RUNNER_LIFECYCLE, value);
}

/**
 * The connection commands, and what each one asks main to do (MAR-383).
 *
 * A third family rather than more `runner.*` entries, for the reason the second
 * one exists: these are not process lifecycle and they are not Agent DOM verbs.
 * They touch the OS vault, which nothing else in this catalogue does, and
 * keeping that a separate route means the one place a credential is reachable
 * is a place a reviewer can find by name.
 */
/**
 * The task-workspace commands, and what each one asks main to do (MAR-507).
 *
 * A fourth family for the reason the third exists: they are neither Agent DOM
 * verbs nor process lifecycle, and the one thing they have in common is that
 * they touch files a person chose. Keeping that its own route means the one
 * place a user's own path is reachable is a place a reviewer can find by name —
 * the same argument `CONNECTION_ACTIONS` makes about the vault.
 */
export const WORKSPACE_ACTIONS = {
  "workspace.openTask": "open_task",
  "workspace.selectInput": "select_input",
  "workspace.dispatchTask": "dispatch_task",
  // MAR-434's download joined this family first — the half of that issue's
  // acceptance criterion that had a proven route and no way to reach it from a
  // page. The input-selection commands landing beside it is what the family
  // was made for.
  "workspace.download": "download",
  // MAR-674. A fifth member, and it belongs here for the family's own stated
  // reason: it touches a file a person chose. It reaches no runner — see the
  // catalogue entry — which is the one thing that makes it a sibling of
  // `download` rather than the same command with a format flag.
  "workspace.exportBrief": "export_brief",
} as const;

export type WorkspaceCommandName = keyof typeof WORKSPACE_ACTIONS;
export type WorkspaceAction = (typeof WORKSPACE_ACTIONS)[WorkspaceCommandName];

export function isWorkspaceCommandName(value: CommandName): value is WorkspaceCommandName {
  return Object.hasOwn(WORKSPACE_ACTIONS, value);
}

/**
 * Handing something to a program DASH does not own (MAR-697, MAR-698).
 *
 * A ninth family, for the reason set out beside its two catalogue entries: this
 * is the only route by which a press inside DASH's window can start something
 * outside it. `WORKSPACE_ACTIONS` would have been the tempting home for the
 * second member — it does touch a file — and folding it in there would have
 * made "what can DASH launch?" a question whose answer is spread across a
 * family whose stated subject is files a person chose. These two are about the
 * *launch*, and the file is incidental to one of them.
 *
 * Both are performed by `electron/open-out.ts` and nothing else, which is what
 * makes that module reviewable as the seam rather than as one caller of many.
 */
export const OPEN_ACTIONS = {
  "open.link": "link",
  "open.export": "export",
} as const;

export type OpenCommandName = keyof typeof OPEN_ACTIONS;
export type OpenAction = (typeof OPEN_ACTIONS)[OpenCommandName];

export function isOpenCommandName(value: CommandName): value is OpenCommandName {
  return Object.hasOwn(OPEN_ACTIONS, value);
}

/**
 * Re-importing an agent DASH scaffolded (MAR-576).
 *
 * A fifth family with one member, on the terms the fourth was created under: it
 * is not an Agent DOM verb, not process lifecycle, not the vault and not a file
 * a person chose. What these touch is **the stored manifest itself** — the one
 * document every other surface in DASH treats as the author's and never edits —
 * and a route that can rewrite it deserves to be findable by name rather than
 * folded in beside three commands that cannot.
 *
 * One member is not a shape waiting to be filled. If nothing ever joins it, a
 * reviewer asking "what in DASH can overwrite an author's document?" still gets
 * a complete answer from one map.
 */
export const SAMPLE_ACTIONS = {
  "sample.refresh": "refresh",
} as const;

export type SampleCommandName = keyof typeof SAMPLE_ACTIONS;
export type SampleAction = (typeof SAMPLE_ACTIONS)[SampleCommandName];

export function isSampleCommandName(value: CommandName): value is SampleCommandName {
  return Object.hasOwn(SAMPLE_ACTIONS, value);
}

/**
 * Remembering that somebody looked (MAR-586).
 *
 * A sixth family on the terms the fifth was created under, and the distinction
 * is sharper than any of the others: every command in the five families above
 * acts on something DASH supervises, and this one records something about the
 * person at the keyboard. A reviewer asking "what in DASH writes down what the
 * user has read?" gets a complete answer from one map with one member in it.
 *
 * One member is not a shape waiting to be filled — see `SAMPLE_ACTIONS` for the
 * same standing.
 */
export const GLANCE_ACTIONS = {
  "glance.looked": "looked",
} as const;

export type GlanceCommandName = keyof typeof GLANCE_ACTIONS;
export type GlanceAction = (typeof GLANCE_ACTIONS)[GlanceCommandName];

export function isGlanceCommandName(value: CommandName): value is GlanceCommandName {
  return Object.hasOwn(GLANCE_ACTIONS, value);
}

/**
 * The reader's own record of one agent (MAR-589, MAR-640, MAR-615).
 *
 * One member until MAR-640 made it two and MAR-615 made it three, each on
 * `FOLDER_ACTIONS`' own terms: the question this map answers widens by
 * exactly one word each time — what does DASH itself remember about an
 * agent, for the reader rather than about the agent — and a name, a star and
 * a costume are three facts of that one story. Every member contacts
 * nobody, every one is DASH's own record rather than the manifest's, and
 * every one is one more press away from whatever it replaced.
 */
export const IDENTITY_ACTIONS = {
  "identity.rename": "rename",
  "identity.favourite": "favourite",
  "identity.avatar": "avatar",
} as const;

export type IdentityCommandName = keyof typeof IDENTITY_ACTIONS;
export type IdentityAction = (typeof IDENTITY_ACTIONS)[IdentityCommandName];

export function isIdentityCommandName(value: CommandName): value is IdentityCommandName {
  return Object.hasOwn(IDENTITY_ACTIONS, value);
}

/**
 * A person's standing answers to an agent's runtime questions (MAR-681).
 *
 * Its own map rather than a fourth member of `IDENTITY_ACTIONS`: that map's
 * three facts are about *identifying* an agent to the reader, and a standing
 * answer is about a *question* the agent asked, keyed by the question's own
 * words rather than by nothing at all. Both are DASH's own record and both
 * contact nobody, which is as far as the resemblance goes.
 */
export const STANDING_ANSWER_ACTIONS = {
  "standing_answer.set": "set",
  "standing_answer.clear": "clear",
} as const;

export type StandingAnswerCommandName = keyof typeof STANDING_ANSWER_ACTIONS;
export type StandingAnswerAction = (typeof STANDING_ANSWER_ACTIONS)[StandingAnswerCommandName];

export function isStandingAnswerCommandName(value: CommandName): value is StandingAnswerCommandName {
  return Object.hasOwn(STANDING_ANSWER_ACTIONS, value);
}

/**
 * When DASH should start an agent with nobody watching (MAR-742 item 8,
 * ADR 0029).
 *
 * Its own map rather than a third member of `STANDING_ANSWER_ACTIONS`, whose own
 * note already draws this line once: that map is about a *question the agent
 * asked*, and this is about a time of day at which nothing will be asked at all.
 * The catalogue entries carry the longer version.
 *
 * Two members and not three. There is no `schedule.runNow` here, and its absence
 * is the design: Run now already exists, goes through `runAgentCommand`, and is
 * the one place ADR 0016's spend allowance opens. A second door to the same act
 * that happened to sit in this family would be a second place that decides what
 * a run press means.
 */
export const SCHEDULE_ACTIONS = {
  "schedule.set": "set",
  "schedule.clear": "clear",
} as const;

export type ScheduleCommandName = keyof typeof SCHEDULE_ACTIONS;
export type ScheduleAction = (typeof SCHEDULE_ACTIONS)[ScheduleCommandName];

export function isScheduleCommandName(value: CommandName): value is ScheduleCommandName {
  return Object.hasOwn(SCHEDULE_ACTIONS, value);
}

/**
 * An agent's folder, as edited from outside DASH (MAR-584).
 *
 * A seventh family with three members, and the reason it is a family rather
 * than three additions to older maps is in the catalogue entries above: one of
 * these compares, one accepts, and one opens a window on the user's own
 * computer. A reviewer asking "what happens when something outside DASH changes
 * an agent?" gets a complete answer from one map.
 *
 * MAR-598 makes it four, and the fourth is deliberately here rather than in a
 * family of its own. The question the map answers widens by exactly one word —
 * *what happens when a folder on this computer becomes an agent DASH holds* —
 * and choosing, comparing and accepting are three moments of that one story. A
 * ninth family would have split it across two maps and made "which commands can
 * write an agent folder" a question with a compound answer.
 */
export const FOLDER_ACTIONS = {
  "folder.check": "check",
  "folder.adopt": "adopt",
  "folder.reveal": "reveal",
  "folder.choose": "choose",
  "folder.repair": "repair",
} as const;

export type FolderCommandName = keyof typeof FOLDER_ACTIONS;
export type FolderAction = (typeof FOLDER_ACTIONS)[FolderCommandName];

export function isFolderCommandName(value: CommandName): value is FolderCommandName {
  return Object.hasOwn(FOLDER_ACTIONS, value);
}

/**
 * Which model an agent uses (MAR-583).
 *
 * An eighth family with three members. The catalogue entries above argue why it
 * is its own family rather than three additions to `CONNECTION_ACTIONS`; what
 * the map itself buys is the same thing every other one does — the trusted-side
 * switch and the named preload methods are both exhaustive over it, so a fourth
 * member cannot be added without both of them stopping compiling.
 *
 * MAR-642 made it five and MAR-654 six. Every addition since the third has been
 * about no agent — DASH's default model, the catalogue behind it, and what one
 * *level* means — and each one stayed here rather than starting a family for the
 * reason `model.default`'s own entry gives: what they change is which model DASH
 * asks for, which is a setting, in the family whose name is a setting.
 */
export const MODEL_ACTIONS = {
  "model.choose": "choose",
  "model.step": "step",
  "model.list": "list",
  // MAR-642. Two members about no agent — see their catalogue entries for why
  // they are in this family and what naming a provider does and does not widen.
  "model.default": "default",
  "model.catalogue": "catalogue",
  // MAR-654. A third, on the same terms: what one *level* means, fleet-wide.
  "model.level": "level",
  // MAR-696. A fourth: the chief's own model, read before the fleet default
  // rather than instead of it — never a fourth family, on this comment's own
  // terms: what it changes is still which model DASH asks for.
  "model.chief": "chief",
} as const;

export type ModelCommandName = keyof typeof MODEL_ACTIONS;
export type ModelAction = (typeof MODEL_ACTIONS)[ModelCommandName];

export function isModelCommandName(value: CommandName): value is ModelCommandName {
  return Object.hasOwn(MODEL_ACTIONS, value);
}

/**
 * Talking to an agent (MAR-545).
 *
 * A tenth family with one member, on the terms the eighth and ninth were created
 * under. The question it answers alone is one nothing else in this file can:
 * **what in DASH can spend the person's money?** One map, one member, and a
 * reviewer gets a complete answer without reading the other nine.
 *
 * Not `model.*`, though it uses the same three ids and the same key. That family
 * decides *which* model an agent uses and every one of its members is free to
 * run; this one runs one. Folding a billed call in beside three settings changes
 * would put the only expensive thing in DASH inside a family whose name promises
 * a preference.
 */
export const ASK_ACTIONS = {
  "ask.question": "question",
} as const;

export type AskCommandName = keyof typeof ASK_ACTIONS;
export type AskAction = (typeof ASK_ACTIONS)[AskCommandName];

export function isAskCommandName(value: CommandName): value is AskCommandName {
  return Object.hasOwn(ASK_ACTIONS, value);
}

/**
 * Talking to the chief (MAR-659, ADR 0023).
 *
 * An eleventh family, and not more of `ask.*`, on the terms the tenth was
 * created under. That map answers *what in DASH can spend the person's money?*
 * and this one is a second thing that can, so the honest reading is that the
 * question now has two answers and a reviewer should see both maps.
 *
 * They are kept apart because the two commands are aimed at different
 * principals, which is the distinction ADR 0023 spent a type on: `ask.*` carries
 * an agent id and reaches `{ kind: "agent" }`; `chief.*` carries no id at all
 * and reaches `{ kind: "chief" }`. One map holding both would make "which of
 * these can be pointed at an agent?" a question about payload keys rather than
 * about which family a command is in.
 */
export const CHIEF_ACTIONS = {
  "chief.ask": "ask",
  "chief.clear": "clear",
} as const;

export type ChiefCommandName = keyof typeof CHIEF_ACTIONS;
export type ChiefAction = (typeof CHIEF_ACTIONS)[ChiefCommandName];

export function isChiefCommandName(value: CommandName): value is ChiefCommandName {
  return Object.hasOwn(CHIEF_ACTIONS, value);
}

/**
 * Where DASH posts when an agent needs somebody (MAR-588).
 *
 * A ninth family, on the terms the eighth was created under. A reviewer
 * asking "what in DASH can send something off this machine on its own?" gets a
 * complete answer from this one map — which is a question worth being able to
 * ask, and one no other map in this file answers.
 */
export const NOTIFY_ACTIONS = {
  "notify.connect": "connect",
  "notify.disconnect": "disconnect",
  "notify.test": "test",
  "notify.setKind": "set_kind",
} as const;

export type NotifyCommandName = keyof typeof NOTIFY_ACTIONS;
export type NotifyAction = (typeof NOTIFY_ACTIONS)[NotifyCommandName];

export function isNotifyCommandName(value: CommandName): value is NotifyCommandName {
  return Object.hasOwn(NOTIFY_ACTIONS, value);
}

/**
 * Where the chief may be spoken to from outside DASH (MAR-743, ADR 0028).
 *
 * A twelfth family, and its own rather than three more entries in
 * `NOTIFY_ACTIONS`, on the terms every split in this file has been made under.
 * That map answers *what can DASH send off this machine on its own?* and its
 * answer is "a message about an agent, composed by DASH, to a channel". This one
 * answers a different question — *what can reach in?* — and there is exactly one
 * map for it, which is worth being able to read in one place.
 *
 * The two also differ in what a compromised renderer gets. `notify.*` cannot
 * name an address at all. These carry two ids, because a channel and an allowed
 * speaker are things a person has to be able to see and correct, and a
 * credential is not.
 */
export const CHIEF_DISCORD_ACTIONS = {
  "chiefDiscord.connect": "connect",
  "chiefDiscord.disconnect": "disconnect",
  "chiefDiscord.setEnabled": "set_enabled",
} as const;

export type ChiefDiscordCommandName = keyof typeof CHIEF_DISCORD_ACTIONS;
export type ChiefDiscordAction = (typeof CHIEF_DISCORD_ACTIONS)[ChiefDiscordCommandName];

export function isChiefDiscordCommandName(
  value: CommandName,
): value is ChiefDiscordCommandName {
  return Object.hasOwn(CHIEF_DISCORD_ACTIONS, value);
}

/**
 * What DASH tells a LAB about its own agents' plans (MAR-479, ADR 0026).
 *
 * The tenth family, and the second half of the answer `NOTIFY_ACTIONS`' own
 * docblock promises. A reviewer asking *"what in DASH can send something off
 * this machine on its own?"* now reads two maps rather than one, and they are
 * adjacent so that the answer stays complete.
 */
export const LAB_ACTIONS = {
  "lab.connect": "connect",
  "lab.disconnect": "disconnect",
  "lab.setEnabled": "set_enabled",
  "lab.sendNow": "send_now",
} as const;

export type LabCommandName = keyof typeof LAB_ACTIONS;
export type LabAction = (typeof LAB_ACTIONS)[LabCommandName];

export function isLabCommandName(value: CommandName): value is LabCommandName {
  return Object.hasOwn(LAB_ACTIONS, value);
}

export const CONNECTION_ACTIONS = {
  "connection.connect": "connect",
  "connection.test": "test",
  "connection.disconnect": "disconnect",
} as const;

export type ConnectionCommandName = keyof typeof CONNECTION_ACTIONS;
export type ConnectionAction = (typeof CONNECTION_ACTIONS)[ConnectionCommandName];

export function isConnectionCommandName(value: CommandName): value is ConnectionCommandName {
  return Object.hasOwn(CONNECTION_ACTIONS, value);
}

/**
 * The fleet family (MAR-593, ADR 0013).
 *
 * Four names of its own and — deliberately — the same **verbs**, because the
 * trusted side performs them through the same `connectionAction` dependency.
 * That is not an economy: every seam a fleet connection needs was already being
 * injected for the per-agent one — the vault, the credential prompt, the sign-in
 * window, the model-provider probe and the agent list — and inventing a second
 * dependency carrying the same five things would have been a second place for
 * them to be wired differently.
 *
 * `share` is the one verb with no `connection.*` twin. It gives out a consent
 * DASH already holds and asks for nothing, which is meaningless for a connection
 * that belongs to a single agent — `performConnectionAction` refuses it there in
 * so many words.
 */
export const FLEET_ACTIONS = {
  "fleet.connect": "connect",
  "fleet.test": "test",
  "fleet.disconnect": "disconnect",
  "fleet.share": "share",
  "fleet.default": "default",
  "fleet.assign": "assign",
} as const;

export type FleetCommandName = keyof typeof FLEET_ACTIONS;
export type FleetAction = (typeof FLEET_ACTIONS)[FleetCommandName];

export function isFleetCommandName(value: CommandName): value is FleetCommandName {
  return Object.hasOwn(FLEET_ACTIONS, value);
}

/**
 * The server commands, and what each one asks main to do (MAR-536).
 *
 * Deliberately a sixth family rather than runner lifecycle: a runner is a
 * process DASH launched, while a host is somebody else's server DASH may later
 * deploy to. The three names are kept here, not derived from a string prefix,
 * so the trusted-side switch and the named preload methods are both exhaustive.
 */
export const HOST_ACTIONS = {
  "host.create": "create",
  "host.probe": "probe",
  "host.trust": "trust",
  "host.setup": "setup",
  "host.deploy": "deploy",
  "host.run": "run",
  "host.bringHome": "bringHome",
  "host.forget": "forget",
} as const;

export type HostCommandName = keyof typeof HOST_ACTIONS;
export type HostAction = (typeof HOST_ACTIONS)[HostCommandName];

export function isHostCommandName(value: CommandName): value is HostCommandName {
  return Object.hasOwn(HOST_ACTIONS, value);
}

/**
 * The window-chrome commands (MAR-440).
 *
 * A fourth family for the reason the second and third exist: it is not an Agent
 * DOM verb, not runner lifecycle and not a credential. It asks main to draw
 * something on this machine's screen and reaches no agent, no store and no
 * provider — which is why it is the only family whose commands may declare
 * `mutates: false`.
 */
export const SHELL_UI_ACTIONS = {
  "shell.menu": "menu",
  "shell.scale": "scale",
  // MAR-642. The third, and the only one whose effect outlives the call: a
  // window keeps the theme it was told until it is told another or closes.
  "shell.theme": "theme",
} as const;

export type ShellUiCommandName = keyof typeof SHELL_UI_ACTIONS;

export function isShellUiCommandName(value: CommandName): value is ShellUiCommandName {
  return Object.hasOwn(SHELL_UI_ACTIONS, value);
}

/**
 * The controlled browser's two commands (MAR-628, ADR 0019).
 *
 * A family of its own rather than two more entries in `SHELL_UI_ACTIONS`, and
 * the reason is that they are not the same kind of thing. Everything in that
 * map changes how this window looks and nothing else; `browser.stop` destroys a
 * Chromium session and refuses an agent's requests for the rest of its run,
 * which is `mutates: true` and belongs in an audit row somebody may later go
 * looking for. Filing it under the cosmetic family would have been one line of
 * convenience and a misfiled receipt.
 */
export const BROWSER_ACTIONS = {
  "browser.viewport": "viewport",
  "browser.stop": "stop",
} as const;

export type BrowserCommandName = keyof typeof BROWSER_ACTIONS;

export function isBrowserCommandName(value: CommandName): value is BrowserCommandName {
  return Object.hasOwn(BROWSER_ACTIONS, value);
}

/**
 * Every command is local, an Agent DOM command, or runner lifecycle.
 *
 * This is a compile-time assertion, not a runtime one: adding an entry to
 * `COMMANDS` without routing it produces a type error here. The `never` check in
 * `executeCommand` catches the same class of mistake for local commands, and
 * this catches it for the dispatcher.
 */
type UnroutedCommand = Exclude<
  CommandName,
  | AgentCommandChannelName
  | RunnerCommandName
  | ConnectionCommandName
  | FleetCommandName
  | HostCommandName
  | ShellUiCommandName
  | BrowserCommandName
  | WorkspaceCommandName
  | OpenCommandName
  | SampleCommandName
  | GlanceCommandName
  | IdentityCommandName
  | StandingAnswerCommandName
  | ScheduleCommandName
  | FolderCommandName
  | ModelCommandName
  | NotifyCommandName
  | LabCommandName
  | AskCommandName
  | ChiefCommandName
  | ChiefDiscordCommandName
  | "shell.ping"
>;
const _allCommandsAreRouted: UnroutedCommand extends never ? true : never = true;
void _allCommandsAreRouted;

export type CommandName = keyof typeof COMMANDS;

export function isCommandName(value: unknown): value is CommandName {
  return typeof value === "string" && Object.hasOwn(COMMANDS, value);
}

/* ---------------------------------------------------------------------- *
 * Requests, decisions and audit records
 * ---------------------------------------------------------------------- */

/** What the renderer sends. Treated as fully untrusted — it is `unknown` until reviewed. */
export interface CommandRequest {
  command: string;
  /** Correlates the renderer's call with its audit record. */
  request_id: string;
  payload?: Record<string, unknown>;
}

export type DenialReason =
  | "unknown_command"
  | "malformed_request"
  | "unexpected_payload_field"
  | "unsupported_payload_value"
  | "missing_payload_field";

/**
 * The audit record. Deliberately contains no payload *values* — only the keys
 * that were present.
 *
 * The reason is the rule above: a command may not carry a secret. Logging keys
 * proves what was asked without betting the log's safety on that rule holding
 * forever. If a future command does need a value audited, it should opt in
 * explicitly, in review.
 */
export interface CommandAuditRecord {
  request_id: string;
  /** The raw string as received — an unknown command's name is worth knowing. */
  command: string;
  decision: "allowed" | "denied";
  reason?: DenialReason;
  /** Keys only, never values. */
  payload_keys: string[];
  mutates: boolean;
}

export type CommandReview =
  | {
      decision: "allowed";
      command: CommandName;
      spec: CommandSpec;
      /**
       * The payload, narrowed to the declared keys and to primitives.
       *
       * Carried on the *review* and never on the audit record — the boundary
       * between "what the command layer may act on" and "what gets written
       * down" is the whole "keys, never values" rule, and putting the values
       * one field away from the record keeps that distinction visible at every
       * call site.
       */
      payload: Record<string, string | number | boolean>;
      audit: CommandAuditRecord;
    }
  | { decision: "denied"; reason: DenialReason; audit: CommandAuditRecord };

function denied(
  reason: DenialReason,
  command: string,
  requestId: string,
  payloadKeys: string[] = [],
): CommandReview {
  return {
    decision: "denied",
    reason,
    audit: {
      request_id: requestId,
      command,
      decision: "denied",
      reason,
      payload_keys: payloadKeys,
      // A denied command ran nothing, so it mutated nothing.
      mutates: false,
    },
  };
}

/**
 * The gate. Given anything at all from the renderer, decide whether it may run
 * and produce the record of that decision.
 *
 * Every path returns an audit record — including the malformed ones. A request
 * so broken it has no usable id still gets logged (with `request_id: ""`),
 * because "someone sent garbage down the command channel" is exactly the event
 * an audit log should show.
 */
export function reviewCommand(request: unknown): CommandReview {
  if (typeof request !== "object" || request === null) {
    return denied("malformed_request", "", "");
  }

  const { command, request_id: requestId, payload } = request as Partial<CommandRequest>;
  const safeId = typeof requestId === "string" ? requestId : "";
  const safeCommand = typeof command === "string" ? command : "";

  if (safeCommand === "" || safeId === "") {
    return denied("malformed_request", safeCommand, safeId);
  }

  if (!isCommandName(safeCommand)) {
    return denied("unknown_command", safeCommand, safeId);
  }

  if (payload !== undefined && (typeof payload !== "object" || payload === null)) {
    return denied("malformed_request", safeCommand, safeId);
  }

  const spec: CommandSpec = COMMANDS[safeCommand];
  const keys = payload === undefined ? [] : Object.keys(payload);

  for (const key of keys) {
    if (!spec.payload_keys.includes(key)) {
      // Denying the *whole* request rather than dropping the extra field: a
      // caller sending a field we do not understand has a different model of
      // this command than we do, and silently ignoring it hides that.
      return denied("unexpected_payload_field", safeCommand, safeId, keys);
    }
    const value = (payload as Record<string, unknown>)[key];
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      // Primitives only. Objects and arrays are where a credential blob, a
      // buffer or a prototype-pollution payload would arrive.
      return denied("unsupported_payload_value", safeCommand, safeId, keys);
    }
    if (value === "") {
      // An empty string is a present-but-absent field. The contract gives every
      // id `minLength: 1`, so accepting one here would only move the failure to
      // envelope validation, where it would be reported as a DASH bug rather
      // than as the caller's missing argument.
      return denied("missing_payload_field", safeCommand, safeId, keys);
    }
  }

  for (const required of spec.required_keys) {
    // Required ids are strings by default. `host.create.port` is the deliberate
    // exception: a port is a number, and declaring it as one keeps a string
    // representation from becoming a second parser between the renderer and
    // `checkHostRecord`.
    const requiredType = spec.payload_types?.[required] ?? "string";
    if (typeof (payload as Record<string, unknown> | undefined)?.[required] !== requiredType) {
      return denied("missing_payload_field", safeCommand, safeId, keys);
    }
  }

  return {
    decision: "allowed",
    command: safeCommand,
    spec,
    payload: (payload ?? {}) as Record<string, string | number | boolean>,
    audit: {
      request_id: safeId,
      command: safeCommand,
      decision: "allowed",
      payload_keys: keys,
      mutates: spec.mutates,
    },
  };
}

/* ---------------------------------------------------------------------- *
 * Execution
 * ---------------------------------------------------------------------- */

export interface CommandResult {
  ok: boolean;
  request_id: string;
  /**
   * Present only on denial. The renderer gets the reason code, nothing more.
   *
   * The two families are deliberately one field. A caller does not care whether
   * its command died at the IPC allowlist or at the runner's approval check —
   * it cares what to tell the user — and giving the two seams separate fields
   * would push that distinction into the UI, which is the layer least able to
   * make anything of it.
   */
  reason?: DenialReason | string;
  /**
   * Command-specific, non-secret result data. `shell.ping` returns nothing.
   *
   * Values are scalars, or a **list of flat rows** of scalars — and one level
   * is the whole of the widening MAR-606 made here. The flatness is a safety
   * property rather than a style: a reviewer can read this one line and know
   * that nothing arbitrarily nested crosses to the renderer, which is what stops
   * a future field quietly carrying a whole record — with whatever is on it —
   * because it happened to be in scope at the call site.
   *
   * `host.probe`'s `agents_there` is the list that needed it: two strings and a
   * boolean per row, from the server's own answer. See ADR 0015.
   */
  data?: Record<
    string,
    string | number | boolean | readonly Record<string, string | number | boolean>[]
  >;
  /** Agent commands only: the audit correlation this attempt was filed under. */
  correlation_id?: string;
  /** Agent commands only: true when an earlier identical command's result was returned. */
  duplicate?: boolean;
  /** Agent commands only: plain-language detail, safe to render. */
  detail?: string;
  /**
   * Connection commands only (MAR-383): what the user can do about a failure.
   *
   * A structured `Recovery` rather than a code, because the page renders a
   * headline, a meaning and a next action, and reducing it to a string here
   * would put the job of turning "vault_locked" into three sentences in the
   * renderer — the layer furthest from knowing which vault it was. Contains no
   * secret: `lib/copy/recovery.ts` is given a service name and a vault label.
   */
  recovery?: Recovery;
  /**
   * Folder commands only (MAR-584): what DASH found when it compared.
   *
   * A structured value rather than something squeezed into `data`, for
   * `recovery`'s reason and with the same shape of argument: the page renders a
   * card and a list of sentences, and flattening that into primitives would put
   * the job of composing them back together in the renderer. It is composed by
   * `lib/folder-changes.ts` — the one place the comparison is worded — so the
   * check surface and any later reader cannot describe the same folder
   * differently.
   *
   * Absent on `folder.adopt` and `folder.reveal`, which report only whether they
   * did the thing.
   */
  folder?: FolderChangeReport;
  /**
   * `folder.choose` only (MAR-598): what DASH did with the folder you picked.
   *
   * Its own field rather than something squeezed into `detail`, for `folder`'s
   * reason: the page renders a card and, on a refusal, the validator's own block
   * underneath it, and flattening that into one string would put the job of
   * splitting it apart back in the renderer.
   */
  added?: AddedAgentReport;
  /**
   * `model.list` only (MAR-583): the model ids this agent's key can reach.
   *
   * Its own field rather than something folded into `data`, which takes one
   * primitive per key and could not hold a list at all. Ids and nothing else —
   * no description, no context length, no price — the same projection
   * `modelsListOperation` keeps for the agent-facing list and for the same
   * reason: a provider's own prose reaching a surface is the channel ADR 0002
   * invariant 7 is about.
   *
   * **Not stored anywhere.** It travels from a provider's answer to the page that
   * asked, and when that page closes it is gone. A durable table of which models
   * a key can reach is the record `lib/db.ts` refuses in as many words.
   */
  models?: string[];
}

/**
 * Run a reviewed command.
 *
 * Takes a `CommandReview` rather than a raw request, so it is impossible to
 * execute something that was never reviewed — the type system enforces the
 * ordering that the audit depends on.
 *
 * `shell.ping` returns only its own request id: proof the round trip worked,
 * carrying nothing about the machine, the user or any connection.
 */
export function executeCommand(review: CommandReview): CommandResult {
  if (review.decision === "denied") {
    return { ok: false, request_id: review.audit.request_id, reason: review.reason };
  }

  if (
    isAgentCommandName(review.command) ||
    isRunnerCommandName(review.command) ||
    isConnectionCommandName(review.command) ||
    // MAR-593. Every one of them opens the vault, and three of them open a
    // window or contact a provider. Same reason as the line above it, on a
    // target that names no agent.
    isFleetCommandName(review.command) ||
    isHostCommandName(review.command) ||
    isShellUiCommandName(review.command) ||
    // MAR-628. One moves a native `WebContentsView` and one destroys a Chromium
    // session. Neither is reachable from a sandboxed preload, and succeeding
    // here would be the worse of the two failures this list guards against:
    // reporting that a person's Stop closed a browser that is still open.
    isBrowserCommandName(review.command) ||
    // MAR-507. In this list for the plainest reason of all: performing one
    // opens a file picker, which this module cannot do and must not appear to.
    isWorkspaceCommandName(review.command) ||
    // MAR-697, MAR-698. Performing one reaches `shell.openExternal` or
    // `shell.openPath`, and the second also reads the exports folder off disk —
    // neither available to a sandboxed preload. This is the entry where
    // succeeding without acting would be most misleading: a person who pressed
    // a link and was told it opened would go looking for a window that is not
    // there.
    isOpenCommandName(review.command) ||
    // MAR-576. Performing one writes the agent folder and the store, both of
    // which need `node:fs` — and this module stays importable from a sandboxed
    // preload. Succeeding here would report a manifest replaced that was not.
    isSampleCommandName(review.command) ||
    // MAR-586. Writes a row through `node:sqlite`, which is the same reason as
    // every entry above: succeeding here would report a look recorded that was
    // not, and the fleet card would go on saying an output is new.
    isGlanceCommandName(review.command) ||
    // MAR-589, MAR-640. Writes a row through `node:sqlite`, the same reason as
    // the entry immediately above: succeeding here would report a rename or a
    // star that never touched the store.
    isIdentityCommandName(review.command) ||
    // MAR-681. Writes a row through `node:sqlite`, the same reason as the entry
    // immediately above: succeeding here would report a standing answer
    // remembered or forgotten that never touched the store, and the next run
    // would show the popup this feature exists to suppress.
    isStandingAnswerCommandName(review.command) ||
    // MAR-742 item 8, ADR 0029. Writes a row through `node:sqlite`, and the
    // consequence of succeeding without it is the worst in this list: a person
    // would be shown a cadence their agent has, walk away, and come back to a
    // machine that never started anything — with a settings page still saying it
    // would. A schedule that quietly does not exist is the exact failure this
    // feature was built to end.
    isScheduleCommandName(review.command) ||
    // MAR-584. Two of the three read the folder off disk and the third opens a
    // window on it, none of which a sandboxed preload may do. `folder.check`
    // matters most here despite changing nothing: succeeding without looking
    // would tell a person their folder is unchanged on the strength of a
    // function that cannot see a folder.
    isFolderCommandName(review.command) ||
    // MAR-583. Two write rows through `node:sqlite` and the third opens the
    // operating system's vault and reaches a provider over the network. The
    // third is the one that matters most: succeeding here would hand a page an
    // empty list of models as though a provider had answered with none.
    isModelCommandName(review.command) ||
    // MAR-588. Two of these open a window or touch the vault, and the third
    // sends bytes to Discord — none of which a sandboxed preload may do.
    // `notify.test` matters most: succeeding here would report a message
    // delivered to a channel nothing contacted, which is precisely the
    // reassurance that command exists to make checkable.
    isNotifyCommandName(review.command) ||
    // MAR-479, ADR 0026. Two open a window or touch the vault, one writes a row
    // and `lab.sendNow` posts to a machine DASH does not own. That last one is
    // why this entry matters most in the whole list: succeeding here would tell
    // a person their telemetry had been delivered when nothing left the process,
    // and the receipt — the one artifact this feature exists to make checkable —
    // would be a record of an act that never happened.
    isLabCommandName(review.command) ||
    // MAR-545. Opens the vault, reaches a provider and bills an account.
    // Succeeding here would report a question asked that nothing asked, beside
    // a cost sentence about a charge nobody made.
    isAskCommandName(review.command) ||
    // MAR-659, ADR 0023. `chief.ask` opens the vault, reaches a provider and
    // bills an account, exactly as the entry above does. `chief.clear` is in
    // this list for the opposite reason and it is the sharper one: it deletes
    // every row of a conversation through `node:sqlite`, and succeeding here
    // would tell somebody their transcript was forgotten while every word of it
    // was still on their disk.
    isChiefCommandName(review.command) ||
    // MAR-743, ADR 0028. Opens the vault, and on success hands a bot token and a
    // model key to another process. Succeeding here would report a bridge
    // connected while nothing was listening — and the person would go to Discord
    // and talk to a channel that cannot hear them, which is the failure this
    // whole feature is measured against.
    isChiefDiscordCommandName(review.command)
  ) {
    // Not a denial and not a result: a caller that reached here bypassed the
    // trusted side entirely. Throwing is the only honest answer — returning a
    // failure would let a miswired call site look like a refused command, and
    // returning success would be a lie about an effect nothing performed.
    //
    // `shell.menu` is in this list despite mutating nothing (MAR-440). What it
    // needs from the trusted side is not permission but *capability*: this
    // module is pure and importable from a sandboxed preload, so it cannot
    // reach a `Menu`. Silently succeeding here would report that a menu opened
    // when none did.
    throw new Error(
      `${review.command} needs the trusted side and must go through dispatchCommand, not executeCommand.`,
    );
  }

  switch (review.command) {
    case "shell.ping":
      return { ok: true, request_id: review.audit.request_id, data: { pong: true } };
    default: {
      // Exhaustiveness: adding a command to COMMANDS without handling it here
      // is a compile error, not a runtime surprise.
      const unreachable: never = review.command;
      throw new Error(`Unhandled command: ${String(unreachable)}`);
    }
  }
}

/**
 * What the dispatcher needs from the trusted side.
 *
 * An injected function rather than a direct import, so this module stays pure
 * and free of I/O — `lib/agent-dom/runner.ts` opens the database and reaches an
 * adapter, and dragging that in here would make the command allowlist
 * untestable without a store and unimportable from the preload. Electron main
 * supplies the real one; tests supply a fake.
 */
export interface RunnerLifecycleResult {
  ok: boolean;
  detail?: string;
  /**
   * `runner.status` and `runner.retireStore` (MAR-518) only, and primitives
   * only — the same constraint every other command result carries.
   *
   * Deliberately a summary rather than per-agent process facts. An agent's
   * status, pid and lifecycle belong in its Agent DOM state, which the poller
   * already writes to the store and the UI already renders; returning a second
   * copy down the IPC channel would be a parallel source of truth that drifts
   * the moment one of them is a poll interval behind the other.
   *
   * `runner.status` uses it for `store_damaged` and `damage_kind` as well as
   * the ordinary supervising count — a fact about the runner as a whole, which
   * is why `app/page.tsx` asks it rather than any per-agent surface.
   */
  data?: Record<string, string | number | boolean>;
}

/**
 * What a task-workspace command answers with (MAR-507).
 *
 * `refusal` is the runner's own code and `detail` is the runner's own sentence,
 * both passed through untouched. `lib/copy/inputs.ts` explains why DASH does not
 * reword them: the runner is what decided, its limits are what moved, and a
 * second vocabulary here is the thing that stays wrong when they change.
 *
 * `data` holds primitives only, like every other command result, and holds no
 * path. What a person needs to see about an admitted file is its own name and
 * its size — both facts about the copy the runner now owns, not about where it
 * came from.
 */
export interface WorkspaceActionResult {
  ok: boolean;
  /** The runner's refusal code, for a caller that wants to branch. Never rendered. */
  refusal?: string;
  /** The runner's own plain sentence. Rendered verbatim. */
  detail?: string;
  data?: Record<string, string | number | boolean>;
}

/**
 * The only data a host action may give back to the renderer.
 *
 * `host.create` deliberately spells its answer rather than returning a host
 * record or a generic data bag. A record could grow a path; a generic bag could
 * grow `private_key`. This closed union contains the public key and key *name*
 * only, which makes the custody rule a type-level restriction at the boundary.
 */
export type HostActionResult =
  | {
      ok: true;
      action: "create";
      host_id: string;
      label: string;
      public_key: string;
      key_name: string;
      /**
       * The same public half with the restriction that makes it safe, ready to
       * paste (MAR-573).
       *
       * Beside `public_key` rather than instead of it, because they answer
       * different questions: one is the key, and this is the *line* — the key
       * plus `restrict,command="…"`, which is what makes DASH's credential
       * structurally unable to run anything but the helper. A person installing
       * by hand should install this one.
       */
      authorized_keys_line: string;
      /** True when this call attached to a server DASH already had (MAR-572). */
      resumed: boolean;
    }
  /**
   * What the server said when DASH asked it (MAR-574, then MAR-606/ADR 0015).
   *
   * ## The count used to travel alone, and the argument for that was wrong
   *
   * MAR-574 sent a number and not a list, reasoning that DASH keeps no record
   * of what it deployed where, so *"a list travelling here would read as DASH's
   * inventory of somebody else's machine, and there is no such inventory to be
   * right or wrong about."*
   *
   * The premise is still true and the conclusion did not follow from it. The
   * count and the names come out of **the same sentence from the same server in
   * the same round trip** — `answer.bundles` in `electron/main.ts` has always
   * held both. Sending only the length did not make DASH more careful about
   * what it knows: it discarded half of one answer while keeping the other half
   * on identical evidence, and left a person unable to tell one agent on a
   * server from the same agent apparently sent twice. MAR-489's attended run is
   * that person.
   *
   * ## What each field may be used to say
   *
   * `agents_running` is a count from the server's own answer. `agents_there` is
   * that same answer's names, running or not.
   *
   * Neither is DASH's record and neither outlives this reply. Both are worded
   * on screen as a report with the moment it arrived attached — see ADR 0015
   * for the bound and `lib/host-sighting.ts` for the sentences. A surface may
   * say *"Hostinger reported News Scout running when DASH asked at 21:14."* It
   * may not say *"News Scout is running on Hostinger"*, and the reason has not
   * changed since ADR 0010: the second is a present-tense claim about somebody
   * else's machine, and DASH is never in a position to make one.
   */
  | {
      ok: true;
      action: "probe";
      host_id: string;
      label: string;
      runner_build: string | null;
      agents_running: number;
      /**
       * Every bundle the server named, running or not.
       *
       * Stopped ones are included because "installed and not running" is a
       * state a person needs to see and the count above cannot express — it is
       * the difference between an agent that was never sent and one that died,
       * and reducing both to an absence is how the second goes unnoticed.
       */
      agents_there: { agent_id: string; running: boolean }[];
    }
  | {
      ok: true;
      action: "trust";
      host_id: string;
      label: string;
      /** What was pinned, so a surface can show what it now trusts. */
      fingerprint: string;
    }
  | {
      ok: true;
      action: "setup";
      host_id: string;
      label: string;
      /** The whole snippet, as text to copy. Carries no private key and no path on this machine. */
      script: string;
    }
  | {
      ok: true;
      action: "deploy";
      host_id: string;
      label: string;
      agent_id: string;
      bundle_id: string;
      runner_build: string;
      detail: string;
    }
  /**
   * What DASH asked a server to do, and what it could see straight afterwards
   * (MAR-602).
   *
   * **There is no token here, and that is the point of spelling this member out
   * one field at a time rather than adding a data bag.** The `channel` verb is
   * the only thing on either plane that carries a credential, and this union is
   * the boundary it must never cross — the same reason `host.create` returns a
   * public key and a key *name* instead of a host record that could grow a path.
   *
   * `reached` is about DASH's own looking and not about the run. It says whether
   * the server answered when DASH looked immediately after pressing, which is
   * almost always *before the run has produced anything*. A surface must not
   * render it as "the run worked": the honest reading is "DASH got to look", and
   * a false one here would be exactly the invisible-consequence button ADR 0014's
   * third admission question refuses.
   */
  | {
      ok: true;
      action: "run";
      host_id: string;
      label: string;
      agent_id: string;
      detail: string;
      reached: boolean;
    }
  | {
      ok: true;
      action: "bringHome";
      host_id: string;
      label: string;
      agent_id: string;
      files_saved: number;
      detail: string;
    }
  | { ok: true; action: "forget"; host_id: string; label: string }
  | {
      ok: false;
      detail: string;
      problem?: HostReachProblem;
      /**
       * Set only with `problem: "host_key_not_trusted"` (MAR-572).
       *
       * A named, closed shape rather than a data bag, for the reason the
       * successful variants are spelled out one field at a time: a bag on the
       * failure path is where a diagnostic string naming this machine's key
       * location would eventually be added by somebody being helpful. Three
       * fields, all facts about a *remote* key, none of them from this machine.
       */
      host_key?: { fingerprint: string; key_type: string; offered_count: number };
    };

/**
 * What main hands back from one folder command (MAR-584).
 *
 * Three commands, one shape, and `report` present on exactly one of them. A
 * discriminated union was the alternative and was declined: `check` and `adopt`
 * fail in the same ways for the same reasons — no such agent, folder unreadable,
 * import refused — and splitting them would mean two copies of those refusals
 * for one extra field.
 */
export interface FolderActionResult {
  ok: boolean;
  /** A short code, for the same channel a connection or sample refusal uses. */
  refusal?: string;
  /** Plain language, safe to render. */
  detail?: string;
  /** `folder.check` only. Composed by `lib/folder-changes.ts` and nowhere else. */
  report?: FolderChangeReport;
  /** `folder.choose` only. Composed by `lib/copy/add-agent.ts` and nowhere else. */
  added?: AddedAgentReport;
}

/**
 * What DASH did with a folder somebody chose (MAR-598).
 *
 * A card and, when a folder was refused, the validator's own account underneath
 * it — the same two-part shape `FolderChangeReport` carries, and for the same
 * reason: `explainImportFailure` is DASH's explanation and the schema's errors
 * are the evidence for it, and MAR-423 requires the first to be shown *with*
 * rather than *instead of* the second.
 *
 * The card's `meaning` is the one place in this whole boundary where a path
 * travels, and it travels **outward only**. The renderer cannot name a folder
 * on the way in — `folder.choose` has no payload at all — and what comes back
 * is where DASH put its own copy, which is the fact the issue is explicit about
 * saying out loud. `removeAgent` already names the same directory in its own
 * receipt.
 */
export interface AddedAgentReport {
  /**
   * Whether an agent was actually added.
   *
   * Carried on the report as well as on the result, rather than inferred from
   * the absence of a `failure`. Two of the refusals have no validator block at
   * all — a folder that is already DASH's own, and a question somebody answered
   * no to — so "no errors" is not the same fact as "it worked", and a surface
   * that derived one from the other would draw a decline as a success.
   */
  ok: boolean;
  card: AddAgentCard;
  failure: ImportFailureExplanation | null;
}

/**
 * What one notification command answers with (MAR-588).
 *
 * One shape for all four, the same call `FolderActionResult` makes: they fail in
 * the same ways for the same reasons — no vault, nothing configured, Discord
 * refused — and a discriminated union would mean four copies of those refusals
 * for the sake of one optional field.
 *
 * `masked_hint` is the only value that comes back and it is a mask by
 * construction: `recordNotificationWebhook` refuses to store anything that is
 * not one, so a hint that reached this type is a hint that passed `isMaskedHint`
 * on the way to the database.
 */
export interface NotifyActionResult {
  ok: boolean;
  /** A short code, for the same channel a connection or folder refusal uses. */
  refusal?: string;
  /** Plain language, safe to render. Never contains the address. */
  detail?: string;
  /** `••••` plus four characters, after a connect. Absent otherwise. */
  masked_hint?: string;
}

/**
 * What comes back from a chief-Discord command (MAR-743, ADR 0028).
 *
 * `NotifyActionResult`'s shape and its guarantee — nothing a credential could be
 * assigned to crosses back — with one difference: the whole settings record
 * comes back rather than only a masked hint.
 *
 * That is deliberate and is the point of decision 4's schema note. The two ids
 * are configuration a person must be able to check, because the commonest way
 * this feature fails is a right-click that copied the wrong id, and a page that
 * could not show what DASH holds would leave them with no way to tell. Neither
 * id is a credential, and the token's only representation here is the same four
 * masked characters every other credential in DASH exposes.
 */
export interface ChiefDiscordActionResult {
  ok: boolean;
  refusal?: string;
  /** Plain language, safe to render. Never contains the token. */
  detail?: string;
  /** What DASH holds now, for the page to draw without a second read. */
  settings?: {
    configured: boolean;
    enabled: boolean;
    channel_id: string;
    allowed_user_id: string;
    masked_hint: string | null;
    configured_at: string | null;
  };
}

/**
 * What comes back from a LAB-telemetry command (MAR-479, ADR 0026).
 *
 * `NotifyActionResult`'s shape and its guarantee: nothing a token could be
 * assigned to crosses back. `sent` is a count and not a payload — the payload a
 * person reads is the receipt, which arrives through `view.labTelemetry` where
 * it is a stored record rather than a command's return value.
 */
export interface LabActionResult {
  ok: boolean;
  refusal?: string;
  /** Plain language, safe to render. Never contains the token. */
  detail?: string;
  /** `••••` plus four characters, after a connect. Absent otherwise. */
  masked_hint?: string;
  /** How many entries that LAB accepted, after a send. Absent otherwise. */
  sent?: number;
}

export interface DispatchContext {
  runAgentCommand(input: AgentCommandInput): Promise<AgentCommandResult>;
  /**
   * Ask the bundled runner to start or stop a process, or report what it holds.
   *
   * Injected for the same reason `runAgentCommand` is: this module must stay
   * importable from a sandboxed preload, and the runner client reaches the
   * network. Supplying it here also means a build with no runner — the vault
   * was unavailable, say — passes one that refuses honestly, rather than this
   * module having to know that could happen.
   */
  runnerLifecycle(action: string, agentId: string | undefined): Promise<RunnerLifecycleResult>;
  /**
   * Connect, test or forget a credential for one declared connection (MAR-383).
   *
   * Injected like the two above, and for a sharper version of the same reason:
   * the real implementation opens a window and touches the OS vault, and this
   * module must stay importable from a sandboxed preload. It also means the
   * command allowlist can be tested against a fake that never holds a secret.
   *
   * Note the return type. Nothing a credential could be assigned to crosses
   * back — a state, a masked hint and a sentence, all of which are already safe
   * to render and to log.
   */
  connectionAction(
    action: ConnectionAction | FleetAction,
    target: { agent_id: string; connection_id: string; field_id: string },
  ): Promise<ConnectionActionResult>;
  /**
   * Create, probe or forget a saved host. Main owns the key and the filesystem;
   * this pure dispatcher only passes the narrowed target and projects the
   * deliberately closed result above.
   */
  hostAction(
    action: HostAction,
    target:
      | { label: string; address: string; username: string; port: number }
      | { host_id: string }
      | { host_id: string; fingerprint: string }
      | { host_id: string; agent_id: string },
  ): Promise<HostActionResult>;
  /**
   * Show the application menu at a point in the window (MAR-440).
   *
   * Injected like the three above, and for the plainest version of the reason:
   * `Menu` is an Electron main API and this module must stay importable from a
   * sandboxed preload.
   *
   * It returns nothing. A menu that opened and a menu the user then dismissed
   * are the same outcome, and there is no result the renderer could act on —
   * every consequence of the menu happens in main, where the handlers are.
   */
  showApplicationMenu(at: { x: number; y: number } | undefined): void;
  setUiScale(factor: number | undefined): number;
  /**
   * Colour the chrome Electron draws in Node (MAR-642).
   *
   * Injected like the four above, and for the same plain reason: `nativeTheme`
   * is an Electron main API and this module has to stay importable from a
   * sandboxed preload.
   *
   * It returns nothing, `showApplicationMenu`'s shape. What the renderer needs
   * to know about the theme it already knows — it is the thing that chose it,
   * and the palette it can see is CSS. This is the half it cannot see.
   */
  setNativeTheme(theme: "system" | "light" | "dark"): void;
  /**
   * Put the controlled browser where the supervision panel says it is
   * (MAR-628).
   *
   * Injected like the three above, and for the plainest of their reasons: a
   * `WebContentsView` is an Electron main object and this module has to stay
   * importable from a sandboxed preload.
   *
   * It returns nothing, `showApplicationMenu`'s shape. There is no result the
   * renderer could act on — it already knows where its own panel is, and
   * whether a view exists to be moved is a question about a session it cannot
   * name.
   */
  setBrowserViewport(bounds: { x: number; y: number; width: number; height: number }): void;
  /**
   * Destroy one agent's browser session and refuse the rest of its run
   * (MAR-628).
   *
   * The only path to revocation, and the only one there is: `lib/browser/protocol.ts`
   * has no `stop` and no `close` operation, so an agent cannot revoke, cannot
   * un-revoke, and cannot discover that it has been revoked except by being
   * refused.
   */
  stopBrowser(agentId: string): Promise<void>;
  /**
   * The task-workspace actions: open a task, admit one user-selected file,
   * hand the task over (MAR-507), or save one of an agent's outputs where the
   * user asks (MAR-434).
   *
   * Injected like the others, and here the reason is the strongest of the
   * families: the real implementation opens `dialog.showOpenDialog` or a native
   * save dialog and reaches the runner over its socket — the APIs in DASH that
   * turn a click into a path on the user's own disk — none of which a sandboxed
   * preload may hold. Keeping them behind one injected function lets this
   * module describe the commands without being able to perform them.
   *
   * The result carries no path either way, and cannot: `data` is the same
   * primitive record every other command result uses, and what it holds is a
   * task id, a display name and a size. Which optional target fields a command
   * requires is `reviewCommand`'s job; by the time this runs, the payload rules
   * have already refused anything path-shaped.
   */
  workspaceAction(
    action: WorkspaceAction,
    target: {
      agent_id: string;
      task_id?: string;
      role_id?: string;
      run_id?: string;
      artifact_id?: string;
    },
  ): Promise<WorkspaceActionResult>;
  /**
   * Start something outside DASH's window (MAR-697, MAR-698).
   *
   * Injected for the reason `workspaceAction` above is, and it is the sharpest
   * case on this interface: performing one calls `shell.openExternal` or
   * `shell.openPath`, and a sandboxed preload holds neither. A module that
   * could answer this itself would be a module that could open anything from a
   * page's say-so.
   *
   * **The two gates are the implementation's and are deliberately not stated
   * here.** `electron/open-out.ts` owns both — the `https` check on an address
   * and the containment check on a file name — because a rule written at this
   * seam is a rule a second implementation could forget, while a rule written
   * beside the `shell` call is unavoidable by anything that actually opens
   * something. `sampleAction` below makes the same argument about its ownership
   * check.
   *
   * `target` is loose because the two commands take different fields and
   * `reviewCommand` has already enforced which. Nothing here may carry a path:
   * `file` is a single name, and what it is allowed to name is decided in main
   * against a folder main computed.
   */
  openAction(
    action: OpenAction,
    target: { url?: string; agent_id?: string; file?: string },
  ): Promise<{ ok: boolean; refusal?: string; detail?: string }>;
  /**
   * Re-import an agent DASH scaffolded, from DASH's current template (MAR-576).
   *
   * Injected for the reason the four above are, in its strongest form: the real
   * implementation writes the agent's folder and the store through
   * `importManifest`, which reaches `node:fs` and `node:sqlite`. This module has
   * to stay importable from a sandboxed preload, so it can name the command and
   * must be unable to perform it.
   *
   * **The ownership check belongs to the implementation, not to this seam**, and
   * that is deliberate. A gate stated here would be a gate a second
   * implementation could forget; stated in main, beside the write, it is
   * unavoidable by anything that actually rewrites a document. The refusal comes
   * back through `refusal`, which is the same channel a connection action's
   * does, so a surface renders it with the machinery it already has.
   */
  sampleAction(
    action: SampleAction,
    target: { agent_id: string },
  ): Promise<{ ok: boolean; refusal?: string; detail?: string }>;
  /**
   * Write down that this agent's page has been opened (MAR-586).
   *
   * Injected for the plainest form of the reason the five above are: the real
   * implementation reaches `node:sqlite`, and this module has to stay importable
   * from a sandboxed preload.
   *
   * It returns whether the row was written and nothing else. There is no
   * document to hand back and deliberately no timestamp: the moment DASH
   * recorded is DASH's own clock, and returning it would invite a renderer to
   * start reasoning about a value it has no business holding.
   */
  glanceAction(action: GlanceAction, target: { agent_id: string }): Promise<{ ok: boolean }>;
  /**
   * The reader's own record of one agent: its DASH-given name, and whether
   * it is starred (MAR-589, MAR-640).
   *
   * Injected for `glanceAction`'s own reason immediately above: the real
   * implementation reaches `node:sqlite`, and this module has to stay
   * importable from a sandboxed preload. An absent `display_name` clears the
   * rename; see `IDENTITY_ACTIONS`'s own note for why that is the field's
   * only way to mean "put this back". `favourite` is read only when `action`
   * is `"favourite"`, and `avatar` only when it is `"avatar"`;
   * `reviewCommand`'s payload rules keep the three members' fields from
   * crossing.
   */
  agentAction(
    action: IdentityAction,
    target: { agent_id: string; display_name?: string; favourite?: boolean; avatar?: string },
  ): Promise<{ ok: boolean; refusal?: string }>;
  /**
   * Remember — or forget — this agent's answer to one runtime question
   * (MAR-681).
   *
   * Injected for `agentAction`'s own reason immediately above: the real
   * implementation reaches `node:sqlite`, and this module has to stay
   * importable from a sandboxed preload. `question_label`, `option_id` and
   * `option_label` are read only on `set`; `question_key` only on `clear` —
   * `reviewCommand`'s payload rules keep the two members' fields from
   * crossing, `agentAction`'s own note for `favourite` and `avatar`.
   */
  standingAnswerAction(
    action: StandingAnswerAction,
    target: {
      agent_id: string;
      question_key?: string;
      question_label?: string;
      option_id?: string;
      option_label?: string;
    },
  ): Promise<{ ok: boolean; refusal?: string }>;
  /**
   * Set — or clear — when DASH starts this agent on its own (MAR-742 item 8,
   * ADR 0029).
   *
   * Injected for `standingAnswerAction`'s own reason immediately above: the real
   * implementation reaches `node:sqlite`, and this module has to stay importable
   * from a sandboxed preload.
   *
   * **The row is the whole of the write, and the runner is not contacted here.**
   * That is deliberate rather than an omission: the schedule set is re-asserted
   * to the runner on every evidence poll (`electron/agent-adapters.ts`), so this
   * seam has nothing to push and no push to fail. The alternative — a
   * `pushToRunner` beside this one, `notifyAction`'s shape — is the design ADR
   * 0029 decision 2 refuses, because MAR-745 is what a push-on-change list looks
   * like when it is one event short.
   *
   * `at_local` is read only on `set`; `reviewCommand`'s payload rules keep it
   * from crossing on `clear`.
   */
  scheduleAction(
    action: ScheduleAction,
    target: { agent_id: string; at_local?: string },
  ): Promise<{ ok: boolean; refusal?: string }>;
  /**
   * Choose a model, set one step's level, or ask what models there are (MAR-583).
   *
   * Injected for the reason the six above are, and here in two forms at once: the
   * real implementation reaches `node:sqlite` for the choice rows and the
   * operating system's vault plus the network for the list. A sandboxed preload
   * may hold neither.
   *
   * `models` is the only field of the result that carries anything the renderer
   * did not already know, and it is a list of ids that lives for as long as the
   * answer does. Nothing persists it — see `listAiKeyModels` — so a page that
   * closes forgets the catalogue, which is the property `ai_key_checks` was
   * designed to keep and the one thing here that could quietly stop being true.
   */
  modelAction(
    action: ModelAction,
    target: {
      /**
       * Empty on `default` and `catalogue`, which are about no agent (MAR-642).
       *
       * Empty rather than optional, so that the three members that *do* need an
       * agent keep a `string` to hand and no branch of main has to decide what
       * `undefined` meant. An empty id resolves to no manifest, which is the
       * refusal those three already give.
       */
      agent_id: string;
      connection_id?: string;
      field_id?: string;
      model_id?: string;
      step?: number;
      level?: string;
      /** One of `AI_PROVIDER_IDS`, on the two members that name no agent. */
      provider_id?: string;
    },
  ): Promise<{ ok: boolean; detail?: string; recovery?: Recovery; models?: string[] }>;
  /**
   * Ask this agent's model a question about what the agent has saved (MAR-545).
   *
   * Injected for the reason the eight above are, and here three reasons apply at
   * once: it opens the OS vault, it puts bytes on the network, and it writes a
   * row through `node:sqlite`. A pure module importable from a sandboxed preload
   * can do none of them.
   *
   * **The answer does not come back through this seam**, and that is deliberate
   * rather than incidental. What returns is whether the question was asked and a
   * sentence about it; the answer itself lands in the store and reaches the page
   * on the next poll, with the rest of the agent's view. So there is exactly one
   * path by which an answer becomes something on screen, and it is the same path
   * a conversation reopened tomorrow takes -- rather than a second rendering of
   * an answer that exists only in one window's memory.
   */
  askAction(
    action: AskAction,
    target: { agent_id: string; connection_id: string; field_id: string; question: string },
  ): Promise<{ ok: boolean; detail?: string; recovery?: Recovery }>;
  /**
   * Ask the chief about the fleet, or clear what it said (MAR-659, ADR 0023).
   *
   * Injected for `askAction`'s three reasons at once — the vault, the network
   * and a `node:sqlite` write — and it returns the same shape for the same
   * reason: **the answer does not come back through this seam.** It lands in
   * `chief_messages` and reaches the page on the next poll with the rest of the
   * fleet view, so there is exactly one path by which a chief answer becomes
   * something on screen, and it is the same path a conversation reopened
   * tomorrow takes.
   *
   * `target` is one optional string and nothing else. There is no agent id to
   * pass, because `{ kind: "chief" }` has no field one could go in — see
   * `CHIEF_ACTIONS`.
   */
  chiefAction(
    action: ChiefAction,
    target: { question?: string },
  ): Promise<{ ok: boolean; detail?: string; recovery?: Recovery }>;
  /**
   * Compare, accept, open — or choose — an agent's folder (MAR-584, MAR-598).
   *
   * Injected for the reason the six above are: the real implementation reads the
   * folder with `node:fs`, writes through `importManifest`, and — for `reveal`
   * and `choose` — calls an Electron main API. None of that is reachable from a
   * sandboxed preload, which is what lets this module name the four commands
   * while being structurally unable to perform any of them.
   *
   * **`report` and `added` are the only structured values that come back, and
   * both are already safe to render.** `report` is `lib/folder-changes.ts`'s
   * pure result: worded cards, plain-language change lines and the validator's
   * own errors. No path, no digest and no file content crosses on that one — the
   * renderer learns *that two files of the program changed*, never which bytes
   * or where they live. `added` is `lib/copy/add-agent.ts`'s, and carries the one
   * deliberate exception: where DASH put its own copy. See `AddedAgentReport`.
   *
   * `agent_id` is optional for exactly one action, and the optionality is the
   * point rather than a loosening. `folder.choose` names no agent because there
   * is no agent yet — that is the command's whole situation — and a seam that
   * demanded one would have forced a caller to invent a value main would then
   * have to recognise and ignore. The other three still require it, enforced one
   * layer up by `reviewCommand` against `required_keys`.
   */
  folderAction(
    action: FolderAction,
    target: { agent_id?: string },
  ): Promise<FolderActionResult>;
  /**
   * Connect, forget, test or adjust the Discord channel (MAR-588).
   *
   * Injected for the reason the seven above are, and here two of them apply at
   * once: `connect` opens the credential window and touches the OS vault, and
   * `test` puts bytes on the network. A pure module importable from a sandboxed
   * preload can do neither, which is exactly why this seam exists.
   *
   * **Nothing an address could be assigned to crosses back.** The result carries
   * whether it worked, a sentence, and — for a surface that has just connected —
   * the masked hint, which `lib/secret-refs.ts` defines as four characters a
   * credential cannot be reconstructed from. There is no field for the address,
   * on the way in or the way out.
   */
  notifyAction(
    action: NotifyAction,
    target: { kind?: string; enabled?: boolean },
  ): Promise<NotifyActionResult>;
  /**
   * Connect, forget or switch the chief's Discord bridge (MAR-743, ADR 0028).
   *
   * `notifyAction`'s neighbour and its seam, carrying one thing more: a
   * successful connect hands the *runner* a bot token and a model key, so this
   * entry is the one line in this interface behind which a credential leaves
   * Electron main for another process. Everything that bounds that is in
   * `electron/chief-discord.ts` and `runner/chief-broker.ts`.
   *
   * **Nothing a credential could be assigned to crosses back**, the same
   * guarantee `notifyAction` gives. The result carries whether it worked, a
   * sentence, and the settings a person is entitled to read off their own page —
   * two ids they typed and a masked hint.
   */
  chiefDiscordAction(
    action: ChiefDiscordAction,
    target: { channel_id?: string; allowed_user_id?: string; enabled?: boolean },
  ): Promise<ChiefDiscordActionResult>;
  /**
   * Set up, switch, or run DASH's report to a LAB (MAR-479, ADR 0026).
   *
   * Injected exactly as `notifyAction` is, and with the same closed return
   * type: `electron/lab-telemetry.ts` opens the vault, raises the credential
   * window and reaches the network, and this module has to stay importable from
   * a sandboxed preload.
   *
   * `endpoint` crosses and the token does not. There is no field for the token,
   * on the way in or the way out.
   */
  labAction(
    action: LabAction,
    target: { enabled?: boolean; endpoint?: string },
  ): Promise<LabActionResult>;
  /**
   * Where the IPC-level audit record goes.
   *
   * Injected rather than written to `console` here for the same reason as
   * above — but also so that "the record is emitted on every path" is a thing a
   * test can observe, instead of a thing a reviewer has to trace by eye through
   * the one call site in `electron/main.ts`.
   */
  audit(record: CommandAuditRecord): void;
}

/**
 * The single entry point: review, then route.
 *
 * Both families of command pass through `reviewCommand` first, so the
 * allowlist, the payload rules and the IPC audit record apply to an Agent DOM
 * command exactly as they applied to `shell.ping`.
 *
 * An allowed agent command therefore produces *two* audit records: one at the
 * IPC boundary saying the request was well-formed and permitted to be built,
 * and one in `command_audit` saying what the runner decided about it. They can
 * legitimately disagree — the boundary allows a shape, the runner judges a
 * meaning — and keeping both is what lets an auditor tell "the renderer asked
 * for something it should not have" from "the renderer asked reasonably and the
 * agent's state said no".
 */
export async function dispatchCommand(
  request: unknown,
  context: DispatchContext,
): Promise<CommandResult> {
  const review = reviewCommand(request);
  // Before the branch, so there is no route out of this function — denied,
  // local or agent — that skips it.
  context.audit(review.audit);

  if (review.decision === "denied") {
    return { ok: false, request_id: review.audit.request_id, reason: review.reason };
  }

  if (isAgentCommandName(review.command)) {
    const result = await context.runAgentCommand(
      toAgentCommandInput(review, AGENT_COMMAND_VERBS[review.command]),
    );
    return {
      ok: result.ok,
      request_id: result.request_id,
      reason: result.reason,
      correlation_id: result.correlation_id,
      duplicate: result.duplicate,
      detail: result.detail,
    };
  }

  if (isConnectionCommandName(review.command)) {
    // Required keys guarantee all three are non-empty strings, so the target is
    // whole by the time it leaves this function. Main resolves it against the
    // validated manifest before touching the vault — naming a connection here
    // is not the same as being allowed to hold a credential for it.
    const result = await context.connectionAction(CONNECTION_ACTIONS[review.command], {
      agent_id: String(review.payload["agent_id"]),
      connection_id: String(review.payload["connection_id"]),
      field_id: String(review.payload["field_id"]),
    });
    return {
      ok: result.ok,
      request_id: review.audit.request_id,
      detail: result.detail,
      recovery: result.recovery,
      data: { state: result.state, masked_hint: result.masked_hint ?? "" },
    };
  }

  if (isFleetCommandName(review.command)) {
    /*
     * MAR-593, ADR 0013. The principal is supplied here, never accepted.
     *
     * `fleet.*` declares one payload key and it is a provider, so there is no
     * member a renderer could put an agent id in — the same shape the audit
     * catalogue argues for above, and the same argument `registerCommandChannel`
     * makes about the actor: the request that arrived over IPC is not consulted
     * for who it is on behalf of, and cannot be.
     *
     * `field_id` is empty on purpose. The catalogue owns which field a fleet
     * connector holds; `performFleetAction` resolves it and ignores whatever is
     * here, so a value in this slot could only ever be a lie about a decision
     * this side does not make.
     */
    const result = await context.connectionAction(FLEET_ACTIONS[review.command], {
      agent_id:
        review.command === "fleet.assign"
          ? String(review.payload["agent_id"])
          : FLEET_PRINCIPAL,
      connection_id: String(review.payload["provider"]),
      field_id:
        typeof review.payload["account_id"] === "string"
          ? review.payload["account_id"]
          : "",
    });
    return {
      ok: result.ok,
      request_id: review.audit.request_id,
      detail: result.detail,
      recovery: result.recovery,
      data: { state: result.state, masked_hint: result.masked_hint ?? "" },
    };
  }

  if (isHostCommandName(review.command)) {
    const action = HOST_ACTIONS[review.command];
    const result = await (async (): Promise<HostActionResult> => {
      switch (action) {
        case "create":
          return context.hostAction(action, {
            label: String(review.payload["label"]),
            address: String(review.payload["address"]),
            username: String(review.payload["username"]),
            port: Number(review.payload["port"]),
          });
        case "deploy":
        case "run":
        case "bringHome":
          return context.hostAction(action, {
            host_id: String(review.payload["host_id"]),
            agent_id: String(review.payload["agent_id"]),
          });
        case "trust":
          return context.hostAction(action, {
            host_id: String(review.payload["host_id"]),
            // The fingerprint the person was shown, carried back so main can
            // refuse if the server's answer has changed since. Required by
            // the payload rules, so it is a non-empty string by here.
            fingerprint: String(review.payload["fingerprint"]),
          });
        case "probe":
        case "setup":
        case "forget":
          return context.hostAction(action, { host_id: String(review.payload["host_id"]) });
        default: {
          const unreachable: never = action;
          throw new Error(`Unhandled host action: ${String(unreachable)}`);
        }
      }
    })();

    if (!result.ok) {
      return {
        ok: false,
        request_id: review.audit.request_id,
        detail: result.detail,
        data:
          result.problem === undefined
            ? undefined
            : {
                problem: result.problem,
                // Flattened to primitives here, like every other command's data.
                // Absent unless main set them, which it does only for the one
                // problem that has a fingerprint to show (MAR-572).
                ...(result.host_key === undefined
                  ? {}
                  : {
                      fingerprint: result.host_key.fingerprint,
                      key_type: result.host_key.key_type,
                      offered_count: result.host_key.offered_count,
                    }),
              },
      };
    }

    // `HOST_ACTIONS` is the catalogue; this successful-result union is its
    // projection. Keep the two in lockstep before the switch below turns a
    // new host action into another silent fall-through.
    const everyHostActionHasAResult: Exclude<HostAction, typeof result.action> extends never
      ? true
      : never = true;
    void everyHostActionHasAResult;

    switch (result.action) {
      case "create":
        // The explicit projection is the custody boundary: no record, private
        // key or path can be added to a `host.create` reply by accident.
        return {
          ok: true,
          request_id: review.audit.request_id,
          data: {
            host_id: result.host_id,
            label: result.label,
            public_key: result.public_key,
            key_name: result.key_name,
            authorized_keys_line: result.authorized_keys_line,
            resumed: result.resumed,
          },
        };
      case "trust":
        return {
          ok: true,
          request_id: review.audit.request_id,
          data: {
            host_id: result.host_id,
            label: result.label,
            fingerprint: result.fingerprint,
          },
        };
      case "setup":
        // The script and nothing else. It is composed by `lib/host-bootstrap.ts`
        // from DASH's own public key and the helper's bytes; no path on this
        // machine and no private key can appear in it, which is a property of
        // that module's allowlist rather than of this projection.
        return {
          ok: true,
          request_id: review.audit.request_id,
          data: {
            host_id: result.host_id,
            label: result.label,
            script: result.script,
          },
        };
      case "probe":
        return {
          ok: true,
          request_id: review.audit.request_id,
          data: {
            host_id: result.host_id,
            label: result.label,
            runner_build: result.runner_build ?? "",
            agents_running: result.agents_running,
            // MAR-606. Plain objects rather than the transport's own bundle
            // type: this crosses a channel, and what crosses it is two strings
            // and a boolean per entry with no room for a pid to arrive later
            // because somebody widened a type upstream.
            agents_there: result.agents_there.map((agent) => ({
              agent_id: agent.agent_id,
              running: agent.running,
            })),
          },
        };
      case "deploy":
        return {
          ok: true,
          request_id: review.audit.request_id,
          detail: result.detail,
          data: {
            host_id: result.host_id,
            label: result.label,
            agent_id: result.agent_id,
            bundle_id: result.bundle_id,
            runner_build: result.runner_build,
          },
        };
      /*
       * MAR-602's verb, given the arm it never had. A successful run used to
       * fall out of this switch — the block ended without returning, control
       * reached the `executeCommand` fallback, and its trusted-side guard threw
       * a raw error over a press that had *succeeded* on the host. The second
       * of two fall-throughs on the same press: the dispatch arm above dropped
       * the agent id, and this switch dropped the answer. `detail` is main's
       * own sentence — the evidence arrives when DASH next reaches the server —
       * and `reached` is the one fact the page tones its feedback by.
       */
      case "run":
        return {
          ok: true,
          request_id: review.audit.request_id,
          detail: result.detail,
          data: {
            host_id: result.host_id,
            label: result.label,
            agent_id: result.agent_id,
            reached: result.reached,
          },
        };
      case "bringHome":
        return {
          ok: true,
          request_id: review.audit.request_id,
          detail: result.detail,
          data: {
            host_id: result.host_id,
            label: result.label,
            agent_id: result.agent_id,
            files_saved: result.files_saved,
          },
        };
      case "forget":
        return {
          ok: true,
          request_id: review.audit.request_id,
          data: { host_id: result.host_id, label: result.label },
        };
      default: {
        const unreachable: never = result;
        throw new Error(`Unhandled host result: ${String(unreachable)}`);
      }
    }
  }

  if (isShellUiCommandName(review.command)) {
    if (review.command === "shell.theme") {
      /*
       * MAR-642. Narrowed to one of three literals here rather than passed
       * through, so that whatever a renderer sends, what reaches
       * `nativeTheme.themeSource` is a value this file wrote. Anything else —
       * including nothing — is `system`, which is the default and the state
       * every window starts in.
       */
      const asked = review.payload["theme"];
      context.setNativeTheme(asked === "light" || asked === "dark" ? asked : "system");
      return { ok: true, request_id: review.audit.request_id };
    }
    if (review.command === "shell.scale") {
      const factor = review.payload["factor"];
      return {
        ok: true,
        request_id: review.audit.request_id,
        data: { factor: context.setUiScale(typeof factor === "number" ? factor : undefined) },
      };
    }
    // Both coordinates or neither. A menu popped at a half-known point would
    // land somewhere nobody chose, and Electron's own default — the pointer's
    // position — is the better answer when we do not have both.
    const x = review.payload["x"];
    const y = review.payload["y"];
    const at =
      typeof x === "number" && typeof y === "number"
        ? { x: Math.round(x), y: Math.round(y) }
        : undefined;
    context.showApplicationMenu(at);
    return { ok: true, request_id: review.audit.request_id };
  }

  if (isBrowserCommandName(review.command)) {
    if (review.command === "browser.stop") {
      // The agent is named and nothing else is. The renderer cannot name a
      // session, and main resolves one from the agent it is already tracking —
      // so the widest thing a compromised renderer could ask for is "stop the
      // browser belonging to agent X", which is the same thing the button asks
      // for.
      await context.stopBrowser(String(review.payload["agent"]));
      return { ok: true, request_id: review.audit.request_id };
    }
    /*
     * Four numbers, each narrowed here rather than passed through.
     *
     * `reviewCommand` has already required all four to be present by the time
     * this runs; what it cannot say is that they are numbers, because the
     * payload rules are about which keys exist. A non-number becomes zero, and
     * zero is a safe value in both directions: a view with no width paints
     * nothing and reports no error, which is the correct outcome for a panel
     * that measured itself wrong.
     */
    const number = (key: string): number => {
      const value = review.payload[key];
      return typeof value === "number" && Number.isFinite(value) ? value : 0;
    };
    context.setBrowserViewport({
      x: number("x"),
      y: number("y"),
      width: number("width"),
      height: number("height"),
    });
    return { ok: true, request_id: review.audit.request_id };
  }

  if (isWorkspaceCommandName(review.command)) {
    /*
     * Note what does *not* leave this function: a path.
     *
     * `select_input` carries an agent, a task and a role, and main is what opens
     * the file picker, checks the role against the manifest and reads the
     * declared limits out of it (MAR-507). `download` carries an agent and an
     * artifact id, and main asks the user where to save through the operating
     * system's own dialog while the runner alone resolves the id to a location
     * on disk (MAR-434). In both directions the renderer names which kind of
     * thing it means and never which file — the same shape `connection.connect`
     * has, and for a sharper reason: a credential the renderer could name would
     * be one it already had, whereas a path the renderer could name is one
     * nobody chose. Which fields each command requires is `reviewCommand`'s
     * job, already done by here.
     */
    const optionalField = (key: string): string | undefined =>
      typeof review.payload[key] === "string" ? (review.payload[key] as string) : undefined;
    const result = await context.workspaceAction(WORKSPACE_ACTIONS[review.command], {
      agent_id: String(review.payload["agent_id"]),
      task_id: optionalField("task_id"),
      role_id: optionalField("role_id"),
      run_id: optionalField("run_id"),
      artifact_id: optionalField("artifact_id"),
    });
    return {
      ok: result.ok,
      request_id: review.audit.request_id,
      reason: result.refusal,
      detail: result.detail,
      data: result.data,
    };
  }

  if (isOpenCommandName(review.command)) {
    /*
     * MAR-697, MAR-698. Note what does not leave this function: a path.
     *
     * `open.link` carries an address and main decides whether it is one DASH
     * will open — `https` and nothing else. `open.export` carries an agent and
     * a single file *name*, and main computes the folder that name may resolve
     * in. So the widest thing a compromised renderer can ask for here is "open
     * a secure web address" or "open a file DASH itself saved for agent X",
     * which is what the two anchors on the screen ask for.
     *
     * The fields are read optionally and passed through. Which of them each
     * command requires is `reviewCommand`'s job, already done by here.
     */
    const optionalField = (key: string): string | undefined =>
      typeof review.payload[key] === "string" ? (review.payload[key] as string) : undefined;
    const result = await context.openAction(OPEN_ACTIONS[review.command], {
      url: optionalField("url"),
      agent_id: optionalField("agent_id"),
      file: optionalField("file"),
    });
    return {
      ok: result.ok,
      request_id: review.audit.request_id,
      reason: result.refusal,
      detail: result.detail,
    };
  }

  if (isSampleCommandName(review.command)) {
    /*
     * MAR-576. The renderer names an agent and nothing else.
     *
     * It cannot supply a manifest, a template, a version or a path — the
     * payload rules permit one key, and `reviewCommand` has already enforced
     * that by here. Main reads the stored document, checks DASH's own scaffold
     * wrote it, regenerates it and imports it. So the widest thing a
     * compromised renderer could ask for is "re-import agent X from DASH's own
     * template", which is the same thing the button asks for.
     */
    const result = await context.sampleAction(SAMPLE_ACTIONS[review.command], {
      agent_id: String(review.payload["agent_id"]),
    });
    return {
      ok: result.ok,
      request_id: review.audit.request_id,
      reason: result.refusal,
      detail: result.detail,
    };
  }

  if (isFolderCommandName(review.command)) {
    /*
     * MAR-584. One agent id, and there is nowhere for a second field to go.
     *
     * The payload rules permit exactly one key, so a compromised renderer's
     * widest reach here is "compare agent X's folder", "accept whatever is in
     * agent X's folder" or "open agent X's folder". It cannot name a path, a
     * document, a digest or a version — everything the comparison and the
     * acceptance run against is read by main from DASH's own record and DASH's
     * own folder.
     *
     * That bound is what makes `folder.adopt` safe to expose at all. It accepts
     * a document a person's editor wrote, which is a wider provenance than
     * `sample.refresh` allows — but the document has to already be in the folder
     * DASH keeps for that agent, having got there through the user's own file
     * system, and it still goes through `importManifest` and is still refused if
     * it does not validate.
     */
    /*
     * MAR-598 adds the one member of this family that names nothing, and it is
     * read here rather than coerced. `String(undefined)` would have handed main
     * the literal word "undefined" as an agent id — a value that is not a
     * refusal, not an agent, and would have to be recognised somewhere further
     * in. The payload rules have already decided which commands require the
     * field; this reads what they left.
     */
    const agentId = review.payload["agent_id"];
    const result = await context.folderAction(FOLDER_ACTIONS[review.command], {
      agent_id: typeof agentId === "string" ? agentId : undefined,
    });
    return {
      ok: result.ok,
      request_id: review.audit.request_id,
      reason: result.refusal,
      detail: result.detail,
      folder: result.report,
      added: result.added,
    };
  }

  if (isNotifyCommandName(review.command)) {
    /*
     * MAR-588. Three of these take no payload at all, and the fourth takes a
     * word and a boolean.
     *
     * So the widest thing a compromised renderer can do with this family is ask
     * for the credential window to open, ask DASH to forget a channel it already
     * holds, post one fixed test message to that same channel, or flip a switch.
     * It cannot name an address, cannot learn the one DASH holds, and cannot
     * cause a message about any agent to be sent — those are composed in the
     * runner from what an agent actually did.
     */
    const result = await context.notifyAction(NOTIFY_ACTIONS[review.command], {
      kind: review.payload["kind"] === undefined ? undefined : String(review.payload["kind"]),
      enabled: review.payload["enabled"] === undefined ? undefined : review.payload["enabled"] === true,
    });
    return {
      ok: result.ok,
      request_id: review.audit.request_id,
      reason: result.refusal,
      detail: result.detail,
      // The masked hint is the one value that comes back, and it rides `data`
      // for the reason that field exists: primitives only, already safe to
      // render, already safe to log.
      data: result.masked_hint === undefined ? undefined : { masked_hint: result.masked_hint },
    };
  }

  if (isChiefDiscordCommandName(review.command)) {
    /*
     * MAR-743, ADR 0028. Two ids and a boolean, and no credential anywhere.
     *
     * So the widest thing a compromised renderer can do with this family is ask
     * for the credential window to open, aim an already-held token at a channel
     * of its choosing, name a different allowed speaker, or switch the bridge
     * off. It cannot learn the token DASH holds, cannot ask the chief anything,
     * and cannot cause a message to be sent — the chief only ever answers, and
     * only ever what the one allowed Discord identity said to it.
     */
    const result = await context.chiefDiscordAction(CHIEF_DISCORD_ACTIONS[review.command], {
      channel_id:
        review.payload["channel_id"] === undefined
          ? undefined
          : String(review.payload["channel_id"]),
      allowed_user_id:
        review.payload["allowed_user_id"] === undefined
          ? undefined
          : String(review.payload["allowed_user_id"]),
      enabled:
        review.payload["enabled"] === undefined ? undefined : review.payload["enabled"] === true,
    });
    return {
      ok: result.ok,
      request_id: review.audit.request_id,
      reason: result.refusal,
      detail: result.detail,
      /*
       * The settings ride `data` and are flattened to primitives, which is that
       * field's own rule: already safe to render, already safe to log. A nested
       * object would be the first thing in this file to break it, and the flat
       * form is what the page reads anyway.
       */
      data:
        result.settings === undefined
          ? undefined
          : {
              configured: result.settings.configured,
              enabled: result.settings.enabled,
              channel_id: result.settings.channel_id,
              allowed_user_id: result.settings.allowed_user_id,
              masked_hint: result.settings.masked_hint ?? "",
              configured_at: result.settings.configured_at ?? "",
            },
    };
  }

  if (isLabCommandName(review.command)) {
    /*
     * MAR-479, ADR 0026. Two of these take no payload, one takes a boolean and
     * one takes an address.
     *
     * So the widest thing a compromised renderer can do with this family is ask
     * for the credential window to open, point DASH at an address of its
     * choosing, flip the switch, or make DASH send the batch it was going to
     * send anyway. It cannot learn the token, cannot compose what is sent —
     * `lib/lab/observation.ts` builds that from stored manifests and nothing
     * else — and cannot cause anything about an agent's goal to be sent, because
     * no such field exists in the payload.
     *
     * Pointing DASH at an attacker's address is the real capability here and it
     * is bounded twice: `lab.connect` still opens the credential window, so a
     * person has to type a token before anything can be posted anywhere, and
     * the address a renderer named is on the settings page afterwards.
     */
    const result = await context.labAction(LAB_ACTIONS[review.command], {
      enabled: review.payload["enabled"] === undefined ? undefined : review.payload["enabled"] === true,
      endpoint:
        review.payload["endpoint"] === undefined ? undefined : String(review.payload["endpoint"]),
    });
    return {
      ok: result.ok,
      request_id: review.audit.request_id,
      reason: result.refusal,
      detail: result.detail,
      // Two primitives, the same discipline as the notify branch above: a
      // masked hint and a count, both already safe to render and to log.
      data:
        result.masked_hint === undefined && result.sent === undefined
          ? undefined
          : {
              ...(result.masked_hint === undefined ? {} : { masked_hint: result.masked_hint }),
              ...(result.sent === undefined ? {} : { sent: result.sent }),
            },
    };
  }

  if (isGlanceCommandName(review.command)) {
    /*
     * MAR-586. One agent id, and there is nowhere for a second field to go: the
     * payload rules permit exactly one key and the moment recorded is DASH's own
     * clock in main, never a value the renderer chose. A page that could stamp
     * this would be a page that could mark an agent as read in the future and
     * silence its card for good.
     */
    const result = await context.glanceAction(GLANCE_ACTIONS[review.command], {
      agent_id: String(review.payload["agent_id"]),
    });
    return { ok: result.ok, request_id: review.audit.request_id };
  }

  if (isIdentityCommandName(review.command)) {
    /*
     * MAR-589, MAR-640, MAR-615. `display_name` is absent from
     * `review.payload` whenever the renderer's `dropUnset` dropped it — the
     * field's whole vocabulary for "put this back to the manifest's own
     * name" — so it is read optionally rather than defaulted to an empty
     * string, which `reviewCommand` would already have refused as "present
     * but absent" if it had arrived that way. `favourite` and `avatar` are
     * likewise read optionally: the payload rules only require each on its
     * own member, so a rename carries neither and `performIdentityAction`
     * reads only the field its own `action` names.
     */
    const result = await context.agentAction(IDENTITY_ACTIONS[review.command], {
      agent_id: String(review.payload["agent_id"]),
      display_name:
        review.payload["display_name"] === undefined
          ? undefined
          : String(review.payload["display_name"]),
      favourite:
        review.payload["favourite"] === undefined ? undefined : review.payload["favourite"] === true,
      avatar:
        review.payload["avatar"] === undefined ? undefined : String(review.payload["avatar"]),
    });
    return { ok: result.ok, request_id: review.audit.request_id, reason: result.refusal };
  }

  if (isStandingAnswerCommandName(review.command)) {
    /*
     * MAR-681. `question_key` is absent from `review.payload` on `set` and
     * `question_label`/`option_id`/`option_label` are absent on `clear` — the
     * payload rules require each field only on the member that names it, the
     * same division `isIdentityCommandName` draws above.
     */
    const result = await context.standingAnswerAction(STANDING_ANSWER_ACTIONS[review.command], {
      agent_id: String(review.payload["agent_id"]),
      question_key:
        review.payload["question_key"] === undefined ? undefined : String(review.payload["question_key"]),
      question_label:
        review.payload["question_label"] === undefined
          ? undefined
          : String(review.payload["question_label"]),
      option_id:
        review.payload["option_id"] === undefined ? undefined : String(review.payload["option_id"]),
      option_label:
        review.payload["option_label"] === undefined ? undefined : String(review.payload["option_label"]),
    });
    return { ok: result.ok, request_id: review.audit.request_id, reason: result.refusal };
  }

  if (isScheduleCommandName(review.command)) {
    /*
     * MAR-742 item 8, ADR 0029. `at_local` is absent on `clear` — the payload
     * rules require it only on the member that names it, the same division the
     * two branches above draw.
     *
     * Copied explicitly rather than spread, `toAgentCommandInput`'s rule: a
     * spread would mean the day somebody adds a payload key it silently becomes
     * part of what main acts on, and the key somebody would want to add to this
     * particular family is one that says *what* to run.
     */
    const result = await context.scheduleAction(SCHEDULE_ACTIONS[review.command], {
      agent_id: String(review.payload["agent_id"]),
      at_local:
        review.payload["at_local"] === undefined ? undefined : String(review.payload["at_local"]),
    });
    return { ok: result.ok, request_id: review.audit.request_id, reason: result.refusal };
  }

  if (isModelCommandName(review.command)) {
    /*
     * MAR-583. Every field copied explicitly, `toAgentCommandInput`'s rule: a
     * spread would mean that the day somebody adds a payload key it silently
     * becomes part of what main acts on, without anyone deciding it should.
     *
     * The three optional string fields are optional in the type as well as in
     * the payload rules, and that is what carries the "put it back" cases. An
     * absent `model_id` on `model.choose` means matching each step again, and an
     * absent `level` on `model.step` means that step goes back to what its plan
     * asked for — so removing a setting needs no second command and cannot be
     * spelled as a magic value main would have to recognise.
     */
    const optional = (key: string): string | undefined =>
      typeof review.payload[key] === "string" && review.payload[key] !== ""
        ? (review.payload[key] as string)
        : undefined;
    const step = review.payload["step"];

    const result = await context.modelAction(MODEL_ACTIONS[review.command], {
      /*
       * MAR-642. Empty rather than the string "undefined" for the two members
       * that name no agent. `String(undefined)` was harmless while every member
       * carried an id — `required_keys` refused the command before it got here
       * — and it stops being harmless the moment a member is allowed to arrive
       * without one.
       */
      agent_id: optional("agent_id") ?? "",
      connection_id: optional("connection_id"),
      field_id: optional("field_id"),
      model_id: optional("model_id"),
      step: typeof step === "number" ? step : undefined,
      level: optional("level"),
      provider_id: optional("provider_id"),
    });
    return {
      ok: result.ok,
      request_id: review.audit.request_id,
      detail: result.detail,
      recovery: result.recovery,
      models: result.models,
    };
  }

  if (isAskCommandName(review.command)) {
    /*
     * MAR-545. Four fields, every one copied explicitly for
     * `toAgentCommandInput`'s reason, and all four required -- there is no
     * "put it back" case for a question, so nothing here is optional and main
     * never has to decide what a missing field meant.
     *
     * Note what is absent: no model id. The renderer cannot choose what this
     * question is answered by, because main reads that from the row a person set
     * through `model.choose`. A page that could name a model would be a page
     * that could pick the most expensive one somebody's key reaches.
     */
    const result = await context.askAction(ASK_ACTIONS[review.command], {
      agent_id: String(review.payload["agent_id"]),
      connection_id: String(review.payload["connection_id"]),
      field_id: String(review.payload["field_id"]),
      question: String(review.payload["question"]),
    });
    return {
      ok: result.ok,
      request_id: review.audit.request_id,
      detail: result.detail,
      recovery: result.recovery,
    };
  }

  if (isChiefCommandName(review.command)) {
    /*
     * MAR-659. One field, optional, and nothing else crosses.
     *
     * `chief.clear` carries no payload at all, so `question` is read
     * defensively rather than asserted — `String(undefined)` is `"undefined"`,
     * which is a question DASH would then really put to a model on somebody's
     * bill. `toAgentCommandInput`'s copy-explicitly rule, applied to the one
     * family where the field is genuinely absent for half the members.
     *
     * Note what is *not* here: no agent id, no connection id, no field id, no
     * model id. There is no value on this line a compromised page could use to
     * aim a fleet question at an agent, because the chief principal has no field
     * one could be assigned to.
     */
    const question = review.payload["question"];
    const result = await context.chiefAction(CHIEF_ACTIONS[review.command], {
      question: typeof question === "string" ? question : undefined,
    });
    return {
      ok: result.ok,
      request_id: review.audit.request_id,
      detail: result.detail,
      recovery: result.recovery,
    };
  }

  if (isRunnerCommandName(review.command)) {
    // No envelope, no nonce, no idempotency key, no correlation. A lifecycle
    // command is not an Agent DOM command and does not borrow its machinery —
    // see the note on `COMMANDS`. The IPC audit record above is its audit.
    const agentId = review.payload["agent_id"];
    const result = await context.runnerLifecycle(
      RUNNER_LIFECYCLE[review.command],
      typeof agentId === "string" ? agentId : undefined,
    );
    return {
      ok: result.ok,
      request_id: review.audit.request_id,
      detail: result.detail,
      data: result.data,
    };
  }

  return executeCommand(review);
}

/**
 * Turn a reviewed request into the runner's input.
 *
 * Every field is copied explicitly. A spread of the payload would be shorter
 * and would also mean that the day someone adds a payload key, it silently
 * becomes part of the envelope's target without anyone deciding that it should.
 */
function toAgentCommandInput(
  review: Extract<CommandReview, { decision: "allowed" }>,
  command: AgentCommand,
): AgentCommandInput {
  const payload = review.payload;
  const optional = (key: string): string | undefined =>
    typeof payload[key] === "string" ? (payload[key] as string) : undefined;
  // Guaranteed a non-empty string by `required_keys`; `String` is a no-op that
  // states the guarantee rather than asserting it away with `!`.
  const required = (key: string): string => String(payload[key] ?? "");

  const target = {
    agent_id: required("agent_id"),
    run_id: optional("run_id"),
    task_id: optional("task_id"),
    choice_id: optional("choice_id"),
    approval_id: optional("approval_id"),
    action_id: optional("action_id"),
  };

  return {
    request_id: review.audit.request_id,
    command,
    target,
    observed_at: required("observed_at"),
    option_id: optional("option_id"),
    reason: optional("reason"),
    payload_keys: review.audit.payload_keys,
    mutates: review.spec.mutates,
    irreversible: review.spec.irreversible,
  };
}

/**
 * Render an audit record as one log line.
 *
 * Kept here beside the record so the "keys, never values" rule is enforced at
 * the point of formatting too — the place where a well-meaning
 * `JSON.stringify(payload)` would otherwise creep in.
 */
export function formatAuditLine(record: CommandAuditRecord): string {
  const keys = record.payload_keys.length > 0 ? ` keys=[${record.payload_keys.join(",")}]` : "";
  const reason = record.reason ? ` reason=${record.reason}` : "";
  return `[dash-shell] ${record.decision} command=${record.command} id=${record.request_id}${keys}${reason} mutates=${record.mutates}`;
}
