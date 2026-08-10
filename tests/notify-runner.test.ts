/**
 * The notifier that lives in the runner (MAR-588, outbound).
 *
 * The claim under test is the second liveness sentence — *with DASH closed and
 * the computer on, messages are still sent* — and what makes it true is not any
 * one function but the **placement**: the sender is in the detached process that
 * outlives the DASH window, and it is driven by the lines agents write rather
 * than by anything DASH polls. Two of the tests below are structural for that
 * reason. The rest are about the policy that placement forces on it: bounded
 * memory, bounded queue, no duplicate messages, and no credential in a log.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DiscordNotifier, NOTIFY_QUEUE_LIMIT } from "../runner/notify";
import type { FetchLike } from "../lib/notify/deliver";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ENDPOINT =
  "https://discord.com/api/webhooks/1234567890123456789/aB3dEfGhIjKlMnOpQrStUvWxYz-0123456789_ABCDEF";

interface Sent {
  url: string;
  body: string;
}

/** A `fetch` that records and answers, so nothing here touches a network. */
function recorder(statuses: number[] = []): { sent: Sent[]; fetchImpl: FetchLike } {
  const sent: Sent[] = [];
  let index = 0;
  const fetchImpl: FetchLike = (url, init) => {
    sent.push({ url, body: init.body });
    const status = statuses[index] ?? 204;
    index += 1;
    return Promise.resolve({
      status,
      headers: { get: () => null },
      text: () => Promise.resolve(""),
    });
  };
  return { sent, fetchImpl };
}

function notifier(fetchImpl: FetchLike, log: string[] = []): DiscordNotifier {
  return new DiscordNotifier({
    fetchImpl,
    log: (line) => log.push(line),
    // No real waiting: the retry policy is under test, the clock is not.
    sleep: () => Promise.resolve(),
  });
}

/** One agent state document with a live, enforced approval in it. */
function stateWithApproval(id: string): unknown {
  return {
    approval_requests: [
      {
        id,
        status: "pending",
        runner_enforced: true,
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        // Deliberately present, deliberately never sent anywhere. A message
        // quoting this is the thing `tests/notify-discord.test.ts` forbids; this
        // fixture is what would make such a leak visible if it happened.
        label: "Wire 4,000 EUR to Acme Ltd",
      },
    ],
  };
}

/** Let the notifier's own promise chain settle. */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("nothing is sent until DASH hands over a channel", () => {
  it("accepts observations and posts nothing when unconfigured", async () => {
    const { sent, fetchImpl } = recorder();
    const notify = notifier(fetchImpl);

    notify.observeState("ledger", "Ledger", stateWithApproval("ap-1"));
    notify.observeArtifact("ledger", "Ledger", { run_id: "run-1" });
    await settle();

    expect(sent).toEqual([]);
    expect(notify.describe().configured).toBe(false);
  });

  it("never reports which channel it holds", () => {
    const { fetchImpl } = recorder();
    const notify = notifier(fetchImpl);
    notify.configure({ endpoint: ENDPOINT, send_approvals: true, send_reports: true });

    const described = notify.describe();
    expect(described.configured).toBe(true);
    expect(JSON.stringify(described)).not.toContain("discord.com");
  });
});

describe("what reaches the channel", () => {
  it("posts once for an approval, to the address it was given", async () => {
    const { sent, fetchImpl } = recorder();
    const notify = notifier(fetchImpl);
    notify.configure({ endpoint: ENDPOINT, send_approvals: true, send_reports: true });

    notify.observeState("ledger", "Ledger", stateWithApproval("ap-1"));
    await settle();

    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(ENDPOINT);
    expect(sent[0]?.body).toContain("Ledger");
    // The rule from the module header, checked against the bytes on the wire
    // rather than against the composer: the approval's own label never travels.
    expect(sent[0]?.body).not.toContain("Acme");
    expect(sent[0]?.body).not.toContain("4,000");
  });

  it("does not announce the same approval twice, however often the agent reports", async () => {
    const { sent, fetchImpl } = recorder();
    const notify = notifier(fetchImpl);
    notify.configure({ endpoint: ENDPOINT, send_approvals: true, send_reports: true });

    for (let i = 0; i < 5; i += 1) {
      notify.observeState("ledger", "Ledger", stateWithApproval("ap-1"));
    }
    await settle();

    expect(sent).toHaveLength(1);
  });

  it("announces one run once, however many artifacts it publishes", async () => {
    const { sent, fetchImpl } = recorder();
    const notify = notifier(fetchImpl);
    notify.configure({ endpoint: ENDPOINT, send_approvals: true, send_reports: true });

    notify.observeArtifact("ledger", "Ledger", { run_id: "run-1", artifact_id: "a1" });
    notify.observeArtifact("ledger", "Ledger", { run_id: "run-1", artifact_id: "a2" });
    notify.observeArtifact("ledger", "Ledger", { run_id: "run-2", artifact_id: "a3" });
    await settle();

    expect(sent).toHaveLength(2);
  });

  it("ignores an approval that is settled, unenforced or expired", async () => {
    const { sent, fetchImpl } = recorder();
    const notify = notifier(fetchImpl);
    notify.configure({ endpoint: ENDPOINT, send_approvals: true, send_reports: true });

    const future = new Date(Date.now() + 3_600_000).toISOString();
    notify.observeState("ledger", "Ledger", {
      approval_requests: [
        { id: "a", status: "approved", runner_enforced: true, expires_at: future },
        // Not a gate, only a suggestion. Asking somebody to hurry to their
        // machine for something that was never going to wait would be worse
        // than saying nothing.
        { id: "b", status: "pending", runner_enforced: false, expires_at: future },
        { id: "c", status: "pending", runner_enforced: true, expires_at: "2020-01-01T00:00:00Z" },
      ],
    });
    await settle();

    expect(sent).toEqual([]);
  });

  it("respects each switch on its own", async () => {
    const { sent, fetchImpl } = recorder();
    const notify = notifier(fetchImpl);
    notify.configure({ endpoint: ENDPOINT, send_approvals: false, send_reports: true });

    notify.observeState("ledger", "Ledger", stateWithApproval("ap-1"));
    notify.observeArtifact("ledger", "Ledger", { run_id: "run-1" });
    await settle();

    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toContain("published a new report");
  });

  it("says nothing about an artifact with no usable run", async () => {
    const { sent, fetchImpl } = recorder();
    const notify = notifier(fetchImpl);
    notify.configure({ endpoint: ENDPOINT, send_approvals: true, send_reports: true });

    notify.observeArtifact("ledger", "Ledger", { run_id: 42 });
    notify.observeArtifact("ledger", "Ledger", null);
    await settle();

    expect(sent).toEqual([]);
  });
});

