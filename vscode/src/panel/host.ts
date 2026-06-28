/**
 * Shared render helper for the Omnigent editor panel.
 *
 * The full Omnigent app renders in the editor-beside `WebviewPanel`
 * (EditorPanelController → ViewColumn.Beside). This module factors the render
 * logic into a single `renderInto(webview, opts)` so the controller and any
 * future host stay in lockstep.
 *
 * Render decision (token-security ADR):
 *  - `iframe` (default) is used ONLY for LOCAL servers — a local server needs no
 *    auth, so no token ever lands in a navigable URL.
 *  - remote/unknown hosts, or an explicit `renderMode === "embed"`, fall back to
 *    the quarantined embed path (which receives server/token/route via postMessage).
 */
import * as vscode from "vscode";
import * as crypto from "node:crypto";
import { buildCsp, wsOriginsForServer } from "./csp";
import { buildWebviewHtml, type ImportMapUris } from "./html";
import { buildIframeHtml } from "./iframeHtml";
import type { ExtensionToWebview } from "./messages";
import type { ServerTarget, RenderMode } from "../config";

/** The localResourceRoots needed by the embed render path (also harmless for iframe). */
export function embedLocalResourceRoots(extensionUri: vscode.Uri): vscode.Uri[] {
  return [
    // Top-level media/ (icon, etc.)
    vscode.Uri.joinPath(extensionUri, "media"),
    // ap-web dist-embed entry + chunks + assets
    vscode.Uri.joinPath(extensionUri, "media", "apweb"),
    vscode.Uri.joinPath(extensionUri, "media", "apweb", "chunks"),
    vscode.Uri.joinPath(extensionUri, "media", "apweb", "assets"),
    // Vendor bundles (React, react-router-dom, etc.)
    vscode.Uri.joinPath(extensionUri, "media", "apweb", "vendor"),
    // Bootstrap bundle
    vscode.Uri.joinPath(extensionUri, "media", "bootstrap"),
  ];
}

export interface RenderIntoOptions {
  /** Resolved server target (origin/baseUrl/hostType). */
  target: ServerTarget;
  /** Extension root URI (for resolving media/ webview URIs in embed mode). */
  extensionUri: vscode.Uri;
  /** Render mode from settings. */
  renderMode: RenderMode;
  /** Initial route (e.g. "/" or "/c/<id>"). */
  route?: string;
  /** Bearer token for the embed handshake (never used by the iframe path). */
  token?: string;
  /** Dark-mode hint for the embed body class / init message. */
  isDarkMode: boolean;
  /** Optional diagnostic logger. */
  log?: (msg: string) => void;
}

/** Returns true when the iframe path should be used for this target + mode. */
export function shouldUseIframe(renderMode: RenderMode, target: ServerTarget): boolean {
  return renderMode !== "embed" && target.hostType === "local";
}

/**
 * Render the Omnigent UI into a webview (WebviewView or WebviewPanel). Sets
 * `webview.html` and, for the embed path, posts the init handshake message.
 */
export function renderInto(webview: vscode.Webview, opts: RenderIntoOptions): void {
  const route = opts.route ?? "/";
  if (shouldUseIframe(opts.renderMode, opts.target)) {
    renderIframe(webview, opts.target, route, opts.log);
  } else {
    renderEmbed(webview, opts.target, opts.extensionUri, opts.isDarkMode, opts.log);
    postEmbedInit(webview, opts.target, route, opts.token, opts.isDarkMode);
  }
}

/** Render the iframe host pointed at the resolved (local) server. */
function renderIframe(
  webview: vscode.Webview,
  target: ServerTarget,
  route: string,
  log?: (msg: string) => void,
): void {
  const nonce = crypto.randomBytes(16).toString("base64url");
  const csp = buildCsp({
    serverOrigin: target.origin,
    wsOrigins: wsOriginsForServer(target.origin),
    nonce,
    cspSource: webview.cspSource,
  });
  // Pass the BARE base + route separately: buildIframeHtml bakes the route into
  // the initial src AND keeps the bare base for its navigate shim, so a later
  // `omnigent/navigate` post does not double the path (`/c/x/c/x`).
  webview.html = buildIframeHtml({ baseUrl: target.baseUrl, route, csp, nonce });
  log?.(`[omnigent] iframe rendered (origin=${target.origin}, route=${route}, nonce=${nonce.slice(0, 8)}...)`);
}

/**
 * Render the quarantined embed path (renderMode=embed or remote/unknown host).
 * Uses the RESOLVED origin in the CSP (no longer a hardcoded placeholder).
 */
function renderEmbed(
  webview: vscode.Webview,
  target: ServerTarget,
  extensionUri: vscode.Uri,
  isDarkMode: boolean,
  log?: (msg: string) => void,
): void {
  const nonce = crypto.randomBytes(16).toString("base64url");
  const csp = buildCsp({
    serverOrigin: target.origin,
    wsOrigins: wsOriginsForServer(target.origin),
    nonce,
    cspSource: webview.cspSource,
  });

  // Helper to build a webview URI from a path relative to media/
  const mediaUri = (...segments: string[]) =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", ...segments)).toString();

  // Import-map: 6 vendor bundles + omnigent-embed entry
  const importMap: ImportMapUris = {
    react: mediaUri("apweb", "vendor", "react.js"),
    reactDom: mediaUri("apweb", "vendor", "react-dom.js"),
    reactDomClient: mediaUri("apweb", "vendor", "react-dom-client.js"),
    reactJsxRuntime: mediaUri("apweb", "vendor", "jsx-runtime.js"),
    reactRouter: mediaUri("apweb", "vendor", "react-router.js"),
    reactRouterDom: mediaUri("apweb", "vendor", "react-router-dom.js"),
    omnigentEmbed: mediaUri("apweb", "omnigent-embed.js"),
  };

  // The ap-web Vite embed build emits the stylesheet at the dist-embed ROOT
  // (`omnigent-embed.css`), NOT under assets/ — vite.embed.config.ts routes
  // `*.css` to the top level and only non-CSS assets (the Monaco worker) to
  // assets/. Pointing at assets/ 404s and the SPA renders unstyled.
  const cssUri = mediaUri("apweb", "omnigent-embed.css");
  const bootstrapUri = mediaUri("bootstrap", "bootstrap.js");

  webview.html = buildWebviewHtml({ csp, nonce, bootstrapUri, cssUri, importMap, isDarkMode });
  log?.(`[omnigent] embed rendered (nonce=${nonce.slice(0, 8)}...)`);
}

/** Post the init handshake the embed bootstrap expects (server URL + token + route). */
function postEmbedInit(
  webview: vscode.Webview,
  target: ServerTarget,
  route: string,
  token: string | undefined,
  isDarkMode: boolean,
): void {
  const msg: ExtensionToWebview = {
    type: "omnigent/init",
    serverUrl: target.baseUrl,
    token,
    route,
    isDarkMode,
  };
  webview.postMessage(msg);
}

/** Minimal placeholder HTML shown until the server target is resolved. Self-contained CSP. */
export function renderResolvingHtml(): string {
  const csp = "default-src 'none'; style-src 'unsafe-inline'";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <title>Omnigent</title>
  <style>
    html, body { margin: 0; padding: 0; height: 100%; width: 100%; }
    body {
      display: flex; align-items: center; justify-content: center;
      font-family: var(--vscode-font-family, sans-serif);
      color: var(--vscode-descriptionForeground, #999);
      background: var(--vscode-editor-background, #1e1e1e);
    }
  </style>
</head>
<body>
  <p>Resolving Omnigent server…</p>
</body>
</html>`;
}
