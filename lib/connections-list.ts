/**
 * One list, keyed by service (MAR-642).
 *
 * ## The defect this closes
 *
 * The Connections page stacked two card systems with near-identical vocabulary.
 * `FleetConnectorCard` drew *what you can connect* — the catalogue, keyed by
 * provider, subject the person. `ConnectorTile` drew *what your agents need* —
 * the manifests, keyed by provider, subject the agents. Both said the service's
 * name, both said connected or not, both had a Connect button, and on a DASH
 * with one Gmail agent **both drew Gmail**, one above the other, with different
 * chips and different buttons for the same account.
 *
 * MAR-593 built the second half for a real reason — a DASH with no agents had
 * an empty page — and the two were never reconciled. This is the reconciliation:
 * the key was always `provider`, both sides already grouped on it, and nothing
 * about them was ever two lists except the rendering.
 *
 * ## What a row is
 *
 * One service. It may have a catalogue entry (DASH has built the flow), or
 * agents that named it, or both. `fleet` and `tile` are carried side by side
 * rather than blended into a third shape, which is deliberate: they answer
 * different questions and their sentences are already written — `describeSkip`,
 * `describeDependents`, `describeSharedGrant`, `describeProof` — and a merged
 * super-shape would be a third place those facts could be worded.
 *
 * ## Room for two things that do not exist yet
 *
 * MAR-642 asks for a list an **MCP server row** (MAR-633, ADR 0020) fits into
 * without a new section, and one that holds **more than one account per
 * service** (MAR-643) without a redesign. Both are shaped for here rather than
 * promised:
 *
 * - `ServiceKind` is a closed union with a third member DASH does not yet
 *   produce. Nothing switches on it beyond the glyph and one noun, so the day a
 *   catalogue entry says `server` the list draws it — and until then
 *   `tests/connections-list.test.ts` pins that no row can claim to be one.
 * - `accounts` is an **array**, always, and is empty or single today. Every
 *   sentence about it is written from the count rather than from "the account",
 *   so a second one is a longer list rather than a rewritten row. What DASH
 *   cannot do yet is *hold* two — `connection_secrets` is keyed one per
 *   (agent, connection, field) — and this file does not pretend otherwise.
 *
 * Pure, and it renders nothing: the shape `lib/connectors.ts` and
 * `lib/fleet/catalogue.ts` both keep.
 */

import { connectorChip, type ConnectorTile } from "./connectors";
import type { FleetConnectorView } from "./views/types";

/* ---------------------------------------------------------------------- *
 * The vocabulary
 * ---------------------------------------------------------------------- */

/**
 * What kind of thing a person is connecting.
 *
 * Three, and the third has no producer yet. It is here because MAR-642's brief
 * is explicit that an MCP server has to fit this list without a new section,
 * and a union that had to grow a member later is a union every `switch` over it
 * has to be revisited for. ADR 0020 decided that **an MCP server is a
 * connection**; this is that sentence in a type.
 */
export const SERVICE_KINDS = ["account", "key", "server"] as const;

export type ServiceKind = (typeof SERVICE_KINDS)[number];

/**
 * One thing DASH holds for a service.
 *
 * A list on the row rather than a field, which is MAR-643's whole shape: today
 * a service has zero or one, and the sentence above it is built from the count.
 * `hint` is masked at the source — `lib/secret-refs.ts` — and is the only part
 * of a credential that has ever existed outside the vault.
 */
export interface ServiceAccount {
  /** Which of the person's accounts, masked, or null when the provider named none. */
  hint: string | null;
  /** "since 10 August 2026", or null when the stored date cannot be read. */
  since: string | null;
}

export interface ServiceRow {
  /** The provider string. The key on both halves, and never rendered. */
  provider: string;
  /** What a person reads: "Gmail". */
  service: string;
  kind: ServiceKind;
  /** The catalogue half, or null for a service only an agent named. */
  fleet: FleetConnectorView | null;
  /** The agents' half, or null for a catalogue entry nobody has asked for. */
  tile: ConnectorTile | null;
  /** What DASH holds. Empty or one today; MAR-643 makes it many. */
  accounts: ServiceAccount[];
  /** The one status chip, and the tone the page colours it with. */
  chip: { label: string; tone: string };
}

