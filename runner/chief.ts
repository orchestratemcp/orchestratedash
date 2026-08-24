/**
 * The chief, in the process that outlives the window (MAR-743, ADR 0028).
 *
 * `electron/chief-host.ts` for the other room, and deliberately its shape: thin,
 * because it holds a socket, a credential and a database handle, and everything
 * that could be decided somewhere testable is. Who may speak is
 * `lib/chief/discord.ts`, what the answer is is `lib/chief/answer.ts` — the same
 * procedure main runs, not a second one — what a spend is allowed to be is
 * `runner/chief-broker.ts`, and the socket is `runner/discord-gateway.ts`.
 *
 * ## The four things this file supplies
 *
 * **The snapshot, and its age.** The runner does not open `dash.sqlite` — ADR
 * 0028 decision 6, and MAR-700's three destroyed stores behind it. So the fleet
 * arrives as a document main pushes and this file holds it, timestamped. An
 * answer built from a snapshot older than the reply says how old it is, which is
 * the honest form of a cost that cannot be designed away.
 *
 * **One question at a time.** `#busy` is a serial gate rather than a queue. A
 * person who sends three messages in a row while the first is still being
 * answered gets one sentence saying so, not three priced completions racing each
 * other into the same channel. The broker's window would have caught the sixth
 * in a minute; this catches the second in a second, and it is the difference
 * between a bound and a bill.
 *
 * **The spool.** Turns and broker decisions go into `runner.sqlite`, and DASH
 * drains them into `chief_messages` and `broker_audit` on its next open. See
 * `runner/store.ts` for why those are queues and not homes.
 *
 * **The credentials, held nowhere else.** The bot token and the model key are
 * one object in memory, handed over by main on the authenticated control
 * channel. Never written to the store, never to a file, never to a log. Gone
 * when this process ends, which is the third liveness sentence and the reason
 * there is a fourth.
 */

import type { DatabaseSync } from "node:sqlite";

import { aiProviderById } from "../lib/ai/providers";
import { answerChiefQuestion, type ChiefSnapshot } from "../lib/chief/answer";
import { readChiefEvidence } from "../lib/chief/evidence";
import { fetchChiefSources } from "../lib/chief/fetch-sources";
import type { ChiefItem } from "../lib/chief/library";
import { CHIEF_SOURCES } from "../lib/chief/sources";
import type { ChiefBriefingRow } from "../lib/chief/briefing";
import {
  admit,
  fitReply,
  replyFor,
  type InboundMessage,
} from "../lib/chief/discord";
import type { ChiefFleetAgent } from "../lib/chief/reply";
import type { ChiefTurnDraft } from "../lib/chief/store";
import { createChiefBroker, type ChiefAuditRow, type ChiefBroker } from "./chief-broker";
import { DiscordGateway, type GatewaySocket } from "./discord-gateway";

/* ---------------------------------------------------------------------- *
 * What main hands over
 * ---------------------------------------------------------------------- */

/**
 * One push from main: everything the chief needs to answer without DASH.
 *
 * One object rather than four routes, because the pieces are only useful
 * together and a partial handover is a state with no good behaviour — a bridge
 * with a token and no key would connect and refuse everything, which reads to
 * the person as a broken feature rather than as a half-finished setup.
 */
export interface ChiefBridgeConfiguration {
  bot_token: string;
  channel_id: string;
  allowed_user_id: string;
  /**
   * The provider and key the chief spends, or null.
   *
   * Null is a real and ordinary state: a person can connect Discord before
   * connecting AI, and ADR 0028 decision 9 says the chief still answers — from
   * records, saying what it could not add.
   */
  model: { provider_id: string; model_id: string; api_key: string } | null;
  snapshot: PushedSnapshot;
}

/** The fleet as main last read it, with the moment it read it. */
export interface PushedSnapshot {
  fleet: ChiefFleetAgent[];
  briefing: ChiefBriefingRow[];
  /**
   * What the fleet has produced, newest first (MAR-744).
   *
   * Pushed rather than read, and this is the clause of ADR 0028 decision 6 that
   * MAR-744 leans hardest on: the answer to *"pull out the most current news"*
   * lives in `run_artifacts` in `dash.sqlite`, and the runner may not open that
   * file. So main flattens it into items on its way past and hands them over
   * with the briefing.
   *
   * The cost is the one decision 6 already states, arriving somewhere it bites
   * harder: a Discord answer is grounded in the fleet **as of the last push**,
   * and for news that is the difference between today's headlines and
   * Tuesday's. `#asOf` says so on any model answer past the threshold, which is
   * what stops the staleness being silent.
   *
   * Bounded at `MAX_LIBRARY_ITEMS` by `chiefLibrary` before it is pushed, so
   * this stays a small object on a local HTTP channel however long somebody has
   * owned their agents.
   */
  library: ChiefItem[];
  taken_at: string;
}

