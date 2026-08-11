/**
 * Asking a host to run an agent, and recording what came back (MAR-602,
 * ADR 0014).
 *
 * ADR 0014 admitted the route and wrote down, in its own follow-up list, that
 * the wiring was not written:
 *
 * > **The wiring is not written.** Resolving a deployed agent's host, building
 * > the channel and posting the envelope touches `electron/agent-adapters.ts`
 * > and `electron/ssh-host.ts`, which another session owns while this one runs.
 * > The route being admitted with no caller is a deliberate half-step.
 *
 * This is that caller. It is a file of its own rather than a branch in
 * `electron/main.ts` for the reason `performFolderAction` and `performAskAction`
 * are: every gate belongs beside the call it guards, where no future caller can
 * route around it, and main should hold the seam and not the argument.
 *
 * ## The shape of one press
 *
 * ```
 *   channel verb  ─ ask the host for the credential its runner is using
 *   GET  state    ─ ask that runner what it is currently offering
 *   POST commands ─ the envelope, adjudicated on both machines
 *   pull evidence ─ look, and write down that DASH looked
 * ```
 *
 * Four `ssh` children, because ADR 0007 spawns one connection per request and
 * declined a pool. That is slow and it is the arrangement: a pool would need a
 * health model DASH does not have for a machine it is not watching.
 *
 * ## What this file promises about the credential
 *
 * The host's runner mints its own channel secret and records it under an
 * owner-only proven ACL (MAR-520). DASH has never had a way to obtain it —
 * `runner/README.md` item 6 has named that gap since May — so `sshHostChannel`
 * took a `token` no caller could supply. The `channel` verb closes it, and the
 * custody rule is one sentence:
 *
 * > **DASH asks for the credential, spends it, and drops it.**
 *
 * It is not written to the vault, not cached on a module-level map, not put in
 * anything returned from here, and not logged. Fetching it fresh costs one `ssh`
 * round trip per press and buys the property that matters: a runner that
 * restarted has a new secret, and a DASH holding the old one would answer 401
 * with nothing on screen able to say why. `lib/deploy/verbs.ts` carries the
 * argument for the verb; this file is where the promise about the value is kept.
 *
 * ## What it promises about honesty
 *
 * ADR 0014, twice, and both apply to the code below rather than to the copy:
 *
 * - *"A run says which machine it happened on, from the pull that produced it,
 *   never from a deploy record."* So this function ends with a real
 *   `pullEvidence` against the host and an `evidence_pulls` row written from
 *   what it drained. The row is written **whether or not anything came back**,
 *   because "when DASH last looked" is half the sentence the Runs page carries
 *   and it is only true if it is written when the answer is boring.
 * - *"A remote Run now can therefore succeed completely and leave no trace DASH
 *   can show."* The pull immediately after the press will usually drain nothing,
 *   because the run has just started. That is the pull model working, not a
 *   failure, and the sentence this returns says so before the person goes
 *   looking.
 */

import { randomUUID } from "node:crypto";

import { pullEvidence } from "../lib/agent-dom/evidence";
import type {
  AgentCommandRoute,
  AgentStateRoute,
  RemoteRunnerChannel,
} from "../lib/agent-dom/runner-channel";
import { localPrincipal, runAgentCommand } from "../lib/agent-dom/runner";
import { fetchAgentDomState, httpAdapter, type ControlChannel } from "../lib/agent-dom/transport";
import { validateState } from "../lib/contracts";
import { checkDeployRequest } from "../lib/deploy/verbs";
import type { HostRecord } from "../lib/hosts";
import type { HostActionResult } from "../lib/shell/ipc";
import { recordEvidencePull } from "../lib/store";
import type { AgentDomState } from "../lib/workspace";
import {
  runDeployVerb,
  sshDeploySpawn,
  sshHostChannel,
  type SshDiagnostics,
} from "./ssh-host";

/**
 * The bundle a deployed agent lives in on a host.
 *
 * `hostAction`'s deploy branch passes `bundle_id: target.agent_id`, so the two
 * are one value by construction. It is derived here rather than stored because
 * storing it would create a second answer to a question that already has one,
 * and the two would disagree the first time either changed — the argument
 * `lib/agent-dom/evidence.ts` makes about a deploy verb returning run evidence.
 *
 * Derived and then **checked**, because a derivation is not a validation: an
 * agent id that cannot pass `checkDeployRequest`'s alphabet is an agent that
 * could never have been deployed, and finding that out here is better than
 * finding it out as a helper refusal three `ssh` children later.
 */
