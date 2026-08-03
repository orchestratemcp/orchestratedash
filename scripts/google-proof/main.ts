/**
 * The attended real-Google proof (MAR-468, ADR 0002 amendment 3).
 *
 * **This is not a gate and can never become one.** It is run by hand, by a person
 * who is watching, on a machine signed in to a real Google account. ADR 0004's
 * rule — a blocking release gate may depend only on this repository and this
 * machine — is why `scripts/prove-google.mjs` refuses to start it without a
 * terminal, and why nothing in `package.json` invokes it.
 *
 * ## What this proves that proof 7 cannot
 *
 * `electron/smoke.ts` proof 7 drives the entire boundary — vault, runner, spawned
 * child, grant, mint, bearer header, projection, audit, artifact — against a
 * provider the harness binds on `127.0.0.1`. Every link is real except the last
 * one. So proof 7 establishes **the boundary**, and says nothing whatever about
 * Gmail's API.
 *
 * This runs the same shape with the substitution taken back out: the provider is
 * `https://gmail.googleapis.com`, the credential comes from a human at Google's
 * own consent screen, and the draft lands in a real Drafts folder. What it
 * establishes is **that Google behaves as DASH models it** — a different claim,
 * and a narrower one than "the broker is proven". ADR 0002 amendment 3 writes
 * down which sentences each of the two makes true.
 *
 * The most load-bearing check here is the cheapest: `G0b` asserts
 * `loopbackProofOrigin()` is null. Without it every check below would pass
 * against the fake provider and the dated record would be a lie about which
 * server answered.
 *
 * ## What it does to the account, stated before the code that does it
 *
 * It **creates a real draft in a real Drafts folder**, addressed and written,
 * one human click from going out. Nothing sends it: there is no operation in
 * DASH that could, and this proof must not become the first thing that has one.
 * DASH also has no operation that deletes a draft, so the draft is **not** tidied
 * up by this file — `docs/real-google-proof-runbook.md` ends by telling the
 * person running it to delete it in Gmail themselves, and this harness prints
 * the same instruction with the draft's id.
 *
 * It ends by revoking the grant at Google and deleting DASH's copy, so the
 * machine is left holding no restricted-scope credential for a throwaway proof
 * agent. That is also check `G13`: the agent's very next request after a real
 * revocation must come back `revoked` and not as a generic failure, which is a
 * MAR-446 acceptance criterion that until now had only ever been asked of a fake
 * server returning a hand-written `invalid_grant`.
 */

// MUST BE FIRST, and in this order — the same reason `electron/smoke.ts` gives.
// `smoke-identity` supplies the app name `electron .` would have had, and
// `main.js` carries the side-effect import that points the store at the
// user-data directory derived from it. Everything below reads decisions those
// two have already made, so a harness that imported them later would be proving
// things about `.../Roaming/Electron` instead of about the product.
import "../../electron/smoke-identity.js";
import { collectSpawnCredentials } from "../../electron/main.js";

import { app, BrowserWindow } from "electron";

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

import { IPC_ORIGIN } from "../../lib/agent-dom/ipc-fetch";
import { readBrokerAudit } from "../../lib/broker/store";
import { describeGrant, resolveGrant } from "../../lib/broker/grant";
import { brokerProfileFor } from "../../lib/broker/providers";
import { performConnectionAction } from "../../lib/connection-actions";
import { connectionSecretName } from "../../lib/connection-credentials";
import type { ConnectionSourceManifest } from "../../lib/connections";
import { closeDb, dataDir } from "../../lib/db";
import { parseOAuthCredential, type OAuthCredential } from "../../lib/oauth/credential";
import { loopbackProofOrigin, oauthProviderById } from "../../lib/oauth/providers";
import {
  BUNDLED_NODE_COMMAND,
  removeRegistration,
  writeRegistration,
} from "../../lib/registration";
import { artifactsForRun, forgetAgent, importManifest, readAgentManifest } from "../../lib/store";
import { providerOperations, startAuthorization } from "../../electron/oauth-session.js";
import { runnerFetch, type RunnerHandle } from "../../electron/runner-process.js";
import { secureStore } from "../../electron/secure-store.js";
import { ensureChannelSecret } from "../../runner/channel-secret";

/* ---------------------------------------------------------------------- *
 * The record
 * ---------------------------------------------------------------------- */

const failures: string[] = [];
const lines: string[] = [];

function say(line: string): void {
  console.log(line);
  lines.push(line);
}

function check(label: string, passed: boolean, detail: unknown): void {
  if (!passed) {
    failures.push(label);
  }
  say(`${passed ? "PASS" : "FAIL"}  ${label}: ${JSON.stringify(detail)}`);
}

/**
 * A check that could not be attempted, and says so.
 *
 * MAR-473's lesson, borrowed: a downstream check whose input never arrived has
 * not failed, it has not run, and printing it as a failure buries the one line
 * that matters. A skip never fails the run on its own — whatever stopped it
 * already did.
 */
function skip(label: string, because: string): void {
  say(`SKIP  ${label}: not attempted — ${because}`);
}

/**
 * Every check from the write onwards, named once.
 *
 * A run that stops early has not failed these; it has not run them, and a reader
 * counting PASS lines needs to see the difference. Listed rather than derived
 * because the alternative is a harness that knows its own check names only after
 * it has run them, which is exactly when it cannot say what it skipped.
 */
