/**
 * The unit a host's own service manager reads, and the one place its text is
 * decided (MAR-795, ADR 0031).
 *
 * Pure: no filesystem, no `systemctl`, no child process. `scripts/host-helper/main.ts`
 * is the half that touches a disk and a service manager; this is the half that
 * can be read, asserted and argued about without a Linux box.
 *
 * The split is `lib/shell/autostart.ts`'s, one machine over and for the same
 * reason ADR 0030 gave: *which command a login entry should hold* is a decision,
 * and a decision that can only be executed cannot be tested. Everything below is
 * that decision; `electron/host-residency.ts` is the press and the helper is the
 * hands.
 *
 * ## Why DASH writes a unit at all, when `runner/standalone.ts` said it would not
 *
 * That file's standing sentence — *"No restart policy, no service file, no boot
 * integration"* — is quoted in ADR 0007, ADR 0022, ADR 0029 and ADR 0030, and
 * every one of them says the same thing about it: **a systemd unit chosen in
 * passing is what was refused, not a service unit decided on purpose.** ADR 0031
 * is the decision. The rules it inherits, and which this module implements, are
 * ADR 0030's three:
 *
 * 1. **The entry has to be findable and removable without DASH.** A user unit at
 *    `$XDG_CONFIG_HOME/systemd/user/<name>` is a file with a name an operator can
 *    `systemctl --user list-unit-files` and `rm`. It is the Linux equivalent of
 *    ADR 0030 decision 2's argument for a Run value over a scheduled task: DASH
 *    puts its entry where the platform already offers a door, rather than
 *    building one.
 * 2. **Read the system's own off state.** `systemctl --user is-enabled` is the
 *    equivalent of `StartupApproved\Run`'s bitmask: an operator may disable this
 *    unit without deleting it, and a DASH that reported the file's existence
 *    would say *On* over a boot that does nothing. `HostServiceState` has a third
 *    member for exactly that, and `lib/copy/host-residency.ts` has a sentence for
 *    each of the three.
 * 3. **Nothing is enabled by the bootstrap.** `ensureHostPack` lays down the pack
 *    on every helper invocation; it does not write a unit and cannot, because no
 *    function in this module is reachable from it. The unit exists only after a
 *    press.
 *
 * ## The three things this unit deliberately does not say
 *
 * **No `Restart=`.** `runner/README.md` item 3 has recorded since May that there
 * is no restart policy anywhere in DASH, on purpose, and ADR 0007's refusal
 * names *"a host that restarts an agent DASH cannot see"* as a supervision claim
 * DASH cannot make. `Restart=on-failure` is one line and is precisely that
 * claim. So the unit starts the runner when the machine boots and does not bring
 * it back when it dies — which is the same liveness DASH already has on this
 * machine, and is a smaller promise than the file it is written into could
 * make.
 *
 * **No credential.** There is nowhere in this text for one. The three
 * `Environment=` lines carry the same three variables `start()` already sets on
 * the child it spawns — a data directory, the host root and a bundle id — and
 * every one of them is a location or a name. The secret store is reached by the
 * runner through `runner/host-pack.ts`, from the root named here, exactly as it
 * is for a runner the helper started; a key never travels in a unit and a unit
 * never names one.
 *
 * **No path the caller chose.** Every path below comes from
 * `scripts/host-helper/main.ts`'s own `hostRoot()` and its own join. ADR 0018's
 * rule — *the request cannot name a path, filename, mode, environment variable,
 * command or executable* — is what `ServiceRequest`'s closed field set enforces;
 * this module is the other end of it, where a caller-named path would have to
 * arrive to do any harm and has no parameter to arrive in.
 *
 * ## And why the text is checked before it is written
 *
 * A unit file is `key=value` lines, and a value carrying a newline is two lines.
 * Every variable in it is a path the *helper* resolved — from `os.homedir()` or
 * from `DASH_HOST_ROOT` — so nothing a request sent can reach it. That makes
 * `checkUnitValue` a check on the machine's own configuration rather than on an
 * attacker, and it is written anyway for `namesOneSegment`'s reason: a guard
 * whose reasoning is *"the only caller is trusted"* is a guard the second caller
 * will not have.
 */