function bundleFor(agentId: string): { ok: true; bundle_id: string } | { ok: false; detail: string } {
  const checked = checkDeployRequest({ verb: "channel", bundle_id: agentId });
  return checked.ok
    ? { ok: true, bundle_id: agentId }
    : {
        ok: false,
        detail:
          "This agent's name is not one DASH can address on a server, so it was never put there.",
      };
}

/**
 * A one-route `fetch` for `lib/agent-dom/transport.ts` to call.
 *
 * This is the join between the two halves of the control plane and it is worth
 * reading slowly, because the obvious alternative is the thing
 * `lib/agent-dom/runner-channel.ts` exists to prevent.
 *
 * `transport.ts` owns everything that makes a runner exchange safe — the byte
 * ceiling, the timeout, the 401 sentence, the store-damage body, the
 * `unavailable`/`failed` split, the never-quote-the-token rule — and it reaches
 * a runner through an injectable `fetch(url, init)`. `RemoteRunnerChannel` owns
 * the capability, and it takes a **route** rather than a URL precisely because
 * `${origin}/broker/drain` is a string and types cannot see into one.
 *
 * Composing them by handing the transport a URL and re-deriving a route from it
 * would return that module to decoration in one line. So the route is captured
 * in the closure and the URL the transport composes is **discarded**: this
 * function is a fetch that can reach exactly one route, chosen here, at compile
 * time, by a value the type system enumerated. The transport's own bearer header
 * is overwritten by the channel's, which is the same token — `withBearer` sets
 * it last on purpose, so a caller cannot drop it.
 */
function viaRoute(
  channel: RemoteRunnerChannel,
  route: AgentCommandRoute | AgentStateRoute,
): typeof globalThis.fetch {
  return ((_input, init) => channel.call(route, init)) as typeof globalThis.fetch;
}

/**
 * The task a run request names, from the host's own snapshot.
 *
 * The same rule the Run now control on the agent page applies to the local copy:
 * a pending task belonging to no run is what a manual-first agent publishes when
 * it is waiting to be asked. `lib/agent-dom/enforce.ts`'s `resolveTarget` calls
 * that case `no_run` and treats it as *a real answer, not a missing one*, which
 * is what makes it a legitimate target.
 *
 * Read from the raw contract document rather than from a view, because no view
 * is built over a snapshot DASH does not store — and `run_id` is **absent**
 * here where the view would have made it null.
 */
function waitingTask(state: AgentDomState): string | null {
  const waiting = (state.tasks ?? []).find(
    (task) => task.status === "pending" && task.run_id === undefined,
  );
  return waiting?.id ?? null;
}

/**
 * Start the copy of an agent that is on a server, and say what DASH could see
 * afterwards.
 *
 * Returns a `HostActionResult`, which is a closed union with **no member that
 * could carry a credential** — the same discipline that keeps a private key out
 * of `host.create`'s answer, applied to the one plane that now handles a
 * credential at all.
 */
