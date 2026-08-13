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
    payload_keys: ["provider"],
    required_keys: ["provider"],
    mutates: true,
    irreversible: false,
  },
  "fleet.test": {
    effect:
      "Check that the sign-in or key DASH holds for one service still works, by asking that service.",
    payload_keys: ["provider"],
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
    payload_keys: ["provider"],
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
    payload_keys: ["provider"],
    required_keys: ["provider"],
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
} as const;

export type WorkspaceCommandName = keyof typeof WORKSPACE_ACTIONS;
export type WorkspaceAction = (typeof WORKSPACE_ACTIONS)[WorkspaceCommandName];

export function isWorkspaceCommandName(value: CommandName): value is WorkspaceCommandName {
  return Object.hasOwn(WORKSPACE_ACTIONS, value);
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
 * The one member of the rename family (MAR-589).
 *
 * One member is not a shape waiting to be filled — see `GLANCE_ACTIONS`'s own
 * note for the same standing above.
 */
export const RENAME_ACTIONS = {
  "identity.rename": "rename",
} as const;

export type RenameCommandName = keyof typeof RENAME_ACTIONS;
export type RenameAction = (typeof RENAME_ACTIONS)[RenameCommandName];

export function isRenameCommandName(value: CommandName): value is RenameCommandName {
  return Object.hasOwn(RENAME_ACTIONS, value);
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
 */
export const MODEL_ACTIONS = {
  "model.choose": "choose",
  "model.step": "step",
  "model.list": "list",
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
} as const;

export type ShellUiCommandName = keyof typeof SHELL_UI_ACTIONS;

export function isShellUiCommandName(value: CommandName): value is ShellUiCommandName {
  return Object.hasOwn(SHELL_UI_ACTIONS, value);
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
  | WorkspaceCommandName
  | SampleCommandName
  | GlanceCommandName
  | RenameCommandName
  | FolderCommandName
  | ModelCommandName
  | NotifyCommandName
  | AskCommandName
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
    // MAR-507. In this list for the plainest reason of all: performing one
    // opens a file picker, which this module cannot do and must not appear to.
    isWorkspaceCommandName(review.command) ||
    // MAR-576. Performing one writes the agent folder and the store, both of
    // which need `node:fs` — and this module stays importable from a sandboxed
    // preload. Succeeding here would report a manifest replaced that was not.
    isSampleCommandName(review.command) ||
    // MAR-586. Writes a row through `node:sqlite`, which is the same reason as
    // every entry above: succeeding here would report a look recorded that was
    // not, and the fleet card would go on saying an output is new.
    isGlanceCommandName(review.command) ||
    // MAR-589. Writes a row through `node:sqlite`, the same reason as the entry
    // immediately above: succeeding here would report a rename that never
    // touched the store.
    isRenameCommandName(review.command) ||
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
    // MAR-545. Opens the vault, reaches a provider and bills an account.
    // Succeeding here would report a question asked that nothing asked, beside
    // a cost sentence about a charge nobody made.
    isAskCommandName(review.command)
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
   * Set — or clear — the name DASH shows for one agent (MAR-589).
   *
   * Injected for `glanceAction`'s own reason immediately above: the real
   * implementation reaches `node:sqlite`, and this module has to stay
   * importable from a sandboxed preload. An absent `display_name` clears the
   * rename; see `RENAME_ACTIONS`'s own note for why that is the field's only
   * way to mean "put this back".
   */
  agentAction(
    action: RenameAction,
    target: { agent_id: string; display_name?: string },
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
      agent_id: string;
      connection_id?: string;
      field_id?: string;
      model_id?: string;
      step?: number;
      level?: string;
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
      agent_id: FLEET_PRINCIPAL,
      connection_id: String(review.payload["provider"]),
      field_id: "",
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

  if (isRenameCommandName(review.command)) {
    /*
     * MAR-589. `display_name` is absent from `review.payload` whenever the
     * renderer's `dropUnset` dropped it — the field's whole vocabulary for
     * "put this back to the manifest's own name" — so it is read optionally
     * rather than defaulted to an empty string, which `reviewCommand` would
     * already have refused as "present but absent" if it had arrived that way.
     */
    const result = await context.agentAction(RENAME_ACTIONS[review.command], {
      agent_id: String(review.payload["agent_id"]),
      display_name:
        review.payload["display_name"] === undefined
          ? undefined
          : String(review.payload["display_name"]),
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
      agent_id: String(review.payload["agent_id"]),
      connection_id: optional("connection_id"),
      field_id: optional("field_id"),
      model_id: optional("model_id"),
      step: typeof step === "number" ? step : undefined,
      level: optional("level"),
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
