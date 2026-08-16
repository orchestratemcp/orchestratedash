/**
 * What a page is given, and nothing else (MAR-432, DASH-20).
 *
 * Every page in DASH used to be a server component that called `lib/store.ts`
 * directly, which worked because the page and the database were in the same
 * process. The packaged app breaks that: the renderer is a static export and the
 * database is in Electron main. So the pages now render a *view* — a document
 * built on the trusted side and handed across a boundary.
 *
 * ## Why the shapes live here rather than being inferred
 *
 * Two callers must produce byte-identical answers: the IPC read handler in
 * `electron/main.ts` and the developer path's GET routes under `app/api/views/`.
 * A shape that is whatever `readStore()` happened to return is a shape those two
 * can drift apart on. Naming it once is what makes "the browser tab and the
 * installed app render the same thing" a checkable claim instead of a hope.
 *
 * ## Two rules every type in this file obeys
 *
 * 1. **Structured-clone safe.** These cross `contextBridge`, which clones rather
 *    than passing references. Plain objects, arrays, strings, numbers, booleans
 *    and `null`. No `Date`, no `Map`, no class instance, no function — each of
 *    which would either throw at the boundary or arrive as something else.
 * 2. **Narrowed on purpose, not by accident.** A view carries what a page
 *    renders. It is not a window onto the store, and the difference matters most
 *    where the underlying record holds more than the page shows — see
 *    `AgentOriginView`.
 */

import type { GroundingAnalysis, RunAnalysis } from "../analyze";
import type { EvidenceNotice } from "../copy/evidence";
import type { RunOriginNotice } from "../copy/where-it-ran";
import type { GlanceChip } from "../copy/glance";
import type { AiKeyFlow } from "../ai/connection-view";
import type { AgentFeedView, AgentTelemetryView } from "./agent-feed";
import type { ArtifactCardView } from "./artifacts";
import type { InputRoleView } from "./inputs";
import type { PanelView } from "./panel";
import type { ManifestGapView } from "../sample-refresh";
import type { AgentHealthView } from "./agent-health";
import type { Recovery } from "../copy/recovery";
import type { ConnectionRequirementRow } from "../connections";
import type { ConnectionTravel } from "../deploy/connection-travel";
import type { ManifestPermissions, PermissionGrant, RunArtifact, RunEvent } from "../contracts";
import type { AgentCompliance } from "../insights";
import type { OName } from "../brand/o-cast";
import type { RunSummary } from "../store";
import type {
  AvailableControl,
  InboxItem,
  WorkspaceOverview,
} from "../workspace";

/* ---------------------------------------------------------------------- *
 * Agents
 * ---------------------------------------------------------------------- */

/**
 * Where an agent came from, reduced to the three states the UI distinguishes.
 *
 * **This is the narrowing that matters most in this file.** The page used to be
 * handed a whole `ManagedRegistration`, which was harmless while the page and
 * the registration were in the same process. That record carries `command`,
 * `args` and an optional `env` block — extra environment for the agent's child
 * process, which is somebody else's configuration and can hold anything they put
 * in it. Sending it to a renderer would be sending the renderer a set of values
 * no screen displays and nobody reviewed for that purpose.
 *
 * So the projection is the three facts `AgentOrigin` actually renders, and the
 * rest never crosses. `source_project` is deliberately kept: it is a folder the
 * user chose, which `docs/design-brief.md` states is content rather than an
 * identifier, and the origin column is meaningless without it.
 */
export interface AgentOriginView {
  kind: "added_through_dash" | "set_up_by_hand" | "watched_only";
  /** The folder the agent's own code lives in. Absent unless DASH added it. */
  source_project?: string;
}

/**
 * Whether DASH holds enough of this agent to send it to a server (MAR-577).
 *
 * ## Why this is on the view rather than discovered by pressing the button
 *
 * It is a fact about DASH's own folder for the agent, not about any server, and
 * DASH can answer it without a network. Until this field existed the only way to
 * learn it was to choose a server, press deploy, and read the refusal that came
 * back — which on the server card arrives *after* the host-key gate, so somebody
 * with an unconfirmed server was told their server's identity was unconfirmed
 * and never told the agent could not have been sent either way.
 *
 * ## It is not the gate
 *
 * `produceAgentFolderBundle` in main refuses again and stays the authority, the
 * same arrangement the add-a-server form's duplicate check has: a page can be
 * wrong about what the store holds, and a renderer that was trusted would be one
 * a stale read could talk into a deploy. What this buys is that nobody is
 * offered a control that was never going to work.
 *
 * `refusal` is null exactly when `deployable` is true. It carries MAR-553's own
 * sentence — the string, not a code — because the module that owns it reads a
 * disk and must never be imported into a `"use client"` tree.
 */
export interface AgentDeployView {
  deployable: boolean;
  refusal: string | null;
  /**
   * Which of this agent's connections would not go with it (MAR-591).
   *
   * The assessment and **not** its sentences, which is the opposite call to
   * `refusal` one line up and is deliberate. That string comes from a module
   * that reads a disk, so it has to be worded before it crosses; this one comes
   * from `lib/deploy/connection-travel.ts`, which imports nothing that reaches a
   * disk and is therefore callable from both `"use client"` deploy panels. The
   * two panels name a different agent and a different server in every sentence,
   * so wording it here would mean wording it for one of them and letting the
   * other invent its own.
   *
   * `NOTHING_STRANDED` for an agent with nothing DASH holds, which is most of
   * them. Never null: an absent assessment and an assessment that found nothing
   * would render identically and only one of them is a claim.
   */
  travel: ConnectionTravel;
}

/**
 * One server DASH has sent this agent to, and whether what it sent is still
 * what this agent is (MAR-584, ADR 0010).
 *
 * **Read ADR 0010 before adding a field.** Every value here is something DASH
 * observed about its own act: it built a bundle, pushed it, the server took it,
 * and this was the date and these were the bytes. There is no field for whether
 * the agent is running there, whether the server is reachable, or what is on it
 * now — those are properties of somebody else's machine, DASH has not asked, and
 * a field would invite a surface to imply an answer.
 *
 * The two booleans carry the distinction that makes this honest, and the second
 * one earns its place. `behind` means something only when `comparable` is true;
 * an agent with no recorded baseline, or a push made before DASH kept one,
 * produces `comparable: false`, and the page says DASH cannot tell rather than
 * defaulting to reassurance or to alarm.
 */
export interface AgentDeployTarget {
  host_id: string;
  /** What the person calls this server. */
  label: string;
  /** DASH's own clock at the moment the push finished. */
  sent_at: string;
  /** The same moment as a person would say it, or null for an unreadable date. */
  sent_on: string | null;
  /** Whether DASH holds enough on both sides to compare at all. */
  comparable: boolean;
  /** True only when `comparable` and the two digests disagree. */
  behind: boolean;
}

/**
 * One agent, as an option on a server's deploy panel (MAR-577).
 *
 * A name alone was what the panel took, and it could not tell a deployable agent
 * from a migrated one — so the refusal had nowhere to render until after the
 * press.
 */
export interface AgentDeployChoice {
  name: string;
  /** The one name a person reads for this agent (MAR-589). See `AgentRow.title`. */
  title: string;
  deploy: AgentDeployView;
}

