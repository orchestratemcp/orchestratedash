/**
 * MAR-595 finding 12: a `console.warn` after the launching terminal's reader
 * closes crashed the whole app with an uncaught `EPIPE`. `ignoreBrokenPipeErrors`
 * is the fix, exercised here without touching the real `process.stdout` — a
 * fake `EventEmitter` stands in for the writable stream.
 */

import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";

import { ignoreBrokenPipeErrors } from "../lib/shell/pipe-guard";

function fakeStream(): NodeJS.WritableStream {
  return new EventEmitter() as unknown as NodeJS.WritableStream;
}

describe("ignoreBrokenPipeErrors", () => {
  it("swallows an EPIPE error instead of letting it throw", () => {
    const stream = fakeStream();
    ignoreBrokenPipeErrors([stream]);

    const error = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
    expect(() => stream.emit("error", error)).not.toThrow();
  });

  it("rethrows any other stream error unchanged", () => {
    const stream = fakeStream();
    ignoreBrokenPipeErrors([stream]);

    const error = Object.assign(new Error("write EACCES"), { code: "EACCES" });
    expect(() => stream.emit("error", error)).toThrow("write EACCES");
  });

  it("guards every stream it is given", () => {
    const stdout = fakeStream();
    const stderr = fakeStream();
    ignoreBrokenPipeErrors([stdout, stderr]);

    const error = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
    expect(() => stdout.emit("error", error)).not.toThrow();
    expect(() => stderr.emit("error", error)).not.toThrow();
  });
});
