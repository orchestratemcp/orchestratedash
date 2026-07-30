import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkEnvironmentName,
  connectableFields,
  connectionSecretName,
  deliverableFields,
  resolveCredentialTarget,
} from "../lib/connection-credentials";
import type { ConnectionSourceManifest } from "../lib/connections";
import { isValidSecretName } from "../lib/secure-store";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function example(name: string): ConnectionSourceManifest {
  return JSON.parse(
    readFileSync(path.join(repoRoot, "examples", name), "utf8"),
  ) as ConnectionSourceManifest;
}

const secretExample = example("dash-managed-secret.manifest.v2.example.json");
const oauthExample = example("dash-managed.manifest.v2.example.json");
const agentManagedExample = example("agent-managed.manifest.v2.example.json");
const gmailExample = example("gmail-meeting-assistant.manifest.v2.example.json");

describe("resolveCredentialTarget — what DASH will hold a credential for", () => {
  it("resolves a declared dash-managed secret field", () => {
    const resolved = resolveCredentialTarget("ledger-reporter", secretExample, "ledger", "api-key");

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.target.service).toBe("Ledger");
    expect(resolved.target.field_label).toBe("Ledger API key");
    expect(resolved.target.environment_name).toBe("LEDGER_API_KEY");
  });

  /**
   * The refusal that keeps the Connection Center from becoming a place to stash
   * arbitrary secrets: DASH takes a credential only for a field the agent
   * declared.
   */
  it("refuses a connection the manifest never declared", () => {
    const resolved = resolveCredentialTarget("ledger-reporter", secretExample, "stripe", "api-key");
    expect(resolved).toEqual({ ok: false, refusal: "unknown_connection" });
  });

  it("refuses a field the connection never declared", () => {
    const resolved = resolveCredentialTarget("ledger-reporter", secretExample, "ledger", "password");
    expect(resolved).toEqual({ ok: false, refusal: "unknown_field" });
  });

  /**
   * The derived model-provider row has no manifest entry by construction, so it
   * can never resolve. Asserted explicitly because it is the row most likely to
   * grow a Connect button by accident.
   */
  it("refuses the derived model-provider row", () => {
    const resolved = resolveCredentialTarget(
      "gmail-assistant",
      gmailExample,
      "derived:model-provider",
      "api-key",
    );
    expect(resolved).toEqual({ ok: false, refusal: "unknown_connection" });
  });

  it("refuses an agent-managed connection, and says who owns it", () => {
    const resolved = resolveCredentialTarget(
      "invoice-agent",
      agentManagedExample,
      "invoice-store",
      "service-credential",
    );
    expect(resolved).toEqual({
      ok: false,
      refusal: "not_dash_managed",
      ownership: "agent_managed",
    });
  });

  /**
   * MAR-383 refused every OAuth field. MAR-446 narrows that to the providers
   * DASH genuinely has no sign-in for, and this manifest names one — so the
   * refusal survives, with a code that says *why* rather than the old blanket
   * "not a secret field".
   *
   * Keeping this test is the point. The interesting risk in adding a flow is
   * that "DASH does OAuth now" quietly becomes "DASH will try to sign in to
   * anything", and this is what stops it.
   */
  it("refuses an OAuth field for a provider DASH has no sign-in for", () => {
    const resolved = resolveCredentialTarget(
      "project-reporter",
      oauthExample,
      "project-service",
      "account-authorization",
    );
    expect(resolved).toEqual({ ok: false, refusal: "no_oauth_flow" });
  });

  /**
   * The MAR-383 acceptance criterion that could not be met, met (MAR-446).
   *
   * Both Gmail example connections are `oauth_reauthorization`, which is why
   * MAR-383's "the DASH-managed path passes" was unreachable. They now resolve
   * to real targets carrying the provider and the scopes the manifest declared.
   */
  it("resolves both Gmail example connections now that Google has a flow", () => {
    const fields = connectableFields("gmail-assistant", gmailExample);

    expect(fields.map((field) => field.connection_id)).toEqual(["gmail", "calendar"]);
    expect(fields.every((field) => field.kind === "oauth")).toBe(true);
    expect(fields[0]?.oauth).toEqual({
      provider_id: "google",
      scopes: [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.compose",
      ],
    });
    // Neither declares an `environment_name`, so DASH holds both and delivers
    // neither — the honest state the checklist has copy for.
    expect(deliverableFields("gmail-assistant", gmailExample)).toEqual([]);
  });

  it("refuses an OAuth field whose manifest declared no permissions", () => {
    const stripped = JSON.parse(JSON.stringify(gmailExample)) as ConnectionSourceManifest;
    delete stripped.agent_dom?.connections?.[0]?.fields[0]?.technical;

    expect(
      resolveCredentialTarget("gmail-assistant", stripped, "gmail", "gmail-account"),
    ).toEqual({ ok: false, refusal: "oauth_scopes_not_declared" });
  });

  /**
   * Scope escalation through a manifest. Without the allowlist an agent author
   * could ask for full mailbox control — including delete — while the checklist
   * above went on rendering whatever friendly capability labels the same
   * manifest supplied.
   */
  it("refuses an OAuth field asking for access outside the provider allowlist", () => {
    const greedy = JSON.parse(JSON.stringify(gmailExample)) as ConnectionSourceManifest;
    const field = greedy.agent_dom?.connections?.[0]?.fields[0];
    if (field?.technical !== undefined) {
      field.technical.provider_scopes = ["https://mail.google.com/"];
    }

    expect(resolveCredentialTarget("gmail-assistant", greedy, "gmail", "gmail-account")).toEqual({
      ok: false,
      refusal: "oauth_scope_not_allowed",
    });
  });
});