export interface AgentRow {
  name: string;
  /**
   * The one name a person reads for this agent (MAR-589).
   *
   * `agentDisplayName`'s answer — the stored rename when there is one, else the
   * manifest's own `display_name`, else the humanized id. This is the label;
   * `name` above is a value and belongs in `<code>`, never set as this row's
   * heading.
   */
  title: string;
  goal: string;
  /**
   * What this agent's author declared it does, as component ids (MAR-648).
   *
   * `planned_route[].component_id` in declared order — `public_feed_fetch`,
   * `digest_compose`. Values, never labels: nothing renders one as prose, and
   * `lib/copy/chief-chat.ts` states the rule that keeps it that way.
   *
   * On the row because the chief's composer routes on it, and routing must read
   * **what an author declared**, never what a run produced or what an agent is
   * called. `lib/chief/route.ts`'s header is the argument; this field plus
   * `goal` is the entire corpus it is allowed to see.
   *
   * `planned_steps` above is the same document counted, and the two travel
   * together rather than one being derived from the other on a page: a length
   * computed in a component would be a second answer to "how many steps" free to
   * disagree with the summary's.
   *
   * Empty for an agent whose manifest is too old to declare a route, which is
   * the same population `older_agent_names` names on the Connections view. An
   * empty corpus routes to nobody rather than to everybody — `routeRequest`
   * scores on matched words and an agent with none scores zero.
   */
  capabilities: string[];
  plan_source: string;
  build_target: string;
  planned_steps: number;
  automation_clearance: string;
  run_count: number;
  /**
   * When DASH last saw this agent run, or null when it never has (MAR-639).
   *
   * `started_at` off the newest row in the runs table — the same "what did DASH
   * see" reading `lib/views/glance.ts` already takes for the overdue chip's
   * `last_run_at`, not the agent's own account of itself. On the row so the
   * fleet card can put a date beside `run_count` without opening the runs view
   * a second time.
   */
  last_run_at: string | null;
  origin: AgentOriginView;
  compliance: AgentCompliance;
  /**
   * Which of the O's this agent wears (MAR-501).
   *
   * On the row rather than derived by the page, and that is the whole point of
   * it being here: `oFor` is a pure function of the name and a renderer could
   * call it, which is exactly why it must not. The character is a stored fact
   * about the agent — assigned once at creation, unchanged when its author
   * renames it — so it travels with the row like `origin` does, and a page that
   * computed it would be a page whose avatars quietly disagree with the
   * database the moment anything ever writes a different one.
   *
   * `OName` rather than `string`: the union is what stops a row reaching
   * `OAvatar` with a character no build ships, and `storedAvatar` in
   * `lib/store.ts` is where an unreadable column is already resolved.
   */
  avatar: OName;
  /**
   * Whether this agent could be put on a server, and why not (MAR-577).
   *
   * On the row because the Servers page's deploy panel is a list of these rows
   * and needs the answer per option. See `AgentDeployView`.
   */
  deploy: AgentDeployView;
  /**
   * The four questions this agent's card answers at a glance, already worded
   * (MAR-586).
   *
   * Sentences rather than the counts behind them, and that is this file's own
   * rule about projecting rather than passing through: two hosts build this
   * document, and a page composing its own copy from four numbers would be the
   * second place the claim could soften. `lib/copy/glance.ts` owns the wording
   * and `lib/views/glance.ts` owns which records answer.
   *
   * Never empty. A card with no chips cannot be told apart from a card DASH
   * failed to fill in, so "nothing needs you" is a chip — see `GLANCE_ALL_CLEAR`.
   */
  glance: GlanceChip[];
  /**
   * A run of this agent's is in flight right now.
   *
   * On the row so the fleet card can mark Working from the same document it
   * already holds, rather than opening the runs view. Derived from events
   * (`RunStatus === "running"`), never from a costume or a guess.
   */
  running: boolean;
  /**
   * The servers DASH has sent this agent to, newest first (MAR-606).
   *
   * ## This reverses a decision, and the reasoning it reverses is quoted below
   *
   * `deploy_targets` on the workspace view carries the same table, and its
   * comment says why it is deliberately *not* here:
   *
   * > It is on the workspace and not on `AgentRow` on purpose: the fleet card
   * > asks whether an agent needs you, and "a server has an older copy" is a
   * > fact about a decision you already made rather than something waiting for
   * > you.
   *
   * That is still correct **about `deploy_targets`**, and this is not it. The
   * digest comparison stays on the workspace, where a person can act on it.
   * What comes here is narrower: which servers, and when — because MAR-606
   * found that the fleet card was answering a question nobody asked and staying
   * silent on one everybody did.
   *
   * > *"AN agent that is hosted online should have like an icon or somthing on
   * > its fleet card."* — Henrik
   *
   * "Where does this agent run" is not a stale fact about a past decision. It is
   * the difference between an agent that stops when the laptop closes and one
   * that does not, it is the difference between a free agent and one costing
   * money every month, and the fleet card was the only page that could have said
   * so at a glance.
   *
   * ## What it may not be used to say
   *
   * Nothing about whether anything is running. Every field is DASH's own act
   * with a date on it, ADR 0010's bound exactly — the live half arrives from a
   * check, is held for the window only, and is joined in by the renderer. See
   * `lib/host-sightings.ts` and ADR 0015.
   *
   * Empty for almost every agent, and an empty list draws nothing at all.
   */
  hosted_on: AgentHostedOnView[];
  /**
   * Whether the reader has starred this agent (MAR-640).
   *
   * The first fact on this row that is about the reader rather than about the
   * agent — `agent_prefs` is a table of its own for exactly that reason, the
   * same one `last_looked_at` is not a column here. False for every agent
   * until somebody stars it, which is every agent today.
   */
  favourite: boolean;
}

/**
 * One server an agent was sent to, as a fleet card reads it (MAR-606).
 *
 * `host_id` travels because the renderer joins this against the session's
 * sighting log, which is keyed by it. It is not content and never reaches a
 * sentence — `lib/copy/identifiers.ts` is the rule, and `label` is the name a
 * person chose and the only one that gets rendered.
 */
export interface AgentHostedOnView {
  host_id: string;
  /** What the person calls this server. Their words, so it is content. */
  label: string;
  /** When DASH sent it, as a person would say it, or null for an unreadable date. */
  sent_on: string | null;
}

export interface AgentsView {
  agents: AgentRow[];
  /**
   * Rows the store holds and could not read back, worded as a recovery, or null
   * when there are none.
   *
   * On the agents view rather than on every view, because this is the page the
   * loss is *about*: a damaged manifest is a missing agent, and the agents list
   * is where a user would notice one had gone. Repeating the same notice on the
   * runs list and the Connection Center would report one fault four times and
   * still not be the page that could act on it.
   *
   * A `Recovery` rather than the raw names, so the boundary carries the sentence
   * the page renders instead of asking each host to compose one — the same
   * argument `AgentOriginView` makes about projecting rather than passing
   * through.
   */
  damage: Recovery | null;
}

/* ---------------------------------------------------------------------- *
 * Runs
 * ---------------------------------------------------------------------- */

export interface RunRow extends RunSummary {
  analysis: RunAnalysis | null;
  /** What this agent's model setting was when the run started (MAR-583). */
  model: RunModelView | null;
}

