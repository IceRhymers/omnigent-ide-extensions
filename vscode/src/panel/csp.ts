/**
 * A5/A6 — CSP string construction (pure, unit-testable, guards PM2).
 *
 * buildCsp() produces a strict nonce-based Content-Security-Policy for the
 * Omnigent WebviewView. It is a PURE function with no VS Code API dependency
 * so it can be tested without an IDE host.
 *
 * Key rules (per plan §A5 + ADR):
 *  - default-src 'none' — deny everything not explicitly allowed.
 *  - script-src 'nonce-{nonce}' 'wasm-unsafe-eval' — nonce covers the bootstrap
 *    module and import-map; wasm-unsafe-eval required by Monaco worker (A6+).
 *    No 'unsafe-inline', no 'unsafe-eval'.
 *  - style-src 'nonce-{nonce}' 'unsafe-inline' — OmnigentApp injects runtime
 *    CSS via style attributes; unsafe-inline on style-src is the recommended
 *    trade-off when the injected styles are extension-controlled.
 *  - connect-src — the https/http server API origin + ws:/wss: for each WS
 *    origin provided (covers terminal WS + managed-sandbox WS, R9/Q2).
 *  - img-src — the vscode-resource scheme for local assets + data URIs + https:
 *    (OmnigentApp may display remote avatars/thumbnails).
 *  - font-src — the vscode-resource scheme.
 *  - frame-src {serverOrigin} — the default `iframe` render mode hosts the running
 *    Omnigent server in an <iframe>; the server is a separate origin so it must be
 *    allowlisted here. (The quarantined `embed` mode does not use frames; allowing
 *    the server origin is harmless for it.)
 *  - worker-src <cspSource> blob: — Monaco spawns workers from blob: URLs.
 *
 * IMPORTANT: `webviewCspSource` (vscode's allowlist for the extension's own
 * resources) must also be in relevant directives when the panel goes live; the
 * caller passes it via `cspSource` and it is added alongside 'self'.
 */

export interface BuildCspOptions {
  /** Resolved server API origin (e.g. "https://omnigent.example.com" or "http://127.0.0.1:6767"). */
  serverOrigin: string;
  /**
   * WS origins to allow in connect-src. Typically derived from serverOrigin
   * (ws://127.0.0.1:6767 for local, wss://omnigent.example.com for remote).
   * May include a per-sandbox origin when managed runners use a different WS host (Q2/R9).
   */
  wsOrigins: string[];
  /** The cryptographic nonce for this webview load (fresh per message). */
  nonce: string;
  /**
   * VS Code's webview.cspSource value — the allowlist for the extension's own
   * resources. Passed through so CSP allows the webview resource scheme.
   * When not in a real webview (tests), omit or pass undefined.
   */
  cspSource?: string;
}

/**
 * Build a strict CSP string for the Omnigent WebviewView. Pure — no side effects.
 *
 * Unit-tested via src/panel/csp.test.ts against the PM2 guard assertions.
 */
export function buildCsp(opts: BuildCspOptions): string {
  const { serverOrigin, wsOrigins, nonce, cspSource } = opts;

  // script-src: nonce only (+ cspSource for the extension's own bundled scripts)
  // 'wasm-unsafe-eval' required by Monaco wasm runtime.
  const scriptSrcParts = [`'nonce-${nonce}'`, `'wasm-unsafe-eval'`];
  if (cspSource) scriptSrcParts.push(cspSource);
  const scriptSrc = scriptSrcParts.join(" ");

  // style-src: nonce + unsafe-inline (OmnigentApp uses runtime CSS injection)
  const styleSrc = cspSource
    ? `'nonce-${nonce}' ${cspSource} 'unsafe-inline'`
    : `'nonce-${nonce}' 'unsafe-inline'`;

  // connect-src: server API origin + ws:/wss: for each WS origin
  const wsAllowlist = wsOrigins.join(" ");
  const connectSrc = [
    serverOrigin,
    wsAllowlist,
  ]
    .filter(Boolean)
    .join(" ");

  // img-src / font-src: allow data URIs + vscode-resource scheme + https: for remote images
  const imgSrc = cspSource
    ? `${cspSource} data: https:`
    : `data: https:`;
  // font-src must allow data: — the embed bundle inlines its (icon) fonts as
  // data:font/woff URIs, so a cspSource-only font-src blocks them under the
  // strict webview CSP. The vscode-resource scheme stays allowed for any
  // file-backed fonts shipped under media/.
  const fontSrc = cspSource ? `${cspSource} data:` : `data:`;

  // worker-src: Monaco spawns workers from blob: URLs; also needs cspSource for
  // workers loaded from the extension's own media/ directory.
  const workerSrc = cspSource
    ? `${cspSource} blob:`
    : `blob:`;

  const directives: string[] = [
    `default-src 'none'`,
    `script-src ${scriptSrc}`,
    `style-src ${styleSrc}`,
    `connect-src ${connectSrc}`,
    `img-src ${imgSrc}`,
    `font-src ${fontSrc}`,
    `frame-src ${serverOrigin}`,
    `worker-src ${workerSrc}`,
  ];

  return directives.join("; ");
}

/**
 * Derive the WS origin(s) from a server API origin.
 * Local http -> ws, remote https -> wss.
 * Returns a single origin by default; the caller may append a managed-sandbox
 * origin (Q2/R9) to the returned array.
 */
export function wsOriginsForServer(serverOrigin: string): string[] {
  try {
    const u = new URL(serverOrigin);
    const wsScheme = u.protocol === "https:" ? "wss:" : "ws:";
    return [`${wsScheme}//${u.host}`];
  } catch {
    return [];
  }
}
