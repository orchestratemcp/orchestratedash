// Retire orphaned capture-harness runners the way scripts/retire-groupD-runners.mjs
// does (MAR-520): read each scratch store's runner.session.key, check it against
// runner.json's fingerprint, POST /shutdown over the runner's own pipe. Never a
// kill. The real store (%APPDATA%\orchestratedash) is skipped by path.
import { createHash } from "node:crypto";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";

const ROOTS = [process.env.TEMP ?? "C:\\Users\\henri\\AppData\\Local\\Temp", "C:\\Users\\henri\\AppData\\Roaming\\Electron"];
const SKIP = /Roaming[\\/]orchestratedash/i;
const MAX_DEPTH = 5;

function fingerprint(secret) {
  return createHash("sha256").update(secret, "utf8").digest("hex").slice(0, 16);
}
function post(endpoint, route, secret) {
  return new Promise((resolve) => {
    const request = http.request(
      { socketPath: endpoint, path: route, method: "POST", headers: { authorization: `Bearer ${secret}`, "content-length": "0" }, timeout: 8000 },
      (response) => { let body = ""; response.on("data", (c) => (body += c)); response.on("end", () => resolve({ status: response.statusCode, body: body.slice(0, 200) })); },
    );
    request.on("timeout", () => { request.destroy(); resolve({ status: null, body: "timed out" }); });
    request.on("error", (error) => resolve({ status: null, body: error.message }));
    request.end();
  });
}
function* stores(dir, depth) {
  if (depth > MAX_DEPTH) return;
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  if (entries.some((e) => e.isFile() && e.name === "runner.json")) { yield dir; return; }
  for (const e of entries) {
    if (!e.isDirectory() || e.name === "node_modules" || e.name.startsWith(".")) continue;
    yield* stores(path.join(dir, e.name), depth + 1);
  }
}
const results = [];
for (const root of ROOTS) {
  for (const store of stores(root, 0)) {
    if (SKIP.test(store)) { results.push({ store, outcome: "skipped: real store" }); continue; }
    const record = JSON.parse(readFileSync(path.join(store, "runner.json"), "utf8"));
    let alive = false; try { process.kill(record.pid, 0); alive = true; } catch {}
    if (!alive) continue; // nothing to retire; leave the store alone
    const sessionPath = path.join(store, "runner.session.key");
    if (!existsSync(sessionPath)) { results.push({ store, pid: record.pid, outcome: "UNRETIRABLE: live pid, no session key" }); continue; }
    const session = readFileSync(sessionPath, "utf8").trim();
    const matches = record.channel_secret_fingerprint === fingerprint(session);
    const answer = await post(record.endpoint, "/shutdown", session);
    results.push({ store, pid: record.pid, fingerprint_matches: matches, status: answer.status, outcome: answer.status === 202 || answer.status === 200 ? "RETIRED" : answer.status === 401 ? "REFUSED 401" : `unexpected ${answer.status} ${answer.body}` });
  }
}
console.log(JSON.stringify({ checked_at: new Date().toISOString(), results }, null, 1));