export interface RunsView {
  runs: RunRow[];
  /**
   * How complete this list is, when DASH has something qualified to say
   * (MAR-488).
   *
   * Null is the ordinary answer and means the record has nothing to disclose —
   * not that it is guaranteed complete. `lib/copy/evidence.ts` owns the
   * difference, and for a runner on another machine the notice is
   * unconditional, because the evidence a user's own server has already
   * discarded increments no counter.
   */
  evidence: EvidenceNotice | null;
  /**
   * Which machines the runs below happened on (MAR-602, ADR 0014).
   *
   * Beside `evidence` and deliberately not folded into it: the two answer
   * different questions about the same list. `evidence` says how complete the
   * list is; this says where its contents came from. A list can be complete and
   * of unknown origin, or of known origin and missing half of itself, and one
   * sentence covering both would be weaker than either.
   *
   * Null when DASH has never recorded collecting anything, which is not the
   * same as "they all ran here" — see `lib/copy/where-it-ran.ts`.
   */
  origin: RunOriginNotice | null;
}

/**
 * The two verdicts a run carries, side by side and never merged.
 *
 * `analysis` judges the run against its safety contract; `grounding` judges the
 * digest against the sources the run said it read. See `lib/analyze.ts` for why
 * a missing citation must never render in the same red as an unapproved
 * irreversible action.
 */
export interface RunArtifactsView {
  artifacts: RunArtifact[];
  grounding: GroundingAnalysis | null;
}

/** One planned step, joined to whether the run executed it. */
export interface PlannedStepView {
  step: number;
  component_id: string;
  risk_level: string;
  model_tier: string;
  executed: boolean;
  /**
   * The capability level this step's author declared for it (MAR-583), already
   * turned into words, or null when the step needs no model.
   *
   * The words rather than the stored value, for `AiKeyLivenessView`'s reason: a
   * sentence composed in a component is a sentence the copy sweep does not see.
   */
  model_level_label: string | null;
}

/* ---------------------------------------------------------------------- *
 * Models (MAR-583)
 * ---------------------------------------------------------------------- */

/** One of an agent's steps that needs a model, as a row in the disclosure. */
export interface ModelStepView {
  step: number;
  component_id: string;
  /** The level in force: the person's override, or the plan's own answer. */
  level: string;
  label: string;
  meaning: string;
  /** The plan's own answer, so the control can offer a way back to it. */
  declared: string;
  declared_label: string;
  overridden: boolean;
}

/**
 * Which model an agent uses, as the page draws it (MAR-583).
 *
 * **The list of models is deliberately not here.** A view is built on every
 * five-second poll of the workspace, and a field on it that named the models a
 * key can reach would mean either contacting a provider on that poll or keeping
 * a durable copy of somebody else's catalogue — and `lib/db.ts` refuses the
 * second in as many words. The list arrives through the `model.list` command,
 * when a person asks for it, and lives in the page's own state.
 */
export type AgentModelSettingsView =
  | {
      can_choose: false;
      reason: string;
      headline: string;
      detail: string;
      next_action: string | null;
      /** Drawn even here, so an agent's declared levels are readable. */
      steps: ModelStepView[];
    }
  | {
      can_choose: true;
      /** The registry id. Travels back on the command; never rendered. */
      provider_id: string;
      provider_label: string;
      connection_id: string;
      field_id: string;
      headline: string;
      detail: string;
      /**
       * The model named **for this agent**, or null when nobody named one.
       *
       * Deliberately still null for an agent running on DASH's default
       * (MAR-642). It is what the picker's value is bound to, and a default
       * shown as this agent's own choice would be a control claiming a decision
       * nobody made — and would then be un-choosable, because picking the value
       * already displayed fires no change event.
       */
      chosen_model_id: string | null;
      /** What DASH would use right now, in one sentence. */
      in_force: string;
      /**
       * True when `in_force` names DASH's default rather than this agent's own
       * choice (MAR-642).
       *
       * A flag rather than a sentence, because the page does not word it — every
       * sentence that varies with it is already composed in
       * `lib/ai/model-choice.ts`. What the page does with it is nothing but
       * decide whether to draw the chip that says so.
       */
      from_default: boolean;
      /**
       * The picker's first option, worded for whether a default exists
       * (MAR-642). "Match each step to what it needs", or "Use DASH's default".
       */
      unpinned_option: string;
      steps: ModelStepView[];
      /** False while one named model overrides every step's own level. */
      steps_in_force: boolean;
      /** Why the step controls are set aside. Null when they are in force. */
      steps_note: string | null;
    };

/**
 * What one run was set to use when it started (MAR-583).
 *
 * Null when DASH has no record — every run that finished before this was
 * recorded, and every agent whose plan needs no model. Null renders as nothing
 * rather than as today's setting, which would be a claim about the past made out
 * of the present.
 *
 * **There is no cost field and will not be one until MAR-299 has numbers that
 * came from a provider.** `label` names a model or says the setting matched each
 * step; `detail` carries the caveat that DASH watched its own setting rather
 * than a model.
 */
export interface RunModelView {
  label: string;
  detail: string;
}

/**
 * One run's detail, or the fact that there is no such run.
 *
 * `found: false` rather than `null`, because the two hosts report absence
 * differently and the page should not have to care: a server component called
 * `notFound()`, an HTTP route returns 404, and the IPC channel returns a
 * document. One shape means one branch in the page.
 */
export type RunView =
  | { found: false }
  | {
      found: true;
      agent: string;
      run_id: string;
      events: RunEvent[];
      analysis: RunAnalysis | null;
      planned_route: PlannedStepView[];
      /** What this agent's model setting was when the run started (MAR-583). */
      model: RunModelView | null;
      /**
       * Whether the agent's manifest has been imported. `analysis` being null
       * already implies it, but a page that has to infer "there is no plan" from
       * a null is a page that will eventually infer something else.
       */
      manifest_imported: boolean;
      /**
       * Component ids that ran but were not in the plan. Computed here, where
       * the manifest is, rather than in the page from two sets it would have to
       * be given anyway.
       */
      unplanned_component_ids: string[];
      /** What the run produced, newest first. Empty for a run that produced nothing. */
      artifacts: RunArtifact[];
      /**
       * The same outputs with their role, provenance receipt and availability
       * resolved (MAR-434) — what the Outputs panel draws.
       *
       * Alongside `artifacts` rather than replacing it: `electron/smoke.ts`
       * reads that field as proof 6k, and a blocking release gate is not
       * something to break for a tidier shape.
       */
      artifact_cards: ArtifactCardView[];
      /**
       * The newest artifact's grounding, or null when the run produced none.
       *
       * The newest is judged because it is the one on screen: a run that revised
       * its digest corrected it, and grading the superseded copy would report a
       * finding against text the user cannot see.
       */
      grounding: GroundingAnalysis | null;
    };

/* ---------------------------------------------------------------------- *
 * Connections
 * ---------------------------------------------------------------------- */

/**
 * A checklist row, plus what DASH holds for it (MAR-383).
 *
 * Kept as an extension of `ConnectionRequirementRow` rather than folded into it:
 * that type is a pure function of the manifest and is used where no store
 * exists, and giving it fields that only a database can fill would make it lie
 * in those places.
 */
