/**
 * Putting one key the user owns on one server the user enrolled (MAR-794,
 * ADR 0018).
 *
 * ADR 0018 designed this in full in August and wrote *"No implementation of
 * `install-key`, remove-key, consent UI or receipt storage"* under its own
 * non-goals, because *"the first code line is a security-boundary widening"*.
 * This is that first code line, and it is a file of its own rather than a branch
 * in `electron/main.ts` for `electron/host-run.ts`'s reason: every gate belongs
 * beside the call it guards, where no future caller can route around it.
 *
 * ## The shape of one press
 *
 * ```
 *   pack verb     ─ can this server run a host broker at all?
 *   the vault     ─ read the value, on the trusted side, once
 *   install-key   ─ the value on stdin; the helper proves the owner-only write
 *   the store     ─ write the receipt, after the proof and never before it
 * ```
 *
 * The `pack` question comes **first**, and ADR 0021 section 4 says why:
 * *"Discovering that a host is too old only at the moment a key would leave is
 * too late for the surface that should have said so on the server row."* The
 * vault is not opened for a server that cannot use what is in it.
 *
 * ## What this file promises about the value
 *
 * > **DASH reads the key, hands it to `ssh` on stdin, and drops it.**
 *
 * The renderer never receives it: `installKeyOnHost` in the preload takes four
 * names and `HostActionResult` has no member it could travel back in. It is not
 * put on argv — `sshArgv` composes fixed options and a verb, and everything
 * variable rides the stdin envelope, which is `lib/deploy/verbs.ts`'s opening
 * rule and matters more here than anywhere else. It is not logged, not put in a
 * refusal, not hashed, not measured, and not written to DASH's store. The one
 * expression that holds it is the request object handed to `runDeployVerb`.
 *
 * `tests/install-key.test.ts` asserts that over the **captured command line**
 * and the whole error path rather than by reading this paragraph, which is what
 * ADR 0018's proof list asks for: *"key bytes and stable derivatives appear in
 * no argv, answer, log, error, audit target, receipt or renderer payload."*
 *
 * ## What it promises about honesty
 *
 * ADR 0018's third admission answer is *"yes, but only as custody"*, and the
 * receipt is load-bearing because no audit code can recover the visibility later.
 * So the store row is written **after the helper proved the write and never on
 * an attempt** (`recordKeyPlacement`'s own rule), and the sentence that comes
 * back names the placement rather than claiming anything about what the agent
 * can now do. Whether the deployed copy can actually reach a model is a fact
 * about the host broker on that machine, and the only thing that can establish
 * it is the attended run.
 */

import { parseAiKeyCredential } from "../lib/ai/credential";
import { readHostPack } from "../lib/deploy/host-pack";
import { checkKeySlot, describeKeySlotRefusal } from "../lib/deploy/key-placement";
import { RESERVED_HOST_BUNDLE_ID } from "../lib/deploy/verbs";
import { connectionSecretName } from "../lib/connection-credentials";
import type { ConnectionSourceManifest } from "../lib/connections";
import { plainDay } from "../lib/copy/when";
import { describeHostPackTooOld } from "../lib/copy/host-pack";
import { classifyHostFailure, type HostReachProblem } from "../lib/host-connect";
import type { HostRecord } from "../lib/hosts";
import { isSecureStoreError } from "../lib/secure-store";
import type { HostActionResult } from "../lib/shell/ipc";
import { recordKeyPlacement } from "../lib/store";
import { secureStore } from "./secure-store";
import { runDeployVerb, sshDeploySpawn, type SshDiagnostics } from "./ssh-host";

/**
 * Read one provider key out of the vault, as the value and nothing else.
 *
 * [[model-key-in-vault-is-an-envelope]] is why this is a function rather than a
 * `secureStore().get`: what is under that name is a JSON envelope, and a caller
 * that sent it straight to the host would place a document where a key belongs —
 * the host broker would then present the whole envelope as a bearer token and
 * the provider would refuse it, on a machine nobody is watching, with a receipt
 * on this one saying the key is installed.
 *
 * The four outcomes are `electron/broker-host.ts`'s, unreduced, for its stated
 * reason: a vault that will not open and a connection that was never made are
 * different sentences and different recoveries.
 */
type KeyRead =
  | { kind: "found"; key: string }
  | { kind: "absent" }
  | { kind: "unusable" }
  | { kind: "vault_error" };

async function readProviderKey(secretName: string): Promise<KeyRead> {
  let raw: string;
  try {
    raw = await secureStore().get(secretName);
  } catch (error: unknown) {
    if (isSecureStoreError(error)) {
      return error.code === "not_found" ? { kind: "absent" } : { kind: "vault_error" };
    }
    return { kind: "vault_error" };
  }
  const parsed = parseAiKeyCredential(raw);
  return parsed === null ? { kind: "unusable" } : { kind: "found", key: parsed.key };
}

/**
 * Put one declared provider key on one enrolled server.
 *
 * `manifest` is the agent's stored document, read by main. It is checked here
 * against the same `checkKeySlot` the helper runs on its own copy — two calls to
 * one function, never two implementations, which is `checkDeployRequest`'s rule
 * and applies with more force to the verb that moves a credential. DASH's copy
 * refuses before the vault is opened; the helper's copy refuses on the machine
 * that owns the filesystem.
 */
