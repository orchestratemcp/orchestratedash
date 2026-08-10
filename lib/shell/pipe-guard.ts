/**
 * Stops a broken output pipe from crashing DASH (MAR-595 finding 12).
 *
 * `console.warn`/`console.error` write to `process.stdout`/`process.stderr`.
 * If whatever is reading the other end of that pipe is gone — the launching
 * terminal was closed, `| findstr` already exited — the next write fails with
 * `EPIPE`. A writable stream with no `error` listener throws on that failure,
 * which Node treats as an uncaught exception: the whole app dies over a log
 * line. Any other stream error is rethrown unchanged, so this narrows the
 * crash away for exactly the one failure mode that must never be fatal and
 * leaves every other one exactly as fatal as before.
 */
export function ignoreBrokenPipeErrors(streams: readonly NodeJS.WritableStream[]): void {
  for (const stream of streams) {
    stream.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EPIPE") {
        return;
      }
      throw error;
    });
  }
}
