import { describe, expect, it } from "vitest";
import {
  commitMemoryWrite,
  evaluateMemoryWrite,
  isDurable,
} from "../lib/memory";
import type { MemoryCategory, MemoryWriteProposal } from "../lib/memory";

function proposal(overrides: Partial<MemoryWriteProposal> = {}): MemoryWriteProposal {
  return {
    id: "memory-01",
    category: "approved_preference",
    summary: "Prefer 30-minute meetings",
    author: "model",
    actor_id: "claude-opus-4-8",
    sensitivity: "ordinary",
    provenance: "Suggested after the user picked 30 minutes three times",
    scope: "agent",
    proposed_at: "2026-07-19T12:00:00Z",
    ...overrides,
  };
}

const APPROVAL = { actor_id: "user-henrik", approved_at: "2026-07-19T12:05:00Z" };

describe("evaluateMemoryWrite — permanent memory cannot be silently written by the model", () => {
  it("requires approval for a model-authored durable preference", () => {
    const decision = evaluateMemoryWrite(proposal());
    expect(decision.outcome).toBe("needs_user_approval");
    expect(decision.durable).toBe(true);
    expect(decision.reason).toBe(
      "The agent suggested remembering this. It is saved only if you approve.",
    );
  });

  it("commits non-durable working state without asking", () => {
    const decision = evaluateMemoryWrite(proposal({ category: "working_state" }));
    expect(decision.outcome).toBe("commit");
    expect(decision.durable).toBe(false);
  });

  it("lets a runner record a run summary without approval", () => {
    const decision = evaluateMemoryWrite(
      proposal({ category: "run_summary", author: "runner", actor_id: "worker-01" }),
    );
    expect(decision.outcome).toBe("commit");
    expect(decision.durable).toBe(true);
  });

  it("still gates a model-authored run summary", () => {
    // A model writing the record of what it just did is exactly the silent
    // durable write the rule exists to stop.
    expect(evaluateMemoryWrite(proposal({ category: "run_summary" })).outcome).toBe(
      "needs_user_approval",
    );
  });

  it("does not let a runner decide the user's preferences", () => {
    const decision = evaluateMemoryWrite(
      proposal({ author: "runner", actor_id: "worker-01" }),
    );
    expect(decision.outcome).toBe("needs_user_approval");
  });

  it("commits a preference the user themselves stated", () => {
    const decision = evaluateMemoryWrite(
      proposal({ author: "user", actor_id: "user-henrik" }),
    );
    expect(decision.outcome).toBe("commit");
  });
});

describe("evaluateMemoryWrite — hard stops", () => {
  it("never lets the agent rewrite its own safety rules", () => {
    const decision = evaluateMemoryWrite(proposal({ category: "safety_policy" }));
    expect(decision.outcome).toBe("rejected");
    expect(decision.reason).toBe("Safety rules cannot be changed by the agent itself.");
  });

  it("asks the user before any other safety-rule change", () => {
    const decision = evaluateMemoryWrite(
      proposal({ category: "safety_policy", author: "user", actor_id: "user-henrik" }),
    );
    expect(decision.outcome).toBe("needs_user_approval");
  });

  it("refuses to store raw provider content, whoever proposed it", () => {
    for (const author of ["model", "user", "runner"] as const) {
      const decision = evaluateMemoryWrite(
        proposal({ sensitivity: "provider_content", author }),
      );
      expect(decision.outcome).toBe("rejected");
    }
  });

  it("rejects knowledge memory as out of scope for v0", () => {
    expect(evaluateMemoryWrite(proposal({ category: "knowledge" })).outcome).toBe(
      "rejected",
    );
  });

  it("applies hard stops before the approval rule, so a rejection cannot be downgraded", () => {
    // safety_policy + provider_content + model author: every rule fires. The
    // outcome must be the strictest one.
    const decision = evaluateMemoryWrite(
      proposal({ category: "safety_policy", sensitivity: "provider_content" }),
    );
    expect(decision.outcome).toBe("rejected");
  });
});

describe("isDurable", () => {
  it("treats only working state as non-durable", () => {
    const durable: MemoryCategory[] = [
      "approved_preference",
      "safety_policy",
      "run_summary",
      "knowledge",
    ];
    for (const category of durable) {
      expect(isDurable(category)).toBe(true);
    }
    expect(isDurable("working_state")).toBe(false);
  });
});

describe("commitMemoryWrite", () => {
  it("saves nothing when the decision was a rejection", () => {
    const input = proposal({ category: "safety_policy" });
    expect(commitMemoryWrite(input, evaluateMemoryWrite(input), APPROVAL)).toBeNull();
  });

  it("saves nothing when approval was required but not supplied", () => {
    const input = proposal();
    expect(commitMemoryWrite(input, evaluateMemoryWrite(input))).toBeNull();
  });

  it("records the approver and marks the entry user-approved", () => {
    const input = proposal();
    const entry = commitMemoryWrite(input, evaluateMemoryWrite(input), APPROVAL);
    expect(entry?.retention).toBe("user_approved");
    expect(entry?.approved_by).toBe("user-henrik");
    expect(entry?.approved_at).toBe("2026-07-19T12:05:00Z");
  });

  it("keeps a direct commit as descriptor_only with no approver", () => {
    const input = proposal({ category: "working_state" });
    const entry = commitMemoryWrite(input, evaluateMemoryWrite(input));
    expect(entry?.retention).toBe("descriptor_only");
    expect(entry?.approved_by).toBeUndefined();
  });

  it("carries provenance and actor onto the entry", () => {
    const input = proposal();
    const entry = commitMemoryWrite(input, evaluateMemoryWrite(input), APPROVAL);
    expect(entry?.provenance).toBe(
      "Suggested after the user picked 30 minutes three times",
    );
    expect(entry?.actor_id).toBe("claude-opus-4-8");
    expect(entry?.author).toBe("model");
  });

  it("always lets the user delete what an agent remembers about them", () => {
    const input = proposal();
    expect(commitMemoryWrite(input, evaluateMemoryWrite(input), APPROVAL)?.deletable).toBe(
      true,
    );
  });

  it("does not let a run summary be edited into something it was not", () => {
    const input = proposal({ category: "run_summary", author: "runner", actor_id: "worker-01" });
    const entry = commitMemoryWrite(input, evaluateMemoryWrite(input));
    expect(entry?.editable).toBe(false);
    expect(entry?.deletable).toBe(true);
  });

  it("omits run_id entirely for agent-scoped memory", () => {
    const input = proposal({ category: "working_state" });
    const entry = commitMemoryWrite(input, evaluateMemoryWrite(input));
    expect(entry === null ? [] : Object.keys(entry)).not.toContain("run_id");
  });
});