/**
 * The one init system this packet supports, as a value so a refusal and a
 * sentence can point at the same string.
 *
 * ADR 0031 decision 2 argues the choice: a host enrolled by DASH is a Linux box
 * reached over `ssh` as an unprivileged user, and `systemd --user` is the only
 * arrangement in which *that* account can install a boot-time service without
 * root. A system unit under `/etc/systemd/system` would need a privilege DASH's
 * key does not have and should never ask for; an init system that is not systemd
 * gets a **named** stop with its own sentence rather than a failed write.
 */
export const HOST_SERVICE_INIT = "systemd";

/**
 * What a host says about the unit for one bundle.
 *
 * Three members and no fourth. ADR 0030 decision 2's `enrolled` and `approved`
 * booleans, collapsed into a union because the fourth combination — *not
 * written, yet enabled* — is not a state a host can be in once
 * `disableHostService` removes the file after disabling it. A union rather than
 * two booleans means `lib/copy/host-residency.ts` is exhaustive by the compiler
 * rather than by a reader counting branches.
 */
export type HostServiceState =
  /** No unit file for this bundle. The state every host is in until a press. */
  | "not_written"
  /** Written, and the service manager says it will start at boot. */
  | "enabled"
  /**
   * Written, and the service manager says it will not.
   *
   * The state that exists because an operator can turn a unit off without
   * removing it — `systemctl --user disable`, run by somebody on the machine —
   * and the reason DASH reads `is-enabled` rather than `existsSync`.
   */
  | "disabled";

/** What a `service` request may ask for. A closed set, checked by value. */
export type HostServiceAction = "status" | "enable" | "disable";

export const HOST_SERVICE_ACTIONS: readonly HostServiceAction[] = [
  "status",
  "enable",
  "disable",
];

export function isHostServiceAction(candidate: unknown): candidate is HostServiceAction {
  return (
    typeof candidate === "string" &&
    (HOST_SERVICE_ACTIONS as readonly string[]).includes(candidate)
  );
}

/**
 * What the unit for one bundle is called.
 *
 * One unit per bundle, because there is one runner per bundle: `start` spawns
 * `node start.mjs` inside `bundles/{id}` with that bundle's own data directory,
 * and a single unit for a host would have to choose one of them or become a
 * supervisor of several — which is a second scheduler on the far side of a
 * boundary DASH cannot see into.
 *
 * The prefix is the product's name rather than the helper's root, so an operator
 * running `systemctl --user list-unit-files` sees what put it there. `bundleId`
 * has already passed `lib/deploy/verbs.ts`'s identifier alphabet by the time
 * this is called — lowercase letters, digits, `-` and `_`, three characters or
 * more — which is why this can concatenate rather than escape: the alphabet
 * cannot spell a separator, a quote, a space or a newline.
 */
export function serviceUnitName(bundleId: string): string {
  return `orchestratedash-${bundleId}.service`;
}

/** The roots the helper chose, and the only variable text in a unit. */
export interface ServiceUnitRoots {
  /** The Node binary the helper is itself running under. Never a request's. */
  execPath: string;
  /** `{root}/bundles/{id}`, joined by the helper and contained-checked there. */
  bundleDirectory: string;
  /** `{root}/bundles/{id}/data`, the same directory `start()` passes. */
  dataDirectory: string;
  /** The helper's own `hostRoot()`. */
  hostRoot: string;
  /** Already through the identifier alphabet. */
  bundleId: string;
}

export type ServiceUnitText =
  | { ok: true; text: string }
  | {
      /**
       * A root this machine cannot be described in a unit file with.
       *
       * Its own refusal rather than an escaped write, because escaping is where
       * a `key=value` format grows a quoting layer to get wrong, and because a
       * home directory containing a newline is a machine with a problem DASH
       * should report rather than route around.
       */
      ok: false;
      refusal: "unspellable_root";
    };

/**
 * Whether a value can be put in a unit file as itself.
 *
 * Newlines end a directive, `"` and `\` are systemd's own quoting characters,
 * and a control character in a path is a path nothing should be silently
 * accepting. Everything else — spaces included — survives inside the double
 * quotes every value below is written in.
 */
