import { describe, expect, it } from "vitest";
import { assertOnlyRunFullTrustCapability, toMsixVersion } from "../lib/shell/appx-manifest";

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
