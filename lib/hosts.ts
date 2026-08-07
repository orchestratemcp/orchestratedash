/**
 * A host DASH can reach, and the argument vector it is reached with (MAR-484,
 * ADR 0007).
 *
 * Pure: no `ssh`, no filesystem, no vault. `electron/ssh-host.ts` is the half
 * that touches the machine. The split is `lib/agent-dom/control-location.ts`'s
 * and it is worth the file for that module's own stated reason — "a security
 * boundary that can only be tested by standing up a server is one that mostly
 * does not get tested". Everything decided here is decided on strings, so CI
 * runs all of it on a machine with no host, no key and no network.
 *
 * ## Two credentials, and this record holds neither
 *
 * ADR 0007 runs two planes with two credentials: an SSH key for the deploy
 * plane, and the remote runner's own channel secret for the control plane. A
 * `HostRecord` names **which** key by name and holds no key material, no
 * passphrase and no channel secret. That is `ControlChannel`'s discipline —
 * the token is passed as a value and never read from a store by the module
 * that uses it — applied one layer out, and it is what lets this record be
 * written to disk, rendered, and logged.
 *
 * ## The refusal that is actually load-bearing
 *
 * `ssh` takes its options as argv. A host address of `-oProxyCommand=…` is not
 * a host: it is a flag, and `ssh` will read it as one no matter how carefully
 * the surrounding code was written, because argv has no quoting layer to get
 * wrong. So **every component that reaches argv is checked against an
 * allowlist, and a leading `-` is refused outright.**
 *
 * This is the deploy plane's version of the sentence `runner/README.md` has
 * carried for months: *the API chooses which registration to start, never what
 * to run.* Here, DASH chooses which host and which verb, never which options.
 * And it is a boundary against **DASH itself** rather than against the host —
 * DASH holds a key that could run anything there, and pretending otherwise
 * would be the dishonesty ADR 0006 spends its length avoiding. What it rules
 * out is a bad record, a bad import or a hostile build brief turning a poll
 * into arbitrary remote execution.
 */

/* ---------------------------------------------------------------------- *
 * The record
 * ---------------------------------------------------------------------- */

export interface HostRecord {
  /** DASH-minted and opaque. Never derived from the address, which can change. */
  host_id: string;
  /** What a person reads. "My server", not "root@203.0.113.4". */
  label: string;
  /** Hostname or IP literal. No scheme, no userinfo, no port — those are fields. */
  address: string;
  port: number;
  username: string;
  /**
   * Which key DASH reaches this host with, by name.
   *
   * A name rather than a path, for the reason `adapterTokenName` is a name: a
   * path is a fact about one machine's filesystem, and a record that carried
   * one would be wrong the first time a data directory moved.
   * `electron/ssh-host.ts` resolves it.
   */
  key_name: string;
  /**
   * The host's own public key fingerprint, learned at connect and pinned.
   *
   * Null before the first connection, which is a different state from "any
   * key will do" and is kept different: a null here means DASH has nothing to
   * compare against yet and the connect flow must say so.
   */
  host_fingerprint: string | null;
  added_at: string;
}

export type HostRecordProblem =
  | "malformed_label"
  | "malformed_address"
  | "malformed_username"
  | "malformed_port"
  | "malformed_key_name"
  /** A component that `ssh` would read as an option rather than a value. */
  | "option_injection";

export type HostRecordCheck =
  | { ok: true; record: HostRecord }
  | { ok: false; problem: HostRecordProblem; detail: string };

/**
 * Hostnames and IP literals, and nothing that is also shell or `ssh` syntax.
 *
 * Deliberately narrower than the RFCs: no trailing dot, no underscore, no
 * IPv6 zone index. Each of those is legal somewhere and none of them is
 * something a person types into "which server?", so admitting them would widen
 * the set of strings reaching argv for no user DASH has.
 */
const ADDRESS_PATTERN = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
/** Bracketed IPv6, which is how a person writes one and how this record stores it. */
const IPV6_PATTERN = /^\[[0-9A-Fa-f:.]{2,45}\]$/;
/** POSIX-portable account names. `useradd` enforces about this much itself. */
const USERNAME_PATTERN = /^[a-z_][a-z0-9_-]{0,31}$/;
/** Same alphabet `isValidSecretName` uses, because these two names live side by side. */
const KEY_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/;

/**
 * Check a candidate host record, or say which part is wrong.
 *
 * Every field is checked even after one fails — no, it is not: the first
 * problem is returned, because the caller renders one sentence and a person
 * fixing an address does not benefit from being told their port is also
 * suspect. `lib/import-feedback.ts` makes the same choice.
 */
