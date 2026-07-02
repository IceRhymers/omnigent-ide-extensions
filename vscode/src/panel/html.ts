/**
 * A5/A6 — Pure HTML generation for the Omnigent WebviewView.
 *
 * buildWebviewHtml() is a PURE function (no vscode API) so it is unit-testable.
 * It generates the host HTML that:
 *  1. Sets the strict nonce-based CSP (built by csp.ts).
 *  2. Provides an import-map so bare specifiers resolve to vendor/ WebviewURIs.
 *  3. Loads a CSS stylesheet from the ap-web dist-embed bundle.
 *  4. Loads the bundled bootstrap script as type="module" (ESM).
 *  5. Provides a root <div id="root"> for OmnigentApp to mount into.
 *
 * A6 bootstrap contract: the extension host posts a typed init message
 *   { type: 'omnigent/init', serverUrl, token, route, isDarkMode }
 * to the webview. The bootstrap receives this, calls setOmnigentHostConfig()
 * eagerly, then mounts <MemoryRouter><OmnigentApp /></MemoryRouter>.
 *
 * DEV FALLBACK: if the ap-web bundle is absent the bootstrap renders a
 * human-readable placeholder (see media/bootstrap/bootstrap.ts).
 */

export interface BuildHtmlOptions {
  /** The CSP string (from buildCsp). */
  csp: string;
  /** The nonce to stamp on inline <style>, <script type="importmap">, and the module <script>. */
  nonce: string;
  /** URI of the bundled bootstrap script (webview-resource URI in production). */
  bootstrapUri: string;
  /** URI of the ap-web CSS file (media/apweb/omnigent-embed.css — dist-embed root, not assets/). */
  cssUri: string;
  /** Import-map entries: bare specifier -> WebviewURI string. */
  importMap: ImportMapUris;
  /** isDarkMode hint passed into the HTML body class. */
  isDarkMode: boolean;
}

/** The 7 WebviewURI strings needed for the import-map. */
export interface ImportMapUris {
  react: string;
  reactDom: string;
  reactDomClient: string;
  reactJsxRuntime: string;
  reactRouter: string;
  reactRouterDom: string;
  omnigentEmbed: string;
}

export function buildWebviewHtml(opts: BuildHtmlOptions): string {
  const { csp, nonce, bootstrapUri, cssUri, importMap, isDarkMode } = opts;
  const bodyClass = isDarkMode ? "vscode-dark" : "vscode-light";

  const importMapJson = JSON.stringify(
    {
      imports: {
        "react": importMap.react,
        "react-dom": importMap.reactDom,
        "react-dom/client": importMap.reactDomClient,
        "react/jsx-runtime": importMap.reactJsxRuntime,
        "react-router": importMap.reactRouter,
        "react-router-dom": importMap.reactRouterDom,
        "omnigent-embed": importMap.omnigentEmbed,
      },
    },
    null,
    2,
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="${escapeAttr(csp)}" />
  <title>Omnigent</title>
  <link rel="stylesheet" nonce="${nonce}" href="${cssUri}" />
  <style nonce="${nonce}">
    html, body, #root { margin: 0; padding: 0; height: 100%; width: 100%; overflow: hidden; }
    body { background: var(--vscode-editor-background, #1e1e1e); }
  </style>
  <script type="importmap" nonce="${nonce}">${importMapJson}</script>
</head>
<body class="${bodyClass}">
  <div id="root"></div>
  <script type="module" nonce="${nonce}" src="${bootstrapUri}"></script>
</body>
</html>`;
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
