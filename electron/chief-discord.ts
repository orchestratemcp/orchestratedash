/**
 * Connecting the chief's second room, and keeping the runner supplied
 * (MAR-743, ADR 0028).
 *
 * `electron/notify-settings.ts` for the other Discord credential, and
 * deliberately its shape: every gate is in this module beside the vault read and
 * the write it guards, so "the token is reachable from exactly one entry in
 * exactly one context object" stays a property of `electron/main.ts`'s wiring
 * rather than a convention.
 *
 * ## What is different from the notifier, and it is the part to read
 *
 * MAR-588 hands the runner an address that can **post**. This hands it a bot
 * token that can post *and listen*, and a model key that can **spend**. ADR 0028
 * decision 5 is the argument for doing it at all; what this file adds is that
 * the widening is as narrow as it can be at the moment of handover:
 *
 * - the key is read from the vault **only when a push happens**, never held here;
 * - it is pushed only when a bridge is configured *and* enabled, so a person who
 *   turned the chief's Discord off has a runner with no key in it;
 * - it is pushed with the one model id DASH resolved, so the runner has nothing
 *   to choose;
 * - and `runner/chief-broker.ts` admits exactly one operation with it.
 *
 * ## Why the push is called more often than it needs to be
 *
 * `pushNotifyConfiguration`'s reasoning, inherited: the runner holds all of this
 * in memory only, so a runner that restarted while DASH was running has
 * forgotten it, and the failure of not re-pushing is a chief that goes quiet
 * with nobody able to tell why. Sending it again costs one local request.
 */

import type { BrowserWindow } from "electron";

import { parseAiKeyCredential } from "../lib/ai/credential";
import { readEffectiveChiefModel } from "../lib/ai/model-store";
import { aiProviderById } from "../lib/ai/providers";
import { recordRunnerChiefCall } from "../lib/broker/store";
import { briefingFor } from "../lib/chief/briefing";
import { chiefLibraryFor } from "../lib/views/chief-library";
import { CHIEF_CONNECTION_ID, chiefOperationId } from "../lib/chief/manifest";
import { chiefFleetFrom } from "../lib/chief/records-answer";
import { recordChiefTurn, type ChiefTurnDraft } from "../lib/chief/store";
import {
  CHIEF_DISCORD_PROMPT,
  isSnowflake,
  type ChiefDiscordSettings,
} from "../lib/chief/discord";
import { FLEET_PRINCIPAL } from "../lib/fleet/principal";
import { readFleetConnection } from "../lib/fleet/store";
import { SecureStoreError, type SecureStore } from "../lib/secure-store";
import {
  forgetChiefDiscordBridge,
  readChiefDiscordSettings,
  recordChiefDiscordBridge,
  setChiefDiscordEnabled,
} from "../lib/store";
import { maskSecret } from "../lib/secret-refs";
import { agentsView } from "../lib/views/build";

/** The vault name the chief's bot token stands under. */
export const CHIEF_DISCORD_SECRET_NAME = "dash.chief.discord.bot_token";

export type ChiefDiscordAction = "connect" | "disconnect" | "set_enabled";

export interface ChiefDiscordActionResult {
  ok: boolean;
  refusal?: string;
  detail: string;
  settings?: ChiefDiscordSettings;
}

export interface ChiefDiscordPorts {
  store: SecureStore;
  promptForSecret(request: {
    service: string;
    field_label: string;
    purpose: string;
    help: string | null;
    ai_provider_id: string | null;
  }): Promise<string | null>;
  /** Tell the runner. Resolves either way — a runner that is down is temporary. */
  pushToRunner(): Promise<void>;
  parent?: BrowserWindow | null;
}

/**
 * Run one command from the Discord tab.
 *
 * Every branch returns a sentence, `performNotifyAction`'s rule: a settings
 * surface that got back a bare `ok: false` would have to invent one, and the
 * sentence for "the vault is locked" is not something a page is in a position to
 * write.
 */
export async function performChiefDiscordAction(
  action: ChiefDiscordAction,
  target: { channel_id?: string; allowed_user_id?: string; enabled?: boolean },
  ports: ChiefDiscordPorts,
): Promise<ChiefDiscordActionResult> {
  switch (action) {
    case "connect":
      return connect(target, ports);
    case "disconnect":
      return disconnect(ports);
    case "set_enabled":
      return setEnabled(target, ports);
    default: {
      const unreachable: never = action;
      throw new Error(`Unhandled chief Discord action: ${String(unreachable)}`);
    }
  }
}

