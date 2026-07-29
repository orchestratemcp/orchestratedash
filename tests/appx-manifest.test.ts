import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertDeclaresHandoffProtocol,
  assertOnlyRunFullTrustCapability,
  toMsixVersion,
} from "../lib/shell/appx-manifest";

describe("toMsixVersion", () => {
  it("appends a trailing zero to a plain semver", () => {
    expect(toMsixVersion("0.1.0")).toBe("0.1.0.0");
    expect(toMsixVersion("12.34.56")).toBe("12.34.56.0");
  });

  it("strips prerelease and build metadata before converting", () => {
    expect(toMsixVersion("1.2.3-beta.1")).toBe("1.2.3.0");
    expect(toMsixVersion("1.2.3+20260726")).toBe("1.2.3.0");
  });

  it("rejects a version that is not three numeric parts", () => {
    expect(() => toMsixVersion("1.2")).toThrow(/major\.minor\.patch/);
    expect(() => toMsixVersion("1.2.3.4")).toThrow(/major\.minor\.patch/);
  });

  it("rejects a segment that is not a plain integer", () => {
    expect(() => toMsixVersion("1.x.3")).toThrow(/version segment/);
  });

  it("rejects a segment above the MSIX ceiling of 65535", () => {
    expect(() => toMsixVersion("1.2.99999")).toThrow(/version segment/);
  });
});

function manifestWithCapabilities(capabilitiesXml: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10">
  <Identity Name="OrchestrateDASH" Publisher="CN=Alohana Group AB" Version="0.1.0.0" />
  <Capabilities>${capabilitiesXml}</Capabilities>
</Package>`;
}

describe("assertOnlyRunFullTrustCapability", () => {
  it("accepts a manifest declaring exactly runFullTrust", () => {
    const xml = manifestWithCapabilities('<rescap:Capability Name="runFullTrust" />');
    expect(() => assertOnlyRunFullTrustCapability(xml)).not.toThrow();
  });

  it("rejects a manifest with no Capabilities element at all", () => {
    const xml = `<Package><Identity Name="x" Publisher="CN=x" Version="0.1.0.0" /></Package>`;
    expect(() => assertOnlyRunFullTrustCapability(xml)).toThrow(/no <Capabilities> element/);
  });

  it("rejects an empty Capabilities element", () => {
    const xml = manifestWithCapabilities("");
    expect(() => assertOnlyRunFullTrustCapability(xml)).toThrow(/found 0/);
  });

  it("rejects a second capability appearing beside runFullTrust", () => {
    const xml = manifestWithCapabilities(
      '<rescap:Capability Name="runFullTrust" /><Capability Name="internetClient" />',
    );
    expect(() => assertOnlyRunFullTrustCapability(xml)).toThrow(/found 2/);
  });

  it("rejects the right tag with the wrong capability name", () => {
    const xml = manifestWithCapabilities('<rescap:Capability Name="allowElevation" />');
    expect(() => assertOnlyRunFullTrustCapability(xml)).toThrow(/found rescap:Capability Name="allowElevation"/);
  });

  it("rejects runFullTrust declared under the wrong (unrestricted) capability tag", () => {
    const xml = manifestWithCapabilities('<Capability Name="runFullTrust" />');
    expect(() => assertOnlyRunFullTrustCapability(xml)).toThrow(/found Capability Name="runFullTrust"/);
  });
});

/**
 * The handoff scheme (MAR-428).
 *
 * The failure this guards against is silent in exactly the wrong way: a package
 * that lost its protocol declaration installs, runs and hosts agents perfectly,
 * and "Open in DASH" does nothing at all — on the machine of the person the
 * whole feature exists for, with no error anywhere to see.
 */
describe("assertDeclaresHandoffProtocol", () => {
  function manifestWithExtensions(extensionsXml: string): string {
    return `<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10">
  <Applications>
    <Application Id="OrchestrateDASH" Executable="OrchestrateDASH.exe">
      ${extensionsXml}
    </Application>
  </Applications>
</Package>`;
  }

  it("accepts a manifest that claims dash://", () => {
    const xml = manifestWithExtensions(
      '<Extensions><uap:Extension Category="windows.protocol">' +
        '<uap:Protocol Name="dash"><uap:DisplayName>x</uap:DisplayName></uap:Protocol>' +
        "</uap:Extension></Extensions>",
    );
    expect(() => assertDeclaresHandoffProtocol(xml)).not.toThrow();
  });

  it("rejects a manifest with no extensions at all", () => {
    expect(() => assertDeclaresHandoffProtocol(manifestWithExtensions(""))).toThrow(
      /silently do nothing/,
    );
  });

  it("rejects a protocol spelled differently from the one the code listens for", () => {
    // The regression it exists to catch: renaming the scheme in `lib/handoff.ts`
    // and forgetting the manifest. Working developer path, dead installed one.
    const xml = manifestWithExtensions(
      '<Extensions><uap:Extension Category="windows.protocol">' +
        '<uap:Protocol Name="dashboard" /></uap:Extension></Extensions>',
    );
    expect(() => assertDeclaresHandoffProtocol(xml)).toThrow(/\[dashboard\]/);
  });

  it("holds for the manifest this repo actually packs", () => {
    // Against the committed file, not a fixture: the template is what MakeAppx
    // is handed, and `scripts/package-msix.mjs` re-checks the staged copy.
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const committed = readFileSync(
      path.join(repoRoot, "build", "appx", "AppxManifest.xml"),
      "utf8",
    );
    expect(() => assertDeclaresHandoffProtocol(committed)).not.toThrow();
    expect(() => assertOnlyRunFullTrustCapability(committed)).not.toThrow();
  });
});
