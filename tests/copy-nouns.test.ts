/**
 * The section nouns, and a ratchet under the ones that have not been renamed
 * yet (MAR-879).
 *
 * ## Why this reads the source rather than the exports
 *
 * The drift being caught is a *heading* — a string literal sitting in a copy
 * module or a page. Importing every module and walking its exports would miss
 * the ones written inline in JSX, which is exactly where "Remote machines"
 * lives. So the scan is over the files, as text, the same way
 * `scripts/brand-check.mjs` walks `app/`.
 *
 * ## It was a baseline for about an hour, and now it is a ban
 *
 * The first version of this file recorded the four surviving uses as a
 * `BASELINE` and refused any *new* one, because the four lived in files
 * MAR-879's lane did not own. The ownership was extended and they were renamed,
 * so the baseline is empty — and an empty baseline is not a weaker version of
 * the mechanism, it is the whole point of it. What the ratchet was for was
 * getting here.
 *
 * The shape is kept rather than replaced by a flat `not.toContain`, for one
 * reason: if a future packet has to reintroduce one of these words somewhere it
 * genuinely belongs, the honest way to do it is a line in `BASELINE` naming the
 * file and saying why — visible in a diff, countable, and impossible to leave
 * lying around unnoticed. A bare ban would be argued with by deleting the
 * assertion.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import {
  RETIRED_NOUNS,
  SECTION_NOUNS,
  canonicalNounFor,
  everyNounSentence,
  type RetiredNoun,
} from "../lib/copy/nouns";
import { expectPlainLanguage } from "./helpers/plain-language";

const ROOT = join(__dirname, "..");

/**
 * Where a section heading can be written.
 *
 * `lib/copy` is where they belong; `app` is where the ones that never made it
 * into a copy module are. Nothing else in the repository draws a section for a
 * person to read.
 */
const SCANNED_DIRECTORIES = ["lib/copy", "app"];

/** This module defines the retired phrases, so it cannot be held to not using them. */
const EXEMPT = new Set(["lib/copy/nouns.ts"]);

/**
 * Where a retired phrase is still allowed to appear, and how often.
 *
 * **Empty, and that is the finished state.** MAR-879 renamed all four sites:
 * `AGENT_OUTPUTS_COPY.heading` and `PANEL_ALREADY_SHOWN` say "Results", and the
 * Servers page's `<h1>` says "Servers". Keys would be repository-relative paths
 * with forward slashes and the value the number of uses.
 *
 * Adding a line here is not forbidden — a phrase can have a legitimate home
 * again, and a comment beside it saying which and why is the honest way to
 * record that. What is forbidden is drift, which is the same thing arriving
 * without anybody writing it down.
 */
const BASELINE: Record<RetiredNoun, Record<string, number>> = {
  "Generated assets": {},
  "Remote machines": {},
};

function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const full = join(directory, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
        found.push(relative(ROOT, full).split(sep).join("/"));
      }
    }
  };
  for (const directory of SCANNED_DIRECTORIES) {
    walk(join(ROOT, directory));
  }
  return found.filter((path) => !EXEMPT.has(path)).sort();
}

function occurrences(text: string, phrase: string): number {
  let count = 0;
  let at = text.indexOf(phrase);
  while (at !== -1) {
    count += 1;
    at = text.indexOf(phrase, at + phrase.length);
  }
  return count;
}

function countRetired(): Record<RetiredNoun, Record<string, number>> {
  const counted = Object.fromEntries(
    Object.keys(RETIRED_NOUNS).map((phrase) => [phrase, {} as Record<string, number>]),
  ) as Record<RetiredNoun, Record<string, number>>;

  for (const path of sourceFiles()) {
    const text = readFileSync(join(ROOT, path), "utf8");
    for (const phrase of Object.keys(RETIRED_NOUNS) as RetiredNoun[]) {
      const count = occurrences(text, phrase);
      if (count > 0) {
        counted[phrase][path] = count;
      }
    }
  }
  return counted;
}

describe("the section nouns", () => {
  it("are plain language, noun and gloss alike", () => {
    expectPlainLanguage(everyNounSentence());
  });

  it("are each one capitalised word a person could press", () => {
    for (const [key, entry] of Object.entries(SECTION_NOUNS)) {
      expect(entry.noun, key).toMatch(/^[A-Z][a-z]+$/);
      expect(entry.means, key).not.toBe("");
      // A gloss that is the noun again teaches nobody anything.
      expect(entry.means.toLowerCase(), key).not.toBe(entry.noun.toLowerCase());
    }
  });

  it("names a live noun for every retired phrase", () => {
    for (const phrase of Object.keys(RETIRED_NOUNS) as RetiredNoun[]) {
      const canonical = canonicalNounFor(phrase);
      expect(canonical, phrase).not.toBe("");
      expect(canonical, phrase).not.toBe(phrase);
    }
  });
});

describe("the retired phrases", () => {
  const counted = countRetired();

  it("appear in no file the baseline does not already name", () => {
    /*
     * The assertion the module exists for, and with an empty baseline it is now
     * the plain claim: no surface in `lib/copy` or `app` says a retired word.
     * One that picks "Generated assets" up tomorrow lands here as a new key,
     * and the message names the file and the word it should have used instead.
     */
    for (const phrase of Object.keys(RETIRED_NOUNS) as RetiredNoun[]) {
      const seen = Object.keys(counted[phrase]).sort();
      const allowed = Object.keys(BASELINE[phrase]).sort();
      expect(
        seen,
        `"${phrase}" is retired — say "${canonicalNounFor(phrase)}" instead`,
      ).toEqual(allowed);
    }
  });

  it("appear no more often anywhere than the baseline allows", () => {
    for (const phrase of Object.keys(RETIRED_NOUNS) as RetiredNoun[]) {
      for (const [path, allowed] of Object.entries(BASELINE[phrase])) {
        const seen = counted[phrase][path] ?? 0;
        expect(
          seen,
          seen < allowed
            ? `"${phrase}" is used ${String(seen)} times in ${path} now, not ${String(allowed)} — lower the baseline in this file`
            : `"${phrase}" is retired — say "${canonicalNounFor(phrase)}" instead`,
        ).toBe(allowed);
      }
    }
  });
});