export async function installKeyOnHost(options: {
  record: HostRecord;
  agentId: string;
  connectionId: string;
  /** The identity the consent frame displayed, carried back from the renderer. */
  fingerprint: string;
  manifest: ConnectionSourceManifest | null;
  dataDir: string;
}): Promise<HostActionResult> {
  const { record, agentId, connectionId, manifest, dataDir } = options;

  /*
   * The frame named a machine, and this is where that claim is checked.
   *
   * ADR 0018 puts the fingerprint on the ceremony so that *"the address and
   * fingerprint make it the enrolled machine rather than another row with the
   * same label"*. A renderer could send any string, so this proves nothing about
   * the renderer — what it proves is that the record has not been re-pinned
   * since the frame was drawn, which is the change that would silently point a
   * consented press at a different server. `host.trust` is the only thing that
   * writes that field, and it refuses a second pin.
   */
  if (record.host_fingerprint === null || record.host_fingerprint !== options.fingerprint) {
    return {
      ok: false,
      detail:
        "This server's identity is not the one you were shown, so nothing was sent. Check the server again.",
      problem: "host_key_not_trusted",
    };
  }

  const slot = checkKeySlot(agentId, agentId, manifest, connectionId);
  if (!slot.ok) {
    return { ok: false, detail: describeKeySlotRefusal(slot.refusal) };
  }

  const diagnostics: SshDiagnostics = { stderr: "" };
  const spawn = sshDeploySpawn(record, dataDir, diagnostics);

  /*
   * ADR 0021 section 4, and the ordering is the decision: a host too old to run
   * a broker cannot use a key, so it is asked before the vault is opened. There
   * is no fall-through — *"an old helper that cannot answer `pack` cannot
   * receive `install-key` either; both stops name the setup step."*
   */
  const pack = readHostPack(await runDeployVerb(spawn, { verb: "pack" }));
  if (!pack.ok) {
    return {
      ok: false,
      detail:
        pack.stop === "unreachable" ? pack.detail : describeHostPackTooOld(record.label),
    };
  }

  const read = await readProviderKey(connectionSecretName(agentId, connectionId, slot.field_id));
  if (read.kind !== "found") {
    return { ok: false, detail: describeVaultRead(read.kind) };
  }

  const answer = await runDeployVerb(spawn, {
    verb: "install-key",
    bundle_id: agentId,
    connection_id: connectionId,
    key: read.key,
  });
  if (!answer.ok) {
    /*
     * The helper's own sentence, and never the request. ADR 0018: *"A diagnostic
     * that quotes stdin is a credential leak, not evidence."* `answer.detail` is
     * composed on the host from constants and from `lib/deploy/key-placement.ts`,
     * neither of which has ever seen the value.
     */
    return { ok: false, detail: answer.detail, problem: diagnosed(diagnostics, record) };
  }
  if (answer.verb !== "install-key") {
    // A well-formed answer to a different question. Reported as a failure rather
    // than read for fields it may not have — the same direction `readHostPack`
    // takes, and the safe one: the cost of being wrong here is one repeated
    // ceremony, and the cost of the other direction is a receipt for a placement
    // nothing proved.
    return { ok: false, detail: "The server answered something DASH could not read as a receipt." };
  }

  /*
   * After the proof and nowhere else. A row written on the attempt would claim a
   * key is on a machine it may never have reached, which is the one direction a
   * custody claim must never be wrong in.
   */
  recordKeyPlacement({
    host_id: record.host_id,
    bundle_id: answer.bundle_id,
    connection_id: answer.connection_id,
    field_id: slot.field_id,
  });

  return {
    ok: true,
    action: "installKey",
    host_id: record.host_id,
    label: record.label,
    agent_id: agentId,
    connection_id: answer.connection_id,
    placed_on: plainDay(answer.placed_at) ?? "",
    replaced: answer.replaced,
    detail: answer.replaced
      ? `The key on ${record.label} was replaced. The one that was there before can no longer be used from that server.`
      : `The key is on ${record.label}. DASH cannot see or take back what uses it there.`,
  };
}

/**
 * Why DASH could not read the key it was asked to send.
 *
 * Four sentences for four causes, unreduced, because they have four different
 * next moves — and because the honest one for `unusable` is not "the key is
 * broken" but "what is stored is not something this build can read", which is a
 * reconnect rather than a rotation. [[a-vault-blob-can-stop-decrypting]].
 */
function describeVaultRead(kind: Exclude<KeyRead["kind"], "found">): string {
  switch (kind) {
    case "absent":
      return "DASH is not holding a key for this connection, so there was nothing to send. Connect it first.";
    case "unusable":
      return "What DASH has stored for this connection cannot be read back. Connect it again, and nothing was sent.";
    case "vault_error":
      return "DASH could not open this computer's vault, so nothing was sent.";
  }
}

/**
 * `ssh`'s diagnostics, reduced to a member of a closed union.
 *
 * The same two lines `electron/main.ts` runs for every other host command,
 * repeated here rather than exported from there, because importing main from a
 * module main imports is a cycle. `classifyHostFailure` returns a
 * `HostReachProblem` or null, so `ssh`'s own text — which names this machine's
 * private key location — has no route from here to anything rendered.
 */
function diagnosed(
  diagnostics: SshDiagnostics,
  record: HostRecord,
): HostReachProblem | undefined {
  return (
    classifyHostFailure({
      stderr: diagnostics.stderr,
      pinned: record.host_fingerprint !== null,
    }) ?? undefined
  );
}

/**
 * The reserved id, re-exported where the placement path already is.
 *
 * A slot under `RESERVED_HOST_BUNDLE_ID` belongs to no agent, so it has no
 * manifest to declare it and `RESERVED_HOST_SLOTS` is empty in this packet —
 * nothing here can place one, and this export exists so the packet that can
 * finds the placement path rather than writing a second one.
 */
export { RESERVED_HOST_BUNDLE_ID };
