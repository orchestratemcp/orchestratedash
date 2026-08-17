/**
 * Does the credential DASH's row points at still come back out of the vault?
 * (MAR-676)
 *
 * `lib/views/build.ts` projects the store and stays synchronous, which is right:
 * a view is a read of SQLite and nothing else. But `fleet_connections` holds a
 * `secret_name`, and a name is a *pointer*. Henrik's row pointed at a vault entry
 * the OS would not decrypt, and every surface downstream reported CONNECTED from
 * the pointer — which is how a true record built a false chip.
 *
 * This is the one step that follows the pointer. It runs after the projection,
 * where a vault is actually available, and adds one boolean per connection.
 *
 * ## Three properties, and each one is a rule rather than a detail
 *
 * **No secret value goes anywhere.** `store.get` is awaited and its result is
 * never bound. The only thing that leaves this module is whether the call
 * succeeded, which is what `lib/secure-store.ts` means when it says names and
 * errors are safe and values are not.
 *
 * **No secret *name* goes anywhere either.** `FleetConnectorView` deliberately
 * carries no `secret_name` — the renderer has never been told where a credential
 * lives and must not start being told now. The names are read from the store here
 * and stay here.
 *
 * **Which account is asked is not decided twice.** `held` on the view describes
 * the default account, resolved by `readFleetConnection(provider)`. This asks the
 * same function for the same row, so the boolean is about the account the chip is
 * about. Two independent answers to "which account is this card showing" is the
 * `applyFleetDefault` mistake in a new place.
 *
 * ## What it costs
 *
 * One vault read per connected service, when the Settings page is read. Not per
 * frame and not per render: `view.connections` is answered on navigation. The
 * broker already does exactly this read on every run, so nothing here is a new
 * kind of access — it is the same question asked before the answer is claimed on
 * screen rather than after.
 */

import { describeFleetSecretUnreadable } from "../copy/fleet-standing";
import type { SecureStore } from "../secure-store";
import type { ConnectionsView } from "../views/types";
import { readFleetConnection } from "./store";

export interface FleetSecretReadDeps {
  /**
   * `get` for the read and `describeBacking` for the one sentence that names the
   * credential store. Both, because this is the only step in the chain that has a
   * vault at all — the projection before it does not and the renderer must not.
   */
  store: Pick<SecureStore, "get" | "describeBacking">;
  /**
   * The account `held` describes, or null when nothing is connected.
   *
   * Injected so a test can drive this without a store, and defaulted to the same
   * function `lib/views/build.ts` builds `held` from — see the header on why that
   * is the same function rather than an equivalent one.
   */
  readDefaultAccount?: (provider: string) => { secret_name: string } | null;
}

/**
 * Whether one connection's secret comes back, with every failure reading false.
 *
 * Every `SecureStoreErrorCode` lands here as the same answer, and that is
 * deliberate: `not_found`, `vault_locked` and `backend_unavailable` are three
 * different recoveries for the *broker*, and for a chip they are one fact — DASH
 * cannot use this right now. The sentence under the chip says which situation the
 * person is in without the chip having to carry three states nobody asked for.
 */
async function resolves(store: Pick<SecureStore, "get">, secretName: string): Promise<boolean> {
  try {
    // Awaited and discarded. Not assigned, so there is no local holding a
    // credential for the rest of this function's frame.
    await store.get(secretName);
    return true;
  } catch {
    return false;
  }
}

/**
 * The same view with every credential-backed connection's read filled in.
 *
 * A new object rather than a mutation of the argument, for the reason every
 * projection in `lib/views/` is built that way: the caller handed this a value it
 * may still be holding, and a decorator that edited it in place would make "the
 * view" mean something different before and after this call.
 *
 * A connection with no `held` is left alone — there is nothing to read, and
 * `fleetStanding` reads an absent row as `not_connected` without asking.
 */
export async function withFleetSecretStandings(
  view: ConnectionsView,
  deps: FleetSecretReadDeps,
): Promise<ConnectionsView> {
  const readAccount = deps.readDefaultAccount ?? ((provider: string) => readFleetConnection(provider));
  const vaultLabel = deps.store.describeBacking().label;

  const fleet = await Promise.all(
    view.fleet.map(async (connector) => {
      if (connector.held === null) {
        return connector;
      }
      const account = readAccount(connector.provider);
      // A row that went away between the projection and this read is not a
      // successful read of anything, so it falls in with the failures rather than
      // getting the reassuring answer by default.
      const readable = account === null ? false : await resolves(deps.store, account.secret_name);
      return {
        ...connector,
        held: {
          ...connector.held,
          // Set together, from this one boolean. The chip reads the first and the
          // paragraph reads the second, and there is no path here on which they
          // can describe different situations.
          secret_readable: readable,
          unreadable: readable ? null : describeFleetSecretUnreadable(connector.service, vaultLabel),
        },
      };
    }),
  );

  return { ...view, fleet };
}
