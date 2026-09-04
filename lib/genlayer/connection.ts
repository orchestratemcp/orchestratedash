/**
 * The `genlayer` connection kind — an endpoint and an address, and no key
 * (MAR-863, ADR 0033).
 *
 * ## What makes this a different kind of connection from every other one
 *
 * Every connection DASH has held until now is a **credential**. A Google
 * sign-in is a refresh token in the vault; a model provider is a key in the
 * vault; `CONNECTOR_KINDS_V1` is two flows for putting one of those two things
 * somewhere only Electron main can read it, and `lib/broker/execute.ts` is a
 * function whose entire shape is "hold a credential for the length of one
 * request and drop it".
 *
 * This one holds nothing secret at all. It is **where** to talk and **what** to
 * talk to: a JSON-RPC endpoint and a contract address. The account that signs
 * the transactions is a throwaway made per adjudication by `createAccount()` and
 * funded from Studionet's own faucet over `sim_fundAccount` — it exists for the
 * length of one run, it is never written to disk, and it holds nothing anybody
 * would want.
 *
 * That is not a convenience. It is the reason this packet adds no spend path, no
 * vault entry and no scope: **there is nothing here for the broker to gate**,
 * because there is nothing that could be spent and nothing that could leak. A
 * compromised renderer that learned the whole of this connection would have
 * learned a public URL and a public address.
 *
 * ## Why it is declared by value rather than typed into a settings page
 *
 * `CONNECTOR_KINDS_V1`' membership rule, which this file is held to: *a kind is
 * in the list because DASH has built the flow*. DASH has built exactly one
 * network's worth of this — Studionet, whose faucet is what makes a keyless
 * account possible at all — so the defaults below are that network, written out
 * where a reviewer can read them, and `resolveGenLayerConnection` is the one
 * function that turns an override into a usable connection or refuses it.
 *
 * A person who points DASH at a different endpoint gets a checked value or a
 * refusal, never a half-configured connection that fails at the third
 * transaction. `lib/copy/genlayer.ts` says the refusals in words.
 *
 * ## Pure, and importable from anywhere
 *
 * No imports at all, on `lib/connection-spec.ts`' terms: the surface that draws
 * this has to know what it is, and a module reaching a Node builtin cannot ship
 * to the renderer bundle. Nothing here reads a store, opens a socket or holds a
 * secret.
 */

/* ---------------------------------------------------------------------- *
 * The one network DASH has built the flow for
 * ---------------------------------------------------------------------- */

/**
 * The provider string, and the key everywhere this connection is named.
 *
 * The same role `google-gmail` and `openrouter` play — machine vocabulary that
 * is never rendered. `GENLAYER_SERVICE` is what a person reads.
 */
export const GENLAYER_PROVIDER = "genlayer";

/** What a person reads on the card. */
export const GENLAYER_SERVICE = "GenLayer";

/**
 * GenLayer Studionet: the test network, and the only one DASH will talk to.
 *
 * Chosen for one property and it is the property this whole design rests on —
 * **it has a faucet on the RPC**. `sim_fundAccount` gives a freshly made account
 * enough to pay for a transaction, which is what lets an adjudication run with
 * no key anywhere in DASH. A network without one would need a funded account,
 * which would need a private key, which would need the vault — and this packet's
 * central claim, that nothing is held and nothing can leak, would be gone.
 *
 * The chain id is carried so a person reading a receipt can tell which network
 * a transaction hash belongs to. DASH never decides anything from it.
 */
export const STUDIONET_RPC_URL = "https://studio.genlayer.com/api";
export const STUDIONET_CHAIN_ID = 61999;
export const STUDIONET_LABEL = "GenLayer Studionet";

/**
 * The BriefAcceptance contract, as deployed for Agent Tank.
 *
 * A default rather than a requirement: a person can point DASH at their own
 * deployment of the same contract, and `resolveGenLayerConnection` checks the
 * shape of what they typed. What DASH cannot check is whether the code at that
 * address is the contract it expects — nothing short of reading the deployed
 * source would, and Studio does not offer that over this RPC. So the honest
 * position is that this default is the one DASH has actually run against, and a
 * changed address is the person's own claim about their own deployment.
 *
 * Verified live on 2026-09-04: ten commissions from the spike's stability run,
 * plus DASH's own first probe, all readable at this address.
 */
export const STUDIONET_CONTRACT_ADDRESS = "0xD08455a5Cfc53E43731834d6C92a6FE4aA0b3B75";

/* ---------------------------------------------------------------------- *
 * The connection
 * ---------------------------------------------------------------------- */

