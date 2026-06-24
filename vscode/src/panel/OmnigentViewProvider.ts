/**
 * A5/A6/A11 — WebviewViewProvider for the Omnigent activity-bar panel.
 *
 * This is the thin VS Code adapter layer. All render logic is shared with the
 * editor-beside panel host via panel/host.ts (renderInto); pure logic lives in
 * csp.ts / html.ts / iframeHtml.ts / messages.ts so it is testable without an
 * IDE host.
 *
 * Responsibilities:
 *  - Own the webview lifecycle (resolveWebviewView).
 *  - Show a "Resolving server…" placeholder until init() supplies the resolved
 *    server target, then (re)render via the shared host helper.
 *  - Accept NavigateMessage commands from the command layer (A8).
 *  - Forward Webview→Host messages to the output channel.
 */
import * as vscode from "vscode";
import {
  embedLocalResourceRoots,
  renderInto,
  renderResolvingHtml,
} from "./host";
import type { ExtensionToWebview, WebviewToExtension } from "./messages";
import type { ServerTarget } from "../config";
import { readSettings } from "../config/vscodeSettings";
import type { ResolvedToken } from "../auth/precedence";
import { redact } from "../redact";

export const VIEW_ID = "omnigent.panel";

export class OmnigentViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _output: vscode.OutputChannel;

  // Last resolved server target / auth / route — stored so the panel can render
  // (or re-render) with the REAL origin once the server is resolved, and so the
  // editor-beside panel host can reuse the same state.
  private _target?: ServerTarget;
  private _resolved?: ResolvedToken;
  private _route = "/";

  constructor(
    private readonly _extensionUri: vscode.Uri,
    output: vscode.OutputChannel,
  ) {
    this._output = output;
  }

  /** The active server target, exposed so the editor panel host can reuse it (A11). */
  get target(): ServerTarget | undefined {
    return this._target;
  }

  /** The active route (e.g. "/c/<id>"), so a newly opened editor panel matches the view. */
  get route(): string {
    return this._route;
  }

  /** The bearer token for the embed handshake (manual/file sources only). */
  get token(): string | undefined {
    return this._resolved ? this._tokenOf(this._resolved) : undefined;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: embedLocalResourceRoots(this._extensionUri),
    };

    // Listen for webview→host messages.
    webviewView.webview.onDidReceiveMessage((msg: WebviewToExtension) => {
      if (msg.type === "omnigent/ready") {
        this._output.appendLine("[omnigent] webview ready");
      } else if (msg.type === "omnigent/error") {
        this._output.appendLine(`[omnigent] webview error: ${msg.message}`);
      }
    });

    // The view can resolve BEFORE the server target is known. Show a lightweight
    // placeholder until init() arrives with the resolved origin, then re-render.
    if (this._target) {
      this._render(webviewView.webview);
    } else {
      webviewView.webview.html = renderResolvingHtml();
    }
  }

  /** Called by the command layer (A8) to send a navigate message. */
  postMessage(msg: ExtensionToWebview): boolean {
    if (!this._view) return false;
    this._view.webview.postMessage(msg);
    return true;
  }

  /**
   * Called by extension.ts once the server + auth are resolved. Stores the
   * target/route and (re)renders the panel with the REAL origin so the iframe
   * src and CSP frame-src use the resolved server, not a placeholder.
   */
  init(target: ServerTarget, resolved: ResolvedToken, route = "/"): void {
    this._target = target;
    this._resolved = resolved;
    this._route = route;
    this._output.appendLine(
      `[omnigent] init (origin=${target.origin}, hostType=${target.hostType}, tokenSource=${resolved.source}, token=${redact(this._tokenOf(resolved))})`,
    );
    if (this._view) {
      this._render(this._view.webview);
    }
  }

  /** Extract the bearer token from a resolved token (manual/file only). */
  private _tokenOf(resolved: ResolvedToken): string | undefined {
    return resolved.source === "manual" || resolved.source === "file"
      ? (resolved as { token: string }).token
      : undefined;
  }

  private _render(webview: vscode.Webview): void {
    const target = this._target;
    if (!target) {
      webview.html = renderResolvingHtml();
      return;
    }
    renderInto(webview, {
      target,
      extensionUri: this._extensionUri,
      renderMode: readSettings().renderMode,
      route: this._route,
      token: this.token,
      isDarkMode: vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark,
      log: (m) => this._output.appendLine(m),
    });
  }
}
