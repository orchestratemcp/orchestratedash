# ADR 0019: Browser control is a supervised Electron WebContents

Status: Proposed

Date: 2026-08-13

Issue: MAR-628. Related: ADR 0002 (the broker may claim only the operations it
actually bounds), ADR 0006 (unattended credentials past this machine are
agent-managed), ADR 0009 (a limit belongs in the enforcing boundary, not in a
declaration), and MAR-625 (credentials on a host).

## Decision

**DASH should control the Chromium it already ships, through an isolated
Electron `WebContents`, and put that `WebContents` inside DASH when a person is
watching.** In Electron 43 the renderable primitive is `WebContentsView`, not
`BrowserView`: `BrowserView` has been deprecated since Electron 30 and is now a
compatibility wrapper. The automation primitive is Electron's built-in
`webContents.debugger` transport to the Chrome DevTools Protocol (CDP), behind a
small DASH-owned operation catalogue.

No agent receives raw CDP, a debugger target, an Electron object, or a remote
debugging port. It asks DASH for named browser operations. DASH resolves the
request against the run's declared origins and action set, records its own
decision, performs the operation in Electron main, and returns a projection.
This is the same shape ADR 0002 chose for provider access, applied to a browser:
the powerful substrate stays on the trusted side and the third-party process
gets typed operations rather than the substrate.

Browser access is a **manifest capability named `browser`**, with declared
origins and action classes, and resolves through the existing requirement and
capability cards. It is not a new connection plane. A signed-in browser profile
may later add a custody row to the same card, but credentials do not decide the
shape of the browser capability itself.

The same controller has two placements:

1. **On the DASH machine**, a sandboxed `WebContentsView` is attached to DASH's
   window. The person sees the page itself, not a reconstruction or a test trace.
2. **On a headless VPS**, the Linux Electron build runs the same controller and
   the same command/event contract in an offscreen `BrowserWindow`. Electron's
   documented Linux headless path still needs a display driver, so the host
   payload includes a virtual X display such as Xvfb. Offscreen paint frames are
   the remote supervision trail.

Playwright and Puppeteer are not added for the first implementation. The
controller contract deliberately leaves room to put either behind it later;
choosing Electron/CDP now is not permission for agents to depend on CDP details.

## Why the renderable surface decides it

Playwright and Puppeteer are better automation libraries. Both have locators,
waiting and actionability checks that DASH would otherwise have to build.
Playwright also has excellent screenshots, DOM snapshots, network traces and a
trace viewer. Those are substantial advantages if the product being built is a
test runner.

DASH is building a supervision surface. The important output is not only that a
selector matched. It is that a person can watch the actual page, interrupt the
run, inspect what DASH asked the browser to do, and decide the next consequential
gesture without changing applications. A `WebContentsView` is the only candidate
that is natively both the controlled browser and a surface inside DASH.

An external Playwright or Puppeteer browser can be headed in another window, or
stream screenshots back into DASH. The first makes supervision leave DASH; the
second makes DASH show a delayed copy while the authoritative page is elsewhere.
Either can be engineered, but neither is a reason to ship a second Chromium next
to the one already in the installer.

## The controller boundary

The trusted controller owns all of these things together:

- one isolated Electron session partition per run;
- a parsed, exact-origin allowlist for top-level navigation and every network
  request, including redirects and subresources;
- `nodeIntegration: false`, context isolation, renderer sandboxing and no
  privileged preload exposed to the remote page;
- denied popups, external protocols, permission prompts, downloads and new
  `WebContents` unless a later named operation admits one;
- the CDP attachment and the only code allowed to send CDP commands;
- a short catalogue such as `navigate`, `read`, `scroll`, `type` and `click`,
  with bounded inputs and bounded results;
- an append-only action record and a frame captured before and after a gesture;
- the per-run command token whose revocation destroys the `WebContents` and
  refuses later commands.

The first implementation must allowlist **origins, not string prefixes**.
`https://example.com.attacker.test` is not inside `https://example.com`. A page
whose scripts, fonts or API calls need another origin must declare that resource
origin too; silently allowing every subresource would turn the card into a
top-level-navigation claim while the browser could still talk anywhere.