const CHECKS_AFTER_THE_WRITE = [
  "G7b. the runner started the proof agent",
  "G8a. Gmail answered both read operations",
  "G8b. the projection over real Gmail MIME",
  "G9. Gmail accepted the composed draft",
  "G10. Google filed it against the right thread",
  "G11. both send attempts refused",
  "G12a. header injection refused",
  "G12b. the audit allowed no send",
  "G12c. the audit holds no content",
  "G13. no token observable from the agent",
  "G14. the artifact reached DASH",
  "G15a. Google accepted the revocation",
  "G15b. the next request came back revoked",
  "G16. the operator deleted the real draft",
];

async function waitForValue<T>(
  read: () => Promise<T | null>,
  what: string,
  timeoutMs: number,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== null) {
      return value;
    }
    if (Date.now() > deadline) {
      say(`[proof] gave up waiting for ${what} after ${String(timeoutMs)}ms`);
      return null;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/**
 * Wait for the person running this to type something.
 *
 * The one place a proof blocks on a human, and it is deliberate in two of the
 * three uses: before the write, because a real draft in a real mailbox deserves
 * a sentence and a keystroke rather than a scrolled-past log line; and at the
 * end, because deleting the draft is a step only a person can perform.
 */
function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/* ---------------------------------------------------------------------- *
 * Constants
 * ---------------------------------------------------------------------- */

const AGENT_ID = "dash-google-proof";
/** The connection id inside the shipped meeting-assistant manifest. */
const CONNECTION_ID = "gmail";
const FIELD_ID = "gmail-account";

/**
 * The subject the runbook asks the person to send themselves first.
 *
 * A planted message rather than `is:unread`, for two reasons that both matter.
 * The proof becomes deterministic — an empty inbox is a failure of the setup and
 * not of the broker — and the message the agent reads and replies to is one the
 * operator wrote to themselves, so no third party's mail is read into a proof
 * log.
 */
const PROOF_SUBJECT = "DASH real-Google proof";
const SEARCH_QUERY = `subject:"${PROOF_SUBJECT}"`;

/**
 * The variable the manifest asks DASH to deliver the credential in.
 *
 * Added to the shipped example on purpose, and it is the single line MAR-458's
 * defect required: `deliverableSecretFields` only ever returned a target whose
 * manifest declared `technical.environment_name`, and no shipped example
 * declares one. Adding it here is what makes check `G8` a real negative rather
 * than a check that nothing asked for anything.
 */
const ENVIRONMENT_NAME = "GMAIL_OAUTH_TOKEN";

/* ---------------------------------------------------------------------- *
 * The proof
 * ---------------------------------------------------------------------- */

async function run(): Promise<void> {
  await app.whenReady();
  // A window, only to establish that the shell really came up. Nothing below
  // renders anything: this proof is about the broker, and proof 1 owns the UI.
  await new Promise<void>((resolve) => {
    const attach = (): void => {
      if (BrowserWindow.getAllWindows().length > 0) {
        resolve();
        return;
      }
      setTimeout(attach, 200);
    };
    attach();
  });

  const startedAt = new Date();
  say("");
  say(`[proof] MAR-468 attended real-Google proof`);
  say(`[proof] date: ${startedAt.toISOString()}`);
  say(`[proof] store: ${dataDir}`);
  say(`[proof] userData: ${app.getPath("userData")}`);
  say("");

  /* -- G0: this run is against Google, and against the installed store ---- */

  check(
    "G0a. the store is the one `electron .` uses",
    dataDir === app.getPath("userData") && path.basename(dataDir) === "orchestratedash",
    dataDir,
  );

  /*
   * The check the whole record rests on.
   *
   * `lib/oauth/providers.ts`'s `loopbackProofOrigin()` is the guard that lets
   * proof 7 point DASH at a provider on `127.0.0.1`. If it were live here, every
   * check below would pass against that fake and this file's dated output would
   * be a claim about Google that Google never answered. So it is asserted null,
   * first, before anything is connected — and the Gmail profile is read back to
   * show which origin the operations will actually be built against.
   */
  const profile = brokerProfileFor("google-gmail");
  check(
    "G0b. no loopback provider is in force, and Gmail's real origin is",
    loopbackProofOrigin() === null &&
      process.env["DASH_BROKER_PROOF_ORIGIN"] === undefined &&
      profile?.api_origin === "https://gmail.googleapis.com",
    {
      loopback_proof_origin: loopbackProofOrigin(),
      gmail_api_origin: profile?.api_origin ?? null,
      client_owner: profile?.client_owner ?? null,
      token_custodian: profile?.token_custodian ?? null,
    },
  );

  if (failures.length > 0) {
    say("");
    say("[proof] refusing to continue: this run would not have been against Google.");
    return;
  }

  const workDir = mkdtempSync(path.join(tmpdir(), "dash-google-proof-"));
  const reportPath = path.join(workDir, "proof-report.json");
  const watchPath = path.join(workDir, "revoke-watch.json");
  const RUN_ID = `google-proof-${String(Date.now())}`;
  const REQUEST_PREFIX = `gproof-${String(Date.now())}`;
  const secretName = connectionSecretName(AGENT_ID, CONNECTION_ID, FIELD_ID);

  /*
   * Declared out here rather than inside the `try`, and the reason is the one
   * failure mode this harness must not have.
   *
   * A run that dies after `G2` has obtained a real, live, restricted-scope
   * Google grant. If revocation only happened on the success path, the `finally`
   * would delete DASH's copy and leave that grant alive at Google for the rest
   * of its seven days, owned by a throwaway proof agent and invisible from
   * DASH — the exact orphan `lib/connection-actions.ts` refuses to create when a
   * disconnect half-fails. So the credential is reachable from the cleanup, and
   * the cleanup withdraws it however the run ended.
   */
  let credential: OAuthCredential | null = null;
  let draftId: string | null = null;
  let revokedAtGoogle = false;

  try {
    /* -- G1: the shipped manifest, imported as a proof agent -------------- */

    /*
     * `examples/gmail-meeting-assistant.manifest.v2.example.json` as DASH ships
     * it, with two edits and no others: the agent's name, so this run cannot
     * collide with anything real, and `technical.environment_name` on the Gmail
     * field. Using the shipped document rather than a fixture is the point — the
     * grant below is resolved from a manifest a user could actually import.
     */
    const manifest = JSON.parse(
      readFileSync(
        path.join(process.cwd(), "examples", "gmail-meeting-assistant.manifest.v2.example.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    (manifest["agent"] as Record<string, unknown>)["name"] = AGENT_ID;

    const connections = (manifest["agent_dom"] as { connections?: Array<Record<string, unknown>> })
      .connections;
    const gmail = connections?.find((connection) => connection["id"] === CONNECTION_ID);
    const gmailField = (gmail?.["fields"] as Array<Record<string, unknown>> | undefined)?.find(
      (field) => field["id"] === FIELD_ID,
    );
    const technical = gmailField?.["technical"] as Record<string, unknown> | undefined;
    if (technical !== undefined) {
      technical["environment_name"] = ENVIRONMENT_NAME;
    }
    const declaredScopes = (technical?.["provider_scopes"] as string[] | undefined) ?? [];

    const imported = importManifest(manifest);
    check(
      "G1. the shipped meeting-assistant manifest imports, declaring both Gmail scopes",
      imported.ok && declaredScopes.length === 2,
      imported.ok ? { scopes: declaredScopes.length } : imported,
    );

    /* -- G2: a real Connect, through the real Connection Center action ---- */

    say("");
    say("[proof] Google's consent screen is about to open in your system browser.");
    say("[proof] Sign in as the account you added as a TEST USER on DASH's Cloud");
    say("[proof] project, and grant BOTH permissions. Testing-mode grants for");
    say("[proof] restricted scopes expire seven days from today.");
    say("");

    const connected = await performConnectionAction(
      "connect",
      { agent_id: AGENT_ID, connection_id: CONNECTION_ID, field_id: FIELD_ID },
      {
        store: secureStore(),
        readManifest: (agentId) => readAgentManifest(agentId) as ConnectionSourceManifest | null,
        // Never reached: this target is an OAuth field, and an OAuth field is
        // never a typed secret. Present because the interface requires it, and
        // it throws rather than returning null so a wiring mistake that routed
        // an OAuth connect through the text-box path would be loud.
        promptForSecret: () => {
          throw new Error("the Gmail field is an OAuth target and must not be prompted for");
        },
        oauth: {
          ...providerOperations(),
          /*
           * The one substitution on the connect path, and it is a renderer
           * surface rather than a boundary.
           *
           * The product calls `electron/credential-prompt.ts`'s
           * `promptForAuthorization`, which shows DASH's own summary of what is
           * about to be granted and then calls exactly the function below. What
           * is skipped is that summary window; what is not skipped is any part
           * of the flow that touches Google — the PKCE pair, the loopback
           * listener, the authorization URL, the system browser, the code
           * exchange, and the envelope that reaches the vault are all the
           * product's.
           */
          authorize: async (target) => {
            const provider = oauthProviderById(target.oauth?.provider_id ?? "");
            if (provider === null) {
              return { ok: false, code: "provider_error" };
            }
            return startAuthorization(provider, target.oauth?.scopes ?? [], null).outcome;
          },
        },
      },
    );

    check(
      "G2. a real Google sign-in completed and DASH stored it in this machine's vault",
      connected.ok && connected.state === "connected",
      { ok: connected.ok, state: connected.state, masked_hint: connected.masked_hint },
    );

    const storedRaw = await secureStore()
      .get(secretName)
      .catch(() => null);
    credential = storedRaw === null ? null : parseOAuthCredential(storedRaw);

    check(
      "G3. Google returned a refresh token and named the account, in DASH's own envelope",
      credential !== null &&
        credential.provider === "google" &&
        credential.refresh_token.length > 0 &&
        credential.account !== null,
      credential === null
        ? "nothing readable in the vault"
        : {
            provider: credential.provider,
            // The account, not the token. `accountFromIdToken` has never been
            // fed a real Google id token before this run; that it produced an
            // address is the check, and the address is the operator's own.
            account_present: credential.account !== null,
            scope_count: credential.scopes.length,
            obtained_at: credential.obtained_at,
          },
    );

    /* -- G4: the grant, intersected against a real consent ---------------- */

    const storedManifest = readAgentManifest(AGENT_ID) as ConnectionSourceManifest | null;
    const resolved =
      storedManifest === null
        ? null
        : resolveGrant(AGENT_ID, storedManifest, CONNECTION_ID, credential, secretName);

    const grantedIds =
      resolved !== null && resolved.ok ? resolved.grant.operations.map((entry) => entry.id) : [];

    check(
      "G4. the three-party intersection over a real credential grants exactly the three operations",
      resolved !== null &&
        resolved.ok &&
        grantedIds.length === 3 &&
        grantedIds[0] === "gmail.draft.create" &&
        grantedIds.includes("gmail.search") &&
        grantedIds.includes("gmail.message.read") &&
        resolved.grant.missing_scopes.length === 0,
      {
        operations: grantedIds,
        missing_scopes: resolved !== null && resolved.ok ? resolved.grant.missing_scopes : null,
        unused_scopes: resolved !== null && resolved.ok ? resolved.grant.unused_scopes : null,
      },
    );

    /*
     * The disclosure MAR-469 made structural, read off a card built from a real
     * Google grant rather than from a fixture.
     *
     * `gmail.compose` is now a *used* scope, so the "you granted something DASH
     * offers no action for" sentence correctly does not carry it. The sentence
     * that has to is `wider_permission_sentence`, and a card that lost it here
     * would be a card telling a user their permission is narrower than what
     * Google actually issued them minutes earlier.
     */
    const card =
      resolved !== null && resolved.ok ? describeGrant(resolved.grant, "Google proof agent") : null;
    check(
      "G5. the capability card admits the granted permission is wider than the action",
      card !== null &&
        card.wider_permission_sentence !== null &&
        card.wider_permission_sentence.includes("no drafts-only permission") &&
        card.capabilities[0]?.consequence !== null,
      card === null
        ? null
        : {
            wider_permission_sentence: card.wider_permission_sentence,
            first_capability: card.capabilities[0]?.label ?? null,
            client_sentence: card.client_sentence,
          },
    );

    /* -- The agent -------------------------------------------------------- */

    /*
     * The same shape proof 7 writes, pointed at a real mailbox.
     *
     * Written here rather than shipped, for proof 7's reason: an agent whose
     * purpose is to dump its own environment is a proof fixture, not a sample.
     * The sequence order is proof 7's too, and the ordering is load-bearing —
     * the send attempt comes *before* the draft so that a run in which the whole
     * connection was broken cannot make `G9` pass for the wrong reason.
     */
    const agentScript = `
      import { writeFileSync } from "node:fs";
      const reportPath = ${JSON.stringify(reportPath)};
      const watchPath = ${JSON.stringify(watchPath)};
      const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
      const pending = new Map();
      let seq = 0;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      function askBroker(operation, input) {
        const id = ${JSON.stringify(REQUEST_PREFIX)} + "-" + (seq += 1);
        return new Promise((resolve) => {
          const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, refusal: "broker_unavailable" }); }, 40000);
          pending.set(id, (r) => { clearTimeout(timer); resolve(r); });
          send({ type: "broker_request", request: { request_id: id, connection_id: ${JSON.stringify(CONNECTION_ID)}, operation, input } });
        });
      }

      let buffer = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => {
        buffer += chunk;
        let nl = buffer.indexOf("\\n");
        while (nl !== -1) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          nl = buffer.indexOf("\\n");
          let m; try { m = JSON.parse(line); } catch { continue; }
          if (m && m.type === "broker_response") {
            const settle = pending.get(m.request_id);
            if (settle) { pending.delete(m.request_id); settle(m); }
          }
        }
      });

      send({ type: "state", state: { status: "running", runs: [], tasks: [] } });

      // Written after every step rather than once at the end, so a step that
      // hangs names itself instead of costing another attended cycle. An
      // attended cycle here costs a consent screen.
      const trace = [];
      let report = {};
      function record(patch) {
        report = { ...report, ...patch, trace };
        writeFileSync(reportPath, JSON.stringify(report), "utf8");
      }
      const note = (line) => { trace.push(line); process.stdout.write("[agent] " + line + "\\n"); };

      (async () => {
        const runId = ${JSON.stringify(RUN_ID)};
        note("asking for search");
        const found = await askBroker("gmail.search", { query: ${JSON.stringify(SEARCH_QUERY)}, max_results: 5 });
        note("search ok=" + String(found.ok) + " refusal=" + String(found.refusal));
        record({ search: found, found_count: found.ok ? (found.result.messages || []).length : 0 });

        const first = found.ok ? (found.result.messages || [])[0] : null;
        const read = first
          ? await askBroker("gmail.message.read", { message_id: first.message_id })
          : { ok: false, refusal: "no_message" };
        note("read ok=" + String(read.ok) + " refusal=" + String(read.refusal));
        record({ read });

        // Deliberately asked for and deliberately expected to fail, against a
        // credential that really does carry the scope Google would honour it
        // with. That is the whole difference between this and a unit test.
        const send_attempt = await askBroker("gmail.send", { to: "nobody@example.com", subject: "s", body: "b" });
        note("send ok=" + String(send_attempt.ok) + " refusal=" + String(send_attempt.refusal));
        record({ send_attempt });

        // The write. A real draft, in a real Drafts folder.
        const replyTo = read.ok && read.result.from ? read.result.from : null;
        const drafted = replyTo === null
          ? { ok: false, refusal: "no_recipient" }
          : await askBroker("gmail.draft.create", {
              to: replyTo,
              subject: read.ok ? "Re: " + read.result.subject : "Re:",
              body_text: "This draft was created by the DASH MAR-468 attended proof. Delete it.",
              thread_id: read.ok ? read.result.thread_id : undefined
            });
        note("draft ok=" + String(drafted.ok) + " refusal=" + String(drafted.refusal));
        record({ drafted });

        // The send that goes through the drafts endpoint rather than the
        // messages one. A guard written against the word "send" rather than
        // against the operation set would let this through.
        const draft_send_attempt = await askBroker("gmail.drafts.send", { draft_id: drafted.ok ? drafted.result.draft_id : "x" });
        note("drafts.send ok=" + String(draft_send_attempt.ok) + " refusal=" + String(draft_send_attempt.refusal));
        record({ draft_send_attempt });

        // A recipient carrying CRLF: the header injection that would put a Bcc
        // on a message DASH composed and Google would then store.
        const injected = await askBroker("gmail.draft.create", {
          to: (replyTo || "someone@example.com") + "\\r\\nBcc: attacker@evil.example",
          subject: "Re: injected",
          body_text: "hello"
        });
        note("injection ok=" + String(injected.ok) + " refusal=" + String(injected.refusal));
        record({ injected });

        const environment = Object.entries(process.env).map(([k, v]) => k + "=" + String(v)).join("\\n");

        send({
          type: "artifact",
          artifact: {
            artifact_version: 1,
            agent: ${JSON.stringify(AGENT_ID)},
            run_id: runId,
            artifact_id: "draft-" + runId,
            kind: "draft",
            title: "Reply to " + (read.ok ? read.result.subject : "nothing"),
            generated_at: new Date().toISOString(),
            draft: {
              to: replyTo ? [replyTo] : [],
              subject: read.ok ? "Re: " + read.result.subject : "Re:",
              body: "This draft was created by the DASH MAR-468 attended proof. Delete it.",
              placement: drafted.ok
                ? { where: "provider_draft", service: "Gmail", draft_id: drafted.result.draft_id }
                : { where: "dash_only" },
              in_reply_to: read.ok ? { message_id: read.result.message_id, thread_id: read.result.thread_id } : undefined,
              sources: read.ok ? [{ message_id: read.result.message_id, subject: read.result.subject, from: read.result.from }] : []
            }
          }
        });

        record({
          send_refusal: send_attempt.ok === false ? send_attempt.refusal : "ALLOWED",
          draft_send_refusal: draft_send_attempt.ok === false ? draft_send_attempt.refusal : "ALLOWED",
          injection_refusal: injected.ok === false ? injected.refusal : "ALLOWED",
          draft_id: drafted.ok ? drafted.result.draft_id : null,
          message_id: drafted.ok ? drafted.result.message_id : null,
          draft_thread_id: drafted.ok ? drafted.result.thread_id : null,
          read_thread_id: read.ok ? read.result.thread_id : null,
          read_subject: read.ok ? read.result.subject : null,
          environment,
          complete: true
        });

        // The revocation watch. The harness is about to withdraw this grant at
        // Google; the same request that is being answered now must come back
        // refused, and refused as "revoked" rather than as a generic failure.
        // Five seconds apart, twelve times, which stays inside the broker's own
        // twenty-per-minute budget.
        const polls = [];
        let sawRevoked = false;
        for (let i = 0; i < 12 && !sawRevoked; i += 1) {
          await sleep(5000);
          const again = await askBroker("gmail.search", { query: ${JSON.stringify(SEARCH_QUERY)}, max_results: 1 });
          const outcome = again.ok ? "ALLOWED" : String(again.refusal);
          polls.push(outcome);
          if (outcome === "revoked") { sawRevoked = true; }
          note("poll " + String(i + 1) + " = " + outcome);
          writeFileSync(watchPath, JSON.stringify({ polls, saw_revoked: sawRevoked, finished: sawRevoked }), "utf8");
        }
        writeFileSync(watchPath, JSON.stringify({ polls, saw_revoked: sawRevoked, finished: true }), "utf8");
      })().catch((e) => process.stdout.write("[agent] " + String(e) + "\\n"));

      setInterval(() => {}, 1000);
    `;
    const scriptPath = path.join(workDir, "agent.mjs");
    writeFileSync(scriptPath, agentScript, "utf8");

    /*
     * Does the program this harness just wrote actually parse?
     *
     * Proof 7 learned this the expensive way: a single-escaped `\n` inside the
     * template literal became a real newline, ended a string in the generated
     * file, and every downstream check failed with "no report" — which reads
     * exactly like a broker that does not answer. Here a cycle costs a consent
     * screen, so the question is answered first, in about fifty milliseconds.
     */
    const parsed = spawnSync(process.execPath, ["--check", scriptPath], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      encoding: "utf8",
    });
    check(
      "G6. the proof agent this harness wrote is valid JavaScript",
      parsed.status === 0,
      parsed.status === 0 ? "parses" : (parsed.stderr ?? "").split("\n").slice(0, 4).join(" "),
    );

    /* -- Starting it ------------------------------------------------------ */

    const endpointFile = path.join(dataDir, "runner.json");
    const recorded = existsSync(endpointFile)
      ? (JSON.parse(readFileSync(endpointFile, "utf8")) as {
          pid: number;
          endpoint: string;
          transport: string;
        })
      : null;
    if (recorded === null) {
      check("G7a. the runner wrote an endpoint file", false, "no runner.json — the shell did not start one");
      for (const label of CHECKS_AFTER_THE_WRITE) {
        skip(label, "the runner never wrote an endpoint file");
      }
      return;
    }
    check("G7a. the runner wrote an endpoint file", true, {
      transport: recorded.transport,
      pid: recorded.pid,
    });

    const handle: RunnerHandle = {
      origin: IPC_ORIGIN,
      endpoint: recorded.endpoint,
      transport: recorded.transport as RunnerHandle["transport"],
      pid: recorded.pid,
      token: ensureChannelSecret(dataDir),
      adopted: true,
      started_at: null,
    };
    const call = runnerFetch(handle);

    writeRegistration(dataDir, {
      registration: {
        agent_id: AGENT_ID,
        manifest_path: "",
        // The sentinel, not `process.execPath`. `resolveSpawnCommand` turns it
        // into DASH's own binary plus `ELECTRON_RUN_AS_NODE=1`; naming the path
        // directly starts the child as a full Electron app whose stdin is not a
        // node stream, so every brokered request would time out. Proof 7 paid
        // several cycles for this line.
        command: BUNDLED_NODE_COMMAND,
        args: [scriptPath],
        cwd: workDir,
      },
      manifestJson: JSON.stringify(manifest),
      ownership: {
        owner: "dash_handoff",
        handoff_id: "google-proof",
        source_project: workDir,
        display_name: "Google proof agent",
        summary: "Reads a planted message through the broker and drafts a reply at Google.",
        registered_at: new Date().toISOString(),
      },
    });

    await call(`${handle.origin}/registrations/reload`, {
      method: "POST",
      headers: { authorization: `Bearer ${handle.token}` },
      signal: AbortSignal.timeout(5_000),
    });

    say("");
    say("[proof] ⚠  The next step creates a REAL DRAFT in the REAL Drafts folder of");
    say(`[proof] ⚠  the account you just connected. It is addressed and written, and`);
    say("[proof] ⚠  one human click from going out. Nothing here sends it: DASH has no");
    say("[proof] ⚠  operation that could. DASH also has no operation that DELETES a");
    say("[proof] ⚠  draft, so you will be asked to delete it in Gmail yourself.");
    say("");
    const consent = await ask("[proof] Type 'draft' to continue, or anything else to stop: ");
    if (consent !== "draft") {
      say("[proof] stopped before the write, at the operator's request.");
      for (const label of CHECKS_AFTER_THE_WRITE) {
        skip(label, "the operator stopped the run before the write");
      }
      // A failure rather than a clean exit, and deliberately: a run that stopped
      // is not a run that passed, and the difference must survive somebody
      // pasting the last line of the log into an issue.
      failures.push("operator stopped before the write");
      return;
    }

    const started = await call(`${handle.origin}/agents/${encodeURIComponent(AGENT_ID)}/lifecycle`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${handle.token}` },
      body: JSON.stringify({ action: "start", credentials: await collectSpawnCredentials(AGENT_ID) }),
      signal: AbortSignal.timeout(10_000),
    });
    const startBody = (await started.json()) as { ok?: boolean; detail?: string };
    check("G7b. the runner started the proof agent", startBody.ok === true, startBody);

    /* -- The round trip against Gmail ------------------------------------- */

    interface Report {
      search?: { ok?: boolean; refusal?: string };
      read?: { ok?: boolean; refusal?: string; result?: Record<string, unknown> };
      drafted?: { ok?: boolean; refusal?: string };
      found_count?: number;
      send_refusal?: string;
      draft_send_refusal?: string;
      injection_refusal?: string;
      draft_id?: string | null;
      message_id?: string | null;
      draft_thread_id?: string | null;
      read_thread_id?: string | null;
      read_subject?: string | null;
      environment?: string;
      trace?: string[];
      complete?: boolean;
    }

    const readReport = (): Report | null => {
      try {
        return existsSync(reportPath) ? (JSON.parse(readFileSync(reportPath, "utf8")) as Report) : null;
      } catch {
        return null;
      }
    };

    const reported = await waitForValue(
      async () => {
        const value = readReport();
        return value?.complete === true ? value : null;
      },
      "the agent's own report of what Gmail answered",
      120_000,
    );
    const partial = readReport();
    // Held where the cleanup can print it, so a run that dies after the write
    // still tells the operator what is sitting in their mailbox.
    draftId = reported?.draft_id ?? partial?.draft_id ?? null;

    check(
      "G8a. Gmail answered both read operations through the broker",
      reported?.search?.ok === true && reported.read?.ok === true,
      {
        search: reported?.search?.ok === true ? "ok" : (reported?.search?.refusal ?? "no report"),
        messages_found: reported?.found_count ?? partial?.found_count ?? null,
        read: reported?.read?.ok === true ? "ok" : (reported?.read?.refusal ?? "no report"),
        trace: partial?.trace ?? "none",
      },
    );

    /*
     * The check most likely to have failed, and the reason this proof is worth
     * running at all.
     *
     * The loopback provider serves a single-part `text/plain` payload with two
     * headers. Real Gmail serves a MIME tree — commonly `multipart/alternative`
     * with the plain part nested a level or two down — and headers in whatever
     * case it feels like. `plainTextBody` walks that tree and `header` matches
     * case-insensitively, and until this run neither had ever been given a
     * document Google wrote.
     */
    const readResult = (reported?.read?.result ?? {}) as Record<string, unknown>;
    check(
      "G8b. DASH's projection found a subject, a sender and a plain-text body in real Gmail MIME",
      typeof readResult["subject"] === "string" &&
        (readResult["subject"] as string).includes(PROOF_SUBJECT) &&
        typeof readResult["from"] === "string" &&
        typeof readResult["body_text"] === "string" &&
        (readResult["body_text"] as string).length > 0,
      {
        // The names of what came back and the length of the body, never the
        // body. This log is pasted into a Linear comment.
        projected_fields: Object.keys(readResult).sort(),
        subject_matches: typeof readResult["subject"] === "string" ? (readResult["subject"] as string).includes(PROOF_SUBJECT) : false,
        body_chars: typeof readResult["body_text"] === "string" ? (readResult["body_text"] as string).length : 0,
      },
    );

    check(
      "G9. Gmail accepted the draft DASH composed and returned a draft id",
      reported?.drafted?.ok === true &&
        typeof reported.draft_id === "string" &&
        (reported.draft_id ?? "").length > 0,
      { refusal: reported?.drafted?.refusal ?? "none", draft_id: reported?.draft_id ?? null },
    );

    /*
     * `thread_id` is the only agent-supplied value that reaches Google outside
     * the message DASH wrote, and the loopback provider never had an opinion
     * about it. Google resolving it means the draft is filed against the
     * conversation it replies to, in the authenticated account.
     */
    check(
      "G10. Google filed the draft against the thread the reply was to",
      reported?.draft_thread_id !== null &&
        reported?.draft_thread_id === reported?.read_thread_id,
      { draft_thread: reported?.draft_thread_id ?? null, read_thread: reported?.read_thread_id ?? null },
    );

    check(
      "G11. both send attempts were refused as operations that do not exist, against a credential carrying gmail.compose",
      reported?.send_refusal === "unknown_operation" &&
        reported.draft_send_refusal === "unknown_operation",
      {
        send_refusal: reported?.send_refusal ?? null,
        draft_send_refusal: reported?.draft_send_refusal ?? null,
        credential_carries_compose:
          credential?.scopes.includes("https://www.googleapis.com/auth/gmail.compose") ?? false,
      },
    );

    check(
      "G12a. a recipient carrying a header injection was refused before any request reached Google",
      reported?.injection_refusal === "invalid_input",
      { injection_refusal: reported?.injection_refusal ?? null },
    );

    /*
     * The negative proof 7n makes, made differently — and it is weaker in one
     * stated way.
     *
     * Proof 7's harness *serves* Gmail's two send endpoints and answers them
     * with success, so "DASH never called a send endpoint" is a statement about
     * DASH rather than about the provider's willingness. Here the provider is
     * Google and cannot be made willing, so the evidence is DASH's own record of
     * every request it decided about: the audit holds one row per brokered call
     * on every path including refusals, and no row in this run names an
     * operation that sends because no such operation exists to name. What proof
     * 7 adds and this cannot is the assurance that a bug producing a send
     * *request* would have been caught rather than silently refused upstream.
     * The two are complementary and neither replaces the other.
     */
    const audit = readBrokerAudit(AGENT_ID, 500);
    const operations = [...new Set(audit.map((row) => row.operation))].sort();
    check(
      "G12b. every brokered call this run is audited, allowed and refused alike, and none of them sends",
      audit.length >= 6 &&
        // The send attempts ARE in this audit, by name, as refusals — that is
        // the record working rather than a leak. What must never appear is an
        // *allowed* row for one.
        audit.some((row) => row.operation.endsWith(".send") && row.decision === "refused") &&
        !audit.some((row) => row.operation.endsWith(".send") && row.decision === "allowed") &&
        audit.some((row) => row.operation === "gmail.draft.create" && row.decision === "allowed"),
      {
        rows: audit.length,
        operations,
        allowed_sends: audit.filter((row) => row.operation.endsWith(".send") && row.decision === "allowed").length,
      },
    );

    check(
      "G12c. the audit holds no token, no query text and no message content",
      audit.every(
        (row) =>
          !JSON.stringify(row).includes(PROOF_SUBJECT) &&
          !JSON.stringify(row).includes(credential?.refresh_token ?? " never"),
      ),
      { rows: audit.length, input_key_names: [...new Set(audit.flatMap((row) => row.input_keys))].sort() },
    );

    /*
     * MAR-458's own reason for existing, asked of a process that really was
     * holding a real Google grant on the other side of the pipe.
     *
     * The agent dumped every variable it has, names and values.
     * `GMAIL_OAUTH_TOKEN` — the variable this manifest explicitly asked DASH to
     * deliver the credential in — must be absent entirely rather than empty, and
     * the refresh token must not appear under any name at all.
     */
    const environment = reported?.environment ?? "";
    check(
      "G13. no Google token is observable from the agent process or its environment",
      reported !== null &&
        credential !== null &&
        !environment.includes(credential.refresh_token) &&
        !environment.includes(ENVIRONMENT_NAME),
      {
        reported: reported !== null,
        environment_variables: environment.split("\n").filter((line) => line.length > 0).length,
        names: environment
          .split("\n")
          .map((line) => line.split("=")[0])
          .filter((name) => name !== undefined && name.length > 0),
      },
    );

    const artifact = await waitForValue(
      async () => {
        const found = artifactsForRun(AGENT_ID, RUN_ID).find((entry) => entry.kind === "draft");
        return found === undefined ? null : found;
      },
      "the draft artifact to reach DASH",
      30_000,
    );
    check(
      "G14. the artifact reached DASH and says the reply is at the provider",
      artifact !== null &&
        artifact.kind === "draft" &&
        artifact.draft.placement.where === "provider_draft",
      artifact === null ? null : { title: artifact.title, placement: artifact.draft.placement },
    );

    /* -- G15: revocation, which is also the cleanup ------------------------ */

    say("");
    say("[proof] Withdrawing the grant at Google. The agent is still running and is");
    say("[proof] asking for the same search every five seconds; its next request after");
    say("[proof] this must come back refused as 'revoked'.");

    revokedAtGoogle =
      credential === null ? false : await providerOperations().revoke(credential);
    check("G15a. Google accepted the revocation", revokedAtGoogle, { revoked: revokedAtGoogle });

    const watched = await waitForValue(
      async () => {
        try {
          if (!existsSync(watchPath)) {
            return null;
          }
          const value = JSON.parse(readFileSync(watchPath, "utf8")) as {
            polls?: string[];
            saw_revoked?: boolean;
            finished?: boolean;
          };
          return value.finished === true ? value : null;
        } catch {
          return null;
        }
      },
      "the agent's next request after the revocation",
      100_000,
    );

    /*
     * MAR-446's acceptance criterion, against Google rather than against a test
     * server returning a hand-written `invalid_grant`.
     *
     * `lib/oauth/flow.ts` classifies exactly that body as `revoked` and every
     * surface downstream turns it into "your access was taken away, and trying
     * again will not help" rather than "something went wrong". Until this run
     * nothing had ever seen Google produce it.
     */
    check(
      "G15b. the agent's next request after a real revocation was refused as revoked, not as a generic failure",
      watched?.saw_revoked === true && (watched.polls ?? []).includes("ALLOWED"),
      {
        polls: watched?.polls ?? null,
        // An "ALLOWED" before the "revoked" is what makes this a transition
        // rather than a connection that never worked.
        allowed_before_revoked: (watched?.polls ?? []).includes("ALLOWED"),
      },
    );

    /* -- What only a person can do ---------------------------------------- */

    say("");
    say("========================================================================");
    say(`[proof] A REAL DRAFT EXISTS IN YOUR GMAIL DRAFTS FOLDER.`);
    say(`[proof]   draft id: ${String(reported?.draft_id ?? "unknown")}`);
    say(`[proof]   subject:  Re: ${String(reported?.read_subject ?? PROOF_SUBJECT)}`);
    say("[proof]");
    say("[proof] DASH has no operation that deletes a draft, and this proof must not");
    say("[proof] be the reason one gets built. Open Gmail, confirm the draft reads as");
    say("[proof] DASH composed it — your own address in From, one recipient, no Bcc —");
    say("[proof] and then DELETE it. Do not send it.");
    say("========================================================================");
    say("");
    const deleted = await ask("[proof] Type 'deleted' once you have deleted it in Gmail: ");
    check(
      "G16. the operator confirmed the real draft was inspected and deleted",
      deleted === "deleted",
      { answered: deleted },
    );
  } finally {
    /* -- Leaving the machine, and the Google account, as they were found ---- */

    /*
     * Withdraw first, delete second, and in that order for the reason
     * `lib/connection-actions.ts` gives about a half-failed disconnect: DASH's
     * copy is the only handle on the grant, so deleting it before withdrawing
     * would turn a revocation failure into a live restricted-scope grant nobody
     * can find. Best-effort and never fatal — an offline machine must not turn a
     * finished proof into a crash — but it is reported, because a grant this
     * harness could not withdraw is one the operator has to withdraw by hand.
     */
    if (credential !== null && !revokedAtGoogle) {
      const late = await providerOperations()
        .revoke(credential)
        .catch(() => false);
      say(
        late
          ? "[proof] cleanup: the grant was withdrawn at Google."
          : "[proof] cleanup: COULD NOT withdraw the grant at Google. Remove DASH's access " +
              "yourself under your Google account's third-party connections — otherwise it " +
              "stays live for the rest of its seven days.",
      );
    }

    await secureStore()
      .delete(secretName)
      .catch(() => undefined);
    removeRegistration(dataDir, AGENT_ID);
    forgetAgent(AGENT_ID);
    rmSync(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

    // Printed on every path, including the ones that died before `G16` could
    // ask. A draft this harness created and then failed to mention is the one
    // piece of litter it must never leave in somebody's mailbox.
    if (draftId !== null) {
      say(`[proof] cleanup: a real draft (id ${draftId}) exists in Gmail. DELETE IT. Do not send it.`);
    }

    say("");
    say(`[proof] finished ${new Date().toISOString()}`);
    say(
      `[proof] ${failures.length === 0 ? "all checks passed" : `FAILED: ${failures.join(", ")}`}`,
    );
    say("");
    say("[proof] Paste everything above into the Linear issue and the state packet,");
    say("[proof] WITH the date. Testing-mode grants for restricted scopes expire seven");
    say("[proof] days after they were issued, so this evidence has a stated shelf life.");
  }
}

function exitAfterClosing(code: number): void {
  try {
    closeDb();
  } catch (error: unknown) {
    console.error(`[proof] closing the store failed: ${String(error)}`);
  }
  app.exit(code);
}

void run().then(
  () => exitAfterClosing(failures.length === 0 ? 0 : 1),
  (error: unknown) => {
    console.error(`[proof] ${error instanceof Error ? error.stack : String(error)}`);
    exitAfterClosing(1);
  },
);