export interface ConnectionRowWithCredential extends ConnectionRequirementRow {
  /** Whether DASH may take a credential for this row at all. */
  dash_can_hold: boolean;
  /** Which declared field a Connect acts on, or null when there is none. */
  field_id: string | null;
  /**
   * The masked hint stored when the credential was — four trailing characters
   * of a typed secret, or a masked account for a sign-in (MAR-446). Never a
   * value either way.
   */
  masked_hint: string | null;
  /**
   * Whether DASH will actually put this credential in the agent's environment.
   *
   * **False for every brokered connection, whatever the manifest asked for**
   * (MAR-458). It used to mean "the manifest names somewhere to deliver it",
   * which was the same thing until ADR 0002 and is now a different thing: a
   * manifest can still name an environment variable for its OAuth field and
   * DASH will not fill it. Reporting the manifest's wish here would tell a user
   * their sign-in is handed to the agent when it is not.
   */
  delivered_to_agent: boolean;
  /**
   * Whether Connect opens a text box or a provider sign-in (MAR-446), and for a
   * text box, whether what is typed stays with DASH (MAR-582).
   *
   * Null when DASH cannot hold this row at all. The page needs it because the
   * kinds produce different sentences for the same situation: an API key DASH
   * holds but cannot deliver has to be fetched by the agent some other way,
   * while a sign-in DASH holds but cannot deliver is one DASH will keep renewing
   * and the agent will reach through its own means.
   *
   * `provider_key` is the third, and it is typed like the first and behaves like
   * the second: a key the user pastes for a model provider DASH *is* a client
   * for. It is never delivered, it is reached through named operations, and it
   * is the one kind DASH can ask a provider a real question about. See
   * `lib/ai/providers.ts` for which services qualify and why the list is closed.
   */
  credential_kind: "secret" | "oauth" | "provider_key" | null;
  /** The permission card, for a connection DASH brokers. Null otherwise. */
  broker: BrokerRowView | null;
  /**
   * The other agents one sign-in here would also connect (MAR-570).
   *
   * ## Why this is on the row and not worked out by a page
   *
   * Because it is a statement about a **consequence of pressing a button**, and
   * it has to be true on every surface that draws the button. The connector tile
   * is one of them and the receipt card is the other, and a page that derived
   * this for itself would be a second derivation free to disagree with the
   * fan-out that actually happens in `lib/connection-actions.ts`.
   *
   * ## What makes two agents share
   *
   * The **provider**, not the connection id. `google-gmail` is one authorization
   * server, one client and one consent screen; two agents naming it are asking
   * for the same account, whatever they each called their connection. Author-
   * chosen ids are not comparable across two manifests and this must never key
   * on them.
   *
   * ## Empty is the ordinary case and means what it says
   *
   * No other agent needs this provider, so a sign-in here connects exactly what
   * the person is looking at. It does **not** mean sharing is off.
   *
   * Names, not ids, because the sentence built from this is read by somebody who
   * is deciding whether to sign in — and it is the one disclosure on this page
   * that describes something happening to an agent they are not looking at.
   */
  also_connects: string[];
}

/**
 * One capability on a permission card (MAR-458).
 *
 * `label` is what a person reads. `id` travels for the code and is never
 * rendered — `lib/copy/identifiers.ts` forbids an operation id appearing on a
 * guided surface.
 */
export interface BrokerCapabilityView {
  id: string;
  label: string;
  /**
   * `BrokerAccess`, restated rather than imported. `lib/views/types.ts` is what a
   * page imports and it stays free of anything that reaches a store; the two are
   * pinned equal by a compile-time assignment in `tests/broker-spend.test.ts`.
   */
  access: "read" | "write" | "spend";
  /**
   * What will exist in the user's account because this ran, or null for a read
   * (MAR-469).
   *
   * A write's label is a verb phrase — "Save a reply in your Gmail drafts" — and
   * a person approving one needs the sentence after it: where the thing ends up,
   * who can act on it, and what DASH still cannot do. Rendered under the
   * capability rather than in a tooltip, because a consequence a user has to
   * hover to discover is one they will approve without reading.
   */
  consequence: string | null;
}

/**
 * What the permission broker has to say about one connection row.
 *
 * Present only for a connection DASH brokers — a typed-secret row has none,
 * because DASH holds a value for it and performs nothing on the user's behalf.
 * That absence is the honest one: a card promising narrow operations for an API
 * key DASH hands straight to an agent would be describing a boundary that is not
 * there.
 *
 * **Nothing here opens the vault.** `requested` comes from the manifest,
 * `receipt` and `recent` from the store. `lib/connection-actions.ts` explains
 * why that matters: a vault read per row would pop an OS unlock prompt at the
 * moment a user merely looked at this page.
 */
export interface BrokerRowView {
  /** Who actually holds the credential, in a sentence. */
  custody_sentence: string;
  /** Whose consent screen this connection uses, or null when not OAuth. */
  client_sentence: string | null;
  /**
   * What the agent is asking to be able to do, from its own manifest.
   *
   * Shown before a sign-in as well as after, because a user deciding whether to
   * connect needs to know what is being asked for — which is a different
   * question from what has been granted.
   */
  requested: BrokerCapabilityView[];
  /**
   * The complement: every action **DASH offers for this provider** that this
   * agent's manifest did not ask for (MAR-533).
   *
   * `requested` is already an intersection of DASH's operation set with the
   * manifest's declared scopes, so from a card's point of view two of the three
   * parties in a grant are indistinguishable inside it. This is the list that
   * separates them, and it is the one that lets the page make a checkable
   * statement instead of a reassuring one: "send an email" sitting here, on a
   * Gmail connection, says DASH has never built that action and granting every
   * permission Google has would not create it.
   *
   * Empty for a manifest that asked for everything DASH offers, which is the
   * honest absence — there is then nothing DASH could do that this agent did
   * not ask for.
   */
  not_requested: BrokerCapabilityView[];
  /**
   * How the provider permission behind a granted write is wider than the write
   * itself, or null when nothing on this connection writes (MAR-469).
   *
   * Beside the capability list rather than inside it, because it is not a
   * capability — it is a fact about the user's account at the provider that DASH
   * cannot change and must not conceal. For Gmail it says that the permission
   * allowing a draft also allows sending, and that DASH builds nothing on that.
   *
   * Derived from the manifest's declared operations, so it appears on the card
   * *before* a sign-in as well as after. A disclosure that only shows up once a
   * user has already granted the permission has told them nothing.
   */
  wider_permission_sentence: string | null;
  /**
   * When this agent keeps running while DASH is closed: what this connection
   * is worth to it during that window, or null for an agent that stops with
   * DASH (MAR-482, ADR 0006's option-3 copy).
   *
   * On the card before a sign-in as well as after, for the same reason as
   * `wider_permission_sentence`: the person who has not yet granted anything
   * is the one deciding, and a disclosure that appears only once they have is
   * a lapse row wearing better clothes. Null is the honest absence — warning
   * that requests will go unanswered while DASH is closed, about an agent
   * that does not run then, would describe a window in which there is nobody
   * to be warned about.
   */
  dash_closed_sentence: string | null;
  /** ADR 0002 invariant 4, once there is a grant to receipt. */
  receipt: {
    account_hint: string | null;
    granted_at: string;
    last_used_at: string | null;
    capabilities: BrokerCapabilityView[];
  } | null;
  /** Recent brokered calls, newest first. Bounded. */
  recent: Array<{
    /** The operation's plain-language label, or a fallback for a retired one. */
    label: string;
    decision: "allowed" | "refused";
    /** The refusal's headline sentence, when it was refused. */
    refusal_headline: string | null;
    result_count: number | null;
    decided_at: string;
    /**
     * True when DASH could not confirm this answer reached the agent (MAR-467).
     *
     * Rendered as a note *on* the decision rather than as a separate entry,
     * because it is one: DASH really did decide this, and the decision is
     * exactly as auditable as every other row. What failed happened afterwards.
     */
    undelivered: boolean;
  }>;
}

