/**
 * A5 — CSP string construction (pure, unit-testable, guards PM2).
 *
 * buildCsp() produces a strict nonce-based Content-Security-Policy for the
 * Omnigent WebviewView. It is a PURE function with no VS Code API dependency
 * so it can be tested without an IDE host.
 *
 * Key rules (per plan §A5 + ADR):
 *  - default-src 'none' — deny everything not explicitly allowed.
 *  - script-src 'nonce-{nonce}' — only inline scripts with the nonce (our
 *    bootstrap). No 'unsafe-inline', no 'unsafe-eval'.
 *  - style-src 'nonce-{nonce}' 'unsafe-inline' — OmnigentApp injects runtime
 *    CSS via style attributes; unsafe-inline on style-src is the recommended
 *    trade-off when the injected styles are extension-controlled.
 *  - connect-src — the https/http server API origin + ws:/wss: for each WS
 *    origin provided (covers terminal WS + managed-sandbox WS, R9/Q2).
 *  - img-src — the vscode-resource scheme for local assets + data URIs.
 *  - font-src — the vscode-resource scheme.
 *  - frame-src 'none' — Option B mounts OmnigentApp directly; no remote iframe.
 *  - worker-src 'none'.
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
  const scriptSrc = cspSource
    ? `'nonce-${nonce}' ${cspSource}`
    : `'nonce-${nonce}'`;

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

  // img-src / font-src: allow data URIs + vscode-resource scheme
  const imgSrc = cspSource
    ? `${cspSource} data:`
    : `data:`;
  const fontSrc = cspSource ? cspSource : `'none'`;

  const directives: string[] = [
    `default-src 'none'`,
    `script-src ${scriptSrc}`,
    `style-src ${styleSrc}`,
    `connect-src ${connectSrc}`,
    `img-src ${imgSrc}`,
    `font-src ${fontSrc}`,
    `frame-src 'none'`,
    `worker-src 'none'`,
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