describe("resolveCredentialTarget — delivery targets", () => {
  function withEnvironmentName(name: string): ConnectionSourceManifest {
    const clone = JSON.parse(JSON.stringify(secretExample)) as ConnectionSourceManifest;
    const field = clone.agent_dom?.connections?.[0]?.fields?.[0];
    if (field !== undefined) {
      field.technical = { environment_name: name };
    }
    return clone;
  }

  /**
   * The refusal that stops a connect succeeding and the agent then failing to
   * start: `runner/supervisor.ts` refuses the whole `DASH_` namespace, so a
   * manifest asking for one is refused here, where the message can explain it.
   */
  it("refuses a manifest that claims the reserved DASH_ namespace", () => {
    const resolved = resolveCredentialTarget(
      "a",
      withEnvironmentName("DASH_INGEST_TOKEN"),
      "ledger",
      "api-key",
    );
    expect(resolved).toEqual({ ok: false, refusal: "reserved_environment_name" });
  });

  it.each(["PATH", "NODE_OPTIONS", "LD_PRELOAD"])(
    "refuses %s, which would change what the child executes rather than what it connects to",
    (name) => {
      const resolved = resolveCredentialTarget("a", withEnvironmentName(name), "ledger", "api-key");
      expect(resolved).toEqual({ ok: false, refusal: "unsafe_environment_name" });
    },
  );

  it.each(["lowercase", "HAS SPACE", "a=b", "1LEADING", ""])(
    "refuses the malformed environment name %j",
    (name) => {
      const resolved = resolveCredentialTarget("a", withEnvironmentName(name), "ledger", "api-key");
      expect(resolved).toEqual({ ok: false, refusal: "malformed_environment_name" });
    },
  );

  it("accepts a field with no delivery target at all", () => {
    const clone = JSON.parse(JSON.stringify(secretExample)) as ConnectionSourceManifest;
    const field = clone.agent_dom?.connections?.[0]?.fields?.[0];
    if (field !== undefined) {
      delete field.technical;
    }
    const resolved = resolveCredentialTarget("a", clone, "ledger", "api-key");

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    // Holdable, but not deliverable — and the two lists must disagree.
    expect(resolved.target.environment_name).toBeNull();
    expect(connectableFields("a", clone)).toHaveLength(1);
    expect(deliverableFields("a", clone)).toHaveLength(0);
  });

  it("lists the ledger key as deliverable", () => {
    expect(deliverableFields("ledger-reporter", secretExample)).toEqual([
      expect.objectContaining({ connection_id: "ledger", environment_name: "LEDGER_API_KEY" }),
    ]);
  });
});

describe("checkEnvironmentName", () => {
  it("accepts a conventional name", () => {
    expect(checkEnvironmentName("LEDGER_API_KEY")).toBeNull();
  });

  it("refuses a lowercase DASH prefix too, since the supervisor upper-cases before comparing", () => {
    // The supervisor's own guard is `key.toUpperCase().startsWith("DASH_")`.
    // This module rejects lowercase outright, so the two agree by a different
    // route — asserted so a future relaxation of the pattern cannot silently
    // open the namespace.
    expect(checkEnvironmentName("dash_ingest_token")).toBe("malformed_environment_name");
  });
});

describe("connectionSecretName", () => {
  it("produces a name the SecureStore seam accepts", () => {
    expect(isValidSecretName(connectionSecretName("Ledger Reporter", "ledger", "api-key"))).toBe(
      true,
    );
  });

  it("namespaces away from the adapter token, which a disconnect must not wipe", () => {
    expect(connectionSecretName("a", "b", "c")).toBe("dash.connection.a.b.c");
    expect(connectionSecretName("a", "b", "c")).not.toContain("adapter");
  });

  /**
   * Two distinct ids must not collapse into one vault key. A dot inside an id
   * would otherwise merge with the separator and let one connection's Connect
   * overwrite another's credential.
   */
  it("does not let a dot in an id merge two segments", () => {
    expect(connectionSecretName("a", "b.c", "d")).not.toBe(connectionSecretName("a", "b", "c.d"));
  });

  it("survives ids that are not already name-safe", () => {
    const name = connectionSecretName("Agent Name!", "Conn/ID", "Field ID");
    expect(isValidSecretName(name)).toBe(true);
  });
});
