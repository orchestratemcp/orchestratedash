/**
 * Bringing an agent home, and the order that makes it safe (MAR-611, ADR 0017).
 *
 * The rule this file exists to hold is one sentence — **DASH does not remove
 * what it could not copy** — and it is a rule about *order*, so almost every
 * test below asserts what the steps were asked to do rather than what came back.
 * A refusal that returned the right sentence having already removed the bundle
 * would pass a test written the other way.
 *
 * Every step is injected, which is why this runs with no `ssh`, no host, no key
 * and no network. `tests/deploy-bridge.test.ts` drives the real helper for the
 * verb itself; this drives the sequence around it.
 */

import { describe, expect, it } from "vitest";

import type { EvidencePull, IndexedArtifact } from "../lib/agent-dom/evidence";
import type { RemoteRunnerChannel } from "../lib/agent-dom/runner-channel";
import { describeBringHome, describeBringHomeOutcome } from "../lib/copy/bring-home";
import {
  bringAgentHome,
  type BringHomeSteps,
  type ChannelAttempt,
  type SaveOutcome,
} from "../lib/deploy/bring-home";
import type { DeployAnswer } from "../lib/deploy/verbs";
import { expectPlainLanguage } from "./helpers/plain-language";

const AGENT = "news-scout";

/** A channel that is never actually called: the pull and fetch steps are stubs. */
const channel = { origin: "http://runner.invalid", token: "t", call: () => {
  throw new Error("no route is reached in this test");
} } as unknown as RemoteRunnerChannel;

function pull(over: Partial<EvidencePull> = {}): EvidencePull {
  return {
    source: "host-1",
    kind: "another_machine",
    observed_at: "2026-08-11T18:00:00.000Z",
    reached: true,
    telemetry_dropped: 0,
    artifacts_dropped: 0,
    workspace_truncated: false,
    events_ingested: 3,
    artifacts_ingested: 1,
    workspace_index: [],
    ...over,
  };
}

function indexed(over: Partial<IndexedArtifact> = {}): IndexedArtifact {
  return {
    artifact_id: "art-1",
    agent: AGENT,
    display_name: "digest.txt",
    byte_size: 12,
    availability: "available",
    ...over,
  };
}

const OK_STOP: DeployAnswer = {
  ok: true,
  verb: "stop",
  bundle_id: AGENT,
  stopped: true,
  detail: "The runner was asked to stop and agreed.",
};
const OK_UNINSTALL: DeployAnswer = {
  ok: true,
  verb: "uninstall",
  bundle_id: AGENT,
  removed: true,
  detail: "The bundle and everything it held were removed.",
};
const OK_START: DeployAnswer = { ok: true, verb: "start", bundle_id: AGENT, pid: 4242 };

/**
 * Steps that write down what they were asked, in the order they were asked.
 *
 * `done` is the assertion surface for every ordering test below: a sequence that
 * removed something before it copied would show it here whatever it returned.
 */
function harness(over: Partial<BringHomeSteps> = {}): {
  steps: BringHomeSteps;
  done: string[];
} {
  const done: string[] = [];

  // The defaults are the whole happy path, and every override replaces one of
  // them *before* the recorder is put on. Wrapping after the merge is what makes
  // `done` complete: an override that carried its own body would otherwise be
  // the one step missing from the very list these tests are about.
  const merged: BringHomeSteps = {
    connect: async (): Promise<ChannelAttempt> => ({ ok: true, channel }),
    start: async () => OK_START,
    stop: async () => OK_STOP,
    uninstall: async () => OK_UNINSTALL,
    pull: async () => pull(),
    fetch: async () => [],
    save: async () => ({ ok: true, saved: 0, where: "C:\\home\\outputs" }) satisfies SaveOutcome,
    wait: async () => {},
    ...over,
  };

  const record = <A extends unknown[], R>(name: string, step: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      done.push(name);
      return await step(...args);
    };

  return {
    done,
    steps: {
      connect: record("connect", merged.connect),
      start: record("start", merged.start),
      stop: record("stop", merged.stop),
      uninstall: record("uninstall", merged.uninstall),
      pull: record("pull", merged.pull),
      fetch: record("fetch", merged.fetch),
      save: record("save", merged.save),
      wait: record("wait", merged.wait),
    },
  };
}

