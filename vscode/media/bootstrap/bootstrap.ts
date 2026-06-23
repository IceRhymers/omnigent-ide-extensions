/**
 * A6 — Webview bootstrap (runs INSIDE the webview, not in the extension host).
 *
 * This file is bundled separately (see scripts/build-bootstrap.js) and served
 * from vscode/media/bootstrap/bootstrap.js. The nonce from the HTML <script>
 * tag allows it through the CSP.
 *
 * Boot sequence:
 *  1. Declare the VS Code API acquirer (acquireVsCodeApi).
 *  2. Listen for the host's typed init message (omnigent/init).
 *  3. On receipt: call setOmnigentHostConfig() EAGERLY (before first render)
 *     with fetcher + resolveWebSocketUrl, then mount OmnigentApp inside a Router.
 *  4. Subsequent omnigent/navigate messages drive the router.
 *
 * ap-web bundle contract (from A6a gate doc):
 *  - OmnigentApp is the default export of omnigent-app.js (the built embed).
 *  - setOmnigentHostConfig is a named export of the same module.
 *  - React/ReactDOM/react-router-dom are BARE externals — the bootstrap must
 *    provide them (they are bundled into THIS file, not into omnigent-app.js).
 *  - The host MUST wrap OmnigentApp in a <Router> (BrowserRouter or MemoryRouter).
 *    We use MemoryRouter here so the webview URL doesn't matter.
 *
 * DEV FALLBACK: if the ap-web bundle (omnigent-app.js) is absent, the bootstrap
 * renders a clear placeholder so the extension still loads and activates cleanly.
 * The type-check passes without the bundle present because we use a dynamic import
 * with a catch (no hard static import of the missing file).
 */

// Minimal VS Code webview API type (no @types/vscode in the webview bundle).
interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

// Message types (mirrored from src/panel/messages.ts — no cross-bundle import).
interface InitMessage {
  type: "omnigent/init";
  serverUrl: string;
  token?: string;
  route: string;
  isDarkMode: boolean;
}
interface NavigateMessage {
  type: "omnigent/navigate";
  route: string;
}
type HostMessage = InitMessage | NavigateMessage;

// ── Bootstrap ─────────────────────────────────────────────────────────────────

const vscodeApi: VsCodeApi = acquireVsCodeApi();

/** Navigate callback — set after mount so navigation messages can drive the router. */
let navigateFn: ((route: string) => void) | undefined;

window.addEventListener("message", (event: MessageEvent<HostMessage>) => {
  const msg = event.data;
  if (!msg || !msg.type) return;

  if (msg.type === "omnigent/init") {
    handleInit(msg);
  } else if (msg.type === "omnigent/navigate") {
    navigateFn?.(msg.route);
  }
});

async function handleInit(msg: InitMessage): Promise<void> {
  const { serverUrl, token, route, isDarkMode } = msg;
  const root = document.getElementById("root");
  if (!root) {
    postError("no #root element");
    return;
  }

  // Build the fetcher — the single choke point for all HTTP (including SSE stream).
  // Verified in A6a gate: all ap-web HTTP goes through hostFetch → _config.fetcher.
  const baseUrl = serverUrl.replace(/\/$/, "");
  const fetcher = async (path: string, init?: RequestInit): Promise<Response> => {
    const url = path.startsWith("http") ? path : `${baseUrl}${path}`;
    const headers = new Headers(init?.headers);
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    return fetch(url, { ...init, headers });
  };

  // Build the WS URL resolver — the host controls the origin (covers R9/Q2).
  const resolveWebSocketUrl = (path: string): string => {
    try {
      const u = new URL(baseUrl);
      const scheme = u.protocol === "https:" ? "wss:" : "ws:";
      // Q2 carry-forward: for remote servers with WS auth requirements, the
      // token would be appended here as a query param (local single-user needs none).
      return `${scheme}//${u.host}${path}`;
    } catch {
      return `ws://127.0.0.1:6767${path}`;
    }
  };

  // Try to load the ap-web bundle dynamically so type-check passes when absent.
  try {
    // The import path is relative to the webview origin (media/apweb/omnigent-app.js).
    // In production this file is present; in dev mode it may be absent.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const apweb = await (import("../apweb/omnigent-app.js") as Promise<any>);
    const { default: OmnigentApp, setOmnigentHostConfig } = apweb;

    // Call setOmnigentHostConfig EAGERLY before first render (per gate doc §embed mount mechanics).
    setOmnigentHostConfig({ fetcher, resolveWebSocketUrl, cliServerUrlSuffix: "" });

    // React + react-router-dom are bundled into THIS bootstrap (not into omnigent-app.js).
    // The dynamic require below is resolved at bundle time by the bootstrap bundler.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const React = require("react") as typeof import("react");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactDOM = require("react-dom/client") as typeof import("react-dom/client");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { MemoryRouter, useNavigate } = require("react-router-dom") as typeof import("react-router-dom");

    // Wrapper that exposes the navigate function to the message handler.
    function AppWrapper() {
      const nav = useNavigate();
      navigateFn = nav;
      return React.createElement(OmnigentApp, { isDarkMode, basename: "" });
    }

    const reactRoot = ReactDOM.createRoot(root);
    reactRoot.render(
      React.createElement(MemoryRouter, { initialEntries: [route] },
        React.createElement(AppWrapper),
      ),
    );
    vscodeApi.postMessage({ type: "omnigent/ready" });
  } catch (err) {
    // DEV FALLBACK: ap-web bundle absent or failed to load — render a clear placeholder.
    const msg2 = err instanceof Error ? err.message : String(err);
    renderPlaceholder(root, msg2);
    vscodeApi.postMessage({ type: "omnigent/ready" }); // still signal ready so extension activates
  }
}

function renderPlaceholder(root: HTMLElement, reason: string): void {
  root.innerHTML = `
    <div style="font-family:var(--vscode-font-family,sans-serif);padding:24px;color:var(--vscode-foreground,#ccc);">
      <h2 style="margin:0 0 12px;font-size:16px;">Omnigent — ap-web bundle not built</h2>
      <p style="margin:0 0 8px;font-size:13px;color:var(--vscode-descriptionForeground,#aaa);">
        The bundled ap-web build is required to display the Omnigent UI. Follow the
        instructions in <code>scripts/build-apweb.md</code> to build and copy it.
      </p>
      <details style="margin-top:12px;font-size:12px;color:var(--vscode-descriptionForeground,#888);">
        <summary>Error detail</summary>
        <pre style="margin:8px 0 0;white-space:pre-wrap;word-break:break-all;">${escapeHtml(reason)}</pre>
      </details>
    </div>
  `;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function postError(message: string): void {
  vscodeApi.postMessage({ type: "omnigent/error", message });
}
