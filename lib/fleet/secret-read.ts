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

import {
  describeFleetSecretUnreadable,
  type FleetSecretUnreadableKind,
} from "../copy/fleet-standing";
import { isSecureStoreError, type SecureStore } from "../secure-store";
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
  /**
   * Where a failed read's mechanism goes, if anywhere (MAR-684).
   *
   * The chip and the sentence stay in plain language, and the code and cause
   * would otherwise be dropped on the floor — which is how a broken read spent a
   * day being diagnosed from which recovery sentence happened to render.
   * `electron/main.ts` passes its shell log; tests and the developer GET routes
   * pass nothing and stay silent. Never a value; names, codes and causes are the
   * seam's documented log-safe set.
   */
  log?: (line: string) => void;
}

/** How one read failed, in `lib/copy/fleet-standing.ts`'s vocabulary. */
function unreadableKind(error: unknown): FleetSecretUnreadableKind {
  if (isSecureStoreError(error)) {
    if (error.code === "not_found") {
      return "missing";
    }
    if (error.code === "backend_unavailable") {
      return "unavailable";
    }
  }
  // `vault_locked`, `invalid_name`, and anything unrecognised: the reading whose
  // wrong answer destroys nothing, same tie-break as `lib/vault.ts` `get`.
  return "locked";
}

/**
 * Whether one connection's secret comes back — and, when it does not, which of
 * the three situations the person is in (MAR-676, refined by MAR-684).
 *
 * The chip still reads one boolean: `not_found`, `vault_locked` and
 * `backend_unavailable` are one fact for a chip — DASH cannot use this right
 * now. What MAR-684 added is that the *sentence* under the chip must not
 * collapse them, because "restart, then re-paste" and "connect it again" and
 * "this machine has no vault" are different next acts — a person restarted DASH
 * twice over a credential a restart could never bring back.
 */
async function resolves(
  store: Pick<SecureStore, "get">,
  secretName: string,
  log?: (line: string) => void,
): Promise<{ readable: boolean; kind: FleetSecretUnreadableKind | null }> {
  try {
    // Awaited and discarded. Not assigned, so there is no local holding a
    // credential for the rest of this function's frame.
    await store.get(secretName);
    return { readable: true, kind: null };
  } catch (error: unknown) {
    if (log !== undefined) {
      const code = isSecureStoreError(error) ? error.code : "unexpected_error";
      const cause = isSecureStoreError(error) ? error.cause_code ?? null : null;
      log(
        `[dash-shell] vault read failed for "${secretName}": ${code}` +
          (cause === null ? "" : ` (${cause})`),
      );
    }
    return { readable: false, kind: unreadableKind(error) };
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
      // getting the reassuring answer by default — as `missing`, because a
      // pointer to nothing and a pointer to a vanished entry have the same
      // recovery.
      const read =
        account === null
          ? { readable: false, kind: "missing" as const }
          : await resolves(deps.store, account.secret_name, deps.log);
      return {
        ...connector,
        held: {
          ...connector.held,
          // Set together, from this one read. The chip reads the first and the
          // paragraph reads the second, and there is no path here on which they
          // can describe different situations.
          secret_readable: read.readable,
          unreadable: read.readable
            ? null
            : describeFleetSecretUnreadable(connector.service, vaultLabel, read.kind ?? "locked"),
        },
      };
    }),
  );

  return { ...view, fleet };
}
