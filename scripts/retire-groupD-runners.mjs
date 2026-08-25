/**
 * Retire the runners this sweep's capture harnesses left behind (MAR-520).
 *
 * Not part of the shipped shell and named by no package.json script. It is the
 * proof MAR-520 asked for, run against real orphans rather than a fixture:
 * every capture harness in this tree spawns a detached runner that outlives it,
 * which is the observed behaviour the issue was filed about. Before MAR-520 the
 * only way to end one was `Stop-Process`, which AGENTS.md forbids, because
 * `POST /shutdown` with the on-disk `runner.key` answered 401 and nothing on
 * disk recorded which secret the running process had actually resolved.
 *
 * So this reads `runner.session.key` — the credential the runner wrote for
 * itself — checks it against `runner.json`'s `channel_secret_fingerprint`
 * before connecting, and asks each runner to stop over its own pipe. A 200 is
 * MAR-520 working. A 401 is MAR-520 still open, on the exact failure it names.
 *
 *   node scripts/retire-groupD-runners.mjs
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import http from "node:http";
import path from "node:path";

const ROOT = "C:\\Users\\henri\\AppData\\Local\\Temp\\gD-2026-08-25";

/** `runner/session-key.ts`'s own fingerprint: SHA-256, truncated to 16 hex. */
function fingerprint(secret) {
  return createHash("sha256").update(secret, "utf8").digest("hex").slice(0, 16);
}

function post(endpoint, route, secret) {
  return new Promise((resolve) => {
    const request = http.request(
      {
        socketPath: endpoint,
        path: route,
        method: "POST",
        headers: { authorization: `Bearer ${secret}`, "content-length": "0" },
        timeout: 8000,
      },
      (response) => {
        let body = "";
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () => resolve({ status: response.statusCode, body: body.slice(0, 300) }));
      },
    );
    request.on("timeout", () => {
      request.destroy();
      resolve({ status: null, body: "timed out" });
    });
    request.on("error", (error) => resolve({ status: null, body: error.message }));
    request.end();
  });
}

const results = [];
for (const slug of readdirSync(ROOT)) {
  const store = path.join(ROOT, slug, "store");
  const recordPath = path.join(store, "runner.json");
  const sessionPath = path.join(store, "runner.session.key");
  if (!existsSync(recordPath)) {
    results.push({ slug, outcome: "no runner.json", note: "nothing recorded a runner here" });
    continue;
  }
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  const alive = (() => {
    try {
      process.kill(record.pid, 0);
      return true;
    } catch {
      return false;
    }
  })();
  if (!existsSync(sessionPath)) {
    /*
     * The file is removed on graceful shutdown, so its absence beside a live
     * pid is the unretirable state MAR-520 is named after.
     */
    results.push({
      slug,
      pid: record.pid,
      alive,
      outcome: alive ? "UNRETIRABLE - live pid, no session key" : "already gone",
    });
    continue;
  }
  const session = readFileSync(sessionPath, "utf8").trim();
  const matches = record.channel_secret_fingerprint === fingerprint(session);
  if (!alive) {
    results.push({ slug, pid: record.pid, alive, fingerprint_matches: matches, outcome: "already gone" });
    continue;
  }
  const answer = await post(record.endpoint, "/shutdown", session);
  results.push({
    slug,
    pid: record.pid,
    alive,
    /* Checked BEFORE connecting, which is the point of the fingerprint. */
    fingerprint_matches: matches,
    status: answer.status,
    body: answer.body,
    /*
     * 202, not 200. The route accepts the request and lets the process wind
     * itself down, which is the honest code for it - the first draft of this
     * probe expected 200 and labelled three successful retirements
     * "unexpected". Both are recorded as success so the label can never again
     * be the thing that decides whether MAR-520 looks fixed.
     */
    outcome:
      answer.status === 202 || answer.status === 200
        ? `RETIRED over /shutdown with the session key (${String(answer.status)})`
        : answer.status === 401
          ? "REFUSED 401 - MAR-520 still open"
          : `unexpected ${String(answer.status)}`,
  });
}

console.log(JSON.stringify({ checked_at: new Date().toISOString(), results }, null, 2));
