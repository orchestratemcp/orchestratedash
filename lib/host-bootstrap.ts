/**
 * Getting the helper onto a server that has never heard of DASH (MAR-573,
 * ADR 0007, ADR 0009).
 *
 * Pure. It composes text and touches nothing: `electron/ssh-host.ts` reads the
 * helper's bytes and `electron/main.ts` hands them here, for `lib/hosts.ts`'s
 * reason — everything decided in this file is decided on strings, so CI runs
 * all of it on a machine with no host and no network.
 *
 * ## The circle this breaks
 *
 * ADR 0007 says the helper travels *inside the bundle DASH pushes*. Pushing a
 * bundle is the `install` verb. Answering a verb needs the helper. So a freshly
 * rented server could never reach a state where any verb answered, and the
 * attended run on 2026-08-08 proved it in the plainest possible way: DASH
 * authenticated to a real sshd — its own minted key, in the host's `auth.log` —
 * and the host replied `status: command not found`. Nothing in the product got
 * a helper onto a host; the run did it by hand.
 *
 * The way out is not a smaller bundle or a cleverer verb. It is one thing a
 * person pastes into their server once, before DASH has any way in at all. That
 * is what this file builds.
 *
 * ## Why the helper is embedded rather than downloaded
 *
 * The script carries the helper as base64 — about twenty-five kilobytes of it —
 * instead of fetching it from somewhere. Three reasons, in the order they
 * decided it:
 *
 * 1. **There is nowhere to fetch it from.** DASH has no server and is not
 *    getting one; a download URL would be a hosting bill and an availability
 *    dependency for a product whose whole claim is that it runs on your own
 *    machine.
 * 2. **The bytes are the ones this DASH shipped.** A downloaded helper is
 *    whatever the far end has today, which may be a different build from the
 *    one this DASH's deploy path expects. Embedding makes "the host is running
 *    the build this DASH shipped" true by construction rather than by version
 *    negotiation.
 * 3. **It can be read before it is run.** A snippet whose interesting line is
 *    `curl … | sh` asks somebody to trust a URL. This one is long, but every
 *    action in it is visible in the text they are pasting, and it says what it
 *    will do before it does any of it.
 *
 * The one thing it does download is Node itself, from `nodejs.org`, because
 * Ubuntu 24.04 ships none new enough — `engines` requires 22.5.0 and the runner
 * needs `node:sqlite`, which arrived there. The download is checked against
 * that release's own published digest list, and the script says out loud what
 * that check is and is not worth.
 *
 * ## Line endings, which broke the first attempt
 *
 * A script written on Windows and shipped to a POSIX shell arrives with `\r`
 * and the shell answers `$'\r': command not found`. Every string here is joined
 * with `\n` and a test asserts the result carries no `\r` at all — the
 * generator is the only place that could introduce one. The embedded payload is
 * additionally decoded through `tr -d '\r'`, because that is the one place a
 * stray carriage return would corrupt bytes silently rather than fail loudly,
 * and the header comment names the symptom and its one-line fix so a script
 * that somehow arrives mangled explains itself.
 */

/* ---------------------------------------------------------------------- *
 * The decisions, as values
 * ---------------------------------------------------------------------- */

/**
 * Where everything DASH puts on a host lives, and it is one directory.
 *
 * Not `/usr/local/bin`, which is shared with whatever else the person installs
 * and would make "what did DASH leave behind" a question with a scattered
 * answer. One directory is a thing somebody can delete in one command, and the
 * script tells them that command.
 */
export const HOST_INSTALL_ROOT = "/opt/orchestratedash";

/**
 * The Node this installs when the host has nothing new enough.
 *
 * Pinned rather than "latest", so the bytes a host receives are decided by this
 * repository at review time rather than by whatever was published the morning
 * somebody ran the setup. This exact version was proven on Ubuntu 24.04 during
 * the 2026-08-08 attended run; changing it is a change to a pinned dependency
 * and should be treated as one.
 */