describe("the order", () => {
  it("copies, then stops, then removes", async () => {
    const { steps, done } = harness();
    const outcome = await bringAgentHome(AGENT, steps);

    expect(outcome.ok).toBe(true);
    // The whole feature, as a list. The pull is before the stop, the stop is
    // before the removal, and the removal is last.
    expect(done).toEqual(["connect", "pull", "stop", "uninstall"]);
  });

  it("does not fetch anything when the server named no files of this agent's", async () => {
    // Filtered to this agent, because a host holds several bundles and one
    // runner serves whatever is registered with it.
    const { steps, done } = harness({
      pull: async () => pull({ workspace_index: [indexed({ agent: "somebody-else" })] }),
    });
    const outcome = await bringAgentHome(AGENT, steps);

    expect(outcome.ok).toBe(true);
    expect(done).not.toContain("fetch");
    expect(done).not.toContain("save");
  });

  it("skips a file the runner's own index already calls gone", async () => {
    let asked: readonly { artifact_id: string }[] = [];
    const { steps } = harness({
      pull: async () =>
        pull({
          workspace_index: [
            indexed({ artifact_id: "here" }),
            indexed({ artifact_id: "gone", availability: "deleted" }),
          ],
        }),
      fetch: async (_channel, artifacts) => {
        asked = artifacts;
        return artifacts.map((one) => ({
          ok: true as const,
          artifact_id: one.artifact_id,
          display_name: one.display_name,
          bytes: new Uint8Array([1]),
        }));
      },
    });
    const outcome = await bringAgentHome(AGENT, steps);

    expect(asked.map((one) => one.artifact_id)).toEqual(["here"]);
    expect(outcome.ok && outcome.brought_home).toEqual(["here"]);
  });
});

describe("what stops it, and what the server keeps when it does", () => {
  /** Every refusal below must leave these two untouched. */
  function assertNothingRemoved(done: readonly string[]): void {
    expect(done).not.toContain("uninstall");
  }

  it("refuses when the host has no copy of this agent", async () => {
    const { steps, done } = harness({
      connect: async () => ({
        ok: false,
        problem: "not_installed",
        detail: "No bundle is installed under that name.",
      }),
    });
    const outcome = await bringAgentHome(AGENT, steps);

    expect(outcome).toMatchObject({ ok: false, stopped_at: "nothing_there" });
    // Not started, either. A bundle that is not installed will not become
    // installed by being started, and `openWithRetry` only retries the one
    // refusal waiting can change.
    expect(done).toEqual(["connect"]);
  });

  it("refuses when the last look reached nothing, before touching the runner", async () => {
    /*
     * The one caller that treats `reached` as load-bearing. Everywhere else a
     * failed drain is fire-and-forget, because a poll that stopped the loop
     * would be worse than a poll that missed a beat. Here the pull *is* the
     * copy, so a pull that reached nothing is a copy that took nothing.
     */
    const { steps, done } = harness({ pull: async () => pull({ reached: false }) });
    const outcome = await bringAgentHome(AGENT, steps);

    expect(outcome).toMatchObject({ ok: false, stopped_at: "could_not_read" });
    expect(done).toEqual(["connect", "pull"]);
    assertNothingRemoved(done);
  });

  it("refuses the whole removal when one file could not be copied", async () => {
    const { steps, done } = harness({
      pull: async () =>
        pull({
          workspace_index: [
            indexed({ artifact_id: "small", display_name: "digest.txt" }),
            indexed({ artifact_id: "huge", display_name: "recording.wav" }),
          ],
        }),
      fetch: async () => [
        { ok: true, artifact_id: "small", display_name: "digest.txt", bytes: new Uint8Array([1]) },
        {
          ok: false,
          artifact_id: "huge",
          display_name: "recording.wav",
          reason: "It is larger than the 32 MB DASH will copy off a server in one go.",
        },
      ],
    });
    const outcome = await bringAgentHome(AGENT, steps);

    expect(outcome).toMatchObject({ ok: false, stopped_at: "outputs_left_behind" });
    // Named, because "some files could not be copied" leaves somebody staring at
    // a server wondering which.
    expect(outcome.ok ? [] : outcome.left_behind.join(" ")).toContain("recording.wav");
    // And nothing was saved either: a half-copy is not a copy.
    expect(done).not.toContain("save");
    assertNothingRemoved(done);
  });

  it("treats a closed folder dialog as an answer, and removes nothing", async () => {
    const { steps, done } = harness({
      pull: async () => pull({ workspace_index: [indexed()] }),
      fetch: async (_channel, artifacts) =>
        artifacts.map((one) => ({
          ok: true as const,
          artifact_id: one.artifact_id,
          display_name: one.display_name,
          bytes: new Uint8Array([1]),
        })),
      save: async () => ({ ok: false, cancelled: true }),
    });
    const outcome = await bringAgentHome(AGENT, steps);

    expect(outcome).toMatchObject({ ok: false, stopped_at: "cancelled" });
    assertNothingRemoved(done);
  });

  it("refuses to remove files a runner would not let go of", async () => {
    /*
     * DASH refuses here as well as the helper refusing on arrival, and the
     * duplication is the point: the helper owns the filesystem and can only say
     * `still_running`, while DASH can pass on the runner's own account of *why*
     * it did not stop.
     */
    const { steps, done } = harness({
      stop: async () => ({
        ok: true,
        verb: "stop",
        bundle_id: AGENT,
        stopped: false,
        detail: "The runner is running and did not leave a way to sign in to it.",
      }),
    });
    const outcome = await bringAgentHome(AGENT, steps);

    expect(outcome).toMatchObject({ ok: false, stopped_at: "would_not_stop" });
    expect(outcome.ok ? "" : outcome.detail).toContain("did not leave a way to sign in");
    assertNothingRemoved(done);
  });

  it("tells an old helper apart from a server that refused", async () => {
    /*
     * The helper is installed once, by a person pasting the setup step, with its
     * bytes embedded — so every host enrolled before MAR-611 answers
     * `unknown_verb` to this verb forever until that step is run again. A
     * generic "the server would not remove it" would send somebody looking at
     * their server for a fault that is DASH's own version skew.
     */
    const { steps } = harness({
      uninstall: async () => ({
        ok: false,
        problem: "unknown_verb",
        detail: '"uninstall" is not an operation this helper performs.',
      }),
    });
    const outcome = await bringAgentHome(AGENT, steps);

    expect(outcome).toMatchObject({ ok: false, stopped_at: "helper_too_old" });
    expect(describeBringHomeOutcome(outcome, "Hostinger")).toContain("Run the setup step");
  });
});

