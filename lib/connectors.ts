/**
 * The Connections page as connectors, not as agents (MAR-570).
 *
 * Henrik, twice, about two different pages: *"cluttered and a lot of text"*, and
 * before that *"the current connection page makes no sense to me right now."* The
 * second verdict landed on MAR-533's rebuild, which answers the right four
 * questions — what can this reach, whose account, since when, used for what — and
 * answers them **once per agent per connection**. Two agents that both need Gmail
 * produce two full capability cards, and a person reading them has to work out
 * for themselves that it is one Gmail.
 *
 * So the unit changes and the content does not:
 *
 * > The connector is the unit that gets connected; the agent is the unit that
 * > needs it.
 *
 * A tile is one service. It names the agents that depend on it, and it carries
 * MAR-533's four answers unchanged — the receipt is one click away rather than
 * deleted. Nothing honest is lost; what changes is that the page no longer asks
 * a person to deduplicate it by eye.
 *
 * ## The grouping key is the provider, and this is load-bearing
 *
 * `google-gmail` is one authorization server, one client, one consent screen.
 * The `connection_id` beside it is a string the agent's author chose, and two
 * manifests have no reason to agree on one — the shipped Gmail example calls it
 * `gmail`, and nothing stops the next author calling it `mail`. Keying tiles on
 * ids would draw two Gmail tiles and reintroduce the exact duplicate this page
 * exists to kill.
 *
 * `service` is what a person reads, and it comes from the connection's own label
 * rather than from the provider string, because `google-gmail` is machine
 * vocabulary and `lib/copy/identifiers.ts` forbids it on the guided path.
 *
 * ## What a tile may claim
 *
 * Only what the rows under it already say. A tile computes no standing of its
 * own: `connected` is the same `masked_hint !== null` the card reads, and the
 * capability detail comes from `capabilityStandings`, which is MAR-533's
 * three-party intersection and not a second opinion about it. The tile's own
 * contribution is the **rollup**, and its rule is stated below with the reason a
 * cheerful default would be wrong.
 *
 * Pure, and it renders nothing — the shape `lib/connection-card.ts` and
 * `lib/host-connect.ts` established.
 */

import type { OName } from "./brand/o-cast";
import {
  classifyProof,
  type ConnectionProof,
} from "./connection-card";
import type { AgentConnections, ConnectionRowWithCredential } from "./views/types";

/* ---------------------------------------------------------------------- *
 * The dependents
 * ---------------------------------------------------------------------- */

/**
 * One agent that needs this connector, and what it is for.
 *
 * The row travels whole rather than being reduced to a boolean, because the
 * receipt this tile hides behind one click *is* that row's card — and a tile
 * that carried a summary would need a second read of the store to open it.
 */
export interface ConnectorDependent {
  agent: string;
  /** The agent's stored character, or null. Never derived here — MAR-502's rule. */
  avatar: OName | null;
  /** Whether DASH holds a credential for **this agent's** copy of the connector. */
  connected: boolean;
  /** The author's plain-language reason this agent needs it. */
  purpose: string;
  row: ConnectionRowWithCredential;
}

/* ---------------------------------------------------------------------- *
 * The tile
 * ---------------------------------------------------------------------- */

/**
 * Where a connector stands across every agent that needs it.
 *
 * Four, and the middle two are the reason this is not a boolean:
 *
 * - `connected` — every agent that needs it has a credential DASH holds.
 * - `partly_connected` — some do and some do not. **The state a boolean would
 *   lose**, and the one that most needs saying: a page reporting "connected"
 *   here would be telling somebody an agent can work when it cannot.
 * - `not_connected` — none do, and DASH can hold at least one of them, so there
 *   is something to press.
 * - `not_dash_held` — DASH holds none of them and cannot: the agents keep their
 *   own sign-ins, or another program does. Not a gap and not a fault, and it
 *   must never be drawn as one — it is the same distinction `classifyProof`
 *   draws one level down.
 */