An origin allowlist constrains only the browser DASH provides. It does not stop
an ordinary agent process using `fetch`, `curl`, another installed browser, or a
socket of its own. DASH's existing `network: read` declaration is not an
enforced network sandbox, and adding a controlled browser does not make it one.
The capability card and run record must therefore say **"DASH limited this
browser run"**, never **"this agent could only visit these sites."** The same
qualification applies on a VPS.

## What the supervision record can honestly say

For every operation DASH decides, the record carries:

- the requested operation, timestamp, run and agent;
- the origin and page URL before the operation;
- the target as DASH resolved it: accessible role/name when available, otherwise
  a bounded selector description and element rectangle;
- for non-sensitive typing, the exact text DASH supplied;
- for a password or declared-sensitive field, only the field description,
  character count and the fact that the value was redacted;
- the decision: allowed, refused, waiting for approval or revoked;
- the page URL after the operation and the before/after frame references.

That is a record of **what DASH asked its browser to do**. It is not proof of
what the website did with the event. A click can run arbitrary page JavaScript,
a request can be accepted and processed after the view is destroyed, and a site
can change state without a click at all. Revocation stops future controller
commands and tears down the controlled session; it cannot recall a request
already sent.

The record also cannot promise that every secret was recognised. An ordinary
text input can contain a password, an API key or a medical detail without
declaring itself sensitive. The controller redacts known password fields and
values explicitly marked sensitive, and the UI says that this is the redaction
boundary rather than claiming automatic secret detection.

## Approval, and the limit of the word irreversible

There is no reliable general classifier for "irreversible" in a web page. A
button labelled **Save** may be reversible, a link may trigger a deletion, and a
page load may spend money. Reading the DOM and guessing would be the exact kind
of policy claim ADR 0002 and ADR 0009 forbid.

So approval attaches to **named controller operations**, not to DASH's opinion
of a site's meaning:

- read, inspect and scroll may run within the approved origins;
- typing, clicking, submitting, uploading, downloading, granting a browser
  permission, opening a new window and crossing an origin are separate action
  classes;
- an operation class marked `approval_required` stops before input is dispatched
  and shows the live page, resolved target and proposed value or redaction;
- no generic `evaluateJavaScript`, `pressKey`, raw mouse, raw keyboard or raw CDP
  escape hatch exists for an agent, because each would bypass that catalogue.

For the first slice every `type` and `click` requires a person, whether DASH
believes it harmless or not, and submit, upload, download, permission prompts,
popups and new windows do not exist. That is smaller than "approval before every
irreversible action" and stronger for the operations it actually offers. Later
slices may let a person grant a standing action class for one origin, but the
receipt must then describe it as standing authority, not as continuing live
supervision.

## The VPS is the same engine and a weaker supervision situation

"Headless" changes presentation, not the control contract. The host would run
the same Electron major, the same operation catalogue and the same event schema.
A hidden, offscreen `BrowserWindow` would receive CDP commands and emit paint
frames; the existing authenticated host path would be widened with named,
bounded browser commands, decisions and frame references. There would be no
remotely reachable DevTools port.

Electron itself still requires a display driver on Linux. Xvfb is therefore a
real host dependency and belongs in the deploy receipt. Calling the path
"zero-dependency headless" would be false. "Zero new npm dependency" is true;
"zero new host payload" is not, because a Linux Electron binary, its system
libraries and the virtual display have to be installed on the VPS.

When DASH is connected, the person can watch the frame trail, refuse a waiting
gesture and revoke the provided browser session. A frame trail is not a live view
unless measured cadence and transport health make it one, so the remote surface
must show the time of its newest frame.

When DASH is closed, there is nobody to approve. An unattended run may perform
only action classes granted in advance; an approval-required operation stops.
The remote controller can enforce that rule for the browser it owns. It cannot
prove the agent did not use another network path, and DASH cannot claim a remote
action happened merely because the agent reported it. This is ADR 0006's line:
the browser session and any credentials on the VPS are `agent_managed`, while
the returned trail is evidence reported by the host and carries its observation
time.

## Credentials are browser state, not a vault boundary

A logged-in browser is a credential even when the password is never visible.
Cookies, local storage, service-worker state and refresh material let the browser
act as the user. Keeping CDP behind a typed controller reduces what an agent can
ask DASH to do; it does not put the authenticated session behind the OS vault.
The page and Chromium necessarily use that state on the agent's behalf.

The available choices mean this when a run is unattended:

| Choice | What is retained | What unattended really means |
| --- | --- | --- |
| Dedicated persistent profile, signed in once by the user | A separate Electron partition keeps cookies and site state between runs. It must never reuse the person's ordinary DASH or system-browser profile. | The agent can keep acting as the signed-in user for as long as the site session lasts. Per-origin rules limit where the provided browser goes, not what the account can do at that origin. Deleting the local profile stops DASH using that copy; provider-side revocation is the only account-level revocation. On a VPS the profile lives on the VPS and is agent-managed under ADR 0006. |
| Per-origin consent | A receipt records which origins and action classes the person granted; persistence is a separate choice. | Consent is standing authority, not credential isolation. An allowed origin can contain reads, sends, purchases and deletions behind one login. This choice narrows destinations and controller verbs only. |
| Refuse to persist sessions | An in-memory partition is destroyed at the end of the run. | A logged-in unattended task is impossible unless somebody signs in during that run or a secret is injected into it. Injecting a password or session token makes it visible to the browser for the run and does not create a vault boundary. |

The recommendation for the first slice is the third choice: **an ephemeral,
public-web session with no login and no credential input.** Persistent profiles
are a later, explicit product decision. Shipping one incidentally because
Electron sessions persist by default would be the worst of the three choices:
unattended authority with no receipt admitting it.

## Competitive and cost comparison

| Axis | Electron `WebContentsView` + built-in CDP | Playwright | Puppeteer |
| --- | --- | --- | --- |
| Automation API | Lowest-level option. DASH must build locators, waiting, actionability and trace projection for the small catalogue it offers. | Strongest complete API here: role/text locators, automatic actionability checks, retries, screenshots, DOM/network traces and Trace Viewer. Electron automation is documented as experimental. | Mature Chromium automation with locators and waiting, thinner than Playwright and close to CDP. |
| Render inside DASH | Native. The controlled `WebContents` is the surface. | Not native. A launched browser is a separate window; screenshots or a stream have to be projected into DASH. Driving Electron itself does not provide DASH's product boundary. | Same: a separate browser or a screenshot projection. Connecting to Electron over CDP still needs a debugger endpoint and a separate embedding design. |
| Local install and offline behaviour | Electron 43.2 is already in `package.json` and in the packaged shell. No browser download or new package is added. The engine version moves with DASH. | New package. Its normal installation downloads version-matched browser binaries; official docs put each installed browser in the hundreds of megabytes. It can target installed Chrome/Edge, but that makes availability and versioning somebody else's. | New package. `puppeteer` normally downloads Chrome for Testing plus headless shell; `puppeteer-core` avoids the download but still adds a library and requires DASH to manage an executable explicitly. |
| Installer and memory | No second local engine. Each concurrent session still costs Chromium renderer/network/GPU processes and must be measured; "already bundled" does not mean "free per run." | A separately launched Chromium can duplicate the engine DASH already ships. Contexts are cheaper than browsers, but the first browser process remains. | Same underlying browser-process cost. |
| VPS | Same controller and engine, but the host must carry Linux Electron, required system libraries and Xvfb. Offscreen frames give DASH a supervision trail. | Best turnkey headless installation and waiting behaviour. Its separate browser download and Linux dependencies become part of the host image. The DASH supervision surface still has to be built around it. | Also a natural headless fit, with Chrome downloaded by `puppeteer` or separately managed for `puppeteer-core`. The supervision surface still has to be built. |
| Credential meaning | No vault boundary. A dedicated session can be isolated from DASH's own renderer and other browser runs, but its authenticated state remains browser state. | No vault boundary. Browser contexts isolate state from one another, not from the automation process controlling them. | Same. |

The price of this decision is engineering: Playwright and Puppeteer have spent
years on exactly the selector and waiting problems DASH now accepts for itself.
The reason to pay that price is not dependency purity. It is to keep one
authoritative browser surface and make the supervision record a first-class DASH
object rather than an adaptation of a test runner's trace.

If the first real task shows that a five-operation controller cannot be made
reliable without reproducing a large part of Playwright, the next decision is to
put `playwright-core` behind the same controller contract and connect it to a
DASH-owned Chromium. That would be a dependency decision, not a permission or UI
redesign. The contract is the hedge.

## What "full control" would have to earn

"Full control" may eventually describe engine reach: multiple pages, robust
locators, mouse and keyboard, forms, uploads, downloads, dialogs, permissions,
frames, service workers and long-running navigation. It may never be shorthand
for "DASH understood every consequence" or "the agent could do nothing else."