describe("a runner that was not running", () => {
  /** Refuse the credential until a start has happened, then hand one over. */
  function afterStart(refusal: string): {
    steps: BringHomeSteps;
    done: string[];
  } {
    let started = false;
    return harness({
      start: async () => {
        started = true;
        return OK_START;
      },
      connect: async () =>
        started ? { ok: true, channel } : { ok: false, problem: refusal, detail: "not yet" },
    });
  }

  it("starts the copy on the server so it can be asked what it did", async () => {
    /*
     * There is no restart policy anywhere in DASH or the host helper, on
     * purpose — so *installed and not running* is the ordinary state of a host
     * that has rebooted, not an unusual one. A bring-home that refused there
     * would refuse in the commonest case.
     */
    const { steps, done } = afterStart("not_running");
    const outcome = await bringAgentHome(AGENT, steps);

    expect(outcome).toMatchObject({ ok: true, started_it: true });
    expect(done.slice(0, 3)).toEqual(["connect", "start", "connect"]);
  });

  it("waits for a just-started runner to publish its own credential", async () => {
    /*
     * `start` answers as soon as the host has a pid, and the runner writes its
     * session key a moment later — so the first ask after a start can honestly
     * refuse about a runner that is two hundred milliseconds from having one.
     * Retried rather than slept through, because a fixed sleep is either too
     * short on a loaded VPS or wasted on an idle one.
     */
    let asks = 0;
    const { steps, done } = harness({
      connect: async () => {
        asks += 1;
        return asks < 4
          ? { ok: false, problem: "no_channel_credential", detail: "not yet" }
          : { ok: true, channel };
      },
    });
    const outcome = await bringAgentHome(AGENT, steps);

    expect(outcome.ok).toBe(true);
    expect(done.filter((step) => step === "wait")).toHaveLength(2);
  });

  it("gives up rather than retrying a refusal waiting cannot change", async () => {
    const { steps, done } = harness({
      connect: async () => ({
        ok: false,
        problem: "unreachable",
        detail: "The server did not answer.",
      }),
    });
    const outcome = await bringAgentHome(AGENT, steps);

    expect(outcome).toMatchObject({ ok: false, stopped_at: "could_not_sign_in" });
    expect(done).toEqual(["connect"]);
  });
});