export const BOOTSTRAP_NODE_VERSION = "24.19.0";

/**
 * The floor `package.json` sets, repeated here because this script enforces it
 * on a machine that has never seen `package.json`.
 *
 * A host with its own Node at or above this is left alone — the second-commonest
 * complaint about setup scripts, after the ones that do not work, is the ones
 * that install a second copy of something you already had.
 */
export const MINIMUM_NODE_VERSION = "22.5.0";

/**
 * What the person is told before anything happens, and what a surface can show
 * them beside the snippet.
 *
 * Derived into the script's own banner rather than written twice, so the
 * printed promise and this list cannot drift apart. MAR-573's second acceptance
 * bar — *"the bootstrap states what it will install before it runs, and what it
 * leaves behind"* — is this function plus the two lines in `buildBootstrapScript`
 * that print it.
 */
export function describeBootstrap(): {
  needs: string[];
  installs: string[];
  leaves_behind: string[];
  removal: string;
} {
  return {
    needs: [
      "A server you have just rented, running Ubuntu, and the ability to run commands on it as an administrator.",
      "The server needs to be able to reach the internet to download the program DASH's agents run on.",
    ],
    installs: [
      `A copy of Node, the program agents run on, into ${HOST_INSTALL_ROOT}. Nothing outside that folder changes, and a version you already have is used instead.`,
      `DASH's small helper program, into the same folder. It is the only thing DASH ever talks to on this server.`,
      "One line in this account's list of allowed keys, so DASH can sign in — and it is written so that DASH's key can run the helper and nothing else.",
    ],
    leaves_behind: [
      `The folder ${HOST_INSTALL_ROOT}.`,
      "One line in the account's list of allowed keys.",
      "A folder in the account's home directory where agents you send later keep their files.",
    ],
    removal: `rm -rf ${HOST_INSTALL_ROOT}`,
  };
}

/* ---------------------------------------------------------------------- *
 * The line that goes into authorized_keys
 * ---------------------------------------------------------------------- */

/**
 * DASH's key, restricted so that it cannot be used for anything but the helper.
 *
 * This is ADR 0009's decision made concrete, and it is worth being precise
 * about what changes. ADR 0007 already promised that *DASH chooses which
 * operation, never what to run* — a promise kept by `lib/deploy/verbs.ts`
 * drawing every verb from a closed array. That promise was about DASH's own
 * code being unable to compose a command. It said nothing about what the key
 * itself could do if something other than DASH ever held it.
 *
 * `command="…"` moves the promise into the host's own configuration. `sshd`
 * runs the named program no matter what the client asked for, and puts the
 * client's request in `SSH_ORIGINAL_COMMAND` for the program to read or ignore.
 * So a key exfiltrated from this machine cannot open a shell on the server: it
 * can run the helper, whose entire vocabulary is six verbs over JSON. The
 * discipline becomes a property of the host.
 *
 * `restrict` is the other half and does the boring, important work: no port
 * forwarding, no agent forwarding, no X11, no pty, no user rc file. Each of
 * those is a way a key with a forced command can still be used for something
 * else, and OpenSSH's own switch turns off all of them plus whatever it adds
 * next release — which is why it is `restrict` rather than a hand-written list
 * that would age.
 *
 * The alternative was namespacing the verbs as `dash-status`, `dash-install`
 * and so on. It solves the smaller problem — `status`, `start`, `stop` and
 * `install` are English words and one of them is a keystroke from a package
 * tool — and none of the larger one: the key would still be a general shell.
 */
export function authorizedKeysLine(publicKey: string): string {
  return `restrict,command="${HOST_INSTALL_ROOT}/dash-host" ${publicKey.trim()}`;
}

/* ---------------------------------------------------------------------- *
 * Building the script
 * ---------------------------------------------------------------------- */

