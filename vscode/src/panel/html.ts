/**
 * A5/A6 — Pure HTML generation for the Omnigent WebviewView.
 *
 * buildWebviewHtml() is a PURE function (no vscode API) so it is unit-testable.
 * It generates the host HTML that:
 *  1. Sets the strict nonce-based CSP (built by csp.ts).
 *  2. Loads the bundled bootstrap script (the only script-src allowed by nonce).
 *  3. Provides a root <div id="root"> for OmnigentApp to mount into.
 *
 * A6 bootstrap contract: the extension host posts a typed init message
 *   { type: 'omnigent/init', serverUrl, token, route, isDarkMode }
 * to the webview. The bootstrap receives this, calls setOmnigentHostConfig()
 * eagerly, then mounts <Router><OmnigentApp /></Router>.
 *
 * DEV FALLBACK: if the ap-web bundle is absent the bootstrap renders a
 * human-readable placeholder (see media/bootstrap/bootstrap.ts).
 */

export interface BuildHtmlOptions {
  /** The CSP string (from buildCsp). */
  csp: string;
  /** The nonce to stamp on the <script> tag. */
  nonce: string;
  /** URI of the bundled bootstrap script (webview-resource URI in production). */
  bootstrapUri: string;
  /** isDarkMode hint passed into the HTML body class. */
  isDarkMode: boolean;
}

export function buildWebviewHtml(opts: BuildHtmlOptions): string {
  const { csp, nonce, bootstrapUri, isDarkMode } = opts;
  const bodyClass = isDarkMode ? "vscode-dark" : "vscode-light";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="${escapeAttr(csp)}" />
  <title>Omnigent</title>
  <style nonce="${nonce}">
    html, body, #root { margin: 0; padding: 0; height: 100%; width: 100%; overflow: hidden; }
    body { background: var(--vscode-editor-background, #1e1e1e); }
  </style>
</head>
<body class="${bodyClass}">
  <div id="root"></div>
  <script nonce="${nonce}" src="${bootstrapUri}"></script>
</body>
</html>`;
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