describe("what it says afterwards", () => {
  it("never promises more than the pull model can deliver", async () => {
    /*
     * ADR 0007 chose the pull model knowing its cost: a host's buffer is bounded
     * and DASH reads whatever survived until it last looked. So the sentence
     * says what the server *still had*, and must not say "everything it did".
     */
    const { steps } = harness();
    const said = describeBringHomeOutcome(await bringAgentHome(AGENT, steps), "Hostinger");

    expect(said).toContain("no longer on Hostinger");
    expect(said).toContain("still had");
    expect(said).not.toContain("everything it did");
  });

  it("says a bundle that had already gone had already gone", async () => {
    const { steps } = harness({
      uninstall: async () => ({
        ok: true,
        verb: "uninstall",
        bundle_id: AGENT,
        removed: false,
        detail: "There was nothing installed under that name.",
      }),
    });
    const said = describeBringHomeOutcome(await bringAgentHome(AGENT, steps), "Hostinger");

    expect(said).toContain("already gone");
  });

  it("counts the files it wrote, and names the folder the person chose", async () => {
    const { steps } = harness({
      pull: async () =>
        pull({
          workspace_index: [indexed({ artifact_id: "a" }), indexed({ artifact_id: "b" })],
        }),
      fetch: async (_channel, artifacts) =>
        artifacts.map((one) => ({
          ok: true as const,
          artifact_id: one.artifact_id,
          display_name: one.display_name,
          bytes: new Uint8Array([1]),
        })),
      save: async (files) => ({ ok: true, saved: files.length, where: "D:\\Outputs" }),
    });
    const outcome = await bringAgentHome(AGENT, steps);

    expect(outcome).toMatchObject({ ok: true, files_saved: 2, saved_where: "D:\\Outputs" });
    expect(describeBringHomeOutcome(outcome, "Hostinger")).toContain("Its 2 files were saved to D:\\Outputs");
  });
});

describe("what the person is told before they press it", () => {
  it("says the agent leaves the server, and that nothing here is deleted", () => {
    /*
     * ADR 0007 amendment 2: a disclosure that arrives after the act has told
     * them nothing. The third sentence is the one Henrik asked for in so many
     * words — *"Then if you still want to delete the agent you delete it
     * locally"* — and it is what makes the two-step visible rather than merely
     * true.
     */
    const said = describeBringHome("Hostinger");

    expect(said.headline).toContain("Hostinger");
    expect(said.meaning).toContain("removes it from that server");
    expect(said.meaning).toContain("ask you where the files should go");
    expect(said.afterwards).toContain("Nothing on this computer is deleted");
  });

  it("discloses the start, because it happens on somebody else's machine", () => {
    // Starting the runner so it can be asked what it did is a thing DASH does on
    // a machine it does not administer. It is disclosed before the press for the
    // same reason the removal is.
    expect(describeBringHome("Hostinger").meaning).toContain("starts it for a moment");
  });

  it("is plain language, before and after", () => {
    const before = describeBringHome("Hostinger");
    const outcomes = (
      [
        "nothing_there",
        "could_not_start",
        "could_not_sign_in",
        "could_not_read",
        "cancelled",
        "could_not_save",
        "would_not_stop",
        "helper_too_old",
        "could_not_remove",
      ] as const
    ).map((stopped_at) =>
      describeBringHomeOutcome(
        { ok: false, stopped_at, detail: null, left_behind: [] },
        "Hostinger",
      ),
    );

    expectPlainLanguage([before.headline, before.meaning, before.afterwards, ...outcomes]);
  });

  it("names the files it left behind, even though a name is not plain language", () => {
    /*
     * The one sentence here that carries something identifier-shaped, and it is
     * allowed through by name rather than by a rule that guesses. `digest.txt`
     * is an agent's own word for its own file — content, not DASH's vocabulary —
     * and this is the refusal standing between somebody and losing it, so it
     * owes them the name.
     */
    const said = describeBringHomeOutcome(
      {
        ok: false,
        stopped_at: "outputs_left_behind",
        detail: null,
        left_behind: ["digest.txt — It was larger than DASH will copy in one go."],
      },
      "Hostinger",
    );

    expect(said).toContain("digest.txt");
    expectPlainLanguage([said], { allow: ["digest.txt"] });
  });
});
