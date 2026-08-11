/**
 * Taking the bytes of an output off the runner that is holding them (MAR-611,
 * ADR 0017).
 *
 * `lib/agent-dom/evidence.ts` brings home what an agent *did* — telemetry into
 * runs, digests into `run_artifacts`, and the runner's index of its file-backed
 * outputs into `workspace_artifacts`. None of those three is a file. The index
 * carries a name, a size and a digest, and the bytes stay wherever the runner
 * put them.
 *
 * On this machine that gap is invisible: `workspaceDownload` in
 * `electron/main.ts` reaches the local runner over its own socket the moment
 * somebody presses Save, so the file is always one request away. On a host it is
 * the whole problem — the file exists only there, and bringing an agent home
 * removes the bundle that holds it. A bring-home that copied only the index
 * would leave the Outputs panel listing files that no longer exist anywhere.
 *
 * ## Why this is not `workspaceDownload` generalised
 *
 * It nearly is, and the difference is what makes it a separate file rather than
 * a parameter on that one. `workspaceDownload` is **one file, chosen by a
 * person, saved where they point, on a press they can repeat.** This is **every
 * file a runner still has, fetched because something else is about to be
 * destroyed, with no second chance.** The two want opposite failure behaviour:
 * a download that fails is a sentence and a shrug, and a copy that fails here
 * must stop a removal. So the properties below are this module's and not that
 * one's — a per-file ceiling, a whole-batch verdict, and a refusal that names
 * the file rather than the operation.
 *
 * ## What it does not do
 *
 * **It does not write anything.** It returns bytes and the caller decides where
 * they go — `electron/host-bring-home.ts` asks the user, in the operating
 * system's own dialog, and this module never learns the answer. That is
 * `runner/workspace.ts`'s discipline about `stored_path` kept one machine
 * further out: the runner is the only process that resolves an opaque id to a
 * location on its own disk, and DASH is the only process that knows where the
 * copy landed on this one.
 *
 * **It does not verify the digest.** The index carries `sha256` and checking it
 * here would be checking a runner's claim against the same runner's bytes, which
 * is a check that cannot fail in the way it is meant to catch. `install` re-hashes
 * because the *sender* holds an independent digest; nothing here does.
 */

import {
  addressesAnArtifact,
  type ArtifactBytesRoute,
  type RemoteRunnerChannel,
} from "./runner-channel";

/**
 * The most one output may be, in bytes.
 *
 * A bound is not optional: the response is read into memory in one piece, over a
 * pipe to a machine DASH does not administer, and an unbounded read is a way for
 * a host to end the process that is reading it. Thirty-two megabytes is half
 * what `MAX_BUNDLE_BYTES` admits in the other direction and far more than the
 * digests and reports agents in this repository produce.
 *
 * Exceeding it is a **refusal and not a truncation**. Half a file saved under
 * the name of a whole one is the failure mode this repository refuses everywhere
 * else it reads something bounded — `collect` reports `truncated`, the workspace
 * index reports `truncated` — and a bring-home that quietly halved somebody's
 * output while removing the original would be the worst version of it.
 */
export const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;

/** How long one file is waited for. Longer than a drain: this is a file, not a poll. */
const FETCH_TIMEOUT_MS = 60_000;

/** One output, as the runner's own index described it. */
export interface ArtifactToFetch {
  artifact_id: string;
  /** The name the agent gave the file. Used for the copy and for the sentence. */
  display_name: string;
  /** What the index said it weighs, used to refuse before the bytes are asked for. */
  byte_size: number;
}

/** One output that came home, or the reason it did not. */
export type FetchedArtifact =
  | { ok: true; artifact_id: string; display_name: string; bytes: Uint8Array }
  | {
      ok: false;
      artifact_id: string;
      display_name: string;
      /**
       * Why, in words a person can act on.
       *
       * Never the transport's own text: an `ssh` failure's message names a host,
       * a user, a port and a key path, which is `asFetchError`'s reason for
       * discarding it and this module's for not reintroducing it.
       */
      reason: string;
    };

/**
 * Fetch one output's bytes.
 *
 * The size is checked twice and the two checks are not redundant. The index's
 * `byte_size` is refused **before** the request, so an oversized file costs no
 * round trip and no memory; the arriving length is refused **after**, because
 * the index is a runner's claim about a file it looked at earlier and the file
 * on disk is what actually arrives.
 */
export async function fetchArtifactBytes(
  channel: RemoteRunnerChannel,
  artifact: ArtifactToFetch,
): Promise<FetchedArtifact> {
  const route: ArtifactBytesRoute = { artifact_id: artifact.artifact_id, leaf: "download" };
  const named = { artifact_id: artifact.artifact_id, display_name: artifact.display_name };

  if (!addressesAnArtifact(route)) {
    return { ok: false, ...named, reason: "DASH could not address this output on the server." };
  }
  if (artifact.byte_size > MAX_ARTIFACT_BYTES) {
    return {
      ok: false,
      ...named,
      reason: `It is larger than the ${String(MAX_ARTIFACT_BYTES / (1024 * 1024))} MB DASH will copy off a server in one go.`,
    };
  }

  let response: Response;
  try {
    response = await channel.call(route, {
      method: "GET",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, ...named, reason: "DASH could not reach the server to fetch it." };
  }

  if (!response.ok) {
    /*
     * The runner distinguishes "no such artifact" from "the record is here and
     * the bytes are not", and both arrive as a refusal with a sentence — the
     * four availability states `runner/workspace.ts` keeps meaningful all the
     * way to a button. Passed through when it is there, because it is the
     * runner's own account of its own file and it is more specific than
     * anything this module could say.
     */
    const body = (await response.json().catch(() => ({}))) as { detail?: unknown };
    return {
      ok: false,
      ...named,
      reason:
        typeof body.detail === "string" && body.detail.length > 0
          ? body.detail
          : "The server would not hand it over. It may have been moved or deleted since it was made.",
    };
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    return { ok: false, ...named, reason: "The server stopped sending it part-way through." };
  }
  if (bytes.byteLength > MAX_ARTIFACT_BYTES) {
    return {
      ok: false,
      ...named,
      reason: `It arrived larger than the ${String(MAX_ARTIFACT_BYTES / (1024 * 1024))} MB DASH will copy off a server in one go.`,
    };
  }

  return { ok: true, ...named, bytes };
}

/**
 * Fetch every output in a list, and say what came and what did not.
 *
 * **In sequence, and that is a decision.** Concurrent fetches would each spawn
 * their own `ssh` — ADR 0007 declined a pool and spawns one connection per
 * request — so a folder of twenty outputs would open twenty sessions against a
 * server the person is paying for. Sequential costs wall-clock on an act nobody
 * performs twice a day.
 *
 * **Nothing stops early.** A file that could not be fetched does not abort the
 * ones after it, because the caller's decision is about the batch: if any file
 * failed, nothing is removed, and the person is owed the list of what failed
 * rather than the first name in it.
 */
export async function fetchArtifacts(
  channel: RemoteRunnerChannel,
  artifacts: readonly ArtifactToFetch[],
): Promise<FetchedArtifact[]> {
  const fetched: FetchedArtifact[] = [];
  for (const artifact of artifacts) {
    fetched.push(await fetchArtifactBytes(channel, artifact));
  }
  return fetched;
}