async function connect(
  target: { channel_id?: string; allowed_user_id?: string },
  ports: ChiefDiscordPorts,
): Promise<ChiefDiscordActionResult> {
  /*
   * The two ids first, before the credential window opens.
   *
   * `connect`'s ordering rule in `electron/notify-settings.ts`, applied to a
   * different precondition: asking somebody for a token and *then* telling them
   * the channel id they typed is not a channel id is the one order this must
   * never happen in. Discord shows the token once, so a person who pastes it
   * into a flow that then refuses has to go and reset it.
   */
  const channel = (target.channel_id ?? "").trim();
  const allowed = (target.allowed_user_id ?? "").trim();
  if (!isSnowflake(channel)) {
    return {
      ok: false,
      refusal: "bad_channel_id",
      detail:
        "That does not look like a channel id. In Discord, right-click the channel and choose Copy Channel ID — it is a long run of digits.",
    };
  }
  if (!isSnowflake(allowed)) {
    return {
      ok: false,
      refusal: "bad_user_id",
      detail:
        "That does not look like a user id. In Discord, right-click your own name and choose Copy User ID — it is a long run of digits, not your @handle.",
    };
  }

  const backing = ports.store.describeBacking();
  if (!backing.os_backed) {
    return {
      ok: false,
      refusal: "vault_unavailable",
      detail: `This computer has no credential vault available${
        backing.unavailable_reason === undefined ? "" : ` (${backing.unavailable_reason})`
      }, so DASH will not take a bot token it cannot protect.`,
    };
  }

  const typed = await ports.promptForSecret({
    service: CHIEF_DISCORD_PROMPT.service,
    field_label: CHIEF_DISCORD_PROMPT.field_label,
    purpose: CHIEF_DISCORD_PROMPT.purpose,
    help: CHIEF_DISCORD_PROMPT.help,
    ai_provider_id: null,
  });
  if (typed === null) {
    return { ok: false, refusal: "cancelled", detail: "Nothing was stored." };
  }

  const token = typed.trim();
  /*
   * The shape check, and it is deliberately weak.
   *
   * A Discord bot token is three dot-separated parts, and DASH could check that
   * — but Discord has changed the format before, and a check that is wrong on
   * the day they change it again refuses a token that works. So this rejects
   * only what cannot possibly be one: nothing, and something short enough to be
   * a typo. What actually validates the token is Discord's own gateway, which
   * answers 4004 and is reported plainly.
   */
  if (token.length < 32) {
    return {
      ok: false,
      refusal: "bad_token",
      detail:
        "That is too short to be a bot token. On the Bot tab in Discord's developer portal, press Reset Token and then Copy.",
    };
  }

  try {
    await ports.store.set(CHIEF_DISCORD_SECRET_NAME, token);
  } catch (error: unknown) {
    return {
      ok: false,
      refusal: error instanceof SecureStoreError ? error.code : "vault_error",
      detail:
        error instanceof SecureStoreError
          ? error.message
          : "This computer's vault would not take the bot token.",
    };
  }

  // The row goes in after the vault write, never before. A row without a vault
  // entry is a DASH that says the chief is listening and has nothing to listen
  // with.
  recordChiefDiscordBridge(maskSecret(token), channel, allowed);
  await ports.pushToRunner();

  return {
    ok: true,
    settings: readChiefDiscordSettings(),
    detail:
      "The chief is listening in that channel, to you and to nobody else. Say hello to it there.",
  };
}

async function disconnect(ports: ChiefDiscordPorts): Promise<ChiefDiscordActionResult> {
  /*
   * The runner **first**, and this is the one place the order differs from
   * `electron/notify-settings.ts`.
   *
   * There, the vault goes first because the worst case of the reverse is a
   * notifier that posts one more message. Here the runner is holding a live
   * socket and a spending key, and a person pressing Disconnect means "stop
   * listening now". Clearing the runner before the store means there is no
   * window in which DASH's records say disconnected and a socket is still open.
   *
   * `pushToRunner` reads the store, so the store has to be cleared for the push
   * to clear the runner — which is why the row is forgotten between the two.
   */
  forgetChiefDiscordBridge();
  await ports.pushToRunner();

  try {
    await ports.store.delete(CHIEF_DISCORD_SECRET_NAME);
  } catch (error: unknown) {
    // `not_found` is success: there was nothing to remove and the caller wanted
    // there to be nothing. Anything else is reported, because a vault that
    // refused a delete still holds the token.
    if (!(error instanceof SecureStoreError) || error.code !== "not_found") {
      return {
        ok: false,
        refusal: error instanceof SecureStoreError ? error.code : "vault_error",
        settings: readChiefDiscordSettings(),
        detail:
          "The chief has stopped listening, but this computer's vault would not remove the bot token. " +
          "Reset the token in Discord's developer portal so the old one cannot be used.",
      };
    }
  }

  return {
    ok: true,
    settings: readChiefDiscordSettings(),
    detail:
      "The chief has stopped listening and DASH has forgotten the channel. What it already said stays in Discord.",
  };
}