/**
 * Something that kept an agent's request from being adjudicated (MAR-467).
 *
 * Carried beside the connection rows rather than inside a `BrokerRowView`, and
 * the reason is a fact about what DASH knows rather than a layout preference:
 * none of these can be attributed to a connection. The runner does not parse a
 * brokered request, so a dropped one names no connection; a window in which DASH
 * was closed names nothing at all. Rendering them under a particular connection
 * card would invent the one detail that was never observed.
 *
 * ADR 0005 records why this is a separate shape from `recent` rather than more
 * entries in it. `recent` is the audit trail, and the audit trail is worth
 * believing because every line of it is a decision DASH made.
 */
export interface BrokerLapseView {
  kind: "dropped_by_runner" | "dash_closed";
  /** The sentence a person reads. Complete on its own. */
  sentence: string;
  /** The caveat that keeps the sentence from overclaiming, when there is one. */
  qualifier: string | null;
  from_at: string;
  until_at: string | null;
}

export interface AgentConnections {
  name: string;
  /**
   * The agent's own character, read from the store (MAR-533, MAR-502's rule).
   *
   * Read rather than derived, and that is the load-bearing part: the character
   * is DASH's own record, written once at import and deliberately omitted from
   * the re-import path's update, so an author renaming their agent does not
   * re-costume something the user has already learned to recognise. Calling
   * `oFor(name)` here would undo that in one line, and would agree with the
   * stored value at creation — which is exactly why it would go unnoticed.
   *
   * Nullable, because `readAgentAvatar` is: an agent imported before migration 8
   * and never re-read has no character, and drawing a guessed one would be the
   * same defect the paragraph above is about. The card draws nothing.
   */
  avatar: OName | null;
  /** The one name a person reads for this agent (MAR-589). See `AgentRow.title`. */
  title: string;
  rows: ConnectionRowWithCredential[];
  /**
   * What the permission cards above cannot account for (MAR-467). Newest first,
   * bounded, and empty in the ordinary case where nothing went wrong.
   */
  lapses: BrokerLapseView[];
}

/**
 * One service DASH can hold an account or a key for, whether or not any agent
 * has ever asked for it (MAR-593, ADR 0013).
 *
 * The first thing on this view that does not come from a manifest. Everything
 * else here is derived from what an agent declared, which is why a DASH with no
 * agents had an empty Connections page — the exact thing Henrik hit on
 * 2026-08-10, when his test plan asked him to configure DASH before importing
 * anything.
 */
export interface FleetConnectorView {
  /** The manifest's provider string. The key, and never rendered. */
  provider: string;
  /** What a person reads: "Gmail". */
  service: string;
  /** `google_oauth_broker` or `api_key` — which of the two flows the button starts. */
  connector_kind: string;
  /**
   * The model provider this key belongs to, or null when it is not one
   * (MAR-642).
   *
   * What splits Settings' two tabs: the AI tab draws the connectors with an id
   * here and Connections draws the rest. Carried rather than inferred from
   * `connector_kind`, which would say `api_key` for the first non-model key DASH
   * learns to hold and land a mail service on a page about models. It is
   * `FleetConnector.ai_provider_id`, which `lib/fleet/catalogue.ts` sets from
   * `aiProviders()` and nothing else.
   */
  ai_provider_id: string | null;
  /** Why somebody would connect it, in their terms rather than DASH's. */
  purpose: string;
  /** Where to get the credential, when there is somewhere. Null for a sign-in. */
  help: string | null;
  /** What DASH can do once it is connected, from the operation table and nowhere else. */
  capabilities: BrokerCapabilityView[];
  /**
   * Permissions DASH must ask for that are wider than what it will do with them.
   *
   * Rendered **before** the connect as well as after — ADR 0002 amendment 2's
   * rule, and the reason this sits here rather than on `held` below, where it
   * would be invisible to the person who has not connected yet, who is the one
   * it is for.
   */
  wider_permissions: string[];
  /** What DASH holds right now. Null when nothing is connected. */
  held: {
    masked_hint: string | null;
    /** Which of the person's accounts, masked. Null for a key, which names nobody. */
    account_hint: string | null;
    /** "since 10 August 2026", or null when the stored date cannot be read. */
    since: string | null;
    /** What the consent actually issued, in DASH's own sentences. Empty for a key. */
    permissions: string[];
  } | null;
  /** Every connected account for this service, oldest first. */
  accounts?: Array<{
    id: string;
    masked_hint: string | null;
    account_hint: string | null;
    since: string | null;
    permissions: string[];
    is_default: boolean;
  }>;
  /**
   * Every agent this connection reaches, and whether it has it yet.
   *
   * `agent` is the id — a value, never a label (MAR-589's ruling). `title` is
   * `agentDisplayName`'s answer and the one this card is allowed to print.
   */
  agents: Array<{
    agent: string;
    title: string;
    connected: boolean;
    /** The explicit or default account currently materialized for this agent. */
    account_id?: string | null;
  }>;
  /**
   * Agents that name this service and are not reached, each with why.
   *
   * `reason` is a `FleetSkip`, carried as a code rather than a sentence so the
   * copy stays in `describeSkip` — a view that shipped prose would be prose no
   * plain-language sweep ever looks at. `title` follows MAR-589's ruling exactly
   * as it does on `agents` above.
   */
  skipped: Array<{ agent: string; title: string; reason: string }>;
  /**
   * Agents that qualify and do not have it yet — what `fleet.share` would give.
   *
   * Non-empty exactly when somebody imported an agent after connecting this, and
   * deliberately not emptied on its own: a consent given before a piece of
   * software existed is not a consent to that software. The card names them and
   * offers one button instead.
   */
  waiting: string[];
  /** The disclosure that has to be read before the button. Null when it reaches nobody. */
  reach_sentence: string | null;
}

/**
 * DASH's default model, as the AI tab reads it (MAR-642).
 *
 * The sentences are composed in `lib/ai/model-choice.ts` and arrive worded, for
 * `AgentRow.glance`'s reason: a page that built them from the two ids below
 * could describe the setting differently from the process that resolves it.
 *
 * `provider_id` and `model_id` are null together — there is no half-set default
 * — and null is the state every DASH ships in rather than an empty state to be
 * filled.
 */
export interface FleetModelDefaultView {
  /** The registry id. Travels back on the command; never rendered. */
  provider_id: string | null;
  /** The model id, which *is* rendered: it is what the person picked. */
  model_id: string | null;
  headline: string;
  detail: string;
  /** Where the setting stands. Never a claim about what a given agent will use. */
  in_force: string;
}

export interface ConnectionsView {
  /**
   * What DASH can connect, before and regardless of any agent (MAR-593).
   *
   * First on the type because it is first on the page: somebody arriving at
   * Settings with nothing imported has exactly this to do, and the agent
   * checklists below are what those connections then light up.
   *
   * **Both Settings tabs are drawn from this one list (MAR-642).** The AI tab
   * takes the entries with an `ai_provider_id` and Connections takes the rest,
   * rather than a second view being built for a second page: the split is a
   * question about what a person came to do, and a view per tab would be two
   * projections of one catalogue, free to disagree about what is connected.
   */
  fleet: FleetConnectorView[];
  /**
   * The model DASH gives an agent that has not been given one (MAR-642).
   *
   * On this view rather than one of its own because it is read by the tab that
   * reads `fleet` — the default and the key that reaches it are the same
   * screen, and a person setting one is looking at the other.
   */
  model_default: FleetModelDefaultView;
  agents: AgentConnections[];
  /**
   * Names of imported agents whose manifest is too old to declare connections.
   *
   * Carried separately rather than folded in as empty checklists, for the reason
   * `listConnectionCapableAgents` states: "declares no connections" and "is too
   * old to declare any" are different claims and the Connection Center must not
   * make the first when it means the second.
   */
  older_agent_names: string[];
}