function checkUnitValue(value: string): boolean {
  // eslint-disable-next-line no-control-regex -- the point is to refuse them.
  return value.length > 0 && !/["\\]/.test(value) && !/[\u0000-\u001f\u007f]/.test(value);
}

/**
 * The unit, generated from the helper's own roots.
 *
 * ## Every directive, and why it is there or is not
 *
 * `Description` names the product and the bundle, because the person reading it
 * is an operator on their own server looking at a list of units and deciding
 * what is theirs.
 *
 * `Type=simple` because the runner does not fork; it binds its socket and stays
 * in the foreground. `WorkingDirectory` and `ExecStart` are `start()`'s own two
 * decisions, copied — the same directory, the same entry point, the same
 * `process.execPath`. If those two ever disagree, a runner started at boot and a
 * runner started by a press would be different programs, which is the class of
 * bug ADR 0030 decision 3 avoided by putting the login switch on the one
 * executable.
 *
 * The three `Environment=` lines are `start()`'s three, and the comment there is
 * the argument for them here too: **this program chooses them**, exactly as it
 * chooses `node start.mjs`. `DASH_HOST_ROOT` is written explicitly rather than
 * inherited, and under systemd that stops being a nicety — a user unit inherits
 * almost nothing, so a runner relying on the ambient environment would find the
 * home-directory fallback on a real host and the right value under a test.
 *
 * **No `Restart=`, no `After=`, no `RuntimeMaxSec=`.** The first is the module
 * header's argument. The second because a user unit cannot usefully order itself
 * against a system target, and a runner that binds a Unix socket and dials
 * outward needs no network at start — an ordering directive here would be a
 * claim about boot sequencing DASH has not tested on anybody's distribution. The
 * third because a runner that stopped itself on a timer would make "the machine
 * has been up for a week" and "your agent has been reachable for a week"
 * different facts.
 *
 * `WantedBy=default.target` is what makes `enable` mean anything: for a user
 * manager, `default.target` is what comes up when the manager does, and with
 * lingering enabled the manager comes up at boot. Those are two separate
 * conditions and `HostServiceReport.starts_at_boot` reports the second one
 * rather than implying it — and `lib/copy/host-residency.ts` has a sentence for
 * a unit that is enabled on an account that does not linger.
 */
export function serviceUnitText(roots: ServiceUnitRoots): ServiceUnitText {
  const values = [roots.execPath, roots.bundleDirectory, roots.dataDirectory, roots.hostRoot];
  if (!values.every(checkUnitValue)) {
    return { ok: false, refusal: "unspellable_root" };
  }
  const lines = [
    "[Unit]",
    `Description=OrchestrateDASH agent runner (${roots.bundleId})`,
    "",
    "[Service]",
    "Type=simple",
    `WorkingDirectory="${roots.bundleDirectory}"`,
    `ExecStart="${roots.execPath}" "${roots.bundleDirectory}/start.mjs"`,
    `Environment="DASH_RUNNER_DATA_DIR=${roots.dataDirectory}"`,
    `Environment="DASH_HOST_ROOT=${roots.hostRoot}"`,
    `Environment="DASH_HOST_BUNDLE_ID=${roots.bundleId}"`,
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ];
  return { ok: true, text: lines.join("\n") };
}

/**
 * What `systemctl --user is-enabled` said, read as a state rather than a code.
 *
 * `is-enabled` exits non-zero for `disabled`, for `masked` and for a unit it has
 * never heard of, and prints one word for each. Only `enabled` is treated as
 * enabled: everything else — `static`, `masked`, `linked`, `indirect`, an empty
 * answer, a non-zero exit — means this unit will not be brought up by
 * `default.target`, and calling any of them "on" would be the lie ADR 0030
 * decision 2 built the `approved` bit to prevent.
 *
 * The word is compared after trimming and nothing else is parsed. A service
 * manager's output is text from a machine DASH does not administer, headed for
 * a log; the only thing taken from it is whether it is one known word.
 */
export function readIsEnabled(stdout: string): boolean {
  return stdout.trim().split(/\s+/)[0] === "enabled";
}

/**
 * Whether this account's user manager runs without somebody being signed in.
 *
 * `loginctl show-user <name> --property=Linger` prints `Linger=yes` or
 * `Linger=no`. It is the second of the two conditions a boot-time user service
 * needs, and it is a property of the **account** rather than of the unit — which
 * is why it is reported beside `HostServiceState` instead of folded into it. A
 * unit that is enabled on an account that does not linger starts when somebody
 * logs in, which on a server nobody logs in to is a unit that never starts.
 *
 * Anything that is not `yes` is read as no, including an empty answer and an
 * error. Reporting "DASH could not tell" as *yes* is the direction that produces
 * a card claiming a boot that will not happen.
 */
export function readLinger(stdout: string): boolean {
  return /^Linger=yes$/im.test(stdout.trim());
}

/**
 * The three states, composed from the two facts that produce them.
 *
 * The file wins when it is absent: a service manager that still reports
 * `enabled` for a unit whose file has been removed is describing a stale symlink,
 * and *"nothing is written"* is the more useful sentence to hand somebody who is
 * about to press the switch. `disableHostService` removes the symlink and the
 * file in one act, so the two only disagree after somebody has been on the
 * machine with `rm`.
 */
export function hostServiceState(unitPresent: boolean, enabled: boolean): HostServiceState {
  if (!unitPresent) {
    return "not_written";
  }
  return enabled ? "enabled" : "disabled";
}

/**
 * One state for a server that holds several bundles, and the rule is *weakest
 * wins*.
 *
 * ## Why a server has one answer when it has several units
 *
 * There is one runner per bundle, so there is one unit per bundle — but *"does
 * this server come back by itself"* is one question a person asks, and the
 * switch beside it is one switch. So N states are reduced to one, here, purely,
 * where the rule can be asserted instead of inferred from a card.
 *
 * ## Why the reduction under-claims rather than over-claims
 *
 * `not_written` beats `disabled` beats `enabled`. A server with one enabled
 * entry and one missing reports *not written*, which is not the whole truth and
 * is the half that keeps a person safe: the sentence they read is *"this server
 * does not start your agents by itself"*, and the exit beside it — Turn on —
 * writes the missing one. The opposite reduction would print *"this server
 * starts your agents when it reboots"* over an agent that stays stopped, which
 * is the class of claim this repository spends its length refusing.
 *
 * An empty list is `not_written`: a server holding no agents starts none of
 * them, which is exactly true.
 */
export function hostServiceReduction(
  states: readonly HostServiceState[],
): HostServiceState {
  if (states.includes("not_written") || states.length === 0) {
    return "not_written";
  }
  return states.includes("disabled") ? "disabled" : "enabled";
}

/**
 * Everything DASH learns about one server's boot entries, in one shape.
 *
 * No path: the wire carries each unit's **name** and
 * `lib/copy/host-residency.ts` composes the removal instructions around it. That
 * is `pack`'s discipline — its answer is one integer and has no member a slot
 * name or a secrets path could travel in — applied to the second verb that
 * reports on a host's own filesystem. An operator who needs the directory is
 * told the standard one, which is the same on every server that could have
 * accepted this and is therefore not a fact DASH has to learn from theirs.
 */
export interface HostServiceReport {
  state: HostServiceState;
  /** Whether this account lingers, so `enabled` means *at boot* and not *at login*. */
  starts_at_boot: boolean;
  /** `orchestratedash-<bundle>.service`, one per installed bundle. Never a path. */
  units: readonly string[];
}

/**
 * Turn one command result back into a report, or `null` if it is not one.
 *
 * The renderer's half, and `parseAutostartState`'s shape for
 * `parseAutostartState`'s reason: `null` rather than a defaulted object, because
 * *"the shell answered with something that is not this"* and *"this server has no
 * boot entry"* are different sentences and the card shows different things for
 * them. A build mismatch is not a state a person can act on.
 *
 * The state is checked against the three words by value rather than cast. It has
 * crossed a process boundary, and a value this module did not write must not be
 * able to reach `describeResidency`'s exhaustive switch as a fourth member.
 */
export function readHostServiceReport(data: unknown): HostServiceReport | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const record = data as Record<string, unknown>;
  const state = record["state"];
  if (state !== "not_written" && state !== "enabled" && state !== "disabled") {
    return null;
  }
  const units = record["units"];
  return {
    state,
    starts_at_boot: record["starts_at_boot"] === true,
    units: Array.isArray(units)
      ? units
          .map((row) => (row as { name?: unknown } | null)?.name)
          .filter((name): name is string => typeof name === "string")
      : [],
  };
}
