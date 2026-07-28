/**
 * Decisions about the MSIX manifest, pulled out of `scripts/package-msix.mjs`
 * so they are testable without Windows, MakeAppx, or a built package (MAR-429).
 *
 * Everything else about `build/appx/AppxManifest.xml` — package identity,
 * `runFullTrust`, no other capability — is hand-written, literal text in the
 * repo, reviewable in a diff. See the Linear comment recorded on MAR-429 for
 * why that is deliberate and not an omission. The two things below are the
 * only manifest content that is a *computation* rather than a literal, which
 * is exactly why they live here instead of in the template.
 */

const MSIX_VERSION_PART = /^\d{1,5}$/;
const MAX_MSIX_VERSION_PART = 65535;

/**
 * `package.json`'s semver, converted to the four-part numeric version MSIX
 * requires.
 *
 * MSIX rejects prerelease and build metadata outright — no `-beta`, no
 * `+build` — so this throws rather than silently stripping it. A version that
 * looks fine in `package.json` and fails at `makeappx pack` time, with no
 * indication which field was the problem, is a worse experience than failing
 * here, in a place with a stack trace and a unit test.
 */
export function toMsixVersion(semver: string): string {
  const core = semver.split(/[-+]/, 1)[0] ?? semver;
  const parts = core.split(".");
  if (parts.length !== 3) {
    throw new Error(
      `"${semver}" is not a plain major.minor.patch version. MSIX needs a ` +
        `four-part numeric version, and this function only knows how to add ` +
        `the trailing zero — not to guess at the rest.`,
    );
  }
  for (const part of parts) {
    if (!MSIX_VERSION_PART.test(part) || Number(part) > MAX_MSIX_VERSION_PART) {
      throw new Error(
        `"${semver}" has a version segment ("${part}") that is not a plain ` +
          `integer from 0 to ${String(MAX_MSIX_VERSION_PART)}, which is what every ` +
          `part of an MSIX version must be.`,
      );
    }
  }
  return `${parts.join(".")}.0`;
}

/**
 * MAR-429's trust-level acceptance criterion, executed against the manifest
 * bytes MakeAppx will actually pack.
 *
 * The issue requires the trust level "declared explicitly and verified on the
 * built package, rather than asserted from the manifest source" — so this is
 * called from `scripts/package-msix.mjs` against the staged
 * `AppxManifest.xml` read back from disk after it is written, not against the
 * in-memory template string. A hand-written manifest is exactly the kind of
 * file a later edit can widen by accident — adding a capability for some
 * feature under development and forgetting it is still in the packaging
 * manifest — and this is what turns that into a failed build instead of a
 * silently over-privileged package.
 */
export function assertOnlyRunFullTrustCapability(manifestXml: string): void {
  const block = manifestXml.match(/<Capabilities>([\s\S]*?)<\/Capabilities>/);
  if (block === null) {
    throw new Error("The manifest has no <Capabilities> element.");
  }

  const elements = [...block[1].matchAll(/<([\w:]+)\b[^>]*?\bName="([^"]*)"[^>]*?\/>/g)];
  if (elements.length !== 1) {
    throw new Error(
      `Expected exactly one capability, found ${String(elements.length)}: ` +
        (elements.length === 0
          ? "none"
          : elements.map((match) => `${match[1]}(${match[2]})`).join(", ")),
    );
  }

  const [, tag, name] = elements[0];
  if (tag !== "rescap:Capability" || name !== "runFullTrust") {
    throw new Error(
      `Expected the sole capability to be rescap:Capability Name="runFullTrust", ` +
        `found ${tag} Name="${name}". A packaged Win32 app runs full trust unless ` +
        `explicitly sandboxed as an AppContainer; declaring anything else here is ` +
        `either a mistake or an undecided change of trust level.`,
    );
  }
}