/* ---------------------------------------------------------------------- *
 * Saved servers (MAR-574)
 * ---------------------------------------------------------------------- */

/**
 * One saved server, as the Servers page reads it.
 *
 * Narrowed on purpose, and here the narrowing is the security half of the
 * record rather than a rendering preference. `HostRecord` carries `key_name` —
 * which key on this computer DASH reaches this server with — and no page has
 * any use for it. It is the one field on that record that names a credential,
 * so it is the one field that must not travel to a renderer merely because it
 * happened to be in the row.
 *
 * `fingerprint` does travel: it is the *server's* public identity, the thing a
 * person checks against what their provider shows them, and it is null on every
 * real record today (MAR-572).
 */
export interface SavedServerView {
  host_id: string;
  label: string;
  address: string;
  username: string;
  port: number;
  added_at: string;
  fingerprint: string | null;
  /**
   * Where this record sits among the records naming the same address and
   * account, 1-based, oldest first. Always 1 when nothing is duplicated.
   */
  same_server_index: number;
  /** How many records name it, including this one. 1 when nothing is duplicated. */
  same_server_count: number;
  /**
   * Every agent DASH has sent to this server, newest first (MAR-606, ADR 0010).
   *
   * DASH's own record of its own act and nothing else — read `AgentDeployTarget`
   * before adding a field, because this is the same table seen from the server's
   * side and it is bounded the same way. There is no entry for whether anything
   * is running: that is the server's to say, it arrives on the standing with the
   * moment it was said, and `lib/host-sighting.ts` is where the two accounts are
   * put beside each other without being blended into one.
   *
   * Empty for a server nobody has deployed to, which is most of them.
   */
  sent: SentToServerView[];
}

/**
 * One agent DASH put on one server, as the server card reads it (MAR-606).
 *
 * Narrower than `AgentDeployTarget` on purpose. That type carries the digest
 * comparison an agent's own page needs in order to say *"what DASH sent is not
 * what this agent is now"*; a server card is not asking that question, so what
 * travels here is the name and the date and nothing that could be mistaken for
 * a claim about the machine.
 */
export interface SentToServerView {
  /** The agent's name, which is also the id its bundle carries on the server. */
  agent: string;
  /** DASH's own clock at the moment the push finished. */
  sent_at: string;
  /** The same moment as a person would say it, or null for an unreadable date. */
  sent_on: string | null;
}

/**
 * Every server DASH has saved.
 *
 * A list rather than an optional single record, and the four rows in Henrik's
 * store are why: DASH really can hold more than one record for one machine, it
 * really does today, and a view shaped as "the server, if any" would have had to
 * choose one of them silently.
 */
export interface HostsView {
  servers: SavedServerView[];
}

/* ---------------------------------------------------------------------- *
 * Discord notifications (MAR-588)
 * ---------------------------------------------------------------------- */

/**
 * What the notification settings surface renders.
 *
 * This file's second rule — narrowed on purpose, not by accident — at its
 * sharpest. The record behind this is one row and one vault entry, and the vault
 * entry is a credential anybody holding it could post to somebody's Discord
 * channel with. **There is no field here it could be assigned to**, so "the
 * address is never rendered back" is a property of the type rather than
 * something the page has to remember, and `notificationsView` could not leak it
 * if it tried.
 *
 * `state_sentence` travels rather than being composed by the page, for the
 * reason `AgentRow.glance` gives: two hosts build this document, and a page
 * assembling its own sentence from three booleans would be a second place the
 * claim could soften.
 */
export interface NotificationsView {
  configured: boolean;
  /** `••••` plus four characters of the webhook's token, or null. Never a value. */
  masked_hint: string | null;
  /** DASH's own clock at the moment it was stored, or null. */
  configured_at: string | null;
  send_approvals: boolean;
  send_reports: boolean;
  /** What DASH is doing right now, in one sentence. See `describeNotificationState`. */
  state_sentence: string;
}

/* ---------------------------------------------------------------------- *
 * Live workspace
 * ---------------------------------------------------------------------- */

export interface WorkspaceRunView {
  id: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  current_step: string | null;
  progress: number | null;
  /**
   * Run-scoped controls only. Approval and choice controls live on their
   * concrete inbox item, where the target ids and side-effect preview exist.
   */
  controls: AvailableControl[];
}

export interface WorkspaceTaskView {
  id: string;
  /** Null on a task that belongs to no run — see the Agent DOM state contract. */
  run_id: string | null;
  label: string;
  status: string;
  created_at: string | null;
  detail: string | null;
}

export interface WorkspaceConnectionView {
  connection_id: string;
  state: string;
  masked_account: string | null;
  checked_at: string;
  reauthorization_required: boolean;
  detail: string | null;
}

export interface WorkspaceMemoryView {
  id: string;
  label: string;
  summary: string;
  provenance: string;
  retention: "descriptor_only" | "user_approved";
  updated_at: string;
}

export interface WorkspaceApprovalDecisionView {
  id: string;
  request_id: string;
  decision: "approved" | "rejected";
  actor_id: string;
  decided_at: string;
  correlation_id: string;
}

export interface WorkspaceAuditEventView {
  id: string;
  type: string;
  actor_id: string;
  target_id: string;
  ts: string;
  correlation_id: string;
}

export interface WorkspaceCommandAuditView {
  command: string;
  decision: "allowed" | "denied" | "duplicate";
  reason: string | null;
  actor_id: string;
  actor_type: string;
  authenticated_by: string;
  run_id: string | null;
  correlation_id: string;
  decided_at: string;
}

export interface WorkspacePlanView {
  run_id: string;
  planned_components: string[];
  executed_components: string[];
  deviations: Array<{ kind: string; detail: string }>;
}

export interface WorkspaceSnapshotView {
  observed_at: string;
  received_at: string;
  overview: WorkspaceOverview;
  inbox: InboxItem[];
  runs: WorkspaceRunView[];
  tasks: WorkspaceTaskView[];
  connections: WorkspaceConnectionView[];
  memory: WorkspaceMemoryView[];
  approval_decisions: WorkspaceApprovalDecisionView[];
  audit_events: WorkspaceAuditEventView[];
  command_audit: WorkspaceCommandAuditView[];
  plan_vs_actual: WorkspacePlanView | null;
}

/**
 * An imported agent can legitimately have no live Agent DOM snapshot yet.
 * Keeping that as `snapshot: null` lets the workspace explain "not connected"
 * without pretending the agent itself is absent.
 */
