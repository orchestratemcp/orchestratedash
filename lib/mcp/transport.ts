/**
 * Which MCP transports DASH will speak, and why one of them is an install
 * (MAR-633, ADR 0020).
 *
 * MCP defines two transports. `stdio` launches the server as a subprocess and
 * speaks JSON-RPC over its stdin and stdout. Streamable HTTP posts to an
 * endpoint and reads an optional `text/event-stream` back; the older HTTP+SSE
 * pair is deprecated in the specification and DASH does not implement it.
 *
 * ## Why stdio is refused here rather than made careful elsewhere
 *
 * DASH spawns arbitrary code already — every agent is a child process DASH
 * started and did not write — so "it runs local code" is not by itself the
 * argument. Three differences are:
 *
 * 1. **An agent is a thing the person put there**, with a folder, a manifest, a
 *    panel and a run history. A server spawned to satisfy a tool call would be
 *    the only code DASH executes that is invisible in the surfaces DASH sells.
 * 2. **The published launch line is usually a download.** `npx -y some-server`
 *    is a fetch from a mutable registry of whatever version resolves at that
 *    moment, and `-y` exists to suppress the prompt that would have said so. A
 *    consent card cannot describe what will run, because at consent time nobody
 *    knows.
 * 3. **The blast radius is not the connected account.** Every permission card
 *    DASH shows is bounded by what a provider's account can do. A local process
 *    inherits DASH's own user: the home directory, the SSH keys ADR 0007's
 *    deploy path put there, `.env` files, browser profiles, and the DASH store.
 *
 * ## The refusal order is the point
 *
 * `stdio_not_admitted` is the *temporary* rule — the slice, not the shape. The
 * three rules above it are permanent, so they are checked first and win. That
 * ordering is what lets `tests/mcp-transport.test.ts` prove a well-formed stdio
 * proposal still refuses on the slice gate, while a launcher, a relative path or
 * a manifest-supplied command refuses on its own permanent ground and would go
 * on doing so on the day stdio is switched on.
 *
 * Nothing here performs I/O, spawns anything, or opens a socket. It decides
 * whether a proposal may become a connection, which is a pure function of an
 * untrusted document — the property that lets the tests attack it with no
 * Electron, no runner and no server.
 */

/** Who put this transport in front of DASH. Decides one refusal by itself. */
export type TransportProposer =
  /** A catalogue entry DASH wrote. */
  | "catalogue"
  /** A person typed it into the advanced disclosure. */
  | "person"
  /**
   * An agent's manifest asked for it.
   *
   * A manifest is a third party's JSON document. It may *ask* for a server and
   * it may never *supply* a command, because a document that names a program
   * DASH executes is remote code execution arriving through the import door
   * rather than through a consent screen. See `command_from_manifest`.
   */
  | "manifest";

/** A transport as proposed, before anything has been decided about it. */
export type McpTransportProposal =
  | { kind: "streamable_http"; url: string }
  | { kind: "stdio"; command: string; args: readonly string[] };

/** A transport DASH has admitted. Only one kind can be constructed today. */
export interface AdmittedTransport {
  kind: "streamable_http";
  /** The endpoint DASH will POST to. Normalised, credential-free, fragment-free. */
  url: string;
  /**
   * The canonical URI this server is identified by, for RFC 8707.
   *
   * MCP's authorization model requires a client to send `resource` naming the
   * canonical URI of the MCP server, and requires the server to validate that
   * the token it received was issued for it. That is what makes a token DASH
   * holds for an MCP server *audience-bound to that server* rather than a
   * credential for whatever the server fronts — the finding ADR 0020 records
   * about custody. Derived here so one value cannot drift from the URL.
   */
  resource: string;
  /** The origin every request for this connection must be built against. */
  origin: string;
}

