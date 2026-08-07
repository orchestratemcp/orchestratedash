/**
 * A runner that speaks HTTP over its own stdio (MAR-484).
 *
 * ADR 0007's claim about what CI can prove rests on this file existing: "a test
 * can spawn a local child that speaks HTTP over its own stdio and exercise
 * every property `ipcFetch` is tested for — the byte ceiling, the abort path,
 * the `unavailable`/`failed` split — with no SSH, no host and no network."
 *
 * On a real host the far end of the pipe is a helper joining the runner's Unix
 * socket to the `connect` verb's stdio. Here it is a real `node:http` server
 * handed a duplex over this process's own stdin and stdout, so the bytes on the
 * pipe are the bytes a host would send. **The only variable between this and the
 * attended proof is which process is on the other end.**
 *
 * `server.emit("connection", socket)` is the whole trick: `node:http` never
 * required a TCP socket, only something duplex it can parse and write. The
 * no-op socket methods below are the ones the server calls and a `Duplex` does
 * not have.
 *
 * Every diagnostic goes to stderr. Anything written to stdout is HTTP.
 */

import http from "node:http";
import { Duplex } from "node:stream";

const server = http.createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => {
    body += chunk;
  });
  request.on("end", () => {
    if (request.url === "/slow") {
      // Never answers. The abort path needs an endpoint that does not.
      return;
    }
    if (request.url === "/huge") {
      // Larger than `MAX_RESPONSE_BYTES`, so the ceiling in
      // `lib/agent-dom/transport.ts` has something to refuse.
      response.writeHead(200, { "content-type": "application/json" });
      response.end(`{"filler":"${"x".repeat(1_200_000)}"}`);
      return;
    }
    if (request.url === "/unauthorized") {
      response.writeHead(401, { "content-type": "application/json" });
      response.end('{"ok":false,"detail":"Unauthorized."}');
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        ok: true,
        path: request.url,
        method: request.method,
        // Echoed so a test can prove the bearer travelled, without this fixture
        // ever needing to know what the value means.
        authorization: request.headers.authorization ?? null,
        body,
      }),
    );
  });
});

const socket = Duplex.from({ readable: process.stdin, writable: process.stdout });
for (const name of ["setTimeout", "setNoDelay", "setKeepAlive", "ref", "unref"]) {
  socket[name] = () => socket;
}
server.emit("connection", socket);
