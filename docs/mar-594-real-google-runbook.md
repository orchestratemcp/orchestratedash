# MAR-594: configure and prove a real Google connection

Last exercised: 2026-08-10 (Europe/Stockholm). This is the reproducible setup for
DASH's bring-your-own Google Desktop app client and the attended, read-only exit
proof. It records the Google Cloud console screens used during MAR-594; it does
not claim that a Testing-mode client is a verified public release.

## What DASH stores

For Google, the credential-only window accepts a Desktop app `client_id` and
`client_secret`. Main still chooses the provider, Google endpoints, redirect,
and manifest-declared scopes. After the authorization-code exchange, DASH puts
the client pair beside the refresh token in the same OS-vault envelope. SQLite
contains only a vault reference, masked account hint, broker receipt, and
content-free audit rows. A later broker refresh therefore does not depend on a
PowerShell environment variable.

Testing-mode grants involving Gmail scopes expire after seven days. Record the
run date and do not present this proof as public-app verification.

## Google Cloud console: create the client from nothing

The console paths below are the Google Auth Platform UI observed on 2026-08-10.
Complete them while signed into the account that owns the Cloud project.

1. Open Google Cloud Console, use the project picker, and select an existing
   project or choose **New project**. Record the project name, project ID, and
   project number in the attended record.
2. Open **APIs & Services > Library**, search for **Gmail API**, open it, and
   choose **Enable**. If the button says **Manage**, it is already enabled.
3. Open **Google Auth Platform > Branding** and fill in:
   - **App name**: the name users should see on Google's consent screen;
   - **User support email**: an inbox the test user can contact;
   - **Developer contact information**: an inbox Google may contact.
   Save the page.
4. Open **Google Auth Platform > Audience**. Choose **External**, leave the app
   in **Testing**, and under **Test users** choose **Add users**. Add the exact
   Google account that will attend the proof, then save.
5. Open **Google Auth Platform > Data Access**, choose **Add or remove scopes**,
   select or manually add these exact scopes, then choose **Update** and **Save**:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.compose`
   `gmail.compose` can send mail at Google's boundary even though DASH exposes
   draft creation and no send operation; the Connection Center says so.
6. Open **Google Auth Platform > Clients**, choose **Create client**, select
   **Desktop app**, give it a recognizable name, and choose **Create**. Do not
   create a Web application: DASH uses an ephemeral
   `http://127.0.0.1:<port>/callback` loopback redirect.
7. Open the created client. Copy the **Client ID**. Under **Client secrets**, use
   **Add secret** when no usable secret is available, copy the new value once,
   and move it directly into DASH's credential window or a temporary attended
   shell variable. Never put it in a tracked file, terminal transcript, issue,
   screenshot, or runbook. Disable obsolete secrets only after the new one has
   completed a real code exchange and refresh.

The project used on 2026-08-10 was **Orchestrate DASH**, project ID
`orchestrate-dash`, project number `521961057282`. Branding was
**OrchestrateDASH**, Audience was **External / Testing**, and the attended
account was present as a test user. Gmail API was enabled. A Desktop app client
created 2026-07-29 was used; a replacement client secret was added 2026-08-10.
No secret value is recorded here. At the end of the console session, Data Access
still displayed no saved scopes even though both Gmail rows had been selected
through **Manually add scopes** and **Update** twice; the console dialog did not
commit or close. The named test user's prior real authorization proves that
Testing mode can present scopes requested by the authorization URL, but this
empty console state must be retried before any verification or non-test release.

## Ordinary DASH connection

Start DASH without `DASH_GOOGLE_CLIENT_SECRET`. In **Connections**, connect the
Gmail field. On a first connection, enter the Desktop app Client ID and Client
secret in DASH's credential-only window, continue to Google, sign in as a named
test user, approve both permissions, and return to DASH. On reconnect, the two
client fields do not reappear because the protected grant already owns them.

## MAR-594 attended search-only proof from PowerShell

This mode makes no mailbox write and asks no mid-run question. The only attended
step is Google's browser sign-in. It deliberately removes the client secret from
the proof process before the broker call, performs one real `gmail.search`, and
preserves the vault grant plus the three required SQLite evidence rows.

Close the ordinary DASH window first. From the target worktree:

```powershell
$env:DASH_GOOGLE_CLIENT_SECRET = [Environment]::GetEnvironmentVariable('DASH_GOOGLE_CLIENT_SECRET', 'User')
$env:DASH_GOOGLE_PROOF_MAR594 = '1'
node scripts/prove-google.mjs
$proofExit = $LASTEXITCODE
Remove-Item Env:DASH_GOOGLE_CLIENT_SECRET -ErrorAction SilentlyContinue
Remove-Item Env:DASH_GOOGLE_PROOF_MAR594 -ErrorAction SilentlyContinue
if ($proofExit -ne 0) { throw "MAR-594 proof failed with exit $proofExit" }
node scripts/mar594-evidence.mjs
if ($LASTEXITCODE -ne 0) { throw 'MAR-594 evidence check failed' }
```

The proof must print all of these as `PASS`:

- `G0b`: no loopback provider and Gmail origin is real;
- `G2`: Google's authorization-code flow completed;
- `G3`: the protected envelope has a refresh token, account, and persisted
  client while the process client secret is absent;
- `M594-1`: real `gmail.search` succeeded;
- `M594-2`: `connection_secrets` has the protected reference;
- `M594-3`: `broker_grants` has the resolved receipt;
- `M594-4`: `broker_audit` has an allowed `gmail.search`.

After recording the evidence, remove the temporary user-level proof secret if
one was created for the attended harness:

```powershell
[Environment]::SetEnvironmentVariable('DASH_GOOGLE_CLIENT_SECRET', $null, 'User')
```

Do not disconnect or remove `dash-google-proof` until MAR-594's exit evidence
has been accepted: those actions intentionally remove the receipt and audit.
After acceptance, disconnect it in DASH, remove the proof agent, and withdraw
the Testing-mode connection in the Google account's third-party connections if
it is still listed.