/* ---------------------------------------------------------------------- *
 * The merge
 * ---------------------------------------------------------------------- */

/**
 * Every service, once.
 *
 * Catalogue entries first, in the order `fleetCatalogue` returns them, then the
 * services only an agent named. That order is the page's argument: what DASH
 * has built a flow for is what a person can act on today, and what an agent
 * named without a flow is a fact about that agent.
 *
 * The join is on `provider` and nothing else — the same key `buildConnectorTiles`
 * groups on and `findGrantSharers` fans a grant out over, so what a person reads
 * as one service and what DASH treats as one service cannot come apart.
 */
export function serviceRows(
  fleet: readonly FleetConnectorView[],
  tiles: readonly ConnectorTile[],
): ServiceRow[] {
  const byProvider = new Map(tiles.map((tile) => [tile.provider, tile]));
  const rows: ServiceRow[] = [];

  for (const connector of fleet) {
    rows.push(row(connector, byProvider.get(connector.provider) ?? null));
  }
  for (const tile of tiles) {
    if (!fleet.some((connector) => connector.provider === tile.provider)) {
      rows.push(row(null, tile));
    }
  }
  return rows;
}

function row(fleet: FleetConnectorView | null, tile: ConnectorTile | null): ServiceRow {
  /*
   * The service's name comes from the catalogue when there is one, and from the
   * manifest otherwise. Never from both: the catalogue's is DASH's own word for
   * a provider it has built a flow for, and an author's label for the same
   * service can differ — showing whichever is longer, or joining them, would
   * make one service look like two on the page that exists to stop that.
   */
  const service = fleet?.service ?? tile?.service ?? "";
  const provider = fleet?.provider ?? tile?.provider ?? "";

  return {
    provider,
    service,
    kind: kindOf(fleet),
    fleet,
    tile,
    accounts: accountsOf(fleet, tile),
    chip: chipOf(fleet, tile),
  };
}

/**
 * What kind of connection this is.
 *
 * Read off the catalogue's `connector_kind`, and defaulted to `account` for a
 * service only an agent named — which is the honest answer, because a manifest
 * declares a *connection* and DASH has not built a flow that would say more.
 * Nothing here can return `server`, deliberately: no catalogue entry produces
 * one yet, and a function that guessed would put a shape on screen ADR 0020 has
 * not been implemented for.
 */
function kindOf(fleet: FleetConnectorView | null): ServiceKind {
  return fleet?.connector_kind === "api_key" ? "key" : "account";
}

/**
 * What DASH holds for this service.
 *
 * The catalogue's own record first — that is the fleet connection, held once for
 * the whole DASH. Failing that, the first dependent that has a credential:
 * a grant is stored per agent, so a service several agents hold has several
 * records of one act, and listing them all would be listing DASH's bookkeeping
 * rather than the person's accounts.
 *
 * MAR-643 is where this stops being "the first" and becomes "each", and the
 * array is already the shape for it.
 */
function accountsOf(
  fleet: FleetConnectorView | null,
  tile: ConnectorTile | null,
): ServiceAccount[] {
  if (fleet?.held != null) {
    return [{ hint: fleet.held.account_hint ?? fleet.held.masked_hint, since: fleet.held.since }];
  }
  const connected = tile?.dependents.find((one) => one.row.masked_hint !== null);
  return connected === undefined ? [] : [{ hint: connected.row.masked_hint, since: null }];
}

/**
 * One chip, from whichever half knows the more interesting answer.
 *
 * When agents need this service, the chip is theirs — `connectorChip` already
 * has the three-way answer (all connected, some, none), and "Connected" over a
 * row where one of two agents cannot reach it would be the drift MAR-605 caught
 * on the Servers page in its own words.
 *
 * With no dependents there is nothing partial to report, so the chip is what
 * DASH holds.
 */