export interface BootstrapInput {
  /** The public half DASH minted for this host. Never the private one. */
  public_key: string;
  /** The account on the server DASH signs in as. */
  username: string;
  /** The helper's bytes, base64, exactly as they will land on the host. */
  helper_base64: string;
  /** SHA-256 of the decoded helper, hex. Re-checked on the host after writing. */
  helper_sha256: string;
  /** Overridable so a test can assert the pin rather than restate it. */
  node_version?: string;
}

export type BootstrapProblem =
  | "malformed_public_key"
  | "malformed_username"
  | "malformed_helper"
  | "malformed_version";

export type BootstrapScript =
  | { ok: true; script: string }
  | { ok: false; problem: BootstrapProblem; detail: string };

/**
 * DASH's own key, as it is allowed to appear in a script.
 *
 * Narrower than what `ssh-keygen` can emit, and deliberately: this is the key
 * *DASH minted*, which is always Ed25519 with the comment `orchestratedash`, so
 * every other shape reaching this function is a sign something is wrong rather
 * than a case to support. What the narrowness buys is that no character in it
 * can end a shell quote.
 */
const PUBLIC_KEY_PATTERN = /^ssh-ed25519 [A-Za-z0-9+/]+={0,3}(?: [A-Za-z0-9._@-]+)?$/;
/** Same alphabet `checkHostRecord` admits. Checked again because this reaches a shell. */
const USERNAME_PATTERN = /^[a-z_][a-z0-9_-]{0,31}$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const VERSION_PATTERN = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/**
 * The one snippet, as text.
 *
 * Every value that reaches the script is checked here first, and the check is
 * an allowlist rather than an escaper. That is the same decision `lib/hosts.ts`
 * makes about `ssh` argv and for a stronger version of the reason: a shell has
 * more ways to be surprised than `ssh` does, and the honest way to compose text
 * that a shell will execute is to admit only characters that cannot mean
 * anything in one. A value that fails is refused; nothing is quoted around a
 * string this function does not understand.
 */
