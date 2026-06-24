/**
 * Iframe host HTML for the Omnigent WebviewView (default `iframe` render mode).
 *
 * Instead of mounting the embed bundle, the webview hosts a single <iframe>
 * pointed at the running Omnigent server (gated to LOCAL servers — a local
 * server needs no auth, so no token ever appears in the iframe URL; see the
 * token-security ADR).
 *
 * buildIframeHtml() is a PURE function (no vscode API) so it is unit-testable.
 * The page carries:
 *  1. A strict nonce-based CSP whose `frame-src` allows the server origin.
 *  2. A nonce'd <style> making html/body/#root and the iframe fill 100%, no border.
 *  3. The <iframe src="${serverUrl}"> filling the pane.
 *  4. A tiny nonce'd shim that calls acquireVsCodeApi() and relays
 *     `omnigent/navigate` messages by setting `iframe.src = serverUrl + route`.
 */

export interface BuildIframeHtmlOptions {
  /** Resolved server base URL (e.g. "http://127.0.0.1:6767"). Loaded as the iframe src. */
  serverUrl: string;
  /** The CSP string (from buildCsp) — its frame-src must allow the server origin. */
  csp: string;
  /** Nonce stamped on the inline <style> and the shim <script>. */
  nonce: string;
}

export function buildIframeHtml(opts: BuildIframeHtmlOptions): string {
  const { serverUrl, csp, nonce } = opts;
  const src = serverUrl.replace(/\/$/, "");

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
    #omnigent-frame { border: 0; width: 100%; height: 100%; display: block; }
  </style>
</head>
<body>
  <div id="root">
    <iframe id="omnigent-frame" src="${escapeAttr(src)}" style="border:0;width:100%;height:100%"></iframe>
  </div>
  <script nonce="${nonce}">
    (function () {
      var serverUrl = ${JSON.stringify(src)};
      var vscode = acquireVsCodeApi();
      window.addEventListener("message", function (event) {
        var msg = event.data;
        if (msg && msg.type === "omnigent/navigate" && typeof msg.route === "string") {
          var frame = document.getElementById("omnigent-frame");
          if (frame) {
            frame.src = serverUrl.replace(/\\/$/, "") + msg.route;
          }
        }
      });
    })();
  </script>
</body>
</html>`;
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