export type ConnectorStanding =
  | "connected"
  | "partly_connected"
  | "not_connected"
  | "not_dash_held";

export interface ConnectorTile {
  /** The provider id. The grouping key, and never rendered — machine vocabulary. */
  provider: string;
  /** What a person reads: "Gmail". The connection's own label. */
  service: string;
  /** Every agent that needs this connector, in the order the page lists agents. */
  dependents: ConnectorDependent[];
  standing: ConnectorStanding;
  /**
   * What DASH can and cannot prove about this connector, from `classifyProof`.
   *
   * The strongest claim any dependent supports, so a tile with one brokered
   * agent and one that holds its own says `dash_brokered` — and the per-agent
   * detail underneath is where the difference is drawn. A tile that reported the
   * weakest would hide the receipt DASH genuinely has.
   */
  proof: ConnectionProof;
}

/**
 * Group every agent's connections into one tile per service.
 *
 * Takes the whole `ConnectionsView.agents` list, because the sharing this page
 * exists for is a fact **between** agents and a caller assembling tiles one
 * agent at a time would have to merge them afterwards — which is the merge this
 * function is.
 *
 * Order is first appearance, so the page is stable across reads and a tile does
 * not move because an agent connected something.
 */
export function buildConnectorTiles(agents: readonly AgentConnections[]): ConnectorTile[] {
  const tiles = new Map<string, ConnectorTile>();

  for (const agent of agents) {
    for (const row of agent.rows) {
      const dependent: ConnectorDependent = {
        agent: agent.name,
        avatar: agent.avatar,
        connected: row.masked_hint !== null,
        purpose: row.purpose,
        row,
      };
      const existing = tiles.get(row.provider);
      if (existing === undefined) {
        tiles.set(row.provider, {
          provider: row.provider,
          service: row.service,
          dependents: [dependent],
          // Placeholders: both are computed over the finished dependent list
          // below, because neither is a property of the first row to arrive.
          standing: "not_connected",
          proof: classifyProof(row),
        });
        continue;
      }
      existing.dependents.push(dependent);
    }
  }

  const built = [...tiles.values()].map((tile) => ({
    ...tile,
    standing: rollUpConnector(tile.dependents),
    proof: strongestProof(tile.dependents),
  }));

  /*
   * What a person can act on, first.
   *
   * Found by photographing it: the first draft ordered by first appearance,
   * which is agent order, which is alphabetical — so a store whose first agent
   * was `invoice-reviewer` opened the page on two tiles DASH cannot connect and
   * pushed Gmail below the fold. That is the MAR-576 defect on a different page:
   * the thing a person came to do, underneath the things they cannot.
   *
   * A stable partition rather than a sort key, so tiles do not reorder among
   * themselves when one connects — a page that rearranged itself under the
   * cursor after a sign-in would be the "nothing moves without saying it did"
   * rule broken at the worst moment.
   */
  const actionable = built.filter((tile) => tile.standing !== "not_dash_held");
  const rest = built.filter((tile) => tile.standing === "not_dash_held");
  return [...actionable, ...rest];
}

/**
 * One chip for several agents.
 *
 * `not_dash_held` is tested first because it is a statement about what DASH
 * *can* do and outranks every statement about what it has done: a connector
 * whose credentials live with the agents is not "not connected yet", and drawing
 * it as though a button would fix it is the dead-control failure
 * `lib/workspace.ts` names.
 *
 * An empty list cannot occur through `buildConnectorTiles` — a tile exists
 * because a row created it — and resolves to `not_dash_held` rather than to a
 * cheerful default, for `rollUpStanding`'s reason: on a page about what is safe
 * to run, the one wrong answer is the reassuring one.
 */