async function setEnabled(
  target: { enabled?: boolean },
  ports: ChiefDiscordPorts,
): Promise<ChiefDiscordActionResult> {
  const enabled = target.enabled === true;
  setChiefDiscordEnabled(enabled);
  await ports.pushToRunner();
  return {
    ok: true,
    settings: readChiefDiscordSettings(),
    detail: enabled
      ? "The chief is listening in Discord again."
      : "The chief has stopped listening. Your setup is kept, so you can turn it back on.",
  };
}

/* ---------------------------------------------------------------------- *
 * The push
 * ---------------------------------------------------------------------- */

/**
 * Everything the runner needs to be the chief, or null.
 *
 * Null whenever the bridge is not configured, not enabled, or its token cannot
 * be read back — and null is what clears the runner. There is no partial
 * handover: a runner with a channel and no token would hold a configuration it
 * cannot act on, which is a state with no behaviour worth having.
 *
 * **This is the one function in DASH that reads a model key out of the vault to
 * give it to another process.** Everything about that is argued in ADR 0028
 * decision 5. What is worth seeing here is how little it takes to do: the key is
 * read, put on the returned object, and never bound to anything that outlives
 * the call.
 */
export async function buildChiefBridgeConfiguration(
  store: Pick<SecureStore, "get">,
): Promise<Record<string, unknown> | null> {
  const settings = readChiefDiscordSettings();
  if (!settings.configured || !settings.enabled) {
    return null;
  }

  let token: string;
  try {
    token = await store.get(CHIEF_DISCORD_SECRET_NAME);
  } catch {
    /* The row says a token is there and the vault will not produce it — a
       profile move, a locked keychain, a wiped credential store. Null rather
       than a configuration with an empty token: the runner would identify with
       it, be refused 4004, and stop, which reports the wrong problem. */
    return null;
  }

  const agents = agentsView().agents;
  return {
    bot_token: token,
    channel_id: settings.channel_id,
    allowed_user_id: settings.allowed_user_id,
    model: await resolveChiefModel(store),
    snapshot: {
      fleet: chiefFleetFrom(agents),
      briefing: briefingFor(agents),
      /*
       * What the fleet has produced (MAR-744).
       *
       * Read here, on main's side, because ADR 0028 decision 6 keeps
       * `dash.sqlite` to one writer and this is the moment DASH is already
       * holding it open. It rides the same push as the briefing for
       * `ChiefSnapshot`'s reason: two projections of one read must describe the
       * same instant, and a library pushed separately from the briefing would
       * be a bridge answering from two different Tuesdays.
       *
       * Which means it is re-pushed on exactly the cadence MAR-745 established
       * — AI connection or default model changing, an agent imported or
       * removed, the bridge's settings re-saved — and **not** when a run
       * finishes. So a scout that ran an hour ago while DASH was closed is not
       * in the room's library until DASH is next opened, which is the same
       * sentence decision 6 already makes about the fleet and is honestly the
       * sharpest edge this packet leaves. See the handoff on MAR-744.
       */
      library: chiefLibraryFor(agents),
      taken_at: new Date().toISOString(),
    },
  };
}

/**
 * Which model the runner's chief asks under, and the key for it.
 *
 * `readEffectiveChiefModel` — the chief's own pin, then the fleet default — so
 * the two rooms ask under the same model. A runner resolving this itself would
 * be a second place the precedence is decided, which is the defect MAR-743 found
 * between `electron/chief-host.ts` and `lib/views/chief.ts` and did not want to
 * ship a third copy of.
 *
 * Null when there is no model, no provider profile, no fleet connection, or no
 * usable key. All four are the same fact to the runner — *there is nothing to
 * ask* — and ADR 0028 decision 9 makes that an answer from records rather than a
 * silence.
 *
 * ## The envelope is opened here, and MAR-745 is what happens when it is not
 *
 * `store.get` does not return a key. It returns whatever `lib/ai/actions.ts`
 * wrote under that name, and since MAR-582 that is an `AiKeyCredential`
 * **envelope** — a JSON document with the key as one of its fields, wrapped so
 * that an OAuth grant left under the same name can never be mistaken for a
 * bearer credential. `electron/broker-host.ts` opens it before building a
 * header; this function did not, and handed the whole document to the runner as
 * `api_key`. The runner then sent `Authorization: Bearer {"version":1,...}`,
 * OpenRouter answered 401, and `runner/chief-broker.ts` recorded the one word it
 * can record for a 401 — `revoked` — which told Henrik his working key had been
 * withdrawn. The window kept answering on the same vault row the whole time.
 *
 * So the parse is not defensive tidying; it is the difference between the two
 * rooms asking under the same credential and one of them blaming the user for a
 * document DASH built. And the provider is checked against the profile for
 * `lib/ai/actions.ts`' stated reason — a key filed against one provider must not
 * be presented to another — rather than coerced.
 */
