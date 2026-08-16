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
   * ADR 0014 declined trigger configuration and this page must not imply
   * otherwise. The two options DASH cannot honour say so in their own detail
   * line; a future edit that made them read as available would be the page
   * promising a scheduler that "exists nowhere in this repository".
   */
  it("says the two triggers DASH cannot honour are not built", () => {
    expect(AGENT_TRIGGER_COPY.at_a_time.detail).toContain("Not built yet");
    expect(AGENT_TRIGGER_COPY.on_an_interval.detail).toContain("Not built yet");
    expect(AGENT_TRIGGER_COPY.on_command.detail).not.toContain("Not built");
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
