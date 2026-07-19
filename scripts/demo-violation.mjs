#!/usr/bin/env node
/**
 * DASH-04 demo: replay a violating run against the example manifest and show
 * the verdict end-to-end.
 *
 * Start the app first (`pnpm dev`), then:
 *
 *   node scripts/demo-violation.mjs
 *   DASH_BASE_URL=http://localhost:3020 node scripts/demo-violation.mjs
 *
 * The replayed run writes the CRM note — an irreversible component — with no
 * approval gate resolved before it, against an L3 plan that expects a human in
 * the loop. Both findings should appear, and the run should render red.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = (process.env.DASH_BASE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);
const token = process.env.DASH_INGEST_TOKEN;

function readExample(name) {
  return JSON.parse(readFileSync(path.join(repoRoot, "examples", name), "utf8"));
}

async function post(pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

async function get(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

const manifest = readExample("agent.manifest.example.json");
const events = readExample("run-events.gate-violation.example.json");

const agentName = manifest.agent.name;
const runId = events[0].run_id;

console.log(`DASH demo → ${baseUrl}`);

const imported = await post("/api/agents", manifest).catch((error) => {
  console.error(`\nCould not reach DASH at ${baseUrl}. Is \`pnpm dev\` running?`);
  console.error(String(error));
  process.exit(1);
});
console.log(`  imported manifest  ${imported.status} ${JSON.stringify(imported.payload)}`);

const ingested = await post("/api/events", events);
console.log(`  replayed run       ${ingested.status} ${JSON.stringify(ingested.payload)}`);

// Read the verdict back out of the running app — the same analysis the run
// detail view renders — so the demo asserts the outcome end-to-end rather than
// asking you to go look at it.
const detailPath = `/api/runs/${encodeURIComponent(agentName)}/${encodeURIComponent(runId)}`;
const verdict = await get(detailPath);
const analysis = verdict.payload.analysis;

if (!analysis) {
  console.error(`\nNo analysis returned (${verdict.status}).`);
  console.error(JSON.stringify(verdict.payload, null, 2));
  process.exit(1);
}

console.log("\nVerdict");
console.log(`  compliant          ${analysis.compliant}`);
for (const violation of analysis.gate_violations) {
  console.log(
    `  GATE VIOLATION     ${violation.component_id} ran at seq ${violation.seq} with no gate resolved`,
  );
}
for (const finding of analysis.clearance_findings) {
  console.log(`  CLEARANCE          ${finding.detail}`);
}
for (const finding of analysis.drift) {
  console.log(`  drift              ${finding.component_id} — ${finding.detail}`);
}

const detailUrl = `${baseUrl}/runs/${encodeURIComponent(agentName)}/${encodeURIComponent(runId)}`;
console.log(`\nOpen the red badge end-to-end:\n  ${detailUrl}\n`);

if (analysis.compliant) {
  console.error("Expected this demo run to be non-compliant.");
  process.exit(1);
}
