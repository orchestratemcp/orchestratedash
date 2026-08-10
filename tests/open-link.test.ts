/**
 * `dash://open?…`, the second deep link (MAR-588).
 *
 * The handoff link's tests are about a URL that could end with DASH spawning a
 * program. These are about a URL that can only ever end with a page being shown
 * — and the reason they are worth writing anyway is where this link *travels*:
 * into a Discord channel, which has members, can be forwarded out of, and is the
 * one place in DASH's design where a link leaves the machine that wrote it.
 *
 * So the checks are shaped around what somebody could do by editing one in
 * transit and sending it back.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { HANDOFF_HOST, HANDOFF_SCHEME } from "../lib/handoff";
import { OPEN_HOST, buildOpenLink, deepLinkAuthority, parseOpenLink } from "../lib/open-link";
import { findDeepLink } from "../lib/shell/deep-link";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("the two authorities stay apart", () => {
  it("is a different authority from the handoff, on the same scheme", () => {
    expect(OPEN_HOST).not.toBe(HANDOFF_HOST);
    expect(deepLinkAuthority(buildOpenLink({ agent: "a", run: null }))).toBe(OPEN_HOST);
    expect(deepLinkAuthority(`${HANDOFF_SCHEME}://${HANDOFF_HOST}?file=x&nonce=y`)).toBe(
      HANDOFF_HOST,
    );
  });

  it("is found by the same argv scan the handoff link is", () => {
    // Windows appends the URL to a second copy's argv, so a link that the
    // finder did not recognise would never reach either parser.
    const link = buildOpenLink({ agent: "ledger", run: null });
    expect(findDeepLink(["electron.exe", "C:\\project", link])).toBe(link);
  });

  it("refuses a handoff URL, and the handoff authority refuses this one", () => {
    expect(parseOpenLink(`${HANDOFF_SCHEME}://${HANDOFF_HOST}?file=x`).ok).toBe(false);
    expect(deepLinkAuthority("https://example.com/open?agent=a")).toBe(null);
  });
});

describe("what a link may name", () => {
  it("round-trips an agent, with and without a run", () => {
    const withRun = parseOpenLink(buildOpenLink({ agent: "ai-agent-news", run: "run-3" }));
    expect(withRun.ok && withRun.target).toEqual({ agent: "ai-agent-news", run: "run-3" });

    const without = parseOpenLink(buildOpenLink({ agent: "ai-agent-news", run: null }));
    expect(without.ok && without.target).toEqual({ agent: "ai-agent-news", run: null });
  });

  /**
   * The rule MAR-421 makes law and this link inherits: no approval token in any
   * URL. Enforced as *refusal of anything extra* rather than as a deny-list, so
   * a parameter nobody has thought of yet is covered too.
   */
  it("refuses a third parameter whatever it is called", () => {
    const base = buildOpenLink({ agent: "ledger", run: null });
    for (const extra of ["approval_id=ap-1", "token=abc", "nonce=deadbeef", "answer=yes"]) {
      const parsed = parseOpenLink(`${base}&${extra}`);
      expect(parsed.ok).toBe(false);
      expect(parsed.ok === false && parsed.refusal).toBe("unexpected_param");
    }
  });

  it("refuses an agent id that was never a legal agent id", () => {
    for (const bad of ["../other", "A", "has space", "-leading", ""]) {
      expect(parseOpenLink(`${HANDOFF_SCHEME}://${OPEN_HOST}?agent=${encodeURIComponent(bad)}`).ok).toBe(
        false,
      );
    }
  });

  it("refuses a run id carrying a separator", () => {
    expect(
      parseOpenLink(`${HANDOFF_SCHEME}://${OPEN_HOST}?agent=ledger&run=${encodeURIComponent("a/b")}`)
        .ok,
    ).toBe(false);
  });

  it("refuses a link with no agent at all", () => {
    const parsed = parseOpenLink(`${HANDOFF_SCHEME}://${OPEN_HOST}`);
    expect(parsed.ok === false && parsed.refusal).toBe("missing_agent");
  });

  it("refuses another scheme wearing the same authority", () => {
    const parsed = parseOpenLink(`https://${OPEN_HOST}?agent=ledger`);
    expect(parsed.ok === false && parsed.refusal).toBe("wrong_scheme");
  });
});

/**
 * `lib/open-link.ts` restates `lib/handoff.ts`'s agent-id rule rather than
 * importing it, because that constant is deliberately private to the module
 * whose boundary it is. Restating means the two can drift, so this is the check
 * that says they have not — by reading the other file, which is the only
 * direction available.
 */
it("keeps the agent id rule byte-identical to the handoff's", () => {
  const handoff = readFileSync(path.join(repoRoot, "lib", "handoff.ts"), "utf8");
  const open = readFileSync(path.join(repoRoot, "lib", "open-link.ts"), "utf8");
  const pattern = /const AGENT_ID = (\/\^.*\$\/);/u;

  const inHandoff = pattern.exec(handoff)?.[1];
  const inOpen = pattern.exec(open)?.[1];
  expect(inHandoff).toBeDefined();
  expect(inOpen).toBe(inHandoff);
});