export interface RunnerChiefOptions {
  /** The runner's store, or null while it is damaged. Resolved per use. */
  database: () => DatabaseSync | null;
  log: (line: string) => void;
  fetchImpl?: typeof fetch;
  connect?: (url: string) => GatewaySocket;
  now?: () => Date;
}

/**
 * How many spooled turns may wait for DASH to open.
 *
 * A person who leaves DASH closed for a month and talks to the chief every day
 * should not come back to a runner holding an unbounded transcript. Bounded at
 * the write, dropping the **oldest**, which is the opposite of
 * `DiscordNotifier`'s choice and right for the opposite reason: a notification
 * that has been waiting behind forty others is not a notification any more,
 * while a conversation is most useful at its end.
 */
const MAX_SPOOLED_TURNS = 200;
const MAX_SPOOLED_AUDIT = 400;

/* ---------------------------------------------------------------------- *
 * The bridge
 * ---------------------------------------------------------------------- */

export class RunnerChief {
  #configuration: ChiefBridgeConfiguration | null = null;
  #busy = false;
  readonly #gateway: DiscordGateway;
  readonly #broker: ChiefBroker;
  readonly #options: RunnerChiefOptions & { now: () => Date };

  constructor(options: RunnerChiefOptions) {
    this.#options = { ...options, now: options.now ?? (() => new Date()) };
    this.#gateway = new DiscordGateway({
      onMessage: (message) => {
        void this.#hear(message);
      },
      log: options.log,
      connect: options.connect,
      fetchImpl: options.fetchImpl,
    });
    this.#broker = createChiefBroker({
      /*
       * A function, not a captured value. Main can push a replaced key at any
       * moment, and a broker holding the old one would spend a credential the
       * person has revoked.
       */
      credential: () => {
        const model = this.#configuration?.model;
        return model === undefined || model === null
          ? null
          : { provider_id: model.provider_id, api_key: model.api_key };
      },
      fetchImpl: options.fetchImpl ?? fetch,
      audit: (row) => {
        this.#spoolAudit(row);
      },
      now: this.#options.now,
    });
  }

  /**
   * Take a configuration, or take one away.
   *
   * Called at DASH's startup, on every settings change, and with null on
   * disconnect — `pushNotifyConfiguration`'s cadence and its reasoning: what it
   * costs to be wrong is silence, and silence is the failure this feature exists
   * to prevent.
   */
  configure(configuration: ChiefBridgeConfiguration | null): void {
    this.#configuration = configuration;
    this.#gateway.configure(
      configuration === null
        ? null
        : { bot_token: configuration.bot_token, channel_id: configuration.channel_id },
    );
  }

  /**
   * Whether a bridge is configured, and what it is currently answering with —
   * never the credentials themselves (MAR-745).
   *
   * `fleet_count` and `model` exist because ADR 0028 decision 6 pushes a
   * snapshot rather than letting the runner pull one, and a push that never
   * fired — the gap MAR-745 found — leaves DASH's settings row and the
   * runner's actual memory disagreeing with nothing on screen to say so. This
   * is the sentence that closes that gap: read fresh on every call, off the
   * one object `#hear` answers from, so it cannot drift from what a Discord
   * question would actually be asked under.
   */
  describe(): {
    configured: boolean;
    connected: boolean;
    snapshot_at: string | null;
    fleet_count: number;
    model: { provider_id: string; model_id: string; label: string } | null;
  } {
    const model = this.#configuration?.model;
    const profile = model === undefined || model === null ? null : aiProviderById(model.provider_id);
    return {
      ...this.#gateway.describe(),
      snapshot_at: this.#configuration?.snapshot.taken_at ?? null,
      fleet_count: this.#configuration?.snapshot.fleet.length ?? 0,
      model:
        model === undefined || model === null
          ? null
          : { provider_id: model.provider_id, model_id: model.model_id, label: profile?.label ?? model.provider_id },
    };
  }

  stop(): void {
    this.#gateway.stop();
    this.#configuration = null;
  }

  /**
   * Hand DASH everything that has happened since it last asked, and forget it.
   *
   * Read-then-delete in one transaction, so a drain that is interrupted between
   * the two does not lose the rows — the pattern `drainTelemetry` uses, and the
   * reason it is a transaction rather than two statements is that the failure it
   * prevents is somebody's conversation disappearing.
   */
  drain(): { turns: ChiefTurnDraft[]; audit: ChiefAuditRow[] } {
    const database = this.#options.database();
    if (database === null) {
      return { turns: [], audit: [] };
    }
    try {
      database.exec("BEGIN IMMEDIATE");
      const turns = database
        .prepare(
          "SELECT asked_at, question, answer, failure, provider_id, model_id, tokens_in, " +
            "tokens_out, amount_usd, receipt_json, origin, evidence_json " +
            "FROM chief_turn_spool ORDER BY id",
        )
        .all()
        .map((row) => readTurn(row as Record<string, unknown>));
      const audit = database
        .prepare(
          "SELECT connection_id, operation, request_id, decision, refusal, input_keys, " +
            "result_count, duration_ms, decided_at FROM chief_audit_spool ORDER BY id",
        )
        .all()
        .map((row) => readAudit(row as Record<string, unknown>));
      database.exec("DELETE FROM chief_turn_spool");
      database.exec("DELETE FROM chief_audit_spool");
      database.exec("COMMIT");
      return { turns, audit };
    } catch (error: unknown) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // No transaction was open. Nothing to undo.
      }
      this.#options.log(`[runner] the chief's spool could not be drained: ${describeError(error)}`);
      return { turns: [], audit: [] };
    }
  }

  /* -------------------------------------------------------------------- *
   * One message
   * -------------------------------------------------------------------- */

  async #hear(message: InboundMessage): Promise<void> {
    const configuration = this.#configuration;
    if (configuration === null) {
      return;
    }
    const admission = admit(message, {
      enabled: true,
      channel_id: configuration.channel_id,
      allowed_user_id: configuration.allowed_user_id,
    });

    if (admission.kind === "ignore") {
      /*
       * Silence, for everybody who is not the one allowed id — and no log line
       * naming them either. The two exceptions are the two where the *allowed*
       * person is the one being dropped, and telling them is the whole point:
       * a question too long to carry, and a message with no words in it, are
       * both things they can act on.
       */
      if (admission.why === "too_long" && message.author_id === configuration.allowed_user_id) {
        await this.#say(
          "That is longer than I carry over Discord. Ask me the short version here, or open DASH " +
            "on your computer for the long one.",
        );
      }
      return;
    }

    if (this.#busy) {
      // Said rather than queued. A queue here would price every message somebody
      // sent while waiting, and "I am still on the last one" is what a person
      // would want to hear from anybody else.
      await this.#say("Still working on your last one — ask me again when I have answered it.");
      return;
    }

    this.#busy = true;
    try {
      /*
       * Say it was heard, before the work starts (MAR-744).
       *
       * Not awaited on the way to the answer -- the indicator is a courtesy and
       * the reply is the point, so a slow or refused typing call must not add
       * latency to what the person actually asked for. `showTyping` swallows its
       * own failures for the same reason.
       */
      void this.#gateway.showTyping();
      await this.#answer(admission.question, configuration);
    } catch (error: unknown) {
      /*
       * The last guard on ADR 0028 decision 9, and it earns its place: the
       * snapshot arrives as JSON from another process, and a field with the
       * wrong shape in it throws deep inside the answering procedure — which
       * would otherwise be a person in a chat room getting nothing back, which
       * is exactly what decision 9 forbids and exactly what "it is broken" looks
       * like from their side.
       *
       * The caught value is logged and never sent. It can carry a stack naming
       * this repository's files, and a chat channel is not where those go.
       */
      this.#options.log(`[runner] the chief could not answer: ${describeError(error)}`);
      await this.#say(
        "Something went wrong on my side and I could not answer that. Open DASH on your computer — " +
          "it will say more than I can from here.",
      );
    } finally {
      this.#busy = false;
    }
  }

  async #answer(question: string, configuration: ChiefBridgeConfiguration): Promise<void> {
    const profile =
      configuration.model === null ? null : aiProviderById(configuration.model.provider_id);

    const snapshot: ChiefSnapshot = {
      fleet: configuration.snapshot.fleet,
      briefing: configuration.snapshot.briefing,
      /*
       * An older DASH pushes no library, so this is the field that has to
       * survive a version skew: an empty list means *this room has nothing of
       * your agents' to read*, and `selectChiefMaterial` answers
       * `nothing_saved`, which the chief says in words. A missing field read as
       * a fault would make a perfectly working bridge look broken after a
       * downgrade.
       */
      library: configuration.snapshot.library ?? [],
      taken_at: configuration.snapshot.taken_at,
    };

    const outcome = await answerChiefQuestion(question, "discord", {
      snapshot,
      model:
        configuration.model === null || profile === null
          ? null
          : { profile, model_id: configuration.model.model_id },
      /*
       * No conversational context, and this is a stated gap rather than an
       * oversight.
       *
       * `recentChiefContext` reads the last few turns out of `chief_messages`,
       * which this process must not open. Reading them out of the spool instead
       * would give a *different* history to the two rooms — the spool empties
       * every time DASH opens — so the chief would remember more or less of the
       * same conversation depending on when somebody last looked at their
       * computer. An empty string is the honest version of "I do not have that
       * here"; carrying context across the drain is MAR-744's to do properly.
       */
      context: "",
      ask: (request) => this.#broker.handle(request),
      /*
       * Discord can search too, and it is the same implementation (MAR-744).
       *
       * ADR 0028 decision 1's rule, one layer down: a second fetcher in the
       * runner is a place for the allowlist, the byte ceiling or the audit row
       * to quietly not be true on the path where nobody is watching. Main hands
       * `fetchChiefSources` its `recordBrokerCall`; this hands it the audit
       * spool, and `recordRunnerChiefCall` stamps `decided_on = 'runner'` on
       * every row when DASH drains them.
       *
       * This is a read and it opens no allowance. ADR 0028 decision 8 bounds
       * what a Discord message may cause to exactly one chief completion; a
       * fetch of three public feeds spends nothing at all, so the sentence that
       * decision makes about somebody's money is unchanged by this packet.
       */
      fetchSources: async (topic: string) =>
        (
          await fetchChiefSources(
            topic,
            {
              fetchImpl: this.#options.fetchImpl ?? fetch,
              audit: (row) => {
                this.#spoolAudit(row);
              },
              now: this.#options.now,
            },
            CHIEF_SOURCES,
          )
        ).sources,
      record: (draft) => this.#spoolTurn(draft),
      now: this.#options.now,
    });

    const reply = replyFor(outcome);
    const dated =
      outcome.kind === "answered" && outcome.from === "model"
        ? `${reply}${this.#asOf(configuration.snapshot.taken_at)}`
        : reply;
    await this.#say(dated);
  }

  /**
   * How old the facts under an answer are, when that is worth saying.
   *
   * Only on a model answer, and only past a threshold. A records answer already
   * reads as a quotation from DASH's own cards, and a snapshot pushed twenty
   * minutes ago is not stale in any sense a person cares about — a note on every
   * reply would be noise that teaches somebody to stop reading the notes.
   */
  #asOf(takenAt: string): string {
    const age = this.#options.now().getTime() - Date.parse(takenAt);
    if (!Number.isFinite(age) || age < STALE_AFTER_MS) {
      return "";
    }
    const hours = Math.floor(age / 3_600_000);
    const when = hours < 24 ? `${String(hours)}h ago` : `${String(Math.floor(hours / 24))}d ago`;
    return `\n\n(Your fleet as DASH last read it, ${when}. Open DASH to refresh what I know.)`;
  }

  async #say(text: string): Promise<void> {
    await this.#gateway.post(fitReply(text));
  }

  /* -------------------------------------------------------------------- *
   * The spool
   * -------------------------------------------------------------------- */

  #spoolTurn(draft: ChiefTurnDraft): boolean {
    const database = this.#options.database();
    if (database === null) {
      /*
       * The runner's store is damaged and `runner/main.ts` is supervising
       * nothing until it is repaired. False, so the answer is reported as
       * unrecorded rather than delivered as though it had been written down —
       * `recordChiefTurn`'s own asymmetry, and the reason `not_recorded` is its
       * own outcome.
       */
      return false;
    }
    try {
      database
        .prepare(
          "INSERT INTO chief_turn_spool (asked_at, question, answer, failure, provider_id, " +
            "model_id, tokens_in, tokens_out, amount_usd, receipt_json, origin, " +
            "evidence_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          draft.asked_at,
          draft.question,
          draft.answer,
          draft.failure,
          draft.provider_id,
          draft.model_id,
          draft.tokens_in,
          draft.tokens_out,
          draft.amount_usd,
          JSON.stringify(draft.receipt),
          draft.origin,
          // Null for a turn with no tool, the same representation
          // `recordChiefTurn` writes on the far side of the drain.
          draft.evidence.kind === "none" ? null : JSON.stringify(draft.evidence),
        );
      trim(database, "chief_turn_spool", MAX_SPOOLED_TURNS);
      return true;
    } catch (error: unknown) {
      this.#options.log(`[runner] the chief's turn could not be spooled: ${describeError(error)}`);
      return false;
    }
  }

  #spoolAudit(row: ChiefAuditRow): void {
    const database = this.#options.database();
    if (database === null) {
      return;
    }
    try {
      database
        .prepare(
          "INSERT INTO chief_audit_spool (connection_id, operation, request_id, decision, " +
            "refusal, input_keys, result_count, duration_ms, decided_at) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          row.connection_id,
          row.operation,
          row.request_id,
          row.decision,
          row.refusal,
          JSON.stringify(row.input_keys),
          row.result_count,
          row.duration_ms,
          row.decided_at,
        );
      trim(database, "chief_audit_spool", MAX_SPOOLED_AUDIT);
    } catch (error: unknown) {
      /*
       * Logged and swallowed. An audit row that cannot be written must not
       * become a refusal the person sees: the decision was already taken and the
       * provider may already have been paid, so failing the question here would
       * charge somebody for an answer and then tell them it did not happen.
       */
      this.#options.log(`[runner] a chief decision could not be spooled: ${describeError(error)}`);
    }
  }
}