export function buildBootstrapScript(input: BootstrapInput): BootstrapScript {
  const publicKey = input.public_key.trim();
  if (!PUBLIC_KEY_PATTERN.test(publicKey)) {
    return {
      ok: false,
      problem: "malformed_public_key",
      detail: "DASH did not recognise its own key for this server, so it will not write a setup step for it.",
    };
  }
  if (!USERNAME_PATTERN.test(input.username)) {
    return {
      ok: false,
      problem: "malformed_username",
      detail: `"${input.username}" is not an account name DASH will sign in with.`,
    };
  }
  if (!BASE64_PATTERN.test(input.helper_base64) || !/^[0-9a-f]{64}$/.test(input.helper_sha256)) {
    return {
      ok: false,
      problem: "malformed_helper",
      detail: "DASH could not read the helper it would put on this server.",
    };
  }
  const nodeVersion = input.node_version ?? BOOTSTRAP_NODE_VERSION;
  if (!VERSION_PATTERN.test(nodeVersion)) {
    return { ok: false, problem: "malformed_version", detail: "The Node version to install is not a version." };
  }

  const described = describeBootstrap();
  // Wrapped at 76 characters, which is what `base64` itself produces and what a
  // terminal will not reflow into something `base64 -d` cannot read.
  const payload = (input.helper_base64.match(/.{1,76}/g) ?? []).join("\n");

  const lines: string[] = [
    "#!/bin/sh",
    "#",
    "# Sets this server up for DASH. Generated by DASH; safe to read before running.",
    "#",
    "# If your shell answers with something about \\r or $'\\r', this text arrived",
    "# with Windows line endings. Fix it with:  sed -i \"s/\\r$//\" thisfile",
    "#",
    "set -eu",
    "",
    "echo \"\"",
    `echo "Setting this server up for DASH."`,
    "echo \"\"",
    "echo \"What this installs:\"",
    ...described.installs.map((line) => `echo "  - ${shellSafeMessage(line)}"`),
    "echo \"\"",
    "echo \"What it leaves behind:\"",
    ...described.leaves_behind.map((line) => `echo "  - ${shellSafeMessage(line)}"`),
    "echo \"\"",
    `echo "To undo all of it later:  ${described.removal}  (and remove the one line from the allowed keys file)"`,
    "echo \"\"",
    "",
    `DASH_ROOT="${HOST_INSTALL_ROOT}"`,
    `DASH_USER="${input.username}"`,
    `DASH_NODE_VERSION="${nodeVersion}"`,
    `DASH_NODE_MINIMUM="${MINIMUM_NODE_VERSION}"`,
    `DASH_HELPER_SHA256="${input.helper_sha256}"`,
    /*
     * Single quotes, and this is not a style choice.
     *
     * The allowed-keys line is `restrict,command="…" ssh-ed25519 …` — it
     * *contains* double quotes, and `sshd` needs them: `command=/opt/…` without
     * them is not an option `sshd` parses, so the key would be rejected and
     * DASH would be locked out of a server the person had just set up. Written
     * inside double quotes the shell would eat them, leave a syntactically
     * valid script, and produce exactly that failure.
     *
     * Single quoting is safe here because `PUBLIC_KEY_PATTERN` admits no single
     * quote — which is the allowlist earning its keep on a line where escaping
     * would have been the obvious and wrong answer.
     */
    `DASH_KEY='${publicKey}'`,
    `DASH_AUTH_LINE='${authorizedKeysLine(publicKey)}'`,
    "",
    ...PRIVILEGE_BLOCK,
    "",
    ...NODE_BLOCK,
    "",
    ...HELPER_BLOCK,
    "",
    "# The helper's own bytes, as this copy of DASH shipped them. Decoded through",
    "# tr so that a carriage return picked up in transit cannot silently change",
    "# them: base64 would either fail or, worse, decode to something else.",
    "tr -d '\\r' <<'DASH_HELPER_PAYLOAD' | base64 -d > \"$DASH_ROOT/host-helper.mjs\"",
    payload,
    "DASH_HELPER_PAYLOAD",
    "",
    ...VERIFY_AND_AUTHORIZE_BLOCK,
  ];

  // Joined with \n and only \n. The test that asserts no \r survives in the
  // result is the guard on this line, and it is the whole of the line-endings
  // fix — every other mitigation in this file is for a script that already went
  // wrong somewhere else.
  return { ok: true, script: `${lines.join("\n")}\n` };
}

/**
 * Text that is going inside double quotes in a shell.
 *
 * The copy above is DASH's own and contains none of these, so this is a
 * backstop rather than an escaper doing real work — but it is here because the
 * alternative is a reviewer having to check every sentence in
 * `describeBootstrap` by eye for the rest of the file's life.
 */