function chipOf(
  fleet: FleetConnectorView | null,
  tile: ConnectorTile | null,
): { label: string; tone: string } {
  if (tile !== null && tile.dependents.length > 0) {
    const chip = connectorChip(tile.standing);
    return { label: chip.label, tone: `chip-${chip.tone}` };
  }
  return fleet?.held != null
    ? { label: "connected", tone: "chip-ok" }
    : { label: "not connected", tone: "chip-muted" };
}

/* ---------------------------------------------------------------------- *
 * What the list says about itself
 * ---------------------------------------------------------------------- */

/**
 * The line above the list, counted over the rows it actually drew.
 *
 * `summariseConnectors`' rule, which this replaces: that function summarised
 * the tiles and `FleetConnectors` summarised the catalogue, so a page with both
 * had **two** summaries counting two different things about overlapping sets.
 * One list has one line.
 */
export function summariseServices(rows: readonly ServiceRow[]): string {
  if (rows.length === 0) {
    return "There is nothing to connect yet.";
  }
  const connected = rows.filter((one) => one.accounts.length > 0).length;
  const services = rows.length === 1 ? "1 service" : `${String(rows.length)} services`;

  if (connected === 0) {
    return `${services} DASH can connect for you. None is connected yet.`;
  }
  if (connected === rows.length) {
    return rows.length === 1
      ? "1 service, and it is connected."
      : `${services}, and all of them are connected.`;
  }
  return `${services} DASH can connect for you. ${String(connected)} of them ${connected === 1 ? "is" : "are"} connected.`;
}

/**
 * The account line on a collapsed row, or null when there is nothing to say.
 *
 * Built from the count rather than from "the account", which is the half of
 * MAR-643's shape that costs nothing today and would cost a rewrite later.
 * A provider that named no account gets the honest sentence rather than "your
 * account" — DASH asserting something it was not told.
 */
export function describeAccounts(accounts: readonly ServiceAccount[]): string | null {
  if (accounts.length === 0) {
    return null;
  }
  if (accounts.length > 1) {
    return `${String(accounts.length)} accounts`;
  }
  const only = accounts[0] as ServiceAccount;
  const who = only.hint ?? "An account the provider did not name";
  return only.since === null ? who : `${who}, since ${only.since}`;
}

/** What the expansion is called, given what is behind it. */
export function describeExpansion(row: ServiceRow): string {
  const needed = row.tile?.dependents.length ?? 0;
  if (needed === 0) {
    return row.accounts.length > 0
      ? "What DASH can do with this"
      : "What DASH would be able to do";
  }
  return needed === 1
    ? "What DASH can do, and what the one agent that needs it may do"
    : `What DASH can do, and what each of the ${String(needed)} agents that need it may do`;
}

/** Every sentence this module can produce, for the plain-language check. */
export function everyServiceListSentence(): string[] {
  const accounts: ServiceAccount[][] = [
    [],
    [{ hint: null, since: null }],
    [{ hint: "he••••@example.com", since: "10 August 2026" }],
    [
      { hint: "one@example.com", since: null },
      { hint: "two@example.com", since: null },
    ],
  ];
  const counts = [0, 1, 2, 3];

  return [
    summariseServices([]),
    ...counts.flatMap((connected) =>
      counts.map((total) =>
        summariseServices(
          Array.from({ length: total }, (_, index) => ({
            provider: `p${String(index)}`,
            service: "A service",
            kind: "account" as ServiceKind,
            fleet: null,
            tile: null,
            accounts: index < connected ? [{ hint: null, since: null }] : [],
            chip: { label: "not connected", tone: "chip-muted" },
          })),
        ),
      ),
    ),
    ...accounts.map((one) => describeAccounts(one) ?? ""),
    ...[0, 1, 2].flatMap((needed) =>
      [0, 1].map((held) =>
        describeExpansion({
          provider: "p",
          service: "A service",
          kind: "account",
          fleet: null,
          tile:
            needed === 0
              ? null
              : ({
                  provider: "p",
                  service: "A service",
                  standing: "connected",
                  proof: "dash_brokered",
                  dependents: Array.from({ length: needed }, () => ({})),
                } as unknown as ConnectorTile),
          accounts: held === 0 ? [] : [{ hint: null, since: null }],
          chip: { label: "not connected", tone: "chip-muted" },
        }),
      ),
    ),
  ];
}