export async function runAgentOnHost(
  record: HostRecord,
  agentId: string,
  dataDir: string,
  userName: string,
  log: (line: string) => void = (line) => {
    console.warn(line);
  },
): Promise<HostActionResult> {
  const bundle = bundleFor(agentId);
  if (!bundle.ok) {
    return { ok: false, detail: bundle.detail };
  }

  // Collected by `openSshChannel` and never rendered: its text names this
  // machine's key location. Passed in so a failure here is classified by the
  // same function every other host action's failure is.
  const diagnostics: SshDiagnostics = { stderr: "" };

  let token: string;
  try {
    const answered = await runDeployVerb(sshDeploySpawn(record, dataDir, diagnostics), {
      verb: "channel",
      bundle_id: bundle.bundle_id,
    });
    if (!answered.ok) {
      return { ok: false, detail: answered.detail };
    }
    if (answered.verb !== "channel") {
      return { ok: false, detail: "The server did not answer the request DASH sent." };
    }
    token = answered.token;
  } catch {
    // `assertHostKeyProtected` and `hardenOwnerOnly` both throw with messages
    // that can name a local path. The renderer gets the fact and never the
    // diagnostic — `hostAction`'s existing rule, kept here rather than relaxed
    // because this branch is new.
    return { ok: false, detail: "DASH could not prepare the key for this server." };
  }

  let channel: RemoteRunnerChannel;
  try {
    channel = sshHostChannel({ record, dataDir, bundle_id: bundle.bundle_id, token });
  } catch {
    return { ok: false, detail: "DASH could not prepare the key for this server." };
  }

  /*
   * The snapshot, borrowed and not stored.
   *
   * `putAgentDomState` is deliberately not called. `agent_dom_state` is keyed by
   * agent id alone and a deployed agent has the same id in both places, so
   * storing this would overwrite the row belonging to the copy on this computer
   * — two machines' clocks fighting through an ordering guard built for one.
   * ADR 0014's third admission question is answered by refusing to keep it.
   */
  const control: ControlChannel = {
    uri: `${channel.origin}/agents/${encodeURIComponent(agentId)}`,
    token: channel.token,
  };
  const fetched = await fetchAgentDomState(control, {
    fetch: viaRoute(channel, { agent_id: agentId, leaf: "state" }),
  });
  if (!fetched.ok) {
    return {
      ok: false,
      detail:
        fetched.reason === "unavailable"
          ? `DASH could not reach the copy of this agent on ${record.label}.`
          : `The copy of this agent on ${record.label} could not say what it is doing.`,
    };
  }

  // Validated rather than trusted, for `putAgentDomState`'s reason one machine
  // over: a runner that emitted a bad document must not be allowed to decide
  // what a command may target.
  const validated = validateState(fetched.state);
  if (!validated.ok) {
    return {
      ok: false,
      detail: `The copy of this agent on ${record.label} described itself in a way DASH could not read.`,
    };
  }
  const state = validated.value;

  const taskId = waitingTask(state);
  if (taskId === null) {
    return {
      ok: false,
      detail:
        `The copy of this agent on ${record.label} is not waiting for anything to be started. ` +
        `It may already be running.`,
    };
  }

  /*
   * The whole command pipeline, against the host's snapshot rather than DASH's.
   *
   * Same audit rows, same nonce, same expiry, same idempotency claim — see
   * `CommandRuntime.snapshot` for why substituting the evidence beats writing a
   * second, thinner path. The adapter is the transport's own, pointed down the
   * route this channel carries.
   *
   * The idempotency key hashes the snapshot's `observed_at`, which is the host's
   * value and not this machine's, so a remote press and a local press of the
   * same agent can never collapse into one another's stored result.
   */
  const issued = await runAgentCommand(
    {
      request_id: randomUUID(),
      command: "retry",
      target: { agent_id: agentId, task_id: taskId },
      observed_at: state.observed_at,
      payload_keys: ["agent_id", "observed_at", "task_id"],
      mutates: true,
      irreversible: false,
    },
    {
      principal: localPrincipal(userName),
      adapter: httpAdapter(control, {
        fetch: viaRoute(channel, { agent_id: agentId, leaf: "commands" }),
      }),
      snapshot: state,
    },
  );

  /*
   * Look at the host, and write down that DASH looked — whatever the press did.
   *
   * After a refusal too, and that is deliberate rather than sloppy. The pull is
   * a record of DASH's own looking, and a look that happened is a fact
   * independent of whether the thing DASH asked for was allowed. Suppressing it
   * on the failure path would make `evidence_pulls` a log of successes, which is
   * the one thing MAR-488 built it not to be.
   */
  const pull = await pullEvidence(channel, {
    source: record.host_id,
    kind: "another_machine",
    log,
  });
  try {
    recordEvidencePull(pull);
  } catch {
    // `pullLocalEvidence` swallows this for the same reason: a poll that could
    // not record its own reading must not be a poll that stops, and the store
    // being unwritable is already reported by everything else that touches it.
  }

  if (!issued.ok) {
    return {
      ok: false,
      detail:
        issued.detail ??
        `${record.label} would not start this agent, and gave no reason DASH can pass on.`,
    };
  }

  return {
    ok: true,
    action: "run",
    host_id: record.host_id,
    label: record.label,
    agent_id: agentId,
    /*
     * ADR 0007's pull cost, said at the moment of pressing.
     *
     * The second sentence is the load-bearing one and it is not decoration:
     * a run DASH causes on a host produces evidence bounded by the host's
     * retention and by when DASH next looks, so "nothing appeared" has to be
     * understood as the arrangement rather than as a failure. Saying it after
     * would have told them nothing.
     */
    detail:
      `${record.label} was asked to start this agent. DASH will show what it did the next ` +
      `time it can reach that server, and only what the server still has then.`,
    reached: pull.reached,
  };
}