export function checkHostRecord(candidate: HostRecord): HostRecordCheck {
  if (candidate.label.trim().length === 0 || candidate.label.length > 120) {
    return {
      ok: false,
      problem: "malformed_label",
      detail: "A host needs a name a person will recognise, up to 120 characters.",
    };
  }

  for (const [field, value] of [
    ["address", candidate.address],
    ["username", candidate.username],
    ["key name", candidate.key_name],
  ] as const) {
    if (value.startsWith("-")) {
      // Checked before the patterns, and separately, because this is the one
      // failure with a security story rather than a typo behind it.
      return {
        ok: false,
        problem: "option_injection",
        detail:
          `The ${field} starts with "-", which the ssh command would read as an option ` +
          `rather than a value. DASH will not send it.`,
      };
    }
  }

  if (!ADDRESS_PATTERN.test(candidate.address) && !IPV6_PATTERN.test(candidate.address)) {
    return {
      ok: false,
      problem: "malformed_address",
      detail:
        `"${candidate.address}" is not a server name or address DASH recognises. ` +
        `Use the name or IP address on its own — no "ssh://", no user name in front, and no port.`,
    };
  }
  if (!USERNAME_PATTERN.test(candidate.username)) {
    return {
      ok: false,
      problem: "malformed_username",
      detail: `"${candidate.username}" is not an account name DASH will sign in with.`,
    };
  }
  if (!Number.isInteger(candidate.port) || candidate.port < 1 || candidate.port > 65535) {
    return {
      ok: false,
      problem: "malformed_port",
      detail: `${String(candidate.port)} is not a port number.`,
    };
  }
  if (!KEY_NAME_PATTERN.test(candidate.key_name)) {
    return {
      ok: false,
      problem: "malformed_key_name",
      detail: "The key name must be 3-64 characters of lowercase letters, digits, \".\", \"-\" or \"_\".",
    };
  }

  return { ok: true, record: candidate };
}

/* ---------------------------------------------------------------------- *
 * The verb set
 * ---------------------------------------------------------------------- */

/**
 * Every verb DASH will ever send this host, as a closed set.
 *
 * ADR 0007 lists six the host helper will eventually carry — install, start,
 * stop, status, collect, connect — and says explicitly that specifying the set
 * "belongs with the deploy bridge, where there is something to validate
 * against". So exactly one is here: the control plane's, which is the plane
 * MAR-484 builds. Writing the other five now would be inventing vocabulary for
 * an implementation that does not exist, which is the failure ADR 0006 named
 * about building an import validator with nothing to validate.
 *
 * Adding a verb is a change to this array *and* to the type derived from it,
 * in one file, reviewed as a widening — which is the whole point of the set
 * being closed.
 */
export const HOST_VERBS = ["connect"] as const;
export type HostVerb = (typeof HOST_VERBS)[number];

/**
 * The `ssh` argument vector for one verb against one host.
 *
 * The options are fixed and this function composes no command line. A verb
 * takes no arguments today, and when one does it will take **arguments the
 * host helper validates**, never a command — `runner/README.md`'s rule, moved
 * one machine over and stated in its own words.
 *
 * The options are worth reading one at a time, because each is a decision:
 *
 * - `BatchMode=yes` — never prompt. A prompt from a process with no terminal
 *   is a hang, and a hang in the poll loop is a DASH that looks frozen for a
 *   reason no user could discover.
 * - `StrictHostKeyChecking=yes` and `UserKnownHostsFile` pointing at DASH's own
 *   file — the host's identity is pinned to what the connect flow recorded, and
 *   pinned in a file DASH owns rather than in the user's `~/.ssh/known_hosts`,
 *   which DASH must not edit and cannot vouch for. `accept-new` is deliberately
 *   *not* used: it would make the first connection after an address change
 *   silently trust a new key.
 * - `IdentitiesOnly=yes` — offer only the key named here. Without it `ssh`
 *   offers every key the agent holds, which would make "DASH reaches this host
 *   with this key" false and would leak which keys the user has to any host
 *   they connect to.
 * - `IdentityAgent=none` — do not consult an agent at all. ADR 0007 chose a
 *   file with a proven ACL over `ssh-agent`, and a config file elsewhere on the
 *   machine could otherwise reintroduce the agent behind that decision.
 * - `ExitOnForwardFailure` and the absence of any `-L`/`-R`/`-D` — nothing is
 *   forwarded. ADR 0007 rejected a forwarded loopback port for MAR-430's own
 *   reason, and the way to keep that true is to never pass the flag.
 */
export function sshArgv(
  record: HostRecord,
  verb: HostVerb,
  paths: { identity_file: string; known_hosts_file: string },
): string[] {
  return [
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=yes",
    "-o", `UserKnownHostsFile=${paths.known_hosts_file}`,
    "-o", "IdentitiesOnly=yes",
    "-o", "IdentityAgent=none",
    "-o", "ExitOnForwardFailure=yes",
    "-o", "ServerAliveInterval=15",
    "-o", "ConnectTimeout=10",
    "-i", paths.identity_file,
    "-p", String(record.port),
    `${record.username}@${unbracket(record.address)}`,
    verb,
  ];
}

/**
 * IPv6 is stored bracketed because that is how a person writes it and how a
 * URL would carry it, and `ssh` wants it bare in `user@host`. One place knows.
 */
function unbracket(address: string): string {
  return address.startsWith("[") && address.endsWith("]") ? address.slice(1, -1) : address;
}

/**
 * What the Connection Center says about a host, in plain language.
 *
 * ADR 0007 sets the test — "a receipt that cannot describe the arrangement
 * honestly rules the option out" — and fixes both sentences. They are here
 * rather than in a component so the copy is testable and so the second one
 * cannot be dropped by a renderer that found it discouraging.
 *
 * The second sentence is the unpleasant one and it has to be there: the pull
 * model means evidence is bounded by what survived on the host until the next
 * poll, which is a real gap and not a rendering delay.
 */
export function describeHostReach(): { while_open: string; while_closed: string } {
  return {
    while_open:
      "DASH reaches this server when it is open. Nothing on the server can reach back to this computer.",
    while_closed:
      "Agents you put on this server keep running when DASH is closed. DASH will not see what they " +
      "did until you open it again, and it can only show you what the server still has when it looks.",
  };
}