describe("when Discord says no", () => {
  it("stops after a refusal rather than retrying a message it cannot deliver", async () => {
    const log: string[] = [];
    const { sent, fetchImpl } = recorder([404]);
    const notify = notifier(fetchImpl, log);
    notify.configure({ endpoint: ENDPOINT, send_approvals: true, send_reports: true });

    notify.observeArtifact("ledger", "Ledger", { run_id: "run-1" });
    await settle();

    expect(sent).toHaveLength(1);
    expect(log.join(" ")).toContain("404");
    // The status, never the address. A support log is a thing people paste.
    expect(log.join(" ")).not.toContain("discord.com");
  });

  it("retries a rate limit and a server error, and gives up bounded", async () => {
    const { sent, fetchImpl } = recorder([429, 500, 503]);
    const log: string[] = [];
    const notify = notifier(fetchImpl, log);
    notify.configure({ endpoint: ENDPOINT, send_approvals: true, send_reports: true });

    notify.observeArtifact("ledger", "Ledger", { run_id: "run-1" });
    await settle();

    expect(sent).toHaveLength(3);
    expect(log.join(" ")).toContain("could not be delivered");
    expect(log.join(" ")).not.toContain("discord.com");
  });

  it("abandons a retry when the person disconnects mid-backoff", async () => {
    const { sent, fetchImpl } = recorder([429, 204]);
    const notify = notifier(fetchImpl);
    notify.configure({ endpoint: ENDPOINT, send_approvals: true, send_reports: true });

    notify.observeArtifact("ledger", "Ledger", { run_id: "run-1" });
    // The first attempt is in flight; clearing must stop the second, or a
    // "stop posting" would be followed by one more post.
    await Promise.resolve();
    notify.configure(null);
    await settle();

    expect(sent.length).toBeLessThanOrEqual(1);
  });
});

describe("bounds", () => {
  it("drops rather than growing, and says which agent lost a message", async () => {
    const log: string[] = [];
    // A fetch that never settles, so everything piles up behind the first.
    const notify = notifier(() => new Promise(() => {}), log);
    notify.configure({ endpoint: ENDPOINT, send_approvals: true, send_reports: true });

    for (let i = 0; i < NOTIFY_QUEUE_LIMIT + 5; i += 1) {
      notify.observeArtifact("ledger", "Ledger", { run_id: `run-${String(i)}` });
    }
    await settle();

    // Logged rather than swallowed: a notification nobody sent and nobody knows
    // about is the failure this whole feature exists to prevent.
    expect(log.some((line) => line.includes("dropped"))).toBe(true);
    expect(notify.describe().queued).toBeLessThanOrEqual(NOTIFY_QUEUE_LIMIT);
  });

  it("empties the queue when the channel is taken away", async () => {
    const notify = notifier(() => new Promise(() => {}));
    notify.configure({ endpoint: ENDPOINT, send_approvals: true, send_reports: true });
    notify.observeArtifact("ledger", "Ledger", { run_id: "run-1" });
    notify.observeArtifact("ledger", "Ledger", { run_id: "run-2" });

    notify.configure(null);
    expect(notify.describe().queued).toBe(0);
  });
});

/**
 * The liveness claim, checked structurally.
 *
 * `lib/notify/settings.ts` tells a person that messages are still sent with DASH
 * closed. That is only true while the sender is in the runner, and the one way
 * it would silently stop being true is somebody moving this into Electron main
 * because it is easier to reach the vault from there. These two assertions are
 * what would fail on that day.
 */
describe("the sender is where the copy says it is", () => {
  it("is driven from the runner's own supervision, not from a DASH poll", () => {
    const supervisor = readFileSync(path.join(repoRoot, "runner", "supervisor.ts"), "utf8");
    // The hook is called on the line the agent wrote, in the same place
    // `onArtifactFile` is — not from a drain, which only moves when DASH asks.
    expect(supervisor).toContain("onNotifiable");
    const main = readFileSync(path.join(repoRoot, "runner", "main.ts"), "utf8");
    expect(main).toContain("new DiscordNotifier()");
  });

  it("is not what Electron main sends real notifications with", () => {
    // Main may send the *test* message — a person is sitting in front of it —
    // and must not be the thing that notices an agent needs somebody.
    const main = readFileSync(path.join(repoRoot, "electron", "main.ts"), "utf8");
    expect(main).not.toContain("DiscordNotifier");
    expect(main).not.toContain("observeState");
  });
});
