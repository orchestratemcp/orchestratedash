/**
 * Every word the chief says about what it read and what it fetched (MAR-744).
 *
 * `tests/chief-chat-copy.test.ts`' walk, pointed at the second copy module: the
 * sentences are produced by **calling** each function rather than by reading
 * constants, because a template that interpolated an identifier would be
 * invisible to a walk over strings while being exactly the leak the identifier
 * rule exists to catch.
 *
 * The rule this file adds to that one is about **addresses**. `FeedSource.name`
 * carries the comment *"what the user reads. Never a URL"*, and this whole
 * packet's citation discipline rests on an address living on a citation rather
 * than inside a sentence. So no sentence here may contain one.
 */

import { describe, expect, it } from "vitest";

import { CHIEF_SOURCES } from "../lib/chief/sources";
import {
  describeChiefCannotSearch,
  describeChiefFetched,
  describeChiefFoundNoSources,
  describeChiefItemsOnly,
  describeChiefItemsRead,
  describeChiefNoTopic,
  describeChiefSourceStatus,
  describeChiefSourcesUnreachable,
  describeChiefTopicRefused,
  everyChiefSourcesSentence,
} from "../lib/copy/chief-sources";
import { expectPlainLanguage } from "./helpers/plain-language";

describe("the chief's words about its sources are plain", () => {
  it("passes the plain-language walk", () => {
    expectPlainLanguage(everyChiefSourcesSentence());
  });

  /*
   * The one rule this module has that its neighbour does not. A sentence
   * carrying an address would be `lib/copy/identifiers.ts`' failure on the
   * surface built hardest to avoid it -- and it would put a link in a place
   * DASH does not render as a link, so a reader could not click it either.
   */
  it("never writes an address into a sentence", () => {
    for (const sentence of everyChiefSourcesSentence()) {
      expect(sentence).not.toMatch(/https?:\/\//u);
      expect(sentence).not.toMatch(/\bwww\./u);
      expect(sentence).not.toMatch(/[a-z0-9-]+\.(com|org|net|io|gov)\b/iu);
    }
  });

  it("says every source by the name a person reads", () => {
    const names = CHIEF_SOURCES.map((source) => source.name);
    const sentence = describeChiefFoundNoSources(names).sentence;
    for (const name of names) {
      expect(sentence).toContain(name);
    }
  });
});

describe("the failure sentences are honest about what happened", () => {
  /*
   * Item 4's bar: *"honest 'I can't reach that' instead of generic refusals"*.
   * Each of these is the assertion that one sentence still says the specific
   * thing it was written to say, rather than having drifted into "something
   * went wrong" during an edit.
   */
  it("does not claim to have searched the internet", () => {
    const sentence = describeChiefFoundNoSources(["Google News", "Hacker News", "arXiv"]).sentence;
    expect(sentence).toContain("Google News");
    expect(sentence).not.toMatch(/\bthe (whole )?(internet|web)\b/iu);
  });

  it("distinguishes nothing-listed from could-not-reach", () => {
    const listed = describeChiefFoundNoSources(["arXiv"]).sentence;
    const unreachable = describeChiefSourcesUnreachable(["arXiv"]).sentence;
    expect(listed).not.toBe(unreachable);
    expect(listed).toContain("none of them listed anything");
    expect(unreachable).toContain("could not reach");
    // Only one of the two is worth retrying, and only that one says so.
    expect(unreachable).toContain("again");
  });

  it("asks for a subject rather than answering a question nobody asked", () => {
    expect(describeChiefNoTopic().sentence).toContain("what about");
    expect(describeChiefTopicRefused().sentence).toContain("subject");
  });

  it("sends somebody somewhere when this room cannot search", () => {
    expect(describeChiefCannotSearch().sentence).toContain("DASH on your computer");
  });

  it("names the sources that did not answer, so a partial result says so", () => {
    const sentence = describeChiefFetched(4, ["Google News"], ["arXiv"]).sentence;
    expect(sentence).toContain("Google News");
    expect(sentence).toContain("arXiv");
    expect(sentence).toContain("may be more");
  });

  it("does not add a caveat when every source answered", () => {
    expect(describeChiefFetched(4, ["Google News", "arXiv"], []).sentence).not.toContain(
      "may be more",
    );
  });
});

describe("the sentence under a read accounts for what was read", () => {
  it("admits when nothing matched and the newest were taken instead", () => {
    const matched = describeChiefItemsRead("matched", 3, ["tariffs"]).sentence;
    const newest = describeChiefItemsRead("newest", 3, ["tariffs"]).sentence;
    expect(matched).not.toBe(newest);
    expect(newest).toContain("Nothing your agents saved mentions");
  });

  it("does not claim a miss when nothing distinctive was asked", () => {
    // "pull out the most current news" has no term to match on, so the newest
    // items are what was asked for rather than a fallback from a failed search.
    expect(describeChiefItemsRead("newest", 3, []).sentence).not.toContain("Nothing your agents");
  });

  it("counts in words rather than printing a bare number twice", () => {
    expect(describeChiefItemsRead("matched", 1, []).sentence).toContain("1 thing");
    expect(describeChiefItemsRead("matched", 4, []).sentence).toContain("4 things");
    expect(describeChiefItemsOnly(1).sentence).toContain("this");
  });

  it("says the fleet has saved nothing without reading as a failure", () => {
    const sentence = describeChiefItemsRead("nothing_saved", 0, []).sentence;
    expect(sentence).toContain("Run one");
    expect(sentence).not.toMatch(/\b(error|failed|problem)\b/iu);
  });

  it("carries the searched terms as values rather than in the sentence", () => {
    const read = describeChiefItemsRead("matched", 2, ["tariffs"]);
    expect(read.values).toEqual(["tariffs"]);
    expect(read.quoted).toBeNull();
  });
});

describe("a source's outcome is words, never a code", () => {
  const STATUSES = ["ok", "empty", "unreachable", "not_a_feed", "refused"] as const;

  it("has a distinct sentence for every status", () => {
    const said = STATUSES.map((status) => describeChiefSourceStatus(status, 2));
    expect(new Set(said).size).toBe(STATUSES.length);
    for (const sentence of said) {
      expect(sentence).not.toContain("_");
    }
  });

  it("counts results in words", () => {
    expect(describeChiefSourceStatus("ok", 1)).toBe("1 result");
    expect(describeChiefSourceStatus("ok", 4)).toBe("4 results");
  });
});
