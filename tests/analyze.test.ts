import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzeRun } from "../lib/analyze";
import type { AgentManifest, RunEvent, RunEventType } from "../lib/contracts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const manifest = JSON.parse(
  readFileSync(
    path.join(repoRoot, "examples", "agent.manifest.example.json"),
    "utf8",
  ),
) as AgentManifest;

/**
 * Event builder. `seq` is assigned by position so a test reads as the sequence
 * of things the agent did, which is what each case is really asserting about.
 */
function run(
  steps: Array<[RunEventType, string?]>,
  runId = "run-test",
): RunEvent[] {
  return steps.map(([type, componentId], index) => ({
    event_version: 1,
    agent: manifest.agent.name,
    run_id: runId,
    seq: index,
    ts: new Date(Date.UTC(2026, 6, 19, 12, 0, index)).toISOString(),
    type,
    ...(componentId === undefined ? {} : { component_id: componentId }),
  }));
}

/** Every planned step, in plan order, with the approval gate honoured. */
const cleanRun = run([
  ["run_started"],
  ["step_started", "email_read"],
  ["step_started", "schema_validation"],
  ["step_started", "intent_classifier"],
  ["step_started", "email_draft"],
  ["step_started", "human_approval_gate"],
  ["gate_requested", "human_approval_gate"],
  ["gate_resolved", "human_approval_gate"],
  ["step_started", "crm_note_write"],
  ["step_started", "optional_email_send"],
  ["step_started", "audit_log"],
  ["run_completed"],
]);

describe("clean run", () => {
  const analysis = analyzeRun(manifest, cleanRun);

  it("is compliant", () => {
    expect(analysis.compliant).toBe(true);
  });

  it("reports no drift, no gate violations and no clearance findings", () => {
    expect(analysis.drift).toEqual([]);
    expect(analysis.gate_violations).toEqual([]);
    expect(analysis.clearance_findings).toEqual([]);
  });

  it("records the executed route in order", () => {
    expect(analysis.executed_route).toEqual([
      "email_read",
      "schema_validation",
      "intent_classifier",
      "email_draft",
      "human_approval_gate",
      "crm_note_write",
      "optional_email_send",
      "audit_log",
    ]);
  });

  it("is unaffected by out-of-order event delivery", () => {
    const shuffled = [...cleanRun].reverse();
    expect(analyzeRun(manifest, shuffled)).toEqual(analysis);
  });
});

describe("drifted run", () => {
  // Skips schema_validation, runs an unplanned scraper, and writes the CRM note
  // before drafting the email — the plan orders the draft first.
  const analysis = analyzeRun(
    manifest,
    run([
      ["run_started"],
      ["step_started", "email_read"],
      ["step_started", "web_scrape"],
      ["step_started", "intent_classifier"],
      ["gate_requested", "human_approval_gate"],
      ["gate_resolved", "human_approval_gate"],
      ["step_started", "crm_note_write"],
      ["step_started", "email_draft"],
      ["step_started", "optional_email_send"],
      ["step_started", "audit_log"],
      ["run_completed"],
    ]),
  );

  it("flags the planned step that never ran", () => {
    expect(analysis.drift).toContainEqual({
      kind: "missing_step",
      component_id: "schema_validation",
      detail: "planned step 2 never ran",
    });
  });

  it("flags the step that was never planned", () => {
    expect(analysis.drift).toContainEqual({
      kind: "unplanned_step",
      component_id: "web_scrape",
      detail: "ran but was never planned",
    });
  });

  it("flags the step that ran out of plan order", () => {
    expect(analysis.drift).toContainEqual({
      kind: "order_violation",
      component_id: "email_draft",
      detail: "ran after crm_note_write, but the plan orders it before",
    });
  });

  it("does not treat the unplanned step as an order violation", () => {
    const orderFindings = analysis.drift.filter(
      (finding) => finding.kind === "order_violation",
    );
    expect(orderFindings.map((finding) => finding.component_id)).toEqual([
      "email_draft",
    ]);
  });

  it("stays compliant, because drift alone is not a safety failure", () => {
    expect(analysis.gate_violations).toEqual([]);
    expect(analysis.compliant).toBe(true);
  });
});