export function rollUpConnector(dependents: readonly ConnectorDependent[]): ConnectorStanding {
  if (dependents.length === 0) {
    return "not_dash_held";
  }
  if (dependents.every((one) => !one.row.dash_can_hold)) {
    return "not_dash_held";
  }
  // Only the agents DASH could hold a credential for can be counted as
  // connected or not: an agent that keeps its own sign-in is neither, and
  // counting it as unconnected would leave a tile permanently short of the
  // total whatever the person did.
  const holdable = dependents.filter((one) => one.row.dash_can_hold);
  const connected = holdable.filter((one) => one.connected).length;
  if (connected === 0) {
    return "not_connected";
  }
  return connected === holdable.length ? "connected" : "partly_connected";
}

/**
 * The strongest thing DASH can prove about this connector.
 *
 * Precedence is how much DASH can show, best first, which is the axis
 * `describeProof` is written along. A tile takes the strongest because the
 * per-agent rows underneath carry their own, and a tile claiming the weakest
 * would conceal a receipt DASH really has.
 */
function strongestProof(dependents: readonly ConnectorDependent[]): ConnectionProof {
  const order: ConnectionProof[] = [
    "dash_brokered",
    "handed_over",
    "agent_holds",
    "held_elsewhere",
  ];
  for (const proof of order) {
    if (dependents.some((one) => classifyProof(one.row) === proof)) {
      return proof;
    }
  }
  return "held_elsewhere";
}

/* ---------------------------------------------------------------------- *
 * What the tile says
 * ---------------------------------------------------------------------- */

export interface ConnectorSentence {
  label: string;
  tone: "ok" | "warn" | "muted";
}

/**
 * The chip, in the four tones the system already has.
 *
 * `not_dash_held` is muted rather than warned, for the reason
 * `standingChip` colours a reachable-but-empty server amber rather than red:
 * nothing is wrong, and a tone that said otherwise would tell somebody their
 * working setup is broken.
 */
export function connectorChip(standing: ConnectorStanding): ConnectorSentence {
  switch (standing) {
    case "connected":
      return { label: "Connected", tone: "ok" };
    case "partly_connected":
      return { label: "Partly connected", tone: "warn" };
    case "not_connected":
      return { label: "Not connected", tone: "muted" };
    case "not_dash_held":
      return { label: "DASH does not hold this", tone: "muted" };
  }
}

/**
 * Which agents need this, as a sentence rather than a list of chips.
 *
 * The tile's whole reason for existing, said in words: this is one connection
 * and these are the agents behind it. Named rather than counted — "used by 2
 * agents" is a number a person then has to go and expand, and the names are the
 * thing that makes "connect once" believable.
 */
export function describeDependents(tile: ConnectorTile): string {
  const names = tile.dependents.map((one) => one.agent);
  if (names.length === 1) {
    return `Needed by ${names[0] as string}.`;
  }
  if (names.length === 2) {
    return `Needed by ${names[0] as string} and ${names[1] as string}.`;
  }
  const last = names[names.length - 1] as string;
  return `Needed by ${names.slice(0, -1).join(", ")} and ${last}.`;
}

/**
 * The disclosure that has to be read **before** the sign-in (MAR-570).
 *
 * One consent fans out: `findGrantSharers` writes the grant DASH receives to
 * every agent that names this provider, so pressing Connect here reaches agents
 * the person is not looking at. That is precisely the kind of consequence
 * ADR 0002 amendment 2 says must be disclosed before the grant rather than
 * after — a sentence that arrives with the confirmation describes a window the
 * person has already entered.
 *
 * Null when nothing is shared, which is the ordinary case. An unconditional
 * "this may also connect other agents" would be a warning about nothing on most
 * tiles, and a warning that is usually about nothing is one people stop reading.
 *
 * It names what each agent gets, not just that it gets something: an agent that
 * asked for more than this consent covers still shows "you did not give this
 * one" on its own actions, and the sentence must not promise otherwise.
 */