async function resolveChiefModel(
  store: Pick<SecureStore, "get">,
): Promise<{ provider_id: string; model_id: string; api_key: string } | null> {
  const chosen = readEffectiveChiefModel();
  if (chosen === null) {
    return null;
  }
  const profile = aiProviderById(chosen.provider_id);
  if (profile === null) {
    return null;
  }
  const connection = readFleetConnection(profile.connection_provider);
  if (connection === null) {
    return null;
  }
  let stored: string;
  try {
    stored = await store.get(connection.secret_name);
  } catch {
    // The fleet row points at a vault entry the OS will not decrypt — MAR-676's
    // exact failure. Reported as no model rather than as a broken bridge,
    // because the repair is the same one the Settings page already offers.
    return null;
  }

  const credential = parseAiKeyCredential(stored);
  if (credential === null || credential.provider !== profile.id) {
    /*
     * Not an envelope this build can read, or one filed against a different
     * provider. The same refusal `lib/ai/actions.ts` makes on the window path
     * and deliberately so: the two rooms must agree about whether there is a
     * usable key, or a person is told "connected" in one place and "revoked" in
     * the other. A bare pre-MAR-582 value lands here too, and is refused rather
     * than sent — DASH cannot tell which provider it belongs to.
     */
    return null;
  }
  return { provider_id: profile.id, model_id: chosen.model_id, api_key: credential.key };
}

/* ---------------------------------------------------------------------- *
 * The drain
 * ---------------------------------------------------------------------- */

/**
 * Write what the runner did while DASH was closed into DASH's own tables.
 *
 * Called once at startup, after the runner is up. Turns land in
 * `chief_messages` carrying the origin the runner recorded, and decisions land
 * in `broker_audit` stamped `decided_on = 'runner'` by
 * `recordRunnerChiefCall` — which is the one function that can write that value
 * and takes no argument for it.
 *
 * Order matters and is turns-then-audit: a person reading the transcript should
 * never see a charge for a turn that is not there yet. The reverse would be a
 * moment in which the audit says money was spent on a question DASH cannot show.
 */
export function ingestChiefDrain(payload: {
  turns: readonly ChiefTurnDraft[];
  audit: readonly {
    connection_id: string;
    operation: string;
    request_id: string;
    decision: "allowed" | "refused";
    refusal: string | null;
    input_keys: string[];
    result_count: number | null;
    duration_ms: number;
    decided_at: string;
  }[];
}): { turns: number; audit: number } {
  let turns = 0;
  for (const turn of payload.turns) {
    if (recordChiefTurn(turn) !== null) {
      turns += 1;
    }
  }

  let audit = 0;
  for (const row of payload.audit) {
    /*
     * The connection and operation are checked rather than trusted, even though
     * DASH's own runner wrote them. `broker_audit` is the table a person reads to
     * find out what their key was spent on, and a row in it naming an operation
     * this bridge cannot perform would be a false record of a spend — the one
     * kind of wrong entry that is worse than a missing one.
     */
    if (row.connection_id !== CHIEF_CONNECTION_ID || !isChiefOperation(row.operation)) {
      console.warn("[dash-shell] a drained chief decision named something the chief cannot do");
      continue;
    }
    recordRunnerChiefCall({
      // `FLEET_PRINCIPAL`, the same label `lib/broker/execute.ts` writes for a
      // chief call made at the window. The two rooms' rows sit under one name
      // and are told apart by `decided_on`, which is what that column is for.
      agent: FLEET_PRINCIPAL,
      connection_id: row.connection_id,
      operation: row.operation,
      request_id: row.request_id,
      decision: row.decision,
      refusal: row.refusal as never,
      input_keys: row.input_keys,
      result_count: row.result_count,
      duration_ms: row.duration_ms,
      decided_at: row.decided_at,
    });
    audit += 1;
  }

  return { turns, audit };
}

/** Whether this is the one operation the chief's broker can have performed. */
function isChiefOperation(operation: string): boolean {
  const provider = operation.slice(0, operation.indexOf("."));
  return provider.length > 0 && operation === chiefOperationId(provider);
}
