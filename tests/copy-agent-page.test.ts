/**
 * Every word the rebuilt agent page says (MAR-609).
 *
 * ## Why this walks the module rather than listing strings
 *
 * A copy gate only sees the fields a fixture populates — that lesson is written
 * down in `tests/copy-folder.test.ts` and it applies harder here, because
 * `lib/copy/agent-page.ts` is six exported objects with nested groups inside
 * three of them. A test that named "a representative few" would be green on the
 * day somebody added a ninth. So this recurses the exported objects themselves,
 * which means a new constant is covered the moment it exists rather than the
 * moment somebody remembers to add it here.
 *
 * Function-valued entries are called with a sample argument rather than
 * skipped. Two of this module's strings are builders — the "following this run"
 * line and the declared-trigger sentence — and a template that interpolated an
 * id would be exactly the kind of leak the identifier rule exists to catch,
 * while being invisible to a walk that only looked at strings.
 */

import { describe, expect, it } from "vitest";

import {
  AGENT_ABOUT_COPY,
  AGENT_CONTROL_COPY,
  AGENT_FEED_COPY,
  AGENT_HEADER_COPY,
  AGENT_OUTPUTS_COPY,
  AGENT_RUN_PROGRESS_COPY,
  AGENT_SETTINGS_COPY,
  AGENT_TELEMETRY_COPY,
  AGENT_TILE_COPY,
  AGENT_TRIGGER_COPY,
} from "../lib/copy/agent-page";
import { expectPlainLanguage } from "./helpers/plain-language";

const MODULES = {
  AGENT_HEADER_COPY,
  AGENT_ABOUT_COPY,
  AGENT_CONTROL_COPY,
  AGENT_TILE_COPY,
  AGENT_TRIGGER_COPY,
  AGENT_SETTINGS_COPY,
  AGENT_OUTPUTS_COPY,
  AGENT_FEED_COPY,
  AGENT_TELEMETRY_COPY,
  /* MAR-680. Added the moment the export existed, which is the whole argument
     of this file's own docblock: a gate only sees the fields somebody
     remembered to list, and this one is nine strings deep in a nested object. */
  AGENT_RUN_PROGRESS_COPY,
};

/**
 * Every string reachable from one exported object, with a path for the failure
 * message.
 *
 * The sample arguments are deliberately ordinary values a person would see —
 * a clock time, a trigger label — rather than something adversarial. The point
 * is to render the template at all; what is being checked is the *surrounding*
 * words, which are the part the author wrote.
 */
function strings(value: unknown, path: string): Array<{ path: string; text: string }> {
  if (typeof value === "string") {
    return [{ path, text: value }];
  }
  if (typeof value === "function") {
    const rendered = (value as (arg: string) => unknown)("09:41");
    return typeof rendered === "string" ? [{ path: `${path}()`, text: rendered }] : [];
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, inner]) => strings(inner, `${path}.${key}`));
  }
  return [];
}

describe("the agent page's copy", () => {
  it("is plain language, every string of every export", () => {
    for (const [name, module] of Object.entries(MODULES)) {
      for (const { path, text } of strings(module, name)) {
        // Nothing is exempted. If a string ever needs an allowance it belongs
        // here in the diff with its path beside it — see `IdentifierScanOptions`
        // on why exemptions live at the call site.
        expectPlainLanguage([text], {});
        expect(text, path).not.toBe("");
      }
    }
  });

  /**
   * The three idle reasons are the behavioural heart of this issue.
   *
   * `RunNow` returned `null` for a missing snapshot, a missing pending task and
   * a read-only window alike, so a freshly added agent had no control and no
   * explanation. `buildAgentControl` returns a reason instead, and the reason
   * is only worth anything if there is a sentence behind every arm of it — a
   * missing key would render `undefined` into the page.
   */
  it("has a sentence for every reason there is no control", () => {
    for (const reason of ["not_reported", "nothing_waiting", "read_only"] as const) {
      expect(AGENT_CONTROL_COPY.idle[reason], reason).toBeTruthy();
    }
  });

  it("names the command block as quick commands, not a power switch", () => {
    expect(AGENT_CONTROL_COPY.heading).toBe("Quick commands");
  });

  /**
   * ADR 0014 declined trigger configuration, and until MAR-742 item 8 this page
   * said so in both of the two options DASH could not honour.
   *
   * **One of them is a control now** (ADR 0029). The assertion moved with it
   * rather than being deleted: the written-schedule option is still not built,
   * still says so, and the two that are built must not claim otherwise.
   */
  it("says the one trigger DASH still cannot honour is not built", () => {
    expect(AGENT_TRIGGER_COPY.on_an_interval.detail).toContain("Not built yet");
    expect(AGENT_TRIGGER_COPY.at_a_time.detail).not.toContain("Not built");
    expect(AGENT_TRIGGER_COPY.on_command.detail).not.toContain("Not built");
  });

  /**
   * ADR 0029's three liveness sentences, and the third one in particular.
   *
   * The whole risk of this feature is that a page which used to say *"nothing
   * would start it while DASH is closed"* now offers a time picker and says
   * nothing — trading a true sentence for a control. The third sentence is what
   * stops that, so it is asserted by what it has to admit rather than by its
   * phrasing: a computer that is off runs nothing, DASH reports it, and DASH
   * never quietly catches up.
   */
  it("keeps saying what a schedule cannot survive", () => {
    expect(AGENT_TRIGGER_COPY.liveness).toHaveLength(3);
    const sleeping = AGENT_TRIGGER_COPY.liveness[2] ?? "";
    expect(sleeping).toContain("asleep");
    expect(sleeping).toContain("nothing runs");
    expect(sleeping).toContain("missed");
    expect(sleeping).toContain("does not run it late");
    // And the middle sentence still promises exactly what the runner delivers.
    expect(AGENT_TRIGGER_COPY.liveness[1]).toContain("DASH closed");
  });

  /**
   * ADR 0029 decision 6, said where the decision is made rather than in a
   * document. The agent somebody is most likely to want on a timer is the one
   * whose plan curates through a model, and the refusal would otherwise be
   * discovered from a log at 03:00.
   */
  it("says a scheduled run cannot spend, and where to press instead", () => {
    expect(AGENT_TRIGGER_COPY.no_spend).toContain("cannot spend");
    expect(AGENT_TRIGGER_COPY.no_spend).toContain("Run now");
  });

  /**
   * MAR-589's ruling, held to on the one surface that renders both.
   *
   * The name row now says a rename is possible rather than claiming DASH
   * cannot do it — the write half shipped after this test was first written —
   * and the id row must still say it is DASH's internal reference rather than
   * a second name.
   */
  it("says the name is renamable and what the id is", () => {
    expect(AGENT_SETTINGS_COPY.identity.name_source).toContain("until you rename it");
    expect(AGENT_SETTINGS_COPY.identity.name_source).not.toContain("cannot rename");
    expect(AGENT_SETTINGS_COPY.identity.id_source).toContain("never changes");
  });

  /**
   * The notification row must not imply a per-agent channel. There is one
   * webhook for the whole product and a drawer that suggested otherwise would
   * be offering a setting that does not exist.
   */
  it("says notifications are product-wide rather than per agent", () => {
    expect(AGENT_SETTINGS_COPY.notifications.scope).toContain("every agent");
  });
});
