/**
 * MAR-676: a chip that said CONNECTED over a vault read that had failed.
 *
 * Three surfaces described one situation on 2026-08-17 and only one of them was
 * right. The AI tab's chip said **CONNECTED**, because it was drawn from
 * `held !== null` — the row, which recorded truthfully that Henrik had given DASH
 * an OpenRouter key on 10 August. The scout's briefing box said *"connect its
 * model provider"*, because the broker had actually tried and failed. And the
 * tab's own outcome line, two paragraphs under the chip, said *"DASH holds
 * OpenRouter but could not read it from windows credential manager (dpapi) just
 * now"*.
 *
 * The page was showing its own contradiction. What was missing was not a sentence
 * but a *question*: nothing between the row and the chip asked whether the
 * credential the row points at still comes back.
 *
 * These tests cover the three pieces of the answer — the decision, the words, and
 * the read — and `tests/connections-list.test.ts` covers the second renderer,
 * because there were always two components drawing this chip.
 */

import { describe, expect, it } from "vitest";

import {
  FLEET_STANDINGS,
  VAULT_LABELS,
  describeFleetSecretUnreadable,
  everyFleetStandingSentence,
  fleetStanding,
  fleetStandingChip,
} from "../lib/copy/fleet-standing";
import { withFleetSecretStandings } from "../lib/fleet/secret-read";
import { SecureStoreError, type SecureStoreBacking } from "../lib/secure-store";
import type { ConnectionsView, FleetConnectorView } from "../lib/views/types";
import { expectPlainLanguage } from "./helpers/plain-language";

/* ---------------------------------------------------------------------- *
 * The decision
 * ---------------------------------------------------------------------- */

describe("fleetStanding", () => {
  it("says connected only when the secret resolves", () => {
    // MAR-676's rule, in one line. This is the assertion the whole issue reduces
    // to, and before it the left-hand side was the only fact anybody looked at.
    expect(fleetStanding({ held: true, secret_readable: true })).toBe("connected");
    expect(fleetStanding({ held: true, secret_readable: false })).toBe("unreadable");
  });

  it("keeps not-connected apart from unreadable", () => {
    // Collapsing these would tell somebody to connect a service they already
    // connected — and doing that overwrites a credential that is probably still
    // good, which is the destruction `lib/vault.ts`' own `get` refuses to risk.
    expect(fleetStanding({ held: false, secret_readable: false })).toBe("not_connected");
    // Nothing held and a readable secret is not a state the store can be in; if it
    // ever is, the row is what decides, because a credential nobody has a record
    // of is not a connection.
    expect(fleetStanding({ held: false, secret_readable: true })).toBe("not_connected");
  });
});

describe("fleetStandingChip", () => {
  it("gives the failed read its own chip rather than reusing either neighbour", () => {
    expect(fleetStandingChip("connected")).toEqual({ label: "Connected", tone: "ok" });
    expect(fleetStandingChip("not_connected")).toEqual({ label: "Not connected", tone: "muted" });

    const unreadable = fleetStandingChip("unreadable");
    expect(unreadable.label).toBe("DASH cannot read this");
    // Amber, not red. Nothing is broken and nothing is lost, and a red chip would
    // tell somebody their setup is ruined when a restart may fix it —
    // `standingChip`'s own reasoning about a reachable-but-empty server.
    expect(unreadable.tone).toBe("warn");
  });

  it("has a chip for every standing", () => {
    // The union drives it, so a fourth standing added without a chip is a compile
    // error rather than a blank span.
    for (const standing of FLEET_STANDINGS) {
      expect(fleetStandingChip(standing).label.length).toBeGreaterThan(0);
    }
  });
});

/* ---------------------------------------------------------------------- *
 * The words
 * ---------------------------------------------------------------------- */

