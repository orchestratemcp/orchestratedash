/**
 * The document DASH prints a brief into (MAR-674, ADR 0025 decision 4).
 *
 * Henrik's ruling: *"text files should download as html->PDF"*. This is the
 * html half, and it is a pure string function so that the interesting part —
 * what a person receives when they press Save a copy — is testable without
 * Electron, a window, or a printer.
 *
 * ## Where the markup comes from, and why that is the whole security argument
 *
 * The body handed in here is `renderToStaticMarkup(<BriefBody …>)`, produced by
 * **the same React components that draw the screen**. That is what makes this
 * safe rather than merely convenient: React escapes text by construction, so a
 * model that wrote `[click here](http://evil.example)` or `<script>` produces
 * inert characters in the PDF exactly as it does in the app.
 *
 * The first draft of ADR 0025 proposed a Markdown file and rejected HTML on the
 * grounds that it would mean hand-escaping untrusted text at a second site.
 * Henrik overturned it, and he was right: printing the React output removes the
 * second site entirely. **There is no escaper in this file, and there must never
 * be one** — if this module ever needs to interpolate a model's characters into
 * markup itself, that is the signal the design has drifted back to the thing it
 * was chosen to avoid.
 *
 * ## Why a document rather than a route in the renderer
 *
 * The ADR sketched a print-only route in DASH's static export. This renders in
 * the main process and loads through a `data:` URL instead, which
 * `electron/splash.ts` already does and `electron/capture-panel.ts` already
 * renders React for. It is strictly less privileged: no preload, no command
 * channel, no route a person could navigate to by accident, and nothing to keep
 * out of the app's own navigation allowlist.
 *
 * The cost is stated rather than hidden: the app's stylesheet is not here, so
 * the print styles below are their own small sheet. That is not a loss for a
 * document somebody forwards — a PDF of a dark-themed application window is
 * worse than a page that looks like a page, and the ADR already required the
 * printed copy to force light and drop every control.
 */

/**
 * The stylesheet, inlined.
 *
 * Deliberately small and deliberately not a copy of `app/tokens.css`. Three
 * things it must do, each of which was a named requirement:
 *
 * - **light, always.** The app follows the OS through `light-dark()`; a PDF
 *   printed while DASH is dark would be a black page somebody prints on paper.
 * - **no controls.** `BriefBody` renders none, and this is the belt: anything
 *   that arrived as a button or a `summary` is hidden rather than printed as a
 *   dead widget.
 * - **readable at A4.** A measure, real margins, and links that keep their
 *   colour so a reader can see which words carried one.
 */
const PRINT_STYLES = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 0;
    background: #ffffff;
    color: #16202c;
    font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
    font-size: 11pt;
    line-height: 1.55;
  }
  main { max-width: 46em; margin: 0 auto; padding: 2.2em 2.4em; }
  h1 { font-size: 19pt; line-height: 1.25; margin: 0 0 0.15em; }
  h3 { font-size: 13pt; margin: 1.6em 0 0.4em; page-break-after: avoid; }
  p { margin: 0 0 0.75em; }
  .brief-section { page-break-inside: auto; }
  .muted { color: #5a6b7d; font-size: 10pt; }
  .wrap { overflow-wrap: anywhere; }
  a { color: #0b5cab; }
  .brief-cited, .brief-uncited { margin: -0.35em 0 1.1em; }
  .notice { border-left: 3px solid #b04a2f; padding: 0.6em 0 0.6em 0.9em; margin: 0 0 1.2em; }
  .notice p { margin: 0 0 0.35em; }
  .brief-print-head { border-bottom: 1px solid #d8e0e8; padding-bottom: 0.9em; margin-bottom: 1.4em; }
  /* Controls have no meaning on paper. BriefBody draws none; this is the belt. */
  button, input, select, [role="button"] { display: none !important; }
  details > summary { list-style: none; font-weight: 600; }
  @page { margin: 14mm; }
`;

/**
 * Wrap a rendered brief in the document that gets printed.
 *
 * `title` and `subtitle` are DASH's own strings — the artifact's title and the
 * receipt line — and are the only text this function positions itself. They are
 * escaped here because they are *not* React output: `title` is the agent's own
 * name for its brief, which is agent-authored and reaches this function as a
 * plain string.
 *
 * That is the one exception to this module's no-escaper rule, and it is narrow
 * on purpose: two known strings, escaped by one function, with a test. The
 * model-authored body is never touched.
 */
export function briefPrintDocument(options: {
  title: string;
  subtitle: string;
  body: string;
}): string {
  const { title, subtitle, body } = options;
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    `<title>${escapeText(title)}</title>`,
    `<style>${PRINT_STYLES}</style>`,
    "</head><body><main>",
    '<header class="brief-print-head">',
    `<h1>${escapeText(title)}</h1>`,
    `<p class="muted">${escapeText(subtitle)}</p>`,
    "</header>",
    body,
    "</main></body></html>",
  ].join("");
}

/**
 * The five characters that turn text into markup.
 *
 * Not a general sanitiser and not trying to be — it is applied to two strings
 * this module positions itself and to nothing else. `lib/broker/operations.ts`'
 * `LOOKS_LIKE_A_LINK` makes the same choice for the same reason: a blunt rule
 * with one job beats a cleaner with several.
 */
function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