export type WorkspaceView =
  | { found: false }
  | {
      found: true;
      agent: string;
      title: string;
      /**
       * Whether `title` is a stored rename rather than the manifest's own
       * `display_name` (MAR-589). The settings drawer's only use for this: it
       * words the name row's source line differently depending on which one
       * a person is looking at.
       */
      renamed: boolean;
      goal: string;
      /**
       * The agent's persisted character, for the portrait (MAR-502).
       *
       * Null for an agent whose row DASH cannot read — which is a real state
       * here, because this view is built from the manifest and the manifest is
       * a different column from the avatar. The page reserves the portrait's
       * box either way, so a null costs no layout; inventing one from the name
       * would put a character on screen that the fleet card beside it might not
       * agree with, and the whole value of a costume is that it is the same one
       * every time.
       */
      avatar: OName | null;
      snapshot: WorkspaceSnapshotView | null;
      /**
       * The most recent digest, across every run — and deliberately a sibling of
       * `snapshot` rather than a field inside it.
       *
       * The snapshot is what the agent published about itself and is null until
       * it has published anything. A digest is DASH's own record and outlives
       * the process that made it. Nesting it would make the last thing the user
       * cares about vanish whenever the agent was stopped or unreachable.
       */
      latest_digest: RunArtifact | null;
      latest_digest_grounding: GroundingAnalysis | null;
      /**
       * The latest outputs this agent has made, across every run, with each
       * output's availability resolved by the same producer the run detail page
       * uses (MAR-434, MAR-609).
       *
       * **This used to be one run's outputs, and the narrowing was the bug.**
       * MAR-434's scope was "everything *that run* produced", which is right on
       * the run detail page and wrong here: Henrik asked the agent page for *"a
       * list of the latest outputs"* and got the newest run's, so a scout run
       * twice showed one digest and gave no route to the other. The counter-
       * argument this doc used to make — that an unbounded list turns the page
       * into an archive — is answered by `artifactRecordsForAgent`'s own cap
       * rather than by showing one run, and that function has been the author
       * panel's scope since MAR-548. The two surfaces on this page disagreed
       * about how much of an agent's work existed, and DASH's own was the one
       * hiding it.
       *
       * Each card carries its producing run in `reference.run_id`, so the link
       * to a run is per card. There is deliberately no view-level run id: with
       * a list that spans runs, one id would name a run most of the cards did
       * not come from.
       *
       * Empty rather than absent when there are none, so the panel can say
       * "nothing was produced" — which is a different thing to learn from a
       * panel that is not shown, and is the distinction
       * `app/_components/outputs.tsx` already argues for.
       */
      outputs: ArtifactCardView[];
      /**
       * The live output feed for this agent's current or latest run (MAR-635).
       *
       * Projected from telemetry v1 events, which already carry per-step
       * records. `{ kind: "empty" }` when this agent has never posted a run
       * event — the state every new user meets, and the one the page is
       * sized for first.
       */
      feed: AgentFeedView;
      /**
       * Numbers the selected run actually reported (MAR-635, MAR-547).
       *
       * `meters` is empty when nothing was recorded. The panel then draws
       * nothing at all: a zero would claim a fact the store does not have.
       */
      telemetry: AgentTelemetryView;
      /** What the manifest declares it may do without an account. */
      permissions: PermissionGrant[];
      /**
       * The kinds of file this agent declares it accepts (MAR-507), in the
       * author's own plain-language names.
       *
       * A projection of the manifest and nothing else. It carries no task, no
       * admitted file and no path, because none of those are facts DASH holds:
       * the runner owns the task workspace, and what is in it is the answer to a
       * command rather than a field on a view. Empty means the agent takes no
       * files, which is not the same as taking anything — see `buildInputRoles`.
       */
      input_roles: InputRoleView[];
      /**
       * Which model this agent uses, and what its steps asked for (MAR-583).
       *
       * Never absent, so a page cannot have to decide what a missing setting
       * means: the union's `can_choose: false` arm carries the sentence for every
       * agent there is nothing to choose for, including the ordinary case of an
       * agent whose plan uses no model at all.
       */
      models: AgentModelSettingsView;
      /**
       * The Health stage's stored-record verdicts (MAR-645).
       *
       * Host sightings are deliberately not here: ADR 0015 keeps those in the
       * renderer for one window, and the stage joins them to `deploy_targets`
       * at draw time rather than persisting them in this document.
       */
      health: AgentHealthView;
      /**
       * What pressing Run now will spend, or null (MAR-619, ADR 0016).
       *
       * Null for every agent that cannot spend on a run, which is nearly all of
       * them: one that declares no model provider, one whose key is not
       * connected, and one whose owner has named no model. All three produce a
       * run that is refused before anything is sent, so a warning about money
       * on them would be a warning about nothing — and `describeFleetReach`
       * records what becomes of a warning that is usually about nothing.
       *
       * Non-null is the disclosure ADR 0016 obliges: the Run press is the one
       * act in DASH that authorises an agent to spend, so it is the one place a
       * person has to be told, before they press, that it will.
       */
      run_spend: string | null;
      /**
       * The conversation with this agent about what it has saved (MAR-545).
       *
       * Never absent, for `models`' reason: the union's `can_ask: false` arm
       * carries a sentence and a next action for every reason there is nothing
       * to ask with, so a page cannot have to decide what a missing chat means
       * and cannot end up drawing an input that does nothing.
       */
      ask: AgentAskView;
      /**
       * The panel this agent's author declared, bound to what the agent has
       * produced (MAR-548, ADR 0008 slice 3).
       *
       * Built from the *folder's* `agent.manifest.json` where there is one, the
       * row's copy otherwise — `panelDocument` in `lib/views/build.ts` owns that
       * choice, because it is the half of ADR 0008's authority rule that needs a
       * disk and `lib/views/panel.ts` must stay free of one.
       *
       * `{ kind: "none" }` for an agent that declared no panel, which is every
       * agent until its author declares one, and which renders nothing at all —
       * not an empty frame and not a placeholder. This field is never absent, so
       * a page cannot have to decide what a missing panel means.
       */
      panel: PanelView;
      /**
       * Whether this agent's saved setup is behind DASH's own template, and
       * what to say about it (MAR-576).
       *
       * Null for every agent DASH did not scaffold, and for every scaffolded
       * agent already carrying the current template's capabilities — which is
       * to say null almost always. It is non-null exactly when DASH is about to
       * draw a thinner page than it would for a freshly added copy of the same
       * agent, which is the one moment silence would be a lie.
       *
       * A sibling of `panel` rather than a fourth `PanelView` case, and that is
       * deliberate. `PanelView` answers "what does the author's region draw",
       * and the answer here is genuinely `none` — there is no region, the author
       * declared nothing, and `AgentPanel` is right to render nothing. This
       * answers a different question, in DASH's own voice, about DASH's own
       * template. Folding it into the union would have put a sentence DASH is
       * saying about itself inside the box marked as somebody else's.
       */
      manifest_gap: ManifestGapView | null;
      /**
       * Whether this agent could be put on a server, and why not (MAR-577).
       *
       * The same fact `AgentRow` carries, on the page where the agent is already
       * chosen. Here it decides whether the deploy section offers a server at
       * all: an agent DASH cannot send is shown the refusal and no control,
       * which is `lib/workspace.ts`'s rule about dead controls applied to the
       * one case where a disabled button would read as a claim about the
       * *server* rather than about the agent.
       */
      deploy: AgentDeployView;
      /**
       * Every server DASH has sent this agent to (MAR-584, ADR 0010).
       *
       * Empty for an agent DASH has never pushed, which is almost all of them,
       * and an empty list draws nothing. It is on the workspace and not on
       * `AgentRow` on purpose: the fleet card asks whether an agent needs you,
       * and "a server has an older copy" is a fact about a decision you already
       * made rather than something waiting for you.
       *
       * Newest first, so the server most likely to be on somebody's mind is the
       * one they read first.
       */
      deploy_targets: AgentDeployTarget[];
      /**
       * Whether DASH can offer to compare this agent's folder (MAR-584).
       *
       * The comparison itself is not here, and that is the design rather than an
       * omission: `folder.check` is a command a person presses, and a report
       * computed inside this view would be DASH looking at the folder on every
       * five-second poll — hashing every recorded file of every open agent page
       * — while telling the person on that page that it only looks when asked.
       *
       * False for an agent with no folder of DASH's own, where there is nothing
       * to open and nothing to compare.
       */
      folder_checkable: boolean;
    };