/** Past this, an answer says how old the facts under it are. */
const STALE_AFTER_MS = 6 * 3_600_000;

function trim(database: DatabaseSync, table: string, keep: number): void {
  database
    .prepare(
      `DELETE FROM ${table} WHERE id NOT IN (SELECT id FROM ${table} ORDER BY id DESC LIMIT ?)`,
    )
    .run(keep);
}

function readTurn(row: Record<string, unknown>): ChiefTurnDraft {
  return {
    asked_at: String(row["asked_at"]),
    question: String(row["question"]),
    answer: typeof row["answer"] === "string" ? row["answer"] : null,
    failure: typeof row["failure"] === "string" ? row["failure"] : null,
    provider_id: typeof row["provider_id"] === "string" ? row["provider_id"] : null,
    model_id: typeof row["model_id"] === "string" ? row["model_id"] : null,
    tokens_in: numberOrNull(row["tokens_in"]),
    tokens_out: numberOrNull(row["tokens_out"]),
    amount_usd: numberOrNull(row["amount_usd"]),
    receipt: parseJsonArray(row["receipt_json"]) as ChiefBriefingRow[],
    // The column, not a constant. A row that lost its origin at the drain would
    // be exactly the copy-loses-provenance failure the column exists to stop.
    origin: row["origin"] === "discord" ? "discord" : "window",
    evidence: readChiefEvidence(
      typeof row["evidence_json"] === "string" ? row["evidence_json"] : null,
    ),
  };
}

function readAudit(row: Record<string, unknown>): ChiefAuditRow {
  return {
    connection_id: String(row["connection_id"]),
    operation: String(row["operation"]),
    request_id: String(row["request_id"]),
    decision: row["decision"] === "allowed" ? "allowed" : "refused",
    refusal: (typeof row["refusal"] === "string" ? row["refusal"] : null) as ChiefAuditRow["refusal"],
    input_keys: parseJsonArray(row["input_keys"]).filter(
      (one): one is string => typeof one === "string",
    ),
    result_count: numberOrNull(row["result_count"]),
    duration_ms: Number(row["duration_ms"]),
    decided_at: String(row["decided_at"]),
  };
}

function parseJsonArray(value: unknown): unknown[] {
  if (typeof value !== "string") {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "unknown";
}