describe("describeFleetSecretUnreadable", () => {
  it("keeps the sentence Henrik actually read", () => {
    const said = describeFleetSecretUnreadable("OpenRouter", "Windows Credential Manager (DPAPI)");
    expect(said.headline).toBe(
      "DASH holds OpenRouter but could not read it from windows credential manager (dpapi) just now.",
    );
  });

  it("says the key is not gone, because it is not", () => {
    /*
     * The half that had to be checked rather than assumed. DASH keeps one
     * encrypted file per secret and asks the OS to decrypt it; an intact envelope
     * that will not decrypt is `vault_locked`, and `lib/vault.ts` reports it that
     * way specifically so nobody is told to re-enter a credential they already
     * gave — because doing that overwrites the good one.
     */
    const said = describeFleetSecretUnreadable("OpenRouter", "macOS Keychain");
    expect(said.meaning).toContain("still there");
    expect(said.meaning).toContain("Nothing was sent and nothing was charged");
  });

  it("names a remedy that exists on this platform", () => {
    // `describeBrokerRefusal`'s `vault_unavailable` says "unlock your keyring",
    // which is true on Linux and macOS and means nothing on Windows, where DPAPI
    // is bound to the login session and there is nothing to unlock. Restarting is
    // true everywhere; reconnecting is the fallback and not the first suggestion.
    const said = describeFleetSecretUnreadable("OpenRouter", "Windows Credential Manager (DPAPI)");
    expect(said.next_action).toContain("start it again");
    expect(said.next_action).not.toContain("keyring");
    expect(said.next_action.indexOf("start it again")).toBeLessThan(
      said.next_action.indexOf("connect OpenRouter again"),
    );
  });

  it("reads with a service that has no name", () => {
    // The possessive rule `describeNotCurated` states: callers pass a brand name
    // where one is known and a description where one is not, and "your its model
    // provider" is what a possessive in front of `service` produces.
    const said = describeFleetSecretUnreadable("its model provider", "macOS Keychain");
    for (const sentence of [said.headline, said.meaning, said.next_action]) {
      expect(sentence).not.toMatch(/your (its|the) /);
    }
  });
});

describe("the copy sweep", () => {
  it("is plain language with every vault label DASH can produce", () => {
    /*
     * The labels are swept including the one with `dpapi` in it, rather than being
     * represented by a friendly example. `lib/copy/identifiers.ts` would flag it
     * as vocabulary and it is right to — but it is the operating system's own name
     * for its credential store, which DASH did not choose and cannot improve, and
     * the sentence is more useful naming the thing the person would recognise from
     * Windows' own dialogs. So the exemption is taken here, where it shows up in a
     * diff, instead of by keeping the real string out of the set.
     */
    expectPlainLanguage(everyFleetStandingSentence(), { allow: [...VAULT_LABELS].map((label) => label.toLowerCase()) });
  });

  it("sweeps every standing and every label, derived rather than listed", () => {
    const swept = everyFleetStandingSentence().join(" ");
    for (const standing of FLEET_STANDINGS) {
      expect(swept).toContain(fleetStandingChip(standing).label);
    }
    for (const label of VAULT_LABELS) {
      expect(swept).toContain(label.toLowerCase());
    }
  });
});

/* ---------------------------------------------------------------------- *
 * The read
 * ---------------------------------------------------------------------- */

const backing: SecureStoreBacking = {
  backend: "os_keychain",
  os_backed: true,
  persists_across_restart: true,
  label: "Windows Credential Manager (DPAPI)",
};

function connector(over: Partial<FleetConnectorView> = {}): FleetConnectorView {
  return {
    provider: "openrouter",
    service: "OpenRouter",
    connector_kind: "api_key",
    ai_provider_id: "openrouter",
    purpose: "Let DASH hold your OpenRouter key.",
    help: null,
    capabilities: [],
    wider_permissions: [],
    held: {
      masked_hint: "••••abcd",
      account_hint: null,
      since: "10 August 2026",
      permissions: [],
      // What the projection produces: nothing has looked yet.
      secret_readable: false,
      unreadable: null,
    },
    accounts: [],
    agents: [],
    skipped: [],
    waiting: [],
    reach_sentence: null,
    ...over,
  };
}

function view(connectors: readonly FleetConnectorView[]): ConnectionsView {
  /*
   * Only `fleet` is read by the decorator, and the rest of `ConnectionsView` is a
   * dozen projections this has nothing to say about. The cast is the honest shape
   * for that: building all of them would be a fixture asserting things about
   * agents, runs and requirements in a file about a chip.
   *
   * `model_default` stands in for "the rest", and the test below checks it comes
   * back — a decorator that rebuilt the view instead of spreading it would drop
   * every sibling projection and the page would render empty.
   */
  return {
    fleet: [...connectors],
    model_default: { provider_id: null, model_id: null, headline: "", detail: "", in_force: "" },
  } as unknown as ConnectionsView;
}

