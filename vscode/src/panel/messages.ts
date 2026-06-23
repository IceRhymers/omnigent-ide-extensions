/**
 * Typed postMessage protocol between the extension host and the webview bootstrap.
 * Token travels ONLY via postMessage (never in a navigable URL — per the gate doc / R3).
 *
 * Host → Webview messages (ExtensionToWebview):
 *   omnigent/init    — initial handshake (server URL + bearer + route + theme)
 *   omnigent/navigate — deep-link to a session route (drives OmnigentApp router)
 *   omnigent/theme    — notify a VS Code theme change
 *
 * Webview → Host messages (WebviewToExtension):
 *   omnigent/ready   — bootstrap has mounted; host may start sending events
 *   omnigent/error   — bootstrap encountered a fatal error
 */

// ── Host → Webview ────────────────────────────────────────────────────────────

export interface InitMessage {
  type: "omnigent/init";
  /** Resolved server base URL (e.g. "http://127.0.0.1:6767"). */
  serverUrl: string;
  /**
   * Bearer token — present when a token is resolved; absent when none.
   * NEVER placed in a navigable URL. Travels only via this postMessage.
   */
  token?: string;
  /** Initial route for OmnigentApp (e.g. "/" or "/c/<id>"). */
  route: string;
  isDarkMode: boolean;
}

export interface NavigateMessage {
  type: "omnigent/navigate";
  /** The route to navigate to (e.g. "/c/<sessionId>"). */
  route: string;
}

export interface ThemeMessage {
  type: "omnigent/theme";
  isDarkMode: boolean;
}

export type ExtensionToWebview = InitMessage | NavigateMessage | ThemeMessage;

// ── Webview → Host ────────────────────────────────────────────────────────────

export interface ReadyMessage {
  type: "omnigent/ready";
}

export interface WebviewErrorMessage {
  type: "omnigent/error";
  message: string;
}

export type WebviewToExtension = ReadyMessage | WebviewErrorMessage;
