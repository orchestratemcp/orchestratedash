/**
 * Every state of the connect-a-server flow, rendered (MAR-498).
 *
 * The issue's `merged` bar is *"every state of the flow — no host, probing,
 * reachable, unreachable, no usable ssh — rendered and screenshotted at the three
 * widths"*. The screenshots cover the four steps; MAR-536 now gives the live
 * page its named host command path, and the state renders below keep every
 * answer from that probe represented under test.
 *
 * So this file is the other half of that bar and the more durable half: it
 * renders all nine states of the check step, plus the key step both ways, and
 * asserts what each one has to say. A screenshot proves a state was drawn once
 * on one machine; this proves every state is still drawn on every run.
 *
 * The load-bearing assertion is again a negative one. The concept screen for
 * this flow has a private-key textarea on it, and the entire design is that DASH
 * draws no such field — so the whole wizard's markup is checked for one.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { CheckStep, KeyStep, StepRail } from "../app/hosts/page";
import { HOST_REACH_PROBLEMS, type HostConnectState } from "../lib/host-connect";
import { WIZARD_STEPS, describeStep } from "../lib/host-wizard";

const LABEL = "My server";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Every state the check step can be in, which is what the issue enumerates. */
const STATES: HostConnectState[] = [
  { step: "no_host" },
  { step: "awaiting_key_install", label: LABEL, public_key: "ssh-ed25519 AAAA… orchestratedash" },
  { step: "probing", label: LABEL },
  { step: "reachable", label: LABEL, runner_build: "96cef12082fe67afa3a6" },
  ...HOST_REACH_PROBLEMS.map((problem): HostConnectState => ({
    step: "unreachable",
    label: LABEL,
    problem,
  })),
];

