/**
 * Taking an output's bytes off a runner, and what stops it (MAR-611, ADR 0017).
 *
 * The interesting assertions here are all refusals, and they exist because this
 * module is called by something that is about to destroy the original. A
 * truncated file, a half-read stream or an oversized read that ends the process
 * are each a way to lose somebody's output while reporting success.
 */

import { describe, expect, it } from "vitest";

import {
  MAX_ARTIFACT_BYTES,
  fetchArtifactBytes,
  fetchArtifacts,
} from "../lib/agent-dom/artifact-bytes";
import type { RemoteRunnerChannel } from "../lib/agent-dom/runner-channel";

/** A channel whose one route answers whatever a test hands it. */
function channelServing(
  answer: (artifactId: string) => Response | Promise<Response> | Promise<never>,
): { channel: RemoteRunnerChannel; asked: string[] } {
  const asked: string[] = [];
  const channel = {
    origin: "http://runner.invalid",
    token: "t",
    call: async (route: unknown) => {
      const id = (route as { artifact_id: string }).artifact_id;
      asked.push(id);
      return await answer(id);
    },
  } as unknown as RemoteRunnerChannel;
  return { channel, asked };
}

function wanted(over: Partial<{ artifact_id: string; display_name: string; byte_size: number }> = {}) {
  return { artifact_id: "art-1", display_name: "digest.txt", byte_size: 12, ...over };
}

describe("fetching one output", () => {
  it("returns the bytes the runner served", async () => {
    const { channel } = channelServing(() => new Response(new Uint8Array([1, 2, 3])));
    const fetched = await fetchArtifactBytes(channel, wanted({ byte_size: 3 }));

    expect(fetched.ok).toBe(true);
    expect(fetched.ok && [...fetched.bytes]).toEqual([1, 2, 3]);
  });

  it("refuses an oversized file before it asks for it", async () => {
    /*
     * Two size checks, and they are not redundant. This one spends no round trip
     * and no memory, because the index already said how big the file is.
     */
    const { channel, asked } = channelServing(() => new Response(new Uint8Array([1])));
    const fetched = await fetchArtifactBytes(
      channel,
      wanted({ byte_size: MAX_ARTIFACT_BYTES + 1, display_name: "recording.wav" }),
    );

    expect(fetched.ok).toBe(false);
    expect(asked).toEqual([]);
    expect(fetched.ok ? "" : fetched.reason).toContain("32 MB");
  });

  it("refuses bytes that arrive larger than the index claimed", async () => {
    /*
     * And this one is why the first is not enough: the index is a runner's claim
     * about a file it looked at earlier, and what arrives is the file on disk.
     * A refusal rather than a truncation — half a file saved under the name of a
     * whole one, while the original is about to be removed, is the worst outcome
     * available here.
     */
    const { channel } = channelServing(
      () => new Response(new Uint8Array(MAX_ARTIFACT_BYTES + 8)),
    );
    const fetched = await fetchArtifactBytes(channel, wanted({ byte_size: 10 }));

    expect(fetched.ok).toBe(false);
    expect(fetched.ok ? "" : fetched.reason).toContain("arrived larger");
  });

  it("passes on the runner's own account of a file it will not hand over", async () => {
    // The runner distinguishes "no such artifact" from "the record is here and
    // the bytes are not". That distinction is what keeps the availability states
    // meaningful all the way to the person, so it travels rather than being
    // replaced.
    const { channel } = channelServing(
      () =>
        new Response(JSON.stringify({ detail: "The file was moved after the run finished." }), {
          status: 410,
        }),
    );
    const fetched = await fetchArtifactBytes(channel, wanted());

    expect(fetched.ok).toBe(false);
    expect(fetched.ok ? "" : fetched.reason).toBe("The file was moved after the run finished.");
  });

  it("never quotes the transport's own error", async () => {
    /*
     * An `ssh` failure's message names a host, a user, a port and a key path.
     * `asFetchError` discards it for that reason and this module must not put it
     * back — the reason string here reaches a surface.
     */
    const { channel } = channelServing(() =>
      Promise.reject(new Error("ssh: connect to host 203.0.113.9 port 22: refused")),
    );
    const fetched = await fetchArtifactBytes(channel, wanted());

    expect(fetched.ok).toBe(false);
    expect(fetched.ok ? "" : fetched.reason).not.toContain("203.0.113.9");
  });

  it("refuses an artifact id that would not stay in its own segment", async () => {
    const { channel, asked } = channelServing(() => new Response(new Uint8Array([1])));
    const fetched = await fetchArtifactBytes(channel, wanted({ artifact_id: ".." }));

    expect(fetched.ok).toBe(false);
    expect(asked).toEqual([]);
  });
});

describe("fetching a batch", () => {
  it("asks one at a time and does not stop at the first failure", async () => {
    /*
     * Sequential, because ADR 0007 spawns one `ssh` per request and declined a
     * pool — twenty concurrent fetches would open twenty sessions against a
     * server somebody is paying for.
     *
     * And nothing stops early, because the caller's decision is about the whole
     * batch: if any file failed, nothing is removed, and the person is owed the
     * list of what failed rather than the first name in it.
     */
    const { channel, asked } = channelServing((id) =>
      id === "bad" ? new Response("no", { status: 500 }) : new Response(new Uint8Array([7])),
    );

    const fetched = await fetchArtifacts(channel, [
      wanted({ artifact_id: "one" }),
      wanted({ artifact_id: "bad" }),
      wanted({ artifact_id: "two" }),
    ]);

    expect(asked).toEqual(["one", "bad", "two"]);
    expect(fetched.map((one) => one.ok)).toEqual([true, false, true]);
  });
});