/**
 * Where DASH sends a brief for judgement.
 *
 * Three fields, all public, none secret. Every one is a fact about a network
 * rather than about the person, which is what makes this safe to render in full
 * on a page and safe to put in a log.
 */
export interface GenLayerConnection {
  /** The JSON-RPC endpoint. Always `https`. */
  rpc_url: string;
  /** The BriefAcceptance contract this DASH judges against. */
  contract_address: string;
  /** The network's own id, carried so a receipt can say which chain it is on. */
  chain_id: number;
  /** What a person reads for the network: "GenLayer Studionet". */
  network_label: string;
  /** Whether this is the shipped default or something the person typed. */
  is_default: boolean;
}

/** Why an override could not become a connection. */
export type GenLayerConnectionRefusal =
  /** Not a URL, or not `https` — an endpoint DASH will not send a brief to. */
  | "endpoint_invalid"
  /** Not a 20-byte hex address. Nothing on chain could be at it. */
  | "address_invalid";

export type GenLayerConnectionResult =
  | { ok: true; connection: GenLayerConnection }
  | { ok: false; refusal: GenLayerConnectionRefusal };

/** What DASH ships, and what a person gets by pressing the button on day one. */
export function defaultGenLayerConnection(): GenLayerConnection {
  return {
    rpc_url: STUDIONET_RPC_URL,
    contract_address: STUDIONET_CONTRACT_ADDRESS,
    chain_id: STUDIONET_CHAIN_ID,
    network_label: STUDIONET_LABEL,
    is_default: true,
  };
}

/**
 * A contract address, exactly as every EVM-shaped chain writes one.
 *
 * `0x` and forty hex digits, case-insensitive, and nothing else. Deliberately
 * not a checksum check: the mixed-case checksum is a convention a person
 * copying an address out of a block explorer will sometimes have lost, and
 * refusing a correct address because it arrived lowercase would be DASH being
 * strict about the wrong thing. What this excludes is everything that could
 * make an address into something other than an address.
 */
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * Turn what DASH holds into the connection it will use, or refuse.
 *
 * Both overrides are optional and independent: a person may point at their own
 * contract on the shipped endpoint, or at a different endpoint entirely. An
 * absent or empty override is the default rather than a refusal — a stored blank
 * is what "never configured" looks like, and it must not read as a mistake.
 *
 * **`https` only, and no exception for localhost.** A brief is a document
 * somebody's agent wrote about their own reading, and sending it over plain
 * `http` would put it on the wire in clear on the way to a public chain. A local
 * Studio is a real thing people run; supporting it means deciding what DASH does
 * about a plaintext endpoint, and that decision belongs in the packet that adds
 * it rather than in a default nobody reviewed. `lib/shell/outbound.ts` makes the
 * same ruling about the one other place DASH reaches outward.
 */
export function resolveGenLayerConnection(overrides: {
  rpc_url?: string | null;
  contract_address?: string | null;
}): GenLayerConnectionResult {
  const base = defaultGenLayerConnection();
  const rpc = trimmed(overrides.rpc_url);
  const address = trimmed(overrides.contract_address);

  let rpcUrl = base.rpc_url;
  if (rpc !== null) {
    let parsed: URL;
    try {
      parsed = new URL(rpc);
    } catch {
      return { ok: false, refusal: "endpoint_invalid" };
    }
    if (parsed.protocol !== "https:") {
      return { ok: false, refusal: "endpoint_invalid" };
    }
    rpcUrl = parsed.toString();
  }

  let contractAddress = base.contract_address;
  if (address !== null) {
    if (!ADDRESS.test(address)) {
      return { ok: false, refusal: "address_invalid" };
    }
    contractAddress = address;
  }

  const isDefault =
    rpcUrl === base.rpc_url && contractAddress === base.contract_address;

  return {
    ok: true,
    connection: {
      rpc_url: rpcUrl,
      contract_address: contractAddress,
      chain_id: base.chain_id,
      /*
       * The label names Studionet only while the endpoint is Studionet's. A
       * person pointing at their own node has not been told which network it
       * is on, and DASH claiming one would be a sentence it cannot support —
       * the chain id it reports comes from the same place.
       */
      network_label: rpcUrl === base.rpc_url ? base.network_label : hostOf(rpcUrl),
      is_default: isDefault,
    },
  };
}

/** A stored override that is present and not blank, or null. */
function trimmed(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const clean = value.trim();
  return clean.length === 0 ? null : clean;
}

/** The host of an endpoint a person typed, for the one line that names it. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    // Unreachable: this is only called on a value `new URL` already accepted.
    return url;
  }
}