The phrase is not earned until all of these are true for the supported operation
set:

1. every agent-reachable command is in one reviewed catalogue and raw CDP remains
   unreachable;
2. origin and new-window limits are enforced before dispatch, including redirects
   and subresources;
3. every dispatched input has an action record and before/after visual evidence;
4. revocation has a tested stop point and the UI says what may already have left
   the machine;
5. approval-required classes cannot be reached by a lower-risk alias such as a
   generic key press or JavaScript evaluation;
6. local and VPS receipts distinguish DASH-observed facts, host-reported facts
   and agent declarations;
7. credential custody and provider-side revocation are visible before a user
   signs in;
8. resource use and failure recovery have been measured on the packaged desktop
   and the supported VPS image.

Until then the product should say **controlled browser operations**, not full
browser control.

## Smallest first slice

One real agent performs one real public-web task: **the News Scout opens one
cited article in DASH, scrolls it, and—after a person approves the proposed
gesture—clicks one visible same-origin link, then returns the final page title,
URL and a screenshot.** No login, no persisted session and no provider write.

The slice contains only:

1. one ephemeral `WebContentsView`, visible inside the agent's run surface;
2. an exact HTTPS origin list chosen before the run, including any required
   resource origins;
3. `navigate`, `read title and visible text`, `scroll` and one
   approval-required `click` operation;
4. denied popups, downloads, permissions, external protocols, new windows,
   file access, arbitrary JavaScript, typing and every raw input/CDP operation;
5. a Stop control that destroys the view and refuses the run token;
6. an action trail with the resolved link, decision, timestamps, URLs and frames
   before and after the click;
7. one packaged-shell attended proof in which the person watches, approves and
   then revokes a second proposed click; and
8. one VPS proof of the same command/event contract under Xvfb, explicitly
   promoted only to a timestamped host-reported frame trail, not a claim of live
   desktop supervision.

That proves the differentiator before credential custody, arbitrary form input,
multi-tab control or a new automation dependency is allowed into the argument.

## Alternatives rejected

**Playwright first.** Best automation ergonomics and the likely fallback if the
catalogue grows. Rejected for the first slice because it adds a package and
usually another browser payload before proving the inside-DASH supervision
surface. Its Electron integration is also explicitly experimental.

**Puppeteer first.** A smaller conceptual jump from CDP and `puppeteer-core` can
avoid downloading Chrome. Rejected because it is still a new dependency whose
main value is an API DASH does not yet know it needs, while it does not solve
embedding, custody, approvals or honest audit claims.

**A system Chrome profile.** Convenient and catastrophic for scope: it begins
with the user's existing cookies, extensions and browsing state and gives DASH
no dedicated revocation unit. A browser run uses a dedicated Electron partition
or it does not run.

**Raw CDP as the manifest capability.** This is "full control" in the narrowest
technical sense and makes every supervision claim false. An agent could evaluate
JavaScript, read cookies, synthesize input or create targets outside the action
catalogue. CDP is an implementation detail of the trusted controller, never an
agent operation.

**A remote DevTools port on the VPS.** Rejected even behind authentication. It
turns the most powerful interface in the design into a network service and lets
a client bypass the host's operation and evidence contract. The controller is
local to the browser process; DASH talks to the host in named commands.

## Sources checked for this decision

- Electron: [WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view),
  [BrowserView migration](https://www.electronjs.org/blog/migrate-to-webcontentsview),
  [`webContents.debugger`](https://www.electronjs.org/docs/latest/api/debugger),
  [offscreen rendering](https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering),
  [headless Linux/Xvfb](https://www.electronjs.org/docs/latest/tutorial/testing-on-headless-ci),
  and the [security checklist](https://www.electronjs.org/docs/latest/tutorial/security).
- Playwright: [browser installation and disk model](https://playwright.dev/docs/browsers),
  [actionability and auto-waiting](https://playwright.dev/docs/actionability),
  [tracing](https://playwright.dev/docs/api/class-tracing), and
  [experimental Electron support](https://playwright.dev/docs/api/class-electron).
- Puppeteer: [installation and `puppeteer-core`](https://pptr.dev/guides/installation)
  and [locators/page interactions](https://pptr.dev/guides/page-interactions).