describe("the step rail", () => {
  it("marks exactly one step current, and says so in the markup", () => {
    for (const step of WIZARD_STEPS) {
      const html = renderToStaticMarkup(<StepRail current={step} />);
      expect(html.split('aria-current="step"')).toHaveLength(2);
      expect(html).toContain(describeStep(step).label);
    }
  });

  it("hides the numbers from anything not looking at the rail", () => {
    // The position is already in the markup order. Reading "zero one" before
    // every step name is noise to somebody who cannot see it.
    const html = renderToStaticMarkup(<StepRail current="key" />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("01");
  });

  it("names every step, so none is reachable without being announced", () => {
    const html = renderToStaticMarkup(<StepRail current="provider" />);
    for (const step of WIZARD_STEPS) {
      expect(html).toContain(describeStep(step).label);
    }
  });
});

describe("the live wizard's command path", () => {
  it("uses every named host action, so the bridge actions are actual page affordances", () => {
    /*
     * MAR-518 found the meaningful failure mode: a command can be correctly
     * dispatched and still be unavailable to every page when preload never
     * exposes it. Reading the component is the appropriate proof here because
     * the server-rendered state intentionally does not invoke Electron.
     */
    const source = readFileSync(path.join(repoRoot, "app", "hosts", "page.tsx"), "utf8");
    expect(source).toContain('submitHostCommand("create"');
    expect(source).toContain('submitHostCommand("probe"');
    expect(source).toContain('submitHostCommand("forget"');
  });
});

describe("the key step", () => {
  it("draws the public half, and only the public half", () => {
    const html = renderToStaticMarkup(
      <KeyStep label={LABEL} publicKey="ssh-ed25519 AAAAC3NzaC1lZDI1 orchestratedash" />,
    );
    expect(html).toContain("ssh-ed25519 AAAAC3NzaC1lZDI1");
    expect(html).toContain("public-key");
  });

  it("says the refusal out loud in both of its own states", () => {
    /*
     * Said, rather than merely not asked. Somebody who has connected a server
     * before expects to be asked for a private key — every other tool asks — and
     * a flow that quietly does not ask reads as one that forgot rather than as
     * one that decided.
     */
    for (const key of [null, "ssh-ed25519 AAAA orchestratedash"]) {
      const html = renderToStaticMarkup(<KeyStep label={LABEL} publicKey={key} />);
      expect(html).toContain("will not ask you to paste a private key");
      expect(html).toContain('role="note"');
    }
  });

  it("draws no field that could take a private key", () => {
    /*
     * The assertion this file exists for. The concept screen has an
     * `SSH_PRIVATE_KEY` textarea with a `-----BEGIN OPENSSH PRIVATE KEY-----`
     * placeholder and a "save key to vault" checkbox; MAR-484 made DASH's
     * inability to read a private key structural, and a paste field would hand
     * it the one secret it has arranged not to be able to hold.
     *
     * Checked against the *markup* rather than against the copy, because the
     * failure mode is somebody adding an input, not somebody adding a sentence.
     */
    for (const key of [null, "ssh-ed25519 AAAA orchestratedash"]) {
      const html = renderToStaticMarkup(<KeyStep label={LABEL} publicKey={key} />);
      expect(html).not.toContain("<textarea");
      expect(html).not.toContain("<input");
      expect(html).not.toContain("BEGIN OPENSSH");
    }
  });
});

describe("every state of the check step", () => {
  it("renders all nine, each with a headline and a meaning", () => {
    for (const state of STATES) {
      const html = renderToStaticMarkup(<CheckStep state={state} />);
      expect(html.length, state.step).toBeGreaterThan(0);
      expect(html, state.step).toContain("<strong>");
    }
  });

  it("gives the six unreachable problems six different next actions", () => {
    /*
     * `lib/host-connect.ts` already asserts the six strings are distinct. This
     * asserts the *card* keeps them distinct — a renderer that dropped
     * `next_action` would leave six situations with six fixes looking like one
     * shrug, which is exactly what that module exists to prevent.
     */
    const rendered = HOST_REACH_PROBLEMS.map((problem) =>
      renderToStaticMarkup(<CheckStep state={{ step: "unreachable", label: LABEL, problem }} />),
    );
    expect(new Set(rendered).size).toBe(HOST_REACH_PROBLEMS.length);
    for (const html of rendered) {
      expect(html).toContain("next-action");
    }
  });

  it("never tells somebody a changed server identity means the server is down", () => {
    // The one state that must never read as "not reachable". The honest answer
    // is that this may not be the same server, and somebody told the wrong thing
    // here will reconnect straight past a real warning.
    const html = renderToStaticMarkup(
      <CheckStep state={{ step: "unreachable", label: LABEL, problem: "server_identity_changed" }} />,
    );
    expect(html).toContain("not the server DASH");
    expect(html).not.toContain("is down");
  });

  it("has no next action while it is probing, because there is nothing to do", () => {
    const html = renderToStaticMarkup(<CheckStep state={{ step: "probing", label: LABEL }} />);
    expect(html).not.toContain("next-action");
  });
});

describe("the deploy receipt, surfaced at last", () => {
  const reachable = renderToStaticMarkup(
    <CheckStep state={{ step: "reachable", label: LABEL, runner_build: "96cef12082fe67afa3a6" }} />,
  );

  it("appears the moment a server becomes reachable, and not before", () => {
    /*
     * ADR 0007 requires the while-closed sentence *before the first deploy*, and
     * this is the last moment that is still true. `lib/deploy/bundle.ts` has
     * built this receipt since MAR-487 and it rendered nowhere at all.
     */
    expect(reachable).toContain("Before you put an agent here");
    expect(reachable).toContain("runs there, not on this computer");

    const notYet = renderToStaticMarkup(<CheckStep state={{ step: "no_host" }} />);
    expect(notYet).not.toContain("Before you put an agent here");
  });

  it("keeps all three limits, including the unpleasant one", () => {
    expect(reachable).toContain("DASH does not hold its sign-ins");
    expect(reachable).toContain("only show you what the server still has");
    expect(reachable).toContain("Turning this off in DASH does not stop it");
  });

  it("offers the revocation that actually works", () => {
    expect(reachable).toContain("stop it on My server");
    expect(reachable).toContain("the server is what decides");
  });
});
