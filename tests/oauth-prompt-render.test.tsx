/**
 * The MAR-594 client setup is rendered only in the credential-only window.
 * Static rendering pins both the presence of the protected fields on a first
 * Google connection and their absence when main already has a stored client.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AuthorizationPrompt } from "../app/credential-prompt/page";
import type { OAuthPromptDescription } from "../lib/shell/credential-prompt";

const DESCRIPTION: OAuthPromptDescription = {
  mode: "oauth",
  service: "Gmail",
  field_label: "Google account",
  purpose: "Search mail",
  help: null,
  vault_label: "Windows Credential Manager",
  replacing: false,
  provider_label: "Google",
  permissions: ["Read Gmail messages and search mail"],
  account_hint: null,
  waiting: false,
  client_setup: true,
};

function render(clientSetup: boolean): string {
  return renderToStaticMarkup(
    <AuthorizationPrompt
      description={{ ...DESCRIPTION, client_setup: clientSetup }}
      busy={false}
      onBusy={() => undefined}
    />,
  );
}

describe("the OAuth client setup prompt", () => {
  it("asks for a Desktop app client before a first real Google sign-in", () => {
    const html = render(true);

    expect(html).toContain("OAuth client ID");
    expect(html).toContain('id="oauth-client-secret"');
    expect(html).toContain('type="password"');
    expect(html).toContain("disabled");
  });

  it("does not render client fields when reconnecting with a stored client", () => {
    const html = render(false);

    expect(html).not.toContain("oauth-client-id");
    expect(html).not.toContain("oauth-client-secret");
    expect(html).not.toContain("disabled");
  });
});