function shellSafeMessage(text: string): string {
  return text.replace(/[\\"$`]/g, "");
}

/* ---------------------------------------------------------------------- *
 * The blocks, as they will read on the host
 * ---------------------------------------------------------------------- */

/**
 * Administrator rights, obtained honestly or not at all.
 *
 * A provider's fresh box is usually `root`, in which case this does nothing. On
 * the ones that hand out an ordinary account with `sudo`, the prefix is added
 * and the person sees it in the script they are reading. Nothing here asks for
 * a password: `sudo` will do that itself, in its own words, in their terminal.
 */
const PRIVILEGE_BLOCK: readonly string[] = [
  "DASH_SUDO=\"\"",
  "if [ \"$(id -u)\" -ne 0 ]; then",
  "  if command -v sudo >/dev/null 2>&1; then",
  "    DASH_SUDO=\"sudo\"",
  "    echo \"This needs administrator rights; sudo will ask you for your password.\"",
  "  else",
  "    echo \"This needs to run as an administrator on the server, and sudo is not here.\" >&2",
  "    echo \"Sign in as the administrator account and run it again.\" >&2",
  "    exit 1",
  "  fi",
  "fi",
];

/**
 * Node, reused if the host already has one new enough and installed under
 * DASH's own directory if not.
 *
 * `sort -V` does the comparison, which is the one piece of this that would be
 * fiddly to write by hand and is already on every Ubuntu. The digest check is
 * against the release's own `SHASUMS256.txt` fetched over TLS from the same
 * origin as the tarball — so it catches a truncated or corrupted download and a
 * mirror serving stale bytes, and it does not catch a compromised nodejs.org.
 * The script says exactly that rather than letting a checksum imply more than
 * it proves.
 */
const NODE_BLOCK: readonly string[] = [
  "DASH_NODE=\"\"",
  "if command -v node >/dev/null 2>&1; then",
  "  DASH_HAVE=\"$(node -v 2>/dev/null | sed 's/^v//')\"",
  "  DASH_OLDEST=\"$(printf '%s\\n%s\\n' \"$DASH_NODE_MINIMUM\" \"$DASH_HAVE\" | sort -V | head -n 1)\"",
  "  if [ \"$DASH_OLDEST\" = \"$DASH_NODE_MINIMUM\" ]; then",
  "    DASH_NODE=\"$(command -v node)\"",
  "    echo \"Using the copy of Node already on this server ($DASH_HAVE).\"",
  "  fi",
  "fi",
  "",
  "if [ -z \"$DASH_NODE\" ] && [ -x \"$DASH_ROOT/node/bin/node\" ]; then",
  "  DASH_NODE=\"$DASH_ROOT/node/bin/node\"",
  "  echo \"Using the copy of Node this setup installed earlier.\"",
  "fi",
  "",
  "if [ -z \"$DASH_NODE\" ]; then",
  "  case \"$(uname -m)\" in",
  "    x86_64) DASH_ARCH=\"x64\" ;;",
  "    aarch64|arm64) DASH_ARCH=\"arm64\" ;;",
  "    *)",
  "      echo \"This server's processor is one DASH does not have a copy of Node for.\" >&2",
  "      exit 1",
  "      ;;",
  "  esac",
  "",
  "  DASH_TARBALL=\"node-v$DASH_NODE_VERSION-linux-$DASH_ARCH.tar.xz\"",
  "  DASH_BASE=\"https://nodejs.org/dist/v$DASH_NODE_VERSION\"",
  "  DASH_TMP=\"$(mktemp -d)\"",
  "  echo \"Downloading Node $DASH_NODE_VERSION for this server.\"",
  "",
  "  if command -v curl >/dev/null 2>&1; then",
  "    curl -fsSL \"$DASH_BASE/$DASH_TARBALL\" -o \"$DASH_TMP/$DASH_TARBALL\"",
  "    curl -fsSL \"$DASH_BASE/SHASUMS256.txt\" -o \"$DASH_TMP/SHASUMS256.txt\"",
  "  elif command -v wget >/dev/null 2>&1; then",
  "    wget -q \"$DASH_BASE/$DASH_TARBALL\" -O \"$DASH_TMP/$DASH_TARBALL\"",
  "    wget -q \"$DASH_BASE/SHASUMS256.txt\" -O \"$DASH_TMP/SHASUMS256.txt\"",
  "  else",
  "    echo \"This server has no way to download files, so DASH cannot install Node on it.\" >&2",
  "    echo \"Installing either curl or wget and running this again will fix it.\" >&2",
  "    exit 1",
  "  fi",
  "",
  "  # Checked against the digest list published beside the download itself. That",
  "  # catches a download that arrived wrong. It does not, and cannot, prove the",
  "  # site was not compromised - it is the same trust as installing from apt.",
  "  ( cd \"$DASH_TMP\" && grep \" $DASH_TARBALL\\$\" SHASUMS256.txt | sha256sum -c - >/dev/null )",
  "  echo \"The download matches the digest published with it.\"",
  "",
  "  $DASH_SUDO mkdir -p \"$DASH_ROOT/node\"",
  "  $DASH_SUDO tar -xJf \"$DASH_TMP/$DASH_TARBALL\" -C \"$DASH_ROOT/node\" --strip-components=1",
  "  rm -rf \"$DASH_TMP\"",
  "  DASH_NODE=\"$DASH_ROOT/node/bin/node\"",
  "fi",
];

/**
 * The helper's directory and the one-line program `sshd` will run.
 *
 * The wrapper exists so that the line in `authorized_keys` names a path that
 * never changes, while which Node runs the helper is decided here and can be
 * decided differently on the next run. It passes `"$@"` through so that
 * somebody debugging on the server can run `dash-host status` by hand and see
 * the same thing DASH sees.
 */
const HELPER_BLOCK: readonly string[] = [
  "$DASH_SUDO mkdir -p \"$DASH_ROOT\"",
  "$DASH_SUDO chmod 755 \"$DASH_ROOT\"",
];

/**
 * Prove the helper arrived whole, then let DASH's key in — restricted.
 *
 * The digest is re-computed from the file on disk rather than from what was
 * decoded, which is `install`'s own discipline in `scripts/host-helper/main.ts`
 * and the same reason: a receipt should describe the bytes in the file the
 * receipt points at.
 *
 * The allowed-keys edit is written to work twice. Any previous line carrying
 * this same key is dropped before the new one is appended, so running the setup
 * again after a failure leaves one line rather than a growing stack of them —
 * which is exactly what the 2026-08-08 run left behind by hand.
 */
const VERIFY_AND_AUTHORIZE_BLOCK: readonly string[] = [
  "DASH_GOT=\"$(sha256sum \"$DASH_ROOT/host-helper.mjs\" | cut -d' ' -f1)\"",
  "if [ \"$DASH_GOT\" != \"$DASH_HELPER_SHA256\" ]; then",
  "  echo \"The helper did not arrive as DASH sent it, so nothing was installed.\" >&2",
  "  rm -f \"$DASH_ROOT/host-helper.mjs\"",
  "  exit 1",
  "fi",
  "$DASH_SUDO chmod 644 \"$DASH_ROOT/host-helper.mjs\"",
  "",
  "printf '%s\\n' '#!/bin/sh' \"exec \\\"$DASH_NODE\\\" \\\"$DASH_ROOT/host-helper.mjs\\\" \\\"\\$@\\\"\" \\",
  "  | $DASH_SUDO tee \"$DASH_ROOT/dash-host\" >/dev/null",
  "$DASH_SUDO chmod 755 \"$DASH_ROOT/dash-host\"",
  "",
  "DASH_HOME=\"$(getent passwd \"$DASH_USER\" | cut -d: -f6)\"",
  "if [ -z \"$DASH_HOME\" ]; then",
  "  echo \"There is no account called $DASH_USER on this server.\" >&2",
  "  exit 1",
  "fi",
  "$DASH_SUDO mkdir -p \"$DASH_HOME/.ssh\"",
  "$DASH_SUDO chmod 700 \"$DASH_HOME/.ssh\"",
  "$DASH_SUDO touch \"$DASH_HOME/.ssh/authorized_keys\"",
  "",
  "# Rewritten rather than appended to, so a second run replaces DASH's line",
  "# instead of adding another one beside it.",
  "DASH_KEEP=\"$(mktemp)\"",
  "$DASH_SUDO grep -F -v \"$DASH_KEY\" \"$DASH_HOME/.ssh/authorized_keys\" > \"$DASH_KEEP\" || true",
  "printf '%s\\n' \"$DASH_AUTH_LINE\" >> \"$DASH_KEEP\"",
  "$DASH_SUDO cp \"$DASH_KEEP\" \"$DASH_HOME/.ssh/authorized_keys\"",
  "rm -f \"$DASH_KEEP\"",
  "$DASH_SUDO chmod 600 \"$DASH_HOME/.ssh/authorized_keys\"",
  "$DASH_SUDO chown -R \"$DASH_USER\" \"$DASH_HOME/.ssh\"",
  "",
  "echo \"\"",
  "echo \"This server is ready. DASH can sign in now - go back to DASH and check the connection.\"",
  "echo \"DASH's key is allowed to run one program here and nothing else.\"",
  "echo \"\"",
];