export type WorkInboxRow = InboxItem & {
  agent: string;
  agent_title: string;
  observed_at: string;
};

/**
 * A schedule-triggered agent past its expected window, alongside choices and
 * approvals (MAR-441).
 *
 * Deliberately not an `InboxItem`: that type's shape is built around a
 * concrete deadline (`expires_at`/`expired`), and a stalled agent has no
 * deadline — there is nothing expiring, only a gap since the last activity
 * this module could find evidence of. Forcing it into that shape would mean
 * inventing an expiry the agent never declared.
 */
export interface StalledAgentRow {
  agent: string;
  agent_title: string;
  last_activity_at: string | null;
  next_action: string;
}

export interface WorkInboxView {
  items: WorkInboxRow[];
  stalled: StalledAgentRow[];
}


/* ---------------------------------------------------------------------- *
 * Talking to an agent (MAR-545)
 * ---------------------------------------------------------------------- */

/**
 * One saved thing an answer was built from, as DASH recorded it.
 *
 * Everything here came out of DASH's own store at the moment the question was
 * asked. Nothing on it is derived from the answer's text, which is what makes
 * the list worth showing under an answer at all — a model that invents a source
 * cannot put it here. See `lib/ai/ask.ts`.
 */
export interface AskCitationView {
  /** The number the material used, so a mention in the answer can be found. */
  index: number;
  headline: string;
  source_name: string | null;
  /** The item's own link, as the agent recorded it. Rendered by DASH, never by the answer. */
  item_url: string | null;
  report_title: string;
}

/** One question and what became of it, ready to draw. */
export interface AskExchangeView {
  id: number;
  question: string;
  /** When it was asked, in words. Never a machine timestamp. */
  asked: string;
  /** The answer's text, or null when the question did not produce one. */
  answer: string | null;
  /** Why it failed, with a next action. Null exactly when there is an answer. */
  failure: Recovery | null;
  /** Which saved things were used and why, in one sentence. */
  selection: string;
  /**
   * What it cost, said by whoever knows — the provider when it stated an amount,
   * a count of what was read and written otherwise. Never a figure DASH derived.
   */
  charge: string;
  /** The model the provider says answered. Null when it did not say. */
  model: string | null;
  citations: AskCitationView[];
}

/** What the chat fires when somebody asks something. */
export interface AskFlow {
  agent_id: string;
  connection_id: string;
  field_id: string;
}

/**
 * The chat on an agent's page.
 *
 * A discriminated union rather than one shape with a disabled flag, so that
 * every reason a person cannot ask something carries its own sentence and its
 * own next action. MAR-545 asks for exactly this: "never a dead input".
 */
/**
 * The model indicator on the composer's settings row (MAR-648).
 *
 * ## The id is the label, and there is no friendlier one to give
 *
 * `model_id` is the provider's own name for the model — `claude-sonnet-5`,
 * `gpt-5.2`. It is set as a value rather than written into a sentence, which is
 * `lib/copy/identifiers.ts`'s rule and also the only honest option: DASH holds
 * no table mapping a model id to a marketing name, and ADR 0012's refusal of a
 * price table is the same argument in a different costume — a copy of somebody
 * else's facts, in a repository nobody updates when they change.
 *
 * It is also the string a person already sees on every stored answer
 * (`AskExchangeView.model`) and in the picker they chose it with, so the
 * indicator matches what is above and below it.
 *
 * ## `from_default` is a fact about whose decision it was
 *
 * `EffectiveModelChoice.from_default`, carried rather than re-derived. "You
 * chose this" and "this is what DASH uses unless you say otherwise" are
 * different facts about the same id, and a person who cannot tell them apart
 * cannot predict what changing the fleet default will do to this agent.
 */
export interface AskModelView {
  /** The provider's own model id. Rendered as a value, never inside prose. */
  model_id: string;
  /** True when this agent is running on DASH's fleet default (MAR-642). */
  from_default: boolean;
  /** Which of the two facts above, in words. `lib/copy/ask.ts` owns them. */
  note: string;
  /** Where to change it — this agent's Settings stage. */
  change_label: string;
}

export type AgentAskView =
  | {
      can_ask: true;
      heading: string;
      purpose: { headline: string; detail: string };
      custody: string;
      placeholder: string;
      submit: string;
      working: string;
      sources_heading: string;
      /** DASH's friendly name for the provider being asked. Never an identifier. */
      provider_label: string;
      /**
       * The model this question will actually be asked under (MAR-648).
       *
       * The composer's settings row draws it, which is the whole of Henrik's
       * *"It's a chatbox with some settings. Model, etc."* — and it is the one
       * setting a person can already change, so it is the one the row carries.
       *
       * `readEffectiveModelChoice`'s answer, not `agent_model_choice`'s: MAR-642
       * gave DASH a fleet default, and an indicator reading the per-agent row
       * alone would show nothing at all for the agent that is *only* covered by
       * the default — which is every freshly imported agent, and precisely the
       * case the default was added for.
       *
       * Never null on this arm. `buildAgentAsk` refuses a question it cannot name
       * a model for before it reaches here, so an "asking under —" state is
       * unreachable rather than merely unlikely.
       */
      model: AskModelView;
      /** What sending a question will do, before anybody presses anything. */
      estimate: { headline: string; detail: string };
      ask: AskFlow;
      /** Oldest first, so the conversation reads downwards. */
      history: AskExchangeView[];
      /** What every question here has cost so far, or null when nothing is priced. */
      spent: string | null;
      /**
       * What this agent says its own runs cost, or null when they say nothing
       * (MAR-583's unread field, MAR-545).
       *
       * Beside `spent` on purpose. One of these two numbers is a provider's
       * figure for something DASH asked for, and the other is the agent's own
       * figure about its own past — ADR 0005's two kinds of fact, about money,
       * where a person can see both at once and the sentences say which is
       * which.
       */
      reported: string | null;
    }
  | {
      can_ask: false;
      heading: string;
      blocked: Recovery;
      /**
       * The connection to open, when the reason is a missing key. Null for every
       * other reason, because there is nothing for a button to do.
       */
      connect: AiKeyFlow | null;
      /** Oldest first. Kept when a key is withdrawn: the conversation happened. */
      history: AskExchangeView[];
      /**
       * The heading over a citation list.
       *
       * On this arm as well as the other, because a conversation outlives the
       * key that produced it: an agent whose provider has been disconnected
       * still shows every answer it gave and what each one was built from. The
       * component would otherwise have to supply a word of its own, and this
       * file's whole point is that it never does.
       */
      sources_heading: string;
      /** What this agent says its own runs cost. Shown whether or not it can be asked. */
      reported: string | null;
    };