export type TransportRefusal =
  /** The proposal is not a transport DASH recognises. */
  | "unknown_transport"
  /** A manifest tried to supply a command. Permanent. */
  | "command_from_manifest"
  /** The command is a package-manager launcher or a shell. Permanent. */
  | "launcher_forbidden"
  /** The command is not an absolute path to something already on disk. Permanent. */
  | "command_not_absolute"
  /** Well-formed stdio, and stdio is not in this slice. Temporary — see ADR 0020. */
  | "stdio_not_admitted"
  /** The URL did not parse. */
  | "url_malformed"
  /** Not `https:`, and not the loopback exception a proof harness uses. */
  | "url_not_https"
  /** The URL carried a username or password. */
  | "url_has_credentials"
  /** The URL carried a fragment, which no request can send anyway. */
  | "url_has_fragment";

export type TransportAdmission =
  | { ok: true; transport: AdmittedTransport }
  | { ok: false; refusal: TransportRefusal };

/**
 * Programs that are a way of running a different program, refused by name.
 *
 * By name rather than by heuristic, so the refusal can say which word it
 * objected to and so widening the list is a reviewed diff — the shape
 * `CONNECTOR_KINDS_V1` and `WRITE_PATHS` already have.
 *
 * **What is deliberately not here: `node`, `python`, `deno`'s script form and
 * every other interpreter.** An interpreter's risk lives in its script
 * argument, so pinning the interpreter's own digest tells a person nothing, and
 * a list that included them would look like it had solved that. It has not. It
 * is a gap the stdio ceremony has to close before stdio ships, and this slice
 * does not ship stdio at all.
 */
export const FORBIDDEN_LAUNCHERS: readonly string[] = Object.freeze([
  "npx",
  "npm",
  "pnpm",
  "pnpx",
  "yarn",
  "bun",
  "bunx",
  "uv",
  "uvx",
  "pipx",
  "sh",
  "bash",
  "zsh",
  "dash",
  "fish",
  "ksh",
  "csh",
  "cmd",
  "powershell",
  "pwsh",
  "wsl",
  "env",
  "start",
]);

/** Longest URL DASH will consider. A bound, not a guess about real endpoints. */
const MAX_URL_LENGTH = 2048;

/**
 * The loopback exception, in `loopbackProofOrigin`'s exact shape.
 *
 * `https:` only is the rule, and an unattended proof cannot obtain a
 * certificate for a server it binds in-process. So `http:` is admitted for a
 * host that is literally `127.0.0.1` — not "resolves to loopback", because what
 * `localhost` resolves to is a property of a hosts file.
 *
 * Unlike `loopbackProofOrigin` this needs no environment variable: an
 * `http://127.0.0.1` endpoint reaches nothing off this machine, so admitting it
 * grants no reach that a person typing it did not already have. What the
 * namespaced variable buys there is that a *token exchange* cannot be pointed
 * somewhere else by accident; there is no equivalent here.
 */
function isLoopback(url: URL): boolean {
  return url.protocol === "http:" && url.hostname === "127.0.0.1";
}

/**
 * The basename of a command, lowercased, with a Windows executable suffix
 * removed.
 *
 * `C:\Program Files\nodejs\npx.cmd` and `/usr/local/bin/npx` are the same
 * refusal, and a check that only looked at the string as written would catch
 * one of them.
 */
export function commandBasename(command: string): string {
  const separator = Math.max(command.lastIndexOf("/"), command.lastIndexOf("\\"));
  const base = separator === -1 ? command : command.slice(separator + 1);
  return base.toLowerCase().replace(/\.(exe|cmd|bat|com|ps1)$/u, "");
}

/**
 * Whether a path is absolute in the sense a consent card can describe: a POSIX
 * root or a Windows drive or UNC path.
 *
 * `node:path`'s `isAbsolute` answers for the platform the test happens to run
 * on, which would make `C:\...` relative on the CI Linux box and
 * `/usr/local/bin/...` relative on Henrik's Windows machine. A connection
 * proposal is a document that can travel between the two, so the question is
 * about the string rather than about the host.
 */