describe("gate violation", () => {
  // The gate is requested but never resolved, and the CRM write happens anyway.
  const analysis = analyzeRun(
    manifest,
    run([
      ["run_started"],
      ["step_started", "email_read"],
      ["step_started", "schema_validation"],
      ["step_started", "intent_classifier"],
      ["step_started", "email_draft"],
      ["gate_requested", "human_approval_gate"],
      ["step_started", "crm_note_write"],
      ["step_started", "optional_email_send"],
      ["run_completed"],
    ]),
  );

  it("flags every irreversible step that ran unapproved", () => {
    expect(analysis.gate_violations.map((v) => v.component_id)).toEqual([
      "crm_note_write",
      "optional_email_send",
    ]);
  });

  it("is not compliant", () => {
    expect(analysis.compliant).toBe(false);
  });

  it("carries the seq and timestamp of the offending step", () => {
    expect(analysis.gate_violations[0]).toMatchObject({
      component_id: "crm_note_write",
      seq: 6,
    });
  });

  it("does not fire a clearance finding, because gate traffic existed", () => {
    expect(analysis.clearance_findings).toEqual([]);
  });

  it("clears irreversible steps that follow a resolved gate", () => {
    const resolved = analyzeRun(
      manifest,
      run([
        ["run_started"],
        ["gate_requested", "human_approval_gate"],
        ["gate_resolved", "human_approval_gate"],
        ["step_started", "crm_note_write"],
      ]),
    );
    expect(resolved.gate_violations).toEqual([]);
  });

  it("does not flag reversible steps that run before any gate", () => {
    const analysisBeforeGate = analyzeRun(
      manifest,
      run([
        ["run_started"],
        ["step_started", "email_read"],
        ["step_started", "intent_classifier"],
      ]),
    );
    expect(analysisBeforeGate.gate_violations).toEqual([]);
  });
});

describe("unattended against an attended plan", () => {
  // An L3 plan whose run contains no gate traffic at all.
  const analysis = analyzeRun(
    manifest,
    run([
      ["run_started"],
      ["step_started", "email_read"],
      ["step_started", "schema_validation"],
      ["step_started", "intent_classifier"],
      ["step_started", "email_draft"],
      ["step_started", "human_approval_gate"],
      ["step_started", "crm_note_write"],
      ["step_started", "optional_email_send"],
      ["step_started", "audit_log"],
      ["run_completed"],
    ]),
  );

  it("flags the run", () => {
    expect(analysis.clearance_findings).toEqual([
      {
        clearance: "L3",
        detail:
          "ran unattended against an attended plan (clearance L3, no gate events in this run)",
      },
    ]);
  });

  it("is not compliant", () => {
    expect(analysis.compliant).toBe(false);
  });

  it("also applies to L4, the stricter always-human level", () => {
    const l4Manifest: AgentManifest = {
      ...manifest,
      safety_contract: { ...manifest.safety_contract, automation_clearance: "L4" },
    };
    const l4 = analyzeRun(l4Manifest, run([["run_started"], ["run_completed"]]));
    expect(l4.clearance_findings).toHaveLength(1);
    expect(l4.clearance_findings[0]?.clearance).toBe("L4");
  });

  it("does not fire below L3, where no human is expected by default", () => {
    const l1Manifest: AgentManifest = {
      ...manifest,
      safety_contract: { ...manifest.safety_contract, automation_clearance: "L1" },
    };
    const l1 = analyzeRun(l1Manifest, run([["run_started"], ["run_completed"]]));
    expect(l1.clearance_findings).toEqual([]);
    expect(l1.compliant).toBe(true);
  });

  it("is satisfied by a requested gate even if it never resolved", () => {
    const requestedOnly = analyzeRun(
      manifest,
      run([
        ["run_started"],
        ["gate_requested", "human_approval_gate"],
        ["run_completed"],
      ]),
    );
    expect(requestedOnly.clearance_findings).toEqual([]);
  });
});