/** A vault that answers for exactly the names it was given. */
function vault(entries: Record<string, string>): {
  get(name: string): Promise<string>;
  describeBacking(): SecureStoreBacking;
} {
  return {
    get: async (name: string): Promise<string> => {
      const value = entries[name];
      if (value === undefined) {
        throw new SecureStoreError("not_found", `No secret stored as "${name}".`, name);
      }
      return value;
    },
    describeBacking: () => backing,
  };
}

describe("withFleetSecretStandings", () => {
  it("marks a connection readable when the vault gives the secret back", async () => {
    const decorated = await withFleetSecretStandings(view([connector()]), {
      store: vault({ "dash.fleet.openrouter.api_key": "sk-live" }),
      readDefaultAccount: () => ({ secret_name: "dash.fleet.openrouter.api_key" }),
    });

    expect(decorated.fleet[0]?.held?.secret_readable).toBe(true);
    expect(decorated.fleet[0]?.held?.unreadable).toBeNull();
    // And every other projection on the view survives. A decorator that rebuilt
    // rather than spread would empty the page it was meant to correct one chip on.
    expect(decorated.model_default).not.toBeUndefined();
  });

  it("marks Henrik's exact situation unreadable, with the sentence attached", async () => {
    // A row naming a vault entry that does not answer. The store is telling the
    // truth about what he gave DASH and the vault is telling the truth about what
    // it can hand back, and until MAR-676 the page only listened to the first.
    const decorated = await withFleetSecretStandings(view([connector()]), {
      store: vault({}),
      readDefaultAccount: () => ({ secret_name: "dash.fleet.openrouter.api_key" }),
    });

    const held = decorated.fleet[0]?.held;
    expect(held?.secret_readable).toBe(false);
    expect(held?.unreadable?.headline).toContain("DASH holds OpenRouter but could not read it");
    // And the row itself is untouched: what the person gave DASH is still recorded.
    expect(held?.masked_hint).toBe("••••abcd");
    expect(held?.since).toBe("10 August 2026");
  });

  it("sets the boolean and the sentence together, so they cannot disagree", async () => {
    // The one invariant of carrying two fields for one fact. The chip reads the
    // first and the paragraph reads the second, and a path that set one without
    // the other would put an explanation under a Connected chip or a bare warning
    // chip with nothing to act on.
    const cases: Array<Record<string, string>> = [{}, { "dash.fleet.openrouter.api_key": "sk-live" }];
    for (const entries of cases) {
      const decorated = await withFleetSecretStandings(view([connector()]), {
        store: vault(entries),
        readDefaultAccount: () => ({ secret_name: "dash.fleet.openrouter.api_key" }),
      });
      const held = decorated.fleet[0]?.held;
      expect(held?.secret_readable).toBe(held?.unreadable === null);
    }
  });

  it("reads a row that vanished as unreadable rather than as fine", async () => {
    const decorated = await withFleetSecretStandings(view([connector()]), {
      store: vault({ "dash.fleet.openrouter.api_key": "sk-live" }),
      readDefaultAccount: () => null,
    });

    expect(decorated.fleet[0]?.held?.secret_readable).toBe(false);
  });

  it("leaves a connection nobody has connected alone", async () => {
    let asked = 0;
    const decorated = await withFleetSecretStandings(view([connector({ held: null })]), {
      store: vault({}),
      readDefaultAccount: () => {
        asked += 1;
        return null;
      },
    });

    // Nothing to follow, so nothing is asked. A vault read per unconnected
    // catalogue entry would be one OS call per card on a DASH with nothing set up,
    // which is every DASH on its first run.
    expect(asked).toBe(0);
    expect(decorated.fleet[0]?.held).toBeNull();
  });

  it("never puts a secret name or a secret value on the view", async () => {
    // The property that makes it acceptable to consult the vault for a chip at
    // all. `FleetConnectorView` has never carried a `secret_name`, and the boolean
    // exists so that it does not have to start.
    const decorated = await withFleetSecretStandings(view([connector()]), {
      store: vault({ "dash.fleet.openrouter.api_key": "sk-live-do-not-leak" }),
      readDefaultAccount: () => ({ secret_name: "dash.fleet.openrouter.api_key" }),
    });

    const serialized = JSON.stringify(decorated);
    expect(serialized).not.toContain("sk-live-do-not-leak");
    expect(serialized).not.toContain("dash.fleet.openrouter.api_key");
  });
});
