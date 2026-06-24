/**
 * A6 — Webview bootstrap (runs INSIDE the webview, not in the extension host).
 *
 * Built by scripts/build-bootstrap.js as ESM with bare specifiers kept EXTERNAL
 * so the webview import-map resolves them to vendor/ and apweb/ WebviewURIs.
 *
 * Externals (resolved via import-map at runtime — NOT bundled here):
 *   "react"             -> media/apweb/vendor/react.js
 *   "react-dom/client"  -> media/apweb/vendor/react-dom-client.js
 *   "react-router-dom"  -> media/apweb/vendor/react-router-dom.js
 *   "omnigent-embed"    -> media/apweb/omnigent-embed.js
 *
 * Same React instance as the embed is critical — both sides must share the
 * same React object or hooks will throw. The import-map guarantees this.
 *
 * TOKEN SECURITY: token travels ONLY via omnigent/init postMessage, placed into
 * the fetcher closure. It is NEVER put in a navigable URL.
 */

// Bare specifiers — resolved to vendor bundles via the webview import-map.
import React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useNavigate } from "react-router-dom";

// Minimal VS Code webview API type (no @types/vscode in the webview context).
declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

// Mirrored from src/panel/messages.ts — no cross-bundle import allowed.
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

// ── Bootstrap entry ───────────────────────────────────────────────────────────

const vscodeApi = acquireVsCodeApi();

/** Set after mount so omnigent/navigate messages can drive the router. */
let navigateFn: ((route: string) => void) | undefined;

window.addEventListener("message", (event: MessageEvent<HostMessage>) => {
  const msg = event.data;
  if (!msg?.type) return;
  if (msg.type === "omnigent/init") {
    handleInit(msg).catch((err) => postError(String(err)));
  } else if (msg.type === "omnigent/navigate") {
    navigateFn?.(msg.route);
  }
});

async function handleInit(msg: InitMessage): Promise<void> {
  const { serverUrl, token, route, isDarkMode } = msg;
  const rootEl = document.getElementById("root");
  if (!rootEl) { postError("no #root element"); return; }

  // ── fetcher: single choke point for ALL HTTP including the SSE stream ──────
  // Verified in A6a gate: ap-web's stream uses a fetch-based ReadableStream
  // reader (parseSseStream via authenticatedFetch → hostFetch → _config.fetcher).
  // EventSource limitation does NOT apply. Token is in closure — never in URL.
  const baseUrl = serverUrl.replace(/\/$/, "");
  const fetcher = (path: string, init?: RequestInit): Promise<Response> => {
    const url = path.startsWith("http") ? path : `${baseUrl}${path}`;
    const headers = new Headers(init?.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(url, { ...init, headers });
  };

  // ── resolveWebSocketUrl: host controls WS origin (covers R9/Q2) ──────────
  // Q2 carry-forward: remote servers may need token as query param for WS auth.
  // Local single-user server requires no WS auth (primary v1 path — unblocked).
  const resolveWebSocketUrl = (path: string): string => {
    try {
      const u = new URL(baseUrl);
      const scheme = u.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${scheme}//${u.host}${path}`;
      if (token && u.protocol === "https:") {
        const sep = path.includes("?") ? "&" : "?";
        return `${wsUrl}${sep}token=${encodeURIComponent(token)}`;
      }
      return wsUrl;
    } catch {
      return `ws://127.0.0.1:6767${path}`;
    }
  };

  // ── Load embed (dynamic so dev-fallback still works when bundle is absent) ─
  let OmnigentApp: React.ComponentType<{
    basename?: string;
    isDarkMode?: boolean;
    [k: string]: unknown;
  }>;
  let setOmnigentHostConfig: (cfg: {
    fetcher?: typeof fetcher;
    resolveWebSocketUrl?: typeof resolveWebSocketUrl;
    cliServerUrlSuffix?: string;
  }) => void;

  try {
    // "omnigent-embed" is resolved by the import-map to apweb/omnigent-embed.js.
    // Named exports confirmed in A6a: export { Hte as OmnigentApp, Ne as setOmnigentHostConfig }
    const embed = await import("omnigent-embed") as {
      OmnigentApp: typeof OmnigentApp;
      setOmnigentHostConfig: typeof setOmnigentHostConfig;
    };
    OmnigentApp = embed.OmnigentApp;
    setOmnigentHostConfig = embed.setOmnigentHostConfig;
  } catch (err) {
    renderPlaceholder(rootEl, err instanceof Error ? err.message : String(err));
    vscodeApi.postMessage({ type: "omnigent/ready" });
    return;
  }

  // Call EAGERLY before first render (host.ts:117 guards against clobbering).
  setOmnigentHostConfig({ fetcher, resolveWebSocketUrl, cliServerUrlSuffix: "" });

  // Router wrapper that exposes navigate to omnigent/navigate message handler.
  function AppWrapper() {
    const nav = useNavigate();
    React.useLayoutEffect(() => { navigateFn = nav; }, [nav]);
    return React.createElement(OmnigentApp, { basename: undefined, isDarkMode });
  }

  const reactRoot = createRoot(rootEl);
  reactRoot.render(
    React.createElement(
      MemoryRouter,
      { initialEntries: [route] },
      React.createElement(AppWrapper),
    ),
  );
  vscodeApi.postMessage({ type: "omnigent/ready" });
}

function renderPlaceholder(el: HTMLElement, reason: string): void {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  el.innerHTML = `
    <div style="font-family:var(--vscode-font-family,sans-serif);padding:24px;
                color:var(--vscode-foreground,#ccc);">
      <h2 style="margin:0 0 12px;font-size:16px;">
        Omnigent — ap-web bundle not built
      </h2>
      <p style="margin:0 0 8px;font-size:13px;
                color:var(--vscode-descriptionForeground,#aaa);">
        Follow <code>scripts/build-apweb.md</code> to build the embed bundle,
        then run <code>npm run build:vendor &amp;&amp; npm run build:bootstrap</code>.
      </p>
      <details style="margin-top:12px;font-size:12px;">
        <summary>Error detail</summary>
        <pre style="margin:8px 0;white-space:pre-wrap;word-break:break-all;">${esc(reason)}</pre>
      </details>
    </div>`;
}

function postError(message: string): void {
  vscodeApi.postMessage({ type: "omnigent/error", message });
}
