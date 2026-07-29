/**
 * What counts as a raw identifier, written down once.
 *
 * MAR-423's acceptance criterion is that **no raw identifier appears anywhere in
 * the guided path, verified by a test over the rendered copy, not by
 * inspection.** This module is the "verified" half: it is the only definition of
 * the rule in the repository, and every guided-path string is asserted against
 * it.
 *
 * MAR-428 established the pattern for one dialog, inline in
 * `tests/handoff-flow.test.ts`. Two things made generalising it worth the
 * module rather than copying the regexes: a rule expressed as four literals in
 * one test file is a rule that holds until the second surface, and a failure
 * that says `expected "…" not to match /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/` tells
 * whoever broke it nothing about what to do instead.
 *
 * ## What is an identifier
 *
 * DASH's internal vocabulary, in the four shapes it actually escapes in:
 *
 * - **Environment variable names** — `DASH_INGEST_URL`, `GOOGLE_API_KEY`.
 * - **Internal field names** — `manifest_path`, `agent_dom`, `component_id`,
 *   `runner_enforced`. Anything the contracts call a thing amongst themselves.
 * - **Provider scopes** — `https://www.googleapis.com/auth/calendar.events`,
 *   `calendar.events.readonly`. `agent.manifest.v2.schema.json` buckets these
 *   under `fields[].technical.provider_scopes` precisely so the plain label can
 *   be shown on its own, and this is what holds callers to it.
 * - **Artifact filenames** — `agent.manifest.json`. "Import
 *   `agent.manifest.json`" is the exact phrase MAR-423 calls meaningless to a
 *   normal person.
 *
 * ## What is deliberately *not* an identifier
 *
 * A folder the user chose, and the command that is about to run. Both are
 * excluded by the caller through `allow`, never by a rule in here that tries to
 * guess which paths are friendly.
 *
 * That is the point of putting the exemption at the call site: `allow` is a
 * short list of exact strings a caller has decided are *content*, and it shows
 * up in the diff when someone adds one. A detector clever enough to work it out
 * for itself would be a detector nobody could see the exceptions of.
 */

/**
 * The shape a match was recognised as. For the failure message, not for the
 * rule — a string that matches any of these is a finding regardless of which
 * one claimed it first.
 */
export type RawIdentifierKind =
  | "environment_variable"
  | "internal_field"
  | "provider_scope"
  | "artifact_file"
  | "forbidden_value";

export interface RawIdentifier {
  kind: RawIdentifierKind;
  /** The offending text, exactly as it appeared. */
  text: string;
}

export interface IdentifierScanOptions {
  /**
   * Exact substrings that are content rather than vocabulary — the command that
   * will run, the folder the user created. Blanked before scanning, so an
   * identifier that happens to sit *inside* an allowed string is allowed too.
   * That is intended: the caller has taken responsibility for the whole string.
   */
  allow?: readonly string[];
  /**
   * Values this particular surface must not leak, on top of the general rules.
   *
   * The general rules catch *names*. They cannot catch an opaque id like
   * `approval-meeting-01`, because nothing about it is shaped differently from a
   * word a person might legitimately write. So a test that renders real content
   * passes the ids of that content here, which is what makes "verified over the
   * rendered copy" mean something for values as well as for vocabulary.
   */
  forbid?: readonly string[];
}

/**
 * Ordered by specificity, not by importance. A filename and a dotted scope are
 * the same shape to a regex, so the more specific pattern is given the first
 * claim on a span and later ones skip anything already matched — otherwise
 * `agent.manifest.json` would be reported as a provider scope and the message
 * would send its reader looking in the wrong contract.
 */
const MATCHERS: ReadonlyArray<{ kind: RawIdentifierKind; pattern: RegExp }> = [
  // Two or more segments: a bare `PATH` is a word, `DASH_INGEST_URL` is not.
  { kind: "environment_variable", pattern: /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g },
  { kind: "provider_scope", pattern: /\bhttps?:\/\/\S+/g },
  { kind: "artifact_file", pattern: /\b[\w-]+(?:\.[\w-]+)*\.(?:json|jsonl|schema\.json|sqlite|mjs|cjs|tsx?)\b/g },
  // Three or more dotted segments. Two would catch every ordinary sentence that
  // ends in a filename-ish word, and scopes in the wild have at least three.
  { kind: "provider_scope", pattern: /\b[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*){2,}\b/g },
  { kind: "internal_field", pattern: /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g },
];

/**
 * Every raw identifier in a string, in the order they appear.
 *
 * Returns findings rather than a boolean so a failing test can say *which* word
 * is the problem. An empty array is the passing case.
 */
export function rawIdentifiersIn(
  text: string,
  options: IdentifierScanOptions = {},
): RawIdentifier[] {
  const haystack = blankOut(text, options.allow ?? []);
  const claimed: Array<[number, number]> = [];
  const found: Array<{ at: number; identifier: RawIdentifier }> = [];

  for (const value of options.forbid ?? []) {
    if (value === "") {
      continue;
    }
    let at = haystack.indexOf(value);
    while (at !== -1) {
      claimed.push([at, at + value.length]);
      found.push({ at, identifier: { kind: "forbidden_value", text: value } });
      at = haystack.indexOf(value, at + value.length);
    }
  }

  for (const { kind, pattern } of MATCHERS) {
    // A fresh regex per scan: the module-level literals carry `g`, and a shared
    // `lastIndex` across calls is the classic way a detector starts skipping
    // findings only on the second invocation.
    const scanner = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = scanner.exec(haystack)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (claimed.some(([from, to]) => start < to && end > from)) {
        continue;
      }
      claimed.push([start, end]);
      found.push({ at: start, identifier: { kind, text: match[0] } });
    }
  }

  return found.sort((a, b) => a.at - b.at).map((entry) => entry.identifier);
}

/** True when a string is fit for the guided path. */
export function isPlainLanguage(text: string, options: IdentifierScanOptions = {}): boolean {
  return rawIdentifiersIn(text, options).length === 0;
}

/**
 * A failure message someone can act on.
 *
 * Names the offending words and what to do instead, because the reader of this
 * message is a person who just broke a rule they may not know exists, and
 * "expected [] to have length 0" would not tell them it does.
 */
export function describeRawIdentifiers(findings: readonly RawIdentifier[]): string {
  if (findings.length === 0) {
    return "no raw identifiers";
  }
  const advice: Record<RawIdentifierKind, string> = {
    environment_variable: "environment variable names never belong in front of a user",
    internal_field: "use the plain label the manifest carries beside this field",
    provider_scope: "show the connection's label; scopes live under fields[].technical",
    artifact_file: "name what the file is for, not what it is called",
    forbidden_value: "this identifier is an internal value and has no meaning to the reader",
  };
  return findings
    .map((finding) => `“${finding.text}” (${finding.kind}: ${advice[finding.kind]})`)
    .join("; ");
}

/**
 * Replace each allowed substring with spaces of the same length.
 *
 * Spaces rather than deletion so that offsets keep lining up, which is what the
 * overlap check above depends on, and so two adjacent findings cannot be fused
 * into one by the removal of the text between them.
 */
function blankOut(text: string, allow: readonly string[]): string {
  let result = text;
  for (const phrase of allow) {
    if (phrase === "") {
      continue;
    }
    let at = result.indexOf(phrase);
    while (at !== -1) {
      result = result.slice(0, at) + " ".repeat(phrase.length) + result.slice(at + phrase.length);
      at = result.indexOf(phrase, at + phrase.length);
    }
  }
  return result;
}
