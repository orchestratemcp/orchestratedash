# Signing and sideloading the MAR-429 test MSIX

`pnpm run package:msix` produces an **unsigned** `.msix` at
`build/appx/OrchestrateDASH-<version>.msix`. Everything from here on touches
the certificate store or installs a package, which is outside what the
packaging script — or Claude — does. This is the runbook for Henrik.

It corresponds to the two decisions recorded in MAR-429's comments: the
certificate goes in **Trusted People, not Trusted Root**, and removal at the
end is a required step, not optional cleanup. The private key never leaves
this machine and is never exported to a file.

## 1. Create the test certificate (once)

`-Subject` must equal the manifest's `Publisher` **exactly**:
`build/appx/AppxManifest.xml` has `Publisher="CN=Alohana Group AB"`. If you
ever change one, regenerate the certificate and redo step 2.

```powershell
$cert = New-SelfSignedCertificate `
  -Type Custom `
  -Subject "CN=Alohana Group AB" `
  -KeyUsage DigitalSignature `
  -FriendlyName "OrchestrateDASH MSIX test signing (MAR-429, delete after use)" `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}Subject Type:End Entity") `
  -NotAfter (Get-Date).AddDays(30)

$cert.Thumbprint
```

The private key stays in `Cert:\CurrentUser\My` for the whole exercise.
`signtool` will sign against the thumbprint directly (step 3) — nothing here
ever calls `Export-PfxCertificate`.

## 2. Trust the certificate machine-wide (once, elevated)

Open PowerShell **as Administrator** for this step only. Trusting the cert has
to be machine-wide because the sideload later happens from the `dashtest`
account, which needs to see it too.

```powershell
Export-Certificate -Cert "Cert:\CurrentUser\My\<THUMBPRINT>" -FilePath "$env:TEMP\dash-msix-test.cer"
Import-Certificate -FilePath "$env:TEMP\dash-msix-test.cer" -CertStoreLocation "Cert:\LocalMachine\TrustedPeople"
Remove-Item "$env:TEMP\dash-msix-test.cer"
```

This exports and imports the **public** certificate only — `Export-Certificate`
never includes the private key. `Cert:\LocalMachine\TrustedPeople`, not
`Cert:\LocalMachine\Root`: sufficient for MSIX sideload trust, far narrower
than trusting the cert as a root CA.

## 3. Sign the package (after every `pnpm run package:msix`)

Ordinary, unelevated PowerShell, back in the repo:

```powershell
& "C:\Program Files (x86)\Windows Kits\10\bin\10.0.19041.0\x64\signtool.exe" sign `
  /fd SHA256 /sha1 <THUMBPRINT> /s My `
  "build\appx\OrchestrateDASH-<version>.msix"
```

`/s My` signs against the certificate already sitting in
`Cert:\CurrentUser\My` — no `.pfx` file is written to disk at any point.

## 4. Sideload from the `dashtest` account

`dashtest` cannot read another user's profile folder by default, so copy the
signed package somewhere both accounts can reach before switching:

```powershell
Copy-Item "build\appx\OrchestrateDASH-<version>.msix" "C:\Users\Public\OrchestrateDASH-test.msix"
```

Then, logged in as `dashtest` (standard user — no elevation needed, since the
certificate is already trusted machine-wide from step 2):

```powershell
Add-AppxPackage -Path "C:\Users\Public\OrchestrateDASH-test.msix"
```

If this refuses with a trust error even after step 2, the fallback is
**Settings → Privacy & security → For developers → Developer Mode**, on for
this exercise only, off again during cleanup. It should not be necessary for a
correctly-trusted signed package, so treat needing it as a signal something
above didn't take.

Launch from the Start Menu entry ("OrchestrateDASH (packaging proof)"), or:

```powershell
Get-AppxPackage OrchestrateDASH
```

## 5. Testing update, repair, uninstall

- **Update:** bump `package.json`'s `version`, rerun `pnpm run package:msix`,
  redo steps 3–4 (same certificate, no need to repeat steps 1–2). MSIX treats
  a higher `Version` under the same `Identity Name`/`Publisher` as an update in
  place, not a new install — that's what this issue's update-lifecycle
  acceptance criteria actually exercise.
- **Repair:** Settings → Apps → installed apps → OrchestrateDASH → Advanced
  options → Repair.
- **Uninstall:** Settings → Apps, or:
  ```powershell
  Get-AppxPackage OrchestrateDASH | Remove-AppxPackage
  ```

## 6. Required cleanup, every time this exercise is run

Not optional — recorded as a required step in the MAR-429 clean-machine
comment.

```powershell
# From dashtest, if still installed
Get-AppxPackage OrchestrateDASH | Remove-AppxPackage

# Elevated, on the main account: remove the trust
Get-ChildItem Cert:\LocalMachine\TrustedPeople | Where-Object Subject -eq "CN=Alohana Group AB" | Remove-Item

# Remove the signing certificate itself once no further builds are being tested
Get-ChildItem Cert:\CurrentUser\My | Where-Object Subject -eq "CN=Alohana Group AB" | Remove-Item

# The copy left for dashtest to read
Remove-Item "C:\Users\Public\OrchestrateDASH-test.msix" -ErrorAction SilentlyContinue
```

If Developer Mode was turned on in step 4 as a fallback, turn it back off too.

## 7. Windows App Certification Kit

`appcert.exe` (`C:\Program Files (x86)\Windows Kits\10\App Certification Kit\`)
is installed on this machine, but its manifest requires elevation — running it
from an unelevated shell fails with "the requested operation requires
elevation" before it does anything else, so this is Henrik's step too.

With the package installed (step 4), open **Windows App Cert Kit** from the
Start Menu (or `appcert.exe` from an elevated PowerShell), choose "Validate a
Windows app", select OrchestrateDASH from the list of installed apps, and run
the full test pass. Per the issue: record the result — pass, or failures with
a decision — in the ADR amendment, early enough that a structural failure
could still change the packaging approach.