export function describeSharedGrant(tile: ConnectorTile): string | null {
  /*
   * OAuth only, matching `findGrantSharers` exactly.
   *
   * A typed secret is not shared — it is a value a person handed DASH for a
   * named agent, with no consent screen and no scopes, and copying it elsewhere
   * would be DASH redistributing something given for one purpose. So a tile of
   * API-key rows says nothing here, because nothing is shared and a sentence
   * claiming otherwise would be the page promising what the action will not do.
   */
  const sharing = tile.dependents.filter(
    (one) => one.row.dash_can_hold && one.row.credential_kind === "oauth",
  );
  if (sharing.length < 2) {
    return null;
  }
  const names = sharing.map((one) => one.agent);
  const last = names[names.length - 1] as string;
  const list =
    names.length === 2
      ? `${names[0] as string} and ${last}`
      : `${names.slice(0, -1).join(", ")} and ${last}`;
  /*
   * Four claims in as few lines as they fit in, and the length was found by
   * photographing it: the first draft ran to six lines at 1280 and pushed the
   * tile's own Sign in button below the fold — a disclosure so long it hid the
   * thing it was disclosing about. Every claim is still here, because each one
   * is what makes the sharing acceptable rather than merely disclosed: that it
   * is one sign-in, who it reaches, that the records stay separate so one can be
   * revoked alone, and that no agent gains an action it never asked for.
   */
  return (
    `One sign-in connects ${tile.service} for ${list}. ` +
    `DASH keeps a separate record for each, so you can disconnect one without the other, ` +
    `and each agent only gets the actions it asked for.`
  );
}

/**
 * The one line above the tiles, counted rather than asserted.
 *
 * `lib/connection-card.ts`'s `summarisePage` counted connections; this counts
 * services, because that is now the unit on screen. A page that said "4
 * connections" over two tiles would be a summary disagreeing with the thing it
 * summarises — the failure mode of every hand-written line at the top of a list.
 */
export function summariseConnectors(tiles: readonly ConnectorTile[]): string {
  if (tiles.length === 0) {
    return "No agent here has asked to reach anything outside this computer.";
  }
  const services = `${String(tiles.length)} service${tiles.length === 1 ? "" : "s"}`;
  /*
   * Counted by the same rule `describeSharedGrant` uses, not by how many agents
   * name the tile.
   *
   * Found by photographing it. A "Model provider" tile is named by three agents
   * and DASH holds none of it, so the first draft counted it as shared and the
   * page said "you connect each once" about a thing there is nothing to connect.
   * A summary may only claim what the tiles under it will actually do.
   */
  const shared = tiles.filter((tile) => describeSharedGrant(tile) !== null).length;
  const waiting = tiles.filter(
    (tile) => tile.standing === "not_connected" || tile.standing === "partly_connected",
  ).length;

  const first =
    waiting === 0
      ? `${services}, and everything that needs connecting is connected.`
      : `${services}. ${String(waiting)} still ${waiting === 1 ? "needs" : "need"} connecting.`;

  return shared === 0
    ? first
    : `${first} ${String(shared)} of them ${shared === 1 ? "is" : "are"} needed by more than one agent, and you connect ${shared === 1 ? "it" : "each"} once.`;
}

/**
 * Every sentence this module can produce, for the copy sweep.
 *
 * Derived from the union and from real tile shapes rather than written out, so a
 * standing added without being added here is one the plain-language check never
 * sees — the shape `everyConnectSentence` established.
 */
export function everyConnectorSentence(tiles: readonly ConnectorTile[]): string[] {
  const standings: ConnectorStanding[] = [
    "connected",
    "partly_connected",
    "not_connected",
    "not_dash_held",
  ];
  return [
    ...standings.map((standing) => connectorChip(standing).label),
    ...tiles.flatMap((tile) => [
      tile.service,
      describeDependents(tile),
      describeSharedGrant(tile) ?? "",
    ]),
    summariseConnectors([]),
    summariseConnectors(tiles),
  ];
}