export function isAbsolutePath(command: string): boolean {
  return /^([/\\]|[A-Za-z]:[/\\])/u.test(command);
}

/**
 * Decide whether a proposed transport may become a connection.
 *
 * Returns a refusal rather than throwing, so every decision can be audited in
 * the same row shape as every other — `lib/broker/operations.ts` makes the same
 * choice for the same reason.
 */
export function admitTransport(
  proposal: McpTransportProposal,
  proposer: TransportProposer,
): TransportAdmission {
  if (proposal.kind === "stdio") {
    // Permanent rules first, temporary gate last. See the note at the top.
    if (proposer === "manifest") {
      return { ok: false, refusal: "command_from_manifest" };
    }
    if (FORBIDDEN_LAUNCHERS.includes(commandBasename(proposal.command))) {
      return { ok: false, refusal: "launcher_forbidden" };
    }
    if (!isAbsolutePath(proposal.command)) {
      return { ok: false, refusal: "command_not_absolute" };
    }
    return { ok: false, refusal: "stdio_not_admitted" };
  }

  if (proposal.kind !== "streamable_http") {
    return { ok: false, refusal: "unknown_transport" };
  }

  if (typeof proposal.url !== "string" || proposal.url.length > MAX_URL_LENGTH) {
    return { ok: false, refusal: "url_malformed" };
  }

  let parsed: URL;
  try {
    parsed = new URL(proposal.url);
  } catch {
    return { ok: false, refusal: "url_malformed" };
  }

  if (parsed.protocol !== "https:" && !isLoopback(parsed)) {
    return { ok: false, refusal: "url_not_https" };
  }
  // Checked before the fragment, because a URL carrying both is worth naming by
  // the more serious of the two: a credential in a URL is a credential in every
  // log line that URL ever reaches.
  if (parsed.username !== "" || parsed.password !== "") {
    return { ok: false, refusal: "url_has_credentials" };
  }
  if (parsed.hash !== "") {
    return { ok: false, refusal: "url_has_fragment" };
  }

  // The canonical resource keeps the path — two MCP servers can live at
  // `/team-a/mcp` and `/team-b/mcp` on one host, and an audience that named only
  // the origin would be a token valid at both. It drops the query, because a
  // resource identifier that varied per request would bind nothing.
  const resource = `${parsed.origin}${parsed.pathname.replace(/\/$/u, "")}`;

  return {
    ok: true,
    transport: {
      kind: "streamable_http",
      url: parsed.toString(),
      resource: resource === parsed.origin ? parsed.origin : resource,
      origin: parsed.origin,
    },
  };
}

/**
 * The sentence a person reads when a transport was refused.
 *
 * Plain language and no identifiers, because these render on the advanced
 * disclosure where the person is by definition doing something DASH has not
 * pre-approved and needs to know which rule they met.
 */
export function describeTransportRefusal(refusal: TransportRefusal): string {
  switch (refusal) {
    case "unknown_transport":
      return "DASH does not know how to talk to this kind of server.";
    case "command_from_manifest":
      return (
        "This agent's own file tried to choose a program for DASH to run on your computer. " +
        "DASH never lets an agent do that — if you want this program, you choose it yourself."
      );
    case "launcher_forbidden":
      return (
        "This would download and run whatever version of a program is published right now, " +
        "so nobody can tell you in advance what would run on your computer. Point DASH at a " +
        "program you already have instead."
      );
    case "command_not_absolute":
      return "DASH needs the full location of a program that is already on this computer.";
    case "stdio_not_admitted":
      return (
        "This server runs as a program on your computer, which DASH does not offer yet. " +
        "Servers DASH connects to over the internet work today."
      );
    case "url_malformed":
      return "That is not a web address DASH can read.";
    case "url_not_https":
      return "DASH only connects to servers over a secure address.";
    case "url_has_credentials":
      return "That address has a sign-in written into it. Remove it and connect the normal way.";
    case "url_has_fragment":
      return "That address has a part after the # that never reaches the server. Remove it.";
  }
}
