import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The optional argument exists so the gate can be pointed at a throwaway
// repository and checked against packets that are deliberately wrong. A gate
// nobody has ever seen fail is not known to work — that is the whole lesson of
// MAR-465 — and the only honest way to see this one fail is to feed it a bad
// packet somewhere other than the real project.
const root = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const state = JSON.parse(
  readFileSync(path.join(root, ".orchestrate", "state.json"), "utf8"),
);

const failures = [];
const warnings = [];
const unverified = [];

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function isAncestor(commit) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", commit, "HEAD"], {
      cwd: root,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function hasCommit(commit) {
  try {
    execFileSync("git", ["cat-file", "-e", `${commit}^{commit}`], { cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function isShallow() {
  try {
    return git(["rev-parse", "--is-shallow-repository"]) === "true";
  } catch {
    return false;
  }
}

const shallow = isShallow();

/**
 * `INVALID` must mean the packet is wrong, not that the checkout was thin.
 *
 * A commit that is absent from a shallow clone and a commit that was never in
 * this repository fail `merge-base --is-ancestor` identically, and reading the
 * first as the second is what made CI red for three merges. So ask the further
 * question the two answers differ on — does the object exist here at all — and
 * only decline to check when history genuinely is not present.
 */
function checkAncestry(commit, label) {
  if (isAncestor(commit)) {
    return;
  }
  if (hasCommit(commit)) {
    failures.push(`${label} ${commit} is not an ancestor of HEAD`);
  } else if (shallow) {
    unverified.push(`${label} ${commit}: history unavailable, ancestry not checked`);
  } else {
    failures.push(`${label} ${commit} is not a commit in this repository`);
  }
}

// Tolerating a shallow clone is for a developer who cloned thin, never for the
// release gate. In CI the workflow is responsible for `fetch-depth: 0`, so a
// shallow clone there is a broken gate rather than a limitation to work around
// — and saying so is the difference between this fix and a false green.
if (shallow && process.env.CI) {
  failures.push(
    "shallow clone in CI: ancestry is unverifiable, so this gate proves nothing — check out with fetch-depth: 0",
  );
}

if (state.schema_version !== 1) {
  failures.push("unsupported state schema");
}
if (typeof state.git?.evidence_base_commit !== "string") {
  failures.push("git.evidence_base_commit is missing");
} else {
  checkAncestry(state.git.evidence_base_commit, "evidence base");
}

for (const issue of state.issues ?? []) {
  if (["merged", "proven"].includes(issue.lifecycle)) {
    if (typeof issue.commit !== "string") {
      failures.push(`${issue.id}: merged/proven without a commit`);
    } else {
      checkAncestry(issue.commit, `${issue.id}: merged/proven commit`);
    }
  }
  if (issue.lifecycle === "proven" && typeof issue.proof?.command !== "string") {
    failures.push(`${issue.id}: proven without a reproducible proof command`);
  }
  if (
    ["merged", "proven"].includes(issue.lifecycle) &&
    ["Backlog", "Todo", "In Progress"].includes(issue.linear_status)
  ) {
    warnings.push(
      `${issue.id}: Git says ${issue.lifecycle}, recorded Linear status is ${issue.linear_status}`,
    );
  }
}

console.log(
  `[state] ${state.project} HEAD=${git(["rev-parse", "--short", "HEAD"])} wave=${state.current_wave}${
    shallow ? " (shallow clone)" : ""
  }`,
);
for (const warning of warnings) {
  console.warn(`[state] DRIFT: ${warning}`);
}
for (const skipped of unverified) {
  console.warn(`[state] UNVERIFIED: ${skipped}`);
}
for (const failure of failures) {
  console.error(`[state] INVALID: ${failure}`);
}
if (failures.length > 0) {
  process.exit(1);
}
if (unverified.length > 0) {
  console.log(
    `[state] no invalid entries, but ${unverified.length} commit(s) went unchecked in a shallow clone; this run is not ancestry evidence`,
  );
}
console.log(`[state] valid; ${warnings.length} recorded cross-system drift warning(s)`);
